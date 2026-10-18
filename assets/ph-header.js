/* ══════════════════════════════════════════════════════════════════
   ph-header.js — 나비 "4대 메뉴" 공용 헤더 스크립트 (단일 소스)

   대상 페이지(4개, desktop.html 히어로 상단 4개 버튼과 1:1 대응):
     - pages/k-services.html
     - pages/expert-personas.html
     - pages/k-government.html
     - pages/prompts.html

   전문가 페르소나 페이지가 2026-09-04에 plan.hondi.net 스타일로
   하드코딩했던 topnav+hero 마크업을 그 원형으로 삼아, 이 4개 페이지가
   공유하는 단일 모듈로 추출했다(2026-09-06, 주피터님 지시).
   ※ /assets/site-header.js(다른 19개 페이지가 쓰는 기존 공용 모듈)와는
     별개의 모듈이다 — 이 4개 페이지만 이 모듈을 쓴다.

   사용법 — 각 페이지의 <body> 시작 부분에 다음을 넣으면 됩니다:

     <script>
       window.PAGE_HEADER = {
         active: 'k-services',   // 'k-services' | 'expert-personas' | 'k-government' | 'prompts'
         badge: '배지 문구',
         h1: '제목(줄바꿈은 <br> 직접 포함 가능)',
         instruction: '굵게 강조할 안내 문장(선택)',
         sub: '설명 문단(선택, html 허용)',
         extraHtml: '<div class="pp-explainer">...</div>',  // 히어로(어두운 배경) 안에 그대로 넣을 페이지 전용 콘텐츠(선택)
         disclaimer: true,                  // 히어로 바로 아래에 면책 안내 띠를 표시(선택). true면 아래 DEFAULT_DISCLAIMER, 문자열이면 그 문구(텍스트로만 취급)
         disclaimerDismissKey: 'my-page',   // 선택(2026-10-17 신설, 기본은 꺼짐) — 문자열을 주면 띠 오른쪽에 「다시 보지 않기 ✕」가 생기고, 누르면 이 브라우저(localStorage)에서 다시 표시하지 않는다
         subnav: [                          // 보조 탭 줄(선택) — 프롬프트 페이지 전용
           { label: '프롬프트', href: 'prompts.html', active: true },
           { label: 'SP의 계층 구조', href: 'sp-hierarchy.html' }
         ]
       };
     </script>
     <link rel="stylesheet" href="/assets/ph-header.css">
     <script src="/assets/ph-header.js"></script>

   내비게이션 메뉴 항목 자체(K-서비스/전문가 페르소나/... 등)를 바꾸려면
   이 파일의 NAV_HTML만 고치면 됩니다 — 4개 페이지를 하나씩 고칠 필요가
   없습니다.
   ══════════════════════════════════════════════════════════════════ */

(function () {

  var NAV_ITEMS = [
    { key: 'k-services',      label: 'K-서비스',       href: '/pages/k-services.html' },
    { key: 'expert-personas', label: '전문가 페르소나', href: '/pages/expert-personas.html' },
    { key: 'k-government',    label: 'K-정부',          href: '/pages/k-government.html' },
    { key: 'prompts',         label: '프롬프트',        href: '/pages/prompts.html' },
    { key: 'usage-guide',     label: '이용방법',        href: '/pages/usage-guide.html' },
    { key: 'ai-assistant',    label: 'AI 비서',         href: '/pages/ai-assistant.html' }
  ];

  // 보조 AI 면책 문구(단일 소스). 페이지가 PAGE_HEADER.disclaimer: true 로 켠다.
  var DEFAULT_DISCLAIMER = '관계 법령에 따라, 모든 보조 AI는 인간 전문가의 업무를 보조하며, 단독으로 기능하지 않는다.';

  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  // 2026-10-18(주피터 지시) — 헤더 오른쪽 여백의 행동 버튼(선택). PAGE_HEADER.rightButton = { label, href, title }.
  // href는 사이트 안 경로('/'로 시작)만 허용한다. 문구는 escapeHtml을 거친다.
  function renderCta(config) {
    var b = config && config.rightButton;
    if (!b || !b.label || typeof b.href !== 'string' || b.href.charAt(0) !== '/' || b.href.charAt(1) === '/') return '';
    return '<a class="topnav-cta" href="' + escapeHtml(b.href).replace(/"/g, '&quot;') + '"' + (b.title ? ' title="' + escapeHtml(b.title).replace(/"/g, '&quot;') + '"' : '') + '>' + escapeHtml(b.label) + '</a>';
  }
  function renderNav(activeKey, config) {
    var links = NAV_ITEMS.map(function (item) {
      var cls = item.key === activeKey ? ' class="active"' : '';
      return '<a href="' + item.href + '"' + cls + '>' + escapeHtml(item.label) + '</a>';
    }).join('');
    return (
      '<nav class="topnav">' +
        '<div class="topnav-inner">' +
          '<a href="/desktop.html" class="topnav-logo" onclick="return __hondiBack(event);"><img class="topnav-logo-icon" src="/icons/navi-icon-192.png" alt="" width="26" height="26">나비</a>' +
          '<div class="topnav-links">' + links + '</div>' +
          '<div class="topnav-right">' +
            renderCta(config) +
            '<div class="topnav-status"><span class="status-dot-green"></span>로그인 불필요 · 열람 전용</div>' +
          '</div>' +
        '</div>' +
      '</nav>'
    );
  }

  function renderSubnav(subnav) {
    if (!subnav || !subnav.length) return '';
    var links = subnav.map(function (item) {
      var cls = item.active ? ' class="active"' : '';
      return '<a href="' + item.href + '"' + cls + '>' + escapeHtml(item.label) + '</a>';
    }).join('');
    return '<div class="topsubnav"><div class="topsubnav-inner">' + links + '</div></div>';
  }

  function renderHero(config) {
    if (!config) return '';
    var html = '<div class="ph-hero"><div class="ph-hero-inner">';
    if (config.badge) {
      html += '<div class="ph-hero-tag"><span class="ph-hero-tag-dot"></span>' + escapeHtml(config.badge) + '</div>';
    }
    if (config.h1) {
      html += '<h1>' + config.h1 + '</h1>';
    }
    if (config.instruction) {
      html += '<p class="ph-hero-instruction">' + config.instruction + '</p>';
    }
    if (config.sub) {
      html += '<p>' + config.sub + '</p>';
    }
    if (config.extraHtml) {
      html += config.extraHtml;
    }
    html += '</div></div>';
    return html;
  }

  // 「다시 보지 않기」 선택 기록(localStorage). 저장소를 못 쓰는 환경(시크릿 창 등)에서는 기록 없이 동작한다.
  function dismissStoreKey(config) { return 'ph-disclaimer-dismissed:' + config.disclaimerDismissKey; }
  function isDismissed(config) {
    if (!config || typeof config.disclaimerDismissKey !== 'string' || !config.disclaimerDismissKey) return false;
    try { return localStorage.getItem(dismissStoreKey(config)) === '1'; } catch (e) { return false; }
  }

  // 히어로 바로 아래의 면책 안내 띠. 문구는 항상 escapeHtml을 거쳐 텍스트로만 넣는다.
  function renderDisclaimer(config) {
    if (!config || !config.disclaimer) return '';
    if (isDismissed(config)) return '';
    var text = (typeof config.disclaimer === 'string') ? config.disclaimer : DEFAULT_DISCLAIMER;
    var dismissible = typeof config.disclaimerDismissKey === 'string' && config.disclaimerDismissKey;
    return (
      '<div class="ph-disclaimer" role="note">' +
        '<div class="ph-disclaimer-inner">' +
          '<span class="ph-disclaimer-mark" aria-hidden="true">!</span>' +
          '<p>' + escapeHtml(text) + '</p>' +
          (dismissible ? '<button type="button" class="ph-disclaimer-x" aria-label="이 안내를 다시 보지 않기">다시 보지 않기 <span aria-hidden="true">&#10005;</span></button>' : '') +
        '</div>' +
      '</div>'
    );
  }

  // 오버레이(SPA) 안에서 열렸으면 오버레이를 닫고, 아니면(새 탭/직접 접속으로
  // 열렸으면) 그냥 href를 따라 /desktop.html로 실제 이동한다.
  window.__hondiBack = function (e) {
    if (typeof closeStandalone === 'function') {
      closeStandalone();
      if (e && e.preventDefault) e.preventDefault();
      return false;
    }
    return true;
  };

  // document.currentScript는 이 스크립트가 동기적으로 실행되는 바로 그 순간에만
  // 유효하므로 지금 잡아둔다. 실제 삽입은 이 스크립트 태그 자신이 놓인 위치를
  // 기준으로 하여, 오버레이 안이든 단독 페이지든 항상 올바른 곳에 삽입되게 한다.
  var THIS_SCRIPT = document.currentScript;

  function init() {
    var container = THIS_SCRIPT ? THIS_SCRIPT.parentNode : document.body;
    var config = window.PAGE_HEADER || {};

    var html = renderNav(config.active, config) + renderSubnav(config.subnav) + renderHero(config) + renderDisclaimer(config);

    var temp = document.createElement('div');
    temp.innerHTML = html;
    var nodes = Array.prototype.slice.call(temp.childNodes);
    nodes.forEach(function (node) {
      if (THIS_SCRIPT) {
        container.insertBefore(node, THIS_SCRIPT);
      } else {
        container.insertBefore(node, container.firstChild);
      }
    });
    nodes.forEach(function (node) {
      var x = node.querySelector && node.querySelector('.ph-disclaimer-x');
      if (!x) return;
      x.addEventListener('click', function () {
        try { localStorage.setItem(dismissStoreKey(config), '1'); } catch (e) {}
        if (node.parentNode) node.parentNode.removeChild(node);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

// 2026-10-15(주피터 지시) — 전문가 직역 페이지(/pages/<직역id>.html)에 "이용자가 알려 준 서식" 목록을 게시한다.
// 서류 목록을 모르는 직역은 이용자가 서식을 알려 주고, 그 서식이 이 페이지에 쌓여 다른 이용자가 쓴다(SP_DOC_FORM v1.2 §8).
// 페이지가 PAGE_HEADER.sharedForms: false 로 끌 수 있다.
(function () {
  var c = window.PAGE_HEADER || {};
  if (c.active !== 'expert-personas' || c.sharedForms === false) return;
  var m = location.pathname.match(/\/pages\/([a-z0-9-]+)\.html$/i);
  if (!m || ['expert-personas', 'expert-personas-docs', 'expert-chat'].indexOf(m[1]) >= 0) return;
  var s = document.createElement('script'); s.src = '/assets/expert-shared-forms.js'; document.body.appendChild(s);
})();

// 2026-10-18(주피터 지시) — 전문가 페르소나 페이지에 「나비 매뉴얼」 배너를 게시한다(assets/manual-banner.js).
// 배너의 「다시 보지 않기 (X)」를 누르면 이 브라우저에서 모든 페이지의 배너가 사라진다.
// 페이지가 PAGE_HEADER.manualBanner: false 로 끌 수 있다. 다른 페이지로 넓힐 때는 그 페이지에서
// /assets/manual-banner.js 를 직접 불러오면 된다(이 조건을 고칠 필요 없음).
(function () {
  var c = window.PAGE_HEADER || {};
  if (c.active !== 'expert-personas' || c.manualBanner === false) return;
  var s = document.createElement('script'); s.src = '/assets/manual-banner.js'; document.body.appendChild(s);
})();
