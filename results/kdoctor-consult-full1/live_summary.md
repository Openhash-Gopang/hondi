# K-Doctor 협진 호출 라이브 스모크

전체 100건 — PASS 87 / FAIL 13 / ERROR 0 (87.0%)

| 구분 | 건수 | PASS | FAIL | ERROR | 통과율 |
|---|---|---|---|---|---|
| doctor/consult | 44 | 38 | 6 | 0 | 86.4% |
| doctor/emergency | 6 | 2 | 4 | 0 | 33.3% |
| patient/consult | 44 | 41 | 3 | 0 | 93.2% |
| patient/emergency | 6 | 6 | 0 | 0 | 100.0% |

협진 기대 건당 평균 호출 과목 수: 1.92
총괄 호출 278회 중 출력 한도로 잘린 호출(finish_reason=length): 0회

## 실패 사유

- no_consult: 6건
- no_report_unclosed: 1건
- no_report_invalid: 2건
- consult_in_emergency: 4건

## 대체 허용(accept_ids)으로만 통과 — 사람 검토

kdoc-doctor-37, kdoc-patient-25, kdoc-patient-27, kdoc-patient-40

## 실패 목록

| id | 기대 | 실제 호출 | 사유 |
|---|---|---|---|
| kdoc-doctor-11 | allergy | - | no_consult |
| kdoc-doctor-24 | anesthesiology-pain | - | no_consult |
| kdoc-doctor-30 | radiation-oncology | radiation-oncology,hematology-oncology,gastroenterology | no_report_unclosed |
| kdoc-doctor-32 | laboratory-medicine | - | no_consult |
| kdoc-doctor-33 | tuberculosis | pulmonology,tuberculosis,radiology | no_report_invalid |
| kdoc-doctor-35 | nuclear-medicine | - | no_consult |
| kdoc-doctor-45 | 응급(협진 없음) | cardiology | consult_in_emergency |
| kdoc-doctor-47 | 응급(협진 없음) | pediatric-infectious | consult_in_emergency |
| kdoc-doctor-48 | 응급(협진 없음) | obstetrics-gynecology | consult_in_emergency |
| kdoc-doctor-49 | 응급(협진 없음) | allergy | consult_in_emergency |
| kdoc-patient-02 | cardiology | - | no_consult |
| kdoc-patient-36 | preventive-medicine | - | no_consult |
| kdoc-patient-37 | family | internal,cardiology,neurology | no_report_invalid |
