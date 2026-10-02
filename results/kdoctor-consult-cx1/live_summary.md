# K-Doctor 협진 호출 라이브 스모크

전체 24건 — PASS 22 / FAIL 2 / ERROR 0 (91.7%)

| 구분 | 건수 | PASS | FAIL | ERROR | 통과율 |
|---|---|---|---|---|---|
| patient/consult | 10 | 9 | 1 | 0 | 90.0% |
| patient/emergency | 2 | 1 | 1 | 0 | 50.0% |
| doctor/consult | 10 | 10 | 0 | 0 | 100.0% |
| doctor/emergency | 2 | 2 | 0 | 0 | 100.0% |

## 독립 검수 (K-Doctor-Check)

검수 24건 — 재검토 불요 12 / 재검토 권고 11 / 결론 무효 소지 1 / 판정 파싱 실패 0 / 호출 오류 0
재조정 반영 12건, 재조정 실패(원 보고서 유지) 0건
모듈별 지적 수: C-2=26, C-6=11, C-3=1, C-4=7, C-1=19, C-5=1

복합 사례 맥락 반영: 평균 98% (맥락 누락 0건)

협진 기대 건당 평균 호출 과목 수: 2.35
총괄 호출 69회 중 출력 한도로 잘린 호출(finish_reason=length): 0회

## 실패 사유

- too_few_specialties: 1건
- consult_in_emergency: 1건

## 대체 허용(accept_ids)으로만 통과 — 사람 검토

kdoc-cx-patient-09

## 실패 목록

| id | 기대 | 실제 호출 | 사유 |
|---|---|---|---|
| kdoc-cx-patient-07 | obstetrics-gynecology,hematology-oncology | obstetrics-gynecology | too_few_specialties |
| kdoc-cx-patient-11 | 응급(협진 없음) | rheumatology,neurology | consult_in_emergency |
