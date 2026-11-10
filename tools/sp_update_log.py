#!/usr/bin/env python3
"""
tools/sp_update_log.py
----------------------
정부 AI SP 갱신 기록(언제·어떻게·왜)과 모든 SP 간 공유 메커니즘.
설계: docs/GOV-SP-UPDATE-SHARING_v1_0.md

갱신 의무 트리거(둘 중 하나):  ① 해당 SP에 대한 미반영 사용자 피드백 10건 이상  ② 마지막 갱신 후 90일 경과

  add      --file entry.json | --json '{...}'   갱신 기록 1건 추가(검증·peer_impact 자동 계산)
  digest   [--check]                            공유 다이제스트 prompts/gov-tree/00-common/GOV-UPDATE-DIGEST.md 생성/동기 검사
  due      [--json]                             지금 갱신해야 하는 SP 목록(트리거별)
  check-pr --base REF                           CI: 바뀐 정부 SP 파일은 기록이 함께 추가돼야 함

기록 원장: data/sp-update-log/log.jsonl (append-only, 한 줄 = 한 갱신). 지우거나 고치지 않고 정정 기록을 추가한다.
"""
import json, os, re, sys, glob, fnmatch, subprocess, urllib.request, urllib.parse
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOG = ROOT / 'data' / 'sp-update-log' / 'log.jsonl'
DIGEST = ROOT / 'prompts' / 'gov-tree' / '00-common' / 'GOV-UPDATE-DIGEST.md'
GOV_GLOBS = ['prompts/gov-tree/**/*.md']
GOV_EXTRA = ['prompts/K-Public_common_v1_4.md', 'prompts/SP-10_kpublic_v3.25.txt']
EXEMPT = {'prompts/gov-tree/00-common/GOV-UPDATE-DIGEST.md'}   # 생성물
DUE_DAYS = 90
DUE_FEEDBACK = 10
DIGEST_DAYS = 90
DIGEST_MAX_BYTES = 9000
TRIGGERS = {'days90', 'feedback10', 'monthly', 'manual', 'initial'}
METHODS = {'web_search', 'peer_digest', 'feedback', 'general_knowledge', 'official_notice', 'user_instruction'}
VERIFIED = {'web', 'peer', 'feedback', 'partial', 'unverified'}
KINDS = {'정체성', '소관', '법령', '창구', '명칭', '연락처', '절차', '기한', '양식', '규칙', '기타'}
DATE_RE = re.compile(r'(?:legal_basis_last_verified|last_verified)\**:?\**\s*\**(\d{4}-\d{2}-\d{2})')
TAG_RE = re.compile(r'^(법령|기관|분야):.+')


def rel(p):
    return p.relative_to(ROOT).as_posix()


def today():
    return datetime.now(timezone(timedelta(hours=9))).date()


def _is_sp(p):
    n = p.name
    return n.startswith('SP-') or bool(re.search(r'-SP_v[\d.]+\.md$', n)) or rel(p) in GOV_EXTRA


def _ver(p):
    m = re.search(r'_v([\d.]+?)(?:\.[a-z]+)?$', p.name)
    return tuple(int(x) for x in m.group(1).split('.') if x.isdigit()) if m else ()


def gov_files():
    """갱신 규칙의 대상 = 실제로 로드되는 정부 AI SP(최신 버전만). 문서·스키마·로그·구버전은 제외."""
    cand = []
    for g in GOV_GLOBS:
        cand += [Path(p) for p in glob.glob(str(ROOT / g), recursive=True)]
    cand += [ROOT / p for p in GOV_EXTRA]
    cand = [p for p in cand if p.exists() and '/archive/' not in p.as_posix() and _is_sp(p)
            and rel(p) not in EXEMPT]
    best = {}
    for p in cand:
        key = (p.parent, p.name.split('_v')[0])
        if key not in best or _ver(p) > _ver(best[key]): best[key] = p
    return sorted(best.values())


def read_log():
    if not LOG.exists():
        return []
    return [json.loads(l) for l in LOG.read_text(encoding='utf-8').splitlines() if l.strip()]


def matches(entry, path):
    return any(fnmatch.fnmatch(path, pat) for pat in entry['sp_ids'])


def validate(e):
    errs = []
    for k in ('sp_ids', 'trigger', 'why', 'how', 'changes', 'verified'):
        if not e.get(k):
            errs.append(f'필수 필드 누락: {k}')
    if errs:
        return errs
    if e['trigger'] not in TRIGGERS: errs.append(f'trigger ∈ {sorted(TRIGGERS)}')
    if e['verified'] not in VERIFIED: errs.append(f'verified ∈ {sorted(VERIFIED)}')
    if not isinstance(e['sp_ids'], list) or not all(isinstance(x, str) for x in e['sp_ids']):
        errs.append('sp_ids 는 경로/글로브 문자열 목록')
    else:
        allp = [rel(p) for p in gov_files()]
        for pat in e['sp_ids']:
            if not any(fnmatch.fnmatch(p, pat) for p in allp):
                errs.append(f'sp_ids 패턴이 어떤 SP 파일과도 맞지 않음: {pat}')
    how = e['how']
    ms = how.get('method') or []
    if not ms or not set(ms) <= METHODS: errs.append(f'how.method ⊂ {sorted(METHODS)} (비어 있으면 안 됨)')
    if 'web_search' in ms and not how.get('sources'): errs.append('web_search 를 썼으면 how.sources(URL·게시일) 필수')
    if 'peer_digest' in ms and not how.get('peer_refs'): errs.append('peer_digest 를 참고했으면 how.peer_refs(다른 갱신 id) 필수')
    if 'feedback' in ms and not how.get('feedback_ids'): errs.append('feedback 반영이면 how.feedback_ids 필수')
    if e['verified'] == 'web' and 'web_search' not in ms and 'official_notice' not in ms:
        errs.append("verified=web 이면 method 에 web_search/official_notice 필요")
    for c in e['changes']:
        if c.get('kind') not in KINDS or not (c.get('summary') or '').strip():
            errs.append(f'changes[].kind ∈ {sorted(KINDS)}, summary 필수')
    for t in e.get('tags', []):
        if not TAG_RE.match(t): errs.append(f'tags 형식은 법령:/기관:/분야: — {t}')
    return errs


def peer_impact(e, limit=60):
    """같은 법령·기관 태그를 본문에 언급하는 다른 SP — "참고해 점검할 후보"."""
    kws = [t.split(':', 1)[1] for t in e.get('tags', []) if t.startswith(('법령:', '기관:'))]
    if not kws:
        return []
    own = set()
    for p in gov_files():
        if matches(e, rel(p)): own.add(rel(p))
    res = []
    for p in gov_files():
        r = rel(p)
        if r in own: continue
        txt = p.read_text(encoding='utf-8', errors='ignore')
        if any(k in txt for k in kws): res.append(r)
        if len(res) >= limit: break
    return res


def next_id(entries, d):
    n = sum(1 for e in entries if e['id'].startswith(f'U-{d:%Y%m%d}')) + 1
    return f'U-{d:%Y%m%d}-{n:03d}'


def cmd_add(a):
    raw = Path(a[a.index('--file') + 1]).read_text(encoding='utf-8') if '--file' in a else a[a.index('--json') + 1]
    e = json.loads(raw)
    errs = validate(e)
    if errs:
        print('기록 거부:'); [print('  -', x) for x in errs]; return 1
    entries = read_log(); d = today()
    e.setdefault('ts', d.isoformat()); e['id'] = next_id(entries, date.fromisoformat(e['ts']))
    e.setdefault('tags', []); e['peer_impact'] = peer_impact(e)
    with LOG.open('a', encoding='utf-8') as f:
        f.write(json.dumps(e, ensure_ascii=False) + '\n')
    print(f"✓ {e['id']} 기록 — 참고 점검 후보 SP {len(e['peer_impact'])}개. 다음: python3 tools/sp_update_log.py digest")
    return 0


def short(paths):
    names = sorted({re.sub(r'^.*/(SP-[A-Z0-9-]+?)(?:_v[\d.]+)?(?:-TEMPLATE)?\..*$', r'\1', p) if 'SP-' in p else Path(p).stem for p in paths})
    return ', '.join(names[:4]) + (f' 외 {len(names)-4}' if len(names) > 4 else '')


def build_digest():
    ref = today(); entries = [e for e in read_log() if (ref - date.fromisoformat(e['ts'])).days <= DIGEST_DAYS]
    entries.sort(key=lambda e: (e['ts'], e['id']), reverse=True)
    head = ('# 정부 AI SP 갱신 공유 다이제스트 (자동 생성 — 직접 고치지 않는다)\n\n'
            f'생성 기준일 {ref} · 최근 {DIGEST_DAYS}일 갱신 {len(entries)}건 · 원장 data/sp-update-log/log.jsonl · 절차 docs/GOV-SP-UPDATE-SHARING_v1_0.md\n\n'
            '이 문서는 **모든 정부 AI가 공유하는 갱신 기록**이다. 각 줄은 `갱신id · 일자 · 대상 · 트리거 · 이유 → 바뀐 것 · 검증수준 · 태그`. '
            '내 소관과 같은 법령·기관 태그의 최신 기록이 있으면 SP 본문보다 이쪽을 우선해 참고하되, 검증수준이 `unverified`/`partial`이면 확정 사실처럼 말하지 않고 공식 출처로 확인한다.\n\n')
    body = ''
    for e in entries:
        ch = '; '.join(f"{c['kind']}:{c['summary']}" for c in e['changes'])[:160]
        line = f"- {e['id']} · {e['ts']} · {short(e['sp_ids'])} · {e['trigger']} · {e['why'][:80]} → {ch} · {e['verified']}" + (f" · {' '.join(e['tags'][:4])}" if e.get('tags') else '') + '\n'
        if len((head + body + line).encode()) > DIGEST_MAX_BYTES:
            body += f'- … 이하 {len(entries) - body.count(chr(10))}건은 원장 참조\n'; break
        body += line
    return head + (body or '- (최근 갱신 기록 없음)\n')


def cmd_digest(a):
    new = build_digest()
    if '--check' in a:
        cur = DIGEST.read_text(encoding='utf-8') if DIGEST.exists() else ''
        # 기준일 줄은 날짜만 달라지므로 비교에서 제외
        norm = lambda s: re.sub(r'생성 기준일 \d{4}-\d{2}-\d{2} · ', '', s)
        if norm(cur) != norm(new): print('✗ 다이제스트가 원장과 어긋남 — `python3 tools/sp_update_log.py digest` 실행'); return 1
        print('✓ 다이제스트 동기'); return 0
    DIGEST.write_text(new, encoding='utf-8'); print(f'✓ {rel(DIGEST)} ({len(new.encode())}B)'); return 0


def pb_new_feedback_counts():
    base, em, pw = (os.environ.get(k, '').rstrip('/') for k in ('POCKETBASE_URL', 'POCKETBASE_ADMIN_EMAIL', 'POCKETBASE_ADMIN_PASSWORD'))
    if not (base and em and pw):
        return None
    def call(url, body=None, tok=None):
        req = urllib.request.Request(url, data=json.dumps(body).encode() if body else None,
                                     headers={'Content-Type': 'application/json', **({'Authorization': f'Bearer {tok}'} if tok else {})})
        return json.loads(urllib.request.urlopen(req, timeout=30).read())
    tok = call(f'{base}/api/collections/_superusers/auth-with-password', {'identity': em, 'password': pw})['token']
    counts, page = {}, 1
    while True:
        qs = urllib.parse.urlencode({'filter': "status = 'new'", 'perPage': 200, 'page': page})
        r = call(f'{base}/api/collections/user_feedback/records?{qs}', tok=tok)
        for it in r.get('items', []):
            c = it.get('context_sp') or ''
            if c: counts[c] = counts.get(c, 0) + 1
        if page >= r.get('totalPages', 1): break
        page += 1
    return counts


def due_list(ref=None, fb_counts=None):
    """각 SP 파일의 마지막 갱신 = max(파일 안 마지막 확인일, 원장에서 이 파일을 덮는 최신 기록)."""
    ref = ref or today(); entries = read_log(); out = []
    for p in gov_files():
        r = rel(p)
        m = DATE_RE.search(p.read_text(encoding='utf-8', errors='ignore'))
        last = date.fromisoformat(m.group(1)) if m else None
        for e in entries:
            if matches(e, r) and e['verified'] != 'unverified':   # 미검증 기록은 90일 시계를 되돌리지 않는다
                d = date.fromisoformat(e['ts']); last = d if last is None or d > last else last
        why = []
        if last is None or (ref - last).days > DUE_DAYS: why.append('days90')
        stem = Path(r).name.split('_v')[0]
        n = (fb_counts or {}).get(stem, 0) + (fb_counts or {}).get(stem.replace('-TEMPLATE', ''), 0)
        if n >= DUE_FEEDBACK: why.append(f'feedback{n}')
        if why: out.append({'path': r, 'last_update': last.isoformat() if last else None, 'reasons': why})
    return out


def cmd_due(a):
    fb = pb_new_feedback_counts()
    res = due_list(fb_counts=fb)
    if '--json' in a: print(json.dumps(res, ensure_ascii=False, indent=2)); return 0
    print(f'갱신 의무 SP {len(res)}개 (90일 경과 또는 미반영 피드백 10건↑) — 피드백 원천: {"pocketbase" if fb is not None else "unavailable(90일 기준만 계산)"}')
    for r in res[:40]: print(' ', r['path'], r['last_update'], ','.join(r['reasons']))
    return 0


RULE_VERSION = 'v1.0'
RULE_HEAD = '## §UPDATE-RULE.'
RULE_BLOCK = f'''## §UPDATE-RULE. 이 SP의 갱신 규칙 ({RULE_VERSION} · 2026-11-11 — 모든 정부 AI SP 공통, 정본: K-Public_common P15 · docs/GOV-SP-UPDATE-SHARING_v1_0.md)

- **갱신 의무**: 이 SP에 대한 미반영 사용자 피드백이 10건 이상 쌓이거나 마지막 갱신 후 90일이 지나면 이 SP는 갱신되어야 한다.
- **갱신 방법**: 웹 검색 등으로 최신 정보를 확인해 반영하고, 다른 SP의 갱신 기록(GOV-UPDATE-DIGEST·원장 data/sp-update-log/log.jsonl)을 참고하며, 언제·어떻게·왜 갱신했는지 원장에 기록한다. 기록은 모든 SP와 공유된다.
- **호출 시 행동**: ① 상위로 주어진 GOV-UPDATE-DIGEST에서 내 소관과 같은 법령·기관·분야의 더 새로운 기록이 있으면 SP 본문보다 그것을 따른다(검증수준이 `partial`·`unverified`면 확정 사실처럼 말하지 않는다). ② 이 SP의 마지막 확인일이 90일을 넘겼으면 안내가 오래된 정보일 수 있음을 사용자에게 알리고 공식 출처 확인을 권한다. ③ 사용자가 정정·불만·누락을 말하면 `[USER_FEEDBACK]`, 웹 검색으로 SP와 다른 공식 최신 정보를 발견하면 `[SP_UPDATE_SIGNAL]`을 낸다(형식: K-Public_common P14·P15). ④ 갱신이 되었다고 약속하지 않는다.
'''


def _apply_rule(text):
    """규칙 블록 삽입(없으면 §3 앞, §3이 없으면 파일 끝) 또는 갱신(있으면 그 자리 교체). 멱등."""
    if RULE_HEAD in text:
        i = text.index(RULE_HEAD); m = re.search(r'\n## ', text[i + 5:])
        j = i + 5 + m.start() + 1 if m else len(text)
        return text[:i] + RULE_BLOCK + ('\n' if j < len(text) else '') + text[j:]
    m = re.search(r'^## §[3-9]', text, re.M)
    if m: return text[:m.start()] + RULE_BLOCK + '\n' + text[m.start():]
    return text.rstrip('\n') + '\n\n' + RULE_BLOCK


def rule_targets():
    # K-Public_common(P15)·SP-10(§UPDATE-SHARING)은 규칙의 정본을 본문에 갖고 있어 블록을 따로 두지 않는다
    return [p for p in gov_files() if rel(p) not in GOV_EXTRA]


def cmd_rule(a):
    """rule-apply: 모든 정부 SP에 규칙 블록 반영 / rule-check: 모든 SP가 현행 규칙 블록을 갖는지 검사(CI)."""
    check = a and a[0] == 'check'
    bad = []; n = 0
    for p in rule_targets():
        t = p.read_text(encoding='utf-8')
        new = _apply_rule(t)
        if new != t:
            if check: bad.append(rel(p))
            else: p.write_text(new, encoding='utf-8'); n += 1
    if check:
        if bad:
            print(f'✗ 갱신 규칙(§UPDATE-RULE {RULE_VERSION})이 없거나 현행과 다른 정부 SP {len(bad)}개 — `python3 tools/sp_update_log.py rule-apply`'); [print('  -', b) for b in bad[:15]]; return 1
        print(f'✓ 정부 SP {len(rule_targets())}개 모두 현행 갱신 규칙 보유(정본 2개 제외)'); return 0
    print(f'✓ 규칙 블록 반영 {n}개 (대상 {len(rule_targets())}개)'); return 0


def cmd_check_pr(a):
    base = a[a.index('--base') + 1]
    names = subprocess.run(['git', 'diff', '--name-only', f'{base}...HEAD'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
    gov = {rel(p) for p in gov_files()}
    changed = [n for n in names if n in gov]
    if not changed:
        print('✓ 정부 SP 변경 없음'); return cmd_rule(['check'])
    diff = subprocess.run(['git', 'diff', f'{base}...HEAD', '--', 'data/sp-update-log/log.jsonl'], cwd=ROOT, capture_output=True, text=True).stdout
    added = [json.loads(l[1:]) for l in diff.splitlines() if l.startswith('+') and not l.startswith('+++') and l[1:].strip()]
    bad = []
    for e in added:
        er = validate(e)
        if er: bad.append((e.get('id'), er))
    if bad:
        print('✗ 이 PR이 추가한 갱신 기록이 유효하지 않음:'); [print('  -', i, x) for i, x in bad]; return 1
    miss = [c for c in changed if not any(matches(e, c) for e in added)]
    if miss:
        print(f'✗ 갱신 기록 없이 바뀐 정부 SP {len(miss)}개 — 언제·어떻게·왜를 data/sp-update-log/log.jsonl 에 추가하고 digest 를 갱신하세요'); [print('  -', m) for m in miss[:15]]; return 1
    if cmd_digest(['--check']): return 1
    if cmd_rule(['check']): return 1
    print(f'✓ 정부 SP {len(changed)}개 변경 모두 갱신 기록 있음'); return 0


if __name__ == '__main__':
    a = sys.argv[1:]
    cmds = {'rule-apply': lambda x: cmd_rule(['apply']), 'rule-check': lambda x: cmd_rule(['check']), 'add': cmd_add, 'digest': cmd_digest, 'due': cmd_due, 'check-pr': cmd_check_pr}
    sys.exit(cmds[a[0]](a[1:]) if a and a[0] in cmds else (print(__doc__) or 2))
