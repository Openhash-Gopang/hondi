/* ══════════════════════════════════════════════════════════════════
   k-service-auth-client.js — K-서비스 공용 전화번호 인증 모듈 (v2.0)

   배포 위치: https://app.naviweb.kr/auth/k-service-auth-client.js

   v2.0(2026-09-06 저녁, 주피터 지시로 긴급 수정): v1.0은 SMS 인증번호를
   직접 입력받는 UI(받기→인증번호 입력→확인)를 기본/대체 경로로
   제공했으나, 이는 잘못된 이해였다. plan.hondi.net의 실제 최종 설계
   (git 커밋 17acc3d "로그인 팝업에서 문자 인증 대체 버튼 삭제 -
   device-link 단일 경로로 정리")를 확인한 결과, SMS 인증번호 직접
   입력은 가입 시점에만(다른 채널에서) 쓰이고, 이 로그인 팝업에서는
   device-link(웹푸시 승인) 단 하나의 경로만 제공해야 한다 — 전화번호를
   입력하고 이 버튼을 누르면 폰에 알림이 가고, 폰에서 "본인 확인"
   버튼을 탭하는 것으로 끝난다. 이 페이지에는 인증번호를 손으로
   입력하는 UI 자체가 없다(가입 안 된/기기 연결 안 된 번호는 서버가
   /auth/device-link/init 응답의 hasMobileDevice 여부로 판단해 별도
   채널로 처리한다 — 클라이언트는 그저 폴링만 한다). v1.0의 SMS 입력
   UI는 완전히 제거했다.

   대상: plan.naviweb.kr(webapp.html) · klaw.naviweb.kr(webapp.html) ·
   mail.naviweb.kr(webapp.html) · hondi.net(desktop.html GDC 대시보드).
   ※ /assets/site-header.js(다른 19개 페이지가 쓰는 기존 공용 모듈)와는
     별개의 모듈이다.

   사용법 — 각 페이지의 <body> 시작 부분에 한 줄:

     <script>
       window.K_AUTH_CONFIG = {
         serviceLabel: 'K-Law',   // 로그인 UI에 표시될 서비스명(선택)
       };
     </script>
     <script src="https://app.naviweb.kr/auth/k-service-auth-client.js"></script>

   공개 API (window.KAuth):
     await KAuth.ensureLogin()        — 로그인 안 돼 있으면 오버레이를 띄우고 완료까지 대기, 토큰 문자열 반환
     KAuth.getToken()                 — 현재 유효한 토큰(없으면 null), 오버레이 없음
     KAuth.hasValidLogin()            — boolean
     KAuth.logout()                   — 로그아웃(쿠키 삭제)
     await KAuth.fetchWithAuth(url, opts) — phone_verify_token을 자동 첨부해 fetch,
                                             일시적 인증 오류는 조용히 재시도, 진짜
                                             만료/무효일 때만 재로그인 오버레이 표시
                                             (GET/HEAD는 쿼리스트링에, 그 외는 JSON
                                             body에 phone_verify_token 필드로 첨부).
                                             만료가 7.5일 이내로 남았으면 요청 전에
                                             /auth/refresh-token으로 조용히 30일 창을
                                             새로 연다(2026-09-12 신설 — Gmail처럼
                                             활동 중엔 재인증 없이 유지, 주피터 지시).
   ══════════════════════════════════════════════════════════════════ */

(function (global) {
  if (global.KAuth) return; // 중복 로드 방지

  var PROXY         = 'https://hondi-proxy.tensor-city.workers.dev';
  var COOKIE_DOMAIN = (global.K_AUTH_CONFIG && global.K_AUTH_CONFIG.cookieDomain) || (/(^|\.)naviweb\.kr$/.test(location.hostname) ? '.naviweb.kr' : location.hostname);
  var COOKIE_TOKEN  = 'hondi_pvt';
  var COOKIE_EXP    = 'hondi_pvt_exp';
  // 2026-09-12 신설 — 슬라이딩 세션 갱신 임계값(주피터 지시: Gmail처럼
  // 활동 중엔 재인증 없이 유지). 만료까지 이 시간 이하로 남으면
  // fetchWithAuth가 요청 직전에 조용히 /auth/refresh-token을 불러 30일
  // 창을 새로 연다. 30일 TTL의 1/4 지점(7.5일 전)부터 갱신을 시도해
  // 두면, 그 사이 한 번이라도 접속이 있으면 절대 만료되지 않는다.
  var REFRESH_WINDOW_MS = 7.5 * 24 * 60 * 60 * 1000;

  var cfg = Object.assign({
    serviceLabel: document.title || 'K-서비스',
    icon: '🧭',
  }, global.K_AUTH_CONFIG || {});

  // ── 쿠키 유틸 (.hondi.net 도메인 — 모든 서브도메인이 공유) ──────
  function readCookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function writeCookie(name, value, maxAgeSec) {
    document.cookie = name + '=' + encodeURIComponent(value) +
      '; domain=' + COOKIE_DOMAIN + '; path=/; max-age=' + maxAgeSec + '; secure; samesite=lax';
  }
  function clearCookie(name) {
    document.cookie = name + '=; domain=' + COOKIE_DOMAIN + '; path=/; max-age=0; secure; samesite=lax';
  }

  // ── 토큰 상태 ────────────────────────────────────────────────
  var token = null, tokenExp = 0;
  var waiters = [];

  function loadFromCookie() {
    var t = readCookie(COOKIE_TOKEN);
    var e = Number(readCookie(COOKIE_EXP) || 0);
    if (t && e && Date.now() < e - 30000) { token = t; tokenExp = e; return true; }
    return false;
  }
  // 2026-10-27 신설 — 로그인 상태가 바뀌면 같은 페이지의 /auth/user-badge.js(우측 상단 아이디 표시)가
  // 바로 다시 그리도록 알린다. 이벤트를 듣는 쪽이 없어도 아무 영향이 없다.
  function notifyAuthChange() {
    try { global.dispatchEvent(new CustomEvent('hondi-auth-change')); } catch (e) { /* 구형 브라우저 */ }
  }
  function persist(t, exp) {
    token = t; tokenExp = exp;
    var maxAge = Math.max(1, Math.floor((exp - Date.now()) / 1000));
    writeCookie(COOKIE_TOKEN, t, maxAge);
    writeCookie(COOKIE_EXP, String(exp), maxAge);
    notifyAuthChange();
  }
  function clear() {
    token = null; tokenExp = 0;
    clearCookie(COOKIE_TOKEN);
    clearCookie(COOKIE_EXP);
    notifyAuthChange();
  }
  function hasValidLogin() { return !!token && Date.now() < tokenExp - 30000; }

  // ── 슬라이딩 세션 갱신 (2026-09-12 신설) ─────────────────────
  // in-flight 갱신 요청을 하나로 합친다 — 같은 페이지에서 여러
  // fetchWithAuth 호출이 동시에 임계값을 넘기면(예: 탭을 여러 개 열어둔
  // 상태로 복귀), 갱신 요청이 N번 중복 발사되는 대신 하나만 나가고
  // 나머지는 그 결과를 같이 기다린다.
  var refreshing = null;
  function maybeRefresh() {
    if (!token || !tokenExp) return Promise.resolve();
    if (tokenExp - Date.now() > REFRESH_WINDOW_MS) return Promise.resolve(); // 아직 여유 있음
    if (refreshing) return refreshing;
    refreshing = fetch(PROXY + '/auth/refresh-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone_verify_token: token }),
    }).then(function (res) {
      return res.json().catch(function () { return {}; });
    }).then(function (data) {
      if (data.ok && data.phone_verify_token) {
        persist(data.phone_verify_token, new Date(data.expires_at).getTime());
      }
      // 실패해도 조용히 무시한다 — 기존 토큰이 아직 유효하니(임계값을
      // 막 넘긴 시점일 뿐 만료된 건 아님) 지금 이 요청은 그대로 진행되고,
      // 다음 fetchWithAuth 호출 때 다시 시도된다. 일시적 네트워크 오류로
      // 세션이 끊기는 걸 막기 위해 실패를 사용자에게 노출하지 않는다.
    }).catch(function () { /* 네트워크 오류 — 다음 호출 때 재시도 */ })
      .finally(function () { refreshing = null; });
    return refreshing;
  }

  // ── 오버레이 UI (자체 주입 — 페이지에 마크업 불필요) ────────────
  // device-link(웹푸시 승인) 단일 경로만 제공한다 — SMS 인증번호를
  // 손으로 입력하는 화면은 없다(v2.0, 위 헤더 주석 참고).
  var els = {};
  function injectStyle() {
    if (document.getElementById('ksa-style')) return;
    var style = document.createElement('style');
    style.id = 'ksa-style';
    style.textContent =
      // Material Design 스타일(2026-11-14, 주피터 승인 시안): 밑줄 입력칸 · 전체 폭 버튼 · 문자(텍스트) 버튼 · 고도 그림자. 강조색은 --ksa-accent 한 곳에서 바꾼다.
      '#ksa-overlay{--ksa-accent:#00796B;--ksa-err:#D32F2F;position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;padding:24px;font-family:"Noto Sans KR",Roboto,Pretendard,-apple-system,BlinkMacSystemFont,"Malgun Gothic",sans-serif}' +
      '#ksa-overlay.show{display:flex}' +
      '.ksa-box{background:#fff;border-radius:4px;padding:32px 32px 12px;width:100%;max-width:360px;box-sizing:border-box;box-shadow:0 11px 15px -7px rgba(0,0,0,.2),0 24px 38px 3px rgba(0,0,0,.14),0 9px 46px 8px rgba(0,0,0,.12)}' +
      '.ksa-icon-row{display:block;margin-bottom:24px}' +
      '.ksa-icon{display:none}' +
      '.ksa-desc{font-size:20px;font-weight:500;color:#212121;line-height:1.3}' +
      '.ksa-field{margin-bottom:0}' +
      '.ksa-field label{display:block;font-size:14px;font-weight:500;color:var(--ksa-accent)}' +
      '.ksa-field input{display:block;width:100%;box-sizing:border-box;border:0;border-bottom:2px solid var(--ksa-accent);border-radius:0;padding:6px 0 8px;background:transparent;outline:none;font-size:20px;letter-spacing:2px;color:#212121;font-family:inherit}' +
      '.ksa-field input.ksa-invalid{border-bottom-color:var(--ksa-err)}' +
      '.ksa-field:has(.ksa-invalid) label{color:var(--ksa-err)}' +
      '.ksa-hint{margin-top:6px;font-size:14px;color:#616161}' +
      '.ksa-cta{display:block;width:100%;height:48px;margin-top:24px;border:0;border-radius:4px;background:var(--ksa-accent);color:#fff;font-size:17px;font-weight:500;letter-spacing:.5px;font-family:inherit;cursor:pointer;box-shadow:0 2px 2px 0 rgba(0,0,0,.14),0 3px 1px -2px rgba(0,0,0,.12),0 1px 5px 0 rgba(0,0,0,.2);transition:box-shadow .15s}' +
      '.ksa-cta:disabled{opacity:.5;cursor:not-allowed}' +
      '.ksa-cta:not(:disabled):hover{box-shadow:0 4px 5px 0 rgba(0,0,0,.14),0 1px 10px 0 rgba(0,0,0,.12),0 2px 4px -1px rgba(0,0,0,.2)}' +
      '.ksa-input-wrap{display:flex;gap:8px;align-items:flex-end}' +
      '.ksa-input-wrap input{flex:1;min-width:0;border:0;border-bottom:2px solid var(--ksa-accent);border-radius:0;padding:6px 0 8px;background:transparent;outline:none;font-size:18px;letter-spacing:1px;font-family:inherit}' +
      '.ksa-input-icon-btn{border:none;background:var(--ksa-accent);color:#fff;border-radius:4px;width:44px;height:44px;flex-shrink:0;font-size:17px;cursor:pointer}' +
      '.ksa-input-icon-btn:disabled{opacity:.5;cursor:not-allowed}' +
      '.ksa-devlink-wait{padding:0;text-align:center}' +
      '.ksa-spinner{position:relative;height:4px;margin:0 -32px 24px;background:#B2DFDB;overflow:hidden}' +
      '.ksa-spinner::before{content:"";position:absolute;top:0;bottom:0;width:40%;background:var(--ksa-accent);animation:ksa-ind 1.6s linear infinite}' +
      '@keyframes ksa-ind{0%{left:-40%}100%{left:100%}}' +
      '.ksa-match-sub{font-size:17px;color:#424242}' +
      '.ksa-match-num{display:inline-flex;align-items:center;justify-content:center;min-width:128px;height:88px;margin-top:14px;border-radius:12px;background:#E0F2F1;color:var(--ksa-accent);font-size:56px;font-weight:700;letter-spacing:2px;font-family:Roboto,inherit}' +
      '.ksa-sms{display:block;margin:12px auto 0;border:0;background:transparent;color:var(--ksa-accent);border-radius:4px;height:48px;padding:0 12px;font-size:16px;font-weight:500;font-family:inherit;cursor:pointer}' +
      '.ksa-sms:disabled{opacity:.5;cursor:not-allowed}' +
      '.ksa-resend{display:inline-block;margin-top:8px;padding:12px;font-size:16px;font-weight:500;color:var(--ksa-accent);cursor:pointer}' +
      '.ksa-msg{font-size:15px;margin-top:8px;text-align:left;min-height:16px}' +
      '.ksa-msg.err{color:var(--ksa-err)}' +
      '.ksa-msg.ok{color:#1b6b3a}' +
      '.ksa-cancel{display:block;margin:4px -8px 0 auto;border:0;background:transparent;color:#616161;border-radius:4px;height:48px;padding:0 12px;font-size:16px;font-weight:500;font-family:inherit;cursor:pointer}' +
      '.ksa-cancel:hover{background:rgba(0,0,0,.05)}' +
      '.ksa-su-row{margin-top:8px;font-size:16px;color:#616161}' +
      '.ksa-su-row a{color:var(--ksa-accent);font-weight:500;cursor:pointer;padding:8px 4px}' +
      '.ksa-su-title{font-size:19px;font-weight:500;color:#212121;margin-bottom:4px}' +
      '.ksa-su-sub{font-size:15px;color:#616161;margin-bottom:12px}' +
      '.ksa-su-tabs{display:flex;gap:0;margin-bottom:12px;border-bottom:1px solid #E0E0E0}' +
      '.ksa-su-tabs button{flex:1;height:48px;border:0;border-bottom:2px solid transparent;background:transparent;color:#616161;font-size:16px;font-weight:500;font-family:inherit;cursor:pointer}' +
      '.ksa-su-tabs button.on{border-bottom-color:var(--ksa-accent);color:var(--ksa-accent)}' +
      '#ksa-su-qrbox{display:flex;justify-content:center;margin:4px 0 8px}#ksa-su-qrbox svg{width:168px;height:168px}';
    document.head.appendChild(style);
  }

  function ensureOverlay() {
    if (els.overlay) return;
    injectStyle();
    var wrap = document.createElement('div');
    wrap.id = 'ksa-overlay';
    wrap.innerHTML =
      '<div class="ksa-box">' +
        '<div class="ksa-icon-row"><span class="ksa-icon">' + cfg.icon + '</span>' +
          '<div class="ksa-desc" id="ksa-desc">naviweb 로그인</div></div>' +
        '<div id="ksa-step-phone">' +
          '<div class="ksa-field"><label for="ksa-phone">폰 번호 뒷 8자리</label>' +
            '<input type="tel" id="ksa-phone" inputmode="numeric" maxlength="8" autocomplete="tel" aria-describedby="ksa-phone-hint">' +
            '<div class="ksa-hint" id="ksa-phone-hint">010을 제외한 8자리</div></div>' +
          '<button type="button" class="ksa-cta" id="ksa-devlink-btn">로그인</button>' +
          '<div class="ksa-su-row">처음이세요? <a id="ksa-signup-link" role="button" tabindex="0">회원 가입</a></div>' +
        '</div>' +
        '<div id="ksa-step-signup" style="display:none">' +
          '<div class="ksa-su-title">회원 가입</div>' +
          '<div class="ksa-su-sub">무료 플랜으로 시작합니다. 가입은 스마트폰에서 이어집니다.</div>' +
          '<div class="ksa-su-tabs"><button type="button" id="ksa-su-qr-tab" class="on">QR로 가입</button><button type="button" id="ksa-su-sms-tab">문자로 링크 받기</button></div>' +
          '<div id="ksa-su-sms" style="display:none;margin-bottom:10px"><div class="ksa-input-wrap">' +
            '<input type="tel" id="ksa-su-phone" placeholder="전화번호 뒷 8자리" inputmode="numeric" maxlength="8" autocomplete="tel">' +
            '<button type="button" class="ksa-input-icon-btn" id="ksa-su-send" aria-label="가입 링크 문자 받기" title="가입 링크 문자 받기"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>' +
          '</div></div>' +
          '<div id="ksa-su-wait" style="display:none;text-align:center">' +
            '<div id="ksa-su-qrbox"></div>' +
            '<div style="font-size:12.5px;color:#374151">폰에서 이 숫자를 고르세요</div>' +
            '<div id="ksa-su-num" style="font-size:40px;font-weight:800;letter-spacing:2px;color:#4338CA;margin-top:2px"></div>' +
            '<div id="ksa-su-status" style="font-size:16px;color:#4A5568;margin-top:4px"></div>' +
            '<div id="ksa-su-timer" style="font-size:14px;color:#718096;margin-top:4px"></div>' +
          '</div>' +
          '<div class="ksa-resend" id="ksa-su-back">로그인으로 돌아가기</div>' +
        '</div>' +
        '<div id="ksa-step-devlink" style="display:none">' +
          '<div class="ksa-devlink-wait">' +
            '<div class="ksa-spinner"></div>' +
                        '<div id="ksa-match" style="display:none"><div class="ksa-match-sub">폰에서 이 숫자를 선택하세요</div><div id="ksa-match-num" class="ksa-match-num"></div></div>' +
            '<div id="ksa-devlink-status" style="font-size:17px;color:#4A5568;text-align:center"></div>' +
            '<div id="ksa-devlink-timer" style="font-size:15px;color:#718096;text-align:center;margin-top:4px"></div>' +
          '</div>' +
          '<button type="button" class="ksa-sms" id="ksa-push-btn" style="display:none">알림 다시 보내기</button>' +
          '<button type="button" class="ksa-sms" id="ksa-sms-btn" style="display:none">문자로 받기</button>' +
          '<div class="ksa-resend" id="ksa-resend-phone">다시 입력</div>' +
        '</div>' +
        '<div class="ksa-msg" id="ksa-msg"></div>' +
        '<button type="button" class="ksa-cancel" id="ksa-cancel">취소</button>' +
      '</div>';
    document.body.appendChild(wrap);
    els.overlay      = wrap;
    els.desc         = wrap.querySelector('#ksa-desc');
    els.stepPhone    = wrap.querySelector('#ksa-step-phone');
    els.stepDevlink  = wrap.querySelector('#ksa-step-devlink');
    els.phone        = wrap.querySelector('#ksa-phone');
    els.msg          = wrap.querySelector('#ksa-msg');
    els.devlinkBtn   = wrap.querySelector('#ksa-devlink-btn');
    els.devlinkStatus= wrap.querySelector('#ksa-devlink-status');
    els.matchBox     = wrap.querySelector('#ksa-match');
    els.matchNum     = wrap.querySelector('#ksa-match-num');
    els.devlinkTimer = wrap.querySelector('#ksa-devlink-timer');
    els.resendPhone  = wrap.querySelector('#ksa-resend-phone');
    els.smsBtn       = wrap.querySelector('#ksa-sms-btn');
    els.smsBtn.onclick = sendSmsLink;
    els.pushBtn      = wrap.querySelector('#ksa-push-btn');
    els.pushBtn.onclick = function () { pushAgain(false); };
    els.stepSignup = wrap.querySelector('#ksa-step-signup');
    wrap.querySelector('#ksa-signup-link').onclick = openSignup;
    wrap.querySelector('#ksa-signup-link').onkeydown = function (e) { if (e.key === 'Enter') openSignup(); };
    wrap.querySelector('#ksa-su-qr-tab').onclick = function () { signupTab('qr'); };
    wrap.querySelector('#ksa-su-sms-tab').onclick = function () { signupTab('sms'); };
    wrap.querySelector('#ksa-su-send').onclick = function () { startSignup('sms'); };
    wrap.querySelector('#ksa-su-phone').addEventListener('keydown', function (e) { if (e.key === 'Enter') startSignup('sms'); });
    wrap.querySelector('#ksa-su-back').onclick = closeSignup;

    els.desc.textContent = PHONE_TITLE();
    wrap.querySelector('#ksa-cancel').onclick = cancelOverlay;
    els.devlinkBtn.onclick = startLogin;
    els.resendPhone.onclick = resetToPhoneStep;
    els.phone.addEventListener('keydown', function (e) { if (e.key === 'Enter') startLogin(); });
  }

  // 문자로 승인 링크 받기 — 폰 구독이 없을 때만 보인다. 문자는 비용이 들어 자동 발송하지 않고 사용자가 누를 때 한 번 보낸다(서버가 횟수·시간당 제한).
  function showSmsButton(on) {
    if (!els.smsBtn) return;
    els.smsBtn.style.display = on ? '' : 'none';
    if (on) { els.smsBtn.disabled = false; els.smsBtn.textContent = '문자로 받기'; }
  }
  async function sendSmsLink() {
    var sid = devlinkSessionIds[devlinkSessionIds.length - 1];
    if (!sid || els.smsBtn.disabled) return;
    els.smsBtn.disabled = true; els.smsBtn.textContent = '문자 발송 중…';
    try {
      var res = await fetch(PROXY + '/auth/device-link/resend-sms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sid }) });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.detail || data.message || '문자 발송에 실패했습니다.');
      els.smsBtn.textContent = '문자를 보냈습니다';
      els.devlinkStatus.textContent = '문자로 받은 링크를 폰에서 열어 승인해 주세요.';
    } catch (e) {
      els.smsBtn.disabled = false; els.smsBtn.textContent = '문자로 받기';
      els.devlinkStatus.textContent = e.message || '문자 발송에 실패했습니다.';
    }
  }
  function PHONE_TITLE() { return (cfg.serviceLabel && cfg.serviceLabel !== 'K-Mail' ? cfg.serviceLabel : 'naviweb') + ' 로그인'; }
  function setMsg(text, kind) {
    if (els.phone) els.phone.classList.toggle('ksa-invalid', kind === 'err');
    els.msg.textContent = text || '';
    els.msg.className = 'ksa-msg' + (kind ? ' ' + kind : '');
    els.msg.setAttribute('role', 'alert');
  }
  // 승인 대기 화면에서는 제목을 "폰에서 승인하세요" 한 줄로 바꾼다(번호 입력 안내가 남아 있으면 불필요하고 중복된다).
  function setDescWait(on) {
    els.desc.textContent = on ? '폰에서 승인하세요' : PHONE_TITLE();
  }
  function resetToPhoneStep() {
    stopDevlinkPolling();
    if (smsAbort) { try { smsAbort.abort(); } catch (e) {} smsAbort = null; }
    { var _b = els.overlay && els.overlay.querySelector('#ksa-sms-code'); if (_b) _b.style.display = 'none'; }
    setDescWait(false);
    if (els.stepSignup) els.stepSignup.style.display = 'none';
    els.stepDevlink.style.display = 'none';
    els.stepPhone.style.display = '';
    showSmsButton(false);
    setMsg('', '');
  }
  function showOverlay() { ensureOverlay(); els.overlay.classList.add('show'); }
  // 취소·Esc: 진행 중인 승인 대기를 멈추고 팝업을 닫는다. 기다리던 호출에는 지금 토큰(없으면 빈 값)을 돌려준다.
  function cancelOverlay() { stopSignupPolling(); stopDevlinkPolling(); resetToPhoneStep(); hideOverlay(); resolveWaiters(); }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && els.overlay && els.overlay.classList.contains('show')) { e.preventDefault(); cancelOverlay(); } });
  function hideOverlay() { if (els.overlay) els.overlay.classList.remove('show'); }

  function resolveWaiters() {
    var w = waiters; waiters = [];
    w.forEach(function (resolve) { resolve(token); });
  }

  // ── device-link(웹푸시 승인) 흐름 — 유일한 인증 경로 ────────────
  //
  // ★ 2026-09-08 근본 수정 (레이스 컨디션) — 예전엔 devlinkAutoResend()가
  // 10초마다 완전히 새 세션을 만들면서 옛 sessionId 폴링을 그냥 버렸다.
  // 그런데 서버는 옛 세션을 무효화하지 않으므로, 폰이 옛 세션에 대해
  // (예: 지문/Face ID 인증에 10초 넘게 걸려서) 늦게 승인을 완료해도
  // 서버는 정상 처리하지만 PC는 이미 그 세션을 버린 뒤라 영원히 못
  // 받는 사고가 있었다 — 지문 인증 강제화(2026-09-07)로 폰 쪽 승인
  // 소요시간이 늘면서 이 레이스가 훨씬 자주 발생하게 됨(주피터 실사로
  // 재현). 수정: sessionId를 교체하지 않고 배열에 누적해 전부 병행
  // 폴링한다 — 어느 세션이든 먼저 승인되는 쪽을 채택하고 나머지는
  // 그때 정리한다. 개별 세션이 만료되면 그 세션만 배열에서 제거하고
  // (전체 폴링을 멈추지 않음), verification_failed(서명 위조/불일치)는
  // 실제 보안 실패 신호이므로 그 즉시 전체를 중단한다.
  var devlinkPollTimer = null, devlinkCountdownTimer = null;
  var devlinkAutoResendTimer = null, devlinkAutoResendCount = 0;
  var devlinkSessionIds = []; // 동시에 유효할 수 있는 모든 pending 세션
  var pendingE164 = '';
  // 폰 알림은 1회만 보낸다(2026-11-12, 주피터 지시). 예전에는 전달 여부와 상관없이 10초마다 최대 3번 더 보내 폰에 같은 알림이 4건까지 쌓였다.
  // 이제는 첫 발송이 실패했을 때(푸시 서비스가 받지 않음)에만 1회 다시 보낸다. 전달됐는데 폰에서 안 보이면 "문자로 받기"를 쓴다.
  var DEVLINK_AUTORESEND_DELAY_MS = 3000, DEVLINK_AUTORESEND_MAX = 1;
  // 2026-11-14 — 푸시는 푸시 서비스(FCM)가 받아도(201) 폰이 절전·Doze·죽은 구독 때문에 알림을 못 띄우는 경우가 있다(서버는 그 사실을 알 수 없다).
  // 문자(SMS)가 아니라 같은 푸시 경로로 다시 보낸다(주피터 지시: 와이파이 전송). 6초 뒤에도 승인이 없으면 자동으로 1회 다시 보내고 "알림 다시 보내기" 버튼을 보인다. 다시 보낸 알림은 같은 tag라 폰에 한 건으로 합쳐진다.
  var DEVLINK_PUSH_AGAIN_DELAY_MS = 6000, DEVLINK_PUSH_AGAIN_MAX = 5;
  var devlinkPushAgainTimer = null, devlinkPushAgainCount = 0;

  function stopDevlinkPolling() {
    if (devlinkPollTimer) { clearInterval(devlinkPollTimer); devlinkPollTimer = null; }
    if (devlinkCountdownTimer) { clearInterval(devlinkCountdownTimer); devlinkCountdownTimer = null; }
    if (devlinkPushAgainTimer) { clearTimeout(devlinkPushAgainTimer); devlinkPushAgainTimer = null; }
    if (els.pushBtn) els.pushBtn.style.display = 'none';
    if (devlinkAutoResendTimer) { clearTimeout(devlinkAutoResendTimer); devlinkAutoResendTimer = null; }
    devlinkAutoResendCount = 0;
    devlinkSessionIds = [];
    document.removeEventListener('visibilitychange', onVisibilityPoll);
  }
  function onVisibilityPoll() { if (!document.hidden && devlinkSessionIds.length) devlinkPollOnce(); }

  function startDevlinkCountdown(seconds) {
    var remain = seconds;
    var tick = function () {
      els.devlinkTimer.textContent = remain > 0 ? (remain + '초 남음') : '만료됨';
      if (remain <= 0 && devlinkCountdownTimer) { clearInterval(devlinkCountdownTimer); devlinkCountdownTimer = null; }
      remain -= 1;
    };
    tick();
    devlinkCountdownTimer = setInterval(tick, 1000);
  }

  // ── PC 회원 가입(2026-11-12, 주피터 지시) ────────────────────────────────
  // 신규 사용자는 폰에 계정이 없어 알림 승인을 쓸 수 없고, 암호키(GDC Wallet)는 폰에서만 만든다. 그래서 PC 는 "가입 세션"만 만들고
  // (QR 또는 문자 링크) 폰이 숫자 대조 뒤 기존 가입 절차를 진행한다. 가입이 끝나면 일반 로그인(폰 승인)으로 이어 가고,
  // 모든 가입은 무료 플랜으로 시작한다(유료 서비스가 필요해질 때 그 지점에서 전환을 요청한다).
  var QR_LIB_URL = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
  var QR_LIB_SRI = 'sha384-8FWZA6BGMXhsfO+BLtrJK0We6gg5o1JyO8xQm6peWDEUs17ACA5ziE/NIAkl9z2k';
  var signupSessionId = null, signupPollTimer = null, signupTimer = null, signupFreePlan = false, signupMethod = 'qr';
  function sq(id) { return els.overlay.querySelector('#' + id); }
  function stopSignupPolling() {
    if (signupPollTimer) { clearInterval(signupPollTimer); signupPollTimer = null; }
    if (signupTimer) { clearInterval(signupTimer); signupTimer = null; }
    signupSessionId = null;
  }
  function loadQrLib() {
    if (global.qrcode) return Promise.resolve(global.qrcode);
    return new Promise(function (resolve, reject) {
      var sc = document.createElement('script');
      sc.src = QR_LIB_URL; sc.integrity = QR_LIB_SRI; sc.crossOrigin = 'anonymous';
      sc.onload = function () { global.qrcode ? resolve(global.qrcode) : reject(new Error('qr')); };
      sc.onerror = function () { reject(new Error('qr')); };
      document.head.appendChild(sc);
    });
  }
  function openSignup() {
    stopDevlinkPolling();
    setDescWait(false);
    els.stepPhone.style.display = 'none';
    els.stepDevlink.style.display = 'none';
    els.stepSignup.style.display = '';
    setMsg('', '');
    signupTab('qr');
  }
  function closeSignup() {
    stopSignupPolling();
    els.stepSignup.style.display = 'none';
    els.stepPhone.style.display = '';
    setMsg('', '');
  }
  function signupTab(method) {
    stopSignupPolling();
    signupMethod = method;
    sq('ksa-su-qr-tab').className = method === 'qr' ? 'on' : '';
    sq('ksa-su-sms-tab').className = method === 'sms' ? 'on' : '';
    sq('ksa-su-sms').style.display = method === 'sms' ? '' : 'none';
    sq('ksa-su-wait').style.display = 'none';
    setMsg('', '');
    if (method === 'qr') startSignup('qr');
  }
  async function startSignup(method) {
    stopSignupPolling();
    var body = { pcLabel: cfg.serviceLabel || 'PC', method: method };
    var match = String(10 + (crypto.getRandomValues(new Uint32Array(1))[0] % 90));
    body.pcMatch = match;
    if (method === 'sms') {
      var raw = sq('ksa-su-phone').value.replace(/\D/g, '');
      if (raw.length !== 8) { setMsg('전화번호 뒷 8자리를 입력해 주세요.', 'err'); return; }
      body.e164 = '+8210' + raw;
    }
    setMsg('', '');
    try {
      var res = await fetch(PROXY + '/auth/signup-link/init', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) {
        if (data.error === 'ALREADY_REGISTERED') { setMsg('이미 가입된 번호입니다. 로그인해 주세요.', 'err'); return; }
        throw new Error(data.message || '요청에 실패했습니다.');
      }
      signupSessionId = data.sessionId;
      sq('ksa-su-num').textContent = match;
      sq('ksa-su-wait').style.display = '';
      var qrBox = sq('ksa-su-qrbox'); qrBox.innerHTML = '';
      if (method === 'qr') {
        sq('ksa-su-status').textContent = '스마트폰 카메라로 QR을 비추어 주세요.';
        try {
          var qrcodeFn = await loadQrLib();
          var qr = qrcodeFn(0, 'M'); qr.addData(data.approveUrl); qr.make();
          qrBox.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
        } catch (e) {
          sq('ksa-su-status').textContent = '폰의 브라우저에서 이 주소를 열어 주세요: ' + data.approveUrl;
        }
      } else {
        sq('ksa-su-status').textContent = '문자로 보낸 링크를 폰에서 열어 주세요.';
      }
      var remain = data.expires_in || 600;
      var tick = function () { sq('ksa-su-timer').textContent = remain > 0 ? (Math.floor(remain / 60) + '분 ' + (remain % 60) + '초 후 만료') : '만료됨'; remain -= 1; };
      tick(); signupTimer = setInterval(tick, 1000);
      var sid = signupSessionId;
      signupPollTimer = setInterval(function () { signupPollOnce(sid); }, 2000);
    } catch (e) {
      setMsg(e.message || '요청에 실패했습니다.', 'err');
    }
  }
  async function signupPollOnce(sid) {
    if (sid !== signupSessionId) return;
    try {
      var res = await fetch(PROXY + '/auth/signup-link/poll?sessionId=' + encodeURIComponent(sid));
      var d = await res.json().catch(function () { return {}; });
      if (sid !== signupSessionId || !d.ok) return;
      if (d.state === 'verified') sq('ksa-su-status').textContent = '확인되었습니다. 폰에서 가입을 마쳐 주세요.';
      if (d.state === 'denied') { stopSignupPolling(); sq('ksa-su-wait').style.display = 'none'; setMsg('폰에서 숫자를 여러 번 잘못 골라 취소됐습니다. 다시 시작해 주세요.', 'err'); return; }
      if (d.state === 'expired') { stopSignupPolling(); sq('ksa-su-wait').style.display = 'none'; setMsg('요청이 만료됐습니다. 다시 시작해 주세요.', 'err'); return; }
      if (d.state === 'registered' && d.e164) {
        stopSignupPolling();
        // 가입이 끝났다 — 이어서 일반 로그인(폰 승인)으로 넘어간다. 로그인에 성공하면 무료 플랜을 명시해 둔다.
        signupFreePlan = true;
        els.phone.value = String(d.e164).slice(-8);
        els.stepSignup.style.display = 'none';
        els.stepPhone.style.display = '';
        setMsg('가입이 완료되었습니다. 이어서 폰으로 로그인합니다.', 'ok');
        startDeviceLink();
      }
    } catch (e) { /* 일시적 오류 무시, 다음 polling에서 재시도 */ }
  }

  // ── 폰에서 로그인: 입력한 번호로 인증번호(문자)를 보내고, 폰이 자동으로 읽어 입력한다 (2026-11-13, 주피터 지시) ──
  // 사용자는 번호를 넣고 "로그인"만 누르면 된다. 안드로이드 Chrome 은 문자 끝의 "@도메인 #코드"를 보고 코드를 자동으로 넘겨 준다(WebOTP).
  // 자동 입력이 안 되는 폰(iOS 등)은 키보드 위 제안이나 직접 입력 칸을 쓴다. PC 는 문자를 받을 수 없으므로 기존 폰 승인 방식을 그대로 쓴다.
  // 이 로그인으로는 전화번호 인증 토큰만 얻는다 — 지갑 개인키는 기기에 있어 문자로 옮겨지지 않으므로 서명·송금에는 쓸 수 없다.
  var IS_PHONE = /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent || '');
  function startLogin() { return IS_PHONE ? startSmsLogin() : startDeviceLink(); }
  var smsAbort = null;
  async function startSmsLogin() {
    var rawPhone = els.phone.value.trim();
    if (!rawPhone) { setMsg('전화번호를 입력해 주세요.', 'err'); return; }
    var phone = rawPhone;
    try {
      var authMod = await import('https://app.naviweb.kr/src/gopang/core/auth.js');
      phone = authMod.buildE164(rawPhone, 'KR');
    } catch (e) { console.warn('[KAuth] buildE164 공유 모듈 로드 실패, 원본 입력값 사용:', e.message); }
    setMsg('', '');
    els.devlinkBtn.disabled = true;
    try {
      var res = await fetch(PROXY + '/biz/phone-otp-request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ e164: phone }) });
      var d = await res.json().catch(function () { return {}; });
      if (!res.ok || !d.ok) throw new Error(d.detail || d.message || '인증번호를 보내지 못했습니다.');
    } catch (e) { els.devlinkBtn.disabled = false; setMsg(e.message, 'err'); return; }
    els.devlinkBtn.disabled = false;

    pendingE164 = phone;
    els.stepPhone.style.display = 'none';
    els.stepDevlink.style.display = '';
    els.desc.textContent = '문자 인증번호';
    els.devlinkStatus.textContent = '인증번호 확인 중…';
    els.devlinkTimer.textContent = '';
    var matchBox = els.overlay.querySelector('#ksa-match'); if (matchBox) matchBox.style.display = 'none';
    showSmsButton(false);

    var done = false;
    var verify = async function (code) {
      if (done) return;
      try {
        var r = await fetch(PROXY + '/biz/phone-otp-verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ e164: phone, code: String(code).trim() }) });
        var v = await r.json().catch(function () { return {}; });
        if (!r.ok || !v.ok) throw new Error(v.detail || v.message || '인증번호가 맞지 않습니다.');
        done = true;
        if (smsAbort) { try { smsAbort.abort(); } catch (e) {} smsAbort = null; }
        persist(v.phone_verify_token, new Date(v.expires_at).getTime());
        hideOverlay(); setMsg('', ''); resetToPhoneStep(); resolveWaiters();
      } catch (e) { els.devlinkStatus.textContent = e.message; }
    };
    // 자동 입력(WebOTP) — 안드로이드 Chrome
    if ('OTPCredential' in window && navigator.credentials && navigator.credentials.get) {
      smsAbort = new AbortController();
      navigator.credentials.get({ otp: { transport: ['sms'] }, signal: smsAbort.signal })
        .then(function (c) { if (c && c.code) verify(c.code); })
        .catch(function () { /* 취소·미지원 — 아래 직접 입력 칸이 남아 있다 */ });
    }
    // 자동 입력이 안 될 때를 위한 직접 입력 칸(키보드 위 문자 제안도 여기에 들어간다)
    var box = els.overlay.querySelector('#ksa-sms-code');
    if (!box) {
      box = document.createElement('input');
      box.id = 'ksa-sms-code'; box.type = 'tel'; box.inputMode = 'numeric'; box.maxLength = 6; box.autocomplete = 'one-time-code'; box.placeholder = '인증번호 6자리';
      box.style.cssText = 'display:block;width:100%;box-sizing:border-box;margin:10px 0 0;padding:10px;border:1px solid #d1d5db;border-radius:8px;text-align:center;font-size:16px;letter-spacing:4px;font-family:inherit';
      els.devlinkStatus.parentNode.appendChild(box);
      box.addEventListener('input', function () { if (/^\d{6}$/.test(box.value)) verify(box.value); });
    }
    box.value = ''; box.style.display = '';
  }
  async function startDeviceLink() {
    var rawPhone = els.phone.value.trim();
    if (!rawPhone) { setMsg('전화번호를 입력해 주세요.', 'err'); return; }
    // ★ 2026-09-17 신설 — 이 스크립트는 여러 도메인(klaw/plan/mail.hondi.net,
    // hondi.net desktop.html)에 그대로 로드되는 classic script라
    // core/auth.js를 정적으로 import할 수 없었고, 그래서 지금까지 입력창의
    // "뒷 8자리" 원문을 그대로 서버에 보냈다 — 서버(handleDeviceLinkInit)가
    // 정규화를 해줘서 우연히 문제없이 동작했을 뿐이다. handlePhoneOtpVerify가
    // 이 가정(호출자가 뭘 보내든 서버가 항상 정규화해준다)이 깨지는 걸
    // 실사로 보여줬으므로, 원칙대로 클라이언트도 "물리적으로 하나뿐인"
    // 정규화 함수(core/auth.js의 buildE164)를 직접 써서 보낸다. klaw
    // 저장소 webapp.html이 이미 같은 방식(동적 cross-origin import)으로
    // https://app.naviweb.kr/src/gopang/gwp/gwp-report-client.js를 성공적으로
    // 쓰고 있어 이 패턴 자체는 검증된 것이다.
    var phone = rawPhone;
    try {
      var authMod = await import('https://app.naviweb.kr/src/gopang/core/auth.js');
      phone = authMod.buildE164(rawPhone, 'KR');
    } catch (e) {
      // 공유 모듈 로드 실패 시(네트워크 문제 등) 원본 입력값으로 그대로
      // 진행 — 서버 쪽 정규화가 최후 방어선이므로 완전히 막지는 않는다.
      console.warn('[KAuth] buildE164 공유 모듈 로드 실패, 원본 입력값 사용:', e.message);
    }
    els.devlinkBtn.disabled = true;
    setMsg('', '');
    var sigMsg = 'kauth-login:' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)) + ':' + Date.now();
    try {
      var res = await fetch(PROXY + '/auth/device-link/init', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ e164: phone, pcLabel: cfg.serviceLabel, purpose: 'sign_request', sigMsg: sigMsg, pcMatch: (devlinkMatch = String(10 + (crypto.getRandomValues(new Uint32Array(1))[0] % 90))) }),
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.message || data.detail || '요청에 실패했습니다.');

      pendingE164 = phone;
      var _mEl = wrapMatchEl(); if (_mEl) { _mEl.num.textContent = devlinkMatch; _mEl.box.style.display = ''; }
      devlinkSessionIds = [data.sessionId];
      devlinkAutoResendCount = 0;
      els.stepPhone.style.display = 'none';
      els.stepDevlink.style.display = '';
      setDescWait(true);
      els.devlinkStatus.textContent = data.hasMobileDevice === false
        ? '알림 받을 폰이 없어 문자로 보냅니다.'
        : '';
      showSmsButton(data.hasMobileDevice === false);

      startDevlinkCountdown(data.expires_in || 90);
      document.addEventListener('visibilitychange', onVisibilityPoll);
      devlinkPollTimer = setInterval(devlinkPollOnce, 2000);
      // 첫 발송이 성공했으면 다시 보내지 않는다. 폰이 등록돼 있는데 발송이 실패했을 때만 1회 재시도한다.
      // 2026-11-14 — 알림 받을 폰(푸시 구독)이 없으면 사용자가 "문자로 받기"를 누를 때까지 기다리지 않고 바로 문자를 보낸다(도착이 30초 이상 늦던 원인). 서버가 횟수·시간당 제한을 한다.
      devlinkPushAgainCount = 0;
      if (data.hasMobileDevice === false) sendSmsLink();
      else devlinkPushAgainTimer = setTimeout(function () { pushAgain(true); }, DEVLINK_PUSH_AGAIN_DELAY_MS);
      if (data.pushSentToMobile === false && data.hasMobileDevice !== false) scheduleDevlinkAutoResend();
    } catch (e) {
      setMsg(e.message || '요청에 실패했습니다.', 'err');
    } finally {
      els.devlinkBtn.disabled = false;
    }
  }

  // 숫자 대조(2026-11-10) — 이번 로그인 시도에서 PC가 보여 주는 두 자리 숫자(자동 재전송 세션도 같은 숫자)
  var devlinkMatch = null;
  function wrapMatchEl() { return (els.matchBox && els.matchNum) ? { box: els.matchBox, num: els.matchNum } : null; }

  // 폰 알림이 안 보일 때 같은 푸시 경로로 다시 보낸다(문자 아님). 새 세션을 추가하고 기존 세션 폴링은 유지 — 먼저 승인되는 쪽을 채택한다.
  async function pushAgain(auto) {
    devlinkPushAgainTimer = null;
    if (!devlinkSessionIds.length || !pendingE164 || devlinkPushAgainCount >= DEVLINK_PUSH_AGAIN_MAX) return;
    if (els.pushBtn.disabled) return;
    devlinkPushAgainCount += 1;
    els.pushBtn.style.display = ''; els.pushBtn.disabled = true; els.pushBtn.textContent = '알림 보내는 중…';
    var firstSid = devlinkSessionIds[0];
    var sigMsg = 'kauth-login:' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)) + ':' + Date.now();
    try {
      var res = await fetch(PROXY + '/auth/device-link/init', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ e164: pendingE164, pcLabel: cfg.serviceLabel, purpose: 'sign_request', sigMsg: sigMsg, pcMatch: devlinkMatch, retryOf: firstSid }),
      });
      var data = await res.json().catch(function () { return {}; });
      if (res.ok && data.ok) {
        devlinkSessionIds.push(data.sessionId);
        els.devlinkStatus.textContent = '알림을 다시 보냈습니다. 폰 화면을 켜 주세요.';
      } else {
        els.devlinkStatus.textContent = data.message || '알림을 다시 보내지 못했습니다.';
      }
    } catch (e) {
      els.devlinkStatus.textContent = '알림을 다시 보내지 못했습니다.';
    }
    if (devlinkSessionIds.length) {
      els.pushBtn.textContent = '알림 다시 보내기';
      setTimeout(function () { if (els.pushBtn) els.pushBtn.disabled = false; }, 4000);
    }
  }

  function scheduleDevlinkAutoResend() {
    if (devlinkAutoResendTimer) clearTimeout(devlinkAutoResendTimer);
    if (devlinkAutoResendCount >= DEVLINK_AUTORESEND_MAX) return;
    devlinkAutoResendTimer = setTimeout(devlinkAutoResend, DEVLINK_AUTORESEND_DELAY_MS);
  }

  // 새 세션을 추가로 만들어 푸시를 다시 보내되, 기존 세션(들)의 폴링은
  // 계속 유지한다 — 먼저 승인되는 쪽이 이긴다. 배열이 무한히 자라지
  // 않도록 DEVLINK_AUTORESEND_MAX + 1개로 자연히 상한(재전송 횟수 제한).
  async function devlinkAutoResend() {
    devlinkAutoResendTimer = null;
    if (!devlinkSessionIds.length || !pendingE164) return;
    if (devlinkAutoResendCount >= DEVLINK_AUTORESEND_MAX) return;
    devlinkAutoResendCount += 1;
    var sigMsg = 'kauth-login:' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)) + ':' + Date.now();
    try {
      var res = await fetch(PROXY + '/auth/device-link/init', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ e164: pendingE164, pcLabel: cfg.serviceLabel, purpose: 'sign_request', sigMsg: sigMsg, pcMatch: devlinkMatch }), // 자동 재전송 세션도 같은 숫자를 쓴다
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) return;   // 재시도는 1회뿐이다(문자로 받기가 남아 있다)
      // 옛 세션(들) 폴링은 그대로 두고 새 세션을 추가만 한다 — 폴링
      // 타이머·카운트다운은 이미 돌고 있으므로 다시 만들지 않는다.
      devlinkSessionIds.push(data.sessionId);
      els.devlinkStatus.textContent = data.hasMobileDevice === false
        ? '알림 받을 폰이 없어 문자로 보냅니다.'
        : '';
      showSmsButton(data.hasMobileDevice === false);
    } catch (e) { /* 재시도는 1회뿐이다 */ }
  }

  async function devlinkPollOnce() {
    if (!devlinkSessionIds.length) return;
    // 현재 배열의 스냅샷을 병행 폴링 — 콜백 중 배열이 바뀌어도(성공/만료
    // 처리) 안전하도록 id 값 자체로 다음 tick에 반영한다.
    var ids = devlinkSessionIds.slice();
    await Promise.all(ids.map(async function (sessionId) {
      if (devlinkSessionIds.indexOf(sessionId) === -1) return; // 이미 정리됨(다른 세션이 먼저 성공 등)
      try {
        var res = await fetch(PROXY + '/auth/device-link/poll?sessionId=' + encodeURIComponent(sessionId));
        var data = await res.json().catch(function () { return {}; });
        if (!data.ok) return;

        if (data.state === 'expired') {
          // 이 세션만 목록에서 제거 — 다른 세션이 아직 pending이면 계속 기다린다.
          var idx = devlinkSessionIds.indexOf(sessionId);
          if (idx !== -1) devlinkSessionIds.splice(idx, 1);
          if (devlinkSessionIds.length === 0) {
            stopDevlinkPolling();
            els.devlinkStatus.textContent = '요청이 만료됐습니다.';
          }
          return;
        }
        if (data.state === 'verification_failed') {
          // 서명 위조/불일치 — 실제 보안 실패이므로 다른 세션 대기 없이 즉시 중단.
          stopDevlinkPolling();
          els.devlinkStatus.textContent = '승인을 확인하지 못했습니다 — 번호를 다시 확인해 주세요.';
          return;
        }
        if (data.state === 'delivered' && data.verified && data.phone_verify_token) {
          stopDevlinkPolling();
          persist(data.phone_verify_token, new Date(data.expires_at).getTime());
          if (signupFreePlan) {   // 방금 가입한 사용자 — 무료 플랜으로 시작한다(실패해도 로그인에는 영향 없음)
            signupFreePlan = false;
            try { fetch(PROXY + '/auth/free-plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone_verify_token: data.phone_verify_token, plan: 'free' }) }).catch(function () {}); } catch (e) { /* 무시 */ }
          }
          hideOverlay();
          setMsg('', '');
          resolveWaiters();
        }
      } catch (e) { /* 일시적 오류 무시, 다음 polling에서 재시도 */ }
    }));
  }

  // ── 🧪 테스트 기간 아이디 자동 입장 (2026-10-09, 주피터 지시, 잠정) ──────
  // 서버 스위치(SIMPLE_AUTH_TEST)가 켜져 있으면, 접속 즉시 쉬운 한국어 단어 아이디(예: 푸른바다)를
  // 자동으로 만들고 phone_verify_token 형식의 테스트 토큰을 쿠키(hondi_pvt)로 .hondi.net 전체에 공유한다.
  // → 이 토큰을 받는 모든 서비스(K-Law·K-Plan·K-Gov·K-Business·K-Mail·GDC 등)에서 그대로 통한다.
  // 스위치가 꺼지면 남아 있는 테스트 토큰은 지우고 원래의 전화 인증(device-link) 흐름으로 돌아간다.
  // window.__hondiTestEnter 는 src/gopang/core/auth.js 와 같은 페이지에서 중복 생성을 막는 공용 약속이다.
  function isTestToken(t) { return !!t && String(t).indexOf('tid-') === 0; }
  // 전화 인증으로 로그인한 '실사용자'의 토큰이 살아 있으면 테스트 자동 입장은 절대 건드리지 않는다.
  function hasRealLogin() { return hasValidLogin() && !isTestToken(token); }
  // 사용자가 '기존 계정으로 로그인'을 골랐다면(이 사이트 저장소 플래그) 자동 입장을 하지 않는다.
  function testOptedOut() { try { return global.localStorage.getItem('hondi_test_optout') === '1'; } catch (e) { return false; } }
  // 안내(고시) 표시 규칙 — 같은 기기에서 단 한 번, 총 10초. src/gopang/core/auth.js 와 같은 기록
  // (hondi_tn 쿠키, .hondi.net)을 써서 hondi.net 에서 본 사람은 klaw·plan·mail 에서 다시 보지 않는다.
  var NOTICE_MS = 10000;
  function writeNoticeUntil(until) {
    try { global.localStorage.setItem('hondi_test_notice_until', String(until)); } catch (e) {}
    writeCookie('hondi_tn', String(until), 31536000);
  }
  function noticeRemaining() {
    var c = Number(readCookie('hondi_tn') || 0), l = 0;
    try { l = Number(global.localStorage.getItem('hondi_test_notice_until') || 0); } catch (e) {}
    var until = Math.max(c || 0, l || 0);
    if (!until) { writeNoticeUntil(Date.now() + NOTICE_MS); return NOTICE_MS; } // 이 기기에서 처음
    return Math.max(0, until - Date.now());                                      // 진행 중이면 남은 시간, 끝났으면 0
  }
  function hideTestBanner() {
    var bar = document.getElementById('_test-notice-banner');
    if (bar) { bar.remove(); document.body.style.paddingTop = ''; }
  }
  function showTestBanner(id) {
    var remaining = noticeRemaining();
    if (remaining <= 0) { hideTestBanner(); return; } // 이미 본 기기 — 다시 표시하지 않는다
    var bar = document.getElementById('_test-notice-banner');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = '_test-notice-banner';
      bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483000;background:#b45309;color:#fff;' +
        'font-size:13px;line-height:1.55;padding:8px 12px;text-align:center;font-family:inherit';
      document.body.appendChild(bar);
      document.body.style.paddingTop = '40px';
    }
    bar.innerHTML = '';
    var span = document.createElement('span');
    span.textContent = '⚠️ [고시] 테스트 기간 중 보안 모듈 잠정 중단 · 정해진 한도까지 무료 · 한도를 넘기면 24시간 안에 정식 아이디로 전환 · 실제 개인정보는 입력하지 마세요. 내 아이디: ';
    var b = document.createElement('b'); b.textContent = id;
    bar.appendChild(span); bar.appendChild(b);
    function mk(label, fn) {
      var x = document.createElement('button');
      x.textContent = label;
      x.style.cssText = 'margin:2px 0 0 8px;padding:2px 8px;border:1px solid #fff;background:transparent;color:#fff;border-radius:6px;cursor:pointer;font-size:12.5px';
      x.onclick = fn; bar.appendChild(x); return x;
    }
    mk('다른 아이디로 입장', function () {
      var nid = global.prompt('입장할 아이디를 입력하세요 (같은 아이디면 폰·PC 어디서든 같은 계정입니다)', id);
      if (!nid) return;
      try { global.localStorage.removeItem('hondi_test_optout'); } catch (e) {}
      enterTest(nid.trim().toLowerCase().normalize('NFC'), true).then(function (d) {
        if (d) location.reload(); else global.alert('입장에 실패했습니다. 아이디는 2~20자의 한글·영문 소문자·숫자·_·- 만 가능합니다.');
      });
    });
    // 다른 기기에서 같은 계정으로 들어오는 링크(안내가 사라진 뒤에도 ?testid=<아이디> 로 언제든 가능)
    var copyBtn = mk('다른 기기용 링크 복사', function () {
      var link = location.origin + '/?testid=' + encodeURIComponent(id);
      var done = function () { copyBtn.textContent = '복사됨 ✓'; };
      if (global.navigator.clipboard && global.navigator.clipboard.writeText) {
        global.navigator.clipboard.writeText(link).then(done, function () { global.prompt('이 링크를 다른 기기에서 여세요', link); });
      } else { global.prompt('이 링크를 다른 기기에서 여세요', link); }
    });
    // 탈출구: 전화 인증으로 만든 기존 계정을 쓰는 사용자는 테스트 아이디를 끄고 원래 로그인으로 돌아간다.
    mk('기존 계정으로 로그인', function () {
      try { global.localStorage.setItem('hondi_test_optout', '1'); } catch (e) {}
      if (isTestToken(token)) clear();
      location.reload();
    });
    clearTimeout(global.__hondiNoticeTimer);
    global.__hondiNoticeTimer = setTimeout(hideTestBanner, remaining);
  }
  // 서버 응답을 이 모듈의 로그인 상태로 반영(쿠키 + 이 사이트 저장소에 아이디 백업 + 배너)
  function adoptTest(d) {
    persist(d.phone_verify_token, new Date(d.expires_at).getTime());
    try { global.localStorage.setItem('hondi_test_id', d.id); } catch (e) {}
    showTestBanner(d.id);
  }
  function enterTest(id, force) {
    if (!force && hasRealLogin()) return Promise.resolve(null); // 자동 경로는 실사용자 로그인을 덮어쓰지 않는다
    return fetch(PROXY + '/auth/test-enter', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(id ? { id: id } : {}),
    }).then(function (r) { return r.json().catch(function () { return {}; }); }).then(function (d) {
      if (!d || !d.ok || !d.phone_verify_token) return null;
      if (!force && hasRealLogin()) return null; // 응답을 기다리는 사이 실사용자 로그인이 생겼다면 양보
      adoptTest(d);
      return d;
    }).catch(function () { return null; });
  }
  // 주소 파라미터 ?testid=… (안내가 사라진 뒤에도 쓸 수 있는 조작 수단)
  //   ?testid=<아이디> 이 기기를 그 아이디로 전환 / ?testid=show 내 아이디 확인용(안내 10초 재표시) / ?testid=off 전화 인증 로그인으로 복귀
  function readTestParam() {
    try {
      var u = new URL(location.href), raw = u.searchParams.get('testid');
      if (raw === null) return null;
      u.searchParams.delete('testid');
      global.history.replaceState(null, '', u.pathname + u.search + u.hash);
      return String(raw).trim().toLowerCase().normalize('NFC') || null;
    } catch (e) { return null; }
  }
  function autoTestEnter() {
    if (global.__hondiTestEnter) return global.__hondiTestEnter;
    var param = readTestParam();
    var paramId = (param && param !== 'show' && param !== 'off' && /^[a-z0-9가-힣_-]{2,20}$/.test(param)) ? param : null;
    if (param === 'off') {
      try { global.localStorage.setItem('hondi_test_optout', '1'); } catch (e) {}
      if (isTestToken(token)) clear();
    }
    if (param === 'off' || hasRealLogin() || (testOptedOut() && !paramId)) {
      global.__hondiTestEnter = Promise.resolve(null); // 실사용자·'기존 계정' 선택자는 테스트 입장 대상이 아니다
      return global.__hondiTestEnter;
    }
    // 테스트 모드 확인이 느리거나 멈춰도 원래 로그인 화면이 막히지 않도록 4초 타임아웃
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, 4000) : null;
    global.__hondiTestEnter = fetch(PROXY + '/auth/test-mode', ctl ? { signal: ctl.signal } : undefined).then(function (r) {
      return r.ok ? r.json().catch(function () { return null; }) : null;
    }).then(function (m) {
      if (timer) clearTimeout(timer);
      // 서버가 분명히 답하지 않은 경우(오류·타임아웃·이상한 응답)는 '모름' — 저장된 토큰을 건드리지 않는다
      if (!m || m.ok !== true) return null;
      if (!m.enabled) {
        if (isTestToken(token)) clear(); // 서버가 '종료'라고 분명히 답함 — 남은 테스트 토큰 정리
        return null;
      }
      if (param === 'show') writeNoticeUntil(Date.now() + NOTICE_MS);
      if (paramId) { try { global.localStorage.removeItem('hondi_test_optout'); } catch (e) {} return enterTest(paramId, true); }
      var id = null;
      if (isTestToken(token)) id = token.slice(4, token.indexOf(':')); // 이미 가진 아이디 재사용
      else { try { id = global.localStorage.getItem('hondi_test_id'); } catch (e) {} } // 쿠키가 사라졌어도 이 기기의 아이디 복구
      return enterTest(id || null, false);
    }).then(function (d) {
      // 같은 페이지의 src/gopang/core/auth.js 가 먼저 만든 결과를 공유받은 경우: 이 모듈은 아직
      // 자기 상태를 모르므로 여기서 반영한다(안 하면 ensureLogin 이 전화 인증 팝업을 띄운다).
      if (d && d.phone_verify_token && !hasValidLogin()) adoptTest(d);
      return d;
    }).catch(function () { if (timer) clearTimeout(timer); return null; });
    return global.__hondiTestEnter;
  }

  // ── 공개 API ─────────────────────────────────────────────────
  function legacyEnsureLogin() {
    return new Promise(function (resolve) {
      waiters.push(resolve);
      showOverlay();
    });
  }
  function ensureLogin() {
    if (hasValidLogin() && !isTestToken(token)) return Promise.resolve(token);
    return autoTestEnter().then(function (d) {
      if (d && hasValidLogin()) return token;
      if (hasValidLogin()) return token;
      return legacyEnsureLogin();
    });
  }
  function getToken() { return hasValidLogin() ? token : null; }
  function logout() { clear(); }

  function isRecoverableAuthError(message) {
    return /로그인이 필요합니다|인증 토큰이 만료|토큰 서명이 유효하지 않습니다/.test(message || '');
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function fetchWithAuth(url, options) {
    options = options || {};
    await ensureLogin();
    await maybeRefresh(); // 만료 임박이면 실제 요청 전에 조용히 30일 창을 새로 연다

    function build() {
      var method = (options.method || 'GET').toUpperCase();
      if (method === 'GET' || method === 'HEAD') {
        var u = new URL(url, location.href);
        u.searchParams.set('phone_verify_token', token);
        return [u.toString(), options];
      }
      var body = {};
      try { body = options.body ? JSON.parse(options.body) : {}; } catch (e) {}
      body.phone_verify_token = token;
      var opts = Object.assign({}, options, {
        body: JSON.stringify(body),
        headers: Object.assign({ 'Content-Type': 'application/json' }, options.headers || {}),
      });
      return [url, opts];
    }

    var built = build();
    var resp = await fetch(built[0], built[1]);
    if (resp.status === 401 || resp.status === 400) {
      var data = {};
      try { data = await resp.clone().json(); } catch (e) {}
      if (isRecoverableAuthError(data.message)) {
        if (hasValidLogin()) {
          // 클라이언트는 여전히 유효하다고 믿는 로그인 — 서버 쪽 일시적
          // 문제일 가능성이 높으므로 재로그인 없이 같은 토큰으로 재시도
          for (var i = 0; i < [700, 1500, 3000].length; i++) {
            await sleep([700, 1500, 3000][i]);
            resp = await fetch(built[0], built[1]);
            if (resp.ok) return resp;
          }
          return resp;
        }
        clear();
        await ensureLogin();
        built = build();
        resp = await fetch(built[0], built[1]);
      }
    }
    // 2026-10-27: 테스트 한도 초과로 차단됐거나 이미 정식 계정으로 이동한 테스트 아이디라는 응답이면 배지(user-badge.js)에 알린다
    if (resp.status === 402 || resp.status === 403) {
      try {
        resp.clone().json().then(function (d) {
          var c = d && (d.error || d.code);
          if (c === 'TEST_QUOTA_BLOCKED' || c === 'TEST_ACCOUNT_MIGRATED') {
            global.dispatchEvent(new CustomEvent('hondi-test-quota', { detail: { code: c } }));
          }
        }).catch(function () { /* 본문이 JSON이 아니면 무시 */ });
      } catch (e) { /* 구형 브라우저 */ }
    }
    return resp;
  }

  // ── 초기화 ───────────────────────────────────────────────────
  // ── PC 비활동 자동 로그아웃 (2026-11-10 신설, 주피터 지시) ─────────────────────
  // 공용·남의 PC에서 로그인한 채 자리를 뜨는 경우를 막는다. 폰(앱)은 본인 기기이므로 적용하지 않는다.
  //   · 마지막 사용(마우스·키보드·터치·스크롤) 시각을 쿠키 hondi_act(.hondi.net 공유)에 남겨, 같은 계정으로 열린 모든 서브도메인 탭이 함께 판단한다.
  //   · 기본 30분(K_AUTH_CONFIG.idleLogoutMinutes로 바꿈, 0이면 끔) 동안 아무 입력이 없으면 로그아웃한다.
  //     AI 요청이 진행 중이면(fetchWithAuth) 사용 중으로 본다 — 긴 판결 생성이 중간에 끊기지 않게.
  //   · 탭·브라우저를 닫았다가 30분이 지나서 다시 열어도 같은 규칙으로 로그아웃된다(탭을 닫는 순간의 로그아웃은 브라우저가 신뢰성 있게 알려 주지 않아 시간으로 대신한다).
  //   · 테스트 아이디(tid-) 자동 입장에는 적용하지 않는다.
  var COOKIE_ACT = 'hondi_act';
  var IDLE_MS = (function () {
    var m = global.K_AUTH_CONFIG && global.K_AUTH_CONFIG.idleLogoutMinutes;
    m = (m === undefined || m === null) ? 30 : Number(m);
    return m > 0 ? m * 60000 : 0;
  })();
  var IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  var inflight = 0, lastTouchWrite = 0;
  function touchActivity(force) {
    var now = Date.now();
    if (!force && now - lastTouchWrite < 20000) return;   // 쿠키 쓰기는 20초에 한 번만
    lastTouchWrite = now;
    try { writeCookie(COOKIE_ACT, String(now), 86400); } catch (e) {}
  }
  function idleLogoutApplies() {
    return IDLE_MS > 0 && !IS_MOBILE && hasValidLogin() && !isTestToken(token);
  }
  function checkIdle() {
    if (!idleLogoutApplies() || inflight > 0) return;
    var last = Number(readCookie(COOKIE_ACT) || 0);
    if (!last) { touchActivity(true); return; }
    if (Date.now() - last > IDLE_MS) {
      clear();
      try { global.dispatchEvent(new CustomEvent('hondi-idle-logout')); } catch (e) {}
      showIdleNotice();
    }
  }
  function showIdleNotice() {
    try {
      if (!document.body) return;
      var d = document.createElement('div');
      d.setAttribute('role', 'status');
      d.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#1e293b;color:#fff;padding:12px 18px;border-radius:10px;font-size:13px;z-index:2147483000;max-width:90vw;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.3)';
      d.textContent = '오래 사용하지 않아 안전을 위해 로그아웃되었습니다. 다시 사용하시려면 로그인해 주세요.';
      document.body.appendChild(d);
      setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 15000);
    } catch (e) {}
  }
  if (IDLE_MS > 0 && !IS_MOBILE) {
    ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'].forEach(function (ev) {
      global.addEventListener(ev, function () { touchActivity(false); }, { passive: true, capture: true });
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { checkIdle(); } });
    setInterval(checkIdle, 30000);
  }

  loadFromCookie();
  if (IDLE_MS > 0 && !IS_MOBILE) checkIdle();   // 닫았다가 오래 뒤에 다시 연 경우: 로그인 상태를 읽자마자 판단
  if (idleLogoutApplies()) touchActivity(true);
  // 🧪 테스트 기간: 접속하면 자동으로 아이디 생성/입장(스위치가 꺼져 있으면 아무 일도 없음)
  var _bootTest = function () { autoTestEnter(); };
  if (document.body) _bootTest(); else document.addEventListener('DOMContentLoaded', _bootTest);

  global.KAuth = {
    ensureLogin: ensureLogin,
    getToken: getToken,
    hasValidLogin: hasValidLogin,
    logout: logout,
    // 2026-11-12 — 로그인 팝오버의 "회원 가입": 로그인 창을 가입 화면으로 바로 연다. 가입·로그인이 끝나면 기다리던 호출에 토큰을 돌려준다.
    openSignup: function () {
      return new Promise(function (resolve) { waiters.push(resolve); showOverlay(); openSignup(); });
    },
    // 2026-11-11 — 나비웹 도우미가 K-Law 창을 열 때, 이미 로그인한 나비웹에서 넘겨 준 토큰으로 재인증 없이 들어온다.
    // 호출하는 쪽(klaw-assist.js)이 부모 창 출처를 직접 확인한 뒤에만 부른다. 형식이 맞지 않거나 이미 만료된 값은 받지 않는다.
    adopt: function (t, exp) {
      exp = Number(exp);
      if (typeof t !== 'string' || t.length < 20 || t.length > 4000 || !(exp > Date.now() + 60000)) return false;
      persist(t, exp);
      return true;
    },
    fetchWithAuth: function () {   // 진행 중인 요청이 있는 동안은 비활동으로 보지 않는다
      inflight++;
      var p = fetchWithAuth.apply(null, arguments);
      var done = function () { inflight = Math.max(0, inflight - 1); touchActivity(true); };
      p.then(done, done);
      return p;
    },
  };
})(window);
