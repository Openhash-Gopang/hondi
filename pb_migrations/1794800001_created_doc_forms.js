/// <reference path="../pb_data/types.d.ts" />
// doc_forms — 2026-10-14 신설. 나비 서식 DB: 전문가 페르소나가 서류를 작성할 때 쓰는 "빈 서식(템플릿)" 저장소.
// 저장 대상은 빈 서식뿐이다(개인·사안 정보 제거본). 같은 서식(agency+name+form_no)은 버전으로 쌓는다.
// status: user_provided(이용자 제공·검토 전) → reviewed(운영자 검토) → official_verified(공식 출처 확인).
// 규칙은 전부 null — Worker(src/worker/doc-form-handler.js)만 admin 토큰으로 읽고 쓴다. contributor는 외부에 노출하지 않는다.
migrate((db) => {
  const collection = new Collection({
    "id": "docformsv001a",
    "created": "2026-10-14 00:00:00.000Z",
    "updated": "2026-10-14 00:00:00.000Z",
    "name": "doc_forms",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "df01key",    "name": "key_hash",    "type": "text",   "required": true,  "presentable": false, "options": { "min": 64, "max": 64, "pattern": "^[0-9a-f]{64}$" } },
      { "system": false, "id": "df02ver",    "name": "version",     "type": "number", "required": true,  "presentable": true,  "options": { "min": 1, "max": null, "noDecimal": true } },
      { "system": false, "id": "df03agency", "name": "agency",      "type": "text",   "required": true,  "presentable": true,  "options": { "min": 1, "max": 60, "pattern": "" } },
      { "system": false, "id": "df04name",   "name": "name",        "type": "text",   "required": true,  "presentable": true,  "options": { "min": 1, "max": 100, "pattern": "" } },
      { "system": false, "id": "df05formno", "name": "form_no",     "type": "text",   "required": false, "presentable": false, "options": { "min": null, "max": 60, "pattern": "" } },
      { "system": false, "id": "df06class",  "name": "form_class",  "type": "select", "required": true,  "presentable": false, "options": { "maxSelect": 1, "values": ["A", "B"] } },
      { "system": false, "id": "df07status", "name": "status",      "type": "select", "required": true,  "presentable": true,  "options": { "maxSelect": 1, "values": ["user_provided", "reviewed", "official_verified"] } },
      { "system": false, "id": "df08vdate",  "name": "version_date","type": "text",   "required": false, "presentable": false, "options": { "min": null, "max": 20, "pattern": "" } },
      { "system": false, "id": "df09fields", "name": "fields",      "type": "json",   "required": false, "presentable": false, "options": { "maxSize": 100000 } },
      { "system": false, "id": "df10body",   "name": "body",        "type": "text",   "required": true,  "presentable": false, "options": { "min": 1, "max": 60000, "pattern": "" } },
      { "system": false, "id": "df11bhash",  "name": "body_hash",   "type": "text",   "required": true,  "presentable": false, "options": { "min": 64, "max": 64, "pattern": "^[0-9a-f]{64}$" } },
      { "system": false, "id": "df12source", "name": "source",      "type": "select", "required": true,  "presentable": false, "options": { "maxSelect": 1, "values": ["user_attached", "ai_composed", "official"] } },
      { "system": false, "id": "df13snote",  "name": "source_note", "type": "text",   "required": false, "presentable": false, "options": { "min": null, "max": 300, "pattern": "" } },
      { "system": false, "id": "df14persona","name": "persona",     "type": "text",   "required": false, "presentable": false, "options": { "min": null, "max": 60, "pattern": "" } },
      { "system": false, "id": "df15contrib","name": "contributor", "type": "text",   "required": true,  "presentable": false, "options": { "min": 1, "max": 100, "pattern": "" } },
      { "system": false, "id": "df16ts",     "name": "ts",          "type": "number", "required": true,  "presentable": false, "options": { "min": 0, "max": null, "noDecimal": true } },
      { "system": false, "id": "df17sig",    "name": "sig",         "type": "text",   "required": false, "presentable": false, "options": { "min": null, "max": 200, "pattern": "" } },
      { "system": false, "id": "df18offurl", "name": "official_url","type": "text",   "required": false, "presentable": false, "options": { "min": null, "max": 300, "pattern": "" } },
      { "system": false, "id": "df19review", "name": "reviewer",    "type": "text",   "required": false, "presentable": false, "options": { "min": null, "max": 100, "pattern": "" } },
      { "system": false, "id": "df20rts",    "name": "reviewed_ts", "type": "number", "required": false, "presentable": false, "options": { "min": 0, "max": null, "noDecimal": true } }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_doc_forms_key_ver ON doc_forms (key_hash, version)",
      "CREATE INDEX idx_doc_forms_agency ON doc_forms (agency)",
      "CREATE INDEX idx_doc_forms_contrib_ts ON doc_forms (contributor, ts)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  return dao.deleteCollection(dao.findCollectionByNameOrId("docformsv001a"));
})
