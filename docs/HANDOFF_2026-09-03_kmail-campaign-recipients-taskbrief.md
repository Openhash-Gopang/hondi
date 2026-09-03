# 작업 지시서 — K-Mail 캠페인 수신자별 발송·회신 추적 (kmail_campaign_recipients)

**이 문서는 K-Mail을 다루는 세션(새 대화창)에 그대로 붙여넣어 시작
지점으로 삼기 위해 작성됐습니다. K-Plan 쪽 작업(작업 보드, K-Capability
단계 등)은 이 문서가 작성된 시점 기준으로 이미 완료됐고, 그 세션과는
독립적으로 진행하시면 됩니다 — K-Plan 코드/SP는 이 작업 범위에
포함되지 않습니다.**

---

## 0. 한 줄 요약

K-Mail 캠페인이 지금은 "누구에게 보냈는지"·"몇 명이 회신했는지"를
**캠페인 전체 단위로만** 알고 있습니다. 이걸 **수신자 개인 단위**로
쪼개 추적하는 `kmail_campaign_recipients` 컬렉션을 신설하고,
`_kmailGenerateDigest`가 이 데이터를 채우도록 배선합니다.

## 1. 배경 — 왜 필요한가

K-Plan(별도 완성된 트랙)이 캠페인을 설계할 때, "1단계 결과를 보고
2단계를 조정한다"는 K-Recompose 원칙을 갖고 있습니다. 지금은 그
"결과"가 캠페인 전체를 3~5문장으로 뭉뚱그린 AI 요약 하나뿐이라, K-Plan이
"어느 그룹 반응이 가장 좋았는가" 같은 판단을 정확한 데이터 없이
추측해야 합니다. 수신자별 구조화 데이터가 있으면 이 판단이 훨씬
정확해집니다 — 이게 이번 작업의 동기입니다.

**단, 이번 작업 범위는 K-Mail 쪽 데이터 구조·배선까지만입니다.** K-Plan
쪽에서 이 데이터를 실제로 읽어다 쓰는 건(예: K-Recompose 프롬프트에
포함시키는 것) 이 작업이 끝난 뒤 K-Plan 트랙에서 별도로 진행합니다 —
`kplan_tasks.plan_id`로 `kmail_campaigns.kplan_plan_id`를 필터링해
조인하는 방식으로 이미 설계해뒀으니, 이 문서의 작업만 끝나면 연결
자체는 어렵지 않을 것입니다.

## 2. 지금 있는 것 / 없는 것

| 항목 | 상태 |
|---|---|
| 캠페인이 어느 플랜/체크포인트 소속인지 | ✅ `kmail_campaigns.kplan_plan_id`/`kplan_checkpoint_label` (기존) |
| 누구에게 보냈는지 | ✅ `kmail_campaigns.contact_ids`(배열) — 다만 수신자별 발송 시각은 없음(캠페인 전체가 `send_at` 하나만 공유) |
| 회신 원문 | ✅ `ai_messages`(`session_id='kmail:<campaign_id>'`, `content_type='kmail_inbound'`) |
| 회신 요약 | ✅ AI가 캠페인 전체를 3~5문장으로 요약 |
| **수신자별 발송·회신 매칭** | ❌ 지금은 발신 이메일을 슬러그로 대조하는 임시 로직이 다이제스트 생성 시 1회성으로만 계산되고 저장 안 됨 |
| **수신자별 분류(참석/불참/문의/무응답)** | ❌ 자유텍스트 요약 안에 뭉쳐있음 |

## 3. 만들 것 — `kmail_campaign_recipients`

캠페인 발송 시점에 `contact_ids` 개수만큼 행을 미리 만들어두고, 회신이
오면 그 행을 채우는 구조입니다.

```js
// pb_migrations/<timestamp>_created_kmail_campaign_recipients.js
{
  "name": "kmail_campaign_recipients",
  "schema": [
    { "name": "campaign_id",         "type": "text",   "required": true },   // kmail_campaigns.id
    { "name": "contact_id",          "type": "text",   "required": true },   // kmail_contacts.id
    { "name": "sent_at",             "type": "date",   "required": false },  // 캠페인 send_at 공유 → 수신자별로 분리
    { "name": "delivery_status",     "type": "select", "values": ["pending","sent","bounced","failed"] },
    { "name": "replied_at",          "type": "date",   "required": false },
    { "name": "reply_message_id",    "type": "text",   "required": false },  // ai_messages(kmail_inbound) 레코드 id
    { "name": "reply_classification","type": "select", "values": ["참석","불참","문의","기타","무응답"] }
  ],
  "indexes": [
    "CREATE INDEX idx_kmail_campaign_recipients_campaign ON kmail_campaign_recipients (campaign_id)",
    "CREATE UNIQUE INDEX idx_kmail_campaign_recipients_unique ON kmail_campaign_recipients (campaign_id, contact_id)"
  ]
}
```

`kmail_campaigns`·`kmail_contacts`는 필드 추가 없이 그대로 재사용 —
새 컬렉션 하나로 "언제·누구에게·어떤 회신"의 빈칸이 다 채워집니다.

## 4. 배선 변경 (`worker.js`, 최소 침습)

1. **발송 시점**(캠페인 실제 발송 처리 지점 — 정확한 함수명은 K-Mail
   코드에서 직접 확인하십시오. `handleKmailCampaignCreate` 근처로
   추정): `contact_ids` 개수만큼 `kmail_campaign_recipients` 행을
   `delivery_status:'pending'`으로 생성 → 발송 완료 시 `'sent'`로 갱신.
2. **`_kmailGenerateDigest` 확장**: 지금은 회신들의 `sender_guid`를
   슬러그로 대조해서 "몇 명 회신/몇 명 미회신" 숫자만 세는데, 이
   대조 결과를 그대로 `kmail_campaign_recipients` 행에 저장
   (`replied_at`, `reply_message_id`)하도록 한 줄만 추가. AI 요약
   프롬프트에 "각 회신을 참석/불참/문의/기타 중 하나로도 분류해서
   JSON으로 같이 달라"는 지시를 추가해서, 지금 자유텍스트로만 나오는
   분류를 구조화된 `reply_classification`으로도 저장.

## 5. 하지 말아야 할 것

- **K-Plan 쪽 코드(`handleKPlanRelay`, `handleKPlanPlanCreate` 등)나
  SP(`k-plan_v1_1.md`)를 이 작업에서 건드리지 마십시오** — 그건 별도
  완성된 트랙입니다. K-Recompose 프롬프트에 이 데이터를 실제로 포함시
  키는 건 K-Plan 쪽에서 나중에 별도로 진행합니다.
- **`kplan_tasks`(K-Plan 작업 보드 컬렉션)에 K-Mail 전용 필드를 직접
  추가하지 마십시오** — `kplan_tasks.plan_id`로 `kmail_campaigns.
  kplan_plan_id`를 필터링해서 조회 시점에 조인하는 방식으로 이미
  설계해뒀습니다. 스키마를 섞으면 두 컬렉션의 독립성이 깨집니다.
- 이 작업 범위에서 실제 PM 보드 프론트엔드(`plan.hondi.net`)를 고칠
  필요는 없습니다 — 수신자별 데이터를 저장하는 백엔드 배선까지만입니다.

## 6. 시작 순서 (제안)

1. `Openhash-Gopang/hondi` 저장소를 클론하고, `worker.js`에서
   `_kmailGenerateDigest`·캠페인 발송 처리 함수를 먼저 찾아 실제
   코드를 확인(이 문서의 함수명 추정이 정확한지 재확인).
2. `kmail_campaigns`·`kmail_contacts`·`ai_messages`(`kmail_inbound`)
   스키마를 `pb_migrations/`에서 직접 확인해 정확한 필드명을 파악.
3. `kmail_campaign_recipients` 마이그레이션 작성.
4. 발송 시점 행 생성 배선 추가.
5. `_kmailGenerateDigest`에 매칭·분류 저장 로직 추가.
6. `docs/KPLAN_KMAIL_INTEGRATION_ARCHITECTURE_v1_0_20260902.md`를
   이번 변경 내용으로 갱신(정본 문서 갱신 원칙 준수).

## 7. 완료 기준 체크리스트

- [ ] `kmail_campaign_recipients` 컬렉션이 실제 L1 서버에 생성됨
- [ ] 캠페인 발송 시 수신자 수만큼 `pending` 행이 생성됨
- [ ] 다이제스트 생성 시 회신 매칭 결과(`replied_at`, `reply_message_id`)가
      해당 행에 저장됨
- [ ] AI 요약이 `reply_classification`을 구조화된 값으로도 반환하고,
      그 값이 저장됨
- [ ] `KPLAN_KMAIL_INTEGRATION_ARCHITECTURE_v1_0_20260902.md` 갱신됨
- [ ] (K-Plan 트랙에 인계할 것) `kplan_tasks.plan_id` ↔
      `kmail_campaigns.kplan_plan_id` 조인으로 수신자별 데이터를
      K-Plan 작업 보드에서 조회하는 프론트엔드 작업은 이 문서의
      범위 밖 — 이 체크리스트가 다 끝나면 K-Plan 트랙에 인계
