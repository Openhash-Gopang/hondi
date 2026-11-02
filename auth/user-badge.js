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

   ■ 테스트 아이디 한도(2026-10-27)
     · 테스트 아이디는 DeepSeek API 실비 기준 정해진 한도(기본 500원)까지 무료이고, 한도가 차면 곧바로 사용이 중단되며 유료 회원 전환 안내창이 뜬다.
     · 메뉴에 사용량을 보여 주고, 한도가 차면 안내창을 띄운다(서버 /auth/test-quota). 유예(grace)는 서버 설정(TEST_GRACE_HOURS)을 켠 경우에만 있다.
     · "정식 아이디로 로그인" — 테스트 아이디의 로그인 정보를 쿠키(hondi_mig_pvt, 7일)에 잠시 보관한 뒤 전화 인증 로그인을 연다.
       정식 아이디로 로그인되면 같은 쿠키를 보고 테스트 데이터를 정식 아이디로 옮긴다(서버 /auth/test-migrate).
     · "정식 아이디 만들기" — 위 쿠키를 남기고 hondi.net 가입 화면으로 이동. 가입·로그인 뒤 어느 사이트에서든 이동이 이어진다.

   ■ 아이디 = 메일 아이디(2026-10-27)
     · 정식 로그인 사용자의 아이디는 전화번호가 아니라 메일 아이디(<아이디>@hondi.kr의 앞부분)를 보여 준다.
       서버 GET /kmail/mail-id/status 로 가져오며, 불러오는 동안·실패했을 때는 "로그인됨"만 보인다(전화번호는 어디에도 쓰지 않는다).
     · 가입 직후 첫 로그인에서 한 번 "메일 아이디를 정해 주세요" 선택 화면을 띄운다 — 기본 아이디가 채워져 있고,
       그대로 쓰거나 직접 정하거나 "나중에 하기"(건너뛰기, 기본 아이디 유지)를 고를 수 있다.
     · 같은 화면에서 "보내는 이름(선택)"도 받는다 — 받는 사람의 메일 프로그램(Gmail 등)이 보낸 사람으로 보여 주는 이름이다.
       비워 두면 주소만 나가고, 받는 사람의 프로그램에 따라 @ 앞부분(아이디)이 이름처럼 보일 수 있다. 미리보기를 함께 보여 준다.
     · 아이디 바꾸기는 K-Mail 설정 페이지(https://mail.hondi.net/desktop.html#settings)의 "계정"에서 한다(30일에 3번까지 — 서버 정책).
       배지 오른쪽의 세로 점 세 개(⋮) 아이콘이 그 설정 페이지로 연결된다. (2026-10-28)
     · 메뉴의 "보내는 이름"은 눌러서 바로 고칠 수 있다(저장하면 서버 POST /kmail/settings, 같은 페이지에 "hondi-mail-info-change" 이벤트를 보낸다).

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
  var SETTINGS_URL = 'https://mail.hondi.net/desktop.html#settings';   // K-Mail 설정 페이지(아이디 바꾸기·보내는 이름·서명·자동응답)

  // ── 로그인 상태 읽기 ─────────────────────────────────────────
  function readCookie(name) {
    var m = doc.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    if (!m) return null;
    try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
  }
  function clearCookie(name) {
    doc.cookie = name + '=; domain=' + COOKIE_DOMAIN + '; path=/; max-age=0; secure; samesite=lax';
  }
  // 메인 앱(hondi.net)에서 전화로 가입·로그인한 사용자는 공유 쿠키 없이 이 기기에 계정 정보(gopang_user_v4)만 둔다.
  // 쿠키가 없을 때에 한해 그 기록을 로그인으로 인정한다(번호는 뒤 4자리만 보여 준다).
  function spaIdentity() {
    try {
      var raw = global.localStorage.getItem('gopang_user_v4') || global.sessionStorage.getItem('gopang_user_v4');
      if (!raw) return null;
      var u = JSON.parse(raw);
      var h = String((u && u.handle) || '');
      if (!u || !(u.ipv6 || u.guid) || u.isGuest || u.isTemp || u.test_account || h.indexOf('tid-') === 0) return null;
      return { loggedIn: true, kind: 'user', source: 'spa', label: '로그인됨' };   // 메인 앱의 handle은 전화번호 뒷자리라 보여 주지 않는다
    } catch (e) { return null; }
  }
  function identity() {
    var t = readCookie(C_TOKEN), e = Number(readCookie(C_EXP) || 0);
    if (!t || !e || Date.now() >= e - 30000) return spaIdentity() || { loggedIn: false, kind: '', label: '' };
    if (t.indexOf('tid-') === 0) {                    // 테스트 기간 아이디
      var i = t.indexOf(':');
      var id = i > 4 ? t.slice(4, i) : t.slice(4);
      return { loggedIn: true, kind: 'test', source: 'cookie', label: id };
    }
    return { loggedIn: true, kind: 'user', source: 'cookie', label: (mailInfo && mailInfo.mail_id) || cachedMailId() || '로그인됨' };   // 전화번호는 아이디로 쓰지 않는다
  }
  function testIdSaved() {
    try { return global.localStorage.getItem('hondi_test_id') || ''; } catch (e) { return ''; }
  }

  // ── 한도 조회·정식 아이디 전환·데이터 이동 ───────────────────
  var PROXY = 'https://hondi-proxy.tensor-city.workers.dev';
  var C_MIG = 'hondi_mig_pvt';                              // 테스트 로그인 정보를 잠시 보관(전환용)
  var SIGNUP_URL = 'https://hondi.net/desktop.html';        // 정식 아이디 가입 화면(메인 앱)
  var PAY_URL = 'https://hondi.net/usage.html?charge=1';     // 결제(계좌 이체) 화면 — 정식 아이디로 로그인한 뒤 열린다
  function writeCookie(name, value, maxAgeSec) {
    doc.cookie = name + '=' + encodeURIComponent(value) + '; domain=' + COOKIE_DOMAIN + '; path=/; max-age=' + maxAgeSec + '; secure; samesite=lax';
  }
  var quota = null, quotaAt = 0, quotaBusy = false, migrating = false;
  var fmtNum = function (n) { return Number(n).toLocaleString('ko-KR', { maximumFractionDigits: 0 }); };
  function fmtTime(iso) {
    try {
      var d = new Date(iso);
      return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
    } catch (e) { return ''; }
  }
  function postJson(path, body) {
    if (typeof global.fetch !== 'function') return Promise.reject(new Error('fetch를 쓸 수 없는 브라우저입니다')); // 아이디 표시는 fetch 없이도 동작해야 한다
    return global.fetch(PROXY + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, d: d || {} }; }); });
  }
  var quotaTriedAt = 0;
  function fetchQuota(force) {
    if (identity().kind !== 'test') { quota = null; return Promise.resolve(null); }
    if (!force && quota && Date.now() - quotaAt < 55000) return Promise.resolve(quota);
    if (!force && !quota && Date.now() - quotaTriedAt < 15000) return Promise.resolve(quota);   // 조회가 계속 실패해도 15초에 한 번만 다시 시도
    if (quotaBusy) return Promise.resolve(quota);
    quotaBusy = true; quotaTriedAt = Date.now();
    return postJson('/auth/test-quota', { phone_verify_token: readCookie(C_TOKEN) }).then(function (x) {
      quotaBusy = false;
      if (x.d.ok && x.d.test) { quota = x.d; quotaAt = Date.now(); }
      else if (x.d.ok && !x.d.test) { quota = null; }
      render(true);
      onQuotaState();
      return quota;
    }, function () { quotaBusy = false; return quota; });
  }
  function onQuotaState() {
    if (!quota) return;
    if (quota.status === 'grace') {
      var flag = null; try { flag = global.sessionStorage.getItem('hondi_grace_notice'); } catch (e) {}
      if (!flag) {
        try { global.sessionStorage.setItem('hondi_grace_notice', '1'); } catch (e) {}
        toast('테스트 한도를 모두 사용했습니다. ' + fmtTime(quota.grace_ends_at) + '까지 정식 아이디로 전환해 주세요. 이후에는 사용이 중단됩니다.', 9000);
      }
    } else if (quota.status === 'blocked') {
      showBlockedModal();
    }
  }
  function testTagText() {
    if (quota && quota.status === 'grace') return '전환 필요';
    if (quota && quota.status === 'blocked') return '중단됨';
    return '테스트';
  }
  function stashTestToken() {                               // 정식 로그인 뒤 데이터를 옮길 수 있게 테스트 로그인 정보를 잠시 보관
    var t = readCookie(C_TOKEN);
    if (t && t.indexOf('tid-') === 0) writeCookie(C_MIG, t, 7 * 24 * 3600);
  }
  function startFormalLogin() {
    stashTestToken();
    if (identity().kind === 'test') { try { global.localStorage.setItem('hondi_test_optout', '1'); } catch (e) {} }
    if (global.KAuth) { global.KAuth.logout(); } else { clearCookie(C_TOKEN); clearCookie(C_EXP); }
    render(true);
    return login().then(function () { return maybeMigrate(); });
  }
  function startSignup() {
    stashTestToken();
    global.location.href = SIGNUP_URL;
  }
  function maybeMigrate() {
    var mig = readCookie(C_MIG), id = identity();
    if (!mig || !id.loggedIn || id.kind !== 'user' || id.source !== 'cookie' || migrating) return Promise.resolve();   // 메인 앱 기기 로그인에는 전화 인증 토큰이 없어 이동할 수 없다
    migrating = true;
    var i0 = mig.indexOf(':'), testId = mig.indexOf('tid-') === 0 ? mig.slice(4, i0 > 4 ? i0 : undefined) : '';
    var sum = { moved: 0, failed: 0, found: 0 };
    // 서버는 한 번에 처리할 양이 제한돼 있어(무료 플랜 워커) done=false와 next_index를 돌려준다 — 그 값을 cursor로 다시 보낸다.
    var call = function (dry, cursor) {
      return postJson('/auth/test-migrate', { test_phone_verify_token: mig, phone_verify_token: readCookie(C_TOKEN), dry_run: !!dry, cursor: cursor || 0, failed_before: dry ? 0 : sum.failed });
    };
    var fail = function (x) {
      var msg = (x.d && (x.d.message || x.d.detail)) || '';
      if (x.status >= 500 || !x.status) { toast('테스트 데이터 이동에 실패했습니다. 잠시 뒤 다시 시도합니다. ' + msg, 8000); return; }   // 쿠키를 남겨 다음에 다시 시도
      clearCookie(C_MIG);
      toast('테스트 데이터를 옮기지 못했습니다. ' + msg, 9000);
    };
    var finish = function (d) {
      clearCookie(C_MIG);
      if (d.migrated) { try { global.localStorage.removeItem('hondi_test_id'); } catch (e) {} }   // 닫힌 테스트 아이디로 되돌아가는 버튼이 남지 않게
      if (d.migrated) toast('테스트 아이디' + (testId ? '(' + testId + ')' : '') + '의 데이터 ' + fmtNum(sum.moved) + '건을 정식 아이디로 옮겼습니다.', 9000);
      else toast(fmtNum(sum.moved) + '건을 옮겼습니다. ' + fmtNum(sum.failed) + '건은 중복 등으로 옮기지 못했습니다.', 10000);
    };
    var loop = function (n, cursor) {
      return call(false, cursor).then(function (x) {
        if (!x.d.ok) return fail(x);
        var movedNow = (x.d.totals && x.d.totals.moved) || 0;
        sum.moved += movedNow; sum.failed += (x.d.totals && x.d.totals.failed) || 0;
        var next = Number(x.d.next_index) || 0;
        // 이어갈 곳이 앞으로 가거나, 같은 곳에서라도 실제로 옮긴 것이 있을 때만 계속한다(멈춰 있으면 무한 반복하지 않는다)
        if (!x.d.done && n < 400 && (next > cursor || movedNow > 0)) {
          toast('테스트 데이터를 옮기는 중… ' + fmtNum(sum.moved) + '건 (' + next + '/' + (x.d.total_targets || '?') + ')', 4000);
          return loop(n + 1, next);
        }
        return finish(x.d);
      });
    };
    var count = function (n, cursor) {                       // 건수 확인도 여러 번에 나눠 센다
      return call(true, cursor).then(function (x) {
        if (!x.d.ok) return x;
        sum.found += (x.d.totals && x.d.totals.found) || 0;
        if (!x.d.done && n < 200 && Number(x.d.next_index) > cursor) return count(n + 1, Number(x.d.next_index));
        return x;
      });
    };
    return count(0, 0).then(function (x) {
      if (!x.d.ok) return fail(x);
      var n = sum.found;
      if (n > 0 && !global.confirm('테스트 아이디' + (testId ? '(' + testId + ')' : '') + '의 데이터 ' + fmtNum(n) + '건을 지금 로그인한 정식 아이디로 옮깁니다.\n옮긴 뒤에는 이 테스트 아이디로 다시 로그인할 수 없습니다.\n\n계속할까요?')) {
        clearCookie(C_MIG);
        toast('옮기지 않았습니다. 나중에 옮기려면 테스트 아이디로 다시 입장해 메뉴의 "정식 아이디로 로그인"을 누르세요.', 9000);
        return;
      }
      return loop(0, 0);
    }).catch(function () { toast('테스트 데이터 이동 중 연결이 끊겼습니다. 잠시 뒤 다시 시도합니다.', 8000); })
      .then(function () { migrating = false; mailInfo = null; fetchMailId(true); });   // 이동이 끝나면 새 정식 계정의 아이디 선택 화면을 이어서 띄운다
  }
  function showBlockedModal() {
    if (doc.getElementById('hondi-blocked-modal')) return;
    var back = el('div'); back.id = 'hondi-blocked-modal';
    var box = el('div', 'hub-modal'); box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    box.appendChild(el('h2', '', '무료 한도를 모두 사용했습니다'));
    box.appendChild(el('p', '', '테스트 아이디의 무료 한도(AI 사용 비용 ' + fmtNum(quota.limit_krw) + '원)를 다 썼습니다. 계속 쓰려면 유료 회원으로 전환해 주세요.'));
    var price = el('div', 'hub-price');
    price.appendChild(el('div', '', '정식 요금: 월 100,000원 · 연 1,200,000원'));
    price.appendChild(el('div', 'hub-price-em', '필드 테스트 가입자(2026년 12월 말까지) 90% 할인: 월 10,000원 · 연 100,000원'));
    box.appendChild(price);
    box.appendChild(el('p', 'hub-note', '전환 순서: ① 정식 아이디로 로그인하거나 만들면 테스트 데이터가 옮겨집니다. ② 사용량 화면의 충전하기에서 계좌 이체로 결제합니다. 자동결제는 없습니다.'));
    var b1 = el('button', 'hub-btn hub-primary', '정식 아이디로 로그인'); b1.type = 'button';
    b1.addEventListener('click', function () { back.remove(); startFormalLogin(); });
    var b2 = el('button', 'hub-btn', '정식 아이디 만들기'); b2.type = 'button';
    b2.addEventListener('click', startSignup);
    var b4 = el('button', 'hub-btn', '이미 정식 아이디가 있다면 결제 화면 열기'); b4.type = 'button';
    b4.addEventListener('click', function () { global.location.href = PAY_URL; });
    var b3 = el('button', 'hub-btn', '닫기'); b3.type = 'button';
    b3.addEventListener('click', function () { back.remove(); });
    box.appendChild(b1); box.appendChild(b2); box.appendChild(b4); box.appendChild(b3);
    back.appendChild(box); doc.body.appendChild(back);
  }
  function appendTestSection(menu) {
    if (quota) {
      var pct = Math.min(100, Math.round((quota.spent_krw / quota.limit_krw) * 100));
      var q = el('div', 'hub-quota');
      q.appendChild(el('div', '', '무료 사용량 ' + fmtNum(quota.spent_krw) + ' / ' + fmtNum(quota.limit_krw) + '원'));
      var bar = el('div', 'hub-bar'); var fill = el('div', 'hub-bar-fill' + (quota.status === 'active' ? '' : ' hub-over')); fill.style.width = pct + '%'; bar.appendChild(fill); q.appendChild(bar);
      if (quota.status === 'grace') q.appendChild(el('p', 'hub-note hub-warn', '한도를 모두 사용했습니다. ' + fmtTime(quota.grace_ends_at) + '까지 정식 아이디로 전환해 주세요. 이후에는 사용이 중단됩니다.'));
      else if (quota.status === 'blocked') q.appendChild(el('p', 'hub-note hub-warn', '무료 한도를 모두 사용해 사용이 중단되었습니다. 유료 회원으로 전환하면 이어서 쓸 수 있습니다.'));
      menu.appendChild(q);
    } else {
      menu.appendChild(el('p', 'hub-note', '테스트 기간에 자동으로 만들어진 임시 아이디입니다.'));
    }
    var b1 = el('button', 'hub-btn hub-primary', '정식 아이디로 로그인'); b1.type = 'button';
    b1.addEventListener('click', function () { setMenu(false); startFormalLogin(); });
    var b2 = el('button', 'hub-btn', '정식 아이디 만들기'); b2.type = 'button';
    b2.addEventListener('click', startSignup);
    menu.appendChild(b1); menu.appendChild(b2);
    menu.appendChild(el('p', 'hub-note', '로그인하면 테스트 데이터를 정식 아이디로 옮겨 드립니다.'));
  }

  // ── 메일 아이디(= 혼디 아이디) ───────────────────────────────
  var mailInfo = null, mailInfoAt = 0, mailInfoBusy = false, mailInfoTriedAt = 0, mailPrompted = false;
  var MID_CACHE = 'hondi_mail_id', MID_PROMPTED = 'hondi_mid_prompted';
  function cachedMailId() {
    try { var v = JSON.parse(global.sessionStorage.getItem(MID_CACHE) || 'null'); return (v && v.id && Date.now() - v.t < 600000) ? v.id : ''; } catch (e) { return ''; }
  }
  function cacheMailId(id) {
    try { if (id) global.sessionStorage.setItem(MID_CACHE, JSON.stringify({ id: id, t: Date.now() })); else global.sessionStorage.removeItem(MID_CACHE); } catch (e) {}
  }
  function getJson(path) {
    if (typeof global.fetch !== 'function') return Promise.reject(new Error('fetch를 쓸 수 없는 브라우저입니다'));
    return global.fetch(PROXY + path).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, d: d || {} }; }); });
  }
  function isCookieUser() { var i = identity(); return i.kind === 'user' && i.source === 'cookie'; }
  function fetchMailId(force) {
    if (!isCookieUser()) { mailInfo = null; return Promise.resolve(null); }
    if (mailInfoBusy) return Promise.resolve(mailInfo);
    if (!force && mailInfo && Date.now() - mailInfoAt < 300000) return Promise.resolve(mailInfo);
    if (!force && !mailInfo && Date.now() - mailInfoTriedAt < 15000) return Promise.resolve(mailInfo);   // 실패해도 15초에 한 번만
    mailInfoBusy = true; mailInfoTriedAt = Date.now();
    return getJson('/kmail/mail-id/status?phone_verify_token=' + encodeURIComponent(readCookie(C_TOKEN))).then(function (x) {
      mailInfoBusy = false;
      if (x.d && x.d.ok) { mailInfo = x.d; mailInfoAt = Date.now(); cacheMailId(x.d.mail_id); render(true); maybePromptMailId(); }
      return mailInfo;
    }, function () { mailInfoBusy = false; return mailInfo; });
  }
  // 가입 직후 첫 로그인 — 선택을 아직 안 했으면 한 번만(탭 세션당) 선택 화면을 띄운다. 데이터 이동이 끝난 뒤에 띄운다.
  function maybePromptMailId() {
    if (!mailInfo || !mailInfo.needs_choice || mailPrompted || migrating || !isCookieUser()) return;
    var seen = null; try { seen = global.sessionStorage.getItem(MID_PROMPTED); } catch (e) {}
    if (seen) return;
    mailPrompted = true; try { global.sessionStorage.setItem(MID_PROMPTED, '1'); } catch (e) {}
    openMailIdChooser({ first: true });
  }
  // 서버(kmail-sender.js)와 같은 규칙 — 최종 판정은 서버가 하고, 여기서는 미리 알려 준다
  function checkSenderName(raw, nameMax) {
    nameMax = nameMax || 40;
    var r = String(raw == null ? '' : raw);
    if (/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u206F\uFEFF]/.test(r)) return { ok: false, value: '', msg: '줄바꿈이나 보이지 않는 문자는 쓸 수 없습니다.' };
    var v = r.replace(/\s+/g, ' ').trim();
    if (Array.from(v).length > nameMax) return { ok: false, value: v, msg: '이름은 ' + nameMax + '자까지 쓸 수 있습니다.' };
    if (/[<>"@\\;:,]/.test(v)) return { ok: false, value: v, msg: '이름에는 < > " @ \\ ; : , 문자를 쓸 수 없습니다.' };
    if (/[\u2713\u2714\u2611\u2705\uD83D\uDD12\uD83D\uDD10\uD83D\uDD0F\uD83D\uDEE1]/.test(v)) return { ok: false, value: v, msg: '인증·보증된 것처럼 보이는 기호(✓ ✔ ✅ 🔒 등)는 이름에 쓸 수 없습니다.' };
    return { ok: true, value: v };
  }
  function openMailIdChooser(opts) {
    opts = opts || {};
    var first = !!opts.first, tok = readCookie(C_TOKEN);
    if (!tok || doc.getElementById('hondi-mailid-modal')) return;
    var info = mailInfo || {}, current = info.mail_id || '', n = 0, timer = null, seq = 0;
    var st = { ok: false, same: false };
    var enc = encodeURIComponent;
    var curName = String(info.sender_display_name || '');
    var nameServerMsg = '';                                         // 서버가 이름을 거절했을 때의 이유 — 이름을 다시 고칠 때까지 보여 준다
    var nameMax = info.sender_name_max || 40;
    function checkName(raw) { return checkSenderName(raw, nameMax); }

    var back = el('div'); back.id = 'hondi-mailid-modal';
    var box = el('div', 'hub-modal'); box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'hondi-mid-title');
    var h = el('h2', '', first ? '메일 아이디를 정해 주세요' : '메일 아이디 바꾸기'); h.id = 'hondi-mid-title';
    box.appendChild(h);
    box.appendChild(el('p', '', first ? '혼디 아이디이자 메일 주소(아이디@hondi.kr)가 됩니다. 기본 아이디를 드렸어요 — 마음에 들면 그대로 쓰시고, 바꾸고 싶으면 아래에서 고르세요.' : '바꾸면 새 아이디가 내 메일 주소가 됩니다.'));
    var row = el('div', 'hub-mid-row');
    var input = el('input', 'hub-mid-input'); input.type = 'text'; input.id = 'hondi-mid-input'; input.maxLength = 40; input.autocomplete = 'off'; input.spellcheck = false; input.setAttribute('autocapitalize', 'none'); input.setAttribute('aria-label', '메일 아이디');
    row.appendChild(input); row.appendChild(el('span', 'hub-mid-suffix', '@hondi.kr'));
    box.appendChild(row);
    var status = el('div', 'hub-mid-status'); status.setAttribute('aria-live', 'polite'); status.id = 'hondi-mid-status';
    box.appendChild(status);
    var suggest = el('button', 'hub-btn hub-mid-suggest', '다른 아이디 추천 보기'); suggest.type = 'button';
    box.appendChild(suggest);
    box.appendChild(el('p', 'hub-note', '3~30자 · 영문 소문자, 숫자, 하이픈(-), 밑줄(_) · 숫자만으로는 만들 수 없어요.'));
    // 보내는 이름(선택) — 받는 사람 화면에 보이는 이름. 2026-10-27(주피터 결정: 필수 아님, 권장)
    var nameLabel = el('div', 'hub-mid-label', '보내는 이름 (선택 · 권장)'); box.appendChild(nameLabel);
    var nameInput = el('input', 'hub-mid-input hub-mid-name'); nameInput.type = 'text'; nameInput.id = 'hondi-mid-name'; nameInput.maxLength = 40; nameInput.autocomplete = 'off'; nameInput.spellcheck = false; nameInput.placeholder = '예: 도 영민'; nameInput.setAttribute('aria-label', '보내는 이름');
    box.appendChild(nameInput);
    box.appendChild(el('p', 'hub-note', '받는 모든 사람에게 보입니다. 비워 두면 주소만 나가고, 받는 사람의 메일 프로그램에 따라 아이디 부분이 이름처럼 보일 수 있어요.'));
    var preview = el('div', 'hub-mid-preview'); preview.id = 'hondi-mid-preview'; preview.setAttribute('aria-live', 'polite'); box.appendChild(preview);
    var nameStatus = el('div', 'hub-mid-status'); nameStatus.id = 'hondi-mid-name-status'; nameStatus.setAttribute('aria-live', 'polite'); box.appendChild(nameStatus);
    var limitNote = el('p', 'hub-note'); box.appendChild(limitNote);
    var primary = el('button', 'hub-btn hub-primary', first ? '이 아이디 사용' : '이 아이디로 저장'); primary.type = 'button';
    var secondary = el('button', 'hub-btn', first ? '나중에 하기 (기본 아이디 유지)' : '닫기'); secondary.type = 'button';
    box.appendChild(primary); box.appendChild(secondary);
    back.appendChild(box); doc.body.appendChild(back);

    function setStatus(msg, kind) { status.textContent = msg || ''; status.className = 'hub-mid-status' + (kind ? ' hub-mid-' + kind : ''); }
    function paintLimit() {
      var left = info.changes_left, lim = info.limit, win = info.window_days;
      if (info.can_change === false) { limitNote.textContent = (info.limit_message || ('변경 횟수를 모두 사용했습니다.')); limitNote.className = 'hub-note hub-warn'; }
      else if (first || info.first_free) { limitNote.textContent = '처음 한 번은 변경 횟수에 포함되지 않아요. 이후에는 ' + (win || 30) + '일에 ' + (lim || 3) + '번까지 바꿀 수 있어요.'; limitNote.className = 'hub-note'; }
      else if (left != null) { limitNote.textContent = '남은 변경 횟수 ' + left + '/' + lim + ' (' + win + '일 기준)'; limitNote.className = 'hub-note'; }
      else limitNote.textContent = '';
    }
    function nameState() { var r = checkName(nameInput.value); return { ok: r.ok, value: r.value, msg: r.msg, dirty: r.ok && r.value !== curName }; }
    function paintPreview() {
      var ns = nameState();
      var idNow = String(input.value || '').trim().toLowerCase();
      var idShown = (st.ok || st.same) && idNow ? idNow : (current || idNow || '아이디');
      var addr = idShown + '@hondi.kr';
      preview.textContent = ns.ok && ns.value ? ('받는 사람에게 이렇게 보입니다:  ' + ns.value + ' <' + addr + '>') : ('받는 사람에게 이렇게 보입니다:  ' + addr);
      var shown = ns.ok ? nameServerMsg : ns.msg;
      nameStatus.textContent = shown; nameStatus.className = 'hub-mid-status' + (shown ? ' hub-mid-bad' : '');
    }
    function paintButtons() {
      var changeBlocked = info.can_change === false, ns = nameState();
      paintPreview();
      if (!ns.ok) { primary.disabled = true; return; }
      if (st.same) {
        if (first) { primary.textContent = ns.dirty ? '이 아이디와 이름 저장' : '이 아이디 사용'; primary.disabled = false; }
        else { primary.textContent = '이름 저장'; primary.disabled = !ns.dirty; }
      } else { primary.textContent = ns.dirty ? '이 아이디와 이름 저장' : '이 아이디로 저장'; primary.disabled = !st.ok || changeBlocked; }
    }
    function close() { clearTimeout(timer); if (back.parentNode) back.parentNode.removeChild(back); doc.removeEventListener('keydown', onKey, true); }
    function onKey(ev) { if (ev.key === 'Escape' && !first) close(); }
    doc.addEventListener('keydown', onKey, true);

    function runCheck() {
      var v = input.value.trim().toLowerCase();
      var mine = ++seq;
      if (!v) { st = { ok: false, same: false }; setStatus('', ''); paintButtons(); return; }
      if (v === current) { st = { ok: true, same: true }; setStatus('지금 쓰는 아이디입니다.', 'ok'); paintButtons(); return; }
      if (v.length < 3) { st = { ok: false, same: false }; setStatus('3자 이상 입력해 주세요.', 'bad'); paintButtons(); return; }
      setStatus('확인하는 중…', ''); st = { ok: false, same: false }; paintButtons();
      getJson('/kmail/mail-id/check?candidate=' + enc(v) + '&phone_verify_token=' + enc(tok)).then(function (x) {
        if (mine !== seq) return;                           // 그 사이 입력이 바뀌었으면 버린다
        if (x.status === 200 && x.d.ok) {
          if (!x.d.valid) { setStatus(x.d.message || '사용할 수 없는 아이디입니다.', 'bad'); st = { ok: false, same: false }; }
          else if (!x.d.available) { setStatus('이미 사용 중인 아이디예요.', 'bad'); st = { ok: false, same: false }; }
          else { setStatus('사용할 수 있어요 ✓', 'ok'); st = { ok: true, same: false }; }
        } else { setStatus((x.d && x.d.message) || '확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.', 'bad'); st = { ok: false, same: false }; }
        paintButtons();
      }, function () { if (mine === seq) { setStatus('확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.', 'bad'); paintButtons(); } });
    }
    input.addEventListener('input', function () { clearTimeout(timer); st = { ok: false, same: false }; paintButtons(); timer = setTimeout(runCheck, 350); });
    input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && !ev.isComposing && !primary.disabled) { ev.preventDefault(); primary.click(); } });
    nameInput.addEventListener('input', function () { nameServerMsg = ''; paintButtons(); });
    nameInput.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && !ev.isComposing && !primary.disabled) { ev.preventDefault(); primary.click(); } });

    suggest.addEventListener('click', function () {
      n += 1; suggest.disabled = true;
      getJson('/kmail/mail-id/suggest?n=' + n + '&phone_verify_token=' + enc(tok)).then(function (x) {
        suggest.disabled = false;
        if (x.d && x.d.ok && x.d.candidate) { input.value = x.d.candidate; runCheck(); input.focus(); }
        else setStatus((x.d && x.d.message) || '추천을 가져오지 못했습니다.', 'bad');
      }, function () { suggest.disabled = false; setStatus('추천을 가져오지 못했습니다.', 'bad'); });
    });

    function refreshAndClose(msg) {
      toast(msg, 7000); mailInfo = null; render(true); close(); fetchMailId(true);
    }
    function nameMsgPart(ns) { return ns.dirty ? (ns.value ? ', 보내는 이름 ' + ns.value : ', 이름은 비워 두었습니다(주소만 나감)') : ''; }
    primary.addEventListener('click', function () {
      var v = input.value.trim().toLowerCase(), ns = nameState();
      if (!ns.ok) return;
      primary.disabled = true;
      function fail(x, e) { if (x && x.status === 429) { info.can_change = false; info.limit_message = x.d.message; paintLimit(); } setStatus((x && x.d && x.d.message) || '저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.', 'bad'); st = { ok: false, same: st.same }; paintButtons(); }
      if (st.same) {
        // 아이디는 그대로 — 이름이 바뀌었으면 먼저 저장하고(실패하면 확정하지 않는다), 선택 화면이면 "아이디 사용"으로 확정한다
        var afterName = function () {
          if (!first) { cacheMailId(current); refreshAndClose('보내는 이름을 ' + (ns.value ? ns.value : '비웠습니다(주소만 나갑니다)') + (ns.value ? '(으)로 바꿨습니다.' : '.')); return; }
          postJson('/kmail/mail-id/confirm', { phone_verify_token: tok, action: 'accept' }).then(function (x) {
            if (x.d && x.d.ok) refreshAndClose('메일 아이디 ' + x.d.mail_id + nameMsgPart(ns) + '(으)로 정해졌습니다. 아이디를 눌러 언제든 바꿀 수 있어요.');
            else fail(x);
          }, function () { fail(null); });
        };
        if (ns.dirty) postJson('/kmail/settings', { phone_verify_token: tok, sender_display_name: ns.value }).then(function (x) { if (x.status === 200 && x.d.ok) afterName(); else { nameServerMsg = (x.d && x.d.message) || '이름을 저장하지 못했습니다.'; paintButtons(); } }, function () { fail(null); });
        else afterName();
        return;
      }
      var body = { phone_verify_token: tok, mail_id: v };
      if (ns.dirty) body.sender_display_name = ns.value;           // 같은 요청으로 함께 저장 — 이름이 거절되면 아이디도 저장되지 않는다
      postJson('/kmail/settings', body).then(function (x) {
        if (x.status === 200 && x.d.ok) { cacheMailId(v); refreshAndClose('메일 아이디가 ' + v + '(으)로 바뀌었습니다' + nameMsgPart(ns) + '. 새 주소: ' + v + '@hondi.kr'); return; }
        if (x.d && x.d.error === 'INVALID_SENDER_NAME') { nameServerMsg = x.d.message; paintButtons(); return; }
        fail(x);
      }, function () { fail(null); });
    });
    secondary.addEventListener('click', function () {
      if (!first) { close(); return; }
      secondary.disabled = true;
      postJson('/kmail/mail-id/confirm', { phone_verify_token: tok, action: 'skip' }).then(function (x) {
        if (x.d && x.d.ok) refreshAndClose('기본 아이디 ' + x.d.mail_id + '(을)를 그대로 쓰겠습니다. 아이디를 눌러 언제든 바꿀 수 있어요.');
        else { secondary.disabled = false; setStatus((x.d && x.d.message) || '저장하지 못했습니다.', 'bad'); }
      }, function () { secondary.disabled = false; setStatus('저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.', 'bad'); });
    });

    paintLimit();
    nameInput.value = curName; paintPreview();
    if (current) { input.value = current; runCheck(); }
    else {                                                   // 아직 아이디가 없으면(드문 경우) 기본 추천을 채운다
      getJson('/kmail/mail-id/suggest?n=0&phone_verify_token=' + enc(tok)).then(function (x) { if (x.d && x.d.candidate) { input.value = x.d.candidate; runCheck(); } }, function () {});
    }
    input.focus();
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
    mailInfo = null; mailPrompted = false; cacheMailId('');
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
    '#hondi-user-badge .hub-menu{position:absolute;right:0;top:calc(100% + 6px);width:max-content;min-width:250px;max-width:min(340px,88vw);box-sizing:border-box;background:#fff;color:#0f172a;border:1px solid rgba(15,23,42,.16);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.2);padding:14px;font-size:15px;font-weight:500;line-height:1.5;z-index:1}' +
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
    '#hondi-user-badge .hub-quota{margin-top:8px}' +
    '#hondi-user-badge .hub-bar{height:8px;border-radius:999px;background:#e2e8f0;margin-top:6px;overflow:hidden}' +
    '#hondi-user-badge .hub-bar-fill{height:100%;background:#22c55e}' +
    '#hondi-user-badge .hub-bar-fill.hub-over{background:#dc2626}' +
    '#hondi-user-badge .hub-warn{color:#b91c1c;font-weight:600}' +
    '#hondi-user-badge .hub-row{display:inline-flex;align-items:center;gap:4px;max-width:100%}' +
    '#hondi-user-badge .hub-more{flex:none;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;text-decoration:none;cursor:pointer;border:1px solid transparent;background:transparent;color:#334155}' +
    '#hondi-user-badge .hub-more:hover{background:rgba(15,23,42,.1)}' +
    '#hondi-user-badge .hub-more:focus-visible{outline:2px solid #2563eb;outline-offset:2px}' +
    '#hondi-user-badge .hub-more svg{width:20px;height:20px;fill:currentColor}' +
    '[data-hondi-user-slot="dark"] #hondi-user-badge .hub-more{color:#fff}' +
    '[data-hondi-user-slot="dark"] #hondi-user-badge .hub-more:hover{background:rgba(255,255,255,.18)}' +
    '#hondi-user-badge .hub-name{margin:8px 0 0;font-size:13.5px;color:#475569;line-height:1.6}' +
    '#hondi-user-badge .hub-name-val{display:inline-flex;align-items:center;gap:5px;max-width:100%;padding:2px 7px;margin-left:3px;border:1px dashed #94a3b8;border-radius:7px;background:transparent;color:#0f172a;font:inherit;font-size:13.5px;font-weight:700;cursor:text;text-align:left;word-break:break-all}' +
    '#hondi-user-badge .hub-name-val:hover{background:#f1f5f9;border-color:#64748b}' +
    '#hondi-user-badge .hub-name-val:focus-visible{outline:2px solid #2563eb;outline-offset:2px}' +
    '#hondi-user-badge .hub-name-val.hub-empty{font-weight:500;color:#64748b}' +
    '#hondi-user-badge .hub-name-val svg{width:13px;height:13px;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
    '#hondi-user-badge .hub-name-edit{display:flex;gap:6px;margin-top:6px}' +
    '#hondi-user-badge .hub-name-input{flex:1 1 auto;min-width:0;box-sizing:border-box;padding:7px 9px;border:2px solid #cbd5e1;border-radius:8px;font:600 14.5px/1.3 Pretendard,system-ui,sans-serif;color:#0f172a;background:#fff}' +
    '#hondi-user-badge .hub-name-input:focus{outline:none;border-color:#1d4ed8}' +
    '#hondi-user-badge .hub-name-edit .hub-btn{display:inline-block;width:auto;margin-top:0;padding:7px 11px;font-size:13.5px;flex:none}' +
    '#hondi-user-badge .hub-name-edit .hub-btn:disabled{opacity:.5;cursor:not-allowed}' +
    '#hondi-user-badge .hub-name-msg{min-height:1.2em;margin:4px 0 0;font-size:12.5px;color:#b91c1c;font-weight:600}' +
    '@media (prefers-color-scheme:dark){#hondi-user-badge .hub-more{color:#e2e8f0}#hondi-user-badge .hub-more:hover{background:rgba(255,255,255,.14)}#hondi-user-badge .hub-name-val{color:#f1f5f9;border-color:#64748b}#hondi-user-badge .hub-name-val:hover{background:#334155}#hondi-user-badge .hub-name-val.hub-empty{color:#cbd5e1}#hondi-user-badge .hub-name-input{background:#0f172a;border-color:#475569;color:#f1f5f9}#hondi-user-badge .hub-name-msg{color:#fca5a5}}' +
    '#hondi-blocked-modal{position:fixed;inset:0;z-index:2147482500;background:rgba(15,23,42,.62);display:flex;align-items:center;justify-content:center;padding:16px}' +
    '#hondi-blocked-modal .hub-modal{width:min(440px,100%);box-sizing:border-box;background:#fff;color:#0f172a;border-radius:16px;padding:22px 22px 18px;font:500 16px/1.6 Pretendard,system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.35)}' +
    '#hondi-blocked-modal h2{margin:0 0 8px;font-size:21px}' +
    '#hondi-blocked-modal .hub-price{margin:8px 0;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;background:#f1f5f9;font-size:15px;line-height:1.55}' +
    '#hondi-blocked-modal .hub-price-em{margin-top:4px;font-weight:700;color:#1d4ed8}' +
    '#hondi-blocked-modal .hub-note{font-size:14px;color:#475569;line-height:1.55}' +
    '@media (prefers-color-scheme:dark){#hondi-blocked-modal .hub-price{background:#0f172a;border-color:#475569}#hondi-blocked-modal .hub-price-em{color:#93c5fd}#hondi-blocked-modal .hub-note{color:#cbd5e1}}' +
    '#hondi-blocked-modal p{margin:0 0 6px}' +
    '#hondi-blocked-modal .hub-btn{display:block;width:100%;margin-top:10px;padding:11px 12px;border-radius:10px;border:1px solid #cbd5e1;background:#f8fafc;color:#0f172a;font:inherit;font-size:16px;cursor:pointer}' +
    '#hondi-blocked-modal .hub-btn.hub-primary{background:#1d4ed8;border-color:#1d4ed8;color:#fff}' +
    '@media (prefers-color-scheme:dark){#hondi-user-badge .hub-bar{background:#475569}#hondi-user-badge .hub-warn{color:#fca5a5}#hondi-blocked-modal .hub-modal{background:#1e293b;color:#f1f5f9}#hondi-blocked-modal .hub-btn{background:#334155;border-color:#475569;color:#f1f5f9}#hondi-blocked-modal .hub-btn.hub-primary{background:#2563eb;border-color:#2563eb;color:#fff}}' +
    '#hondi-mailid-modal{position:fixed;inset:0;z-index:2147482400;background:rgba(15,23,42,.62);display:flex;align-items:center;justify-content:center;padding:16px}' +
    '#hondi-mailid-modal .hub-modal{width:min(460px,100%);max-height:calc(100vh - 32px);overflow:auto;box-sizing:border-box;background:#fff;color:#0f172a;border-radius:16px;padding:22px 22px 18px;font:500 16px/1.6 Pretendard,system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.35)}' +
    '#hondi-mailid-modal h2{margin:0 0 8px;font-size:21px}' +
    '#hondi-mailid-modal p{margin:0 0 8px}' +
    '#hondi-mailid-modal .hub-note{font-size:14px;color:#475569;line-height:1.55}' +
    '#hondi-mailid-modal .hub-warn{color:#b91c1c;font-weight:600}' +
    '#hondi-mailid-modal .hub-btn{display:block;width:100%;margin-top:10px;padding:11px 12px;border-radius:10px;border:1px solid #cbd5e1;background:#f8fafc;color:#0f172a;font:inherit;font-size:16px;cursor:pointer}' +
    '#hondi-mailid-modal .hub-btn:disabled{opacity:.5;cursor:not-allowed}' +
    '#hondi-mailid-modal .hub-btn.hub-primary{background:#1d4ed8;border-color:#1d4ed8;color:#fff}' +
    '#hondi-mailid-modal .hub-mid-suggest{margin-top:2px;padding:8px 12px;font-size:14.5px}' +
    '#hondi-mailid-modal .hub-mid-label{margin:14px 0 4px;font-weight:700;font-size:15px}' +
    '#hondi-mailid-modal .hub-mid-name{width:100%}' +
    '#hondi-mailid-modal .hub-mid-preview{margin:6px 0 2px;padding:9px 11px;border:1px solid #cbd5e1;border-radius:10px;background:#f1f5f9;font-weight:700;font-size:15px;word-break:break-all}' +
    '.hub-mid-row{display:flex;align-items:center;gap:6px;margin:10px 0 4px}' +
    '.hub-mid-input{flex:1 1 auto;min-width:0;box-sizing:border-box;padding:11px 12px;border:2px solid #cbd5e1;border-radius:10px;font:600 18px/1.3 Pretendard,system-ui,sans-serif;color:#0f172a;background:#fff}' +
    '.hub-mid-input:focus{outline:none;border-color:#1d4ed8}' +
    '.hub-mid-suffix{flex:none;font-weight:700;color:#475569}' +
    '.hub-mid-status{min-height:1.5em;margin:2px 0 8px;font-size:15px;font-weight:600;color:#475569}' +
    '.hub-mid-status.hub-mid-ok{color:#15803d}.hub-mid-status.hub-mid-bad{color:#b91c1c}' +
    '@media (prefers-color-scheme:dark){#hondi-mailid-modal .hub-mid-preview{background:#0f172a;border-color:#475569}#hondi-mailid-modal .hub-modal{background:#1e293b;color:#f1f5f9}#hondi-mailid-modal .hub-note{color:#cbd5e1}#hondi-mailid-modal .hub-btn{background:#334155;border-color:#475569;color:#f1f5f9}#hondi-mailid-modal .hub-btn.hub-primary{background:#2563eb;border-color:#2563eb;color:#fff}.hub-mid-input{background:#0f172a;border-color:#475569;color:#f1f5f9}.hub-mid-suffix{color:#cbd5e1}.hub-mid-status.hub-mid-ok{color:#86efac}.hub-mid-status.hub-mid-bad{color:#fca5a5}}' +
    'html.hondi-anon [data-requires-login]{opacity:.55;cursor:not-allowed}' +
    '#hondi-user-toast{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 24px);transform:translateX(-50%);z-index:2147482100;max-width:88vw;padding:11px 18px;border-radius:12px;background:#0f172a;color:#fff;font:600 15px/1.4 Pretendard,system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.3)}' +
    '@media print{#hondi-user-badge,#hondi-user-toast,#hondi-blocked-modal,#hondi-mailid-modal{display:none!important}}';

  var badge = null, menuOpen = false, lastSig = null, toastTimer = null, nameEdit = null;   // nameEdit: 보내는 이름을 고치는 중이면 { draft, msg, busy }

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
  function toast(msg, ms) {
    var t = doc.getElementById('hondi-user-toast');
    if (!t) { t = el('div'); t.id = 'hondi-user-toast'; t.setAttribute('role', 'status'); doc.body.appendChild(t); }
    t.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, ms || 3200);
  }
  function setMenu(open) {
    menuOpen = !!open;
    var m = badge && badge.querySelector('.hub-menu');
    var c = badge && badge.querySelector('.hub-chip');
    if (m) m.hidden = !menuOpen;
    if (c) c.setAttribute('aria-expanded', menuOpen ? 'true' : 'false');
  }

  // ── 아이콘(SVG는 createElementNS로 만든다) ────────────────────
  var SVG_NS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs) {
    var n = doc.createElementNS(SVG_NS, tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, attrs[k]);
    return n;
  }
  function dotsIcon() {                                      // 세로 점 세 개(⋮)
    var s = svgEl('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
    [5, 12, 19].forEach(function (cy) { s.appendChild(svgEl('circle', { cx: '12', cy: String(cy), r: '2' })); });
    return s;
  }
  function pencilIcon() {
    var s = svgEl('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
    s.appendChild(svgEl('path', { d: 'M12 20h9' }));
    s.appendChild(svgEl('path', { d: 'M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z' }));
    return s;
  }
  // 아이디 칩 오른쪽의 ⋮ — K-Mail 설정 페이지로 간다. K-Mail 화면 안이면 새로 읽지 않고 바로 연다.
  function settingsLink() {
    var a = el('a', 'hub-more');
    a.href = SETTINGS_URL; a.title = '설정'; a.setAttribute('aria-label', '설정');
    a.appendChild(dotsIcon());
    a.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (typeof global.kmailOpenSettings === 'function') { ev.preventDefault(); setMenu(false); global.kmailOpenSettings(); }
    });
    return a;
  }

  // ── 보내는 이름: 메뉴에서 눌러서 바로 고친다 ───────────────────
  function senderNameNow() { return String((mailInfo && mailInfo.sender_display_name) || ''); }
  function announceMailInfo() {                              // 같은 페이지의 설정 화면 등이 값을 맞추도록 알린다
    try { global.dispatchEvent(new CustomEvent('hondi-mail-info-change', { detail: { mail_id: (mailInfo && mailInfo.mail_id) || '', sender_display_name: senderNameNow() } })); } catch (e) {}
  }
  function saveSenderName(value) {
    var tok = readCookie(C_TOKEN);
    if (!tok || !nameEdit || nameEdit.busy) return;
    nameEdit.busy = true;
    postJson('/kmail/settings', { phone_verify_token: tok, sender_display_name: value }).then(function (x) {
      if (x.status === 200 && x.d && x.d.ok) {
        if (mailInfo) mailInfo.sender_display_name = value;
        nameEdit = null;
        toast(value ? '보내는 이름을 ' + value + '(으)로 바꿨습니다.' : '보내는 이름을 비웠습니다. 주소만 나갑니다.');
        render(true, true);
        announceMailInfo();
        return;
      }
      if (nameEdit) { nameEdit.busy = false; nameEdit.msg = (x.d && x.d.message) || '저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.'; }
      render(true, true);
    }, function () {
      if (nameEdit) { nameEdit.busy = false; nameEdit.msg = '저장하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.'; }
      render(true, true);
    });
  }
  function buildNameRow() {
    var row = el('div', 'hub-name');
    row.addEventListener('click', function (ev) { ev.stopPropagation(); });   // 이 줄 안의 클릭은 메뉴를 닫지 않는다
    row.appendChild(doc.createTextNode('보내는 이름'));
    if (!nameEdit) {
      var cur = senderNameNow();
      var b = el('button', 'hub-name-val' + (cur ? '' : ' hub-empty')); b.type = 'button';
      b.title = '눌러서 고치기';
      b.appendChild(el('span', '', cur || '(없음 — 주소만 나감)'));
      b.appendChild(pencilIcon());
      b.addEventListener('click', function (ev) { ev.stopPropagation(); nameEdit = { draft: cur, msg: '', busy: false }; render(true, true); });
      row.appendChild(b);
      return row;
    }
    var max = (mailInfo && mailInfo.sender_name_max) || 40;
    var wrap = el('div', 'hub-name-edit');
    var inp = el('input', 'hub-name-input'); inp.type = 'text'; inp.maxLength = max; inp.autocomplete = 'off'; inp.spellcheck = false;
    inp.placeholder = '예: 도 영민'; inp.setAttribute('aria-label', '보내는 이름'); inp.value = nameEdit.draft;
    var save = el('button', 'hub-btn hub-primary', '저장'); save.type = 'button';
    var cancel = el('button', 'hub-btn', '취소'); cancel.type = 'button';
    var msg = el('p', 'hub-name-msg', nameEdit.msg || ''); msg.setAttribute('aria-live', 'polite');
    function paint() {
      var r = checkSenderName(inp.value, max);
      if (!nameEdit.busy) msg.textContent = r.ok ? (nameEdit.msg || '') : r.msg;
      save.disabled = nameEdit.busy || !r.ok;
      cancel.disabled = nameEdit.busy; inp.disabled = nameEdit.busy;
    }
    function submit() {
      var r = checkSenderName(inp.value, max);
      if (!r.ok || nameEdit.busy) return;
      if (r.value === senderNameNow()) { nameEdit = null; render(true, true); return; }   // 바뀐 것이 없으면 그냥 닫는다
      nameEdit.draft = r.value; paint(); saveSenderName(r.value);
    }
    inp.addEventListener('input', function () { nameEdit.draft = inp.value; nameEdit.msg = ''; paint(); });
    inp.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); submit(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); if (!nameEdit.busy) { nameEdit = null; render(true, true); } }
    });
    save.addEventListener('click', function (ev) { ev.stopPropagation(); submit(); });
    cancel.addEventListener('click', function (ev) { ev.stopPropagation(); nameEdit = null; render(true, true); });
    wrap.appendChild(inp); wrap.appendChild(save); wrap.appendChild(cancel);
    row.appendChild(wrap); row.appendChild(msg);
    paint();
    return row;
  }

  function render(force, hard) {
    if (!doc.body) return;
    var id = identity();
    var sig = (id.loggedIn ? '1' : '0') + '|' + id.kind + '|' + id.label;
    if (!(id.loggedIn && id.kind === 'user' && id.source === 'cookie')) nameEdit = null;   // 로그아웃·계정 전환이면 고치던 이름은 버린다
    doc.documentElement.classList.toggle('hondi-anon', !id.loggedIn);
    doc.documentElement.setAttribute('data-hondi-auth', id.loggedIn ? 'in' : 'out');
    if (!force && sig === lastSig && badge && badge.isConnected) return;
    if (nameEdit && !hard && sig === lastSig && badge && badge.isConnected) return;   // 이름을 고치는 중에는 백그라운드 갱신이 입력칸을 지우지 않게 한다
    lastSig = sig;
    addStyle();
    mount();
    badge.className = (badge.className.indexOf('hub-fixed') >= 0 ? 'hub-fixed ' : '') + (id.loggedIn ? 'hub-in' : 'hub-out');
    while (badge.firstChild) badge.removeChild(badge.firstChild);

    var chip = el('button', 'hub-chip');
    chip.type = 'button';
    chip.setAttribute('aria-haspopup', 'true');
    chip.setAttribute('aria-expanded', 'false');
    chip.title = id.loggedIn ? id.label : '로그인하지 않았습니다';
    chip.appendChild(el('span', 'hub-dot'));
    chip.appendChild(el('span', 'hub-label', id.loggedIn ? id.label : '로그인 필요'));
    if (id.kind === 'test') chip.appendChild(el('span', 'hub-tag', testTagText()));
    chip.addEventListener('click', function (ev) { ev.stopPropagation(); setMenu(!menuOpen); if (menuOpen && id.kind === 'test') fetchQuota(true); });

    var menu = el('div', 'hub-menu');
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    if (id.loggedIn) {
      var p = el('div'); p.appendChild(el('b', '', id.label));              // 아이디만 보여 준다 — 메뉴가 열리면 로그인된 상태임을 알 수 있다
      menu.appendChild(p);
      if (id.kind === 'test') appendTestSection(menu);
      if (id.source === 'spa') {
        menu.appendChild(el('p', 'hub-note', '이 기기에 등록된 계정입니다. 계정 정보는 메인 앱의 설정에서 관리합니다.'));
      } else {
        if (id.kind === 'user') {
          if (mailInfo && mailInfo.address) menu.appendChild(el('p', 'hub-note', '내 메일 주소: ' + mailInfo.address));
          if (mailInfo && mailInfo.address) menu.appendChild(buildNameRow());   // 보내는 이름 — 눌러서 바로 고친다
          if (mailInfo && mailInfo.needs_choice) {                              // 아이디를 아직 안 정한 사람에게만 — 바꾸기는 설정 페이지(⋮)로 옮겼다
            var chg = el('button', 'hub-btn', '아이디 정하기'); chg.type = 'button';
            chg.addEventListener('click', function () { setMenu(false); fetchMailId(true).then(function () { openMailIdChooser({ first: true }); }); });
            menu.appendChild(chg);
          } else if (mailInfo && mailInfo.address) {
            menu.appendChild(el('p', 'hub-note', '아이디 바꾸기는 오른쪽 ⋮ 설정에서 할 수 있어요.'));
          }
        }
        var out = el('button', 'hub-btn', '로그아웃'); out.type = 'button';
        out.addEventListener('click', function () { setMenu(false); logout(); });
        menu.appendChild(out);
      }
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
    var rowBox = el('div', 'hub-row');
    rowBox.appendChild(chip);
    if (id.loggedIn && id.kind === 'user' && id.source === 'cookie') rowBox.appendChild(settingsLink());   // 아이디 오른쪽 ⋮ → 설정 페이지
    badge.appendChild(rowBox);
    badge.appendChild(menu);
    setMenu(menuOpen);                                // 사용량을 새로 받아 다시 그려도 열어 둔 메뉴는 닫지 않는다
    if (nameEdit && menuOpen) {                       // 이름을 고치는 중이면 입력칸에 커서를 돌려 준다
      var ni = badge.querySelector('.hub-name-input');
      if (ni && !ni.disabled) { ni.focus(); try { ni.setSelectionRange(ni.value.length, ni.value.length); } catch (e) {} }
    }
    if (id.kind === 'user' && id.source === 'cookie' && readCookie(C_MIG)) maybeMigrate();
    if (id.kind !== 'test') quota = null;
    else if (!quota) fetchQuota(false);          // 로그인 직후 사용량을 바로 가져온다(1분을 기다리지 않는다)
    if (id.kind === 'user' && id.source === 'cookie' && !mailInfo) fetchMailId(false);   // 메일 아이디(표시용·선택 화면용)
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
    version: '1.1',
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
    getQuota: function () { return quota; },
    getMailId: function () { return mailInfo && mailInfo.mail_id || ''; },
    reloadMailInfo: function () { return fetchMailId(true); },   // 설정 화면에서 아이디·이름을 바꾼 뒤 배지를 새로 맞춘다
    openMailIdChooser: function (o) { return fetchMailId(true).then(function () { openMailIdChooser(o || {}); }); },
    refresh: function () { render(true); },
  };

  // ── 시작 ─────────────────────────────────────────────────────
  function start() {
    render(true);
    fetchQuota(true);
    setInterval(function () { fetchQuota(false); }, 60000);
    ensureKAuth();                                    // 테스트 기간 자동 입장·로그인 창을 위해 공용 모듈을 함께 불러온다
    global.addEventListener('hondi-auth-change', function () { render(); });
    global.addEventListener('hondi-test-quota', function (ev) {
      var code = ev && ev.detail && ev.detail.code;
      if (code === 'TEST_ACCOUNT_MIGRATED') {                       // 다른 기기에서 이미 정식 아이디로 옮긴 테스트 아이디
        toast('이 테스트 아이디의 데이터는 정식 아이디로 이동했습니다. 정식 아이디로 로그인해 주세요.', 9000);
        try { global.localStorage.setItem('hondi_test_optout', '1'); global.localStorage.removeItem('hondi_test_id'); } catch (e) {}
        if (global.KAuth) global.KAuth.logout(); else { clearCookie(C_TOKEN); clearCookie(C_EXP); }
        render(true);
      } else { fetchQuota(true); }
    });
    doc.addEventListener('visibilitychange', function () { if (!doc.hidden) render(); });
    setInterval(function () { render(); }, 2000);     // 다른 탭·다른 서브도메인에서 바뀐 쿠키 반영
  }
  if (doc.body) start(); else doc.addEventListener('DOMContentLoaded', start);
})(window);
