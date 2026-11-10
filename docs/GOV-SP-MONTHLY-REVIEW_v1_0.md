# 정부 AI SP 월간 검토 절차 v1.0 (2026-11-11)

정부 AI의 모든 SP(`prompts/gov-tree/**`, K-Public_common, SP-10)는 **매월 한 번** 두 가지를 반드시 거친다.
이 절차는 권고가 아니라 **장부 + CI 게이트로 강제**된다.

1. **최신성 갱신** — 기관·부서의 명칭·소속·소관 업무·근거 법령·접수 창구를 공식 출처(.go.kr·법제처·소관 기관 사이트)로 확인해 SP를 고치고 마지막 확인일(`legal_basis_last_verified`)을 갱신한다. (K-Public_common P13·SP-10 §REFRESH의 "30일" 기준과 동일)
2. **사용자 피드백 반영** — 지난달에 쌓인 사용자 피드백(`user_feedback`, `[USER_FEEDBACK]` 신호)과 SP 갱신 제안(`sp_update_proposals`)을 취합해, 항목마다 반영·기각·이월을 **사유와 함께** 결정한다.

## 주기와 마감

| 시점 | 일 | 담당 |
|---|---|---|
| 매월 1일 | 피드백 취합(triage) → 장부 `data/gov-sp-review/YYYY-MM.json` 개설 PR + 체크리스트 이슈 | 자동(`gov-sp-monthly-review.yml`) |
| 1~15일 | 항목별 처리·SP 수정 PR·마지막 확인일 갱신 | 사람(주피터) 또는 사람이 승인한 에이전트 작업 |
| 15일 | **마감** — 장부 종결(`closed=true`) | 사람 |
| 16일~ | 장부 미종결이면 **정부 SP를 바꾸는 PR은 병합 불가**(필수 체크 실패) + 매일 이슈 재알림 | 자동 |

최초 주기(2026-11)는 기준선을 기록하는 달이라 마감을 11월 30일로 한다.

## 장부 규칙 (`tools/gov_sp_monthly_review.py`)

- **피드백 항목**은 모두 `disposition`이 있어야 한다: `applied`(ref에 PR/커밋 필수) · `rejected`(사유 필수) · `deferred`(사유 필수, 다음 달 장부에 다시 올림).
- **피드백 원천을 조회하지 못하면**(비밀값 없음 등) 사람이 직접 취합해 항목을 채우거나 `attested_none=true`로 "없음"을 확인해야 한다 — 조용히 통과하지 않는다.
- **갱신 필요 SP**(마지막 확인일이 30일을 넘었거나 없음)는 종결 시점의 실제 수를 `refresh.remaining_stale`에 정확히 기록한다(거짓 기록은 검증에서 걸림). 남은 SP가 있으면 `refresh.note`에 계획을 적고, **지난달보다 늘어나면 실패**한다(갱신은 후퇴하지 않는다).
- 장부는 SP 본문을 고치지 않는다. 자동 승인은 없다.

## 에이전트(SP)가 하는 일

SP는 파일을 스스로 고칠 수 없다. 대신 (a) 호출 시점에 웹 검색으로 최신성을 확인해 그 응답에 반영하고(P13), (b) 사용자가 정정·불만·누락을 말하면 `[USER_FEEDBACK: raw="…", context_sp=…]` 신호를 내서 월간 취합 대상으로 남긴다(P14). 영속 반영은 이 절차의 몫이다.

## 체크리스트

- [ ] 1일: 장부 PR 병합, 피드백 취합 결과 확인(`data/feedback_triage_report.json`, 장부 `feedback.items`)
- [ ] 피드백 항목마다 `applied`/`rejected`/`deferred` 결정(사유·ref 기록)
- [ ] 갱신 필요 SP를 배치로 갱신(공식 출처 확인 → 내용 수정 → 마지막 확인일 갱신)
- [ ] `refresh.remaining_stale`·`refresh.note` 기록
- [ ] `python3 tools/gov_sp_monthly_review.py close --by <이름>` 으로 종결 후 장부 PR 병합 (15일까지)

## 설정이 필요한 것 (저장소 관리자)

- 브랜치 보호에서 `Gov SP monthly review / check-ledger`를 **필수 상태 체크**로 지정해야 병합이 실제로 막힌다.
- 비밀값 `POCKETBASE_URL`·`POCKETBASE_ADMIN_EMAIL`·`POCKETBASE_ADMIN_PASSWORD`가 이미 triage에 쓰이므로 그대로 쓴다. 없으면 피드백은 `unavailable`로 기록되어 사람이 채워야 한다.
