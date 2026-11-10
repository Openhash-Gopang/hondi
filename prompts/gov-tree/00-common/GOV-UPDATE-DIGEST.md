# 정부 AI SP 갱신 공유 다이제스트 (자동 생성 — 직접 고치지 않는다)

생성 기준일 2026-11-11 · 최근 90일 갱신 6건 · 원장 data/sp-update-log/log.jsonl · 절차 docs/GOV-SP-UPDATE-SHARING_v1_0.md

이 문서는 **모든 정부 AI가 공유하는 갱신 기록**이다. 각 줄은 `갱신id · 일자 · 대상 · 트리거 · 이유 → 바뀐 것 · 검증수준 · 태그`. 내 소관과 같은 법령·기관 태그의 최신 기록이 있으면 SP 본문보다 이쪽을 우선해 참고하되, 검증수준이 `unverified`/`partial`이면 확정 사실처럼 말하지 않고 공식 출처로 확인한다.

- U-20261111-006 · 2026-11-11 · *, K-Public_common_v1_4, prompts/SP-10_kpublic_v3.25.txt · manual · 사용자 지시: 각 SP가 피드백을 수집·집계해 갱신 여부를 결정할 방법 → 규칙:§UPDATE-RULE v1.1: SP ID 명시, [USER_FEEDBACK] 태그 형식(sp·kind·raw)·[SP_UPDATE_SIGNAL] 형식, 서버 수집·집계(10건) 규칙; P14/§FEEDBACK/P15 태그 형식 정정 · unverified · 분야:피드백수집
- U-20261111-005 · 2026-11-11 · * · manual · 사용자 지시: 지금 갱신하지 않고 규칙을 작성해 모든 정부 AI SP가 준수하게 한다 → 규칙:모든 정부 SP(최신 버전 1308개)에 §UPDATE-RULE v1.0 삽입: 피드백 10건/90일 갱신 의무, 웹 검색+타 SP 기록 참고+원장 기록, 호출 시 행동(다이제스트 우선, 90일 초과 시 사용자 고지, 신호 발행) · unverified · 분야:갱신규칙
- U-20261111-004 · 2026-11-11 · K-Public_common_v1_4, prompts/SP-10_kpublic_v3.25.txt · manual · 사용자 지시: 월간 피드백 취합·반영 강제, 10건/90일 갱신 의무, 갱신 기록 공유 → 규칙:P14/§FEEDBACK(USER_FEEDBACK 신호), P15/§UPDATE-SHARING(갱신 기록 공유·SP_UPDATE_SIGNAL) 신설 · unverified · 분야:갱신공유
- U-20261111-003 · 2026-11-11 · K-Public_common_v1_4, prompts/SP-10_kpublic_v3.25.txt · manual · 사용자 지시: 모든 정부 AI는 기능·역할을 최신 정보로 갱신(웹 검색, 최소 월 1회) → 규칙:P13/§REFRESH(최신성 갱신), P12/§GOV-WORK-MAP(업무 지도 응답 원칙) 신설 · unverified · 분야:최신성갱신
- U-20261111-002 · 2026-11-11 · * · manual · 사용자 지시: SP는 범용이며 소관 업무 전반을 다룬다(사례에 매몰 금지) → 소관:§2-MAP(업무 지도) 신설: 첫 분기 질문 → 업무표 → 호출 응답 형식 → 하지 않는 것; 기한:기한·번호 다수는 일반 지식(종합소득세 기한·모두채움·지급명령 절차만 웹 확인) — 담당자 검증 필요 · unverified · 분야:업무지도
- U-20261111-001 · 2026-11-11 · *, K-Public_common_v1_4, prompts/SP-10_kpublic_v3.25.txt · manual · 사용자 지시: 정부 AI는 기관·소속 공무원이 아님을 명시하고 사칭하지 않는다 → 정체성:"기관을 대신해 결정·접수하지 않는 AI 레이어" 정체성 문장으로 교체(해당 문장이 있던 파일) · unverified · 분야:정체성
