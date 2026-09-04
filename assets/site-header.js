/* ══════════════════════════════════════════════════════════════════
   site-header.js — 혼디 공용 헤더 스크립트 (단일 소스)

   이 스크립트를 불러오는 페이지는 로드 시 자동으로:
     1) 상단 안내 띠 + 내비게이션 바 + 돌아가기 화살표를 <body> 맨 앞에 삽입
     2) window.PAGE_HERO 설정값으로 히어로(배지·제목·설명·버튼)를 렌더링해
        <div id="site-hero-mount"></div> 안에 삽입

   사용법 — 각 페이지의 <body> 시작 부분에 다음을 넣으면 됩니다:

     <script>
       window.PAGE_HERO = {
         badge: '배지 문구',
         l1: '제목 첫 줄(흰색)',
         l2: '제목 둘째 줄(하늘색)',
         sub: '부제 설명 문장',
         actions: [
           { label: '버튼 문구', href: 'https://...', style: 'primary' }
         ]
       };
     </script>
     <link rel="stylesheet" href="/assets/site-header.css">
     <script src="/assets/site-header.js"></script>
     <div id="site-hero-mount"></div>

   내비게이션 메뉴 항목 자체(이용방법/AI비서/... 등)를 바꾸려면 이 파일의
   NAV_HTML만 고치면 됩니다 — 21개 페이지를 하나씩 고칠 필요가 없습니다.
   ══════════════════════════════════════════════════════════════════ */

(function () {

  var NAV_HTML =
    '<div class="site-nav">' +
      '<a class="site-nav-logo" href="/desktop.html" onclick="return __hondiBack(event);">' +
        '<img src="/icons/icon-192.png" alt="혼디">' +
        '<span>혼디</span>' +
      '</a>' +
      '<nav class="site-nav-links">' +
        '<a href="/pages/usage-guide.html">이용방법</a>' +
        '<a href="/pages/ai-assistant.html">AI 비서</a>' +
        '<a href="/feedback.html">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
          '게시판' +
        '</a>' +
        '<a href="/desktop.html">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="4" rx="1"/><rect x="3" y="10" width="18" height="4" rx="1"/><rect x="3" y="16" width="10" height="4" rx="1"/></svg>' +
          '대시보드' +
        '</a>' +
        '<a href="/pages/ai-engine.html">AI 엔진</a>' +
        '<a href="/pages/openhash.html">오픈해시</a>' +
        '<a href="/pages/hondi-market.html">혼디마켓</a>' +
      '</nav>' +
      '<div class="site-nav-highlight">' +
        '<a href="/pages/k-services.html"><span class="dot"></span><span class="label-text">K-서비스</span></a>' +
        '<a href="/pages/expert-personas.html"><span class="dot"></span><span class="label-text">전문가 페르소나</span></a>' +
        '<a href="/pages/k-government.html"><span class="dot"></span><span class="label-text">K-정부</span></a>' +
      '</div>' +
    '</div>' +
    '<div class="site-strip">' +
      '<a class="site-strip-text" href="https://github.com/Openhash-Gopang/hondi" target="_blank">2026년 9월 1일 테스트 시작 · 2027년 완전한 AI 정부 구현 목표 · 오픈소스 코드 공개</a>' +
      '<a class="site-strip-support-btn" href="/pages/project-support.html">혼디 프로젝트 지원</a>' +
    '</div>';

  var BACK_ARROW_HTML =
    '<a class="page-back-arrow" href="/desktop.html" onclick="return __hondiBack(event);" aria-label="돌아가기">' +
      '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>' +
    '</a>';

  // 오버레이(SPA) 안에서 열렸으면 오버레이를 닫고, 아니면(새 탭으로 직접 열렸으면)
  // 그냥 href를 따라 /desktop.html로 실제 이동한다.
  window.__hondiBack = function (e) {
    if (typeof closeStandalone === 'function') {
      closeStandalone();
      if (e && e.preventDefault) e.preventDefault();
      return false;
    }
    return true;
  };

  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function renderHero(config) {
    if (!config) return '';
    var html = '<section class="site-hero" id="top">';
    if (config.badge) {
      html += '<span class="site-hero-badge"><span class="dot"></span>' + escapeHtml(config.badge) + '</span>';
    }
    html += '<a class="site-hero-corner-logo" href="/desktop.html" onclick="return __hondiBack(event);" title="혼디">' +
              '<img src="/icons/hondi-hero-badge.png" alt="혼디 로고">' +
            '</a>';
    if (config.l1 || config.l2) {
      html += '<h1>';
      if (config.l1) html += '<span class="l1">' + escapeHtml(config.l1) + '</span>';
      if (config.l1 && config.l2) html += '<br>';
      if (config.l2) html += '<span class="l2">' + escapeHtml(config.l2) + '</span>';
      html += '</h1>';
    }
    if (config.sub) {
      html += '<p class="site-hero-sub">' + config.sub + '</p>';
    }
    if (config.actions && config.actions.length) {
      html += '<div class="site-hero-actions">';
      config.actions.forEach(function (a) {
        var target = a.target ? ' target="' + a.target + '" rel="noopener"' : '';
        var cls = a.style === 'outline' ? 'outline' : 'primary';
        html += '<a href="' + a.href + '" class="' + cls + '"' + target + '>' + escapeHtml(a.label) + '</a>';
      });
      html += '</div>';
    }
    html += '</section>';
    return html;
  }

  // document.currentScript는 이 스크립트가 "동기적으로 실행되는 바로 그 순간"에만
  // 유효하다. 반면 #site-hero-mount 같은 요소는 이 스크립트 태그보다 뒤에 있어서
  // 즉시 조회하면 아직 존재하지 않는다. 그래서 스크립트 자신에 대한 참조는 지금
  // 동기적으로 잡아두고, 실제 DOM 삽입은 뒤로 미룬다.
  var THIS_SCRIPT = document.currentScript;

  function init() {
    // document.body는 항상 desktop.html의 실제 body를 가리킨다 — 오버레이 안에
    // 주입된 콘텐츠 안에서 이 스크립트가 실행되더라도 마찬가지다. 그래서
    // document.body를 기준으로 삽입하면 오버레이로 열 때마다 desktop.html의
    // 진짜 헤더 위에 사본이 계속 쌓인다(중복 버그). 대신 이 스크립트 태그 자신이
    // 실제로 놓인 위치를 기준으로 삽입한다 — 오버레이 안이든 새 탭 단독 실행이든
    // 항상 올바른 컨테이너에 삽입된다.
    var container = THIS_SCRIPT ? THIS_SCRIPT.parentNode : document.body;

    function insertHtml(html) {
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

    insertHtml(NAV_HTML);
    insertHtml(BACK_ARROW_HTML);

    var mount = document.getElementById('site-hero-mount');
    if (mount) {
      mount.outerHTML = renderHero(window.PAGE_HERO);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // activateScripts로 재실행되는 경우 document.readyState는 이미 'complete'이므로
    // DOMContentLoaded가 다시 발생하지 않는다 — 이 경우 바로 실행한다.
    init();
  }
})();
