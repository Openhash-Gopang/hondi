/* gov-agency.js — 행정기관 공통 페이지(pages/gov-agency.html) 로직 (2026-10-19 신설)

   전문가 페르소나 페이지(accountant.html 등)와 같은 레이아웃: 공용 헤더(ph-header) → 시작 영역(입력창 + 「민원 작성 / 법률 검토 / 방법론」 탭)
   → 작성 방법 → 업무 영역 탭의 민원 서류 목록 → 작성된 문서 → 관계 법령 → 한계 → 푸터.
   기관 한 곳당 HTML 파일을 만들지 않고 ?gov_code=<govCode> 하나로 모든 기관을 그린다. 기관별로 달라지는 부분은 assets/gov-agency-overrides.js.

   로드 순서(pages/gov-agency.html):  gov-agency-data.js → gov-agency-overrides.js → 이 파일(window.PAGE_HEADER·PRO_DOC_PAGE 를 먼저 채움)
                                      → ph-header.js → (본문) → md-view.js → pro-doc-page.js → 이 파일의 DOM 단계(DOMContentLoaded)

   대화 엔진은 새로 만들지 않는다 — 「민원 작성」 탭은 기존 행정 AI(pages/regional-gov.html?embed=1)를 같은 오리진 iframe 으로 끼운다.
   라우팅·GOV_TASK·직원 검토 게이트·PDV 기록은 그 페이지의 엔진이 그대로 처리한다. */
(function () {
  'use strict';
  var qs = new URLSearchParams(location.search);
  var code = (qs.get('gov_code') || '').trim();
  var rec = (window.GOV_AGENCIES || {})[code] || null;          // [이름, 소속, SP 경로|null]
  var name = rec ? rec[0] : '', group = rec ? rec[1] : '', spPath = rec ? rec[2] : null;
  var tier = code.split(':')[0];
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };

  /* ── 기본값(모든 기관 공통의 일반 민원 절차) ─────────────────────────
     기관 고유의 서류·법령은 여기에 적지 않는다(기관마다 다르고, 지어내면 안 된다) — 그 기관 SP 를 정본으로 overrides 표에 적는다.
     법령은 이름만 적고 조번호·시행일은 적지 않는다(현행본 확인 필요 — 아래 「확인하지 못한 법령」). */
  var DEFAULT_CATALOG = [
    { id: 'G-1', tab: '일반 민원', title: '일반 민원(신청·질의·건의)',
      meta: '근거 민원 처리에 관한 법률, 행정절차법',
      lead: '이 기관이 처리하는 일반적인 민원을 대화로 정리해 신청서·질의서 초안을 만듭니다. 기관 고유의 서류 목록은 기관별로 추가됩니다.',
      notes: ['작성된 초안은 접수가 아닙니다. 담당 부서가 접수하고 처리한 뒤에야 효력이 생기며, 처리 결과는 담당 공무원이 결정합니다.'],
      items: [
        { t: '민원 신청서(일반)', d: '신청인 인적사항, 민원 내용과 요청 사항, 처리를 원하는 기한·방법, 첨부 서류 / 담당 부서 확인 필요' },
        { t: '질의서(민원 질의)', d: '질의 사항과 배경, 관련 법령·사실관계, 회신 방법' },
        { t: '건의서·제안서', d: '건의 내용, 현황과 문제점, 개선 방안, 기대 효과' }
      ] },
    { id: 'G-2', tab: '정보공개', title: '정보공개 청구',
      meta: '근거 공공기관의 정보공개에 관한 법률',
      lead: '', notes: ['비공개 대상 여부는 기관이 판단합니다. 이 도구는 청구서 초안만 작성합니다.'],
      items: [
        { t: '정보공개 청구서', d: '청구인 인적사항, 청구 대상 정보의 내용·기간·범위, 공개 방법(열람·사본·전자), 수수료 안내 확인' }
      ] },
    { id: 'G-3', tab: '이의·불복', title: '처분에 대한 이의·불복',
      meta: '근거 민원 처리에 관한 법률, 행정심판법, 행정절차법',
      lead: '', notes: ['불복 기한과 제출처는 처분서(통지서)에 적힌 안내를 먼저 확인하십시오. 기한이 지나면 권리를 잃을 수 있어 「법률 검토」 탭에서 쟁점을 먼저 점검할 수 있습니다.'],
      items: [
        { t: '이의신청서', d: '처분의 내용과 통지일, 이의 사유, 요청 사항, 처분서 사본 첨부' },
        { t: '행정심판 청구서(작성 보조)', d: '처분 내용과 처분이 있음을 안 날, 청구 취지와 이유, 불복 절차 안내 확인 / 제출처는 처분서 안내 확인' }
      ] },
    { id: 'G-4', tab: '진정·고충', title: '진정·고충',
      meta: '근거 민원 처리에 관한 법률',
      lead: '', notes: [],
      items: [
        { t: '진정서', d: '진정 대상과 사실관계(일시·장소·경위), 요구 사항, 증빙 자료' },
        { t: '고충민원 신청서', d: '고충의 내용과 경위, 관계 기관과 지금까지의 처리 경과, 바라는 해결 방안' }
      ] }
  ];
  var DEFAULT_LAWS = [
    { name: '민원 처리에 관한 법률', rel: '민원의 접수·처리 절차와 처리 기간, 민원 신청서 형식 / 현행 조번호 확인 필요' },
    { name: '행정절차법', rel: '처분의 사전 통지·의견 제출·이유 제시, 처분서의 불복 절차 안내 / 현행 조번호 확인 필요' },
    { name: '공공기관의 정보공개에 관한 법률', rel: '정보공개 청구와 비공개 대상 정보, 이의신청 / 현행 조번호 확인 필요' },
    { name: '행정심판법', rel: '행정청의 처분에 대한 불복(행정심판) 청구 기한과 절차 / 현행 조번호 확인 필요' },
    { name: '개인정보 보호법', rel: '민원 작성 중 입력한 개인정보의 수집·이용 / 현행 조번호 확인 필요' }
  ];
  var DEFAULT_LIMITS = [
    '이 페이지는 초안 단계입니다. 기관별 민원 서류 목록과 관계 법령은 기관 SP 를 정본으로 기관마다 채워 가는 중이며, 아직 채워지지 않은 기관은 위의 일반 민원 목록을 보여 줍니다.',
    '위 관계 법령은 법령 이름만 적었습니다. 조번호·시행일·시행규칙은 확인하지 못했으므로 서류를 작성할 때 현행본을 확인하십시오.',
    '「작성된 문서」 카드는 AI 가 서류 초안을 규정된 문서 형식(머리말에 doc_type 이 있는 문서)으로 낼 때만 채워집니다. 기관의 기존 GOV_TASK(서류 초안·제출 요청) 흐름과 이 카드를 잇는 일은 남아 있습니다.',
    '정식 접수·전자 제출은 이 페이지가 아니라 기관의 접수 창구(정부24, 국민신문고, 기관 누리집 등)에서 이루어집니다. 이 페이지의 어떤 내용도 접수를 대신하지 않습니다.'
  ];

  var tierOv = (window.GOV_TIER_OVERRIDES || {})[tier] || {};
  var agOv = (window.GOV_AGENCY_OVERRIDES || {})[code] || {};
  function pick(k, dflt) { return agOv[k] !== undefined ? agOv[k] : (tierOv[k] !== undefined ? tierOv[k] : dflt); }

  // 시·도 부서처럼 이름만으로는 어느 지역인지 모호한 기관(예: 「기획조정실」)은 소속의 시·도 이름을 앞에 붙인다. 이미 지역 이름이 들어 있으면 그대로 둔다.
  var pm = group.match(/^(\S+) (?:부서|직속기관|출자출연기관|읍·면·동|부서 세부과|직속기관 세부과|출자출연기관 세부팀)$/);
  var displayName = name ? ((pm && name.indexOf(pm[1]) < 0) ? pm[1] + ' ' + name : name) : '행정기관';
  var CFG = {
    h1: pick('h1', rec ? esc(displayName) + ' 민원을<br>대화로 작성해 제출합니다' : '기관을 찾지 못했습니다'),
    sub: pick('sub', rec ? '작성할 민원을 목록에서 고르거나 아래 입력창으로 말씀하시면, 필요한 정보를 물어 민원서류 초안을 작성합니다.'
                         : 'K-정부 목록에서 기관을 다시 선택해 주십시오.'),
    disclaimer: pick('disclaimer', '이 AI는 공무원의 처분·접수를 대신하지 않습니다. 작성된 초안은 담당 부서의 접수·심사를 거쳐야 효력이 있습니다.'),
    intro: pick('intro', ''),
    catalog: pick('catalog', DEFAULT_CATALOG),
    laws: pick('laws', DEFAULT_LAWS),
    lawsUnverified: pick('lawsUnverified', '법령 이름만 적었고 조번호·시행일은 확인하지 못했습니다. 개정될 수 있으므로 서류를 작성하기 전에 현행본을 확인하십시오.'),
    limits: pick('limits', DEFAULT_LIMITS),
    footer: pick('footer', '근거 법령: 민원 처리에 관한 법률 외 · ' + displayName + ' AI 는 민원 작성을 돕는 도구이며 처분·접수·법률 자문을 제공하지 않습니다.')
  };

  /* ── 헤더·서류 목록 설정: ph-header.js / pro-doc-page.js 가 읽기 전에 채운다 ── */
  document.title = (rec ? displayName + ' AI' : '행정기관') + ' — 나비';
  window.PAGE_HEADER = {
    active: 'k-government',
    badge: 'K-정부 · ' + (rec ? displayName + ' AI' : '행정기관 AI'),
    h1: CFG.h1,
    sub: CFG.sub,
    disclaimer: CFG.disclaimer,
    disclaimerDismissKey: 'gov-agency'
  };
  window.PRO_DOC_PAGE = {
    catalog: CFG.catalog,
    askOtherMessage: '목록에 없는 민원을 작성하려고 합니다. 어떤 민원인지 먼저 확인해 주세요.',
    startMessage: function (title) { return '「' + title + '」 민원을 작성하려고 합니다. 필요한 정보를 순서대로 물어봐 주세요.'; },
    send: function (msg) { sendToEngine(msg); }
  };
  window.K_AUTH_CONFIG = { serviceLabel: displayName + ' AI' };

  /* ── DOM 단계 ───────────────────────────────────────────────── */
  var engineFrame = null, engineReady = false, queue = [];
  function sendToEngine(msg) {
    if (!rec) return;
    selectTab('write', false);
    try { document.getElementById('startBox').scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
    if (engineReady && engineFrame && engineFrame.contentWindow) engineFrame.contentWindow.postMessage({ type: 'gov-embed-send', text: String(msg) }, location.origin);
    else queue.push(String(msg));
  }
  var selectTab = function () {};

  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text) n.textContent = text;
    return n;
  }

  function init() {
    var box = document.getElementById('startBox');
    if (!box) return;

    /* 본문 채우기: 작성 방법 / 관계 법령 / 한계 / 푸터 */
    var how = document.getElementById('govHow');
    if (how) how.innerHTML = CFG.intro ? '<b>작성 방법</b> ' + esc(CFG.intro)
      : '<b>작성 방법</b> ① 위 입력창에 민원 내용이나 서류를 말씀하시거나, 아래 탭에서 서류를 고르고 「대화로 작성」을 누릅니다. ② 대화로 필요한 정보를 알려 주시면 초안이 작성됩니다. ③ 페이지 아래 「작성된 문서」에서 내용을 확인하고 웹 표준 서식으로 내려받아, 기관의 접수 창구에 제출합니다.';
    var laws = document.getElementById('govLawRows');
    if (laws) laws.innerHTML = CFG.laws.map(function (l) { return '<tr><td class="doc-title">' + esc(l.name) + '</td><td class="doc-detail">' + esc(l.rel) + '</td></tr>'; }).join('');
    var lu = document.getElementById('govLawsUnverified'); if (lu) lu.innerHTML = '<b>확인하지 못한 법령</b> ' + esc(CFG.lawsUnverified);
    var lim = document.getElementById('govLimits');
    if (lim) lim.innerHTML = '<div class="svc-detail"><h2>이 페이지의 미비점·한계와 추후 작업</h2><p class="svc-lead">이 페이지와 기관 AI 는 초안 단계입니다. 아래는 현재 알려진 한계와 앞으로 할 일입니다.</p><ul>' + CFG.limits.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div>';
    var ft = document.getElementById('govFooter'); if (ft) ft.textContent = CFG.footer;

    if (!rec) {   // 기관을 못 찾은 경우: 시작 영역 대신 안내만
      box.innerHTML = '';
      var nf = el('div', { 'class': 'svc-callout important' });
      nf.innerHTML = (code ? '<b>「' + esc(code) + '」</b> 에 해당하는 기관이 없습니다. ' : '<b>기관이 지정되지 않았습니다.</b> ') +
        '<a href="/pages/k-government.html">K-정부 목록</a>에서 기관을 선택해 주십시오.';
      box.appendChild(nf);
      ['svcTabs', 'svcContent', 'askOther'].forEach(function (id) { var n = document.getElementById(id); if (n) { var b = n.closest('.doc-toolbar') || n; b.style.display = 'none'; } });
      return;
    }

    /* 시작 영역: 탭 3개 + 대화창 자리 */
    var tabs = el('div', { 'class': 'start-tabs', role: 'tablist', 'aria-label': '시작 방식' });
    var t1 = el('button', { type: 'button', 'class': 'start-tab active', role: 'tab', 'aria-selected': 'true' }, '민원 작성');
    var t3 = el('button', { type: 'button', 'class': 'start-tab', role: 'tab', 'aria-selected': 'false' }, '법률 검토');
    var t2 = el('button', { type: 'button', 'class': 'start-tab', role: 'tab', 'aria-selected': 'false' }, '방법론');
    tabs.appendChild(t1); tabs.appendChild(t3); tabs.appendChild(t2);
    var lrBanner = el('div', { 'class': 'lr-banner', role: 'note' }); lrBanner.hidden = true;
    var lrState = el('p', { 'class': 'lr-state' }); lrState.hidden = true;
    var writeMount = el('div', { id: 'govWriteMount' });
    var reviewMount = el('div', { id: 'startChatMount' }); reviewMount.hidden = true;   // chat-widget(inline) 이 붙는 자리 — 법률 검토 전용
    box.appendChild(tabs); box.appendChild(lrBanner); box.appendChild(lrState); box.appendChild(writeMount); box.appendChild(reviewMount);

    /* 민원 작성: 기존 행정 AI 엔진을 같은 오리진 iframe 으로 끼운다 */
    engineFrame = el('iframe', {
      id: 'govEngine', title: displayName + ' AI 대화창', loading: 'eager', allow: 'microphone; camera; geolocation',
      src: '/pages/regional-gov.html?embed=1&gov_code=' + encodeURIComponent(code)
    });
    engineFrame.style.cssText = 'display:block;width:100%;height:150px;border:0;background:transparent;color-scheme:light';
    writeMount.appendChild(engineFrame);

    window.addEventListener('message', function (e) {
      if (e.origin !== location.origin || !engineFrame || e.source !== engineFrame.contentWindow || !e.data) return;
      var d = e.data;
      if (d.type === 'gov-embed-ready') {
        engineReady = true;
        while (queue.length) engineFrame.contentWindow.postMessage({ type: 'gov-embed-send', text: queue.shift() }, location.origin);
      } else if (d.type === 'gov-embed-height' && typeof d.height === 'number') {
        engineFrame.style.height = Math.max(150, Math.min(d.height + 4, 4000)) + 'px';
      } else if (d.type === 'gov-embed-reply' && typeof d.text === 'string') {
        if (window.ProDocPage) window.ProDocPage.transformReply(d.text);   // 서류 초안이 들어 있으면 「작성된 문서」 카드로 옮긴다(반환 문구는 쓰지 않음)
      } else if (d.type === 'gov-embed-login') {
        var done = function () { try { engineFrame.contentWindow.postMessage({ type: 'gov-embed-login-done' }, location.origin); } catch (x) {} };
        if (window.KAuth && typeof window.KAuth.ensureLogin === 'function') window.KAuth.ensureLogin().then(done, done); else done();
      }
    });

    /* 방법론(기관 SP 원문) — 본문 폭 */
    var view = el('section', { 'class': 'sp-view', id: 'spView', 'aria-label': displayName + ' 방법론(시스템 프롬프트 원문)', 'aria-hidden': 'true' });
    var inner = el('div', { 'class': 'sp-view-inner' });
    var bar = el('div', { 'class': 'sp-view-bar' });
    bar.appendChild(el('span', { 'class': 'sp-view-title' }, displayName + ' 방법론 — 시스템 프롬프트(SP) 원문'));
    var raw = el('a', { 'class': 'sp-view-raw', href: '#', target: '_blank', rel: 'noopener noreferrer' }, '원문 열기'); raw.hidden = true; bar.appendChild(raw);
    var md = el('article', { 'class': 'sp-md', id: 'spMd' });
    md.appendChild(el('p', { 'class': 'sp-state' }, '「방법론」 탭을 누르면 불러옵니다.'));
    inner.appendChild(bar); inner.appendChild(md); view.appendChild(inner);
    box.parentNode.insertBefore(view, box.nextSibling);

    var spLoaded = false, spLoading = false;
    function spState(text, retry) {
      md.textContent = ''; var p = el('p', { 'class': 'sp-state' }, text); md.appendChild(p);
      if (retry) { var b = el('button', { type: 'button', 'class': 'svc-link-btn sm' }, '다시 불러오기'); b.addEventListener('click', loadSP); p.appendChild(document.createTextNode(' ')); p.appendChild(b); }
    }
    function loadSP() {
      if (spLoaded || spLoading) return;
      if (!spPath) { spState('이 기관은 전용 시스템 프롬프트 파일이 아직 없습니다. 같은 종류 기관의 공통 템플릿과 지역 공통 SP 로 안내합니다.'); return; }
      spLoading = true; spState('방법론(시스템 프롬프트)을 불러오는 중입니다…');
      fetch('/' + spPath.replace(/^\//, ''), { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error('sp ' + r.status); return r.text();
      }).then(function (txt) {
        md.innerHTML = window.HondiMd ? window.HondiMd.render(txt) : '<pre>' + esc(txt) + '</pre>';
        raw.href = '/' + spPath.replace(/^\//, ''); raw.hidden = false; spLoaded = true;
      }).catch(function (e) { console.error('[gov-agency] SP 로드 실패', e); spState('방법론을 불러오지 못했습니다.', true); })
        .then(function () { spLoading = false; });
    }

    /* 법률 검토: 채팅 위젯(inline) 을 법률 검토 모드로 — 기관 직원이 아닌 시민용 법률 쟁점 점검 */
    var LR_KEY = 'hondi_legal_review_banner_hidden_v1';   // 전문가 페이지와 같은 키 — 숨김 선택을 공유한다
    var LR_BANNER_TEXT = 'AI 법률 검토는 인간 변호사를 대신하지 않습니다. 변호사에게 자문을 구하기 전에 쟁점과 준비사항을 정리하는 참고용이며 법적 효력이 없습니다.';
    var LR_H1 = '행정 처분·민원의 법률 쟁점을<br>AI로 먼저 점검합니다';
    var LR_SUB = '상황을 알려 주시면 쟁점·기한·준비할 자료를 정리해 드립니다. 구체적 사건의 법률 판단은 변호사에게 확인하세요.';
    var heroOrig = null, lrReview = null, lrLoading = false, mode = 'write';
    function lrHidden() { try { return localStorage.getItem(LR_KEY) === '1'; } catch (e) { return false; } }
    function lrShowBanner(on) {
      lrBanner.textContent = '';
      if (!on || lrHidden()) { lrBanner.hidden = true; return; }
      lrBanner.appendChild(el('span', { 'class': 'lr-banner-text' }, '⚖ ' + LR_BANNER_TEXT));
      var x = el('button', { type: 'button', 'class': 'lr-banner-x', 'aria-label': '이 안내 다시 보지 않기' }, '다시 보지 않기 ✕');
      x.addEventListener('click', function () { try { localStorage.setItem(LR_KEY, '1'); } catch (e) {} lrBanner.hidden = true; lrBanner.textContent = ''; });
      lrBanner.appendChild(x); lrBanner.hidden = false;
    }
    function lrNote(text) { lrState.textContent = text || ''; lrState.hidden = !text; }
    function heroApply() {
      var h1 = document.querySelector('.ph-hero h1'); if (!h1) return;
      var sub = h1.parentNode.querySelector('p:not([class])');
      if (!heroOrig) heroOrig = { h1: h1.innerHTML, sub: sub ? sub.innerHTML : null };
      var on = mode === 'review';
      h1.innerHTML = on ? LR_H1 : heroOrig.h1;
      if (sub && heroOrig.sub !== null) sub.innerHTML = on ? LR_SUB : heroOrig.sub;
    }
    function widgetActive() { return !!document.getElementById('hcw-panel') && !!window.HondiChatWidget; }
    async function lrEnter() {
      if (!widgetActive() || !window.HondiChatWidget.setMode) { lrNote('법률 검토 창을 불러오지 못했습니다. 페이지를 새로 고친 뒤 다시 시도해 주세요.'); return false; }
      if (!lrReview) {
        if (lrLoading) return false;
        lrLoading = true; lrNote('법률 검토를 준비하는 중입니다…');
        try {
          var m = await import('/src/gopang/ai/legal-review.js');
          var sp = await m._composeLegalReviewPrompt('gov-agency', undefined, { serverInjectsUniversal: true });
          if (!sp) throw new Error('compose 실패');
          lrReview = {
            system: sp, maxTokens: 2500,
            context: '사용자는 지금 ' + displayName + ' 민원 페이지의 「법률 검토」 탭에 있다. 시민이 행정기관의 처분·민원과 관련해 변호사에게 묻기 전 쟁점을 점검하는 화면이다. [CONNECT_HUMAN_EXPERT]·[ESCALATE_URGENT] 같은 태그를 처리하지 않으므로 출력하지 않고 문장으로 안내한다.',
            greeting: m.LEGAL_REVIEW_DISCLAIMER + '\n\n' + displayName + ' 관련 민원·처분에서 변호사에게 묻기 전에 확인하고 싶은 사안을 알려 주세요. 쟁점과 기한, 준비할 자료를 정리해 드립니다.'
          };
        } catch (e) { console.error('[gov-agency] 법률 검토 로드 실패', e); lrLoading = false; lrNote('법률 검토를 불러오지 못했습니다. 잠시 후 다시 눌러 주세요.'); return false; }
        lrLoading = false;
      }
      lrNote('');
      if (!window.HondiChatWidget.setMode(lrReview)) { lrNote('답변을 받는 중에는 바꿀 수 없습니다. 잠시 후 다시 눌러 주세요.'); return false; }
      var inp = document.getElementById('hcw-input'); if (inp) inp.placeholder = '법률 문제를 알려 주세요. 예: 영업정지 처분 통지서를 받았습니다';
      return true;
    }

    var reviewReady = false;
    selectTab = async function (next, focus) {
      if (next === mode) return;
      if (next === 'review' && !reviewReady) { if (!(await lrEnter())) return; reviewReady = true; }
      mode = next;
      var review = next === 'review', method = next === 'method';
      [[t1, next === 'write'], [t3, review], [t2, method]].forEach(function (p) { p[0].classList.toggle('active', p[1]); p[0].setAttribute('aria-selected', p[1] ? 'true' : 'false'); });
      writeMount.hidden = next !== 'write';
      reviewMount.hidden = !review;
      box.classList.toggle('is-method', method);
      box.classList.toggle('is-review', review);
      document.body.classList.toggle('lr-mode', review);
      heroApply(); lrShowBanner(review);
      view.classList.toggle('open', method); view.setAttribute('aria-hidden', method ? 'false' : 'true');
      if (method) loadSP();
      else if (focus && review) { var inp = document.getElementById('hcw-input'); if (inp) { try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); } } }
    };
    t1.addEventListener('click', function () { selectTab('write', true); });
    t3.addEventListener('click', function () { selectTab('review', true); });
    t2.addEventListener('click', function () { selectTab('method', false); });
    if (location.hash === '#legal-review') selectTab('review', false);

    /* 상단 메뉴 오른쪽 버튼: 「⚖ 법률 검토」·「💬 제안 및 질문」 — 전문가 페르소나 페이지와 같은 위치·모양 */
    function addNavButtons() {
      var navRight = document.querySelector('.topnav-right'); if (!navRight) return;
      if (!document.getElementById('sqNavBtn')) {
        var a = el('a', { id: 'sqNavBtn', 'class': 'sq-nav-btn', href: '/pages/suggest.html?from=' + encodeURIComponent('gov-agency'), title: '혼디에 바라는 점이나 궁금한 점을 말씀해 주세요' }, '💬 제안 및 질문');
        navRight.insertBefore(a, navRight.firstChild);
      }
      if (!document.getElementById('lrNavBtn')) {
        var nb = el('button', { type: 'button', id: 'lrNavBtn', 'class': 'lr-nav-btn', title: '인간 변호사에게 묻기 전에 AI로 쟁점을 먼저 점검합니다' }, '⚖ 법률 검토');
        nb.addEventListener('click', function () { selectTab('review', true); try { box.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {} });
        navRight.insertBefore(nb, navRight.firstChild);
      }
    }
    setTimeout(addNavButtons, 0);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
