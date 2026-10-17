/* ══════════════════════════════════════════════════════════════════
   manual-banner.js — 「나비 매뉴얼」 안내 배너 (2026-10-18 신설, 주피터 지시)

   목적: 처음 오신 분이 나비 사용 방법을 담은 매뉴얼(PDF)을 바로 찾도록 페이지
   맨 위에 배너를 한 줄 띄운다. 배너 안의 「다시 보지 않기 (X)」를 누르면 이
   브라우저에서는 어느 페이지에서도 다시 나타나지 않는다(localStorage 한 곳에만
   저장하며, 서버에는 아무것도 보내지 않는다. 저장소를 못 쓰는 환경에서는 이번
   탭에서만 숨긴다).

   적용 범위(1단계): 전문가 페르소나 페이지 — assets/ph-header.js 가
   PAGE_HEADER.active === 'expert-personas' 인 페이지에서 이 파일을 불러온다.
   페이지가 PAGE_HEADER.manualBanner = false 로 끌 수 있다.
   다른 페이지로 넓힐 때는 이 파일을 고치지 않고, 그 페이지에서 이 파일을
   <script src="/assets/manual-banner.js"></script> 로 불러오면 된다.

   표시하지 않는 경우: 이미 숨김을 눌렀을 때 / iframe 안일 때 /
   /pages/<이름>.html 로 직접 열린 페이지가 아닐 때(오버레이 등에서 이중으로 뜨는 것을 막는다).
   ══════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var MANUAL_URL = 'https://hondi.net/assets/presentations/navi-user-manual-20261016.pdf';
  var STORE_KEY = 'hondi_manual_banner_hidden_v1';
  var STYLE_ID = 'nmb-style';
  var TEXT = '나비를 처음 쓰시나요? 나비 매뉴얼에서 사용 방법을 확인하세요.';
  var LINK_LABEL = '나비 매뉴얼 보기 (PDF)';
  var CLOSE_LABEL = '다시 보지 않기 (X)';

  var CSS = [
    '.nmb-banner{background:#0c6cc3;color:#fff;font-family:Pretendard,-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;border-bottom:1px solid #0a5aa3}',
    '.nmb-inner{max-width:1160px;margin:0 auto;padding:9px 24px;display:flex;align-items:center;justify-content:center;gap:10px 14px;flex-wrap:wrap}',
    '.nmb-text{margin:0;font-size:13.5px;font-weight:600;line-height:1.5;word-break:keep-all}',
    '.nmb-link{display:inline-block;padding:5px 12px;border-radius:6px;background:#fff;color:#0c6cc3;font-size:13px;font-weight:700;text-decoration:none;white-space:nowrap}',
    '.nmb-link:hover{background:#e8f1fb}',
    '.nmb-link:focus-visible,.nmb-close:focus-visible{outline:2px solid #fff;outline-offset:2px}',
    '.nmb-close{padding:4px 6px;border:none;background:transparent;color:#d6e7fa;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap}',
    '.nmb-close:hover{color:#fff;text-decoration:underline}',
    '@media (max-width:680px){.nmb-inner{padding:9px 16px}}',
    '@media print{.nmb-banner{display:none}}'
  ].join('\n');

  var memHidden = false;   // 저장소 접근이 막힌 환경(시크릿 창 등)에서는 이번 탭에서만 유지

  function isHidden(storage) {
    try { return (storage && storage.getItem(STORE_KEY) === '1') || memHidden; }
    catch (e) { return memHidden; }
  }

  function setHidden(storage, hidden) {
    memHidden = !!hidden;
    try {
      if (!storage) return;
      if (hidden) storage.setItem(STORE_KEY, '1'); else storage.removeItem(STORE_KEY);
    } catch (e) { /* 저장 불가 — 메모리 값으로만 유지 */ }
  }

  // 배너를 띄울 곳인가: 최상위 창, /pages/<이름>.html 로 직접 열린 페이지, 숨김 선택이 없을 때만.
  function shouldShow(win, storage) {
    if (!win || !win.location) return false;
    if (win.top !== win.self) return false;
    if (!/\/pages\/[A-Za-z0-9_-]+\.html$/.test(String(win.location.pathname || ''))) return false;
    return !isHidden(storage);
  }

  function buildBanner(doc, onClose) {
    var wrap = doc.createElement('div');
    wrap.className = 'nmb-banner';
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', '나비 매뉴얼 안내');

    var inner = doc.createElement('div');
    inner.className = 'nmb-inner';

    var p = doc.createElement('p');
    p.className = 'nmb-text';
    p.textContent = '\uD83D\uDCD8 ' + TEXT;

    var a = doc.createElement('a');
    a.className = 'nmb-link';
    a.href = MANUAL_URL;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = LINK_LABEL;

    var x = doc.createElement('button');
    x.type = 'button';
    x.className = 'nmb-close';
    x.setAttribute('aria-label', '나비 매뉴얼 안내를 다시 보지 않기');
    x.textContent = CLOSE_LABEL;
    x.addEventListener('click', function () {
      if (onClose) onClose();
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    });

    inner.appendChild(p);
    inner.appendChild(a);
    inner.appendChild(x);
    wrap.appendChild(inner);
    return wrap;
  }

  function injectStyle(doc) {
    if (doc.getElementById(STYLE_ID)) return;
    var st = doc.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(st);
  }

  function storageOf(win) {
    try { return win.localStorage; } catch (e) { return null; }
  }

  function mount(win) {
    var doc = win.document;
    var storage = storageOf(win);
    if (!shouldShow(win, storage)) return null;
    if (doc.querySelector('.nmb-banner')) return null;   // 두 번 불러와도 한 번만 표시
    injectStyle(doc);
    var el = buildBanner(doc, function () { setHidden(storage, true); });
    doc.body.insertBefore(el, doc.body.firstChild);
    return el;
  }

  var api = {
    MANUAL_URL: MANUAL_URL, STORE_KEY: STORE_KEY, TEXT: TEXT, LINK_LABEL: LINK_LABEL, CLOSE_LABEL: CLOSE_LABEL,
    isHidden: isHidden, setHidden: setHidden, shouldShow: shouldShow, buildBanner: buildBanner, mount: mount
  };

  root.HondiManualBanner = api;                       // 디버깅·테스트용(화면 동작에는 쓰이지 않음)
  if (!root.document) return;                         // node 테스트처럼 문서가 없는 환경에서는 기능만 노출

  function run() { mount(root); }
  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', run);
  else run();
})(typeof window !== 'undefined' ? window : globalThis);
