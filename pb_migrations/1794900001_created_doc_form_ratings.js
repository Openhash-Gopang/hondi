/// <reference path="../pb_data/types.d.ts" />
// doc_form_ratings — 2026-10-17 신설. 서식 DB(doc_forms)의 서식을 써 본 이용자의 평가(1~5점).
// 서식 한 버전당 평가자 1명 1표(고쳐 쓰면 덮어씀). rater·form_contributor 는 공개하지 않는다.
// eligible: 평가 시점에 평가자 계정이 가입 7일 이상이었는가(보상 집계에 들어가는 표인지).
// 규칙은 전부 null — Worker(src/worker/doc-form-reward.js)만 admin 토큰으로 읽고 쓴다.
migrate((db) => {
  const collection = new Collection({
    "id": "docformrate01",
    "created": "2026-10-17 00:00:00.000Z",
    "updated": "2026-10-17 00:00:00.000Z",
    "name": "doc_form_ratings",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "dr01key",   "name": "key_hash",         "type": "text",   "required": true,  "presentable": false, "options": { "min": 64, "max": 64, "pattern": "^[0-9a-f]{64}$" } },
      { "system": false, "id": "dr02ver",   "name": "version",          "type": "number", "required": true,  "presentable": true,  "options": { "min": 1, "max": null, "noDecimal": true } },
      { "system": false, "id": "dr03rater", "name": "rater",            "type": "text",   "required": true,  "presentable": false, "options": { "min": 1, "max": 100, "pattern": "" } },
      { "system": false, "id": "dr04rate",  "name": "rating",           "type": "number", "required": true,  "presentable": true,  "options": { "min": 1, "max": 5, "noDecimal": true } },
      { "system": false, "id": "dr05elig",  "name": "eligible",         "type": "bool",   "required": false, "presentable": false, "options": {} },
      { "system": false, "id": "dr06contr", "name": "form_contributor", "type": "text",   "required": true,  "presentable": false, "options": { "min": 1, "max": 100, "pattern": "" } },
      { "system": false, "id": "dr07ts",    "name": "ts",               "type": "number", "required": true,  "presentable": false, "options": { "min": 0, "max": null, "noDecimal": true } },
      { "system": false, "id": "dr08sig",   "name": "sig",              "type": "text",   "required": false, "presentable": false, "options": { "min": null, "max": 200, "pattern": "" } }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_doc_form_ratings_one ON doc_form_ratings (key_hash, version, rater)",
      "CREATE INDEX idx_doc_form_ratings_rater_ts ON doc_form_ratings (rater, ts)",
      "CREATE INDEX idx_doc_form_ratings_ring ON doc_form_ratings (rater, form_contributor)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  return dao.deleteCollection(dao.findCollectionByNameOrId("docformrate01"));
})
