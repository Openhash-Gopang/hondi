/**
 * gopang-app.js — 진입점 v3.0
 * 실제 로직은 전부 src/ 하위 모듈에 있음
 * 이 파일의 역할: import → exposeGlobals → bootstrap
 *
 * webapp.html에서 로드 방식:
 *   <script type="module" src="/gopang-app.js"></script>
 */

// ── Core ─────────────────────────────────────────────────
import { initAuth, initAuthWithPhone, _isRegistered, _isGDCUser, _deviceFullReset, _deviceLocalReset, _deleteMyProfile, gopangAuth, _hasConfirmedBackup, _issueSession, _verifyStoredAccountStillExists } from './src/gopang/core/auth.js';
import { loadSettings, CFG, saveSettings, loadDefaultKeyIfNeeded } from './src/gopang/core/config.js';
import { _USER, aiActive, setAiActive, setUser } from './src/gopang/core/state.js';

// ── UI ───────────────────────────────────────────────────
import { appendBubble }                        from './src/gopang/ui/bubble.js';
import { openSettings, closeSettings, handleOverlayClick,
         openAISettings, closeAISettings, handleAISettingsOverlayClick,
         _updateHandleChip, _settingsRegisterHandle,
         clearSWCache, _updateSecuritySection,
         openChatHistory, openHashChain, openGopangWallet, openFinancialStatement,
         openMyProfile, openProfileComposer, openBackupKey,
         applySkinColor,
         openHondiCodeModal, closeHondiCodeModal, _downloadHondiCode,
         openDeviceLinkQR, closeDeviceLinkQR, _copyDeviceLinkQRUrl,
         _resubscribePush,
} from './src/gopang/ui/settings.js';
import { _showRegisterFlow }                   from './src/gopang/ui/register-flow.js';

// ── AI ───────────────────────────────────────────────────
import { toggleAI, activateAI, closeAI, initAIToggleState } from './src/gopang/ai/toggle.js';

// ── P2P ──────────────────────────────────────────────────
import { setPeer, _clearPeer,
         _startSignalPoll }                     from './src/gopang/p2p/webrtc.js';

// ── PDV ──────────────────────────────────────────────────
import { recordPDV }                           from './src/gopang/pdv/record.js';
import { loadChainFromIDB }                    from './src/openhash/hashChain.js';

// ── P2P 검색/채팅 (GDUDA Phase 1) ────────────────────────
import { openSearch as openP2PSearch }         from './src/gopang/ui/p2p-search.js';
import { startIncomingWatch, checkPendingInvites, startP2PCall } from './src/gopang/ui/p2p-chat.js';

// ── 원격 디버깅 콘솔 (2026-07-22 신설) ──────────────────────
// USB/무선 디버깅 연결이 안 되는 실기기에서도 콘솔을 봐야 하는 상황을
// 위해, URL에 ?debug=1(또는 &debug=1)을 붙이면 Eruda(모바일 인페이지
// devtools)를 불러와 화면 위에 떠 있는 콘솔·네트워크 패널로 보여준다.
// 쿼리 파라미터가 없는 일반 사용자 경로에는 전혀 영향 없다(로드 자체를
// 안 함) — 프로덕션 기본 동작과 완전히 분리돼 있어 안전하다.
if (new URLSearchParams(location.search).get('debug') === '1') {
  const _erudaScript = document.createElement('script');
  _erudaScript.src = 'https://cdn.jsdelivr.net/npm/eruda';
  _erudaScript.onload = () => { try { window.eruda.init(); } catch (e) { /* 무시 */ } };
  document.head.appendChild(_erudaScript);
}

// ════════════════════════════════════════════════════════
// 1. 사용자 초기화 — v6.0: Guest 모드 완전 폐지
//
// 이전 버전: 이미 등록된 사용자일 때만 initAuth()를 호출했다(그래서 "등록
// 안 된 사용자는 initAuth를 건너뛰고 그대로 채팅 화면으로 들어가는" 게스트
// 모드가 사실상 기본 동작이었다). 이제는 정반대다 — 등록이 안 되어 있으면
// "무조건" initAuth()로 가입/로그인 팝업을 띄우고, 그 Promise가 resolve될
// 때까지(=가입 또는 로그인 완료) 이 아래 어떤 코드도 #app을 공개하지 않는다.
//
// #app은 CSS에서 기본적으로 visibility:hidden이며(webapp.html 참조),
// body에 gopang-authed 클래스가 붙어야만 보인다 — 즉 "혼디 대화창을 그렸지만
// 팝업으로 가려놨다"가 아니라 "애초에 그려서 보여주지 않는다". initAuth()의
// 전화번호 입력 팝업에는 닫기(X) 버튼이나 바깥 클릭 닫기가 없으므로(의도적),
// 가입/로그인을 완료하지 않고는 이 await를 빠져나갈 방법이 없다.
// ════════════════════════════════════════════════════════
const _hasRegisteredUser = (() => {
  try {
    const s = JSON.parse(localStorage.getItem('gopang_user_v4') || 'null');
    return !!(s?.handle && s?.ipv6);
  } catch { return false; }
})();
void _hasRegisteredUser; // 참고용 — 실제 분기는 initAuth() 내부에서 처리(이미 등록 시 즉시 resolve)
// initAuth()는 가입/로그인 취소, PC 차단, 기기 불일치 후 "닫기" 등의 경로에서
// null로 resolve될 수 있다 — 그 경우에도 #app을 공개하면 게스트 모드가 되살아나므로,
// _isRegistered()로 실제 등록 여부를 직접 재확인하고 아니면 다시 initAuth()를 띄운다.
while (!_isRegistered()) {
  await initAuth();
}
// 이 줄에 도달했다는 것은 곧 _isRegistered() === true라는 뜻 — 이제 대화창을 공개한다.
document.getElementById('gopang-auth-gate')?.remove();
document.body.classList.add('gopang-authed');

// ★ 2026-07-21 신설 — 실사로 발견한 버그: _isRegistered()는 localStorage만
// 보고 판단하므로(서버 재확인 없음), 관리자가 서버에서 계정을 지워도 이
// while 루프 자체가 한 번도 안 돌아 initAuth() 내부의 서버 존재 확인
// 코드가 아예 호출되지 않았다("여전히 로그인 상태"로 계속 남던 사고).
// while 루프를 이미 통과한 이 시점에 별도로 한 번 더, 무조건 확인한다.
//
// ★★ 같은 날 재수정 — 위 코드가 방금 "이 세션에서 막 완료된 신규가입"
// 까지도 검사해버려서 자기모순에 빠졌다: 서버에 방금 쓴 프로필이 조회
// 가능해지기까지의 아주 짧은 복제 지연 사이에 이 확인이 먼저 실행되면
// "없음"으로 오판해 방금 가입한 계정을 그 자리에서 로그아웃시켜 버린다
// (실사로 재현 — 가입 완료 직후 다시 가입 화면으로 돌아가던 사고).
// _hasRegisteredUser는 이 while 루프가 시작되기 "전", 즉 이번 로드에서
// initAuth()가 실행되기 전 시점의 localStorage 상태다 — 그때 이미
// 등록돼 있었다면 "이전 세션부터 있던 계정"이 확실하므로만 검사한다.
// 이번 로드에서 막 새로 가입한 경우(그 전엔 _hasRegisteredUser가
// false였던 경우)는 애초에 삭제될 대상이 아니므로 검사 자체를 건너뛴다.
try {
  if (_hasRegisteredUser) {
    const _storedNow = JSON.parse(localStorage.getItem('gopang_user_v4') || 'null');
    if (_storedNow?.ipv6) _verifyStoredAccountStillExists(_storedNow);
  }
} catch {}

// ── 웹푸시 구독을 모든 가입자의 기본값으로 보장 (2026-07-20 신설) ──────
// 지금까지 requestPushSubscription()은 "신규 가입 완료 시점" 단 1회만
// 자동 호출됐다 — 그 순간 사용자가 권한 팝업을 놓치거나 거부하면(흔함),
// 재유도 경로가 설정 화면의 수동 토글뿐이었다. 그 결과 오래된 계정일수록
// push_subscription이 아예 없는 경우가 실사로 확인됐고, 이는 device-link
// (기기 간 지갑 이전 — 웹푸시로 폰을 깨우는 기능)가 조용히 멈추는
// 직접적 원인이 됐다.
//
// 브라우저 알림 권한은 코드로 강제할 수 없다(사용자 동의 필수, 플랫폼
// 제약) — 그래서 "디폴트로 추가"는 "매번 자동으로 재시도해서, 사용자가
// 한 번이라도 허용하는 순간 반드시 등록되게 한다"로 구현한다. 이미
// 거부(denied)한 사용자에게는 재요청하지 않는다(requestPushSubscription
// 자체가 이미 이 경우 조용히 종료함 — services/push.js 참조).
//
// 매 페이지 로드마다 재시도하면 권한이 아직 결정 안 된(default) 사용자
// 에게는 매번 팝업이 뜰 수 있어 성가시므로, 24시간에 한 번만 재시도한다
// — 그래도 어차피 이미 구독된 사용자는 이 호출이 즉시 재확인만 하고
// 끝나므로(services/push.js의 getSubscription() 우선 확인) 실질적
// 비용은 없다.
(async () => {
  try {
    // ★ 2026-07-22 신설 — javascript: 북마클릿을 모바일 주소창에 입력하기
    // 어렵다는 실사용 피드백. ?debug=1과 동일한 패턴으로, URL에
    // ?resetpush=1(또는 &resetpush=1)을 붙이면 24시간 쿨다운을 건너뛰고
    // 즉시 재시도한다 — 그냥 평범한 URL이라 주소창에 타이핑/편집만 하면
    // 되고 브라우저의 javascript: 스킴 차단과 무관하다. 콘솔을 볼 수
    // 없는 상황을 가정해 결과를 화면에도 말풍선으로 보여준다.
    const _forceRetry = new URLSearchParams(location.search).get('resetpush') === '1';

    const PUSH_RETRY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
    const lastTry = parseInt(localStorage.getItem('gopang_push_last_try') || '0', 10);
    if (!_forceRetry && Date.now() - lastTry < PUSH_RETRY_COOLDOWN_MS) return;

    const stored = JSON.parse(localStorage.getItem('gopang_user_v4') || 'null');
    if (!stored?.ipv6) {
      if (_forceRetry) appendBubble('ai', '🔔 로그인 상태가 아니라 푸시 재구독을 건너뜁니다.');
      return;
    }

    // ★ 2026-07-21 신설 — 실사로 발견한 버그: push_subscription은 계정(guid)당
    // 딱 하나뿐인데(profiles 단일 필드, 기기별 아님), 이 블록이 여태 "이 기기가
    // 실제로 이 계정의 지갑 키를 갖고 있는가"는 전혀 확인하지 않고 localStorage의
    // gopang_user_v4 세션만 보고 구독을 재등록했다. 그 결과, 예전에 이 계정으로
    // 로그인한 적 있는 PC가 device-link(기기 간 지갑 이전) 승인을 "받는 중"인
    // 상태에서도 조용히 자신을 push 대상으로 덮어써서, 폰으로 가야 할 device-link
    // 알림이 엉뚱하게 PC 자신에게 온 채 폰에는 도착하지 않는 문제가 실제로
    // 재현됐다.
    //
    // ★★ 2026-07-21 추가 수정 — 처음엔 GopangWallet.exists()(이 기기 IndexedDB에
    // "어떤" 서명키든 있는지)로만 걸렀는데, 이걸로는 부족하다는 게 바로 그날
    // 실사로 다시 드러났다: GopangWallet.load()는 기존 키 복호화(decryptPrivKey)가
    // 실패하면(OperationError — 기기 엔트로피/WebAuthn 소스가 바뀌는 사설/시크릿
    // 모드 등에서 실제로 재현됨) 에러를 삼키고 null을 반환하고, 그러면 싱글턴
    // 초기화 IIFE가 "최초 실행"으로 오판해 이 guid와 아무 관계 없는 새 키페어를
    // 조용히 자동 생성한다(gopang-wallet.js 하단 IIFE, "새 지갑 자동 생성 완료"
    // 로그). 그 새 키도 exists()엔 true로 잡히므로, "어떤 키든 있으면 통과"였던
    // 이전 체크로는 이 가짜 상태를 걸러내지 못했다. 그래서 이번엔 "키가 있는가"가
    // 아니라 "이 기기의 현재 키가 서버에 이 guid로 실제 등록된 그 키와 서명으로
    // 검증되는가"(_issueSession — 로그인 시 기기 일치를 확인하는 바로 그 함수)를
    // 재사용해 진짜로 확인한다.
    if (typeof window.GopangWallet === 'undefined' || !(await window.GopangWallet.exists())) {
      console.info('[Push] 이 기기에 지갑 키가 없어 기본 구독 보장을 건너뜁니다(세션만 있는 기기로 추정).');
      if (_forceRetry) appendBubble('ai', '🔔 이 기기에 지갑 키가 없어 재구독을 건너뜁니다.');
      return;
    }
    const _verify = await _issueSession(stored.ipv6, 'gopang');
    if (!_verify.ok) {
      console.info('[Push] 이 기기의 지갑 키가 서버 등록 키와 일치하지 않아 기본 구독 보장을 건너뜁니다:', _verify.reason);
      if (_forceRetry) appendBubble('ai', `🔔 이 기기 지갑 키가 서버 등록 키와 안 맞아 재구독을 건너뜁니다 (${_verify.reason}).`);
      return;
    }

    localStorage.setItem('gopang_push_last_try', String(Date.now()));
    const { requestPushSubscription } = await import('/src/gopang/services/push.js');
    const result = await requestPushSubscription(stored.ipv6);
    if (result.ok) {
      console.info('[Push] 기본 구독 보장 완료(guid:', stored.ipv6.slice(0, 12) + '...)');
      if (_forceRetry) appendBubble('ai', '✅ 푸시 재구독 완료 — PC에서 다시 로그인 요청을 보내보세요.');
    } else if (result.reason && result.reason !== 'permission_denied') {
      console.warn('[Push] 기본 구독 보장 실패(다음 재시도까지 대기):', result.reason);
      if (_forceRetry) appendBubble('ai', `⚠️ 푸시 재구독 실패: ${result.reason}`);
    } else if (result.reason === 'permission_denied' && _forceRetry) {
      appendBubble('ai', '🔔 알림 권한이 꺼져 있어 재구독할 수 없습니다. 브라우저 설정 → 알림에서 허용해 주세요.');
    }
  } catch (e) {
    console.warn('[Push] 기본 구독 보장 중 오류(치명적 아님):', e.message);
  }
})();

// ── 고액 거래 재인증(생체인증)도 기본값으로 유도 — 2026-07-20 신설,
// 2026-09-07 개정(사용자 지시) ──────────────────────────────────────
// (사용자 지시: "지문·얼굴 등 생체인식을 사용자 선택이 아니라 디폴트로
// 활성화") 다만 웹푸시 권한과 달리 WebAuthn 등록(navigator.credentials
// .create())은 브라우저가 사용자 제스처 없는 호출을 거부한다 — 완전히
// 조용한 자동 등록은 기술적으로 불가능하다. 그래서 가입 직후(auth.js
// _completeRegistration)에 한 번 자동 시도는 이미 하되, 그게 제스처
// 컨텍스트 만료로 실패했거나 이미 가입된 기존 사용자인 경우를 위해,
// 앱을 열 때 "원탭이면 바로 등록되는" 배너를 띄운다 — 이게 이 플랫폼에서
// "디폴트"에 가장 가깝게 갈 수 있는 방법이다. 24시간 쿨다운으로 매번
// 뜨는 걸 막는다(웹푸시 배너와 동일한 정책).
//
// ★ 2026-09-07 개정 — 지문(step-up) 인증이 이제 "고액 거래 보호"뿐 아니라
// device-link 승인(다른 기기 로그인 확인)과 전화번호 재클레임(번호를
// 다시 등록할 때)에도 필수로 바뀌었다(불법 취득한 폰으로 SMS·웹푸시만
// 받아 본인 인증을 우회하는 걸 막기 위함). 기존 가입자는 이 변경 이전에
// 지문 등록을 건너뛰었을 수 있는데, 그대로 두면 나중에 다른 기기(새 폰
// 등)에서 로그인을 승인하려는 순간 갑자기 막혀서 당황하게 된다 — 그래서
// 배너 문구를 "있으면 좋은 보안 기능"에서 "지금 등록해야 나중에 새 기기
// 승인·번호 재등록이 막히지 않는다"로 바꾼다.
(async () => {
  try {
    if (typeof window.GopangWallet === 'undefined' || !window.PublicKeyCredential) return;
    if (window.GopangWallet.isStepUpEnrolled()) return;

    const STEPUP_NUDGE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
    const lastNudge = parseInt(localStorage.getItem('gopang_stepup_nudge_last') || '0', 10);
    if (Date.now() - lastNudge < STEPUP_NUDGE_COOLDOWN_MS) return;

    const stored = JSON.parse(localStorage.getItem('gopang_user_v4') || 'null');
    if (!stored?.ipv6) return;
    if (!document.getElementById('message-list')) return; // 채팅창 준비 전이면 스킵

    localStorage.setItem('gopang_stepup_nudge_last', String(Date.now()));
    appendBubble('ai',
      '🔒 <strong>지문·Face ID 등록이 꼭 필요해요.</strong><br>' +
      '이제 새 기기에서 로그인을 승인하거나, 전화번호를 다시 등록할 때도 ' +
      '지문 인증이 반드시 있어야 해요 — 등록해두지 않으면 나중에 폰을 ' +
      '바꾸거나 다른 기기를 쓸 때 계정을 못 옮길 수 있어요. ' +
      '(물론 고액 거래를 지키는 데도 계속 쓰여요.)' +
      '<br><button onclick="this.disabled=true;this.textContent=\'등록 중...\';' +
      'window.GopangWallet.enrollStepUpBiometric(JSON.parse(localStorage.getItem(\'gopang_user_v4\')).ipv6)' +
      '.then(r=>{this.textContent=r.ok?\'✅ 등록 완료\':\'등록 실패(\'+r.reason+\') — 설정에서 다시 시도해 주세요\';})' +
      '.catch(e=>{this.textContent=\'등록 실패: \'+e.message;this.disabled=false;});" ' +
      'style="margin-top:8px;padding:8px 14px;border:none;border-radius:8px;' +
      'background:#0057A8;color:#fff;font-size:13px;font-weight:700;cursor:pointer">' +
      '지금 등록하기</button>',
      true
    );
  } catch (e) {
    console.warn('[StepUpBiometric] 등록 유도 배너 표시 실패(치명적 아님):', e.message);
  }
})();

// ── 신규 가입 직후 처리 ────────────────────────────────────────────
// v3.3(2026-07-01): LLM 선택 창(ai-setup-mobile.html)으로 강제 이동시키던
// 로직을 완전히 제거했다. 이제 혼디는 가입 즉시 DeepSeek V4 Flash를
// 무료 한도(1,000원) 내에서 기본 제공한다(call-ai.js _buildCallCandidates()의
// 'deepseek-default' 안전망) — 사용자가 LLM을 고르거나 키를 입력할 필요가
// 전혀 없다. 플래그만 정리하고 그대로 대화창을 보여준다.
if (localStorage.getItem('hondi_new_registration') === '1') {
  localStorage.removeItem('hondi_new_registration');
  // ★ 2026-07-11 수정: 이 시점은 while(!_isRegistered()) 루프를 이미
  // 통과한 뒤라 gopang_user_v4.nickname이 100% 보장된다(_isRegistered()가
  // handle을 확인하고, handle은 nickname과 같은 시점에 같은 객체로
  // localStorage에 쓰인다). 반면 webapp.html의 기존 "페이지 로드 후
  // 고정 300ms" 타이머는 가입 자체가 언제 끝나는지 전혀 모른 채 독립적으로
  // 돌아서, 사용자가 전화번호·OTP 입력에 4초 넘게(실제로는 흔함) 걸리면
  // 닉네임이 준비되기 전에 폴링을 포기하고 빈 이름으로 첫 인사를
  // 내보내던 경합조건이 실사로 확인됐다. 여기서 닉네임이 보장된 시점에
  // 명시적으로 패널을 열면 그 경합 자체가 없어진다 — 기존 타이머가
  // 나중에 한 번 더 openAIPanel()을 불러도 내부 가드(_panelOpen)로
  // 안전하게 무시되므로 중복 트리거 걱정도 없다.
  if (typeof window.openAIPanel === 'function') {
    window.openAIPanel();
  } else {
    // 극히 드문 로드 순서 문제 대비 — 다음 이벤트 루프에서 한 번 더 시도.
    setTimeout(() => { if (typeof window.openAIPanel === 'function') window.openAIPanel(); }, 0);
  }
}

// ★ 버그 수정 — 이미 등록된 사용자(흔한 "재방문" 케이스)는 위 while 루프의
// 조건이 시작부터 참이라 루프 본문(await initAuth())이 단 한 번도 실행되지
// 않는다. setUser()는 initAuth() 내부에서만 호출되므로, 이 경로를 탄
// 사용자는 _isRegistered()(localStorage 기준)는 true이면서도 state.js의
// 메모리 상 _USER는 세션 내내 null로 남는다. p2p-search.js의 연결 요청,
// p2p-chat.js의 시그널링 등 여러 곳이 _isRegistered()가 아니라 메모리 상의
// _USER.ipv6를 직접 참조하므로, 이 상태에서는 분명히 로그인된 사용자인데도
// "로그인이 필요합니다" 오류가 뜨거나 P2P 연결 자체가 조용히 실패한다.
// → while 루프를 빠져나온 시점(_isRegistered()===true가 보장됨)에 _USER가
// 아직 비어있다면, 저장된 사용자 정보로 명시적으로 한 번 동기화한다.
// ※ stored?.ipv6를 추가로 요구하지 않는다 — _isRegistered()는 handle만
// 확인하므로, 여기서 ipv6까지 요구하면 "handle은 있는데 ipv6가 빠진" 데이터에서
// 똑같은 버그가 재발한다. 이미 위에서 _isRegistered()===true가 보장됐으므로
// stored가 존재한다는 사실 자체를 신뢰한다.
if (!_USER) {
  try {
    const stored = JSON.parse(localStorage.getItem('gopang_user_v4') || sessionStorage.getItem('gopang_user_v4') || 'null');
    if (stored) setUser(stored);
  } catch (e) {
    console.warn('[Boot] 이미 등록된 사용자의 _USER 동기화 실패:', e.message);
  }
}

// v6.0: 백업 키를 아직 확인하지 않은 사용자에게 경고 — 가입 직후 단계를
// 거쳤다면 정상적으로는 뜨지 않지만, 이 업데이트 이전에 가입한 기존 사용자나
// (지갑 준비 지연 등으로) 그 단계를 못 거친 경우를 위한 안전망이다.
// v6.1: 이 기기에서 한 번이라도 노출됐으면 이후 영구적으로 다시 표시하지
// 않는다(localStorage). "나중에"를 누르지 않고 그냥 다른 화면으로 이동해도
// 동일하게 적용된다 — 표시되는 순간 바로 "본 것"으로 기록한다.
const BACKUP_WARN_SEEN_KEY = 'gopang_backup_warn_seen_v1';
(function _maybeShowBackupWarn() {
  if (!_isRegistered() || _hasConfirmedBackup()) return;
  if (localStorage.getItem(BACKUP_WARN_SEEN_KEY)) return;
  const banner = document.getElementById('backup-warn-banner');
  if (!banner) return;
  const installShowing = document.getElementById('install-banner')?.classList.contains('show')
    || document.getElementById('ios-install-banner')?.classList.contains('show');
  if (installShowing) banner.classList.add('below-install');
  banner.classList.add('show');
  try { localStorage.setItem(BACKUP_WARN_SEEN_KEY, '1'); } catch (e) {}
})();
window.dismissBackupWarn = function() {
  try { localStorage.setItem(BACKUP_WARN_SEEN_KEY, '1'); } catch (e) {}
  document.getElementById('backup-warn-banner')?.classList.remove('show');
};

// ════════════════════════════════════════════════════════
// 2. 전역 노출 — import 완료 직후 동기 실행
//    HTML의 onclick이 이 시점 이후 즉시 동작 가능
// ════════════════════════════════════════════════════════
(function exposeGlobals() {
  // 설정
  window.openSettings              = openSettings;
  window.openChatHistory           = openChatHistory;
  window.openHashChain             = openHashChain;
  window.openGopangWallet          = openGopangWallet;
  window.openBackupKey             = openBackupKey;
  window.openFinancialStatement    = openFinancialStatement;
  window.openMyProfile             = openMyProfile;
  window.openProfileComposer       = openProfileComposer;
  window.openAISettings            = openAISettings;
  window._deviceFullReset          = _deviceFullReset;
  window._deviceLocalReset         = _deviceLocalReset;
  window._deleteMyProfile          = _deleteMyProfile;
  window._isGDCUser                = _isGDCUser;
  window.closeAISettings           = closeAISettings;
  window.handleAISettingsOverlayClick = handleAISettingsOverlayClick;
  window.closeSettings             = closeSettings;
  window.openHondiCodeModal        = openHondiCodeModal;
  window.closeHondiCodeModal       = closeHondiCodeModal;
  window._downloadHondiCode        = _downloadHondiCode;
  window.openDeviceLinkQR          = openDeviceLinkQR;
  window.closeDeviceLinkQR         = closeDeviceLinkQR;
  window._copyDeviceLinkQRUrl      = _copyDeviceLinkQRUrl;
  window.handleOverlayClick        = handleOverlayClick;
  window.saveSettings              = saveSettings;
  window.clearSWCache              = clearSWCache;
  window._resubscribePush          = _resubscribePush;
  window._settingsRegisterHandle   = _settingsRegisterHandle;
  window._updateHandleChip         = _updateHandleChip;
  window.applySkinColor            = applySkinColor;
  window._settingsRegisterFingerprint = window._settingsRegisterFingerprint || (() => {});
  window._settingsRegisterFace        = window._settingsRegisterFace        || (() => {});

  // 검색 — btn-search는 p2p-search.js의 openSearch(별칭 openP2PSearch)를 쓴다.
  // (2026-07-01 정리: search.js의 openSearch/closeSearch/runSearch/
  //  handleSearchOverlayClick/selectContact/openProfile은 #search-overlay를
  //  대상으로 하나, 그 오버레이를 여는 호출 지점이 코드베이스 어디에도 없어
  //  전부 도달 불가능한 죽은 코드였다 — search.js 파일 자체와 함께 제거.)

  // AI
  window.toggleAI                  = toggleAI;
  window.activateAI                = activateAI;
  window.closeAI                   = closeAI;

  // P2P
  window.setPeer                   = setPeer;
  window._clearPeer                = _clearPeer;

  // P2P 검색/채팅 (GDUDA Phase 1)
  window.openP2PSearch             = openP2PSearch;

  // PDV (하위 시스템 공통)
  window.recordPDV                 = recordPDV;
  window.gopangAuth                = gopangAuth;

  // PWA — gopang-pwa.js 로드 전이므로 빈 함수로 초기화
  // DOMContentLoaded 후 실제 함수로 교체됨
  window.installPWA        = window.installPWA        || (() => {});
  window.dismissInstall    = window.dismissInstall    || (() => {});
  window.dismissIOSInstall = window.dismissIOSInstall || (() => {});
  window.requestInstall    = window.requestInstall    || (() => {});

  console.info('[Gopang v3] 전역 함수 노출 완료');
})();

// ════════════════════════════════════════════════════════
// 3. 설정 복원 + 핸들 칩 초기화
// ════════════════════════════════════════════════════════
loadSettings();
_updateHandleChip(_USER?.nickname || _USER?.handle || null);

// 사용자 키가 없으면 체험 기간 디폴트 키를 Worker에서 fetch
loadDefaultKeyIfNeeded().catch(() => {});

// ════════════════════════════════════════════════════════
// 4. DOMContentLoaded — 나머지 모듈 동적 로드
// ════════════════════════════════════════════════════════
// 체험 기간 만료 이벤트 → 안내 배너 표시
window.addEventListener('hondi:trial_expired', (e) => {
  const msg = e.detail?.message || 'AI 비서 무료 체험 기간이 종료됐습니다.';
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);' +
    'background:#1e293b;color:#fff;padding:12px 20px;border-radius:12px;font-size:13px;' +
    'z-index:9999;max-width:90vw;text-align:center;line-height:1.5;' +
    'box-shadow:0 4px 20px rgba(0,0,0,.3)';
  banner.innerHTML = msg;
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 10000);
});

const _boot = async () => {

  // 4-0. Hash Chain IDB 복원 — prevHash 연속성 보장
  try {
    await loadChainFromIDB();
  } catch(e) {
    console.warn('[Boot] Hash Chain IDB 복원 실패 (무시):', e.message);
  }

  // 4-1. 부트스트랩 (src/app.js)
  // ⚠️ 2026-07-18: src/app.js/shell-ui.js/core/plugin-registry.js는 "고팡 v2"
  //    시절(K서비스 klaw·khealth 2개뿐이던 초기 아키텍처) 유산이다. 지금은
  //    GWP_REGISTRY + SP 파일 + 18개 K서비스 저장소 체계가 이 역할을 완전히
  //    대체했고, bootstrap()의 마지막 단계(ShellUI.render)는 #gopang-shell
  //    마운트 지점이 이 페이지에 없어 매번 조용히 no-op된다(webapp.html은
  //    자기 UI를 직접 구현, registry 결과를 안 씀) — 해롭진 않으나 낭비.
  //    제거 작업은 의도적으로 보류 중(src/tests/phase7_bootstrap.test.js
  //    상단 주석 참고). 착수 시 이 블록 + src/app.js + src/shell-ui.js를
  //    함께 지울 것.
  try {
    const { bootstrap } = await import('./src/app.js');
    await bootstrap();
    document.getElementById('status-dot').style.background = 'var(--green)';
  } catch(e) {
    const st = document.getElementById('status-text');
    const sd = document.getElementById('status-dot');
    if (st) st.textContent = '오프라인 모드';
    if (sd) sd.style.background = 'var(--yellow)';
    console.warn('[Boot] 오프라인 모드:', e.message);
  }

  // 4-2. PWA 함수 재노출 (pwa.js 로드 완료 시점)
  ['installPWA','dismissInstall','dismissIOSInstall','requestInstall'].forEach(fn => {
    if (typeof window[fn] === 'function' && window[fn].toString().includes('{}') === false) return;
    // eslint-disable-next-line no-undef
    if (typeof eval(fn) === 'function') window[fn] = eval(fn);
  });

  // 4-3. 나머지 모듈 병렬 로드
  const [
    { sendMessage, handleKey, updateSendBtn, autoResize },
    { triggerAttach, removeAttach, handleFileSelect, triggerCamera },
    { toggleMic },
    { _scheduleLocation, _updateLocationInPrompt, _buildLocNote },
    { _showWelcomeMessage },
    { _onLogoTap, _closeProgressSheet, _progressStart },
    { _gwpLaunch, _gwpClose },
    { _handleGwpSignRequest },
    { _klawReview },
    { callAI, stopGeneration },
  ] = await Promise.all([
    import('./src/gopang/ui/send-message.js'),
    import('./src/gopang/ui/file-attach.js'),
    import('./src/gopang/ai/mic.js'),
    import('./src/gopang/services/location.js').then(m => {
      // gopang-pwa.js(일반 스크립트)가 CustomEvent로 GPS 초기화 요청을 보냄
      window.addEventListener('gopang:pwa-install-done', () => {
        if (!m._locationReady && !m._locationPending) m._initLocation();
      });
      return m;
    }),
    import('./src/gopang/ui/welcome.js'),
    import('./src/gopang/ui/progress.js'),
    import('./src/gopang/gwp/engine.js'),
    import('./src/gopang/gwp/sign.js'),
    import('./src/gopang/services/klaw.js'),
    import('./src/gopang/ai/call-ai.js'),
  ]);

  // 4-4. 동적 로드 함수 전역 노출
  Object.assign(window, {
    sendMessage, handleKey, updateSendBtn, autoResize,
    triggerAttach, removeAttach, handleFileSelect, triggerCamera,
    toggleMic,
    _onLogoTap, _closeProgressSheet,
    _gwpLaunch, _gwpClose,
    callAI,
  });


  // 4-6. 입력 이벤트 바인딩
  const input   = document.getElementById('msg-input');
  const sendBtn = document.getElementById('send-btn');
  const camBtn  = document.getElementById('btn-camera');
  const micBtn  = document.getElementById('btn-mic');
  const fileInp = document.getElementById('file-input');
  const camInp  = document.getElementById('camera-input');

  if (input) {
    input.addEventListener('input', (ev) => {
      autoResize(input);
      updateSendBtn();
    });
    input.addEventListener('keydown', (e) => handleKey(e));
  }
  const attBtn = document.getElementById('btn-attach');
  if (attBtn)  attBtn.addEventListener('click',  () => triggerAttach());
  if (sendBtn) sendBtn.addEventListener('click', () => {
    if (sendBtn.classList.contains('generating')) stopGeneration();
    else sendMessage();
  });
  if (camBtn)  camBtn.addEventListener('click',  () => triggerCamera());
  if (micBtn)  micBtn.addEventListener('click',  () => toggleMic());
  if (fileInp) fileInp.addEventListener('change', (e) => handleFileSelect(e));
  if (camInp)  camInp.addEventListener('change',  (e) => handleFileSelect(e));

  // 4-7. 초기화
  loadSettings();         // CFG 최신화 (initAIToggleState 판단 기준)
  initAIToggleState();    // 마지막 AI 켬/끔 상태 복원 (또는 설정 직후 첫 부팅 시 자동 켬)
  setAiActive(aiActive);  // 강제 재동기화 — 위 단계에서 상태가 안 바뀌었어도 버튼 화면은 항상 맞춘다
  _showWelcomeMessage();
  _scheduleLocation();

  // 4-8. 등록 사용자 → 시그널 폴링 자동 시작
  if (_isRegistered()) {
    // _startSignalPoll() 비활성화 — webrtc.js의 레거시 _handleOffer/_handleSignal이
    // p2p-chat.js의 객체 payload({sdp, from_handle})를 JSON.parse()하다가 크래시함.
    // offer/answer는 영구 jam(삭제 안 됨), ice는 파싱 실패한 채로 삭제되어 증발.
    // 모든 시그널 처리는 startIncomingWatch (p2p-chat.js) 단일 경로로 통일.
    // _startSignalPoll();
    console.info('[Signal] 레거시 폴링 비활성화 — p2p-chat.js Realtime/폴링 단일화');

    // GDUDA Phase 1 — incoming offer 감시
    if (_USER?.ipv6) startIncomingWatch(_USER.ipv6);

    // 무응답으로 남겨진 P2P 초대 확인 (2026-07-02 신설)
    if (_USER?.ipv6) checkPendingInvites(_USER.ipv6);

    // PC→휴대폰 LLM Key 자동 동기화 — AI 설정 화면을 열지 않아도
    // 앱 시작 시점에 X25519 키를 보장하고, PC가 보낸 대기 설정이 있으면
    // 즉시 적용한다. (전송 채널 자체가 X25519 ECDH로 본인 인증되어 있으므로
    // 추가 확인 버튼 없이 자동 적용해도 안전함)
    import('./src/gopang/ui/settings.js').then(({ _autoApplyPcSyncedSetting }) => {
      if (typeof _autoApplyPcSyncedSetting !== 'function') return;

      // 무한 호출 방지 — 연속 실패 시 재시도 간격을 지수적으로 늘린다(최대 30분).
      // 기존엔 setInterval(60초) 고정이라, L1 wallet/x25519가 526(서버 인증서
      // 오류) 같은 지속적 장애일 때도 영원히 60초마다 같은 실패를 반복했다.
      // (2026-06-27 — 사용량 폭증 원인 분석 중 발견)
      const _SYNC_BASE_MS = 60_000;       // 기본 재시도 간격
      const _SYNC_MAX_MS  = 30 * 60_000;  // 백오프 상한 30분
      let _syncFailCount  = 0;
      let _syncTimerId    = null;

      const _runSync = async () => {
        try {
          const ok = await _autoApplyPcSyncedSetting();
          _syncFailCount = ok ? 0 : _syncFailCount + 1;
          return ok;
        } catch (e) {
          console.warn('[AI설정] 자동 동기화 실패 (무시):', e.message);
          _syncFailCount++;
          return false;
        }
      };

      function _scheduleNextPoll() {
        if (_syncTimerId) clearTimeout(_syncTimerId);
        const delay = Math.min(_SYNC_BASE_MS * (2 ** _syncFailCount), _SYNC_MAX_MS);
        _syncTimerId = setTimeout(async () => {
          await _runSync();
          _scheduleNextPoll(); // 성공/실패 결과에 따라 다음 간격을 다시 계산해 스스로 재예약
        }, delay);
      }

      _runSync().then(_scheduleNextPoll); // 앱 시작 시 1회 즉시 확인 후 폴백 폴링 루프 시작

      // 메인 경로: PC가 키를 전송하면 서버가 즉시 푸시를 보내고, Service Worker가
      // 열려있는 탭에 SYNC_AI_SETTING을 postMessage로 전달한다 — 화면 무관 즉시 반응.
      if (navigator.serviceWorker) {
        navigator.serviceWorker.addEventListener('message', (event) => {
          if (event.data?.type === 'SYNC_AI_SETTING') {
            console.info('[AI설정] 푸시 신호 수신 — 즉시 동기화');
            _runSync(); // 백오프 타이머는 그대로 두고 즉시 1회만 추가 확인(성공 시 실패 카운트도 초기화됨)
          }
        });
      }
      // 폴백 폴링 주기는 위 _scheduleNextPoll()이 기본 60초 → 연속 실패 시
      // 최대 30분까지 늘려가며 스스로 재예약한다 (고정 setInterval 제거).
    }).catch(e => console.warn('[AI설정] settings.js 로드 실패 (무시):', e.message));
  }

  // 4-9. 세션 저장 훅
  const { _saveOnce } = await import('./src/gopang/core/session.js');
  window.addEventListener('pagehide', _saveOnce);
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') _saveOnce();
  });

  // 4-9b. 다른 탭(ai-setup-mobile.html)의 로컬 저장 감지 ──────────
  // 모바일 AI 설정 페이지는 서버를 거치지 않고 localStorage(gopang_cfg)에
  // 직접 쓴다. 그 탭은 닫히고 이 탭(webapp.html)은 계속 떠 있는 경우,
  // storage 이벤트로 변경을 즉시 감지해 새로고침 없이 CFG를 재적용한다.
  // (PC→폰 푸시 동기화용 _runSync와는 별개 경로 — 그쪽은 서버의 seal 큐를
  //  조회하므로 이 로컬 저장 방식의 변경은 감지하지 못한다.)
  //
  // ※ 같은 점검 로직을 visibilitychange(탭 복귀) 시점에도 한 번 더 돌린다.
  //   안드로이드에서 백그라운드 탭이 동결(frozen)되어 storage 이벤트를
  //   놓치는 경우, 탭으로 돌아왔을 때 CFG는 이미 갱신돼 있는데 AI 버튼만
  //   꺼진 채로 남는 "실제로는 켜졌는데 꺼진 것처럼 보이는" 불일치를 막는다.
  const _checkAutoActivateAI = () => {
    loadSettings();
    const hasKey = !!(CFG.apiKey || CFG.geminiKey ||
      (Array.isArray(CFG.providers) && CFG.providers.length));
    if (hasKey && !aiActive) {
      activateAI(true);
      appendBubble('ai', '⚙️ AI 비서 설정이 저장되어 자동으로 활성화되었습니다.');
    }
  };
  window.addEventListener('storage', (e) => {
    if (e.key === 'gopang_cfg' && e.newValue) {
      _checkAutoActivateAI();
    }
    // ai-setup-mobile.html 탭이 저장 완료 후 닫히면서 보내는 신호
    if (e.key === 'gopang_ai_activated' && e.newValue) {
      localStorage.removeItem('gopang_ai_activated');
      _checkAutoActivateAI();
      // 안내 문구는 삭제됨 (2026-06-24, 사용자 요청: 중복 표시 문제로 완전 제거)
    }
  });

  // ── 화면이 다시 보일 때마다 AI 버튼 강제 재동기화 ──────────
  // setAiActive()가 호출될 때마다 버튼도 같이 갱신되지만, 상태값 자체는
  // 안 바뀌고(예: 이미 true) 화면만 어떤 이유로든 어긋난 경우는 setAiActive가
  // 다시 호출되지 않는다. 그래서 화면이 다시 보일 수 있는 모든 시점에
  // setAiActive(aiActive)를 그대로 다시 호출해 강제로 한 번 더 맞춘다.
  const _resyncAIButton = () => setAiActive(aiActive);
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      _checkAutoActivateAI();
      _resyncAIButton();
    }
  });
  window.addEventListener('pageshow', _resyncAIButton); // 뒤로가기 등 BFCache 복원 시

  console.info('[Gopang v3] 부트스트랩 완료');

  // BUG-FIX(2026-07-01): 사용자 요청으로 환영 인사 패널(_showWelcomePopup)
  // 자체를 삭제한다. 다만 그 안에서 미등록 사용자를 번호 입력 화면으로
  // 보내던 역할까지 함께 사라지면 신규 가입 진입로가 없어지므로, 그 부분만
  // 그대로 남긴다.
  if (!_isAlreadyRegistered()) {
    _showRegisterGuide();
  }
};
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', _boot);
} else {
  _boot();
}

// ── 등록 여부 확인 (Guest 모드 폐기 — 부트 시 미등록 사용자 판별용) ──
function _isAlreadyRegistered() {
  try {
    const s = JSON.parse(localStorage.getItem('gopang_user_v4') || 'null');
    return !!(s?.handle && s?.ipv6);  // ipv6가 실제 저장 키
  } catch { return false; }
}

// ── 오디오 자동재생 잠금 해제 (인스턴스 재사용) ──────────────────
// 모바일 브라우저의 자동재생 허용 여부는 "이 페이지가 사용자 동작으로
// 미디어를 재생한 적이 있는가"뿐 아니라, 실무적으로는 동일 Audio
// 인스턴스를 계속 재사용하는 편이 가장 안정적으로 동작한다. 매번
// new Audio()로 새 인스턴스를 만들면 잠금 해제 효과가 새 인스턴스에는
// 적용되지 않아 여전히 차단되는 사례가 있었다 — 그래서 사운드별로 하나의
// Audio 인스턴스만 만들어 두고 이후 전부 그 인스턴스를 재사용한다.
// window에 노출해 p2p-chat.js 등 다른 모듈에서도 같은 인스턴스를 쓴다.
window.__gopangSoundPool = {};
for (const _name of ['ping', 'chime', 'bell', 'drop']) {
  window.__gopangSoundPool[_name] = new Audio(`/assets/sounds/${_name}.mp3`);
}

let _audioUnlocked = false;
function _unlockAudioOnce() {
  if (_audioUnlocked) return;
  _audioUnlocked = true;
  for (const a of Object.values(window.__gopangSoundPool)) {
    const prevVolume = a.volume;
    a.volume = 0.01;
    a.play().then(() => {
      a.pause();
      a.currentTime = 0;
      a.volume = prevVolume;
    }).catch(() => {});
  }
  console.info('[Audio] 첫 사용자 동작 — 자동재생 잠금 해제 시도 완료');
}
document.addEventListener('pointerdown', _unlockAudioOnce, { once: true, capture: true });

// 풀에 있는 같은 인스턴스를 재사용해 재생한다(없으면 새로 생성해 폴백).
function _playPooledSound(name) {
  const a = window.__gopangSoundPool?.[name];
  if (a) {
    a.currentTime = 0;
    a.volume = 1.0;
    return a.play();
  }
  return new Audio(`/assets/sounds/${name}.mp3`).play();
}

function _forcePlayTestSound(tag) {
  console.info(`[TEST-SOUND] ${tag} 트리거됨 — 강제 재생 시도`);
  try { if (navigator.vibrate) navigator.vibrate([300, 100, 300]); }
  catch (e) { console.warn('[TEST-SOUND] vibrate 실패:', e.message); }
  _playPooledSound('ping')
    .then(() => console.info(`[TEST-SOUND] ${tag} 재생 성공`))
    .catch(e => console.warn(`[TEST-SOUND] ${tag} 재생 실패:`, e.name, e.message));
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'PLAY_SOUND') _forcePlayTestSound('postMessage(PLAY_SOUND)');
  });
}

// ── GDC 잔액 실시간 갱신 (2026-08-28 신설, 주피터 지시: "GDC wallet은
// 언제나 최신 정보를 반영해야 합니다") ─────────────────────────────
// 지금까지는 지갑 시트(openGopangWallet)를 열 때, 설정 패널을 열 때,
// AI 응답 완료 1.5초 후에만 서버와 재대사했다 — 전부 "그 화면을 방금
// 열었거나 방금 뭔가 했을 때"에 한정된 시점이었다. 그런데 예를 들어
// 지갑 시트를 이미 열어둔 채로 가만히 있는 동안 다른 경로(관리자
// 알림캡처로 충전 확정 등)로 잔액이 바뀌면, 화면을 다시 열지 않는 한
// 절대 반영되지 않았다.
// 위 SYNC_AI_SETTING·PLAY_SOUND와 동일한 패턴을 그대로 재사용한다 —
// sw.js가 GDC 충전 확정 푸시(tag: 'gdc-charge-confirmed', worker.js
// _mintAndRecordCharge에서 발송)를 받는 즉시 열려있는 모든 탭에
// REFRESH_GDC_BALANCE를 브로드캐스트하고, 여기서 그 신호를 받아
// window.gopangWallet.refreshBalanceUI()를 호출한다. 이 함수(
// gopang-wallet.js)는 이미 헤더(#gdc-balance)·설정 화면(#gdc-balance
// -display) DOM을 갱신하므로, 지갑 시트가 지금 열려있든 닫혀있든
// 화면 어디를 보고 있든 항상 최신값이 즉시 반영된다. 지갑 시트
// 내부의 상세 렌더링(거래 내역 등)까지 실시간 갱신하려면
// openGopangWallet() 쪽에 별도 재렌더 로직이 필요하지만, 최소한
// "잔액 숫자 자체는 항상 최신"이라는 이번 요구사항은 이걸로 충족된다.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'REFRESH_GDC_BALANCE' && window.gopangWallet?.refreshBalanceUI) {
      console.info('[GDC] 충전 확정 푸시 수신 — 잔액 즉시 재대사');
      window.gopangWallet.refreshBalanceUI().catch(() => {});
      // 2026-08-28 추가 — 헤더 숫자뿐 아니라, 지갑 시트(Gopang Wallet)를
      // 지금 열어보고 있는 중이라면 지출/수입/거래내역까지 포함해 통째로
      // 다시 그린다. 시트 타이틀로 판별하는 이유: _openSheet()가 여러
      // 화면(설정/지갑/거래상세 등)이 같은 DOM(#_gopang-sheet-body)을
      // 공유해서 덮어쓰는 구조라, 지갑이 아닌 다른 화면을 보고 있을 때
      // 무턱대고 openGopangWallet()을 부르면 엉뚱한 화면을 덮어써버린다.
      const sheetTitleEl = document.getElementById('_gopang-sheet-title');
      if (sheetTitleEl && sheetTitleEl.textContent === 'Gopang Wallet' && typeof window.openGopangWallet === 'function') {
        window.openGopangWallet();
      }
    }
  });
}

// ── 새 탭 딥링크(?panel=settings|search) — 2026-07-07 신설 ──────────
// AGENT-COMMON의 [OPEN_SETTINGS_TAB]/[OPEN_SEARCH_TAB: query=...] 태그가
// window.open('/webapp.html?panel=...')로 여는 새 탭에서, 이 앱의 나머지
// 초기화(auth 등)를 그대로 다 거친 뒤 해당 패널을 자동으로 연다 — 설정
// 패널은 webapp.html에 이미 존재하는 정적 DOM(수십 개 요소)에 강하게
// 결합돼 있어(openSettings() 참조), 그 마크업을 새 페이지에 복제하는 대신
// webapp.html 자체를 재사용하는 쪽이 훨씬 안전하다(중복 마크업 드리프트
// 위험 없음). 검색은 이미 pages/search-tab.html이라는 전용 새 탭 페이지가
// 있으므로 이 분기 대상이 아니다 — query=search가 오더라도 그쪽으로
// 리다이렉트한다(사용자가 옛 링크를 쓸 경우의 방어적 처리).
(() => {
  const params = new URLSearchParams(location.search);
  const panel = params.get('panel');
  if (!panel) return;

  params.delete('panel');
  const qs = params.toString();
  history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);

  if (panel === 'settings') {
    // openSettings()는 exposeGlobals() 직후(동기) 이미 window에 노출돼
    // 있으나, _USER 등 auth 상태가 완전히 준비된 뒤 열어야 계정 관련
    // 섹션(등록 상태 등)이 정확히 표시된다 — DOMContentLoaded 이후
    // 한 틱 더 기다려 안전하게 호출한다.
    const _tryOpen = () => {
      if (typeof window.openSettings === 'function') window.openSettings();
      else setTimeout(_tryOpen, 100);
    };
    if (document.readyState === 'complete') setTimeout(_tryOpen, 50);
    else window.addEventListener('load', () => setTimeout(_tryOpen, 50));
  } else if (panel === 'search') {
    location.replace('/pages/search-tab.html' + (qs ? '?' + qs : ''));
  }
})();

// ── P2P 연결 위임 수신 — 검색 새 탭(pages/search-tab.html)이 이 탭에게
// 위임한 연결 요청을 실제로 수행 (2026-07-07 신설, p2p-search.js의
// _sendConnectRequest() 참조). P2P 자체를 새 탭에서 여는 기능이 완성되면
// 이 경로는 필요 없어진다 — 그 전까지의 임시 가교.
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin) return;
  if (e.data?.type !== 'HONDI_P2P_CONNECT_REQUEST') return;
  const targetUser = e.data.targetUser;
  if (!targetUser?.guid) return;
  startP2PCall(targetUser).catch(err =>
    console.warn('[P2P] 새 탭 위임 연결 실패:', err.message)
  );
});

// ── 요청자(시민) 측 PDV 기록 — 정부기관 AC 새 탭(pages/regional-gov.html)
// 위임 수신 (2026-07-25 신설) ────────────────────────────────────────
// 발견 경위: 기관 측(AGY_VAULT_STORE→owner_pdv)은 실제로 기록되는데,
// 요청자 자신의 PDV엔 정부기관 상담 이력이 전혀 안 남고 있었다.
// regional-gov.html은 _USER/_userLocation 같은 이 파일(webapp.html 쪽
// 최상위 컨텍스트) 모듈 스코프 상태에 의존하는 _recordPDV()를 직접 호출할
// 수 없는 별도 탭이라(window.open으로 열림), 바로 위 HONDI_P2P_CONNECT_
// REQUEST와 동일한 크로스탭 위임 패턴을 그대로 재사용한다 — 새 프로토콜을
// 만들지 않는다.
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin) return;
  if (e.data?.type !== 'GOV_CONSULTATION_RECORD') return;
  const { what, summary, agency, agencyDisplayName, provinceCode } = e.data;
  if (!what) return;
  import('./src/gopang/pdv/record.js').then(({ _recordPDV }) => _recordPDV({
    type: 'gov_consultation',
    serviceId: 'kgov',
    what,
    summary: summary || what,
    why: `${agencyDisplayName || agency || '정부기관'} 상담`,
    how: 'text',
    domain: 'personal',
    data: { agency, agencyDisplayName, provinceCode },
  })).catch(err => console.warn('[GovConsultation] 요청자 PDV 기록 실패(무시):', err.message));
});

// 알림 클릭으로 새 창이 열린 경우 — URL 쿼리 파라미터(?playSound=...) 존재
// 여부만 보고 무조건 강제 재생 (sound 값/none 체크 등 조건 전부 제거)
(() => {
  const params = new URLSearchParams(location.search);
  if (!params.has('playSound')) return;
  _forcePlayTestSound('URL ?playSound=');
  params.delete('playSound');
  const qs = params.toString();
  history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
})();

// ── 사용자 등록 안내 팝업 (한국 사용자 전화번호 안내) ───────────
function _showRegisterGuide() {
  const ov = document.createElement('div');
  ov.id = 'gopang-register-guide-overlay';
  ov.style.cssText = [
    'position:fixed;inset:0;z-index:10000',
    'background:rgba(0,0,0,.5)',
    'display:flex;align-items:center;justify-content:center',
    'padding:24px',
  ].join(';');

  ov.innerHTML = `
    <div style="
      background:#fff;border-radius:12px;
      width:100%;max-width:340px;
      padding:28px 24px 24px;
      font-family:'Pretendard',-apple-system,sans-serif;
    ">
      <div style="font-size:15px;font-weight:600;color:#111;margin-bottom:20px;letter-spacing:-.2px">
        사용자 등록
      </div>

      <div style="
        border-left:3px solid #111;
        padding:12px 14px;
        font-size:13.5px;color:#333;line-height:1.8;
        margin-bottom:12px;
      ">
        <code style="font-size:13px;font-weight:600;">010</code>을 제외한 나머지
        <strong>8자</strong>를 대시(<code>-</code>)없이 입력하세요.
      </div>

      <div style="font-size:12px;color:#888;margin-bottom:16px;line-height:1.6">
        귀하의 고유 로그인 + 패스워드입니다.
      </div>

      <!-- 번호 입력 필드 -->
      <div style="display:flex;align-items:center;
                  border:1.5px solid #e5e7eb;border-radius:10px;
                  background:#f9fafb;overflow:hidden;margin-bottom:8px"
           id="_rg-field">
        <span style="padding:0 12px;font-size:13px;color:#555;
                     border-right:1px solid #e5e7eb;height:50px;
                     display:flex;align-items:center;white-space:nowrap">
          🇰🇷 010 -
        </span>
        <input id="_rg-input" type="tel" maxlength="8" inputmode="numeric"
          placeholder="12345678"
          style="flex:1;padding:0 14px;height:50px;border:none;background:transparent;
                 font-size:18px;font-family:inherit;outline:none;color:#111;
                 letter-spacing:3px;min-width:0"/>
      </div>
      <div id="_rg-error" style="display:none;font-size:12px;color:#dc2626;margin-bottom:8px;padding:0 4px"></div>
      <div style="font-size:11px;color:#aaa;margin-bottom:20px;padding:0 4px">
        예) 010-1234-5678 → <code style="font-weight:600;color:#555">12345678</code>
      </div>

      <button id="_rg-ok" style="
        width:100%;padding:14px;
        background:#111;color:#fff;border:none;
        border-radius:8px;font-size:14px;font-weight:600;
        cursor:pointer;font-family:inherit;letter-spacing:-.1px;
      ">시작하기</button>
    </div>
  `;

  document.body.appendChild(ov);

  const inp   = ov.querySelector('#_rg-input');
  const okBtn = ov.querySelector('#_rg-ok');
  const errEl = ov.querySelector('#_rg-error');
  const field = ov.querySelector('#_rg-field');

  inp.focus();
  inp.addEventListener('focus', () => field.style.borderColor = '#111');
  inp.addEventListener('blur',  () => field.style.borderColor = '#e5e7eb');
  inp.addEventListener('input', () => {
    inp.value = inp.value.replace(/\D/g, '').slice(0, 8);
    errEl.style.display = 'none';
  });

  const doSubmit = async () => {
    const val = inp.value.trim();
    if (val.length !== 8) {
      errEl.textContent = '8자리를 모두 입력해 주세요.';
      errEl.style.display = 'block';
      inp.focus();
      return;
    }
    okBtn.disabled = true;
    okBtn.textContent = '확인 중…';
    // 번호를 localStorage에 임시 저장 후 initAuth 호출
    // initAuth는 내부적으로 번호 입력 팝업을 띄우므로
    // 여기서는 직접 _phone-input에 값을 주입하는 방식 사용
    ov.remove();
    await initAuthWithPhone(val);
    const stored = JSON.parse(localStorage.getItem('gopang_user_v4') || 'null');
    if (stored?.handle && typeof _updateHandleChip === 'function') {
      _updateHandleChip(stored.nickname || stored.handle);
    }
    // ── Bug Fix: 등록 완료 후 설정 창 자동 열기 제거 ──
    // (사용자가 직접 설정 버튼을 눌러야 열림)
  };

  okBtn.onclick = doSubmit;
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') doSubmit(); });
}
