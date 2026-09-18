/**
 * ai/expert-session.js — 전문가 AI(60개 페르소나) 라우팅 + 프롬프트 합성
 *
 * ARCHITECTURE NOTE (2026-08-06 재정리): 전문 분야(기관) AI(K-Law 등)와
 * 마찬가지로, 전문가 AI(변호사·간호사 등)도 2026-07-03부로 "같은 스레드
 * System Prompt 교체" 방식이 아니라 새 탭(pages/expert-chat.html)에서
 * 독립 실행된다. 이 파일에는 그 새 탭을 여는 라우팅 로직(handleExpertTag)과
 * K-Compose/K-Execute 내부 위임(scope=orchestration_subtask, call-ai.js
 * §0-H)이 재사용하는 프롬프트 합성 로직(_composeExpertPrompt)만 남아있다.
 *
 * 예전에 이 파일에 있던 "같은 스레드 세션" 서브시스템(startExpertSession/
 * isExpertActive/maybeHandleExpertTurn/applyExpertSystemIfActive/
 * endExpertSession 등, 2026-07-03 이후 유일한 진입점이던 startExpertSession을
 * 아무도 호출하지 않아 전부 죽은 코드였다)은 2026-08-06 감사로 확인 후
 * src/_archive/expert-session-legacy-inthread.js.md로 코드와 근거를 보존해
 * 이관했다 — 부활이 필요하면 그 파일 참조.
 */
import { CFG } from '../core/config.js';
import { history } from '../core/state.js';
import { appendBubble } from '../ui/bubble.js';
import { EXPERT_REGISTRY, UNIVERSAL_INTEGRITY_KEY, COMMON_GUARDRAILS_KEY, COMMON_MEDICAL_SAFETY_KEY,
         EXPERT_BASE_KEY, CONTROL_TOWER_PRINCIPLE_KEY, getExpertGwpDef, resolveExpertId }
  from './expert-registry.js';
import { refineToLeaf } from './subject-gate.js';
import { _loadSpByKey, _loadSpRawByKey } from './manifest-loader.js';
// ★ 2026-08-30 수정 — 2026-07-19 신설된 핸드오프 맥락 요약(아래
// summarizeHandoffContext6W 호출부, §"AC와의 이전 대화 맥락을 페르소나에
// 함께 인계")이 이 import 자체가 빠져 있어 매번 ReferenceError로 죽고,
// 감싸는 try/catch가 조용히 삼켜 항상 폴백(이번 발화만 전달)으로만
// 동작하고 있었다 — 즉 이 기능은 도입 이후 한 번도 실제로 작동한 적이
// 없었다(expert-session-switch.test.mjs 핸드오프 스위트로 발견).
import { _gwpLaunch } from '../gwp/engine.js';
import { _buildRoutingFacts } from '../services/location.js';
import { summarizeHandoffContext6W } from './report-utils.js';

// 합성된 System Prompt 캐시 (같은 페르소나 재호출 시 재요청 방지 — K-Compose
// nested 위임처럼 한 세션 안에서 같은 페르소나가 반복 호출될 수 있다)
const _promptCache = new Map();

// ── C50(관제탑 원칙) 코드 층 강제용 순수 판정 함수 — 2026-08-06 신설 ──────
// 실제 강제(재시도 카운터·보정 지시 재전송)는 EXPERT 페르소나 대화가
// 실제로 벌어지는 pages/expert-chat.html의 _maybeEnforceNextStep()이
// 수행한다 — 이 함수는 그쪽에서 재사용하는 순수 판정부만 제공한다.
// SP_common_guardrails C50-3이 요구하는 [NEXT_STEP: ...] 태그가 EXPERT
// 페르소나 응답에 실제로 있는지 감지하는 순수 함수. expert-chat.html이
// 매 턴 이걸 호출해, 빠져 있으면 [INTERNAL: ...] 보정 지시를 재전송한다
// (GOV_TASK_SUBMIT_REQUEST 형식 오류 시 재시도 지시 패턴과 동일 메커니즘).
//
// ⚠️ 2026-08-06 정정: 최초 구현 시 이 훅을 call-ai.js에 걸고 isExpertActive()
// (이 파일의 죽은 같은-스레드 세션 게이트)로 가드했었다 — 그 결과 "코드로
// 강제하라"는 지시를 지키려다 실제로는 한 번도 실행될 수 없는 코드를
// 만드는 실수를 했다. 실제 EXPERT 대화는 이 파일이 아니라
// pages/expert-chat.html에서 벌어지므로, 강제 로직 자체도 거기 있어야
// 한다 — 이 파일에는 재사용 가능한 순수 판정 함수만 남긴다.
//
// 오탐 방지를 위해 "아직 결론이 없는 되묻기 턴"은 예외로 둔다(C50-3에
// 명시된 예외와 동일) — 정규식만으로 "이 턴이 결론에 도달했는가"를
// 정확히 판정할 수는 없으므로, 최소 침습적인 근사치를 쓴다: 응답이
// 짧은 되묻기 형태(물음표로 끝나거나 CLARIFY 패턴)이면서 동시에 STEP D
// 정형 블록([위험 고지]/[인간 전문가 연결]) 중 어느 것도 없으면, 아직
// 결론 이전 단계로 보고 보정 대상에서 제외한다. 이 휴리스틱이 실제
// 라이브 트래픽에서 오탐/누락을 만들면(예: 결론이 났는데 되묻기로
// 오분류) tests/live_smoketest/expert_persona_smoketest.py의 채점
// 결과로 드러날 것 — 그 결과를 보고 조정할 것.
const NEXT_STEP_TAG_RE = /\[\s*NEXT_STEP\s*:/i;
const RISK_NOTICE_RE = /\[\s*위험\s*고지\s*\]/;
const HUMAN_CONNECT_RE = /\[\s*CONNECT_HUMAN_EXPERT|\[\s*인간\s*전문가\s*연결\s*\]/;
const CLARIFY_ONLY_RE = /(말씀해\s*주(시겠|세요|시면)|알려\s*주(시겠|세요|시면)|어떤\s*상황|\?\s*$)/;

export function _missingNextStepMarker(fullReply) {
  if (!fullReply || typeof fullReply !== 'string') return false;
  if (NEXT_STEP_TAG_RE.test(fullReply)) return false; // 태그가 있으면 충족
  const looksLikeConclusion =
    RISK_NOTICE_RE.test(fullReply) || HUMAN_CONNECT_RE.test(fullReply);
  const looksLikeClarifyOnly = CLARIFY_ONLY_RE.test(fullReply) && !looksLikeConclusion;
  if (looksLikeClarifyOnly) return false; // 아직 결론 이전 — 예외 대상, 보정 안 함
  return true; // 그 외에는 태그가 빠졌다고 판정
}

// ── 합성 System Prompt 로드 (2026-07-19 재구성) ──────────────────────
// 조립 순서: UNIVERSAL-INTEGRITY → UNIVERSAL-common → PROFESSIONAL-common
//   → 공통 가드레일(C1~C43) → (의료시) 의료 안전모듈 → 페르소나 SP
//
// 배경 ① (2026-07-19 실사로 발견): UNIVERSAL-common(U0 의도특정·U1 권한의
// 한계·U7 업무처리파이프라인 — "안내로 끝내지 않는다"는 원칙의 실제 본문)과
// PROFESSIONAL-common(전문가 사칭 금지·최종판단은 감독전문가 전속 등 정체성
// 계층)이 이 조립 함수 어디에도 없어, 60개 EXPERT 페르소나 전원이 그 원칙
// 없이 구동되고 있었다 — SP 문서 자신은 이 상속을 전제로 쓰여 있었으나
// (예: PROFESSIONAL-common_v1_0.md 헤더) 실제로 로드된 적이 없었다.
//
// 배경 ② (동시 발견): 기존 코드는 _loadSpByKey()를 이 함수 안에서 여러 번
// 호출했는데, _loadSpByKey()가 매번 UNIVERSAL-INTEGRITY·TASK-DELEGATION-GUIDE를
// 자동으로 다시 앞에 붙이는 바람에 최종 합성 프롬프트에 그 두 문서가 최대
// 4번까지 중복 삽입되고 있었다(실사로 확인 — UNIVERSAL-INTEGRITY 시작 문구
// 3회 반복). 공유 상위 계층은 이 함수에서 정확히 한 번만 조립하고, 나머지는
// _loadSpRawByKey()(자동 결합 없음)로 원문만 받아온다.
//
// 2026-07-09: fetch(하드코딩 URL) 직접 호출 -> _loadSpByKey(manifest 키)로
// 전환. sp-catalog.json은 CI가 매 push마다 최신 버전으로 자동 갱신하므로,
// 이제 새 SP 버전을 만들면 이 파일을 손대지 않아도 자동으로 반영된다
// (SP_lawyer가 v3.2에 몇 주간 고정돼 있던 문제의 재발 방지).
// 2026-07-09: export 추가 — call-ai.js의 K-Compose→EXPERT(scope=
// orchestration_subtask) nested 호출(§0-H)이 이 합성 로직을 그대로
// 재사용한다. 페르소나 SP 파일 하나만 달랑 로드하면 UNIVERSAL-INTEGRITY·
// 공통 가드레일(C1~C43)·의료 안전모듈이 빠진 반쪽 프롬프트가 되므로,
// 오케스트레이션 하위 호출이라고 해서 이 합성 과정을 생략하면 안 된다
// — 로직을 중복 구현하지 않고 여기 하나만 있게 유지한다.
export async function _composeExpertPrompt(def) {
  if (_promptCache.has(def.key)) return _promptCache.get(def.key);

  const parts = [];

  // 공유 상위 계층 — 정확히 한 번만 조립(중복 버그 수정, 2026-07-19).
  // UNIVERSAL-INTEGRITY 자기 자신을 로드할 땐 _loadSpByKey()도 자동 결합을
  // 하지 않으므로(self-concat 방지 분기) 그대로 써도 무방하다.
  try {
    parts.push(await _loadSpByKey(UNIVERSAL_INTEGRITY_KEY, 'UNIVERSAL-INTEGRITY'));
  } catch (e) { console.warn('[Expert] UNIVERSAL-INTEGRITY 로드 실패:', e.message); }

  // 2026-08-08 신설(버그 수정) — CONTROL-TOWER-PRINCIPLE(관제탑 원칙)이
  // 지금까지 이 조립 경로에서 한 번도 로드된 적이 없었다(실사로 발견,
  // CONTROL_TOWER_PRINCIPLE_KEY 정의부 주석 참고). UNIVERSAL-INTEGRITY와
  // 같은 이유(self-concat 방지)로 _loadSpByKey를 그대로 써도 안전하다 —
  // manifest-loader.js가 manifestKey==='CONTROL-TOWER-PRINCIPLE'일 때도
  // 동일한 조기 반환 분기를 타므로 원문만 정확히 한 번 실린다.
  try {
    parts.push(await _loadSpByKey(CONTROL_TOWER_PRINCIPLE_KEY, 'CONTROL-TOWER-PRINCIPLE'));
  } catch (e) { console.warn('[Expert] CONTROL-TOWER-PRINCIPLE 로드 실패:', e.message); }

  try {
    parts.push(await _loadSpRawByKey('UNIVERSAL-common', 'UNIVERSAL-common'));
  } catch (e) { console.warn('[Expert] UNIVERSAL-common 로드 실패:', e.message); }

  try {
    parts.push(await _loadSpRawByKey('PROFESSIONAL-common', 'PROFESSIONAL-common'));
  } catch (e) { console.warn('[Expert] PROFESSIONAL-common 로드 실패:', e.message); }

  try {
    parts.push(await _loadSpRawByKey(COMMON_GUARDRAILS_KEY, '공통 가드레일'));
  } catch (e) { console.warn('[Expert] 공통 가드레일 로드 실패:', e.message); }

  if (def.needsMedicalSafety) {
    try {
      parts.push(await _loadSpRawByKey(COMMON_MEDICAL_SAFETY_KEY, '의료 안전모듈'));
    } catch (e) { console.warn('[Expert] 의료 안전모듈 로드 실패:', e.message); }
  }

  // EXPERT_BASE(SP-COMMON-06) — 2026-08-07 신설(HANDOFF SP-EXPERT-BASE-
  // 전체롤아웃계획 §6-2). 법무사·변호사·감정평가사·세무사 4개 실사검증
  // 페르소나에서 추출한 STEP 골격 스캐폴드. 공통 가드레일(및 의료
  // 안전모듈) 다음, 개별 페르소나 SP(또는 §6-4의 부모 SP) 이전에 정확히
  // 한 번만 결합한다 — H2(캐시 프리픽스 고정) 순서를 지키기 위해 이
  // 위치를 벗어나면 안 된다.
  try {
    parts.push(await _loadSpRawByKey(EXPERT_BASE_KEY, 'EXPERT_BASE'));
  } catch (e) { console.warn('[Expert] EXPERT_BASE 로드 실패:', e.message); }

  // 조상(상위 직업군/계열) SP 체인 — 2026-08-07 신설 → 2026-08-08 N단 재귀로
  // 확장(§6-4 개정, HANDOFF_교수-교과계열-계층설계). 기존에는 "부모 1단만"
  // 지원하고(예: physician-internal-medicine → physician) 그 이상(예:
  // professor-semiconductor → professor-engineering-electronics → professor
  // 같은 3단)은 경고만 내고 조상 로드를 건너뛰었다 — 계열(중간) 계층이 필요한
  // 교수(professor) 세부전공 구조를 지원하려고 진짜 N단 재귀로 바꿨다.
  //
  // def.parentKey부터 시작해 EXPERT_REGISTRY를 계속 따라 올라가며(각 노드의
  // parentKey를 다음 조상으로) 체인을 모으고, 루트(가장 위 조상)부터 순서대로
  // EXPERT_BASE 다음·리프 SP 이전에 전부 삽입한다. 방문 집합으로 순환 참조
  // (A→B→A)를 막고, 최대 깊이(5단)로 설정 실수로 인한 무한/과잉 체인을 막는다.
  const MAX_ANCESTOR_DEPTH = 5;
  if (def.parentKey) {
    const chain = [];              // 수집 순서: 바로 위 부모 → ... → 최상위 조상
    const visited = new Set();
    let curKey = def.parentKey;
    while (curKey) {
      if (visited.has(curKey)) {
        console.warn(`[Expert] parentKey 순환 참조 감지(${def.label} 조상 체인 중 ${curKey}) — 이 지점에서 체인 중단`);
        break;
      }
      if (chain.length >= MAX_ANCESTOR_DEPTH) {
        console.warn(`[Expert] parentKey 체인이 최대 깊이(${MAX_ANCESTOR_DEPTH}단)를 초과(${def.label}) — 이후 조상은 무시`);
        break;
      }
      const curDef = EXPERT_REGISTRY[curKey];
      if (!curDef) {
        console.warn(`[Expert] parentKey 미등록: ${curKey} (${def.label} 조상 체인 중 발견)`);
        break;
      }
      visited.add(curKey);
      chain.push(curDef);
      curKey = curDef.parentKey;
    }
    chain.reverse();               // 루트(최상위 조상)부터 삽입되도록 뒤집는다
    for (const ancestorDef of chain) {
      try {
        parts.push(await _loadSpRawByKey(ancestorDef.key, `${ancestorDef.label}(상위 SP)`));
      } catch (e) { console.warn('[Expert] 상위 SP 로드 실패:', ancestorDef.key, e.message); }
    }
  }

  try {
    parts.push(await _loadSpRawByKey(def.key, def.label));
  } catch (e) {
    console.warn('[Expert] 페르소나 SP 로드 실패:', e.message);
    parts.push(`[${def.label} 페르소나 SP 로드 실패 — 일반 전문가 모드로 응답]`);
  }

  const composed = parts.join('\n\n---\n\n');
  _promptCache.set(def.key, composed);
  return composed;
}

// ── 타임아웃 타이머 재설정 ───────────────────────────────────
function _resetTimeoutTimer() {
  if (_expert.timer) clearTimeout(_expert.timer);
  _expert.timer = setTimeout(() => {
    console.info('[Expert] 무응답 타임아웃 — 자동 종료:', _expert.personaId);
    endExpertSession('timeout').catch(e => console.warn('[Expert] 타임아웃 종료 실패:', e.message));
  }, EXPERT_TIMEOUT_MS);
}

function _clearTimeoutTimer() {
  if (_expert.timer) { clearTimeout(_expert.timer); _expert.timer = null; }
}

// ── 태그 해석 실패 공용 리포터 (구조적 취약점 보완 #2, 2026-07-14 신설) ──
// EXPERT([EXPERT: personaId])·GWP([GWP: serviceId]) 두 라우팅 태그 모두
// "모델이 태그는 냈지만 registry에 없는 id"인 경우, 기존에는 콘솔 경고만
// 남기고 사용자에게는 아무 신호 없이 그대로 증발했다(사고실험으로 확인된
// 구조적 취약점). 이제 (1) 사용자에게 실패를 알리고 일반 답변으로 계속
// 도와줄 수 있음을 안내하며, (2) 서버 SP-Author 큐(/sp-author/queue)에
// "unresolved_tag_signal"로 기록해 미등록 수요를 정량적으로 추적한다.
// institution 필드에 raw id를 그대로 넣어두면 서버의 기존 중복병합 로직
// (institution+task 기준, handleSPAuthorQueue 참조)이 동일 id의 반복
// 실패를 자동으로 병합해줘서 큐가 노이즈로 넘치지 않는다.
export function _reportUnresolvedTag(kind, rawId, userText) {
  try {
    appendBubble(
      'ai',
      `요청하신 항목("${rawId}")에 맞는 ${kind === 'expert' ? '전문가' : '서비스'}를 아직 찾지 못했어요. ` +
      `우선 제가 아는 선에서 바로 도와드릴게요.`
    );
  } catch (e) {
    console.warn('[TagTelemetry] 안내 버블 표시 실패(무시):', e.message);
  }
  try {
    const base = (CFG.endpoint || '').replace(/\/+$/, '');
    fetch(`${base}/sp-author/queue`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request_type: 'unresolved_tag_signal',
        signal_source: kind === 'expert' ? 'expert_tag_resolution' : 'gwp_tag_resolution',
        institution: rawId,
        task: `[${kind}] 태그 미해결 — 사용자 발화 기반 수요 신호`,
        source_conversation: userText || '',
        priority: 'low',
      }),
    }).catch(e => console.warn('[TagTelemetry] 큐 등록 실패(무시, 사용자 흐름엔 영향 없음):', e.message));
  } catch (e) {
    console.warn('[TagTelemetry] 큐 등록 시도 실패(무시):', e.message);
  }
}

// ── [EXPERT:personaId] 태그 감지 → 새 탭에서 전문가 페르소나 시작 ──
// call-ai.js의 GWP 태그 파서 옆에서 같이 호출한다.
//
// BUG-FIX(2026-07-03): 기존에는 같은 스레드 안에서 System Prompt만 교체하는
// startExpertSession()을 호출했다(아래에 정의는 남겨뒀지만 이 경로에서는
// 더 이상 호출하지 않는다 — 참고용/향후 필요시 재사용 대비). 이제 GWP
// 기관 서비스와 동일하게 새 탭으로 연다: pages/expert-chat.html이 persona
// 쿼리 파라미터로 SP를 갈아끼워 서빙하고, _gwpLaunch()가 ctx(사용자 발화
// 원문)를 그대로 전달한다 — GWP와 완전히 동일한 핸드오프 규약을 쓴다.
export async function handleExpertTag(fullReply, userText, _preTab) {
  // BUG-FIX(2026-07-02): AGENT-COMMON 프롬프트가 "[EXPERT: SP-LAW-01]"처럼
  // 콜론 뒤 공백을 넣는 형식으로 지시하는데(316/368/893~896행), 이 정규식은
  // 공백을 허용하지 않아 실제 출력과 어긋나 있었다 — GWP와 동일한 원인,
  // 동일한 수정(\s* 추가).
  const m = fullReply?.match(/\[EXPERT:\s*([@\w-]+)\]/);
  let raw = m ? m[1] : null;

  // ★ 2026-07-31 신설 — 태그 누락 폴백(GWP측과 동일한 원리·동일한 발견 근거).
  // 태그가 없을 때만, EXPERT_REGISTRY 표시명(label)이 호출 의도 동사와
  // 함께 유일하게 하나만 등장하면 그걸로 라우팅을 구제한다.
  if (!raw && fullReply && /호출|연결해|시작하겠습니다/.test(fullReply)) {
    const candidates = Object.entries(EXPERT_REGISTRY).filter(
      ([, def]) => def && def.label && fullReply.includes(def.label)
    );
    if (candidates.length === 1) {
      raw = candidates[0][0];
      console.info('[Expert] 태그 누락 폴백 — 표시명 매칭으로 라우팅 복구:', raw);
    }
  }
  if (!raw) return false;

  // @handle 직접 지목은 아직 미구현(별도 기능) — 조용히 무시하고 진행하지 않는다.
  if (raw.startsWith('@')) {
    console.warn('[Expert] @handle 직접 연결은 아직 미구현:', raw);
    return false;
  }

  let personaId = resolveExpertId(raw);
  if (!personaId) {
    console.warn('[Expert] 알 수 없는 전문가 ID:', raw);
    // 2026-07-14 신설(구조적 취약점 보완 #2) — 이전에는 여기서 그냥 return
    // false로 끝나 사용자에게 아무 신호도 없이 태그가 증발했다(핵심
    // 대화가 이미 스트리밍된 뒤라 사용자는 원인을 알 길이 없었음). 이제
    // (1) 사용자에게 실패 사실을 알리고, (2) 실제 미등록 수요로 서버에
    // 기록한다 — 모델이 명시적으로 [SP_DRAFT_REQUEST]를 낸 경우만 큐에
    // 잡히던 기존 방식의 사각지대(태그 자체가 잘못 나온 경우)를 메운다.
    _reportUnresolvedTag('expert', raw, userText);
    return false;
  }

  // ── 2026-08-08 신설(과목 게이트) ──────────────────────────────────
  // 1단계 라우팅이 professor/physician/lawyer처럼 리프 아닌 상위
  // personaId를 냈으면(§CATALOG-EXPERT 표엔 이들이 한 줄로만 있어 라우팅
  // LLM이 애초에 세부 리프 ID를 낼 수 없다 — subject-gate.js 헤더 참조),
  // 여기서 실제 리프로 정밀화한다. gwpDef는 반드시 이 정밀화 *이후*
  // personaId로 다시 조회한다 — 정밀화 전 gwpDef를 재사용하면 personaId만
  // professor-math로 바뀌고 실제 launch는 여전히 professor(범용) SP로
  // 나가는 stale-def 버그가 재발한다.
  // 2026-09-18 변경 — refineToLeaf가 이제 { personaId, ambiguousCandidates }를
  // 반환한다(주피터 지시: 오분류보다 "애매한데 안 되묻는 것"이 진짜 문제).
  // ambiguousCandidates가 있으면 personaId는 정밀화를 멈춘 상위 노드이고,
  // 그 후보들을 finalCtx에 실어 launch되는 페르소나가 직접 확인하게 한다
  // (아래 finalCtx 조립부 참고, SP_EXPERT_BASE §1-2-A).
  const _refined = await refineToLeaf(personaId, userText);
  personaId = _refined.personaId;
  const ambiguousCandidates = _refined.ambiguousCandidates;

  const gwpDef = getExpertGwpDef(personaId);
  if (!gwpDef) {
    console.warn('[Expert] personaId는 해석됐으나 GWP 정의 없음:', personaId);
    _reportUnresolvedTag('expert', raw, userText);
    return false;
  }

  console.info('[Expert] LLM 판단 → 새 탭:', personaId);

  // ── 2026-08-11 신설, 2026-08-14 제거(주피터 지시) — 교수 페르소나 월
  // 사용 한도(시민 티어 제한, 학생 티어 무제한)는 티어가 시민(990원)
  // 단일로 재설계되며 존재 이유(학생 티어와의 가격 차별화)가 사라져
  // 폐지됐다. worker.js의 /subscription/professor-usage/consume도 이제
  // 항상 allowed:true만 반환해 이 호출 자체가 무의미해졌으므로,
  // 호출부도 함께 제거한다 — 남겨두면 효과 없는 네트워크 왕복만
  // 늘어난다. 교수 페르소나 비용은 다른 서비스와 동일하게 기존
  // 토큰 기반 과금(_settleAiUsage)이 건별로 그대로 반영한다.

  // ── 2026-07-19 신설: AC와의 이전 대화 맥락을 페르소나에 함께 인계 ──
  // 배경: 지금까지는 이 태그를 유발한 "이번 발화"(userText) 한 줄만 전달돼,
  // AC와 여러 턴에 걸쳐 이미 확인된 맥락(당사자·경위·이미 진행된 절차 등)이
  // 새 탭에서 소실되고 사용자가 같은 내용을 반복 진술해야 했다(UX 저하 —
  // 주피터 지시). 이번 발화 자신을 제외한 이전 대화만 슬라이스해 6하원칙류
  // 요약을 생성하고, "이번 발화 원문은 그대로 유지"라는 기존 규약은
  // 건드리지 않은 채 그 앞에 요약 블록만 덧붙인다.
  //
  // 실패 시(네트워크 오류 등) priorSummary는 null이 되고, 기존과 동일하게
  // userText만 전달된다 — 100% 하위호환.
  let finalCtx = userText;
  try {
    // AC 대화 로그 중 "이번 발화" 이전 구간만 사용(중복 방지). 이번 발화는
    // 아직 history에 push되지 않은 시점일 수도, 이미 push된 시점일 수도
    // 있으므로 양쪽 다 방어적으로 걸러낸다.
    const priorTurns = history.filter(t =>
      !(t.role === 'user' &&
        (typeof t.content === 'string' ? t.content : '') === userText)
    );
    if (priorTurns.length > 0) {
      const priorTranscript = priorTurns
        .filter(t => t.role === 'user' || t.role === 'assistant')
        .map(t => `[${t.role === 'user' ? '사용자' : 'AI비서'}] ${
          typeof t.content === 'string' ? t.content : JSON.stringify(t.content)
        }`)
        .join('\n');
      const handoff = priorTranscript.trim()
        ? await summarizeHandoffContext6W(priorTranscript)
        : null;
      // 2026-07-19 신설 — risk_signals가 있으면 다른 4개 필드가 전부 비어
      // 있어도(예: 요약할 만한 "사실"은 없지만 위험 신호만 있는 경우) 반드시
      // 포함한다. 일반 요약 4줄과 섞여 묻히지 않도록 별도 블록·경고 표시로
      // 분리한다 — 이 블록이 있다는 것 자체가 페르소나에게 "판단이 필요한
      // 신호가 있다"는 신호이며, 판단 자체(위험한지 아닌지)는 페르소나 몫이다.
      if (handoff && (handoff.party || handoff.situation || handoff.already_done ||
                       handoff.goal || handoff.risk_signals)) {
        const lines = [
          '[AI 비서와의 이전 대화에서 이미 확인된 내용 — 다시 캐묻지 않아도 됩니다]',
          handoff.party        ? `- 당사자/입장: ${handoff.party}`       : null,
          handoff.situation    ? `- 경위·현재 상황: ${handoff.situation}` : null,
          handoff.already_done ? `- 이미 진행된 절차: ${handoff.already_done}` : null,
          handoff.goal         ? `- 원하는 결과: ${handoff.goal}`         : null,
        ].filter(Boolean).join('\n');
        const riskBlock = handoff.risk_signals
          ? `\n\n[⚠️ 이전 대화에서 그대로 보존된 표현 — 요약 압축 없이 원문 전달됨]\n` +
            `"${handoff.risk_signals}"\n` +
            `(이 표현이 위험 신호인지 판단은 당신의 몫입니다 — 요약 과정에서 순화되지 않았습니다)`
          : '';
        finalCtx = `${lines}${riskBlock}\n\n[이번 발화]\n${userText}`;
      }
    }
  } catch (e) {
    console.warn('[Expert] 핸드오프 맥락 요약 실패(무시 — 이번 발화만 전달):', e.message);
  }

  // 2026-09-18 신설 — 2단계 게이트(subject-gate.js)가 세부분야를 확신
  // 있게 못 골랐을 때, 짐작해서 launch하지 않고 그 사실 자체를 페르소나에게
  // 넘긴다. 핸드오프 요약 블록과 같은 자리(둘 다 [이번 발화] 앞에 붙는
  // 구조적 접두 블록)에 쌓는다 — 핸드오프가 있으면 그 위에, 없으면
  // userText 위에 그대로 얹는다.
  if (ambiguousCandidates && ambiguousCandidates.length >= 2) {
    const candLines = ambiguousCandidates.map((l) => `- ${l}`).join('\n');
    finalCtx =
      `[세부 전공/분야 확인 필요 — AI 비서 단계에서 다음 후보 중 하나로 ` +
      `확신 있게 좁히지 못했습니다. 짐작해서 진행하지 말고, 첫 답변에서 ` +
      `이 중 어느 쪽인지(또는 둘 다 아닌지) 자연스럽게 확인한 뒤 진행하세요]\n` +
      `${candLines}\n\n${finalCtx}`;
  }

  _gwpLaunch(gwpDef, finalCtx, _preTab, _buildRoutingFacts());
  return true;
}
