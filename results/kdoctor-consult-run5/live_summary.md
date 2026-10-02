# K-Doctor 협진 호출 라이브 스모크

전체 100건 — PASS 88 / FAIL 12 / ERROR 0 (88.0%)

| 구분 | 건수 | PASS | FAIL | ERROR | 통과율 |
|---|---|---|---|---|---|
| doctor/consult | 44 | 43 | 1 | 0 | 97.7% |
| doctor/emergency | 6 | 6 | 0 | 0 | 100.0% |
| patient/consult | 44 | 34 | 10 | 0 | 77.3% |
| patient/emergency | 6 | 5 | 1 | 0 | 83.3% |

협진 기대 건당 평균 호출 과목 수: 1.66
총괄 호출 244회 중 출력 한도로 잘린 호출(finish_reason=length): 0회

## 실패 사유

- no_consult: 9건
- no_report: 1건
- no_report_no_tag: 1건
- consult_in_emergency: 1건

## 대체 허용(accept_ids)으로만 통과 — 사람 검토

kdoc-doctor-23, kdoc-doctor-41, kdoc-patient-25, kdoc-patient-27, kdoc-patient-40

## 실패 목록

| id | 기대 | 실제 호출 | 사유 |
|---|---|---|---|
| kdoc-doctor-40 | neonatology | - | no_consult |
| kdoc-patient-02 | cardiology | cardiology,emergency | no_report |
| kdoc-patient-19 | dermatology | - | no_consult |
| kdoc-patient-20 | dermatology | - | no_consult |
| kdoc-patient-24 | surgery | - | no_consult |
| kdoc-patient-26 | plastic-surgery | - | no_consult |
| kdoc-patient-34 | rehabilitation | - | no_consult |
| kdoc-patient-35 | occupational-environmental | - | no_consult |
| kdoc-patient-36 | preventive-medicine | - | no_consult |
| kdoc-patient-41 | pediatric-gastro-nutrition | pediatric-gastro-nutrition,pediatric-infectious | no_report_no_tag |
| kdoc-patient-44 | pediatric-cardiology | - | no_consult |
| kdoc-patient-47 | 응급(협진 없음) | - | consult_in_emergency |
