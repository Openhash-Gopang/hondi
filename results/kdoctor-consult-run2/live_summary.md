# K-Doctor 협진 호출 라이브 스모크

전체 10건 — PASS 1 / FAIL 9 / ERROR 0 (10.0%)

| 구분 | 건수 | PASS | FAIL | ERROR | 통과율 |
|---|---|---|---|---|---|
| doctor/consult | 10 | 1 | 9 | 0 | 10.0% |

협진 기대 건당 평균 호출 과목 수: 1.8
총괄 호출 43회 중 출력 한도로 잘린 호출(finish_reason=length): 30회

## 실패 사유

- no_report_no_tag: 4건
- no_report_truncated: 4건
- no_report_invalid: 1건

## 실패 목록

| id | 기대 | 실제 호출 | 사유 |
|---|---|---|---|
| kdoc-doctor-01 | cardiology | cardiology,emergency | no_report_no_tag |
| kdoc-doctor-03 | pulmonology | pulmonology,thoracic-surgery | no_report_truncated |
| kdoc-doctor-04 | gastroenterology | gastroenterology,emergency | no_report_no_tag |
| kdoc-doctor-05 | gastroenterology | gastroenterology | no_report_invalid |
| kdoc-doctor-06 | endocrinology | endocrinology | no_report_no_tag |
| kdoc-doctor-07 | endocrinology | endocrinology | no_report_no_tag |
| kdoc-doctor-08 | nephrology | nephrology,endocrinology | no_report_truncated |
| kdoc-doctor-09 | hematology-oncology | hematology-oncology,tuberculosis | no_report_truncated |
| kdoc-doctor-10 | infectious-disease | infectious-disease,hematology-oncology | no_report_truncated |
