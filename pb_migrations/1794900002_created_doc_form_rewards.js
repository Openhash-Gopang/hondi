/// <reference path="../pb_data/types.d.ts" />
// doc_form_rewards — 2026-10-17 신설. 서식을 처음 올린 이용자에게 주는 GDC 보상 기록(멱등 장부).
// (key_hash, version, kind) 유일 → 같은 서식에 같은 종류 보상은 한 번만. kind: qualified(기본) / excellent(우수 추가분).
// status: minting(지급 진행) · paid(완료) · failed(L1이 명시적으로 거절 — 자동 재시도) · unknown(응답 불명 — 운영자 확인 전 재시도 안 함) · void(운영자 무효).
// 규칙은 전부 null — Worker 만 admin 토큰으로 읽고 쓴다.
migrate((db) => {
  const collection = new Collection({
    "id": "docformrewd01",
    "created": "2026-10-17 00:00:00.000Z",
    "updated": "2026-10-17 00:00:00.000Z",
    "name": "doc_form_rewards",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "rw01key",   "name": "key_hash",    "type": "text",   "required": true,  "presentable": false, "options": { "min": 64, "max": 64, "pattern": "^[0-9a-f]{64}$" } },
      { "system": false, "id": "rw02ver",   "name": "version",     "type": "number", "required": true,  "presentable": true,  "options": { "min": 1, "max": null, "noDecimal": true } },
      { "system": false, "id": "rw03kind",  "name": "kind",        "type": "select", "required": true,  "presentable": true,  "options": { "maxSelect": 1, "values": ["qualified", "excellent"] } },
      { "system": false, "id": "rw04contr", "name": "contributor", "type": "text",   "required": true,  "presentable": false, "options": { "min": 1, "max": 100, "pattern": "" } },
      { "system": false, "id": "rw05amt",   "name": "amount_krw",  "type": "number", "required": true,  "presentable": true,  "options": { "min": 1, "max": null, "noDecimal": true } },
      { "system": false, "id": "rw06stat",  "name": "status",      "type": "select", "required": true,  "presentable": true,  "options": { "maxSelect": 1, "values": ["minting", "paid", "failed", "unknown", "void"] } },
      { "system": false, "id": "rw07att",   "name": "attempts",    "type": "number", "required": false, "presentable": false, "options": { "min": 0, "max": null, "noDecimal": true } },
      { "system": false, "id": "rw08atts",  "name": "attempt_ts",  "type": "number", "required": false, "presentable": false, "options": { "min": 0, "max": null, "noDecimal": true } },
      { "system": false, "id": "rw09gdc",   "name": "gdc",         "type": "number", "required": false, "presentable": false, "options": { "min": 0, "max": null, "noDecimal": false } },
      { "system": false, "id": "rw10hash",  "name": "mint_hash",   "type": "text",   "required": false, "presentable": false, "options": { "min": null, "max": 100, "pattern": "" } },
      { "system": false, "id": "rw11paid",  "name": "paid_ts",     "type": "number", "required": false, "presentable": false, "options": { "min": 0, "max": null, "noDecimal": true } },
      { "system": false, "id": "rw12err",   "name": "error",       "type": "text",   "required": false, "presentable": false, "options": { "min": null, "max": 200, "pattern": "" } },
      { "system": false, "id": "rw13stats", "name": "stats",       "type": "json",   "required": false, "presentable": false, "options": { "maxSize": 2000 } },
      { "system": false, "id": "rw14ts",    "name": "ts",          "type": "number", "required": true,  "presentable": false, "options": { "min": 0, "max": null, "noDecimal": true } }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_doc_form_rewards_one ON doc_form_rewards (key_hash, version, kind)",
      "CREATE INDEX idx_doc_form_rewards_contrib ON doc_form_rewards (contributor, ts)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  return dao.deleteCollection(dao.findCollectionByNameOrId("docformrewd01"));
})
