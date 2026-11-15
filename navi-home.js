/*! navi-home.js — 모든 나비웹 페이지의 나비 로고는 메인 탭(나만의 AI 비서)을 맨 앞으로 부른다. (2026-11-16, 주피터 지시)
 *  - 일반 스크립트(모듈 아님): 어느 저장소·도메인의 페이지에서나 <script src="https://app.naviweb.kr/navi-home.js" defer></script> 한 줄로 쓴다.
 *  - 메인 탭 = 창 이름이 'naviweb-main'인 탭. 로고를 누르면:
 *      ① window.open('', 'naviweb-main') — 이미 열린 메인 탭이 있으면 주소를 바꾸지 않고(새로고침 없이) 그 창을 돌려받아 focus() 한다.
 *      ② 없으면 빈 창이 새로 열리므로 메인 주소로 이동시킨다. 새 창은 정의상 맨 앞에 뜬다.
 *      ③ 두 메인이 생기면(서로 연결되지 않은 창) 나중에 열린 쪽이 BroadcastChannel 로 알려, 먼저 열린 쪽은 "다른 창에서 열렸습니다" 상태가 된다.
 *         → 사용자가 로고를 누르면 항상 "방금 맨 앞에 뜬 창"이 유일한 활성 메인이다.
 */
(function (g) {
  'use strict';
  var MAIN_WINDOW = 'naviweb-main', MAIN_URL = 'https://app.naviweb.kr/webapp', CH = 'naviweb-main-channel';
  var uid = Math.random().toString(36).slice(2), bc = null;
  function channel() { if (bc || typeof g.BroadcastChannel !== 'function') return bc; try { bc = new g.BroadcastChannel(CH); } catch (e) { bc = null; } return bc; }
  function isMainTab() { try { return g.name === MAIN_WINDOW; } catch (e) { return false; } }
  function markMainTab() { try { g.name = MAIN_WINDOW; } catch (e) {} }
  function markCallTab() { try { g.name = 'naviweb-call-' + uid; } catch (e) {} }

  // 사용자 동작(클릭) 안에서 동기로 호출해야 팝업 차단을 피한다.
  function openMain() {
    try { var c = channel(); if (c) c.postMessage({ t: 'summon', id: uid }); } catch (e) {}
    var w = null, blank = false;
    try { w = g.open('', MAIN_WINDOW); } catch (e) { w = null; }
    if (w) {
      try { blank = (w.location.href === 'about:blank'); } catch (e) { blank = false; }   // 다른 출처의 기존 메인 창이면 읽을 수 없다 = 이미 열려 있음
      if (blank) { try { w.location.replace(MAIN_URL); } catch (e) {} }
      try { w.focus(); } catch (e) {}
      return w;
    }
    try { g.location.href = MAIN_URL; } catch (e) {}   // 팝업이 막히면 이 탭에서 이동
    return null;
  }

  // 메인 탭이 부른다: 다른 메인 창이 나중에 열리면 onPassive(), 누가 부르면 focus.
  function watchMain(onPassive) {
    var c = channel(); if (!c) return;
    c.onmessage = function (ev) {
      var d = ev && ev.data; if (!d || d.id === uid) return;
      if (d.t === 'main-up' && typeof onPassive === 'function') onPassive();
      else if (d.t === 'summon') { try { g.focus(); } catch (e) {} }
    };
    try { c.postMessage({ t: 'main-up', id: uid }); } catch (e) {}
  }


  // ── 열린 나비웹 탭 목록 (2026-11-16) ─────────────────────────────────
  // 메인 탭 밖의 탭(전문가·기관·친구 대화창)이 4초마다 자기 정보를 알리고, 메인 탭이 모아 목록으로 보여 준다.
  // BroadcastChannel 은 같은 출처(app.naviweb.kr)·같은 브라우저에서만 닿는다 — 다른 도메인 페이지는 목록에 나오지 않는다.
  var TABS_CH = 'naviweb-tabs', BEAT_MS = 4000, STALE_MS = 11000;
  var tbc = null, tabInfo = { kind: '', label: '' }, tabMap = {}, tabListener = null, beatTimer = null;
  function tabsChannel() { if (tbc || typeof g.BroadcastChannel !== 'function') return tbc; try { tbc = new g.BroadcastChannel(TABS_CH); } catch (e) { tbc = null; } return tbc; }
  function guessKind() {
    var p = (g.location && g.location.pathname) || '';
    if (/expert-chat/.test(p)) return 'expert';
    if (/regional-gov/.test(p)) return 'institution';
    if (/^naviweb-call/.test(g.name || '')) return 'friend';
    return 'service';
  }
  function setTabInfo(o) { if (!o) return; if (o.kind) tabInfo.kind = o.kind; if (o.label) tabInfo.label = String(o.label).slice(0, 40); }
  function selfTab() {
    var t = (g.document && g.document.title) || '';
    return { id: uid, name: g.name, kind: tabInfo.kind || guessKind(), label: tabInfo.label || t.replace(/\s*[|·-]\s*나비웹.*$/, '') || '나비웹', ts: Date.now() };
  }
  function beat() { var c = tabsChannel(); if (c) try { c.postMessage({ t: 'hello', tab: selfTab() }); } catch (e) {} }
  // 메인 탭이 아닌 탭은 자신을 알린다.
  function registerTab(opts) {
    setTabInfo(opts);
    try { if (g.self !== g.top) return; } catch (e) { return; }
    if (isMainTab()) return;
    try { if (!g.name) g.name = 'naviweb-tab-' + uid; } catch (e) {}   // 이름이 있어야 메인이 window.open('', 이름)으로 다시 찾는다
    var c = tabsChannel(); if (!c || beatTimer) return;
    c.addEventListener('message', function (ev) {
      var d = ev && ev.data; if (!d) return;
      if (d.t === 'ping') beat();
      else if (d.t === 'goto' && d.to === uid) { try { g.focus(); } catch (e) {} }
    });
    beat(); beatTimer = setInterval(beat, BEAT_MS);
    g.addEventListener('pagehide', function () { try { c.postMessage({ t: 'bye', id: uid }); } catch (e) {} });
    g.document.addEventListener('visibilitychange', function () { if (!g.document.hidden) beat(); });
  }
  function pruneTabs() { var now = Date.now(); Object.keys(tabMap).forEach(function (k) { if (now - tabMap[k].seen > STALE_MS) delete tabMap[k]; }); }
  function listTabs() { pruneTabs(); return Object.keys(tabMap).map(function (k) { return tabMap[k]; }).sort(function (a, b) { return b.seen - a.seen; }); }
  // 메인 탭이 부른다: 탭 목록이 바뀔 때마다 fn(목록)을 호출한다. 해제 함수를 돌려준다.
  function watchTabs(fn) {
    var c = tabsChannel(); if (!c) return function () {};
    tabListener = fn;
    c.addEventListener('message', function (ev) {
      var d = ev && ev.data; if (!d) return;
      if (d.t === 'hello' && d.tab && d.tab.id !== uid) { var t = d.tab; t.seen = Date.now(); tabMap[t.id] = t; fn(listTabs()); }
      else if (d.t === 'bye' && tabMap[d.id]) { delete tabMap[d.id]; fn(listTabs()); }
    });
    try { c.postMessage({ t: 'ping' }); } catch (e) {}
    setInterval(function () { var n = Object.keys(tabMap).length; pruneTabs(); if (Object.keys(tabMap).length !== n) fn(listTabs()); }, BEAT_MS);
    return function () { tabListener = null; };
  }
  // 사용자 동작(클릭) 안에서 동기로 호출한다. 돌려주는 값: true = 이동을 시도함.
  function gotoTab(tab) {
    if (!tab) return false;
    var c = tabsChannel(); try { if (c) c.postMessage({ t: 'goto', to: tab.id }); } catch (e) {}
    try { var w = g.open('', tab.name); if (w) { try { if (w.location.href === 'about:blank') { w.close(); return false; } } catch (e) {} w.focus(); } } catch (e) {}
    return true;
  }

  function flutter(el) { try { el.classList.remove('navi-flutter'); void el.offsetWidth; el.classList.add('navi-flutter'); setTimeout(function () { el.classList.remove('navi-flutter'); }, 900); } catch (e) {} }

  var CSS = '#navi-home-logo{position:fixed;top:8px;left:8px;z-index:2147483000;width:40px;height:40px;padding:0;border:0;border-radius:50%;background:rgba(255,255,255,.92);box-shadow:0 1px 6px rgba(0,0,0,.25);cursor:pointer;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent}' +
    '#navi-home-logo img{width:30px;height:30px;pointer-events:none}#navi-home-logo.navi-flutter img{animation:navi-home-flutter .8s ease-in-out}' +
    '@keyframes navi-home-flutter{0%{transform:scaleX(1) rotate(0)}15%{transform:scaleX(.45) rotate(-12deg)}30%{transform:scaleX(1.1) rotate(10deg)}45%{transform:scaleX(.5) rotate(-8deg)}60%{transform:scaleX(1.08) rotate(6deg)}80%{transform:scaleX(.8) rotate(-3deg)}100%{transform:scaleX(1) rotate(0)}}' +
    'html.embed #navi-home-logo{display:none}';
  function mountLogo() {
    var d = g.document; if (!d || d.getElementById('navi-home-logo') || d.getElementById('ai-panel-logo')) return;
    var st = d.createElement('style'); st.textContent = CSS; d.head.appendChild(st);
    var b = d.createElement('button'); b.id = 'navi-home-logo'; b.type = 'button'; b.title = '나만의 AI 비서(메인)로 가기'; b.setAttribute('aria-label', '나만의 AI 비서로 가기');
    b.innerHTML = '<img src="https://app.naviweb.kr/icons/navi-icon-192.png" alt="">';
    b.onclick = function () { flutter(b); openMain(); };
    d.body.appendChild(b);
  }
  function init() {
    try { if (g.self !== g.top) return; } catch (e) { return; }   // 다른 페이지 안에 끼워 넣은 화면(iframe)은 탭이 아니다 — 로고도 탭 등록도 하지 않는다
    var d = g.document; if (!d || (d.documentElement && d.documentElement.hasAttribute('data-navi-home-off'))) return;
    if (d.body) mountLogo(); else d.addEventListener('DOMContentLoaded', mountLogo);
    if (!isMainTab() && !d.getElementById('ai-panel-logo')) registerTab();
  }

  var api = { MAIN_WINDOW: MAIN_WINDOW, MAIN_URL: MAIN_URL, isMainTab: isMainTab, markMainTab: markMainTab, markCallTab: markCallTab, openMain: openMain, registerTab: registerTab, setTabInfo: setTabInfo, watchTabs: watchTabs, listTabs: listTabs, gotoTab: gotoTab, watchMain: watchMain, flutter: flutter, mountLogo: mountLogo, init: init };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  g.NaviHome = api; init();
})(typeof window !== 'undefined' ? window : globalThis);
