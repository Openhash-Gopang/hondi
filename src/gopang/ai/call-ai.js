/**
 * ai/call-ai.js — LLM API 호출·스트리밍·GWP 태그 처리 + profile-assistant 온보딩 관리 v2.0
 *
 * (2026-07-08: PA/personal-assistant를 profile-assistant로 개명·역할 분리.
 *  "PA"라는 약칭은 이제 쓰지 않는다 — 프로필 작성만 다루는 SP가 됐다.)
 *
 * profile-assistant 온보딩 흐름:
 *   1. _buildProfileContext() — gopang_user_v4(가입 데이터) + hondi_profile_partial(진행 중 데이터)를
 *      읽어 [CONTEXT: PROFILE_ONBOARDING] 블록 생성 → profile-assistant SP에 주입
 *      → 이미 아는 항목은 다시 묻지 않음
 *   2. 호출 경로 둘 — ① settings.js 프로필 작성 패널(직접 호출)
 *      ② AGENT-COMMON의 [CALL_PROFILE_ASSISTANT] 위임(§0-E) → 이 창의
 *      system을 그대로 profile-assistant로 바꿔치기(_switchToProfileAssistantSP())
 *   3. 응답 처리 — PROFILE_SUBMIT / PROFILE_SKIP / [N/6단계] 감지 → 상태 갱신 + AC로 SP 전환
 *      / [PROFILE_INTERRUPT_HANDOFF] 감지 → 무관한 요청을 AC에게 즉시 반환
 */
import { CFG, _modelSupportsVision, PROVIDER_INFO, getPriorityOrder, MODEL_MIGRATION } from '../core/config.js';
import { TOKEN_BUDGET, resolveChatBudget, resolveOrchestrationModel } from '../core/token-policy.js';
import { IMPORTANCE } from '../../core/constants.js';
import { aiActive, history, _userLocation,
         _USER, USER_GUID, _locationPending, _locationReady,
         _gwpLiveProgress, _paHandoffPending, setPaHandoffPending } from '../core/state.js';
import { appendBubble, showTyping, hideTyping,
         _createStreamBubble, _updateStreamBubble, setBubbleTarget } from '../ui/bubble.js';
import { _buildLocNote, _buildRoutingFacts, _waitForLocationReady } from '../services/location.js';
import { _injectAuthConfirmButton } from '../core/auth.js';
import { _klawReview } from '../services/klaw.js';
import { openSearch } from '../ui/p2p-search.js';
import { inviteByHandle } from '../ui/p2p-chat.js';
import { _openProfilePanel } from '../ui/settings.js';
import { _gwpLaunch } from '../gwp/engine.js';
import { handleExpertTag, _composeExpertPrompt } from './expert-session.js';
import { getExpertDef, resolveExpertId, EXPERT_REGISTRY } from './expert-registry.js';
import { buildHondiFaqContext } from './hondi-faq-router.js';
import { buildRoutingHintPart } from './routing-hint.js';
import { findFreshCredential } from '../idv/idv-store.js';

// ═══════════════════════════════════════════════════════════
// 2026-08-10 신설 — "내 사용량 보여줘" 등 액션 인텐트 → usage.html
// 대시보드로 안내하는 버튼을 즉시(LLM 호출 없이) 표시한다.
//
// 기존 hondi-faq-router.js의 'quota' 항목(트리거: '사용량', '얼마나 썼' 등)은
// "무료 한도가 뭔지 설명해달라"는 정보성 질문에는 잘 맞지만, "그래서 내
// 실제 사용량을 화면으로 보고 싶다"는 액션 요청에는 텍스트 설명만
// 돌려주고 실제 대시보드로 연결하지 않았다 — PC에서는 settings.js가
// usage.html을 이미 열어주지만, 이 채팅 인터페이스(특히 폰)에서 "보여줘"
// 라고 말했을 때 실제로 열어주는 경로가 없었던 게 이 신설의 이유다.
//
// LLM에게 별도 태그를 가르쳐 방출시키는 방식(예: _handleBalanceCheckTag의
// [BALANCE_CHECK] 패턴) 대신, 여기서는 결정론적 로컬 매칭으로 처리한다 —
// "화면을 열어달라"는 건 LLM의 자연어 이해가 필요한 애매한 요청이 아니라
// 명확한 UI 액션이므로, 매 턴 LLM 호출 비용·지연 없이 즉시 응답하는 게
// 사용자 경험상 더 낫다. 명사(사용량/지출 등) + 액션 동사(보여줘/열어줘 등)
// 둘 다 있어야 매칭되도록 일부러 보수적으로 잡았다 — "사용량이 얼마나
// 될까요?"처럼 순수 질문형은 그대로 기존 대화 흐름(FAQ 텍스트 설명 또는
// [BALANCE_CHECK])을 타게 둔다.
const _USAGE_DASHBOARD_NOUN = /사용량|지출|충전\s*내역|사용\s*내역|GDC\s*(잔액|현황)/i;
const _USAGE_DASHBOARD_ACTION = /보여\s*줘|보고\s*싶|확인하고\s*싶|확인해\s*줘|열어\s*줘|대시보드|화면으로|어디서\s*보|어디서\s*확인/i;

function _matchUsageDashboardIntent(text) {
  if (!text || typeof text !== 'string') return false;
  if (text.trim().startsWith('[')) return false; // 클라이언트 내부 신호 제외 (hondi-faq-router.js와 동일 원칙)
  return _USAGE_DASHBOARD_NOUN.test(text) && _USAGE_DASHBOARD_ACTION.test(text);
}
import { setPdvDomain, getPdvDomain, _buildPDVNote, _saveProjectState, _loadOpenProjectStates, _proposeSpUpdate, _submitUserFeedback } from '../pdv/record.js';
// ★ 2026-07-11 추가: _callGeminiGeneral 등 5개 함수가 vision.js에 정의는
// 돼 있는데 여기서 import가 빠져 있었다 — 이미지 첨부 후 Gemini 분석
// 경로를 탈 때마다 ReferenceError로 죽고 있었을 것(실사로 확인, 아래
// import 없이 호출부만 있었음).
import { _fileToBase64, _showGeminiProgress, _hideGeminiProgress,
         _callGeminiGeneral, _geminiResultToText } from './vision.js';


export let history_ref = history;  // 외부 참조용

// ── manifest 기반 SP 로더 ────────────────────────────────────────────
// _loadManifest/_loadSpByKey 는 manifest-loader.js 로 이미 분리돼 있었으나
// (2026-07-09 신설, expert-session.js는 그쪽을 사용 중) call-ai.js만 자체
// 사본을 그대로 갖고 있어 manifest.json(현 sp-catalog.json)을 두 번 fetch하고 있었다(W-16 발견,
// 2026-07-09). manifest-loader.js는 call-ai.js/expert-session.js 어느 쪽도
// import하지 않는 독립 모듈이라 순환 참조 없이 바로 가져다 쓸 수 있다.
import { _loadSpByKey } from './manifest-loader.js';

// ── AC 사전 분류기(ac-intent-router.js) 배선 (2026-09-13 신설) ──────────
// 배경은 ac-intent-router.js 파일 상단 주석 참고. 여기서는 그 모듈이
// 필요로 하는 data/ac-routing-registry.json을 fetch해 캐싱하는 로더만
// 둔다 — manifest-loader.js의 _loadManifest()와 동일한 패턴(세션당 1회,
// no-cache로 최신본 보장).
import { classifyIntent, ROUTE_TYPES } from './ac-intent-router.js';
let _routingRegistryCache = null;
async function _loadRoutingRegistry() {
  if (_routingRegistryCache) return _routingRegistryCache;
  try {
    const res = await fetch('/data/ac-routing-registry.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('routing registry fetch 실패: ' + res.status);
    _routingRegistryCache = await res.json();
    return _routingRegistryCache;
  } catch (e) {
    console.warn('[Router] ac-routing-registry.json 로드 실패(무시, classifyIntent 사전분류 생략):', e.message);
    return null;
  }
}

// AC-PRO-CORE(신규 기본 프롬프트) — 세션당 1회 캐시
// v1.5(2026-07-28) — Pro/Flash 재설계: 기본으로 로드하는 프롬프트를
// AGENT-COMMON(2500줄+ 판단보조 SCAFFOLDING 포함, 구 hondi-flash용)에서
// AC-PRO-CORE(CORE+CATALOG+SAFETY만 남긴 신규, hondi-pro용)로 교체한다.
// 함수 이름은 이 파일 밖에서도 여러 곳(webapp.html _callPanelAI 등)이
// import해서 쓰고 있어, 이름을 그대로 두고 내부 로드 대상만 바꾼다 —
// 이름과 실제 로드 내용이 어긋난다는 걸 알아둘 것(리네이밍은 별도 작업).
let _agentCommonCache = null;
// v1.3 — export: AI 패널(webapp.html _callPanelAI)도 같은 manifest 기반 로더를
// 쓰도록 공개.
// v1.4(2026-07-05) — 실패 시 빈 문자열을 반환하는 건 그대로지만, 호출자가
// 이걸 "폴백으로 대체해도 되는 신호"로 쓰면 안 된다 — webapp.html에 있던
// 내장 _PA_SYSTEM_PROMPT 폴백(안전장치 전혀 없는 742자 축약판)을 완전히
// 제거하면서, 호출자는 빈 문자열을 받으면 명확한 오류를 보여주고 중단해야
// 한다. AC-PRO-CORE는 유일한 정본이며, 그 대체물은 존재하지 않는다.
export async function _loadAgentCommonSP() {
  if (_agentCommonCache) return _agentCommonCache;
  try {
    _agentCommonCache = await _loadSpByKey('AC-PRO-CORE', 'AC-PRO-CORE');
    return _agentCommonCache;
  } catch (e) {
    console.error('[SP] AC-PRO-CORE 로드 실패:', e.message);
    return '';
  }
}

// AC-FLASH-EXECUTOR(신규) — hondi-flash에게 위임할 때만 로드, 세션당 1회 캐시
let _flashExecutorCache = null;
export async function _loadFlashExecutorSP() {
  if (_flashExecutorCache) return _flashExecutorCache;
  try {
    _flashExecutorCache = await _loadSpByKey('AC-FLASH-EXECUTOR', 'AC-FLASH-EXECUTOR');
    return _flashExecutorCache;
  } catch (e) {
    console.error('[SP] AC-FLASH-EXECUTOR 로드 실패:', e.message);
    return '';
  }
}

// UNIVERSAL-job-assist (2026-07-15 신설) — AGENT-COMMON과 달리 CFG.system_base에
// 넣지 않는다. 위 AGENT-COMMON 로드 지점 주석에 "system 메시지는 세션 내 절대
// 변경하지 않는다(DeepSeek 캐시 prefix 보존)"는 명시적 원칙이 있는데, 이 모듈은
// [PDV_DOMAIN_SET mode=work] 태그로 세션 도중 켜지고 꺼질 수 있는 상태(getPdvDomain())에
// 반응해야 하므로 system이 아니라 매 턴 _buildEnhancedUserContent()의 동적
// 컨텍스트로 주입한다(job_ksco/affiliation과 같은 위치·같은 이유, UNIVERSAL-
// INTEGRITY의 user 메시지 병합 패턴과도 동일). UNIVERSAL-job-assist_v1_1.md
// 서문 참고 — v1.0의 "system 상속" 서술은 이 제약을 몰랐을 때 쓴 부정확한
// 서술이라 v1.1에서 정정했다.
//
// 로드 방식은 UNIVERSAL-INTEGRITY와 동일하게 _loadSpByKey(manifest 기반)를
// 쓴다 — worker.js UNIVERSAL_COMMON_URL이 raw.githubusercontent.com 하드코딩
// URL이라 v1_3에 박제된 채 실제 파일은 v1_5까지 올라간 걸 놓치고 있었던 걸
// 이번에 발견했다(별도 커밋으로 수정). 그 문제를 막으려고 UNIVERSAL-INTEGRITY가
// 2026-07-09에 이미 manifest 체계로 전환된 선례가 있어 그 패턴을 그대로
// 따른다(tools/build_manifest.py에 동일한 스캔 규칙 추가). 버전을 올려도
// 파일명 접두어(UNIVERSAL-job-assist_v)만 지키면 manifest가 최신본을
// 자동으로 찾는다 — URL을 손으로 바꿀 필요가 없다.
let _jobAssistCache = null;

async function _fetchUniversalJobAssist() {
  if (_jobAssistCache) return _jobAssistCache;
  try {
    _jobAssistCache = await _loadSpByKey('UNIVERSAL-job-assist', 'UNIVERSAL-job-assist');
  } catch (e) {
    console.warn('[JobAssist] 로드 실패:', e.message);
    return '';
  }
  return _jobAssistCache;
}

// profile-assistant SP (2026-07-08: personal-assistant에서 프로필 작성
// 기능만 분리 독립 — 함수명도 개명. manifest 키도 'personal-assistant'→
// 'profile-assistant'로 변경(build_manifest.py 참조). 세션당 1회 캐시.
// 호출 경로 둘 다 이 함수를 공유한다: ① settings.js의 프로필 작성 패널
// (직접 호출) ② AC의 [CALL_PROFILE_ASSISTANT] 위임(§0-E) — 아래
// _switchToProfileAssistantSP()가 이 함수를 재사용.
let _profileAssistantSpCache = null;
export async function _loadProfileAssistantSP() {
  if (_profileAssistantSpCache) return _profileAssistantSpCache;
  try {
    _profileAssistantSpCache = await _loadSpByKey('profile-assistant', 'Profile-Assistant');
    return _profileAssistantSpCache;
  } catch (e) {
    console.warn('[SP] profile-assistant SP 로드 실패:', e.message);
    return null;
  }
}
// klaw.js 등이 배열 참조용으로 사용 (window.history와 구분)
if (typeof window !== 'undefined') window._callAiHistoryRef = history;

// ── 오케스트레이션 3단계 SP 로더 (2026-07-08 신설, §0-H v3.40) ──────
// K-Intent(의도파악)·K-Compose(조합결정)·K-Deliver(결과제출) 세션당 1회 캐시.
// _loadProfileAssistantSP()와 동일 패턴 — manifest 키만 다르다.
let _kIntentSpCache = null;
export async function _loadKIntentSP() {
  if (_kIntentSpCache) return _kIntentSpCache;
  try {
    _kIntentSpCache = await _loadSpByKey('SP-19_kintent', 'K-Intent');
    return _kIntentSpCache;
  } catch (e) {
    console.warn('[Orchestration] K-Intent SP 로드 실패:', e.message);
    return null;
  }
}
let _kComposeSpCache = null;
export async function _loadKComposeSP() {
  if (_kComposeSpCache) return _kComposeSpCache;
  try {
    _kComposeSpCache = await _loadSpByKey('SP-20_kcompose', 'K-Compose');
    return _kComposeSpCache;
  } catch (e) {
    console.warn('[Orchestration] K-Compose SP 로드 실패:', e.message);
    return null;
  }
}
let _kDeliverSpCache = null;
export async function _loadKDeliverSP() {
  if (_kDeliverSpCache) return _kDeliverSpCache;
  try {
    _kDeliverSpCache = await _loadSpByKey('SP-21_kdeliver', 'K-Deliver');
    return _kDeliverSpCache;
  } catch (e) {
    console.warn('[Orchestration] K-Deliver SP 로드 실패:', e.message);
    return null;
  }
}
// K-Execute(SP-22)·K-Report(SP-23) 로더 — 2026-07-16 신설(5단계 확장).
// K-Compose·K-Deliver와 동일한 _loadSpByKey 패턴을 그대로 재사용한다.
let _kExecuteSpCache = null;
export async function _loadKExecuteSP() {
  if (_kExecuteSpCache) return _kExecuteSpCache;
  try {
    _kExecuteSpCache = await _loadSpByKey('SP-22_kexecute', 'K-Execute');
    return _kExecuteSpCache;
  } catch (e) {
    console.warn('[Orchestration] K-Execute SP 로드 실패:', e.message);
    return null;
  }
}
let _kReportSpCache = null;
export async function _loadKReportSP() {
  if (_kReportSpCache) return _kReportSpCache;
  try {
    _kReportSpCache = await _loadSpByKey('SP-23_kreport', 'K-Report');
    return _kReportSpCache;
  } catch (e) {
    console.warn('[Orchestration] K-Report SP 로드 실패:', e.message);
    return null;
  }
}
// K-Search(SP-18) 로더 — 2026-07-09 신설. §0-F(AGENT-COMMON)가 오래전부터
// [KSEARCH_HANDOFF]를 문서화하고 있었지만, 실제 로더가 없어 이 태그
// 자체가 조용히 실패하는 상태였다(K-Compose의 nested 호출 스텁이
// `import('./call-ai.js')`로 자기 자신을 재귀 import해 존재하지도 않는
// 이름을 찾던 것도 이 공백의 증상이었다 — 아래에서 함께 정리).
let _kSearchSpCache = null;
export async function _loadKSearchSP() {
  if (_kSearchSpCache) return _kSearchSpCache;
  try {
    _kSearchSpCache = await _loadSpByKey('SP-18_ksearch', 'K-Search');
    return _kSearchSpCache;
  } catch (e) {
    console.warn('[Orchestration] K-Search SP 로드 실패:', e.message);
    return null;
  }
}

// K-Bank/K-Telecom/K-Estate 로더 — 2026-07-12 신설. 처음엔 새 저장소
// (bank.hondi.net 등)를 전제로 만들었다가, "모든 SP가 별도 저장소가
// 필요한 것은 아니다"(주피터님 지적)를 반영해 K-Search와 같은
// 시스템 전환형으로 재설계 — gwp-registry.js의 type:'switch' 참조.
let _kBankSpCache = null;
export async function _loadKBankSP() {
  if (_kBankSpCache) return _kBankSpCache;
  try {
    _kBankSpCache = await _loadSpByKey('SP-22_kbank', 'K-Bank');
    return _kBankSpCache;
  } catch (e) {
    console.warn('[Orchestration] K-Bank SP 로드 실패:', e.message);
    return null;
  }
}
let _kTelecomSpCache = null;
export async function _loadKTelecomSP() {
  if (_kTelecomSpCache) return _kTelecomSpCache;
  try {
    _kTelecomSpCache = await _loadSpByKey('SP-23_ktelecom', 'K-Telecom');
    return _kTelecomSpCache;
  } catch (e) {
    console.warn('[Orchestration] K-Telecom SP 로드 실패:', e.message);
    return null;
  }
}
let _kEstateSpCache = null;
export async function _loadKEstateSP() {
  if (_kEstateSpCache) return _kEstateSpCache;
  try {
    _kEstateSpCache = await _loadSpByKey('SP-24_kestate', 'K-Estate');
    return _kEstateSpCache;
  } catch (e) {
    console.warn('[Orchestration] K-Estate SP 로드 실패:', e.message);
    return null;
  }
}
// K-Plan/K-Watch/K-Job 로더 — 2026-09-02 신설. K-Bank/K-Telecom/K-Estate와
// 동일한 이유(별도 저장소·도메인 불필요)로 처음부터 type:'switch'로
// 설계된 세 SP(prompts/k-plan_v1_0.md·k-watch_v1_0.md·k-job_v1_0.md)를
// 이 세션 안 시스템 전환형으로 연결한다. sp_key는 SP-NN 번호 체계가
// 아니라 k-business와 동일한 평문 이름(sp-catalog.json에 'k-plan'·
// 'k-watch'·'k-job' 키로 등록 — k-plan/k-watch는 이번에 함께 신규
// 등록했다, sp-catalog.json 참조).
let _kPlanSpCache = null;
export async function _loadKPlanSP() {
  if (_kPlanSpCache) return _kPlanSpCache;
  try {
    _kPlanSpCache = await _loadSpByKey('k-plan', 'K-Plan');
    return _kPlanSpCache;
  } catch (e) {
    console.warn('[Orchestration] K-Plan SP 로드 실패:', e.message);
    return null;
  }
}
let _kWatchSpCache = null;
export async function _loadKWatchSP() {
  if (_kWatchSpCache) return _kWatchSpCache;
  try {
    _kWatchSpCache = await _loadSpByKey('k-watch', 'K-Watch');
    return _kWatchSpCache;
  } catch (e) {
    console.warn('[Orchestration] K-Watch SP 로드 실패:', e.message);
    return null;
  }
}
let _kJobSpCache = null;
export async function _loadKJobSP() {
  if (_kJobSpCache) return _kJobSpCache;
  try {
    _kJobSpCache = await _loadSpByKey('k-job', 'K-Job');
    return _kJobSpCache;
  } catch (e) {
    console.warn('[Orchestration] K-Job SP 로드 실패:', e.message);
    return null;
  }
}
// switch 타입 GWP id → 로더 매핑(아래 _parseAgentTags의 GWP 분기가 참조)
const SWITCH_SP_LOADERS = {
  kbank: _loadKBankSP,
  ktelecom: _loadKTelecomSP,
  kestate: _loadKEstateSP,
  kplan: _loadKPlanSP,
  kwatch: _loadKWatchSP,
  kjob: _loadKJobSP,
};

// ★ 2026-08-01 신설 — 자동복구 재진입 가드. 라이브 검증(_updateStreamBubble
// 자동복구, 아래 _parseAgentTags 참고) 중 실사로 발견: switch 타입 SP로
// 전환된 뒤 보내는 INTERNAL 연속 메시지에 K-Telecom 자신이 "K-Telecom을
// 호출하겠습니다"처럼 본인 표시명 + 호출 동사를 섞어 답하면, 2026-07-31
// 신설된 "태그 누락 폴백"(같은 파일, 표시명 매칭으로 라우팅 복구)이 그
// 자기 응답에 또 반응해 자동복구가 자기 자신을 재호출하는 루프가 생겼다
// (콘솔에서 정확히 2회씩 쌍으로 재현 확인, Uncaught SyntaxError 동반).
// 이 플래그가 true인 동안엔 switch 타입 자동복구를 다시 트리거하지 않는다.
let _gwpSwitchRecoveryInFlight = false;

// ── SP 전환 스택 (2026-07-08 신설) ───────────────────────────────
// 기존 _switchToAssistantSP()/_switchToProfileAssistantSP()는 CFG.system을
// 그냥 덮어쓰기만 했다 — "이전 SP로 돌아간다"는 개념 자체가 없는 단순
// 교체였다(왕복 하나, AC↔profile-assistant만 상정한 설계). 3단계
// 오케스트레이션(K-Intent→K-Compose→(K-Search/EXPERT 중첩 호출)→
// K-Compose→K-Deliver→AC)은 "잠깐 다른 SP를 불렀다가 반드시 원래
// 자리로 돌아와야 하는" 중첩 호출이 필요해 기존 방식으로는 안 된다
// (사고실험 #8·#9에서 발견 — call-ai.js 실사로 확정).
//
// 구분 원칙:
//   - "전달"(forward handoff, 돌아올 필요 없음 — 예: K-Intent→K-Compose,
//     K-Compose→K-Deliver): 기존처럼 그냥 교체한다. 스택 안 건드림.
//   - "위임"(nested call, 반드시 돌아와야 함 — 예: K-Compose가 K-Search나
//     EXPERT를 scope=orchestration_subtask로 부를 때): 현재 system을
//     스택에 쌓아두고 교체한다. 상대가 끝나면 스택에서 꺼내 정확히
//     그 자리로 복귀한다.
if (typeof CFG !== 'undefined' && !CFG.systemStack) CFG.systemStack = [];

// [2026-08-06 신설 — 실시간 진행 보고] SP 전환 시 사용자에게 즉시 알린다.
// 배경: 기존엔 _updateBubble(_stripInternalTags(fullReply))로 직전 SP의
// 응답을 보여준 뒤, 다음 SP 재주입 응답(_watchdogSendFn(...))이 완료될
// 때까지 화면에 아무 변화가 없었다 — 그 사이(hondi-pro reasoning 포함,
// 실측 20~30초대)는 사용자가 막연히 기다리는 구간이었다(§2026-08-06
// 대화에서 지적). SP 전환은 여기(_forwardSwitchSP/_pushAndSwitchSP)
// 한 곳에서만 일어나므로, 여기서 새 말풍선 하나를 즉시 appendBubble로
// 붙이면 — 다음 LLM 호출을 기다릴 필요 없이 — 사용자가 "지금 무슨 단계로
// 넘어가는지"를 실시간으로 볼 수 있다. 이 파일의 SP-Author 큐잉 진행
// 말풍선(⏳, 2135행)과 동일한 패턴 재사용.
const _STAGE_LABELS = {
  'K-Intent':    '요청 파악',
  'K-Compose':   '절차 구성',
  'K-Execute':   '실행',
  'K-Deliver':   '결과 정리',
  'K-Report':    '통지·신고 처리',
  'K-Search':    '조회',
  'K-Bank':      '금융 상담',
  'K-Telecom':   '통신 상담',
  'K-Estate':    '부동산 상담',
  // 2026-09-02 추가 — K-Plan/K-Watch/K-Job을 switch형으로 편입하면서
  // (_forwardSwitchSP(loader, label)의 label 인자로 'K-Plan'/'K-Watch'/
  // 'K-Job'이 그대로 들어옴, _handleOrchestrationTags의 label 매핑 참조)
  // 여기 등록을 빠뜨리면 _friendlyStageLabel이 원문 영문 라벨을 그대로
  // 반환해 "K-Job 단계로 이동 중…"처럼 사용자에게 노출된다 — 사고실험
  // 중 발견해 함께 수정.
  'K-Plan':      '계획 수립',
  'K-Watch':     '신고 접수',
  'K-Job':       '구직 상담',
  'AGENT-COMMON': 'AI 비서',
};
function _friendlyStageLabel(label) {
  if (_STAGE_LABELS[label]) return _STAGE_LABELS[label];
  if (typeof label === 'string' && label.startsWith('EXPERT:')) return '전문가 상담';
  return label; // 매핑 없는 라벨은 원문 그대로(안전한 폴백)
}
function _announceStageTransition(label) {
  try {
    appendBubble('ai', `🔄 ${_friendlyStageLabel(label)} 단계로 이동 중…`);
  } catch (e) {
    console.warn('[Orchestration] 진행 알림 말풍선 실패(무시):', e.message);
  }
}

async function _forwardSwitchSP(loaderFn, label) {
  try {
    const sp = await loaderFn();
    if (!sp) throw new Error(`${label} SP 로드 결과 비어있음`);
    _announceStageTransition(label);
    CFG.system_base = sp;
    CFG.system = sp;
    try {
      const cfg = JSON.parse(localStorage.getItem('gopang_cfg') || '{}');
      cfg.system = CFG.system;
      cfg.system_base = CFG.system_base;
      localStorage.setItem('gopang_cfg', JSON.stringify(cfg));
    } catch {}
    console.log(`[Orchestration] ${label}(으)로 전달(forward) 전환 완료`);
  } catch (e) {
    console.warn(`[Orchestration] ${label} 전달 전환 실패(무시):`, e.message);
  }
}

async function _pushAndSwitchSP(loaderFn, label) {
  try {
    // 현재 system을 스택에 쌓는다 — 나중에 정확히 여기로 복귀하기 위함.
    CFG.systemStack.push({ system: CFG.system, system_base: CFG.system_base });
    const sp = await loaderFn();
    if (!sp) throw new Error(`${label} SP 로드 결과 비어있음`);
    _announceStageTransition(label);
    CFG.system_base = sp;
    CFG.system = sp;
    console.log(`[Orchestration] ${label}(으)로 위임(nested) 전환 완료 — 스택 깊이 ${CFG.systemStack.length}`);
  } catch (e) {
    console.warn(`[Orchestration] ${label} 위임 전환 실패(무시):`, e.message);
    CFG.systemStack.pop(); // 실패 시 잘못 쌓인 프레임 되돌림
  }
}

async function _popSP() {
  const frame = CFG.systemStack.pop();
  if (!frame) {
    console.warn('[Orchestration] 복귀할 스택 프레임 없음 — AGENT-COMMON으로 폴백');
    await _switchToAssistantSP();
    return;
  }
  // 복귀 대상의 정확한 라벨은 스택 프레임에 저장돼 있지 않아(system 문자열
  // 원문만 있음) 위 _friendlyStageLabel 매핑을 못 쓴다 — 범용 문구로 안내.
  try { appendBubble('ai', '🔄 이전 단계로 복귀하는 중…'); }
  catch (e) { console.warn('[Orchestration] 복귀 알림 말풍선 실패(무시):', e.message); }
  CFG.system = frame.system;
  CFG.system_base = frame.system_base;
  try {
    const cfg = JSON.parse(localStorage.getItem('gopang_cfg') || '{}');
    cfg.system = CFG.system;
    cfg.system_base = CFG.system_base;
    localStorage.setItem('gopang_cfg', JSON.stringify(cfg));
  } catch {}
  console.log(`[Orchestration] 스택 복귀 완료 — 남은 깊이 ${CFG.systemStack.length}`);
}


// ── 응답 생성 중지(Stop) 지원 ───────────────────────────────
// 전송 버튼이 "생성 중" 상태일 때 클릭하면 stopGeneration()이 호출되어
// 현재 진행 중인 스트리밍 fetch를 중단한다 (Claude의 정지 버튼과 동일한 동작).
let _currentAbort = null;

// ── 유휴(idle) 타임아웃 공용 헬퍼 (2026-07-01) ───────────────────
// BUG-FIX: 아래 _callLLM/_callAIInner의 fetch()에는 타임아웃이 전혀 없어,
// 서버가 무응답으로 멈추면 await가 영원히 반환되지 않았다(패널 쪽 동일 버그를
// webapp.html에서 먼저 고쳤고, 메인 채팅 경로도 같은 문제가 있어 함께 고친다).
// "마지막 진행(연결 시도 또는 청크 수신)으로부터 N초"를 재는 유휴 타임아웃이며,
// linkedSignal(예: 사용자의 수동 "정지" 버튼용 _currentAbort.signal)이 먼저
// 중단되면 그것도 즉시 반영한다 — 단, 어느 쪽이 중단시켰는지는 반환된
// wasManualStop()으로 구분할 수 있어야 한다(수동 중지는 페일오버 없이 즉시
// 종료해야 하고, 유휴 타임아웃은 다음 후보로 페일오버해야 하므로 의미가 다르다).
function _makeIdleAbort(timeoutMs, linkedSignal) {
  const ctl = new AbortController();
  let timer = null;
  const onLinkedAbort = () => ctl.abort();
  if (linkedSignal) {
    if (linkedSignal.aborted) ctl.abort();
    else linkedSignal.addEventListener('abort', onLinkedAbort, { once: true });
  }
  const reset = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => ctl.abort(), timeoutMs);
  };
  const cancel = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (linkedSignal) linkedSignal.removeEventListener('abort', onLinkedAbort);
  };
  reset();
  return {
    signal: ctl.signal,
    reset,
    cancel,
    // true면 유휴 타임아웃이 아니라 linkedSignal(사용자 수동 중지 등)이 원인
    wasManualStop: () => !!(linkedSignal && linkedSignal.aborted),
  };
}
const _LLM_IDLE_TIMEOUT_MS = 45000; // 45초 무진행 시 자동 중단(다음 후보로 페일오버)

// ══════════════════════════════════════════════════════════════
// PA 온보딩 관련 함수
// ══════════════════════════════════════════════════════════════

/**
 * _buildProfileContext — [CONTEXT: PROFILE_ONBOARDING] 블록 생성
 *
 * call-ai.js가 "이미 아는 것"을 결정하는 유일한 주체입니다.
 * 아래 데이터 소스를 순서대로 병합하여 PA SP에 주입합니다:
 *   1. gopang_user_v4 — 가입 시 등록된 필드 (guid, handle, nickname, region, e164)
 *   2. hondi_profile_partial — 온보딩 도중 저장된 진행 중 데이터
 *
 * PA SP는 [CONTEXT]에 값이 있는 항목은 절대 다시 묻지 않습니다.
 * 재호출(설정 → 프로필 작성) 시에도 동일 로직으로 미작성 항목만 진행합니다.
 *
 * v1.3 — export: AI 패널도 온보딩 중에는 이 컨텍스트를 똑같이 주입해야
 * "이미 답한 걸 또 묻는" 문제가 안 생긴다.
 */
export function _buildProfileContext() {
  // 가입 시 저장 데이터 (항상 신뢰할 수 있는 기준 데이터)
  let reg = {};
  try { reg = JSON.parse(localStorage.getItem('gopang_user_v4') || '{}'); } catch {}

  // 온보딩 진행 중 저장 데이터 (reg보다 구체적인 항목을 가질 수 있음)
  let partial = {};
  try { partial = JSON.parse(localStorage.getItem('hondi_profile_partial') || '{}'); } catch {}

  // 두 소스 병합 — reg가 기본값, partial이 덮어씀 (진행 중 데이터 우선)
  const ctx = Object.assign({}, {
    guid:     reg.ipv6   || reg.guid || '',
    handle:   reg.handle || '',
    nickname: reg.nickname || '',
    region:   reg.region || '',
    e164:     reg.e164   || '',       // 가입 시 입력한 전화번호 — 다시 묻지 않음
  }, partial);

  // 현재 단계 (없으면 0 = 최초 시작)
  const step = parseInt(localStorage.getItem('hondi_profile_step') || '0', 10);

  // [CONTEXT] 블록 조립 — 값이 있는 항목만 포함
  // v1.3 — PHASE -1(최초 인사)·이름짓기 상태 (PA SP가 first_greeted/name_pending 참조)
  const firstGreeted  = localStorage.getItem('hondi_first_greeted')  === '1';
  const namePending   = localStorage.getItem('hondi_name_pending')   === '1';
  const assistantName = localStorage.getItem('hondi_assistant_name') || '';

  const lines = ['[CONTEXT: PROFILE_ONBOARDING]'];
  lines.push(`step: ${step}`);
  // v1.6 — 이전엔 이 값을 항상 false로 하드코딩했다(당시엔 isOnboarding=
  // !done&&!skipped 게이트를 통과했을 때만 이 함수가 불렸으므로 실제로
  // 항상 false였음). 이제 settings.js의 프로필 작성 패널이 done=true(완료
  // 후 수정)·skipped=true(재개) 상태에서도 이 함수를 직접 부르므로, PA SP가
  // PHASE 0 분기를 정확히 타도록 실제 값을 그대로 전달해야 한다.
  let doneFlag = false, skippedFlag = false;
  try {
    doneFlag    = localStorage.getItem('hondi_profile_done')    === '1';
    skippedFlag = localStorage.getItem('hondi_profile_skipped') === '1';
  } catch {}
  lines.push(`done: ${doneFlag}`);
  lines.push(`skipped: ${skippedFlag}`);
  lines.push(`first_greeted: ${firstGreeted}`);
  lines.push(`name_pending: ${namePending}`);
  if (assistantName) lines.push(`assistant_name: ${assistantName}`);
  if (ctx.guid)           lines.push(`guid: ${ctx.guid}`);
  if (ctx.handle)         lines.push(`handle: ${ctx.handle}`);
  if (ctx.nickname)       lines.push(`nickname: ${ctx.nickname}`);
  if (ctx.region)         lines.push(`region: ${ctx.region}`);
  if (ctx.e164)           lines.push(`e164: ${ctx.e164}`);   // 있으면 PA가 phone을 묻지 않음
  if (ctx.name)           lines.push(`name: ${ctx.name}`);
  if (ctx.address)        lines.push(`address: ${ctx.address}`);
  if (ctx.phone)          lines.push(`phone: ${ctx.phone}`);
  if (ctx.entity_type)    lines.push(`entity_type: ${ctx.entity_type}`);
  if (ctx.entity_subtype) lines.push(`entity_subtype: ${ctx.entity_subtype}`);
  if (ctx.schema_id)      lines.push(`schema_id: ${ctx.schema_id}`);
  if (ctx.products)       lines.push(`products: ${JSON.stringify(ctx.products)}`);
  if (ctx.description)    lines.push(`description: ${ctx.description}`);
  if (ctx.platform_type)  lines.push(`platform_type: ${ctx.platform_type}`);
  if (ctx.member_count)   lines.push(`member_count: ${ctx.member_count}`);
  if (ctx.industry_fields) lines.push(`industry_fields: ${JSON.stringify(ctx.industry_fields)}`);
  if (ctx.gdc_accepted !== undefined) lines.push(`gdc_accepted: ${ctx.gdc_accepted}`);
  if (ctx.is_public !== undefined)    lines.push(`is_public: ${ctx.is_public}`);

  // 2026-09-13 신설 — PARTIAL_SAVE 핸들러(위 "진행 중 필드 저장" 블록)가
  // entity_type 모순을 결정론적으로 감지해 남겨둔 신호를 여기서 한 번만
  // 소비한다. profile-assistant SP v2.32 §ESCALATE-TO-PRO는 이 줄이 보이면
  // 조건2가 자동 성립한 것으로 보고 반드시 [ESCALATE_TO_PRO: reason=2]를
  // 내야 한다 — "one-shot"으로 설계한 이유: 이 줄을 지우지 않고 매 턴
  // 계속 주입하면 사용자가 승격 절차에 답한 뒤에도(=모순이 이미 해소된
  // 뒤에도) 다음 턴에 또 같은 신호가 보여 불필요한 재확인을 반복 요구하게
  // 된다. 딱 한 번, 모순이 감지된 바로 다음 요청에만 실어 보낸다.
  try {
    const conflictRaw = localStorage.getItem('hondi_profile_entity_type_conflict');
    if (conflictRaw) {
      const conflict = JSON.parse(conflictRaw);
      lines.push(`entity_type_conflict: ${conflict.previous}->${conflict.next}`);
      localStorage.removeItem('hondi_profile_entity_type_conflict');
    }
  } catch {}

  lines.push('[/CONTEXT]');

  return lines.join('\n');
}

/**
 * _handleProfileTags — PROFILE_SUBMIT / PROFILE_SKIP / 단계 업데이트 처리
 *
 * @param {string} fullReply — LLM 응답 전문
 * @param {HTMLElement|null} bubble — 스트림 버블 (SKIP 시 태그 제거용)
 * @returns {boolean} true = 태그 처리됨 (GWP 등 후속 처리 생략)
 */
// v1.3 — export: 내부 전용 태그를 화면에서 제거하는 헬퍼. 모듈 스코프로 끌어올려
// AI 패널(webapp.html) 등 _handleProfileTags를 거치지 않는 경로에서도 재사용 가능.
// 2026-07-09 신설 — steps=[...] 같은 중첩 배열/객체를 값으로 갖는 태그는
// 단순 정규식([^\]]*)으로 안전하게 못 지운다(배열 안쪽 첫 ']'에서 멈춰
// 태그 뒷부분이 그대로 노출되는 버그가 실제로 있었다). 대괄호 깊이를
// 세어 정확한 짝을 찾는 헬퍼를 별도로 둔다.
function _stripBracketTag(text, tagName) {
  let out = text;
  let idx;
  while ((idx = out.indexOf(`[${tagName}:`)) !== -1) {
    let depth = 0, end = -1;
    for (let i = idx; i < out.length; i++) {
      if (out[i] === '[') depth++;
      else if (out[i] === ']') {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    if (end === -1) break; // 짝이 안 맞으면(응답이 잘림 등) 더 이상 진행 안 함
    out = out.slice(0, idx) + out.slice(end);
  }
  return out;
}

// ── _stripBracketTag와 같은 원리로, 스트립 대신 태그 본문을 추출한다
// (2026-08-06 신설). HANDOFF_TO_KEXECUTE/KDELIVER처럼 plan={steps:[...]}
// 같은 중첩 배열을 본문에 담는 태그를 단순 정규식(`[^\]]*`)으로 캡처하면
// 배열 안쪽 첫 ]에서 잘린다 — 라이브 재검증(2026-08-06)에서 실사로 발견:
// HANDOFF_TO_KEXECUTE 감지 캡처가 딱 그 지점에서 끊겨 K-Execute가 받는
// project_brief 자체가 반토막이었고, 스트립도 같은 지점에서 멈춰 나머지
// 원시 JSON(parallel_group, eligibility_gate, user_profile 등)이 화면에
// 그대로 노출됐다(PROCEDURE_MAP_DRAFT와 같은 계열의 버그, 그건 이미
// _stripBracketTag로 고쳐져 있었는데 이 태그들은 안 옮겨져 있었다).
function _extractBracketTag(text, tagName) {
  const idx = text.indexOf(`[${tagName}:`);
  if (idx === -1) return null;
  let depth = 0, end = -1;
  for (let i = idx; i < text.length; i++) {
    if (text[i] === '[') depth++;
    else if (text[i] === ']') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end === -1) return null; // 짝이 안 맞으면(응답이 잘림 등)
  const bodyStart = idx + tagName.length + 2; // '[' + tagName + ':'
  return text.slice(bodyStart, end - 1);
}

// ── PROJECT_STATE_SAVE 태그의 중첩 배열/객체 필드(remaining_steps 등)를
// 안전하게 떼어낸다(2026-07-17 신설). 정규식으로 완벽한 JSON 파싱을
// 시도하지 않는다 — LLM 출력은 형식이 살짝 흔들릴 수 있어, 실패하면
// 빈 배열로 두고 조용히 넘어간다(재개 시 K-Execute가 부족분을 다시
// 판단하게 하는 편이 파싱 에러로 전체 흐름을 막는 것보다 안전하다).
function _safeParseJsonField(raw, key) {
  const startIdx = raw.indexOf(key + '=');
  if (startIdx === -1) return [];
  let i = raw.indexOf('=', startIdx) + 1;
  while (i < raw.length && /\s/.test(raw[i])) i++;
  const openChar = raw[i];
  if (openChar !== '[' && openChar !== '{') return [];
  const closeChar = openChar === '[' ? ']' : '}';
  let depth = 0, end = -1;
  for (let j = i; j < raw.length; j++) {
    if (raw[j] === openChar) depth++;
    else if (raw[j] === closeChar) { depth--; if (depth === 0) { end = j + 1; break; } }
  }
  if (end === -1) return [];
  try { return JSON.parse(raw.slice(i, end)); }
  catch { return []; }
}

export const _stripInternalTags = (text) => _stripBracketTag(
  _stripBracketTag(_stripBracketTag(_stripBracketTag(_stripBracketTag(_stripBracketTag(_stripBracketTag(text,
    'PROCEDURE_MAP_DRAFT'), 'PROCEDURE_MAP_UPDATE'), 'KSEARCH_CANDIDATES'),
    'HANDOFF_TO_KEXECUTE'), 'HANDOFF_TO_KDELIVER'), 'PROJECT_STATE_SAVE'), 'PDV_REQUEST')
  .replace(/PROFILE_SUBMIT\s*\{[\s\S]*?\n\}/, '')
  .replace(/\[PARTIAL_SAVE\]\s*\{[\s\S]*?\}/g, '')
  .replace(/\[\d+\/\d+단계\]/g, '')
  .replace(/\[FIRST_GREETED\]/g, '')
  .replace(/\[NAME_CAPTURED\]/g, '')
  .replace(/\[PROFILE_SKIP\]/g, '')
  .replace(/\[TUTORIAL_ADVANCE:\d+\]/g, '')   // 튜토리얼 단계 태그
  .replace(/\[TUTORIAL_STEP:[^\]]*\]/g, '')    // 튜토리얼 컨텍스트 태그(실수로 AI가 출력하면)
  .replace(/\[SHARE_DOC_PENDING:[\s\S]*?\]/g, '')  // 공유문서 확인 지시 컨텍스트(2026-07-09 신설, 실수로 출력되면 방어)
  .replace(/\[SHARE_DOC_CONFIRMED:[^\]]+\]/g, '')  // 공유문서 확인 완료 태그
  .replace(/\[SHARE_DOC_REJECTED\]/g, '')          // 공유문서 거부 태그
  .replace(/\[PANEL_ACTION:close\]/g, '')      // AI 패널 닫기 지시 태그 (2026-07-02 신설)
  .replace(/\[PDV_DOMAIN_SET:[^\]]*\]/g, '')    // PDV 일상/업무 전환 태그 (2026-07-13 신설)
  .replace(/\[KCOMPOSE_AWAIT_USER:[^\]]*\]/g, '')  // 2026-09-12 신설 — K-Compose 정상 대기 신호(§ K-Compose 프로토콜 가드 참고), 사용자에겐 안 보여야 함
  .replace(/\[TEMPLATE_LOOKUP:[^\]]*\]/g, '')   // 정체성 템플릿 참조 조회 태그 (2026-07-17 신설, 방어적 — 정상 경로는 _handleProfileTags가 먼저 소비)
  .replace(/\[INDUSTRY_TEMPLATE_LOOKUP:[^\]]*\]/g, '') // 구 태그명(v2.3~) — SP 갱신 유예기간 동안 방어적으로 함께 제거
  .replace(/\[TEMPLATE_CANDIDATE:[^\]]*\]/g, '') // 템플릿 후보 큐잉 태그 (2026-07-17 신설 — 100인 사고실험 케이스 #52에서 strip 누락 발견, 그 즉시 추가)
  .replace(/\[JOB_KSCO_REVIEWED\]/g, '')        // job_ksco 재확인 완료 태그 (2026-07-14 신설, 구멍 E)
  .replace(/\[JOB_KSCO_REVIEW_DUE:[\s\S]*?\]/g, '')  // 방어적 — 정상 경로는 컨텍스트 주입용, AI가 실수로 에코하면 제거
  .replace(/\[GWP:\s*[\w-]+\]/g, '')           // 하위 시스템 라우팅 태그 (방어적 — 정상 경로는 _parseAgentTags가 처리)
  .replace(/\[EXPERT:\s*[@\w-]+\]/g, '')       // 전문가 세션 라우팅 태그 (방어적 — 정상 경로는 handleExpertTag가 처리)
  // 2026-08-06 신설 — 라이브 재검증 실사로 발견: 위 라인은 단순
  // '[EXPERT: id]' 형식만 잡는다. orchestration_subtask 확장 포맷
  // ('[EXPERT: id, scope=orchestration_subtask, question="..."]' 또는
  // 'personaId=id,' 키=값 변형)은 못 잡아 원시 태그가 그대로 노출됐다
  // (해당 위임 로직 자체는 위쪽 kExpertSubtaskMatch가 이미 정상 처리
  // 하므로, 이건 그 처리 이전/실패 시에도 화면에 안 새도록 하는 방어망).
  .replace(/\[EXPERT:\s*(?:personaId=)?[\w-]+,\s*scope=orchestration_subtask,\s*question=[^\]]*\]/gi, '')
  // 2026-07-07 신설 — 아래 5개는 이전부터 _parseAgentTags가 실제 동작은
  // 처리해왔지만 이 스트립 목록에는 빠져있어, 태그 원문이 채팅 버블에
  // 그대로 노출되던 기존 결함이었다(SEARCH/OPEN_PROFILE/P2P_INVITE).
  // 새로 추가한 3개(OPEN_SETTINGS_TAB/OPEN_K_SERVICES_TAB/SEARCH의
  // mode=tab 변형)와 함께 한 번에 정리한다.
  .replace(/\[SEARCH:\s*query=[^,\]]+,\s*type=user(?:,\s*mode=tab)?\s*\]/g, '')
  // K-Search RULE-02 STEP3의 JSON 본문 형([SEARCH]{...}[/SEARCH]) —
  // 위 type=user 형과 이름만 같고 문법이 다르다(2026-07-11 Phase 1).
  .replace(/\[SEARCH\][\s\S]*?\[\/SEARCH\]/g, '')
  .replace(/\[OPEN_PROFILE:\s*handle=@[\w.-]+\s*\]/g, '')
  .replace(/\[P2P_INVITE:\s*handle=@[\w.-]+(?:,\s*message=[^\]]*)?\]/g, '')
  .replace(/\[OPEN_SETTINGS_TAB\]/g, '')
  .replace(/\[OPEN_K_SERVICES_TAB\]/g, '')
  // 2026-07-08 신설 — AC↔profile-assistant 핸드오프 태그(§0-E)
  .replace(/\[CALL_PROFILE_ASSISTANT\]/g, '')
  .replace(/\[PROFILE_INTERRUPT_HANDOFF\]/g, '')
  // 2026-07-08 신설 — 오케스트레이션 3단계(K-Intent/K-Compose/K-Deliver) 핸드오프 태그(§0-H v3.40)
  .replace(/\[CALL_KINTENT:[^\]]*\]/g, '')
  // 2026-08-06 신설 — 라이브 재검증 중 실사로 발견: 위 정규식은 정식
  // 형식([CALL_KINTENT: query=...])만 잡는다. 모델이 콜론·본문 없이
  // '[CALL_KINTENT]'만 괄호 인용으로 언급하거나 'CALL_INTENT'(K자
  // 탈락)로 오탈자를 내는 경우, 위 라인은 못 잡아 원시 태그가 그대로
  // 노출됐다(감지 로직도 같은 이유로 못 걸려 전달 자체가 정지되는
  // 더 심각한 문제와 짝을 이룸 — 그쪽은 kIntentMatch 정규식 자체를
  // 넓혀 고쳤고, 이건 그 방어망을 한 번 더 두는 것).
  .replace(/\[CALL_K?INTENT(?::[^\]]*)?\]/gi, '')
  .replace(/\[HANDOFF_TO_KCOMPOSE:[^\]]*\]/g, '')
  // 2026-08-06 수정 — HANDOFF_TO_KEXECUTE/KDELIVER는 이제 위쪽
  // _stripBracketTag 체인에서 대괄호 깊이 계산으로 처리한다(중첩
  // 배열/객체 본문 때문에 아래 같은 단순 정규식은 배열 안쪽 첫 ]에서
  // 잘려 나머지 원시 JSON이 노출되는 버그가 있었다 — 라이브 재검증
  // 실사로 확인). 옛 단순 정규식 라인은 제거.
  .replace(/\[HANDOFF_TO_KREPORT:[^\]]*\]/g, '')  // 2026-07-16 신설(5단계 확장)
  .replace(/\[ORCHESTRATION_COMPLETE:[^\]]*\]/g, '')
  .replace(/\[ORCHESTRATION_HANDOFF_BACK:[^\]]*\]/g, '')
  .replace(/\[ORCHESTRATION_SUBTASK_RESULT:[^\]]*\]/g, '')
  .replace(/\[ORCHESTRATION_PROGRESS:[^\]]*\]/g, '')  // 2026-07-12 신설(SP-20 v1.4)
  // 2026-07-17 신설 — mode=project(SP-19 v1.2/SP-20 v1.6/SP-22 v1.1)
  // 2026-08-06 수정 — PROJECT_STATE_SAVE도 위쪽 _stripBracketTag
  // 체인으로 이동(HANDOFF_TO_KEXECUTE와 같은 이유 — remaining_steps
  // 등 중첩 배열 때문에 아래 단순 정규식이 잘렸었다). 옛 라인 제거.
  .replace(/\[RESUME_KEXECUTE:[^\]]*\]/g, '')
  // 2026-07-17 신설 — 자기 갱신 제안(RULE-03, K-Intent v1.3 등)
  .replace(/\[SELF_UPDATE_PROPOSAL:[^\]]*\]/g, '')
  .replace(/\[USER_FEEDBACK:[^\]]*\]/g, '')      // 사용자 개선 제안 포착 태그 (2026-07-17 신설)
  // 2026-08-06 수정 — 라이브 재검증(패널 오케스트레이션 연결) 중 실사로 발견:
  // 정식 태그 형식은 콜론이 태그명 바로 뒤([PROCEDURE_MAP_LOOKUP: goal=...])라
  // 아래 첫 줄로 정상 케이스는 잡히지만, 모델이 조회 결과를 사용자에게
  // 설명하며 "[PROCEDURE_MAP_LOOKUP 결과: miss]"처럼 내부 용어를 자연어
  // 문장에 섞어 쓰는 이탈 케이스(콜론이 태그명 바로 뒤에 안 붙음)는
  // 기존 정규식이 못 잡아 원문이 그대로 노출됐다. 콜론 위치 제약을 없애고
  // 대괄호 안에 PROCEDURE_MAP_LOOKUP이 등장하는 모든 경우를 방어적으로 제거.
  .replace(/\[PROCEDURE_MAP_LOOKUP:[^\]]*\]/g, '')
  .replace(/\[PROCEDURE_MAP_LOOKUP[^\]]*\]/g, '')
  // 2026-08-06 신설 — PDV_REVIEWED(call-ai.js:722, 2026-07-13 신설)가
  // localStorage 기록용으로 fullReply.includes()는 감지하면서 정작 이
  // 스트립 목록엔 빠져 있던 결함. SP가 이번 턴 응답을 이 태그 하나로만
  // 끝내면(예: 주기적 PDV 검토 완료 알림 턴) 태그 원문이 그대로 독립된
  // 채팅 버블로 노출됐다(라이브 재검증 중 실사 확인).
  .replace(/\[PDV_REVIEWED\]/g, '')
  // 2026-08-06 신설 — U8(PDV_HISTORY_REQUEST)/U7-3(PDV_REQUEST)이
  // UNIVERSAL-common을 통해 2026-07-19부터 K-Compose→EXPERT(scope=
  // orchestration_subtask, expert-session.js._composeExpertPrompt 경로,
  // §0-H) 위임에도 실려가고 있었다 — 이 스레드엔 그 태그를 실제로
  // 가로채 /pdv/query를 호출하는 실행기(pdv-history-client.js, K-서비스
  // 13개 저장소에만 연동됨)가 없다. VALID_PDV_SCOPES가 GWP 기관/부서
  // 단위로만 등록돼 있어(개별 EXPERT 페르소나엔 scope 자체가 없음) U8은
  // 애초에 이 경로를 염두에 두고 설계되지 않았다 — 실행 구현 대신, 모델이
  // U8-3 자기점검(자리표시자 미치환 시 태그 미사용)을 안 지켰을 때를 대비한
  // 최소 방어망만 둔다(pages/expert-chat.html의 _stripPdvTags와 동일 원리).
  // PDV_REQUEST(U7-3, fields=[...] 중첩 배열 본문)는 위 _stripBracketTag
  // 체인에서 이미 처리했으므로 여기선 평문 본문(scope=/period=/reason=,
  // 중첩 대괄호 없음)인 PDV_HISTORY_REQUEST(U8)만 남는다.
  .replace(/\[PDV_HISTORY_REQUEST:[^\]]*\]/g, '')
  .replace(/\[BENEFIT_CANDIDATE_SEARCH:[^\]]*\]/g, '')  // 2026-07-16 신설(SP-20 v1.6, v1.9부터 레거시 폴백)
  .replace(/\[BENEFIT_SEMANTIC_SEARCH:[^\]]*\]/g, '')  // 2026-07-16 신설(SP-20 v1.9, 임베딩 재설계)
  .replace(/\[CALL_GOVTREE:[^\]]*\]/g, '')  // 2026-08-05 신설 — gov-tree 지방행정 SP 실행 태그(§ handleGovTreeStepExecute)
  // [2026-08-06 수정 — 실사로 발견] _handleSPAuthorTags(2001행)가 처리하는
  // 4개 태그가 이 스트립 목록에서 통째로 빠져 있었다. _handleSPAuthorTags
  // 자체는 정상 동작하지만, 그보다 먼저 화면에 찍히는 원문 버블
  // (_stripInternalTags(full)을 그대로 innerHTML에 대입하는 지점, webapp.html
  // _callPanelAI 3928행 등)에는 이 정규식이 적용되므로, 여기 없으면 원시
  // 대괄호 태그가 그대로 노출된다 — 실사(2026-08-06, "안심상속" 시나리오)로
  // [GWP_REGISTRY_SEARCH: ...], [GOV_SP_DRAFT_REQUEST: ...] 원문 노출 확인.
  // 값에 중첩 대괄호가 없는 flat key=value 본문이라 다른 태그들과 동일하게
  // [^\]]* 정규식으로 안전하게 처리 가능(DRAFT/UPDATE류처럼 중첩 배열을
  // 값으로 갖지 않음 — _stripBracketTag가 필요 없다).
  .replace(/\[GWP_REGISTRY_SEARCH:[^\]]*\]/g, '')
  .replace(/\[GOV_SP_DRAFT_REQUEST:[^\]]*\]/g, '')
  .replace(/\[SP_DRAFT_REQUEST:[^\]]*\]/g, '')
  .replace(/\[ESCALATE:[^\]]*\]/g, '')
  // 2026-07-09 정정 — DRAFT/UPDATE·KSEARCH_CANDIDATES는 steps=[...] 같은
  // 중첩 배열을 값으로 가져 위 _stripBracketTag()가 이미 먼저 처리했다
  // (이 체인에 들어오기 전에 적용됨) — 여기서 다시 정규식으로 지우지
  // 않는다(이중 처리 방지).
  // 2026-07-09 신설 — K-Search 계열 태그(§0-F, 지금까지 strip 목록에
  // 빠져 있어 K-Search가 실제로 응답하면 사용자에게 대괄호 태그 원문이
  // 그대로 노출될 뻔했다).
  .replace(/\[KSEARCH_HANDOFF:[^\]]*\]/g, '')
  .replace(/\[KSEARCH_RESULT:[^\]]*\]/g, '')
  .replace(/\[KSEARCH_CLARIFY:[^\]]*\]/g, '')
  .replace(/\[KSEARCH_HANDOFF_BACK:[^\]]*\]/g, '')
  .trim();

/**
 * _handleProfileTags — PROFILE_SUBMIT / PROFILE_SKIP / 단계 업데이트 처리
 *
 * v1.3 — export + sendFn 매개변수 추가: 메인 채팅(callAI)뿐 아니라 AI 패널
 * (webapp.html _callPanelAI) 등 다른 표면에서도 호출 가능. sendFn은 "인계
 * 안착 인사"를 어디로 보낼지 결정 — 기본값은 메인 채팅의 callAI, 패널에서
 * 호출할 때는 패널 자체의 전송 함수를 넘기면 그쪽 말풍선에 이어서 표시된다.
 *
 * v2.0 (2026-07-08) — userText 매개변수 추가: [PROFILE_INTERRUPT_HANDOFF]
 * 처리 시 "방금 사용자가 한 말"을 AC에게 그대로 재전달해야 하는데, 이
 * 함수는 fullReply(AI 응답)만 받고 있어서 그 원문에 접근할 방법이
 * 없었다. 호출부(_callAIInner)는 이미 userText를 갖고 있으므로 그대로
 * 넘겨받는다 — 기본값 ''은 하위 호환용(다른 호출부가 안 넘겨도 에러 안 남).
 */
export async function _handleProfileTags(fullReply, bubble, sendFn = callAI, userText = '') {
  // ── CALL_PROFILE_ASSISTANT — 폐기된 legacy 태그, 방어적 무력화만 수행
  //    (v2.0 신설, §0-E → 2026-07-11 [GWP: profile-assistant] 새 탭 방식으로
  //    완전히 대체됨 — gwp-registry.js·AGENT-COMMON_v3_45 §0-1 1042행 참조).
  //
  // 예전엔 이 태그가 오면 _switchToProfileAssistantSP()로 "같은 창의
  // system을 그대로 바꿔치기"했는데, 이 방식이 바로 "튜토리얼 대본이 AC
  // 자신의 응답과 섞여 실제 사용자 지시를 가로채는" 사고를 냈던 원인이라
  // 새 탭 방식으로 이관된 것이었다. 그런데 이관 이후에도 이 처리 블록
  // 자체는 지워지지 않고 남아있어, 캐시된 구버전 SP나 모델의 옛 태그명
  // 재현(할루시네이션) 등으로 이 태그가 다시 출력되면 이미 고쳤던 그
  // 버그가 그대로 재발할 위험이 있었다(2026-07-27 사고실험에서 실제로
  // webapp.html의 재방문자 튜토리얼 재개 트리거가 이 옛 태그명을 AC에게
  // 직접 지시하고 있던 것도 함께 발견돼 그쪽은 [GWP: profile-assistant]로
  // 정정함). 현재 시점엔 이 태그를 실제로 출력하는 곳이 없어야 정상이므로,
  // 혹시라도 관측되면 원인 파악용 경고만 남기고 절대 같은 창 전환을
  // 실행하지 않는다 — 정상 흐름은 그대로 이어간다(return false).
  if (fullReply.includes('[CALL_PROFILE_ASSISTANT]')) {
    console.warn('[Profile] ⚠️ 폐기된 [CALL_PROFILE_ASSISTANT] 태그 감지 — ' +
      '무시함(같은 창 전환 실행 안 함). [GWP: profile-assistant]를 썼어야 ' +
      '합니다 — SP 캐시나 호출부에 옛 태그명이 남아있는지 확인하세요.');
  }

  // ── PROFILE_INTERRUPT_HANDOFF — profile-assistant가 무관한 요청을 받아
  // AC로 즉시 반환 (v2.0 신설, profile-assistant SP §PROFILE-INTERRUPT-HANDOFF) ──
  if (fullReply.includes('[PROFILE_INTERRUPT_HANDOFF]')) {
    console.log('[Profile] PROFILE_INTERRUPT_HANDOFF 감지 — AGENT-COMMON으로 즉시 복귀');
    if (bubble) {
      const { _updateStreamBubble: _usb } = await import('../ui/bubble.js').catch(() => ({}));
      if (_usb) _usb(bubble, _stripInternalTags(fullReply));
    }
    history.length = 0;
    await _switchToAssistantSP();
    // 원래 사용자 발화를 AC에게 그대로 재전달 — 사용자가 같은 말을
    // 두 번 입력할 필요가 없도록. userText가 없으면(예: 내부 인계
    // 신호 자체가 무관 판정된 극히 예외적 경우) 조용히 건너뛴다.
    if (userText) await sendFn(userText);
    return true;
  }

  // ── FIRST_GREETED — PHASE -1 최초 인사 완료 (v1.3) ──────────
  if (fullReply.includes('[FIRST_GREETED]')) {
    console.log('[Profile] FIRST_GREETED 감지 — 최초 인사 완료');
    try {
      localStorage.setItem('hondi_first_greeted', '1');
      // v2.0: 이름짓기는 UI에서 직접 처리 — name_pending 플래그 불필요
      // 2026-07-13 신설 — 계정 나이 기준점(주기적 PDV 검토 간격 계산용).
      // 최초 인사는 가입당 정확히 1회만 발생하므로 신뢰할 수 있는 마커.
      if (!localStorage.getItem('hondi_signup_at')) {
        localStorage.setItem('hondi_signup_at', new Date().toISOString());
      }
    } catch {}
  }

  // ── PDV_REVIEWED — 주기적 PDV 검토 완료 기록 (2026-07-13 신설) ──
  if (fullReply.includes('[PDV_REVIEWED]')) {
    try { localStorage.setItem('hondi_pdv_review_last', new Date().toISOString()); } catch {}
  }

  // ── JOB_KSCO_REVIEWED — job_ksco 재확인 완료 기록 (2026-07-14 신설, 구멍 E) ──
  // review_due 자체도 +30일로 미뤄둔다(AC-AUTHOR §7과 동일 주기) — 서버
  // PROFILE_SUBMIT이 다음에 올 때까지는 로컬 캐시만 갱신, 서버 값은
  // 다음 정식 저장 때 반영된다(이 태그 자체는 "재확인을 시도했다"는
  // 기록일 뿐 job_ksco 내용 자체를 바꾸지 않음 — 내용 변경은 여전히
  // [PARTIAL_SAVE]의 몫).
  if (fullReply.includes('[JOB_KSCO_REVIEWED]')) {
    try {
      localStorage.setItem('hondi_job_ksco_review_last', new Date().toISOString());
      const partial = JSON.parse(localStorage.getItem('hondi_profile_partial') || '{}');
      if (partial.job_ksco) {
        partial.job_ksco.review_due = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
        localStorage.setItem('hondi_profile_partial', JSON.stringify(partial));
      }
    } catch {}
  }

  // ── SHARE_DOC_CONFIRMED/REJECTED — 정부24 공유문서 확인 완료(2026-07-09) ──
  await _processShareDocTags(fullReply);

  // ── NAME_CAPTURED — 이름짓기 응답 처리 완료 (v1.3) ──────────
  let _justCapturedName = false;
  if (fullReply.includes('[NAME_CAPTURED]')) {
    console.log('[Profile] NAME_CAPTURED 감지 — 이름짓기 응답 처리 완료');
    try { localStorage.setItem('hondi_name_pending', '0'); } catch {}
    // assistant_name은 hondi_profile_partial이 아닌 별도 키에 영구 저장
    // (hondi_profile_partial은 PROFILE_SUBMIT 시 삭제되므로, 거기 두면 사라짐)
    const nameMatch = fullReply.match(/\[PARTIAL_SAVE\]\s*(\{[^}]*"assistant_name"[^}]*\})/);
    if (nameMatch) {
      try {
        const parsed = JSON.parse(nameMatch[1]);
        if (parsed.assistant_name) localStorage.setItem('hondi_assistant_name', parsed.assistant_name);
      } catch {}
    }
    _justCapturedName = true;
  }

  // ── PDV 일상/업무 영역 전환 [PDV_DOMAIN_SET] (2026-07-13 신설,
  // AC-EVOLUTION_v1_1.md §PDV-SPLIT) — 시간대 자동전환이 아니라 사용자의
  // 명시적 발화("업무 시작"/"퇴근했어요" 등)를 AC가 감지했을 때만 바뀐다.
  const domainSetMatch = fullReply.match(/\[PDV_DOMAIN_SET:\s*mode=(work|personal)(?:,\s*org=([\w:.-]+))?\]/);
  if (domainSetMatch) {
    setPdvDomain(domainSetMatch[1], domainSetMatch[2] || null);
  }

  // ── 진행 중 필드 저장 [PARTIAL_SAVE] — step 태그 유무와 무관하게 항상 처리 (v1.3) ──
  // 이전엔 [N/6단계] 태그가 같은 응답에 없으면 PARTIAL_SAVE를 무시했는데,
  // PA SP가 단계를 건너뛰며 동시에 값을 채우는 경우(추정 입력 등) 놓칠 수 있어 분리함.
  if (!localStorage.getItem('hondi_profile_done')) {
    const partialMatch = fullReply.match(/\[PARTIAL_SAVE\]\s*(\{[\s\S]*?\})/);
    if (partialMatch) {
      try {
        const incoming = JSON.parse(partialMatch[1]);
        const existing = JSON.parse(localStorage.getItem('hondi_profile_partial') || '{}');

        // 2026-09-13 신설 — entity_type 모순 감지를 profile-assistant SP(모델)의
        // 자기 신고(§ESCALATE-TO-PRO 조건2)에만 맡기지 않는다. 라이브
        // 스모크테스트 diverse-industries #11에서 실측: 사용자가 "사업자예요"
        // →"사실 개인이에요"로 명백히 번복했는데도 flash가 승격 태그를 내지
        // 않고 조용히 자체 판단만으로 person으로 넘어간 사례 확인. 판단(자연어
        // 응대)은 여전히 SP가 하되, "이미 확정 저장된 값과 다른 값이 다시
        // 저장되려 한다"는 사실 자체의 감지는 결정론적으로 코드가 책임진다
        // (TIER3 게이트를 서버가 모델 판단과 무관하게 강제하는 것과 동일한
        // 원칙 — 판단과 판단의 검증을 같은 층에 전부 맡기지 않는다).
        // incoming 값으로 그대로 덮어쓰는 건 유지한다(최신 발화를 반영하는
        // 게 기존 병합 원칙과 일치) — 다만 그 사실을 별도로 기록해 다음 턴
        // [CONTEXT]에 실어 보내고, SP가 반드시 명시적으로 확인하게 만든다.
        if (
          incoming.entity_type &&
          existing.entity_type &&
          incoming.entity_type !== existing.entity_type
        ) {
          localStorage.setItem('hondi_profile_entity_type_conflict', JSON.stringify({
            previous: existing.entity_type,
            next: incoming.entity_type,
            at: new Date().toISOString(),
          }));
          console.warn(
            '[Profile] entity_type 모순 감지(결정론적 가드, §ESCALATE-TO-PRO 조건2 강제 발동 예정):',
            existing.entity_type, '->', incoming.entity_type
          );
        }

        localStorage.setItem('hondi_profile_partial', JSON.stringify(Object.assign(existing, incoming)));
      } catch {}
    }
  }

  // ── [TEMPLATE_LOOKUP] — 정체성/업종 템플릿 참조 조회 (2026-07-17 신설) ──
  // profile-assistant SP의 [§INDUSTRY-TEMPLATE](v2.3)가 이 태그를 출력하도록
  // 설계돼 있었으나, 여기(클라이언트 핸들러)와 worker.js(엔드포인트) 양쪽 다
  // 실제 구현이 없어 태그가 조용히 유실되고 있었다(실사 발견). 아래에서
  // 처음으로 배선한다 — schema_id(사업자/KSIC), job_ksco_code·work_domain
  // (개인/KSCO+work_domain 배열) 중 있는 것만 보내면 서버가 알아서 분기.
  // 구 태그명 [INDUSTRY_TEMPLATE_LOOKUP: schema_id=...]도 과도기 동안 함께 인식.
  const templateLookupMatch =
    fullReply.match(/\[TEMPLATE_LOOKUP:\s*([^\]]*)\]/) ||
    fullReply.match(/\[INDUSTRY_TEMPLATE_LOOKUP:\s*([^\]]*)\]/);
  if (templateLookupMatch) {
    console.log('[Profile] TEMPLATE_LOOKUP 감지 — 참조 프로필 조회');
    if (bubble) {
      const { _updateStreamBubble: _usb } = await import('../ui/bubble.js').catch(() => ({}));
      if (_usb) _usb(bubble, _stripInternalTags(fullReply));
    }
    history.push({ role: 'assistant', content: fullReply });

    // 태그 본문 파싱 — "key=value, key2=value2" 형식(다른 태그들과 동일 관례).
    // work_domain=student,self_employed 처럼 콤마로 다중값을 받을 수 있는
    // 필드는 work_domain만 별도 분리해 배열로 만든다.
    const raw = templateLookupMatch[1];
    const params = {};
    for (const part of raw.split(',')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const k = part.slice(0, eq).trim();
      const v = part.slice(eq + 1).trim();
      if (k) params[k] = v;
    }
    const workDomainStatuses = params.work_domain
      ? params.work_domain.split('+').map(s => s.trim()).filter(Boolean) // '+'로 다중 결합 표기(콤마는 이미 파라미터 구분자로 씀)
      : undefined;

    const base = (CFG.endpoint || '').replace(/\/+$/, '');

    // 2026-07-17 수정 — 100인 사고실험 케이스 #64("카페 사장이자 바리스타")
    // 에서 발견: schema_id(업종)와 job_ksco_code/work_domain(개인 직업)이
    // 같은 세션에서 함께 확정되면, 예전 코드는 이걸 한 요청에 AND로 묶어
    // 보냈다 — "이 KSIC 코드'와 동시에' 이 KSCO 코드도 가진 프로필"이라는
    // 조건은 사실상 항상 공집합에 가까워(업종 템플릿과 개인 직업 템플릿은
    // 서로 다른 모집단이다), 참조가 있어야 할 상황에서도 매번 "최초 사례"로
    // 잘못 처리됐다. 두 축이 모두 있으면 독립된 요청 두 번으로 분리한다.
    const lookups = [];
    if (params.schema_id) {
      lookups.push({ label: 'INDUSTRY_TEMPLATE', body: { entity_type: 'business', schema_id: params.schema_id } });
    }
    if (params.job_ksco_code || workDomainStatuses) {
      lookups.push({
        label: 'PERSON_TEMPLATE',
        body: { entity_type: 'person', job_ksco_code: params.job_ksco_code || undefined, work_domain_statuses: workDomainStatuses },
      });
    }

    const contextBlocks = [];
    for (const { label, body } of lookups) {
      let refs = [];
      try {
        const res = await fetch(`${base}/template-lookup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const data = await res.json().catch(() => ({ refs: [] }));
          refs = data.refs || [];
        } else {
          console.warn('[Profile] template-lookup 실패 (HTTP', res.status, `, ${label}) — 빈 참조로 진행`);
        }
      } catch (e) {
        console.warn(`[Profile] template-lookup 요청 실패(${label}, 무시 — 빈 참조로 진행):`, e.message);
      }
      // 참조가 없어도(신규 업종/정체성 최초 사례) 빈 블록으로 다음 턴을
      // 진행시킨다 — SP의 [§TEMPLATE-REFERENCE] 원칙("참조 없으면 조용히
      // 본인 지식으로 진행")이 이 빈 블록을 보고 그대로 동작한다.
      contextBlocks.push(
        refs.length
          ? `[CONTEXT: ${label}]\n${JSON.stringify(refs)}\n[/CONTEXT]`
          : `[CONTEXT: ${label}]\n(참조 사례 없음 — 최초 사례)\n[/CONTEXT]`
      );
    }
    await sendFn(contextBlocks.join('\n'));
    return true;
  }

  // ── 단계 업데이트 [N/6단계] ───────────────────────────────
  const stepMatch = fullReply.match(/\[(\d+)\/\d+단계\]/);
  if (stepMatch && !localStorage.getItem('hondi_profile_done')) {
    try { localStorage.setItem('hondi_profile_step', stepMatch[1]); } catch {}
  }

  // ── TEMPLATE_CANDIDATE — 최초 사례 템플릿 후보 큐잉 (2026-07-17 신설) ──
  // PROFILE_SUBMIT과 같은 응답에 함께 출력되므로 그 처리보다 먼저 감지한다.
  // 아직 서버 컬렉션(identity_templates 등)이 없어(§RENEWALING 배치 도구가
  // 그 역할까지는 아직 안 함 — PocketBase 마이그레이션 별도 필요) 우선
  // 로컬에 큐잉만 해둔다. 클라이언트 하나의 큐일 뿐이라 전체 통계로서의
  // 의미는 없고, "이 기기에서 최초 사례가 몇 번 있었나"를 사람이 나중에
  // 확인할 수 있는 최소한의 기록이다 — 실제 코드↔템플릿 갱신은 여전히
  // tools/renew_identity_templates.py(전수 조사)의 몫.
  const templateCandidateMatch = fullReply.match(/\[TEMPLATE_CANDIDATE:\s*([^\]]*)\]/);
  if (templateCandidateMatch) {
    try {
      const raw = templateCandidateMatch[1];
      const params = {};
      for (const part of raw.split(',')) {
        const eq = part.indexOf('=');
        if (eq === -1) continue;
        params[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
      }
      const queue = JSON.parse(localStorage.getItem('hondi_template_candidates') || '[]');
      queue.push({
        key: params.key || null,
        fields: params.fields ? params.fields.split('|').map(f => f.trim()).filter(Boolean) : [],
        queued_at: new Date().toISOString(),
      });
      // 무한 누적 방지 — 오래된 것부터 버리고 최근 200건만 유지.
      while (queue.length > 200) queue.shift();
      localStorage.setItem('hondi_template_candidates', JSON.stringify(queue));
      console.log('[Profile] TEMPLATE_CANDIDATE 큐잉 완료:', params.key);
    } catch (e) {
      console.warn('[Profile] TEMPLATE_CANDIDATE 큐잉 실패(무시):', e.message);
    }
  }

  // ── PROFILE_SUBMIT ────────────────────────────────────────
  if (fullReply.includes('PROFILE_SUBMIT')) {
    console.log('[Profile] PROFILE_SUBMIT 감지 — 프로필 등록 시작');
    try {
      const { handleProfileSubmit } = await import('../ui/welcome.js');
      await handleProfileSubmit(fullReply);
    } catch (e) {
      console.warn('[Profile] handleProfileSubmit 실패:', e.message);
    }
    // v1.3 — 사용자 화면에는 PROFILE_CARD 등 자연어만 남기고 내부 태그는 제거
    if (bubble) {
      const { _updateStreamBubble: _usb } = await import('../ui/bubble.js').catch(() => ({}));
      if (_usb) _usb(bubble, _stripInternalTags(fullReply));
    }
    // 상태 정리 (assistant_name은 의도적으로 보존 — AGENT-COMMON 등 이후에도 유지)
    try {
      localStorage.setItem('hondi_profile_done', '1');
      localStorage.removeItem('hondi_profile_step');
      localStorage.removeItem('hondi_profile_skipped');
      localStorage.removeItem('hondi_profile_partial');
      localStorage.removeItem('hondi_first_greeted');
      localStorage.removeItem('hondi_name_pending');
    } catch {}
    history.length = 0;
    await _switchToAssistantSP();
    await _triggerSeamlessHandoff(sendFn);
    return true;
  }

  // ── TUTORIAL_ADVANCE — 튜토리얼 단계 진행 (v2.0) ─────────
  const _tutAdvMatch = fullReply.match(/\[TUTORIAL_ADVANCE:(\d+)\]/);
  if (_tutAdvMatch) {
    const nextStep = parseInt(_tutAdvMatch[1], 10);
    try {
      if (nextStep >= 7) {
        localStorage.setItem('hondi_tutorial_done', '1');
        localStorage.removeItem('hondi_tutorial_step');
        console.log('[Tutorial] 완료');
      } else {
        localStorage.setItem('hondi_tutorial_step', String(nextStep));
        console.log('[Tutorial] 단계→', nextStep);
      }
    } catch {}
  }

  // ── PANEL_ACTION:close — 튜토리얼 마지막에 "닫을까요?"라고 물은 뒤
  // 사용자가 동의하면 AI가 이 태그를 출력해 실제로 패널을 닫는다
  // (2026-07-02 신설). closeAIPanel()은 webapp.html의 AI 패널 IIFE에서
  // window.closeAIPanel로 노출돼 있다 — 여기선 브라우저 전역이므로 그대로 호출.
  if (fullReply.includes('[PANEL_ACTION:close]')) {
    try {
      setTimeout(() => {
        if (typeof window !== 'undefined' && typeof window.closeAIPanel === 'function') {
          window.closeAIPanel();
        }
      }, 900); // 마지막 인사 버블을 사용자가 읽을 시간을 살짝 준 뒤 닫는다
    } catch {}
  }

  // ── PROFILE_SKIP ──────────────────────────────────────────
  if (fullReply.includes('[PROFILE_SKIP]')) {
    console.log('[Profile] PROFILE_SKIP 감지 — 온보딩 건너뜀 (재개를 위해 단계·작성분 보존)');
    try {
      localStorage.setItem('hondi_profile_skipped', '1');
      // v1.4 — hondi_profile_step / hondi_profile_partial은 더 이상 지우지 않는다.
      // PA SP가 사용자에게 "나중에 설정 → 프로필에서 이어서 작성하실 수 있어요"라고
      // 약속하는데, 여기서 지워버리면 settings.js의 resumeProfileSetup()이 어느
      // 단계였는지도, 이미 입력한 값도 알 수 없게 돼 약속이 깨진다. 재개 시점
      // (resumeProfileSetup)에서 hondi_profile_skipped를 다시 해제하는 식으로 처리한다.
    } catch {}
    // v1.3 — 내부 태그 전체 제거(이전엔 [PROFILE_SKIP]만 지웠음)
    if (bubble) {
      const { _updateStreamBubble: _usb } = await import('../ui/bubble.js').catch(() => ({}));
      if (_usb) _usb(bubble, _stripInternalTags(fullReply));
    }
    history.length = 0;
    await _switchToAssistantSP();
    await _triggerSeamlessHandoff(sendFn);
    return true;
  }

  // ── 여기까지 SUBMIT/SKIP이 아니었어도, 내부 태그가 섞여 있었다면 화면은 정리 (v1.3) ──
  if (bubble) {
    const cleaned = _stripInternalTags(fullReply);
    if (cleaned !== fullReply.trim()) {
      const { _updateStreamBubble: _usb } = await import('../ui/bubble.js').catch(() => ({}));
      if (_usb) _usb(bubble, cleaned);
    }
  }

  // ── NAME_CAPTURED 자동 이어가기 (v1.4) ──────────────────────
  // SP 사양(PHASE 0): "[P0-NAME-CAPTURE] 처리 후 아래 1~3 평가"는 같은 응답
  // 안에서 모델이 스스로 이어 쓰는 것을 전제로 하지만, 모델이 이름 확인
  // 한 줄만 내고 응답을 끝내버리면 대화가 그대로 멈춘다(실사용에서 확인됨).
  // PROFILE_SUBMIT/SKIP과 동일하게, 모델의 판단에 맡기지 않고 클라이언트가
  // 명시적으로 한 번 더 트리거해 PHASE 1로 이어지게 한다. SUBMIT/SKIP은 위에서
  // 이미 return true로 빠지므로 여기 도달했다면 둘 다 아니었다는 뜻.
  if (_justCapturedName) {
    await _triggerProfileContinue(sendFn);
    return true;
  }

  return false;
}

/**
 * _recoverOrchestrationFailure — 오케스트레이션 홉 워치독의 복구 처리
 * (2026-08-06 신설, "필요한 지점에만 감독" 합의 반영)
 *
 * 배경: 기존엔 K-Intent/K-Compose/K-Execute 등 체인 중 어느 한 홉이라도
 * 실패(전체 LLM 후보 소진, 네트워크 오류, 45초 타임아웃)하면 _callAIInner의
 * 일반 catch가 "⚠️ API 오류: ..." 문구만 사용자에게 보여주고 그대로 멈췄다 —
 * 재시도도, 대안 안내도, AC의 재판단도 없었다.
 *
 * 설계: 매 홉마다 AC(hondi-pro)가 상시 감독하게 하면(모든 재주입 결과를 다시
 * AC 판단에 태우면) 어제 hondi-flash로 분리해 줄인 지연 비용이 다시 늘어난다
 * (§HANDOFF_2026-08-06 modelTier 배선과 정면 충돌). 대신 실패가 "실제로
 * 발생한" 홉에서만 AC를 다시 불러 복구를 맡기는 워치독 방식을 쓴다 —
 * 평소엔 개입 없이 relay가 그대로 진행되고, 딱 필요한 지점에서만 감독이
 * 켜진다.
 *
 * CFG.system을 system_base(AC)로 강제 복원하는 게 핵심이다 — 안 하면 실패한
 * SP의 system 프롬프트가 그대로 남아 복구 메시지도 그 SP 인격으로
 * 응답해버린다(예: K-Execute가 자기 실패를 K-Execute 문법으로 서술).
 */
async function _recoverOrchestrationFailure(err, sendFn, userText, hopLabel) {
  console.warn(`[Orchestration][Watchdog] "${hopLabel}" 홉 실패 — AC로 복귀:`, err?.message || err);
  CFG.system = CFG.system_base || CFG.system;
  const reason = String(err?.message || err || '알 수 없는 오류').slice(0, 200);
  const recoveryMsg =
    `[INTERNAL: 오케스트레이션 진행 중 "${hopLabel}" 단계 처리에 실패했습니다(사유: ${reason}). ` +
    `사용자에게 이 실패를 기술적 오류 문구 그대로 노출하지 말고 자연스럽게 설명하고, ` +
    `재시도가 의미 있으면 재시도 의사를 물어보거나 정부24 등 대체 경로를 안내하세요. ` +
    `원래 사용자 발화: "${userText}"]`;
  try {
    // 복구 호출 자체는 워치독 없이(=onFailure 없이) 보낸다 — 이것마저 실패하면
    // 기존 일반 오류 UI로 자연스럽게 떨어진다(무한 재귀 방지).
    await sendFn(recoveryMsg);
  } catch (e2) {
    console.error('[Orchestration][Watchdog] 복구 호출도 실패 — 포기:', e2.message);
  }
}



/**
 * _handleOrchestrationTags — AC↔K-Intent↔K-Compose↔K-Deliver 및 그
 * 내부의 중첩 위임(K-Search/EXPERT scope=orchestration_subtask)을
 * 공통 처리한다(2026-07-08 신설, AGENT-COMMON §0-H v3.40).
 *
 * _handleProfileTags와 동일한 디스패처 패턴 — 어느 SP가 활성 상태든
 * 이 함수 하나가 모든 태그를 감지한다. "전달"(forward, 스택 안 씀)과
 * "위임"(nested, 스택 씀)을 구분하는 게 이 함수의 핵심 책임이다.
 */
export async function _handleOrchestrationTags(fullReply, bubble, sendFn = callAI, userText = '') {
  const _updateBubble = async (text) => {
    if (!bubble) return;
    const { _updateStreamBubble: _usb } = await import('../ui/bubble.js').catch(() => ({}));
    if (_usb) _usb(bubble, text);
  };

  // [2026-08-06 신설 — 워치독] 이 함수 안의 모든 재귀 sendFn(...) 호출을 이
  // 래퍼로 교체해서 쓴다(아래 일괄 치환). 어느 한 홉이 실패해도 AC로 복귀해
  // 복구를 시도한다 — 자세한 설계 근거는 위 _recoverOrchestrationFailure
  // 함수 주석 참고. hopLabel은 각 호출부 근처 주석/태그명을 그대로 쓴다.
  const _watchdogSendFn = (hopLabel) => async (text, imageFile, preTabArg, modelTierArg) => {
    try {
      await sendFn(text, imageFile, preTabArg, modelTierArg,
        (err) => _recoverOrchestrationFailure(err, sendFn, userText, hopLabel));
    } catch (err) {
      // sendFn 자체가 onFailure(5번째 인자)를 모르는 커스텀 구현(예: 패널의
      // _panelSendFn — 아직 미지원)일 경우를 대비한 방어적 fallback.
      await _recoverOrchestrationFailure(err, sendFn, userText, hopLabel);
    }
  };
  // ── [ORCHESTRATION_PROGRESS: step=n/total, doing=...] 실시간 진행상황
  // 표시 (2026-07-12 신설, K-Compose SP-20 v1.4와 함께) ──
  // ★ 배경: 오케스트레이션(K-Intent→K-Compose→K-Deliver)이 여러 기관을
  // 순차 호출하는 동안, 지금까지는 K-Deliver가 마지막에 결과를 내놓기
  // 전까지 이용자에게 아무 진행 신호가 없었다("실행과정 실시간 전달"이
  // 사실상 없는 상태였음 — 2026-07-12 검토로 발견). 이 태그는 K-Compose가
  // STEP4에서 각 단계 착수 직전에 낸다. 서버 호출이 필요 없는 순수 UI
  // 신호라 재귀 호출 없이 버블만 갱신하고, false를 반환해 같은 fullReply
  // 안의 다른 태그(KSEARCH_HANDOFF 등)가 계속 처리되게 한다 — 이 처리가
  // 다른 로직을 막으면 안 된다.
  try {
    const progressMatch = fullReply.match(/\[ORCHESTRATION_PROGRESS:\s*step=(\d+)\/(\d+),\s*doing=([^\]]+)\]/);
    if (progressMatch) {
      const [, step, total, doing] = progressMatch;
      console.info(`[Orchestration] 진행상황 (${step}/${total}): ${doing.trim()}`);
      const displayText = _stripInternalTags(fullReply).trim();
      const progressLine = `🔄 (${step}/${total}) ${doing.trim()}…`;
      await _updateBubble(displayText ? `${progressLine}\n\n${displayText}` : progressLine);
    }
  } catch (e) {
    console.warn('[Orchestration] PROGRESS 처리 오류 (무시):', e.message);
  }

  // ── worker.js 오케스트레이션 레지스트리 실제 배선 (2026-07-09 신설) ──
  // ★ 통합 사고실험에서 발견된 가장 심각한 공백 ★ — SP-20(K-Compose)이
  // [PROCEDURE_MAP_LOOKUP]/[PROCEDURE_MAP_DRAFT]/[PROCEDURE_MAP_UPDATE]/
  // [CALL_GOVSYS] 태그를 내도록 설계돼 있고, worker.js에도 해당 엔드포인트가
  // 실제로 구현돼 있었는데, 이 둘을 잇는 fetch 코드가 지금까지 하나도
  // 없었다 — 태그는 strip 목록에서 대괄호만 지워질 뿐 아무 일도 안
  // 일어나던 상태였다. K-Market/market웹앱의 [SEARCH] 재주입 패턴(질의→
  // RPC→결과를 시스템 메시지로 주입→같은 세션에서 재호출)을 그대로
  // 재사용한다 — system은 K-Compose로 유지한 채 결과만 받는다.
  if (CFG.system?.includes('K-Compose') || CFG.system?.includes('K-Deliver')) {
    const base = (CFG.endpoint || '').replace(/\/+$/, '');

    const updateMatch = fullReply.match(/\[PROCEDURE_MAP_UPDATE:\s*goal=([^,\]]+)/);
    if (updateMatch && fullReply.includes('[PROCEDURE_MAP_UPDATE:')) {
      // ★ K-Deliver도 이 태그를 낸다(SP-21 STEP 4) — K-Compose만 게이트에
      // 있어 놓치고 있던 공백. DRAFT와 동일한 한계(자유 텍스트 바디,
      // goal 필드만 안전하게 추출)를 그대로 갖는다.
      console.log('[Orchestration] PROCEDURE_MAP_UPDATE 감지 — worker.js 갱신 요청');
      await _updateBubble(_stripInternalTags(fullReply));
      history.push({ role: 'assistant', content: fullReply });
      let resultText;
      try {
        const res = await fetch(`${base}/orchestration/procedure-map/update`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goal: updateMatch[1].trim(), changes: [] }),
        });
        resultText = JSON.stringify(await res.json().catch(() => ({ status: res.status })));
      } catch (e) {
        resultText = `{"error":"${e.message}"}`;
      }
      await _watchdogSendFn('PROCEDURE_MAP_UPDATE')(`[PROCEDURE_MAP_UPDATE 결과] ${resultText}`, null, null, resolveOrchestrationModel('PROCEDURE_MAP_UPDATE_RESULT'));
      return true;
    }

    const lookupMatch = fullReply.match(/\[PROCEDURE_MAP_LOOKUP:\s*goal=([^\]]+)\]/);
    if (lookupMatch) {
      console.log('[Orchestration] PROCEDURE_MAP_LOOKUP 감지 — worker.js 조회');
      await _updateBubble(_stripInternalTags(fullReply));
      history.push({ role: 'assistant', content: fullReply });
      let resultText;
      try {
        const res = await fetch(`${base}/orchestration/procedure-map?goal=${encodeURIComponent(lookupMatch[1].trim())}`);
        resultText = res.ok ? JSON.stringify(await res.json()) : `{"error":"HTTP ${res.status}"}`;
      } catch (e) {
        resultText = `{"error":"${e.message}"}`;
      }
      await _watchdogSendFn('PROCEDURE_MAP_LOOKUP')(`[PROCEDURE_MAP_LOOKUP 결과] ${resultText}\n\n위 결과를 이어받아 RULE-02를 계속 진행하세요.`, null, null, resolveOrchestrationModel('PROCEDURE_MAP_LOOKUP_RESULT'));
      return true;
    }

    // 2026-07-16 신설(SP-20 v1.9 STEP 0-DISCOVER, 임베딩 기반 전면
    // 재설계) — query가 자연어 문장이라 콤마를 포함할 수 있다(예:
    // "제주 거주, 만 30세 청년..."). 기존 BENEFIT_CANDIDATE_SEARCH
    // 처럼 태그 전체를 콤마로 나누면 문장 안의 콤마에서 파싱이
    // 깨진다 — query는 반드시 따옴표로 감싸게 하고, 정규식으로
    // 따옴표 안쪽만 통째로 뽑는다(콤마 개수와 무관하게 안전).
    const semanticSearchMatch = fullReply.match(
      /\[BENEFIT_SEMANTIC_SEARCH:\s*query="([^"]*)"(?:,\s*domain=([^,\]]+))?(?:,\s*limit=(\d+))?\]/
    );
    if (semanticSearchMatch) {
      console.log('[Orchestration] BENEFIT_SEMANTIC_SEARCH 감지 — worker.js 임베딩 의미검색');
      await _updateBubble(_stripInternalTags(fullReply));
      history.push({ role: 'assistant', content: fullReply });
      const [, query, domain, limit] = semanticSearchMatch;
      const qs = new URLSearchParams();
      qs.set('query', query.trim());
      if (domain) qs.set('domain', domain.trim());
      if (limit) qs.set('limit', limit.trim());
      let resultText;
      try {
        const res = await fetch(`${base}/orchestration/benefit-semantic-search?${qs.toString()}`);
        resultText = res.ok ? JSON.stringify(await res.json()) : `{"error":"HTTP ${res.status}"}`;
      } catch (e) {
        resultText = `{"error":"${e.message}"}`;
      }
      await _watchdogSendFn('BENEFIT_SEMANTIC_SEARCH')(`[BENEFIT_SEMANTIC_SEARCH 결과] ${resultText}\n\n위 후보 목록을 이어받아 RULE-02 STEP 0-C를 계속 진행하세요.`, null, null, resolveOrchestrationModel('BENEFIT_SEMANTIC_SEARCH_RESULT'));
      return true;
    }

    // ★ 비상 폴백으로 유지(2026-07-16부터 SP-20이 더 이상 안 씀) —
    // 2026-07-16 신설(SP-20 v1.6 STEP 0-DISCOVER) — 사업명을 모르는
    // 발견형 의도 전용. PROCEDURE_MAP_LOOKUP과 동일한 재주입 패턴이나
    // goal 완전일치 대신 q/domain LIKE 검색으로 다건을 받는다.
    const benefitSearchMatch = fullReply.match(/\[BENEFIT_CANDIDATE_SEARCH:\s*([^\]]+)\]/);
    if (benefitSearchMatch) {
      console.log('[Orchestration] BENEFIT_CANDIDATE_SEARCH 감지 — worker.js 후보 검색(레거시 LIKE 경로)');
      await _updateBubble(_stripInternalTags(fullReply));
      history.push({ role: 'assistant', content: fullReply });
      const params = {};
      benefitSearchMatch[1].split(',').forEach((kv) => {
        const [k, ...rest] = kv.split('=');
        if (k) params[k.trim()] = rest.join('=').trim();
      });
      const qs = new URLSearchParams();
      if (params.q) qs.set('q', params.q);
      if (params.domain) qs.set('domain', params.domain);
      if (params.limit) qs.set('limit', params.limit);
      let resultText;
      try {
        const res = await fetch(`${base}/orchestration/benefit-candidates?${qs.toString()}`);
        resultText = res.ok ? JSON.stringify(await res.json()) : `{"error":"HTTP ${res.status}"}`;
      } catch (e) {
        resultText = `{"error":"${e.message}"}`;
      }
      await _watchdogSendFn('BENEFIT_CANDIDATE_SEARCH')(`[BENEFIT_CANDIDATE_SEARCH 결과] ${resultText}\n\n위 후보 목록을 이어받아 RULE-02 STEP 0-C를 계속 진행하세요.`, null, null, resolveOrchestrationModel('BENEFIT_CANDIDATE_SEARCH_RESULT'));
      return true;
    }

    const draftMatch = fullReply.match(/\[PROCEDURE_MAP_DRAFT:([\s\S]*)\]$/m);
    if (draftMatch && fullReply.includes('[PROCEDURE_MAP_DRAFT:')) {
      console.log('[Orchestration] PROCEDURE_MAP_DRAFT 감지 — worker.js 등재 요청');
      await _updateBubble(_stripInternalTags(fullReply));
      history.push({ role: 'assistant', content: fullReply });
      // ★ 정직한 한계 ★ 이 태그의 바디는 goal=..., steps=[...] 같은
      // 준-JSON 자유 텍스트라 완전한 파서가 아직 없다 — 최소한의 goal
      // 필드만 뽑아 draft 생성을 "시도"하고, 나머지 구조화된 필드
      // (steps 등)는 이번 배선에서 전달하지 않는다(다음 순서 후보:
      // K-Compose가 애초에 JSON 블록으로 태그 바디를 내도록 SP 문서
      // 정정, 그래야 안전하게 파싱 가능).
      const goalM = draftMatch[1].match(/goal=([^,\]]+)/);
      let resultText;
      if (!goalM) {
        resultText = '{"error":"goal 필드를 이 태그 바디에서 못 찾음 — 등재 생략"}';
      } else {
        try {
          const res = await fetch(`${base}/orchestration/procedure-map/draft`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ goal: goalM[1].trim(), domain: '', steps: [] }),
          });
          resultText = JSON.stringify(await res.json().catch(() => ({ status: res.status })));
        } catch (e) {
          resultText = `{"error":"${e.message}"}`;
        }
      }
      await _watchdogSendFn('PROCEDURE_MAP_DRAFT')(`[PROCEDURE_MAP_DRAFT 결과] ${resultText}`, null, null, resolveOrchestrationModel('PROCEDURE_MAP_DRAFT_RESULT'));
      return true;
    }

    const govsysMatch = fullReply.match(/\[CALL_GOVSYS:\s*id=([\w-]+),\s*mode=([\w-]+),\s*caller=([\w-]+)\]/);
    if (govsysMatch) {
      // ★ 정정 ★ SP-20 문서는 이 태그의 id를 "automation_sp 식별자"처럼
      // 서술했지만, worker.js execute-atom은 atom_id로 조회한 뒤 그
      // 안의 automation_sp를 내부적으로 쓰는 구조다(3~4차 라운드에서
      // "원자=패턴+데이터"로 확정한 설계 그대로). 그래서 여기서는 id를
      // atom_id로 취급해 호출한다 — K-Compose가 PROCEDURE_MAP의 steps
      // 에서 얻는 값이 원래 atom_id이므로 실제 사용과도 맞아떨어진다.
      console.log('[Orchestration] CALL_GOVSYS 감지 — /orchestration/execute-atom 호출(id=atom_id로 취급)');
      await _updateBubble(_stripInternalTags(fullReply));
      history.push({ role: 'assistant', content: fullReply });
      let resultText;
      try {
        const res = await fetch(`${base}/orchestration/execute-atom`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ atom_id: govsysMatch[1], atom_input: {} }),
        });
        resultText = JSON.stringify(await res.json().catch(() => ({ status: res.status })));
      } catch (e) {
        resultText = `{"error":"${e.message}"}`;
      }
      await _watchdogSendFn('CALL_GOVSYS')(`[CALL_GOVSYS 결과] ${resultText}\n\n결과가 requires_user_action이면 그 사유를 이용자에게 자연스럽게 전달하세요.`, null, null, resolveOrchestrationModel('CALL_GOVSYS_RESULT'));
      return true;
    }

    // ── CALL_GOVTREE(2026-08-05 신설) — org_profiles.resolution_strategy=
    // gov_tree_delegate인 지방행정 기관 실행. CALL_GOVSYS(순수 API 자동화,
    // atom_id 기반)와 달리 gov-tree SP와 자연어로 한 턴 대화해서 결과를
    // 얻는다 — task 필드는 콤마를 포함할 수 있어(자연어 문장) 반드시
    // 따옴표로 감싸게 하고 정규식은 따옴표 안쪽만 통째로 뽑는다
    // (BENEFIT_SEMANTIC_SEARCH의 query= 파싱과 동일한 이유).
    const govtreeMatch = fullReply.match(
      /\[CALL_GOVTREE:\s*gov_tree_ref=([\w:-]+),\s*task="([^"]*)"(?:,\s*caller=([\w-]+))?\]/
    );
    if (govtreeMatch) {
      console.log('[Orchestration] CALL_GOVTREE 감지 — /orchestration/execute-govtree-step 호출');
      await _updateBubble(_stripInternalTags(fullReply));
      history.push({ role: 'assistant', content: fullReply });
      const [, govTreeRef, task] = govtreeMatch;
      let resultText;
      try {
        const res = await fetch(`${base}/orchestration/execute-govtree-step`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gov_tree_ref: govTreeRef, task: task.trim() }),
        });
        resultText = JSON.stringify(await res.json().catch(() => ({ status: res.status })));
      } catch (e) {
        resultText = `{"error":"${e.message}"}`;
      }
      await _watchdogSendFn('CALL_GOVTREE')(`[CALL_GOVTREE 결과] ${resultText}\n\nstatus가 gov_tree_ref_stale이면 org_profiles와 gov-tree가 어긋난 것이므로 이 기관은 미연결로 취급하고 대체 경로(K-Search 등)를 시도하세요. status=ok면 institution_response를 그 기관이 실제로 답한 내용으로 취급해 다음 단계로 진행하세요.`, null, null, resolveOrchestrationModel('CALL_GOVTREE_RESULT'));
      return true;
    }
  }

  // ── AC → K-Intent (§0-H 트리거, forward — AC는 이후 관여 안 함) ──
  // 2026-08-06 수정 — 라이브 재검증 중 실사로 발견: 모델이 이 태그를
  // '[CALL_KINTENT]'(콜론·query= 없이 괄호 인용 형태로만 언급) 또는
  // 'CALL_INTENT'(K자 탈락 오탈자)로 내는 경우가 실제로 있었다. 원래의
  // 좁은 정규식(`\[CALL_KINTENT:\s*query=...\]`)은 둘 다 못 잡아서,
  // AC→K-Intent 전달 자체가 발동을 안 하는데도 사용자에게는 "확인
  // 중이니 기다려 주세요"라는 안내만 남고 그대로 정지하는 치명적
  // 결함으로 이어졌다(EXPERT:kfam과 같은 계열의 문제이지만, 이번엔
  // 오케스트레이션 진입점 자체라 사용자 입장에선 "시스템 다운"처럼
  // 보였다). 태그명 철자(K 유무)와 본문 유무를 모두 허용하도록 넓히고,
  // query= 본문이 없으면 원 사용자 발화(userText)를 목표로 대신 쓴다 —
  // AC가 이 태그를 냈다는 것 자체가 "지금 발화를 K-Intent에 넘기겠다"는
  // 의도이므로 안전한 폴백이다.
  const kIntentMatch = fullReply.match(/\[CALL_K?INTENT\s*(?::\s*query=([^\]]+))?\]/i);
  if (kIntentMatch) {
    const forwardQuery = (kIntentMatch[1] || userText || '').trim();
    console.log('[Orchestration] CALL_KINTENT 감지 — K-Intent로 전달 전환' +
      (kIntentMatch[1] ? '' : ' (⚠️ 태그 형식 이탈 — userText로 폴백)'));
    await _updateBubble(_stripInternalTags(fullReply));
    history.length = 0;
    await _forwardSwitchSP(_loadKIntentSP, 'K-Intent');
    await _watchdogSendFn('AC-to-KIntent')(`[INTERNAL: AC→K-Intent 위임 — 사용자에게 보이지 않는 내부 신호입니다. ` +
      `다음 발화를 목표로 구조화하세요: "${forwardQuery}"]`);
    return true;
  }

  // ── K-Intent → K-Compose (forward) ──
  const kComposeMatch = fullReply.match(/\[HANDOFF_TO_KCOMPOSE:([^\]]*)\]/);
  if (kComposeMatch) {
    console.log('[Orchestration] HANDOFF_TO_KCOMPOSE 감지 — K-Compose로 전달 전환');
    await _updateBubble(_stripInternalTags(fullReply));
    history.length = 0;
    CFG._kcomposeHandoffRetried = false; // 2026-08-06 신설 — 아래 프로토콜 가드용, 새 K-Compose 세션마다 초기화
    await _forwardSwitchSP(_loadKComposeSP, 'K-Compose');
    await _watchdogSendFn('KIntent-to-KCompose')(`[INTERNAL: K-Intent→K-Compose 위임 — 아래 목표를 이어받아 진행하세요: ${kComposeMatch[1].trim()}]`);
    return true;
  }

  // ── K-Compose → K-Execute (forward, 2026-07-16 신설 — 5단계 확장) ──
  // 2026-08-06 수정 — plan={steps:[...]} 중첩 배열 때문에 단순 정규식
  // ([^\]]*)이 배열 안쪽 첫 ]에서 잘리던 버그를 _extractBracketTag로 수정
  // (라이브 재검증 실사 확인 — K-Execute가 받는 project_brief 자체가
  // 반토막이었고, 화면에 원시 JSON 잔여물이 노출됐다).
  const kExecuteBody = _extractBracketTag(fullReply, 'HANDOFF_TO_KEXECUTE');
  if (kExecuteBody !== null) {
    console.log('[Orchestration] HANDOFF_TO_KEXECUTE 감지 — K-Execute로 전달 전환');
    await _updateBubble(_stripInternalTags(fullReply));
    history.length = 0;
    await _forwardSwitchSP(_loadKExecuteSP, 'K-Execute');
    await _watchdogSendFn('KCompose-to-KExecute')(`[INTERNAL: K-Compose→K-Execute 위임 — 아래 계획을 이어받아 실행하세요: ${kExecuteBody.trim()}]`);
    return true;
  }

  // ── [PROJECT_STATE_SAVE: ...] — mode=project human_action 일시정지
  // 시 PDV에 진행상태 기록(2026-07-17 신설, SP-22 v1.1 STEP1-PROJECT).
  // ★ forward가 아니다 — 같은 K-Execute 응답 안에 이 태그와
  // [HANDOFF_TO_KDELIVER]가 함께 나오므로, 여기서 return true 하지
  // 않고 저장만 한 뒤 아래 kDeliverMatch 처리로 계속 흘러가게 둔다.
  // 2026-08-06 수정 — remaining_steps/fan_out_targets 등 중첩 배열 때문에
  // 단순 정규식([^\]]*)이 배열 안쪽 첫 ]에서 raw 자체를 반토막 내던 버그
  // 수정(HANDOFF_TO_KEXECUTE와 같은 계열, 같은 실사에서 함께 확인).
  const projectStateSaveBody = _extractBracketTag(fullReply, 'PROJECT_STATE_SAVE');
  if (projectStateSaveBody !== null) {
    try {
      const raw = projectStateSaveBody;
      const pick = (key) => {
        const m = raw.match(new RegExp(key + '=("[^"]*"|\\{[\\s\\S]*?\\}(?=,\\s*\\w+=|$)|[^,}]*)'));
        return m ? m[1].replace(/^"|"$/g, '') : null;
      };
      await _saveProjectState({
        project_id: pick('project_id'),
        goal: pick('goal'),
        status: pick('status') || 'awaiting_human_action',
        paused_at_seq: Number(pick('paused_at_seq')) || null,
        human_action_desc: pick('human_action_desc') || '',
        // 2026-07-17 신설(사고실험 결함 1) — project_brief를 저장 안
        // 하면 재개 시 K-Execute가 남은 step의 세부 맥락을 잃는다.
        // SP가 다른 자유서술 필드(issue/proposed_patch 등)와 동일하게
        // 따옴표로 감싸 낼 것을 전제로 pick()의 "[^"]*" 분기를 탄다.
        project_brief: pick('project_brief') || '',
        // remaining_steps/fan_out_targets/results_so_far는 중첩 객체라
        // 위 단순 정규식으로 안전히 못 뗀다 — JSON 본문 전체를 다시
        // 안전 파싱 시도, 실패하면 빈 배열로 둔다(과도한 파싱 실패보다
        // 안전, 재개 시 K-Execute가 부족분을 다시 물어볼 수 있다).
        remaining_steps: _safeParseJsonField(raw, 'remaining_steps'),
        fan_out_targets: _safeParseJsonField(raw, 'fan_out_targets'),
        results_so_far: _safeParseJsonField(raw, 'results_so_far'),
      });
    } catch (e) {
      console.warn('[ProjectState] PROJECT_STATE_SAVE 처리 실패(무시):', e.message);
    }
    // return true 하지 않음 — 계속 진행
  }

  // ── [SELF_UPDATE_PROPOSAL: ...] — SP 자기 갱신 제안 (2026-07-17
  // 신설, RULE-03: K-Intent v1.3/K-Compose v1.7/K-Deliver v1.3/
  // K-Report v1.1). ★ 이것도 forward가 아니다 — 사이드이펙트로 저장만
  // 하고, 원래 이 SP가 하려던 처리(HANDOFF_TO_KCOMPOSE 등)는 같은
  // 응답 안에서 그대로 계속 진행된다. 자동 승인은 없다 — pending_
  // review로 쌓일 뿐, 이 SP의 다음 동작에 어떤 영향도 주지 않는다.
  const selfUpdateMatch = fullReply.match(/\[SELF_UPDATE_PROPOSAL:([^\]]*)\]/);
  if (selfUpdateMatch) {
    try {
      const raw = selfUpdateMatch[1];
      const pick = (key) => {
        const m = raw.match(new RegExp(key + '=("[^"]*"|[^,\\]]*)'));
        return m ? m[1].replace(/^"|"$/g, '') : null;
      };
      await _proposeSpUpdate({
        sp_id: pick('sp_id'),
        current_version: pick('current_version'),
        trigger: pick('trigger') || 'self_noticed_gap',
        issue: pick('issue'),
        proposed_patch: pick('proposed_patch'),
        confidence: pick('confidence') || 'medium',
        protected_sections_touched: pick('protected_sections_touched') === 'Y',
      });
    } catch (e) {
      console.warn('[SelfUpdate] SELF_UPDATE_PROPOSAL 처리 실패(무시):', e.message);
    }
    // return true 하지 않음 — 계속 진행
  }

  // ── [USER_FEEDBACK: ...] — 사용자 개선 제안 능동 획득 (2026-07-17
  // 신설, docs/user_feedback_mechanism_proposal_v1.md). RULE-03과
  // 동일 원칙: 사이드이펙트일 뿐이라 원래 이 SP가 하려던 처리를 막지
  // 않는다. 태그 자체는 AGENT-COMMON/profile-assistant 등 여러 SP가
  // 낼 수 있다 — 이 핸들러는 그중 하나만 신경 쓰면 된다(어느 SP가
  // 냈는지는 context_sp 파라미터로 구분).
  const userFeedbackMatch = fullReply.match(/\[USER_FEEDBACK:\s*([^\]]*)\]/);
  if (userFeedbackMatch) {
    try {
      const raw = userFeedbackMatch[1];
      const pick = (key) => {
        const m = raw.match(new RegExp(key + '=("[^"]*"|[^,\\]]*)'));
        return m ? m[1].replace(/^"|"$/g, '') : null;
      };
      await _submitUserFeedback({
        raw_text: pick('raw') || userText || '',
        context_sp: pick('context_sp') || CFG.system?.slice(0, 60) || null,
        context_summary: pick('context_summary') || '',
        category: pick('category') || 'question',
      });
      // 능동 요청 빈도 제한 — 같은 기기에서 최근 7일 이내 이미 물어봤으면
      // AC/PA 프롬프트에도 그 사실을 알려 다시 캐묻지 않게 한다. 서버
      // 왕복 없이 localStorage만으로 충분(사람 하나당 기기 하나 기준의
      // 느슨한 제한이라 정밀할 필요 없음).
      localStorage.setItem('hondi_feedback_last_asked_at', new Date().toISOString());
    } catch (e) {
      console.warn('[UserFeedback] USER_FEEDBACK 처리 실패(무시):', e.message);
    }
    // return true 하지 않음 — 계속 진행
  }

  // ── AC → K-Execute 직접 재호출 (재개, 2026-07-17 신설) ──
  // K-Intent/K-Compose를 다시 거치지 않는다 — 계획은 이미 확정돼 있다.
  // 재개 판별 자체(이 발화가 재개인지)는 AC(AGENT-COMMON §0-H [재개
  // 판별])가 이미 끝낸 뒤 이 태그를 낸다 — 여기서는 그대로 전달만 한다.
  const resumeMatch = fullReply.match(/\[RESUME_KEXECUTE:([^\]]*)\]/);
  if (resumeMatch) {
    console.log('[Orchestration] RESUME_KEXECUTE 감지 — K-Execute로 직접 전달');
    await _updateBubble(_stripInternalTags(fullReply));
    history.length = 0;
    await _forwardSwitchSP(_loadKExecuteSP, 'K-Execute');
    await _watchdogSendFn('AC-to-KExecute-resume')(`[INTERNAL: AC→K-Execute 재개 위임 — 아래 저장된 project_state부터 이어서 실행하세요: ${resumeMatch[1].trim()}]`);
    return true;
  }

  // ── K-Execute → K-Deliver (forward) — 기존 K-Compose→K-Deliver와
  // 같은 태그를 K-Execute도 낸다(무료 이관 경로는 K-Compose가 여전히
  // 직접 냄, 아래 kDeliverMatch가 양쪽 다 받는다). ──
  const kDeliverBody = _extractBracketTag(fullReply, 'HANDOFF_TO_KDELIVER');
  if (kDeliverBody !== null) {
    console.log('[Orchestration] HANDOFF_TO_KDELIVER 감지 — K-Deliver로 전달 전환');
    await _updateBubble(_stripInternalTags(fullReply));
    history.length = 0;
    await _forwardSwitchSP(_loadKDeliverSP, 'K-Deliver');
    await _watchdogSendFn('to-KDeliver')(`[INTERNAL: →K-Deliver 위임 — 아래 결과를 정리해 제출하세요: ${kDeliverBody.trim()}]`);
    return true;
  }

  // ── K-Deliver → K-Report (forward, 2026-07-16 신설 — 5단계 확장) ──
  const kReportMatch = fullReply.match(/\[HANDOFF_TO_KREPORT:([^\]]*)\]/);
  if (kReportMatch) {
    console.log('[Orchestration] HANDOFF_TO_KREPORT 감지 — K-Report로 전달 전환');
    await _updateBubble(_stripInternalTags(fullReply));
    history.length = 0;
    await _forwardSwitchSP(_loadKReportSP, 'K-Report');
    await _watchdogSendFn('KDeliver-to-KReport')(`[INTERNAL: K-Deliver→K-Report 위임 — 아래 결과에 대한 이해당사자 통지/신고를 처리하세요: ${kReportMatch[1].trim()}]`);
    return true;
  }

  // ── K-Search 위임 — 두 갈래(§0-F 최상위 vs K-Compose 중첩) ──
  // 기존 [KSEARCH_HANDOFF]는 AC 전용으로 설계됐었지만(§0-F), K-Compose도
  // 동일 태그를 재사용한다(RULE-06 그대로). AC에서 나올 때는 forward
  // (K-Search 완료 후 AC로 안 돌아가고 K-Search가 직접 이용자와 계속
  // 주고받다가 필요시 결과만 통보), K-Compose에서 나올 때는 반드시
  // K-Compose로 복귀해야 하므로 push를 쓴다 — 현재 활성 SP가 K-Compose
  // 인지 여부로 분기한다.
  const kSearchMatch = fullReply.match(/\[KSEARCH_HANDOFF:\s*query=([^\]]+)\]/);
  if (kSearchMatch && CFG.system?.includes('K-Compose')) {
    console.log('[Orchestration] K-Compose 내부 KSEARCH_HANDOFF 감지 — 위임(push) 전환');
    await _updateBubble(_stripInternalTags(fullReply));
    history.length = 0;
    await _pushAndSwitchSP(_loadKSearchSP, 'K-Search');
    await _watchdogSendFn('KCompose-to-KSearch')(`[INTERNAL: K-Compose→K-Search 위임 — 조회 후 결과를 반환하세요: ${kSearchMatch[1].trim()}]`);
    return true;
  }
  if (kSearchMatch) {
    // 2026-07-09 신설 — §0-F가 오래전부터 문서화하고 있었지만 실제
    // 로더·전환 로직이 없어 AC가 이 태그를 내도 아무 일도 안 일어나던
    // 공백을 해소한다(최상위 경로, K-Compose를 거치지 않은 AC 자체
    // 판단). forward 전환 — K-Search가 이후 이용자와 직접 주고받다가
    // 필요할 때만 AC로 돌아온다(아래 "K-Search 최상위 결과 반환" 참조).
    console.log('[Orchestration] AC 최상위 KSEARCH_HANDOFF 감지 — K-Search로 전달 전환');
    await _updateBubble(_stripInternalTags(fullReply));
    history.length = 0;
    await _forwardSwitchSP(_loadKSearchSP, 'K-Search');
    await _watchdogSendFn('AC-to-KSearch')(`[INTERNAL: AC→K-Search 위임 — 사용자에게 보이지 않는 내부 신호입니다. ` +
      `다음 발화를 그대로 이어받아 대상을 특정하세요: "${kSearchMatch[1].trim()}"]`);
    return true;
  }

  // ── K-Bank/K-Telecom/K-Estate 위임 — 2026-07-12 신설 ──
  // K-Search와 동일한 시스템 전환형("모든 SP가 별도 저장소가 필요한
  // 것은 아니다" — 주피터님 지적으로 재설계). 셋 다 "최종 실행은
  // 본인 몫, AI는 정보수집·안내까지만"이라 새 탭이나 별도 도메인 없이
  // 이 세션 안에서 시스템 프롬프트만 바꾸는 것으로 충분하다. 하나의
  // 정규식으로 세 태그를 함께 매칭 — 로더는 SWITCH_SP_LOADERS에서
  // 조회(새 서비스 추가 시 이 배열에 한 줄만 추가하면 됨).
  // ── K-Bank/K-Telecom/K-Estate/K-Plan/K-Watch/K-Job 위임 — 2026-07-12
  // 신설, 2026-09-02 K-Plan/K-Watch/K-Job 추가 ──
  // K-Search와 동일한 시스템 전환형("모든 SP가 별도 저장소가 필요한
  // 것은 아니다" — 주피터님 지적으로 재설계). 하나의 정규식으로 여섯
  // 태그를 함께 매칭 — 로더는 SWITCH_SP_LOADERS에서 조회(새 서비스
  // 추가 시 이 배열에 한 줄만 추가하면 됨).
  const switchMatch = fullReply.match(/\[CALL_(KBANK|KTELECOM|KESTATE|KPLAN|KWATCH|KJOB):\s*query=([^\]]+)\]/);
  if (switchMatch) {
    const svcId = switchMatch[1].toLowerCase();
    const loader = SWITCH_SP_LOADERS[svcId];
    const label = { kbank: 'K-Bank', ktelecom: 'K-Telecom', kestate: 'K-Estate', kplan: 'K-Plan', kwatch: 'K-Watch', kjob: 'K-Job' }[svcId];
    if (loader) {
      console.log(`[Orchestration] AC 최상위 CALL_${switchMatch[1]} 감지 — ${label}로 전달 전환`);
      await _updateBubble(_stripInternalTags(fullReply));
      history.length = 0;
      await _forwardSwitchSP(loader, label);
      await _watchdogSendFn('AC-to-EXPERT')(`[INTERNAL: AC→${label} 위임 — 사용자에게 보이지 않는 내부 신호입니다. ` +
        `다음 발화를 그대로 이어받아 상담을 시작하세요: "${switchMatch[2].trim()}"]`);
      return true;
    }
  }

  // ── K-Compose/K-Execute 내부에서의 중첩 위임(nested) — EXPERT scope=orchestration_subtask ──
  // 2026-08-06 수정 — 라이브 재검증 실사로 두 가지 확인:
  // (1) K-Compose뿐 아니라 K-Execute도 같은 패턴으로 EXPERT 서브태스크
  //     위임을 낸다(SP-22도 이 태그를 재사용) — 기존엔 CFG.system이
  //     K-Compose일 때만 이 핸들러가 반응해서, K-Execute 단계에서 나온
  //     동일 태그는 어디서도 안 걸려 원시 텍스트로 그대로 노출됐다.
  // (2) 모델이 첫 인자를 위치 인자(id,)가 아니라 키=값(personaId=id,)
  //     형태로 내는 경우가 있었다 — 기존 정규식은 이것도 못 잡았다.
  // 둘 다 허용하도록 정규식과 게이트 조건을 넓힌다.
  const kExpertSubtaskMatch = fullReply.match(
    /\[EXPERT:\s*(?:personaId=)?([\w-]+),\s*scope=orchestration_subtask,\s*question=([^\]]+)\]/i);
  if (kExpertSubtaskMatch && (CFG.system?.includes('K-Compose') || CFG.system?.includes('K-Execute'))) {
    console.log(`[Orchestration] ${CFG.system?.includes('K-Compose') ? 'K-Compose' : 'K-Execute'} 내부 EXPERT(scope=orchestration_subtask) 감지 — 위임(push) 전환`);
    await _updateBubble(_stripInternalTags(fullReply));
    history.length = 0;
    const personaId = kExpertSubtaskMatch[1];
    // 2026-08-06 수정 — 라이브 재검증 중 실사로 발견: resolveExpertId가
    // 실패해도 (기존 코드처럼) loaderFn 내부에서 조용히 null을 반환하면
    // _pushAndSwitchSP는 "위임 전환 실패(무시)"로 넘어가고 CFG.system은
    // K-Compose에 그대로 남는데, 그 직후 무조건 전송되는 아래
    // watchdogSendFn 메시지("EXPERT로 위임됨 — ORCHESTRATION_SUBTASK_RESULT
    // 형식으로만 답하라")가 실제로는 K-Compose 자신에게 전달돼 맥락에
    // 안 맞는 지시를 받고, 같은 STEP을 반복하는 원인이 됐다(2026-08-06
    // 실사, K-Compose가 존재하지 않는 'kfam' ID를 지어낸 사례). 존재
    // 여부를 먼저 확인해 갈라서, 실패하면 K-Compose에게 정확히 무엇이
    // 틀렸는지와 대체 ID를 돌려줘 스스로 정정하게 한다 — 침묵 대신
    // 명시적 피드백 루프. getExpertGwpDef/.systemPromptLoader 관련
    // 함정은 2026-07-09에 이미 한 차례 정리됐다(아래는 getExpertDef +
    // expert-session.js의 _composeExpertPrompt() 재사용, 그대로 유지).
    const resolvedId = resolveExpertId(personaId);
    const def = resolvedId ? getExpertDef(resolvedId) : null;
    if (!def) {
      console.warn(`[Orchestration] EXPERT:${personaId} 위임 대상 없음 — K-Compose에 정정 요청`);
      await _watchdogSendFn('KCompose-EXPERT-not-found')(`[INTERNAL: EXPERT 위임 실패 — '${personaId}'는 카탈로그에 등록되지 않은 ` +
        `전문가 ID입니다(존재하지 않는 이름을 지어내지 마세요). 가족관계·민사 등록 관련 적합성 확인이 필요하면 ` +
        `'lawyer'(변호사)를 쓰세요. 그 외 분야는 실제 등록된 카탈로그 ID만 사용하고, 확실하지 않으면 EXPERT 위임 없이 ` +
        `바로 STEP 4(HANDOFF_TO_KEXECUTE)로 진행하세요.]`);
      return true;
    }
    await _pushAndSwitchSP(async () => _composeExpertPrompt(def), `EXPERT:${personaId}`);
    await _watchdogSendFn('KCompose-to-EXPERT-subtask')(`[INTERNAL: K-Compose→EXPERT(${personaId}) 위임(scope=orchestration_subtask) — ` +
      `STEP 0-(-1)을 따라 전체 파이프라인을 생략하고 다음 질문에만 짧게 답하세요: ` +
      `${kExpertSubtaskMatch[2].trim()} 답변은 [ORCHESTRATION_SUBTASK_RESULT: verdict=..., ` +
      `confidence=..., needs_full_consultation=...] 형식으로만 출력하세요.]`);
    return true;
  }

  // ── 중첩 위임 완료 → 스택 복귀(pop) ──
  // K-Search·EXPERT(scope=orchestration_subtask) 세션이 각자의 결과 태그를
  // 냈을 때, K-Compose로 정확히 복귀한다. 스택이 비어 있으면(=K-Compose를
  // 거치지 않고 AC가 직접 K-Search를 부른 최상위 경로) 아래 "K-Search
  // 최상위 결과 반환" 블록이 대신 처리한다.
  const subtaskResultMatch = fullReply.match(/\[ORCHESTRATION_SUBTASK_RESULT:([^\]]*)\]/);
  const kSearchResultMatch = fullReply.match(/\[KSEARCH_RESULT:([^\]]*)\]/);
  const kSearchHandoffBackMatch = fullReply.match(/\[KSEARCH_HANDOFF_BACK:\s*reason=(\w+)\]/);
  if ((subtaskResultMatch || kSearchResultMatch) && CFG.systemStack?.length > 0) {
    console.log('[Orchestration] 중첩 위임 결과 감지 — K-Compose로 스택 복귀(pop)');
    await _updateBubble(_stripInternalTags(fullReply));
    const resultPayload = (subtaskResultMatch || kSearchResultMatch)[1].trim();
    history.length = 0;
    await _popSP();
    await _watchdogSendFn('delegation-result')(`[INTERNAL: 위임 결과 수신 — 다음 결과를 이어받아 진행하세요: ${resultPayload}]`);
    return true;
  }

  // ── K-Search 최상위 결과 반환 — AC로 forward 복귀 (2026-07-09 신설) ──
  // §0-F: "K-Search가 대상을 확정하면 [KSEARCH_RESULT: ...]로 나에게
  // 돌아옵니다" / "[KSEARCH_HANDOFF_BACK: reason=...]으로 즉시 돌려보내면
  // 그 사유대로 처리합니다". 스택이 비어 있다는 건 AC가 직접 부른
  // 최상위 호출이었다는 뜻이므로(K-Compose 경유였다면 위에서 이미 pop
  // 처리됨), K-Search를 다시 쓸 일이 없어 forward로 AC에 되돌린다.
  if ((kSearchResultMatch || kSearchHandoffBackMatch) && CFG.system?.includes('K-Search')
      && !(CFG.systemStack?.length > 0)) {
    console.log('[Orchestration] AC 최상위 K-Search 결과/반환 감지 — AC로 전달 전환');
    await _updateBubble(_stripInternalTags(fullReply));
    history.length = 0;
    await _forwardSwitchSP(_loadAgentCommonSP, 'AGENT-COMMON');
    const payload = kSearchResultMatch ? kSearchResultMatch[1].trim()
      : `reason=${kSearchHandoffBackMatch[1]}`;
    await _watchdogSendFn('KSearch-result')(`[INTERNAL: K-Search 결과 수신 — §TAGS의 [KSEARCH_HANDOFF] 항목에 ` +
      `정리된 결과 처리 지침(institution/person/matched_list/not_found/insufficient별 ` +
      `분기)에 따라 처리하세요: ${payload}]`);
    return true;
  }
  // [KSEARCH_CLARIFY]/[KSEARCH_CANDIDATES]는 여기서 가로채지 않는다 —
  // §0-F: "K-Search가 되묻거나 후보를 제시하는 동안은 나를 거치지 않고
  // K-Search가 직접 이용자와 주고받습니다". 즉 이 두 태그는 전환을
  // 유발하지 않고, 그냥 K-Search 자신의 자연스러운 응답으로 흘러간다
  // (_stripInternalTags가 대괄호 원문만 감춘다).

  // ── K-Deliver → AC (완료, 스택 pop) ──
  const orchestrationCompleteMatch = fullReply.match(/\[ORCHESTRATION_COMPLETE:([^\]]*)\]/);
  if (orchestrationCompleteMatch) {
    console.log('[Orchestration] ORCHESTRATION_COMPLETE 감지 — AC로 복귀');
    await _updateBubble(_stripInternalTags(fullReply));
    history.length = 0;
    await _popSP(); // 스택에 AC가 남아 있으면 정확히 그 자리로, 없으면 폴백으로 AC 로드
    await _watchdogSendFn('orchestration-complete')(`[INTERNAL: 오케스트레이션 완료 — 다음 결과를 이용자에게 자연스럽게 ` +
      `전달하고, pdv_note가 있으면 §2 형식으로 PDV_STORE에 기록하세요: ${orchestrationCompleteMatch[1].trim()}]`);
    return true;
  }

  // ── 어느 단계에서든 즉시 AC로 반환 (응급·순환참조·단일서비스충분 등) ──
  // ── K-Deliver → AC (mode=project 일시정지, v1.2 신설) ──
  // 일반 handoffBackMatch(아래, 원래는 emergency 전용 폴백)와 달리
  // userText를 재전송하지 않는다 — 원래 발화를 다시 보내면 AC가 이미
  // K-Deliver가 전달한 요약/pending_user_action을 다시 처리하는 게
  // 아니라 원래 발화를 새 요청처럼 재처리할 위험이 있다. 대신 K-Deliver
  // 가 낸 태그 내용을 그대로 넘겨 AC가 이용자에게 전달하고 PDV 기록
  // (§4-1, AC 전속)까지 하게 한다 — ORCHESTRATION_COMPLETE와 동일한
  // 패턴, reason만 다르다.
  const projectPausedMatch = fullReply.match(/\[ORCHESTRATION_HANDOFF_BACK:\s*reason=project_paused\]/);
  if (projectPausedMatch) {
    console.log('[Orchestration] ORCHESTRATION_HANDOFF_BACK(reason=project_paused) 감지 — AC로 복귀');
    await _updateBubble(_stripInternalTags(fullReply));
    history.length = 0;
    CFG.systemStack = [];
    await _switchToAssistantSP();
    await _watchdogSendFn('mode-project-paused')(`[INTERNAL: mode=project가 human_action에서 일시정지됨 — 방금 K-Deliver가 ` +
      `전달한 요약과 pending_user_action을 이용자에게 자연스럽게 전달하고, "프로젝트 일시정지: ` +
      `{project_id}, {human_action_desc}"로 §4-1 PDV 기록을 남기세요(project_state 자체는 ` +
      `K-Execute가 이미 PDV에 저장했으므로 여기서는 일반 6하원칙 로그만 남기면 된다).]`);
    return true;
  }

  // ★ 2026-08-03 신설 — 코드 강제 화이트리스트. 프롬프트 경고문으로
  // reason 값을 지어내지 말라고 두 차례(2026-08-03) 타일렀는데도 실사
  // 재검증에서 매번 새로운 값을 지어냈다(reason=multi-step_bereavement_
  // process 등, 하이픈 포함이라 기존 \w+ 정규식에 아예 안 걸리기까지
  // 했다 — 아래 정규식도 [\w-]+로 함께 넓힘). 자연어 설득의 한계가
  // 명확해, 실제 SP 5개(K-Intent/K-Compose/K-Deliver/K-Execute/
  // K-Report) 전체에서 선언한 값만 화이트리스트로 못박는다 — 목록
  // 밖이면 누가 냈든(AC든 하위 SP든) 무조건 무시하고 폴백한다.
  const VALID_ORCHESTRATION_HANDOFF_BACK_REASONS = new Set([
    'emergency',            // 전 SP 공통
    'project_paused',       // K-Deliver(SP-21) — 위에서 별도 처리됨
    'unclear_after_2_tries',// K-Intent(SP-19) 전용
    'circular_reference',   // K-Compose(SP-20) 전용
    'goal_not_composable',  // K-Compose(SP-20) 전용
  ]);

  const handoffBackMatch = fullReply.match(/\[ORCHESTRATION_HANDOFF_BACK:\s*reason=([\w-]+)\]/);
  if (handoffBackMatch) {
    if (!VALID_ORCHESTRATION_HANDOFF_BACK_REASONS.has(handoffBackMatch[1])) {
      console.warn(`[Orchestration] 화이트리스트에 없는 reason 값(${handoffBackMatch[1]}) — 지어낸 값으로 간주, 무시하고 다른 태그 처리로 폴백`);
      return false;
    }
    // ★ 2026-08-03 긴급 수정 — 실사(K-Intent 트리거 검증 시나리오 10건,
    // live smoketest)로 확인된 오용 패턴: 이 태그는 K-Compose/K-Search가
    // 진행 중인 오케스트레이션을 AC로 되돌릴 때만 의미가 있는데, AC
    // 자신(최상위, 애초에 되돌아갈 곳이 없음)이 이 태그를 대신 내는
    // 사례가 10건 중 3건 관찰됐다(요양원 문의에 reason=emergency를
    // 내는 등 — CALL_KINTENT를 냈어야 할 자리에 잘못 냄). 가드 없이
    // 그대로 처리하면 history가 지워지고 같은 userText가 AC에게 그대로
    // 재전송돼(아래) 같은 오태그가 반복될 위험(루프)이 있고, 같은
    // 응답에 함께 있었을 수 있는 [GWP:] 태그도(위 함수가 true를
    // 반환하면 _parseAgentTags가 아예 실행되지 않으므로) 통째로
    // 유실된다(실사례: 반려견 등록 시나리오에서 [GWP: khealth]가
    // 이렇게 유실됨). 위 화이트리스트 검증을 통과한(=값 자체는 진짜
    // 5개 중 하나인) 경우에도, AC-PRO-CORE 본체가 활성 상태(§0. 정체성
    // 마커, 4305행과 동일 판별법)라면 여전히 문맥상 오용이다 — "값은
    // 유효하지만 지금 이 화자가 낼 상황이 아님"을 이 두 번째 가드가
    // 잡는다.
    if (CFG.system?.includes('§0. 정체성')) {
      console.warn(`[Orchestration] AC 최상위에서 ORCHESTRATION_HANDOFF_BACK(reason=${handoffBackMatch[1]}) 오용 감지 — 무시하고 다른 태그 처리로 폴백`);
      return false;
    }
    console.log(`[Orchestration] ORCHESTRATION_HANDOFF_BACK(reason=${handoffBackMatch[1]}) 감지 — AC로 즉시 반환`);
    await _updateBubble(_stripInternalTags(fullReply));
    history.length = 0;
    CFG.systemStack = []; // ★ 응급 등 비정상 종료 시 스택을 통째로 비운다 —
    // 중첩이 몇 겹이든 즉시 AC로 뛰어나와야 한다(§0-G, 예외 없음). 순서대로
    // pop하며 복귀하지 않는 것이 의도적이다 — 응급 상황에서 "원래 있던 자리"
    // 로 차례차례 돌아가는 것보다 AC로 즉시 뛰는 게 항상 안전하다.
    await _switchToAssistantSP();
    if (handoffBackMatch[1] === 'emergency' && userText) {
      await _watchdogSendFn('handoff-back-emergency')(userText); // 응급 신호가 담긴 원래 발화를 AC가 다시 보게 함
    } else if (userText) {
      await _watchdogSendFn('handoff-back')(userText);
    }
    return true;
  }

  // ★ 2026-08-06 신설 — K-Compose 프로토콜 강제 가드 ★
  // K-Compose는 계획을 세우는 게 끝이 아니라 반드시 [HANDOFF_TO_KEXECUTE]
  // (실행 필요) 또는 [HANDOFF_TO_KDELIVER](실행 불필요)로 넘겨야 완결된다
  // (SP-20 STEP4/§5). 그런데 여기까지 왔다는 건 이번 fullReply가 위의
  // 어떤 알려진 태그와도 안 걸렸다는 뜻 — 지금까지는 이 경우 그냥 false를
  // 반환해 fullReply가 평범한 채팅 답변인 것처럼 화면에 그대로 뿌려졌다.
  // 실사 재검증(2026-08-06)에서 EXPERT 위임 실패 후 K-Compose가 계획만
  // 세워놓고 HANDOFF 없이 안내문으로 응답을 끝내버리는 사례가 발견됐는데,
  // 이게 바로 "혼디가 정보 안내만 하고 실행은 안 하는 FAQ 봇처럼 보이는"
  // 근본 원인이었다(사용자 지적, 2026-08-06) — steps/atom_id/org_id까지
  // 다 준비해놓고 K-Execute를 못 불러 실행 이관이 조용히 실패한 것.
  // 1회에 한해 정정 요청을 보내고, 그래도 반복되면(모델이 계속 규칙을
  // 못 지키면) 무한루프 방지를 위해 사용자에게 실패를 있는 그대로
  // 알리고 AC로 안전 복귀시킨다 — "성공한 것처럼 보이는 미완료 응답"을
  // 침묵 속에 화면에 내보내는 것보다 훨씬 안전하다.
  if (CFG.system?.includes('K-Compose')) {
    // 2026-09-12 신설(주피터 지시 — 실사 원인 조사 결과) — SP-20 STEP 2
    // (적합성 확인 결과 안내)·STEP 3(무료/유료 선택 게이트) 등은 설계상
    // 정상적으로 사용자 응답을 기다리며 멈춰야 하는 지점이다. 지금까지
    // 이 가드는 HANDOFF_TO_KEXECUTE/KDELIVER가 없으면 이유를 구분하지
    // 않고 전부 "위반"으로 판정해, 정상적인 되묻기까지 재시도·AC 강제
    // 복귀 대상이 됐다(실사 재현, 2026-09-12 — 헤드리스 스모크테스트로
    // 처음 확인됐으나, 이 가드 자체가 2026-08-06에 만들어진 이유였던
    // 실사용 사례와 근본 원인이 같다). SP-20에 신설한
    // [KCOMPOSE_AWAIT_USER: reason=...] 태그가 있으면 정상 대기로
    // 인정하고 일반 응답과 동일하게 처리한다(아래로 폴스루 —
    // _stripInternalTags가 태그 자체는 화면에서 지운다).
    if (fullReply.includes('[KCOMPOSE_AWAIT_USER:')) {
      CFG._kcomposeHandoffRetried = false;
      return false;
    }
    if (!CFG._kcomposeHandoffRetried) {
      console.warn('[Orchestration] ⚠️ K-Compose 프로토콜 위반 감지 — HANDOFF_TO_KEXECUTE/KDELIVER 없이 응답 종료. 1회 정정 요청.');
      CFG._kcomposeHandoffRetried = true;
      await _updateBubble(_stripInternalTags(fullReply));
      history.push({ role: 'assistant', content: fullReply });
      await _watchdogSendFn('KCompose-protocol-violation')(`[INTERNAL: 방금 응답이 [HANDOFF_TO_KEXECUTE]나 [HANDOFF_TO_KDELIVER] 없이 끝났습니다 — ` +
        `이는 규칙 위반입니다(STEP4/§5). steps가 준비됐다면 반드시 [HANDOFF_TO_KEXECUTE: goal=..., plan={steps:[...]}]를, ` +
        `실행이 필요 없는 단순 안내라면 [HANDOFF_TO_KDELIVER: goal=..., results={...}]를 내야 합니다. ` +
        `지금 바로 정확한 형식으로 다시 응답하세요.]`);
      return true;
    }
    console.warn('[Orchestration] ⚠️ K-Compose 프로토콜 위반 재발 — 무한루프 방지를 위해 AC로 안전 복귀');
    CFG._kcomposeHandoffRetried = false;
    await _updateBubble(_stripInternalTags(fullReply) +
      '\n\n(⚠️ 절차 실행 준비 중 내부 오류가 발생해 여기서 중단했습니다. 방금 요청을 다시 말씀해 주시면 처음부터 다시 시도하겠습니다.)');
    history.length = 0;
    CFG.systemStack = [];
    await _switchToAssistantSP();
    return true;
  }

  return false;
}

/**
 * _switchToAssistantSP — AGENT-COMMON SP를 CFG.system_base / CFG.system에 적용
 * PROFILE_SUBMIT 또는 PROFILE_SKIP 직후 호출됩니다.
 * history가 비워진 상태이므로 다음 callAI 호출 시 새 system이 history[0]으로 삽입됩니다.
 */
async function _switchToAssistantSP() {
  try {
    if (!CFG.system_base || CFG.system_base.includes('나만의 AI 비서')) {
      // system_base가 아직 PA SP이거나 미로드 상태 → AGENT-COMMON manifest 키로 재로드
      CFG.system_base = await _loadAgentCommonSP();
    }
    CFG.system = CFG.system_base;
    // 설정 저장 (다음 페이지 로드 시 복원)
    try {
      const cfg = JSON.parse(localStorage.getItem('gopang_cfg') || '{}');
      cfg.system = CFG.system;
      cfg.system_base = CFG.system_base;
      localStorage.setItem('gopang_cfg', JSON.stringify(cfg));
    } catch {}
    console.log('[Profile] AGENT-COMMON SP로 전환 완료');
  } catch (e) {
    console.warn('[Profile] SP 전환 실패 (무시):', e.message);
  }
}

/**
 * _switchToProfileAssistantSP — profile-assistant SP를 CFG.system_base /
 * CFG.system에 적용 (2026-07-08 신설, §0-E). AGENT-COMMON이
 * [CALL_PROFILE_ASSISTANT]를 출력한 직후 호출됩니다. _switchToAssistantSP()의
 * 반대 방향 — 구조는 동일(system_base/system 교체 + localStorage 저장),
 * 대상만 다르다.
 *
 * ※ 2026-07-27 — 현재 미사용(unused). [CALL_PROFILE_ASSISTANT]가
 *   2026-07-11에 [GWP: profile-assistant] 새 탭 방식으로 대체되며 이
 *   함수를 부르던 유일한 호출부(_handleProfileTags)도 방어적 경고만
 *   남기도록 바뀌었다. 삭제하지 않고 남겨둔 이유: 같은 창 전환이라는
 *   메커니즘 자체는(대상 SP만 다를 뿐) 여전히 유효한 패턴이라 나중에
 *   다른 용도로 재사용될 수 있고, 히스토리 추적용으로도 남겨둔다.
 */
async function _switchToProfileAssistantSP() {
  try {
    CFG.system_base = await _loadProfileAssistantSP();
    if (!CFG.system_base) throw new Error('profile-assistant SP 로드 결과 비어있음');
    CFG.system = CFG.system_base;
    try {
      const cfg = JSON.parse(localStorage.getItem('gopang_cfg') || '{}');
      cfg.system = CFG.system;
      cfg.system_base = CFG.system_base;
      localStorage.setItem('gopang_cfg', JSON.stringify(cfg));
    } catch {}
    console.log('[Profile] profile-assistant SP로 전환 완료');
  } catch (e) {
    console.warn('[Profile] profile-assistant SP 전환 실패 (무시):', e.message);
  }
}

/**
 * _triggerProfileAssistantHandoff — AC→profile-assistant 전환 직후, 사용자
 * 입력 없이 내부 인계 신호를 한 번 보내 profile-assistant가 곧바로
 * PHASE 0부터 이어가도록 한다(2026-07-08 신설). _triggerSeamlessHandoff와
 * 대칭 구조(반대 방향) — AC는 이미 프로필 작성 취지를 설명하고 동의를
 * 받은 뒤이므로, profile-assistant는 재인사하지 않고 바로 시작해야 한다.
 *
 * ※ 2026-07-27 — 현재 미사용(unused). 위 _switchToProfileAssistantSP()와
 *   동일한 사유로 호출부가 제거됐다 — 참고: 같은 역할(재인사 없이 곧장
 *   시작)은 이제 pages/profile-assistant.html의 startGreeting()이
 *   [INTERNAL: ...] 신호로 직접 수행한다(새 탭 방식이라 여기서 sendFn을
 *   대신 호출해줄 필요가 없어짐).
 */
async function _triggerProfileAssistantHandoff(sendFn = callAI) {
  try {
    // ★ 2026-07-11 수정: 튜토리얼 대본이 AC에서 profile-assistant로
    // 이관됐다(§0-1-T 삭제, PHASE -1 신설). AC는 튜토리얼 완료 여부를
    // 모르니(그 상태는 hondi_tutorial_done에 있고 §0-1-T가 없어져
    // AC가 더 이상 참조하지 않음), 여기 클라이언트 코드가 대신 확인해
    // 인계 신호에 명시적으로 적어준다.
    let tutDone = false;
    try { tutDone = localStorage.getItem('hondi_tutorial_done') === '1'; } catch {}
    const handoff = tutDone
      ? `[INTERNAL: AGENT-COMMON→profile-assistant 인계 — 사용자에게 ` +
        `보이지 않는 내부 신호입니다. AC가 이미 프로필 작성 취지를 설명했고 ` +
        `사용자가 방금 동의했습니다. 앱 사용법 튜토리얼은 이미 완료된 ` +
        `상태입니다 — 재인사하지 말고, [CONTEXT]를 읽어 PHASE 0 분기부터 ` +
        `자연스럽게 이어서 시작하세요.]`
      : `[INTERNAL: AGENT-COMMON→profile-assistant 인계(튜토리얼부터) — ` +
        `사용자에게 보이지 않는 내부 신호입니다. AC가 이미 첫 인사를 ` +
        `마쳤고 사용자가 방금 준비됐다고 답했습니다. 재인사하지 말고, ` +
        `PHASE -1(앱 사용법 튜토리얼) STEP 0부터 곧바로 시작하세요.]`;
    await sendFn(handoff);
  } catch (e) {
    console.warn('[Profile] profile-assistant 핸드오프 트리거 실패(무시 — 다음 사용자 메시지에서 정상 처리됨):', e.message);
  }
}

/**
 * _triggerProfileContinue — NAME_CAPTURED 직후, SP를 바꾸지 않은 채(여전히 PA SP)
 * "PHASE 0의 1~3 평가를 계속해서 PHASE 1로 이어가라"는 내부 신호를 한 번 더
 * 보낸다. _triggerSeamlessHandoff와 달리 _switchToAssistantSP를 호출하지
 * 않는다 — 아직 온보딩 중이므로 system은 PA SP 그대로 유지돼야 한다.
 */
async function _triggerProfileContinue(sendFn = callAI) {
  try {
    const handoff = `[INTERNAL: 방금 이름짓기(P0-NAME-CAPTURE)에 응답했습니다. 사용자에게 ` +
      `보이지 않는 내부 신호입니다 — 다시 인사하지 말고, PHASE 0의 1~3 평가를 이어서 ` +
      `진행해 해당하는 PHASE로 자연스럽게 이어가세요(예: step=0이면 PHASE 1-INTRO부터 시작).]`;
    await sendFn(handoff);
  } catch (e) {
    console.warn('[Profile] PHASE 1 자동 이어가기 트리거 실패(무시 — 다음 사용자 메시지에서 정상 처리됨):', e.message);
  }
}

/**
 * _triggerSeamlessHandoff — PA→AGENT-COMMON 전환을 사용자가 체감하지 못하게,
 * 사용자 입력 없이 즉시 AGENT-COMMON의 "인계 안착 인사"를 한 번 트리거합니다(v1.3).
 *
 * _switchToAssistantSP() 직후 callAI()를 내부적으로 한 번 더 호출해, 같은 흐름
 * 안에서 AGENT-COMMON이 자연스럽게 이어 말하도록 만듭니다. 사용자에게는 AI
 * 말풍선 두 개가 끊김 없이 이어지는 것처럼 보입니다(중간에 사용자 입력 불필요).
 *
 * 이 시점에 hondi_assistant_name이 있으면 AGENT-COMMON에게 그 이름을 직접
 * 알려줍니다 — PA가 이름을 AGENT-COMMON에 전달하는 통로가 바로 이 메시지입니다.
 * (보조 수단으로 _buildEnhancedUserContent의 "이름:" 컨텍스트도 매 턴 동봉됨 —
 * 새로고침으로 history가 끊겨도 이름이 유지되도록.)
 */
async function _triggerSeamlessHandoff(sendFn = callAI) {
  try {
    const assistantName = localStorage.getItem('hondi_assistant_name') || '';
    const handoff = assistantName
      ? `[INTERNAL: 그림자 AI 인계 — 사용자가 이 비서를 "${assistantName}"이라고 부르기로 ` +
        `했습니다. 이후 자기 자신을 "${assistantName}"으로 칭하세요. 사용자에게 보이지 ` +
        `않는 내부 신호입니다 — 새로 인사·자기소개하지 말고, 자연스럽게 이어서 짧게 ` +
        `한두 문장만 안착 인사를 건네세요.]`
      : `[INTERNAL: 그림자 AI 인계 — 사용자에게 보이지 않는 내부 신호입니다. 새로 ` +
        `인사·자기소개하지 말고, 자연스럽게 이어서 짧게 한두 문장만 안착 인사를 건네세요.]`;
    await sendFn(handoff);
  } catch (e) {
    console.warn('[Profile] 인계 안착 인사 트리거 실패(무시 — 다음 사용자 메시지에서 정상 처리됨):', e.message);
  }
}

/**
 * _handleSPAuthorTags — [SP_DRAFT_REQUEST]/[GOV_SP_DRAFT_REQUEST]/[ESCALATE]
 * 태그를 worker.js /sp-author/* 엔드포인트로 실제 배선한다(2026-07-11 신설).
 *
 * 지금까지 이 세 태그는 "아직 미처리(Phase 2~5 예정)"로 남아 있어 AC(§3-0)나
 * K-Compose(STEP 4-A)가 태그를 내도 대괄호만 strip되고 아무 일도 일어나지
 * 않았다 — SP-Author로 가는 신호가 전부 유실되던 상태. _handleOrchestrationTags
 * 와 달리 특정 SP(K-Compose/K-Deliver)로 게이트하지 않는다 — AGENT-COMMON
 * 본인도 §3-0 ③에서 [SP_DRAFT_REQUEST]를 직접 낼 수 있기 때문이다.
 *
 * SP-Author 자체(실제 조사·작성)는 여전히 사람이 수행한다 — 이 함수는
 * "신호가 큐/알림에 정직하게 남는다"까지만 보장한다.
 */
/**
 * _handleKSearchExecutionTag — K-Search(SP-18) RULE-02 STEP3의
 * [SEARCH]{...}[/SEARCH](JSON 본문) 태그를 실제로 실행한다(2026-07-11
 * Phase 1 신설, 파이프라인 사고실험 미비점1).
 *
 * ★ 이 태그는 기존 [SEARCH: query=X, type=user](P2P 사람검색 UI 오버레이,
 * openSearch() 처리)와 이름만 같고 문법이 완전히 다르다 — 이쪽은 JSON
 * 본문이고, worker.js POST /search(handleSearch)를 호출해 결과를
 * history에 재주입하고 sendFn으로 재귀 호출한다. market/webapp.html의
 * 이미 검증된(사고실험 11회) "[SEARCH] 감지→RPC→재주입→재귀호출" 패턴을
 * gopang 공용 모듈로 이식한 것 — 로직을 새로 설계하지 않았다.
 *
 * K-Search가 시스템으로 활성화된 상태(§0-F [KSEARCH_HANDOFF] 이후, 또는
 * K-Compose 내부 위임 이후)에서만 의미가 있으므로, 호출부(§9 파서)에서
 * CFG.system?.includes('K-Search')로 게이트하는 걸 전제로 한다 — 이
 * 함수 자체는 게이트하지 않고 태그 존재 여부만 본다(호출부 책임).
 */
/**
 * _handleWebSearchTag — §0-B 경로1(공개정보: tool-web-search)과 K-Search
 * RULE-07(대체형, [WEB_SEARCH: query=...])의 실제 실행부(2026-07-11 신설).
 *
 * 지금까지 "웹검색 경로"는 AGENT-COMMON·K-Search SP에 원칙 서술만
 * 있고 실행 수단이 없었다(callDeepSeek에 tool-calling 자체가 없음 —
 * 이번 세션 사고실험으로 확인) — 이 함수가 그 실행 수단이다.
 * worker.js POST /web-search(Serper.dev 프록시, 캐시+일일예산 통제)를
 * 호출하고 결과를 history에 재주입한다. K-Search든 AC 자신이든 이
 * 태그를 낼 수 있으므로 특정 system으로 게이트하지 않는다.
 */
// ── C50(관제탑 원칙) [NEXT_STEP:] 태그 강제 — 이 파일에는 없음 ─────
// (2026-08-06 정정) 이 자리에 있던 _enforceNextStepMarker()는
// isExpertActive()(항상 false — expert-session.js 아카이브 참조)로
// 가드돼 있어 한 번도 실행될 수 없는 죽은 코드였다. 실제 EXPERT
// 페르소나 대화는 이 파일(그림자 AI 스레드)이 아니라
// pages/expert-chat.html에서 벌어지므로, 강제 로직도 그쪽으로
// 옮겼다(_maybeEnforceNextStep, expert-session.js의
// _missingNextStepMarker 재사용). ★ 2026-08-06 추가 확인(CONTROL-
// TOWER-PRINCIPLE 신설 검토 중) — [NEXT_STEP:] 태그 자체가 K-Execute/
// K-Deliver SP 본문에서 요구된 적이 없고 _stripInternalTags도 이
// 태그를 걸러내지 않는다. K-Execute/K-Deliver 쪽 코드 강제는 태그
// 요구 없이 구조를 직접 보는 별도 메커니즘(_violatesConversationalStyle/
// _enforceConversationalStyle)이 담당한다 — 아래(모듈 하단)에 정의.

// ── 재무제표(fs) 실시간 조회 (2026-07-13 신설) ──────────────
// GDC 시스템 소속 데이터라 프로필에 스냅샷으로 저장하지 않는다 —
// 필요할 때마다 wallet.getFinancialState()(로컬 IndexedDB, 네트워크
// 불필요)로 그때그때 조회한다. _handleWebSearchTag와 동일한 "태그 →
// 조회 → 재주입 → 재호출" 패턴.
export async function _handleBalanceCheckTag(fullReply, bubble, sendFn = callAI, userText = '') {
  if (!fullReply.includes('[BALANCE_CHECK]')) return false;

  const _updateBubble = async (text) => {
    if (!bubble) return;
    const { _updateStreamBubble: _usb } = await import('../ui/bubble.js').catch(() => ({}));
    if (_usb) _usb(bubble, text);
  };
  await _updateBubble(_stripInternalTags(fullReply).replace('[BALANCE_CHECK]', '\n재무 상태 확인 중…'));
  history.push({ role: 'assistant', content: fullReply });

  let resultText;
  try {
    const wallet = window.gopangWallet;
    if (!wallet?.getFinancialState) {
      resultText = '재무 상태 조회 불가(지갑 미준비)';
    } else {
      const fs = await wallet.getFinancialState();
      resultText = JSON.stringify(fs);
    }
  } catch (e) {
    resultText = `조회 오류: ${e.message}`;
  }

  const inject =
    `[재무제표 조회 결과 — GDC 시스템 실시간 데이터] ${resultText}\n\n` +
    `이 정보는 본인에게 답변할 때만 사용하십시오. 프로필의 공개 필드로 ` +
    `저장하거나(PARTIAL_SAVE·PROFILE_SUBMIT 등) 제3자에게 노출하지 마십시오 ` +
    `— 재무제표는 항상 비공개입니다.`;
  history.push({ role: 'user', content: inject });

  await sendFn(inject);
  return true;
}

export async function _handleWebSearchTag(fullReply, bubble, sendFn = callAI, userText = '') {
  const m = fullReply.match(/\[WEB_SEARCH:\s*query=([^\]]+)\]/);
  if (!m) return false;
  const query = m[1].trim();

  const _updateBubble = async (text) => {
    if (!bubble) return;
    const { _updateStreamBubble: _usb } = await import('../ui/bubble.js').catch(() => ({}));
    if (_usb) _usb(bubble, text);
  };
  await _updateBubble(_stripInternalTags(fullReply).replace(/\[WEB_SEARCH:[^\]]*\]/, '\n웹 검색 중…'));
  history.push({ role: 'assistant', content: fullReply });

  const base = (CFG.endpoint || '').replace(/\/+$/, '');
  let resultText;
  try {
    const res = await fetch(`${base}/web-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // 429(일일예산 초과)·503(키 미설정) 등도 조용히 감추지 않고
      // 사용자에게 정직하게 전달할 수 있도록 그대로 넘긴다.
      resultText = `검색 불가: ${data.message || data.error || `HTTP ${res.status}`}`;
    } else {
      const parts = [];
      if (data.answer_box) parts.push(`[요약] ${data.answer_box.title}: ${data.answer_box.snippet}`);
      if (data.knowledge_graph) parts.push(`[정보] ${data.knowledge_graph.title} — ${data.knowledge_graph.description}`);
      (data.organic || []).forEach((r, i) => {
        parts.push(`${i + 1}. ${r.title} — ${r.snippet} (${r.link})`);
      });
      resultText = parts.length > 0 ? parts.join('\n') : '검색 결과 없음';
    }
  } catch (e) {
    resultText = `검색 오류: ${e.message}`;
  }

  // RULE-07 [7-A] 대체형 — Hondi 검증 필드(guid 등)와 구분해 "웹 참고정보"
  // 임을 명시하고, K-Search가 [KSEARCH_RESULT: status=external_info_only,
  // source=..., info=...] 형식으로 위임자에게 반환하도록 안내한다.
  const searchInject =
    `[웹 검색결과 — 미검증, 출처: 웹] ${resultText}\n\n` +
    `이 정보는 Hondi 내부에서 검증된 게 아닙니다(guid 없음). ` +
    `K-Search RULE-07 [7-A] 대체형에 따라 이용자에게는 "Hondi에 등록된 ` +
    `업체가 아니라 웹 검색 결과"임을 분명히 밝히고, [KSEARCH_RESULT: ` +
    `status=external_info_only, source=웹검색, info=...] 형식으로 ` +
    `위임자에게 반환하세요.`;
  history.push({ role: 'user', content: searchInject });

  await sendFn(searchInject);
  return true;
}


export async function _handleKSearchExecutionTag(fullReply, bubble, sendFn = callAI, userText = '') {
  const m = fullReply.match(/\[SEARCH\](.+?)\[\/SEARCH\]/s);
  if (!m) return false;

  let params;
  try {
    params = JSON.parse(m[1].trim());
  } catch (e) {
    // 태그는 있는데 JSON이 깨진 경우 — RULE-01 금지-8(존재하지 않는
    // 필드를 지어내지 않는다) 정신에 따라 조용히 넘기지 않고 정직하게
    // 재질의를 유도한다.
    await sendFn(`[SEARCH 결과] {"error":"태그 본문 JSON 파싱 실패 — RULE-02 STEP3 형식을 다시 확인하세요: ${e.message}"}`);
    return true;
  }

  const _updateBubble = async (text) => {
    if (!bubble) return;
    const { _updateStreamBubble: _usb } = await import('../ui/bubble.js').catch(() => ({}));
    if (_usb) _usb(bubble, text);
  };
  await _updateBubble(_stripInternalTags(fullReply).replace(/\[SEARCH\][\s\S]*?\[\/SEARCH\]/, '\n검색 중…'));
  history.push({ role: 'assistant', content: fullReply });

  const base = (CFG.endpoint || '').replace(/\/+$/, '');
  let resultText;
  try {
    const res = await fetch(`${base}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // worker.js handleSearch가 q/p_* 필드를 그대로 정규화 — SP가 안 보낸
      // p_lat/p_lng은 이용자 GPS로 보정(주소 문자열은 Kakao region depth
      // 불일치로 신뢰 불가할 수 있어, market/webapp.html의 검증된 보정
      // 로직과 동일 원칙 — 2026-07-12 추가).
      body: JSON.stringify({
        p_lat: _userLocation?.lat ?? null,
        p_lng: _userLocation?.lng ?? null,
        ...params,
      }),
    });
    if (!res.ok) {
      resultText = `검색 실패 (HTTP ${res.status})`;
    } else {
      const rows = await res.json();
      resultText = (Array.isArray(rows) && rows.length > 0)
        ? rows.map((r, i) => {
            const svc = r.services?.[0] || '';
            const price = svc ? ` | ${svc}` : '';
            const gdc = r.gdc_accepted ? ' | GDC' : ' | GDC 미지원';
            const trust = r.trust_level ? ` | ${r.trust_level}` : '';
            const rating = r.rating_avg ? ` | ★${r.rating_avg}` : '';
            const handleStr = r.handle ? ` [handle:${r.handle}]` : '';
            // ★ 2026-07-12: entity_type 추가 — STEP4가 person/institution/
            // product_seller 구분을 매칭 근거로 쓰는데(SP-18 STEP4), 이
            // 필드가 빠져 있으면 사람/기관 검색 시 판단 근거가 부족해진다.
            const etype = r.entity_type ? ` [type:${r.entity_type}]` : '';
            const provisional = r.provisional ? ' [미청구/provisional]' : '';
            return `${i + 1}. ${r.name} (${r.address || ''})${etype}${provisional}${price}${rating}${trust}${gdc}${handleStr} [guid:${r.primary_guid}]`;
          }).join('\n')
        : '검색 결과 없음';
    }
  } catch (e) {
    resultText = `검색 오류: ${e.message}`;
  }

  // RULE-02 STEP4/5 — 후보 평가는 K-Search 자신(다음 턴)의 몫이다. 여기서는
  // 결과만 정직하게 넘긴다(임의로 후보를 만들어내지 않음 — RULE-01 금지-2).
  const searchInject =
    `[검색결과] ${resultText}\n\n` +
    `위 결과만 근거로 STEP4(후보 평가·확정)를 진행하세요. 결과가 없으면 ` +
    `주소 범위를 넓혀 1회 재검색하거나(STEP3-C), person/institution이면 RULE-03으로, ` +
    `product_seller면 대안 제안으로 넘어가세요 — 없는 후보를 지어내지 마세요.`;
  history.push({ role: 'user', content: searchInject });

  await sendFn(searchInject);
  return true;
}


/**
 * _handleCreateUnclaimedProfileTag — K-Search(SP-18) STEP3의 실제 배선.
 * (2026-07-12 신설)
 *
 * K-Search가 STEP1(웹검색으로 대상 정보 수집)·STEP2(이용자에게 "이 업체가
 * 맞습니까?" 확인) 를 마친 뒤, 원안(profile-assistant 대화형 위임)을
 * 단순화해 이 태그 하나로 /profile POST(claim_status=unclaimed)까지
 * 직행한다 — 이미 STEP1~2에서 확인이 끝난 필드를 다시 여러 턴에 걸쳐
 * 되묻을 이유가 없기 때문(설계 변경 근거는 worker.js
 * _handleUnclaimedProfilePost 상단 주석과 동일).
 *
 * [CREATE_UNCLAIMED_PROFILE]{"entity_type":"business","name":"...","address":"...",...}[/CREATE_UNCLAIMED_PROFILE]
 *
 * CFG.system?.includes('K-Search') 게이트를 건다 — 다른 SP가 우연히
 * 같은 이름의 태그를 다른 용도로 낼 위험을 차단(기존 _handleKSearchExecutionTag와
 * 동일한 원칙, call-ai.js 2865행 참고).
 */
export async function _handleCreateUnclaimedProfileTag(fullReply, bubble, sendFn = callAI, userText = '') {
  const m = fullReply.match(/\[CREATE_UNCLAIMED_PROFILE\](.+?)\[\/CREATE_UNCLAIMED_PROFILE\]/s);
  if (!m) return false;

  let params;
  try {
    params = JSON.parse(m[1].trim());
  } catch (e) {
    await sendFn(`[CREATE_UNCLAIMED_PROFILE 결과] {"error":"태그 본문 JSON 파싱 실패: ${e.message}"}`);
    return true;
  }

  const _updateBubble = async (text) => {
    if (!bubble) return;
    const { _updateStreamBubble: _usb } = await import('../ui/bubble.js').catch(() => ({}));
    if (_usb) _usb(bubble, text);
  };
  await _updateBubble(_stripInternalTags(fullReply).replace(/\[CREATE_UNCLAIMED_PROFILE\][\s\S]*?\[\/CREATE_UNCLAIMED_PROFILE\]/, '\n등록 중…'));
  history.push({ role: 'assistant', content: fullReply });

  const base = (CFG.endpoint || '').replace(/\/+$/, '');
  let resultText;
  try {
    const res = await fetch(`${base}/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, claim_status: 'unclaimed' }),
    });
    const payload = await res.json().catch(() => ({}));
    resultText = res.ok
      ? JSON.stringify(payload)
      : `등록 실패 (HTTP ${res.status}): ${JSON.stringify(payload)}`;
  } catch (e) {
    resultText = `등록 오류: ${e.message}`;
  }

  const inject =
    `[CREATE_UNCLAIMED_PROFILE 결과] ${resultText}\n\n` +
    `성공했다면 이 guid로 [KSEARCH_RESULT: status=matched, confidence=provisional, ...]를 ` +
    `구성하고, 이용자에게 "정식 가입자가 아니라 검색으로 확인한 정보"라는 점을 반드시 함께 안내하세요.`;
  history.push({ role: 'user', content: inject });

  await sendFn(inject);
  return true;
}


export async function _handleSPAuthorTags(fullReply, bubble, sendFn = callAI, userText = '') {
  const _updateBubble = async (text) => {
    if (!bubble) return;
    const { _updateStreamBubble: _usb } = await import('../ui/bubble.js').catch(() => ({}));
    if (_usb) _usb(bubble, text);
  };
  const base = (CFG.endpoint || '').replace(/\/+$/, '');

  // [GWP_REGISTRY_SEARCH: q=..., category=..., tier=...] — K-Compose
  // v1.2 STEP 4-A. GOV_SP_DRAFT_REQUEST보다 먼저 확인해야 하므로 이
  // 함수 안에서도 가장 먼저 매칭한다 — gwp-registry.js(core 21개)에
  // 없다고 바로 "생태계에 없다"고 단정하지 않고, SP-Author가 이미
  // 승인해둔 확장 레지스트리(gwp_registry)를 먼저 재확인한다.
  const searchMatch = fullReply.match(/\[GWP_REGISTRY_SEARCH:([\s\S]*?)\]/);
  if (searchMatch) {
    const body = searchMatch[1];
    const get = (field) => {
      const m = body.match(new RegExp(`${field}=([^,\\]]+)`));
      return m ? m[1].trim() : '';
    };
    console.log('[gwp-registry] GWP_REGISTRY_SEARCH 감지 — 확장 레지스트리 검색');
    await _updateBubble(_stripInternalTags(fullReply));
    history.push({ role: 'assistant', content: fullReply });
    let resultText;
    try {
      const qs = new URLSearchParams();
      if (get('q')) qs.set('q', get('q'));
      if (get('category')) qs.set('category', get('category'));
      if (get('tier')) qs.set('tier', get('tier'));
      const res = await fetch(`${base}/gwp-registry/search?${qs.toString()}`);
      resultText = res.ok ? JSON.stringify(await res.json()) : `{"error":"HTTP ${res.status}"}`;
    } catch (e) {
      resultText = `{"error":"${e.message}"}`;
    }
    await sendFn(`[GWP_REGISTRY_SEARCH 결과] ${resultText}\n\n결과가 있으면 그 gwp_id로 STEP 4를 이어가고(match_score 재평가), 없으면 매칭 실패 처리로 진행하세요.`, null, null, resolveOrchestrationModel('GWP_REGISTRY_SEARCH_RESULT'));
    return true;
  }

  // [GOV_SP_DRAFT_REQUEST: institution=..., task=..., tier_hint=...,
  //  source_conversation=...] — K-Compose STEP 4-A 매칭 실패 또는 AC가
  // 직접 정부·공공기관 공백을 발견했을 때.
  const govMatch = fullReply.match(/\[GOV_SP_DRAFT_REQUEST:([\s\S]*?)\]/);
  if (govMatch) {
    const body = govMatch[1];
    const get = (field) => {
      const m = body.match(new RegExp(`${field}=([^,\\]]+)`));
      return m ? m[1].trim() : '';
    };
    console.log('[SP-Author] GOV_SP_DRAFT_REQUEST 감지 — 큐잉 요청');
    await _updateBubble(_stripInternalTags(fullReply));
    history.push({ role: 'assistant', content: fullReply });
    // ★ 2026-07-11 추가(실사로 확인된 문제): 기존엔 큐잉 결과를 [GOV_SP_
    // DRAFT_REQUEST 결과] 태그로 모델에게만 돌려주고, 그걸 모델이 다음
    // 턴에서 잘 narration해주길 기대했다 — 근데 그 두 번째 턴이 사용자
    // 눈에 안 보이거나(매우 짧게 지나가거나), 모델이 결과를 그냥 침묵
    // 처리하면 사용자는 "초안 작성을 요청해 두겠습니다"라는 말만 보고
    // 실제로 등록됐는지 알 길이 없었다. Claude가 도구 호출 진행상황을
    // 보여주듯, 여기서도 사실관계(등록 성공/실패)는 모델의 서술 품질에
    // 기대지 않고 별도의 눈에 보이는 상태 말풍선으로 직접 보장한다.
    // ★ 2026-07-29 null-safe화 — appendBubble()은 #message-list가 없는
    // 컨텍스트(예: webapp.html의 AI 패널, #ai-panel-messages 사용)에서는
    // 조용히 undefined를 반환한다(bubble.js §설계). 여기서 그 반환값을
    // 바로 .textContent에 대입하면 TypeError로 함수 전체가 죽어, 뒤이은
    // sendFn() 호출(사용자에게 결과를 알려주는 부분)까지 함께 유실된다 —
    // 진행 말풍선은 "있으면 갱신, 없으면 생략"으로 처리하고, 큐잉 자체
    // (네트워크 호출)는 DOM과 무관하게 항상 끝까지 실행되도록 분리한다.
    const _progBubble = appendBubble('ai', '⏳ SP 초안 작성 요청을 서버에 등록하는 중…');
    let resultText, _queueOk = false, _queueId = '';
    try {
      const res = await fetch(`${base}/sp-author/queue`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_type: 'create',
          signal_source: CFG.system?.includes('K-Compose') ? 'kcompose_match_fail' : 'realtime_ac',
          institution: get('institution'),
          task: get('task'),
          tier_hint: get('tier_hint'),
          source_conversation: get('source_conversation') || userText,
          priority: 'normal',
        }),
      });
      const data = await res.json().catch(() => ({ status: res.status }));
      resultText = JSON.stringify(data);
      _queueOk = res.ok && !data.error;
      _queueId = data.id || data.request_id || '';
    } catch (e) {
      resultText = `{"error":"${e.message}"}`;
    }
    if (_progBubble) {
      _progBubble.textContent = _queueOk
        ? `✅ SP 초안 작성 요청이 등록됐습니다${_queueId ? ` (요청 ID: ${_queueId})` : ''} — 검토·승인 후 이용하실 수 있어요.`
        : `⚠️ SP 초안 작성 요청 등록에 실패했습니다. 잠시 후 다시 시도해 주세요.`;
    }
    await sendFn(`[GOV_SP_DRAFT_REQUEST 결과] ${resultText}`, null, null, resolveOrchestrationModel('GOV_SP_DRAFT_REQUEST_RESULT'));
    return true;
  }

  // [SP_DRAFT_REQUEST: domain=..., request=..., suggested_slug=...] —
  // AGENT-COMMON §3-0 ③(완전히 새로운 서비스 카테고리, 정부기관이 아닌 경우).
  const draftMatch = fullReply.match(/\[SP_DRAFT_REQUEST:([\s\S]*?)\]/);
  if (draftMatch) {
    const body = draftMatch[1];
    const get = (field) => {
      const m = body.match(new RegExp(`${field}=([^,\\]]+)`));
      return m ? m[1].trim() : '';
    };
    console.log('[SP-Author] SP_DRAFT_REQUEST 감지 — 큐잉 요청');
    await _updateBubble(_stripInternalTags(fullReply));
    history.push({ role: 'assistant', content: fullReply });
    // ★ 2026-07-11 추가 — 위 GOV_SP_DRAFT_REQUEST와 동일한 이유로 진행
    // 상태를 모델 서술에만 맡기지 않고 별도 말풍선으로 직접 보장한다.
    // ★ 2026-07-29 null-safe화 — 위 GOV_SP_DRAFT_REQUEST 분기와 동일한
    // 이유(appendBubble()이 #message-list 없는 컨텍스트에서 undefined
    // 반환)로 방어한다.
    const _progBubble = appendBubble('ai', '⏳ SP 초안 작성 요청을 서버에 등록하는 중…');
    let resultText, _queueOk = false, _queueId = '';
    try {
      const res = await fetch(`${base}/sp-author/queue`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_type: 'create',
          signal_source: 'realtime_ac',
          institution: get('suggested_slug') || get('domain'),
          task: get('request') || get('domain'),
          source_conversation: userText,
          // ★ 2026-07-29 수정 — AC-PRO-CORE §DRAFT_REQUEST(2026-07-28
          // 신설)가 이미 태그에 risk_tier={low|high}를 실어 보내고
          // 있었는데, 여기서 파싱만 하고 서버로 전달하지 않아 worker.js의
          // risk_tier 화이트리스트 판정(risk_tier==='low'일 때만 '사후
          // 보고'로 취급, 그 외 전부 안전하게 'high')이 항상 기본값
          // 'high'로만 떨어지던 버그. get('risk_tier')를 그대로 전달한다
          // — 화이트리스트 검증은 worker.js가 이미 하고 있으므로 여기선
          // 그대로 넘기기만 하면 된다.
          risk_tier: get('risk_tier'),
          priority: 'normal',
        }),
      });
      const data = await res.json().catch(() => ({ status: res.status }));
      resultText = JSON.stringify(data);
      _queueOk = res.ok && !data.error;
      _queueId = data.id || data.request_id || '';
    } catch (e) {
      resultText = `{"error":"${e.message}"}`;
    }
    if (_progBubble) {
      _progBubble.textContent = _queueOk
        ? `✅ SP 초안 작성 요청이 등록됐습니다${_queueId ? ` (요청 ID: ${_queueId})` : ''} — 검토·승인 후 이용하실 수 있어요.`
        : `⚠️ SP 초안 작성 요청 등록에 실패했습니다. 잠시 후 다시 시도해 주세요.`;
    }
    await sendFn(`[SP_DRAFT_REQUEST 결과] ${resultText}`, null, null, resolveOrchestrationModel('SP_DRAFT_REQUEST_RESULT'));
    return true;
  }

  // [SP_INDUSTRY_TRANSFORM_GENERATE_REQUEST: schema_id=...] — 2026-07-23
  // 신설. profile-assistant STEP3C가 TIER3 규제업종이 아닌데 SP-INDUSTRY-
  // TRANSFORM-{schema_id}가 아직 없을 때 낸다. 위 SP_DRAFT_REQUEST와
  // 성격이 다르다 — 저건 "큐에 등록하고 사람이 나중에 작성"이고, 이건
  // "지금 바로 AI가 생성하고 검증 통과하면 즉시 활성화, 사후에 사람이
  // 검토"다(HUMAN-AUTHORITY-GATE-SCHEMA의 사전 승인 원칙을 위험 업종
  // 밖에서는 완화한 것 — 주피터님 2026-07-23 지시).
  const itGenMatch = fullReply.match(/\[SP_INDUSTRY_TRANSFORM_GENERATE_REQUEST:([\s\S]*?)\]/);
  if (itGenMatch) {
    const body = itGenMatch[1];
    const get = (field) => {
      const m = body.match(new RegExp(`${field}=([^,\\]]+)`));
      return m ? m[1].trim() : '';
    };
    const schemaId = get('schema_id');
    console.log('[SP-INDUSTRY-TRANSFORM] 실시간 생성 요청 감지:', schemaId);
    await _updateBubble(_stripInternalTags(fullReply));
    history.push({ role: 'assistant', content: fullReply });
    // 생성은 시간이 걸릴 수 있어(웹검색 왕복 포함) 응답을 기다리지 않고
    // 백그라운드로 던진다 — 프로필 작성 대화 자체는 계속 진행돼야 한다
    // (STEP3C 설계상 이 태그 다음 곧바로 STEP4로 넘어가므로, 여기서
    // await로 막으면 그 설계 의도와 어긋난다).
    fetch(`${base}/sp-industry-transform/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schema_id: schemaId,
        // triggered_by_profile_guid는 감사 추적용 optional 필드라, 정확한
        // 필드명이 CFG에 있는지 확인 못 했다(guid 관련 필드는 registration
        // context의 ctx.guid만 확인됨, CFG 레벨엔 없어 보임) — 없으면 빈
        // 문자열로 안전하게 넘어간다. 정확한 필드가 있으면 나중에 바꿔도 됨.
        triggered_by_profile_guid: (CFG?.principalGuid || ''),
      }),
    }).catch((e) => console.warn('[SP-INDUSTRY-TRANSFORM] 백그라운드 생성 요청 실패:', e.message));
    // 사용자에게 보이는 흐름은 막지 않으므로 별도 결과 말풍선 없이
    // 곧바로 다음 턴(STEP4)으로 넘어간다 — SP_DRAFT_REQUEST처럼 진행
    // 상태 말풍선을 띄우지 않는 이유: 어차피 "지금 만들고 있다"는 안내는
    // STEP3C 프롬프트 자체가 이미 사용자 응답으로 냈고, 이 이후엔 조용히
    // 백그라운드에서 끝난다(성공하든 실패하든 사업자 대화에 재개입하지
    // 않음 — 다음 프로필 편집 시점에 반영 여부가 자연스럽게 드러남).
    return false; // 대화 흐름을 여기서 끊지 않음(STEP4로 자연 진행)
  }

  // [ESCALATE: to=..., reason=..., summary=...] — 응급이 아닌 일반 에스컬레이션
  // (응급은 §0-G가 별도 경로로 처리 — 이 핸들러는 SP-Author/검토 알림 용도).
  const escMatch = fullReply.match(/\[ESCALATE:([\s\S]*?)\]/);
  if (escMatch) {
    const body = escMatch[1];
    const get = (field) => {
      const m = body.match(new RegExp(`${field}=([^,\\]]+)`));
      return m ? m[1].trim() : '';
    };
    console.log('[SP-Author] ESCALATE 감지 — 알림 생성');
    await _updateBubble(_stripInternalTags(fullReply));
    history.push({ role: 'assistant', content: fullReply });
    let resultText;
    try {
      const res = await fetch(`${base}/sp-author/escalate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: get('to') || '@owner',
          reason: get('reason') || 'other',
          summary: get('summary') || userText,
        }),
      });
      resultText = JSON.stringify(await res.json().catch(() => ({ status: res.status })));
    } catch (e) {
      resultText = `{"error":"${e.message}"}`;
    }
    await sendFn(`[ESCALATE 결과] ${resultText}`, null, null, resolveOrchestrationModel('ESCALATE_RESULT'));
    return true;
  }

  return false;
}

// ── GOV_TASK 태그 처리 (2026-07-12 신설) ──
// K-Compose/K-Deliver 게이트 없이 어느 SP에서든(kgov/SP-10 활성화된
// 대화에서만 실제 출력되는 태그라 게이트 불필요) 처리한다 —
// _handleSPAuthorTags 바로 다음 위치.
export async function _handleGovTaskTags(fullReply, bubble, sendFn = callAI, userText = '', trace = []) {
  const _updateBubble = async (text) => {
    if (!bubble) return;
    const { _updateStreamBubble: _usb } = await import('../ui/bubble.js').catch(() => ({}));
    if (_usb) _usb(bubble, text);
  };

  // ── GOV_TASK_SCHEMA_LOOKUP (2026-08-13 신설 — 혼디 패스포트 IDV 연동) ──
  // kgov(§REQUIRED-DOCUMENTS 2단계)가 이미 등록된 agency:task_key를
  // 인식했을 때 사용자에게 서류를 요구하기 전에 먼저 이 태그를 낸다.
  // 새 서버 엔드포인트를 만들지 않고 기존 /gov/task/schema/lookup
  // (worker.js handleGovTaskSchemaLookup, 2026-07-30 구현됐으나 지금까지
  // 어떤 클라이언트도 호출한 적 없던 dead code)을 그대로 재사용한다.
  // 응답의 schema.documents[]에서 acquisition:'gov24' && idv_type이 있는
  // 항목만 로컬 IDV(gopang_idv_vault)에서 findFreshCredential()로 조회 —
  // 브라우저 로컬 조회이므로 credentialSubject 원본은 이 함수 밖으로도,
  // 서버로도 나가지 않는다("서버는 평문을 못 읽는다" 원칙 그대로 유지).
  const govTaskSchemaLookupMatch = fullReply.match(
    /\[GOV_TASK_SCHEMA_LOOKUP\]([\s\S]*?)\[\/GOV_TASK_SCHEMA_LOOKUP\]/);
  if (govTaskSchemaLookupMatch) {
    console.log('[GovTask] GOV_TASK_SCHEMA_LOOKUP 감지 — /gov/task/schema/lookup 호출 + 로컬 IDV 조회');
    await _updateBubble(_stripInternalTags(fullReply));
    let payload = null;
    try {
      payload = JSON.parse(govTaskSchemaLookupMatch[1].trim());
    } catch (e) {
      await sendFn(`[INTERNAL: GOV_TASK_SCHEMA_LOOKUP의 JSON 파싱 실패(${e.message}) — ` +
        `IDV 조회 없이 기존 §REQUIRED-DOCUMENTS 2단계(정부24 안내)로 바로 진행하세요.]`);
      return true;
    }
    const base = (CFG.endpoint || '').replace(/\/+$/, '');
    try {
      const res  = await fetch(`${base}/gov/task/schema/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, guid: _USER?.ipv6 || USER_GUID || null }),
      });
      const data = await res.json().catch(() => null);
      if (!data?.found) {
        await sendFn(`[INTERNAL: GOV_TASK_SCHEMA_LOOKUP 결과 — 레지스트리에 없음(found:false). ` +
          `§REQUIRED-DOCUMENTS 3단계(웹검색 후 GOV_TASK_DRAFT_REQUEST)로 진행하세요.]`);
        return true;
      }

      // acquisition:'gov24' && idv_type이 있는 문서만 로컬 IDV 조회 대상.
      const gov24Docs = (data.schema?.documents || []).filter(d => d.acquisition === 'gov24' && d.idv_type);
      const matched = [];
      for (const doc of gov24Docs) {
        try {
          const cred = await findFreshCredential(doc.idv_type, doc.max_age_days ?? null);
          if (cred) {
            matched.push({
              doc_id: doc.id, idv_type: doc.idv_type,
              issuanceDate: cred.issuanceDate, issuer_name: cred.issuer?.name || null,
              contentHash: cred._contentHash || null,
              verificationTier: cred._verificationTier || 'signature_verified',
              // 2026-08-13 추가 — 사용자가 저장 시 idv_type을 잘못 골랐을
              // 가능성(오분류)을 모델이 최소한이라도 걸러낼 수 있도록
              // 본문 미리보기를 함께 전달한다. storeCredential() 경로
              // (검증된 credential)는 이 필드가 없을 수 있음 — null 허용.
              extractedTextPreview: cred.credentialSubject?.extractedTextPreview || null,
            });
          }
        } catch (e) {
          console.warn('[GovTask] IDV 조회 실패(doc_id=' + doc.id + '):', e.message);
          // 개별 문서 조회 실패가 전체를 막지 않는다 — 그 문서만 기존 정부24 폴백으로 처리됨.
        }
      }

      await sendFn(`[INTERNAL: GOV_TASK_SCHEMA_LOOKUP 결과 수신 — schema: ${JSON.stringify(data.schema)}. ` +
        `로컬 IDV 조회 결과, 아래 idv_type들은 이미 유효한 credential이 있어 재발급 요구 없이 ` +
        `즉시 서류로 사용 가능합니다(§IDV-자동첨부 원칙): ${JSON.stringify(matched)}. ` +
        `matched 각 항목의 extractedTextPreview가 있으면 반드시 훑어보고, 그 내용이 doc_id/idv_type이 ` +
        `가리키는 서류와 명백히 다르면(예: idv_type은 가족관계증명서인데 본문이 사업자등록증 내용) ` +
        `그 항목은 matched에서 무시하고 사용자에게 "IDV에 저장된 서류 종류가 실제와 다른 것 같다"고 ` +
        `알린 뒤 §공문서 발급 안내로 폴백하세요(사용자가 저장 시 종류를 잘못 골랐을 수 있음 — 저장 자체는 ` +
        `검증 없이 이뤄지므로 이 교차검증이 유일한 안전장치입니다). ` +
        `matched 배열에 없는(또는 위 사유로 무시한) acquisition:'gov24' 문서는 기존과 동일하게 ` +
        `§공문서 발급 안내(정부24)로 안내하세요. matched 항목을 GOV_TASK_SUBMIT_REQUEST에 포함할 때는 ` +
        `documents[]에 doc_id와 함께 idv_ref:true, sha256 자리에 contentHash를 사용하세요` +
        `(원본 파일을 별도로 요구하지 마세요).]`);
    } catch (e) {
      await sendFn(`[INTERNAL: GOV_TASK_SCHEMA_LOOKUP 서버 호출 실패(${e.message}) — ` +
        `IDV 조회 없이 기존 §REQUIRED-DOCUMENTS 2단계(정부24 안내)로 진행하세요.]`);
    }
    return true;
  }

  const govTaskDraftMatch = fullReply.match(
    /\[GOV_TASK_DRAFT_REQUEST\]([\s\S]*?)\[\/GOV_TASK_DRAFT_REQUEST\]/);
  if (govTaskDraftMatch) {
    console.log('[GovTask] GOV_TASK_DRAFT_REQUEST 감지 — /gov/task/schema/draft 호출');
    await _updateBubble(_stripInternalTags(fullReply));
    let payload = null;
    try {
      payload = JSON.parse(govTaskDraftMatch[1].trim());
    } catch (e) {
      await sendFn(`[INTERNAL: GOV_TASK_DRAFT_REQUEST의 JSON 파싱 실패(${e.message}) — ` +
        `형식을 맞춰 재시도하거나, 저장 없이 조사 내용만 사용자에게 텍스트로 안내하고 ` +
        `"사람 검토 전이라 다른 사용자에게는 공유되지 않는 임시 정보"라는 점을 밝히세요.]`);
      return true;
    }
    const base = (CFG.endpoint || '').replace(/\/+$/, '');
    try {
      const res  = await fetch(`${base}/gov/task/schema/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, guid: _USER?.ipv6 || USER_GUID || null }),
      });
      const data = await res.json().catch(() => null);
      await sendFn(`[INTERNAL: GOV_TASK_DRAFT_REQUEST 결과 수신 — 이 결과를 바탕으로 ` +
        `§REQUIRED-DOCUMENTS 3단계 지시(verified 여부에 따른 경고 문구 포함)대로 ` +
        `사용자에게 자연스럽게 안내하세요: ${JSON.stringify(data)}]`);
    } catch (e) {
      await sendFn(`[INTERNAL: GOV_TASK_DRAFT_REQUEST 서버 호출 실패(${e.message}) — ` +
        `저장이 안 됐음을 사용자에게 알리고, 지금 조사한 내용은 이번 대화에서만 ` +
        `유효한 임시 안내임을 명확히 하세요.]`);
    }
    return true;
  }

  const govTaskSubmitMatch = fullReply.match(
    /\[GOV_TASK_SUBMIT_REQUEST\]([\s\S]*?)\[\/GOV_TASK_SUBMIT_REQUEST\]/);
  if (govTaskSubmitMatch) {
    console.log('[GovTask] GOV_TASK_SUBMIT_REQUEST 감지 — /gov/task/submit 호출');
    await _updateBubble(_stripInternalTags(fullReply));
    let payload = null;
    try {
      payload = JSON.parse(govTaskSubmitMatch[1].trim());
    } catch (e) {
      await sendFn(`[INTERNAL: GOV_TASK_SUBMIT_REQUEST의 JSON 파싱 실패(${e.message}) — ` +
        `형식을 맞춰 재시도하세요. 접수는 되지 않았습니다.]`);
      return true;
    }
    const base = (CFG.endpoint || '').replace(/\/+$/, '');
    try {
      const res  = await fetch(`${base}/gov/task/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // 2026-08-15 신설(3단계 배선) — trace를 실어 보내면 서버가
        // extractCityCodeFromTrace()로 지역코드를 뽑아 gov-fee-lookup.js의
        // resolveGovFee()에 넘긴다(혼디 서비스 수수료 계산용). trace가 없는
        // 호출부(kgov 인라인 등, gov-router.js의 시/도 판별을 안 쓰는 흐름)는
        // 기본값 []로 조용히 넘어가고, 서버 쪽은 지역 무관(전국공통/BASELINE만)
        // 매칭으로 그레이스풀 디그레이드한다 — 에러 없음.
        body: JSON.stringify({ ...payload, guid: _USER?.ipv6 || USER_GUID || null, trace }),
      });
      const data = await res.json().catch(() => null);
      // 2026-08-13 명확화 — 라이브 스모크테스트(no=6, gov_task_execute_
      // live_smoketest.py)에서 실제로 확인된 결함: 이 INTERNAL 메시지만
      // 받으면 모델이 접수번호 안내로 답을 끝내고 인간전속 구간이어도
      // [PROJECT_STATE_SAVE: ...]를 안 내는 경우가 있었다(SP-22 STEP1에
      // "멈추기 직전 반드시 PROJECT_STATE_SAVE" 지침이 있는데도, 이
      // 후속 턴에서 그 지침을 다시 떠올리지 못한 것으로 보임) — 이 자리에서
      // 명시적으로 다시 상기시킨다.
      await sendFn(`[INTERNAL: GOV_TASK_SUBMIT_REQUEST 결과 수신 — receipt_no와 disclaimer, ` +
        `schema_verified 필드는 절대 요약·생략하지 말고 그 의미를 온전히 사용자에게 전달하세요 ` +
        `(§접수번호 면책문구 참조): ${JSON.stringify(data)}. ` +
        `이어서 이 atom이 인간전속 구간(automation_sp 없음 또는 본인인증 필요)이라면, ` +
        `SP-22 STEP1 지침대로 안내 문구만 내고 끝내지 말고 반드시 [PROJECT_STATE_SAVE: ...]까지 ` +
        `낸 뒤 멈추세요 — 이 태그 없이 끝내면 재개 시 이 접수 상태가 유실됩니다.]`);
    } catch (e) {
      await sendFn(`[INTERNAL: GOV_TASK_SUBMIT_REQUEST 서버 호출 실패(${e.message}) — ` +
        `접수가 실제로 이루어지지 않았음을 사용자에게 명확히 알리세요. ` +
        `"접수했습니다"라고 말하면 안 됩니다.]`);
    }
    return true;
  }

  // ── GOV_TASK_SUPPLEMENT_REQUEST / GOV_TASK_FIELD_INSPECTION_SCHEDULE /
  // GOV_TASK_OPINION_SUBMIT (2026-08-20 신설 — GOV-TASK-POST-ACCEPTANCE-
  // REVIEW_v2_0 §2, ops/dpaper-integration/IMPLEMENTATION-GAPS_gov-task-
  // post-acceptance.md 완결). 세 태그 다 GOV_TASK_SUBMIT_REQUEST와 동일
  // 패턴(fetch → INTERNAL 메시지로 결과 전달) — 서버(worker.js)가
  // access_cert 검증·관할부서 대조를 전담하므로 이 쪽은 순수 배선만 한다.
  // ★ officer-decision(§3)은 여기 없다 — 그건 모델 태그가 아니라 담당
  // 공무원이 직접 호출하는 REST 엔드포인트다(§1 원칙, 서버 라우터 주석
  // 참조). 이 세 태그를 발행하는 실제 지침은 부서 SP(예:
  // SP-CITYDIV-SEOGWIPO-CONSTRUCTION-BUILDING §3)에 있다.
  const govTaskSupplementMatch = fullReply.match(
    /\[GOV_TASK_SUPPLEMENT_REQUEST\]([\s\S]*?)\[\/GOV_TASK_SUPPLEMENT_REQUEST\]/);
  if (govTaskSupplementMatch) {
    console.log('[GovTask] GOV_TASK_SUPPLEMENT_REQUEST 감지 — /gov/task/supplement-request 호출');
    await _updateBubble(_stripInternalTags(fullReply));
    let payload = null;
    try {
      payload = JSON.parse(govTaskSupplementMatch[1].trim());
    } catch (e) {
      await sendFn(`[INTERNAL: GOV_TASK_SUPPLEMENT_REQUEST의 JSON 파싱 실패(${e.message}) — ` +
        `형식을 맞춰 재시도하세요. 보완요청이 기록되지 않았습니다.]`);
      return true;
    }
    const base = (CFG.endpoint || '').replace(/\/+$/, '');
    try {
      const res = await fetch(`${base}/gov/task/supplement-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      await sendFn(`[INTERNAL: GOV_TASK_SUPPLEMENT_REQUEST 결과 수신 — 미비점(deficiency)과 ` +
        `보완할 내용(required_action)을 신청자에게 명확히 전달하세요. 재제출은 같은 receipt_no로 ` +
        `GOV_TASK_SUBMIT_REQUEST를 다시 낸다는 점도 함께 안내하세요: ${JSON.stringify(data)}]`);
    } catch (e) {
      await sendFn(`[INTERNAL: GOV_TASK_SUPPLEMENT_REQUEST 서버 호출 실패(${e.message}) — ` +
        `보완요청이 실제로 기록되지 않았음을 알리세요.]`);
    }
    return true;
  }

  const govTaskInspectionMatch = fullReply.match(
    /\[GOV_TASK_FIELD_INSPECTION_SCHEDULE\]([\s\S]*?)\[\/GOV_TASK_FIELD_INSPECTION_SCHEDULE\]/);
  if (govTaskInspectionMatch) {
    console.log('[GovTask] GOV_TASK_FIELD_INSPECTION_SCHEDULE 감지 — /gov/task/field-inspection-schedule 호출');
    await _updateBubble(_stripInternalTags(fullReply));
    let payload = null;
    try {
      payload = JSON.parse(govTaskInspectionMatch[1].trim());
    } catch (e) {
      await sendFn(`[INTERNAL: GOV_TASK_FIELD_INSPECTION_SCHEDULE의 JSON 파싱 실패(${e.message}) — ` +
        `형식을 맞춰 재시도하세요. 실사 일정이 기록되지 않았습니다.]`);
      return true;
    }
    const base = (CFG.endpoint || '').replace(/\/+$/, '');
    try {
      const res = await fetch(`${base}/gov/task/field-inspection-schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      await sendFn(`[INTERNAL: GOV_TASK_FIELD_INSPECTION_SCHEDULE 결과 수신 — 일정 후보(proposed_slots)를 ` +
        `신청자에게 전달하고 확정을 요청하세요. 실사 자체와 그 결과 판단은 담당 공무원이 직접 하며 이 SP가 ` +
        `대행하지 않는다는 점을 넘지 마세요: ${JSON.stringify(data)}]`);
    } catch (e) {
      await sendFn(`[INTERNAL: GOV_TASK_FIELD_INSPECTION_SCHEDULE 서버 호출 실패(${e.message}) — ` +
        `일정이 실제로 기록되지 않았음을 알리세요.]`);
    }
    return true;
  }

  const govTaskOpinionMatch = fullReply.match(
    /\[GOV_TASK_OPINION_SUBMIT\]([\s\S]*?)\[\/GOV_TASK_OPINION_SUBMIT\]/);
  if (govTaskOpinionMatch) {
    console.log('[GovTask] GOV_TASK_OPINION_SUBMIT 감지 — /gov/task/opinion-submit 호출');
    await _updateBubble(_stripInternalTags(fullReply));
    let payload = null;
    try {
      payload = JSON.parse(govTaskOpinionMatch[1].trim());
    } catch (e) {
      await sendFn(`[INTERNAL: GOV_TASK_OPINION_SUBMIT의 JSON 파싱 실패(${e.message}) — ` +
        `형식을 맞춰 재시도하세요. 의견이 제출되지 않았습니다.]`);
      return true;
    }
    const base = (CFG.endpoint || '').replace(/\/+$/, '');
    try {
      const res = await fetch(`${base}/gov/task/opinion-submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      // ★ §2-3 원문 그대로 — "이 태그는 승인이 아니다". 서버가 pending_human_action:true를
      // 내려주지만, 여기서도 명시적으로 재확인시켜 "승인됐다"고 잘못 요약하지 않게 한다.
      await sendFn(`[INTERNAL: GOV_TASK_OPINION_SUBMIT 결과 수신 — 이건 승인이 아니라 담당 공무원에게 ` +
        `제출된 의견일 뿐입니다. 사용자에게 "승인/반려됐다"고 말하지 말고, 담당 공무원 결재(officer-decision) ` +
        `전까지 pending_human_action 상태임을 REPORT(공리 1)로 정확히 전달하세요: ${JSON.stringify(data)}]`);
    } catch (e) {
      await sendFn(`[INTERNAL: GOV_TASK_OPINION_SUBMIT 서버 호출 실패(${e.message}) — ` +
        `의견이 실제로 제출되지 않았음을 알리세요.]`);
    }
    return true;
  }

  // ── GOV_FEE_APPROVE (2026-08-15 신설 — §GOV-FEE-APPROVAL 승인 게이트) ──
  // GOV_TASK_SUBMIT_REQUEST 응답의 gov_fee.status가 'NEEDS_APPROVAL'일 때만
  // SP가 이 태그를 낸다(사용자가 추정 금액에 명시 동의한 뒤에만 — SP 텍스트가
  // 강제). 서버(POST /gov/task/fee-approve)가 guid 일치와 pending_approval
  // 상태를 다시 검증하므로, 이 클라이언트 코드는 순수 배선 역할만 한다.
  const govFeeApproveMatch = fullReply.match(
    /\[GOV_FEE_APPROVE\]([\s\S]*?)\[\/GOV_FEE_APPROVE\]/);
  if (govFeeApproveMatch) {
    console.log('[GovTask] GOV_FEE_APPROVE 감지 — /gov/task/fee-approve 호출');
    await _updateBubble(_stripInternalTags(fullReply));
    let payload = null;
    try {
      payload = JSON.parse(govFeeApproveMatch[1].trim());
    } catch (e) {
      await sendFn(`[INTERNAL: GOV_FEE_APPROVE의 JSON 파싱 실패(${e.message}) — ` +
        `형식을 맞춰 재시도하세요. 청구되지 않았습니다.]`);
      return true;
    }
    const base = (CFG.endpoint || '').replace(/\/+$/, '');
    try {
      const res = await fetch(`${base}/gov/task/fee-approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receipt_no: payload.receipt_no, guid: _USER?.ipv6 || USER_GUID || null }),
      });
      const data = await res.json().catch(() => null);
      await sendFn(`[INTERNAL: GOV_FEE_APPROVE 결과 수신 — 청구 성공/실패 여부(ok)와 ` +
        `금액을 있는 그대로 사용자에게 전달하세요. 잔액 부족(INSUFFICIENT_BALANCE)이면 ` +
        `충전 안내를, 이미 처리된 건(NOT_PENDING)이면 현재 상태를 그대로 알리세요: ` +
        `${JSON.stringify(data)}]`);
    } catch (e) {
      await sendFn(`[INTERNAL: GOV_FEE_APPROVE 서버 호출 실패(${e.message}) — ` +
        `청구가 실제로 이루어지지 않았음을 사용자에게 명확히 알리세요. ` +
        `"청구했습니다"라고 말하면 안 됩니다.]`);
    }
    return true;
  }

  return false;
}

// ── DEPT_TASK 태그 처리 (2026-07-12 신설, B그룹 100건 사고실험 대응) ──
// GOV_TASK와 같은 위치·같은 게이트-없음 원칙(institutional SP가 낼 때만
// 실제로 등장하는 태그라 system 게이트가 불필요) — _handleGovTaskTags
// 바로 다음 위치에서 호출한다(_callAIInner 디스패치 체인 참고).
//
// [DEPT_TASK_REQUEST]{ "requester_type":"dept", "requester_id":"do-dept:plan",
//   "requester_label":"제주도청 기획조정실", "target_type":"dept",
//   "target_id":"do-dept:welfare", "task_type":"budget_execution_report",
//   "directive":"하반기 복지예산 집행실적 취합해서 보내" }[/DEPT_TASK_REQUEST]
/**
 * _handleDeptTaskTag — call-ai.js(gopang 시민 채팅 클라이언트) 전용 경로.
 *
 * ★ 2026-07-12 재설계 — jeju_do/jeju_national SP는 실제로 jeju.hondi.net
 * (별도 저장소 Openhash-Gopang/jeju)에서 서빙되고, 그 클라이언트는 이
 * call-ai.js를 쓰지 않는다. 그래서 DEPT_TASK_REQUEST의 "진짜" 처리 경로는
 * worker.js handleGovRelay/handleBusinessRelay 안에 서버측으로 새로 만들었다
 * (sp_call과 동일한 원칙 — 클라이언트 무관하게 서버가 직접 감지·처리).
 * 이 함수는 혹시 AGENT-COMMON(시민용) 쪽에서 이 태그가 나올 경우를 위한
 * 보조 경로로 남겨두지만, dept/org 요청자는 authoritativeAgency 없이는
 * 서버가 거부하므로(dept-task-handler.js _authoritativeCheck) 이 경로로는
 * business/citizen 요청만 실제로 성공한다.
 */
export async function _handleDeptTaskTag(fullReply, bubble, sendFn = callAI, userText = '') {
  const m = fullReply.match(/\[DEPT_TASK_REQUEST\]([\s\S]*?)\[\/DEPT_TASK_REQUEST\]/);
  if (!m) return false;

  const _updateBubble = async (text) => {
    if (!bubble) return;
    const { _updateStreamBubble: _usb } = await import('../ui/bubble.js').catch(() => ({}));
    if (_usb) _usb(bubble, text);
  };
  await _updateBubble(_stripInternalTags(fullReply));
  history.push({ role: 'assistant', content: fullReply });

  let payload;
  try {
    payload = JSON.parse(m[1].trim());
  } catch (e) {
    await sendFn(`[INTERNAL: DEPT_TASK_REQUEST의 JSON 파싱 실패(${e.message}) — ` +
      `형식을 맞춰 재시도하세요. 업무지시는 등록되지 않았습니다.]`);
    return true;
  }

  const base = (CFG.endpoint || '').replace(/\/+$/, '');
  let resultText;
  try {
    const res = await fetch(`${base}/gov/dept-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    resultText = res.ok
      ? JSON.stringify(data)
      : `등록 실패 (HTTP ${res.status}): ${JSON.stringify(data)}`;
  } catch (e) {
    resultText = `등록 오류: ${e.message}`;
  }

  await sendFn(`[INTERNAL: DEPT_TASK_REQUEST 결과 — 등록된 task_id/status를 그대로 안내하고, ` +
    `절대 "처리 완료됐다"고 말하지 마세요(이 큐는 지시가 접수됐다는 기록만 남길 뿐, 실제 이행은 ` +
    `대상 기관이 별도로 status를 갱신해야 완료됩니다): ${resultText}`);
  return true;
}

/**
 * _buildFirstContactContext — 최초 인사("이름을 지어주세요")와 프로필 작성
 * 필요성 설명을 SP(시스템 프롬프트) 본문이 아니라, 꼭 필요한 1~2턴에만
 * 사용자 메시지 앞에 붙는 1회성 컨텍스트로 주입합니다(v1.6).
 *
 * 왜 SP에 안 박아두는가: SP는 캐시되는 고정 prefix라도 매 호출마다 다시
 * 전송·과금됩니다. "첫 인사 대본"은 평생 단 한 번만 쓰이는데 SP 본문에
 * 넣으면 모든 사용자의 모든 대화에 영구히 죽은 무게로 따라다닙니다.
 * 대신 여기서는 hondi_first_greeted/hondi_name_pending 플래그가 true인
 * 정확히 그 1~2번의 호출에만 블록을 만들어 끼워 넣고, 끝나면 완전히
 * 사라집니다 — AGENT-COMMON 본문은 첫 대화든 천 번째 대화든 완전히 동일.
 *
 * AGENT-COMMON §0-1(최초 접촉 처리)이 이 블록을 발견하면 그대로 따르고
 * [FIRST_GREETED]/[NAME_CAPTURED]를 출력 — 이후 call-ai.js의
 * _handleProfileTags()가 기존과 동일하게 처리합니다(PA SP 시절과 태그
 * 체계 100% 동일, 출력 주체만 PA→AGENT-COMMON으로 바뀜).
 *
 * @returns {string} 끼워 넣을 컨텍스트 블록(없으면 빈 문자열)
 */
/**
 * SHARE_DOC_CONFIRMED/REJECTED 태그를 처리한다 — 사람이 실제로 확답한
 * 뒤에만 markDocumentProvided를 호출한다(guessDocumentMatch의 추정만으로는
 * 절대 자동 기록하지 않는다는 원칙을 여기서 마지막으로 강제).
 * deps로 procedure-docs.js/share-inbox.js 모듈을 주입받는다(기본값은
 * 동적 import — 테스트에서 mock 주입 가능하게 하기 위함).
 */
export async function _processShareDocTags(fullReply, deps = {}) {
  const shareConfirmMatch = fullReply.match(/\[SHARE_DOC_CONFIRMED:([^\]]+)\]/);
  const shareRejected = fullReply.includes('[SHARE_DOC_REJECTED]');
  if (!shareConfirmMatch && !shareRejected) return;

  try {
    const raw = sessionStorage.getItem('hondi_share_pending');
    const pending = raw ? JSON.parse(raw) : null;
    if (pending) {
      if (shareConfirmMatch) {
        const label = shareConfirmMatch[1].trim();
        const { markDocumentProvided } = deps.procedureDocsModule || await import('../pdv/procedure-docs.js');
        markDocumentProvided(pending.procedureId, label, { filename: pending.filename, sourceTitle: pending.title });
        console.log('[Share] 필요서류 확인 기록:', label);
      } else {
        console.log('[Share] 사용자가 문서 용도를 거부 — 기록하지 않음');
      }
      const { clearSharedDocument } = deps.shareInboxModule || await import('../pdv/share-inbox.js');
      await clearSharedDocument(pending.id);
    }
    sessionStorage.removeItem('hondi_share_pending');
  } catch (e) {
    console.warn('[Share] 공유문서 확인 처리 실패:', e.message);
  }
}

/**
 * _buildFirstContactContext v2.1 (2026-07-11 — 튜토리얼 PA 이관 반영)
 *
 * 첫 인사(FIRST_CONTACT): 이름 포함 고정 환영 문구 + 앱 기본 사용법 안내.
 *   → [FIRST_GREETED] 태그로 완료 기록(단, 닉네임이 아직 없으면 이번 턴엔
 *     [FIRST_GREETED]를 내지 말라고 지시해 슬롯을 아낀다 — 아래 참조).
 *
 * 튜토리얼 단계(TUTORIAL_STEP): 대본은 더 이상 AGENT-COMMON에 없다
 *   (profile-assistant PHASE -1로 이관). 그래서 CFG.system이 실제로
 *   profile-assistant일 때만 hondi_tutorial_step 값을 주입한다 — AC가
 *   아직 활성 상태인 턴에 주입하면 AC가 갖고 있지 않은 대본을 진행하라는
 *   혼란스러운 지시가 된다.
 *   → AI가 [TUTORIAL_ADVANCE:N] 태그를 출력하면 call-ai.js가 step을 N으로 저장.
 *   → hondi_tutorial_done='1' 이면 더 이상 주입하지 않는다.
 *
 * 이름짓기(NAME_CAPTURE_PENDING)는 v2.0에서 제거됨 — AI 비서 이름은 AI 패널
 * 상단 이름 영역을 터치해 언제든 UI에서 직접 편집한다.
 */
export function _buildFirstContactContext() {
  let firstGreeted = false, tutStep = 0, tutDone = false;
  try {
    firstGreeted = localStorage.getItem('hondi_first_greeted') === '1';
    tutStep  = parseInt(localStorage.getItem('hondi_tutorial_step') || '0', 10);
    tutDone  = localStorage.getItem('hondi_tutorial_done') === '1';
  } catch {}

  // ── 최초 인사 (평생 1회) ──────────────────────────────────────
  if (!firstGreeted) {
    let nickname = '';
    try {
      const reg = JSON.parse(
        localStorage.getItem('gopang_user_v4') ||
        sessionStorage.getItem('gopang_user_v4') || '{}'
      );
      nickname = reg.nickname || '';
    } catch {}

    // ★ 2026-07-11 수정: 기존엔 닉네임이 준비 안 된 상태(가입 폼 작성·OTP
    // 대기 등으로 패널의 "페이지 로드 후 최대 4.3초" 대기가 실제 가입
    // 완료보다 먼저 끝나버리는 경우가 실사로 흔함 — "닉네임 끝내 미준비"
    // 로그로 확인됨)에서도 그대로 진행해 "저는 **님과..." 같은 빈 이름
    // 인사가 나갔고, [FIRST_GREETED]가 그 응답으로 영구 소비되어 이후
    // 다시는 제대로 된 이름으로 인사할 기회가 없었다. 닉네임이 없으면
    // 모델에게 [FIRST_GREETED]를 이번엔 내지 말라고 지시해, 다음
    // 기회(닉네임이 채워진 뒤)에 정상적으로 재시도되게 한다 — 사용자에게
    // 보여줄 인사말 자체는 그대로 내보내되(무한 침묵 방지), "평생 1회"
    // 슬롯만 아껴둔다.
    if (!nickname) {
      // 2026-07-13 갱신 — 이 임시 인사와 정식 인사([FIRST_CONTACT])의
      // 자기소개가 중복된다는 사고실험 지적 반영: 정식 문구("평생을
      // 함께할"·"나만의 AI 비서" 등)를 여기서 미리 쓰지 않도록 명시적으로
      // 금지한다 — 그건 이름이 준비된 뒤 단 한 번만 나가야 한다.
      return (
        `[FIRST_CONTACT_PENDING_NAME: 닉네임이 아직 준비되지 않았습니다.` +
        ` 이번 턴엔 짧게(1~2문장) 일반적인 환영 인사만 하십시오.` +
        ` "평생을 함께할", "나만의 AI 비서" 같은 정식 자기소개 문구는` +
        ` 절대 미리 쓰지 마십시오 — 그건 이름이 준비된 뒤 정식 인사 때` +
        ` 단 한 번만 나갑니다. 앱 사용법 안내도 이번엔 하지 마십시오.` +
        ` 절대 [FIRST_GREETED]를 출력하지 마십시오 — 이름이 준비되는 대로` +
        ` 다음 대화에서 정식으로 다시 인사할 것입니다.]\n\n`
      );
    }

    // 사용자 지정 환영 문구 — 한 글자도 바꾸지 말 것 (2026-07-13 3차 갱신 —
    // 첫 질문을 "판매하시는 상품이 있나요?"(고정, 자영업자 외엔 무관)에서
    // profile-assistant의 [P1-INFER]와 동일한 열린 질문으로 교체. 12개
    // 페르소나 사고실험(학생·공무원·회사원·봉직의 등)에서 고정 질문이
    // 자영업자 1건 외엔 전부 무관하거나 어색했던 문제를 해소하기 위함.
    return (
      `[FIRST_CONTACT: 아래 문구를 토씨 하나 바꾸지 말고 그대로 출력하십시오.` +
      ` **나만의 AI 비서**·**혼디**·**프로필**은 마크다운 굵은 글씨로 표시합니다.` +
      ` 단, 이번 사용자 메시지가 실질적인 질문이나 요청이라면(단순 첫 접속이` +
      ` 아니라 진짜 궁금한 점을 물었다면) 아래 문구를 출력하기 전에 그 질문에` +
      ` 1~2문장으로 먼저 답한 뒤 자연스럽게 아래 문구로 이어가십시오 —` +
      ` 사용자의 실제 발화를 무시하지 마십시오. 그 외의 경우(세션의 첫` +
      ` 메시지 등)엔 아래 문구만 출력하고 반드시 거기서 멈추십시오.\n` +
      `---\n` +
      `저는 **${nickname}**님과 평생을 함께할 **나만의 AI 비서** **혼디**입니다.` +
      ` 저는 오직 ${nickname}님만을 위해 일하며, ${nickname}님의 일상과 업무를 돕고,` +
      ` 기록하며, 지시하신 각종 업무를 수행할 것입니다. 앱 사용법이 궁금하실 땐` +
      ` 언제든 저에게 편하게 물어봐 주세요.\n\n` +
      `무엇이든 지시하십시오. 그러나, 제가 ${nickname}님을 잘 알수록 더 정확하고` +
      ` 효율적으로 지시를 이행할 수 있습니다. 번거롭겠지만, 제가 여쭙는 몇 가지` +
      ` 질문에 답해 주시면, 제가 ${nickname}님의 프로필과 웹 페이지를` +
      ` 작성하겠습니다. 첫째 질문입니다. 어떤 일을 하고 계세요? 사업을` +
      ` 하신다면 어떤 일인지도 편하게 말씀해 주시면 제가 알아서 정리할게요.\n` +
      `---\n응답 끝에 반드시 [FIRST_GREETED]를 출력하십시오.]\n\n`
    );
  }

  // ── 튜토리얼 단계 주입 (완료 전까지, PA가 활성 상태일 때만) ──────
  // ★ 2026-07-11 수정: 튜토리얼은 이제 profile-assistant의 PHASE -1이다
  // (구 AC §0-1-T 이관). AC가 아직 인계하기 전 턴(예: 첫인사 뒤 사용자의
  // "준비됐어요" 응답을 AC 자신이 받는 턴)에 이 블록이 끼어들면 AC가
  // 갖고 있지도 않은 "§0-1-T"를 진행하라는 혼란스러운 지시를 받게 되므로,
  // CFG.system이 실제로 profile-assistant로 전환된 뒤에만 주입한다.
  if (!tutDone && CFG.system?.includes('profile-assistant')) {
    return (
      `[TUTORIAL_STEP:${tutStep} — 아래 단계별 안내를 진행하십시오(PHASE -1 참조).` +
      ` 각 단계 완료 시 응답 끝에 [TUTORIAL_ADVANCE:${tutStep + 1}]를 출력하십시오.]\n\n`
    );
  }

  return '';
}

// ══════════════════════════════════════════════════════════
// 정부24 공유문서 확인 컨텍스트 (2026-07-09 신설)
// ══════════════════════════════════════════════════════════
// gopang-pwa.js가 ?shared=<id>를 감지하면 sessionStorage에
// "hondi_share_pending" 플래그만 남긴다(자동 확정 안 함). 이 함수가
// _buildFirstContactContext와 동일한 1회성 주입 패턴으로 다음 AI
// 턴에 사람에게 직접 확인을 물어보게 만들고, AI가 [SHARE_DOC_CONFIRMED:
// 라벨] 또는 [SHARE_DOC_REJECTED]를 출력하면 그 결과만 call-ai.js가
// 기록한다 — "문서 용도는 AI가 단정하지 않고 항상 사람이 확정한다"는
// extract.js/share-inbox.js와 동일한 원칙을 대화 흐름에도 그대로 적용.
// ══════════════════════════════════════════════════════════
// 주기적 PDV 검토 트리거 (2026-07-13 신설, 3단계 롤아웃 중 ①)
// ══════════════════════════════════════════════════════════
// 계정 나이에 따라 검토 간격을 늘린다 — 신규 계정은 활동 패턴이
// 아직 안 잡혀 매일 봐도 새로운 단서가 나올 가능성이 높고, 오래된
// 계정은 프로필이 이미 안정화됐을 가능성이 높아 자주 볼 필요가 준다.
function _pdvReviewIntervalDays() {
  let signupAt = null;
  try { signupAt = localStorage.getItem('hondi_signup_at'); } catch {}
  if (!signupAt) return null; // 가입 시점을 아직 모르면 검토 보류
  const ageDays = (Date.now() - new Date(signupAt).getTime()) / 86400000;
  if (ageDays < 100) return 1;   // ~3~4개월: 매일
  if (ageDays < 365) return 7;   // ~1년: 매주
  return 30;                     // 1년 이후: 매월
}

// ══════════════════════════════════════════════════════════
// job_ksco 재확인 트리거 (2026-07-14 신설 — 구멍 E 해결)
// ══════════════════════════════════════════════════════════
// AC-AUTHOR §7이 job_ksco.review_due를 만들어뒀지만, 위
// _buildPdvReviewContext()는 "프로필이 아직 미완성인 사용자"만
// 대상으로 하는(hondi_profile_done==='1'이면 즉시 return) 온보딩
// 완료 유도용 메커니즘이라 job_ksco의 "시간이 지나 오래된 정보"
// 문제와는 대상 집단이 정반대다(오래돼서 review_due가 지나는 건
// 이미 프로필을 완성한 지 오래된 사용자에게나 일어난다). 그래서
// 독립적인 함수로 새로 만든다 — 프로필 완성 여부와 무관하게 동작.
function _buildJobKscoReviewContext() {
  try {
    let partial = {};
    try { partial = JSON.parse(localStorage.getItem('hondi_profile_partial') || '{}'); } catch {}
    const jobKsco = partial.job_ksco || window.__hondiOwnProfileCache?.job_ksco || null;
    if (!jobKsco?.review_due) return ''; // review_due 자체가 없으면(아직 한 번도 승인/작성 안 됨) 대상 아님
    if (new Date(jobKsco.review_due) >= new Date()) return ''; // 아직 안 지남

    // 쿨다운 — PDV_REVIEW_DUE와 별개 타이머. 매 턴 물어보면 피곤하므로
    // 최소 14일 간격(임의값 — job_ksco 자체가 자주 안 바뀌는 정보라
    // PDV 검토(1~30일)보다 더 여유 있게 잡음).
    let lastAsked = null;
    try { lastAsked = localStorage.getItem('hondi_job_ksco_review_last'); } catch {}
    if (lastAsked && (Date.now() - new Date(lastAsked).getTime()) < 14 * 86400000) return '';

    return (
      `[JOB_KSCO_REVIEW_DUE: 저장된 직업 정보("${jobKsco.label || '미상'}")의 ` +
      `재확인 시점이 지났습니다. 이번 응답 끝에 자연스럽게 "여전히 같은 일을 ` +
      `하고 계세요?" 류로 한 번만 가볍게 물어보십시오(강요하지 않음, 지금 대화` +
      `흐름과 전혀 안 맞으면 이번엔 생략해도 됩니다). 사용자가 답하면(계속 ` +
      `같은 일이든, 바뀌었든) [PARTIAL_SAVE]로 job_ksco를 갱신하십시오. 답하지` +
      ` 않거나 이번 턴에 안 물어봤어도, 이번 응답 끝에 [JOB_KSCO_REVIEWED]를` +
      ` 출력해 검토 시도를 기록하십시오(다음 재확인 시점 계산용, 사용자에게는` +
      ` 안 보이는 내부 태그).]\n\n`
    );
  } catch { return ''; }
}

// AC↔PA 실시간 채널(2026-07-27 신설) — PA(profile-assistant) 세션이 끝나면
// engine.js가 setPaHandoffPending()으로 6하원칙 형태 보고를 딱 1번 남긴다.
// 지금까지는 이 정보가 UI 버블(appendBubble)과 PDV에만 남고 AC의 실제
// history(다음 턴에 모델이 실제로 보는 대화)엔 전혀 안 들어가서, 사람은
// 화면에서 완료 요약을 봐도 AC 모델 자신은 그걸 "기억"하지 못했다(EXPERT
// 핸드오프는 같은 history를 공유해 이 문제 자체가 없었는데, PA는 별도
// 탭·별도 history라 명시적으로 다시 주입해야만 한다 — 격리 리팩터링
// (2026-07-11)이 깨뜨린 부수효과를 여기서 복구한다). firstContact/
// jobKscoReview와 동일한 1회성 소비 패턴 — 한 번 [ctx]에 실리면 즉시
// 비운다(다음 턴에 같은 보고를 반복하지 않음).
function _buildPaHandoffContext() {
  if (!_paHandoffPending) return '';
  const p = _paHandoffPending;
  setPaHandoffPending(null); // 1회성 — 이번 턴에 실었으니 즉시 소비
  const parts6w = [
    p.what ? `무엇을: ${p.what}` : null,
    p.why  ? `왜: ${p.why}`     : null,
    p.how  ? `어떻게: ${p.how}` : null,
  ].filter(Boolean).join(' / ');
  return (
    `[PA_HANDOFF_REPORT: 방금 별도 탭에서 진행되던 프로필 작성이 끝났습니다 ` +
    `— "${p.summary}"${parts6w ? ` (${parts6w})` : ''}. 사용자가 이미 결과를 ` +
    `화면에서 봤으므로 다시 요약해서 말해줄 필요는 없습니다 — 그저 이 사실을 ` +
    `배경지식으로 알고 있다가, 사용자가 이어서 관련 질문을 하거나(예: "내 ` +
    `프로필 어때 보여?", "그거 하다 말았는데") 자연스러운 기회가 오면 문맥에 ` +
    `맞게 반영하십시오. 먼저 나서서 언급할 필요는 없습니다.]\n\n`
  );
}

export function _buildPdvReviewContext() {
  try {
    // 프로필이 이미 완성된 사용자는 이 트리거 대상이 아니다(§0-1-P[6]의
    // "프로필:미완성" 게이트와 동일한 전제 — 완성본을 계속 흔들지 않음).
    if (localStorage.getItem('hondi_profile_done') === '1') return '';

    const intervalDays = _pdvReviewIntervalDays();
    if (intervalDays == null) return '';

    let lastReview = null;
    try { lastReview = localStorage.getItem('hondi_pdv_review_last'); } catch {}
    const dueMs = intervalDays * 86400000;
    if (lastReview && (Date.now() - new Date(lastReview).getTime()) < dueMs) return '';

    return (
      `[PDV_REVIEW_DUE: 지금이 이 세션에서 PDV 검토 시점입니다(계정 나이 기준` +
      ` ${intervalDays}일 주기). 이번 응답은 평소처럼 사용자 요청에 정상적으로` +
      ` 답하되, 이번 턴의 [이력] 블록(최근 PDV 요약)에서 프로필에 추가할 만한` +
      ` 단서(반복되는 상품·업무·활동 패턴 등)가 보이면 응답 끝에 §0-1-P[6]과` +
      ` 같은 톤으로 딱 한 가지만 자연스럽게 언급하십시오 — 강요하지 않습니다.` +
      ` 뚜렷한 단서가 없으면 아무 말도 덧붙이지 않아도 됩니다. 어느 경우든` +
      ` 이번 응답 끝에 [PDV_REVIEWED]를 반드시 출력해 검토를 기록하십시오` +
      ` (사용자에게는 보이지 않는 내부 태그 — 다음 검토 시점 계산용).]\n\n`
    );
  } catch {
    return '';
  }
}

export function _buildShareInboxContext() {
  let pending = null;
  try {
    const raw = sessionStorage.getItem('hondi_share_pending');
    pending = raw ? JSON.parse(raw) : null;
  } catch {}
  if (!pending) return '';

  const name = pending.filename || pending.title || '공유받은 문서';
  const guessLine = pending.guesses && pending.guesses.length
    ? ` 파일명으로 미루어 "${pending.guesses.join(', ')}"일 가능성이 있습니다만, 반드시 사용자에게 직접 확인하세요 — 절대 임의로 단정하지 마세요.`
    : ' 어떤 서류인지 짐작할 단서가 부족합니다 — 사용자에게 직접 물어보세요.';

  return (
    `[SHARE_DOC_PENDING: 방금 정부24(또는 다른 앱)에서 공유받은 문서가 있습니다 — "${name}".` +
    `${guessLine}` +
    ` 개인파산 신청에 필요한 서류(파산·면책신청서/진술서/채권자목록/재산목록/수입및지출목록) 중 어느 것인지,` +
    ` 또는 그 서류들을 뒷받침하는 증빙(은행잔고증명서/보험가입확인서/국민연금증명원) 중 어느 것인지,` +
    ` 또는 다른 용도인지 사용자에게 물어보세요.` +
    ` 사용자가 특정 서류로 확답하면 응답 끝에 [SHARE_DOC_CONFIRMED:그 서류명]을,` +
    ` 관련 없다고 하면 [SHARE_DOC_REJECTED]를 정확히 한 번만 출력하세요.]\n\n`
  );
}

// ══════════════════════════════════════════════════════════
// 3단계 — 점수 기반 UNIVERSAL-INTEGRITY 동적 주입 (2026-07-09 신설)
// ══════════════════════════════════════════════════════════
// buildHondiFaqContext()와 완전히 동일한 패턴(세션 캐시 + 이번 턴 user
// 메시지에만 병합, system prefix 불변 — DeepSeek 캐시 보존)을 따른다.
// ★ 의도적으로 하지 않은 것: userText만으로 GWP 카테고리를 키워드
// 매칭해서 추정하는 것. matchService()(구 window.gwpMatch)가 2026-07-05
// "호출부 0건, 죽은 코드"로 이미 제거됐고, 그 커밋의 원칙이 "실제
// 라우팅은 AGENT-COMMON이 [GWP:]/[EXPERT:] 태그로 직접 수행한다"였다 —
// 이 사전 판단 시점엔 그 태그가 아직 없으므로, _estimateGovImportance를
// gwpEntry=null로 호출해 카테고리 가중치는 항상 기본값(10)만 쓰고
// 처분성 키워드·응급 신호만으로 판단한다(제거된 라우팅 방식을 다른
// 이름으로 되살리지 않기 위함).
let _universalIntegrityCache = null;

async function _buildUniversalIntegrityContext(userText) {
  const score = _estimateGovImportance(userText, null);
  if (score < IMPORTANCE.LIGHTWEIGHT_MAX) return '';

  if (!_universalIntegrityCache) {
    try {
      _universalIntegrityCache = await _loadSpByKey('UNIVERSAL-INTEGRITY', 'UNIVERSAL-INTEGRITY');
    } catch (e) {
      console.warn('[GovImportance] UNIVERSAL-INTEGRITY 로드 실패(무시):', e.message);
      return '';
    }
  }
  console.info('[GovImportance] UNIVERSAL-INTEGRITY 이번 턴 주입 — score:', score.toFixed(1));
  return (
    `[UNIVERSAL-INTEGRITY 참고 — 이번 질문에서 처분성/기관 관련 신호가 감지되어,` +
    ` 전체 SP 공통 정직성·확신도 원칙을 이번 턴에 한해 함께 적용합니다.\n` +
    _universalIntegrityCache +
    `]\n\n`
  );
}

/**
 * _buildEnhancedUserContent — 동적 컨텍스트를 사용자 메시지 앞에 병합
 *
 * DeepSeek Auto Prompt Caching 최적화의 핵심:
 *   • system 메시지는 완전히 정적 → 캐시 prefix 100% 보존
 *   • GUID·위치·PDV 요약은 ctxMsg(별도 메시지)가 아닌 현재 user 메시지 앞에 주입
 *   → 캐시 prefix(system)가 매 호출 동일 → DeepSeek 캐시 적중률 95%+
 *
 * v1.6 — "PA 온보딩 중" 분기를 제거했습니다. 메인 채팅/AI 패널은 더 이상
 * PA SP를 직접 로드하지 않고 항상 AGENT-COMMON을 씁니다(PA SP는 settings.js
 * 의 프로필 작성 패널 전용 — _buildProfileContext()는 거기서 직접 부릅니다).
 * 대신 _buildFirstContactContext()로 "최초 인사/이름짓기" 1회성 컨텍스트를
 * 매 턴 검사해서, 필요한 딱 그 1~2턴에만 끼워 넣습니다.
 *
 * @param {string|Array} userContent — 현재 사용자 메시지 (텍스트 또는 multipart)
 * @returns {string|Array} 컨텍스트가 병합된 사용자 메시지
 */
// _loadOwnJobContext — 2026-07-14 신설. 서버에 최종 저장된 본인
// 프로필의 job_ksco/affiliation을 가져와 window.__hondiOwnProfileCache에
// 캐시한다(AC_SELF_EVOLUTION_THOUGHT_EXPERIMENT_v1_0.md 1번 제안).
// hondi_profile_partial(localStorage, 온보딩 중 즉시 반영)은 그 세션
// 안에서만 유효하고 새 세션·새 탭에서는 비어 있으므로, 이 함수가 그
// 간극을 메운다 — GET /profile의 기존 뷰어 서명 핸드셰이크
// (_isAuthenticatedOwnerRequest, verifyOwnerHandshake와 동일한
// gopangWallet.signPayload 체계)를 그대로 재사용한다. 세션(페이지 로드)
// 당 한 번만 시도한다 — 매 턴 서버를 다시 부르지 않는다.
let _ownJobContextAttempted = false;
async function _loadOwnJobContext() {
  if (_ownJobContextAttempted) return;
  _ownJobContextAttempted = true;
  try {
    const guid = USER_GUID;
    const wallet = window.gopangWallet;
    if (!guid || !wallet?.signPayload) return; // 지갑 미준비 — 조용히 스킵(필수 기능 아님)

    const ts = String(Math.floor(Date.now() / 1000));
    const pubkey = wallet.publicKeyB64u || wallet.publicKeyB64 || '';
    // handleProfileGet._isAuthenticatedOwnerRequest가 기대하는 정확한
    // 서명 메시지 형식 — 다른 문자열이면 서버가 본인 조회로 인정 안 함.
    const sigMsg = `view:${guid}:${pubkey}:${ts}`;
    const signature = await wallet.signPayload(sigMsg);

    const qs = new URLSearchParams({
      guid, viewer_guid: guid, viewer_pubkey: pubkey, viewer_sig: signature, viewer_ts: ts,
    });
    const res = await fetch(`https://hondi-proxy.tensor-city.workers.dev/profile?${qs.toString()}`, { cache: 'no-cache' });
    const data = await res.json().catch(() => null);
    const identity = data?.extra?.public?.identity;
    if (identity && (identity.job_ksco || identity.affiliation || identity.work_domain)) {
      window.__hondiOwnProfileCache = {
        job_ksco: identity.job_ksco || null,
        affiliation: identity.affiliation || null,
        work_domain: identity.work_domain || null, // 2026-07-14 신설(구멍 D)
      };
    }
    // ★ 2026-07-30 신설 — 이 조회는 이미 인증된 본인 프로필 전체를 받아온다
    // (data.profile). 그런데 정작 profile.address/name/phone은 지금까지
    // 캐시하지 않고 있었다 — SP(U7-2/U7-3)는 계속 "PDV_REQUEST로 스스로
    // 확인하라"고 지시했지만, 메인 앱에는 그 태그를 처리하는 코드 자체가
    // 없었다(K-서비스 서브탭에만 pdv-history-client.js가 연결돼 있었음).
    // "SP 문구로 지시" 대신, 이미 하고 있던 이 인증 조회의 응답에서
    // 값만 더 꺼내 코드가 직접 채워 넣는다 — 위치·날짜와 동일한 원칙.
    if (data?.profile) {
      window.__hondiOwnProfileCache = {
        ...(window.__hondiOwnProfileCache || {}),
        address: data.profile.address || null,
        name: data.profile.name || null,
        phone: data.profile.phone || null,
      };
    }

    // 2026-07-14 신설 — 나에게 배정된 STAFF_TASK_QUEUE 작업 확인
    // (AC_SELF_EVOLUTION_THOUGHT_EXPERIMENT_v2_0.md 구멍 C). 검증된
    // 소속(verified affiliation)이 하나도 없으면 애초에 배정될 수
    // 없으므로 조회 자체를 건너뛴다(불필요한 요청 절약).
    const hasVerifiedAffiliation = Array.isArray(identity?.affiliation) &&
      identity.affiliation.some(a => a.verified && a.active !== false);
    if (hasVerifiedAffiliation) {
      try {
        const assignRes = await fetch('https://hondi-proxy.tensor-city.workers.dev/gov/dept-task/my-assignments', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guid, viewer_pubkey: pubkey, viewer_sig: signature, viewer_ts: ts }),
        });
        const assignData = await assignRes.json().catch(() => null);
        if (assignData?.ok && assignData.count > 0) {
          window.__hondiOwnProfileCache = { ...(window.__hondiOwnProfileCache || {}), pending_assignments: assignData.assignments };
        }
      } catch (e) {
        console.warn('[JobContext] 배정 작업 조회 실패(무시):', e.message);
      }
    }
  } catch (e) {
    console.warn('[JobContext] 본인 프로필 조회 실패(무시 — 필수 기능 아님):', e.message);
  }
}

async function _buildEnhancedUserContent(userContent) {
  _loadOwnJobContext(); // fire-and-forget — 이번 턴엔 아직 캐시가 없을 수 있지만 다음 턴부터 반영됨(await로 첫 턴을 늦추지 않음)

  const parts = [];

  // GUID + 위치 + PDV 요약 (RAG 스타일, 압축)
  if (USER_GUID) parts.push(`GUID:${USER_GUID.slice(-8)}`);

  // 2026-07-05 신설 — 사용자 본인의 닉네임/handle. 라우팅 확정 시
  // "{사용자}님, {대상}을 호출하겠습니다" 같은 확인 문구에 필요.
  // 아래 '비서이름'과 반드시 구분할 것 — 이건 이용자 자신을 가리키는
  // 값이고, '비서이름'은 이용자가 지어준 그림자 AI(자기 자신)의 이름이다.
  const userLabel = _USER?.nickname || _USER?.handle || '';
  if (userLabel) parts.push(`사용자:${userLabel}`);

  // v1.3 — 이용자가 지어준 AI 비서 이름을 매 턴 함께 전달(새로고침으로 history가
  // 끊겨도 AGENT-COMMON이 계속 같은 이름을 쓸 수 있도록)
  // 2026-07-05: 키를 '이름'→'비서이름'으로 명확화(위 '사용자' 필드와 혼동 방지 —
  // 과거엔 이 값 하나만 있어서 AGENT-COMMON이 자기소개용인지 호칭용인지
  // 헷갈릴 여지가 있었음).
  const assistantName = localStorage.getItem('hondi_assistant_name') || '';
  if (assistantName) parts.push(`비서이름:${assistantName}`);

  // 2026-07-13 신설 — 프로필 완성도 신호. §0-1-P[6](은연중 프로필 작성
  // 유도)이 참조하는 근거. 완성되면(done='1') 신호 자체를 빼서, 더 이상
  // 언급할 대상이 아님을 자연스럽게 전달한다(별도 "완성됨" 신호 불필요).
  try {
    if (localStorage.getItem('hondi_profile_done') !== '1') {
      parts.push('프로필:미완성');
    }
  } catch {}

  // ★ 2026-09-06 버그 수정 — _waitForLocationReady()는 2026-08-22에
  // "AI 비서는 항상 사용자의 현재 위치를 알고 있어야 한다"(주피터 지시)를
  // 지키기 위해 만들어졌으나, 정작 이 함수(매 턴 프롬프트 조립부)가 한
  // 번도 호출하지 않고 있었다 — 즉 GPS/프로필 조회가 끝나기 전에 이미
  // _buildLocNote()가 빈 값으로 지나가 버리는 사고가 실사로 확인됐다
  // (사용자 리포트: "혼디가 내 위치를 모른다고 함"). 최대 4초까지만
  // 대기하므로(services/location.js), 위치 권한을 거부한 사용자도 무한정
  // 멈추지 않는다.
  await _waitForLocationReady();
  const locNote = _buildLocNote();
  if (locNote) parts.push(locNote.trim());

  // ★ 2026-07-30 신설 — window.__hondiOwnProfileCache에 address/name/phone이
  // 있으면(위 _loadOwnJobContext가 채움) 매 턴 자동으로 알려준다. "PDV_REQUEST
  // 태그를 써서 스스로 확인하라"는 SP 지시는 메인 앱에 그 태그를 처리하는
  // 코드가 없어 작동할 수 없었다(실사용 중 반복 확인된 문제) — 태그·왕복
  // 없이 이미 있는 값을 코드가 직접 매 턴 알려주는 방식으로 대체한다.
  const cachedProfile = window.__hondiOwnProfileCache;
  if (cachedProfile?.address || cachedProfile?.name || cachedProfile?.phone) {
    const known = [];
    if (cachedProfile.address) known.push(`주소:${cachedProfile.address}`);
    if (cachedProfile.name)    known.push(`이름:${cachedProfile.name}`);
    if (cachedProfile.phone)   known.push(`전화:${cachedProfile.phone}`);
    parts.push(`[이미 확보된 본인 프로필 — 다시 묻지 말 것] ${known.join(', ')}`);
  }

  // PDV 요약 — 2026-07-14 수정: 이전엔 여기서 localStorage 로그를 직접
  // 읽어 domain(일상/업무) 구분 없이 그대로 넣고 있었다 — §PDV-SPLIT
  // (AC-EVOLUTION_v1_1.md)가 만든 _buildPDVNote()(도메인 필터링)는
  // 정작 이 실제 호출 경로에 한 번도 연결된 적이 없었다(사고실험으로
  // 발견, AC_SELF_EVOLUTION_THOUGHT_EXPERIMENT_v1_0.md). 이제
  // _buildPDVNote()를 그대로 쓴다 — 현재 모드(personal/work)와 다른
  // 도메인의 기록은 아예 여기 안 실린다.
  const pdvNote = _buildPDVNote();
  if (pdvNote) parts.push(pdvNote.trim());

  // 2026-07-14 신설 — job_ksco/affiliation을 매 턴 컨텍스트에 포함
  // (AC_SELF_EVOLUTION_THOUGHT_EXPERIMENT_v1_0.md 1·2번 제안 반영).
  // hondi_profile_partial(온보딩 중 즉시 반영)을 1차 소스로 쓴다 — 이건
  // 동기 접근이라 이 함수의 기존 패턴(GUID·위치 등)과 동일한 방식으로
  // 끼워 넣을 수 있다. 세션이 새로 열려 partial이 비어있는 경우까지
  // 커버하려면 서버 저장 프로필을 별도로 조회해야 하는데, 그건
  // _loadOwnJobContext()(아래 신설, 캐시됨)가 채운
  // window.__hondiOwnProfileCache를 폴백으로 참조한다.
  try {
    let partial = {};
    try { partial = JSON.parse(localStorage.getItem('hondi_profile_partial') || '{}'); } catch {}
    const jobKsco = partial.job_ksco || window.__hondiOwnProfileCache?.job_ksco || null;
    const affiliation = partial.affiliation || window.__hondiOwnProfileCache?.affiliation || null;
    const workDomain = partial.work_domain || window.__hondiOwnProfileCache?.work_domain || null;
    if (jobKsco?.label) parts.push(`직업:${jobKsco.label}`);
    if (Array.isArray(affiliation) && affiliation.length) {
      const affStr = affiliation
        .filter(a => a.active !== false)
        .map(a => `${a.org_id}${a.verified ? '' : '(승인대기)'}`)
        .join(', ');
      if (affStr) parts.push(`소속:${affStr}`);
    }
    // 2026-07-14 신설, 2026-07-17 수정 — work_domain(구멍 D). job_ksco가
    // 못 잡는 학생·은퇴자·전업주부·무직을 여기서 보완한다. WORK_DOMAIN_
    // LABEL_KO 매핑은 AGENT-COMMON이 아니라 여기서 해둔다 — 태그 자체를
    // 한국어 값으로 넘기면 AGENT-COMMON 쪽 파싱 부담이 준다.
    // ★ 2026-07-17 수정 — work_domain.status(단일값)가 그 사이
    // statuses(배열, 다중 정체성 지원)로 바뀌었는데 이 지점이 옛
    // 필드명을 그대로 읽고 있어 이 줄 자체가 항상 빈 값으로 조용히
    // 죽어있었다(같은 세션에서 발견 즉시 수정 — 배열의 각 상태를
    // '+'로 이어붙여 표시).
    if (Array.isArray(workDomain?.statuses) && workDomain.statuses.length) {
      const WORK_DOMAIN_LABEL_KO = {
        employed_public: '공공부문 재직', employed_private: '민간부문 재직',
        self_employed: '자영업', student: '학생', retired: '은퇴',
        homemaker: '전업주부', unemployed: '구직 중', other: '기타',
      };
      const labels = workDomain.statuses.map(s => WORK_DOMAIN_LABEL_KO[s] || s).join('+');
      parts.push(`업무상태:${labels}${workDomain.active === false ? '(비활성)' : ''}`);
    }
    // 2026-07-17 신설 — 사용자 개선 제안 능동 획득 빈도 제한(docs/
    // user_feedback_mechanism_proposal_v1.md). AC/PA가 이 신호를 보고
    // "최근에 이미 물어봤으면 이번엔 안 물어본다"를 스스로 판단한다 —
    // 클라이언트가 강제로 막는 게 아니라 판단 재료만 준다(과유불급
    // 원칙, RULE-03과 동일하게 최종 판단은 SP에 맡김).
    try {
      const lastAsked = localStorage.getItem('hondi_feedback_last_asked_at');
      if (lastAsked) {
        const daysSince = (Date.now() - new Date(lastAsked).getTime()) / 86400000;
        if (daysSince < 7) parts.push(`피드백요청:${Math.floor(daysSince)}일전에_이미_물어봤음`);
      }
    } catch {}
    // 2026-07-14 신설 — 배정된 작업 안내(사고실험 구멍 C 해결). 사람이
    // 아니라 그 사람 소속 부서가 게시한 작업이 있으면, AC가 §0-1-Q
    // 톤으로 자연스럽게 알릴 수 있게 원자료만 [ctx]에 싣는다(실제 안내
    // 문구 생성은 AGENT-COMMON §0-1-Q/R이 담당 — 여기선 데이터만 전달).
    const assignments = window.__hondiOwnProfileCache?.pending_assignments;
    if (Array.isArray(assignments) && assignments.length) {
      const asgStr = assignments.slice(0, 5)
        .map(a => `${a.requester_id}:${a.task_type || '(유형미기재)'}`)
        .join('; ');
      parts.push(`배정된업무(${assignments.length}건):${asgStr}`);
    }
    // AC↔PA 실시간 채널(2026-07-27 신설) — PA(profile-assistant)가 다른 탭에서
    // 진행 중이면 매 턴 이 짧은 신호를 반영한다. 사용자가 PA 탭을 열어둔 채
    // AC 탭으로 돌아와 다른 말을 걸어도, AC가 "지금 프로필 작성 중"임을
    // 알고 자연스럽게 반영할 수 있다(§0-1-P[4] "실행 지시 우선" 원칙과
    // 상충하지 않음 — 이건 그냥 배경지식이고, 대화를 그쪽으로 끌고 가라는
    // 뜻이 아니다). 태그가 아니라 다른 신호들과 동일하게 key:value 한 줄로만
    // 얹는다 — AC가 이 정보를 어떻게 쓸지는 §0-1-P의 절제 원칙에 맡긴다.
    if (_gwpLiveProgress) {
      const { step, total, label } = _gwpLiveProgress;
      const stepStr = (step && total) ? `${step}/${total}단계` : '진행중';
      parts.push(`PA진행:${stepStr}${label ? `(${label})` : ''}`);
    }
  } catch {}

  // 2026-07-15 신설 — UNIVERSAL-job-assist(U1~U6) 주입. system이 아니라
  // 여기(매 턴 동적 컨텍스트)에서 넣는 이유는 위 _fetchUniversalJobAssist
  // 정의부 주석 참고. 위의 짧은 key:value 압축 신호들과 달리 이건 지침
  // 원문이라 압축하지 않고 그대로 붙인다 — job_ksco/affiliation처럼
  // "정보"가 아니라 "행동 규칙"이라 요약하면 의미가 소실된다. getPdvDomain()이
  // 'work'일 때만 붙여 개인 모드 turn의 토큰 비용을 늘리지 않는다.
  try {
    if (getPdvDomain() === 'work') {
      const jobAssistText = await _fetchUniversalJobAssist();
      if (jobAssistText) parts.push(`[업무보조원칙]\n${jobAssistText}`);
    }
  } catch {}

  // v1.6 — 최초 인사/이름짓기 1회성 블록(있을 때만, 평생 1~2턴)
  const firstContact = _buildFirstContactContext();

  // HONDI-FAQ(2026-07-01 신설) — 혼디 생태계 지식(PDV·GDC·OpenHash 등)을
  // AGENT-COMMON에 전부 넣는 대신, 사용자 발화 키워드가 매칭될 때만 해당
  // 주제의 상세 설명을 이번 턴의 user 메시지에만 끼워 넣는다(system
  // prefix는 그대로라 DeepSeek 캐시 적중률에 영향 없음). industry-router.js
  // 와 동일한 "키워드 매칭 → 필요한 것만 로드" 패턴 — 자세한 설계 근거는
  // hondi-faq-router.js 상단 주석 참조.
  const plainText = typeof userContent === 'string'
    ? userContent
    : (Array.isArray(userContent) ? (userContent.find(c => c.type === 'text')?.text || '') : '');
  const faqBlock = await buildHondiFaqContext(plainText);

  // 3단계(2026-07-09) — 처분성/기관 신호가 감지된 턴에만 UNIVERSAL-
  // INTEGRITY를 이번 턴의 user 메시지에만 끼워 넣는다(system prefix는
  // 그대로 — HONDI-FAQ와 완전히 동일한 캐시 보존 원칙). "트랙 무관 전체
  // SP 최상위 공통 원칙"이라는 UNIVERSAL-INTEGRITY 자신의 설명과 달리
  // 지금까지 메인 채팅(AGENT-COMMON)에는 한 번도 주입된 적이 없었다
  // (2026-07-09 발견) — 매 턴 무조건 넣으면 토큰비용이 전체 트래픽의
  // 압도적 다수인 메인 채팅에 계속 붙고, 아예 안 넣으면 그 선언이
  // 거짓이 된다. _estimateGovImportance의 점수 게이트로 절충한다.
  const integrityBlock = await _buildUniversalIntegrityContext(plainText);

  // 정부24 공유문서 확인(2026-07-09 신설) — firstContact와 마찬가지로
  // 1회성 이벤트 트리거형 컨텍스트라 같은 우선순위대에 둔다.
  const shareBlock = _buildShareInboxContext();

  // 주기적 PDV 검토(2026-07-13 신설) — firstContact/shareBlock과 동일한
  // 1회성(이번엔 "주기적 1회") 트리거 패턴.
  const pdvReviewBlock = _buildPdvReviewContext();

  // job_ksco 재확인(2026-07-14 신설, 구멍 E) — 위와 별개 타이머·대상.
  const jobKscoReviewBlock = _buildJobKscoReviewContext();

  // AC↔PA 실시간 채널(2026-07-27 신설) — PA 세션이 막 끝났을 때만 1회.
  const paHandoffBlock = _buildPaHandoffContext();

  // 라우팅 힌트(2026-08-08 신설, routing-hint.js) — 0단계(prefilter)+
  // 1단계(domain-classifier)로 좁힌 GWP/EXPERT 후보를 이번 턴의 parts에
  // 얹는다. AC-PRO-CORE(system, 캐시 고정) 자체는 안 건드린다 — 위
  // _buildEnhancedUserContent 헤더 주석의 캐싱 원칙과 동일하게, 매 턴
  // 바뀌는 신호이므로 여기(user 메시지 앞 [ctx])에만 둔다. 실패해도
  // routing-hint.js 자체가 빈 문자열로 안전 폴백하므로 여기선 그냥
  // 있으면 push한다.
  try {
    const routingHint = await buildRoutingHintPart(plainText, window.GWP_REGISTRY, EXPERT_REGISTRY);
    if (routingHint) parts.push(routingHint);
  } catch (e) {
    console.warn('[RoutingHint] 통합 지점에서 실패(무시):', e.message);
  }

  if (!parts.length && !firstContact && !faqBlock && !integrityBlock && !shareBlock && !pdvReviewBlock && !jobKscoReviewBlock && !paHandoffBlock) return userContent;

  const ctxBlock = integrityBlock + shareBlock + pdvReviewBlock + jobKscoReviewBlock + paHandoffBlock + firstContact + faqBlock + (parts.length ? `[ctx]\n${parts.join('\n')}\n\n` : '');

  // multipart(이미지 포함) 메시지 처리
  if (Array.isArray(userContent)) {
    return [{ type: 'text', text: ctxBlock }, ...userContent];
  }
  return ctxBlock + (userContent || '');
}

// ══════════════════════════════════════════════════════════════

export function stopGeneration() {
  if (_currentAbort) {
    console.log('[AI] 사용자 요청으로 응답 생성 중지');
    _currentAbort.abort();
  }
}

function _setSendBtnGenerating(active) {
  const btn = document.getElementById('send-btn');
  if (!btn) return;
  btn.classList.toggle('generating', active);
  if (active) {
    btn.disabled = false; // 생성 중에는 항상 클릭 가능해야 중지 버튼으로 동작
  } else {
    const input = document.getElementById('msg-input');
    btn.disabled = !(input && input.value.trim());
  }
}

// callAI는 얇은 래퍼 — 실제 로직(_callAIInner)이 어떤 경로로 끝나든(정상 종료/
// 에러/중지) try/finally가 버튼 상태와 AbortController를 항상 정리한다.
// [2026-08-06 신설] 5번째 인자 onFailure — 오케스트레이션 홉으로 호출된 경우
// (_handleOrchestrationTags의 워치독) 실패를 이 콜백으로 받아 AC 복구 판단으로
// 돌릴 수 있게 한다. 기본값 null이면 기존과 동일하게 _callAIInner가 직접
// "⚠️ API 오류" 말풍선을 띄운다(메인 채팅 최상위 호출 등 기존 동작 보존).
// [2026-08-06 신설 — 메인 채팅/패널 통합 1단계] 6번째 인자 bubbleTarget —
// ui/bubble.js가 어느 DOM 컨테이너(#message-list vs #ai-panel-messages
// 등)에 버블을 그릴지 지정한다. **"넘기면 바꾸고, 안 넘기면 그대로 둔다"**가
// 핵심 — _handleOrchestrationTags 등의 재귀 sendFn(...) 호출 47곳은 아무도
// 이 인자를 넘기지 않으므로, 최상위 호출(예: 패널의 send 핸들러)이 턴 시작
// 시점에 한 번 지정한 컨테이너를 체인 전체가 그대로 상속한다 — 매 호출마다
// 인자를 스레딩할 필요가 없다. bubble.js의 setBubbleTarget 주석 참고.
export async function callAI(userText, imageFile = null, _preTab = null, modelTier = null, onFailure = null, bubbleTarget = null) {
  if (bubbleTarget) setBubbleTarget(bubbleTarget);
  // 2026-08-07 신설 — 지역 변수로 스냅샷을 잡아둔다. kestate/ktelecom
  // switch-type 자동복구(4262행 근처 fire-and-forget IIFE)처럼 이 callAI
  // 실행 도중 또 다른 callAI()가 재귀 호출되면, 바깥쪽의 이 finally가
  // 안쪽 호출이 막 세팅한 _currentAbort를 지워버릴 수 있다 — 코드 자체에
  // 이미 "미검증 잔여 리스크"로 남겨져 있던 문제(주석 참고). 아래
  // compare-and-clear로 막는다: 자신이 만든 AbortController가 아직도
  // 현재 값일 때만 정리한다.
  const myAbort = new AbortController();
  _currentAbort = myAbort;
  _setSendBtnGenerating(true);
  try {
    await _callAIInner(userText, imageFile, _preTab, modelTier, onFailure);
  } catch (e) {
    // 2026-09-12 신설(주피터 지시: "어떤 경우에도 혼디가 응답하지 않으면
    // 안 됩니다") — 지금까지 이 바깥쪽 wrapper는 try/finally만 있고
    // catch가 없었다. _callAIInner 내부의 거의 모든 실패 경로는 자체적
    // 으로 appendBubble을 호출해 처리하지만, 그 방어망을 통과하는 예외
    // (네트워크 완전 단절, 코드 상의 예상 못한 TypeError 등)가 하나라도
    // 발생하면 이 함수가 그대로 reject되고, 호출부(send-message.js의
    // 세 지점)엔 이걸 받는 catch가 없어 조용히 사라졌다 — 사용자에게는
    // "입력 중..." 표시나 빈 말풍선만 남고 아무 응답도 오지 않는 것으로
    // 보였다(2026-09-12 실사용 재현). 원인이 무엇이든 최후의 안전망으로
    // 여기서 반드시 사용자에게 보이는 응답을 하나 남긴다.
    console.error('[callAI] 처리되지 않은 오류 — 최후 안전망으로 대체 응답 표시:', e);
    try { hideTyping(); } catch {}
    try {
      appendBubble('ai',
        '⚠️ 잠시 응답을 생성하지 못했습니다. 네트워크 상태를 확인하시고 다시 시도해 주세요.',
        true);
    } catch {}
  } finally {
    _setSendBtnGenerating(false);
    if (_currentAbort === myAbort) {
      _currentAbort = null;
    }
    // 2026-08-28 신설 — GDC 차감 후 UI 미반영 문제의 근본 수정.
    // worker.js의 실제 정산(_settleAiUsage)은 SSE 스트림이 이미
    // 클라이언트로 완전히 전달된 *이후*, res.body.tee()로 분리한
    // 사본을 파싱하는 fire-and-forget 작업(ctx.waitUntil)으로
    // 실행된다 — 즉 스트림 종료 시점엔 서버 정산이 아직 안 끝났을
    // 수 있어, 응답 자체에 새 잔액을 실어 보낼 방법이 구조적으로
    // 없다(worker.js 17172행 근처). 그래서 클라이언트가 짧게 기다린
    // 뒤 직접 재조회하는 방식을 택한다 — 1.5초는 정산 완료를 보장하는
    // 값은 아니지만(비동기 완료 시점을 클라이언트가 알 방법이 없다),
    // 지금까지의 "재로그인 전까지 영원히 미반영"보다는 훨씬 낫다.
    // 완전한 보장이 필요하면 서버에 정산-완료 알림(SSE 이벤트 등)을
    // 추가하는 후속 작업이 필요함을 남겨둔다.
    if (window.gopangWallet?.refreshBalanceUI) {
      setTimeout(() => window.gopangWallet.refreshBalanceUI().catch(() => {}), 1500);
    }
  }
}

// ── 호출 후보 목록 생성 ────────────────────────────────────
// 우선순위는 getPriorityOrder()(config.js)가 결정한다. 기본값은
// OpenRouter(무료풀) → Claude → Gemini → DeepSeek → ChatGPT → Grok 이지만,
// 사용자가 ai-setup-mobile.html에서 드래그로 순서를 바꿨으면 그 순서가 우선 적용된다.
// → 마지막 안전망으로 고팡 프록시(키 불필요)
// OR 풀 내부는 기본적으로 컨텍스트·파라미터 기준 품질 순서다. 단, Claude·Grok이
// OpenRouter에 무료 모델을 새로 올리면 free-model-pool.js가 발견 즉시 풀 최상단으로
// 자동 승격한다(OR_AUTO_PROMOTE_VENDORS 참고) — 오늘은 보통 해당 없음.
// 등록된(키 입력된) provider만 후보가 되며, 한도 초과(429)·크레딧부족(402)·404 등
// 모든 실패 상황에서 callAI()가 다음 후보로 자동 전환한다.
// OR 후보는 추가로 (1) 24h 쿨다운 캐시, (2) 분당 호출 예산 두 가지 필터를 통과해야 한다.
// ══════════════════════════════════════════════════════════
// 자동 Pro 승격 판단 (v1, 2026-07-01)
// ══════════════════════════════════════════════════════════
// 사용자는 더 이상 Flash/Pro를 직접 고르지 않는다. 이번 턴의 질문이
// "복잡하다"고 판단되면 그 턴 한 번만 자동으로 hondi-pro를 쓰고,
// 나머지는 전부 hondi-flash를 쓴다 — 세션 전체를 Pro로 고정하는 것보다
// 무료 한도를 훨씬 아낄 수 있다.
//
// K-Law·K-Tax 같은 전문 분야 계산/추론은 이미 router.js가 별도 SP로
// 라우팅하므로, 여기서 잡아야 하는 "복잡함"은 그 라우팅 이전에
// AGENT-COMMON 자신이 직접 처리해야 하는 것들이다: 여러 조건이 얽힌
// 계획·일정, 코드 작성/디버깅, 여러 항목 비교, 명시적으로 "차근차근/
// 단계별로" 를 요구하는 요청 등.
//
// 판단을 위해 LLM을 한 번 더 부르면 지연·비용이 배가되므로, 여기서는
// 휴리스틱(키워드+구조적 신호) 점수제만 쓴다. 애매하면 Flash 쪽으로
// 기운다(비용 보수적) — 임계값은 실사용 로그를 보면서 조정할 것.
const _COMPLEXITY_PATTERNS = [
  /코드|버그|디버그|에러|함수|변수|스크립트|알고리즘/,      // 코드/디버깅
  /계산|환산|이자율|퍼센트|%|비율|합계|평균/,                // 수치 연산
  /비교해|장단점|어느\s*게|뭐가\s*더|중\s*(뭐|어떤)/,        // 비교/선택
  /만약|~라면|그리고\s*나서|단계별로|차근차근|순서대로/,      // 조건부·다단계
  /일정.*예산|예산.*이내|계획.*세워|동선/,                   // 복수 제약 계획
];
const COMPLEXITY_PRO_THRESHOLD = 3; // 이 점수 이상이면 이번 턴만 Pro

function _estimateQueryComplexity(userText, messages) {
  const text = typeof userText === 'string' ? userText.trim() : '';
  let score = 0;

  if (text) {
    // 1) 길이 — 길수록 여러 조건·맥락이 얽혀 있을 가능성이 높다
    if (text.length > 400) score += 2;
    else if (text.length > 180) score += 1;

    // 2) 한 메시지에 여러 요청이 겹쳐 있는지(물음표 반복, 목록형 나열)
    const qMarks = (text.match(/\?/g) || []).length;
    if (qMarks >= 2) score += 1;
    if (/\n\s*[-*\d]/.test(text)) score += 1;

    // 3) 키워드 신호 — 패턴당 1점
    for (const re of _COMPLEXITY_PATTERNS) {
      if (re.test(text)) score += 1;
    }
  }
  // ★ 2026-07-27 수정 — 이전엔 userText가 비어있으면(예: 내부 트리거
  // 메시지가 예외적으로 빈 문자열인 경우) 함수가 여기서 0을 즉시
  // 반환해 아래 4)·5)의 맥락 신호를 아예 평가하지 않았다. text가
  // 비어도 messages 기반 신호는 계속 평가하도록 조기 반환을 없앴다.

  // 4) 같은 주제로 대화가 이미 길게 이어지는 중이면(복잡한 작업 진행 중일 가능성)
  if (Array.isArray(messages) && messages.length >= 10) score += 1;

  // 5) 맥락/기억 부담 신호 (2026-07-27 신설 — AGENT-COMMON v3.46과 짝)
  //    배경: AC_lifelong_assistant_100case_audit_2026-07-27.md에서
  //    "이전 대화를 자연스럽게 잇기", "여러 정체성 정보를 한 번에
  //    자연스럽게 반영하기", "프로필 유도(§0-1-P[6])와 주기적 PDV
  //    검토(§0-1-P[7])가 겹칠 때 중복 없이 조율하기" 같은 사회적·
  //    맥락적 판단이 필요한 턴이 다수 발견됐는데, 위 1~4)는 전부
  //    기술적 복잡도(코드·수치·비교·다단계·긴 대화)만 감지해서 이런
  //    턴은 매번 hondi-flash로 처리되고 있었다. messages의 마지막
  //    user 메시지(=_buildEnhancedUserContent가 만든 동적 컨텍스트,
  //    userText와 달리 [ctx] 마커들이 실제로 여기 실린다)를 훑어
  //    이런 신호가 있는지 본다.
  if (Array.isArray(messages) && messages.length) {
    const lastContent = messages[messages.length - 1]?.content;
    const ctxText = typeof lastContent === 'string' ? lastContent : '';
    if (ctxText) {
      const hasPdvNote     = ctxText.includes('[PDV 최근 기록');   // _buildPDVNote() 마커 — 과거 기록을 이번 응답에 자연스럽게 이어붙여야 함
      const hasReviewDue   = ctxText.includes('[PDV_REVIEW_DUE');  // §0-1-P[7] 주기 검토 판단이 필요한 턴
      const hasProfileFlag = ctxText.includes('프로필:미완성');     // §0-1-P[6] 대상

      // 정체성 컨텍스트(직업/소속/업무상태/배정업무)가 한 턴에 2개
      // 이상 겹치면, 그중 무엇을 이번 응답에 자연스럽게 반영할지
      // 스스로 골라야 해서 판단 부담이 커진다.
      const identityCount = ['직업:', '소속:', '업무상태:', '배정된업무(']
        .filter(marker => ctxText.includes(marker)).length;

      if (hasPdvNote) score += 1;
      if (identityCount >= 2) score += 1;
      if (hasReviewDue) score += 1;
      // §0-1-P[10](신설)이 요구하는 가장 까다로운 조율 — [6]/[7]이
      // 같은 턴에 겹치는 경우. 이 조합만으로도 임계값에 도달하도록
      // 가중치를 높게 둔다(hasReviewDue의 +1과 합쳐 총 +3).
      if (hasReviewDue && hasProfileFlag) score += 2;
    }
  }

  return score;
}

// _buildCallCandidates() 및 웹앱 AI 패널(webapp.html)이 공용으로 쓴다.
// 반환값은 실제 벤더 모델명이 아니라 "hondi-flash"/"hondi-pro" 논리
// 이름 — worker.js가 실제 백엔드로 매핑한다.
export function _resolveHondiTier(userText, messages) {
  const score = _estimateQueryComplexity(userText, messages);
  if (score >= COMPLEXITY_PRO_THRESHOLD) {
    console.log(`[Hondi Tier] 복잡도 점수 ${score} → hondi-pro 자동 승격`);
    return 'hondi-pro';
  }
  return 'hondi-flash';
}

// ══════════════════════════════════════════════════════════
// 대화 중요도 기반 무결성 검증 등급 (v0.1, 2026-07-09 신설 — 관찰 전용)
// ══════════════════════════════════════════════════════════
// 배경: "메인 채팅은 클라이언트가 조립 → 서버는 프록시만" vs "GWP 서비스는
// 서버가 직접 조립·위임"이라는 신뢰경계 이원화가 원칙 없이 역사적으로
// 갈라져 있었다(2026-07-09 발견). src/openhash/importanceVerifier.js가
// GDC 거래에 이미 쓰고 있는 "중요도 점수 → LIGHTWEIGHT/STANDARD/ENHANCED
// 3단 검증" 패턴을 그대로 재사용해, 대화의 위험/이해관계 크기에 따라
// 검증 비용을 달리 매기는 쪽으로 통일한다 — 오픈해시 철학(탈중앙화·
// 검증가능성 우선, 항상 서버가 통제하지 않음)과 GWP 수준 보안(고위험
// 사안은 서버가 직접 통제)을 동시에 만족시키는 절충안.
//
// ★ 이번 커밋은 "1단계: 점수 함수만" — 실제 라우팅/서버 검증 게이트에는
// 아직 연결하지 않는다(2단계: hashChain.js 앵커링, 3단계: worker.js
// 검증 게이트는 별도 작업). 지금은 콘솔 로그로만 관찰 가능하다.
//
// 점수 공식(importanceVerifier.js와 동일한 가중합 스타일):
//   score = w1·f_category + w2·f_disposition + w3·f_delegation
//   w1=0.5, w2=0.3, w3=0.2
//   응급 신호(kemergency 트리거)는 다른 모든 계산을 생략하고 즉시 100점
//   (gopang 저장소 자신의 src/gopang/gov/gov-router.js가 EMERGENCY_RE 정규식으로
//   구현한 _isEmergency() 하드 게이트와 같은 원칙 — 응급은 예외 없이
//   최고 등급. ★ 2026-07-21 리팩터링으로 이 함수는 별도 jeju 저장소에서
//   gopang 자신의 gov-router.js로 이전됐다(jeju-router.js는 현재 gov-router.js를
//   그대로 재수출하는 얇은 wrapper — export * from '.../gov-router.js').
//   ★ 2026-07-11 확인(2026-07-31 위치만 정정): 이 파일의 kemergency triggers 배열과
//   gov-router.js의 EMERGENCY_RE는 서로 다른 파일에 독립적으로 존재하는
//   별개 키워드 세트다 — 겹치지만 동일하지 않음(예: EMERGENCY_RE에는
//   '자살'·'납치'·'스토킹'·'침입'이 있는데 triggers 배열엔 없음). 하나만
//   갱신되면 다른 하나가 낡는 drift 위험이 실재한다 — 통합 검토 필요.)
//
// 임계값은 IMPORTANCE(core/constants.js)를 그대로 재사용한다 — GDC
// 거래용으로 이미 실측 조정된 값(25/60)을 대화에도 동일 기준으로
// 적용해, 나중에 하나의 "중요도 사상"으로 합칠 여지를 남긴다.

export const GOV_VERIFICATION_MODE = Object.freeze({
  LIGHTWEIGHT: 'LIGHTWEIGHT', // 지금의 메인 채팅과 동일 — 클라이언트 조립, 서버는 프록시
  STANDARD:    'STANDARD',    // 서버가 system 메시지 중 UNIVERSAL-INTEGRITY 부분만 해시 대조(2단계 예정)
  ENHANCED:    'ENHANCED',    // 지금의 /gov/relay와 동일 — 서버가 직접 조립·위임까지 통제
});

// 카테고리별 기본 위험 가중치(0~100) — GWP_REGISTRY의 category 필드 기준.
// EMG는 별도로 즉시 100점 처리하므로 여기엔 없다(도달 안 함).
const _GOV_CATEGORY_WEIGHT = Object.freeze({
  GOV: 90, JUS: 85, MED: 80,           // 행정/사법/의료 — 처분성·법적효력 가능성 높음
  ECO: 60, LEG: 55,                     // 금융/입법 — 중간
  BIZ: 40, EDU: 35, TRN: 30,            // 사업/교육/교통 — 낮은 편
  ENV: 20, MKT: 15,                     // 환경신고/거래 — 더 낮음
  UTL: 5, TOOL: 5,                      // 검색·도구성 — 거의 무위험
});
const _GOV_CATEGORY_DEFAULT_WEIGHT = 10; // 매칭된 GWP 서비스가 없는 일반 잡담

// 처분성(법적 확정 효력) 신호 — GOV-COMMON-OVERLAY §3/JEJU-TREE-PROTOCOL이
// 이미 "처분성 있는 사안"이라 부르는 것과 같은 개념을 텍스트 신호로 근사.
const _DISPOSITION_PATTERN =
  /확정|승인|발급|접수(?:번호)?|신청서?\s*제출|과세|처분|허가|지급\s*결정|자격\s*판정|등록\s*완료/;

// SP_DELEGATION_ORIGINATORS(worker.js)와 동일한 3개 — 이미 서버측
// 위임 오케스트레이션 대상으로 지정된 agency는 그 자체로 "이해관계가
// 크다"는 신호로 본다(worker.js 목록과 이름을 반드시 맞출 것 — 어긋나면
// 이 신호가 조용히 무의미해진다).
const _GOV_DELEGATION_AGENCIES = new Set(['public', 'jeju_do', 'jeju_national']);

/**
 * 대화 한 턴의 중요도 점수를 매긴다(0~100).
 * @param {string} userText - 사용자 발화
 * @param {object|null} gwpEntry - gwp-registry.js의 매칭된 서비스 항목(getService(id) 결과) 또는 null
 * @returns {number} 0~100
 */
export function _estimateGovImportance(userText, gwpEntry = null) {
  const text = typeof userText === 'string' ? userText : '';

  // 응급은 예외 없이 최우선 — gopang 자신의 src/gopang/gov/gov-router.js의
  // _isEmergency() 정규식 하드 게이트와 동일 원칙(★ 2026-07-21 리팩터링으로
  // 이 함수가 별도 jeju 저장소에서 gopang 자신의 gov-router.js로 이전됨 —
  // jeju-router.js는 현재 gov-router.js를 그대로 재수출하는 얇은 wrapper다.
  // 2026-07-11 주석은 당시 위치 기준이었을 뿐 오해가 아니었으나, 2026-07-31
  // 기준으로는 이 파일 경로가 최신이다).
  // kemergency의 triggers 배열을 재사용하지만, gov-router.js의
  // EMERGENCY_RE와 키워드가 완전히 같지는 않다(drift 있음 — 위 주석 참고).
  if (typeof getService === 'function') {
    const emg = getService('kemergency');
    if (emg && Array.isArray(emg.triggers) && emg.triggers.some(t => text.includes(t))) {
      return 100;
    }
  }

  const category = gwpEntry?.category;
  const fCategory = category != null
    ? (_GOV_CATEGORY_WEIGHT[category] ?? _GOV_CATEGORY_DEFAULT_WEIGHT)
    : _GOV_CATEGORY_DEFAULT_WEIGHT;

  const fDisposition = _DISPOSITION_PATTERN.test(text) ? 100 : 0;

  const fDelegation = gwpEntry?.id && _GOV_DELEGATION_AGENCIES.has(gwpEntry.id) ? 100 : 0;

  const score = 0.5 * fCategory + 0.3 * fDisposition + 0.2 * fDelegation;
  return Math.min(100, Math.max(0, score));
}

/**
 * 점수 → 검증 등급. importanceVerifier.js의 selectMode()와 완전히 동일한
 * 임계값(IMPORTANCE.LIGHTWEIGHT_MAX=25, STANDARD_MAX=60)을 재사용한다.
 * @param {number} score
 * @returns {'LIGHTWEIGHT'|'STANDARD'|'ENHANCED'}
 */
export function _selectGovVerificationMode(score) {
  if (score < IMPORTANCE.LIGHTWEIGHT_MAX) return GOV_VERIFICATION_MODE.LIGHTWEIGHT;
  if (score < IMPORTANCE.STANDARD_MAX) return GOV_VERIFICATION_MODE.STANDARD;
  return GOV_VERIFICATION_MODE.ENHANCED;
}

// ══════════════════════════════════════════════════════════
// 2단계 — LIGHTWEIGHT 등급 대화도 검증 가능하게 앵커링 (2026-07-09 신설)
// ══════════════════════════════════════════════════════════
// "막지는 않지만 나중에 누구나 검증 가능하게" — 오픈해시 철학의 핵심.
// p2p-chat.js _saveP2PSession()의 앵커링 패턴(contentHash=SHA-256(JSON)
// → gopangWallet.sign → hashChain.anchor)을 그대로 따르되, 두 가지를
// 더한다:
//   1) systemHash — 이번 턴에 실제로 전송된 system 프롬프트(CFG.system)의
//      해시. UNIVERSAL-INTEGRITY/AGENT-COMMON 원문은 공개 GitHub 저장소에
//      있으므로, 누구든 그 시점 버전의 해시를 직접 계산해 이 앵커와
//      대조하면 "그 세션에 정말 그 내용이 포함됐는지"를 검증할 수 있다
//      (서버가 강제하는 게 아니라 사후 검증 가능하게 만드는 것 — GWP의
//      /gov/relay처럼 서버가 막는 방식과는 다른 신뢰 모델).
//   2) govScore/govMode — _estimateGovImportance()/_selectGovVerificationMode()
//      결과를 anchor()의 lcat/score 인자로 그대로 전달한다. PLSM
//      selectLayer()가 이미 score<IMPORTANCE.LIGHTWEIGHT_MAX 기준으로
//      계층을 나누도록 설계돼 있어(plsm.js), 대화 앵커링에 score를 넘긴
//      건 이번이 처음이지만 인프라 자체는 이미 이 용도로 설계돼 있었다.
//
// PDV 원칙(§5)과 동일하게 원문이 아니라 해시만 남긴다 — userText/fullReply
// 원문은 앵커에 포함하지 않는다.
async function _anchorGovChain(userText, fullReply) {
  // [GWP: id] 태그가 있으면 그 서비스를 gwpEntry로 사용 — _parseAgentTags의
  // 매칭 정규식과 동일(따로 만들지 않음, 하나 바뀌면 둘 다 갱신해야
  // 하는 문제 방지 목적으로 여기서도 같은 패턴을 그대로 재사용).
  const gwpMatch = fullReply.match(/\[GWP:\s*([\w-]+)\]/);
  const gwpEntry = gwpMatch && typeof getService === 'function' ? getService(gwpMatch[1]) : null;

  const score = _estimateGovImportance(userText, gwpEntry);
  const mode = _selectGovVerificationMode(score);

  if (!_USER?.ipv6) return; // 미등록/게스트는 서명 주체가 없어 앵커링 생략

  const msgId = `GOVCHAT-${_USER.ipv6.replace(/:/g, '').slice(0, 12)}-${Date.now()}`;

  const systemHash = CFG.system
    ? await _sha256Hex(CFG.system)
    : null;
  const userTextHash = userText ? await _sha256Hex(userText) : null;
  const replyHash = await _sha256Hex(fullReply);

  const envelope = {
    msgId,
    ts: new Date().toISOString(),
    gwpId: gwpEntry?.id ?? null,
    systemHash,
    userTextHash,
    replyHash,
    govScore: score,
    govMode: mode,
  };
  const envelopeRaw = JSON.stringify(envelope);
  const contentHash = await _sha256Hex(envelopeRaw);

  let userSig = _USER.ipv6;
  try {
    if (window.gopangWallet?.sign) {
      userSig = await window.gopangWallet.sign(contentHash);
    }
  } catch (e) {
    console.warn('[GovChain] Ed25519 서명 실패, guid로 대체:', e.message);
  }

  const { anchor } = await import('../../openhash/hashChain.js');
  const result = await anchor(contentHash, [userSig], msgId, 'gov_chat', score);
  console.info('[GovChain] 앵커링 완료',
    '| mode:', mode, '| score:', score.toFixed(1),
    '| entryHash:', result.entryHash?.slice(0, 16), '| layer:', result.layer);
  return result;
}

async function _sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function _buildCallCandidates(userText, messages, modelTier = null) {
  const candidates = [];

  // 1) 사용자가 등록한 provider 키들 (ai-setup-mobile.html에서 등록)
  //    저장 순서와 무관하게 PRIORITY_ORDER(OR→Claude→Gemini→DeepSeek→ChatGPT→Grok)로
  //    항상 재정렬 — 키가 등록된 provider만 그 순서대로 호출된다.
  if (Array.isArray(CFG.providers)) {
    const priorityOrder = getPriorityOrder();
    const sorted = [...CFG.providers].sort((a, b) => {
      const ia = priorityOrder.indexOf(a?.provider);
      const ib = priorityOrder.indexOf(b?.provider);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });

    for (const p of sorted) {
      if (!p?.apiKey || !p?.model) continue;
      const info = PROVIDER_INFO[p.provider];
      if (!info) continue;

      candidates.push({
        provider: p.provider,
        baseUrl:  (p.baseUrl || info.baseUrl).replace(/\/+$/, ''),
        model:    p.model,
        apiKey:   p.apiKey,
        isProxy:  false,
      });
    }
  }

  // 2) 하위 호환 — CFG.apiKey/geminiKey 단일 키만 있던 기존 사용자
  if (!candidates.some(c => !c.isProxy)) {
    if (CFG.apiKey && !CFG.endpoint.includes('workers.dev')) {
      candidates.push({
        provider: 'legacy', baseUrl: CFG.endpoint.replace(/\/+$/, ''),
        model: CFG.model, apiKey: CFG.apiKey, isProxy: false,
      });
    } else if (CFG.geminiKey) {
      candidates.push({
        provider: 'gemini', baseUrl: PROVIDER_INFO.gemini.baseUrl,
        model: CFG.model.startsWith('gemini') ? CFG.model : 'gemini-2.5-flash',
        apiKey: CFG.geminiKey, isProxy: false,
      });
    }
  }

  // 3) 최종 안전망 — 혼디 제공 DeepSeek 기본 키 (v3.2, 2026-07-01)
  // 사용자 키 등록 여부와 무관하게 항상 마지막 후보로 추가된다. 서버가
  // 자신의 키로 호출하므로 클라이언트는 apiKey가 필요 없다 — "1,000원 무료
  // 제공" 정책의 실제 구현체. model은 실제 벤더 모델명이 아니라 "hondi-flash"/
  // "hondi-pro" 논리 티어 이름이며, worker.js가 실제 백엔드(공식 DeepSeek API
  // 또는 나중에 붙을 혼디 자체 추론 서버)로 매핑한다.
  // v3.2: 사용자가 직접 고르던 Flash/Pro 수동 선택을 제거하고, 이번 턴
  // 질문의 복잡도를 보고 _resolveHondiTier()가 자동으로 고른다.
  // v4.0(2026-07-28, Pro/Flash 재설계): 주피터님 지시 — "AC는 처음부터
  // deepseek v4 pro를 디폴트로 호출". _resolveHondiTier()의 복잡도 점수
  // 산정은 "판단력이 약한 flash를 언제 pro로 승격할지"를 결정하던
  // 로직이었는데, 이제 기본 판단 주체 자체가 pro라 이 질문 자체가
  // 사라진다. hondi-pro를 기본값으로 쓴다. _resolveHondiTier/
  // _estimateQueryComplexity 함수는 삭제하지 않고 남겨둔다 — pro가
  // §DELEGATE로 flash에 위임할지 판단하는 보조 신호로 재활용할 여지가
  // 있다(현재는 pro 스스로 판단, 이 점수를 참조하지 않음).
  //
  // v4.1(2026-08-05, HANDOFF_2026-08-05_live-smoketest-latency-and-empty-
  // content.md §4-2): modelTier 인자 신설 — _handleOrchestrationTags의
  // "단순 분기·재주입 소비" 홉이 매번 hondi-pro(thinking 켜짐)를 그대로
  // 물려받아 오케스트레이션 체인 전체가 순차·전부 무거운 호출이 되던
  // 문제를 해소한다. 최초 AC 호출(모드 인자 없음)은 여전히 hondi-pro
  // 기본값 그대로 — v4.0 결정을 뒤집는 게 아니라, 그 이후 재주입 턴에만
  // 선택적으로 더 가벼운 티어를 쓸 길을 연다(판단 기준은
  // token-policy.js의 resolveOrchestrationModel() 한 곳).
  //
  // v5.0(2026-08-06, 주피터님 지시 — v4.0을 뒤집음): 라이브 재검증에서
  // AC의 hondi-pro thinking 모드가 매 턴 20~30초를 잡아먹으면서도
  // 문서형 응답을 계속 쏟아내는 게 확인됐다("판단력이 필요해서 pro가
  // 낫다"는 v4.0의 전제와 달리, 응답 품질(대화 스타일 준수) 문제는
  // CONTROL-TOWER-PRINCIPLE 프롬프트 상속·_enforceConversationalStyle
  // 코드 강제로 별도 대응 중이라 pro 고정이 그 문제를 안 풀어줬다).
  // "flash를 디폴트로 하고 필요 시 pro를 호출"로 원칙을 다시 뒤집는다
  // — _resolveHondiTier()가 이미 갖고 있던 복잡도 채점(PDV 컨텍스트
  // 중첩·정체성 신호 다중 등)을 다시 실제 판단 근거로 쓴다. 호출부
  // (webapp.html _sendToAI 등)가 이제 이 함수를 직접 불러 modelTier를
  // 명시적으로 채워 넘기므로, 여기 폴백(모델 인자 자체가 안 넘어온
  // 드문 경우 대비)도 안전한 쪽(빠른 flash)으로 맞춘다.
  candidates.push({
    provider: 'deepseek-default',
    baseUrl:  CFG.endpoint.replace(/\/+$/, ''),
    model:    modelTier || 'hondi-flash',
    apiKey:   null,
    isProxy:  true,
  });

  // 모델명 교정 — config.js의 MODEL_MIGRATION을 여기 한 곳에서 일괄 적용한다.
  // (desktop.html의 구형 선택값, DEV_MODE 주입값 등 출처가 어디든 상관없이
  // 전부 통과하게 됨 — 만들어져 있었지만 아무 데서도 안 쓰이고 있던 맵이었음.
  // 특히 deepseek-chat/reasoner는 2026-07-24 완전히 막히므로 시급함.)
  for (const c of candidates) {
    if (MODEL_MIGRATION[c.model]) c.model = MODEL_MIGRATION[c.model];
  }

  return candidates;
}

/**
 * _callLLM — 후보 페일오버 + SSE 스트리밍을 갖춘 범용 LLM 호출 헬퍼.
 *
 * routing-engine.js 등이 메인 채팅(history/스트림 버블)과 무관하게 자체적으로
 * 구성한 messages로 LLM을 호출할 때 쓴다. _buildCallCandidates()를 그대로
 * 재사용하므로, 메인 채팅(_callAIInner)과 동일한 페일오버 순서·OR 분당 예산·
 * 24h 쿨다운 규칙을 따른다.
 *
 * (이전엔 routing-engine.js가 이 함수를 import하고 있었지만 정작 call-ai.js에
 * export가 없어서 호출하는 즉시 깨졌습니다 — "기존 callAI의 내부 fetch 분리
 * 버전"이라는 주석만 있고 실제 분리 작업이 빠져 있었습니다.)
 *
 * @param {Array<{role: string, content: any}>} messages — 이미 완성된 메시지 배열
 * @param {{max_tokens?: number, temperature?: number, bubble?: HTMLElement}} options
 *   bubble을 주면 스트리밍 중 실시간으로 그 엘리먼트에 렌더링한다(메인 채팅과
 *   동일한 _updateStreamBubble 사용). bubble이 없으면 조용히 끝까지 모아서
 *   한 번에 반환한다(streaming 여부는 API 호출 방식일 뿐, 반환값은 항상 완성된
 *   문자열이라는 점에서 호출자 입장에선 동일하다).
 * @returns {Promise<string>} 모델 응답 전체 텍스트
 */
export async function _callLLM(messages, options = {}) {
  const { max_tokens: _explicitMaxTokens, temperature = 0.6, bubble = null } = options;
  const _lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  const _lastUserText = typeof _lastUserMsg?.content === 'string' ? _lastUserMsg.content : '';
  const candidates = _buildCallCandidates(_lastUserText, messages);

  let res = null, lastErr = null, idle = null;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    // BUG-FIX(2026-07-01): 이 함수는 stopGeneration()과 무관한 별도 호출
    // 경로(핸드오프·전문가 세션 등)라 사용자 수동 중지 신호가 없다 — 순수
    // 유휴 타임아웃만 건다(45초 무진행 시 다음 후보로 페일오버).
    // 2026-0X-XX 수정 — 호출자가 max_tokens을 명시하지 않았으면(대부분의
    // 실제 호출), candidate가 hondi-pro인지 보고 그때그때 예산을 고른다
    // (resolveChatBudget). #180과 동일 클래스 결함 — hondi-pro는 thinking
    // 모드가 켜져 있어 CHAT_REPLY(800)로는 추론만 하다 끝나 45초 idle
    // 타임아웃에 걸리는 걸 실측(팀원 제보). 명시적으로 max_tokens을 넘긴
    // 호출자의 의도는 그대로 존중한다.
    const max_tokens = _explicitMaxTokens ?? resolveChatBudget(c.model);
    idle = _makeIdleAbort(_LLM_IDLE_TIMEOUT_MS, null);
    try {
      const reqBody = { model: c.model, messages, max_tokens, temperature, stream: true };
      if (!PROVIDER_INFO[c.provider]?.noStreamOptions) {
        reqBody.stream_options = { include_usage: true };
      }
      // 'legacy'(사용자가 직접 운영하는 커스텀 엔드포인트)는 알려진 벤더가
      // 아니므로 중계 허용목록에 없다 — 이 경로만 예외적으로 직접 호출한다.
      // 'deepseek-default'는 혼디 제공 무료 기본 키(hondi-flash/hondi-pro) —
      // apiKey 없이 /deepseek(서버가 자체 키·티어별 모델 매핑 처리)로 직행한다.
      const attempt = c.provider === 'legacy'
        ? await fetch(`${c.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${c.apiKey}` },
            body: JSON.stringify(reqBody),
            signal: idle.signal,
          })
        : c.provider === 'deepseek-default'
        ? await fetch(`${c.baseUrl}/deepseek`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...reqBody, guid: _USER?.ipv6 || USER_GUID || null }),
            signal: idle.signal,
          })
        : await fetch(`${CFG.endpoint.replace(/\/+$/, '')}/llm/relay`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              provider: c.provider, baseUrl: c.baseUrl, apiKey: c.apiKey,
              model: reqBody.model, messages: reqBody.messages,
              max_tokens: reqBody.max_tokens, temperature: reqBody.temperature,
              stream: true,
            }),
            signal: idle.signal,
          });
      idle.reset(); // 연결 응답 수신 — 스트리밍 구간 타이머로 리셋
      if (attempt.ok) { res = attempt; break; }
      idle.cancel();
      const errBody = await attempt.text().catch(() => '');
      lastErr = new Error(`API ${attempt.status}: ${errBody.slice(0, 300) || '응답없음'}`);
      console.warn(`[_callLLM] ${c.provider}(${c.model}) 실패(${attempt.status}) — 다음 후보로 전환`);
      continue;
    } catch (fetchErr) {
      idle.cancel();
      lastErr = (fetchErr.name === 'AbortError') ? new Error('응답 시간 초과(45초)') : fetchErr;
      continue;
    }
  }
  if (!res) throw (lastErr || new Error('모든 LLM 호출에 실패했습니다.'));

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullReply = '', buf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      idle.reset(); // 청크(또는 종료)를 받을 때마다 유휴 타이머 리셋
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') break;
        try {
          const delta = JSON.parse(payload).choices?.[0]?.delta?.content ?? '';
          if (delta) {
            fullReply += delta;
            if (bubble) _updateStreamBubble(bubble, fullReply);
          }
        } catch {}
      }
    }
  } catch (streamErr) {
    // 스트리밍 도중 유휴 타임아웃(45초 무응답)으로 중단된 경우 — 사용자가
    // 읽기 힘든 "AbortError"보다 원인이 분명한 메시지로 바꿔 던진다.
    throw (streamErr.name === 'AbortError') ? new Error('응답 시간 초과(45초, 스트리밍 중단)') : streamErr;
  } finally {
    idle.cancel();
  }
  return fullReply || '';
}

// ── hondi-flash 위임 처리 (2026-07-28 신설, Pro/Flash 재설계) ──────
// [DELEGATE_TO_FLASH: task=..., context=...] 태그를 hondi-pro가 냈을 때,
// AC-FLASH-EXECUTOR 프롬프트로 hondi-flash를 별도 호출(비스트리밍, 단발)해
// task를 실행시키고 그 결과를 최종 응답으로 채택한다. report-utils.js의
// summarizeHandoffContext6W()와 동일한 패턴(직접 fetch, 실패 시 안전 폴백)을
// 따른다 — 다만 그쪽은 요약을 JSON으로 받아 원래 흐름에 주입하는 "보조
// 호출"이고, 이건 flash의 응답을 사용자에게 보여줄 "최종 응답"으로 쓰는
// 점이 다르다.
async function _delegateToFlash(task, context) {
  const sysPrompt = await _loadFlashExecutorSP();
  if (!sysPrompt) {
    // 안전 폴백 — executor 프롬프트를 못 불러오면 위임 자체를 포기하고
    // pro에게 직접 처리하라고 되돌린다(§ESCALATE와 동일 형식으로 통일).
    return { ok: false, escalate: true, reason: 'executor_load_failed', text: '' };
  }
  try {
    // ★ 2026-07-28 수정 — guid 누락 버그. worker.js의 callDeepSeek()는
    // body.guid가 있어야 무료 한도·GDC 잔액 체크(_settleAiUsage 등)를
    // 태운다(guid 없으면 이 체크 자체가 스킵된다) — 위임 호출도 실사용량이
    // 발생하는 이상 똑같이 과금·한도 대상이어야 한다. 메인 스트리밍 호출과
    // 동일한 표현식(_USER?.ipv6 || USER_GUID || null)을 그대로 쓴다.
    // 엔드포인트도 메인 호출과 동일하게 /deepseek로 맞춘다(/chat/completions와
    // 같은 핸들러로 가긴 하지만, "혼디 제공 기본 키" 경로라는 의도를
    // 코드에서도 드러내기 위해 통일).
    const res = await fetch(CFG.endpoint.replace(/\/+$/, '') + '/deepseek', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:       'hondi-flash',
        max_tokens:  800,
        temperature: 0.3,
        stream:      false,
        guid:        _USER?.ipv6 || USER_GUID || null,
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user',   content: `task: ${task}\ncontext: ${context || '(없음)'}` },
        ],
      }),
    });
    if (res.status === 402) {
      // 무료 한도 소진 + GDC 잔액 부족 — pro에게 되돌려봤자 pro의 다음
      // 호출도 같은 guid로 같은 벽에 부딪힌다. 에스컬레이션 재시도를
      // 소모하지 않고 즉시 이용자에게 정직한 안내로 종료한다.
      let msg = '무료 한도를 모두 사용했고 GDC 잔액도 부족합니다. GDC를 충전한 뒤 다시 이용해 주세요.';
      try { const errData = await res.json(); if (errData?.message) msg = errData.message; } catch {}
      return { ok: false, escalate: false, insufficientBalance: true, text: msg };
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';

    // flash가 §ESCAPE로 되돌린 경우 감지
    const escMatch = text.match(/\[ESCALATE_TO_PRO:\s*reason=([^,\]]+)(?:,\s*(?:signal|note)=([^\]]+))?\]/);
    if (escMatch) {
      return { ok: false, escalate: true, reason: escMatch[1].trim(), detail: (escMatch[2] || '').trim(), text: '' };
    }
    if (!text.trim()) {
      return { ok: false, escalate: true, reason: 'empty_response', text: '' };
    }
    return { ok: true, escalate: false, text };
  } catch (e) {
    console.warn('[Delegate] hondi-flash 위임 실패(무시 — pro로 되돌림):', e.message);
    return { ok: false, escalate: true, reason: 'fetch_error', detail: e.message, text: '' };
  }
}

// sendFn(=callAI)로 되돌릴 때 쓸 재시도 상한 — 위임↔에스컬레이션이 서로를
// 계속 부르는 무한루프를 막는다. 세션 전역이 아니라 이 모듈 스코프 카운터로,
// 탭 새로고침 시 자연히 리셋된다(영구 저장 불필요 — 한 세션의 이상 상태
// 방지가 목적).
let _delegateRetryCount = 0;
const _DELEGATE_RETRY_MAX = 2;

// ── [대화 스타일] 코드 층 강제 — 2026-08-06 신설, 2026-08-06 재배선 ──
// SP-22(K-Execute)/SP-21(K-Deliver)·CONTROL-TOWER-PRINCIPLE(모든 SP
// 공통 상속)에 "정확히 하나의 실행 가능한 동작만, 문서 서식 없이
// 1~3문장으로" 원칙을 프롬프트로 넣었지만, 프롬프트에 규칙을 적는
// 것과 모델이 실제로 매번 지키는 건 별개 문제다 — hondi-pro는
// thinking 모드로 방대한 reasoning을 거친 뒤 content를 내는데, 그
// 내부 사고 습관이 최종 출력 스타일에 스며들 위험이 있다(실사로
// 확인 — 원시 스트림 reasoning_content 참고).
//
// ★ 최초 배선(2026-08-06)에서는 K-Execute/K-Deliver만 대상이었으나,
// 같은 날 라이브 재검증에서 **AC(AGENT-COMMON) 자신**이 K-Intent로
// 넘기기 직전 응답에서 이미 "### 지금 당장 준비하실 것 1. ... 2. ..."
// 식 문서 나열을 쏟아내는 게 확인됐다 — CALL_KINTENT 태그가 그 안에
// 섞여 나왔다는 것 자체가 이 응답이 AC 활성 상태에서 생성됐다는
// 증거다(오케스트레이션 전환은 그 태그가 감지된 *이후*에 일어난다).
// 그래서 AC도 대상에 포함한다 — CFG.system?.includes('§0. 정체성')는
// AC-PRO-CORE 자신이 "call-ai.js의 일부 로직이 이 문자열로 AC 본체
// 활성 여부를 판별한다"고 명시한 기존 호환 마커를 그대로 재사용한다
// (임의로 새 마커를 만들지 않음 — 1777·4655행의 기존 용례와 동일).
//
// ★ max_tokens을 낮춰 강제로 자르는 방식은 의도적으로 쓰지 않는다 —
// SP-22 v1.4 커밋 메시지에 기록된 실제 사고(hondi-pro thinking 모드가
// reasoning에 예산을 다 써서 content가 빈 채로 finish_reason:"length"
// 나던 문제, resolveChatBudget으로 겨우 고침)와 정확히 같은 실패
// 모드를 다시 불러올 위험이 크다. 대신 생성이 끝난 뒤 결과물의 구조
// (마크다운 제목·번호 매김 목록 3개 이상·과도한 길이)를 보고 판정한다
// — "응답 길이 제한"의 효과는 내되, 문장 중간에 잘리는 위험은 없다.
const MD_HEADER_RE = /^#{1,6}\s/m;
const NUMBERED_LIST_RE = /(^|\n)\s*\d+[.)]\s.+(\n\s*\d+[.)]\s.+){2,}/;
const BULLET_LIST_RE = /(^|\n)\s*[-•*]\s.+(\n\s*[-•*]\s.+){2,}/;
const STYLE_MAX_LEN = 300; // 대략 1~3문장을 넉넉히 넘는 길이 — 오탐 방지 위해 넓게 잡음

// ── [라우팅 자기점검] GWP↔EXPERT 편향 방지 (2026-08-06 신설) ──────────
// 배경: AC-PRO-CORE §CORE 2단계 R1 판정축(2026-08-01)이 "위임의도 명시
// 시 EXPERT 우선"을 규정했지만, scenarios_batch2_20260801.json 300건
// 라이브 테스트에서 진짜 FAIL 39건 중 23건(59%)이 정확히 이 축에서
// 나왔다 — 니치 전문가(감정평가사·변리사·관세사·법무사·공인노무사·
// 공인중개사·정보보안전문가 등)에게 위임의도를 명시했는데도 인접
// GWP가 대신 채간 사례가 압도적으로 많았다(§CORE 2단계 주석 원문
// 인용). §CORE의 확신도 기반 되묻기 규칙도 이 편향 자체는 못 잡는다
// — 편향이 확신도 판단 자체를 왜곡시키기 때문("판단력 부족이 아니라
// 습관" — 더 일반적이고 눈에 익은 후보로 자동 수렴).
//
// C50(_enforceConversationalStyle)과 동일 철학의 코드 레벨 방어망:
// LLM이 스스로 세운 R1 기준을 실제로 어겼을 가능성이 있는지 순수
// 패턴 매칭으로 감지해 재확인을 요청한다. 정확도는 완벽하지 않다
// (휴리스틱 정규식) — 오탐 위험을 낮추기 위해 (1) 위임의도 마커가
// 있고 (2) 최종 선택이 GWP이고 (3) 그 GWP 도메인에 EXPERT 형제가
// 실제로 존재하는 경우에만 재확인을 요청하며, 재확인 지시 자체도
// "무조건 EXPERT로 바꾸라"가 아니라 "다시 판단해서 GWP가 맞으면
// 유지해도 된다"는 열린 형태로 낸다(강제 아님 — 이미 맞는 판단을
// 뒤집을 위험을 줄이기 위함).
//
// 반대 방향(GWP가 맞는데 EXPERT로 새는 경우, 39건 중 나머지 41%)은
// 이번 신설 범위에 포함하지 않았다 — 실측 근거상 이 방향이 상대적으로
// 작은 문제였고, "제도적 관점" 마커는 정규식으로 안정적으로 잡기엔
// 오탐 위험이 더 커서(거의 모든 질문이 표면적으로 "정보성"으로 보일
// 수 있음) 별도 설계가 필요하다 — 다음 과제로 남긴다.
const _DELEGATION_INTENT_RE =
  /(해\s*주실\s*분|께\s*직접|에게\s*직접|봐\s*주실\s*(분|전문가)|맡기고\s*싶|여쭤보고\s*싶|상담받고\s*싶|자문\s*(받고|구하고)\s*싶|의뢰하고\s*싶)/;

// GWP id → 동일 도메인에 EXPERT 형제 페르소나가 실제로 존재하는지
// (expert-registry.js EXPERT_REGISTRY의 ownerAgency 필드 기준, 2026-08-06
// 확인). kbank는 gwp-registry.js에서 이미 삭제됐지만 financial-planner.
// ownerAgency가 아직 'kbank'로 남아있는 스테일 참조라 kgdc로 별칭
// 처리한다(kgdc가 kbank의 기능을 흡수했으므로 — §CATALOG kgdc 행 참고).
const _GWP_HAS_EXPERT_SIBLINGS = new Set([
  'klaw', 'khealth', 'kedu', 'kfinance', 'ktax', 'kestate',
  'ksecurity', 'kcommerce', 'kgdc',
]);

export function _violatesRoutingBias(userText, fullReply) {
  if (!userText || !fullReply) return false;
  const gwpMatch = fullReply.match(/\[GWP:\s*([\w-]+)\]/);
  if (!gwpMatch) return false; // GWP 태그가 아니면(EXPERT거나 direct) 이 점검 대상 아님
  const svcId = gwpMatch[1];
  if (!_GWP_HAS_EXPERT_SIBLINGS.has(svcId)) return false; // 경쟁할 EXPERT 자체가 없으면 편향 위험 없음
  return _DELEGATION_INTENT_RE.test(userText);
}

let _routingBiasRetryCount = 0;
const _ROUTING_BIAS_RETRY_MAX = 2;

export async function _enforceRoutingBias(fullReply, bubble, sendFn = callAI, userText = '') {
  if (!_violatesRoutingBias(userText, fullReply)) return false;

  if (_routingBiasRetryCount >= _ROUTING_BIAS_RETRY_MAX) {
    console.warn('[RoutingBias] 재확인 재시도 한도 초과 — 이번 턴은 그냥 통과');
    return false;
  }
  _routingBiasRetryCount += 1;

  // 콘솔 가시성(2026-08-06 신설, 디버그용) — 브라우저 콘솔에서 실제
  // 발동 여부를 직접 관찰할 수 있도록 함. Network 탭의 "추가 API 호출"
  // 만으로는 확신하기 어렵다는 피드백 반영 — svcId까지 로그로 남긴다.
  const _gwpMatchForLog = fullReply.match(/\[GWP:\s*([\w-]+)\]/);
  console.info('[RoutingBias] 재확인 개입 —', _gwpMatchForLog?.[1] || '(알 수 없음)',
    '선택에 위임의도 마커 감지, EXPERT 재검토 요청 전송');

  history.push({ role: 'assistant', content: fullReply });
  const nudge =
    `[INTERNAL: 방금 GWP(기관 서비스)로 라우팅했는데, 사용자 발화에 ` +
    `"~해주실 분"·"~께 직접"·"맡기고 싶다" 류의 개인 위임의도 표현이 ` +
    `있었습니다 — AC-PRO-CORE §CORE 2단계 R1 판정축상 이런 경우 ` +
    `EXPERT(면허 전문가)가 우선해야 할 수 있습니다. 이 발화가 정말 ` +
    `제도 정보·제3자 관점 질문이었는지, 아니면 특정 자격직에게 직접 ` +
    `맡기려는 위임 요청이었는지 다시 판단해서, 필요하면 EXPERT로 ` +
    `다시 라우팅하세요. 재확인 후에도 GWP가 맞다고 판단되면 그 판단을 ` +
    `유지해도 됩니다 — 무조건 EXPERT로 바꾸라는 지시가 아닙니다.]`;
  history.push({ role: 'user', content: nudge });

  await sendFn(nudge);
  return true;
}

export function _violatesConversationalStyle(fullReply) {
  if (!fullReply || typeof fullReply !== 'string') return false;
  if (MD_HEADER_RE.test(fullReply)) return true;
  if (NUMBERED_LIST_RE.test(fullReply)) return true;
  if (BULLET_LIST_RE.test(fullReply)) return true;
  if (fullReply.length > STYLE_MAX_LEN) return true;
  return false;
}

let _styleRetryCount = 0;
const _STYLE_RETRY_MAX = 2;

export async function _enforceConversationalStyle(fullReply, bubble, sendFn = callAI, userText = '', systemTextOverride = undefined) {
  // AC 본체·K-Execute·K-Deliver의 사용자 응대 발화만 대상 — 다른
  // 단계(K-Compose의 계획 태그, K-Search 조회 등)는 이 원칙의 적용
  // 범위가 아니다(오탐 위험을 늘리지 않기 위해 실제로 "사용자에게
  // 직접 말을 거는" 단계만 좁혀서 강제한다).
  //
  // ★ 2026-08-06 신설(systemTextOverride) — webapp.html의 AI 패널
  // (_callPanelAI)은 CFG.system이 아니라 자체 history(_panelHistory[0])로
  // system을 관리한다(§0-1 상단 주석 참조) — 메인 채팅 전용인 CFG.system을
  // 그대로 읽으면 패널 오케스트레이션 전환 이전 단계(AC 자신이 아직
  // 활성 상태인 구간, 정확히 #235가 "알려진 한계"로 정직하게 남긴 그
  // 지점)에서 이 게이트가 항상 무의미하게 통과해버린다. 호출부가 실제
  // system 텍스트를 명시적으로 넘기면 그걸 쓰고, 안 넘기면(기존 call-ai.js
  // 호출부들과 100% 하위호환) 기존처럼 CFG.system을 쓴다.
  const _systemText = systemTextOverride !== undefined ? systemTextOverride : CFG.system;
  const inScope = _systemText?.includes('§0. 정체성')
    || _systemText?.includes('K-Execute') || _systemText?.includes('K-Deliver');
  if (!inScope) return false;
  if (!_violatesConversationalStyle(fullReply)) return false;

  if (_styleRetryCount >= _STYLE_RETRY_MAX) {
    console.warn('[대화스타일] 보정 재시도 한도 초과 — 이번 턴은 그냥 통과');
    return false;
  }
  _styleRetryCount += 1;

  // C50/NEXT_STEP과 동일한 판단 — 이미 스트리밍돼 사용자가 봤을 답변을
  // 지우지 않는다(지우는 게 오히려 더 나쁜 UX). history에 정상 기록한
  // 뒤, 짧게 다시 답하라는 보정 지시만 추가로 보낸다.
  history.push({ role: 'assistant', content: fullReply });
  const nudge =
    `[INTERNAL: 방금 응답이 여러 항목을 나열하는 문서형 응답이었습니다 — ` +
    `[대화 스타일 — 절대 원칙]/CONTROL-TOWER-PRINCIPLE(관제탑 원칙) 위반입니다. ` +
    `지금 사용자가 당장 할 수 있는 정확히 하나의 동작만, 사람이 옆에서 ` +
    `말해주듯 1~3문장으로 다시 답하세요. 목록·제목(###)·여러 단계 설명을 ` +
    `넣지 말고, 방금 답변을 짧게 요약하지도 말고 처음부터 다시 그 형식으로 ` +
    `쓰세요.]`;
  history.push({ role: 'user', content: nudge });

  await sendFn(nudge);
  return true;
}

export async function _handleDelegateToFlashTag(fullReply, bubble, sendFn = callAI, userText = '') {
  const tagMatch = fullReply.match(/\[DELEGATE_TO_FLASH:([\s\S]*?)\]/);
  if (!tagMatch) return false;
  const body = tagMatch[1];
  const get = (field) => {
    const m = body.match(new RegExp(`${field}=([^,\\]]+)`));
    return m ? m[1].trim() : '';
  };
  const task    = get('task');
  const context = get('context');
  if (!task) return false; // task 없이 태그만 형식만 맞으면 위임 대상이 아니라고 본다

  const cleanedReply = fullReply.replace(/\[DELEGATE_TO_FLASH:[\s\S]*?\]/, '').trim();
  if (bubble && cleanedReply) _updateStreamBubble(bubble, cleanedReply);

  const result = await _delegateToFlash(task, context);

  if (result.insufficientBalance) {
    // pro로 되돌려도 같은 guid가 같은 벽에 부딪힐 뿐이다 — 재시도 카운터를
    // 소모하지 않고 바로 이용자에게 정직하게 안내하고 끝낸다.
    if (bubble) _updateStreamBubble(bubble, result.text);
    history.push({ role: 'assistant', content: result.text });
    return true;
  }

  if (!result.ok) {
    _delegateRetryCount += 1;
    if (_delegateRetryCount > _DELEGATE_RETRY_MAX) {
      // 반복 위임 실패 — pro에게 계속 되돌리지 않고 여기서 끊는다.
      console.warn('[Delegate] 위임 재시도 한도 초과 — pro 자체 처리로 강제 종료');
      if (bubble) _updateStreamBubble(bubble, cleanedReply ||
        '요청을 처리하는 중 문제가 발생했습니다. 다시 한번 말씀해 주시겠어요?');
      _delegateRetryCount = 0;
      return true;
    }
    // flash가 판단이 필요하다고 되돌렸거나 호출 자체가 실패 — pro에게
    // "위임이 안 됐으니 네가 직접 마무리하라"고 명시적으로 알리고 재호출.
    const escalateNote =
      `[FLASH_ESCALATED: reason=${result.reason}${result.detail ? ', detail=' + result.detail : ''}] ` +
      `방금 hondi-flash에 위임한 작업(task: ${task})이 처리되지 못하고 되돌아왔습니다. ` +
      `이번엔 위임하지 말고 직접 마무리해 주세요.`;
    history.push({ role: 'user', content: escalateNote });
    await sendFn(escalateNote);
    return true;
  }

  _delegateRetryCount = 0;
  // 필드 테스트 단계에서 실제 위임 빈도를 실측하기 위한 로그(Cache 로그와
  // 동일한 관례). SIGNUP_BONUS_KRW 조정 여부를 추측이 아니라 실측으로
  // 결정하려면 이 비율이 필요하다 — worker.js 재설계 시점 계산은
  // "위임 0%~100%"의 두 극단만 계산했었다(정상상태 턴당 0.96~1.52원).
  console.log('[Delegate] hondi-flash 위임 성공 — task 길이:', task.length);
  const finalText = cleanedReply ? `${cleanedReply}\n\n${result.text}` : result.text;
  if (bubble) _updateStreamBubble(bubble, finalText);
  // 참고: 다른 태그 핸들러들은 관례적으로 history에 fullReply(태그가 든
  // 원문)를 그대로 남기지만, 여기선 finalText(사용자가 실제로 본 내용 —
  // pro의 서두 + flash의 실행 결과)를 남긴다. 다음 턴에 pro가 "자신이
  // 방금 뭐라고 답했는지" 참조할 때, 태그 뒤에 flash가 채운 실제 내용이
  // 빠진 반쪽짜리 fullReply보다 실제 대화 맥락과 일치하는 finalText가
  // 더 정확하다고 판단했다.
  history.push({ role: 'assistant', content: finalText });
  return true;
}


// fullReply를 한 번만 스캔해 §9에 정의된 실행 태그를 찾아 처리한다.
// 태그 하나의 처리 실패가 나머지 태그 처리를 막지 않도록 각각 독립적인
// try/catch로 감싼다. 새 태그를 추가할 때는 이 함수 안에 블록 하나만
// 더 붙이면 된다(0단계 설계 원칙).
//
// 현재 처리: GWP(기존 로직 그대로 이전, 동작 변경 없음),
//            SEARCH / OPEN_PROFILE / P2P_INVITE(Phase 1 — 이미 존재하는
//            실행 함수에 배선만 추가).
// 아직 미처리(Phase 2~5 예정): PDV_STORE, HANDSHAKE, VERIFY_OWNER, TRADE.
// (ESCALATE는 2026-07-11 _handleSPAuthorTags()로 처리됨 — 이 목록에서 제외)
export function _parseAgentTags(fullReply, bubble, userText, _preTab) {
  // [GWP: serviceId] — 하위 시스템 새 탭 오픈 (SP-00 v10.0, 기존 로직 그대로 이전)
  try {
    // BUG-FIX(2026-07-02): AGENT-COMMON 프롬프트는 "[GWP: klaw]"처럼 콜론
    // 뒤에 공백을 넣는 형식으로 일관되게 지시하는데(289/368/886~889행),
    // 이 정규식은 공백을 허용하지 않아 실제 모델 출력과 100% 어긋났다.
    // 그 결과 (1) 서비스가 전혀 열리지 않고 (2) 매칭 실패 시엔 태그
    // 제거(strip)도 안 일어나 원문 그대로("[GWP: klaw]") 채팅창에
    // 노출됐다 — 사용자가 실제로 겪은 증상과 정확히 일치. 콜론 뒤 공백을
    // 선택적으로 허용하도록 \s*를 추가한다.
    const gwpMatch = fullReply.match(/\[GWP:\s*([\w-]+)\]/);
    let svcId = gwpMatch ? gwpMatch[1] : null;

    // ★ 2026-07-31 신설 — 태그 누락 폴백. 2026-07-31 DeepSeek 라이브
    // 스모크 테스트에서, 모델이 "K-Insurance를 호출하겠습니다."처럼 의도는
    // 명확히 문장으로 밝히면서 정작 [GWP:id] 태그 자체는 빠뜨리는 사례가
    // 반복 관찰됐다(4/300건). 태그가 없을 때만, 활성 GWP 서비스의 표시명
    // (name)이 호출 의도 동사와 함께 응답에 유일하게 하나만 등장하면 그걸로
    // 라우팅을 구제한다. 후보가 0개나 2개 이상(모호)이면 아무것도 안 하고
    // 기존 동작(직접 응답으로 처리)을 그대로 유지한다 — 오탐보다 누락이 낫다.
    if (!svcId && typeof window !== 'undefined' && Array.isArray(window.GWP_REGISTRY) &&
        /호출|연결해|시작하겠습니다/.test(fullReply)) {
      const candidates = window.GWP_REGISTRY.filter(
        e => e.status === 'active' && e.name && fullReply.includes(e.name)
      );
      if (candidates.length === 1) {
        svcId = candidates[0].id;
        console.info('[GWP] 태그 누락 폴백 — 표시명 매칭으로 라우팅 복구:', svcId);
      }
    }

    if (svcId) {
      const svcDef = (typeof getService === 'function') ? getService(svcId) : null;
      // ★ 2026-07-12 신설 — status 가드. 지금까지 getService()가 status를
      // 전혀 체크하지 않아, pending_review(승인 전 초안, 예: kbank/
      // ktelecom — 250건 사고실험 중 SP-Author 대행으로 등록된 미배포
      // 서비스)나 pending 상태 서비스도 id만 맞으면 그대로 _gwpLaunch()
      // 되어 존재하지 않는 도메인으로 이동을 시도할 뻔했다(AGENT-COMMON
      // §3-0 ③ "승인 전까지는 어떤 이용자에게도 서빙되지 않는다" 원칙
      // 위반). status가 'active'인 것만 실제로 라우팅한다.
      if (svcDef && svcDef.status !== 'active') {
        console.warn(`[GWP] 서비스 '${svcId}'는 status='${svcDef.status}'라 아직 서빙 대상이 아님 — 라우팅 차단`);
        if (_preTab && typeof _preTab.close === 'function' && !_preTab.closed) { _preTab.close(); }
      } else if (svcDef && svcDef.type === 'switch') {
        // ★ 2026-07-12 신설 → 2026-08-01 자동복구로 교체 — K-Telecom/
        // K-Estate처럼 url 없는 시스템전환형 서비스가 구식 [GWP: id]
        // 문법으로 잘못 불렸을 때의 안전장치. 정상 경로는
        // [CALL_KTELECOM: query=...] 등 전용 태그(_handleOrchestrationTags
        // 가 처리)이지만, 2026-08-01 라이브 재검증(no=1, 2회 재현·완전
        // 동일 오출력)에서 확인했듯 AGENT-COMMON이 §TAGS 표에 예외를
        // 명시해도 습관적으로 구식 [GWP: id] 문법을 낸다 — 25개 라우팅
        // 판단 중 23개가 이 패턴이라 프롬프트 경고만으로는 못 이긴다.
        //
        // 예전엔 여기서 경고 로그만 남기고 탭을 닫아, 라우팅 판단
        // 자체(어느 서비스로 갈지)는 맞았는데도 사용자에게는 그냥
        // AC가 직접 응답한 것처럼 보이며 조용히 끊겼다. SWITCH_SP_LOADERS
        // 에 이미 존재하는 로더를 재사용해 _forwardSwitchSP로 직접
        // 복구한다.
        //
        // 동기 함수 제약 — 이 함수(_parseAgentTags)는 동기라
        // _forwardSwitchSP(async)의 완료를 기다릴 수 없다. 다만 "기다릴
        // 필요"는 애초에 없다: 호출부(callAI 4192행)도 이 결과를
        // await하지 않고, 아래 EXPERT 분기(handleExpertTag, 4198행)가
        // 이미 같은 fire-and-forget 패턴(.catch로 에러만 흡수)을 쓰고
        // 있다 — 그 패턴을 그대로 재사용한다. callAI/history는 이 파일
        // 모듈 스코프에 이미 있어(callAI는 함수 선언이라 호이스팅됨,
        // history는 20행에서 import) 별도 인자 전달 없이 참조 가능하다.
        //
        // ✅ 2026-08-07 해소 — 아래 이 IIFE 안의 await callAI(...)는
        // 지금 이 _parseAgentTags를 호출한 "바깥" callAI()가 아직
        // finally에서 _currentAbort/전송버튼 상태를 정리하기 전에
        // 시작될 수도, 그 이후에 시작될 수도 있어(await _forwardSwitchSP
        // 지연에 따라 달라짐) 두 callAI 실행이 짧게 겹치며 _currentAbort를
        // 서로 덮어쓸 리스크가 있었다 — "정지" 버튼이 잘못된 스트림을
        // 가리킬 수 있는 UX 엣지케이스. live_smoketest 재현 배치
        // (scenarios_repro_gwp_exception_tags_20260807.json, kestate/
        // ktelecom 각 20회 반복해서 이 자동복구 분기가 100% 결정론적으로
        // 타는 걸 확인)를 계기로 재검토, callAI() 자체를 compare-and-clear
        // 패턴(3313행 근처, myAbort 지역변수)으로 고쳐 정적으로 해소했다
        // — 각 callAI 호출이 "자신이 만든" AbortController일 때만 정리해
        // 서로 덮어쓸 수 없다. 그래도 실제 스트리밍/정지 버튼 UX가 기대대로
        // 되는지는 실배포 환경에서 한 번은 수동 확인 권장(이 하네스는
        // DOM/fetch가 최소 스텁이라 실제 스트림 타이밍까지는 검증 못 함).
        const label = { ktelecom: 'K-Telecom', kestate: 'K-Estate', kbank: 'K-Bank', kplan: 'K-Plan', kwatch: 'K-Watch', kjob: 'K-Job' }[svcId];
        const loader = SWITCH_SP_LOADERS[svcId];
        if (_gwpSwitchRecoveryInFlight) {
          // 재진입 — 지금 막 자동복구로 전환한 SP 자신의 응답이 다시
          // 이 분기를 태우려는 것(위 가드 신설 사유 주석 참고). 조용히
          // 무시하고 탭만 정리한다 — 여기서 또 전환/재호출하면 루프.
          console.warn(`[GWP] '${svcId}' 자동복구 재진입 감지 — 이미 복구 진행 중이라 건너뜀(루프 방지).`);
          if (_preTab && typeof _preTab.close === 'function' && !_preTab.closed) { _preTab.close(); }
        } else if (loader) {
          console.info(`[GWP] '${svcId}'는 시스템전환형(type:switch) — 구식 [GWP:] 태그를 감지해 ${label}로 자동복구 전환합니다.`);
          const cleanedReply = fullReply.replace(/\[GWP:\s*[\w-]+\]\s*/, '').trim();
          if (bubble) _updateStreamBubble(bubble, cleanedReply);
          if (_preTab && typeof _preTab.close === 'function' && !_preTab.closed) { _preTab.close(); }
          _gwpSwitchRecoveryInFlight = true;
          (async () => {
            await _forwardSwitchSP(loader, label);
            history.length = 0;
            await callAI(
              `[INTERNAL: AC→${label} 자동복구 전환 — 사용자에게 보이지 않는 내부 신호입니다. ` +
              `모델이 구식 [GWP: ${svcId}] 문법을 냈지만 라우팅 판단(${label}) 자체는 유효하므로 ` +
              `그대로 이어받아 상담을 시작하세요: "${userText}"]`,
              null, _preTab
            );
          })()
            .catch(e => console.warn(`[GWP] ${label} 자동복구 전환 실패(무시):`, e.message))
            .finally(() => { _gwpSwitchRecoveryInFlight = false; });
        } else {
          // SWITCH_SP_LOADERS에 없는 미지의 switch 서비스 — 로더가 없으니
          // 복구 불가, 예전 동작(경고만)으로 폴백.
          console.warn(`[GWP] '${svcId}'는 type:switch인데 SWITCH_SP_LOADERS에 로더가 없어 자동복구 불가.`);
          if (_preTab && typeof _preTab.close === 'function' && !_preTab.closed) { _preTab.close(); }
        }
      } else if (svcDef && !svcDef.url) {
        // ★ 2026-08-11 신설 — kestate/ktelecom(type:switch)과 동일한 계열의
        // 사고: url이 없는 TOOL/INLINE 항목(tool-web-search, ksearch,
        // tool-calculator 등, gwp-registry.js 참조)이 구식 [GWP: id]
        // 문법으로 잘못 호출되면, 아래 범용 분기(else if (svcDef))가
        // _gwpLaunch()를 무조건 실행 — _preTab을 about:blank로 먼저 띄운
        // 뒤 new URL(service.url)에서 TypeError(engine.js)를 내고, 그
        // 예외가 바깥 catch(4382행 부근)에 조용히 삼켜지면서 about:blank
        // 탭만 방치된 채 끝난다(실사 재현: "제주대학교에 ai연구센터가
        // 있는지 알아봐 줘" → 웹 검색 의도 표명 후 빈 탭). switch와
        // 달리 이 항목들은 SWITCH_SP_LOADERS 가드에 걸리지 않아 지금껏
        // 무방비였다 — 이 분기가 그 사각지대를 메운다.
        // ★ 2026-08-30 수정 — 원래 조건(svcDef.type === 'tool' ||
        // svcDef.type === 'inline')이 실제로는 url이 있는 type:'inline'
        // 서비스 14개(klaw 등)까지 전부 이 분기로 잘못 끌어들이고
        // 있었다(sp-tag-dispatch.test.mjs SD-01로 발견 — "[GWP: klaw]"가
        // 조용히 아무것도 안 하고 끝남, 아래쪽 'tool-calculator 등 아직
        // 전용 실행부가 없는 항목' else 분기로 떨어져 로그만 남기고
        // launch 자체가 누락됨). 이 가드의 진짜 의도(주석 그대로 "url이
        // 없는" 항목)에 맞게 type 문자열 대신 url 존재 여부로 직접
        // 판별한다 — tool 항목은 gwp-registry.js에 url:null로 명시돼
        // 있어 그대로 이 분기를 타고, url 있는 inline 항목은 이제 아래
        // 정상 launch 분기로 흐른다.
        console.warn(`[GWP] '${svcId}'는 url 없는 서비스(type:${svcDef.type})인데 구식 [GWP: id] 문법으로 호출됨 — 자동복구 시도.`);
        if (_preTab && typeof _preTab.close === 'function' && !_preTab.closed) { _preTab.close(); }
        const cleanedReplyTool = fullReply.replace(/\[GWP:\s*[\w-]+\]\s*/, '').trim();
        if (bubble) _updateStreamBubble(bubble, cleanedReplyTool);
        const q = (userText || '').trim();
        if (svcId === 'tool-web-search') {
          // 정상 실행부(_handleWebSearchTag, 2105행)를 재사용 — 새로
          // 검색 로직을 만들지 않는다. cleanedReplyTool을 태그 앞에
          // 그대로 붙여 합성한다 — _handleWebSearchTag 내부의
          // _stripInternalTags(fullReply)가 [WEB_SEARCH:...] 태그만
          // 걷어내고 cleanedReplyTool은 그대로 남기므로, 방금 위에서
          // 세팅한 버블 내용("웹에서 확인해서…" 등)이 "웹 검색 중…"으로
          // 바뀌기 전까지 자연스럽게 이어진다(맥락 유실 방지).
          if (q) {
            _handleWebSearchTag(`${cleanedReplyTool}\n\n[WEB_SEARCH: query=${q}]`, bubble, callAI, userText)
              .catch(e => console.warn('[GWP] tool-web-search 자동복구 실패(무시):', e.message));
          } else {
            console.warn('[GWP] tool-web-search 자동복구 불가 — userText 비어있음.');
          }
        } else if (svcId === 'ksearch') {
          // ★ 2026-08-11 신설 — ksearch 전용 자동복구.
          // 예전엔 [KSEARCH_HANDOFF]로 AC→K-Search 직접 위임이 가능했지만,
          // 2026-08-04 AC-PRO-CORE §CORE ②·§ORCHESTRATION 개정으로 그
          // 경로는 AC의 태그 목록에서 완전히 빠졌다(AC-PRO-CORE_v1_7.txt
          // §CATALOG 하단 "[2026-08-04 제거]" 주석 참조) — 지금은 §CATALOG
          // 표 밖 대상(특정 인물·기관·업체 탐색 등)이 전부 [CALL_KINTENT]
          // 하나로 수렴하고, K-Search 위임은 K-Compose 내부 로직이
          // 전담한다. 즉 AC가 구식 [GWP: ksearch]를 냈다는 건 §CATALOG
          // 판단은 맞았는데(표 밖 대상) §ORCHESTRATION 진입([CALL_KINTENT]
          // 발화)이 새고 있다는 신호 — KSEARCH_HANDOFF로 되돌리는 게
          // 아니라 정상 오케스트레이션 진입점인 [CALL_KINTENT]로
          // 밀어넣는 게 맞는 복구다. _handleOrchestrationTags(1165행)의
          // 기존 CALL_KINTENT 처리부(1417행, _forwardSwitchSP(_loadKIntentSP,
          // 'K-Intent') 경유)를 그대로 재사용 — 새 오케스트레이션 경로를
          // 만들지 않는다.
          if (q) {
            _handleOrchestrationTags(`${cleanedReplyTool}\n\n[CALL_KINTENT: query=${q}]`, bubble, callAI, userText)
              .catch(e => console.warn('[GWP] ksearch→CALL_KINTENT 자동복구 실패(무시):', e.message));
          } else {
            console.warn('[GWP] ksearch 자동복구 불가 — userText 비어있음.');
          }
        } else {
          // tool-calculator 등 아직 전용 실행부가 없는 항목(gwp-registry.js
          // 상 fn: null 그대로 방치된 상태) — 지어낸 복구 경로로 임시
          // 땜질하지 않는다. 조용히 끊는 대신 최소한 탭 방치는 막고
          // (로그만 남기고 AC 자신의 응답으로 이어가게 둔다), 실사에서
          // 재현 빈도가 확인되면 그때 전용 [CALCULATE: expr=...] 태그와
          // 실행부를 별도로 설계해야 한다.
          console.warn(`[GWP] '${svcId}' 전용 자동복구 미구현 — 탭 정리만 수행.`);
        }
      } else if (svcDef) {
        console.info('[GWP] LLM 판단 → 새 탭:', svcId);
        const cleanedReply = fullReply.replace(/\[GWP:\s*[\w-]+\]\s*/, '').trim();
        if (bubble) _updateStreamBubble(bubble, cleanedReply);
        // ★ 2026-07-23 수정 — 지금까지는 userText(사용자의 방금 발화)만
        // 새 탭에 넘겨서, 그 발화 자체엔 기관명이 없는 경우(예: "복지관련
        // 부서 연결해 줘") 새 탭이 어느 시/도 소속인지 전혀 알 수 없어
        // 전국 단위로 떨어지는 문제가 실사로 확인됐다. 그런데 바로 위
        // cleanedReply(AI 자신의 이번 답변, 예: "제주시청 기초생활과로
        // 연결해 드리겠습니다")에는 이미 그 기관명이 정확히 들어있다 —
        // AI가 방금 스스로 판단해 말한 내용을 그냥 버리고 있었을 뿐이다.
        // cleanedReply를 같이 실어 보내, 새 탭의 assembleGovSystemPrompt
        // 키워드 매칭이 그 기관명을 그대로 잡을 수 있게 한다.
        const gwpCtx = cleanedReply ? `${cleanedReply}\n\n[사용자 요청] ${userText}` : userText;
        _gwpLaunch(svcDef, gwpCtx, _preTab, _buildRoutingFacts());
      } else {
        // ★ 2026-08-03 신설 — entity 기반 launch 폴백(§ENTITY-LAUNCH).
        // core 21개 배열에 없는 id는 K-Search가 profiles에서 찾은
        // institution/org 엔티티의 guid일 수 있다. 178개 gov-tree
        // 기관을 이 배열에 개별 등록하는 대신, gwp-registry.js의
        // 단일 함수(_resolveEntityGwp)가 여기서 한 번에 처리한다.
        // getService()는 동기라 여기서만 비동기로 재시도한다(기존
        // switch 자동복구와 동일한 fire-and-forget 패턴 재사용).
        const _preTabForEntity = _preTab;
        (async () => {
          const entitySvc = (typeof _resolveEntityGwp === 'function')
            ? await _resolveEntityGwp(svcId) : null;
          if (entitySvc) {
            console.info('[GWP] 엔티티 기반 서비스로 해석됨 →', svcId, entitySvc.url);
            const cleanedReply2 = fullReply.replace(/\[GWP:\s*[\w-]+\]\s*/, '').trim();
            if (bubble) _updateStreamBubble(bubble, cleanedReply2);
            const gwpCtx2 = cleanedReply2 ? `${cleanedReply2}\n\n[사용자 요청] ${userText}` : userText;
            _gwpLaunch(entitySvc, gwpCtx2, _preTabForEntity, _buildRoutingFacts());
          } else {
            console.warn('[GWP] 알 수 없는 서비스 ID(엔티티 조회도 실패):', svcId);
            if (_preTabForEntity && typeof _preTabForEntity.close === 'function' && !_preTabForEntity.closed) {
              _preTabForEntity.close();
            }
          }
        })().catch((e) => {
          console.warn('[GWP] 엔티티 기반 launch 폴백 실패(무시):', e.message);
          if (_preTabForEntity && typeof _preTabForEntity.close === 'function' && !_preTabForEntity.closed) {
            _preTabForEntity.close();
          }
        });
      }
    } else {
      if (_preTab && typeof _preTab.close === 'function' && !_preTab.closed) {
        _preTab.close();
        console.info('[GWP] 직접 처리 — 예약 탭 닫힘');
      }
    }
  } catch (e) {
    console.warn('[Tags] GWP 처리 오류 (무시):', e.message);
  }

  // [SEARCH: query={검색어}, type=user] — 혼디 사용자 검색 패널 오픈
  // (같은 탭 오버레이 — 그림자 AI가 대화 맥락 안에서 후보를 잠깐 보여줄 때)
  //
  // [SEARCH: query={검색어}, type=user, mode=tab] — 2026-07-07 신설
  // 이용자가 "검색 창을 열어줘"처럼 검색 자체를 목적으로 명시적으로
  // 요청한 경우, 상세 필터가 포함된 전용 새 탭(pages/search-tab.html)을
  // 연다. mode=tab이 없으면 기존과 동일하게 같은 탭 오버레이로 처리한다.
  try {
    const searchMatch = fullReply.match(
      /\[SEARCH:\s*query=([^,\]]+),\s*type=user(?:,\s*mode=(tab))?\s*\]/
    );
    if (searchMatch) {
      const q    = searchMatch[1].trim();
      const mode = searchMatch[2];
      console.info('[Tags] SEARCH →', q, mode === 'tab' ? '(새 탭)' : '(같은 탭)');
      if (mode === 'tab') {
        const url = '/pages/search-tab.html' + (q ? '?q=' + encodeURIComponent(q) : '');
        if (_preTab && !_preTab.closed) _preTab.location.href = url;
        else window.open(url, '_blank');
      } else {
        openSearch(q);
      }
    }
  } catch (e) {
    console.warn('[Tags] SEARCH 처리 오류 (무시):', e.message);
  }

  // [OPEN_SETTINGS_TAB] — 2026-07-07 신설. 설정 페이지를 새 탭에서 연다.
  // webapp.html?panel=settings 딥링크로 여는 이유는 gopang-app.js 상단
  // 주석 참조(설정 패널이 webapp.html 정적 마크업에 강하게 결합돼 있어
  // 그 마크업 자체를 재사용하는 쪽이 안전함).
  try {
    if (/\[OPEN_SETTINGS_TAB\]/.test(fullReply)) {
      console.info('[Tags] OPEN_SETTINGS_TAB');
      const url = '/webapp.html?panel=settings';
      if (_preTab && !_preTab.closed) _preTab.location.href = url;
      else window.open(url, '_blank');
    }
  } catch (e) {
    console.warn('[Tags] OPEN_SETTINGS_TAB 처리 오류 (무시):', e.message);
  }

  // [OPEN_K_SERVICES_TAB] — 2026-07-07 신설. K 서비스(GWP_REGISTRY) 전체
  // 목록을 새 탭(pages/k-services.html)에 표시한다.
  try {
    if (/\[OPEN_K_SERVICES_TAB\]/.test(fullReply)) {
      console.info('[Tags] OPEN_K_SERVICES_TAB');
      const url = '/pages/k-services.html';
      if (_preTab && !_preTab.closed) _preTab.location.href = url;
      else window.open(url, '_blank');
    }
  } catch (e) {
    console.warn('[Tags] OPEN_K_SERVICES_TAB 처리 오류 (무시):', e.message);
  }

  // [OPEN_PROFILE: handle={@handle}] — 공급자 프로필 페이지 새 패널로 열기
  try {
    const openProfileMatch = fullReply.match(/\[OPEN_PROFILE:\s*handle=(@[\w.-]+)\s*\]/);
    if (openProfileMatch) {
      const handle = openProfileMatch[1];
      console.info('[Tags] OPEN_PROFILE →', handle);
      _openProfilePanel(handle);
    }
  } catch (e) {
    console.warn('[Tags] OPEN_PROFILE 처리 오류 (무시):', e.message);
  }

  // [P2P_INVITE: handle={@handle}, message={...}] — P2P 채팅 초청 발송
  try {
    const inviteMatch = fullReply.match(/\[P2P_INVITE:\s*handle=(@[\w.-]+)/);
    if (inviteMatch) {
      const handle = inviteMatch[1];
      console.info('[Tags] P2P_INVITE →', handle);
      inviteByHandle(handle).catch(e =>
        console.warn('[Tags] P2P_INVITE 호출 실패 (무시):', e.message)
      );
    }
  } catch (e) {
    console.warn('[Tags] P2P_INVITE 처리 오류 (무시):', e.message);
  }
}


async function _callAIInner(userText, imageFile = null, _preTab = null, modelTier = null, onFailure = null) {
  // 2026-08-10 신설 — "내 사용량 보여줘" 등은 LLM 호출 없이 즉시 처리.
  // 사용자 말풍선은 호출부(send-message.js의 sendMessage())가 callAI 진입
  // 전에 이미 찍어뒀으므로 여기서 다시 찍지 않는다(중복 방지). 이미지
  // 첨부가 함께 온 경우(예: 영수증 사진 + "사용량 보여줘")는 이미지 분석이
  // 본 의도일 가능성이 높으므로 이 단락은 건너뛰고 기존 흐름을 탄다.
  if (!imageFile && _matchUsageDashboardIntent(userText)) {
    history.push({ role: 'user', content: userText });
    const _msg =
      '📊 GDC 사용량·충전 내역을 한눈에 볼 수 있는 대시보드입니다.<br>' +
      '<button onclick="window.location.href=\'usage.html\'" ' +
      'style="margin-top:8px;padding:8px 14px;border:none;border-radius:8px;' +
      'background:#1A73E8;color:#fff;font-weight:600;cursor:pointer">내 사용량 확인하기</button>';
    appendBubble('ai', _msg);
    history.push({ role: 'assistant', content: _msg });
    return;
  }

  showTyping();

  // ── AC 사전 분류기(classifyIntent) 고신뢰 즉시 라우팅 (2026-09-13 신설) ──
  // 배경·범위 제한은 ac-intent-router.js 파일 상단 주석 참고. 요약: 오늘
  // 2,000개 질문 실험에서 high-confidence로 확정한 규칙만 믿고, AC-PRO-CORE
  // 추론 자체를 생략한다 — 단, SERVICE_SP_INTERNAL 중에서도 런타임이
  // 확실히 파악된 두 갈래(switch/gwp_launch)만 다루고 나머지(FEDERATED/
  // NOT_YET_BUILT/QNA/DEV_DOCS/K_SEARCH/EXPERT_PERSONA/UNKNOWN, 그리고
  // AC_CORE — 이미 기본 경로라 별도 분기 불필요)는 손대지 않고 그대로
  // 기존 LLM 카탈로그 판단으로 흘려보낸다. 이미지 첨부, 오케스트레이션
  // 서브태스크 진행 중(CFG.systemStack), switch 자동복구 진행 중
  // (_gwpSwitchRecoveryInFlight), 그리고 '['로 시작하는 내부 신호
  // 메시지(예: [INTERNAL: ...], [KSEARCH_RESULT: ...])는 사용자가 방금
  // 입력한 자연어 발화가 아니므로 전부 건너뛴다.
  if (!imageFile && !(CFG.systemStack?.length > 0) && !_gwpSwitchRecoveryInFlight &&
      typeof userText === 'string' && !userText.trim().startsWith('[')) {
    try {
      const registry = await _loadRoutingRegistry();
      const preRoute = registry ? classifyIntent(userText, registry) : null;
      if (preRoute && preRoute.confidence === 'high' && preRoute.type === ROUTE_TYPES.SERVICE_SP_INTERNAL) {
        if (preRoute.runtime_type === 'switch' && SWITCH_SP_LOADERS[preRoute.gwp_id]) {
          // ── 4개(K-Job/K-Plan/K-Watch/K-Telecom) — 기존 _forwardSwitchSP를
          // 그대로 재사용한다. 원래 이 전환은 AC-PRO-CORE가 [GWP: id]를
          // 낸 뒤에야(4713행 근처 자동복구 분기) 일어났는데, 여기서는 그
          // LLM 왕복 자체를 생략하고 곧장 전환한다 — 전환 함수·로더·이후
          // [INTERNAL: ...] 재주입 패턴은 그 분기와 100% 동일하다.
          const label = { ktelecom: 'K-Telecom', kestate: 'K-Estate', kbank: 'K-Bank',
            kplan: 'K-Plan', kwatch: 'K-Watch', kjob: 'K-Job' }[preRoute.gwp_id] || preRoute.gwp_id;
          console.info(`[Router] classifyIntent 고신뢰(${preRoute.reason}) — AC-PRO-CORE 생략, ${label}로 즉시 전환`);
          history.push({ role: 'user', content: userText });
          _gwpSwitchRecoveryInFlight = true;
          try {
            await _forwardSwitchSP(SWITCH_SP_LOADERS[preRoute.gwp_id], label);
            history.length = 0;
            await callAI(
              `[INTERNAL: 사전 라우팅(classifyIntent 고신뢰 판정) — ${label}로 이미 전환됐습니다. ` +
              `사용자에게 보이지 않는 내부 신호입니다. 다음 요청을 이어받아 상담을 시작하세요: "${userText}"]`,
              null, _preTab
            );
          } finally {
            _gwpSwitchRecoveryInFlight = false;
          }
          return;
        }
        if (preRoute.runtime_type === 'gwp_launch' && typeof getService === 'function') {
          // ── 나머지 8개(K-Mail/K-Health/K-Public/K-Police/K-Traffic/
          // K-Democracy/K-Logistics/K-Insurance) — 기존 [GWP: id] LLM
          // 경로가 새 탭을 열 때 쓰는 _gwpLaunch()를 그대로 재사용한다.
          // status==='active'·url 존재 확인은 기존 _parseAgentTags의
          // 가드(4661행 근처)와 동일하게 유지 — 확인 안 되면 아무 것도
          // 하지 않고 아래로 흘려보내 기존 LLM 경로가 스스로 판단하게
          // 둔다(이중 안전망).
          const svcDef = getService(preRoute.gwp_id);
          if (svcDef && svcDef.status === 'active' && svcDef.url) {
            console.info(`[Router] classifyIntent 고신뢰(${preRoute.reason}) — AC-PRO-CORE 생략, ${svcDef.name} 새 탭으로 즉시 이동`);
            history.push({ role: 'user', content: userText });
            appendBubble('ai', `🔗 ${svcDef.name}(으)로 연결하고 있습니다…`);
            history.push({ role: 'assistant', content: `[GWP: ${preRoute.gwp_id}]` });
            _gwpLaunch(svcDef, userText, _preTab, _buildRoutingFacts());
            return;
          }
          console.warn(`[Router] '${preRoute.gwp_id}' gwp_launch 사전판정됐지만 svcDef 상태 이상` +
            `(status=${svcDef?.status}, url=${svcDef?.url}) — 기존 LLM 경로로 폴백`);
        }
      }
    } catch (e) {
      console.warn('[Router] classifyIntent 사전분류 처리 중 오류(무시, 기존 LLM 경로로 폴백):', e.message);
    }
  }

  // urgent=true → kemergency면 경고 표시 후 계속 처리
  // (고팡 비서가 추가로 응급 가이드 제공)

  // ── 위치 준비 대기 (최대 6초, race condition 방지) ──────
  if (_locationPending) {
    await new Promise(resolve => {
      const deadline = Date.now() + 6000;
      const poll = () => {
        if (_locationReady || Date.now() >= deadline) resolve();
        else setTimeout(poll, 200);
      };
      poll();
    });
  }

  // ── SP 결정 (캐시 최적화 v1.1, v1.6 — PA 자동 로드 분기 제거) ──────
  // 원칙: system 메시지는 세션 내 절대 변경하지 않는다 (DeepSeek 캐시 prefix 보존).
  //   • AGENT-COMMON: system_base에 최초 1회 로드 후 고정 — 메인 채팅/AI 패널은
  //     이제 항상 이것만 쓴다. PA SP는 더 이상 여기서 자동으로 끼어들지 않는다.
  //   • PA SP는 settings.js의 프로필 작성 패널(openProfileComposer)에서만,
  //     그 패널 전용의 독립된 history로 호출된다 — 메인 채팅 history와 무관.
  //   • 동적 데이터(GUID·위치·PDV·최초 인사): system이 아닌 user 메시지 앞에 병합
  //     (_buildEnhancedUserContent/_buildFirstContactContext 참조)
  //   • 그림자 컨텍스트(_buildShadowContext): 제거 — user 메시지 병합 방식으로 대체

  // ── 전문가 AI(페르소나)는 이 스레드에 없음 ───────────────
  // (2026-08-06 정정) EXPERT 페르소나 대화는 새 탭(pages/expert-chat.html)
  // 에서 독립 실행되므로, 이 그림자 AI 스레드는 매 턴 그대로
  // AC-PRO-CORE로 응답한다 — 예전에 여기 있던 isExpertActive() 분기는
  // 항상 else(AC-PRO-CORE 로드)만 타는 죽은 조건문이었다(상세는
  // src/_archive/expert-session-legacy-inthread.js.md).

  // AC-PRO-CORE 최초 1회 로드 (이후 캐시) — manifest["AC-PRO-CORE"] 키로 버전 결정
  if (!CFG.system_base) {
    CFG.system_base = await _loadAgentCommonSP();
  }
  if (!CFG.system) CFG.system = CFG.system_base || '';

  // ── 이미지 첨부 시: Gemini 범용 분석 → SP-00 컨텍스트 주입 ──
  if (imageFile && CFG.geminiKey) {
    try {
      const _gpTimer = _showGeminiProgress();
      console.log('[IMG] Gemini 범용 이미지 분석 시작');
      const genResult = await _callGeminiGeneral(imageFile, CFG.geminiKey, userText);
      _hideGeminiProgress(_gpTimer);
      if (genResult) {
        const analysisText = _geminiResultToText(genResult, userText);
        userContent = analysisText;
        imageFile   = null;
        console.log('[IMG] Gemini 분석 완료 → SP-00 컨텍스트로 전달');
      }
    } catch(e) {
      console.warn('[IMG] Gemini 분석 실패:', e.message);
    }
  }

  // ── 이미지 → content 배열 변환 ──────────────────────
  let userContent;

  if (imageFile && imageFile.type.startsWith('image/')) {
    if (!_modelSupportsVision(CFG.model)) {
      // 비전 미지원 모델 — 이미지 무시, 사용자에게 안내
      hideTyping();
      appendBubble('ai',
        `⚠️ 현재 모델(${CFG.model})은 이미지를 지원하지 않습니다.\n` +
        `설정에서 "DeepSeek V4" 또는 "GPT-4o"로 변경하세요.`);
      if (userText) {
        // 텍스트만이라도 처리
        showTyping();
      } else {
        return;
      }
      userContent = userText;
    } else {
      // 비전 지원 모델 — base64 변환 후 multipart content(image_url 형식).
      // 2026-07-27 수정 — 이전엔 "DeepSeek API는 image_url 미지원"이라는
      // 전제로 DeepSeek 계열에는 base64 앞 100자만 텍스트로 잘라 보내는
      // 별도 분기가 있었는데, 이건 애초에 어떤 모델도 읽을 수 없는
      // 문자열이라 사실상 이미지를 통째로 무시하는 것과 같았다(비전을
      // "지원한다"고 판단해 이 분기까지 왔는데 실제로는 이미지가 전혀
      // 전달되지 않음). 게다가 CFG.model 기본값 자체가 'deepseek-v4-flash'
      // (자체 API 키가 없는 사실상 모든 사용자의 기본 경로)라, 이 분기가
      // 가장 흔한 경로였을 것으로 보인다. profile-assistant.html의 실제
      // 사진 판독(§IMAGE-SCAN)은 처음부터 provider 구분 없이 image_url을
      // 그대로 써왔고 정상 동작해왔다(worker.js의 callDeepSeek이 메시지를
      // 그대로 벤더 API에 패스스루하므로, 이 워커를 거치는 이상 형식은
      // provider와 무관하게 동일해야 한다 — config.js 자체가 "모든
      // provider가 OpenAI 호환 형식 지원"을 전제로 설계돼 있음). 그 검증된
      // 방식으로 통일한다 — provider별 분기 자체를 없앤다.
      try {
        const dataUrl  = await _fileToBase64(imageFile);
        const mimeType = imageFile.type;
        const base64   = dataUrl.split(',')[1];

        userContent = [];
        if (userText) {
          userContent.push({ type: 'text', text: userText });
        }
        userContent.push({
          type: 'image_url',
          image_url: { url: `data:${mimeType};base64,${base64}` },
        });
        // 텍스트 없이 이미지만 전송 시 — 의도 자율 파악 지시
        if (!userText) {
          userContent.push({
            type: 'text',
            text: '[텍스트 없이 이미지만 전송됨]\n사용자의 의도를 이미지에서 직접 파악하여 처리하라.\n환경 오염·쓰레기 현장이면 K-Cleaner v1.2 신고·견적을 자동 실행하고,\n그 외 이미지는 내용에 맞는 적절한 도움을 제공하라.\n불명확할 때만 한 가지 확인 질문을 한다.',
          });
        }
      } catch (e) {
        hideTyping();
        appendBubble('ai', `⚠️ 이미지 변환 오류: ${e.message}`);
        return;
      }
    }
  } else {
    // 일반 텍스트
    userContent = userText;
  }

  // ── history에 system(최초) 및 user 추가 ─────────────────
  // 1) system: 세션 최초 1회만 history[0]으로 삽입
  //    ★ 캐시 최적화: system은 완전 정적 — 동적 데이터는 user 메시지에 병합
  //    DeepSeek Auto Prompt Caching이 system prefix를 영구 캐시
  //    → 수백 번 호출해도 system 토큰 비용 사실상 0
  if (history.length === 0) {
    history.push({ role: 'system', content: CFG.system });
    console.log('[Cache] 세션 최초 — 정적 system 삽입 (DeepSeek 캐시 최적화)');
  }

  // 2) 동적 컨텍스트를 현재 user 메시지 앞에 병합
  //    ★ system prefix를 건드리지 않으므로 캐시 적중률 95%+ 유지
  //    온보딩 중: [CONTEXT: PROFILE_ONBOARDING] 블록 삽입
  //    일반 모드: GUID + 위치 + PDV 요약 (RAG 스타일, 압축)
  const enhancedUserContent = await _buildEnhancedUserContent(userContent);

  // 3) user 레코드는 원본(userContent)으로 history에 저장
  //    → enhancedUserContent(컨텍스트 포함)는 messages 전송용으로만 사용
  const userRecord = { role: 'user', content: typeof userContent === 'string' ? userContent : '[첨부: 이미지]' };
  history.push(userRecord);

  // 4) messages 구성
  //    ★ 구조: [system(고정·캐시)] → [대화이력] → [user(동적ctx 병합)]
  //    기존의 ctxMsg([ctx]GUID+위치 별도 메시지 쌍) 완전 제거
  //    — ctxMsg가 system 바로 뒤에 오면 캐시 prefix가 매번 달라져 캐시 0% 적중
  const sysMsg  = history[0]?.role === 'system' ? [history[0]] : [];
  const dialogs = history.slice(1);           // system 제외 대화
  const recent  = dialogs.slice(-18);         // 최근 18턴

  const messages = [
    ...sysMsg,                                // ★ system (완전 정적 → DeepSeek 캐시 100%)
    ...recent.slice(0, -1),                   // 대화 이력 (userRecord 제외)
    { role: 'user', content: enhancedUserContent }, // ★ 동적 ctx + 현재 질문 (캐시 무관)
  ];

  // ── 호출 후보 목록 생성 (순차 페일오버) ──────────────────
  // 사용자가 등록한 BYOK provider들 순서대로 시도한 뒤, 마지막엔 항상
  // 혼디 제공 DeepSeek 기본 키(hondi-flash/hondi-pro)로 폴백한다 —
  // 그래서 candidates는 절대 0개가 되지 않는다. 티어는 이번 턴 원본
  // userText(가공 전)의 복잡도를 보고 자동으로 정해진다.
  const candidates = _buildCallCandidates(typeof userText === 'string' ? userText : '', messages, modelTier);
  const activeModel = CFG.model;
  console.log(`[AI] 호출 후보 ${candidates.length}개 준비 — 1번부터 순차 시도`);

  // ── 스트리밍 호출 (페일오버 포함) ───────────────────────
  try {
    let res = null, usedCandidate = null, lastErr = null, idle = null;

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      console.log(`[AI] 시도 ${i + 1}/${candidates.length} → ${c.baseUrl}/chat/completions | 모델: ${c.model} | ${c.isProxy ? '프록시(보안)' : 'provider: ' + c.provider}`);
      // BUG-FIX(2026-07-01): 기존엔 _currentAbort?.signal(사용자 수동 "정지"
      // 버튼)만 연결돼 있고 자동 타임아웃이 전혀 없어, 서버가 무응답으로
      // 멈추면 사용자가 직접 정지 버튼을 누르기 전까지 영원히 대기했다.
      // _currentAbort와 idle 타임아웃을 함께 연결하되, idle.wasManualStop()으로
      // "사용자가 정지 버튼을 눌렀는지"와 "그냥 45초 무응답이었는지"를 구분해
      // 후자는 기존처럼 다음 후보로 페일오버되게 한다.
      idle = _makeIdleAbort(_LLM_IDLE_TIMEOUT_MS, _currentAbort?.signal);
      try {
        // 2026-0X-XX 수정 — #180과 동일 클래스 결함(팀원 제보: K-Telecom
        // switch형 GWP 전환 대화에서 hondi-pro 페일오버 턴이 45초 idle
        // 타임아웃, reasoning_tokens만 280+ 소모). hondi-pro는 thinking이
        // 켜져 있어 CHAT_REPLY(800)로는 추론만 하다 끝난다 — candidate가
        // hondi-pro인지 보고 예산을 그때그때 고른다.
        const reqBody = {
          model: c.model,
          messages,
          max_tokens:  resolveChatBudget(c.model),
          temperature: 0.6,
          stream:      true,
        };
        // Gemini·OpenRouter 등 일부 provider는 stream_options를 거부함(400)
        // PROVIDER_INFO[provider].noStreamOptions 플래그로 일반화 처리
        if (!PROVIDER_INFO[c.provider]?.noStreamOptions) {
          reqBody.stream_options = { include_usage: true };
        }
        // ※ 2026-06-29: 벤더에 브라우저에서 직접 fetch하면 대부분 CORS에
        // 막힌다(서버 간 호출만 허용하는 게 일반적). 서버(/llm/relay)를
        // 한 번 거쳐서 보낸다(여전히 사용자 본인 키·본인이 고른 모델 그대로).
        // 'legacy'(사용자가 직접 운영하는 커스텀 엔드포인트)는 알려진 벤더가
        // 아니므로 중계 허용목록에 없다 — 이 경로만 예외적으로 직접 호출한다.
        // 'deepseek-default'는 혼디 제공 무료 기본 키(hondi-flash/hondi-pro) —
        // apiKey 없이 /deepseek(서버가 자체 키·티어별 모델 매핑 처리)로 직행한다.
        const attempt = c.provider === 'legacy'
          ? await fetch(`${c.baseUrl}/chat/completions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${c.apiKey}` },
              body: JSON.stringify(reqBody),
              signal: idle.signal,
            })
          : c.provider === 'deepseek-default'
          ? await fetch(`${c.baseUrl}/deepseek`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...reqBody, guid: _USER?.ipv6 || USER_GUID || null }),
              signal: idle.signal,
            })
          : await fetch(`${CFG.endpoint.replace(/\/+$/, '')}/llm/relay`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                provider: c.provider, baseUrl: c.baseUrl, apiKey: c.apiKey,
                model: reqBody.model, messages: reqBody.messages,
                max_tokens: reqBody.max_tokens, temperature: reqBody.temperature,
                stream: true,
              }),
              signal: idle.signal,
            });

        idle.reset(); // 연결 응답 수신 — 스트리밍 구간 타이머로 리셋
        if (attempt.ok) { res = attempt; usedCandidate = c; break; }

        // 실패(429/402/404/400/5xx 등 모든 상황) → 다음 후보로 항상 페일오버
        // (단종된 모델일 때도, 한도 초과도, 일시 장애도 어떻든 다음 LLM을 시도한다)
        idle.cancel();
        const errBody = await attempt.text().catch(() => '');
        lastErr = new Error(`API ${attempt.status}: ${errBody.slice(0, 300) || '응답없음'}`);
        console.warn(`[AI] ${c.provider}(${c.model}) 실패(${attempt.status}) — 다음 LLM으로 전환:`, errBody.slice(0, 150));
        continue;
      } catch (fetchErr) {
        if (fetchErr.name === 'AbortError' && idle.wasManualStop()) {
          idle.cancel();
          throw fetchErr; // 진짜 사용자 수동 중지 — 페일오버 없이 즉시 중단
        }
        idle.cancel();
        // idle 타임아웃(45초 무응답)이거나 기타 네트워크 오류 — 다음 후보가
        // 있으면 계속 시도(기존 정책과 동일하게 취급)
        lastErr = (fetchErr.name === 'AbortError') ? new Error('응답 시간 초과(45초)') : fetchErr;
        if (i < candidates.length - 1) continue;
        throw lastErr;
      }
    }

    if (!res) throw (lastErr || new Error('모든 LLM 호출에 실패했습니다.'));
    if (usedCandidate && usedCandidate.model !== CFG.model) {
      console.info(`[AI] 페일오버로 모델 전환됨: ${CFG.model} → ${usedCandidate.model}`);
    }

    console.log(`[AI] 응답 시작 — status:${res.status}, streaming...`);

    // ── SSE 스트림 수신 + 실시간 렌더링 ─────────────────────
    // ★ 2026-07-30 버그 수정 — 기존엔 여기서 hideTyping()을 바로
    // 호출했는데, 이건 "HTTP 헤더가 도착했다"는 뜻이지 "LLM이 실제로
    // 텍스트를 생성하기 시작했다"는 뜻이 아니다. 그 사이(라우팅 판단
    // 등으로 첫 토큰까지 지연될 때) 타이핑 인디케이터도 없고 텍스트도
    // 없는 빈 화면이 수 초간 노출돼 "멈춘 것처럼" 보이는 원인이었다
    // (실사용 중 발견). hideTyping()은 실제 첫 델타를 받는 시점으로
    // 옮기고, 그 전까지는 타이핑 인디케이터를 계속 띄워둔다.
    const bubble = _createStreamBubble();
    let   _typingHidden = false;
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   fullReply = '';
    let   buf       = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        idle.reset(); // 청크(또는 종료)를 받을 때마다 유휴 타이머 리셋
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') break;
          try {
            const chunk = JSON.parse(payload);
            if (chunk.usage) {
              const u = chunk.usage;
              const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
              console.log(`[Cache] prompt=${u.prompt_tokens} cached=${cached} completion=${u.completion_tokens} (절감율 ${cached ? Math.round(cached/u.prompt_tokens*100) : 0}%)`);
            }
            const delta = chunk.choices?.[0]?.delta?.content ?? '';
            if (delta) {
              if (!_typingHidden) { hideTyping(); _typingHidden = true; }
              fullReply += delta;
              // CLN 신고가 아닐 때만 실시간 렌더링
              if (bubble) _updateStreamBubble(bubble, fullReply);
            }
          } catch (parseErr) {
            if (payload && payload !== '[DONE]') {
              console.warn('[Stream] 파싱 실패:', payload.slice(0, 80));
            }
          }
        }
      }
    } catch (streamErr) {
      // BUG-FIX(2026-07-01): 스트리밍 도중(연결은 됐지만 그 이후 청크가
      // 끊긴 경우) 발생한 idle 타임아웃도 AbortError로 뜬다. 이걸 그대로
      // 두면 바로 아래 바깥쪽 catch(err)의 "err.name==='AbortError' →
      // 사용자가 정지 버튼을 눌렀다"는 분기를 타서, 실제로는 응답 시간
      // 초과인데도 아무 안내 없이 조용히 종료돼 버린다. 진짜 수동 중지만
      // AbortError로 그대로 올려보내고, idle 타임아웃은 이름이 다른 에러로
      // 바꿔 아래에서 정상적으로 "⚠️ API 오류: 응답 시간 초과" 안내가
      // 뜨도록 한다.
      if (streamErr.name === 'AbortError' && !idle.wasManualStop()) {
        throw new Error('응답 시간 초과(45초, 스트리밍 중단)');
      }
      throw streamErr;
    } finally {
      idle.cancel();
      // ★ 안전장치 — 델타를 한 번도 못 받고 스트림이 끝나거나(빈 응답)
      // 에러로 종료된 경우, 타이핑 인디케이터가 영원히 안 사라지는 걸 방지.
      if (!_typingHidden) { hideTyping(); _typingHidden = true; }
    }

    if (!fullReply) fullReply = '(응답 없음)';
    console.log(`[AI] 응답 완료 — ${fullReply.length}자`);
    if (CFG._modelOverride) { CFG.model = CFG._modelOverride; CFG._modelOverride = null; }
    history.push({ role: 'assistant', content: fullReply });
    if (bubble) bubble.classList.remove('streaming');

    // ── OpenHash 앵커링 (2단계, 2026-07-09 신설 — 관찰 전용) ──────────
    // fire-and-forget: 실패해도 채팅 흐름을 절대 막지 않는다(p2p-chat.js
    // _saveP2PSession과 동일 원칙 — try/catch로 감싸고 결과를 기다리지 않음).
    _anchorGovChain(userText, fullReply).catch(e =>
      console.warn('[GovChain] 앵커링 실패 (무시):', e.message)
    );

    // ── PROFILE 태그 처리 (SUBMIT / SKIP / 단계 업데이트 / 최초 인사·이름짓기 /
    //    CALL_PROFILE_ASSISTANT / PROFILE_INTERRUPT_HANDOFF) ──
    // v2.0(2026-07-08) — CALL_PROFILE_ASSISTANT는 AGENT-COMMON 쪽에서,
    // PROFILE_INTERRUPT_HANDOFF는 profile-assistant 쪽에서 나온다. 나머지는
    // 이전과 동일하게 profile-assistant SP에서만 나온다. 어느 SP가 활성
    // 상태든 이 함수 하나가 공통 처리한다.
    // SUBMIT/SKIP/CALL_PROFILE_ASSISTANT/PROFILE_INTERRUPT_HANDOFF 감지 시
    // history 초기화 + SP 전환 후 true 반환 → 후속 처리 생략.
    const _profileHandled = await _handleProfileTags(fullReply, bubble, callAI, userText);
    if (_profileHandled) return;

    // ── 오케스트레이션 태그 처리 (K-Intent/K-Compose/K-Deliver 핸드오프 +
    //    중첩 위임 스택, 2026-07-08 신설, §0-H v3.40) — PROFILE 처리와
    //    동일한 위치·동일한 조기 반환 패턴을 따른다.
    const _orchestrationHandled = await _handleOrchestrationTags(fullReply, bubble, callAI, userText);
    if (_orchestrationHandled) return;

    // ── SP-Author 자동화 태그 처리 (2026-07-11 신설) ──
    // K-Compose/K-Deliver 게이트 없이 어느 SP에서든(특히 AGENT-COMMON
    // §3-0 ③) 처리한다 — _handleOrchestrationTags 바로 다음 위치.
    const _spAuthorHandled = await _handleSPAuthorTags(fullReply, bubble, callAI, userText);
    if (_spAuthorHandled) return;


    // ── GOV_TASK 태그 처리 (2026-07-12 신설) ──
    // _handleSPAuthorTags 바로 다음 위치 — K-Compose 게이트 없음.
    const _govTaskHandled = await _handleGovTaskTags(fullReply, bubble, callAI, userText);
    if (_govTaskHandled) return;

    // ── DEPT_TASK 태그 처리 (2026-07-12 신설, B그룹 대응) ──
    // GOV_TASK 바로 다음 위치 — 마찬가지로 게이트 없음.
    const _deptTaskHandled = await _handleDeptTaskTag(fullReply, bubble, callAI, userText);
    if (_deptTaskHandled) return;

    // ── K-Search STEP3 실행 태그 처리 (2026-07-11 Phase 1 신설) ──
    // K-Search가 활성 system일 때만 의미 있다(§0-F 핸드오프 이후 —
    // _forwardSwitchSP/_pushAndSwitchSP로 이미 전환된 상태). 게이트를
    // 안 걸면 다른 SP가 우연히 같은 태그명을 다른 용도로 써도(예:
    // 기존 [SEARCH: type=user]) 오작동할 위험이 있다.
    if (CFG.system?.includes('K-Search')) {
      const _kSearchHandled = await _handleKSearchExecutionTag(fullReply, bubble, callAI, userText);
      if (_kSearchHandled) return;

      // ── K-Search STEP3(미청구 프로필 생성) 태그 처리 (2026-07-12 신설) ──
      // STEP3 실행 태그 바로 다음 위치 — 같은 K-Search 활성 게이트 재사용.
      const _unclaimedHandled = await _handleCreateUnclaimedProfileTag(fullReply, bubble, callAI, userText);
      if (_unclaimedHandled) return;
    }

    // ── hondi-flash 위임 태그 처리 (2026-07-28 신설, Pro/Flash 재설계) ──
    // 웹검색 태그와 같은 성격(외부 호출 후 응답 완결) — 다른 라우팅
    // 태그([GWP:]/[EXPERT:] 등)보다 먼저 확인한다. pro가 위임을 냈다는
    // 건 이미 라우팅 판단까지 끝났다는 뜻이라, 뒤이어 _parseAgentTags가
    // 같은 fullReply를 또 라우팅 태그로 오인해 처리할 이유가 없다.
    const _delegateHandled = await _handleDelegateToFlashTag(fullReply, bubble, callAI, userText);
    if (_delegateHandled) return;

    // ── 웹검색 태그 처리 (2026-07-11 신설, §0-B 경로1 실행부) ──
    // K-Search든 AC 자신(§0-B)이든 낼 수 있어 system 게이트를 안 건다 —
    // [WEB_SEARCH: query=...]는 다른 태그와 이름이 겹치지 않는다.
    const _webSearchHandled = await _handleWebSearchTag(fullReply, bubble, callAI, userText);
    if (_webSearchHandled) return;

    // ── 진단 로그 (2026-09-06 신설) ──────────────────────────
    // 실사 리포트: "검색해서 알려드릴게요"라고 말해놓고 그대로 멈춤.
    // 태그 파서(_handleWebSearchTag) 자체는 정상 동작하므로, 원인은 SP가
    // 사람이 읽는 문장만 내고 기계용 [WEB_SEARCH: query=...] 태그를
    // 빠뜨렸거나(케이스 A), 태그는 냈지만 형식이 깨져(query= 누락 등)
    // 파서 정규식과 안 맞는 경우(케이스 B)로 추정된다 — 두 경우 원인이
    // 다르므로(SP 프롬프트 문제 vs 모델의 태그 문법 실수) 구분해서 남긴다.
    // 사용자에게는 아무 영향 없음(콘솔 로그만).
    if (/검색해\s*(서|드리|드릴게요|보겠습니다)|확인해\s*보겠습니다|알아보겠습니다|찾아드릴게요/.test(fullReply)) {
      if (/\[WEB_SEARCH:/.test(fullReply)) {
        console.warn('[Diag] [WEB_SEARCH: 태그는 있으나 파서 정규식과 불일치(형식 깨짐 추정):', fullReply);
      } else if (!/\[BALANCE_CHECK\]|\[GWP:|\[EXPERT:|\[GOV_TASK|\[DEPT_TASK/.test(fullReply)) {
        console.warn('[Diag] 검색/확인 의도 문구는 있으나 태그 자체가 없음 — SP가 태그를 빠뜨렸을 가능성:', fullReply);
      }
    }

    // ── 재무제표 실시간 조회 태그 처리 (2026-07-13 신설) ──────
    const _balanceCheckHandled = await _handleBalanceCheckTag(fullReply, bubble, callAI, userText);
    if (_balanceCheckHandled) return;

    // ── §9 실행 태그 공용 디스패처 (Phase 0) ────────────────
    // 이전엔 GWP가 자체 정규식으로 fullReply를 스캔했고, 별도로
    // _parseShadowTags(fullReply)라는 미정의 함수가 호출돼 매번
    // ReferenceError를 던지며 이 지점 이후(GWP/EXPERT/AUTH/klaw 감시)를
    // 통째로 막고 있었다(2026-07-01 발견, AGENT-COMMON §0 보유 응답마다
    // 100% 재현). 이제 한 번만 스캔해서 발견된 태그를 순서대로 처리한다.
    _parseAgentTags(fullReply, bubble, userText, _preTab);

    // ── EXPERT 태그 감지 → 전문가 AI(같은 스레드 페르소나) 세션 시작 ──
    // 그림자 AI(AGENT-COMMON) 응답에서만 인식한다 — 페르소나 본인이 발급한
    // 텍스트가 우연히 같은 패턴을 포함해도 재귀적으로 세션을 바꾸지 않도록.
    if (CFG.system?.includes('§0. 정체성')) {
      handleExpertTag(fullReply, userText, _preTab).catch(e =>
        console.warn('[Expert] 태그 처리 오류 (무시):', e.message)
      );
    }

    // ── AUTH 태그 감지 → 인증 요구 ──────────────────────────
    const authMatch = fullReply.match(/\[AUTH:(L[0-3])\]/);
    if (authMatch) {
      const requiredLevel = authMatch[1];
      const stored = JSON.parse(localStorage.getItem('gopang_user_v4') || 'null');
      const currentLevel = stored?.authLevel || 'L0';
      const levels = ['L0','L1','L2','L3'];
      if (levels.indexOf(requiredLevel) > levels.indexOf(currentLevel)) {
        setTimeout(() => _injectAuthConfirmButton(requiredLevel), 400);
      }
    }

    // ── [라우팅 자기점검] GWP↔EXPERT 편향 방지 (2026-08-06 신설) ──
    // 대화 스타일 강제보다 먼저 검사한다 — 라우팅 자체가 잘못됐으면
    // 그 응답의 문서형 여부를 따지는 게 의미가 없다(어차피 재확인
    // 결과에 따라 완전히 다른 응답으로 바뀔 수 있으므로).
    const _routingBiasHandled = await _enforceRoutingBias(fullReply, bubble, callAI, userText);
    if (_routingBiasHandled) return;

    // ── [대화 스타일] 문서형 응답 강제 재작성 (2026-08-06 신설) ──
    // 위 AUTH 처리까지 끝난 뒤, 즉 이번 응답이 정말 최종 응답으로
    // 확정된 시점에 검사한다. _enforceConversationalStyle 내부의
    // CFG.system 가드가 대상 범위(AC·K-Execute·K-Deliver) 밖은
    // 자동으로 제외한다.
    const _styleHandled = await _enforceConversationalStyle(fullReply, bubble, callAI, userText);
    if (_styleHandled) return;

    // K-Law 백그라운드 감시 트리거 — 대화 내용 자동 검토 (비동기)
    setTimeout(() => _klawReview('conversation', null), 3000);


  } catch (err) {
    hideTyping();
    // ★ 2026-08-12 신설 — 실사로 발견: send-message.js가 매 발화마다
    // window.open('', '_blank')로 미리 예약해 두는 _preTab은 지금까지
    // _parseAgentTags(4975행 부근, try 블록 안쪽)가 실행돼야만 닫히거나
    // 실제 URL로 이동했다. 그런데 스트리밍 중 예외가 나서 _parseAgentTags
    // 호출 전에 이 catch로 빠지면(재현: "로그인 상태를 확인해 봐" →
    // 응답이 문장 중간에서 끊기며 about:blank 탭만 방치) 이 catch 블록
    // 어디에도 _preTab 정리 코드가 없어 방치됐다. AbortError 조기 반환
    // 경로도 포함해 항상 먼저 정리한다. cross-origin으로 이미 이동한
    // 탭(_gwpLaunch가 먼저 성공한 뒤 그 다음 단계에서 예외가 난 드문
    // 경우)은 .location.href 읽기 자체가 SecurityError를 던지므로,
    // 그 경우엔 "이미 이동했다"로 간주해 건드리지 않는다(무의미한 탭
    // 강제 종료로 이미 열린 하위 서비스를 사용자 모르게 닫는 사고 방지).
    try {
      if (_preTab && !_preTab.closed) {
        let stillBlank = true;
        try { stillBlank = (_preTab.location.href === 'about:blank'); }
        catch (_) { stillBlank = false; } // cross-origin = 이미 다른 곳으로 이동함
        if (stillBlank) _preTab.close();
      }
    } catch (_) { /* 탭 정리는 부가 기능 — 실패해도 본 오류 처리는 계속 */ }
    if (err.name === 'AbortError') {
      console.log('[AI] 응답 생성이 중지되었습니다 (사용자 요청)');
      document.querySelector('.bubble-ai.streaming')?.classList.remove('streaming');
      return;
    }
    // [2026-08-06 신설 — 워치독] onFailure가 넘어왔다는 건 이 호출이 사용자
    // 최상위 발화가 아니라 오케스트레이션 홉(재귀 sendFn)이라는 뜻이다. 기존
    // 처럼 "⚠️ API 오류: ..." 문구를 그대로 사용자에게 보여주고 조용히
    // 멈추는 대신, 호출부(_handleOrchestrationTags의 워치독)가 실패를 받아
    // AC 복구 판단으로 돌리게 한다. 아래 일반 오류 UI 분기는 건너뛴다.
    if (typeof onFailure === 'function') {
      console.warn('[AI][Watchdog] 오케스트레이션 홉 실패 — onFailure로 위임:', err.message);
      try { await onFailure(err); }
      catch (e2) { console.error('[AI][Watchdog] 복구 콜백 자체가 실패:', e2.message); }
      return;
    }
    const existingBubble = document.querySelector('.bubble-ai.streaming');
    let userMsg = `⚠️ API 오류: ${err.message}`;
    // (2026-07-14: SP-GDC-BILLING-v2_0 파이프라인 연결 — 무료 한도(100원)
    //  소진과 "GDC 잔액도 부족해 최종 차단"을 구분해서 안내한다. 전자는
    //  본인 AI 키 등록으로 우회 가능하지만, 후자는 GDC 충전이 필요하다는
    //  점이 달라 안내 문구/버튼도 다르게 준다.)
    const _isBalanceMsg = err.message.includes('GDC_INSUFFICIENT_BALANCE');
    const _isQuotaMsg = !_isBalanceMsg && (err.message.includes('402') || err.message.includes('Insufficient Balance') ||
      err.message.includes('FREE_QUOTA_EXCEEDED'));
    if (_isBalanceMsg) {
      userMsg =
        '💳 무료로 제공되는 100원어치 AI 사용량을 모두 사용했고, GDC 잔액도 부족해요.<br>' +
        'GDC를 충전한 뒤 다시 이용해 주세요.<br>' +
        '<button onclick="window.location.href=\'usage.html\'" ' +
        'style="margin-top:8px;padding:8px 14px;border:none;border-radius:8px;' +
        'background:#1A73E8;color:#fff;font-weight:600;cursor:pointer">내 GDC 잔액 확인하기</button>';
    } else if (_isQuotaMsg) {
      // BUG FIX(2026-07-01): 이전엔 사용자 키 미등록 시 대화창을 벗어나
      // ai-setup-mobile.html로 강제 이동시켰다 — 가입 직후 강제 LLM 설정
      // 이동을 없앤 것과 정면으로 모순되는 잔재였다. deepseek-default(혼디
      // 제공 무료 기본 키)가 항상 마지막 안전망으로 있으므로, 여기 도달했다는
      // 건 "무료 한도까지 다 썼다"는 뜻이다. 페이지 이동 없이 대화창 안에서
      // 안내하고, 설정으로 가는 버튼만 제공한다.
      userMsg =
        '🔑 무료로 제공되는 100원어치 AI 사용량을 모두 사용했어요.<br>' +
        '설정에서 본인의 AI 키를 등록하시면 제한 없이 계속 쓰실 수 있어요.<br>' +
        '<button onclick="window.openAISettings && window.openAISettings()" ' +
        'style="margin-top:8px;padding:8px 14px;border:none;border-radius:8px;' +
        'background:#1A73E8;color:#fff;font-weight:600;cursor:pointer">AI 설정하러 가기</button>';
    }
    if (existingBubble) {
      existingBubble.classList.remove('streaming');
      existingBubble.innerHTML = userMsg.replace(/\n/g, '<br>');
    } else {
      appendBubble('ai', userMsg, true);
    }
    console.error('[AI]', err);
  }
}



// ── _buildShadowContext — DEPRECATED (v1.1) ─────────────────────────
// 동적 컨텍스트를 system에 주입하던 방식 → _buildEnhancedUserContent로 대체.
// DeepSeek Auto Prompt Caching: system을 완전 정적으로 유지해야 캐시 적중.
// 이 함수는 더 이상 호출되지 않으며, 다음 버전에서 제거됩니다.
async function _buildShadowContext() {
  console.warn('[Shadow] _buildShadowContext는 deprecated — _buildEnhancedUserContent 사용');
  return '';
}

// ── _loadPdvSummary — PDV IndexedDB에서 요약 항목 인출 ──────────────
// _buildEnhancedUserContent 내부에서 localStorage 기반으로 간소화됨.
// IndexedDB 기반 상세 조회가 필요한 경우를 위해 보존.
async function _loadPdvSummary() {
  return new Promise((resolve) => {
    const SAFE_TYPES = ['preference', 'relation', 'economic', 'location'];
    const req = indexedDB.open('gopang_pdv_chat', 1);
    req.onerror = () => resolve([]);
    req.onsuccess = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('messages')) { resolve([]); return; }
      try {
        const tx = db.transaction('messages', 'readonly');
        const store = tx.objectStore('messages');
        const all = store.getAll();
        all.onsuccess = () => {
          const items = (all.result || [])
            .filter(m => m.pdv && SAFE_TYPES.includes(m.pdv.type))
            .sort((a, b) => new Date(b.ts || 0) - new Date(a.ts || 0))
            .slice(0, 20)
            .reduce((acc, m) => {
              if (!acc.find(x => x.key === m.pdv.key)) {
                acc.push({ key: m.pdv.key, value: m.pdv.value });
              }
              return acc;
            }, []);
          resolve(items);
        };
        all.onerror = () => resolve([]);
      } catch { resolve([]); }
    };
  });
}
