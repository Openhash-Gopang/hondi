/// <reference path="../pb_data/types.d.ts" />
// doc_form_feedback — 2026-11-04 신설. 서류 서식(정적 양식)을 쓰는 이용자들이 서식을 고친 흔적(지금은 "항목 추가")을 익명으로 모은다.
// 같은 서식 버전·같은 항목을 서로 다른 이용자 N명(기본 5)이 추가하면 서식 갱신 후보가 된다(src/worker/doc-form-feedback.js).
// cid_hash 는 기기별 무작위 값의 해시라 개인을 가리키지 않는다. 규칙은 전부 null — Worker(admin 토큰)만 읽고 쓴다.
migrate((db) => {
  const collection = new Collection({
    "id": "docformfeedbk01",
    "created": "2026-11-04 00:00:00.000Z",
    "updated": "2026-11-04 00:00:00.000Z",
    "name": "doc_form_feedback",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "df01form", "name": "form_id",    "type": "text",   "required": true,  "presentable": true,  "options": { "min": 1, "max": 60,  "pattern": "" } },
      { "system": false, "id": "df02ver",  "name": "version",    "type": "number", "required": true,  "presentable": false, "options": { "min": 1, "max": null, "noDecimal": true } },
      { "system": false, "id": "df03kind", "name": "kind",       "type": "text",   "required": true,  "presentable": false, "options": { "min": 1, "max": 20,  "pattern": "" } },
      { "system": false, "id": "df04norm", "name": "label_norm", "type": "text",   "required": true,  "presentable": false, "options": { "min": 1, "max": 80,  "pattern": "" } },
      { "system": false, "id": "df05lab",  "name": "label",      "type": "text",   "required": true,  "presentable": true,  "options": { "min": 1, "max": 80,  "pattern": "" } },
      { "system": false, "id": "df06cid",  "name": "cid_hash",   "type": "text",   "required": true,  "presentable": false, "options": { "min": 16, "max": 64, "pattern": "" } },
      { "system": false, "id": "df07per",  "name": "persona",    "type": "text",   "required": false, "presentable": false, "options": { "min": null, "max": 60, "pattern": "" } },
      { "system": false, "id": "df08ts",   "name": "ts",         "type": "number", "required": true,  "presentable": false, "options": { "min": 0, "max": null, "noDecimal": true } }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_doc_form_feedback_one ON doc_form_feedback (form_id, version, kind, label_norm, cid_hash)",
      "CREATE INDEX idx_doc_form_feedback_cid_ts ON doc_form_feedback (cid_hash, ts)",
      "CREATE INDEX idx_doc_form_feedback_ts ON doc_form_feedback (ts)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  return dao.deleteCollection(dao.findCollectionByNameOrId("docformfeedbk01"));
})
