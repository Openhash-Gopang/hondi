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
  var mount = el('div', { id: 'startChatMount' });
  box.appendChild(tabs); box.appendChild(mount);

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

  // ── 탭 전환 ──
  function select(method, focus) {
    t1.classList.toggle('active', !method); t1.setAttribute('aria-selected', method ? 'false' : 'true');
    t2.classList.toggle('active', method);  t2.setAttribute('aria-selected', method ? 'true' : 'false');
    box.classList.toggle('is-method', method);
    view.classList.toggle('open', method);
    view.setAttribute('aria-hidden', method ? 'false' : 'true');
    if (method) loadSP();
    else if (focus) { var inp = document.getElementById('hcw-input'); if (inp) { try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); } } }
  }
  t1.addEventListener('click', function () { select(false, true); });
  t2.addEventListener('click', function () { select(true, false); });
  // 대화창이 외부 호출(서류 목록의 「대화로 작성」 등)로 열리면 첫 탭으로 돌아온다.
  document.addEventListener('hcw:inline-open', function () { select(false, false); });
})();
