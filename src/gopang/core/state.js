/**
 * core/state.js — 고팡 전역 상태 (단일 진실 공급원)
 * 모든 모듈이 이 파일에서 상태를 import하여 공유
 */

// ── 사용자 ───────────────────────────────────────────────
export let _USER     = null;   // 초기화 전 null, initAuth() 완료 후 설정
export let USER_GUID = '';

export function setUser(user) {
  _USER     = user;
  USER_GUID = user?.ipv6 || user?.guid || crypto.randomUUID();
}

// ── AI 상태 ──────────────────────────────────────────────
export let aiActive   = false;
export let micActive  = false;
export let attachFile = null;
export let recognition = null;
export const history  = [];   // { role, content }

export function setAiActive(v) {
  aiActive = v;
  // AI 토글 버튼은 상단 바에 항상 떠 있어 "다시 그려지는" 계기가 없는
  // 유일한 토글이라, 다른 설정 토글들과 달리 화면이 따로 동기화되지
  // 않으면 어긋난 채로 영원히 남는다. 그래서 상태가 바뀌는 이 단일
  // 지점에서 항상 버튼 화면도 같이 맞춘다 — 호출자가 매번 버튼 클래스를
  // 직접 건드릴 필요가 없고, 앞으로 추가되는 코드도 자동으로 안전하다.
  document.getElementById('btn-ai')?.classList.toggle('active', !!v);
}
export function setMicActive(v)   { micActive  = v; }
export function setAttachFile(v)  { attachFile = v; }
export function setRecognition(v) { recognition = v; }

// ── P2P 상태 ─────────────────────────────────────────────
export const PROXY      = 'https://hondi-proxy.tensor-city.workers.dev';

// ── 탈중앙화 이관 ③: P2P 시그널링 L1 직접 엔드포인트 (2026-06-23) ──────
// 이전: 단말 → PROXY /signal/* → Worker → L1 webrtc_signals
// 이후: 단말 → L1_SIGNAL_BASE /signal/* (Worker 경유 없음)
// Worker는 이미 "L1 우선, Supabase 폴백" 구조로 L1을 직접 호출 중.
// 단말이 같은 L1 URL을 직접 호출하면 Worker 경유가 불필요.
// L1 PocketBase webrtc_signals 컬렉션 Rule: 인증 없음 (guid 기반 필터링으로 충분)
// ★ 2026-07-22 버그 수정 — 아래 이 파일의 L1_* 상수 5개가 전부 구 브랜드
// 도메인 l1-hanlim.hondi.net을 가리키고 있었다(주피터 확인: 폐기된
// 레거시 도메인, 더 이상 사용 안 함). 그 도메인의 PocketBase가 hondi.net
// 오리진을 CORS로 허용 안 해서 realtime/프로필 조회가 전부 차단되고,
// 반복 재시도가 서버에 503까지 유발했다(register 화면 "네트워크 오류").
// worker.js·webrtc-realtime.js 등 나머지 전체는 이미 l1-hanlim.hondi.net을
// 쓰고 있었으므로 여기만 뒤처져 있던 것 — l1-hanlim.hondi.net으로 통일.
export const L1_SIGNAL_BASE = 'https://l1-hanlim.hondi.net/api/collections/webrtc_signals/records';
// RTC_CONFIG — 기본값 (STUN 전용)
// fetchRtcConfig() 호출 시 TURN credential 포함 버전으로 교체됨
export const RTC_CONFIG_STUN_ONLY = { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]};

export let RTC_CONFIG = RTC_CONFIG_STUN_ONLY;
export function setRtcConfig(v) { RTC_CONFIG = v; }

// TURN credential 캐시 (55분)
let _rtcConfigCache    = null;
let _rtcConfigCachedAt = 0;

/**
 * Worker /turn/credential 에서 TURN 포함 iceServers 취득.
 * TURN_SECRET 미설정 시 STUN 전용 자동 폴백.
 * @param {string} guid - 사용자 GUID (credential username에 포함)
 */
export async function fetchRtcConfig(guid = '') {
  const now = Date.now();
  if (_rtcConfigCache && now - _rtcConfigCachedAt < 55 * 60 * 1000) {
    return _rtcConfigCache;
  }
  try {
    const res  = await fetch(
      `${PROXY}/turn/credential?guid=${encodeURIComponent(guid)}`,
      { cache: 'no-store' }
    );
    const data = await res.json();
    if (data.ok && Array.isArray(data.iceServers)) {
      const cfg = { iceServers: data.iceServers };
      _rtcConfigCache    = cfg;
      _rtcConfigCachedAt = now;
      setRtcConfig(cfg);
      if (!data.fallback) {
        console.info('[RTC] TURN credential 적용 ✓', data.iceServers.length, 'servers');
      } else {
        console.warn('[RTC] TURN 미설정 — STUN 전용 사용');
      }
      return cfg;
    }
  } catch (e) {
    console.warn('[RTC] TURN credential 취득 실패, STUN 전용 사용:', e.message);
  }
  return RTC_CONFIG_STUN_ONLY;
}

export let _peer       = null;
export let _rtcConn    = null;
export let _rtcChannel = null;
export let _signalPoll = null;
export let _pdvChatDB  = null;

export function setPeerState(v)      { _peer       = v; }
export function setRtcConn(v)        { _rtcConn    = v; }
export function setRtcChannel(v)     { _rtcChannel = v; }
export function setSignalPoll(v)     { _signalPoll = v; }
export function setPdvChatDB(v)      { _pdvChatDB  = v; }

// ── 위치 ─────────────────────────────────────────────────
export let _userLocation    = null;
export let _locationReady   = false;
export let _locationPending = false;

export function setUserLocation(v)    { _userLocation    = v; }
export function setLocationReady(v)   { _locationReady   = v; }
export function setLocationPending(v) { _locationPending = v; }

// ── GWP ──────────────────────────────────────────────────
export let _gwpActive   = false;
export let _gwpService  = null;
export let _gwpTab      = null;
export let _gwpTabTimer = null;

export function setGwpActive(v)   { _gwpActive   = v; }
export function setGwpService(v)  { _gwpService  = v; }
export function setGwpTab(v)      { _gwpTab      = v; }
export function setGwpTabTimer(v) { _gwpTabTimer = v; }

// ── AC↔PA 실시간 채널 (2026-07-27 신설) ──────────────────────
// 주피터님 지시: "AC와 PA는 별개 SP이지만 상호 긴밀히 협조해야 하고,
// AC는 PA의 진행 상황을 실시간으로 파악하고 있어야 한다." PA는 별도
// 탭·별도 history라(EXPERT처럼 같은 배열을 공유하지 않음) 이 두 값을
// 명시적으로 들고 있어야만 AC가 다음 턴에 그걸 참조할 수 있다.
//   _gwpLiveProgress: PA가 진행 중인 동안의 "현재 상태" 스냅샷(계속 덮어씀).
//     매 턴 [ctx]에 짧게 반영돼, 사용자가 AC 탭으로 돌아와도 AC가 "지금
//     프로필 작성 중이시죠"를 알 수 있게 한다. PA 세션이 끝나면(GWP_DONE/
//     탭 닫힘) null로 되돌아간다.
//   _paHandoffPending: PA가 끝났을 때 딱 1번, AC의 다음 응답 직전 [ctx]에
//     실려 들어가는 완료 보고(6하원칙 형태). 소비되면(한 번 [ctx]에
//     반영되면) 즉시 null로 비운다 — firstContact/jobKscoReview 등
//     기존 "1회성 트리거형 컨텍스트"와 동일한 소비 패턴.
export let _gwpLiveProgress  = null;
export let _paHandoffPending = null;

export function setGwpLiveProgress(v)  { _gwpLiveProgress  = v; }
export function setPaHandoffPending(v) { _paHandoffPending = v; }

// ── K-Law ────────────────────────────────────────────────
export let _klawBusy      = false;
export let _klawLastCheck = 0;
export const KLAW_COOLDOWN_MS = 30000;

export function setKlawBusy(v)      { _klawBusy      = v; }
export function setKlawLastCheck(v) { _klawLastCheck = v; }

// ── Supabase (전량 제거 완료, 2026-09-22) ─────────────────
// ★ 2026-08-12 — 45개 저장소 시크릿 스캔에서 이 anon key가 openhash-L1-hanlim
// 포함 최소 12개 저장소 실행 코드에 리터럴로 박혀 공개된 게 발견됨(project
// ref ebbecjfrwaswbdybbgiu). 값 자체는 이미 빈 문자열로 제거돼 있었음 —
// Supabase 대시보드에서의 키 회전은 코드 수정과 무관하게 별도로 필요.
//
// 이 상수를 쓰던 4개 파일: auth.js(L1 PocketBase 직접 호출로 교체),
// pdv/record.js(2026-08-20 Worker PATCH /pdv/ledger-hash·/pdv/chain-height
// 경유로 전환), kcleaner.js(2026-09-22 — 마지막 미해결 항목이었음.
// fiil-kcleaner의 reports 테이블을 kcleaner_reports L1 PocketBase
// 컬렉션으로 확정하고, Worker PATCH /kcleaner/report/:report_code
// 경유로 전환 완료 — _updateFiilReport 참고) — 전부 마이그레이션
// 완료되어 이 파일에서 상수 자체를 제거한다. 남은 위험: nounweb/fiil
// (clean.hondi.net 이관 전 원본)의 webapp.html에 같은 anon key가 아직
// 하드코딩돼 있었음 — clean.hondi.net 이관 시 함께 제거 대상.
export const _SUPABASE_URL = undefined; // deprecated — no longer used anywhere; kept only so a stray import doesn't crash at load time
export const _SUPABASE_KEY = undefined; // deprecated — see _SUPABASE_URL

// ── L1 ───────────────────────────────────────────────────
export const L1_URL = 'https://l1-hanlim.hondi.net/api/collections/profiles/records';

// ── T-C: PDV/OpenHash 앵커링 L1 직접 (2026-06-23) ──────────
// 이전: 단말 → PROXY /pdv/report → Worker → Supabase pdv_log
// 이후: 단말 → L1_PDV_URL 직접 POST (+ block_hash 있으면 L1_ANCHOR_URL도 직접 POST)
export const L1_PDV_URL    = 'https://l1-hanlim.hondi.net/api/collections/pdv_records/records';
export const L1_ANCHOR_URL = 'https://l1-hanlim.hondi.net/api/collections/anchor_records/records';
// P2P 호출 무응답 시 "상대방 AI 비서에게 메시지 남기기" 용 (2026-07-02 신설)
export const L1_P2P_INVITES_URL = 'https://l1-hanlim.hondi.net/api/collections/p2p_pending_invites/records';

// ── 기타 ─────────────────────────────────────────────────
export let _lastPipelineResult = null;

export let _lastFiilReportId   = null;
export let _installBannerVisible = false;

export function setLastPipelineResult(v)   { _lastPipelineResult   = v; }

export function setLastFiilReportId(v)     { _lastFiilReportId     = v; }
export function setInstallBannerVisible(v) { _installBannerVisible = v; }
