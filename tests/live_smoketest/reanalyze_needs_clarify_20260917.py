# -*- coding: utf-8 -*-
"""
tests/live_smoketest/reanalyze_needs_clarify_20260917.py
-----------------------------------------------------------
이미 실행된 live_results.jsonl(비용을 다시 쓰지 않음)을 다시 읽어, 두 가지를
새로 채점한다:

1. **루트 태그 재계산(leaf 전용, 버그 수정)** — gen_scenarios_full_routing_
   20260917.py의 leaf expect_tag가 원래 "직계 parentKey"를 썼는데, professor
   계열처럼 중계열(예: professor-korean의 parentKey=professor-language-
   literature)이 끼어 있으면 AC 1단계 응답은 그 중계열이 아니라 최상위
   루트("professor")만 낸다 — 그래서 대부분의 "다른 곳으로 샘: [EXPERT:
   professor]"가 실은 정답인데 오답으로 채점됐다. 이 스크립트는
   scenarios_*.json(수정판, resolve_root_id 적용됨)을 다시 읽어 올바른
   루트 기준으로 raw_response를 재채점한다.

2. **"되물었는가" 판정(2026-09-17 주피터 지시)** — 목적지가 A로 갔는지 B로
   갔는지가 아니라, 애초에 애매한 상황에서 AC가 사용자에게 재차 의도를
   확인했는지가 진짜 결함 판단 기준이라는 지적을 반영한다. raw_response에
   물음표로 끝나는 문장, 또는 "~인가요/~신가요/~이신가요/~일까요/어느 쪽"
   같은 선택형 되묻기 패턴이 있으면 CLARIFY로 표시한다. 정규식 기반
   휴리스틱이라 완벽하지 않다 — NEEDS-REVIEW 항목은 여전히 사람이 원문을
   직접 읽어야 한다.

## 최종 판정 4가지
- ROOT-PASS: (재계산한) 루트 태그가 정확히 일치
- CLARIFIED: 태그는 다른 곳으로 샜지만(또는 없지만) 되묻기 패턴이 응답에
  있음 — "확신이 없어서 물어봤다"는 뜻이므로 결함이 아니라 정상 동작일
  가능성이 높다
- OVERCONFIDENT-MISROUTE: 되묻지도 않고 다른 태그로 확신에 차서 가버림 —
  **이게 진짜 결함 후보**(주피터가 지적한 핵심 문제)
- OVERCONFIDENT-SILENT: 되묻지도 않고 태그도 안 냄(응답이 애매하게 끝남) —
  마찬가지로 결함 후보

## 사용법
    python3 reanalyze_needs_clarify_20260917.py \\
        --scenarios scenarios_full_routing_20260917_expert-leaf.json \\
        --results ../../results/routing-full/expert-leaf/live_results.jsonl \\
        --out ../../results/routing-full/expert-leaf/reanalyzed.jsonl

    (kservice/expert-top 결과에도 동일하게 --scenarios만 바꿔서 실행 가능.
     이 둘은 leaf가 아니라 루트 재계산 자체는 원래도 안 바뀌지만, "되물었는가"
     재채점은 똑같이 유의미하다.)
"""
import argparse
import json
import re

CLARIFY_PATTERNS = [
    r'[?？]\s*$',                     # 물음표로 끝남
    r'(이신가요|이신지요|일까요|이실까요)[\.\?]?\s*$',
    r'(어느\s*(쪽|분야|과)|어떤\s*(쪽|분야|과))',
    r'말씀해\s*주시겠어요',
    r'맞으신가요|맞을까요',
    r'원하시는\s*게|원하시나요',
]
CLARIFY_RE = re.compile('|'.join(CLARIFY_PATTERNS))

def is_clarifying(raw_text):
    if not raw_text:
        return False
    # 응답을 줄 단위로 봐서, 마지막 비어있지 않은 줄이 되묻기 패턴인지
    # 확인한다(응답 중간에 예시로 물음표가 섞여 있는 경우를 배제하기 위함).
    lines = [l.strip() for l in raw_text.strip().split('\n') if l.strip()]
    if not lines:
        return False
    tail = ' '.join(lines[-2:])  # 마지막 1~2줄만 본다
    return bool(CLARIFY_RE.search(tail))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--scenarios', required=True)
    ap.add_argument('--results', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()

    with open(args.scenarios, encoding='utf-8') as f:
        scenarios = {s['id']: s for s in json.load(f)}

    reanalyzed = []
    with open(args.results, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            sid = r['id']
            fresh_expect = scenarios.get(sid, {}).get('expect_tag', r.get('expect_tag'))
            raw = r.get('raw_response') or ''
            root_pass = bool(fresh_expect) and fresh_expect in raw
            clarified = is_clarifying(raw)

            if root_pass:
                verdict = 'ROOT-PASS'
            elif clarified:
                verdict = 'CLARIFIED'
            elif raw.strip():
                verdict = 'OVERCONFIDENT-MISROUTE'
            else:
                verdict = 'OVERCONFIDENT-SILENT'

            reanalyzed.append({
                **r,
                'expect_tag_original': r.get('expect_tag'),
                'expect_tag_recomputed': fresh_expect,
                'reanalyzed_verdict': verdict,
            })

    with open(args.out, 'w', encoding='utf-8') as f:
        for r in reanalyzed:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')

    from collections import Counter
    c = Counter(r['reanalyzed_verdict'] for r in reanalyzed)
    total = len(reanalyzed)
    print(f'총 {total}건 재채점 -> {args.out}')
    for verdict, cnt in c.most_common():
        print(f'  {verdict:24s} {cnt:4d}건 ({cnt/total*100:.1f}%)')

    real_bugs = [r for r in reanalyzed if r['reanalyzed_verdict'].startswith('OVERCONFIDENT')]
    if real_bugs:
        print(f'\n=== 진짜 결함 후보(OVERCONFIDENT-*) {len(real_bugs)}건 — id만 나열 ===')
        for r in real_bugs:
            print(f"  - {r['id']} ({r.get('target_id')})")

if __name__ == '__main__':
    main()
