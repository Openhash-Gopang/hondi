/* ══════════════════════════════════════════════════════════════════
   user-badge.js — 혼디넷 공용 로그인 상태·아이디 표시 (v1.0, 2026-10-27)

   배포 위치: https://hondi.net/auth/user-badge.js

   모든 페이지의 우측 상단에 "로그인 상태 + 아이디"를 보여 주고,
   로그인하지 않은 사용자에게는 data-requires-login 이 붙은 기능을 막습니다.

   ■ 설치 — 페이지에 한 줄(</body> 앞 또는 <head>)
       <script src="https://hondi.net/auth/user-badge.js" defer></script>

   ■ 표시 위치
     · 페이지에 [data-hondi-user-slot] 요소가 있으면 그 안에 넣는다(헤더 오른쪽 등).
         어두운 헤더라면 data-hondi-user-slot="dark".
     · 없으면 화면 우측 상단에 고정(fixed)으로 띄운다.

   ■ 아이디로 보여 주는 값 (쿠키 hondi_pvt — .hondi.net 전체 공유)
     · 테스트 기간 아이디(토큰이 tid- 로 시작) → 아이디 그대로(예: 푸른바다)
     · 전화 인증 실사용자 → 토큰 안의 전화번호는 화면에 절대 풀어 쓰지 않고
         뒤 4자리만 보여 준다(예: ●●●● 5678).

   ■ 테스트 아이디 메뉴의 두 버튼(2026-10-27)
     · "정식 아이디로 로그인" — 테스트 아이디에서 나온 뒤 전화 인증 로그인 창을 바로 연다(로그아웃 → 로그인을 한 번에).
     · "정식 아이디 만들기" — hondi.net 가입 화면(SIGNUP_URL)으로 이동한다.

   ■ 기능 제한(선언형) — 로그인 필요 기능에 속성만 붙이면 됩니다.
       <button data-requires-login="메일 보내기">보내기</button>
       <form data-requires-login="정보 공개 청구"> … </form>
       <div data-requires-login="대화"> <textarea></textarea> </div>
     로그인하지 않았으면 click·submit·Enter 입력을 막고 안내 후 로그인 창을 띄웁니다.
     (속성이 붙은 요소의 자손에서 일어난 이벤트도 막습니다. 다만 글을 쓰려고 입력칸을
      누르는 click 은 막지 않고, 보내기 버튼·Enter·폼 제출만 막습니다.)

   ■ 공개 API (window.HondiAuth)
       isLoggedIn()      boolean
       getUserLabel()    화면에 보이는 아이디 문자열(없으면 '')
       getKind()         'test' | 'user' | ''
       require(label)    Promise<boolean> — 로그인 상태면 true, 아니면 로그인 창을 띄우고 결과를 기다린다
       login()           로그인 창 열기(K-서비스 공용 모듈 KAuth 사용)
       logout()          로그아웃
       refresh()         표시 다시 그리기

   ■ 의존성: 없음. 로그인 창이 필요하면 K-서비스 공용 모듈
     (https://hondi.net/auth/k-service-auth-client.js)을 필요할 때 스스로 불러온다.
   ══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  if (global.HondiAuth) return;                       // 중복 로드 방지
  var doc = global.document;
  if (!doc) return;
  try { if (global.self !== global.top) return; } catch (e) { return; } // iframe 안에서는 표시하지 않는다

  var KAUTH_SRC = 'https://hondi.net/auth/k-service-auth-client.js';
  var C_TOKEN = 'hondi_pvt', C_EXP = 'hondi_pvt_exp';
  var COOKIE_DOMAIN = '.hondi.net';

  // ── 로그인 상태 읽기 ─────────────────────────────────────────
  function readCookie(name) {
    var m = doc.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    if (!m) return null;
    try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
  }
  function clearCookie(name) {
    doc.cookie = name + '=; domain=' + COOKIE_DOMAIN + '; path=/; max-age=0; secure; samesite=lax';
  }
  function identity() {
    var t = readCookie(C_TOKEN), e = Number(readCookie(C_EXP) || 0);
    if (!t || !e || Date.now() >= e - 30000) return { loggedIn: false, kind: '', label: '' };
    if (t.indexOf('tid-') === 0) {                    // 테스트 기간 아이디
      var i = t.indexOf(':');
      var id = i > 4 ? t.slice(4, i) : t.slice(4);
      return { loggedIn: true, kind: 'test', label: id };
    }
    var head = String(t.split(':')[0] || '');          // 실사용자 토큰의 첫 칸은 전화번호 → 뒤 4자리만
    var digits = head.replace(/\D/g, '');
    return { loggedIn: true, kind: 'user', label: digits.length >= 4 ? '●●●● ' + digits.slice(-4) : '로그인됨' };
  }
  function testIdSaved() {
    try { return global.localStorage.getItem('hondi_test_id') || ''; } catch (e) { return ''; }
  }

  // ── 테스트 아이디 → 정식 아이디 ──────────────────────────────
  var SIGNUP_URL = 'https://hondi.net/desktop.html';        // 정식 아이디 가입 화면(메인 앱)
  function startFormalLogin() {
    if (identity().kind === 'test') { try { global.localStorage.setItem('hondi_test_optout', '1'); } catch (e) {} } // 접속하면 다시 테스트 아이디로 자동 입장하지 않도록
    if (global.KAuth) { global.KAuth.logout(); } else { clearCookie(C_TOKEN); clearCookie(C_EXP); }
    render(true);
    return login();
  }
  function startSignup() { global.location.href = SIGNUP_URL; }
  function appendFormalButtons(menu) {
    var b1 = el('button', 'hub-btn hub-primary', '정식 아이디로 로그인'); b1.type = 'button';
    b1.addEventListener('click', function () { setMenu(false); startFormalLogin(); });
    var b2 = el('button', 'hub-btn', '정식 아이디 만들기'); b2.type = 'button';
    b2.addEventListener('click', startSignup);
    menu.appendChild(b1); menu.appendChild(b2);
  }

  // ── 로그인 창(K-서비스 공용 모듈) ────────────────────────────
  var kauthPromise = null;
  function ensureKAuth() {
    if (global.KAuth) return Promise.resolve(global.KAuth);
    if (kauthPromise) return kauthPromise;
    kauthPromise = new Promise(function (resolve) {
      var s = doc.createElement('script');
      s.src = KAUTH_SRC; s.async = true;
      s.onload = function () { resolve(global.KAuth || null); };
      s.onerror = function () { kauthPromise = null; resolve(null); };
      (doc.head || doc.documentElement).appendChild(s);
    });
    return kauthPromise;
  }
  function login() {
    return ensureKAuth().then(function (K) {
      if (!K) { toast('로그인 모듈을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.'); return false; }
      return K.ensureLogin().then(function () { render(); return true; }, function () { return false; });
    });
  }
  function logout() {
    var id = identity();
    // 테스트 기간 아이디는 접속하면 자동 입장되므로, 로그아웃이 유지되도록 자동 입장을 끈다.
    if (id.kind === 'test') { try { global.localStorage.setItem('hondi_test_optout', '1'); } catch (e) {} }
    if (global.KAuth) { global.KAuth.logout(); }
    else { clearCookie(C_TOKEN); clearCookie(C_EXP); }
    render();
  }

  // ── 화면 ─────────────────────────────────────────────────────
  var CSS =
    '#hondi-user-badge{font:600 14px/1.25 Pretendard,system-ui,-apple-system,"Segoe UI","Malgun Gothic",sans-serif;position:relative;display:inline-block;vertical-align:middle;text-align:left}' +
    '#hondi-user-badge.hub-fixed{position:fixed;top:calc(env(safe-area-inset-top,0px) + 8px);right:12px;z-index:2147482000}' +
    '#hondi-user-badge .hub-chip{display:inline-flex;align-items:center;gap:8px;max-width:56vw;padding:7px 13px;border-radius:999px;border:1px solid rgba(15,23,42,.2);background:rgba(255,255,255,.95);color:#0f172a;cursor:pointer;font:inherit;box-shadow:0 1px 4px rgba(0,0,0,.14)}' +
    '#hondi-user-badge .hub-chip:focus-visible{outline:2px solid #2563eb;outline-offset:2px}' +
    '#hondi-user-badge .hub-dot{width:9px;height:9px;border-radius:50%;background:#94a3b8;flex:none}' +
    '#hondi-user-badge.hub-in .hub-dot{background:#22c55e}' +
    '#hondi-user-badge .hub-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '#hondi-user-badge .hub-tag{flex:none;font-size:11.5px;font-weight:700;padding:1px 6px;border-radius:6px;background:#fef3c7;color:#92400e}' +
    '#hondi-user-badge .hub-menu{position:absolute;right:0;top:calc(100% + 6px);width:max-content;min-width:230px;max-width:min(320px,86vw);box-sizing:border-box;background:#fff;color:#0f172a;border:1px solid rgba(15,23,42,.16);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.2);padding:14px;font-size:15px;font-weight:500;line-height:1.5;z-index:1}' +
    '#hondi-user-badge .hub-menu[hidden]{display:none}' +
    '#hondi-user-badge .hub-menu b{font-weight:800;word-break:break-all}' +
    '#hondi-user-badge .hub-note{margin:6px 0 0;font-size:13.5px;color:#475569}' +
    '#hondi-user-badge .hub-btn{display:block;width:100%;margin-top:10px;padding:9px 12px;border-radius:9px;border:1px solid #cbd5e1;background:#f8fafc;color:#0f172a;font:inherit;font-size:14.5px;cursor:pointer}' +
    '#hondi-user-badge .hub-btn.hub-primary{background:#1d4ed8;border-color:#1d4ed8;color:#fff}' +
    '[data-hondi-user-slot="dark"] #hondi-user-badge .hub-chip{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.4);color:#fff;box-shadow:none}' +
    '[data-hondi-user-slot="dark"] #hondi-user-badge .hub-tag{background:rgba(251,191,36,.25);color:#fde68a}' +
    '@media (prefers-color-scheme:dark){' +
      '#hondi-user-badge.hub-fixed .hub-chip{background:rgba(30,41,59,.95);border-color:rgba(255,255,255,.25);color:#f1f5f9}' +
      '#hondi-user-badge .hub-menu{background:#1e293b;color:#f1f5f9;border-color:rgba(255,255,255,.2)}' +
      '#hondi-user-badge .hub-note{color:#cbd5e1}' +
      '#hondi-user-badge .hub-btn{background:#334155;border-color:#475569;color:#f1f5f9}' +
      '#hondi-user-badge .hub-btn.hub-primary{background:#2563eb;border-color:#2563eb;color:#fff}' +
    '}' +
    'html.hondi-anon [data-requires-login]{opacity:.55;cursor:not-allowed}' +
    '#hondi-user-toast{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 24px);transform:translateX(-50%);z-index:2147482100;max-width:88vw;padding:11px 18px;border-radius:12px;background:#0f172a;color:#fff;font:600 15px/1.4 Pretendard,system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.3)}' +
    '@media print{#hondi-user-badge,#hondi-user-toast{display:none!important}}';

  var badge = null, menuOpen = false, lastSig = null, toastTimer = null;

  function addStyle() {
    if (doc.getElementById('hondi-user-badge-style')) return;
    var st = doc.createElement('style');
    st.id = 'hondi-user-badge-style';
    st.appendChild(doc.createTextNode(CSS));
    (doc.head || doc.documentElement).appendChild(st);
  }
  function mount() {
    if (badge && badge.isConnected) return badge;
    badge = doc.getElementById('hondi-user-badge');
    if (badge) return badge;
    badge = doc.createElement('div');
    badge.id = 'hondi-user-badge';
    var slot = doc.querySelector('[data-hondi-user-slot]');
    if (slot) { slot.appendChild(badge); }
    else { badge.className = 'hub-fixed'; doc.body.appendChild(badge); }
    return badge;
  }
  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function toast(msg) {
    var t = doc.getElementById('hondi-user-toast');
    if (!t) { t = el('div'); t.id = 'hondi-user-toast'; t.setAttribute('role', 'status'); doc.body.appendChild(t); }
    t.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3200);
  }
  function setMenu(open) {
    menuOpen = !!open;
    var m = badge && badge.querySelector('.hub-menu');
    var c = badge && badge.querySelector('.hub-chip');
    if (m) m.hidden = !menuOpen;
    if (c) c.setAttribute('aria-expanded', menuOpen ? 'true' : 'false');
  }

  function render(force) {
    if (!doc.body) return;
    var id = identity();
    var sig = (id.loggedIn ? '1' : '0') + '|' + id.kind + '|' + id.label;
    doc.documentElement.classList.toggle('hondi-anon', !id.loggedIn);
    doc.documentElement.setAttribute('data-hondi-auth', id.loggedIn ? 'in' : 'out');
    if (!force && sig === lastSig && badge && badge.isConnected) return;
    lastSig = sig;
    addStyle();
    mount();
    badge.className = (badge.className.indexOf('hub-fixed') >= 0 ? 'hub-fixed ' : '') + (id.loggedIn ? 'hub-in' : 'hub-out');
    while (badge.firstChild) badge.removeChild(badge.firstChild);

    var chip = el('button', 'hub-chip');
    chip.type = 'button';
    chip.setAttribute('aria-haspopup', 'true');
    chip.setAttribute('aria-expanded', 'false');
    chip.title = id.loggedIn ? '로그인됨 · 아이디 ' + id.label : '로그인하지 않았습니다';
    chip.appendChild(el('span', 'hub-dot'));
    chip.appendChild(el('span', 'hub-label', id.loggedIn ? id.label : '로그인 필요'));
    if (id.kind === 'test') chip.appendChild(el('span', 'hub-tag', '테스트'));
    chip.addEventListener('click', function (ev) { ev.stopPropagation(); setMenu(!menuOpen); });

    var menu = el('div', 'hub-menu');
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    if (id.loggedIn) {
      var p = el('div'); p.appendChild(doc.createTextNode('로그인됨 · 아이디 ')); p.appendChild(el('b', '', id.label));
      menu.appendChild(p);
      if (id.kind === 'test') { menu.appendChild(el('p', 'hub-note', '테스트 기간에 자동으로 만들어진 임시 아이디입니다.')); appendFormalButtons(menu); }
      var out = el('button', 'hub-btn', '로그아웃'); out.type = 'button';
      out.addEventListener('click', function () { setMenu(false); logout(); });
      menu.appendChild(out);
    } else {
      menu.appendChild(el('div', '', '로그인하지 않았습니다.'));
      menu.appendChild(el('p', 'hub-note', '메일 보내기 등 일부 기능은 로그인 후에 쓸 수 있습니다.'));
      var inn = el('button', 'hub-btn hub-primary', '로그인'); inn.type = 'button';
      inn.addEventListener('click', function () { setMenu(false); login(); });
      menu.appendChild(inn);
      var saved = testIdSaved();
      if (saved) {                                   // 이 기기에서 쓰던 테스트 아이디로 되돌아가기(?testid= 는 공용 모듈이 처리)
        var back = el('button', 'hub-btn', '테스트 아이디 ' + saved + '(으)로 입장'); back.type = 'button';
        back.addEventListener('click', function () {
          global.location.href = global.location.pathname + '?testid=' + encodeURIComponent(saved);
        });
        menu.appendChild(back);
      }
    }
    badge.appendChild(chip);
    badge.appendChild(menu);
    setMenu(false);
  }

  // ── 기능 제한: data-requires-login ───────────────────────────
  function guard(ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    var g = t.closest('[data-requires-login]');
    if (!g || identity().loggedIn) return;
    // 글을 쓰려고 입력칸을 누르는 것까지 막지는 않는다 — 보내기(버튼·Enter·제출)만 막는다.
    if (ev.type === 'click' && t.matches && t.matches('textarea, input:not([type]), input[type=text], input[type=search], input[type=email], input[type=url], input[type=tel], input[type=number], input[type=password]')) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    var what = g.getAttribute('data-requires-login');
    toast(what ? '“' + what + '”은(는) 로그인 후에 쓸 수 있습니다.' : '로그인이 필요한 기능입니다.');
    login();
  }
  doc.addEventListener('click', guard, true);
  doc.addEventListener('submit', guard, true);
  doc.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) guard(ev);
  }, true);
  doc.addEventListener('click', function () { if (menuOpen) setMenu(false); });
  doc.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && menuOpen) setMenu(false); });

  // ── 공개 API ─────────────────────────────────────────────────
  global.HondiAuth = {
    version: '1.0',
    isLoggedIn: function () { return identity().loggedIn; },
    getUserLabel: function () { return identity().label; },
    getKind: function () { return identity().kind; },
    require: function (label) {
      if (identity().loggedIn) return Promise.resolve(true);
      if (label) toast('“' + label + '”은(는) 로그인 후에 쓸 수 있습니다.');
      return login().then(function () { return identity().loggedIn; });
    },
    login: login,
    logout: logout,
    startFormalLogin: startFormalLogin,
    refresh: function () { render(true); },
  };

  // ── 시작 ─────────────────────────────────────────────────────
  function start() {
    render(true);
    ensureKAuth();                                    // 테스트 기간 자동 입장·로그인 창을 위해 공용 모듈을 함께 불러온다
    global.addEventListener('hondi-auth-change', function () { render(); });
    doc.addEventListener('visibilitychange', function () { if (!doc.hidden) render(); });
    setInterval(function () { render(); }, 2000);     // 다른 탭·다른 서브도메인에서 바뀐 쿠키 반영
  }
  if (doc.body) start(); else doc.addEventListener('DOMContentLoaded', start);
})(window);
