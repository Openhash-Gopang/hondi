# K-Doctor 협진 호출 라이브 스모크

전체 100건 — PASS 97 / FAIL 3 / ERROR 0 (97.0%)

| 구분 | 건수 | PASS | FAIL | ERROR | 통과율 |
|---|---|---|---|---|---|
| doctor/consult | 44 | 44 | 0 | 0 | 100.0% |
| doctor/emergency | 6 | 6 | 0 | 0 | 100.0% |
| patient/consult | 44 | 41 | 3 | 0 | 93.2% |
| patient/emergency | 6 | 6 | 0 | 0 | 100.0% |

## 독립 검수 (K-Doctor-Check)

검수 93건 — 재검토 불요 32 / 재검토 권고 54 / 결론 무효 소지 6 / 판정 파싱 실패 1 / 호출 오류 0
재조정 반영 60건, 재조정 실패(원 보고서 유지) 0건
모듈별 지적 수: C-5=9, C-2=81, C-1=79, C-4=26, C-6=35, C-3=5

협진 기대 건당 평균 호출 과목 수: 1.8
총괄 호출 294회 중 출력 한도로 잘린 호출(finish_reason=length): 0회

## 실패 사유

- no_consult: 1건
- no_report_no_tag: 1건
- wrong_specialty: 1건

## 대체 허용(accept_ids)으로만 통과 — 사람 검토

kdoc-doctor-33, kdoc-doctor-38, kdoc-patient-16, kdoc-patient-25, kdoc-patient-26, kdoc-patient-27

## 실패 목록

| id | 기대 | 실제 호출 | 사유 |
|---|---|---|---|
| kdoc-patient-33 | pulmonology | - | no_consult |
| kdoc-patient-34 | rehabilitation | rehabilitation,neurology | no_report_no_tag |
| kdoc-patient-37 | family | cardiology,endocrinology | wrong_specialty |
