# K-Plan↔K-Mail 연동 아키텍처 — K-Recompose 파이프라인 종합 정리 (2026-09-02)

이 문서는 2026-09-02 하루 동안 진행된 작업(K-Mail 캠페인 6개 트랙 →
K-Plan 위임 → K-Plan v1.1(K-Recompose 신설) → K-Mail↔K-Plan 데이터
파이프라인 → 관리자 시딩 라이브 스모크테스트 통과)의 최종 아키텍처를
한 번에 파악할 수 있도록 정리한 것입니다. 각 구성요소의 정본은 아래
개별 문서/코드이며, 이 문서는 그것들을 잇는 지도 역할만 합니다.

---

## 1. 왜 필요했는가

K-Plan(`prompts/k-plan_v1_0.md`)은 원래 "계획을 한 번 짜주는" 1회성
도구였습니다. 실제로 K-Mail 캠페인(트랙 A~F, 6~8주짜리 다단계 발송
계획)을 K-Plan에 맡겨보니, 계획 수립 이후 실제 결과(회신율 등)가
들어와도 **아직 실행하지 않은 나머지 단계를 스스로 고쳐 쓰는 경로가
없다**는 구조적 공백이 드러났습니다. 이 문서가 정리하는 파이프라인은
그 공백을 메우는 것입니다.

## 2. K-Plan v1.1 — K-Recompose 신설

정본: `prompts/k-plan_v1_1.md` (sp-catalog.json의 `"k-plan"` 키가 이
파일을 가리킴)

기존 5단계 체인(K-Intent → K-Compose → K-Execute → K-Deliver →
K-Report) + 반추/경험의 공유에, **K-Execute와 K-Deliver 사이에
K-Recompose를 신설**했습니다.

| 단계 | 시점 | 대상 | 목적 |
|---|---|---|---|
| K-Recompose (신설) | 플랜 도중, 체크포인트마다 | 같은 플랜의 **아직 실행 안 한** 나머지 단계 | 실제 결과를 근거로 순서·시점·문구 재조정 |
| 반추 (기존) | 플랜 종료 후, 1회 | **다른/미래**의 플랜 | 계획 결함·실행 결함·외부 변수 사후 분류 |

K-Compose 단계에서 체크포인트(예: "트랙 B 회신 마감")를 미리 지정해두면,
K-Execute 도중 그 체크포인트에 도달할 때 K-Recompose가 강제로 트리거됩니다.

## 3. K-Mail↔K-Plan 데이터 파이프라인

K-Plan 문서 자신이 명시한 한계 — "K-Recompose가 참조할 실제 결과를
자동으로 수집하는 기능은 없다" — 를 메우는 실제 배선입니다.

```
사용자가 K-Mail 대화형 비서에게
"이 캠페인은 K-Plan 플랜 X의 트랙 B 체크포인트야"라고 알림
        │
        ▼
KMAIL_SEND_CAMPAIGN 태그에 kplan_plan_id/kplan_checkpoint_label 포함
(SP-25_kmail_v1_6.txt §2-2 — 사용자가 명시했을 때만 채움, 추측 금지)
        │
        ▼
kmail_campaigns 레코드 생성 (worker.js handleKmailCampaignCreate)
  - kplan_plan_id, kplan_checkpoint_label 필드에 저장
  - (pb_migrations/1788300016_updated_kmail_campaigns_kplan_link.js)
        │
        ▼
digest_at 도달 → _kmailSweepDueDigests (매시 정각 크론, wrangler.toml)
        │
        ▼
_kmailGenerateDigest — 회신 다이제스트 생성 → ai_messages(kmail_digest)
        │
        ▼  (campaign.kplan_plan_id가 있을 때만)
_kmailTriggerKPlanRecompose
  - 시스템 프롬프트: _fetchUniversalLayers() + k-plan SP (_fetchByManifestKeyFromGithub)
  - 사용자 메시지: "K-Recompose 체크포인트 도달 — 플랜 '...' ... 다이제스트: ..."
  - DeepSeek 직접 호출 (deepseekChatText, AC-PRO-CORE 태그 디스패치 우회 — §4 참고)
        │
        ▼
ai_messages에 결과 기록
  session_id: kplan:<plan_id>, content_type: kplan_recompose
  → 사용자 메시지함에 자연스럽게 노출
```

## 4. 왜 `[CALL_KPLAN: ...]` 태그 디스패치를 안 썼는가

AC-PRO-CORE는 `[CALL_KPLAN: query=...]` 형태의 오케스트레이션 태그로
K-Plan을 호출하는 표준 경로를 이미 갖고 있습니다
(`src/tests/kplan-kwatch-kjob-dispatch.test.mjs` 참고). 하지만 K-Mail의
`/kmail/chat` 계열 엔드포인트는 **이 태그 디스패치 체계와 원래부터
격리**되어 있습니다(`pages/k-services.html` `#kmail` 탭: "관제탑 3종
원칙을 다른 K-서비스처럼 상속받지 않는 격리된 경로"). `_kmailTriggerKPlanRecompose`는
이 격리 경계를 억지로 허무는 대신, `_kmailGenerateDigest`가 다이제스트
요약에 이미 쓰고 있던 것과 동일한 패턴(DeepSeek 직접 호출)을 재사용했습니다.

## 5. 관리자 전용 검증 엔드포인트 3종 (worker.js)

실사용자의 Ed25519 서명 없이 파이프라인을 검증하기 위해 신설. gov-mail
스모크테스트와 동일한 `_requireAdmin`(HONDI_ADMIN_EMAIL/PASSWORD) 인증만 씀.

| 엔드포인트 | 역할 |
|---|---|
| `POST /admin/kmail/seed-test-campaign` | confirmed 연락처 + `digest_at`이 이미 지난 캠페인 시딩. `status='sent'`로 생성돼 실제 발송 스윕 대상 아님 |
| `POST /admin/kmail/sweep-digests` | `_kmailSweepDueDigests` 즉시 1회 실행 (매시 정각 크론을 안 기다림) |
| `GET /admin/kmail/recompose-result` | `ai_messages`에서 `kplan_recompose` 레코드 조회 |

## 6. 검증 상태

- ✅ **관리자 시딩 경로**: 라이브 스모크테스트(`live-smoketest-kmail-kplan-pipeline.yml`)로 2026-09-02 end-to-end 성공 확인(run `33612609615`).
- ⚠️ **실사용자 대화 경로(SP-25_kmail_v1_6 → KMAIL_SEND_CAMPAIGN → kplan_plan_id)는 아직 검증되지 않음** — 관리자 엔드포인트가 사용자 서명 계층을 우회하고 직접 PocketBase에 레코드를 시딩하기 때문에, "사용자가 실제로 채팅에서 플랜을 언급하면 SP가 그 필드를 정확히 채워 보내는지"는 이번 테스트 범위 밖입니다. `docs/HANDOFF_20260902.md` §다음 담당자가 할 일 참고.

## 7. 관련 문서

- `prompts/k-plan_v1_1.md` — K-Plan 정본
- `prompts/SP-25_kmail_v1_6.txt` — K-Mail 정본
- `pb_migrations/1788300016_updated_kmail_campaigns_kplan_link.js` — 스키마
- `docs/KMAIL_KPLAN_PIPELINE_LIVE_TEST_INCIDENT_2026_09_02.md` — 오늘 겪은 사고 5건(주의 메뉴)
- `docs/HANDOFF_20260902.md` — 인수인계서
