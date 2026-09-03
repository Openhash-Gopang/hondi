# 인수인계서 — K-Plan↔K-Mail 에이전트 간(A2A) 아키텍처 (2026-09-04)

**작성 목적**: 이 세션에서 만든 것을 요약하고, 다음 세션에서 "혼디 마케팅 캠페인"으로 K-Plan·K-Mail을 실제로 테스트하기 전에 알아야 할 것을 정리한다.

---

## 1. 오늘 반영된 것 (병합 완료, 라이브 배포 확인됨)

### `Openhash-Gopang/hondi` — PR #30 (배포 확인: `deploy-worker.yml`·`deploy-pb-migrations.yml` 둘 다 success)

| 커밋 | 내용 |
|---|---|
| K-Plan↔K-Mail 함수 수준 API | `_kplanDecideForKMail`(K-Mail이 인바운드 처리 판단이 안 설 때 K-Plan에 실시간 질의) 신설. `_kmailTriggerKPlanRecompose`가 K-Recompose 결과를 `kplan_plans`에 실제로 저장 안 하던 버그 수정(`_kplanPersistCheckpoint` 공유) |
| 남은 공백 3건 해소 | ① 위임 규칙 자동 승격(K-Plan이 반복 패턴이라 판단하면 `kmail_rules`에 즉시 등록) ② `kplan_plan_state`(재고·영업시간 등 실시간 상태 저장소, K-JIT류 자동 연동이 붙을 자리) ③ `kmail_campaign_recipients.thread_status` + `_kmailFetchThreadHistory`(스레드 단위 상태·과거 대화 참조) |
| k-services 문서 갱신 | `pages/k-services.html`의 K-Mail·K-Plan 패널을 오늘 작업 기준으로 재작성(SP v1.5/v1.0 시절 내용 → v1.9/v1.1) |
| 접속 추적링크 (SP v1.10) | `GET /r/<token>` 신설 — PC/모바일 자동분기 리다이렉트, 클릭 로그. 캠페인 본문에 `{{TRACKING_LINK}}` 삽입 시 수신자별 고유 링크로 자동 치환. `KMAIL_CAMPAIGN_REPORT`에 기관별 방문율 추가 |
| 전략/전술 지휘체계(§9) | 설계 문서에 "K-Plan=전략/정치, K-Mail=전술/전쟁" 명시 + 육하원칙 정형 브리프 포맷 |

### `Openhash-Gopang/hondi` — 추가 커밋 (이번 인수인계 작성 직전 추가, **아직 별도 PR 필요**)

- **`prompts/k-plan_v1_2.md` 신설** — 위 §9 원칙이 설계 문서에만 있고 K-Plan이 실제로 읽는 SP 본문에는 없어서, K-Execute 절에 실제로 반영했다. **이게 없으면 K-Plan이 여전히 발송 회차·일정까지 직접 설계해버릴 수 있으니, 테스트 전에 반드시 병합돼 있어야 한다.**
- `prompts/sp-catalog.json`의 `k-plan` 포인터를 `k-plan_v1_2.md`로 갱신.
- patch 파일: `0001-k-plan-SP-v1.2.patch` (fresh clone에 단독 적용 검증 완료 — 현재 `main`, PR #31 이후 상태 기준으로도 깨끗하게 적용됨)

### `Openhash-Gopang/mail` — PR #2 (배포 확인: GitHub Pages `building`→`built` 전환 중이었음, 최종 확인 필요)

- `mail.hondi.net` 랜딩페이지 전면 갱신 — 목차, 캠페인 생애주기, K-Plan과의 관계(역할표·3단계 처리·함수 API), 위임과 에스컬레이션, 사람과의 관계 신설
- **부수 발견 및 수정**: `main` 브랜치가 PR #1(`webapp.html` 신설) 병합 이전 상태로 되돌아가 있던 것을 발견 — `refs/pull/1/head`에서 복구해 `main`에 강제 push로 되살림. 라이브 사이트 자체는 이 사고 중에도 계속 정상 작동했음(원인 불명 — Pages 소스가 즉시 재빌드하지 않았거나 캐시).

## 2. 세션 중 발견·해결한 인프라 사고 (참고용, 전부 해결됨)

1. **`hondi.net` GitHub Pages 이중 배포** — 옛 저장소 `Openhash-Gopang/gopang`(아카이브됨)이 `hondi.net` GitHub Pages를 계속 서빙하면서, `deploy-worker.yml` 등도 그대로 남아있어 `hondi`와 같은 Cloudflare Worker를 이중 배포하던 split-brain 상태였음. Pages 소스를 `hondi`로 이관하고 `gopang`의 배포 워크플로를 제거·재아카이브해 해소.
2. **`mail` 저장소 `main` 유실** — 위 참고.

## 3. 정본 문서 현재 버전 — **다음 세션에서 여기부터 확인**

| 대상 | 파일 | sp-catalog.json 키 |
|---|---|---|
| K-Mail SP | `prompts/SP-25_kmail_v1_10.txt` | `SP-25_kmail` |
| K-Plan SP | `prompts/k-plan_v1_2.md` | `k-plan` |
| K-Plan↔K-Mail 아키텍처 | `docs/KPLAN_KMAIL_AGENT_TO_AGENT_ARCHITECTURE_v1_0_20260903.md` | (참조 문서, 로드되는 SP 아님) |

**중요**: 위 세 파일이 실제로 `main`에 병합·배포돼 있는지 테스트 직전에 `sp-catalog.json` 내용과 `gh run list --workflow deploy-worker.yml`로 재확인할 것 — 이 세션 내내 "patch 만듦 ≠ 병합됨 ≠ 배포됨"이 여러 번 헷갈렸다.

## 4. "혼디 마케팅 캠페인" 테스트 시나리오

이전 세션에서 사고실험으로 이미 한 번 돌려본 시나리오다:

> 사용자 → K-Plan: "혼디를 한국 주요 기관에 알리는 홍보 캠페인 준비해줘. 9/1~12/31 필드 베타 테스트 안내, 주요 기능과 패러다임 전환(AI-AI 소통) 언급, PC/모바일 접속을 각각 설명페이지/웹앱으로 유도, 기관별 반응(회신+접속) 측정, 반응에 따라 최대 5차까지 발송, 단계별·최종 보고."

**기대되는 동작 (§9 반영 후)**:
1. K-Plan이 육하원칙 6항목이 다 채워지는지 확인 — 빠진 게 있으면 먼저 물어본다.
2. K-Plan은 회차 수·일정·문구를 스스로 설계하지 않는다 — 육하원칙 브리프만 K-Mail에 전달(대화 안에서 자연어로 이뤄질 것 — 강제하는 코드 태그는 없다, §9는 SP 지침일 뿐).
3. K-Mail이 전술(실제 검색 대상, 회차 스케줄, 회차별 문구, 회신취합 시점, 보고주기)을 설계해 보고한다.
4. 실제 발송 전, 위임 범위 밖(대량 발송)이므로 사람 최종 승인을 거쳐야 한다.
5. 발송 시 `{{TRACKING_LINK}}` 사용 여부를 K-Mail이 판단해서 넣을 수 있다(브리프에 "접속측정 허용"이 있으면).

**테스트 시 유의점**:
- 이 브리프 핸드오프는 **코드로 강제되지 않는다** — K-Plan·K-Mail 두 SP가 대화 맥락 안에서 이 원칙을 "읽고 따르는" 것이지, 정해진 액션 태그(`KPLAN_ISSUE_BRIEF` 같은 것)가 있는 게 아니다. 실제로 잘 지켜지는지 자체가 이번 테스트의 핵심 관찰 대상이다.
- 실제 대량 발송까지 밀어붙이면 진짜 이메일이 진짜 기관에 나간다 — 사고실험과 실제 실행을 구분할 것. 라이브 테스트는 소규모(예: 수신자 1~2명, 실제 발송 가능한 테스트 주소)로 시작하는 걸 권장한다.
- K-Mail 발송 한도(100통/일)와 GDC 잔액을 실제 실행 전에 확인할 것.
- 위임 규칙(`delegate_execute`)이 이미 등록돼 있으면 예상과 다르게 자동 처리될 수 있다 — 테스트 계정의 기존 `kmail_rules` 목록을 먼저 확인.

## 5. 아직 해결 안 된 것 (정직하게 남김)

- **K-JIT** — 이 인수인계서 작성 시점 직전에 `pages/k-services.html`에 K-JIT·K-City 탭이 추가된 걸 발견했다(PR #31, 이 세션이 아니라 별도로 진행됨). 실제 백엔드 연동(worker.js 변경 없음, `kplan_plan_state`와의 연결도 없음)은 안 보여서, 오늘 작성한 문서들의 "K-JIT은 아직 존재하지 않음" 서술이 정확히는 "탭·소개는 생겼지만 실제 연동은 아직"으로 업데이트가 필요할 수 있다 — 다음 세션에서 `pages/k-services.html`의 kjit 항목과 SP-26/27 v0.1 초안을 확인할 것.
- 위임 규칙 자동 승격에 대한 사후 검토 절차 없음 (오판이 그대로 규칙화될 위험).
- 스레드 이력 조회가 최근 8건 고정 길이.
- `kplan_plan_state`는 사람이 수동 입력해야 함 — 실제 재고·POS 등 자동 연동 없음.
- K-Plan→K-Mail 브리프, K-Mail→K-Plan 전술보고 둘 다 구조화된 액션 태그가 아니라 자연어 대화 관례다 — SP 지침이 실제로 얼마나 안정적으로 지켜지는지는 이번 테스트로 처음 확인하는 것.

## 6. 관련 파일 전체 목록

```
docs/KPLAN_KMAIL_AGENT_TO_AGENT_ARCHITECTURE_v1_0_20260903.md   (정본 — A2A 설계 전체)
docs/KPLAN_KMAIL_INTEGRATION_ARCHITECTURE_v1_0_20260902.md      (구판 — 상향보고 최초 설계)
docs/KMAIL_KPLAN_PIPELINE_LIVE_TEST_INCIDENT_2026_09_02.md      (참고 — 이전 배포 사고 기록)
docs/HANDOFF_2026-09-03_kmail-campaign-recipients-taskbrief.md  (참고 — SP v1.8의 원 지시서)
prompts/SP-25_kmail_v1_10.txt                                    (정본 — K-Mail SP)
prompts/k-plan_v1_2.md                                           (정본 — K-Plan SP)
prompts/sp-catalog.json                                          (SP 버전 포인터)
worker.js  — 관련 함수: _kplanDecideForKMail, _kplanPersistCheckpoint,
             _kmailDecideDelegation, _kmailTriggerKPlanRecompose,
             _kmailFetchThreadHistory, handleKmailTrackingRedirect,
             handleKPlanPlanStateSet, _kplanFetchPlanState
pb_migrations/1788300017~1788300022 (kmail_campaigns title/closed_at,
             kmail_campaign_recipients 전체 필드, kplan_plan_state,
             kmail_rules delegate_execute)
pages/k-services.html  (hondi.net#k-services — K-Mail·K-Plan 소개 패널)
mail.hondi.net/index.html  (K-Mail 랜딩페이지, Openhash-Gopang/mail 저장소)
```
