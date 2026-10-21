/* professor-persona.js — 교수 페르소나 공통 페이지(pages/professor-persona.html) 로직
   전문가 페르소나 페이지(세무사 등)와 같은 레이아웃: 공용 헤더(ph-header) → 시작 영역(「학습 상담」·「방법론」 탭) → 역할 분담 → 과목별 본문 → 정확도 유의 → 한계.
   과목마다 HTML 을 만들지 않고 ?persona=<교수 페르소나 id> 하나로 모든 교수 페르소나를 그린다.
   과목별로 달라지는 본문은 그 과목 SP(prompts/SP_professor-*.md)의 「세부분야 경계」·「절차·기관 오케스트레이션 3훅」·「정확도 유의」에서 읽어 채운다.
   등록 정보(이름·계열)는 src/gopang/ai/expert-registry.js, SP 파일명은 prompts/sp-catalog.json 에서 읽는다.
   헤더 오른쪽 「학습 시작」 버튼은 ph-header 의 heroButton 기능이며, /pages/professor.html?persona=<id> (학습 트랙 10단계, K-Professor §3-10)로 이어진다.
   로드 순서: 이 파일(window.PAGE_HEADER 먼저 채움) → ph-header.js → 본문 → md-view.js → 이 파일의 DOM 단계(DOMContentLoaded) */
(function () {
  'use strict';
  var qs = new URLSearchParams(location.search);
  var id = (qs.get('persona') || '').trim();
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var validId = /^professor[a-z0-9-]*$/.test(id);
  var startHref = '/pages/professor.html' + (validId ? '?persona=' + encodeURIComponent(id) : '');

  /* ── 헤더: 등록 정보를 읽기 전 기본 문구(읽은 뒤 과목명으로 바꾼다). heroButton 은 id 만으로 만들 수 있다. ── */
  window.PAGE_HEADER = {
    active: 'expert-personas',
    badge: '전문가 페르소나 · 교수 보조 AI',
    h1: '학습 목표를 정하고<br>인간 교수의 지도를 보조합니다',
    sub: '과목별 AI 교수가 수준 진단, 학습 계획, 콘텐츠, 주간 시험을 대화로 돕고, 인간 교수의 검증을 받도록 자료를 정리합니다.',
    disclaimer: '관계 법령에 따라, 모든 보조 AI는 인간 전문가의 업무를 보조하며, 단독으로 기능하지 않는다. 시험·점수는 학습을 돕는 형성평가 참고 지표이며 공식 성적·학점·자격이 아니다.',
    disclaimerDismissKey: 'professor-persona',
    heroButton: { label: '학습 시작', href: startHref, title: '목표 설정부터 인간 교수 검증까지 10단계 학습 트랙을 시작합니다' }
  };
  window.K_AUTH_CONFIG = { serviceLabel: '교수 보조 AI' };

  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text) n.textContent = text;
    return n;
  }
  function md(text) { return window.HondiMd ? window.HondiMd.render(text) : '<pre>' + esc(text) + '</pre>'; }
  /* 레지스트리 라벨 「교수(국어·국문학)」 → 「국어·국문학」, 중계열의 부연(쉼표 뒤)은 머리글에서 뺀다 */
  function shortLabel(l) { return String(l || '').replace(/^교수\((.*)\)$/, '$1').split(/,\s|\s+[—-]\s+/)[0]; }
  function oneLine(s) { return String(s || '').replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim(); }

  /* ── SP 원문 해석: 「## 제목」 단위로 나눈다 ── */
  function sections(text) {
    var out = [], cur = null;
    String(text).split('\n').forEach(function (ln) {
      var m = /^##\s+(.*)$/.exec(ln);
      if (m && !/^###/.test(ln)) { cur = { h: m[1].trim(), body: [] }; out.push(cur); }
      else if (cur) cur.body.push(ln);
    });
    out.forEach(function (s) { s.body = s.body.join('\n').trim(); });
    return out;
  }
  function hook(body, mark) {
    var re = new RegExp('\\*\\*' + mark + '[^*]*\\*\\*\\s*:?\\s*([\\s\\S]*?)(?=\\n\\s*\\n\\*\\*|$)');
    var m = re.exec(body || ''); return m ? oneLine(m[1]) : '';
  }
  /* 학습 기간: SP 에 없는 정보이므로 목표 유형에서 추정한 "제안 기본값"으로만 표시한다(사실로 단정하지 않는다). */
  function spanFor(goalText) {
    var t = goalText || '';
    if (/논문|학위|연구/.test(t)) return '학기~1년 (논문·연구 지도는 단계별 마일스톤으로 나눔)';
    if (/국가고시|전문의|자격|면허|시험|입시|수능|편입|LEET|MEET/i.test(t)) return '8~24주(단기 대비) 또는 6개월~1년(범위가 넓은 시험)';
    return '4~12주(단원·학기 단위), 목표 범위에 따라 6개월~1년까지 조정';
  }

  var LEVEL_NOTE = '유치원생부터 대학원생, 재직자의 평생교육까지 학습자 수준에 맞춰 같은 교수법 표준(Bloom 단계 등)으로 지도합니다(K-Professor 공통).';

  function roleTable(subject) {
    var rows = [
      ['학습 상담·개념 설명', subject + ' 개념을 수준에 맞춰 단계별로 설명하고 질문에 답합니다.', '학습자의 질문과 오개념을 지도하고, 난해한 쟁점을 직접 설명합니다.'],
      ['목표·학습 계획', '대화로 측정 가능한 목표와 주간·월간·분기·반기·연도 계획 초안을 작성합니다.', '목표의 현실성과 계획의 타당성을 검증합니다(선택, 권장).'],
      ['콘텐츠·시험 문항', '요약 노트, 연습 문항, 동영상 스크립트와 주간 시험을 만듭니다.', '내용의 정확성과 난이도를 감수합니다.'],
      ['평가', '주간 시험을 채점하고 피드백하며 통과 시 다음 주로 진행합니다(참고 지표).', '결과를 검토하고 학습 내용에 대한 승인 여부를 직접 판단합니다.'],
      ['공식 성적·자격', '판정하지 않습니다. 학교 성적·학점·학위·자격시험 합격은 해당 기관의 몫입니다.', '소속 기관의 평가 절차에 따라 공식 평가를 합니다.'],
      ['위기·학업윤리', '위기 신호가 보이면 학습을 멈추고 전문 상담 연계를 안내하며, 과제 대필은 하지 않습니다.', '학습자 상담과 지도를 이어 갑니다.']
    ];
    return '<div class="svc-table-wrap"><table class="svc-table"><thead><tr><th>업무</th><th>AI 교수(이 페이지)</th><th>인간 교수</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td class="doc-title">' + esc(r[0]) + '</td><td class="doc-detail">' + esc(r[1]) + '</td><td class="doc-detail">' + esc(r[2]) + '</td></tr>'; }).join('') +
      '</tbody></table></div>' +
      '<p class="svc-lead" style="margin-top:10px">이 도구는 인간 교수를 소개·추천·연결하지 않으며, 학습자가 직접 선택한 인간 교수에게 가져갈 검토 자료(목표·계획·시험·결과)를 정리해 줍니다. 승인을 대신 선언하지 않습니다.</p>';
  }

  function init() {
    var box = document.getElementById('startBox');
    if (!box) return;
    var main = document.getElementById('profBody');

    if (!validId) {
      box.innerHTML = '';
      var nf = el('div', { 'class': 'svc-callout important' });
      nf.innerHTML = '<b>교수 페르소나가 지정되지 않았습니다.</b> <a href="/pages/expert-personas.html">전문가 페르소나 목록</a>에서 과목을 선택해 주십시오.';
      box.appendChild(nf); if (main) main.hidden = true; return;
    }

    var state = { def: null, spFile: null, spText: '' };
    var chatFrame = null;

    /* 시작 영역: 탭 2개(학습 상담 / 방법론) */
    var tabs = el('div', { 'class': 'start-tabs', role: 'tablist', 'aria-label': '시작 방식' });
    var t1 = el('button', { type: 'button', 'class': 'start-tab active', role: 'tab', 'aria-selected': 'true' }, '학습 상담');
    var t2 = el('button', { type: 'button', 'class': 'start-tab', role: 'tab', 'aria-selected': 'false' }, '방법론');
    tabs.appendChild(t1); tabs.appendChild(t2);
    var chatMount = el('div', { id: 'profChatMount' });
    var intro = el('p', { 'class': 'sp-state', id: 'profChatIntro' }, '과목에 대해 질문하거나 학습 방향을 상담합니다. 목표 설정부터 인간 교수 검증까지 체계적으로 배우려면 상단 「학습 시작」을 누르세요.');
    box.appendChild(tabs); box.appendChild(chatMount); chatMount.appendChild(intro);
    chatFrame = el('iframe', { id: 'profChat', title: '교수 AI 대화창', loading: 'lazy', allow: 'microphone; camera; clipboard-write', src: '/pages/expert-chat.html?persona=' + encodeURIComponent(id) });
    chatFrame.style.cssText = 'display:block;width:100%;height:560px;border:1px solid #d9e2ec;border-radius:12px;background:#fff;margin-top:8px;color-scheme:light';
    chatMount.appendChild(chatFrame);
    var openRaw = el('a', { href: '/pages/expert-chat.html?persona=' + encodeURIComponent(id) + '&classic=1', target: '_blank', rel: 'noopener noreferrer', 'class': 'sp-view-raw' }, '대화창을 새 창에서 열기');
    openRaw.style.cssText = 'display:inline-block;margin-top:8px;font-size:13px';
    chatMount.appendChild(openRaw);

    /* 방법론 뷰(과목 SP 원문) */
    var view = el('section', { 'class': 'sp-view', id: 'spView', 'aria-label': '방법론(시스템 프롬프트 원문)', 'aria-hidden': 'true' });
    var inner = el('div', { 'class': 'sp-view-inner' });
    var bar = el('div', { 'class': 'sp-view-bar' });
    var barTitle = el('span', { 'class': 'sp-view-title' }, '방법론 — 시스템 프롬프트(SP) 원문');
    var raw = el('a', { 'class': 'sp-view-raw', href: '#', target: '_blank', rel: 'noopener noreferrer' }, '원문 열기'); raw.hidden = true;
    bar.appendChild(barTitle); bar.appendChild(raw);
    var mdEl = el('article', { 'class': 'sp-md', id: 'spMd' });
    mdEl.appendChild(el('p', { 'class': 'sp-state' }, '「방법론」 탭을 누르면 불러옵니다.'));
    inner.appendChild(bar); inner.appendChild(mdEl); view.appendChild(inner);
    box.parentNode.insertBefore(view, box.nextSibling);

    var mode = 'chat';
    function select(next) {
      if (next === mode) return; mode = next;
      var method = next === 'method';
      [[t1, !method], [t2, method]].forEach(function (p) { p[0].classList.toggle('active', p[1]); p[0].setAttribute('aria-selected', p[1] ? 'true' : 'false'); });
      chatMount.hidden = method;
      box.classList.toggle('is-method', method);
      view.classList.toggle('open', method); view.setAttribute('aria-hidden', method ? 'false' : 'true');
      if (method) renderMethod();
    }
    t1.addEventListener('click', function () { select('chat'); });
    t2.addEventListener('click', function () { select('method'); });

    function renderMethod() {
      if (!state.spText) { mdEl.innerHTML = '<p class="sp-state">방법론 파일을 찾지 못했습니다.</p>'; return; }
      mdEl.innerHTML = md(state.spText);
      raw.href = '/prompts/' + state.spFile; raw.hidden = false;
    }

    /* 등록 정보 + SP 로드 → 과목별 본문 */
    Promise.all([
      import('/src/gopang/ai/expert-registry.js').then(function (m) { return m.EXPERT_REGISTRY || {}; }).catch(function (e) { console.warn('[professor-persona] 레지스트리 로드 실패', e); return {}; }),
      fetch('/prompts/sp-catalog.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; })
    ]).then(function (res) {
      var reg = res[0], cat = res[1];
      var def = reg[id] || null;
      if (!def) { return { reg: reg, def: null, file: null }; }
      var file = cat[def.key] || null;
      return { reg: reg, def: def, file: file };
    }).then(function (r) {
      if (!r.def) { renderMissing(); return; }
      state.def = r.def; state.spFile = r.file;
      var subject = shortLabel(r.def.label || id);
      applyHeader(subject);
      if (!r.file) { renderBody(subject, r, ''); return; }
      return fetch('/prompts/' + r.file, { cache: 'no-cache' }).then(function (x) { if (!x.ok) throw new Error('sp ' + x.status); return x.text(); })
        .then(function (txt) { state.spText = txt; renderBody(subject, r, txt); })
        .catch(function (e) { console.error('[professor-persona] SP 로드 실패', e); renderBody(subject, r, ''); });
    });

    function renderMissing() {
      if (main) main.hidden = true;
      chatMount.hidden = true; tabs.hidden = true;
      var nf = el('div', { 'class': 'svc-callout important' });
      nf.innerHTML = '<b>「' + esc(id) + '」</b> 에 해당하는 교수 페르소나가 없습니다. <a href="/pages/expert-personas.html">전문가 페르소나 목록</a>에서 과목을 선택해 주십시오.';
      box.insertBefore(nf, box.firstChild);
    }

    function applyHeader(subject) {
      document.title = subject + ' 교수 보조 AI — 나비';
      var tag = document.querySelector('.ph-hero-tag'); if (tag) { tag.lastChild.nodeValue = '전문가 페르소나 · ' + subject + ' 교수 보조 AI'; }
      var h1 = document.querySelector('.ph-hero h1'); if (h1) h1.innerHTML = esc(subject) + ' 학습을 대화로 설계하고<br>인간 교수의 지도를 보조합니다';
      var cta = document.querySelector('.ph-hero-cta'); if (cta) cta.setAttribute('title', subject + ' 학습의 목표 설정부터 인간 교수 검증까지 10단계를 시작합니다');
      barTitle.textContent = subject + ' 방법론 — 시스템 프롬프트(SP) 원문';
      var iframe = document.getElementById('profChat'); if (iframe) iframe.title = subject + ' 교수 AI 대화창';
    }

    function renderBody(subject, r, spText) {
      var secs = spText ? sections(spText) : [];
      var scope = secs.filter(function (s) { return /^(세부분야 경계|이 중계열이 다루는 범위|이 중계열 공통의 지도 원칙|하위 소계열)/.test(s.h); });
      var hooks = secs.filter(function (s) { return /오케스트레이션 3훅/.test(s.h); })[0];
      var tier = secs.filter(function (s) { return /^정확도 유의/.test(s.h); })[0];
      var goals = hooks ? hook(hooks.body, '①') : '';
      var needs = hooks ? hook(hooks.body, '②') : '';
      var autos = hooks ? hook(hooks.body, '③') : '';

      /* 헤더 설명(sub): 첫 번째 경계 문단 */
      if (scope.length) {
        var firstPara = oneLine(scope[0].body.split(/\n\s*\n/)[0]);
        var sub = document.querySelector('.ph-hero-inner > p:not([class])');
        if (sub && firstPara) sub.textContent = firstPara.length > 160 ? firstPara.slice(0, 158) + '…' : firstPara;
      }

      var how = document.getElementById('profHow');
      if (how) how.innerHTML = '<b>이용 방법</b> ① 위 「학습 상담」에서 ' + esc(subject) + ' 질문이나 학습 방향을 상담합니다. ② 체계적인 학습이 필요하면 상단의 「학습 시작」을 누릅니다. 현황 파악 → 목표 결정 → 과목별 AI 교수 선정 → 학습 계획 → 콘텐츠 → 시험 설계 → 주간 학습(주간 시험 통과 시 다음 주) → 최종 평가 → 조기 이수·기간 연장 → 인간 교수 검증의 10단계로 진행합니다. ③ 시험과 점수는 형성평가 참고 지표이며 공식 성적이 아닙니다.';

      var roles = document.getElementById('profRoles');
      if (roles) roles.innerHTML = '<h2>인간 교수와 AI 교수의 역할 분담</h2><p class="svc-lead">' + esc(subject) + ' 교수 보조 AI는 인간 교수의 업무를 대신하지 않고 보조합니다.</p>' + roleTable(subject);

      var scopeEl = document.getElementById('profScope');
      if (scopeEl) {
        var h = '<h2>다루는 지식 분야</h2>';
        if (scope.length) {
          scope.forEach(function (s) {
            var parts = s.h.split(/\s+[—-]\s+/); var title = parts[0].replace(/\s*\(.*\)\s*$/, '');
            h += '<h3>' + esc(/^세부분야 경계/.test(title) ? '범위와 경계' : title) + '</h3>';
            if (parts[1]) h += '<p class="svc-lead">' + esc(parts.slice(1).join(' — ')) + '</p>';
            h += '<div class="sp-md">' + md(s.body) + '</div>';
          });
        } else {
          h += '<p class="svc-lead">이 과목의 세부 범위는 방법론(시스템 프롬프트) 원문을 확인해 주십시오.</p>';
        }
        scopeEl.innerHTML = h;
      }

      var learn = document.getElementById('profLearner');
      if (learn) {
        var rows = [
          ['대상 학생·학습자', LEVEL_NOTE + (needs ? ' 이 과목은 ' + needs : '')],
          ['대표 학습 목표', goals || '학습자의 목표(시험·전공·역량)를 대화로 정해 측정 가능한 목표로 바꿉니다.'],
          ['학습 기간(제안 기본값)', spanFor(goals + ' ' + needs) + ' — SP에 정해진 기간이 아니라, 학습 트랙에서 목표·수준에 맞춰 조정하는 기본 제안입니다.'],
          ['조회·자동화 범위', autos || '법령·교육과정·시험 일정 등 변경되는 정보는 조회로 확인하고, 본인 인증이 필요한 신청·응시는 학습자 본인이 직접 합니다.']
        ];
        learn.innerHTML = '<h2>대상 학습자와 학습 기간</h2><p class="svc-lead">아래 내용은 이 과목의 SP에서 읽어 온 대표 목표와 학습자 조건입니다.</p><div class="svc-table-wrap"><table class="svc-table"><thead><tr><th>항목</th><th>내용</th></tr></thead><tbody>' +
          rows.map(function (x) { return '<tr><td class="doc-title">' + esc(x[0]) + '</td><td class="doc-detail">' + esc(x[1]) + '</td></tr>'; }).join('') + '</tbody></table></div>';
      }

      var tierEl = document.getElementById('profTier');
      if (tierEl) {
        tierEl.innerHTML = tier ? '<h2>정확도 유의</h2><p class="svc-lead">내용의 종류에 따라 확인 수준이 다릅니다. 등급이 높은 항목은 조회·인간 교수 확인을 거치도록 안내합니다.</p><div class="sp-md">' + md(tier.body) + '</div>' : '';
      }

      /* 같은 계열·하위 계열 */
      var rel = document.getElementById('profRelated');
      if (rel) {
        var reg = r.reg, pk = r.def.parentKey, out = [];
        var kids = Object.keys(reg).filter(function (k) { return /^professor/.test(k) && reg[k].parentKey === id; });
        var sibs = pk ? Object.keys(reg).filter(function (k) { return /^professor/.test(k) && k !== id && reg[k].parentKey === pk; }) : [];
        function chips(list) { return '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">' + list.map(function (k) { return '<a class="svc-link-btn sm" href="/pages/professor-persona.html?persona=' + encodeURIComponent(k) + '">' + esc(shortLabel(reg[k].label)) + '</a>'; }).join('') + '</div>'; }
        var h2 = '';
        if (pk && reg[pk]) h2 += '<p class="svc-lead">상위 계열: <a href="/pages/professor-persona.html?persona=' + encodeURIComponent(pk) + '">' + esc(shortLabel(reg[pk].label)) + '</a></p>';
        if (kids.length) h2 += '<h3>하위 분야</h3>' + chips(kids.slice(0, 60));
        if (sibs.length) h2 += '<h3>같은 계열의 다른 과목</h3>' + chips(sibs.slice(0, 40));
        rel.innerHTML = h2 ? '<h2>관련 과목</h2>' + h2 : '';
      }

      var lim = document.getElementById('profLimits');
      if (lim) lim.innerHTML = '<h2>이 페이지의 미비점·한계</h2><p class="svc-lead">이 페이지와 교수 보조 AI는 초안 단계입니다.</p><ul><li>학습 진행 표시는 이 브라우저에만 저장되며 다른 기기로 이어지지 않습니다.</li><li>동영상은 스크립트·스토리보드와 확인된 공개 강의 안내까지만 제공하며, 영상 파일은 만들지 못합니다.</li><li>학습 기간은 SP에 정해진 값이 아니라 목표에 따른 제안 기본값입니다.</li><li>이 과목 SP에 적힌 범위 밖의 내용이나 최신 교육과정·시험 정보는 조회로 확인하지 못하면 미확인으로 표시합니다.</li></ul>';
    }

    /* 상단 메뉴 오른쪽 버튼: 「💬 제안 및 질문」 — 전문가 페르소나 페이지와 같은 위치·모양 */
    setTimeout(function () {
      var navRight = document.querySelector('.topnav-right'); if (!navRight || document.getElementById('sqNavBtn')) return;
      navRight.insertBefore(el('a', { id: 'sqNavBtn', 'class': 'sq-nav-btn', href: '/pages/suggest.html?from=' + encodeURIComponent(id), title: '혼디에 바라는 점이나 궁금한 점을 말씀해 주세요' }, '💬 제안 및 질문'), navRight.firstChild);
    }, 0);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
