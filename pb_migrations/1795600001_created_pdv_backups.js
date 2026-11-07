/// <reference path="../pb_data/types.d.ts" />
// pdv_backups — 2026-11-08 신설. PDV 방식 C(클라우드 백업)의 기본 저장소(L1 PocketBase).
// 내용은 폰에서 AES-256-GCM 으로 암호화한 바이트(base64)라 서버는 평문을 볼 수 없다. 복구 문구는 서버에 오지 않는다.
// 규칙은 전부 null — Worker(src/worker/pdv-backup-handler.js)가 본인 인증(지갑 서명/전화 인증)을 확인한 뒤에만 L1 관리자 토큰으로 읽고 쓴다.
migrate((db) => {
  const collection = new Collection({
    "id": "pdvbackups0001",
    "created": "2026-11-08 00:00:00.000Z",
    "updated": "2026-11-08 00:00:00.000Z",
    "name": "pdv_backups",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "pb01guid", "name": "guid", "type": "text",   "required": true,  "presentable": true,  "options": { "min": 3, "max": 100, "pattern": "" } },
      { "system": false, "id": "pb02name", "name": "name", "type": "text",   "required": true,  "presentable": true,  "options": { "min": 5, "max": 120, "pattern": "^pdv/[A-Za-z0-9._-]{1,100}$" } },
      { "system": false, "id": "pb03data", "name": "data", "type": "text",   "required": true,  "presentable": false, "options": { "min": 1, "max": null, "pattern": "" } },
      { "system": false, "id": "pb04size", "name": "size", "type": "number", "required": true,  "presentable": false, "options": { "min": 0, "max": null, "noDecimal": true } },
      { "system": false, "id": "pb05ts",   "name": "ts",   "type": "number", "required": true,  "presentable": false, "options": { "min": 0, "max": null, "noDecimal": true } }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_pdv_backups_guid_name ON pdv_backups (guid, name)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  return dao.deleteCollection(dao.findCollectionByNameOrId("pdvbackups0001"));
})
