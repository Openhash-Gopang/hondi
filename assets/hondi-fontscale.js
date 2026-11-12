/* assets/hondi-fontscale.js — 나비 글자 크기(2026-11-12, 주피터 지시)
 * 사용자가 설정에서 고른 글자 크기를 CSS 변수 --hondi-fs 로 적용한다. 화면의 글자 크기는
 * calc(Nrem * var(--hondi-fs,1)) 이라, 폰·크롬의 글꼴 크기 설정(rem)과 이 값이 곱해져 적용된다.
 * 처음 그리기 전에 적용하도록 <head> 에서 일반 스크립트로 불러온다. 저장은 이 기기의 localStorage 뿐이다. */
(function () {
  var KEY = 'hondi_font_scale', DEFAULT = 110, STEPS = [100, 110, 125, 145];
  function get() { try { var v = parseInt(localStorage.getItem(KEY), 10); return STEPS.indexOf(v) >= 0 ? v : DEFAULT; } catch (e) { return DEFAULT; } }
  function apply(p) { document.documentElement.style.setProperty('--hondi-fs', String(p / 100)); }
  function sync() {
    var c = get();
    var els = document.querySelectorAll('[data-fs]');
    for (var i = 0; i < els.length; i++) els[i].classList.toggle('is-selected', Number(els[i].getAttribute('data-fs')) === c);
  }
  window.getHondiFontScale = get;
  window.syncHondiFontScale = sync;
  window.setHondiFontScale = function (p) { try { localStorage.setItem(KEY, String(p)); } catch (e) {} apply(get()); sync(); };
  apply(get());
  window.addEventListener('storage', function (e) { if (e.key === KEY) { apply(get()); sync(); } });
})();
