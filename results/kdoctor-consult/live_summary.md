# K-Doctor 협진 호출 라이브 스모크

전체 10건 — PASS 3 / FAIL 7 / ERROR 0 (30.0%)

| 구분 | 건수 | PASS | FAIL | ERROR | 통과율 |
|---|---|---|---|---|---|
| doctor/consult | 10 | 3 | 7 | 0 | 30.0% |

협진 기대 건당 평균 호출 과목 수: 1.6

## 실패 사유

- no_consult: 1건
- no_report: 6건

## 실패 목록

| id | 기대 | 실제 호출 | 사유 |
|---|---|---|---|
| kdoc-doctor-02 | cardiology | - | no_consult |
| kdoc-doctor-03 | pulmonology | pulmonology,hematology-oncology | no_report |
| kdoc-doctor-04 | gastroenterology | gastroenterology,hematology-oncology | no_report |
| kdoc-doctor-05 | gastroenterology | gastroenterology | no_report |
| kdoc-doctor-06 | endocrinology | endocrinology | no_report |
| kdoc-doctor-07 | endocrinology | endocrinology | no_report |
| kdoc-doctor-10 | infectious-disease | infectious-disease,hematology-oncology | no_report |
