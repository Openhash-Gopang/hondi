#!/usr/bin/env python3
"""전문가 페이지 생성기 — pages/expert-personas.html 의 SECTIONS 데이터를 읽어, 전문가 페이지가 없는 직역
(업종별 공급자(KSIC)·교수 페르소나 제외)의 pages/<id>.html 을 만든다. 이미 있는 파일은 덮어쓰지 않는다.
사용: python3 scripts/gen-expert-pages.py            (저장소 루트에서)
출력 마지막 줄은 expert-personas.html 의 SECTION_PAGE_LINKS 에 넣을 JS 항목이다."""
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

def eun(w):
    c = ord(w[-1]) - 0xAC00
    return '은' if 0 <= c < 11172 and c % 28 else '는'

def disclaimer(title, cat):
    return ('%s는 해당 분야 전문가와 소속 직원의 서류 작성을 대화로 보조하는 도구입니다. 전문가가 아니며 %s%s 하지 않고, '
            '작성된 서류는 전문가가 검토·확정해야 합니다.' % (title, ROLE.get(cat, ROLE_DEFAULT), eun(ROLE.get(cat, ROLE_DEFAULT))))

def title_of(label): return label if label.endswith('AI') else label + ' 업무 보조 AI'

def page(pid, label, cat, spk, triggers, parent=None, children=None):
    title = title_of(label)
    disc = disclaimer(title, cat)
    chat = '/pages/expert-chat.html?persona=' + pid
    lead = ('아래에서 업무 분야를 고르십시오.' if children else
            '전문가와 소속 직원이 서류를 작성할 때, 필요한 정보를 순서대로 여쭙고 초안 작성을 보조합니다.')
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
  disclaimer: true
}};
</script>
<link rel="stylesheet" href="/assets/ph-header.css">
<script src="/assets/ph-header.js"></script>
<script>
  window.K_AUTH_CONFIG = {{ serviceLabel: {json.dumps(title, ensure_ascii=False)} }};
  window.HONDI_CHAT_WIDGET_CONFIG = {{
    {cfg_sp}
    position: "left",
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
    <div class="svc-callout important"><b>안내</b> {e(disc)}</div>
  </div>

  {body}

  <div class="doc-toolbar" style="margin-top:20px">
    <a class="svc-link-btn solid" href="{chat}">대화로 서류 작성 시작하기</a>
  </div>

  <div class="ug-footer">{e(disc)}</div>
</div>
</body>
</html>
'''

def is_generated(path):
    t = open(path, encoding='utf-8').read()
    return 'gen-expert-pages' in t or '전문가 채팅에서 상담하기' in t

made, links = [], []
for s in SECTIONS:
    if s['cat'] in EXCLUDE_CATS: continue
    single = len(s['personas']) <= 1
    if single and (s['id'] in HAVE or s['personas'][0]['id'] in HAVE) and not is_generated(os.path.join(ROOT, 'pages', s['id'] + '.html')) and os.path.exists(os.path.join(ROOT, 'pages', s['id'] + '.html')): continue
    todo = []
    if single:
        p = s['personas'][0]; todo.append((s['id'], s['label'], sp_key(p['id']) or sp_key(s['id']), p['triggers'], None, None))
    else:
        todo.append((s['id'], s['label'], sp_key(s['id']), [], None, s['personas']))
        for p in s['personas']:
            todo.append((p['id'], p['label'], sp_key(p['id']), p['triggers'], (HAVE_URL.get(s['id'], '/pages/%s.html' % s['id']), s['label']), None))
    for pid, label, spk, trg, parent, kids in todo:
        path = os.path.join(ROOT, 'pages', pid + '.html')
        if os.path.exists(path) and not is_generated(path): continue
        open(path, 'w', encoding='utf-8').write(page(pid, label, s['cat'], spk, trg, parent, kids))
        made.append(pid)
        links.append("'%s': { url: '/pages/%s.html', title: %s }" % (pid, pid, json.dumps(title_of(label) + ' 페이지', ensure_ascii=False)))
print('생성 %d개' % len(made), file=sys.stderr)
print(', '.join(links))
