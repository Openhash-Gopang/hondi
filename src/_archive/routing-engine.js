/**
 * ai/routing-engine.js — 나비 라우팅 엔진 v2.0
 *
 * 설계 원칙:
 *   1. 그림자 AI(AGENT-COMMON)는 먼저 GWP_REGISTRY를 검색
 *   2. 매칭 결과에 따라 세 가지 경로로 분기:
 *        inline — 동일 세션 내 Agent SP 주입 (단순 조회·전문 분석)
 *        tab    — 새 탭 오픈 (트랜잭션·결제·서명)
 *        tool   — function calling (웹검색·계산·이미지 등)
 *   3. GWP에 없으면: 유사 SP 참조 → 웹검색 의무 → 실시간 SP 생성 → 임시 등록
 *   4. Agent 완료 후: 6하 보고서 → 그림자 AI → PDV 기록
 *   5. 임시 등록 SP는 관리자 승인 후 정식 등록
 */

import { CFG }                          from '../core/config.js';
import { TOKEN_BUDGET }                 from '../core/token-policy.js';
import { _USER, history }               from '../core/state.js';
import { appendBubble, _createStreamBubble,
         _updateStreamBubble }          from '../ui/bubble.js';
import { _recordPDV }                   from '../pdv/record.js';
import { _gwpLaunch }                   from '../gwp/engine.js';
import { _callLLM }                     from './call-ai.js';   // 내부 LLM 호출 헬퍼 (기존 callAI의 내부 fetch 분리 버전)

// ── 웹검색 Tool (SP 자동생성 시 의무 사용) ─────────────────────
// LLM이 웹검색 기능을 내장하지 않을 경우 이 함수로 대체
export async function _webSearch(query) {
  // 1순위: 등록된 LLM의 내장 웹검색 (Grok, GPT-4o w/ search 등)
  // 2순위: SerpAPI / Brave Search / Tavily API (hondi-proxy 경유)
  // 3순위: 폴백 — DuckDuckGo instant answer (무료, 제한적)
  try {
    const res = await fetch(
      `${CFG.endpoint}/web-search?q=${encodeURIComponent(query)}`,
      { headers: { 'Content-Type': 'application/json' } }
    );
    if (res.ok) {
      const data = await res.json();
      return data.results?.slice(0, 5).map(r =>
        `[${r.title}](${r.url})\n${r.snippet}`
      ).join('\n\n') || '';
    }
  } catch (e) {
    console.warn('[WebSearch] 프록시 검색 실패, DuckDuckGo 폴백:', e.message);
  }
  // 폴백: DuckDuckGo Instant Answer
  try {
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1`
    );
    if (res.ok) {
      const data = await res.json();
      return data.AbstractText || data.Answer || '';
    }
  } catch {}
  return '';
}

// ── LLM이 웹검색 내장 여부 판단 ───────────────────────────────
function _hasBuiltinWebSearch() {
  const model = CFG.model || '';
  // 알려진 웹검색 내장 모델
  const WEB_SEARCH_MODELS = [
    'grok',           // xAI Grok — 실시간 X/웹 검색
    'sonar',          // Perplexity Sonar
    'gpt-4o-search',  // OpenAI GPT-4o with search
    'gemini-2',       // Google Gemini 2.x — Grounding
  ];
  return WEB_SEARCH_MODELS.some(m => model.toLowerCase().includes(m));
}

// ── GWP_REGISTRY 검색 ─────────────────────────────────────────
// triggerScore: 매칭된 trigger 수 × 10 - priority
function _searchRegistry(userText, hasImage = false) {
  if (typeof GWP_REGISTRY === 'undefined' || !GWP_REGISTRY.length) return null;

  let best = null, bestScore = -Infinity;

  for (const svc of GWP_REGISTRY) {
    // 임시등록(pending) 항목도 검색에 포함 (승인 전이라도 사용 가능)
    const matchCount = (svc.triggers || []).filter(t => userText.includes(t)).length;
    if (matchCount === 0) continue;
    const score = matchCount * 10 - (svc.priority ?? 99);
    const threshold = svc.threshold ?? 0.65;
    if (score / 10 < threshold * 10) continue;  // 임계값 미달
    if (score > bestScore) { bestScore = score; best = svc; }
  }
  return best;
}

// ── 유사 SP 탐색 ───────────────────────────────────────────────
// 요청된 기관/전문직과 가장 유사한 기존 SP를 찾아 반환
async function _findSimilarSP(intent) {
  // 1. GWP_REGISTRY에서 같은 category 내 후보 수집
  const candidates = (GWP_REGISTRY || []).filter(s =>
    s.sp_url && s.status === 'active'
  );

  if (!candidates.length) return null;

  // 2. LLM에게 가장 유사한 후보 선택 요청
  const candidateList = candidates.map(s =>
    `- id: ${s.id}, name: ${s.name}, desc: ${s.description}`
  ).join('\n');

  const prompt = `다음 기관/전문직 목록 중 "${intent}"와 가장 유사한 항목 하나를 골라라.
이유 없이 id만 반환하라.

${candidateList}`;

  try {
    const res = await _callLLM([
      { role: 'system', content: '너는 유사도 분류기다. id 값만 반환한다.' },
      { role: 'user',   content: prompt },
    ], { max_tokens: TOKEN_BUDGET.TRIVIAL_PICK, temperature: 0 });
    const similarId = res?.trim();
    return candidates.find(s => s.id === similarId) || candidates[0];
  } catch {
    return candidates[0];
  }
}

// ── 웹검색을 의무적으로 수행하여 SP 생성 컨텍스트 준비 ──────────
async function _gatherWebContext(intent) {
  const queries = [
    `${intent} 주요 업무 기능 서비스`,
    `${intent} 민원 절차 담당부서`,
  ];

  appendBubble('ai', `🔍 "${intent}" 정보를 웹에서 검색 중...`);

  const results = await Promise.all(queries.map(q => _webSearch(q)));
  return results.filter(Boolean).join('\n\n');
}

// ── 실시간 SP 자동생성 ─────────────────────────────────────────
async function _generateSP(intent, similarSP, webContext) {
  const similarSpText = similarSP?.sp_url
    ? await fetch(similarSP.sp_url).then(r => r.text()).catch(() => '')
    : '';

  const prompt = `다음 조건으로 "${intent}"의 시스템 프롬프트(SP)를 작성하라.

[참조 SP — ${similarSP?.name || '없음'}]
${similarSpText.slice(0, 2000)}

[웹 검색 결과]
${webContext.slice(0, 2000)}

[작성 규칙]
1. 참조 SP의 구조(역할·워크플로·출력형식·PDV기록)를 그대로 유지
2. 기관명·담당업무·연락처·절차는 웹 검색 결과 기반으로 정확하게 작성
3. 6하 보고서 형식(REPORT_6W 블록) 반드시 포함
4. 허위 정보 절대 금지 — 불확실한 정보는 "확인 필요"로 표기
5. 한국어, 800자 이내

출력: SP 전문만 반환 (설명 없이)`;

  appendBubble('ai', `✍️ "${intent}" SP 생성 중...`);

  return await _callLLM([
    { role: 'system', content: '너는 나비 Agent SP 작성 전문가다.' },
    { role: 'user',   content: prompt },
  ], { max_tokens: TOKEN_BUDGET.SP_GENERATE, temperature: 0.3 });
}

// ── 임시 등록 (GWP_REGISTRY + L1 PocketBase pending 큐) ────────
async function _registerPendingSP(intent, spText, similarSP) {
  const newId = 'auto-' + intent.replace(/\s+/g, '-').toLowerCase()
                          .replace(/[^a-z0-9-]/g, '') + '-' + Date.now();

  const entry = {
    id:          newId,
    name:        intent,
    category:    similarSP?.category || 'GOV',
    description: `자동생성 — ${intent}`,
    triggers:    [intent, ...intent.split(/\s+/)],
    priority:    50,
    threshold:   0.65,
    type:        similarSP?.type || 'inline',
    sp_text:     spText,           // 자동생성 SP 본문 (URL 대신 직접 저장)
    sp_url:      null,
    status:      'pending',        // 임시 등록 — 관리자 승인 대기
    created_by:  _USER?.ipv6 || 'system',
    created_at:  new Date().toISOString(),
    usage_count: 1,
  };

  // 1. 로컬 GWP_REGISTRY에 즉시 추가 (이 세션에서 바로 사용 가능)
  if (typeof GWP_REGISTRY !== 'undefined') {
    GWP_REGISTRY.push(entry);
  }

  // 2. L1 PocketBase pending_agents 컬렉션에 저장 (다른 사용자 공유 + 관리자 승인 대기)
  try {
    const L1 = (typeof L1_URL !== 'undefined' ? L1_URL : '')
      .replace('/api/collections/profiles/records', '/api/collections/pending_agents/records');
    if (L1) {
      await fetch(L1, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(entry),
      });
      console.info('[Registry] 임시 등록 완료 → 관리자 승인 대기:', newId);
    }
  } catch (e) {
    console.warn('[Registry] L1 저장 실패 (로컬만 등록):', e.message);
  }

  appendBubble('ai',
    `📋 "${intent}" Agent가 임시 등록되었습니다. 관리자 승인 후 모든 사용자가 이용할 수 있습니다.`
  );

  return entry;
}

// ── inline 모드: 동일 세션 내 Agent SP 주입 ───────────────────
// system은 건드리지 않고 (DeepSeek 캐시 보존),
// user 메시지 앞에 [AGENT_CTX] 블록으로 SP 주입
async function _invokeInline(svc, userText) {
  // SP 로드: sp_url 있으면 fetch, sp_text 있으면 직접 사용
  let agentSP = svc.sp_text || '';
  if (!agentSP && svc.sp_url) {
    try {
      const res = await fetch(svc.sp_url, { cache: 'no-cache' });
      if (res.ok) agentSP = await res.text();
    } catch (e) {
      console.warn('[Inline] SP 로드 실패:', e.message);
    }
  }

  // [AGENT_CTX] 블록을 user 메시지 앞에 삽입 (system 불변 — 캐시 보존)
  const injected = `[AGENT_CTX: ${svc.name}]\n${agentSP}\n[/AGENT_CTX]\n\n${userText}`;

  appendBubble('ai', `🤖 ${svc.icon || ''} **${svc.name}** Agent 호출 중...`);

  // 기존 history + injected user message로 LLM 호출
  const sysMsg   = history[0]?.role === 'system' ? [history[0]] : [];
  const dialogs  = history.slice(1, -1);  // 직전 user 메시지 제외
  const messages = [
    ...sysMsg,
    ...dialogs.slice(-16),
    { role: 'user', content: injected },
  ];

  const bubble = _createStreamBubble();
  const reply  = await _callLLM(messages, { max_tokens: TOKEN_BUDGET.AGENT_INLINE, stream: true, bubble });

  // Agent 완료 → 6하 보고서 추출 + PDV 기록
  await _handleAgentReport(reply, svc);

  return reply;
}

// ── tab 모드: 새 탭 오픈 (트랜잭션) ──────────────────────────
function _invokeTab(svc, userText, _preTab) {
  appendBubble('ai', `🔗 **${svc.name}** 서비스를 새 탭에서 열겠습니다.`);
  _gwpLaunch(svc, userText, _preTab);
  // 탭 완료 후 GWP_DONE postMessage → engine.js가 처리 → PDV 기록
}

// ── tool 모드: function calling ────────────────────────────────
async function _invokeTool(svc, userText) {
  appendBubble('ai', `🛠️ **${svc.name}** Tool 실행 중...`);

  // tool.fn이 등록된 경우 직접 실행
  if (typeof svc.fn === 'function') {
    const result = await svc.fn(userText);
    const report = _buildReport6W({
      who:  _USER?.nickname || '사용자',
      what: userText,
      when: new Date().toISOString(),
      where: '나비',
      how:  svc.name + ' Tool',
      result,
    });
    await _recordPDV({ type: 'tool_use', serviceId: svc.id, summary: report });
    return result;
  }

  console.warn('[Tool] fn 미등록:', svc.id);
  return null;
}

// ── 6하 보고서 추출 + PDV 기록 ────────────────────────────────
async function _handleAgentReport(agentReply, svc) {
  // Agent가 REPORT_6W {...} 블록을 출력하면 파싱
  const match = agentReply?.match(/REPORT_6W\s*(\{[\s\S]*?\})/);
  let report6w = null;

  if (match) {
    try { report6w = JSON.parse(match[1]); } catch {}
  }

  // REPORT_6W 없으면 LLM에게 요약 요청
  if (!report6w) {
    const summary = await _callLLM([
      { role: 'system', content: '다음 Agent 응답을 6하 원칙(누가·언제·어디서·무엇을·어떻게·왜)으로 50자 이내 JSON으로 요약하라. 형식: {"who":"...","when":"...","where":"...","what":"...","how":"...","why":"...","result":"..."}' },
      { role: 'user',   content: agentReply?.slice(0, 1000) || '' },
    ], { max_tokens: TOKEN_BUDGET.SUMMARY_SHORT, temperature: 0 });
    try { report6w = JSON.parse(summary?.replace(/```json|```/g, '').trim()); } catch {}
  }

  if (report6w) {
    await _recordPDV({
      type:      'agent_report',
      serviceId: svc.id,
      service:   svc.name,
      summary:   report6w.what || report6w.result || '',
      who:       report6w.who   || _USER?.nickname,
      when:      report6w.when  || new Date().toISOString(),
      where:     report6w.where || '나비',
      what:      report6w.what  || '',
      how:       report6w.how   || svc.name,
      why:       report6w.why   || '',
      ts:        new Date().toISOString(),
    });
    console.info('[AgentReport] PDV 기록 완료:', report6w);
  }
}

// ── 6하 보고서 블록 생성 헬퍼 ─────────────────────────────────
function _buildReport6W({ who, when, where, what, how, why, result }) {
  return `REPORT_6W {"who":"${who}","when":"${when}","where":"${where}","what":"${what}","how":"${how}","why":"${why || ''}","result":"${String(result).slice(0, 100)}"}`;
}

// ══════════════════════════════════════════════════════════════
// ★ 메인 진입점 — route(userText, imageFile, _preTab)
//   send-message.js가 callAI() 대신 이 함수를 먼저 호출
// ══════════════════════════════════════════════════════════════
export async function route(userText, imageFile = null, _preTab = null) {

  // ── Step 1: GWP_REGISTRY 검색 ──────────────────────────────
  const svc = _searchRegistry(userText, !!imageFile);

  if (svc) {
    // ── Step 2a: 매칭 → type별 분기 ───────────────────────────
    console.info('[Route] 매칭:', svc.id, '| type:', svc.type);

    switch (svc.type) {
      case 'tab':
        _invokeTab(svc, userText, _preTab);
        return { routed: true, mode: 'tab', svc };

      case 'tool':
        await _invokeTool(svc, userText);
        return { routed: true, mode: 'tool', svc };

      case 'inline':
      default:
        await _invokeInline(svc, userText);
        return { routed: true, mode: 'inline', svc };
    }
  }

  // ── Step 2b: 매칭 없음 → SP 자동생성 경로 ─────────────────
  // 단순 일상 대화는 자동생성 하지 않음
  const CASUAL_RE = /^(안녕|고마워|감사|ㅋ|ㅎ|시간|날씨|계산|번역).{0,20}$/;
  if (!userText || userText.length < 5 || CASUAL_RE.test(userText.trim())) {
    return { routed: false };  // 그림자 AI 직접 처리
  }

  // 기관/전문직 키워드 탐지
  const INST_RE = /도청|시청|군청|구청|청|원|처|부|공단|공사|협회|위원회|의사|변호사|회계사|세무사|약사|간호사|판사|검사/;
  if (!INST_RE.test(userText)) {
    return { routed: false };  // 일반 질문 → 그림자 AI 직접 처리
  }

  // ── Step 3: 웹검색 의무 수행 (LLM 내장 여부 무관) ──────────
  const intent    = userText.slice(0, 40);
  const webCtx    = await _gatherWebContext(intent);

  // ── Step 4: 유사 SP 탐색 ───────────────────────────────────
  const similarSP = await _findSimilarSP(intent);
  console.info('[Route] 유사 SP:', similarSP?.id || '없음');

  // ── Step 5: 실시간 SP 생성 ─────────────────────────────────
  const newSPText = await _generateSP(intent, similarSP, webCtx);
  if (!newSPText) {
    appendBubble('ai', `⚠️ "${intent}" SP 생성에 실패했습니다. 직접 답변합니다.`);
    return { routed: false };
  }

  // ── Step 6: 임시 등록 ──────────────────────────────────────
  const newEntry = await _registerPendingSP(intent, newSPText, similarSP);

  // ── Step 7: 생성된 SP로 즉시 inline 실행 ───────────────────
  await _invokeInline(newEntry, userText);
  return { routed: true, mode: 'inline-generated', svc: newEntry };
}
