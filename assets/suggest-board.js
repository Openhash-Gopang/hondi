/* ══════════════════════════════════════════════════════════════════
   suggest-board.js — 「제안 및 질문」 페이지(/pages/suggest.html) 공용 스크립트 (2026-10-17 신설)

   하는 일
     1) 저장소 요약(/data/repo-digest.md)과 최근 게시판 글을 읽어 chat-widget 의 대화 컨텍스트로 붙인다.
        (대화 상대 SP 는 SP_SUGGEST_QUESTION — 위젯이 prompts/ 에서 읽는다)
     2) AI 가 답변 끝에 붙인 [SQ_RECORD]{…}[/SQ_RECORD] 를 화면에서 떼어 내고, 「정리 카드」 + 「이대로 게시판에 기록」 버튼으로 바꾼다.
        기록은 기존 제안 게시판 API(POST /feedback)를 그대로 쓴다 — 새 백엔드·DB 변경 없음.
        내용은 한 덩어리 텍스트로 저장한다:   [제안] 제목 ⏎ #태그 #태그 ⏎ --- ⏎ 본문 [⏎⏎ 출처: 페이지 id]
     3) 게시판(GET /feedback)에서 위 형식의 글만 골라 시간순(최신순)으로 보여 준다. 제안/질문·태그 필터.
   기록하는 사람: 로그인한 사용자(localStorage gopang_user_v4 의 handle/ipv6) — feedback.html 과 같은 방식.
   GDC 보상: 지급 메커니즘은 추후 결정 — 화면에는 「추후 결정」으로만 표시한다.
   순수 함수(encode/parse 등)는 Node 테스트에서도 쓸 수 있게 module.exports 로 내보낸다.
   ══════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HondiSuggest = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var PROXY = 'https://hondi-proxy.tensor-city.workers.dev';
  var DIGEST_URL = '/data/repo-digest.md';
  var USER_KEY = 'gopang_user_v4';
  var KINDS = ['제안', '질문'];
  var TITLE_MAX = 40, BODY_MAX = 800, TAGS_MAX = 3, TAG_MAX = 12;
  var RECORD_RE = /\[SQ_RECORD\]([\s\S]*?)\[\/SQ_RECORD\]/;

  // ── 순수 함수 ────────────────────────────────────────────
  function normalizeTags(tags) {
    var out = [];
    (Array.isArray(tags) ? tags : []).forEach(function (t) {
      var s = String(t == null ? '' : t).replace(/\s+/g, '').replace(/^#*/, '');
      if (!s) return;
      s = '#' + s.slice(0, TAG_MAX);
      if (out.indexOf(s) < 0) out.push(s);
    });
    return out.slice(0, TAGS_MAX);
  }

  // 모델이 낸 레코드를 검증·정규화한다. 쓸 수 없으면 null.
  function sanitizeRecord(r) {
    if (!r || typeof r !== 'object') return null;
    var kind = KINDS.indexOf(r.kind) >= 0 ? r.kind : null;
    var title = String(r.title == null ? '' : r.title).replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
    var body = String(r.body == null ? '' : r.body).replace(/\r/g, '').trim().slice(0, BODY_MAX);
    if (!kind || !title || !body) return null;
    // 본문에 구분선 줄이 있으면 파싱이 깨지므로 무해한 형태로 바꾼다.
    body = body.replace(/^---+\s*$/gm, '—');
    return { kind: kind, title: title, body: body, tags: normalizeTags(r.tags) };
  }

  // 답변 텍스트에서 기록 블록을 떼어 낸다 → { text, record|null }
  function extractRecord(reply) {
    var s = String(reply == null ? '' : reply);
    var m = s.match(RECORD_RE);
    var text = s.replace(/\[SQ_RECORD\][\s\S]*?\[\/SQ_RECORD\]/g, '').replace(/\n{3,}/g, '\n\n').trim();
    // 닫는 표시 없이 끝난 블록(답변이 잘린 경우)도 화면에는 보이지 않게 한다.
    text = text.replace(/\[SQ_RECORD\][\s\S]*$/, '').trim();
    if (!m) return { text: text, record: null };
    var rec = null;
    try { rec = sanitizeRecord(JSON.parse(m[1].trim())); } catch (e) { rec = null; }
    return { text: text, record: rec };
  }

  // 게시판(feedback.content)에 저장할 한 덩어리 텍스트
  function encodeContent(rec, from) {
    var r = sanitizeRecord(rec);
    if (!r) return null;
    var head = '[' + r.kind + '] ' + r.title;
    var tags = r.tags.join(' ');
    var out = head + '\n' + tags + '\n---\n' + r.body;
    var f = String(from || '').replace(/[^a-z0-9-]/gi, '').slice(0, 60);
    if (f) out += '\n\n출처: ' + f;
    return out;
  }

  // feedback 항목 → 게시판 글. 이 형식이 아니면(기존 일반 제안) null.
  function parseItem(item) {
    var c = String((item && item.content) || '');
    var m = c.match(/^\[(제안|질문)\][ \t]*([^\n]*)\n([^\n]*)\n---\n([\s\S]*)$/);
    if (!m) return null;
    var body = m[4], from = '';
    var f = body.match(/\n\n출처: ([a-z0-9-]+)\s*$/i);
    if (f) { from = f[1]; body = body.slice(0, f.index); }
    var tags = (m[3].match(/#[^\s#]+/g) || []).slice(0, TAGS_MAX);
    return {
      id: item.id, kind: m[1], title: m[2].trim(), body: body.trim(), tags: tags, from: from,
      handle: item.handle || '', created: item.created || '', status: item.status || 'pending'
    };
  }

  function formatKst(created) {
    var d = new Date(String(created || '').replace(' ', 'T'));
    if (isNaN(d.getTime())) return '';
    var p = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d);
    return p.replace(',', '');
  }

  function statusLabel(kind, status) {
    if (status === 'reviewing') return { text: '검토중', cls: 'sq-st-rev' };
    if (status === 'accepted') return { text: kind === '질문' ? '답변 완료' : '반영 확정', cls: 'sq-st-ok' };
    if (status === 'rejected') return { text: '보류', cls: 'sq-st-hold' };
    return { text: '접수', cls: 'sq-st-new' };
  }

  // 게시판 글 목록(시간 역순) 만들기
  function buildBoard(items) {
    var posts = [];
    (items || []).forEach(function (it) { var p = parseItem(it); if (p) posts.push(p); });
    posts.sort(function (a, b) { return a.created < b.created ? 1 : a.created > b.created ? -1 : 0; });
    return posts;
  }

  function filterBoard(posts, kind, tag) {
    return posts.filter(function (p) { return (!kind || p.kind === kind) && (!tag || p.tags.indexOf(tag) >= 0); });
  }

  // 대화 컨텍스트(저장소 요약 + 최근 게시판 글) 만들기
  function buildContext(digest, posts, mode) {
    var out = ['사용자는 지금 「제안 및 질문」 페이지에 있다. 이 화면은 대화로 의도를 확인한 뒤 게시판에 기록한다.'];
    if (mode) out.push('[구분 지정: ' + mode + '] 사용자가 이 구분을 골랐다.');
    out.push('', '[저장소 요약 — 근거는 이것뿐이다]', digest ? String(digest).slice(0, 14000) : '(저장소 요약을 불러오지 못했다. 서비스 내용은 추측하지 말고 확인되지 않는다고 답한다.)');
    var recent = (posts || []).slice(0, 20).map(function (p) { return '- [' + p.kind + '] ' + p.title + ' (' + formatKst(p.created).slice(0, 10) + ')'; });
    out.push('', '[최근 게시판 글]', recent.length ? recent.join('\n') : '- (아직 없음)');
    return out.join('\n');
  }

  function getUser() {
    try {
      var u = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
      if (u && u.ipv6 && u.handle) return { guid: u.ipv6, handle: u.handle };
    } catch (e) {}
    return null;
  }

  function personaFrom() {
    try { return (new URLSearchParams(location.search).get('from') || '').replace(/[^a-z0-9-]/gi, '').slice(0, 60); } catch (e) { return ''; }
  }

  // ── DOM (브라우저에서만) ──────────────────────────────────
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  var state = { posts: [], kind: '', tag: '', mode: '', digest: '', user: null, from: '', loaded: false };

  function renderBoard() {
    var list = document.getElementById('sqList');
    if (!list) return;
    var all = state.posts;
    var cnt = function (k) { return all.filter(function (p) { return !k || p.kind === k; }).length; };
    [['', '전체'], ['제안', '제안'], ['질문', '질문']].forEach(function (x) {
      var b = document.querySelector('[data-sq-kind="' + x[0] + '"]');
      if (b) { b.textContent = x[1] + ' ' + cnt(x[0]); b.classList.toggle('on', state.kind === x[0]); }
    });
    // 태그 칩 (게시된 글의 태그 빈도순)
    var tagBox = document.getElementById('sqTags');
    if (tagBox) {
      tagBox.textContent = '';
      var freq = {};
      all.forEach(function (p) { p.tags.forEach(function (t) { freq[t] = (freq[t] || 0) + 1; }); });
      var all0 = el('button', 'sq-tag' + (state.tag ? '' : ' on'), '전체 태그');
      all0.type = 'button';
      all0.addEventListener('click', function () { state.tag = ''; renderBoard(); });
      tagBox.appendChild(all0);
      Object.keys(freq).sort(function (a, b) { return freq[b] - freq[a] || (a < b ? -1 : 1); }).slice(0, 14).forEach(function (t) {
        var b = el('button', 'sq-tag' + (state.tag === t ? ' on' : ''), t);
        b.type = 'button';
        b.addEventListener('click', function () { state.tag = state.tag === t ? '' : t; renderBoard(); });
        tagBox.appendChild(b);
      });
    }
    list.textContent = '';
    var rows = filterBoard(all, state.kind, state.tag);
    if (!rows.length) {
      list.appendChild(el('p', 'sq-empty', state.loaded ? '아직 기록된 글이 없습니다. 위 입력창에서 첫 제안이나 질문을 남겨 보세요.' : '게시판을 불러오는 중입니다…'));
      return;
    }
    rows.forEach(function (p) {
      var row = el('div', 'sq-row' + (p.id && p.id === state.justPosted ? ' sq-new' : ''));
      row.appendChild(el('span', 'sq-pill ' + (p.kind === '질문' ? 'sq-q' : 'sq-p'), p.kind));
      var main = el('div', 'sq-main');
      var t = el('div', 'sq-titleline');
      t.appendChild(el('span', 'sq-title', p.title));
      var st = statusLabel(p.kind, p.status);
      t.appendChild(el('span', 'sq-pill ' + st.cls, st.text));
      if (p.id && p.id === state.justPosted) t.appendChild(el('span', 'sq-pill sq-st-just', '방금 기록됨'));
      main.appendChild(t);
      main.appendChild(el('p', 'sq-body', p.body));
      var tg = el('div', 'sq-taglist');
      p.tags.forEach(function (x) { tg.appendChild(el('span', 'sq-tagchip', x)); });
      main.appendChild(tg);
      row.appendChild(main);
      var meta = el('div', 'sq-meta');
      meta.appendChild(el('b', '', p.handle || '(알 수 없음)'));
      meta.appendChild(el('span', '', formatKst(p.created)));
      row.appendChild(meta);
      row.appendChild(el('div', 'sq-reward', '추후 결정'));
      list.appendChild(row);
    });
  }

  function loadBoard() {
    var qs = new URLSearchParams({ limit: '100' });
    if (state.user) qs.set('requester_guid', state.user.guid);
    return fetch(PROXY + '/feedback?' + qs.toString())
      .then(function (r) { return r.json(); })
      .then(function (d) { state.posts = buildBoard(d.items || []); })
      .catch(function (e) { console.error('[suggest] 게시판 로드 실패', e); state.posts = state.posts || []; })
      .then(function () { state.loaded = true; renderBoard(); });
  }

  function withTimeout(p, ms) {
    return Promise.race([p, new Promise(function (res) { setTimeout(function () { res(null); }, ms); })]);
  }

  function loadDigest() {
    return fetch(DIGEST_URL, { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('digest ' + r.status); return r.text(); })
      .catch(function (e) { console.error('[suggest] 저장소 요약 로드 실패', e); return ''; });
  }

  // 답변에서 기록 블록을 떼어 낸 텍스트만 화면에 보인다.
  function transformReply(reply) { return extractRecord(reply).text || reply; }

  // 답변 말풍선 아래에 정리 카드 + 기록 버튼을 붙인다.
  function onReply(reply, bubble) {
    var rec = extractRecord(reply).record;
    if (!rec || !bubble) return;
    var card = el('div', 'sq-card');
    var head = el('div', 'sq-card-head');
    head.appendChild(el('span', 'sq-pill ' + (rec.kind === '질문' ? 'sq-q' : 'sq-p'), rec.kind));
    head.appendChild(el('b', '', rec.title));
    card.appendChild(head);
    var dl = el('dl', 'sq-kv');
    function kv(k, v, cls) { dl.appendChild(el('dt', '', k)); dl.appendChild(el('dd', cls || '', v)); }
    kv('내용', rec.body);
    kv('태그', rec.tags.join(' ') || '(없음)');
    kv('작성자', state.user ? state.user.handle : '로그인 후 기록할 수 있습니다');
    kv('일시', '기록하는 시각이 자동으로 들어갑니다');
    kv('GDC 보상', '추후 결정', 'sq-dim');
    card.appendChild(dl);
    var actions = el('div', 'sq-actions');
    var ok = el('button', 'sq-btn sq-btn-main', '이대로 게시판에 기록');
    ok.type = 'button';
    var redo = el('button', 'sq-btn', '고쳐서 다시 정리');
    redo.type = 'button';
    var msg = el('p', 'sq-note', '기록하면 아래 게시판에 작성자 아이디와 함께 공개됩니다.');
    actions.appendChild(ok); actions.appendChild(redo);
    card.appendChild(actions); card.appendChild(msg);
    bubble.appendChild(card);
    var box = document.getElementById('hcw-messages'); if (box) box.scrollTop = box.scrollHeight;   // 카드가 붙은 뒤 맨 아래로

    redo.addEventListener('click', function () {
      redo.disabled = true; ok.disabled = true;
      if (window.HondiChatWidget && window.HondiChatWidget.send) window.HondiChatWidget.send('고쳐서 다시 정리하고 싶어요. 어느 부분을 바꿀지 물어봐 주세요.');
    });
    ok.addEventListener('click', function () {
      if (!state.user) { msg.textContent = '로그인 후 이용해 주세요. 로그인하면 이 카드로 기록할 수 있습니다.'; return; }
      ok.disabled = true; redo.disabled = true; ok.textContent = '기록하는 중…';
      var content = encodeContent(rec, state.from);
      fetch(PROXY + '/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guid: state.user.guid, handle: state.user.handle, content: content, visibility: 'public' })
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (!d || !d.ok) throw new Error((d && (d.detail || d.error)) || '기록 실패');
        ok.textContent = '게시판에 기록했습니다 ✓';
        msg.textContent = '아래 게시판 맨 위에서 확인할 수 있습니다.';
        state.justPosted = d.id || '';
        state.kind = ''; state.tag = '';
        loadBoard().then(function () {
          var b = document.getElementById('sqBoard'); if (b && b.scrollIntoView) b.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }).catch(function (e) {
        ok.disabled = false; redo.disabled = false; ok.textContent = '이대로 게시판에 기록';
        msg.textContent = '기록하지 못했습니다: ' + e.message + ' 잠시 후 다시 눌러 주세요.';
      });
    });
  }

  function bindControls() {
    document.querySelectorAll('[data-sq-kind]').forEach(function (b) {
      b.addEventListener('click', function () { state.kind = b.getAttribute('data-sq-kind'); renderBoard(); });
    });
    document.querySelectorAll('[data-sq-mode]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.mode = b.getAttribute('data-sq-mode');
        document.querySelectorAll('[data-sq-mode]').forEach(function (x) {
          var on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-selected', on ? 'true' : 'false');
        });
      });
    });
    document.querySelectorAll('[data-sq-ask]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (window.HondiChatWidget && window.HondiChatWidget.send) window.HondiChatWidget.send(b.getAttribute('data-sq-ask'));
      });
    });
  }

  function loadWidget() {
    var s = document.createElement('script');
    s.src = '/assets/chat-widget.js';
    document.body.appendChild(s);
  }

  function boot() {
    state.user = getUser();
    state.from = personaFrom();
    bindControls();
    renderBoard();
    Promise.all([withTimeout(loadDigest(), 5000), withTimeout(loadBoard(), 6000)]).then(function (res) {
      var digest = res[0] || '';
      state.digest = digest;
      var fresh = document.getElementById('sqFresh');
      if (fresh) {
        var m = digest.match(/- 갱신: ([^\n]+)/);
        fresh.textContent = m ? '답변 기준: hondi.net 저장소 · 최근 갱신 ' + m[1].replace(/ · 기준 커밋.*/, '') : '답변 기준: 저장소 요약을 불러오지 못했습니다';
      }
      window.HONDI_CHAT_WIDGET_CONFIG = {
        sp: 'SP_SUGGEST_QUESTION',
        panelMode: 'inline', inlineMount: '#startChatMount', mic: true, camera: 'touch',
        maxTokens: 2500,
        panelTitle: '제안 및 질문',
        label: '제안하거나 질문하세요',
        serviceLabel: '제안 및 질문',
        placeholder: '제안하거나 질문할 내용을 입력하세요. 예: 세무사 페이지에 …',
        greeting: '안녕하세요! 혼디에 바라는 점이나 궁금한 점을 말씀해 주세요. 질문에는 저장소 최신 내용을 기준으로 답하고, 제안은 몇 가지 여쭤본 뒤 정리해서 게시판에 기록해 드립니다. 게시판에는 작성자 아이디와 함께 공개됩니다.',
        context: buildContext(digest, state.posts, ''),
        beforeSend: function (text) { return state.mode ? '[구분 지정: ' + state.mode + '] ' + text : text; },
        transformReply: transformReply,
        onReply: onReply
      };
      loadWidget();
    });
  }

  if (typeof document !== 'undefined' && document.getElementById && typeof window !== 'undefined') {
    var go = function () { if (document.getElementById('sqBoard')) boot(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  }

  return {
    normalizeTags: normalizeTags, sanitizeRecord: sanitizeRecord, extractRecord: extractRecord,
    encodeContent: encodeContent, parseItem: parseItem, buildBoard: buildBoard, filterBoard: filterBoard,
    buildContext: buildContext, formatKst: formatKst, statusLabel: statusLabel,
    transformReply: transformReply, onReply: onReply, getUser: getUser,
    LIMITS: { TITLE_MAX: TITLE_MAX, BODY_MAX: BODY_MAX, TAGS_MAX: TAGS_MAX, TAG_MAX: TAG_MAX }
  };
});
