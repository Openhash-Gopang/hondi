/**
 * ui/send-message.js — 메시지 전송 라우팅
 */
import { aiActive, _peer, attachFile, setAttachFile, _locationReady, _locationPending, _USER, USER_GUID, _lastPipelineResult, setLastPipelineResult } from '../core/state.js';
import { _isRegistered, ensureWalletSetup } from '../core/auth.js';
import { appendBubble, riskChip } from './bubble.js';
import { activateAI } from '../ai/toggle.js';
import { _sendP2P } from '../p2p/webrtc.js';
import { callAI } from '../ai/call-ai.js';
import { _showRegisterFlow } from './register-flow.js';
import { CFG } from '../core/config.js';
import { _gwpLaunch } from '../gwp/engine.js';

export function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}
export function updateSendBtn() {
  const v = document.getElementById('msg-input').value.trim();
  const hasInput = !!(v || attachFile);
  document.getElementById('send-btn').disabled = !hasInput;

  // 등록 사용자 + 대화 상대 없음 + AI 비활성 → 입력 시작 시 AI 자동 활성화
  if (hasInput && !aiActive && !_peer && _isRegistered()) {
    activateAI(true);
  }
}
export function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

// ── 메시지 전송 ─────────────────────────────────────────

export async function sendMessage() {
  const inp  = document.getElementById('msg-input');
  const text = inp.value.trim();
  if (!text && !attachFile) return;

  // 2026-07-23 신설 — 실제로 서명이 필요해지는 첫 지점(메시지 전송)에서만
  // "계정 연결" 흐름을 띄운다. 이 함수 내부에서 이미 지갑이 있거나, 이
  // 기기가 애초에 대상이 아니거나(모바일 등), 이번 세션에 이미 한 번
  // 물어봤으면 즉시 반환하므로 평소엔 아무 체감 지연이 없다.
  await ensureWalletSetup();

  // 첫 메시지 전송 시 GPS 요청 — PWA 배너가 이미 처리된 후이므로 충돌 없음
  // ★ 2026-07-22 버그 수정: 모바일 실기기(브라우저·설치된 웹앱 모두)에서
  // "GWP 새 탭이 전혀 안 열림 + 폴백 링크도 안 뜸" 재현됨. 원인은
  // navigator.geolocation.watchPosition()이 이 세션 첫 호출 시 네이티브
  // 위치 권한 다이얼로그를 띄우는데(_locationReady/_locationPending은
  // 매 페이지 로드마다 초기화되므로 매번 재발), 그게 아래쪽의
  // window.open('', '_blank')(GWP 프리탭 예약)보다 먼저 실행돼서
  // 모바일 브라우저가 사용자 활성화(user activation)를 소진된 것으로
  // 판단 → 이후 window.open()을 팝업으로 오판해 조용히 차단. 데스크톱
  // 에뮬레이션에서 재현이 안 된 건 그 테스트 계정이 데스크톱에서는 이미
  // 위치 권한을 허용해둔 상태라 재프롬프트가 없었기 때문으로 보임.
  // setTimeout(0)으로 다음 매크로태스크로 미루면, 같은 클릭 핸들러 안의
  // window.open() 호출들이 권한 다이얼로그보다 먼저 끝나 사용자 활성화가
  // 살아있는 상태에서 실행된다. _initLocation()은 원래도 await 없는
  // fire-and-forget이라 지연 자체는 기능에 영향 없음.
  if (!_locationReady && !_locationPending) setTimeout(_initLocation, 0);

  const capturedFile = attachFile;   // 전송 전에 캡처 (removeAttach 전)

  // 사용자 버블 — 이미지 첨부 시 미리보기 포함
  if (capturedFile && capturedFile.type.startsWith('image/')) {
    const objUrl = URL.createObjectURL(capturedFile);
    const imgId  = 'img-' + Date.now();
    appendBubble('user',
      `${text ? text + '<br>' : ''}<img id="${imgId}" src="${objUrl}"
        style="max-width:220px;max-height:180px;border-radius:10px;
               margin-top:${text?'6px':'0'};display:block">`, true);
    // CSP 친화적: 인라인 onload 대신 JS 이벤트 리스너
    requestAnimationFrame(() => {
      const imgEl = document.getElementById(imgId);
      if (imgEl) imgEl.addEventListener('load', () => URL.revokeObjectURL(objUrl), { once: true });
    });
  } else {
    if (text) appendBubble('user', text);
    if (capturedFile) appendBubble('user', capturedFile.name, false);
  }

  // ★ history.push(user)는 callAI 내부에서 처리
  //   (callAI 진입 전에 push하면 isFirstTurn 감지 오작동)
  inp.value = '';
  inp.style.height = 'auto';
  updateSendBtn();
  removeAttach();

  // BUG-FIX(2026-07-02): blur() 호출이 없어서 전송 후에도 입력창에 포커스가
  // 그대로 남아있었다 — 모바일에서 키패드가 계속 확장된 채로 안 내려가던
  // 원인. PC는 애초에 가상 키패드가 없으니 이 blur()가 있어도 아무 영향
  // 없다(정상). AI 패널의 #ai-panel-input(readonly + onblur 트릭)과 동일한
  // 의도 — 여긴 훨씬 단순하게 전송 시점에 명시적으로 포커스만 놓으면 된다.
  inp.blur();

  // ── 대화 상대 분기 ─────────────────────────────────────
  if (text) {
    // 로컬 명령: 최근 위험 분석 결과 조회 — 2026-07-18 라우팅 신설.
    // showRiskAnalysis()는 오래전부터 정의만 되고 어디서도 호출되지 않는
    // 고아 함수였다(HANDOFF_2026-07-18 §2-(1) 후속 과제). 파이프라인
    // 재실행이나 AI/P2P 전송 없이 즉시 로컬에서 처리하고 반환한다.
    if (_isRiskAnalysisCommand(text)) {
      showRiskAnalysis();
      return;
    }

    // 2026-07-18 버그 수정: _runPipelineBackground()는 정의만 돼 있고
    // 어디서도 호출되지 않고 있었다(export도 안 됨, 이 파일 내 호출도
    // 없음 — src/app.js의 낡은 주석에 "index.html이 담당"이라고만 남아
    // 있었는데 실제로 그 연결이 새 아키텍처로 넘어오며 빠짐). 위험 탐지·
    // PDV 기록·OpenHash 앵커링·Phase 7이 전부 여기 걸려 있으므로,
    // 실제 전송을 막지 않도록 완전히 비동기(fire-and-forget)로 호출한다.
    _runPipelineBackground(text);

    if (_peer) {
      // 사람과 대화 → WebRTC P2P 전송 (등록/비등록 모두 가능)
      await _sendP2P(text);
    } else if (aiActive) {
      // AI와 대화
      // ★ 2026-07-21 신설 — 실사로 발견한 버그: GWP(K-Law 등) 새 탭은
      // AI 응답이 다 온 "뒤에" _gwpLaunch()가 window.open()을 호출했다.
      // 클릭과 그 호출 사이에 시간차가 생겨 브라우저가 "사용자가 요청
      // 안 한 팝업"으로 오인해 차단 → 매번 허용 여부를 묻는 프롬프트가
      // 뜨고, 허용해도 그 사이 오리진 관계(opener)가 불안정해지는 부작용
      // 까지 있었다. engine.js의 _gwpLaunch()는 원래 _preTab(클릭 즉시
      // 미리 열어둔 빈 탭)을 받으면 그걸 재사용하도록 이미 만들어져
      // 있었는데, 정작 호출부(여기)가 한 번도 그걸 넘긴 적이 없어 죽은
      // 기능이었다. 지금 이 시점은 sendMessage() 호출 이후 아직 어떤
      // await도 거치지 않은 상태라(_runPipelineBackground는 fire-and-
      // forget) 클릭 제스처가 아직 살아있다 — 여기서 열면 팝업 차단
      // 대상이 아니다. GWP가 실제로 호출되지 않으면 call-ai.js가 이
      // 빈 탭을 알아서 닫는다(기존 로직 그대로).
      const _preTab = window.open('', '_blank');
      await callAI(text, capturedFile, _preTab);
    } else if (_isRegistered()) {
      // 등록 사용자 + 대화 상대 없음 → AI 자동 활성 후 전달
      activateAI(true);
      const _preTab = window.open('', '_blank');
      await callAI(text, capturedFile, _preTab);
    } else {
      // 미등록(Guest) → 등록 유도
      appendBubble('ai',
        '<b>고팡 아이디를 등록</b>하면 AI 비서와 대화할 수 있습니다.<br>' +
        '<span style="font-size:12px;color:var(--txt3)">상단 <b>AI</b> 버튼을 탭하여 등록하세요.</span>',
        true
      );
    }
    return;
  }

  // text 없는 경우 (이미지만) → callAI로 처리
  if (capturedFile && aiActive) {
    const _preTab = window.open('', '_blank');
    await callAI('', capturedFile, _preTab);
  }
}

// ── 고팡 파이프라인 백그라운드 실행 ─────────────────────
// 대화 중 결과를 표시하지 않음 — 사용자 요청 시 showRiskAnalysis() 호출
// (2026-07-18: 결과 저장은 이 파일 로컬 변수가 아니라 core/state.js의
// _lastPipelineResult/setLastPipelineResult 공유 상태를 쓴다 — 이전엔
// 이름이 같은 로컬 변수가 state.js의 export를 shadow하고 있어서, 다른
// 모듈에서는 state.js를 import해도 항상 null만 보이는 상태였다.)

// 사용자가 위험 분석 결과 조회를 요청했는지 판단하는 로컬 명령 트리거.
// GWP_REGISTRY의 trigger 배열과 동일한 방식(문구 포함 여부)을 따른다.
const RISK_ANALYSIS_TRIGGERS = [
  '분석 결과 보여줘', '분석결과 보여줘',
  '위험 분석 보여줘', '위험분석 보여줘',
  '분석 결과 확인', '방금 분석 결과',
  '위험도 보여줘', '위험도 확인',
];
export function _isRiskAnalysisCommand(text) {
  const t = text.trim();
  return RISK_ANALYSIS_TRIGGERS.some(trigger => t === trigger || t.includes(trigger));
}

// ── Phase 7(AI 종합 위법 가능성 판단) LLM 호출자 — 2026-07-18 신설 ──
// CFG.phase7.enabled가 꺼져 있으면 null을 반환하고, runPipeline은 그
// 경우 Phase 7을 항상 skip한다(비용 0). 켜져 있으면 worker.js의
// /deepseek(사용자 본인 guid로 호출 — 본인 무료 한도/GDC 잔액에서
// 차감, 수익자 부담 원칙)를 통해 실제 LLM을 호출한다.
function _buildPhase7LlmCaller() {
  if (!CFG.phase7?.enabled) return null;
  const tier = CFG.phase7.tier === 'pro' ? 'hondi-pro' : 'hondi-flash';
  return async ({ systemPrompt, userMessage }) => {
    const guid = _USER?.ipv6 || USER_GUID || null;
    const res = await fetch(`${CFG.endpoint.replace(/\/+$/, '')}/deepseek`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: tier,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userMessage },
        ],
        max_tokens: 300,
        temperature: 0.2,
        guid,
      }),
    });
    if (!res.ok) throw new Error(`phase7 llm http ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  };
}

async function _runPipelineBackground(text) {
  try {
    // 2026-07-18 버그 수정: 예전엔 './src/ai-secretary/pipeline.js'였는데,
    // 이 파일(src/gopang/ui/send-message.js) 기준 상대경로는
    // 'src/gopang/ui/src/ai-secretary/pipeline.js'로 잘못 해석됨(존재하지
    // 않는 경로). ES 동적 import는 참조 모듈 기준 상대경로라 이 값은 항상
    // 404로 실패했고, catch가 콘솔 경고만 남기고 조용히 삼켜서 지금까지
    // 발견되지 않았다 — 즉 Phase 0~6(위험 탐지·PDV 기록·OpenHash 앵커링)
    // 전체가 실제로는 한 번도 실행되지 못했던 것으로 보인다.
    const { runPipeline } = await import('../../ai-secretary/pipeline.js');
    const llmCaller = _buildPhase7LlmCaller();
    const result = await runPipeline(
      { content: text, senderId: 'user', attachment: attachFile ?? null },
      {}, null, llmCaller
    );
    setLastPipelineResult(result);

    // OpenHash ref는 상태 바에만 조용히 업데이트
    if (result?.anchorHash) {
      const el = document.getElementById('hash-ref');
      if (el) el.textContent = result.anchorHash.slice(0, 8) + '…';
    }

    // S3 감지 시 즉시 경고 (위험 등급 S3만 예외적으로 즉시 표시)
    const isS3 = result?.riskResult?.level === 'S3';
    // Phase 7(LLM, opt-in)이 위법 가능성을 종합 판단해 recommend_review를
    // 켠 경우 — 규칙기반만으론 안 잡히던 완곡어법·암시적 위협 케이스.
    const flaggedByPhase7 = !!result?.overallAssessment?.recommendReview;

    if (isS3) {
      const chip = riskChip('S3', result.riskResult.legalFlags ?? []);
      appendBubble('ai',
        `🛑 위험 감지 — 즉시 확인이 필요합니다. ${chip}`, true);
      _injectReportSuggestion(text, result, 'S3');
    } else if (flaggedByPhase7) {
      const reasoning = result.overallAssessment.reasoning
        ? ` — ${result.overallAssessment.reasoning}` : '';
      appendBubble('ai',
        `⚠️ AI 종합 판단: 위법 가능성이 있어 보입니다${reasoning}. 신고 여부는 아래에서 직접 결정해 주세요.`, true);
      _injectReportSuggestion(text, result, 'PHASE7');
    }
  } catch (e) {
    // 파이프라인 오류는 콘솔에만 기록, 사용자에게 표시하지 않음
    console.warn('[Pipeline]', e.message);
  }
}

// ── 신고 제안 UI — 2026-07-18 신설 ──────────────────────────────
// 절대 자동으로 신고하지 않는다. 신고 초안만 만들어 두고, 사용자가
// "K-Police에 신고" 버튼을 직접 눌러야만 K-Police 웹앱으로 핸드오프된다
// (_gwpLaunch — 새 탭, 실제 제출은 그 탭에서 사용자가 직접 진행).
function _injectReportSuggestion(text, result, source) {
  const list = document.getElementById('message-list');
  if (!list) return;
  document.getElementById('_police-report-row')?.remove();

  window._pendingPoliceReportDraft = _buildPoliceReportDraft(text, result, source);

  const row = document.createElement('div');
  row.className = 'msg-row ai';
  row.id = '_police-report-row';
  row.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;padding:4px 0;">
      <button onclick="window._launchPoliceReport()"
        style="background:#dc2626;color:#fff;border:none;border-radius:8px;
               padding:10px 20px;font-size:14px;font-weight:600;cursor:pointer;">
        🚨 K-Police에 신고
      </button>
      <button onclick="window._dismissReportSuggestion()"
        style="background:var(--bg-subtle);color:var(--label-2);border:1px solid var(--sep);
               border-radius:8px;padding:10px 16px;font-size:13px;cursor:pointer;">닫기</button>
    </div>`;
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;
}

function _buildPoliceReportDraft(text, result, source) {
  const ts       = new Date().toISOString();
  const level    = result?.riskResult?.level ?? 'S1';
  const flags    = (result?.riskResult?.legalFlags ?? []).join(', ');
  const reasoning  = result?.overallAssessment?.reasoning ?? '';
  const anchorHash = result?.anchorHash ?? '';
  return [
    '[혼디 신고 초안 — 사용자 확인 후 제출, 자동 전송 아님]',
    `시각: ${ts}`,
    `분류: ${level}${source === 'PHASE7' ? ' (AI 종합판단·recommend_review)' : ' (규칙기반 즉시감지)'}`,
    flags     ? `관련 카테고리: ${flags}` : null,
    reasoning ? `AI 판단 근거: ${reasoning}` : null,
    anchorHash? `증거 해시(OpenHash 앵커): ${anchorHash}` : null,
    '---',
    `해당 메시지 내용: ${text}`,
  ].filter(Boolean).join('\n');
}

window._launchPoliceReport = function() {
  document.getElementById('_police-report-row')?.remove();
  const draft = window._pendingPoliceReportDraft;
  window._pendingPoliceReportDraft = null;
  if (!draft) return;

  // getService()는 gwp-registry.js(전역 스크립트)가 제공 — call-ai.js의
  // [GWP:] 태그 처리와 동일한 조회·status 가드 패턴을 그대로 따른다.
  const svcDef = (typeof getService === 'function') ? getService('kpolice') : null;
  if (!svcDef || svcDef.status !== 'active') {
    appendBubble('ai',
      '⚠️ K-Police 연동 서비스가 아직 준비 중입니다. 긴급 상황이면 112(범죄)·119(구조)로 직접 연락해 주세요.', true);
    return;
  }
  appendBubble('user', '[신고 요청] K-Police로 신고 초안을 전달합니다 — 실제 제출은 새 탭에서 직접 진행해 주세요.', false);
  _gwpLaunch(svcDef, draft);
};

window._dismissReportSuggestion = function() {
  document.getElementById('_police-report-row')?.remove();
  window._pendingPoliceReportDraft = null;
};

// 사용자 요청 시 분석 결과 표시 (예: "분석 결과 보여줘")
function showRiskAnalysis() {
  if (!_lastPipelineResult) {
    appendBubble('ai', '분석된 메시지가 없습니다.');
    return;
  }
  const r   = _lastPipelineResult.riskResult;
  const chip = riskChip(r?.level ?? 'S0', r?.legalFlags ?? []);
  appendBubble('ai',
    `분석 완료 ${chip}${r?.legalFlags?.length ? '<br>' + r.legalFlags.join(' · ') : ''}`,
    true);
}

