# K-Doctor 복합 사례 라운드 (2026-10-03)

기존 100건은 "한 증상 → 한 과목 협진" 연결을 본다. 이 라운드는 **증상 + 가족력 + 과거 병력 + 복용 약물·처치 경과**가 한 사례에 함께 들어 있을 때, 총괄이 (1) 둘 이상의 과목을 부르는지, (2) 맥락을 보고서에 반영하는지, (3) 응급 신호를 놓치지 않는지를 본다.

## 구성
`tests/live_smoketest/scenarios_kdoctor_complex_20261003.json` — 24건(의사 12·환자 12). 이 중 4건은 응급(거대세포동맥염 시력 소실, 와파린 복용 중 두부 외상, 수술 후 폐색전증, 당뇨병성 케톤산증)이며 협진 없이 119/109 안내가 나와야 한다. 의사 사례는 자문 요청을 명시한다. 모든 사례는 합성이며 의학적 조언이 아니다.

## 채점 (기본 채점 통과 후 추가 3단계)
| 순서 | 조건 | 실패 사유 |
|---|---|---|
| 1 | 호출된 서로 다른 과목 수(기대·허용 집합 내) ≥ `min_hits` (비응급 2) | `too_few_specialties` |
| 2 | 최종 보고서 `triage.level` ∈ `triage_any` | `triage_mismatch` |
| 3 | `facts` 4개 중 `facts_min`(3)개 이상이 최종 보고서 JSON에 등장 | `context_gap` |

통과하면 `complex_ok`이며 `context`{total,hits,need,missing}가 사례 파일에 남는다. 요약에는 `complex_context`(평균 반영률, 누락 사례)가 추가된다.

## 한계
- 맥락 반영은 **키워드 대리 지표**다. 용어를 바꿔 쓰면 놓치고(거짓 누락), 단어만 나열해도 잡힌다(거짓 반영). 실패 사례는 사람이 `cases/<id>.json`으로 확인한다.
- 24건은 통계적 결론이 아니라 약점 탐색용이다.
- 이 라운드 점수를 100건 라운드(R1~R6)와 직접 비교하지 않는다.

## 실행
```
gh workflow run live-smoketest-kdoctor-consult.yml --ref main -f scenarios=scenarios_kdoctor_complex_20261003.json -f label=cx1
```
결과: `results/live-smoketest-kdoctor-consult-cx1` 브랜치.
