/* patent-flow.js — 신규 발명의 특허 출원 준비 단계형 화면 (변리사 보조 AI, 2026-10-21 신설)

   참고: klaw.hondi.net/verdict-generate.html (입력 필드·첨부 아이콘·진행 표시·결과 패널 구성).
   기반 SP: prompts/SP_patent-attorney-assistant (STEP T 발명 출원 트랙) — SP는 이 파일에 복제하지 않고 매 호출마다 매니페스트로 받는다.

   ■ 이 화면이 하지 않는 일 (SP §LEGAL-LIMIT): 지식재산처에 제출하지 않고, 수수료를 납부하지 않고, 서명·날인하지 않는다.
     18·19단계는 변리사 또는 이용자 본인이 직접 하는 일의 안내와 완료 기록이고, 17단계는 이 화면 밖에서 이루어지는 인간 변리사의 최종 검토 결과를 기록하는 단계다.
   ■ 평가 수치(PRI)는 참고 지표다. 사용자 등급(L2·L3)이 플랫폼 인증으로 확인된 경우(window.PATENT_FLOW_TIER)에만 수치를 보인다.
   ■ 검색은 워커의 POST /web-search(스니펫 상위 5건)뿐이다. 청구항 원문은 이용자가 첨부해야 "원문 확인"이 되며, 그렇지 않으면 조사확신도에 상한이 걸린다. */
(function () {
  'use strict';
  var WORKER = 'https://hondi-proxy.tensor-city.workers.dev';
  var SP_KEY = 'SP_patent-attorney-assistant';
  var STORE = 'pf_state_v1';
  var GATE = 90, MAX_ROUNDS = 5, MAX_Q = 6, SESSION_Q = 30, PRI_CAP = 95;   // 워커의 일일 검색 한도(전 이용자 공유)를 지키기 위한 세션당 상한
  var MODEL_FAST = 'deepseek-v4-flash', MODEL_DEEP = 'deepseek-v4-pro';

  var STAGES = [
    { id: 'idea',      n: 1,  g: 1, t: '핵심 아이디어 입력',            kind: 'user' },
    { id: 'search',    n: 2,  g: 2, t: '선행 기술 조사·출력',           kind: 'auto' },
    { id: 'tasks',     n: 3,  g: 2, t: '차별화 과제 제시',              kind: 'auto' },
    { id: 'diff',      n: 4,  g: 2, t: '차별화 아이디어 제출',          kind: 'user' },
    { id: 'eval1',     n: 5,  g: 2, t: '차별화 아이디어 평가',          kind: 'auto' },
    { id: 'supp',      n: 6,  g: 2, t: '보완 아이디어 제출',            kind: 'user', loop: true },
    { id: 'research',  n: 7,  g: 2, t: '재조사·차별화 수준 평가',       kind: 'auto', loop: true },
    { id: 'newtasks',  n: 8,  g: 2, t: '새로운 차별화 과제 제시',       kind: 'auto', loop: true },
    { id: 'pri',       n: 9,  g: 2, t: '차별화·취득 가능성 평가',       kind: 'auto', loop: true },
    { id: 'spec',      n: 10, g: 3, t: '명세서 초안 작성',              kind: 'auto' },
    { id: 'review',    n: 11, g: 3, t: '명세서 검토·보완(발명자)',      kind: 'user' },
    { id: 'specfinal', n: 12, g: 3, t: '최종 명세서 작성',              kind: 'auto' },
    { id: 'draw',      n: 13, g: 4, t: '도면 작성',                     kind: 'auto' },
    { id: 'claims',    n: 14, g: 4, t: '청구항 작성',                   kind: 'auto' },
    { id: 'claimeval', n: 15, g: 4, t: '청구범위·권리 확보 수준 평가',  kind: 'auto' },
    { id: 'confirm',   n: 16, g: 5, t: '최종 출원서 확정',              kind: 'user' },
    { id: 'attorney',  n: 17, g: 5, t: '인간 변리사 최종 검토',          kind: 'user' },
    { id: 'submit',    n: 18, g: 5, t: '출원서 제출 (직접)',            kind: 'manual' },
    { id: 'fee',       n: 19, g: 5, t: '수수료 납부 (직접)',            kind: 'manual' }
  ];
  var GROUPS = ['', '아이디어 입력', '선행기술·차별화', '명세서', '도면·청구범위', '검토·출원·납부'];
  var SEV_W = { Critical: 5, Major: 3, Minor: 1 };

  /* ───────── 유틸 ───────── */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function stageOf(id) { for (var i = 0; i < STAGES.length; i++) if (STAGES[i].id === id) return STAGES[i]; return null; }
  function idxOf(id) { for (var i = 0; i < STAGES.length; i++) if (STAGES[i].id === id) return i; return -1; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* 안전한 마크다운 → HTML (먼저 전부 이스케이프하고, 허용 문법만 되살린다) */
  function md(src) {
    var lines = String(src == null ? '' : src).replace(/\r/g, '').split('\n'), out = [], i = 0, list = null;
    function inline(t) {
      t = esc(t);
      t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
      t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, function (m, a, u) { return '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + a + '</a>'; });
      return t;
    }
    function closeList() { if (list) { out.push('</' + list + '>'); list = null; } }
    while (i < lines.length) {
      var l = lines[i];
      if (/^```/.test(l)) { closeList(); var buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; } i++; out.push('<pre>' + esc(buf.join('\n')) + '</pre>'); continue; }
      if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|[\s:\-|]+\|\s*$/.test(lines[i + 1])) {
        closeList();
        var head = l.trim().replace(/^\||\|$/g, '').split('|'), rows = []; i += 2;
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|')); i++; }
        out.push('<div class="pf-tw"><table class="pf-table"><thead><tr>' + head.map(function (c) { return '<th>' + inline(c.trim()) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + inline(c.trim()) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>');
        continue;
      }
      var h = l.match(/^(#{1,4})\s+(.*)$/);
      if (h) { closeList(); var lv = Math.min(h[1].length + 1, 5); out.push('<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>'); i++; continue; }
      var ul = l.match(/^\s*[-*]\s+(.*)$/), ol = l.match(/^\s*\d+[.)]\s+(.*)$/);
      if (ul || ol) { var tag = ul ? 'ul' : 'ol'; if (list !== tag) { closeList(); out.push('<' + tag + '>'); list = tag; } out.push('<li>' + inline((ul || ol)[1]) + '</li>'); i++; continue; }
      if (/^\s*$/.test(l)) { closeList(); i++; continue; }
      if (/^---+\s*$/.test(l)) { closeList(); out.push('<hr>'); i++; continue; }
      closeList(); out.push('<p>' + inline(l) + '</p>'); i++;
    }
    closeList();
    return out.join('');
  }

  /* LLM이 낸 JSON을 관대하게 읽는다 */
  function parseJSON(text) {
    var t = String(text || '').trim();
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(t); } catch (e) { /* 다음 시도 */ }
    var a = t.search(/[\[{]/); if (a < 0) return null;
    var open = t[a], close = open === '{' ? '}' : ']', b = t.lastIndexOf(close);
    if (b <= a) return null;
    try { return JSON.parse(t.slice(a, b + 1)); } catch (e2) { return null; }
  }
  /* "===이름===" 구분자 문서를 읽는다 */
  function parseSections(text) {
    var out = {}, re = /^===\s*([A-Za-z0-9가-힣_ .:|\-]+?)\s*===\s*$/gm, m, last = null, lastIdx = 0, s = String(text || '');
    while ((m = re.exec(s))) {
      if (last !== null) out[last] = s.slice(lastIdx, m.index).trim();
      last = m[1].trim(); lastIdx = re.lastIndex;
    }
    if (last !== null) out[last] = s.slice(lastIdx).trim();
    return out;
  }

  /* SVG 정화: 허용 요소·속성만 남기고 스크립트·이벤트·외부 참조를 모두 제거한다 */
  var SVG_OK = { svg: 1, g: 1, rect: 1, circle: 1, ellipse: 1, line: 1, polyline: 1, polygon: 1, path: 1, text: 1, tspan: 1, defs: 1, marker: 1, title: 1, desc: 1 };
  var ATTR_OK = /^(x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|width|height|d|points|transform|viewBox|preserveAspectRatio|fill|stroke|stroke-width|stroke-dasharray|stroke-linecap|stroke-linejoin|font-size|font-family|font-weight|text-anchor|dominant-baseline|marker-start|marker-end|markerWidth|markerHeight|refX|refY|orient|id|opacity|xmlns)$/;
  function sanitizeSvg(src) {
    try {
      var doc = new DOMParser().parseFromString(String(src), 'image/svg+xml');
      if (doc.getElementsByTagName('parsererror').length) return null;
      var root = doc.documentElement;
      if (!root || root.nodeName.toLowerCase() !== 'svg') return null;
      (function walk(node) {
        var kids = Array.prototype.slice.call(node.childNodes);
        kids.forEach(function (c) {
          if (c.nodeType === 1) {
            var nm = c.nodeName.toLowerCase();
            if (!SVG_OK[nm]) { node.removeChild(c); return; }
            Array.prototype.slice.call(c.attributes).forEach(function (a) {
              var an = a.name, v = a.value;
              if (!ATTR_OK.test(an) || /url\s*\(|javascript:|data:|<|&#/i.test(v) && !/^marker-(start|end)$/.test(an)) c.removeAttribute(an);
              else if (/^marker-(start|end)$/.test(an) && !/^url\(#[A-Za-z0-9_\-]+\)$/.test(v)) c.removeAttribute(an);
            });
            walk(c);
          } else if (c.nodeType !== 3) node.removeChild(c);
        });
      })(root);
      Array.prototype.slice.call(root.attributes).forEach(function (a) { if (!ATTR_OK.test(a.name)) root.removeAttribute(a.name); });
      if (!root.getAttribute('viewBox')) root.setAttribute('viewBox', '0 0 600 400');
      root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      root.removeAttribute('width'); root.removeAttribute('height');
      return new XMLSerializer().serializeToString(root);
    } catch (e) { return null; }
  }

  /* ───────── 상태 ───────── */
  var S = null, IMG = [], busy = false, view = null, SP_CACHE = null, toastTimer = null;

  function fresh() {
    return {
      v: 1, stage: 'idea', done: {}, round: 0, consent: false, clientOk: false, who: 'attorney',   // 기본 이용자는 인간 변리사
      disclosure: { status: '', date: '' }, avoid: '', input: {},
      idea: { text: '', files: [] }, idr: '', idrOk: false,
      searches: [], docs: [], verified: {}, tasks: [], taskMd: '',
      ideas: [], evals: [], priHist: [], halt: null, waived: [],
      spec: { v: 0, body: '', overview: '', notes: '' }, defects: [], reviews: [], specGate: null, specFinalMd: '',
      figs: [], abstract: '', figDoc: '',
      claims: { body: '', mapping: '', v: 0 }, cdefects: [], creviews: [], claimScores: null,
      biblio: { who: 'person', name: '', addr: '', code: '', inventors: '' },
      attorney: { type: 'self_attorney', name: '', firm: '', date: '', result: '', opinion: '', files: [], chk: {}, hist: [], skipped: false, typed: '' },
      confirmed: false, filing: { done: false, appNo: '', date: '' }, fee: { done: false, date: '', hits: [] }, docs_out: []
    };
  }
  function save() { try { sessionStorage.setItem(STORE, JSON.stringify(S)); } catch (e) { /* 저장 실패는 무시 */ } }
  function load() {
    try { var t = sessionStorage.getItem(STORE); if (t) { var o = JSON.parse(t); if (o && o.v === 1) return o; } } catch (e) { /* 무시 */ }
    return null;
  }

  /* ───────── 평가 계산(수치는 화면이 직접 계산한다 — LLM 산수를 믿지 않는다) ───────── */
  function coverage() {
    var c = { dom: 0, foreign: 0, np: 0, any: 0, high: 0, verified: 0, failed: 0 };
    S.searches.forEach(function (r) {
      r.queries.forEach(function (q) {
        if (q.status === 'ok' && q.results && q.results.length) { c.any++; if (q.cat === 'domestic') c.dom++; else if (q.cat === 'foreign') c.foreign++; else c.np++; }
        if (q.status === 'fail') c.failed++;
      });
    });
    S.docs.forEach(function (d) { if (d.relevance === 'high') { c.high++; if (S.verified[d.link]) c.verified++; } });
    return c;
  }
  /* 조사확신도 상한 — 부록 T-A의 R 열을 이 화면의 검색 능력에 맞춰 결정적으로 적용한다 */
  function rCap() {
    var c = coverage();
    if (!c.any) return 30;
    var base = !c.dom ? 60 : (!c.foreign ? 74 : (!c.np ? 89 : PRI_CAP));
    var need = Math.min(3, c.high);
    if (c.high > 0 && c.verified < need) base = Math.min(base, 84);   // 청구항 원문 미확인(스니펫만) → 90 불가
    return base;
  }
  function clamp(n) { n = Number(n); if (!isFinite(n)) return 0; return Math.max(0, Math.min(100, Math.round(n))); }
  function computePRI(raw) {
    var N = clamp(raw.N && raw.N.score), I = clamp(raw.I && raw.I.score), Sx = clamp(raw.S && raw.S.score);
    if (raw.I && raw.I.rebuttal_possible === false) I = Math.min(I, 89);
    var cap = rCap(), R = Math.min(clamp(raw.R_llm == null ? 100 : raw.R_llm), cap);
    var pri = Math.min(N, I, Sx, R, PRI_CAP), notes = [];
    if (S.disclosure.status !== 'no' && S.disclosure.status !== 'yes') { pri = Math.min(pri, 60); notes.push('공개 이력 미확인 — 상한 60'); }
    var oc = Math.max(0, parseInt(raw.open_critical, 10) || 0);
    var gate = pri >= GATE && oc === 0 && S.idrOk;
    if (pri >= GATE && oc > 0) notes.push('미해결 핵심(Critical) 과제 ' + oc + '건');
    if (pri >= GATE && !S.idrOk) notes.push('발명 특정서 미확정');
    return { N: N, I: I, S: Sx, R: R, rcap: cap, pri: pri, openCritical: oc, gate: gate, notes: notes };
  }
  function band(score) { return score >= 90 ? '충족' : score >= 75 ? '근접' : score >= 50 ? '보완 필요' : '미흡'; }
  function showNum() { var t = String(window.PATENT_FLOW_TIER || '').toUpperCase(); return t === 'L2' || t === 'L3'; }

  /* 결함 레지스터 지표 (K-Law의 "제거율 + 신규 중대결함 0 + 서로 다른 검토 인스턴스" 규칙) */
  function metrics(defects, reviews) {
    var total = 0, resolved = 0, openC = 0, lastRound = reviews.length, newMajor = 0, models = {};
    defects.forEach(function (d) {
      var w = SEV_W[d.sev] || 1; total += w;
      if (d.status !== 'open') resolved += w;
      if (d.status === 'open' && d.sev === 'Critical') openC++;
      if (d.round === lastRound && (d.sev === 'Critical' || d.sev === 'Major')) newMajor++;
    });
    reviews.forEach(function (r) { models[r.model] = 1; });
    var rate = total ? resolved / total : (reviews.length ? 1 : 0), nm = Object.keys(models).length;
    var ok = reviews.length >= 2 && nm >= 2 && rate >= 0.9 && openC === 0 && newMajor === 0;
    return { total: total, resolved: resolved, rate: rate, openCritical: openC, newMajorLast: newMajor, rounds: reviews.length, models: nm, ok: ok };
  }

  /* 후속 일정 (법정 기한은 반드시 현행 규정으로 재확인 — 화면에도 그렇게 표시) */
  function addMonths(dateStr, m) { var p = String(dateStr).split('-'); var d = new Date(+p[0], +p[1] - 1 + m, +p[2]); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function addDays(dateStr, n) { var p = String(dateStr).split('-'); var d = new Date(+p[0], +p[1] - 1, +p[2] + n); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function followDates(appDate, hasDisclosure) {
    var rows = [
      ['심사청구 기한(출원일부터 3년)', addMonths(appDate, 36)],
      ['출원공개 시점(출원일 또는 우선일부터 1년 6개월)', addMonths(appDate, 18)],
      ['국내·국외 우선권 주장 기한(최초 출원일부터 1년)', addMonths(appDate, 12)]
    ];
    if (hasDisclosure) rows.push(['공지예외 증명서류 제출(출원일부터 30일)', addDays(appDate, 30)]);
    return rows;
  }

  /* ───────── 통신 ───────── */
  async function authFetch(url, opt) {
    if (window.KAuth && typeof window.KAuth.fetchWithAuth === 'function') return window.KAuth.fetchWithAuth(url, opt);
    return fetch(url, opt);
  }
  async function ensureLogin() {
    if (window.KAuth && typeof window.KAuth.ensureLogin === 'function') {
      await window.KAuth.ensureLogin();
      if (typeof window.KAuth.hasValidLogin === 'function' && !window.KAuth.hasValidLogin()) throw new Error('로그인이 필요합니다.');
    }
  }
  async function loadSP() {
    if (SP_CACHE) return SP_CACHE;
    var m = await fetch('/prompts/sp-catalog.json', { cache: 'no-cache' });
    if (!m.ok) throw new Error('SP 매니페스트를 불러오지 못했습니다(' + m.status + ')');
    var man = await m.json(), fname = man[SP_KEY];
    if (!fname) throw new Error('매니페스트에 ' + SP_KEY + ' 키가 없습니다');
    var r = await fetch('/prompts/' + fname, { cache: 'no-cache' });
    if (!r.ok) throw new Error('SP를 불러오지 못했습니다(' + r.status + ')');
    var t = await r.text();
    if (!t || t.length < 50) throw new Error('SP 내용이 비정상적으로 짧습니다');
    SP_CACHE = t; return t;
  }
  var COMMON = [
    '이 호출은 변리사 보조 AI의 \'발명 출원 진행\' 화면이 단계별로 부르는 한 번짜리 작업이다. SP의 §LEGAL-LIMIT와 STEP T 규율(T-0)을 그대로 따른다.',
    '- 요청한 출력 형식(JSON 또는 === 구분자 문서)만 쓴다. 인사·안내 문장·[NEXT_STEP]·[초안 검토 고지]·코드펜스를 덧붙이지 않는다(화면이 붙인다).',
    '- 검색은 이 화면이 수행한다. 응답에 [WEB_SEARCH] 등의 태그를 쓰지 않는다. 입력으로 주어진 조회 결과에 없는 문헌·번호·수치는 인용하지 않는다.',
    '- 이용자가 말하지 않은 실시예·수치·효과·사실을 만들지 않는다. 필요하면 [발명자 확인 필요: …]로 표시한다.',
    '- 등록·거절을 단정하지 않는다. 평가는 참고 지표이며 판단은 변리사가 한다. 이용자는 "이용자", 도구는 "변리사 보조 AI", 기관은 "지식재산처(구 특허청)"로 쓴다.'
  ].join('\n');

  async function llm(stageCtx, userText, opt) {
    opt = opt || {};
    await ensureLogin();
    var sp = await loadSP();
    var system = sp + '\n\n---\n[현재 화면 컨텍스트]\n' + COMMON + '\n\n' + stageCtx;
    var content = userText;
    if (opt.images && opt.images.length) {
      content = [{ type: 'text', text: userText }].concat(opt.images.map(function (u) { return { type: 'image_url', image_url: { url: u } }; }));
    }
    var body = JSON.stringify({ provider: 'deepseek', model: opt.model || MODEL_FAST, system: system, messages: [{ role: 'user', content: content }], max_tokens: opt.max || 4096 });
    var res = await authFetch(WORKER + '/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body });
    if (!res.ok) throw new Error('AI 서버 오류(' + res.status + ')');
    var data = await res.json();
    if (!data || !data.content) throw new Error('AI 응답이 비어 있습니다');
    return String(data.content);
  }
  async function llmJSON(stageCtx, userText, opt) {
    var t = await llm(stageCtx, userText, opt), j = parseJSON(t);
    if (j) return j;
    t = await llm(stageCtx, userText + '\n\n[재요청] 직전 응답을 JSON으로 읽지 못했다. 설명 없이 JSON 하나만 다시 출력하라.', opt);
    j = parseJSON(t);
    if (!j) throw new Error('AI가 형식에 맞지 않는 답을 냈습니다. 다시 시도해 주세요.');
    return j;
  }
  async function webSearch(q) {
    try {
      var r = await fetch(WORKER + '/web-search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) });
      var d = await r.json().catch(function () { return {}; });
      if (!r.ok) return { ok: false, status: r.status, error: d.error || ('HTTP ' + r.status), message: d.message || '' };
      return { ok: true, organic: (d.organic || []).slice(0, 5).map(function (o) { return { title: String(o.title || ''), link: String(o.link || ''), snippet: String(o.snippet || '') }; }) };
    } catch (e) { return { ok: false, status: 0, error: 'NETWORK', message: e.message }; }
  }

  /* ═════════════════ 입력 블록 ═════════════════ */
  function disclosureLabel() { return S.disclosure.status === 'no' ? '없음' : S.disclosure.status === 'yes' ? '있음(' + (S.disclosure.date || '일자 미입력') + ')' : '모름(미확인)'; }
  function ideaBlock() {
    var t = '[이용자 입력 — 핵심 아이디어]\n' + S.idea.text;
    S.idea.files.forEach(function (f) { t += '\n\n[첨부: ' + f.name + ']' + (f.text ? '\n' + f.text.slice(0, 8000) : ' — ' + (f.note || '본문을 읽지 못함')); });
    return t + '\n\n[공개 이력] ' + disclosureLabel();
  }
  function ideasBlock() {
    if (!S.ideas.length) return '(아직 없음)';
    return S.ideas.map(function (x) { return '[' + (x.kind === 'diff' ? '차별화 아이디어' : '보완 아이디어') + ' · 라운드 ' + x.round + ']\n' + x.text + (x.files && x.files.length ? x.files.map(function (f) { return '\n[첨부: ' + f.name + ']' + (f.text ? '\n' + f.text.slice(0, 4000) : ' (본문 없음)'); }).join('') : ''); }).join('\n\n');
  }
  function docsBlock(onlyRated) {
    var list = S.docs.filter(function (d) { return !onlyRated || d.relevance; });
    if (!list.length) return '(조회된 문헌 없음)';
    return list.map(function (d) { return '[' + d.ref + '] ' + d.title + ' | ' + d.link + ' | 분류:' + d.cat + ' | 관련도:' + (d.relevance || '미평가') + ' | 근거:' + (S.verified[d.link] ? '원문 확인(이용자 첨부)' : '검색 스니펫') + (d.snippet ? '\n    스니펫: ' + d.snippet.slice(0, 260) : '') + (S.verified[d.link] ? '\n    원문 발췌: ' + S.verified[d.link].text.slice(0, 1800) : ''); }).join('\n');
  }
  function cmpBlock() { return S.cmp ? ('[대비표·분석(라운드 ' + S.cmp.round + ')]\n' + S.cmp.md + '\n[미개시로 보이는 구성(추정)] ' + (S.cmp.gaps || []).join('; ') + '\n[한계] ' + (S.cmp.limits || '')) : '(대비표 없음)'; }
  function tasksBlock() { return S.tasks.length ? S.tasks.map(function (t) { return t.id + '. ' + t.title + (t.critical ? ' [핵심]' : '') + ' — ' + t.why + ' (필요: ' + t.need + ')'; }).join('\n') : '(없음)'; }

  /* ═════════════════ 검색 라운드 ═════════════════ */
  var CTX_IDR = '[작업: 발명 특정서(IDR) 정리] 이용자 입력만으로 발명 특정서를 마크다운으로 정리한다. 항목: 한 줄 요약(문제→수단→효과) / 종래 기술과 한계 / 구성요소(E1…En, 역할, 필수·선택 표시) / 동작·처리 순서 / 변형예 / 실시 조건·수치 / 효과와 정량 근거 / 도면 소재 / 미확정 항목. 각 줄 끝에 출처를 (F)=이용자 진술로 표시한다. 이용자가 말하지 않은 내용은 쓰지 않고 "미확정"으로 적는다. 소프트웨어·BM이면 하드웨어·데이터·제어 관계를 별도 항목으로 적는다. 마크다운 본문만 출력한다.';
  var CTX_PLAN = '[작업: 선행기술 검색 질의 설계] 발명 특정서와 입력을 읽고 검색 질의를 만든다. 규칙: ① 총 6개 이하 ② domestic(한국어, 특허·공개공보 키워드) 2~3개, foreign(영어, patent 포함) 2~3개, nonpatent(논문·제품·표준) 1~2개 ③ 질의에는 구성요소를 추상화한 일반 용어만 쓴다 — 고유 명칭·상표·회사명·수치·핵심 구성의 조합은 비밀이므로 넣지 않는다 ④ 이미 쓴 질의는 반복하지 않는다 ⑤ site:patents.google.com 같은 연산자를 쓸 수 있다. 출력은 JSON 하나: {"queries":[{"cat":"domestic|foreign|nonpatent","q":"질의"}]}';
  var CTX_ANALYZE = '[작업: 조회 결과 분석·구성요소 대비] 아래 "조회 결과"의 제목·스니펫만 근거로 분석한다. 스니펫에 없는 청구항·도면·수치는 쓰지 않으며, 근거가 없으면 "불명"이다. 조회 결과에 없는 문헌은 만들지 않는다. 출력은 JSON 하나: {"docs":[{"ref":"D1","relevance":"high|mid|low","elements_disclosed":["E1"],"note":"한 문장"}],"comparison_md":"구성요소(E1…) × 관련 문헌(상위 6건 이하, ref) 표. 셀은 개시/미개시/유사/불명","key_gaps":["모든 문헌에서 미개시로 보이는 구성 또는 구성 간 관계(스니펫 기준 추정)"],"limits":"조사의 한계 한두 문장"}';

  function normQueries(arr) {
    var avoid = String(S.avoid || '').split(/[,，\n]/).map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
    var used = {}; S.searches.forEach(function (r) { r.queries.forEach(function (q) { used[q.q.toLowerCase()] = 1; }); });
    var out = [], cnt = { domestic: 0, foreign: 0, nonpatent: 0 };
    (Array.isArray(arr) ? arr : []).forEach(function (x) {
      if (!x || typeof x.q !== 'string') return;
      var cat = cnt.hasOwnProperty(x.cat) ? x.cat : null, q = x.q.replace(/\s+/g, ' ').trim();
      if (!cat || q.length < 3 || q.length > 140 || used[q.toLowerCase()] || cnt[cat] >= 3 || out.length >= MAX_Q) return;
      var low = q.toLowerCase();
      if (avoid.some(function (a) { return low.indexOf(a) >= 0; })) return;   // 비밀 고유명칭이 들어간 질의는 버린다
      used[low] = 1; cnt[cat]++; out.push({ cat: cat, q: q });
    });
    var base = out.length ? out[0].q.replace(/\s*site:\S+/g, '') : '';
    if (base) {
      var fb = { domestic: base + ' 특허', foreign: base + ' patent', nonpatent: base + ' 논문 OR 제품' };
      Object.keys(cnt).forEach(function (c) { if (!cnt[c] && out.length < MAX_Q) { var q = fb[c]; if (!used[q.toLowerCase()]) { used[q.toLowerCase()] = 1; out.push({ cat: c, q: q }); } } });
    }
    return out;
  }

  async function searchRound() {
    if (!S.idr) { prog('발명 특정서(IDR) 정리 중…', 6); S.idr = await llm(CTX_IDR, ideaBlock(), { max: 2500, images: IMG }); }
    prog('검색 질의 설계 중…', 16);
    var planIn = '[발명 특정서]\n' + S.idr + '\n\n[아이디어·보완 내용]\n' + ideasBlock() + '\n\n[이미 쓴 질의]\n' + (S.searches.map(function (r) { return r.queries.map(function (q) { return q.q; }).join(' / '); }).join(' / ') || '(없음)');
    var plan = await llmJSON(CTX_PLAN, planIn, { max: 1500 });
    var qs = normQueries(plan.queries);
    var usedN = S.searches.reduce(function (n, r) { return n + r.queries.filter(function (q) { return q.status !== 'skip'; }).length; }, 0), room = Math.max(0, SESSION_Q - usedN), capped = qs.length > room;
    qs = qs.slice(0, room);
    if (!qs.length && !S.searches.length && room > 0) throw new Error('검색 질의를 만들지 못했습니다. 아이디어를 조금 더 구체적으로 적어 다시 시도해 주세요.');
    var rec = { round: S.round, at: today(), queries: [], note: qs.length ? '' : (room === 0 ? '이 세션의 검색 한도(' + SESSION_Q + '회)에 도달해 새로 검색하지 않고 기존 조회 결과를 다시 분석했습니다.' : '새로 검색할 질의가 없어 기존 조회 결과를 보완 내용에 맞춰 다시 분석했습니다.') }, stop = false;
    for (var i = 0; i < qs.length; i++) {
      prog('검색 ' + (i + 1) + '/' + qs.length + ' — ' + qs[i].q.slice(0, 38), 22 + Math.round(40 * i / qs.length));
      if (stop) { rec.queries.push({ cat: qs[i].cat, q: qs[i].q, status: 'skip', error: '검색 한도·설정 문제로 건너뜀', results: [] }); continue; }
      var r = await webSearch(qs[i].q);
      rec.queries.push({ cat: qs[i].cat, q: qs[i].q, status: r.ok ? 'ok' : 'fail', error: r.ok ? '' : (r.error + (r.message ? ': ' + r.message : '')), results: r.ok ? r.organic : [] });
      if (!r.ok && (r.status === 503 || r.status === 429)) stop = true;
    }
    S.searches.push(rec);

    // 새 결과를 문헌 풀에 올린다(링크 기준 중복 제거, 안정적인 D번호 부여)
    var known = {}; S.docs.forEach(function (d) { known[d.link] = d; });
    var fresh = [];
    rec.queries.forEach(function (q) { q.results.forEach(function (o) { if (o.link && !known[o.link]) { var d = { ref: 'D' + (S.docs.length + 1), title: o.title, link: o.link, snippet: o.snippet, cat: q.cat, relevance: '', note: '', elements: [], round: S.round }; S.docs.push(d); known[o.link] = d; fresh.push(d); } }); });
    var pool = fresh.concat(S.docs.filter(function (d) { return d.relevance === 'high' || d.relevance === 'mid'; }).slice(0, 14)).slice(0, 36);
    if (!pool.length) {
      S.cmp = { round: S.round, md: '(조회된 문헌이 없어 대비표를 만들 수 없습니다)', gaps: [], limits: '검색 결과가 없거나 검색이 수행되지 않았습니다.' };
      return;
    }
    prog('조회 결과 분석·구성요소 대비 중…', 72);
    var anaIn = '[발명 특정서]\n' + S.idr + '\n\n[아이디어·보완 내용]\n' + ideasBlock() + '\n\n[조회 결과]\n' + pool.map(function (d) { return '[' + d.ref + '] ' + d.title + ' | ' + d.link + ' | 분류:' + d.cat + '\n   스니펫: ' + d.snippet; }).join('\n') +
      (Object.keys(S.verified).length ? '\n\n[이용자가 첨부한 원문 발췌]\n' + S.docs.filter(function (d) { return S.verified[d.link]; }).map(function (d) { return '[' + d.ref + '] ' + S.verified[d.link].text.slice(0, 2500); }).join('\n---\n') : '');
    var ana = await llmJSON(CTX_ANALYZE, anaIn, { max: 3800 });
    var byRef = {}; S.docs.forEach(function (d) { byRef[d.ref] = d; });
    (ana.docs || []).forEach(function (a) { var d = byRef[a && a.ref]; if (d) { d.relevance = ['high', 'mid', 'low'].indexOf(a.relevance) >= 0 ? a.relevance : 'low'; d.note = String(a.note || '').slice(0, 300); d.elements = Array.isArray(a.elements_disclosed) ? a.elements_disclosed.slice(0, 12) : []; } });
    S.cmp = { round: S.round, md: String(ana.comparison_md || ''), gaps: Array.isArray(ana.key_gaps) ? ana.key_gaps.slice(0, 8).map(String) : [], limits: String(ana.limits || '') };
  }

  /* ═════════════════ 과제·평가 ═════════════════ */
  var CTX_TASKS = '[작업: 차별화 과제 제시] 발명 특정서·대비표·이용자 아이디어를 보고, 선행 기술과 차별화하고 특허 취득 가능성을 높이기 위해 이용자가 해결·답변해야 할 과제를 제시한다. 과제마다 목적, 필요한 자료, 영향을 받는 평가 요소(N=신규성 I=진보성 S=기재 자료 충족도 R=조사확신도), 핵심(critical) 여부, 수행이 어려울 때의 대안을 적는다. 이용자가 이미 답한 과제는 반복하지 않는다. 5~8개. 출력은 JSON 하나: {"tasks":[{"title":"","why":"","need":"","affects":"N|I|S|R","critical":true,"alt":""}],"summary":"전체 방향 두세 문장"}';
  async function makeTasks(label) {
    prog(label || '차별화 과제 정리 중…', 30);
    var input = '[발명 특정서]\n' + S.idr + '\n\n' + cmpBlock() + '\n\n[조회 문헌]\n' + docsBlock(true) + '\n\n[이용자의 지금까지 제출 내용]\n' + ideasBlock() + '\n\n[직전 과제]\n' + tasksBlock();
    var j = await llmJSON(CTX_TASKS, input, { max: 2600 });
    var arr = Array.isArray(j.tasks) ? j.tasks : [];
    S.taskHist = (S.taskHist || []); if (S.tasks.length) S.taskHist.push({ round: S.round, tasks: S.tasks });
    S.tasks = arr.slice(0, 9).map(function (t, i) { return { id: 'T' + (i + 1), title: String(t.title || ''), why: String(t.why || ''), need: String(t.need || ''), affects: String(t.affects || ''), critical: !!t.critical, alt: String(t.alt || '') }; });
    S.taskSummary = String(j.summary || '');
    if (!S.tasks.length) throw new Error('과제를 만들지 못했습니다. 다시 시도해 주세요.');
  }
  var CTX_EVAL = '[작업: 차별화 아이디어 평가] 이용자가 제출한 차별화(보완) 아이디어가 선행 기술과 실제로 구별되는지 평가한다. 사후적 판단 금지(출원 당시 기술수준 기준). 각 아이디어에 대해: 차별 구성 여부와 근거(문헌 ref) / 결합 곤란 사정 / 심사관의 최강 반론과 재반박 가능 여부 / 약점 / 보강 방향. 이용자가 말하지 않은 효과·수치를 가정하지 않는다. 출력(구분자 형식): ===LEVEL===\nhigh|mid|low\n===MD===\n(마크다운 평가문)';
  async function evalDiff(kind) {
    prog('차별화 수준 평가 중…', 60);
    var input = '[발명 특정서]\n' + S.idr + '\n\n' + cmpBlock() + '\n\n[조회 문헌]\n' + docsBlock(true) + '\n\n[이용자 제출 내용]\n' + ideasBlock();
    var sec = parseSections(await llm(CTX_EVAL, input, { max: 3500 }));
    var lv = String(sec.LEVEL || '').toLowerCase().trim(); if (['high', 'mid', 'low'].indexOf(lv) < 0) lv = 'mid';
    S.evals.push({ stage: kind, round: S.round, level: lv, md: sec.MD || '(평가문을 만들지 못했습니다)' });
  }
  var CTX_PRI = '[작업: 차별화·취득 가능성 평가] 부록 T-A 루브릭으로 N(신규성)·I(진보성)·S(기재 자료 충족도: 지금까지 확보한 자료로 명세서의 실시가능·뒷받침·명확을 충족할 수 있는가)·R_llm(조사 질의의 적절성만 평가, 검색 범위 상한은 화면이 따로 적용)을 0~100으로 매긴다. 점수는 이용자 진술(F)과 조회로 확인된 사실로만 올리고 추론만으로는 해당 구간 상한을 넘기지 않는다. 최강 반론에 재반박이 불가능하면 rebuttal_possible=false. open_critical은 아직 해소되지 않은 핵심 과제의 수. 확률·등록 가능 단정 금지. 출력은 JSON 하나: {"N":{"score":0,"basis":""},"I":{"score":0,"basis":"","rebuttal_possible":true},"S":{"score":0,"basis":""},"R_llm":0,"open_critical":0,"key_risks":[""],"next_actions":[""],"summary":"세 문장 이내"}';
  async function scorePRI() {
    prog('취득 가능성 평가 중…', 55);
    var c = coverage();
    var input = '[발명 특정서]\n' + S.idr + '\n\n' + cmpBlock() + '\n\n[조회 문헌]\n' + docsBlock(true) + '\n\n[이용자 제출 내용]\n' + ideasBlock() + '\n\n[현재 과제]\n' + tasksBlock() +
      '\n\n[조사 범위] 국내 질의 성공 ' + c.dom + ' · 해외 ' + c.foreign + ' · 비특허 ' + c.np + ' · 원문 확인한 핵심 문헌 ' + c.verified + '/' + Math.min(3, c.high) + '\n[공개 이력] ' + disclosureLabel();
    var raw = await llmJSON(CTX_PRI, input, { max: 2600 });
    var res = computePRI(raw);
    res.round = S.round; res.summary = String(raw.summary || ''); res.risks = Array.isArray(raw.key_risks) ? raw.key_risks.slice(0, 6).map(String) : []; res.actions = Array.isArray(raw.next_actions) ? raw.next_actions.slice(0, 6).map(String) : [];
    res.basis = { N: String(raw.N && raw.N.basis || ''), I: String(raw.I && raw.I.basis || ''), S: String(raw.S && raw.S.basis || '') };
    S.priHist.push(res);
    return res;
  }
  /* 게이트 판정 후 다음 단계 결정 */
  function afterPri(res) {
    if (res.gate) { S.halt = null; return 'spec'; }
    var h = S.priHist, stag = h.length >= 3 && h[h.length - 1].pri <= h[h.length - 2].pri && h[h.length - 2].pri <= h[h.length - 3].pri;
    if (S.round >= MAX_ROUNDS || stag) { S.halt = { reason: S.round >= MAX_ROUNDS ? MAX_ROUNDS + '라운드를 반복했지만 내부 착수 기준에 이르지 못했습니다.' : '최근 세 라운드 동안 평가가 나아지지 않았습니다.' }; return 'pri'; }
    S.round++;
    ['supp', 'research', 'newtasks', 'pri'].forEach(function (k) { delete S.done[k]; });
    return 'supp';
  }

  /* ═════════════════ 문서 조립 (C-2 서식은 화면이 직접 조립한다 — LLM은 본문만 쓴다) ═════════════════ */
  function openItems(t) { return (String(t).match(/\[(?:발명자 |변리사 )?(?:확인 필요|기재)[^\]]*\]/g) || []).length; }
  function waiverNote() { return S.waived.length ? ('내부 기준 미달 진행 기록: ' + S.waived.join(', ')) : '내부 착수 기준 통과'; }
  function buildDoc(o) {
    var body = String(o.body || '').trim();
    var fm = ['---', 'doc_type: ' + o.type, 'status: DRAFT — 변리사 검토·확정 전 제출 불가', 'statute: 변리사법 제2조', 'submit_to: 지식재산처(구 특허청)',
      'case_ref: "[변리사 기재: 사건·수임 일련번호]"', 'ip_type: 특허', 'kipo_stage: 출원', 'generated_by: 변리사 보조 AI (SP-LAW-13 v1.3)', 'generated_at: ' + today(),
      'law_checked: "미조회 — 이 화면은 검색 스니펫 기준이며 서식·조문·기한은 변리사가 현행본으로 확인"', 'deadline: "★ 공개 이력: ' + disclosureLabel() + ' / 심사청구는 출원일부터 3년(재확인)"',
      'open_items: ' + (o.openItems != null ? o.openItems : openItems(body)), 'scope_note: "' + waiverNote().replace(/"/g, "'") + '"', '---', ''].join('\n');
    var attach = o.attach || '| 1 | (없음) | - | - |';
    return fm + '\n# ' + o.title + '\n\n## 1. 사안 개요 (내부용 — 제출 서류 아님)\n' + (o.overview || '(없음)') + '\n\n## 2. 서류 본문 (제출용)\n' + body + '\n\n## 3. 첨부서류 목록\n| 순번 | 서류 | 발급·작성처 | 상태(확보/미확보/작성 필요) |\n|---|---|---|---|\n' + attach +
      '\n\n## 4. 변리사 검토 체크리스트\n- [ ] 업무 범위(변리사법 제2조)·부록 B\n- [ ] 위임·수임 확인과 이해충돌\n- [ ] 출원·답변·심판 기한(통지서 고지 기한 우선)\n- [ ] 공개 이력과 신규성, 선행기술 확인(원문 확인 여부)\n- [ ] `[확인 필요]`·`[변리사 기재]` 항목 모두 확정\n- [ ] 허위 기재·타인 권리 도용 소지 없음\n- [ ] 기명날인(근거 조문 확인 필요)\n\n## 5. 확인·기명날인\n변리사 [변리사 직접 확인·기명날인] — 이 문서는 변리사 보조 AI가 작성한 초안이며, 확정 전에는 제출할 수 없습니다.\n';
  }
  function pushDoc(type, title, mdText) {
    S.docs_out = S.docs_out.filter(function (d) { return d.type !== type; });
    S.docs_out.push({ type: type, title: title, md: mdText, at: today() });
    try {
      var P = window.ProDocPage;
      if (P && Array.isArray(P.drafts) && typeof P.transformReply === 'function') {
        for (var i = P.drafts.length - 1; i >= 0; i--) if (P.drafts[i].title === title) P.drafts.splice(i, 1);
        P.transformReply('```markdown\n' + mdText + '\n```');
      }
    } catch (e) { /* 작성된 문서 카드가 없어도 흐름은 계속한다 */ }
  }
  function inventionTitle() { var m = String(S.spec.body || '').match(/발명의\s*명칭\s*[:：]?\s*\n?\s*([^\n]+)/); return m ? m[1].replace(/[#*\[\]]/g, '').trim().slice(0, 80) : '신규 발명'; }
  function attachList() {
    var rows = [], n = 1;
    S.docs_out.forEach(function (d) { rows.push('| ' + (n++) + ' | ' + d.type + ' | 변리사 보조 AI 초안 | 작성됨(검토 전) |'); });
    return rows.join('\n') || '| 1 | (없음) | - | - |';
  }

  /* ═════════════════ 명세서 ═════════════════ */
  var CTX_SPEC = '[작업: 명세서 초안 작성] 발명 특정서·이용자 제출 내용·조회 문헌을 근거로 특허 명세서(발명의 설명)를 쓴다. 기재 순서: 발명의 명칭 / 기술분야 / 발명의 배경이 되는 기술 / 선행기술문헌(아래 조회 문헌 중 서지가 확인된 것만, 원문 미확인이면 "(검색 결과 기준, 서지 확인 필요)" 표시) / 발명의 내용(해결하려는 과제, 과제의 해결 수단, 발명의 효과) / 도면의 간단한 설명 / 발명을 실시하기 위한 구체적인 내용(실시예: 이용자가 제공한 조건·수치만, 변형예는 이용자가 확인한 것만) / 부호의 설명. 기재요건 3축(실시가능·뒷받침·명확)을 모두 의식하고, 청구항에 쓸 용어를 일관되게 정의한다. 이용자가 말하지 않은 실시예·수치·효과는 만들지 말고 [발명자 확인 필요: 무엇] 으로 표시한다. 출력(구분자 형식): ===OVERVIEW===\n(내부용 사안 개요 3~6줄: 목적·전제한 사실·미확인 사항)\n===BODY===\n(명세서 본문 마크다운)';
  function specInput() { return '[발명 특정서]\n' + S.idr + '\n\n[이용자 제출 내용 전체]\n' + ideasBlock() + '\n\n' + cmpBlock() + '\n\n[조회 문헌]\n' + docsBlock(true) + '\n\n[공개 이력] ' + disclosureLabel(); }
  async function writeSpec() {
    prog('명세서 초안 작성 중…(1~2분 걸릴 수 있습니다)', 30);
    var sec = parseSections(await llm(CTX_SPEC, specInput(), { max: 7000 }));
    if (!sec.BODY || sec.BODY.length < 200) throw new Error('명세서를 충분히 쓰지 못했습니다. 다시 시도해 주세요.');
    S.spec.v++; S.spec.body = sec.BODY; S.spec.overview = sec.OVERVIEW || '';
    renderSpecDoc('명세서(발명의 설명)', '초안 v' + S.spec.v);
  }
  function renderSpecDoc(type, tag) {
    var title = '명세서(발명의 설명) — ' + inventionTitle() + ' (' + tag + ')';
    pushDoc(type, title, buildDoc({ type: type, title: title, overview: S.spec.overview, body: S.spec.body, attach: attachList() }));
  }

  /* ═════════════════ 독립 검토 (새 AI 호출 — 작성 대화의 맥락을 공유하지 않는다) ═════════════════ */
  var CTX_REVIEW = '[작업: 독립 검토] 당신은 대한민국 특허 심사관과 상대방 측 변리사의 관점을 겸해 출원 서류를 비판적으로 검토하는 검토자이며, 이 서류의 작성자가 아니고 작성 과정을 모른다. 아래 [검토 대상]과 [선행기술 목록]만 근거로 한다. 호의적으로 평가하지 말고 결함을 찾는다. 모르면 "확신 없음", 조문·문헌 번호는 지어내지 말고 불확실하면 [확인필요]. 검토 항목: 기재요건(실시가능·뒷받침·명확) / 청구항-명세서 용어·도면 부호 일치 / 선행기술로 독립항이 거절될 구체 경로와 가장 약한 구성 / 단일성·권리범위의 과대·과소·회피설계 / 출원 후 보충 불가라 지금 넣어야 할 내용 / 형식. [이전 결함 목록]이 있으면 각 id가 현재 서류에서 해소되었는지 prior에 resolved|unresolved로 판정한다. 출력은 JSON 하나: {"prior":[{"id":"D1","status":"resolved|unresolved"}],"findings":[{"loc":"위치","type":"기재불비-실시가능|기재불비-뒷받침|기재불비-명확|신규성|진보성|단일성|용어불일치|도면불일치|보정위험|권리범위|형식","sev":"Critical|Major|Minor","desc":"지적","basis":"근거(조문·문헌, 불확실하면 [확인필요])","ask":"이용자에게 질문할 내용(새 사실을 만들지 말 것)"}],"top5":["가장 위험한 약점"],"need_info":["추가로 필요한 정보"]}';
  async function runReviewer(kind) {   // kind: 'spec' | 'claims'
    var defKey = kind === 'spec' ? 'defects' : 'cdefects', revKey = kind === 'spec' ? 'reviews' : 'creviews';
    var round = S[revKey].length + 1, model = (round % 2 === 1) ? MODEL_FAST : MODEL_DEEP;
    prog('독립 검토 ' + round + '회차 — 새 AI 인스턴스(' + (model === MODEL_FAST ? '모델 A' : '모델 B') + ') 호출 중…', 40);
    var target = kind === 'spec' ? ('[검토 대상: 명세서]\n' + S.spec.body) : ('[검토 대상: 청구범위]\n' + S.claims.body + '\n\n[함께 제출될 명세서]\n' + S.spec.body);
    var prior = S[defKey].length ? '\n\n[이전 결함 목록]\n' + S[defKey].map(function (d) { return d.id + ' | ' + d.loc + ' | ' + d.type + ' | ' + d.sev + ' | ' + d.desc + ' | 상태:' + d.status; }).join('\n') : '';
    var docs = '\n\n[선행기술 목록(검색 결과 기준, 원문 확인 ' + Object.keys(S.verified).length + '건)]\n' + docsBlock(true);
    var extra = kind === 'claims' ? '\n\n추가로 scores를 JSON 최상위에 포함한다: "scores":{"breadth":"low|mid|high(권리범위의 넓이)","support":"low|mid|high(명세서 뒷받침)","designaround":"low|mid|high(회피설계 난이도, high가 좋음)","ladder":"low|mid|high(종속항 안전망)","priorart_risk":"low|mid|high(선행기술 거절 위험, low가 좋음)"},"verdict":"두세 문장"' : '';
    var j = await llmJSON(CTX_REVIEW + extra, target + docs + prior, { model: model, max: model === MODEL_DEEP ? 8000 : 4500 });
    S[revKey].push({ round: round, model: model, at: today(), top5: Array.isArray(j.top5) ? j.top5.slice(0, 5).map(String) : [], need: Array.isArray(j.need_info) ? j.need_info.slice(0, 8).map(String) : [], scores: j.scores || null, verdict: String(j.verdict || '') });
    (Array.isArray(j.prior) ? j.prior : []).forEach(function (p) { S[defKey].forEach(function (d) { if (d.id === p.id && d.status !== 'rejected') d.status = (p.status === 'resolved') ? 'resolved' : 'open'; }); });
    var seq = S[defKey].length;
    (Array.isArray(j.findings) ? j.findings : []).slice(0, 25).forEach(function (f) {
      var sev = SEV_W[f.sev] ? f.sev : 'Minor';
      S[defKey].push({ id: (kind === 'spec' ? 'D' : 'C') + (++seq), loc: String(f.loc || ''), type: String(f.type || ''), sev: sev, desc: String(f.desc || ''), basis: String(f.basis || ''), ask: String(f.ask || ''), status: 'open', round: round, model: model });
    });
  }
  function specMetrics() { return metrics(S.defects, S.reviews); }
  function claimMetrics() { return metrics(S.cdefects, S.creviews); }

  var CTX_REVISE = '[작업: 명세서 보완] 이용자의 답변·수정 요청과 미해결 결함을 반영해 명세서 본문을 고쳐 쓴다. 이용자가 준 사실만 추가하고, 말하지 않은 실시예·수치·효과를 만들지 않는다(모르면 [발명자 확인 필요: …] 유지). 기존 구조와 용어를 유지하고 청구항에서 쓸 용어를 일관되게 한다. 출력(구분자 형식): ===BODY===\n(명세서 본문 전체)\n===CHANGES===\n(바꾼 점을 항목별 한 줄씩)';
  async function reviseSpec() {
    prog('보완 사항을 반영해 명세서를 고치는 중…', 35);
    var open = S.defects.filter(function (d) { return d.status === 'open'; });
    var input = '[현재 명세서]\n' + S.spec.body + '\n\n[이용자 답변·수정 요청]\n' + (S.spec.notes || '(없음)') + (((S.pend && S.pend.review) || []).map(function (f) { return '\n[첨부: ' + f.name + ']\n' + (f.text || '').slice(0, 4000); }).join('')) + '\n\n[미해결 결함]\n' + (open.map(function (d) { return d.id + ' (' + d.sev + ') ' + d.loc + ' — ' + d.desc + (d.ask ? ' / 질문: ' + d.ask : ''); }).join('\n') || '(없음)') + '\n\n[발명 특정서]\n' + S.idr + '\n\n[이용자 제출 내용]\n' + ideasBlock();
    var sec = parseSections(await llm(CTX_REVISE, input, { max: 7000 }));
    if (!sec.BODY || sec.BODY.length < 200) throw new Error('명세서를 고치지 못했습니다. 다시 시도해 주세요.');
    S.spec.v++; S.spec.body = sec.BODY; S.spec.changes = sec.CHANGES || ''; S.spec.notes = ''; if (S.pend) S.pend.review = [];
    renderSpecDoc('명세서(발명의 설명)', '보완 v' + S.spec.v);
  }

  /* ═════════════════ 최종 명세서 · 도면 · 청구항 ═════════════════ */
  var CTX_FINAL = '[작업: 최종 명세서 정리] 현재 명세서를 최종본으로 다듬는다. 새로운 사실·수치·실시예를 추가하지 않는다(출원 후에는 보충할 수 없으므로 빠진 것은 [발명자 확인 필요]로 남긴다). 용어를 통일하고, 부호의 설명을 도면 설명과 맞추고, 선행기술문헌 표기를 정리한다. 출력(구분자 형식): ===BODY===\n(최종 명세서 본문 전체)\n===TERMS===\n(용어 일관성 표: | 용어 | 정의 | 사용 위치 |)';
  async function writeFinal() {
    prog('최종 명세서 정리 중…', 35);
    var sec = parseSections(await llm(CTX_FINAL, '[현재 명세서]\n' + S.spec.body + '\n\n[미해결 결함]\n' + (S.defects.filter(function (d) { return d.status === 'open'; }).map(function (d) { return d.id + ' ' + d.desc; }).join('\n') || '(없음)'), { max: 7000 }));
    if (!sec.BODY || sec.BODY.length < 200) throw new Error('최종 명세서를 만들지 못했습니다.');
    S.spec.body = sec.BODY; S.spec.terms = sec.TERMS || ''; S.spec.final = true;
    var title = '명세서(발명의 설명) — ' + inventionTitle() + ' (최종)';
    pushDoc('명세서(발명의 설명)', title, buildDoc({ type: '명세서(발명의 설명)', title: title, overview: S.spec.overview + '\n\n### 용어 일관성 표\n' + (S.spec.terms || '(없음)'), body: S.spec.body, attach: attachList() }));
  }
  var CTX_DRAW = '[작업: 도면·요약서 작성] 최종 명세서에 맞는 도면(블록도·흐름도·구조도, 최대 6개)과 요약서를 만든다. 도면은 흑백 선화 SVG(fill은 none 또는 white, stroke는 black, 글자는 도면 부호 중심)로 그리고 viewBox="0 0 600 400"을 쓴다. script·이미지·외부 참조·스타일 속성을 쓰지 않는다. 도면 부호는 명세서의 "부호의 설명"과 일치해야 한다. 출력(구분자 형식, 이 순서): ===ABSTRACT===\n(요약서 본문 400자 이내, 대표도 번호 명시)\n===DESC===\n(도면의 간단한 설명: "도 1은 …" 줄 단위)\n===PARTS===\n(부호의 설명: "100: 명칭" 줄 단위)\n===FIG 1|도면 제목===\n<svg …>…</svg>\n===FIG 2|도면 제목===\n<svg …>…</svg>';
  async function drawFigures() {
    prog('도면·요약서 작성 중…', 35);
    var sec = parseSections(await llm(CTX_DRAW, '[최종 명세서]\n' + S.spec.body + (S.drawFeedback ? '\n\n[이용자 수정 요청]\n' + S.drawFeedback : ''), { max: 8000 }));
    var figs = [], warn = [];
    Object.keys(sec).forEach(function (k) {
      var m = k.match(/^FIG\s*(\d+)\s*\|?\s*(.*)$/i); if (!m) return;
      var svgSrc = (sec[k].match(/<svg[\s\S]*<\/svg>/i) || [''])[0], clean = svgSrc ? sanitizeSvg(svgSrc) : null;
      if (clean) figs.push({ no: +m[1], title: (m[2] || '도면').trim(), svg: clean }); else warn.push('도 ' + m[1] + '은 안전하게 읽을 수 없어 제외했습니다.');
    });
    if (!figs.length) throw new Error('도면을 만들지 못했습니다. 다시 시도해 주세요.');
    figs.sort(function (a, b) { return a.no - b.no; });
    S.figs = figs; S.figWarn = warn; S.abstract = sec.ABSTRACT || ''; S.figDesc = sec.DESC || ''; S.figParts = sec.PARTS || ''; S.drawFeedback = '';
    var body = '### 요약서\n' + S.abstract + '\n\n### 도면의 간단한 설명\n' + S.figDesc + '\n\n### 부호의 설명\n' + S.figParts + '\n\n### 도면 파일\n' + figs.map(function (f) { return '- 도 ' + f.no + ' — ' + f.title + ' (이 화면에서 SVG 파일로 내려받기)'; }).join('\n');
    var title = '요약서·도면의 간단한 설명 — ' + inventionTitle();
    pushDoc('요약서·도면의 간단한 설명', title, buildDoc({ type: '요약서·도면의 간단한 설명', title: title, overview: '도면 ' + figs.length + '개. 도면 제출 규격은 변리사가 현행 서식 규정으로 확인한다.', body: body, attach: attachList() }));
  }
  var CTX_CLAIMS = '[작업: 청구항 작성] 최종 명세서에 뒷받침되는 청구범위를 쓴다. 독립항은 필수 구성만으로 넓게, 그러나 대비표의 차별 구성을 반드시 포함한다. 종속항은 계단식(fallback ladder)으로 구성하고 각 종속항은 명세서에 뒷받침이 있어야 한다. 카테고리(물건·방법·시스템·기록매체)는 발명의 단일성을 넘지 않는 범위에서 필요한 것만. 청구항의 용어·부호는 명세서·도면과 1:1로 일치시킨다. 이용자가 말하지 않은 구성을 넣지 않는다. 출력(구분자 형식): ===CLAIMS===\n(청구항 1., 2., … 번호 매긴 본문)\n===MAP===\n(| 청구항 용어 | 명세서 위치 | 도면 부호 | 표)\n===LADDER===\n(독립항 거절 시 편입할 종속항 조합 1·2·3순위와 권리범위 축소 폭, 내부용)';
  async function writeClaims() {
    prog('청구범위 작성 중…', 35);
    var fb = S.cdefects.filter(function (d) { return d.status === 'open'; });
    var input = '[최종 명세서]\n' + S.spec.body + '\n\n' + cmpBlock() + '\n\n[차별 구성 후보]\n' + ((S.cmp && S.cmp.gaps) || []).join('; ') + '\n\n[도면 부호]\n' + (S.figParts || '') + (fb.length ? '\n\n[이전 청구범위 검토에서 지적된 미해결 결함 — 반영할 것]\n' + fb.map(function (d) { return d.id + ' (' + d.sev + ') ' + d.loc + ' — ' + d.desc; }).join('\n') + '\n[직전 청구범위]\n' + S.claims.body : '');
    if (S.claims.feedback) { input += '\n\n[인간 변리사 검토 의견 — 반드시 반영할 것. 이용자가 말하지 않은 구성은 추가하지 않는다]\n' + S.claims.feedback + (fb.length ? '' : '\n[직전 청구범위]\n' + S.claims.body); S.claims.feedback = ''; }
    var sec = parseSections(await llm(CTX_CLAIMS, input, { max: 5000 }));
    if (!sec.CLAIMS || sec.CLAIMS.length < 60) throw new Error('청구범위를 충분히 쓰지 못했습니다.');
    S.claims.v++; S.claims.body = sec.CLAIMS; S.claims.mapping = sec.MAP || ''; S.claims.ladder = sec.LADDER || '';
    var title = '청구범위 — ' + inventionTitle() + ' (v' + S.claims.v + ')';
    pushDoc('청구범위', title, buildDoc({ type: '청구범위', title: title, overview: '### 청구항-명세서 대응표\n' + (S.claims.mapping || '(없음)') + '\n\n### 보정 대비 계단(내부용)\n' + (S.claims.ladder || '(없음)') + '\n\n권리범위의 확정과 청구범위의 최종 확정은 변리사의 전속 책임입니다.', body: S.claims.body, attach: attachList() }));
  }

  /* ═════════════════ 보조: 진행 표시·첨부·저장 ═════════════════ */
  function prog(label, pct) {
    var t = $('pf-toast'); if (!t) return;
    t.classList.add('open'); $('pf-toast-label').textContent = label; $('pf-toast-bar').style.width = Math.max(4, Math.min(100, pct || 0)) + '%';
  }
  function progHide() { var t = $('pf-toast'); if (t) { t.classList.remove('open'); $('pf-toast-bar').style.width = '0'; } }
  function setPath(o, path, v) { var p = path.split('.'), c = o; for (var i = 0; i < p.length - 1; i++) { if (c[p[i]] == null || typeof c[p[i]] !== 'object') c[p[i]] = {}; c = c[p[i]]; } c[p[p.length - 1]] = v; }
  function getPath(o, path) { return path.split('.').reduce(function (c, k) { return c == null ? '' : c[k]; }, o); }
  function dl(name, text, type) {
    var b = new Blob([text], { type: type || 'text/plain;charset=utf-8' }), u = URL.createObjectURL(b), a = document.createElement('a');
    a.href = u; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(u); }, 1000);
  }
  async function readAttachment(file, keepImages) {
    var mod = window.PF_EXTRACT || await import('/src/gopang/ai/file-extract.js');
    var kind = mod.classifyFile(file.name, file.type);
    if (kind === 'text') return { name: file.name, text: (await file.text()).slice(0, 20000) };
    var r = await mod.extractFile(file);
    if (r.kind === 'text') return { name: file.name, text: String(r.text).slice(0, 20000), note: r.note || '' };
    if (r.kind === 'images') { if (keepImages) (r.images || []).forEach(function (u) { IMG.push(u); }); return { name: file.name, text: '', note: '스캔·사진 형식 — 이미지로 AI에 전달(이 브라우저 탭에서만 유지)' }; }
    return { name: file.name, text: '', note: r.reason || '읽지 못했습니다' };
  }
  async function attachTo(listPath, files, keepImages) {
    var list = getPath(S, listPath); if (!Array.isArray(list)) { list = []; setPath(S, listPath, list); }
    for (var i = 0; i < files.length; i++) {
      try { list.push(await readAttachment(files[i], keepImages)); } catch (e) { list.push({ name: files[i].name, text: '', note: '읽지 못했습니다' }); }
    }
    save(); render();
  }

  /* ═════════════════ 단계 전환 ═════════════════ */
  function go(id) {
    S.stage = id; S.peek = null; save(); render();
    try { var r = $('pfRoot'); if (r && r.scrollIntoView) r.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { /* 무시 */ }
    var st = stageOf(id);
    if (st && st.kind === 'auto' && !S.done[id] && !busy) setTimeout(function () { exec(id); }, 30);
  }
  function nextId(id) { var i = idxOf(id); return i >= 0 && i + 1 < STAGES.length ? STAGES[i + 1].id : null; }
  async function exec(id) {
    if (busy) return;
    busy = true; S.err = null; render();
    var next = null;
    try {
      if (id === 'search') { await searchRound(); next = 'tasks'; }
      else if (id === 'tasks') { await makeTasks(); next = 'diff'; }
      else if (id === 'eval1') { await evalDiff('eval1'); S.round = 1; next = 'supp'; }
      else if (id === 'research') { await searchRound(); await evalDiff('research'); next = 'newtasks'; }
      else if (id === 'newtasks') { await makeTasks('새로운 과제 정리 중…'); next = 'pri'; }
      else if (id === 'pri') { var res = await scorePRI(); S.done.pri = true; next = afterPri(res); if (next === 'pri') next = null; }
      else if (id === 'spec') { await writeSpec(); next = 'review'; }
      else if (id === 'specfinal') { await writeFinal(); next = 'draw'; }
      else if (id === 'draw') { await drawFigures(); next = 'claims'; }
      else if (id === 'claims') { await writeClaims(); next = 'claimeval'; }
      else if (id === 'claimeval') { await runReviewer('claims'); next = null; }
      if (id !== 'claimeval' && (id !== 'pri' || next !== 'supp')) S.done[id] = true;   // 청구범위 평가는 이용자가 다음 단계로 넘길 때 완료
      if (id === 'pri' && next === 'supp') { /* afterPri가 루프 단계의 완료 표시를 지웠다 */ S.done.pri = false; }
    } catch (e) { S.err = { stage: id, msg: (e && e.message) || String(e) }; next = null; }
    busy = false; progHide(); save();
    if (next) go(next); else render();
  }
  async function act(name, el) { try { await act0(name, el); } finally { save(); } }
  async function act0(name, el) {
    var id = el && el.getAttribute('data-id');
    if (busy && name !== 'peek') return;
    if (name === 'peek') { S.peek = (S.peek === id) ? null : id; render(); return; }
    if (name === 'retry') { if (S.err) exec(S.err.stage); return; }
    if (name === 'start') return startFlow();
    if (name === 'submit-diff') return submitIdeas('diff');
    if (name === 'submit-supp') return submitIdeas('supp');
    if (name === 'rerun') { delete S.done[id]; go(id); return; }
    if (name === 'reanalyze') return withBusy(reanalyze);
    if (name === 'halt-continue') { S.halt = null; S.round++; ['supp', 'research', 'newtasks', 'pri'].forEach(function (k) { delete S.done[k]; }); go('supp'); return; }
    if (name === 'halt-waive') { S.waived.push('Gate-1(차별화·취득 가능성)'); S.halt = null; go('spec'); return; }
    if (name === 'review-run') return withBusy(function () { return runReviewer('spec'); });
    if (name === 'review-revise') return withBusy(reviseSpec);
    if (name === 'review-next') {
      if (!specMetrics().ok) { if (!window.confirm('독립 검토 기준(제거율 90% 이상, 핵심 결함 0건, 서로 다른 AI 2회 이상)을 채우지 못했습니다. 이 사실을 기록하고 최종 명세서 작성으로 진행할까요?')) return; S.waived.push('Gate-2(명세서 독립 검토)'); }
      S.done.review = true; go('specfinal'); return;
    }
    if (name === 'reject') { var d = (S.defects.concat(S.cdefects)).filter(function (x) { return x.id === id; })[0]; if (!d) return; var why = window.prompt('이 지적을 받아들이지 않는 이유를 적어 주세요(기록됩니다).'); if (why) { d.status = 'rejected'; d.reason = why; save(); render(); } return; }
    if (name === 'redraw') { S.drawFeedback = (S.drawFeedback || '').trim(); delete S.done.draw; go('draw'); return; }
    if (name === 'claims-review') return withBusy(function () { return runReviewer('claims'); });
    if (name === 'claims-rewrite') { delete S.done.claims; S.done.claimeval = false; go('claims'); return; }
    if (name === 'claims-next') {
      if (!claimMetrics().ok) { if (!window.confirm('청구범위 독립 검토 기준을 채우지 못했습니다. 이 사실을 기록하고 출원서 확정 단계로 진행할까요?')) return; S.waived.push('Gate-2(청구범위 독립 검토)'); }
      S.done.claimeval = true; go('confirm'); return;
    }
    if (name === 'confirm') return confirmFiling();
    if (name === 'atty-record') return recordAttorney();
    if (name === 'atty-rework') return attorneyRework(id);
    if (name === 'atty-waive') return waiveAttorney();
    if (name === 'dl-all') return dl('출원준비_패키지_' + today().replace(/-/g, '') + '.html', allDocsHtml(), 'text/html;charset=utf-8');
    if (name === 'dl-fig') { var f = S.figs.filter(function (x) { return String(x.no) === id; })[0]; if (f) dl('도' + f.no + '_' + f.title.replace(/[^\w가-힣]+/g, '_') + '.svg', f.svg, 'image/svg+xml'); return; }
    if (name === 'filed') return recordFiled();
    if (name === 'fee-lookup') return withBusy(feeLookup);
    if (name === 'fee-done') return recordFee();
    if (name === 'export') { dl('발명출원_진행파일_' + today().replace(/-/g, '') + '.json', JSON.stringify(S), 'application/json'); return; }
    if (name === 'import') { var inp = $('pf-import'); if (inp) inp.click(); return; }
    if (name === 'reset') { if (window.confirm('입력한 내용과 진행 상황이 모두 지워집니다. 처음부터 다시 시작할까요?')) { IMG = []; S = base(); save(); render(); } return; }
    if (name === 'rm-file') { var parts = id.split(':'), lst = getPath(S, parts[0]); if (Array.isArray(lst)) { lst.splice(+parts[1], 1); save(); render(); } return; }
    if (name === 'mic') return toggleMic(el);
  }
  async function withBusy(fn) {
    if (busy) return; busy = true; S.err = null; render();
    try { await fn(); } catch (e) { S.err = { stage: S.stage, msg: e.message || String(e), manual: true }; }
    busy = false; progHide(); save(); render();
  }

  function startFlow() {
    var m = [];
    if ((S.idea.text || '').trim().length < 30) m.push('핵심 아이디어를 30자 이상 구체적으로 적어 주세요(무엇을 풀려는 발명인지, 어떻게 해결하는지).');
    if (!S.disclosure.status) m.push('공개 이력(논문·전시·판매·SNS 등)이 있는지 선택해 주세요. 신규성에 직결됩니다.');
    if (S.disclosure.status === 'yes' && !S.disclosure.date) m.push('공개한 날짜를 적어 주세요(대략도 괜찮습니다).');
    if (!S.consent) m.push('기밀 고지에 동의해 주세요.');
    if (A() && !S.clientOk) m.push('발명자(의뢰인)에게 AI 도구 사용을 알리고 필요한 동의를 받았는지 확인(체크)해 주세요. 변리사는 의뢰인 정보에 대한 비밀유지 의무가 있습니다.');
    if (m.length) { S.formErr = m; render(); return; }
    S.formErr = null; S.done.idea = true; go('search');
  }
  function submitIdeas(kind) {
    var txt = String((S.input && S.input[kind]) || '').trim(), files = (S.pend && S.pend[kind]) || [];
    if (txt.length < 20 && !files.length) { S.formErr = ['차별화(보완) 아이디어를 20자 이상 적거나 자료를 첨부해 주세요.']; render(); return; }
    if (kind === 'diff' && !S.idrOk) { S.formErr = [A() ? '정리된 발명 특정서가 발명자에게 확인한 내용과 일치하는지 확인(체크)해 주세요.' : '정리된 발명 특정서가 내가 말한 내용과 일치하는지 확인(체크)해 주세요.']; render(); return; }
    S.formErr = null;
    S.ideas.push({ kind: kind, round: kind === 'diff' ? 0 : S.round, text: txt, files: files.map(function (f) { return { name: f.name, text: f.text || '' }; }) });
    S.input[kind] = ''; S.pend[kind] = [];
    S.done[kind] = true;
    go(kind === 'diff' ? 'eval1' : 'research');
  }
  async function reanalyze() {
    var pool = S.docs.filter(function (d) { return d.relevance === 'high' || d.relevance === 'mid' || S.verified[d.link]; }).slice(0, 20);
    if (!pool.length) throw new Error('다시 분석할 문헌이 없습니다.');
    prog('원문을 반영해 구성요소 대비를 갱신하는 중…', 40);
    var inp = '[발명 특정서]\n' + S.idr + '\n\n[아이디어·보완 내용]\n' + ideasBlock() + '\n\n[조회 결과]\n' + pool.map(function (d) { return '[' + d.ref + '] ' + d.title + ' | ' + d.link + '\n   스니펫: ' + d.snippet; }).join('\n') +
      '\n\n[이용자가 첨부한 원문 발췌]\n' + (pool.filter(function (d) { return S.verified[d.link]; }).map(function (d) { return '[' + d.ref + '] ' + S.verified[d.link].text.slice(0, 3000); }).join('\n---\n') || '(없음)');
    var ana = await llmJSON(CTX_ANALYZE, inp, { max: 3800 }), by = {};
    S.docs.forEach(function (d) { by[d.ref] = d; });
    (ana.docs || []).forEach(function (a) { var d = by[a && a.ref]; if (d) { d.relevance = ['high', 'mid', 'low'].indexOf(a.relevance) >= 0 ? a.relevance : d.relevance; d.note = String(a.note || d.note).slice(0, 300); } });
    S.cmp = { round: S.round, md: String(ana.comparison_md || ''), gaps: Array.isArray(ana.key_gaps) ? ana.key_gaps.slice(0, 8).map(String) : [], limits: String(ana.limits || '') };
  }


  /* ═════════════════ 인간 변리사 최종 검토 (이 화면 밖에서 이루어지는 일의 요청서 작성과 결과 기록) ═════════════════ */
  var RESULT = { ok: '적합(그대로 출원)', minor: '경미한 수정 후 출원', major: '중대한 수정 필요', hold: '출원 보류' };
  function attyLine() {
    var a = S.attorney;
    if (a.skipped) return '- 인간 변리사 최종 검토: 생략(본인 출원, 이용자가 위험을 이해하고 진행 — 기록됨)';
    if (!a.result || !S.done.attorney) return '- 인간 변리사 최종 검토: 미완료(제출 전 필요)';
    return '- 인간 변리사 최종 검토: ' + a.name + (a.firm ? '(' + a.firm + ')' : '') + ' · ' + RESULT[a.result] + ' · 검토일 ' + a.date + (a.files && a.files.length ? ' · 수정본·의견서 첨부 ' + a.files.length + '건' : '');
  }
  function pushSummary() {
    var g1 = S.priHist.length ? S.priHist[S.priHist.length - 1] : null, sm = specMetrics(), cm = claimMetrics(), cv = coverage();
    var sum = ['### 서류 목록·제출 순서', S.docs_out.filter(function (d) { return d.type !== '00_사안요약'; }).map(function (d, i) { return (i + 1) + '. ' + d.type; }).join('\n'), '',
      '### 진행 기록', '- 차별화 라운드: ' + S.round + '회 / 내부 착수 기준 판정: ' + (g1 ? (g1.gate ? '통과' : '미통과') : '기록 없음'),
      '- 선행기술 조사: 국내 ' + cv.dom + ' · 해외 ' + cv.foreign + ' · 비특허 ' + cv.np + ' 질의 성공, 청구항 원문 확인 ' + Object.keys(S.verified).length + '건(없으면 검색 스니펫 기준)',
      '- 명세서 독립 검토: ' + sm.rounds + '회(서로 다른 AI 모델 ' + sm.models + '종), 결함 제거율 ' + Math.round(sm.rate * 100) + '%(참고 지표), 미해결 핵심 결함 ' + sm.openCritical + '건',
      '- 청구범위 독립 검토: ' + cm.rounds + '회(서로 다른 AI 모델 ' + cm.models + '종), 미해결 핵심 결함 ' + cm.openCritical + '건', attyLine(), '- ' + waiverNote(), '',
      '### 제출 전 체크리스트', '- [ ] 출원서 서지·발명자·출원인 일치', '- [ ] 도면 부호가 명세서 "부호의 설명"과 일치', '- [ ] 선행기술문헌 기재 확인(원문 확인 여부)', '- [ ] 인간 변리사의 최종 검토 완료와 청구범위 최종 확정', '- [ ] 공개 이력·공지예외 서류', '- [ ] 수수료 확인(현행 징수규칙)', '- [ ] 제출·납부는 출원인 본인 또는 변리사가 특허로에서 직접', '',
      '이 도구는 지식재산처에 제출하거나 수수료를 납부하지 않으며, 평가 수치는 참고 지표입니다.'].join('\n');
    var t2 = '00_사안요약 — ' + inventionTitle();
    pushDoc('00_사안요약', t2, buildDoc({ type: '00_사안요약', title: t2, overview: '제출 서류가 아닌 내부 요약입니다.', body: sum, attach: attachList() }));
  }
  function pushReviewRequest() {
    var last = S.creviews[S.creviews.length - 1], c = coverage(), sm = specMetrics(), cm = claimMetrics(), p = S.priHist[S.priHist.length - 1];
    var all = S.defects.concat(S.cdefects), openD = all.filter(function (d) { return d.status === 'open'; }), rejD = all.filter(function (d) { return d.status === 'rejected'; });
    var oi = openItems(S.spec.body) + openItems(S.claims.body);
    var sc = last && last.scores ? Object.keys(CSC).map(function (k) { return CSC[k] + ': ' + ({ high: '높음', mid: '보통', low: '낮음' }[String(last.scores[k]).toLowerCase()] || '불명'); }).join(' / ') : '(기록 없음)';
    var body = ['### 검토를 요청드리는 이유', (A() ? '이 서류는 변리사 보조 AI가 담당 변리사의 업무를 보조하기 위해 발명자의 진술과 공개 검색 결과를 바탕으로 작성한 **초안**입니다. 청구범위의 확정, 기재요건과 선행기술의 판단, 기명날인과 제출은 변리사의 업무이므로 제출 전 담당 변리사의 최종 검토·확정을 위한 검토 포인트를 정리했습니다.' : '이 서류는 변리사 보조 AI가 이용자(본인 출원 준비)의 진술과 공개 검색 결과를 바탕으로 작성한 **초안**입니다. 청구범위의 확정, 기재요건과 선행기술의 판단, 제출은 변리사의 업무이므로 제출 전 최종 검토를 요청드립니다.'), '',
      '### 검토 대상 서류', S.docs_out.filter(function (d) { return d.type.indexOf('00_') !== 0; }).map(function (d) { return '- ' + d.type + ' — ' + d.title; }).join('\n'), '',
      '### 특히 확인해 주실 사항',
      '- [ ] 청구범위: 독립항의 권리범위 설정과 종속항 계단(보정 대비). AI 독립 검토의 참고 의견 — ' + sc,
      '- [ ] 기재요건: 실시가능·뒷받침·명확. 명세서·청구범위에 확인이 필요하다고 표시된 곳 ' + oi + '곳',
      '- [ ] 선행기술: 이 조사는 검색 결과의 제목·스니펫 기준이며 청구항 원문을 확인한 문헌은 ' + Object.keys(S.verified).length + '건입니다. 핵심 문헌의 원문 대비가 필요합니다.',
      '- [ ] 공개 이력: ' + disclosureLabel() + ' — 공지예외 주장 필요 여부와 증명서류',
      '- [ ] 출원인 적격(직무발명·공동발명자·정부과제 여부)과 서지사항',
      '- [ ] 도면 제출 규격, 서식, 우선권·심사청구 시기, 수수료 감면 여부', '',
      '### AI 평가 기록(참고)',
      '- 차별화 라운드 ' + S.round + '회, 내부 착수 기준: ' + (p ? (p.gate ? '도달' : '미도달') : '기록 없음') + (showNum() && p ? ' (참고 지표 ' + p.pri + ')' : ''),
      '- 선행기술 조사: 국내 ' + c.dom + ' · 해외 ' + c.foreign + ' · 비특허 ' + c.np + ' 질의 성공',
      '- AI 독립 검토: 명세서 ' + sm.rounds + '회, 청구범위 ' + cm.rounds + '회 — 같은 공급자의 서로 다른 모델이며 인간 변리사의 검토를 대체하지 않습니다.', '- ' + waiverNote(), '',
      '### 미해결·반려된 AI 지적', (openD.length ? openD.map(function (d) { return '- 미해결 ' + d.id + ' (' + d.sev + ') ' + d.loc + ' — ' + d.desc; }).join('\n') : '- 미해결 지적 없음'),
      (rejD.length ? rejD.map(function (d) { return '- 반려 ' + d.id + ' (' + d.sev + ') ' + d.desc + ' — 이용자 사유: ' + (d.reason || ''); }).join('\n') : ''), '',
      '### 한계', '- 평가 수치와 결함 제거율은 참고 지표이며 특허성 판단의 확정이 아닙니다.', '- 이 도구는 변리사를 소개·연결하지 않으며 변리사의 등록 여부를 확인하지 않습니다.'].join('\n');
    var t = '변리사 검토 요청서 — ' + inventionTitle();
    pushDoc('00_변리사 검토 요청서', t, buildDoc({ type: '00_변리사 검토 요청서', title: t, overview: '제출 서류가 아닙니다. 검토하시는 변리사께 전달하는 요청서입니다.', body: body, attach: attachList() }));
  }
  function recordAttorney() {
    var a = S.attorney, c = a.chk || {}, m = [];
    if (!String(a.name || '').trim()) m.push('검토한 변리사의 성명을 적어 주세요.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a.date || '').trim())) m.push('검토일을 날짜(YYYY-MM-DD)로 입력해 주세요.');
    if (!RESULT[a.result]) m.push('검토 결과를 선택해 주세요.');
    if (!c.a || !c.b) m.push('변리사가 청구범위와 선행기술·공개 이력을 직접 검토했다는 확인(체크 두 개)이 필요합니다.');
    if (a.result === 'minor' && !c.c) m.push('경미한 수정 사항을 모두 반영했다는 확인이 필요합니다.');
    if ((a.result === 'major' || a.result === 'hold' || a.result === 'minor') && !String(a.opinion || '').trim() && !(a.files && a.files.length)) m.push('수정이 필요하거나 보류인 경우 변리사의 의견을 적거나 의견서·수정본을 첨부해 주세요.');
    if (m.length) { S.formErr = m; render(); return; }
    S.formErr = null; a.hist = a.hist || [];
    a.hist.push({ name: a.name.trim(), firm: a.firm, type: a.type, date: a.date, result: a.result, opinion: a.opinion, files: (a.files || []).map(function (f) { return f.name; }) });
    if (a.result === 'ok' || a.result === 'minor') { S.done.attorney = true; pushSummary(); go('submit'); }
    else { S.done.attorney = false; save(); render(); }
  }
  function attorneyRework(target) {
    var a = S.attorney, op = String(a.opinion || '').trim() || ((a.files || []).map(function (f) { return '[첨부 ' + f.name + '] ' + (f.text || '').slice(0, 3000); }).join('\n'));
    var clear = target === 'review' ? ['review', 'specfinal', 'draw', 'claims', 'claimeval', 'confirm', 'attorney'] : ['claims', 'claimeval', 'confirm', 'attorney'];
    clear.forEach(function (k) { delete S.done[k]; }); S.confirmed = false;
    if (target === 'review') S.spec.notes = '[인간 변리사 검토 의견]\n' + op + (S.spec.notes ? '\n\n' + S.spec.notes : '');
    else S.claims.feedback = op;
    a.result = ''; a.chk = {}; a.opinion = ''; a.files = [];
    go(target === 'review' ? 'review' : 'claims');
  }
  function waiveAttorney() {
    if (S.who !== 'self') return;
    if (String(S.attorney.typed || '').replace(/\s/g, '') !== '검토없이진행') { S.formErr = ['「검토 없이 진행」이라고 직접 입력해 주세요.']; render(); return; }
    S.formErr = null; S.attorney.skipped = true; S.waived.push('Gate-3(인간 변리사 최종 검토 생략)'); S.done.attorney = true; pushSummary(); go('submit');
  }

  /* ═════════════════ 출원서 확정 · 제출 · 납부 ═════════════════ */
  function confirmFiling() {
    var c = S.input.confirm || {}, need = ['a', 'b', 'c', 'd'], miss = need.filter(function (k) { return !c[k]; });
    var m = [];
    if (miss.length) m.push('확인 항목 네 개를 모두 체크해 주세요.');
    if (String(c.typed || '').trim() !== '확정') m.push('아래 입력칸에 「확정」이라고 직접 입력해 주세요.');
    if (!S.biblio.name.trim()) m.push('출원인 성명(명칭)을 적어 주세요.');
    if (!S.biblio.inventors.trim()) m.push('발명자 성명을 적어 주세요(여러 명이면 쉼표로 구분).');
    if (m.length) { S.formErr = m; render(); return; }
    var oi = openItems(S.spec.body) + openItems(S.claims.body);
    if (oi && !window.confirm('명세서·청구범위에 확인이 필요한 표시 ' + oi + '곳이 남아 있습니다. 출원 후에는 최초 명세서에 없는 내용을 추가할 수 없습니다. 이대로 확정할까요?')) { S.formErr = ['남은 [확인 필요] 표시를 11단계에서 보완한 뒤 확정하는 것을 권합니다.']; render(); return; }
    S.formErr = null;
    var b = S.biblio, hasDis = S.disclosure.status === 'yes';
    var body = ['### 서지사항', '| 항목 | 내용 |', '|---|---|',
      '| 출원인(' + (b.who === 'corp' ? '법인' : '개인') + ') | ' + b.name.trim() + ' |', '| 출원인 주소 | ' + (b.addr.trim() || '[확인 필요: 주소]') + ' |',
      '| 특허고객번호(출원인코드) | ' + (b.code.trim() || '[확인 필요: 출원인코드 — 없으면 신규 발급]') + ' |', '| 발명자 | ' + b.inventors.trim() + ' |',
      '| 대리인 | [변리사 기재: 대리인 정보 — 본인 출원이면 해당 없음] |', '| 발명의 명칭 | ' + inventionTitle() + ' |',
      '| 공지예외 주장 | ' + (hasDis ? '있음 — 공개일 ' + (S.disclosure.date || '[확인 필요]') + ', 증명서류는 변리사 확인' : '없음') + ' |', '| 우선권 주장 | [확인 필요: 해당 시 기재] |', '| 심사청구 | [확인 필요: 출원과 동시에 할지 여부] |', '',
      '### 첨부서류', S.docs_out.filter(function (d) { return d.type !== '특허출원서' && d.type !== '00_사안요약'; }).map(function (d) { return '- ' + d.type + ' — ' + d.title; }).join('\n'), '',
      '주민등록번호·사업자등록번호·인증정보는 이 문서에 적지 않습니다 — 특허로에서 출원인(또는 변리사)이 직접 입력합니다.'].join('\n');
    var t1 = '특허출원서 — ' + inventionTitle();
    pushDoc('특허출원서', t1, buildDoc({ type: '특허출원서', title: t1, overview: '서지사항은 이용자가 입력한 값이며 서식·수수료는 변리사(또는 본인)가 특허로의 현행 서식으로 확인합니다.', body: body, attach: attachList() }));
    pushReviewRequest(); pushSummary();
    S.confirmed = true; S.done.confirm = true; go('attorney');
  }
  function allDocsHtml() {
    var css = 'body{font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif;line-height:1.75;max-width:860px;margin:32px auto;padding:0 16px;color:#111;font-size:16px}h1{font-size:1.5em}h2{font-size:1.25em;margin-top:1.4em}h3{font-size:1.1em}table{border-collapse:collapse;margin:8px 0}td,th{border:1px solid #cbd5e1;padding:5px 9px}pre{background:#f1f5f9;padding:10px;white-space:pre-wrap;word-break:break-word;font-size:.85em}section{margin:0 0 3em;padding-bottom:2em;border-bottom:3px double #94a3b8}.fig{margin:1em 0;text-align:center}.fig svg{max-width:100%;height:auto;border:1px solid #e2e8f0;background:#fff}.note{background:#fff7ed;border:1px solid #fed7aa;padding:10px;border-radius:6px}';
    var ordered = S.docs_out.filter(function (d) { return d.type.indexOf('00_') === 0; }).concat(S.docs_out.filter(function (d) { return d.type.indexOf('00_') !== 0; }));
    var parts = ordered.map(function (d) {
      var m = d.md.replace(/^---\n[\s\S]*?\n---\n/, function (fm) { return '```\n' + fm.trim() + '\n```\n'; });
      return '<section>' + md(m) + '</section>';
    });
    var atty = (S.attorney.hist && S.attorney.hist.length) ? '<section><h2>인간 변리사 검토 기록</h2>' + S.attorney.hist.map(function (x) { return '<p><b>' + esc(x.date) + '</b> · ' + esc(x.name) + (x.firm ? ' (' + esc(x.firm) + ')' : '') + ' · ' + esc(RESULT[x.result]) + '</p><pre>' + esc(x.opinion || '') + '</pre>'; }).join('') + '</section>' : '';
    var figs = S.figs.length ? '<section><h2>도면</h2>' + S.figs.map(function (f) { return '<div class="fig"><h3>도 ' + f.no + ' — ' + esc(f.title) + '</h3>' + f.svg + '</div>'; }).join('') + '</section>' : '';
    return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>특허 출원 준비 패키지</title><style>' + css + '</style></head><body><p class="note"><b>DRAFT — 변리사 검토·확정 전 제출 불가.</b> 변리사 보조 AI가 작성한 초안입니다. 이 도구는 제출·납부를 하지 않으며 평가 수치는 참고 지표입니다.</p>' + parts.join('') + figs + atty + '</body></html>';
  }
  function recordFiled() {
    var no = String(S.input.appNo || '').trim(), dt = String(S.input.appDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dt)) { S.formErr = ['출원일을 날짜(YYYY-MM-DD)로 입력해 주세요.']; render(); return; }
    if (!S.input.filedOk) { S.formErr = ['직접 제출을 마쳤다는 확인(체크)이 필요합니다.']; render(); return; }
    S.formErr = null; S.filing = { done: true, appNo: no, date: dt }; S.done.submit = true; go('fee');
  }
  async function feeLookup() {
    prog('현행 수수료 안내를 검색하는 중…', 40);
    var r = await webSearch('특허료 등의 징수규칙 특허출원료 전자문서 심사청구료 지식재산처');
    S.fee.hits = r.ok ? r.organic : []; S.fee.err = r.ok ? '' : ('검색을 수행하지 못했습니다(' + r.error + '). 특허로의 수수료 안내를 직접 확인해 주세요.');
  }
  function recordFee() {
    var dt = String(S.input.feeDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dt)) { S.formErr = ['납부일을 날짜(YYYY-MM-DD)로 입력해 주세요.']; render(); return; }
    if (!S.input.feeOk) { S.formErr = ['직접 납부를 마쳤다는 확인(체크)이 필요합니다.']; render(); return; }
    S.formErr = null; S.fee.done = true; S.fee.date = dt; S.done.fee = true; render();
  }

  /* ═════════════════ 음성 입력 ═════════════════ */
  var REC = null;
  function toggleMic(btn) {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return;
    var target = btn.getAttribute('data-target'), ta = document.querySelector('[data-k="' + target + '"]');
    if (REC) { try { REC.stop(); } catch (e) { /* 무시 */ } REC = null; btn.classList.remove('rec'); return; }
    REC = new SR(); REC.lang = 'ko-KR'; REC.interimResults = false; REC.continuous = true;
    REC.onresult = function (ev) { var t = ''; for (var i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) t += ev.results[i][0].transcript + ' '; if (ta && t) { ta.value = (ta.value ? ta.value + ' ' : '') + t.trim(); setPath(S, target, ta.value); save(); } };
    REC.onend = function () { REC = null; btn.classList.remove('rec'); }; btn.classList.add('rec'); try { REC.start(); } catch (e2) { REC = null; btn.classList.remove('rec'); }
  }

  /* ═════════════════ 화면 구성 ═════════════════ */
  var CLIP = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>';
  var MIC = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/></svg>';
  function chip(label, cls) { return '<span class="pf-chip ' + (cls || '') + '">' + esc(label) + '</span>'; }
  function bandChip(score) { var b = band(score), cls = b === '충족' ? 'ok' : b === '근접' ? 'mid' : b === '보완 필요' ? 'warn' : 'bad'; return chip(showNum() ? (b + ' · ' + score) : b, cls); }
  function lvChip(lv) { return lv === 'high' ? chip('차별화 수준: 높음', 'ok') : lv === 'low' ? chip('차별화 수준: 낮음', 'bad') : chip('차별화 수준: 보통', 'mid'); }
  function fileChips(path) { var l = getPath(S, path); if (!Array.isArray(l) || !l.length) return ''; return '<div class="pf-chips">' + l.map(function (f, i) { return '<span class="pf-file">' + CLIP + esc(f.name.slice(0, 22)) + (f.text ? '' : ' <em>(' + esc(f.note || '본문 없음') + ')</em>') + '<button type="button" data-act="rm-file" data-id="' + path + ':' + i + '" aria-label="첨부 삭제">×</button></span>'; }).join('') + '</div>'; }
  function field(path, rows, ph, extra) {
    var micOk = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    return '<textarea class="pf-ta" rows="' + rows + '" data-k="' + path + '" placeholder="' + esc(ph) + '">' + esc(getPath(S, path)) + '</textarea>' +
      '<div class="pf-tool"><label class="pf-ic" title="파일 첨부">' + CLIP + '<input type="file" multiple style="display:none" accept=".pdf,.docx,.hwpx,.txt,.md,.csv,.jpg,.jpeg,.png" data-attach="' + extra.list + '"' + (extra.img ? ' data-img="1"' : '') + '></label>' +
      (micOk ? '<button type="button" class="pf-ic" title="음성 입력" data-act="mic" data-target="' + path + '">' + MIC + '</button>' : '') + fileChips(extra.list) + '<span class="pf-sp"></span>' + (extra.btn || '') + '</div>';
  }
  function errBox() { var h = ''; if (S.formErr && S.formErr.length) h += '<div class="pf-err">' + S.formErr.map(function (m) { return '<div>• ' + esc(m) + '</div>'; }).join('') + '</div>'; if (S.err) h += '<div class="pf-err"><b>작업을 마치지 못했습니다.</b> ' + esc(S.err.msg) + (S.err.manual ? '' : ' <button type="button" class="pf-btn sm" data-act="retry">다시 시도</button>') + '</div>'; return h; }
  function card(title, inner, cls) { return '<div class="pf-card ' + (cls || '') + '"><h3>' + title + '</h3>' + inner + '</div>'; }
  function detail(summary, inner, open) { return '<details class="pf-det"' + (open ? ' open' : '') + '><summary>' + summary + '</summary><div class="pf-det-b">' + inner + '</div></details>'; }

  /* ── 결과 보기 ── */
  var CAT = { domestic: '국내', foreign: '해외', nonpatent: '비특허' };
  function resSearch() {
    var h = '<h4>검색 질의와 결과</h4><div class="pf-tw"><table class="pf-table"><thead><tr><th>라운드</th><th>구분</th><th>질의</th><th>결과</th></tr></thead><tbody>' +
      S.searches.map(function (r) { return (r.note ? '<tr><td>' + r.round + '</td><td colspan="3" class="pf-sub">' + esc(r.note) + '</td></tr>' : '') + r.queries.map(function (q) { return '<tr><td>' + r.round + '</td><td>' + CAT[q.cat] + '</td><td>' + esc(q.q) + '</td><td>' + (q.status === 'ok' ? q.results.length + '건' : '<span class="pf-bad">' + esc(q.status === 'skip' ? '건너뜀' : '실패') + '</span> ' + esc(q.error)) + '</td></tr>'; }).join(''); }).join('') + '</tbody></table></div>';
    var rows = S.docs.filter(function (d) { return d.relevance; }).sort(function (a, b) { var o = { high: 0, mid: 1, low: 2 }; return o[a.relevance] - o[b.relevance]; }).slice(0, 14);
    h += '<h4>관련 선행 문헌 (검색 결과 기준 · 원문 미확인)</h4>';
    h += rows.length ? '<div class="pf-tw"><table class="pf-table"><thead><tr><th>ref</th><th>제목</th><th>구분</th><th>관련도</th><th>근거</th><th>원문</th></tr></thead><tbody>' + rows.map(function (d) {
      var ok = !!S.verified[d.link];
      return '<tr><td>' + d.ref + '</td><td><a href="' + esc(d.link) + '" target="_blank" rel="noopener noreferrer">' + esc(d.title.slice(0, 70)) + '</a><div class="pf-sub">' + esc(d.note) + '</div></td><td>' + CAT[d.cat] + '</td><td>' + ({ high: '높음', mid: '보통', low: '낮음' }[d.relevance]) + '</td><td>' + (ok ? chip('원문 확인', 'ok') : chip('스니펫', 'warn')) + '</td><td>' +
        (ok ? '✓ ' + esc(S.verified[d.link].name.slice(0, 14)) : '<label class="pf-link">첨부<input type="file" style="display:none" accept=".pdf,.docx,.hwpx,.txt,.md" data-verify="' + esc(d.link) + '"></label>') + '</td></tr>';
    }).join('') + '</tbody></table></div><p class="pf-note">청구항·도면은 검색 스니펫에 나오지 않습니다. <b>핵심 문헌의 원문(청구항 포함)을 첨부</b>하면 대비표가 정확해지고, 조사확신도 상한이 풀립니다. <button type="button" class="pf-btn sm" data-act="reanalyze">원문 반영해 대비표 갱신</button></p>' : '<p class="pf-note">관련 문헌을 찾지 못했습니다. 검색이 수행되지 않았거나(한도·설정) 결과가 없습니다.</p>';
    if (S.cmp) h += '<h4>구성요소 대비표</h4>' + md(S.cmp.md) + (S.cmp.gaps && S.cmp.gaps.length ? '<p><b>미개시로 보이는 구성(스니펫 기준 추정)</b></p><ul>' + S.cmp.gaps.map(function (g) { return '<li>' + esc(g) + '</li>'; }).join('') + '</ul>' : '');
    h += '<div class="pf-limit"><b>조사 한계</b> 출원 후 18개월간 비공개인 선출원은 조회되지 않습니다. 이 조사는 공개 검색 결과(제목·스니펫) 기반이며 심사관의 조사를 대체하지 않습니다. ' + esc(S.cmp ? S.cmp.limits : '') + '</div>';
    return h;
  }
  function resIDR() { return S.idr ? detail('발명 특정서(IDR) — 이용자 진술 기준 정리', md(S.idr), true) : ''; }
  function resTasks() {
    var h = (S.taskSummary ? '<p>' + esc(S.taskSummary) + '</p>' : '');
    h += '<div class="pf-tw"><table class="pf-table"><thead><tr><th>#</th><th>과제</th><th>필요한 자료</th><th>영향</th><th>대안</th></tr></thead><tbody>' + S.tasks.map(function (t) { return '<tr><td>' + t.id + (t.critical ? ' ' + chip('핵심', 'bad') : '') + '</td><td><b>' + esc(t.title) + '</b><div class="pf-sub">' + esc(t.why) + '</div></td><td>' + esc(t.need) + '</td><td>' + esc(t.affects) + '</td><td>' + esc(t.alt) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    return h;
  }
  function resEval(kind) { var e = S.evals.filter(function (x) { return x.stage === kind; }).pop(); return e ? '<p>' + lvChip(e.level) + ' <span class="pf-sub">라운드 ' + e.round + '</span></p>' + md(e.md) : ''; }
  function resPri() {
    var p = S.priHist[S.priHist.length - 1]; if (!p) return '';
    var h = '<div class="pf-meter">' + [['신규성', p.N], ['진보성', p.I], ['기재 자료', p.S], ['조사확신도', p.R]].map(function (x) { return '<div class="pf-m"><span>' + x[0] + '</span>' + bandChip(x[1]) + '</div>'; }).join('') + '</div>';
    h += '<div class="pf-gate ' + (p.gate ? 'ok' : 'no') + '"><b>내부 착수 기준(' + (showNum() ? GATE : '90') + ')</b> — ' + (p.gate ? '도달했습니다. 명세서 초안 작성으로 넘어갑니다.' : '아직 도달하지 못했습니다.') + (p.notes.length ? '<div class="pf-sub">' + p.notes.map(esc).join(' · ') + '</div>' : '') + '</div>';
    h += '<p class="pf-sub">조사확신도 상한: ' + (showNum() ? p.rcap : (p.rcap >= 95 ? '제한 없음' : '제한 있음')) + ' — ' + (p.rcap < 90 ? '청구항 원문 확인·국내/해외/비특허 조사가 부족하면 90에 이를 수 없습니다.' : '조사 범위 충족') + '</p>';
    h += md('**요약** ' + p.summary); if (p.risks.length) h += '<p><b>주요 위험</b></p><ul>' + p.risks.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    if (p.actions.length) h += '<p><b>다음 조치</b></p><ul>' + p.actions.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    h += detail('라운드별 추이', '<div class="pf-tw"><table class="pf-table"><thead><tr><th>라운드</th><th>신규성</th><th>진보성</th><th>기재</th><th>조사</th><th>종합</th></tr></thead><tbody>' + S.priHist.map(function (x) { return '<tr><td>' + x.round + '</td><td>' + bandChip(x.N) + '</td><td>' + bandChip(x.I) + '</td><td>' + bandChip(x.S) + '</td><td>' + bandChip(x.R) + '</td><td>' + (x.gate ? chip('도달', 'ok') : bandChip(x.pri)) + '</td></tr>'; }).join('') + '</tbody></table></div>');
    h += '<p class="pf-sub">※ 이 평가는 변리사 보조 AI의 내부 루브릭에 따른 참고 지표이며 특허성 판단의 확정이 아닙니다. 판단은 변리사가 합니다.</p>';
    return h;
  }
  function defTable(list) {
    if (!list.length) return '<p class="pf-note">지적 사항이 아직 없습니다.</p>';
    return '<div class="pf-tw"><table class="pf-table"><thead><tr><th>ID</th><th>심각도</th><th>위치·유형</th><th>지적</th><th>상태</th></tr></thead><tbody>' + list.map(function (d) {
      return '<tr><td>' + d.id + '<div class="pf-sub">' + d.round + '회차</div></td><td>' + chip(d.sev, d.sev === 'Critical' ? 'bad' : d.sev === 'Major' ? 'warn' : 'mid') + '</td><td>' + esc(d.loc) + '<div class="pf-sub">' + esc(d.type) + '</div></td><td>' + esc(d.desc) + (d.ask ? '<div class="pf-sub">질문: ' + esc(d.ask) + '</div>' : '') + (d.basis ? '<div class="pf-sub">근거: ' + esc(d.basis) + '</div>' : '') + '</td><td>' + (d.status === 'open' ? chip('미해결', 'bad') + ' <button type="button" class="pf-link" data-act="reject" data-id="' + d.id + '">반려</button>' : d.status === 'rejected' ? chip('반려', 'mid') + '<div class="pf-sub">' + esc(d.reason || '') + '</div>' : chip('해소', 'ok')) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }
  function gate2Box(m) {
    return '<div class="pf-gate ' + (m.ok ? 'ok' : 'no') + '"><b>독립 검토 기준</b> — ' + (m.ok ? '충족' : '미충족') + '<div class="pf-sub">검토 ' + m.rounds + '회(서로 다른 AI ' + m.models + '종) · 결함 제거율 ' + Math.round(m.rate * 100) + '% (참고 지표) · 미해결 핵심 결함 ' + m.openCritical + '건 · 최근 회차 신규 중대 결함 ' + m.newMajorLast + '건 — 기준: 2종 이상 AI로 2회 이상 검토, 제거율 90% 이상, 핵심 결함 0건, 최근 회차 신규 중대 결함 0건</div></div>';
  }
  function resSpec() { var n = openItems(S.spec.body); return '<p>' + chip('v' + S.spec.v, 'mid') + ' ' + (n ? chip('발명자 확인 필요 ' + n + '곳', 'warn') : chip('확인 필요 표시 없음', 'ok')) + ' <span class="pf-sub">완성본은 페이지 아래 「작성된 문서」에서 내려받을 수 있습니다.</span></p>' + detail('명세서 본문 보기', md(S.spec.body), S.stage === 'review'); }
  function resReview() { var m = specMetrics(); return gate2Box(m) + defTable(S.defects) + (S.reviews.length ? detail('검토 요약', S.reviews.map(function (r) { return '<p><b>' + r.round + '회차</b> (' + (r.model === MODEL_FAST ? '모델 A' : '모델 B') + ')</p><ul>' + r.top5.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' + (r.need.length ? '<p class="pf-sub">추가로 필요한 정보: ' + r.need.map(esc).join(' · ') + '</p>' : ''); }).join('')) : ''); }
  function resDraw() { return (S.figWarn || []).map(function (w) { return '<p class="pf-note">' + esc(w) + '</p>'; }).join('') + '<div class="pf-figs">' + S.figs.map(function (f) { return '<figure class="pf-fig"><div class="pf-svg">' + f.svg + '</div><figcaption>도 ' + f.no + ' — ' + esc(f.title) + ' <button type="button" class="pf-link" data-act="dl-fig" data-id="' + f.no + '">SVG 내려받기</button></figcaption></figure>'; }).join('') + '</div>' + detail('요약서·도면 설명·부호', md('**요약서**\n' + S.abstract + '\n\n**도면의 간단한 설명**\n' + S.figDesc + '\n\n**부호의 설명**\n' + S.figParts)); }
  function resClaims() { return '<p>' + chip('v' + S.claims.v, 'mid') + '</p>' + md(S.claims.body) + detail('청구항-명세서 대응표', md(S.claims.mapping)) + detail('보정 대비 계단(내부용)', md(S.claims.ladder || '')); }
  var CSC = { breadth: '권리범위의 넓이', support: '명세서 뒷받침', designaround: '회피설계 난이도', ladder: '종속항 안전망', priorart_risk: '선행기술 거절 위험' };
  function resClaimEval() {
    var last = S.creviews[S.creviews.length - 1], h = '';
    if (last && last.scores) h += '<div class="pf-meter">' + Object.keys(CSC).map(function (k) { var v = String(last.scores[k] || '').toLowerCase(), good = k === 'priorart_risk' ? (v === 'low' ? 'ok' : v === 'high' ? 'bad' : 'mid') : (v === 'high' ? 'ok' : v === 'low' ? 'bad' : 'mid'); return '<div class="pf-m"><span>' + CSC[k] + '</span>' + chip({ high: '높음', mid: '보통', low: '낮음' }[v] || '불명', good) + '</div>'; }).join('') + '</div>' + (last.verdict ? '<p>' + esc(last.verdict) + '</p>' : '');
    return h + gate2Box(claimMetrics()) + defTable(S.cdefects) + '<p class="pf-sub">※ 권리 확보 수준은 독립 검토 AI의 참고 의견입니다. 권리범위의 확정은 변리사의 전속 책임입니다.</p>';
  }
  function attyResult() {
    var a = S.attorney, h = '';
    if (a.skipped) return '<p>' + chip('검토 생략', 'warn') + ' 본인 출원으로 인간 변리사의 검토 없이 진행하는 것으로 기록되었습니다.</p>';
    if (a.hist && a.hist.length) h += '<div class="pf-tw"><table class="pf-table"><thead><tr><th>검토일</th><th>검토자</th><th>결과</th><th>의견·첨부</th></tr></thead><tbody>' + a.hist.map(function (x) {
      return '<tr><td>' + esc(x.date) + '</td><td>' + esc(x.name) + (x.firm ? '<div class="pf-sub">' + esc(x.firm) + '</div>' : '') + '</td><td>' + chip(RESULT[x.result], x.result === 'ok' ? 'ok' : x.result === 'minor' ? 'mid' : 'bad') + '</td><td>' + esc(String(x.opinion || '').slice(0, 300)).replace(/\n/g, '<br>') + (x.files && x.files.length ? '<div class="pf-sub">첨부: ' + x.files.map(esc).join(', ') + '</div>' : '') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
    return h;
  }
  function resultHtml(id) {
    switch (id) {
      case 'idea': return '<p>' + esc((S.idea.text || '').slice(0, 400)) + (S.idea.text.length > 400 ? '…' : '') + '</p><p class="pf-sub">공개 이력: ' + esc(disclosureLabel()) + ' · 첨부 ' + S.idea.files.length + '개</p>';
      case 'search': return S.cmp || S.searches.length ? resIDR() + resSearch() : '';
      case 'tasks': case 'newtasks': return S.tasks.length ? resTasks() : '';
      case 'diff': case 'supp': return S.ideas.length ? S.ideas.filter(function (x) { return x.kind === id; }).map(function (x) { return '<div class="pf-q"><b>라운드 ' + x.round + '</b><br>' + esc(x.text).replace(/\n/g, '<br>') + '</div>'; }).join('') : '';
      case 'eval1': return resEval('eval1'); case 'research': return resEval('research');
      case 'pri': return resPri();
      case 'spec': case 'specfinal': return S.spec.body ? resSpec() : '';
      case 'review': return resReview();
      case 'draw': return S.figs.length ? resDraw() : '';
      case 'claims': return S.claims.body ? resClaims() : '';
      case 'claimeval': return resClaimEval();
      case 'confirm': return S.confirmed ? '<p>' + chip('확정됨', 'ok') + ' ' + esc(waiverNote()) + '</p>' : '';
      case 'attorney': return attyResult();
      case 'submit': return S.filing.done ? '<p>제출 기록: ' + esc(S.filing.appNo || '(출원번호 미입력)') + ' · 출원일 ' + esc(S.filing.date) + '</p>' : '';
      case 'fee': return S.fee.done ? '<p>납부 기록: ' + esc(S.fee.date) + '</p>' : '';
    } return '';
  }

  function lastEvalHtml() { var e = S.evals[S.evals.length - 1]; return e ? resEval(e.stage) : ''; }
  function currentResult(id) {
    switch (id) {
      case 'idea': return '';
      case 'search': return S.done.search ? resIDR() + resSearch() : '';
      case 'tasks': case 'newtasks': return S.done[id] ? resTasks() : '';
      case 'diff': return resIDR() + (S.tasks.length ? '<h4>답해야 할 과제</h4>' + resTasks() : '') + (S.cmp ? detail('선행 기술 조사 결과', resSearch()) : '');
      case 'supp': return (S.priHist.length ? '<h4>직전 라운드 평가</h4>' + resPri() : lastEvalHtml()) + (S.cmp ? detail('최근 조사·대비 결과', resSearch()) : '');
      case 'eval1': case 'research': return S.done[id] ? resEval(id) : '';
      case 'pri': return S.priHist.length ? resPri() : '';
      case 'spec': case 'specfinal': return S.done[id] && S.spec.body ? resSpec() : '';
      case 'review': return (S.spec.body ? resSpec() : '') + resReview();
      case 'draw': return S.done.draw && S.figs.length ? resDraw() : '';
      case 'claims': return S.done.claims && S.claims.body ? resClaims() : '';
      case 'claimeval': return (S.claims.body ? detail('청구범위 보기', md(S.claims.body)) : '') + (S.creviews.length ? resClaimEval() : '');
      case 'confirm': return S.docs_out.length ? '<p class="pf-sub">확정하면 특허출원서와 00_사안요약이 만들어집니다. 지금까지 작성된 서류: ' + S.docs_out.map(function (d) { return esc(d.type); }).join(' · ') + '</p>' : '';
      case 'attorney': return (S.confirmed ? '' : '') + attyResult();
      case 'submit': return resultHtml('submit');
      case 'fee': return resultHtml('fee');
    }
    return '';
  }
  var STEPS_N = STAGES.length;
  function A() { return S.who !== 'self'; }   // 기본: 변리사 업무 보조(이용자 = 변리사). 'self'는 변리사가 아닌 발명자 본인의 출원 준비
  /* ── 단계별 안내문 ── */
  var INTRO = {
    idea: '발명의 핵심 아이디어를 적어 주세요. 무엇을 풀려는 발명인지, 어떤 구성으로 어떻게 해결하는지, 기존 방법과 무엇이 다른지가 구체적일수록 조사가 정확해집니다.',
    search: '이용자의 입력을 발명 특정서로 정리하고, 구성요소를 일반 용어로 바꿔 국내·해외 특허와 비특허문헌을 검색합니다. 검색 결과로 확인된 문헌만 표에 올립니다.',
    tasks: '선행 기술과 차별화하고 특허 취득 가능성을 높이기 위해 이용자가 답해야 할 과제를 정리합니다.',
    diff: '위 과제에 대한 차별화 아이디어를 제출해 주세요. 모르는 과제는 "모름"이라고 적어도 됩니다. 말하지 않은 내용은 명세서에 만들어 넣지 않습니다.',
    eval1: '제출한 차별화 아이디어가 선행 기술과 실제로 구별되는지 평가합니다.',
    supp: '평가와 새 과제를 보고 보완 아이디어를 제출해 주세요. 기준에 이를 때까지 이 단계가 반복됩니다.',
    research: '보완 내용을 반영해 다시 조사하고 차별화 수준을 평가합니다.',
    newtasks: '재조사 결과에 맞춰 남은 과제를 새로 정리합니다.',
    pri: '차별화 수준과 특허 취득 가능성을 평가합니다. 내부 착수 기준(90)에 이르면 명세서 초안 작성으로 넘어가고, 아니면 보완 라운드가 이어집니다.',
    spec: '확정한 내용과 조회된 문헌을 바탕으로 명세서(발명의 설명) 초안을 씁니다. 말하지 않은 실시예·수치는 만들지 않고 [발명자 확인 필요]로 표시합니다.',
    review: '명세서를 읽고 표시된 확인 사항에 답하거나 수정을 요청해 보완합니다. 작성과 분리된 새 AI가 결함을 찾는 독립 검토도 여기서 반복합니다.',
    specfinal: '보완이 끝난 명세서를 최종본으로 정리합니다. 새 사실은 추가하지 않습니다(출원 후에는 보충할 수 없습니다).',
    draw: '최종 명세서에 맞는 도면과 요약서를 만듭니다. 도면 부호는 명세서의 "부호의 설명"과 맞춥니다.',
    claims: '명세서에 뒷받침되는 청구범위를 씁니다. 독립항은 차별 구성을 포함하고, 종속항은 보정 대비 계단으로 구성합니다.',
    claimeval: '청구범위의 권리 확보 수준을 독립 검토 AI가 평가합니다(범위의 넓이·뒷받침·회피설계·종속항 안전망·선행기술 위험).',
    confirm: '출원서에 들어갈 서지사항을 입력하고 최종 확정합니다. 확정 이후에도 제출은 이용자(또는 변리사)가 직접 합니다.',
    attorney: '출원 전 인간 변리사의 최종 검토를 받습니다. 나비는 변리사를 소개·연결하지 않으니, 직접 선택하신 변리사에게 아래 검토 요청 패키지를 전달하고, 받으신 검토 결과를 이 단계에 기록해 주세요. 청구범위의 확정과 제출은 변리사의 업무입니다.',
    submit: '이 도구는 지식재산처에 서류를 제출하지 않습니다. 아래 서류를 내려받아 출원인 본인(또는 변리사)이 특허로에서 직접 제출한 뒤, 결과를 기록해 주세요.',
    fee: '수수료 납부도 이용자(또는 변리사)가 직접 합니다. 현행 금액을 조회해 확인하고 납부한 뒤 기록해 주세요.'
  };

  var INTRO_A = {
    idea: '발명자(의뢰인)로부터 받은 핵심 아이디어를 적어 주세요. 무엇을 풀려는 발명인지, 어떤 구성으로 어떻게 해결하는지, 기존 방법과 무엇이 다른지가 구체적일수록 조사가 정확해집니다. 발명자가 보낸 자료는 첨부 아이콘으로 올릴 수 있습니다.',
    diff: '위 과제에 대해 발명자와 협의한 차별화 아이디어를 제출해 주세요. 확인하지 못한 과제는 "미확인"이라고 적어도 됩니다. 발명자가 말하지 않은 내용은 명세서에 만들어 넣지 않습니다.',
    supp: '평가와 새 과제를 보고 발명자에게 확인한 보완 아이디어를 제출해 주세요. 기준에 이를 때까지 이 단계가 반복됩니다.',
    review: '명세서의 확인 표시 항목과 아래 지적을 발명자에게 확인하고, 그 답변과 수정 사항을 적어 보완합니다. 작성과 분리된 새 AI가 결함을 찾는 독립 검토도 여기서 반복합니다.',
    confirm: '출원서에 들어갈 서지사항을 입력하고 최종 확정합니다. 확정 이후에도 기명날인과 제출은 담당 변리사가 직접 합니다.',
    attorney: '담당 변리사가 서류 전체를 직접 검토·수정하고 청구범위를 확정한 결과를 기록합니다. 사무소 내 다른 변리사나 외부 변리사의 검토를 받는 경우 검토자 구분을 바꿔 기록하세요. 나비는 다른 변리사를 소개·연결하지 않습니다. 기명날인과 제출은 변리사가 직접 합니다.',
    submit: '이 도구는 지식재산처에 서류를 제출하지 않습니다. 아래 서류를 내려받아 담당 변리사가 특허로에서 직접 제출한 뒤, 결과를 기록해 주세요.',
    fee: '수수료 납부도 담당 변리사가 직접 합니다. 현행 금액을 조회해 확인하고 납부한 뒤 기록해 주세요.'
  };
  function intro(id) { return (A() && INTRO_A[id]) || INTRO[id]; }

  /* ── 단계별 입력·작업 영역 ── */
  function actionsHtml(id) {
    var h = '';
    if (id === 'idea') {
      h += '<div class="pf-warn">🔒 ' + (A() ? '<b>의뢰인(발명자)의 정보는 필요한 범위에서 가명으로 바꿔 입력하세요.</b> 입력한 내용은 AI 서버로 전송되어 처리되므로, 변리사의 비밀유지 의무를 고려해 의뢰인에게 AI 도구 사용을 알리고 필요한 동의를 받아 주세요. ' : '<b>개인정보·영업비밀 고유 명칭은 가명으로 바꿔 입력하세요.</b> 입력한 내용은 AI 서버로 전송되어 처리됩니다. ') + '선행기술 검색에는 핵심 구성을 숨긴 일반 용어만 쓰지만, 이 화면의 내용을 외부에 게시하지 마세요(출원 전 공개는 신규성을 잃게 할 수 있습니다).</div>';
      h += field('idea.text', 8, (A() ? '발명자가 전한 내용을 적어 주세요. ' : '') + '예: 야간에 농작물 병해충을 조기에 감지하기 위해, 드론 카메라 영상에서 잎의 색 변화 패턴을 학습하여…\n문제 → 해결 구성 → 기존 방법과의 차이 순서로 적어 주세요.', { list: 'idea.files', img: true, btn: '<button type="button" class="pf-btn primary" data-act="start">분석 시작</button>' });
      h += '<div class="pf-row"><b>공개 이력</b> <label><input type="radio" name="dis" data-k="disclosure.status" value="no"' + (S.disclosure.status === 'no' ? ' checked' : '') + '> 없음</label> <label><input type="radio" name="dis" data-k="disclosure.status" value="yes"' + (S.disclosure.status === 'yes' ? ' checked' : '') + '> 있음(논문·전시·판매·SNS 등)</label> <label><input type="radio" name="dis" data-k="disclosure.status" value="unknown"' + (S.disclosure.status === 'unknown' ? ' checked' : '') + '> 모름</label>' + (S.disclosure.status === 'yes' ? ' <input class="pf-in" data-k="disclosure.date" placeholder="공개일 예: 2026-03-10" value="' + esc(S.disclosure.date) + '">' : '') + '</div>';
      h += '<div class="pf-row"><b>검색에 쓰지 않을 고유 명칭</b> <input class="pf-in wide" data-k="avoid" placeholder="상표·회사명·제품명 등, 쉼표로 구분(선택)" value="' + esc(S.avoid) + '"></div>';
      h += '<div class="pf-row"><b>사용 방식</b> <label><input type="radio" name="who" data-k="who" value="attorney"' + (A() ? ' checked' : '') + '> 변리사 업무 보조 (기본)</label> <label><input type="radio" name="who" data-k="who" value="self"' + (!A() ? ' checked' : '') + '> 변리사가 아닌 발명자 본인의 출원 준비</label></div>';
      if (A()) h += '<label class="pf-row pf-consent"><input type="checkbox" data-k="clientOk"' + (S.clientOk ? ' checked' : '') + '> 발명자(의뢰인)에게 AI 도구 사용과 입력 정보의 처리 방식을 알렸고, 필요한 동의를 받았습니다.</label>';
      h += '<label class="pf-row pf-consent"><input type="checkbox" data-k="consent"' + (S.consent ? ' checked' : '') + '> 위 기밀 고지를 읽었고, 입력 내용이 AI 서버와 검색(일반 용어 질의)에 쓰이는 데 동의합니다. 이 도구는 AI이며 변리사가 아니고, 제출·납부·서명을 하지 않는다는 점을 이해했습니다.</label>';
    }
    if (id === 'diff' || id === 'supp') {
      if (id === 'supp' && S.tasks.length) h += '<div class="pf-q"><b>답해야 할 새 과제</b>' + resTasks() + '</div>';
      if (id === 'diff') h += '<label class="pf-row pf-consent"><input type="checkbox" data-k="idrOk"' + (S.idrOk ? ' checked' : '') + '> ' + (A() ? '위 「발명 특정서」가 발명자에게 확인한 내용과 일치합니다. 다르면 아래 칸에 바로잡아 적겠습니다.' : '위 「발명 특정서」가 제가 말한 내용과 일치합니다. 다르면 아래 칸에 바로잡아 적겠습니다.') + '</label>';
      h += field('input.' + id, 7, id === 'diff' ? '과제별로 답하거나, 선행 기술과 달리 가져가려는 구성·효과·근거(시험 결과, 수치)를 적어 주세요. 예) T1: …' : '새 과제에 대한 보완 아이디어와 근거 자료를 적어 주세요.', { list: 'pend.' + id, btn: '<button type="button" class="pf-btn primary" data-act="submit-' + id + '">제출</button>' });
    }
    if (id === 'pri' && S.halt) {
      h += '<div class="pf-halt"><b>중단 권고</b> — ' + esc(S.halt.reason) + '<p>한계가 된 요소와 대안(권리범위 조정, 실용신안 검토, 영업비밀 등)을 변리사와 상의해 보세요. 나비는 특정 변리사를 소개·연결하지 않으니 직접 선택하신 변리사와 상담하세요.</p><div class="pf-acts"><button type="button" class="pf-btn" data-act="halt-continue">보완을 계속한다(라운드 추가)</button><button type="button" class="pf-btn warn" data-act="halt-waive">기준 미달인 채 명세서 작성으로 진행(기록됩니다)</button></div></div>';
    }
    if (id === 'review') {
      h += '<h4>발명자의 확인·보완</h4><p class="pf-sub">명세서의 [발명자 확인 필요] 항목과 아래 지적에 대한 답변·수정 요청을 적어 주세요. 사실이 아닌 내용은 적지 마세요.</p>' + field('spec.notes', 6, '예) D2에 대해: 실시 온도는 80~95℃이며 시험 결과는…', { list: 'pend.review', btn: '' });
      h += '<div class="pf-acts"><button type="button" class="pf-btn" data-act="review-run">독립 검토 실행 (새 AI)</button><button type="button" class="pf-btn" data-act="review-revise">보완 반영해 명세서 수정</button><button type="button" class="pf-btn primary" data-act="review-next">최종 명세서 작성으로</button></div>';
    }
    if (id === 'draw') h += '<div class="pf-row">도면 수정 요청 <input class="pf-in wide" data-k="drawFeedback" placeholder="예: 도 2에 데이터 흐름 화살표 추가(선택)" value="' + esc(S.drawFeedback || '') + '"> <button type="button" class="pf-btn sm" data-act="redraw">다시 그리기</button></div>';
    if (id === 'claimeval' && S.creviews.length) h += '<div class="pf-acts"><button type="button" class="pf-btn" data-act="claims-review">한 번 더 독립 검토 (다른 AI)</button><button type="button" class="pf-btn" data-act="claims-rewrite">지적을 반영해 청구범위 다시 쓰기</button><button type="button" class="pf-btn primary" data-act="claims-next">출원서 확정 단계로</button></div>';
    if (id === 'confirm') {
      var b = S.biblio, c = S.input.confirm || {};
      h += '<div class="pf-form"><label>출원인 구분 <select data-k="biblio.who"><option value="person"' + (b.who === 'person' ? ' selected' : '') + '>개인</option><option value="corp"' + (b.who === 'corp' ? ' selected' : '') + '>법인</option></select></label>' +
        '<label>출원인 성명(명칭) <input class="pf-in" data-k="biblio.name" value="' + esc(b.name) + '"></label><label>출원인 주소 <input class="pf-in" data-k="biblio.addr" value="' + esc(b.addr) + '"></label>' +
        '<label>특허고객번호(출원인코드) <input class="pf-in" data-k="biblio.code" placeholder="없으면 비워 두세요" value="' + esc(b.code) + '"></label><label>발명자 성명 <input class="pf-in" data-k="biblio.inventors" placeholder="여러 명이면 쉼표로" value="' + esc(b.inventors) + '"></label></div>' +
        '<p class="pf-sub">🔒 주민등록번호·사업자등록번호·인증서·비밀번호는 입력하지 마세요. 이 정보는 AI로 전송되지 않고 화면에서 출원서 초안에 직접 채워집니다.</p>' +
        (A() ? ['발명자·출원인 정보가 정확합니다(발명자에게 확인했습니다).', '명세서의 모든 실시예·수치는 발명자에게 확인한 사실입니다(말하지 않은 내용이 들어 있지 않습니다).', '공개 이력을 발명자에게 확인했습니다.', '출원 후에는 최초 명세서·도면에 없는 내용을 추가할 수 없고, 제출은 되돌릴 수 없음을 이해했습니다.'] : ['발명자·출원인 정보가 정확합니다.', '명세서의 모든 실시예·수치는 사실입니다(말하지 않은 내용이 들어 있지 않습니다).', '공개 이력을 모두 알렸습니다.', '출원 후에는 최초 명세서·도면에 없는 내용을 추가할 수 없고, 제출은 되돌릴 수 없음을 이해했습니다.']).map(function (t, i) { var k = 'abcd'[i]; return '<label class="pf-row pf-consent"><input type="checkbox" data-k="input.confirm.' + k + '"' + (c[k] ? ' checked' : '') + '> ' + t + '</label>'; }).join('') +
        '<div class="pf-row">확정하려면 <b>확정</b>이라고 입력 <input class="pf-in" data-k="input.confirm.typed" value="' + esc(c.typed || '') + '"> <button type="button" class="pf-btn primary" data-act="confirm">최종 출원서 확정</button></div>';
    }
    if (id === 'attorney') {
      var a = S.attorney, ch = a.chk || {}, last = (a.hist || [])[(a.hist || []).length - 1];
      h += '<div class="pf-warn">⚖ ' + (A() ? '<b>이 단계는 이 화면 밖에서 담당 변리사가 하는 일입니다.</b> 서류 전체를 직접 검토·수정하고 청구범위를 확정한 뒤 그 결과를 기록해 주세요. 사무소 내 다른 변리사나 외부 변리사의 검토를 받는다면 검토자 구분을 바꿔 기록합니다. 나비는 다른 변리사를 소개·추천·연결하지 않으며 변리사의 등록 여부도 확인하지 않습니다. 기명날인과 특허청(지식재산처)에 대한 제출은 변리사의 업무입니다.' : '<b>이 단계는 이 화면 밖에서 이루어집니다.</b> 나비는 변리사를 소개·추천·연결하지 않으며 변리사의 등록 여부도 확인하지 않습니다. <b>직접 선택하신 변리사</b>에게 아래 패키지를 전달하고(등록 여부는 이용자가 직접 확인), 변리사가 검토한 결과를 아래에 기록해 주세요. 변리사법상 청구범위의 확정과 특허청에 대한 제출은 변리사의 업무입니다.') + '</div>';
      h += '<div class="pf-acts"><button type="button" class="pf-btn primary" data-act="dl-all">검토 요청 패키지 내려받기 (전체 서류 + 검토 요청서)</button></div><p class="pf-sub">패키지 맨 앞에 「변리사 검토 요청서」가 들어 있고, 청구범위·선행기술 원문 확인 상태·미해결 지적이 정리되어 있습니다.</p>';
      if (last && (last.result === 'major' || last.result === 'hold') && !S.done.attorney) {
        h += '<div class="pf-halt"><b>' + (last.result === 'hold' ? '출원 보류 의견이 기록되었습니다.' : '중대한 수정이 필요하다는 의견이 기록되었습니다.') + '</b><p>' + (last.result === 'hold' ? '출원을 진행하지 않거나, 변리사와 상의해 보완한 뒤 다시 검토를 받으세요. 보완하려면 아래에서 되돌아갈 단계를 선택합니다.' : '변리사의 의견을 반영해 해당 단계로 돌아갑니다. 의견은 자동으로 전달되며, 말하지 않은 내용은 추가되지 않습니다.') + '</p><div class="pf-acts"><button type="button" class="pf-btn" data-act="atty-rework" data-id="review">명세서 보완으로 돌아가기(11단계)</button><button type="button" class="pf-btn" data-act="atty-rework" data-id="claims">청구범위 다시 쓰기(14단계)</button></div></div>';
      }
      h += '<h4>변리사 검토 결과 기록</h4><div class="pf-form">' +
        '<label>검토자 구분 <select data-k="attorney.type">' + (A() ? '<option value="self_attorney"' + (a.type === 'self_attorney' ? ' selected' : '') + '>담당 변리사 본인</option><option value="external"' + (a.type === 'external' ? ' selected' : '') + '>다른 검토 변리사(사무소 내·외부)</option>' : '<option value="external" selected>직접 선택한 변리사</option>') + '</select></label>' +
        '<label>' + (A() && a.type === 'self_attorney' ? '담당 변리사 성명(본인)' : '변리사 성명') + ' <input class="pf-in" data-k="attorney.name" value="' + esc(a.name) + '"></label><label>소속(특허법인·사무소, 선택) <input class="pf-in" data-k="attorney.firm" value="' + esc(a.firm) + '"></label>' +
        '<label>검토일 <input class="pf-in" data-k="attorney.date" placeholder="YYYY-MM-DD" value="' + esc(a.date) + '"></label>' +
        '<label>검토 결과 <select data-k="attorney.result"><option value="">선택</option>' + Object.keys(RESULT).map(function (k) { return '<option value="' + k + '"' + (a.result === k ? ' selected' : '') + '>' + RESULT[k] + '</option>'; }).join('') + '</select></label></div>';
      h += field('attorney.opinion', 5, '변리사의 의견·수정 요청 사항을 적어 주세요(수정이 필요하거나 보류인 경우 필수). 의견서나 수정본 파일은 첨부 아이콘으로 올릴 수 있습니다.', { list: 'attorney.files', btn: '' });
      h += '<label class="pf-row pf-consent"><input type="checkbox" data-k="attorney.chk.a"' + (ch.a ? ' checked' : '') + '> 변리사가 청구범위를 직접 검토했고, 권리범위의 설정은 변리사가 확정했습니다.</label>' +
        '<label class="pf-row pf-consent"><input type="checkbox" data-k="attorney.chk.b"' + (ch.b ? ' checked' : '') + '> 변리사가 선행기술(원문 확인 상태 포함)과 공개 이력을 검토했습니다.</label>' +
        (a.result === 'minor' ? '<label class="pf-row pf-consent"><input type="checkbox" data-k="attorney.chk.c"' + (ch.c ? ' checked' : '') + '> 변리사가 요청한 경미한 수정을 모두 반영했습니다(변리사 수정본이 있으면 제출은 그 파일 기준입니다).</label>' : '') +
        '<div class="pf-acts"><button type="button" class="pf-btn primary" data-act="atty-record">검토 결과 기록</button></div>';
      if (S.who === 'self') h += detail('변리사 검토 없이 진행하려면 (본인 출원만 · 기록됩니다)', '<p class="pf-sub">특허 명세서·청구범위는 출원 후 보충할 수 없고 권리범위는 청구범위로 정해집니다. 검토 없이 진행하면 그 위험은 이용자에게 있으며, 이 사실이 서류와 사안 요약에 기록됩니다.</p><div class="pf-row"><input class="pf-in" data-k="attorney.typed" placeholder="「검토 없이 진행」 입력" value="' + esc(a.typed || '') + '"> <button type="button" class="pf-btn warn" data-act="atty-waive">검토 없이 진행</button></div>');
      else h += '<p class="pf-sub">변리사 업무 보조 모드에서는 이 단계를 생략할 수 없습니다. 본인이 등록 변리사이면 검토자 구분에서 「본인이 등록 변리사」를 선택해 직접 검토한 결과를 기록하세요.</p>';
    }
    if (id === 'submit') {
      h += '<div class="pf-halt"><b>이 도구는 제출하지 않습니다.</b> 변리사법상 특허청(지식재산처)에 대한 대리·제출은 변리사의 업무이고, 이 도구는 AI입니다. 출원인 본인(또는 변리사)이 직접 제출합니다.</div>';
      h += '<div class="pf-acts"><button type="button" class="pf-btn primary" data-act="dl-all">전체 서류 한 파일로 내려받기(웹 표준 서식)</button></div><p class="pf-sub">개별 서류와 도면(SVG)은 아래 「작성된 문서」·도면 목록에서도 내려받을 수 있습니다. 특허로 제출 형식은 현행 안내를 따르며 변환은 변리사(또는 본인)가 합니다.</p>';
      if (S.figs.length) h += '<div class="pf-acts">' + S.figs.map(function (f) { return '<button type="button" class="pf-btn sm" data-act="dl-fig" data-id="' + f.no + '">도 ' + f.no + ' SVG</button>'; }).join('') + '</div>';
      h += '<ol class="pf-steps"><li>특허고객번호(출원인코드)를 확보합니다(없으면 신규 발급).</li><li>특허로에서 이용할 인증 수단을 등록합니다(현행 방식은 특허로 안내 확인).</li><li>특허로의 전자출원(웹 작성/제출 또는 전자출원 SW)에서 출원서·명세서·청구범위·도면·요약서를 작성·첨부합니다.</li><li>제출 전 미리보기·오류를 점검합니다.</li><li>제출하고 접수번호를 확인합니다. <b>(출원인 본인 또는 변리사가 직접)</b></li></ol>';
      h += '<div class="pf-row">출원번호 <input class="pf-in" data-k="input.appNo" placeholder="받으셨다면(선택)" value="' + esc(S.input.appNo || '') + '"> 출원일 <input class="pf-in" data-k="input.appDate" placeholder="YYYY-MM-DD" value="' + esc(S.input.appDate || '') + '"></div><label class="pf-row pf-consent"><input type="checkbox" data-k="input.filedOk"' + (S.input.filedOk ? ' checked' : '') + '> ' + (A() ? '담당 변리사가 직접 제출을 마쳤습니다.' : '제가(또는 변리사가) 직접 제출을 마쳤습니다.') + '</label><div class="pf-acts"><button type="button" class="pf-btn primary" data-act="filed">제출 완료 기록</button></div>';
    }
    if (id === 'fee') {
      h += '<div class="pf-acts"><button type="button" class="pf-btn" data-act="fee-lookup">현행 수수료 안내 조회</button></div>';
      if (S.fee.err) h += '<p class="pf-err">' + esc(S.fee.err) + '</p>';
      if (S.fee.hits && S.fee.hits.length) h += '<div class="pf-tw"><table class="pf-table"><tbody>' + S.fee.hits.map(function (o) { return '<tr><td><a href="' + esc(o.link) + '" target="_blank" rel="noopener noreferrer">' + esc(o.title) + '</a><div class="pf-sub">' + esc(o.snippet) + '</div></td></tr>'; }).join('') + '</tbody></table></div><p class="pf-note">검색 결과 기준의 안내입니다. 금액·감면 여부는 <b>납부 직전에 특허로가 고지하는 금액</b>으로 확인하세요(청구항 수에 따라 달라지는 수수료가 있습니다).</p>';
      h += '<p class="pf-sub">납부는 특허로에서 출원인 본인(또는 변리사)이 직접 합니다. 이 도구는 결제를 대행하지 않습니다.</p><div class="pf-row">납부일 <input class="pf-in" data-k="input.feeDate" placeholder="YYYY-MM-DD" value="' + esc(S.input.feeDate || '') + '"></div><label class="pf-row pf-consent"><input type="checkbox" data-k="input.feeOk"' + (S.input.feeOk ? ' checked' : '') + '> ' + (A() ? '담당 변리사가 직접 납부를 마쳤습니다.' : '제가(또는 변리사가) 직접 납부를 마쳤습니다.') + '</label><div class="pf-acts"><button type="button" class="pf-btn primary" data-act="fee-done">납부 완료 기록</button></div>';
      if (S.fee.done && S.filing.date) h += '<div class="pf-done"><b>모든 단계를 마쳤습니다.</b> 출원일 ' + esc(S.filing.date) + ' 기준 후속 일정(법정 기한은 현행 규정으로 재확인):<div class="pf-tw"><table class="pf-table"><tbody>' + followDates(S.filing.date, S.disclosure.status === 'yes').map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td>' + r[1] + '</td></tr>'; }).join('') + '</tbody></table></div>심사 단계의 의견제출통지가 오면 기한 안에 변리사(또는 본인)가 대응해야 합니다. 통지서를 아래 「그 밖의 서류 작성」 대화창에 올려 의견서·보정서 초안을 요청할 수 있습니다.</div>';
    }
    return h;
  }

  /* ── 전체 화면 ── */
  function progressHtml() {
    var cur = stageOf(S.stage), segs = STAGES.map(function (s) {
      var cls = S.done[s.id] && !(S.halt && s.id === 'pri') ? 'done' : (s.id === S.stage ? 'cur' : 'todo');
      return '<button type="button" class="pf-seg ' + cls + '" data-act="peek" data-id="' + s.id + '" title="' + s.n + '. ' + esc(s.t) + '" aria-label="' + s.n + '단계 ' + esc(s.t) + '"></button>';
    }).join('');
    var counts = [0, 0, 0, 0, 0, 0]; STAGES.forEach(function (s) { counts[s.g]++; });
    var groups = [1, 2, 3, 4, 5].map(function (g) { return '<span style="grid-column:span ' + counts[g] + '">' + GROUPS[g] + '</span>'; }).join('');
    var list = STAGES.map(function (s) { var d = S.done[s.id], c = s.id === S.stage; return '<li class="' + (d ? 'done' : c ? 'cur' : '') + '"><button type="button" data-act="peek" data-id="' + s.id + '">' + s.n + '. ' + esc(s.t) + '</button>' + (d ? ' ✓' : '') + '</li>'; }).join('');
    return '<div class="pf-prog"><div class="pf-prog-hd"><b>' + cur.n + ' / ' + STAGES.length + '</b> · ' + esc(cur.t) + (cur.loop ? ' ' + chip('보완 라운드 ' + S.round, 'mid') : '') + '</div><div class="pf-segs">' + segs + '</div><div class="pf-groups">' + groups + '</div>' + detail('전체 단계 보기', '<ol class="pf-list">' + list + '</ol>') + '</div>';
  }
  function render() {
    var root = $('pfRoot'); if (!root) return;
    var cur = stageOf(S.stage), id = cur.id, html = '';
    html += '<div class="pf-head"><h2>신규 발명 특허 출원 업무 보조</h2><p>발명자로부터 받은 핵심 아이디어 → 선행기술 조사 → 차별화 → 명세서·도면·청구항 → 담당 변리사의 최종 검토 → 출원서 제출·납부까지 ' + STEPS_N + '단계로 지원합니다. ' + (A() ? '<b>서류는 변리사의 검토·확정 전에는 제출할 수 없는 초안이며, 기명날인·제출·수수료 납부는 담당 변리사가 직접</b> 합니다.' : '<b>제출과 수수료 납부는 이용자 본인이 직접</b> 하며, 변리사의 검토를 권합니다.') + ' 이 도구는 AI로서 초안과 안내만 제공합니다.</p></div>';
    html += progressHtml();
    if (S.peek && S.peek !== id) { var ps = stageOf(S.peek); var rh = resultHtml(S.peek); html += card(ps.n + '. ' + esc(ps.t) + ' <button type="button" class="pf-link" data-act="peek" data-id="' + S.peek + '">닫기</button>', rh || '<p class="pf-sub">아직 결과가 없습니다.</p>', 'peek'); }
    var inner = '<p class="pf-intro">' + esc(intro(id)) + '</p>';
    if (busy) inner += '<div class="pf-busy"><span class="pf-spin"></span> 작업 중입니다. 잠시만 기다려 주세요…</div>';
    var rr = currentResult(id); if (rr) inner += '<div class="pf-res">' + rr + '</div>';
    if (S.err && !busy) inner += errBox(); else if (S.formErr && S.formErr.length) inner += errBox();
    if (!busy) {
      var st = cur.kind;
      if (st === 'auto' && !S.done[id] && !S.err && !(id === 'claimeval' && S.creviews.length)) inner += '<div class="pf-acts"><button type="button" class="pf-btn primary" data-act="rerun" data-id="' + id + '">이 단계 실행</button></div>';
      else if (st === 'auto' && S.done[id] && id !== 'claimeval' && !(id === 'pri' && S.halt)) inner += '<div class="pf-acts"><button type="button" class="pf-btn sm" data-act="rerun" data-id="' + id + '">이 단계 다시 실행</button></div>';
      inner += actionsHtml(id);
    }
    html += card(cur.n + '. ' + esc(cur.t), inner, 'cur');
    html += '<div class="pf-foot"><button type="button" class="pf-link" data-act="export">진행 파일 내려받기(.json — 입력 내용이 들어 있으니 보관에 주의)</button> · <button type="button" class="pf-link" data-act="import">진행 파일 불러오기</button><input type="file" id="pf-import" accept=".json" style="display:none"> · <button type="button" class="pf-link" data-act="reset">처음부터 다시 시작</button><div class="pf-sub">진행 내용은 이 브라우저 탭에만 임시 저장됩니다. 평가 수치는 참고 지표이며 특허성 판단의 확정이 아닙니다.</div></div>';
    root.innerHTML = html;
  }

  /* ═════════════════ 이벤트·초기화 ═════════════════ */
  function base() { return Object.assign(fresh(), { cmp: null, taskHist: [], taskSummary: '', drawFeedback: '', figWarn: [], figDesc: '', figParts: '', peek: null, err: null, formErr: null, input: { diff: '', supp: '', confirm: {}, appNo: '', appDate: '', feeDate: '' }, pend: { diff: [], supp: [], review: [] } }); }
  function init() {
    var root = $('pfRoot'); if (!root) return;
    var loaded = load(); S = Object.assign(base(), loaded || {});
    if (!S.attorney) S.attorney = base().attorney;   // 이전 버전에서 저장된 진행 파일 호환
    if (S.done.confirm && !S.done.attorney && !S.filing.done && (S.stage === 'submit' || S.stage === 'fee')) S.stage = 'attorney';   // 이전 버전: 변리사 검토 없이 제출 단계에 있던 진행은 새 단계로
    var t = document.createElement('div'); t.id = 'pf-toast'; t.className = 'pf-toast'; t.innerHTML = '<div class="pf-toast-hd"><span class="pf-spin"></span><b>처리 중</b></div><div class="pf-toast-track"><div class="pf-toast-bar" id="pf-toast-bar"></div></div><div class="pf-toast-label" id="pf-toast-label"></div>'; document.body.appendChild(t);
    root.addEventListener('click', function (e) { var b = e.target.closest ? e.target.closest('[data-act]') : null; if (b) { e.preventDefault(); act(b.getAttribute('data-act'), b); } });
    root.addEventListener('input', function (e) { var k = e.target.getAttribute && e.target.getAttribute('data-k'); if (!k || e.target.type === 'checkbox' || e.target.type === 'radio') return; setPath(S, k, e.target.value); save(); });
    root.addEventListener('change', function (e) {
      var tg = e.target, k = tg.getAttribute && tg.getAttribute('data-k');
      if (k) { if (tg.type === 'checkbox') setPath(S, k, tg.checked); else if (tg.type === 'radio') { if (tg.checked) { setPath(S, k, tg.value); if (k === 'who' && S.attorney) S.attorney.type = tg.value === 'self' ? 'external' : 'self_attorney'; save(); render(); return; } } else setPath(S, k, tg.value); save(); if (k === 'attorney.result' || k === 'attorney.type') render(); return; }
      if (tg.getAttribute && tg.getAttribute('data-attach') && tg.files && tg.files.length) { attachTo(tg.getAttribute('data-attach'), Array.prototype.slice.call(tg.files), !!tg.getAttribute('data-img')); return; }
      var v = tg.getAttribute && tg.getAttribute('data-verify');
      if (v && tg.files && tg.files[0]) { readAttachment(tg.files[0], false).then(function (a) { if (a.text) { S.verified[v] = { name: a.name, text: a.text }; save(); render(); } else window.alert('이 파일에서 글자를 읽지 못했습니다(' + (a.note || '') + '). 텍스트가 있는 PDF·DOCX·TXT로 첨부해 주세요.'); }); return; }
      if (tg.id === 'pf-import' && tg.files && tg.files[0]) { tg.files[0].text().then(function (txt) { try { var o = JSON.parse(txt); if (!o || o.v !== 1) throw new Error('형식 오류'); S = Object.assign(base(), o); save(); render(); } catch (er) { window.alert('진행 파일을 읽지 못했습니다.'); } }); }
    });
    root.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && S.stage === 'idea') { e.preventDefault(); startFlow(); } });
    render();
  }
  window.PatentFlow = {
    state: function () { return S; }, reset: function () { S = base(); save(); render(); },
    _t: { md: md, parseJSON: parseJSON, parseSections: parseSections, sanitizeSvg: sanitizeSvg, computePRI: computePRI, rCap: rCap, coverage: coverage, metrics: metrics, normQueries: normQueries, afterPri: afterPri, followDates: followDates, STAGES: STAGES, fresh: fresh, base: base, exec: exec, act: act, setState: function (s) { S = s; }, isBusy: function () { return busy; }, showNum: showNum, buildDoc: buildDoc }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
