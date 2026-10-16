/* ══════════════════════════════════════════════════════════════════
   md-view.js — 마크다운(MD) 문서를 화면에 보여 주기 위한 작은 변환기 (2026-10-17 신설)

   용도: 페이지가 가져온 .md 원문(예: prompts/ 의 SP 문서)을 HTML 로 바꿔 본문 폭에 펼쳐 보여 준다.
   사용: window.HondiMd.render(md) → HTML 문자열.  표시는 .sp-md 같은 클래스를 가진 요소의 innerHTML 에 넣는다.

   안전: 모든 글자를 먼저 이스케이프한 뒤 마크업을 만든다(원문 속 HTML·스크립트는 글자로만 보인다).
         링크는 http(s):// 와 사이트 안 경로(/…)만 허용하고, 그 밖의 주소는 링크 없이 글자로만 둔다.
   지원: 제목(#~######) · 문단(줄바꿈 유지) · 굵게/기울임/인라인 코드 · 링크 · 목록(중첩 포함) · 번호 목록 · 인용(안쪽도 변환)
         · 표(| 구분, 열 정렬 표시 무시) · 코드 블록(```) · 가로줄 · 맨 앞 front matter(--- … ---, 표로 표시)
   미지원: 이미지, 각주, 원시 HTML (글자로 표시됨).
   ══════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  // 인라인: 코드 → 링크 → 굵게 → 기울임 순. 코드 조각은 자리표시자로 빼 두었다가 마지막에 되돌린다.
  function inline(src) {
    var codes = [];
    var s = esc(src).replace(/`([^`]+)`/g, function (_, c) { codes.push('<code>' + c + '</code>'); return '\u0000' + (codes.length - 1) + '\u0000'; });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, text, url) {
      return /^(https?:\/\/|\/)/.test(url) ? '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + text + '</a>' : text;
    });
    s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![*\w])/g, '$1<em>$2</em>');
    return s.replace(/\u0000(\d+)\u0000/g, function (_, i) { return codes[+i]; });
  }

  var RE_FENCE = /^\s*```(.*)$/;
  var RE_HEAD = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
  var RE_HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
  var RE_QUOTE = /^\s*>\s?(.*)$/;
  var RE_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  var RE_ROW = /^\s*\|.*\|\s*$/;
  var RE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

  function cells(row) {
    var r = row.trim().replace(/^\|/, '').replace(/\|$/, '');
    return r.split(/(?<!\\)\|/).map(function (c) { return c.trim().replace(/\\\|/g, '|'); });
  }

  function isBlockStart(l, next) {
    return RE_FENCE.test(l) || RE_HEAD.test(l) || RE_HR.test(l) || RE_QUOTE.test(l) || RE_ITEM.test(l) || (RE_ROW.test(l) && next !== undefined && RE_SEP.test(next));
  }

  function renderList(items) {
    // items: [{indent, ordered, text}] — 들여쓰기 깊이로 중첩 목록을 만든다.
    var rootList = { ordered: items[0].ordered, items: [] };
    var stack = [{ indent: -1, list: null, owner: null }];
    items.forEach(function (it) {
      while (stack.length > 1 && stack[stack.length - 1].indent >= it.indent) stack.pop();
      var top = stack[stack.length - 1], list;
      if (top.owner === null) { list = rootList; }
      else {
        if (!top.owner.child) top.owner.child = { ordered: it.ordered, items: [] };
        list = top.owner.child;
      }
      var node = { text: it.text, child: null };
      list.items.push(node);
      stack.push({ indent: it.indent, list: list, owner: node });
    });
    function out(list) {
      var tag = list.ordered ? 'ol' : 'ul';
      return '<' + tag + '>' + list.items.map(function (n) { return '<li>' + inline(n.text).replace(/\n/g, '<br>') + (n.child ? out(n.child) : '') + '</li>'; }).join('') + '</' + tag + '>';
    }
    return out(rootList);
  }

  function render(md, depth) {
    depth = depth || 0;
    var lines = String(md).replace(/\r/g, '').split('\n'), out = [], i = 0, m;

    // 맨 앞 front matter
    if (depth === 0 && /^---\s*$/.test(lines[0] || '')) {
      var end = -1;
      for (var k = 1; k < lines.length; k++) { if (/^---\s*$/.test(lines[k])) { end = k; break; } }
      if (end > 0) {
        var rows = [];
        for (var q = 1; q < end; q++) { var kv = lines[q].match(/^([\w가-힣_.-]+):\s*(.*)$/); if (kv) rows.push('<tr><th>' + esc(kv[1]) + '</th><td>' + inline(kv[2].replace(/^["']|["']$/g, '')) + '</td></tr>'); }
        if (rows.length) out.push('<table class="md-meta">' + rows.join('') + '</table>');
        i = end + 1;
      }
    }

    while (i < lines.length) {
      var l = lines[i];
      if (/^\s*$/.test(l)) { i++; continue; }

      // 코드 블록
      if ((m = l.match(RE_FENCE))) {
        var code = []; i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { code.push(lines[i]); i++; }
        i++;
        out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>');
        continue;
      }
      if ((m = l.match(RE_HEAD))) { out.push('<h' + m[1].length + '>' + inline(m[2]) + '</h' + m[1].length + '>'); i++; continue; }
      if (RE_HR.test(l)) { out.push('<hr>'); i++; continue; }

      // 인용 — 안쪽을 다시 변환한다(깊이 제한)
      if (RE_QUOTE.test(l)) {
        var q2 = [];
        while (i < lines.length && RE_QUOTE.test(lines[i])) { q2.push(lines[i].match(RE_QUOTE)[1]); i++; }
        out.push('<blockquote>' + (depth < 4 ? render(q2.join('\n'), depth + 1) : esc(q2.join('\n'))) + '</blockquote>');
        continue;
      }

      // 표(머리줄 + 구분줄)
      if (RE_ROW.test(l) && i + 1 < lines.length && RE_SEP.test(lines[i + 1])) {
        var head = cells(l); i += 2;
        var body = [];
        while (i < lines.length && RE_ROW.test(lines[i])) { body.push(cells(lines[i])); i++; }
        out.push('<div class="md-table-wrap"><table><thead><tr>' + head.map(function (c) { return '<th>' + inline(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          body.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>');
        continue;
      }

      // 목록(중첩) — 들여쓴 이어진 줄은 앞 항목에 붙인다. 빈 줄 뒤에 항목이 또 나오면 같은 목록으로 본다.
      if (RE_ITEM.test(l)) {
        var items = [];
        while (i < lines.length) {
          var cur = lines[i], im = cur.match(RE_ITEM);
          if (im) { items.push({ indent: im[1].replace(/\t/g, '    ').length, ordered: /\d/.test(im[2]), text: im[3] }); i++; continue; }
          if (/^\s*$/.test(cur)) {
            var j = i; while (j < lines.length && /^\s*$/.test(lines[j])) j++;
            if (j < lines.length && RE_ITEM.test(lines[j])) { i = j; continue; }
            break;
          }
          if (/^\s{2,}\S/.test(cur) && !isBlockStart(cur, lines[i + 1])) { items[items.length - 1].text += '\n' + cur.trim(); i++; continue; }
          break;
        }
        out.push(renderList(items));
        continue;
      }

      // 문단 — 줄바꿈은 그대로 보여 준다
      var para = [l]; i++;
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !isBlockStart(lines[i], lines[i + 1])) { para.push(lines[i]); i++; }
      out.push('<p>' + para.map(inline).join('<br>') + '</p>');
    }
    return out.join('\n');
  }

  var api = { render: function (md) { return render(md, 0); } };
  root.HondiMd = api;
})(typeof window !== 'undefined' ? window : this);
