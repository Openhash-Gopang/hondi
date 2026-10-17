/* ══════════════════════════════════════════════════════════════════
   start-field.js — 전문가 페르소나 페이지의 "시작 영역" 공용 스크립트 (2026-10-17 신설)

   하는 일: 페이지의 <div class="doc-start" id="startBox"></div> 를 채운다.
     · 탭 2개 — 첫 탭(기본 「서류 작성」)은 그 아래 한 줄 입력창이 곧 대화창이다(chat-widget 의 inline 모드:
       보내는 순간 위쪽은 고정한 채 아래로 부드럽게 늘어난다). 둘째 탭 「방법론」은 이 페이지 보조 AI 의 SP(prompts/ 의 MD 원문)를
       본문 폭·Pretendard·MD 서식으로 펼쳐 보인다(assets/md-view.js 필요).
     · 대화창이 열릴 때(예: 서류 목록의 「대화로 작성」 버튼) 방법론 탭이 펼쳐져 있으면 첫 탭으로 돌아온다.
   페이지가 준비할 것:
     1) 앞쪽: window.HONDI_CHAT_WIDGET_CONFIG = { sp, panelMode:'inline', inlineMount:'#startChatMount', mic:true, camera:'touch', … }
     2) 본문: <div class="doc-start" id="startBox"></div>
     3) 뒤쪽: <script src="/assets/md-view.js"></script><script src="/assets/start-field.js"></script>
     4) 선택: window.START_FIELD = { firstTab:'감정 평가', secondTab:'방법론', placeholder:'…' }  (스크립트보다 앞에)
   서류 목록형 페이지(window.PRO_DOC_PAGE)는 첫 서류 이름을 입력창 안내 예시로 쓴다.
   ══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var box = document.getElementById('startBox');
  if (!box || box.getAttribute('data-ready')) return;
  box.setAttribute('data-ready', '1');

  var C = window.START_FIELD || {};
  var W = window.HONDI_CHAT_WIDGET_CONFIG || {};
  var firstLabel = C.firstTab || '서류 작성';
  var secondLabel = C.secondTab || '방법론';
  var title = W.panelTitle || (document.title || '').replace(/\s*[—-]\s*나비\s*$/, '') || '보조 AI';

  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text) n.textContent = text;
    return n;
  }

  // ── 탭 + 입력창이 붙을 자리 ──
  var tabs = el('div', { 'class': 'start-tabs', role: 'tablist', 'aria-label': '시작 방식' });
  var t1 = el('button', { type: 'button', 'class': 'start-tab active', role: 'tab', 'aria-selected': 'true', 'data-mode': 'write' }, firstLabel);
  var t2 = el('button', { type: 'button', 'class': 'start-tab', role: 'tab', 'aria-selected': 'false', 'data-mode': 'method' }, secondLabel);
  tabs.appendChild(t1); tabs.appendChild(t2);
  // 2026-10-17: 「법률 검토」 탭 — 서류 작성과 방법론 사이. 인간 변호사에게 묻기 전에 AI로 쟁점을 먼저 점검한다(SP_LEGAL_REVIEW_BASE + 직업군 훅).
  var LR_KEY = 'hondi_legal_review_banner_hidden_v1';   // legal-review-ui.js 와 같은 키 — 전문가 채팅 화면과 숨김 선택을 공유한다
  function lrPersonaId() {
    if (C.personaId) return C.personaId;
    var m = location.pathname.match(/\/pages\/([a-z0-9-]+)\.html$/i);
    var id = m ? m[1] : null;
    if (!id && W.sp) { var q = String(W.sp).match(/^SP_(.+?)(?:-assistant)?$/); id = q ? q[1] : null; }   // 오버레이 등 경로로 알 수 없을 때
    return id && !/^indtransform/.test(id) ? id : null;
  }
  var LR_ID = C.legalReview === false ? null : lrPersonaId();
  var t3 = null;
  if (LR_ID) {
    t3 = el('button', { type: 'button', 'class': 'start-tab', role: 'tab', 'aria-selected': 'false', 'data-mode': 'review' }, '법률 검토');
    tabs.insertBefore(t3, t2);
  }
  var mount = el('div', { id: 'startChatMount' });
  var lrBanner = el('div', { 'class': 'lr-banner', role: 'note' });
  lrBanner.hidden = true;
  var lrState = el('p', { 'class': 'lr-state' });
  lrState.hidden = true;
  box.appendChild(tabs); box.appendChild(lrBanner); box.appendChild(lrState); box.appendChild(mount);

  // ── 방법론(SP 원문) 보기 — 본문 폭 ──
  var view = el('section', { 'class': 'sp-view', id: 'spView', 'aria-label': title + ' 방법론(시스템 프롬프트 원문)', 'aria-hidden': 'true' });
  var inner = el('div', { 'class': 'sp-view-inner' });
  var bar = el('div', { 'class': 'sp-view-bar' });
  bar.appendChild(el('span', { 'class': 'sp-view-title' }, title + ' 방법론 — 시스템 프롬프트(SP) 원문'));
  var raw = el('a', { 'class': 'sp-view-raw', href: '#', target: '_blank', rel: 'noopener noreferrer' }, '원문 열기');
  raw.hidden = true; bar.appendChild(raw);
  var md = el('article', { 'class': 'sp-md', id: 'spMd' });
  md.appendChild(el('p', { 'class': 'sp-state' }, '「' + secondLabel + '」 탭을 누르면 불러옵니다.'));
  inner.appendChild(bar); inner.appendChild(md); view.appendChild(inner);
  box.parentNode.insertBefore(view, box.nextSibling);

  // ── 입력창 안내 문구: 서류 목록형 페이지는 첫 서류 이름을 예시로 ──
  function placeholderText() {
    if (C.placeholder) return C.placeholder;
    var ex = '';
    try { ex = window.PRO_DOC_PAGE.catalog[0].items[0].t.replace(/\s*[(（].*$/, ''); } catch (e) {}
    return '작성할 서류를 입력하세요.' + (ex ? ' 예: ' + ex : '');
  }
  function applyPlaceholder() { var i = document.getElementById('hcw-input'); if (i) i.placeholder = placeholderText(); }
  applyPlaceholder();

  // ── 위젯이 없는 환경(나비 데스크톱 오버레이 안에서는 셸이 자체 채팅 말풍선을 제공해 위젯이 비활성) ──
  function widgetActive() { return !!document.getElementById('hcw-panel'); }
  function showFallback() {
    if (widgetActive()) return;
    mount.textContent = '';
    var b = el('button', { type: 'button', 'class': 'svc-link-btn solid' }, '대화로 서류 작성 시작하기');
    b.style.margin = '0';
    b.addEventListener('click', function () { var fab = document.getElementById('ask-bubble'); if (fab) fab.click(); });
    mount.appendChild(b);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { applyPlaceholder(); showFallback(); });
  else showFallback();

  // ── SP 원문 불러오기 ──
  var loaded = false, loading = false;
  function showState(text, retry) {
    md.textContent = '';
    var p = el('p', { 'class': 'sp-state' }, text); md.appendChild(p);
    if (retry) { var b = el('button', { type: 'button', 'class': 'svc-link-btn sm' }, '다시 불러오기'); b.addEventListener('click', loadSP); p.appendChild(document.createTextNode(' ')); p.appendChild(b); }
  }
  async function loadSP() {
    if (loaded || loading) return;
    loading = true; showState('방법론(시스템 프롬프트)을 불러오는 중입니다…');
    try {
      if (!W.sp) throw new Error('sp key 없음');
      var cat = await fetch('/prompts/sp-catalog.json', { cache: 'no-cache' });
      if (!cat.ok) throw new Error('catalog ' + cat.status);
      var name = (await cat.json())[W.sp];
      if (!name) throw new Error('catalog key ' + W.sp);
      var res = await fetch('/prompts/' + name, { cache: 'no-cache' });
      if (!res.ok) throw new Error('sp ' + res.status);
      md.innerHTML = window.HondiMd.render(await res.text());
      raw.href = '/prompts/' + name; raw.hidden = false;
      loaded = true;
    } catch (e) {
      console.error('[start-field] SP 로드 실패', e);
      showState('방법론을 불러오지 못했습니다.', true);
    }
    loading = false;
  }

  // ── 법률 검토 ──
  function lrHidden() { try { return localStorage.getItem(LR_KEY) === '1'; } catch (e) { return false; } }
  var lrReview = null, lrLoading = false, chatMode = 'write', mode = 'write';
  var LR_PLACEHOLDER = '법률 문제를 알려 주세요. 예: 영업정지 처분 통지서를 받았습니다';
  var LR_BANNER_TEXT = 'AI 법률 검토는 인간 변호사를 대신하지 않습니다. 변호사에게 자문을 구하기 전에 쟁점과 준비사항을 정리하는 참고용이며 법적 효력이 없습니다.';
  function lrShowBanner(on) {
    lrBanner.textContent = '';
    if (!on || lrHidden()) { lrBanner.hidden = true; return; }
    var txt = el('span', { 'class': 'lr-banner-text' }, '⚖ ' + LR_BANNER_TEXT);
    var x = el('button', { type: 'button', 'class': 'lr-banner-x', 'aria-label': '이 안내 다시 보지 않기' }, '다시 보지 않기 ✕');
    x.addEventListener('click', function () { try { localStorage.setItem(LR_KEY, '1'); } catch (e) {} lrBanner.hidden = true; lrBanner.textContent = ''; });
    lrBanner.appendChild(txt); lrBanner.appendChild(x); lrBanner.hidden = false;
  }
  function lrNote(text) { lrState.textContent = text || ''; lrState.hidden = !text; }
  function lrNewTabLink() {
    lrNote('');
    mount.textContent = '';
    var a = el('a', { 'class': 'svc-link-btn solid', href: '/pages/expert-chat.html?persona=' + encodeURIComponent(LR_ID) + '&mode=review', target: '_blank', rel: 'noopener' }, '법률 검토 시작하기 (새 창)');
    a.style.margin = '0';
    mount.appendChild(a);
  }
  // 위젯 대화를 법률 검토 모드로 바꾼다. 성공하면 true.
  async function lrEnter() {
    if (!widgetActive() || !window.HondiChatWidget || !window.HondiChatWidget.setMode) { lrNewTabLink(); return true; }
    if (!lrReview) {
      if (lrLoading) return false;
      lrLoading = true; lrNote('법률 검토를 준비하는 중입니다…');
      try {
        var m = await import('/src/gopang/ai/legal-review.js');
        var sp = await m._composeLegalReviewPrompt(LR_ID, undefined, { serverInjectsUniversal: true });
        if (!sp) throw new Error('compose 실패');
        lrReview = {
          system: sp, maxTokens: 2500,
          context: '사용자는 지금 ' + title + ' 페이지의 「법률 검토」 탭에 있다. 이 화면은 [CONNECT_HUMAN_EXPERT]·[ESCALATE_URGENT] 같은 태그를 처리하지 않으므로 출력하지 않고 문장으로 안내한다.',
          greeting: m.LEGAL_REVIEW_DISCLAIMER + '\n\n' + title.replace(/\s*보조\s*AI\s*$/, '') + ' 분야에서 변호사에게 묻기 전에 확인하고 싶은 사안을 알려 주세요. 쟁점과 기한, 준비할 자료를 정리해 드립니다.'
        };
      } catch (e) {
        console.error('[start-field] 법률 검토 로드 실패', e);
        lrLoading = false; lrNote('법률 검토를 불러오지 못했습니다. 잠시 후 다시 눌러 주세요.');
        return false;
      }
      lrLoading = false;
    }
    lrNote('');
    if (!window.HondiChatWidget.setMode(lrReview)) { lrNote('답변을 받는 중에는 바꿀 수 없습니다. 잠시 후 다시 눌러 주세요.'); return false; }
    var inp = document.getElementById('hcw-input'); if (inp) inp.placeholder = LR_PLACEHOLDER;
    return true;
  }
  function lrLeave() {
    lrNote('');
    if (!widgetActive()) { showFallback(); return; }
    if (window.HondiChatWidget && window.HondiChatWidget.setMode) window.HondiChatWidget.setMode(null);
    applyPlaceholder();
  }

  // ── 탭 전환 ── mode: 'write' | 'review' | 'method'  (대화 모드는 write↔review 사이에서만 바뀐다)
  async function select(next, focus) {
    if (next === 'review' && !t3) next = 'write';
    if (next === 'review' && chatMode !== 'review') { if (!(await lrEnter())) next = mode === 'review' ? 'review' : 'write'; else chatMode = 'review'; }
    else if (next === 'write' && chatMode !== 'write') { lrLeave(); chatMode = 'write'; }
    mode = next;
    var method = next === 'method';
    [[t1, next === 'write'], [t3, next === 'review'], [t2, method]].forEach(function (p) {
      if (!p[0]) return;
      p[0].classList.toggle('active', p[1]); p[0].setAttribute('aria-selected', p[1] ? 'true' : 'false');
    });
    box.classList.toggle('is-method', method);
    box.classList.toggle('is-review', next === 'review');
    lrShowBanner(next === 'review');
    view.classList.toggle('open', method);
    view.setAttribute('aria-hidden', method ? 'false' : 'true');
    if (method) loadSP();
    else if (focus) { var inp = document.getElementById('hcw-input'); if (inp) { try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); } } }
  }
  t1.addEventListener('click', function () { select('write', true); });
  if (t3) t3.addEventListener('click', function () { select('review', true); });
  t2.addEventListener('click', function () { select('method', false); });
  // 대화창이 외부 호출(서류 목록의 「대화로 작성」 등)로 열리면, 방법론을 보고 있던 경우에만 대화 탭으로 돌아온다.
  document.addEventListener('hcw:inline-open', function () { if (mode === 'method') select(chatMode, false); });

  // 상단 메뉴의 「법률 검토」 버튼(원래 위치) + 주소 #legal-review 로 바로 열기
  if (t3) {
    // 상단 메뉴(ph-header.js)는 DOMContentLoaded 에 그려지므로 그 뒤에 버튼을 끼운다.
    var addNavBtn = function () {
      var navRight = document.querySelector('.topnav-right');
      if (!navRight || document.getElementById('lrNavBtn')) return;
      var nb = el('button', { type: 'button', id: 'lrNavBtn', 'class': 'lr-nav-btn', title: '인간 변호사에게 묻기 전에 AI로 쟁점을 먼저 점검합니다' }, '⚖ 법률 검토');
      nb.addEventListener('click', function () { select('review', true); try { box.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {} });
      navRight.insertBefore(nb, navRight.firstChild);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(addNavBtn, 0); });
    else addNavBtn();
    if (location.hash === '#legal-review') select('review', false);
  }
})();
