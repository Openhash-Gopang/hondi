/* ══════════════════════════════════════════════════════════════════
   k-service-auth-client.js — K-서비스 공용 전화번호 인증 모듈 (v1.0)

   배포 위치: https://hondi.net/auth/k-service-auth-client.js

   배경(2026-09-06): K-Plan·K-Law·K-Mail이 phone_verify_token(SMS OTP)
   로그인을 각자 독자적으로 복붙 구현했고, 토큰을 sessionStorage에
   서비스별로 다른 키(kplan_, klaw_, kmail_ 접두사)로 저장해 완전히
   격리돼 있었다 — 한 서비스에 로그인해도 다른 서비스는 몰랐다(SSO 없음).
   이 모듈은 그 셋을 대체하는 단일 소스이며, 토큰을 sessionStorage
   대신 `.hondi.net` 도메인 쿠키에 저장해 모든 서브도메인이 같은
   로그인 세션을 자동으로 공유하게 한다(iframe·postMessage 릴레이
   불필요 — 표준 브라우저 쿠키 도메인 상속만으로 충분).

   구 시스템(고팡 Ed25519 지갑 SSO — subsystem-auth.js/silent-auth.html/
   gopang-sso.js)은 이 모듈과 별개로 당분간 유지하되 신규 게이트는
   전부 이 모듈로 만든다(주피터 지시, 2026-09-06).

   사용법 — 각 K-서비스 페이지의 <body> 시작 부분에 한 줄:

     <script>
       window.K_AUTH_CONFIG = {
         serviceLabel: 'K-Law',        // 로그인 UI에 표시될 서비스명(선택)
         enableDeviceLink: false,      // 웹푸시 승인 로그인 지원 여부(선택, 기본 true)
       };
     </script>
     <script src="https://hondi.net/auth/k-service-auth-client.js"></script>

   공개 API (window.KAuth):
     await KAuth.ensureLogin()        — 로그인 안 돼 있으면 오버레이를 띄우고 완료까지 대기, 토큰 문자열 반환
     KAuth.getToken()                 — 현재 유효한 토큰(없으면 null), 오버레이 없음
     KAuth.hasValidLogin()            — boolean
     KAuth.logout()                   — 로그아웃(쿠키 삭제)
     await KAuth.fetchWithAuth(url, opts) — phone_verify_token을 자동 첨부해 fetch,
                                             일시적 인증 오류는 조용히 재시도, 진짜
                                             만료/무효일 때만 재로그인 오버레이 표시
                                             (GET/HEAD는 쿼리스트링에, 그 외는 JSON
                                             body에 phone_verify_token 필드로 첨부)

   이 모듈에 넣지 않은 것: 서버측 판정 로직(worker.js의
   _resolveGuidFromPhoneVerifyToken, src/worker/k-service-auth.js) — 그건
   이미 여러 K-서비스가 공유하는 별도 서버 모듈이라 그대로 둔다.
   ══════════════════════════════════════════════════════════════════ */

(function (global) {
  if (global.KAuth) return; // 중복 로드 방지

  var PROXY         = 'https://hondi-proxy.tensor-city.workers.dev';
  var COOKIE_DOMAIN = (global.K_AUTH_CONFIG && global.K_AUTH_CONFIG.cookieDomain) || '.hondi.net';
  var COOKIE_TOKEN  = 'hondi_pvt';
  var COOKIE_EXP    = 'hondi_pvt_exp';

  var cfg = Object.assign({
    serviceLabel: document.title || 'K-서비스',
    enableDeviceLink: true,
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
  var pendingE164 = '';

  function loadFromCookie() {
    var t = readCookie(COOKIE_TOKEN);
    var e = Number(readCookie(COOKIE_EXP) || 0);
    if (t && e && Date.now() < e - 30000) { token = t; tokenExp = e; return true; }
    return false;
  }
  function persist(t, exp) {
    token = t; tokenExp = exp;
    var maxAge = Math.max(1, Math.floor((exp - Date.now()) / 1000));
    writeCookie(COOKIE_TOKEN, t, maxAge);
    writeCookie(COOKIE_EXP, String(exp), maxAge);
  }
  function clear() {
    token = null; tokenExp = 0;
    clearCookie(COOKIE_TOKEN);
    clearCookie(COOKIE_EXP);
  }
  function hasValidLogin() { return !!token && Date.now() < tokenExp - 30000; }

  // ── 오버레이 UI (자체 주입 — 페이지에 마크업 불필요) ────────────
  var els = {};
  function injectStyle() {
    if (document.getElementById('ksa-style')) return;
    var style = document.createElement('style');
    style.id = 'ksa-style';
    style.textContent =
      '#ksa-overlay{position:fixed;inset:0;z-index:99999;background:rgba(15,15,25,.45);display:none;align-items:center;justify-content:center;padding:24px;font-family:Pretendard,-apple-system,BlinkMacSystemFont,"Malgun Gothic",sans-serif}' +
      '#ksa-overlay.show{display:flex}' +
      '.ksa-box{background:#fff;border-radius:14px;padding:26px 24px;width:100%;max-width:340px;box-shadow:0 12px 32px rgba(0,0,0,.22)}' +
      '.ksa-icon-row{display:flex;align-items:center;gap:9px;margin-bottom:16px}' +
      '.ksa-icon{font-size:20px}' +
      '.ksa-desc{font-size:13px;color:#1a202c;line-height:1.5}' +
      '.ksa-input-wrap{display:flex;gap:6px}' +
      '.ksa-input-wrap input,.ksa-row input{flex:1;padding:10px 12px;border:1px solid #dfe2ed;border-radius:8px;font-size:14px;font-family:inherit}' +
      '.ksa-input-icon-btn{border:1px solid #dfe2ed;background:#f5f6fa;border-radius:8px;padding:0 12px;font-size:16px;cursor:pointer}' +
      '.ksa-row{display:flex;gap:6px;margin-top:2px}' +
      '.ksa-row button,.ksa-input-wrap button.ksa-send-btn{border:none;background:#4338CA;color:#fff;border-radius:8px;padding:0 14px;font-size:13px;font-weight:600;cursor:pointer}' +
      '.ksa-devlink-wait{padding:6px 0}' +
      '.ksa-spinner{width:22px;height:22px;border:3px solid #e5e7eb;border-top-color:#4338CA;border-radius:50%;margin:0 auto 12px;animation:ksa-spin .8s linear infinite}' +
      '@keyframes ksa-spin{to{transform:rotate(360deg)}}' +
      '.ksa-resend{text-align:center;margin-top:10px;font-size:12px;color:#718096;cursor:pointer;text-decoration:underline}' +
      '.ksa-msg{font-size:12px;margin-top:10px;text-align:center;min-height:16px}' +
      '.ksa-msg.err{color:#c01c28}' +
      '.ksa-msg.ok{color:#1b6b3a}';
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
          '<div class="ksa-desc" id="ksa-desc">휴대폰 번호 뒷자리 8자를 입력하십시오.</div></div>' +
        '<div id="ksa-step-phone">' +
          '<div class="ksa-input-wrap">' +
            '<input type="tel" id="ksa-phone" placeholder="전화번호 뒷 8자리" inputmode="numeric" maxlength="8" autocomplete="tel">' +
            (cfg.enableDeviceLink
              ? '<button type="button" class="ksa-input-icon-btn" id="ksa-devlink-btn" title="폰으로 승인받기">📱</button>'
              : '<button type="button" class="ksa-send-btn" id="ksa-send-btn">받기</button>') +
          '</div>' +
        '</div>' +
        '<div id="ksa-step-devlink" style="display:none">' +
          '<div class="ksa-devlink-wait">' +
            '<div class="ksa-spinner"></div>' +
            '<div id="ksa-devlink-status" style="font-size:12.5px;color:#4A5568;text-align:center">스마트폰 알림을 확인해 주세요…</div>' +
            '<div id="ksa-devlink-timer" style="font-size:11px;color:#718096;text-align:center;margin-top:4px"></div>' +
          '</div>' +
          '<div class="ksa-resend" id="ksa-resend-phone">번호를 다시 입력할게요</div>' +
        '</div>' +
        '<div id="ksa-step-code" style="display:none">' +
          '<div class="ksa-row">' +
            '<input type="text" id="ksa-code" placeholder="인증번호 6자리" inputmode="numeric" maxlength="6" autocomplete="one-time-code">' +
            '<button type="button" id="ksa-verify-btn">확인</button>' +
          '</div>' +
        '</div>' +
        '<div class="ksa-msg" id="ksa-msg"></div>' +
      '</div>';
    document.body.appendChild(wrap);
    els.overlay      = wrap;
    els.desc         = wrap.querySelector('#ksa-desc');
    els.stepPhone    = wrap.querySelector('#ksa-step-phone');
    els.stepDevlink  = wrap.querySelector('#ksa-step-devlink');
    els.stepCode     = wrap.querySelector('#ksa-step-code');
    els.phone        = wrap.querySelector('#ksa-phone');
    els.code         = wrap.querySelector('#ksa-code');
    els.msg          = wrap.querySelector('#ksa-msg');
    els.devlinkBtn   = wrap.querySelector('#ksa-devlink-btn');
    els.sendBtn      = wrap.querySelector('#ksa-send-btn');
    els.verifyBtn    = wrap.querySelector('#ksa-verify-btn');
    els.devlinkStatus= wrap.querySelector('#ksa-devlink-status');
    els.devlinkTimer = wrap.querySelector('#ksa-devlink-timer');
    els.resendPhone  = wrap.querySelector('#ksa-resend-phone');

    els.desc.textContent = (cfg.serviceLabel ? cfg.serviceLabel + ' — ' : '') + '휴대폰 번호 뒷자리 8자를 입력하십시오.';
    if (els.devlinkBtn) els.devlinkBtn.onclick = startDeviceLink;
    if (els.sendBtn) els.sendBtn.onclick = sendOtp;
    els.verifyBtn.onclick = verifyOtp;
    els.resendPhone.onclick = resetToPhoneStep;
    els.code.addEventListener('keydown', function (e) { if (e.key === 'Enter') verifyOtp(); });
    els.phone.addEventListener('keydown', function (e) { if (e.key === 'Enter') (cfg.enableDeviceLink ? startDeviceLink() : sendOtp()); });
  }

  function setMsg(text, kind) {
    els.msg.textContent = text || '';
    els.msg.className = 'ksa-msg' + (kind ? ' ' + kind : '');
  }
  function resetToPhoneStep() {
    stopDevlinkPolling();
    els.stepCode.style.display = 'none';
    els.stepDevlink.style.display = 'none';
    els.stepPhone.style.display = '';
    els.code.value = '';
    setMsg('', '');
  }
  function showOverlay() { ensureOverlay(); els.overlay.classList.add('show'); }
  function hideOverlay() { if (els.overlay) els.overlay.classList.remove('show'); }

  function resolveWaiters() {
    var w = waiters; waiters = [];
    w.forEach(function (resolve) { resolve(token); });
  }

  // ── OTP 흐름 ─────────────────────────────────────────────────
  async function sendOtp() {
    var phone = els.phone.value.trim();
    if (!phone) { setMsg('전화번호를 입력해 주세요.', 'err'); return; }
    var btn = els.sendBtn || els.devlinkBtn;
    if (btn) btn.disabled = true;
    setMsg('인증번호 발송 중…', '');
    try {
      var res = await fetch(PROXY + '/biz/phone-otp-request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ e164: phone }),
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.message || '인증번호 발송에 실패했습니다.');
      pendingE164 = phone;
      els.stepPhone.style.display = 'none';
      els.stepCode.style.display = '';
      els.code.focus();
      setMsg('인증번호를 문자로 보내드렸습니다.', 'ok');
    } catch (e) {
      setMsg(e.message || '인증번호 발송에 실패했습니다.', 'err');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function verifyOtp() {
    var code = els.code.value.trim();
    if (!code) { setMsg('인증번호를 입력해 주세요.', 'err'); return; }
    els.verifyBtn.disabled = true;
    setMsg('확인 중…', '');
    try {
      var res = await fetch(PROXY + '/biz/phone-otp-verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ e164: pendingE164, code: code }),
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok || !data.phone_verify_token) throw new Error(data.message || '인증번호가 일치하지 않습니다.');
      persist(data.phone_verify_token, new Date(data.expires_at).getTime());
      hideOverlay();
      setMsg('', '');
      resolveWaiters();
    } catch (e) {
      setMsg(e.message || '인증번호가 일치하지 않습니다.', 'err');
    } finally {
      els.verifyBtn.disabled = false;
    }
  }

  // ── device-link(웹푸시 승인) 흐름 ────────────────────────────
  var devlinkPollTimer = null, devlinkCountdownTimer = null;
  var devlinkAutoResendTimer = null, devlinkAutoResendCount = 0, devlinkSessionId = null;
  var DEVLINK_AUTORESEND_DELAY_MS = 10000, DEVLINK_AUTORESEND_MAX = 3;

  function stopDevlinkPolling() {
    if (devlinkPollTimer) { clearInterval(devlinkPollTimer); devlinkPollTimer = null; }
    if (devlinkCountdownTimer) { clearInterval(devlinkCountdownTimer); devlinkCountdownTimer = null; }
    if (devlinkAutoResendTimer) { clearTimeout(devlinkAutoResendTimer); devlinkAutoResendTimer = null; }
    devlinkAutoResendCount = 0;
    devlinkSessionId = null;
    document.removeEventListener('visibilitychange', onVisibilityPoll);
  }
  function onVisibilityPoll() { if (!document.hidden && devlinkPollTimer) devlinkPollOnce(); }

  function startDevlinkCountdown(seconds) {
    var remain = seconds;
    var tick = function () {
      els.devlinkTimer.textContent = remain > 0 ? (remain + '초 후 만료') : '만료됨';
      if (remain <= 0 && devlinkCountdownTimer) { clearInterval(devlinkCountdownTimer); devlinkCountdownTimer = null; }
      remain -= 1;
    };
    tick();
    devlinkCountdownTimer = setInterval(tick, 1000);
  }

  async function startDeviceLink() {
    var phone = els.phone.value.trim();
    if (!phone) { setMsg('전화번호를 입력해 주세요.', 'err'); return; }
    els.devlinkBtn.disabled = true;
    setMsg('', '');
    var sigMsg = 'kauth-login:' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)) + ':' + Date.now();
    try {
      var res = await fetch(PROXY + '/auth/device-link/init', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ e164: phone, pcLabel: cfg.serviceLabel, purpose: 'sign_request', sigMsg: sigMsg }),
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.message || data.detail || '요청에 실패했습니다.');

      pendingE164 = phone;
      devlinkSessionId = data.sessionId;
      devlinkAutoResendCount = 0;
      els.stepPhone.style.display = 'none';
      els.stepDevlink.style.display = '';
      els.devlinkStatus.textContent = data.hasMobileDevice === false
        ? '이 번호로 연결된 스마트폰이 없습니다 — 아래에서 문자로 받아 주세요.'
        : '스마트폰 알림을 확인해 주세요…';

      startDevlinkCountdown(data.expires_in || 90);
      document.addEventListener('visibilitychange', onVisibilityPoll);
      devlinkPollTimer = setInterval(devlinkPollOnce, 2000);
      scheduleDevlinkAutoResend();
    } catch (e) {
      setMsg(e.message || '요청에 실패했습니다.', 'err');
    } finally {
      els.devlinkBtn.disabled = false;
    }
  }

  function scheduleDevlinkAutoResend() {
    if (devlinkAutoResendTimer) clearTimeout(devlinkAutoResendTimer);
    if (devlinkAutoResendCount >= DEVLINK_AUTORESEND_MAX) return;
    devlinkAutoResendTimer = setTimeout(devlinkAutoResend, DEVLINK_AUTORESEND_DELAY_MS);
  }

  async function devlinkAutoResend() {
    devlinkAutoResendTimer = null;
    if (!devlinkSessionId || !pendingE164) return;
    if (devlinkAutoResendCount >= DEVLINK_AUTORESEND_MAX) return;
    devlinkAutoResendCount += 1;
    var sigMsg = 'kauth-login:' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)) + ':' + Date.now();
    try {
      var res = await fetch(PROXY + '/auth/device-link/init', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ e164: pendingE164, pcLabel: cfg.serviceLabel, purpose: 'sign_request', sigMsg: sigMsg }),
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) { scheduleDevlinkAutoResend(); return; }
      if (devlinkPollTimer) { clearInterval(devlinkPollTimer); devlinkPollTimer = null; }
      if (devlinkCountdownTimer) { clearInterval(devlinkCountdownTimer); devlinkCountdownTimer = null; }
      devlinkSessionId = data.sessionId;
      els.devlinkStatus.textContent = data.hasMobileDevice === false
        ? '이 번호로 연결된 스마트폰이 없습니다 — 아래에서 문자로 받아 주세요.'
        : '알림을 다시 보냈습니다 — 스마트폰을 확인해 주세요…';
      startDevlinkCountdown(data.expires_in || 90);
      devlinkPollTimer = setInterval(devlinkPollOnce, 2000);
      scheduleDevlinkAutoResend();
    } catch (e) {
      scheduleDevlinkAutoResend();
    }
  }

  async function devlinkPollOnce() {
    if (!devlinkSessionId) return;
    try {
      var res = await fetch(PROXY + '/auth/device-link/poll?sessionId=' + encodeURIComponent(devlinkSessionId));
      var data = await res.json().catch(function () { return {}; });
      if (!data.ok) return;
      if (data.state === 'expired') {
        stopDevlinkPolling();
        els.devlinkStatus.textContent = '요청이 만료됐습니다.';
        return;
      }
      if (data.state === 'verification_failed') {
        stopDevlinkPolling();
        els.devlinkStatus.textContent = '승인을 확인하지 못했습니다 — 문자 인증으로 진행해 주세요.';
        return;
      }
      if (data.state === 'delivered' && data.verified && data.phone_verify_token) {
        stopDevlinkPolling();
        persist(data.phone_verify_token, new Date(data.expires_at).getTime());
        hideOverlay();
        setMsg('', '');
        resolveWaiters();
      }
    } catch (e) { /* 일시적 오류 무시, 다음 polling에서 재시도 */ }
  }

  // ── 공개 API ─────────────────────────────────────────────────
  function ensureLogin() {
    if (hasValidLogin()) return Promise.resolve(token);
    return new Promise(function (resolve) {
      waiters.push(resolve);
      showOverlay();
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
    return resp;
  }

  // ── 초기화 ───────────────────────────────────────────────────
  loadFromCookie();

  global.KAuth = {
    ensureLogin: ensureLogin,
    getToken: getToken,
    hasValidLogin: hasValidLogin,
    logout: logout,
    fetchWithAuth: fetchWithAuth,
  };
})(window);
