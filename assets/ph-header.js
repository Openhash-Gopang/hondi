/* ══════════════════════════════════════════════════════════════════
   ph-header.js — 혼디 "4대 메뉴" 공용 헤더 스크립트 (단일 소스)

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

  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function renderNav(activeKey) {
    var links = NAV_ITEMS.map(function (item) {
      var cls = item.key === activeKey ? ' class="active"' : '';
      return '<a href="' + item.href + '"' + cls + '>' + escapeHtml(item.label) + '</a>';
    }).join('');
    return (
      '<nav class="topnav">' +
        '<div class="topnav-inner">' +
          '<a href="/desktop.html" class="topnav-logo" onclick="return __hondiBack(event);"><span class="topnav-logo-icon">H</span>혼디</a>' +
          '<div class="topnav-links">' + links + '</div>' +
          '<div class="topnav-right">' +
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

    var html = renderNav(config.active) + renderSubnav(config.subnav) + renderHero(config);

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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
