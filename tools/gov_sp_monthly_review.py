#!/usr/bin/env python3
"""
tools/gov_sp_monthly_review.py
------------------------------
정부 AI SP 월간 검토 — 최신성 갱신 + 사용자 피드백 반영을 "강제"하는 장부(ledger) 도구.
절차 전문: docs/GOV-SP-MONTHLY-REVIEW_v1_0.md

  open  [--month YYYY-MM]   매월 1일. 장부 data/gov-sp-review/YYYY-MM.json 개설
                            (갱신 대상 SP 목록 + 지난달 사용자 피드백 스냅샷).
  check [--month YYYY-MM]   장부 검증. 마감(매월 15일) 후 장부가 없거나 미종결이면 exit 1.
                            --pr-gate: SP를 바꾸는 PR 전용(같은 검증, 장부를 고치는 PR은 통과).
  close [--month YYYY-MM] --by NAME   검증 통과 시 closed=true 로 기록.

이 도구는 SP 본문을 고치지 않는다. 승인·반영은 사람이 한다(RULE-03 동일 원칙).
open 은 POCKETBASE_* 환경변수가 있으면 피드백을 가져오고, 없으면 feedback.source=unavailable
로 기록하며 이 경우 종료(close) 시 사람이 feedback.attested_none=true 로 확인해야 한다.
"""
import json, os, re, sys, glob, urllib.request, urllib.parse
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIR = ROOT / 'data' / 'gov-sp-review'
GOV_GLOBS = ['prompts/gov-tree/**/*.md']
GOV_EXTRA = ['prompts/K-Public_common_v1_4.md', 'prompts/SP-10_kpublic_v3.25.txt']
# 갱신 의무 기준(90일·피드백 10건)은 tools/sp_update_log.py 에 둔다(런타임 확인 주기 30일은 P13).
DEADLINE_DAY = 15      # 매월 15일까지 종결
DATE_RE = re.compile(r'(?:legal_basis_last_verified|last_verified)\**:?\**\s*\**(\d{4}-\d{2}-\d{2})')
GOV_SP_RE = re.compile(r'(SP-(DO|AGY|COMM|CITY|CITYDIV|CITYDEPT|DEPT|EMD|TEAM|NAT|ORG|ORGDIV|PROVINCE)|K-Public|SP-10|gov)', re.I)
DISPOSITIONS = {'applied', 'rejected', 'deferred'}


def today():
    return datetime.now(timezone(timedelta(hours=9))).date()


def gov_files():
    out = []
    for g in GOV_GLOBS:
        out += [Path(p) for p in glob.glob(str(ROOT / g), recursive=True)]
    out += [ROOT / p for p in GOV_EXTRA]
    return sorted(p for p in out if p.exists() and '/archive/' not in p.as_posix())


def stale_list(ref, fb_counts=None):
    """갱신 의무 SP — 마지막 갱신 후 90일 경과 또는 미반영 피드백 10건↑ (tools/sp_update_log.py due_list 와 동일 기준)."""
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import sp_update_log
    return [{'path': d['path'], 'last_update': d['last_update'], 'reasons': d['reasons']} for d in sp_update_log.due_list(ref, fb_counts)]


def prev_month(m):
    y, mo = map(int, m.split('-'))
    return f'{y-1}-12' if mo == 1 else f'{y}-{mo-1:02d}'


def load(m):
    f = DIR / f'{m}.json'
    return json.loads(f.read_text(encoding='utf-8')) if f.exists() else None


def pb_feedback(month):
    base, em, pw = (os.environ.get(k, '').rstrip('/') for k in ('POCKETBASE_URL', 'POCKETBASE_ADMIN_EMAIL', 'POCKETBASE_ADMIN_PASSWORD'))
    if not (base and em and pw):
        return 'unavailable', []

    def call(url, body=None, tok=None):
        req = urllib.request.Request(url, data=json.dumps(body).encode() if body else None,
                                     headers={'Content-Type': 'application/json', **({'Authorization': f'Bearer {tok}'} if tok else {})})
        return json.loads(urllib.request.urlopen(req, timeout=30).read())
    tok = call(f'{base}/api/collections/_superusers/auth-with-password', {'identity': em, 'password': pw})['token']
    y, mo = map(int, prev_month(month).split('-'))
    start = date(y, mo, 1).isoformat()
    items, page = [], 1
    while True:
        qs = urllib.parse.urlencode({'filter': f"created >= '{start} 00:00:00' && status != 'dismissed_spam'", 'perPage': 200, 'page': page})
        r = call(f'{base}/api/collections/user_feedback/records?{qs}', tok=tok)
        items += r.get('items', [])
        if page >= r.get('totalPages', 1):
            break
        page += 1
    out = []
    for it in items:
        ctx = it.get('context_sp') or ''
        out.append({'id': it.get('id'), 'context_sp': ctx, 'category': it.get('category'),
                    'text': (it.get('raw_text') or '')[:300], 'gov': bool(GOV_SP_RE.search(ctx)) or not ctx,
                    'disposition': None, 'ref': None, 'note': None})
    return 'pocketbase', out


def cmd_open(m):
    DIR.mkdir(parents=True, exist_ok=True)
    f = DIR / f'{m}.json'
    if f.exists():
        print(f'{f.name} 이미 존재 — 덮어쓰지 않음'); return 0
    src, items = pb_feedback(m)
    stale = stale_list(today())
    prev = load(prev_month(m))
    ledger = {
        'month': m, 'opened_at': today().isoformat(),
        'deadline': date(int(m[:4]), int(m[5:]), DEADLINE_DAY).isoformat(),
        'refresh': {'stale_at_open': len(stale), 'stale_files': stale, 'remaining_stale': None, 'note': None,
                    'previous_remaining': prev['refresh'].get('remaining_stale') if prev else None},
        'feedback': {'source': src, 'attested_none': False, 'items': items},
        'closed': False, 'closed_by': None, 'closed_at': None,
    }
    f.write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'✓ {f} 개설 — 갱신 대상 {len(stale)}개, 피드백 {len(items)}건({src})')
    return 0


def problems(m, ref, require_closed):
    led = load(m)
    if led is None:
        return [f'{m} 장부 없음 — `python3 tools/gov_sp_monthly_review.py open --month {m}` 필요']
    errs = []
    fb = led['feedback']
    for it in fb['items']:
        if not it.get('gov'):
            continue
        d = it.get('disposition')
        if d not in DISPOSITIONS:
            errs.append(f"피드백 {it['id']} 처리 결정 없음(applied/rejected/deferred)")
        elif d == 'applied' and not it.get('ref'):
            errs.append(f"피드백 {it['id']} applied 인데 ref(PR/커밋) 없음")
        elif d in ('rejected', 'deferred') and not (it.get('note') or '').strip():
            errs.append(f"피드백 {it['id']} {d} 인데 사유(note) 없음")
    if fb['source'] == 'unavailable' and not fb.get('attested_none') and not fb['items']:
        errs.append('피드백 원천 조회 불가 — 사람이 직접 취합해 items를 채우거나 attested_none=true 로 확인해야 함')
    rf = led['refresh']
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent)); import sp_update_log
        fbc = sp_update_log.pb_new_feedback_counts()
    except Exception:
        fbc = None
    actual = len(stale_list(ref, fbc))
    if rf.get('remaining_stale') is None:
        errs.append('refresh.remaining_stale 미기록')
    else:
        if rf['remaining_stale'] != actual and require_closed:
            errs.append(f"refresh.remaining_stale({rf['remaining_stale']}) ≠ 실제 갱신 필요 SP 수({actual}) — 마지막 확인일 반영 후 다시 기록")
        prevr = rf.get('previous_remaining')
        if prevr is not None and actual > prevr:
            errs.append(f'갱신 필요 SP가 지난달({prevr})보다 늘었음({actual}) — 갱신이 후퇴함')
        if actual > 0 and not (rf.get('note') or '').strip():
            errs.append('갱신하지 못한 SP가 남았으면 refresh.note 에 계획·사유 기록')
    if require_closed and not led.get('closed'):
        errs.append('장부 미종결(closed=false)')
    return errs


def cmd_check(m, pr_gate=False):
    t = today()
    cur = f'{t.year}-{t.month:02d}'
    m = m or cur
    deadline = date(int(m[:4]), int(m[5:]), DEADLINE_DAY)
    _led = load(m)
    if _led and _led.get('deadline'):          # 최초 주기 등 예외 마감은 장부에 명시
        deadline = date.fromisoformat(_led['deadline'])
    overdue = t > deadline
    if m != cur and not overdue:
        overdue = True
    errs = problems(m, t, require_closed=overdue)
    # 지난달 장부도 마감을 넘겼으면 종결돼야 한다(이월 방지)
    if m == cur:
        pm = prev_month(m)
        if load(pm) is not None:
            e2 = problems(pm, t, require_closed=True) if not load(pm).get('closed') else []
            errs += [f'[{pm}] {e}' for e in e2]
    label = '마감 경과' if overdue else f'마감 {deadline} 이내(경고만)'
    if errs and overdue:
        print(f'✗ {m} 월간 검토 미충족({label}):'); [print('  -', e) for e in errs]
        return 1
    if errs:
        print(f'△ {m} 월간 검토 진행 중({label}):'); [print('  -', e) for e in errs]
    else:
        print(f'✓ {m} 월간 검토 충족')
    return 0


def cmd_close(m, by):
    t = today(); m = m or f'{t.year}-{t.month:02d}'
    errs = problems(m, t, require_closed=False)
    if errs:
        print('종결 불가:'); [print('  -', e) for e in errs]; return 1
    led = load(m); led['closed'] = True; led['closed_by'] = by; led['closed_at'] = t.isoformat()
    (DIR / f'{m}.json').write_text(json.dumps(led, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'✓ {m} 종결 — {by}'); return 0


def main(a):
    if not a or a[0] not in ('open', 'check', 'close'):
        print(__doc__); return 2
    m = a[a.index('--month') + 1] if '--month' in a else None
    if a[0] == 'open':
        t = today(); return cmd_open(m or f'{t.year}-{t.month:02d}')
    if a[0] == 'check':
        return cmd_check(m, '--pr-gate' in a)
    return cmd_close(m, a[a.index('--by') + 1] if '--by' in a else 'unknown')


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
