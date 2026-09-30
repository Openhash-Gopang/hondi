# K-Doctor 협진 호출 라이브 스모크

전체 10건 — PASS 9 / FAIL 1 / ERROR 0 (90.0%)

| 구분 | 건수 | PASS | FAIL | ERROR | 통과율 |
|---|---|---|---|---|---|
| doctor/consult | 10 | 9 | 1 | 0 | 90.0% |

협진 기대 건당 평균 호출 과목 수: 2
총괄 호출 29회 중 출력 한도로 잘린 호출(finish_reason=length): 0회

## 실패 사유

- no_report_invalid: 1건

## 실패 목록

| id | 기대 | 실제 호출 | 사유 |
|---|---|---|---|
| kdoc-doctor-02 | cardiology | cardiology,emergency | no_report_invalid |
