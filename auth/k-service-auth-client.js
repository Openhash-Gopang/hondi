/* ══════════════════════════════════════════════════════════════════
   k-service-auth-client.js — K-서비스 공용 전화번호 인증 모듈 (v2.0)

   배포 위치: https://hondi.net/auth/k-service-auth-client.js

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

   대상: plan.hondi.net(webapp.html) · klaw.hondi.net(webapp.html) ·
   mail.hondi.net(webapp.html) · hondi.net(desktop.html GDC 대시보드).
   ※ /assets/site-header.js(다른 19개 페이지가 쓰는 기존 공용 모듈)와는
     별개의 모듈이다.

   사용법 — 각 페이지의 <body> 시작 부분에 한 줄:

     <script>
       window.K_AUTH_CONFIG = {
         serviceLabel: 'K-Law',   // 로그인 UI에 표시될 서비스명(선택)
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
                                             body에 phone_verify_token 필드로 첨부).
                                             만료가 7.5일 이내로 남았으면 요청 전에
                                             /auth/refresh-token으로 조용히 30일 창을
                                             새로 연다(2026-09-12 신설 — Gmail처럼
                                             활동 중엔 재인증 없이 유지, 주피터 지시).
   ══════════════════════════════════════════════════════════════════ */

(function (global) {
  if (global.KAuth) return; // 중복 로드 방지

  var PROXY         = 'https://hondi-proxy.tensor-city.workers.dev';
  var COOKIE_DOMAIN = (global.K_AUTH_CONFIG && global.K_AUTH_CONFIG.cookieDomain) || '.hondi.net';
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
      '#ksa-overlay{position:fixed;inset:0;z-index:99999;background:rgba(15,15,25,.45);display:none;align-items:center;justify-content:center;padding:24px;font-family:Pretendard,-apple-system,BlinkMacSystemFont,"Malgun Gothic",sans-serif}' +
      '#ksa-overlay.show{display:flex}' +
      '.ksa-box{background:#fff;border-radius:14px;padding:26px 24px;width:100%;max-width:340px;box-shadow:0 12px 32px rgba(0,0,0,.22)}' +
      '.ksa-icon-row{display:flex;align-items:center;gap:9px;margin-bottom:16px}' +
      '.ksa-icon{font-size:20px}' +
      '.ksa-desc{font-size:13px;color:#1a202c;line-height:1.5}' +
      '.ksa-input-wrap{display:flex;gap:6px}' +
      '.ksa-input-wrap input{flex:1;padding:10px 12px;border:1px solid #dfe2ed;border-radius:8px;font-size:14px;font-family:inherit}' +
      '.ksa-input-icon-btn{border:none;background:#4338CA;color:#fff;border-radius:8px;width:42px;height:42px;flex-shrink:0;font-size:17px;cursor:pointer;transition:opacity .12s,transform .08s}' +
      '.ksa-input-icon-btn:disabled{opacity:.5;cursor:not-allowed}' +
      '.ksa-input-icon-btn:not(:disabled):hover{transform:scale(1.05)}' +
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
            '<button type="button" class="ksa-input-icon-btn" id="ksa-devlink-btn" aria-label="폰으로 승인받기" title="폰으로 승인받기">📱</button>' +
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
        '<div class="ksa-msg" id="ksa-msg"></div>' +
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
    els.devlinkTimer = wrap.querySelector('#ksa-devlink-timer');
    els.resendPhone  = wrap.querySelector('#ksa-resend-phone');

    els.desc.textContent = (cfg.serviceLabel ? cfg.serviceLabel + ' — ' : '') + '휴대폰 번호 뒷자리 8자를 입력하십시오.';
    els.devlinkBtn.onclick = startDeviceLink;
    els.resendPhone.onclick = resetToPhoneStep;
    els.phone.addEventListener('keydown', function (e) { if (e.key === 'Enter') startDeviceLink(); });
  }

  function setMsg(text, kind) {
    els.msg.textContent = text || '';
    els.msg.className = 'ksa-msg' + (kind ? ' ' + kind : '');
  }
  function resetToPhoneStep() {
    stopDevlinkPolling();
    els.stepDevlink.style.display = 'none';
    els.stepPhone.style.display = '';
    setMsg('', '');
  }
  function showOverlay() { ensureOverlay(); els.overlay.classList.add('show'); }
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
  var DEVLINK_AUTORESEND_DELAY_MS = 10000, DEVLINK_AUTORESEND_MAX = 3;

  function stopDevlinkPolling() {
    if (devlinkPollTimer) { clearInterval(devlinkPollTimer); devlinkPollTimer = null; }
    if (devlinkCountdownTimer) { clearInterval(devlinkCountdownTimer); devlinkCountdownTimer = null; }
    if (devlinkAutoResendTimer) { clearTimeout(devlinkAutoResendTimer); devlinkAutoResendTimer = null; }
    devlinkAutoResendCount = 0;
    devlinkSessionIds = [];
    document.removeEventListener('visibilitychange', onVisibilityPoll);
  }
  function onVisibilityPoll() { if (!document.hidden && devlinkSessionIds.length) devlinkPollOnce(); }

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
      devlinkSessionIds = [data.sessionId];
      devlinkAutoResendCount = 0;
      els.stepPhone.style.display = 'none';
      els.stepDevlink.style.display = '';
      els.devlinkStatus.textContent = data.hasMobileDevice === false
        ? '이 번호로 연결된 스마트폰이 없습니다 — 문자로 안내해 드립니다.'
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
        body: JSON.stringify({ e164: pendingE164, pcLabel: cfg.serviceLabel, purpose: 'sign_request', sigMsg: sigMsg }),
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) { scheduleDevlinkAutoResend(); return; }
      // 옛 세션(들) 폴링은 그대로 두고 새 세션을 추가만 한다 — 폴링
      // 타이머·카운트다운은 이미 돌고 있으므로 다시 만들지 않는다.
      devlinkSessionIds.push(data.sessionId);
      els.devlinkStatus.textContent = data.hasMobileDevice === false
        ? '이 번호로 연결된 스마트폰이 없습니다 — 문자로 안내해 드립니다.'
        : '알림을 다시 보냈습니다 — 스마트폰을 확인해 주세요… (이전 알림도 계속 유효합니다)';
      scheduleDevlinkAutoResend();
    } catch (e) {
      scheduleDevlinkAutoResend();
    }
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
          hideOverlay();
          setMsg('', '');
          resolveWaiters();
        }
      } catch (e) { /* 일시적 오류 무시, 다음 polling에서 재시도 */ }
    }));
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
