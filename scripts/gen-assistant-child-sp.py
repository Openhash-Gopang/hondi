#!/usr/bin/env python3
"""세부 분야 전문가용 SP 생성기 (2026-10-17).

부모 전문가용 SP(prompts/SP_<부모>-assistant_v1_0.md)를 그대로 두고, 세부 분야 절(§0-4)과 분야 특화 서류(부록 A 끝에 한 절)를 덧붙여
prompts/SP_<자식>-assistant_v1_0.md 를 만든다. 페이지는 SP 파일 하나만 불러 쓰므로(자식이 부모를 상속하지 않는다) 결과물은 부모 전체를 담은 독립 파일이다.

  python3 scripts/gen-assistant-child-sp.py <자식id> [<자식id> ...]
  python3 scripts/gen-assistant-child-sp.py --check --all     # 데이터와 SP 가 다르면 종료 코드 1
  python3 scripts/gen-assistant-child-sp.py --all

데이터: data/assistant-child-sp/<자식id>.json
  parent        부모 직역 id (예: physician)
  label         분야 이름 (예: 내과)
  code_suffix   SP 번호 꼬리 (예: 1 → SP-HEALTH-16A-1)
  scope         분야 범위 한 줄
  judge_extra   이 분야에서 AI 가 스스로 정하지 않는 판단 한 줄
  boundaries    [[인접 분야, 경계 설명], ...]
  checks        분야 특유 점검 표시 목록 (문장)
  tier2         Tier 2 에 추가할 위험 한 줄
  forced        강제 전환 사유 목록 (문장)
  docs          {title, basis, note, rows:[[서류, 핵심 기재·확인], ...]}
  write         (선택, 2026-10-27) 서류 작성하기 트랙(STEP W) 보강 {forms:[[서류, 제출처·시기, 핵심 기재·첨부], ...],
                deadlines:[[기한 이름, 통상 길이·기산(조문 확인 필요)], ...], note}. 부모 SP 에 STEP W 가 있을 때만 쓴다.
출력 파일 버전은 부모 SP 파일 버전을 따른다(부모가 v1_1 이면 SP_<자식>-assistant_v1_1.md).
부모 SP 의 §LEGAL-LIMIT~부록은 한 글자도 바꾸지 않는다(제목 줄과 머리 주석만 자식용으로 바꾼다).
"""
import json, os, re, sys, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data/assistant-child-sp')
CHECK = False


def read_catalog():
    return json.load(open(os.path.join(ROOT, 'prompts/sp-catalog.json'), encoding='utf-8'))


def write_section(d):
    w = d['write']
    s = '### A-%d. %s 서류 작성하기 보강 (STEP W-1·W-2·W-4 참조)\n' % (d['_n'] + 1, d['label'])
    s += '**유의**: STEP W의 W-1(서식 결정)에서 아래 서류를 후보 목록으로 쓰고, W-2(기한 확인)에서 기한 표를 먼저 확인한다. 기한·서식은 이 도구가 확정하지 못한 일반 실무 정보이므로 조문과 법원 공고를 조회해 확인하고, 사안별 기산점과 불복 방법은 변호사가 정한다. 목록에 없는 서류도 변호사가 요구하면 같은 규율로 쓴다.\n'
    s += '| 서류 | 제출처 · 시기 | 핵심 기재 · 첨부 |\n|---|---|---|\n'
    s += '\n'.join('| %s | %s | %s |' % tuple(r) for r in w['forms']) + '\n\n'
    s += '| 기한 | 통상 길이 · 기산 (조문 확인 필요) |\n|---|---|\n'
    s += '\n'.join('| %s | %s |' % tuple(r) for r in w['deadlines']) + '\n\n'
    if w.get('note'): s += '**분야 유의**: %s\n\n' % w['note']
    return s


def child_section(d):
    L = ['## 0-4. 세부 분야 — %s' % d['label'], '',
         '이 SP는 부모 SP의 §LEGAL-LIMIT~부록 전체를 그대로 따르고, **%s** 분야의 전문가가 쓰는 도구로서 아래를 더한다. 충돌하면 §LEGAL-LIMIT이 우선한다.' % d['label'], '',
         '- **분야 범위**: %s' % d['scope'],
         '- **이 분야에서 AI가 스스로 정하지 않는 판단**: %s' % d['judge_extra']]
    if d.get('boundaries'):
        L.append('- **인접 분야와의 경계**:')
        for a, b in d['boundaries']:
            L.append('  - %s: %s' % (a, b))
    if d.get('checks'):
        L.append('- **분야 특유 점검 표시** (발견해도 고치지 않고 `[기록 점검]` 등으로 표시해 되돌린다):')
        for c in d['checks']:
            L.append('  - %s' % c)
    if d.get('forced'):
        L.append('- **강제 전환 사유** (서류 작성보다 먼저 안내한다):')
        for c in d['forced']:
            L.append('  - %s' % c)
    L.append('- **Tier 2 추가 위험**: %s — 🔴`[VERIFY: HIGH — unconfirmed]`' % d['tier2'])
    L.append('- **특화 서류**: 부록 A-%d (%s).' % (d['_n'], d['docs']['title']))
    if d.get('write'):
        L.append('- **서류 작성하기 보강**: 부록 A-%d (STEP W 서식 후보·기한 표).' % (d['_n'] + 1))
    return '\n'.join(L) + '\n\n---\n\n'


def docs_section(d):
    x = d['docs']
    s = '### A-%d. %s (%s)\n' % (d['_n'], x['title'], x['basis'])
    if x.get('note'): s += '**유의**: %s\n' % x['note']
    s += '| 서류 | 핵심 기재 · 첨부·확인 |\n|---|---|\n'
    s += '\n'.join('| %s | %s |' % (a, b) for a, b in x['rows']) + '\n\n'
    return s


def build_text(cid, d):
    ppath = os.path.join(ROOT, 'prompts', read_catalog()['SP_%s-assistant' % d['parent']])
    t = open(ppath, encoding='utf-8', newline='').read()
    lines = t.split('\n')
    m = re.match(r'^# (\S+) · (.+?) v(\S+)\s*$', lines[0])
    if not m: raise SystemExit('%s: 부모 SP 제목 줄을 읽지 못함' % cid)
    code, pname, _ = m.groups()
    ver = re.search(r'_v(\d+)_(\d+)\.md$', os.path.basename(ppath))
    major, minor = ver.group(1), ver.group(2)
    if not d.get('write'): major, minor = '1', '0'  # 서류 작성하기 보강이 없는 분야는 기존 v1.0 그대로
    d['_ver'] = '%s_%s' % (major, minor)
    has_w = bool(re.search(r'^## STEP W\b', t, re.M))
    if d.get('write') and not has_w: raise SystemExit('%s: 부모 SP 에 STEP W 가 없는데 write 데이터가 있음' % cid)
    d['_n'] = max(int(n) for n in re.findall(r'^### A-(\d+)\.', t, re.M)) + 1
    first = next(i for i, l in enumerate(lines) if i > 0 and l.startswith('## '))
    if d['_ver'] == '1_0':
        vline = '> **v1.0 (2026-10-17, 주피터님 지시 — 신설)**'
        extra = '특화 서류(부록 A-%d)' % d['_n']
    else:
        vline = '> **v%s.%s (2026-10-27, 주피터님 지시 — 서류 작성하기 확장)**' % (major, minor)
        extra = '특화 서류(부록 A-%d)와 서류 작성하기 보강(부록 A-%d)' % (d['_n'], d['_n'] + 1)
    head = ['# %s-%s · %s — %s v%s.%s' % (code, d['code_suffix'], pname, d['label'], major, minor), '',
            vline,
            '> 세부 분야 전문가용 SP. 부모 `SP_%s-assistant`의 §LEGAL-LIMIT~부록 전체를 그대로 따르고, %s 분야의 판단 경계(§0-4)와 %s를 더했다. 일반인용은 기존 `SP_%s`가 맡는다.' % (d['parent'], d['label'], extra, cid),
            '> 이 파일은 `scripts/gen-assistant-child-sp.py`가 `data/assistant-child-sp/%s.json`과 부모 SP로 만든다. 직접 고치지 말고 데이터나 부모를 고친 뒤 다시 생성한다.' % cid, '']
    body = '\n'.join(lines[first:])
    a = re.search(r'^## STEP 0\b', body, re.M)
    if not a: raise SystemExit('%s: 부모에 "## STEP 0" 없음' % cid)
    body = body[:a.start()] + child_section(d) + body[a.start():]
    b = re.search(r'(?:^---\s*\n\s*\n)?^## 부록 B', body, re.M)
    if not b: raise SystemExit('%s: 부모에 "## 부록 B" 없음' % cid)
    body = body[:b.start()] + docs_section(d) + (write_section(d) if d.get('write') else '') + body[b.start():]
    return '\n'.join(head) + '\n' + body


def register(cid, name, fname, public_file_hint):
    p = os.path.join(ROOT, 'prompts/sp-catalog.json')
    d = json.loads(open(p, encoding='utf-8', newline='').read())
    key = 'SP_%s-assistant' % cid
    if key in d and d[key] != fname:
        d[key] = fname
        open(p, 'w', encoding='utf-8', newline='').write(json.dumps(d, ensure_ascii=False, indent=2))
    if key not in d:
        n = {}
        for k, v in d.items():
            if k == 'SP_' + cid: n[key] = fname
            n[k] = v
        if key not in n: n[key] = fname
        open(p, 'w', encoding='utf-8', newline='').write(json.dumps(n, ensure_ascii=False, indent=2))
    p = os.path.join(ROOT, 'prompts/sp-catalog-categories.json')
    c = json.loads(open(p, encoding='utf-8', newline='').read())
    cid2 = 'prof-%s-assistant' % cid
    for it in c['items']:
        if it['cat'] == cid2 and it['file'] != 'prompts/' + fname:
            it['file'] = 'prompts/' + fname
            open(p, 'w', encoding='utf-8', newline='').write(json.dumps(c, ensure_ascii=False, separators=(',', ':')))
    if cid2 not in [x['id'] for x in c['categories']]:
        cats = [x['id'] for x in c['categories']]
        pub = [x for x in c['items'] if x['file'] == 'prompts/' + public_file_hint]
        pcat = pub[0]['cat'] if pub else None
        i = cats.index(pcat) if pcat in cats else len(cats)
        c['categories'].insert(i, {'id': cid2, 'label': name, 'group': '전문직 페르소나', 'count': 1})
        j = [it['cat'] for it in c['items']].index(pcat) if pcat else len(c['items'])
        c['items'].insert(j, {'name': name, 'file': 'prompts/' + fname, 'cat': cid2, 'region': ''})
        c['total'] += 1
        open(p, 'w', encoding='utf-8', newline='').write(json.dumps(c, ensure_ascii=False, separators=(',', ':')))


def build(cid):
    d = json.load(open(os.path.join(DATA, cid + '.json'), encoding='utf-8'))
    text = build_text(cid, d)  # d['_ver'] 가 여기서 정해진다
    fname = 'SP_%s-assistant_v%s.md' % (cid, d['_ver'])
    path = os.path.join(ROOT, 'prompts', fname)
    old = open(path, encoding='utf-8', newline='').read() if os.path.exists(path) else None
    if CHECK:
        if old != text: print('%s: %s 가 데이터와 다릅니다' % (cid, fname)); sys.exit(1)
        print('%s: 일치' % cid); return
    if old != text:
        open(path, 'w', encoding='utf-8', newline='').write(text)
    cat = read_catalog()
    pub = cat.get('SP_' + cid, '')
    register(cid, d['name'], fname, pub)
    print('%s: %s (%d줄)%s' % (cid, fname, text.count('\n') + 1, '' if old != text else ' — 변경 없음'))


if __name__ == '__main__':
    args = sys.argv[1:]
    if args and args[0] == '--check':
        CHECK = True; args = args[1:]
    if args == ['--all']:
        args = sorted(os.path.basename(f)[:-5] for f in glob.glob(os.path.join(DATA, '*.json')))
    if not args: raise SystemExit(__doc__)
    for a in args: build(a)
