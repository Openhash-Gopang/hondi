/**
 * ui/navi-home.js — 모든 탭의 나비 로고는 "메인 탭"(나만의 AI 비서)을 부른다(2026-11-16, 주피터 지시).
 * 메인 탭이 열려 있으면 그 탭을 앞으로 가져오고, 닫혀 있으면 새로 연다. 이름 붙은 창(naviweb-main)으로 열기 때문에
 * 같은 브라우저 안에서 같은 탭이 재사용된다(탭은 window.open 으로 열려 같은 그룹에 속한다).
 * 이 모듈은 불러오면 스스로 동작한다: 메인 화면(#ai-panel-logo 있음)이면 창 이름만 붙이고, 그 밖의 페이지는 좌상단에 로고를 단다.
 */
export const MAIN_WINDOW = 'naviweb-main';
export const MAIN_URL = 'https://app.naviweb.kr/webapp';

/** 이 탭이 메인 탭인지: 창 이름으로 판단한다. */
export function isMainTab() { try { return window.name === MAIN_WINDOW; } catch { return false; } }
export function markMainTab() { try { window.name = MAIN_WINDOW; } catch {} }
export function markCallTab() { try { window.name = 'naviweb-call'; } catch {} }

/** 메인 탭을 부른다. 클릭(사용자 동작) 안에서 동기로 호출해야 팝업 차단을 피한다. */
export function openMain() {
  let w = null;
  try { w = window.open(MAIN_URL, MAIN_WINDOW); } catch {}
  try { if (w && typeof w.focus === 'function') w.focus(); } catch {}
  return w;
}

export function flutter(el) {
  try { el.classList.remove('navi-flutter'); void el.offsetWidth; el.classList.add('navi-flutter'); setTimeout(() => el.classList.remove('navi-flutter'), 900); } catch {}
}

const _CSS = `#navi-home-logo{position:fixed;top:8px;left:8px;z-index:2147483000;width:40px;height:40px;padding:0;border:0;border-radius:50%;
background:rgba(255,255,255,.92);box-shadow:0 1px 6px rgba(0,0,0,.25);cursor:pointer;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent}
#navi-home-logo img{width:30px;height:30px;pointer-events:none}
#navi-home-logo.navi-flutter img{animation:navi-home-flutter .8s ease-in-out}
@keyframes navi-home-flutter{0%{transform:scaleX(1) rotate(0)}15%{transform:scaleX(.45) rotate(-12deg)}30%{transform:scaleX(1.1) rotate(10deg)}45%{transform:scaleX(.5) rotate(-8deg)}60%{transform:scaleX(1.08) rotate(6deg)}80%{transform:scaleX(.8) rotate(-3deg)}100%{transform:scaleX(1) rotate(0)}}
html.embed #navi-home-logo{display:none}`;

export function mountNaviLogo() {
  if (typeof document === 'undefined' || document.getElementById('navi-home-logo')) return;
  const st = document.createElement('style'); st.textContent = _CSS; document.head.appendChild(st);
  const b = document.createElement('button');
  b.id = 'navi-home-logo'; b.type = 'button'; b.title = '나만의 AI 비서(메인)로 가기'; b.setAttribute('aria-label', '나만의 AI 비서로 가기');
  b.innerHTML = '<img src="https://app.naviweb.kr/icons/navi-icon-192.png" alt="">';
  b.onclick = () => { flutter(b); openMain(); };
  document.body.appendChild(b);
}

export function initNaviHome() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('ai-panel-logo')) return;   // 메인(webapp) 화면은 자체 로고를 쓴다
  const go = () => mountNaviLogo();
  if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
}
initNaviHome();
