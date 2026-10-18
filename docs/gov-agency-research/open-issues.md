# 열린 문제 — 행정기관 페이지 조사 (2026-10-19 기준)

조사 중 발견했으나 조사자가 임의로 정하지 않고 담당자 확인이 필요한 항목. 해결되면 줄을 지우지 말고 "해결" 표시와 날짜를 남긴다.

| # | 문제 | 발견 경위 | 확인할 곳 |
|---|---|---|---|
| 1 | `jejusi:property_tax_correction_request`(재산세·자동차세 부과 정정신청)가 "제주시청 기획조정실 세무과"로 등록돼 있다. 기관 색인에는 그 이름이 없고, 세무과 SP 는 재산세 부과를 재산세과 소관이라고 적는다 | `tools/extract-gov-tasks.cjs` 미연결 41건 점검 | worker.js 의 agency_name 을 재산세과로 고칠지(또는 세무과 SP 와 맞출지) |
| 2 | 제주시 건축과 SP 는 접수 task `occupancy_inspection`(사용승인)을 선언하는데 서버 레지스트리에는 `seogwipo:occupancy_inspection` 만 있고 `jejusi:occupancy_inspection` 이 없다 | `tools/extract-gov-sp.cjs` 교차 점검 | 제주시 사용승인 필수 서류 등록 여부 |
| 3 | 도시건설국 6개 SP(건축·도시계획·건설·주택·도시재생·상하수도)는 사무분장 원문을 직접 확인하지 못한 잠정 초안이다(SP §6) | SP 본문 | 제주시 사무분장 조례 시행규칙 별표(법령 원문)로 대조 |
| 4 | 저장소에 SP 파일이 없는 기관 25곳(제주 세부과 등, `GOV_AGENCY_VERBOSE=1 node tools/build-gov-agencies.cjs`)과 SP 자체가 없는 읍·면·동 86곳 | 색인 생성 | SP 신설 여부 |
| 5 | 서버 task 29개가 기관 색인에 연결되지 않는다(3회차에 41 → 29: SP가 task_key 를 직접 선언하고 서버 부서 지정과 모순 없는 12건을 `TASK_AGENCY_OVERRIDE` 에 연결). 남은 것: 도서관·체육시설·공연장·휴양림·폐기물, 제주도청 실·국, 공공기관·센터 등 SP가 task_key 를 선언하지 않는 기관 | `tools/extract-gov-tasks.cjs` | 해당 기관 SP 에 task_key 선언을 추가하거나, 담당자가 연결을 확인해 `TASK_AGENCY_OVERRIDE` 에 추가 |
| 6 | 제주 단층제에서 도세 신고서·이의신청서를 내는 실제 창구(행정시 세무과 경유 여부). 서식 원문은 특별자치도세는 특별자치도지사에게 제출하도록 안내 | 세무과 시범 | 제주시청 세무과에 직접 확인 |
| 7 | 지방세법 시행규칙 제9조의 2026.7.1. 시행본 본문, 지방세기본법 제88조·제90조·제91조 조문 본문 | 세무과 시범 | 법제처 Open API 로 조문 본문 대조(인증키 필요) |
| 8 | 소방시설 완공검사(`jejufire:fire_facility_completion_inspection`)는 SP(소방안전본부, `SP-AGY-FIRE`)가 자기 접수 업무로 선언하는데, 서버 부서 알림 지정(`AGENCY_TO_DEPT_TARGET`)은 `do-dept:safety`(도민안전건강실)이다 | 3회차 task 교차 확인 | 알림이 소방안전본부가 아닌 도민안전건강실로 가는 것이 의도인지 |
| 9 | 한라산 특별출입허가(`jeju:hallasan_special_entry_permit`)는 SP 후보가 둘(`SP-AGY-HERITAGE` 본부, `SP-AGYDIV-HERITAGE-MANAGEMENT` 유산관리과)이고 등록 기관명은 「한라산국립공원관리소」(색인에 없음)라 연결하지 않았다 | 3회차 task 교차 확인 | 실제 접수 부서 |
| 10 | 서귀포 기초생활보장 급여 신청(`seogwipo:basic_livelihood_benefit_application`)의 기관명 「서귀포시청 복지위생국 기초생활보장과」가 색인에 없고, 서귀포 SP 중 task_key 를 언급하는 것은 주민복지과(`SP-CITYDIV-SEOGWIPO-WELFARE-RESIDENT`)뿐이라 연결하지 않았다 | 3회차 task 교차 확인 | 서귀포시 기초생활보장 업무가 어느 과 소관인지 |
