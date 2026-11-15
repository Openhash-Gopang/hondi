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
  function markCallTab() { try { g.name = 'naviweb-call'; } catch (e) {} }

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
    var d = g.document; if (!d || (d.documentElement && d.documentElement.hasAttribute('data-navi-home-off'))) return;
    if (d.body) mountLogo(); else d.addEventListener('DOMContentLoaded', mountLogo);
  }

  var api = { MAIN_WINDOW: MAIN_WINDOW, MAIN_URL: MAIN_URL, isMainTab: isMainTab, markMainTab: markMainTab, markCallTab: markCallTab, openMain: openMain, watchMain: watchMain, flutter: flutter, mountLogo: mountLogo, init: init };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  g.NaviHome = api; init();
})(typeof window !== 'undefined' ? window : globalThis);
