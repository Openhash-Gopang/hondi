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
HAVE = {m.group(1) for m in re.finditer(r"'([^']+)':\s*\{\s*url:", blk)}
e = html.escape

def sp_key(pid):
    if 'SP_' + pid in CAT: return 'SP_' + pid
    base = os.path.basename(IDX.get(pid, ''))
    k = base.split('_')[0]
    return k if k in CAT else None

DISC = {
  'law': '변호사가 아니며 법률 자문·소송 대리·서류 제출을 대신하지 않습니다. 구체적인 사건은 변호사와 상담하십시오.',
  'health': '의료·보건 전문 자격자가 아니며 진단·처방·치료를 하지 않습니다. 응급이거나 증상이 심하면 즉시 119 또는 의료기관을 이용하십시오.',
  'fin': '금융·재무 전문 자격자의 자문을 대체하지 않으며 특정 금융상품의 가입이나 거래를 권유하지 않습니다.',
  'eng': '해당 분야 기술사·면허 자격자의 확인·서명을 대체하지 않습니다. 안전과 직결된 판단은 반드시 자격자와 확인하십시오.',
}
DISC_DEFAULT = '해당 분야 전문 자격자의 자문을 대체하지 않습니다. 중요한 결정은 자격을 갖춘 전문가와 확인하십시오.'

def title_of(label): return label if label.endswith('AI') else label + ' 상담 AI'

def page(pid, label, cat, spk, triggers, parent=None, children=None):
    title = title_of(label)
    disc = DISC.get(cat, DISC_DEFAULT)
    chat = '/pages/expert-chat.html?persona=' + pid
    lead = ('아래에서 상담할 분야를 고르십시오.' if children else
            '궁금한 점을 말씀하시면 필요한 정보를 순서대로 여쭙고 정리해 드립니다.')
    back = ('<p class="svc-lead"><a href="/pages/%s.html">← %s</a></p>' % (parent[0], e(parent[1]))) if parent else ''
    if children:
        rows = ''.join('<tr><td class="doc-title"><a href="/pages/%s.html">%s</a></td><td class="doc-detail">%s</td></tr>' %
                       (c['id'], e(c['label']), e(' · '.join(c['triggers'][:3]))) for c in children)
        body = ('<div class="svc-content"><div class="svc-detail"><h2>상담 분야</h2><div class="svc-table-wrap"><table class="svc-table">'
                '<thead><tr><th>분야</th><th>상담 예시</th></tr></thead><tbody>%s</tbody></table></div></div></div>' % rows)
    else:
        items = ''.join('<li>%s</li>' % e(t) for t in triggers)
        body = ('<div class="svc-content"><div class="svc-detail"><h2>상담 예시</h2><ul style="margin:8px 0 0;padding-left:20px;line-height:1.9;font-size:13.5px">%s</ul></div></div>' % items) if triggers else ''
    cfg_sp = ('sp: %s,' % json.dumps(spk)) if spk else ''
    greet = '안녕하세요! %s입니다. 궁금한 점을 말씀해 주세요.' % title
    return f'''<!DOCTYPE html>
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
  h1: {json.dumps(e(label) + ' 상담을<br>대화로 시작합니다', ensure_ascii=False)},
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
    label: "궁금한 점을 말씀하세요",
    greeting: {json.dumps(greet, ensure_ascii=False)},
    serviceLabel: {json.dumps(title, ensure_ascii=False)}
  }};
</script>
<script src="https://hondi.net/auth/k-service-auth-client.js"></script>
<script src="/assets/chat-widget.js"></script>

<div class="ug-doc">
  <div class="doc-intro">
    {back}
    <div class="svc-callout important"><b>안내</b> {e(title)}는 {e(disc)}</div>
  </div>

  {body}

  <div class="doc-toolbar" style="margin-top:20px">
    <a class="svc-link-btn solid" href="{chat}">전문가 채팅에서 상담하기</a>
  </div>

  <div class="ug-footer">{e(title)}는 정보 제공을 돕는 도구입니다. {e(disc)}</div>
</div>
</body>
</html>
'''

made, links = [], []
for s in SECTIONS:
    if s['cat'] in EXCLUDE_CATS: continue
    single = len(s['personas']) <= 1
    if single and (s['id'] in HAVE or s['personas'][0]['id'] in HAVE): continue
    if not single and s['id'] in HAVE: continue
    todo = []
    if single:
        p = s['personas'][0]; todo.append((s['id'], s['label'], sp_key(p['id']) or sp_key(s['id']), p['triggers'], None, None))
    else:
        todo.append((s['id'], s['label'], sp_key(s['id']), [], None, s['personas']))
        for p in s['personas']:
            todo.append((p['id'], p['label'], sp_key(p['id']), p['triggers'], (s['id'], s['label']), None))
    for pid, label, spk, trg, parent, kids in todo:
        path = os.path.join(ROOT, 'pages', pid + '.html')
        if os.path.exists(path): continue
        open(path, 'w', encoding='utf-8').write(page(pid, label, s['cat'], spk, trg, parent, kids))
        made.append(pid)
        links.append("'%s': { url: '/pages/%s.html', title: %s }" % (pid, pid, json.dumps(title_of(label) + ' 페이지', ensure_ascii=False)))
print('생성 %d개' % len(made), file=sys.stderr)
print(', '.join(links))
