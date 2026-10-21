#!/usr/bin/env python3
"""직역 전문가 검수 시트 생성기 (2026-10-21, 계획 W4).

SP 카탈로그에서 현재 전문가용 SP(-assistant)를 찾아, 직역마다 검수자가 채울 시트(docs/review/sheets/<id>-검수시트.md)를 만든다.
시트 내용은 모두 SP에서 뽑는다(정본은 SP): 서류 목록(부록 A), SP가 스스로 '확인 필요'라고 표시한 항목, 금지 행위 절(§LEGAL-LIMIT).
사용:  python3 scripts/gen-review-packages.py          # 생성
       python3 scripts/gen-review-packages.py --check  # 저장소의 시트가 SP와 같은지 검사(다르면 종료코드 1)
"""
import json, os, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'docs/review/sheets'

# (persona id, 직역명, 근거 법령 표기, 시범 순서) — 순서는 계획서 W4: 변리사·공인중개사 시범 → 세무·회계·감정평가·의료·약사 → 법무사·행정사 → 변호사(법률 검토 후)
JOBS = [
    ('patent-attorney', '변리사', '변리사법', '1 (시범)'),
    ('real-estate-agent', '공인중개사', '공인중개사법', '1 (시범)'),
    ('tax-accountant', '세무사', '세무사법', '2'),
    ('accountant', '공인회계사', '공인회계사법', '2'),
    ('appraiser', '감정평가사', '감정평가 및 감정평가사에 관한 법률', '2'),
    ('physician', '의사', '의료법', '2'),
    ('traditional-medicine-doctor', '한의사', '의료법', '2'),
    ('pharmacist', '약사', '약사법', '2'),
    ('judicial-scrivener', '법무사', '법무사법', '3'),
    ('administrative-scrivener', '행정사', '행정사법', '3'),
    ('lawyer', '변호사', '변호사법', '4 (법률 검토 후)'),
]
FLAG = re.compile(r'확인 필요|확인 못함|미확인|확인 못|범위 확인|서식 확인|최신 확인')
cell = lambda s: str(s).replace('|', '\\|').replace('\n', ' ').strip()


def sp_file(pid):
    cat = json.loads((ROOT / 'prompts/sp-catalog.json').read_text(encoding='utf-8'))
    f = cat.get(f'SP_{pid}-assistant')
    if not f:
        raise SystemExit(f'카탈로그에 SP_{pid}-assistant 없음')
    return f


def section(text, start_re, end_re):
    m = re.search(start_re, text, re.M)
    if not m:
        return ''
    e = re.search(end_re, text[m.end():], re.M)
    return text[m.start(): m.end() + (e.start() if e else len(text))].rstrip()


def catalog(fname):
    # Windows 에서 하위 프로세스의 stdout 이 cp949 로 나가 UTF-8 해석에 실패하던 문제(2026-10-21) — 하위 프로세스를 UTF-8 로 고정한다.
    env = dict(os.environ, PYTHONUTF8='1', PYTHONIOENCODING='utf-8')
    r = subprocess.run([sys.executable, '-X', 'utf8', str(ROOT / 'scripts/gen-expert-pages.py'), '--catalog-json', str(ROOT / 'prompts' / fname)], capture_output=True, text=True, encoding='utf-8', env=env)
    if r.returncode != 0:
        raise SystemExit(f'{fname}: 서류 목록 읽기 실패: {r.stderr}')
    return json.loads(r.stdout)


def flagged_lines(text):
    """SP 전체에서 SP 자신이 '확인 필요'로 표시한 줄(제목 줄·빈 줄 제외, 중복 제거, 순서 유지)."""
    seen, out = set(), []
    app = re.search(r'^## 부록 A', text, re.M)                       # 부록 A(서류 목록)는 1부에서 이미 검수하므로 제외
    if app:
        end = re.search(r'^## ', text[app.end():], re.M)
        text = text[:app.start()] + (text[app.end() + end.start():] if end else '')
    for ln in text.splitlines():
        s = ln.strip()
        if not s or s.startswith('#') or not FLAG.search(s) or s in seen:
            continue
        seen.add(s); t = s.lstrip('-* ').strip(); out.append(t if len(t) <= 240 else t[:237] + '…')
    return out


def sheet(pid, name, law, order):
    fname = sp_file(pid)
    text = (ROOT / 'prompts' / fname).read_text(encoding='utf-8')
    ver = re.search(r'_v(\d+_\d+)\.md$', fname).group(1).replace('_', '.')
    cats = catalog(fname)
    n_items = sum(len(c['items']) for c in cats)
    legal = section(text, r'^## §LEGAL-LIMIT', r'^## 0\. IDENTITY')
    flags = flagged_lines(text)
    L = []
    a = L.append
    a(f'# {name} 전문가용 AI 검수 시트')
    a('')
    a(f'- 대상: `{fname}` (v{ver}) · 서류 {len(cats)}개 영역 {n_items}종 · 근거 법령 표기: {law}')
    a(f'- 개시 순서: {order} · 이 시트는 SP에서 자동 생성되며 **현재 상태는 "검수 전 초안"** 입니다.')
    a('- 검수 범위: 서류 목록의 적정성, SP가 스스로 확인 필요로 표시한 항목, AI가 하지 않는 일(금지 행위)의 적정성, 실무 용어. **법령 원문 대조는 별도 작업(W3)이며, 검수자에게 법령 전문 확인을 요구하지 않습니다.**')
    a('')
    a('## 0. 검수자 정보와 이해관계 공개')
    a('')
    a('| 항목 | 기재 |')
    a('|---|---|')
    for k in ['성명(대외 표기 시 사용 — 비공개를 원하면 "직역 전문가 1인"으로 표기)', '직역·경력 요약(자격번호는 적지 않습니다)', '검수 트랙 (A 입찰 예정 전문가 / B 자문 계약 / C 직역 단체)', '검수 일자']:
        a(f'| {k} | |')
    a('')
    a('**이해관계 공개 (해당 항목에 ☑)**')
    a('')
    for k in ['나비웹 컨소시엄 해당 직역 법인의 5% 주식 입찰에 참여할 예정이다 (또는 참여했다)', '해당 직역 법인 또는 나비웹과 보수·계약 관계가 있다 (자문 계약 포함)', '이 서비스가 경쟁·대체하는 사업(유사 AI 서비스, 서류 대행 등)을 운영하거나 지분이 있다', '위 어느 것에도 해당하지 않는다']:
        a(f'- [ ] {k}')
    a('')
    a('> 입찰 예정자의 검수는 **의견 수렴**으로 기록되며, 판단 경계와 서류 목록의 최종 확정은 자문 계약 전문가 또는 직역 단체 의견과 교차 확인합니다. 이해관계 공개 내용은 검수 이력과 함께 공개됩니다.')
    a('')
    a('## 1. 서류 목록 검수')
    a('')
    a('판정 표기: **적정** / **명칭수정** / **설명수정** / **삭제(과잉)** / **확인불가** — 의견란에 실무에서 부르는 이름이나 이유를 적어 주세요.')
    a('')
    for c in cats:
        a(f'### {c["id"]}. {c["title"]}')
        a('')
        if c.get('meta'):
            a(f'- {c["meta"]}')
        for n in c.get('notes', []):
            a(f'- 안내: {n}')
        a('')
        a('| # | 서류명 | AI 설명(SP 기재) | 판정 | 의견 |')
        a('|---|---|---|---|---|')
        for i, it in enumerate(c['items'], 1):
            a(f'| {c["id"]}-{i} | {cell(it["t"])} | {cell(it.get("d", ""))} | | |')
        a('')
        a(f'**{c["id"]} 영역 — 실무상 빠진 서류**(이름·제출처·언제 쓰는지): ')
        a('')
        a('')
    a('## 2. SP가 스스로 "확인 필요"로 표시한 항목')
    a('')
    a('아래는 SP 본문에 "확인 필요/미확인" 등으로 남겨 둔 줄입니다. 아는 범위에서 **맞음 / 틀림(정정 내용) / 모름** 으로 답해 주세요. 모르면 "모름"으로 남기시면 됩니다(지어내지 않는 것이 원칙).')
    a('')
    a('| # | SP 기재 | 답 | 정정·의견 |')
    a('|---|---|---|---|')
    for i, f in enumerate(flags, 1):
        a(f'| F-{i} | {cell(f)} | | |')
    if not flags:
        a('| - | (표시된 항목 없음) | | |')
    a('')
    a('## 3. AI가 하지 않는 일 / 판단 경계 검토')
    a('')
    a('아래는 SP의 「법적 지위와 금지 행위」 절입니다. 읽고 다음 질문에 답해 주세요.')
    a('')
    a('<details><summary>SP 원문 펼치기</summary>')
    a('')
    a('```text')
    a(legal or '(해당 절을 찾지 못함)')
    a('```')
    a('')
    a('</details>')
    a('')
    a('| # | 질문 | 답 |')
    a('|---|---|---|')
    qs = [
        '이 절의 금지 행위 중 직역법상 허용되지 않는 일을 AI가 할 수 있게 쓴 부분이 있습니까?',
        'AI가 반드시 전문가에게 넘겨야 하는데 빠진 상황(판단 경계, 강제 전환 사유)이 있습니까?',
        '일반 이용자에게 위험하게 읽힐 수 있는 안내나 표현이 있습니까?',
        '전문가가 AI 초안을 쓸 때 가장 먼저 확인할 항목은 무엇입니까? (체크리스트에 넣을 항목)',
        '실무에서 쓰지 않거나 어색한 용어가 있습니까? (용어 → 실무 용어)',
        '서류를 AI가 만들기에 부적절하다고 보는 서류가 있습니까? (이유 포함)',
    ]
    for i, q in enumerate(qs, 1):
        a(f'| Q-{i} | {q} | |')
    a('')
    a('## 4. 종합 판정과 대외 표기 동의')
    a('')
    a('- [ ] 서류 목록은 **이대로 사용 가능** · [ ] **수정 후 사용** · [ ] **전면 재검토 필요**')
    a('- 종합 의견: ')
    a('- 검수 결과를 서비스 화면에 "검수 완료(트랙, 일자)"로 표기하는 데 동의한다: [ ] 예 · [ ] 아니오')
    a('- 성명 공개: [ ] 공개 · [ ] 비공개(직역 전문가 1인)')
    a('')
    a('> 이 검수는 AI 서비스 초안의 정확도 향상을 위한 의견입니다. 검수자가 서비스의 결과물이나 이용자의 업무에 대해 책임을 지는 것을 의미하지 않으며, 책임 범위는 별도 계약(트랙 B)이나 요청 공문(트랙 C)에 따릅니다.')
    a('')
    return '\n'.join(L)


def main():
    check = '--check' in sys.argv
    OUT.mkdir(parents=True, exist_ok=True)
    bad = []
    for pid, name, law, order in JOBS:
        path = OUT / f'{pid}-검수시트.md'
        txt = sheet(pid, name, law, order)
        if check:
            if not path.exists() or path.read_text(encoding='utf-8') != txt:
                bad.append(path.name)
        else:
            path.write_text(txt, encoding='utf-8')
            print('생성:', path.relative_to(ROOT))
    if check:
        if bad:
            print('SP와 다른 시트(재생성 필요):', ', '.join(bad)); sys.exit(1)
        print('검수 시트 일치', len(JOBS))


if __name__ == '__main__':
    main()
