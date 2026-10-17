/* pro-doc-page.js — 전문직 "서류 목록 → 대화 작성 → 웹 표준 서식 제출" 페이지 공통 모듈 (2026-10-13)

   법무사 보조 AI 페이지(pages/judicial-scrivener.html)의 동작을 직군 공통으로 일반화했다.
   페이지는 이 스크립트보다 먼저 아래 설정을 둔다.

     window.PRO_DOC_PAGE = {
       catalog: [ { id, tab, title, meta, lead, notes:[…], items:[{t, d}] } ],   // 업무 영역 → 대표 서류
       detailHead: '…',                           // 선택: 서류 표의 설명 열 제목(기본 '핵심 기재 · 첨부·확인')
       askOtherMessage: '…',                      // 선택: "목록에 없는 서류" 버튼 문구
       startMessage: function (title) { … }       // 선택: 서류 선택 시 첫 메시지
     };

   필요한 DOM: #svcTabs, #svcContent, #draftsCard > #draftsList, #askOther.
   채팅 위젯(assets/chat-widget.js)의 transformReply 에서 window.ProDocPage.transformReply 를
   호출해, AI 답변 속 서류 문서를 "작성된 문서" 카드로 옮기고 내려받기(웹 표준 서식 제출)를 제공한다. */

(function () {
  var BT = String.fromCharCode(96);
  // 서류 목록은 페이지가 window.PRO_DOC_PAGE.catalog 로 넘긴다(정본은 해당 직군 SP의 '문서 카탈로그' 부록 — 목록을 바꿀 때는 SP와 함께 갱신).
  var CFG = window.PRO_DOC_PAGE || {};
  var DOC_CATALOG = CFG.catalog || [];
  if (!DOC_CATALOG.length) return;
  var drafts = [];
  var CHAT_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var DL_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function $(id) { return document.getElementById(id); }

  /* ── 채팅 위젯 호출 ── */
  function askChat(msg) {
    if (window.HondiChatWidget && typeof window.HondiChatWidget.send === 'function') {
      window.HondiChatWidget.send(msg);
    } else {
      window.alert('채팅 아이콘을 불러오지 못했습니다. 페이지를 새로 고친 뒤 다시 시도해 주세요.');
    }
  }
  function startDoc(title) { askChat(CFG.startMessage ? CFG.startMessage(title) : '「' + title + '」를 작성하려고 합니다. 필요한 정보를 순서대로 물어봐 주세요.'); }

  /* ── 탭/목록 ── */
  function renderTabs(activeId) {
    $('svcTabs').innerHTML = DOC_CATALOG.map(function (c) {
      return '<div class="svc-tab' + (c.id === activeId ? ' active' : '') + '" data-cat="' + c.id + '">' + esc(c.tab) + '</div>';
    }).join('');
  }
  function renderCategory(id) {
    var c = DOC_CATALOG.filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    var showDetail = c.items.some(function (it) { return it.d; });
    var h = '<div class="svc-detail"><h2>' + esc(c.title) + '</h2><br><span class="svc-badge svc-badge-meta">' + esc(c.meta) + '</span>';
    if (c.lead) h += '<p class="svc-lead">' + esc(c.lead) + '</p>';
    c.notes.forEach(function (n) { h += '<div class="svc-callout important">' + esc(n) + '</div>'; });
    h += '<div class="svc-table-wrap"><table class="svc-table"><thead><tr><th>서류</th>' + (showDetail ? '<th>' + esc(CFG.detailHead || '핵심 기재 · 첨부·확인') + '</th>' : '') + '<th></th></tr></thead><tbody>';
    c.items.forEach(function (it, i) {
      h += '<tr><td class="doc-title">' + esc(it.t) + '</td>' + (showDetail ? '<td class="doc-detail">' + (it.d ? esc(it.d) : '—') + '</td>' : '') +
        '<td class="doc-act"><button type="button" class="svc-link-btn sm" data-doc="' + i + '">' + CHAT_SVG + '대화로 작성</button></td></tr>';
    });
    h += '</tbody></table></div></div>';
    var box = $('svcContent');
    box.innerHTML = h;
    box.setAttribute('data-cat', id);
  }
  function selectCategory(id) {
    renderTabs(id);
    renderCategory(id);
  }

  /* ── 작성된 문서 ── */
  function parseFront(md) {
    var fm = {};
    var m = md.match(/^---\s*\n([\s\S]*?)\n---/);
    if (m) m[1].split('\n').forEach(function (l) {
      var k = l.match(/^([A-Za-z_]+):\s*(.*)$/);
      if (k) fm[k[1]] = k[2].replace(/^["']|["']$/g, '').trim();
    });
    return fm;
  }
  function isDoc(md) { return /^---[ \t]*\n[\s\S]{0,800}?doc_type:/.test(md.trim()); }
  function extractDoc(reply) {
    var re = new RegExp('(^|\\n)(' + BT + '{3,}|~{3,})[ \\t]*(?:markdown|md)?[ \\t]*\\n([\\s\\S]*?)\\n\\2[ \\t]*(?=\\n|$)', 'g');
    var m;
    while ((m = re.exec(reply))) {
      if (isDoc(m[3])) return { raw: m[0].replace(/^\n/, ''), md: m[3].trim() + '\n' };
    }
    var s = reply.match(/(^|\n)(---[ \t]*\n(?:[^\n]*\n){0,8}?doc_type:[^\n]*\n)/);
    if (s) {
      var start = s.index + s[1].length;
      var tail = reply.slice(start);
      var endM = tail.match(/\n\[(?:초안 검토 고지|1차 통로 고지|인간 전문가 상담 권고)\]/);
      var raw = endM ? tail.slice(0, endM.index) : tail;
      return { raw: raw, md: raw.trim() + '\n' };
    }
    return null;
  }
  function docTitle(md) {
    var fm = parseFront(md);
    if (fm.doc_type) return fm.doc_type;
    var h = md.match(/^#\s+(.+)$/m);
    return h ? h[1].trim() : '서류 초안';
  }
  function two(n) { return (n < 10 ? '0' : '') + n; }
  function stamp(d) { return d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()); }
  function fileName(title, d) { return title.replace(/[\\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') + '_' + stamp(d) + '.html'; }

  /* ── 웹 표준 서식 변환: 내부 표기(마크다운 문법)를 HTML 문서로 바꾼다. 모든 글자는 먼저 이스케이프한다. ── */
  function escH(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function inlineH(s) {
    return escH(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }
  function mdToHtmlBody(md) {
    var lines = md.replace(/\r/g, '').split('\n'), out = [], i = 0, list = null;
    function closeList() { if (list) { out.push('</' + list + '>'); list = null; } }
    var fm = md.match(/^---\s*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
    if (fm) {
      out.push('<table class="meta">');
      fm[1].split('\n').forEach(function (l) {
        var k = l.match(/^([A-Za-z_]+):\s*(.*)$/);
        if (k) out.push('<tr><th>' + escH(k[1]) + '</th><td>' + inlineH(k[2].replace(/^["']|["']$/g, '')) + '</td></tr>');
      });
      out.push('</table>');
      i = md.slice(0, fm[0].length).split('\n').length - 1;
    }
    for (; i < lines.length; i++) {
      var l = lines[i], m;
      if (/^\s*$/.test(l)) { closeList(); continue; }
      if ((m = l.match(/^(#{1,6})\s+(.*)$/))) { closeList(); out.push('<h' + m[1].length + '>' + inlineH(m[2]) + '</h' + m[1].length + '>'); continue; }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { closeList(); out.push('<hr>'); continue; }
      if (/^\s*\|.*\|\s*$/.test(l)) {
        closeList();
        var rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(lines[i]); i++; }
        i--;
        var cells = function (r) { return r.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); }); };
        var head = cells(rows[0]), body = rows.slice(/^\s*\|[\s:|-]+\|\s*$/.test(rows[1] || '') ? 2 : 1);
        out.push('<table><thead><tr>' + head.map(function (c) { return '<th>' + inlineH(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          body.map(function (r) { return '<tr>' + cells(r).map(function (c) { return '<td>' + inlineH(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>');
        continue;
      }
      if ((m = l.match(/^\s*[-*]\s+(.*)$/))) { if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inlineH(m[1]) + '</li>'); continue; }
      if ((m = l.match(/^\s*\d+[.)]\s+(.*)$/))) { if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + inlineH(m[1]) + '</li>'); continue; }
      if ((m = l.match(/^>\s?(.*)$/))) { closeList(); out.push('<blockquote>' + inlineH(m[1]) + '</blockquote>'); continue; }
      closeList(); out.push('<p>' + inlineH(l) + '</p>');
    }
    closeList();
    return out.join('\n');
  }
  function toWebDoc(dr) {
    return '<!doctype html>\n<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + escH(dr.title) + '</title><style>' +
      'body{font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif;line-height:1.7;max-width:820px;margin:32px auto;padding:0 16px;color:#111}' +
      'h1{font-size:1.5em}h2{font-size:1.25em;margin-top:1.6em}h3{font-size:1.1em}table{border-collapse:collapse;width:100%;margin:12px 0}' +
      'th,td{border:1px solid #bbb;padding:6px 10px;text-align:left;vertical-align:top}th{background:#f2f4f7}table.meta{font-size:.9em;color:#444}' +
      'blockquote{margin:12px 0;padding:8px 14px;border-left:4px solid #ccc;background:#fafafa}code{background:#f2f4f7;padding:1px 4px;border-radius:3px}' +
      '@media print{body{margin:0;max-width:none}}</style></head><body>\n' + mdToHtmlBody(dr.md) + '\n</body></html>\n';
  }

  function addDraft(ex) {
    var d = new Date();
    var title = docTitle(ex.md);
    drafts.unshift({ id: d.getTime(), title: title, md: ex.md, at: d });
    renderDrafts(true);
    return title;
  }
  function renderDrafts(flash) {
    var card = $('draftsCard');
    if (!drafts.length) { card.style.display = 'none'; return; }
    card.style.display = '';
    $('draftsList').innerHTML = drafts.map(function (dr, i) {
      return '<div class="draft-item' + (flash && i === 0 ? ' draft-flash' : '') + '" data-i="' + i + '">' +
        '<div class="draft-head"><div class="draft-info"><div class="draft-title">' + esc(dr.title) + '</div>' +
        '<div class="draft-time">' + dr.at.getFullYear() + '-' + two(dr.at.getMonth() + 1) + '-' + two(dr.at.getDate()) + ' ' + two(dr.at.getHours()) + ':' + two(dr.at.getMinutes()) + ' · 초안(DRAFT)</div></div>' +
        '<div class="draft-actions">' +
          '<button type="button" class="svc-link-btn sm solid" data-act="download">' + DL_SVG + '웹 표준 서식으로 제출(내려받기)</button>' +
          '<button type="button" class="svc-link-btn sm" data-act="copy">복사</button>' +
          '<button type="button" class="svc-link-btn sm" data-act="toggle">내용 보기</button>' +
        '</div></div><div class="draft-pre"></div></div>';
    }).join('');
    Array.prototype.forEach.call($('draftsList').querySelectorAll('.draft-item'), function (el) {
      var pv = el.querySelector('.draft-pre'); pv.style.whiteSpace = 'normal'; pv.style.fontFamily = 'inherit'; pv.innerHTML = mdToHtmlBody(drafts[+el.getAttribute('data-i')].md);
    });
    if (flash) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function downloadDoc(dr) {
    var blob = new Blob([toWebDoc(dr)], { type: 'text/html;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = fileName(dr.title, dr.at);
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function copyMd(dr, btn) {
    function done() { var t = btn.textContent; btn.textContent = '복사됨'; setTimeout(function () { btn.textContent = t; }, 1400); }
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(dr.md).then(done, done); return; }
    var ta = document.createElement('textarea'); ta.value = dr.md; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta); done();
  }

  /* ── 위젯 연동: AI 답변에서 서류 문서를 분리해 "작성된 문서"로 보낸다 ── */
  function transformReply(reply) {
    var ex = extractDoc(reply);
    if (!ex) return reply;
    var title = addDraft(ex);
    var note = '📄 「' + title + '」 초안을 작성했습니다. 페이지 아래 "작성된 문서"에서 내용을 확인하고 웹 표준 서식으로 제출(내려받기)할 수 있습니다.';
    return reply.replace(ex.raw, note);
  }
  window.ProDocPage = { transformReply: transformReply, extractDoc: extractDoc, drafts: drafts };

  /* ── 이벤트 ── */
  $('svcTabs').addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('.svc-tab') : null;
    if (t) selectCategory(t.getAttribute('data-cat'));
  });
  $('svcContent').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button[data-doc]') : null;
    if (!b) return;
    var c = DOC_CATALOG.filter(function (x) { return x.id === $('svcContent').getAttribute('data-cat'); })[0];
    startDoc(c.items[+b.getAttribute('data-doc')].t);
  });
  $('askOther').addEventListener('click', function () {
    askChat(CFG.askOtherMessage || '목록에 없는 서류를 작성하려고 합니다. 어떤 서류인지 먼저 확인해 주세요.');
  });
  $('draftsList').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button[data-act]') : null;
    if (!b) return;
    var item = b.closest('.draft-item'); var dr = drafts[+item.getAttribute('data-i')];
    var act = b.getAttribute('data-act');
    if (act === 'download') downloadDoc(dr);
    else if (act === 'copy') copyMd(dr, b);
    else if (act === 'toggle') { item.classList.toggle('open'); b.textContent = item.classList.contains('open') ? '내용 접기' : '내용 보기'; }
  });

  (function () {
    var h = ''; try { h = decodeURIComponent((location.hash || '').slice(1)); } catch (e) {}
    var hit = DOC_CATALOG.filter(function (x) { return x.id === h; })[0];
    selectCategory(hit ? hit.id : DOC_CATALOG[0].id);
  })();
})();
