/**
 * services/klaw.js — K-Law 백그라운드 감시 파이프라인
 */
import { _klawBusy, _klawLastCheck, KLAW_COOLDOWN_MS,
         setKlawBusy, setKlawLastCheck } from '../core/state.js';
import { CFG } from '../core/config.js';
import { TOKEN_BUDGET, FAST_MODEL } from '../core/token-policy.js';
import { appendBubble } from '../ui/bubble.js';
import { _recordPDV } from '../pdv/record.js';
import { _gwpLaunch } from '../gwp/engine.js';

// ══════════════════════════════════════════════════════════════════════
// K-Law 백그라운드 감시 파이프라인 v1.0
//
// 역할: 사용자가 요청하지 않아도 모든 대화·서비스 결과를
//       자동으로 검토하여 법적/분쟁 리스크를 감지합니다.
//
// 트리거:
//   1. callAI() 완료 후 → 대화 내용 자동 검토
//   2. _recordPDV() 호출 후 → 서비스 결과 자동 검토
//
// 결과:
//   - RISK_HIGH/RISK_CRITICAL → 채팅창에 경고 버블 즉시 표시
//   - RISK_LOW/RISK_MEDIUM   → PDV에만 조용히 기록
//   - RISK_NONE              → 무시
// ══════════════════════════════════════════════════════════════════════

// ── K-Law 백그라운드 감시 ON/OFF 스위치 ──────────────────────────────
// 2026-06-27: 모든 대화·PDV 기록마다 자동으로 LLM을 호출해 토큰을
// 과다 소모하는 것이 확인되어 일단 중단. 다시 켜려면 이 값만 true로.
// (꺼도 K-Law 자체 서비스(판결예측, klaw.hondi.net)는 영향 없음 —
//  이건 "사용자가 부르지 않아도 모든 대화를 미리 검토하는" 백그라운드
//  파이프라인만 끄는 스위치다.)
const KLAW_BACKGROUND_ENABLED = false;

// ── K-Law 감시 상태 ────────────────────────────────────────────────

// K-Law Monitor 프롬프트 캐시 (감시용 경량 프롬프트 — v15.1 판결예측과 별개)
let _klawMonitorPrompt = null;
async function _getKlawPrompt() {
  if (_klawMonitorPrompt) return _klawMonitorPrompt;
  try {
    const res = await fetch('/klaw/prompts/monitor_prompt.txt');
    if (res.ok) {
      _klawMonitorPrompt = await res.text();
      console.info('[K-Law Monitor] 프롬프트 로드 완료');
      return _klawMonitorPrompt;
    }
  } catch(e) { console.warn('[K-Law Monitor] 프롬프트 로드 실패:', e.message); }
  return null;
}

// ── 리스크 레벨 정의 ────────────────────────────────────────────────
const KLAW_RISK = {
  NONE:     { label: null,              show: false },
  LOW:      { label: '🟢 낮음',         show: false },  // PDV만 기록
  MEDIUM:   { label: '🟡 검토 권고',    show: false },  // PDV만 기록
  HIGH:     { label: '🟠 주의 필요',    show: true  },  // 채팅창 경고
  CRITICAL: { label: '🔴 법적 리스크',  show: true  },  // 채팅창 즉시 경고
};

// ── 메인: K-Law 백그라운드 검토 ────────────────────────────────────
// source: 'conversation' | 'service'
// payload: 검토할 텍스트 또는 서비스 데이터
export async function _klawReview(source, payload) {
  if (!KLAW_BACKGROUND_ENABLED) return;  // 2026-06-27 중단 — 토큰 낭비 방지

  // 쿨다운 및 중복 실행 방지
  const now = Date.now();
  if (_klawBusy) return;
  if (now - _klawLastCheck < KLAW_COOLDOWN_MS) return;

  // K-Law 프롬프트 로드
  const klawPrompt = await _getKlawPrompt();
  if (!klawPrompt) return;

  setKlawBusy(true);
  setKlawLastCheck(now);

  try {
    // ── 검토 대상 텍스트 구성 ────────────────────────────────
    let reviewText = '';

    if (source === 'conversation') {
      // 최근 대화 5턴 추출 (system 제외)
      const recent = (window._gopangHistory || [])
        .filter(m => m.role !== 'system')
        .slice(-10)
        .map(m => `[${m.role === 'user' ? '사용자' : 'AI'}] ${m.content}`)
        .join('\n');
      if (!recent || recent.length < 50) { setKlawBusy(false); return; }
      reviewText = `## 검토 대상: 고팡 대화 내용\n\n${recent}`;

    } else if (source === 'service') {
      // 서비스 완료 결과 (pdvData)
      reviewText = `## 검토 대상: ${payload.service || '서비스'} 처리 결과\n\n` +
        `서비스: ${payload.serviceId}\n` +
        `요약: ${payload.summary}\n` +
        `데이터: ${JSON.stringify(payload.data || {}, null, 2)}`;
    }

    if (!reviewText) { setKlawBusy(false); return; }

    // ── K-Law API 호출 (백그라운드) ──────────────────────────
    // monitor_prompt.txt가 출력 형식을 완전히 정의하므로 추가 지시 불필요
    // ※ 토큰 절약 정책: 분류/감시 전용 태스크는 사용자가 설정한(비쌀 수 있는)
    //   CFG.model을 쓰지 않고, router.js와 동일한 고정 저가 모델을 쓴다.
    //   이게 바로 2026-06-27에 "토큰 과다 소모"로 이 기능을 통째로 꺼야 했던
    //   원인이었다 — 매 대화·PDV 기록마다 메인 모델(사용자가 고른 비싼 모델)을
    //   호출했기 때문. 고정 저가 모델로 바꾸면 다시 켜도 안전하다.
    const klawSystemPrompt = klawPrompt;

    const res = await fetch(CFG.endpoint + '/deepseek', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:       FAST_MODEL,  // 고정 저가 모델 — CFG.model(사용자 설정) 아님
        max_tokens:  TOKEN_BUDGET.MONITOR_REVIEW,
        temperature: 0.1,   // 일관된 법적 판단을 위해 낮게 설정
        messages: [
          { role: 'system',  content: klawSystemPrompt },
          { role: 'user',    content: reviewText },
        ],
      }),
    });

    if (!res.ok) { setKlawBusy(false); return; }
    const data = await res.json();
    const raw  = data.choices?.[0]?.message?.content || '{}';
    const clean = raw.replace(/```json|```/g, '').trim();

    let result;
    try { result = JSON.parse(clean); }
    catch { setKlawBusy(false); return; }

    const level = result.risk_level || 'NONE';
    const risk  = KLAW_RISK[level] || KLAW_RISK.NONE;

    console.info(`[K-Law Monitor] 감시 완료 — ${level}: ${result.summary || '이상 없음'}`);

    // ── PDV에 감시 결과 기록 (모든 레벨) ────────────────────
    if (level !== 'NONE') {
      _recordPDV({
        type:       'klaw_monitor',
        serviceId:  'klaw',
        service:    'K-Law',
        summary:    `[${level}] ${result.summary || ''}`,
        data:       result,
        source:     source,
        ts:         new Date().toISOString(),
      });
    }

    // ── HIGH/CRITICAL: 채팅창에 경고 버블 표시 ──────────────
    if (risk.show && result.summary) {
      const icon  = level === 'CRITICAL' ? '🔴' : '🟠';
      const html  =
        `<div style="border-left:3px solid ${level==='CRITICAL'?'#C01C28':'#e37400'};` +
        `padding:10px 12px;border-radius:4px;background:${level==='CRITICAL'?'#FEE2E2':'#FFF7ED'}">` +
        `<div style="font-size:11px;font-weight:700;color:${level==='CRITICAL'?'#C01C28':'#e37400'};` +
        `letter-spacing:.5px;margin-bottom:6px">` +
        `${icon} K-Law 자동 감지 — ${risk.label}</div>` +
        `<div style="font-size:14px;color:#1A202C;margin-bottom:${result.detail?'8px':'0'}">${result.summary}</div>` +
        (result.detail  ? `<div style="font-size:12px;color:#4A5568;margin-bottom:6px">${result.detail}</div>` : '') +
        (result.action  ? `<div style="font-size:12px;font-weight:600;color:#0057A8">💡 ${result.action}</div>` : '') +
        `</div>`;
      appendBubble('ai', html, true);
    }

    // ── CRITICAL: K-Police/K-Emergency 탭을 미리 채워서 열되, 실제 신고
    //   전송은 사용자가 직접 확인하고 눌러야 한다(자동 전송 금지 — 오탐
    //   1건으로 진짜 신고가 나가버리는 사고를 막기 위함). 다른 GWP 서비스와
    //   동일한 패턴: "탭을 열어 채워주는 것"까지만 자동, 전송은 사람이.
    if (level === 'CRITICAL') {
      try {
        const svcId  = result.service_id || 'kpolice';  // monitor_prompt.txt가 지정하면 그 값, 없으면 기본 K-Police
        const svcDef = (typeof window.getService === 'function') ? window.getService(svcId) : null;
        if (svcDef) {
          const ctxText = [result.summary, result.detail].filter(Boolean).join(' — ');
          appendBubble('ai',
            `<div style="font-size:12px;color:#4A5568">🔴 ${svcDef.name || svcId} 탭을 미리 채워서 열었습니다 — ` +
            `내용을 확인하시고, 신고가 필요하면 그 탭에서 직접 눌러 전송해 주세요(자동으로 전송되지 않습니다).</div>`,
            true
          );
          _gwpLaunch(svcDef, ctxText, null);
        } else {
          console.warn(`[K-Law] CRITICAL 감지했지만 서비스 정의를 찾지 못함(svcId=${svcId}) — 탭 자동 오픈 생략`);
        }
      } catch (e) {
        console.warn('[K-Law] CRITICAL 탭 오픈 실패(무시, 경고 버블은 이미 표시됨):', e.message);
      }
    }

  } catch(e) {
    console.warn('[K-Law] 감시 오류 (무시):', e.message);
  } finally {
    setKlawBusy(false);
  }
}

// ── 대화 히스토리 전역 노출 (K-Law 감시용) ──────────────────────────
// callAI() 내부의 history를 K-Law가 읽을 수 있도록
// _gopangHistory: call-ai.js의 history 배열을 K-Law가 읽을 수 있도록 노출
// 주의: window.history는 브라우저 히스토리 객체 — 절대 사용 금지
// call-ai.js의 history_ref를 통해 접근
Object.defineProperty(window, '_gopangHistory', {
  get: () => {
    // call-ai.js가 export한 history_ref (배열) 우선 사용
    if (window._callAiHistoryRef && Array.isArray(window._callAiHistoryRef)) {
      return window._callAiHistoryRef;
    }
    return [];
  },
  configurable: true,
});

// ══════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════
