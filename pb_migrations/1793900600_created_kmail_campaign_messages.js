/// <reference path="../pb_data/types.d.ts" />
// 2026-09-10 신설 — 캠페인이 시작된(KMAIL_CAMPAIGN_START) 이후의 대화
// 전문을 일자·시간별로 기록한다(주피터 지시). 캠페인이 아직 시작되지
// 않은 대화는 어떤 캠페인에도 속하지 않으므로 기록 대상이 아니다 —
// 캠페인 시작 이전 turn까지 소급해서 채우면 실제 발화 시각이 아닌
// 서버가 나중에 지어낸 시각이 들어가게 되므로(정직성 원칙 위반),
// 일부러 하지 않는다. sent_at은 서버가 그 메시지를 처리한 시각
// (사용자 메시지는 수신 시각, K-Mail 응답은 생성 완료 시각)이다.
migrate((db) => {
  const collection = new Collection({
    "id": "kmc0600msg",
    "created": "2026-09-10 00:00:00.000Z",
    "updated": "2026-09-10 00:00:00.000Z",
    "name": "kmail_campaign_messages",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "kcm001camp",  "name": "campaign_id",      "type": "text",   "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" }, "description": "kmail_campaigns.id" },
      { "system": false, "id": "kcm002owner", "name": "owner_user_guid",  "type": "text",   "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" }, "description": "조회 시 campaign_id로 매번 join하지 않도록 비정규화 — 소유권 검사용" },
      { "system": false, "id": "kcm003role",  "name": "role",             "type": "select", "required": true,  "presentable": true,  "unique": false, "options": { "maxSelect": 1, "values": ["user", "assistant"] } },
      { "system": false, "id": "kcm004cont",  "name": "content",          "type": "text",   "required": true,  "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "kcm005sent",  "name": "sent_at",          "type": "date",   "required": true,  "presentable": true,  "unique": false, "options": { "min": "", "max": "" }, "description": "서버가 이 메시지를 처리한 시각(사용자 메시지=수신 시각, K-Mail 응답=생성 완료 시각)" }
    ],
    "indexes": [
      "CREATE INDEX idx_kmail_campaign_messages_campaign ON kmail_campaign_messages (campaign_id, sent_at)",
      "CREATE INDEX idx_kmail_campaign_messages_owner ON kmail_campaign_messages (owner_user_guid)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0600msg");
  return dao.deleteCollection(collection);
})
