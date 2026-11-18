/**
 * pwa/install-gate.js — 폰 브라우저 탭에서는 앱(PWA) 설치를 먼저 요구한다 (2026-11-18, 주피터 지시).
 * 알림(호출·초대)을 PWA 기준으로 일원화하기 위한 잠정 조치다. 대상은 폰의 브라우저 탭에서 로그인한 뒤의 webapp.html 뿐이다.
 *  - PC, 설치된 PWA 창, 공개 페이지(install·매뉴얼 등), 로그인·가입 전 화면은 영향 없음
 *  - 유예 없음(2026-11-19부터 설치 필수). 개발·시험은 주소 끝에 ?dev=1
 * 설치 여부는 크롬이 알려 주지 않으므로(navi_pwa_last_standalone 기록으로만 추정) "이미 설치했다면 바탕화면 아이콘으로 여세요"를 함께 안내한다.
 */
(function () {
  var ua = navigator.userAgent || '';
  var isMobile = /Android|iPhone|iPad|iPod/i.test(ua);
  var standalone = false;
  try { standalone = window.matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)').matches || navigator.standalone === true; } catch (e) {}
  try { if (/[?&]dev=1\b/.test(location.search)) sessionStorage.setItem('navi_gate_skip', '1'); } catch (e) {}
  var skipped = false;
  try { skipped = sessionStorage.getItem('navi_gate_skip') === '1'; } catch (e) {}
  if (!isMobile || standalone || skipped) return;

  var isIOS = /iPhone|iPad|iPod/i.test(ua);
  var inApp = /KAKAOTALK|NAVER\(|FBAN|FBAV|Instagram|Line\/|DaumApps|; wv\)/i.test(ua);
  var installedBefore = false;
  try { installedBefore = Number(localStorage.getItem('navi_pwa_last_standalone')) > 0; } catch (e) {}
  var canSkip = false;   // 2026-11-19(주피터 지시): 설치는 필수 — 유예와 "이번만 브라우저로 계속"을 없앴다(개발·시험은 ?dev=1)

  var st = document.createElement('style');
  st.textContent = '#navi-pwa-gate{display:none;position:fixed;inset:0;z-index:2147483000;background:#5C6BC0;color:#fff;align-items:center;justify-content:center;padding:24px;text-align:center}' +
    'html.navi-need-pwa body.gopang-authed #navi-pwa-gate{display:flex}' +
    '#navi-pwa-gate .g-box{max-width:340px;width:100%}' +
    '#navi-pwa-gate h1{font-size:1.35rem;margin:0 0 12px}' +
    '#navi-pwa-gate p{font-size:1rem;line-height:1.6;margin:0 0 14px}' +
    '#navi-pwa-gate .g-btn{display:block;width:100%;padding:14px;border:0;border-radius:12px;background:#FFD54F;color:#3B2F00;font-size:1.05rem;font-weight:700;margin:0 0 12px;cursor:pointer;text-decoration:none}' +
    '#navi-pwa-gate .g-steps{background:rgba(255,255,255,.15);border-radius:12px;padding:12px 14px;text-align:left;font-size:.95rem;line-height:1.6;margin:0 0 14px}' +
    '#navi-pwa-gate .g-hint{font-size:.9rem;opacity:.95}' +
    '#navi-pwa-gate .g-skip{display:inline-block;margin-top:10px;color:#fff;opacity:.85;font-size:.85rem;text-decoration:underline;background:none;border:0;cursor:pointer}';
  document.head.appendChild(st);
  document.documentElement.classList.add('navi-need-pwa');

  function build() {
    if (document.getElementById('navi-pwa-gate')) return;
    var el = document.createElement('div');
    el.id = 'navi-pwa-gate';
    var h = '<div class="g-box"><h1>나비는 앱으로 사용합니다</h1>' +
      '<p>대화 호출과 알림이 화면이 꺼져 있어도 소리와 함께 도착하려면 바탕화면에 나비 앱을 설치해야 합니다.</p>';
    if (inApp) {
      h += '<p>지금은 다른 앱 안의 브라우저입니다. ' + (isIOS ? 'Safari' : 'Chrome') + '에서 열어 설치해 주세요.</p>';
      if (!isIOS) h += '<a class="g-btn" href="intent://naviweb.kr/webapp.html#Intent;scheme=https;package=com.android.chrome;end">Chrome으로 열기</a>';
      else h += '<div class="g-steps">오른쪽 아래(또는 위) 메뉴에서 <b>Safari로 열기</b>를 누르세요.</div>';
    } else if (isIOS) {
      h += '<div class="g-steps">① Safari 아래의 <b>공유</b> 버튼<br>② <b>홈 화면에 추가</b><br>③ 바탕화면의 나비 아이콘으로 열기</div>';
    } else {
      h += '<button class="g-btn" id="navi-gate-install">나비 앱 설치</button>' +
        '<div class="g-steps" id="navi-gate-manual" style="display:none">설치 창이 뜨지 않으면 Chrome 메뉴(⋮) → <b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 누르세요.</div>';
    }
    h += '<p class="g-hint" id="navi-gate-hint">' + (installedBefore ? '<b>이미 설치했다면 바탕화면의 나비 아이콘으로 여세요.</b>' : '설치한 뒤에는 바탕화면의 나비 아이콘으로 여세요.') + '</p>';
    if (canSkip) h += '<button class="g-skip" id="navi-gate-skip">이번만 브라우저로 계속 (알림이 늦거나 소리가 없을 수 있습니다)</button>';
    h += '</div>';
    el.innerHTML = h;
    document.body.appendChild(el);

    var ib = document.getElementById('navi-gate-install');
    if (ib) ib.onclick = function () {
      var p = typeof window.installPWAWithPermission === 'function' ? window.installPWAWithPermission() : null;
      var m = document.getElementById('navi-gate-manual'); if (m) m.style.display = 'block';
      return p;
    };
    var sk = document.getElementById('navi-gate-skip');
    if (sk) sk.onclick = function () {
      try { sessionStorage.setItem('navi_gate_skip', '1'); } catch (e) {}
      document.documentElement.classList.remove('navi-need-pwa');
    };
    window.addEventListener('gopang:pwa-install-done', function () {
      var hint = document.getElementById('navi-gate-hint');
      if (hint) hint.innerHTML = '<b>설치됐습니다. 이제 바탕화면의 나비 아이콘으로 열어 주세요.</b>';
      if (ib) ib.style.display = 'none';
    });
  }
  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})();
