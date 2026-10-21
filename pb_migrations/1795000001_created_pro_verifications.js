/// <reference path="../pb_data/types.d.ts" />
// pro_verifications — 2026-10-21 신설. 전문가 면허 인증 신청·승인 장부(W1: 면허증 사본 업로드 → 관리자 수동 승인).
// 결정(2026-10-21): 면허증 사본은 승인 판단에 필요한 기간만 보관한다. 승인·반려 즉시 Worker 가 license_file 을 비우고(license_file_deleted_ts 기록),
// 서버에는 직역·면허번호 마스킹본·면허번호 해시(중복 사용 탐지)·승인자·승인/만료일만 남는다.
// role: professional(면허 소지 전문가) · staff(전문가의 직원 — supervisor_pubkey 의 승인이 유효해야 함).
// status: pending · approved · rejected · revoked. 만료는 expires_ts 로 판단(읽는 쪽이 계산).
// 규칙은 전부 null — Worker 만 admin 토큰으로 읽고 쓴다. license_file 은 protected(파일 토큰 필요).
migrate((db) => {
  const collection = new Collection({
    "id": "proverification",
    "created": "2026-10-21 00:00:00.000Z",
    "updated": "2026-10-21 00:00:00.000Z",
    "name": "pro_verifications",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "pv01pub",  "name": "applicant_pubkey",  "type": "text",   "required": true,  "presentable": false, "options": { "min": 1, "max": 100, "pattern": "" } },
      { "system": false, "id": "pv02pers", "name": "persona",           "type": "text",   "required": true,  "presentable": true,  "options": { "min": 2, "max": 60, "pattern": "^[a-z][a-z0-9-]*$" } },
      { "system": false, "id": "pv03role", "name": "role",              "type": "select", "required": true,  "presentable": true,  "options": { "maxSelect": 1, "values": ["professional", "staff"] } },
      { "system": false, "id": "pv04mask", "name": "license_no_masked", "type": "text",   "required": true,  "presentable": false, "options": { "min": 1, "max": 60, "pattern": "" } },
      { "system": false, "id": "pv05hash", "name": "license_hash",      "type": "text",   "required": true,  "presentable": false, "options": { "min": 64, "max": 64, "pattern": "^[0-9a-f]{64}$" } },
      { "system": false, "id": "pv06sup",  "name": "supervisor_pubkey", "type": "text",   "required": false, "presentable": false, "options": { "min": null, "max": 100, "pattern": "" } },
      { "system": false, "id": "pv07stat", "name": "status",            "type": "select", "required": true,  "presentable": true,  "options": { "maxSelect": 1, "values": ["pending", "approved", "rejected", "revoked"] } },
      { "system": false, "id": "pv08file", "name": "license_file",      "type": "file",   "required": false, "presentable": false, "options": { "maxSelect": 1, "maxSize": 5242880, "mimeTypes": ["image/jpeg", "image/png", "image/webp", "application/pdf"], "thumbs": [], "protected": true } },
      { "system": false, "id": "pv09fsha", "name": "file_sha256",       "type": "text",   "required": false, "presentable": false, "options": { "min": null, "max": 64, "pattern": "" } },
      { "system": false, "id": "pv10fdel", "name": "license_file_deleted_ts", "type": "number", "required": false, "presentable": false, "options": { "min": 0, "max": null, "noDecimal": true } },
      { "system": false, "id": "pv11rev",  "name": "reviewer",          "type": "text",   "required": false, "presentable": false, "options": { "min": null, "max": 100, "pattern": "" } },
      { "system": false, "id": "pv12rts",  "name": "reviewed_ts",       "type": "number", "required": false, "presentable": false, "options": { "min": 0, "max": null, "noDecimal": true } },
      { "system": false, "id": "pv13note", "name": "review_note",       "type": "text",   "required": false, "presentable": false, "options": { "min": null, "max": 300, "pattern": "" } },
      { "system": false, "id": "pv14exp",  "name": "expires_ts",        "type": "number", "required": false, "presentable": false, "options": { "min": 0, "max": null, "noDecimal": true } },
      { "system": false, "id": "pv15view", "name": "view_log",          "type": "json",   "required": false, "presentable": false, "options": { "maxSize": 4000 } },
      { "system": false, "id": "pv16ts",   "name": "ts",                "type": "number", "required": true,  "presentable": false, "options": { "min": 0, "max": null, "noDecimal": true } },
      { "system": false, "id": "pv17sig",  "name": "sig",               "type": "text",   "required": true,  "presentable": false, "options": { "min": null, "max": 200, "pattern": "" } }
    ],
    "indexes": [
      "CREATE INDEX idx_pro_verifications_applicant ON pro_verifications (applicant_pubkey, persona)",
      "CREATE INDEX idx_pro_verifications_status ON pro_verifications (status, ts)",
      "CREATE INDEX idx_pro_verifications_license ON pro_verifications (license_hash, status)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  return dao.deleteCollection(dao.findCollectionByNameOrId("proverification"));
})
