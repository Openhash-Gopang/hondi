#!/usr/bin/env python3
"""
check_routing_regression_threshold.py — 라우팅 회귀 게이트 (2026-08-06 신설)

배경: live_smoketest.py는 항상 exit 0으로 끝난다(결과가 몇 건 실패하든
러너 자체는 정상 종료로 취급) — 그래서 지금까지 이 스모크테스트는
workflow_dispatch(수동)로만 쓰였고, AC-PRO-CORE·gwp-registry.js·
expert-registry.js를 고쳐도 "이 변경이 실제로 더 정확하게 라우팅하는가"를
아무도 자동으로 검증하지 않았다 — 반면 check-stale-refs.yml 등 정적
정합성 검사는 이미 push마다 자동 실행되고 있어, 구조적 정합성과 실제
라우팅 정확도 사이에 검증 수준 격차가 있었다.

이 스크립트는 live_smoketest.py가 만든 live_results.json(요약본인
live_summary.json이 아니라 시나리오별 static_verdict까지 담긴 원본)을
읽어 PASS율을 계산하고, 임계치 밑이면 nonzero exit으로 CI를 실패시킨다.

## 왜 summary.json이 아니라 results.json인가 — static_verdict=WARN 분리
이 저장소의 스모크 시나리오 배치들은 각 시나리오에 static_verdict
(PASS/WARN/N/A)를 붙이는 관례가 있다 — WARN은 "만든 사람 스스로도 정답에
확신이 낮다"고 미리 밝혀둔 항목이다(실사로 확인해보니 실제로 이 배치들의
WARN 항목 중 일부는 애초에 정답 자체가 틀렸던 사례였다 — 2026-08-06
gwp_priority #2/paraphrase_hard #1 재정정 참고). 이런 항목까지 엄격한
PASS/FAIL 판정에 넣으면, 모델이 더 정확하게 응답할수록 오히려 CI가
실패하는 역설이 생긴다. 그래서 이 게이트는 **static_verdict=PASS인
시나리오만** 엄격 판정 대상으로 삼고, WARN은 정보 제공용으로만 별도
출력한다(통과/실패 판정에 영향 없음) — CI 실패 임계치를 낮게 잡아도
모델 스스로 애매하다고 인정한 영역까지 억지로 100% 맞히라고 강요하지
않기 위함이다.

LIVE-CLARIFY는 분모에서 제외한다 — §CORE의 확신도 기반 되묻기 규칙
(2026-08-01)상 "애매하면 되묻는다"는 그 자체로 정답 처리 대상이지 실패가
아니기 때문이다(silently guessing보다 안전한 선택이므로 이걸 벌점
처리하면 "차라리 확신 있게 찍는" 나쁜 유인을 만든다). LIVE-ERROR(API
호출 자체 실패)도 라우팅 정확도와 무관하므로 제외한다.
"""
import argparse
import json
import sys
from collections import Counter

# 2026-09-30 추가 — DeepSeek는 temperature=0으로 호출해도(live_smoketest.py
# 참고) MoE(전문가 혼합) 구조상 배치 구성에 따라 완전한 결정론이 보장되지
# 않는다는 게 실사로 확인됐다(같은 프롬프트·같은 배치를 재실행했더니 서로
# 다른 5건이 새로 실패/통과함, #1/#8/#15/#22/#29). 단일 실행의 PASS율은
# 그래서 "이 변경이 실제로 더 나쁘게 만들었는가"를 판단하는 근거로 쓰기엔
# 노이즈가 크다 — --results에 여러 실행의 live_results.json을 넘기면 전부
# 합쳐서(같은 시나리오 번호가 여러 번 나와도 그대로 각각의 독립 시행으로
# 취급) 하나의 분모로 판정한다. 반복 실행 자체는 이 스크립트가 하지 않고
# (비용은 호출하는 쪽 책임), 이미 만들어진 결과 파일 여러 개를 합산하는
# 것만 담당한다.


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", required=True, nargs="+",
                     help="path(s) to live_results.json (per-scenario, has static_verdict). "
                          "여러 개 넘기면 반복 실행 결과를 합쳐서 판정한다(DeepSeek MoE "
                          "non-determinism 완화).")
    ap.add_argument("--threshold", type=float, default=0.80,
                     help="minimum PASS/(PASS+FAIL) ratio among static_verdict=PASS entries, default 0.80")
    ap.add_argument("--label", default="", help="display label for this batch")
    args = ap.parse_args()

    results = []
    for path in args.results:
        with open(path, "r", encoding="utf-8") as f:
            results.extend(json.load(f))

    label = args.label or "(unnamed batch)"
    if len(args.results) > 1:
        label = f"{label}, {len(args.results)}회 반복 합산"

    strict = [r for r in results if r.get("static_verdict") == "PASS"]
    informational = [r for r in results if r.get("static_verdict") != "PASS"]

    strict_counts = Counter(r["live_verdict"] for r in strict)
    passed = strict_counts.get("LIVE-PASS", 0)
    failed = strict_counts.get("LIVE-FAIL", 0)
    clarify = strict_counts.get("LIVE-CLARIFY", 0)
    error = strict_counts.get("LIVE-ERROR", 0)

    denom = passed + failed
    ratio = (passed / denom) if denom > 0 else 1.0

    print(f"[{label}] 엄격판정 대상(static_verdict=PASS)={len(strict)}/{len(results)} — "
          f"PASS={passed} FAIL={failed} CLARIFY={clarify}(제외) ERROR={error}(제외) "
          f"PASS율={ratio:.1%} (분모={denom}, 임계치={args.threshold:.0%})")

    if informational:
        info_counts = Counter(r["live_verdict"] for r in informational)
        print(f"  ℹ️  정보용(static_verdict≠PASS, 판정 미반영)={len(informational)}건: "
              f"{dict(info_counts)}")
        for r in informational:
            if r["live_verdict"] == "LIVE-FAIL":
                print(f"     - #{r['no']} (WARN으로 표시된 항목이 FAIL — 정답 재검토 후보): "
                      f"{r['utterance'][:40]}")

    if denom == 0:
        print(f"  경고: 엄격판정 대상 중 PASS/FAIL이 0건 — 전부 CLARIFY/ERROR였을 가능성, 수동 확인 필요")
        return 0

    if ratio < args.threshold:
        print(f"  ❌ FAIL — PASS율 {ratio:.1%}이 임계치 {args.threshold:.0%} 미만")
        for r in strict:
            if r["live_verdict"] == "LIVE-FAIL":
                print(f"     - #{r['no']}: {r['utterance'][:50]} "
                      f"(기대 [{r['expected_type']}:{r['expected_id']}])")
        return 1

    print(f"  ✅ PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

