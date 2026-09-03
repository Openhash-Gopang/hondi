/// <reference path="../pb_data/types.d.ts" />
// 2026-09-03 신설 — 캠페인이 "누구에게 보냈는지·몇 명이 회신했는지"를
// 캠페인 전체 단위로만 알던 것을, 수신자 개인 단위로 쪼개 추적한다
// (docs/HANDOFF_2026-09-03_kmail-campaign-recipients-taskbrief.md 설계
// 그대로 구현 + body_override 추가). recipient_name/email/org는
// kmail_contacts에서 매번 조인하지 않도록 발송 시점 값을 그대로
// 복사해 둔다(연락처가 나중에 병합·수정돼도 이 캠페인 시점 기록은
// 안 바뀜 — 보고서의 역사적 정확성을 위해 의도적으로 비정규화).
// body_override는 "수신자 대상자 별로 메일 초안을 정리해 줘" 같은
// 요청(§0-1 ④ 발송 단계, 수신자별 맞춤 본문)을 지원하기 위한 필드 —
// 비어있으면 캠페인 공통 body(kmail_campaigns.body)를 그대로 쓴다.
migrate((db) => {
  const collection = new Collection({
    "id": "kmc0018recip",
    "created": "2026-09-03 00:00:00.000Z",
    "updated": "2026-09-03 00:00:00.000Z",
    "name": "kmail_campaign_recipients",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "kcr001camp",  "name": "campaign_id",         "type": "text",   "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" }, "description": "kmail_campaigns.id" },
      { "system": false, "id": "kcr002cont",  "name": "contact_id",          "type": "text",   "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" }, "description": "kmail_contacts.id" },
      { "system": false, "id": "kcr003name",  "name": "recipient_name",      "type": "text",   "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "kcr004email", "name": "recipient_email",     "type": "text",   "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "kcr005org",   "name": "recipient_org",       "type": "text",   "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" }, "description": "발송 시점 소속기관 — 기관/카테고리별 응답률 집계(KMAIL_CAMPAIGN_REPORT)의 그룹 키" },
      { "system": false, "id": "kcr006body",  "name": "body_override",       "type": "text",   "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" }, "description": "수신자별 맞춤 본문 — 비어있으면 kmail_campaigns.body 공통본문 사용" },
      { "system": false, "id": "kcr007sent",  "name": "sent_at",             "type": "date",   "required": false, "presentable": true,  "unique": false, "options": { "min": "", "max": "" } },
      { "system": false, "id": "kcr008dlv",   "name": "delivery_status",     "type": "select", "required": true,  "presentable": true,  "unique": false, "options": { "maxSelect": 1, "values": ["pending", "sent", "bounced", "failed"] } },
      { "system": false, "id": "kcr009repat", "name": "replied_at",          "type": "date",   "required": false, "presentable": true,  "unique": false, "options": { "min": "", "max": "" } },
      { "system": false, "id": "kcr010repid", "name": "reply_message_id",    "type": "text",   "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" }, "description": "ai_messages(content_type=kmail_inbound) 레코드 id" },
      { "system": false, "id": "kcr011class", "name": "reply_classification","type": "select", "required": false, "presentable": true,  "unique": false, "options": { "maxSelect": 1, "values": ["참석", "불참", "문의", "기타", "무응답"] } }
    ],
    "indexes": [
      "CREATE INDEX idx_kmail_campaign_recipients_campaign ON kmail_campaign_recipients (campaign_id)",
      "CREATE UNIQUE INDEX idx_kmail_campaign_recipients_unique ON kmail_campaign_recipients (campaign_id, contact_id)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0018recip");
  return dao.deleteCollection(collection);
})
