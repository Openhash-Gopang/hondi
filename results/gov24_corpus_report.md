# 정부24 코퍼스 라우팅 결과 대조표

총 100건 — NEEDS-ATTENTION 0 / REVIEW 100

## 🟡 REVIEW (자동 판정 없음 — note와 trace/agency를 직접 대조)

| id | 배치 | 발화 | 기대 소관기관(정부24) | 실제 resolved agency | trace |
|---|---|---|---|---|---|
| gov24-b1-035 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 운전경력증명 발급받고 싶어요 | 경찰청 | gov_national | JEJU-GOV-COMMON > JEJU-NATIONAL-SP > SP-NAT-POLICE > (LLM 분류 폴백) |
| gov24-b1-049 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 교통 범칙금 과태료 미납 내역 조회하고 싶어요 | 경찰청 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-AGY-POLICE > SP-AGYDIV-POLICE-TRAFFIC(과 특정) |
| gov24-b2-001 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 성매매 신고 방법 관련해서 어떻게 해야 하나요 | 경찰청 | gov_national | JEJU-GOV-COMMON > JEJU-NATIONAL-SP > SP-NAT-POLICE > (LLM 분류 폴백) |
| gov24-b2-019 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 영문 운전경력증명 발급받고 싶어요 | 경찰청 | gov_national | JEJU-GOV-COMMON > JEJU-NATIONAL-SP > SP-NAT-POLICE > (LLM 분류 폴백) |
| gov24-b2-036 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 운전면허 정보 관련해서 어떻게 해야 하나요 | 경찰청 | gov_national | JEJU-GOV-COMMON > JEJU-NATIONAL-SP > SP-NAT-POLICE > (LLM 분류 폴백) |
| gov24-b2-037 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 착한운전마일리지 신청하고 싶어요 | 경찰청 | gov_national | JEJU-GOV-COMMON > JEJU-NATIONAL-SP > SP-NAT-POLICE > (LLM 분류 폴백) |
| gov24-b2-012 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 통신판매업신고-시.군.구 관련해서 어떻게 해야 하나요 | 공정거래위원회 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-CITYDEPT-jejusi-econ > (규칙 F 일반화 — 시청 국 소관 사무라 읍면동 생략) |
| gov24-b2-002 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 건강보험료 납부확인서 관련해서 어떻게 해야 하나요 | 공통 | gov_national | JEJU-GOV-COMMON > JEJU-NATIONAL-SP > SP-NAT-NHIS |
| gov24-b1-016 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 학교생활기록부 발급받고 싶어요 | 교육부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-DO-CULTURE > (LLM 분류 폴백) |
| gov24-b1-020 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 대학 졸업증명서 신청하고 싶어요 | 교육부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-EMD-애월읍 > (1단계 힌트 전용 매칭 폴백 — EMD가 위치 힌트로만 잡혀 2~5단계에 더 구체적인 매칭 기회를 먼저 줬으나 실패) |
| gov24-b1-034 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 유치원 및 초중등학교 졸업증명서 발급받고 싶어요 | 교육부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-EMD-애월읍 > (1단계 힌트 전용 매칭 폴백 — EMD가 위치 힌트로만 잡혀 2~5단계에 더 구체적인 매칭 기회를 먼저 줬으나 실패) |
| gov24-b1-041 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 대학 성적증명서 신청하고 싶어요 | 교육부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-EMD-애월읍 > (1단계 힌트 전용 매칭 폴백 — EMD가 위치 힌트로만 잡혀 2~5단계에 더 구체적인 매칭 기회를 먼저 줬으나 실패) |
| gov24-b1-042 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 보육교직원 경력 증명서 관련해서 어떻게 해야 하나요 | 교육부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-DO-WELFARE |
| gov24-b1-043 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 대학 졸업예정증명서 신청하고 싶어요 | 교육부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-EMD-애월읍 > (1단계 힌트 전용 매칭 폴백 — EMD가 위치 힌트로만 잡혀 2~5단계에 더 구체적인 매칭 기회를 먼저 줬으나 실패) |
| gov24-b1-048 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 취학통지서 온라인 신청 발급받고 싶어요 | 교육부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-EMD-애월읍 > (5단계 LLM 분류도 SP-EMD-LAZY로 합의 — 1단계에서 이미 확보해둔 위치 힌트로 확정, 재질문 생략) |
| gov24-b2-010 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 학교생활기록부 발급받고 싶어요 | 교육부 | gov_national | JEJU-GOV-COMMON > JEJU-NATIONAL-SP > SP-NAT-EDUCERT |
| gov24-b2-013 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 성적증명서 중, 고 관련해서 어떻게 해야 하나요 | 교육부 | gov_national | JEJU-GOV-COMMON > JEJU-NATIONAL-SP > SP-NAT-EDUCERT |
| gov24-b2-014 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 대학 재학증명 관련해서 어떻게 해야 하나요 | 교육부 | gov_national | JEJU-GOV-COMMON > JEJU-NATIONAL-SP > SP-NAT-EDUCERT > (LLM 분류 폴백) |
| gov24-b2-024 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 유치원 및 초중등학교 재학증명서 발급받고 싶어요 | 교육부 | gov_national | JEJU-GOV-COMMON > JEJU-NATIONAL-SP > SP-NAT-EDUCERT |
| gov24-b2-032 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 유치원 및 초중등학교 졸업증명서 발급받고 싶어요 | 교육부 | gov_national | JEJU-GOV-COMMON > JEJU-NATIONAL-SP > SP-NAT-EDUCERT |
| gov24-b2-041 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 유치원 및 초중등학교 졸업예정증명서 발급받고 싶어요 | 교육부 | gov_national | JEJU-GOV-COMMON > JEJU-NATIONAL-SP > SP-NAT-EDUCERT |
| gov24-b2-048 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 교원 등 재직증명서 발급받고 싶어요 | 교육부 | gov_national | JEJU-GOV-COMMON > JEJU-NATIONAL-SP > SP-NAT-EDUCERT > (LLM 분류 폴백) |
| gov24-b1-036 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 4대 사회보험료 납부확인서 관련해서 어떻게 해야 하나요 | 국민건강보험공단 | gov_national | JEJU-GOV-COMMON > JEJU-NATIONAL-SP > SP-NAT-NHIS > (LLM 분류 폴백) |
| gov24-b1-032 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 국민연금 가입내역 관련해서 어떻게 해야 하나요 | 국민연금공단 | gov_national | JEJU-GOV-COMMON > JEJU-NATIONAL-SP > SP-NAT-NPS |
| gov24-b1-033 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 4대사회보험 가입자 가입내역 확인서 관련해서 어떻게 해야 하나요 | 국민연금공단 | gov_national | JEJU-GOV-COMMON > JEJU-NATIONAL-SP > SP-NAT-NHIS |
| gov24-b1-019 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 소득금액증명 발급받고 싶어요 | 국세청 | gov_national | JEJU-GOV-COMMON > JEJU-NATIONAL-SP > SP-NAT-STAT > (LLM 분류 폴백) |
| gov24-b1-025 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 납세증명서 발급받고 싶어요 | 국세청 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-DO-PLAN > (LLM 분류 폴백) |
| gov24-b2-005 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 사업자등록증명 발급받고 싶어요 | 국세청 | gov_national | JEJU-GOV-COMMON > JEJU-NATIONAL-SP > SP-NAT-TAX |
| gov24-b2-011 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 연말정산 간소화 서비스 이용하고 싶어요 | 국세청 | gov_national | JEJU-GOV-COMMON > JEJU-NATIONAL-SP > SP-NAT-TAX > (LLM 분류 폴백) |
| gov24-b2-018 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 부가가치세과세표준증명 발급받고 싶어요 | 국세청 | gov_national | JEJU-GOV-COMMON > JEJU-NATIONAL-SP > SP-NAT-TAX |
| gov24-b2-035 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 사실증명 관련해서 어떻게 해야 하나요 | 국세청 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-DO-GENERAL > (LLM 분류 폴백) |
| gov24-b1-001 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 토지대장등본 발급받고 싶어요 | 국토교통부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-EMD-애월읍 > (5단계 LLM 분류도 SP-EMD-LAZY로 합의 — 1단계에서 이미 확보해둔 위치 힌트로 확정, 재질문 생략) |
| gov24-b1-002 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 토지대장 열람하고 싶어요 | 국토교통부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-DO-PLAN > (LLM 분류 폴백) |
| gov24-b1-003 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 토지대장등본 발급받고 싶어요 | 국토교통부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-EMD-애월읍 > (5단계 LLM 분류도 SP-EMD-LAZY로 합의 — 1단계에서 이미 확보해둔 위치 힌트로 확정, 재질문 생략) |
| gov24-b1-004 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 토지대장 열람하고 싶어요 | 국토교통부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > (LLM 분류 폴백) |
| gov24-b1-009 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 건축물대장 관련해서 어떻게 해야 하나요 | 국토교통부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-CITYDEPT-jejusi-housing > (규칙 F 일반화 — 시청 국 소관 사무라 읍면동 생략) > PERMIT-CRITERIA-PROTOCOL(PERMIT-BUILDING-REPORT-14) |
| gov24-b1-010 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 건축물대장 관련해서 어떻게 해야 하나요 | 국토교통부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-CITYDEPT-jejusi-housing > (규칙 F 일반화 — 시청 국 소관 사무라 읍면동 생략) > PERMIT-CRITERIA-PROTOCOL(PERMIT-BUILDING-REPORT-14) |
| gov24-b1-017 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 자동차등록원부열람 발급 신청하고 싶어요 | 국토교통부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-CITYDEPT-jejusi-safety > (규칙 F 일반화 — 시청 국 소관 사무라 읍면동 생략) |
| gov24-b1-018 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 지적도 등본 발급받고 싶어요 | 국토교통부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-EMD-애월읍 > (5단계 LLM 분류도 SP-EMD-LAZY로 합의 — 1단계에서 이미 확보해둔 위치 힌트로 확정, 재질문 생략) |
| gov24-b1-022 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 임야도 등본 발급받고 싶어요 | 국토교통부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-EMD-애월읍 > (5단계 LLM 분류도 SP-EMD-LAZY로 합의 — 1단계에서 이미 확보해둔 위치 힌트로 확정, 재질문 생략) |
| gov24-b1-023 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 자동차등록원부열람 발급 신청하고 싶어요 | 국토교통부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-CITYDEPT-jejusi-safety > (규칙 F 일반화 — 시청 국 소관 사무라 읍면동 생략) |
| gov24-b1-024 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 토지이용계획확인 신청하고 싶어요 | 국토교통부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-CITYDEPT-jejusi-housing > (규칙 F 일반화 — 시청 국 소관 사무라 읍면동 생략) > PERMIT-CRITERIA-PROTOCOL(PERMIT-BUILDING-REPORT-14) |
| gov24-b2-008 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 토지임야대장등본교부 다량 신청하고 싶어요 | 국토교통부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-EMD-애월읍 > (5단계 LLM 분류도 SP-EMD-LAZY로 합의 — 1단계에서 이미 확보해둔 위치 힌트로 확정, 재질문 생략) |
| gov24-b2-020 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 하이패스 미납요금 조회하고 싶어요 | 국토교통부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-EMD-애월읍 > (1단계 힌트 전용 매칭 폴백 — EMD가 위치 힌트로만 잡혀 2~5단계에 더 구체적인 매칭 기회를 먼저 줬으나 실패) |
| gov24-b2-034 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 자동차등록증 재발급 신청하고 싶어요 | 국토교통부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-CITYDEPT-jejusi-safety > (규칙 F 일반화 — 시청 국 소관 사무라 읍면동 생략) |
| gov24-b2-050 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 건축물대장 인터넷 발급받고 싶어요 | 국토교통부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-CITYDEPT-jejusi-housing > (규칙 F 일반화 — 시청 국 소관 사무라 읍면동 생략) > PERMIT-CRITERIA-PROTOCOL(PERMIT-BUILDING-REPORT-14) |
| gov24-b1-021 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 고용보험 자격이력내역서 관련해서 어떻게 해야 하나요 | 근로복지공단 | gov_national | JEJU-GOV-COMMON > JEJU-NATIONAL-SP > SP-NAT-LABOR |
| gov24-b2-017 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 농지대장 관련해서 어떻게 해야 하나요 | 농림축산식품부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-DO-AGRI > (LLM 분류 폴백) |
| gov24-b2-030 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 농업경영체 등록 확인서 발급 신청하고 싶어요 | 농림축산식품부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-DO-AGRI |
| gov24-b1-015 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 가족관계증명서 발급받고 싶어요 | 대법원 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-EMD-애월읍 > (5단계 LLM 분류도 SP-EMD-LAZY로 합의 — 1단계에서 이미 확보해둔 위치 힌트로 확정, 재질문 생략) |
| gov24-b1-039 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 기본증명서 발급받고 싶어요 | 대법원 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-EMD-애월읍 > (5단계 LLM 분류도 SP-EMD-LAZY로 합의 — 1단계에서 이미 확보해둔 위치 힌트로 확정, 재질문 생략) |
| gov24-b2-003 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 혼인관계증명서 발급받고 싶어요 | 대법원 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-EMD-애월읍 > (5단계 LLM 분류도 SP-EMD-LAZY로 합의 — 1단계에서 이미 확보해둔 위치 힌트로 확정, 재질문 생략) |
| gov24-b2-049 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 영문증명서 발급받고 싶어요 | 대법원 | gov_national | JEJU-GOV-COMMON > JEJU-NATIONAL-SP > SP-NAT-EDUCERT > (LLM 분류 폴백) |
| gov24-b1-028 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 출입국에 관한 사실증명 관련해서 어떻게 해야 하나요 | 법무부 | gov_national | JEJU-GOV-COMMON > JEJU-NATIONAL-SP > SP-NAT-IMMIGRATION |
| gov24-b2-026 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 경찰 사건 조회하고 싶어요 | 법무부 | gov_national | JEJU-GOV-COMMON > JEJU-NATIONAL-SP > SP-NAT-POLICE |
| gov24-b2-031 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 외국인등록사실증명 관련해서 어떻게 해야 하나요 | 법무부 | gov_national | JEJU-GOV-COMMON > JEJU-NATIONAL-SP > SP-NAT-IMMIGRATION |
| gov24-b2-043 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 검찰사건 조회하고 싶어요 | 법무부 | gov_national | JEJU-GOV-COMMON > JEJU-NATIONAL-SP > SP-NAT-PROSECUTION > (LLM 분류 폴백) |
| gov24-b1-030 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 병적증명서 발급받고 싶어요 | 병무청 | gov_national | JEJU-GOV-COMMON > JEJU-NATIONAL-SP > SP-NAT-MMA > (LLM 분류 폴백) |
| gov24-b1-012 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 건강진단결과서 발급받고 싶어요 | 보건복지부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-AGY-BOHWAN |
| gov24-b1-026 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 건강보험 자격득실 확인서 관련해서 어떻게 해야 하나요 | 보건복지부 | gov_national | JEJU-GOV-COMMON > JEJU-NATIONAL-SP > SP-NAT-NHIS |
| gov24-b2-009 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 국민기초생활수급자증명 관련해서 어떻게 해야 하나요 | 보건복지부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-DO-WELFARE > (LLM 분류 폴백) |
| gov24-b2-027 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 장애인증명서 발급받고 싶어요 | 보건복지부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-DO-WELFARE |
| gov24-b2-038 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 건강보험 자격확인서 관련해서 어떻게 해야 하나요 | 보건복지부 | gov_national | JEJU-GOV-COMMON > JEJU-NATIONAL-SP > SP-NAT-NHIS |
| gov24-b2-039 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 보건의료인 면허 증명서 발급받고 싶어요 | 보건복지부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-DO-SAFETY |
| gov24-b2-042 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 난임부부 시술비 지원 신청하고 싶어요 | 보건복지부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-DO-WELFARE |
| gov24-b2-045 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 조회를 통한 지원결정통지 출력 관련해서 어떻게 해야 하나요 | 보건복지부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-EMD-애월읍 > (1단계 힌트 전용 매칭 폴백 — EMD가 위치 힌트로만 잡혀 2~5단계에 더 구체적인 매칭 기회를 먼저 줬으나 실패) |
| gov24-b2-047 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 공장등록증명 관련해서 어떻게 해야 하나요 | 산업통상부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-DO-ECON > (LLM 분류 폴백) |
| gov24-b1-011 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 여권 재발급 온라인 신청하고 싶어요 | 외교부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-CITYDEPT-jejusi-jachi > (규칙 F 일반화 — 시청 국 소관 사무라 읍면동 생략) |
| gov24-b1-037 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 여권 발급 이력 조회하고 싶어요 | 외교부 | gov_national | JEJU-GOV-COMMON > JEJU-NATIONAL-SP > SP-POLICY-LAZY(MOFA/fetched) |
| gov24-b1-050 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 여권정보증명서 발급받고 싶어요 | 외교부 | gov_national | JEJU-GOV-COMMON > JEJU-NATIONAL-SP > SP-POLICY-LAZY(MOFA/cache) |
| gov24-b2-015 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 여권 발급 상태 조회하고 싶어요 | 외교부 | gov_national | JEJU-GOV-COMMON > JEJU-NATIONAL-SP > SP-POLICY-LAZY(MOFA/fetched) |
| gov24-b2-028 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 중소기업 확인서 발급 서비스 이용하고 싶어요 | 중소벤처기업부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-ORG-JEDA |
| gov24-b1-047 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 예방접종증명 관련해서 어떻게 해야 하나요 | 질병관리청 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-DO-SAFETY |
| gov24-b2-006 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 나이스플러스 관련해서 어떻게 해야 하나요 | 한국교육학술정보원 | gov_national | JEJU-GOV-COMMON > JEJU-NATIONAL-SP > SP-NAT-EDUCERT > (LLM 분류 폴백) |
| gov24-b2-040 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 나이스 학부모 서비스 이용하고 싶어요 | 한국교육학술정보원 | gov_national | JEJU-GOV-COMMON > JEJU-NATIONAL-SP > SP-NAT-EDUCERT > (LLM 분류 폴백) |
| gov24-b2-025 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 자동차 검사 예약 관련해서 어떻게 해야 하나요 | 한국교통안전공단 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-DO-TRANSPORT > (LLM 분류 폴백) |
| gov24-b1-005 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 주민등록표 등본 발급받고 싶어요 | 행정안전부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-EMD-애월읍 > (5단계 LLM 분류도 SP-EMD-LAZY로 합의 — 1단계에서 이미 확보해둔 위치 힌트로 확정, 재질문 생략) |
| gov24-b1-006 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 주민등록표 초본 발급받고 싶어요 | 행정안전부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-EMD-애월읍 > (5단계 LLM 분류도 SP-EMD-LAZY로 합의 — 1단계에서 이미 확보해둔 위치 힌트로 확정, 재질문 생략) |
| gov24-b1-007 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 주민등록표 등본 발급받고 싶어요 | 행정안전부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-EMD-애월읍 > (5단계 LLM 분류도 SP-EMD-LAZY로 합의 — 1단계에서 이미 확보해둔 위치 힌트로 확정, 재질문 생략) |
| gov24-b1-008 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 주민등록표 초본 발급받고 싶어요 | 행정안전부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-EMD-애월읍 > (5단계 LLM 분류도 SP-EMD-LAZY로 합의 — 1단계에서 이미 확보해둔 위치 힌트로 확정, 재질문 생략) |
| gov24-b1-013 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 지방세 납세증명서 발급받고 싶어요 | 행정안전부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-DO-PLAN |
| gov24-b1-014 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 전입 신고하고 싶어요 | 행정안전부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-EMD-애월읍 > (5단계 LLM 분류도 SP-EMD-LAZY로 합의 — 1단계에서 이미 확보해둔 위치 힌트로 확정, 재질문 생략) |
| gov24-b1-027 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 세목별과세증명 관련해서 어떻게 해야 하나요 | 행정안전부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-DO-PLAN > (LLM 분류 폴백) |
| gov24-b1-029 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 주민등록증재 발급 신청하고 싶어요 | 행정안전부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-EMD-애월읍 > (5단계 LLM 분류도 SP-EMD-LAZY로 합의 — 1단계에서 이미 확보해둔 위치 힌트로 확정, 재질문 생략) |
| gov24-b1-031 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 인감증명서 발급 신청하고 싶어요 | 행정안전부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-EMD-애월읍 > (5단계 LLM 분류도 SP-EMD-LAZY로 합의 — 1단계에서 이미 확보해둔 위치 힌트로 확정, 재질문 생략) |
| gov24-b1-038 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 세목별과세증명 관련해서 어떻게 해야 하나요 | 행정안전부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-DO-PLAN > (LLM 분류 폴백) |
| gov24-b1-040 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 미과세증명 관련해서 어떻게 해야 하나요 | 행정안전부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-DO-PLAN > (LLM 분류 폴백) |
| gov24-b1-044 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 세목별납세증명 관련해서 어떻게 해야 하나요 | 행정안전부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-DO-PLAN > (LLM 분류 폴백) |
| gov24-b1-045 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 미과세증명 관련해서 어떻게 해야 하나요 | 행정안전부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-DO-PLAN > (LLM 분류 폴백) |
| gov24-b1-046 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823 | 세목별과세증명 관련해서 어떻게 해야 하나요 | 행정안전부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-DO-PLAN > (LLM 분류 폴백) |
| gov24-b2-004 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 지방세 온라인 서비스 - 위택스 관련해서 어떻게 해야 하나요 | 행정안전부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-DO-PLAN |
| gov24-b2-007 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 전자본인서명확인서 발급받고 싶어요 | 행정안전부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-EMD-애월읍 > (5단계 LLM 분류도 SP-EMD-LAZY로 합의 — 1단계에서 이미 확보해둔 위치 힌트로 확정, 재질문 생략) |
| gov24-b2-016 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 주민등록증분실 신고하고 싶어요 | 행정안전부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-EMD-애월읍 > (5단계 LLM 분류도 SP-EMD-LAZY로 합의 — 1단계에서 이미 확보해둔 위치 힌트로 확정, 재질문 생략) |
| gov24-b2-021 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 주민등록정정 신고하고 싶어요 | 행정안전부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-EMD-애월읍 > (5단계 LLM 분류도 SP-EMD-LAZY로 합의 — 1단계에서 이미 확보해둔 위치 힌트로 확정, 재질문 생략) |
| gov24-b2-022 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 임신 지원 서비스 통합 제공 관련해서 어떻게 해야 하나요 | 행정안전부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-DO-WELFARE |
| gov24-b2-023 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 요금감면일괄 신청하고 싶어요 | 행정안전부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-EMD-애월읍 > (1단계 힌트 전용 매칭 폴백 — EMD가 위치 힌트로만 잡혀 2~5단계에 더 구체적인 매칭 기회를 먼저 줬으나 실패) |
| gov24-b2-029 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 주민등록 관련 통보 서비스 이용하고 싶어요 | 행정안전부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-EMD-애월읍 > (5단계 LLM 분류도 SP-EMD-LAZY로 합의 — 1단계에서 이미 확보해둔 위치 힌트로 확정, 재질문 생략) |
| gov24-b2-033 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 주민등록표 열람하고 싶어요 | 행정안전부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-EMD-애월읍 > (5단계 LLM 분류도 SP-EMD-LAZY로 합의 — 1단계에서 이미 확보해둔 위치 힌트로 확정, 재질문 생략) |
| gov24-b2-044 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 자동차세 연납 및 분납 안내받고 싶어요 | 행정안전부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-CITYDEPT-jejusi-jachi > (규칙 F 일반화 — 시청 국 소관 사무라 읍면동 생략) |
| gov24-b2-046 | gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 | 미환급금 신청하고 싶어요 | 행정안전부 | gov_do | JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU > SP-EMD-애월읍 > (1단계 힌트 전용 매칭 폴백 — EMD가 위치 힌트로만 잡혀 2~5단계에 더 구체적인 매칭 기회를 먼저 줬으나 실패) |
