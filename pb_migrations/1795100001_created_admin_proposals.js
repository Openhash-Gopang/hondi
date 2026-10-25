/// <reference path="../pb_data/types.d.ts" />
// admin_proposals — 2026-10-25 신설. 관리자 대시보드(admin.html)에서만 열람하는 비공개 문서(직역 AI 법인 지분 매수 제안서 등)의 보관소.
// 문서는 정적 파일(저장소·Pages)로 두지 않는다: 정적 파일은 로그인 없이 주소만 알면 열린다. 여기에는 HTML 본문을 그대로 저장한다.
// 규칙은 전부 null — Worker(src/worker/admin-proposals-handler.js)가 관리자 Bearer 토큰(_requireAdmin)을 확인한 뒤에만 L1 관리자 토큰으로 읽고 쓴다.
migrate((db) => {
  const collection = new Collection({
    "id": "adminprops0001",
    "created": "2026-10-25 00:00:00.000Z",
    "updated": "2026-10-25 00:00:00.000Z",
    "name": "admin_proposals",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "ap01slug",  "name": "slug",       "type": "text",   "required": true,  "presentable": true,  "options": { "min": 3, "max": 64, "pattern": "^[a-z0-9][a-z0-9-]{2,63}$" } },
      { "system": false, "id": "ap02title", "name": "title",      "type": "text",   "required": true,  "presentable": true,  "options": { "min": 1, "max": 200, "pattern": "" } },
      { "system": false, "id": "ap03prof",  "name": "profession", "type": "text",   "required": false, "presentable": false, "options": { "min": null, "max": 40, "pattern": "" } },
      { "system": false, "id": "ap04html",  "name": "html",       "type": "text",   "required": true,  "presentable": false, "options": { "min": 1, "max": null, "pattern": "" } },
      { "system": false, "id": "ap05hash",  "name": "sha256",     "type": "text",   "required": true,  "presentable": false, "options": { "min": 64, "max": 64, "pattern": "^[0-9a-f]{64}$" } },
      { "system": false, "id": "ap06size",  "name": "size",       "type": "number", "required": true,  "presentable": false, "options": { "min": 0, "max": null, "noDecimal": true } },
      { "system": false, "id": "ap07ts",    "name": "ts",         "type": "number", "required": true,  "presentable": false, "options": { "min": 0, "max": null, "noDecimal": true } },
      { "system": false, "id": "ap08by",    "name": "updated_by", "type": "text",   "required": false, "presentable": false, "options": { "min": null, "max": 100, "pattern": "" } }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_admin_proposals_slug ON admin_proposals (slug)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  return dao.deleteCollection(dao.findCollectionByNameOrId("adminprops0001"));
})
