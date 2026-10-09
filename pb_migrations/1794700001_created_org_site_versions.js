/// <reference path="../pb_data/types.d.ts" />
// org_site_versions — 2026-10-09 신설. 혼디 AI 웹사이트(기관 AI 사이트)의 라이브 설정 버전 저장소.
// 설정은 덮어쓰지 않고 버전으로 쌓는다(현재 = site별 최대 version, 롤백 = 옛 설정을 새 버전으로 저장).
// 규칙은 전부 null — Worker(src/worker/org-site-handler.js)만 admin 토큰으로 읽고 쓴다.
migrate((db) => {
  const collection = new Collection({
    "id": "orgsiteversn1",
    "created": "2026-10-09 00:00:00.000Z",
    "updated": "2026-10-09 00:00:00.000Z",
    "name": "org_site_versions",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "os01site",   "name": "site",    "type": "text",   "required": true,  "presentable": true,  "options": { "min": 2, "max": 32, "pattern": "^[a-z0-9][a-z0-9-]{1,31}$" } },
      { "system": false, "id": "os02ver",    "name": "version", "type": "number", "required": true,  "presentable": true,  "options": { "min": 1, "max": null, "noDecimal": true } },
      { "system": false, "id": "os03config", "name": "config",  "type": "json",   "required": true,  "presentable": false, "options": { "maxSize": 200000 } },
      { "system": false, "id": "os04note",   "name": "note",    "type": "text",   "required": false, "presentable": false, "options": { "min": null, "max": 200, "pattern": "" } },
      { "system": false, "id": "os05author", "name": "author",  "type": "text",   "required": true,  "presentable": false, "options": { "min": 20, "max": 100, "pattern": "" } },
      { "system": false, "id": "os06ts",     "name": "ts",      "type": "number", "required": true,  "presentable": false, "options": { "min": 0, "max": null, "noDecimal": true } },
      { "system": false, "id": "os07sig",    "name": "sig",     "type": "text",   "required": true,  "presentable": false, "options": { "min": 20, "max": 200, "pattern": "" } },
      { "system": false, "id": "os08hash",   "name": "hash",    "type": "text",   "required": true,  "presentable": false, "options": { "min": 64, "max": 64, "pattern": "^[0-9a-f]{64}$" } }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_org_site_ver ON org_site_versions (site, version)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  return dao.deleteCollection(dao.findCollectionByNameOrId("orgsiteversn1"));
})
