/// <reference path="../pb_data/types.d.ts" />
// pro_subscriptions — 2026-10-21 신설. 전문가용 AI 구독 장부(W5: 전문가·직원 각각 연 99,000원, 징수 주체는 직역 법인).
// 초기에는 수동 입금 확인 후 관리자가 부여한다(자동 결제 전). 카드번호·계좌번호 같은 결제 수단 정보는 저장하지 않는다 — pay_ref 는 입금자명·입금 참조 정도만.
// kind: professional · staff. status: active · refunded. 유효 여부는 expires_ts 로 읽는 쪽이 계산한다.
// 규칙은 전부 null — Worker 만 admin 토큰으로 읽고 쓴다.
migrate((db) => {
  const collection = new Collection({
    "id": "prosubscription",
    "created": "2026-10-21 00:00:00.000Z",
    "updated": "2026-10-21 00:00:00.000Z",
    "name": "pro_subscriptions",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "ps01pub",  "name": "subscriber_pubkey", "type": "text",   "required": true,  "presentable": false, "options": { "min": 1, "max": 100, "pattern": "" } },
      { "system": false, "id": "ps02kind", "name": "kind",              "type": "select", "required": true,  "presentable": true,  "options": { "maxSelect": 1, "values": ["professional", "staff"] } },
      { "system": false, "id": "ps03stat", "name": "status",            "type": "select", "required": true,  "presentable": true,  "options": { "maxSelect": 1, "values": ["active", "refunded"] } },
      { "system": false, "id": "ps04strt", "name": "start_ts",          "type": "number", "required": true,  "presentable": false, "options": { "min": 0, "max": null, "noDecimal": true } },
      { "system": false, "id": "ps05exp",  "name": "expires_ts",        "type": "number", "required": true,  "presentable": false, "options": { "min": 0, "max": null, "noDecimal": true } },
      { "system": false, "id": "ps06amt",  "name": "amount",            "type": "number", "required": true,  "presentable": false, "options": { "min": 0, "max": null, "noDecimal": true } },
      { "system": false, "id": "ps07ref",  "name": "pay_ref",           "type": "text",   "required": true,  "presentable": false, "options": { "min": 2, "max": 60, "pattern": "" } },
      { "system": false, "id": "ps08by",   "name": "granted_by",        "type": "text",   "required": false, "presentable": false, "options": { "min": null, "max": 100, "pattern": "" } },
      { "system": false, "id": "ps09note", "name": "note",              "type": "text",   "required": false, "presentable": false, "options": { "min": null, "max": 300, "pattern": "" } },
      { "system": false, "id": "ps10rts",  "name": "refund_ts",         "type": "number", "required": false, "presentable": false, "options": { "min": 0, "max": null, "noDecimal": true } },
      { "system": false, "id": "ps11ramt", "name": "refund_amount",     "type": "number", "required": false, "presentable": false, "options": { "min": 0, "max": null, "noDecimal": true } },
      { "system": false, "id": "ps12rnote","name": "refund_note",       "type": "text",   "required": false, "presentable": false, "options": { "min": null, "max": 300, "pattern": "" } },
      { "system": false, "id": "ps13ts",   "name": "ts",                "type": "number", "required": true,  "presentable": false, "options": { "min": 0, "max": null, "noDecimal": true } }
    ],
    "indexes": [
      "CREATE INDEX idx_pro_subscriptions_sub ON pro_subscriptions (subscriber_pubkey, status)",
      "CREATE INDEX idx_pro_subscriptions_exp ON pro_subscriptions (status, expires_ts)",
      "CREATE UNIQUE INDEX idx_pro_subscriptions_ref ON pro_subscriptions (pay_ref)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  return dao.deleteCollection(dao.findCollectionByNameOrId("prosubscription"));
})
