#!/usr/bin/env python3
"""전문가 페이지 생성기 — pages/expert-personas.html 의 SECTIONS 데이터를 읽어, 전문가 페이지가 없는 직역
(업종별 공급자(KSIC)·교수 페르소나 제외)의 pages/<id>.html 을 만든다. 이미 있는 파일은 덮어쓰지 않는다.
사용: python3 scripts/gen-expert-pages.py            (저장소 루트에서)
출력 마지막 줄은 expert-personas.html 의 SECTION_PAGE_LINKS 에 넣을 JS 항목이다.
2026-10-17: 시작 영역을 별도 채팅 페이지 링크에서 "탭 2개(서류 작성·방법론) + 제자리에서 늘어나는 입력창"(assets/start-field.js, chat-widget inline 모드)으로 바꿨다.
생성기가 만든 페이지는 '이미 있는 파일은 덮어쓰지 않는다'의 예외로, 생성 표시(gen-expert-pages)가 있는 파일은 다시 생성한다."""
import json, re, os, html, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXCLUDE_CATS = ('supplier', 'edu')
src = open(os.path.join(ROOT, 'pages/expert-personas.html'), encoding='utf-8').read()
SECTIONS = json.loads(re.search(r'var SECTIONS = (\[.*?\]);\n', src, re.S).group(1))
IDX = json.loads(re.search(r'var EXPERT_SP_PATH_INDEX\s*=\s*(\{.*?\});\n', src, re.S).group(1))
CAT = json.load(open(os.path.join(ROOT, 'prompts/sp-catalog.json'), encoding='utf-8'))
blk = re.search(r"var SECTION_PAGE_LINKS\s*=\s*(\{.*?\});\n", src, re.S).group(1)
HAVE_URL = {m.group(1): m.group(2) for m in re.finditer(r"'([^']+)':\s*\{\s*url:\s*'([^']+)'", blk)}
HAVE = set(HAVE_URL)
e = html.escape

# ── 서류 목록(SP 부록 A) 파서 — SP 가 서류 목록의 정본이고, 페이지의 PRO_DOC_PAGE 데이터는 여기서 만든다 (2026-10-17)
# 형식: "## 부록 A …" 아래 "### A-n. 제목 (메타)" 절마다 표(첫 열 = 서류 이름) 또는 "- **서류**: 설명" 목록.
#   표가 2열이면 둘째 열을 설명으로, 3열 이상이면 "헤더: 값" 을 " · " 로 이어 설명으로 쓴다.
#   표 밖의 문장(**유의**: 등)은 그 탭의 안내(notes)가 된다. 서류가 하나도 없는 절(예: A-4 "이 부록에 없는 서류")은 탭이 되지 않는다.
def _cells(row):
    return [c.strip() for c in row.strip().strip('|').split('|')]

def parse_catalog(md):
    m = re.search(r'^## 부록 A[^\n]*\n', md, re.M)
    if not m: return []
    body = md[m.end():]
    n = re.search(r'^## ', body, re.M)
    if n: body = body[:n.start()]
    out = []
    for sec in re.split(r'^(?=### A-\d+)', body, flags=re.M):
        h = re.match(r'### (A-\d+)\.\s*(.+)', sec)
        if not h: continue
        sid, head = h.group(1), h.group(2).strip()
        head = re.sub(r'\s+—\s+form_class\s+[A-Z]', '', head)
        mm = re.match(r'^(.*?)\s+\((.*)\)\s*$', head)
        title, meta = (mm.group(1).strip(), mm.group(2).strip()) if mm else (head, '')
        notes, items, hdr, lead = [], [], None, []
        lines = sec.split('\n')[1:]
        i = 0
        while i < len(lines):
            l = lines[i]
            if re.match(r'^\s*\|', l):
                rows = []
                while i < len(lines) and re.match(r'^\s*\|', lines[i]):
                    rows.append(lines[i]); i += 1
                cs = [_cells(r) for r in rows]
                hdr = cs[0]
                for r in cs[1:]:
                    if all(re.fullmatch(r':?-{2,}:?', c) for c in r): continue
                    t = r[0]
                    if len(r) == 2: d = r[1]
                    else: d = ' · '.join('%s: %s' % (hdr[k], r[k]) for k in range(1, min(len(r), len(hdr))) if r[k] and r[k] not in ('—', '-'))
                    items.append({'t': t, 'd': d})
                continue
            b = re.match(r'^\s*[-*]\s+\*\*(.+?)\*\*\s*[:：—-]?\s*(.*)$', l)
            if b:
                items.append({'t': b.group(1).strip(), 'd': b.group(2).strip()}); i += 1; continue
            if l.strip() and not re.fullmatch(r'-{3,}', l.strip()):
                if re.match(r'^\*\*유의\*\*\s*[:：]', l.strip()) or l.strip().startswith('\\*'):
                    notes.append(re.sub(r'^\\\*\s*', '※ ', re.sub(r'^\*\*유의\*\*\s*[:：]\s*', '', l.strip())))
                else:
                    lead.append(l.strip())      # 유의 표시가 없는 설명 문단 = 그 탭의 소개(lead)
            i += 1
        if not items: continue
        out.append({'id': sid, 'tab': title, 'title': title, 'meta': meta, 'lead': ' '.join(lead), 'notes': notes, 'items': items, 'hdr': hdr})
    return out

def has_c2(md):
    return bool(re.search(r'^#{2,3} (?:STEP )?C-2\.? ', md, re.M)) or '### C-2.' in md

def sp_file(spk):
    f = CAT.get(spk) if spk else None
    if not f: return None
    path = os.path.join(ROOT, 'prompts', f)
    return path if os.path.exists(path) else None

def catalog_for(spk):
    """SP 에 부록 A 서류 목록과 C-2 서식 출력 규격이 모두 있으면 목록(탭 구성)을, 아니면 None."""
    path = sp_file(spk)
    if not path: return None
    md = open(path, encoding='utf-8').read()
    cat = parse_catalog(md)
    return cat if cat and has_c2(md) else None

def sp_key(pid):
    if 'SP_' + pid in CAT: return 'SP_' + pid
    base = os.path.basename(IDX.get(pid, ''))
    k = base.split('_')[0]
    return k if k in CAT else None

ROLE = {
  'law': '법률 자문·소송 대리·서류 제출 대행',
  'health': '진단·처방·치료',
  'fin': '금융상품 권유나 재무 자문',
  'eng': '기술 확인이나 서명',
}
ROLE_DEFAULT = '전문 자문'
# 노란 경고 띠 한 줄(감정평가사 페이지와 같은 형식): 공통 문구 + 초안 사용 조건
BANNER = '관계 법령에 따라, 모든 보조 AI는 인간 전문가의 업무를 보조하며, 단독으로 기능하지 않는다. 작성된 초안은 전문가의 검토·확정 전에는 사용할 수 없다.'

def eun(w):
    c = ord(w[-1]) - 0xAC00
    return '은' if 0 <= c < 11172 and c % 28 else '는'

def disclaimer(title, cat):
    return ('%s는 해당 분야 전문가와 소속 직원의 서류 작성을 대화로 보조하는 도구입니다. 전문가가 아니며 %s%s 하지 않고, '
            '작성된 서류는 전문가가 검토·확정해야 합니다.' % (title, ROLE.get(cat, ROLE_DEFAULT), eun(ROLE.get(cat, ROLE_DEFAULT))))

def title_of(label): return label if label.endswith('AI') else label + ' 업무 보조 AI'

def page(pid, label, cat, spk, triggers, parent=None, children=None, catalog=None):
    if catalog: return catalog_page(pid, label, cat, spk, parent, catalog)
    title = title_of(label)
    disc = disclaimer(title, cat)
    lead = ('아래에서 업무 분야를 고르거나 입력창으로 요청하십시오.' if children else
            '아래 입력창에 작성할 서류를 말씀하시면, 필요한 정보를 순서대로 여쭙고 초안 작성을 보조합니다.')
    back = ('<p class="svc-lead"><a href="%s">← %s</a></p>' % (parent[0], e(parent[1]))) if parent else ''
    if children:
        rows = ''.join('<tr><td class="doc-title"><a href="/pages/%s.html">%s</a></td></tr>' %
                       (c['id'], e(c['label'])) for c in children)
        body = ('<div class="svc-content"><div class="svc-detail"><h2>업무 분야</h2><div class="svc-table-wrap"><table class="svc-table">'
                '<thead><tr><th>업무 분야</th></tr></thead><tbody>%s</tbody></table></div></div></div>' % rows)
    else:
        body = ''
    cfg_sp = ('sp: %s,' % json.dumps(spk)) if spk else ''
    greet = '안녕하세요! %s입니다. 작성하실 서류를 말씀해 주세요. 필요한 정보를 순서대로 여쭙고 초안 작성을 보조합니다.' % title
    return f'''<!DOCTYPE html>
<!-- scripts/gen-expert-pages.py 로 생성한 페이지 — 직접 고치지 말고 생성기를 고친다 -->
<html lang="ko">
<head>
<link rel="icon" href="data:,">
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" as="style" crossorigin href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<link rel="stylesheet" href="/assets/pro-doc-page.css">
<title>{e(title)} — 나비</title>
</head>
<body>

<script>
window.PAGE_HEADER = {{
  active: 'expert-personas',
  badge: {json.dumps('전문가 페르소나 · ' + title, ensure_ascii=False)},
  h1: {json.dumps(e(label) + ' 업무의 서류 작성을<br>대화로 보조합니다', ensure_ascii=False)},
  sub: {json.dumps(lead, ensure_ascii=False)},
  disclaimer: {json.dumps(BANNER, ensure_ascii=False)},
  disclaimerDismissKey: {json.dumps(pid)}
}};
</script>
<link rel="stylesheet" href="/assets/ph-header.css">
<script src="/assets/ph-header.js"></script>
<script>
  window.K_AUTH_CONFIG = {{ serviceLabel: {json.dumps(title, ensure_ascii=False)} }};
  window.HONDI_CHAT_WIDGET_CONFIG = {{
    {cfg_sp}
    panelMode: "inline",
    inlineMount: "#startChatMount",
    mic: true,
    camera: "touch",
    maxTokens: 4096,
    panelTitle: {json.dumps(title, ensure_ascii=False)},
    label: "작성할 서류를 말씀하세요",
    greeting: {json.dumps(greet, ensure_ascii=False)},
    serviceLabel: {json.dumps(title, ensure_ascii=False)}
  }};
</script>
<script src="https://hondi.net/auth/k-service-auth-client.js"></script>
<script src="/assets/chat-widget.js"></script>

<div class="ug-doc">
  <div class="doc-intro">
    {back}
    <div class="doc-start" id="startBox"></div>
  </div>

  {body}

  <div class="ug-footer">{e(disc)}</div>
</div>
<script src="/assets/md-view.js"></script>
<script src="/assets/start-field.js"></script>
</body>
</html>
'''

ASK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'

def detail_head(catalog):
    heads = {c['hdr'][1] for c in catalog if c.get('hdr') and len(c['hdr']) == 2}
    multi = any(c.get('hdr') and len(c['hdr']) > 2 for c in catalog)
    return heads.pop() if len(heads) == 1 and not multi else '세부 내용'

def catalog_page(pid, label, cat, spk, parent, catalog):
    """서류 목록형 페이지 — 목록은 SP 부록 A에서 읽은 것(정본은 SP). 서류 작성 SP 의 C-2 서식 규격과 짝으로 동작한다."""
    title = title_of(label)
    role = ROLE.get(cat, ROLE_DEFAULT)
    disc = disclaimer(title, cat)
    lead = '작성할 서류를 목록에서 고르거나 아래 입력창으로 요청하면, 필요한 정보를 물어 서류 초안을 작성합니다.'
    back = ('<p class="svc-lead"><a href="%s">← %s</a></p>' % (parent[0], e(parent[1]))) if parent else ''
    data = {'catalog': [{k: v for k, v in c.items() if k != 'hdr'} for c in catalog], 'detailHead': detail_head(catalog)}
    pdp = json.dumps(data, ensure_ascii=False).replace('</', '<\\/')
    greet = ('안녕하세요! %s입니다. 작성하실 서류를 목록에서 고르시거나 이곳에서 말씀해 주세요. 필요한 정보를 순서대로 여쭙고 서류 초안을 웹 표준 서식으로 작성해 드립니다. '
             '(작성된 문서는 전문가의 검토·확정 전 초안입니다.)' % title)
    ctx = ("사용자는 지금 %s의 서류 작성 화면에 있습니다. 이 화면은 사용자가 목록에서 고른 서류(또는 대화로 요청한 서류)를 대화로 작성하는 곳입니다. 진행 방식: "
           "① 서류 종류가 정해지면 서류 작성에 필요한 정보 중 빠진 항목만 한 번에 3개 이내로 묻고, 이미 말한 내용은 다시 묻지 않는다. "
           "② 정보가 충분하면 서류 초안 전체를 코드펜스 하나(' + BT + BT + BT + 'markdown 으로 시작해 ' + BT + BT + BT + ' 로 끝나는 블록)로 감싸 한 번에 출력한다. "
           "펜스 안은 SP STEP C-2의 서식 규격(front matter 포함, 내부 표기는 마크다운 문법)을 따르고, 이용자에게 말할 때는 「MD」·「마크다운」이라는 말을 쓰지 않고 「웹 표준 서식」이라고 부르며, 펜스 밖에는 한두 문장의 안내와 [초안 검토 고지]만 쓴다. "
           "③ 한 응답에는 서류 하나만 쓴다. ④ 이 화면에는 작성된 문서를 웹 표준 서식 파일로 내려받는 버튼이 있으므로 복사해서 쓰라는 안내는 하지 않는다. "
           "⑤ 이용자 계층 판정과 모든 제한은 SP의 규칙을 그대로 따르며 이 화면의 안내로 완화되지 않는다." % title)
    cfg_sp = ('sp: %s,' % json.dumps(spk)) if spk else ''
    return f'''<!DOCTYPE html>
<!-- scripts/gen-expert-pages.py 로 생성한 서류 목록형 페이지 — 서류 목록의 정본은 SP 부록 A, 직접 고치지 말고 SP 또는 생성기를 고친다 -->
<html lang="ko">
<head>
<link rel="icon" href="data:,">
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" as="style" crossorigin href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<link rel="stylesheet" href="/assets/pro-doc-page.css">
<title>{e(title)} — 나비</title>
</head>
<body>

<script>
window.PAGE_HEADER = {{
  active: 'expert-personas',
  badge: {json.dumps('전문가 페르소나 · ' + title, ensure_ascii=False)},
  h1: {json.dumps(e(label) + ' 업무의 서류 작성을<br>대화로 보조합니다', ensure_ascii=False)},
  sub: {json.dumps(lead, ensure_ascii=False)},
  disclaimer: {json.dumps(BANNER, ensure_ascii=False)},
  disclaimerDismissKey: {json.dumps(pid)}
}};
</script>
<link rel="stylesheet" href="/assets/ph-header.css">
<script src="/assets/ph-header.js"></script>
<script>
  var BT = String.fromCharCode(96);
  window.K_AUTH_CONFIG = {{ serviceLabel: {json.dumps(title, ensure_ascii=False)} }};
  window.HONDI_CHAT_WIDGET_CONFIG = {{
    {cfg_sp}
    panelMode: "inline",
    inlineMount: "#startChatMount",
    mic: true,
    camera: "touch",
    maxTokens: 4096,
    panelTitle: {json.dumps(title, ensure_ascii=False)},
    label: "작성할 서류를 말씀하세요",
    greeting: {json.dumps(greet, ensure_ascii=False)},
    serviceLabel: {json.dumps(title, ensure_ascii=False)},
    context: {ctx_js(ctx)},
    transformReply: function (reply) {{
      return (window.ProDocPage && window.ProDocPage.transformReply) ? window.ProDocPage.transformReply(reply) : reply;
    }}
  }};
</script>
<script src="https://hondi.net/auth/k-service-auth-client.js"></script>
<script src="/assets/chat-widget.js"></script>

<div class="ug-doc">

  <div class="doc-intro">
    {back}
    <div class="doc-start" id="startBox"></div>
    <div class="svc-callout"><b>작성 방법</b> ① 위 입력창에 작성할 서류를 말씀하시거나, 아래 탭에서 서류를 고르고 「대화로 작성」을 누릅니다. ② 대화로 필요한 정보를 알려 주시면 초안이 작성됩니다. ③ 페이지 아래 「작성된 문서」에서 내용을 확인하고 웹 표준 서식으로 제출(내려받기)합니다.</div>
  </div>

  <div class="doc-toolbar ask-other-bar">
    <button type="button" class="svc-link-btn solid ask-other" id="askOther">{ASK_SVG}목록에 없는 서류 작성하기</button>
  </div>

  <div class="svc-tabs" id="svcTabs"></div>

  <div class="svc-content" id="svcContent"></div>

  <div class="svc-content" id="draftsCard" style="display:none">
    <div class="svc-detail">
      <h2>작성된 문서</h2>
      <p class="svc-lead">대화로 작성된 서류 초안입니다. 「웹 표준 서식으로 제출(내려받기)」를 누르면 웹 표준 서식 파일로 저장됩니다. 인터넷 브라우저로 열어 보거나 인쇄할 수 있습니다.</p>
      <div id="draftsList"></div>
    </div>
  </div>

  <div class="ug-footer">{e(disc)}</div>
</div>
<script>
window.PRO_DOC_PAGE = {pdp};
</script>
<script src="/assets/md-view.js"></script>
<script src="/assets/pro-doc-page.js"></script>
<script src="/assets/start-field.js"></script>
</body>
</html>
'''

def ctx_js(ctx):
    # ctx 안의 ' + BT + BT + BT + ' 는 JS 문자열 이어붙이기 표기다. 나머지 작은따옴표·역슬래시는 이스케이프한다.
    parts = ctx.split("' + BT + BT + BT + '")
    esc = [p.replace('\\', '\\\\').replace("'", "\\'") for p in parts]
    return "'" + "' + BT + BT + BT + '".join(esc) + "'"

def is_generated(path):
    t = open(path, encoding='utf-8').read()
    return 'gen-expert-pages' in t or '전문가 채팅에서 상담하기' in t

if len(sys.argv) > 2 and sys.argv[1] == '--catalog-json':
    # 시험·점검용: 주어진 SP 파일의 부록 A 서류 목록을 JSON 으로 출력하고 끝낸다(페이지는 만들지 않는다).
    print(json.dumps([{k: v for k, v in c.items() if k != 'hdr'} for c in parse_catalog(open(sys.argv[2], encoding='utf-8').read())], ensure_ascii=False))
    sys.exit(0)

made, links = [], []
for s in SECTIONS:
    if s['cat'] in EXCLUDE_CATS: continue
    single = len(s['personas']) <= 1
    if single and (s['id'] in HAVE or s['personas'][0]['id'] in HAVE) and not is_generated(os.path.join(ROOT, 'pages', s['id'] + '.html')) and os.path.exists(os.path.join(ROOT, 'pages', s['id'] + '.html')): continue
    todo = []
    if single:
        p = s['personas'][0]; k = sp_key(p['id']) or sp_key(s['id']); todo.append((s['id'], s['label'], k, p['triggers'], None, None))
    else:
        todo.append((s['id'], s['label'], sp_key(s['id']), [], None, s['personas']))
        for p in s['personas']:
            todo.append((p['id'], p['label'], sp_key(p['id']), p['triggers'], (HAVE_URL.get(s['id'], '/pages/%s.html' % s['id']), s['label']), None))
    for pid, label, spk, trg, parent, kids in todo:
        path = os.path.join(ROOT, 'pages', pid + '.html')
        if os.path.exists(path) and not is_generated(path): continue
        open(path, 'w', encoding='utf-8').write(page(pid, label, s['cat'], spk, trg, parent, kids, None if kids else catalog_for(spk)))
        made.append(pid)
        links.append("'%s': { url: '/pages/%s.html', title: %s }" % (pid, pid, json.dumps(title_of(label) + ' 페이지', ensure_ascii=False)))
print('생성 %d개' % len(made), file=sys.stderr)
print(', '.join(links))
