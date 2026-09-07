/// <reference path="../pb_data/types.d.ts" />
// ── 2026-09-07 신설(사용자 지시) — 재무제표 스냅샷 저장소.
// handleSettleLedger(worker.js)가 pl 재집계 때마다 git commit과 동일한
// 구조(content_hash + prev_hash 체이닝 → commit_hash)로 기록하고,
// anchorFsSnapshotsMerkleRoot가 10분마다 OpenHash에 배치 앵커링한다.
// GET /fs/verify가 이 컬렉션을 읽어 (a) 앵커 무결성 (b) 데이터
// 자기무결성을 검증한다. pdv_records/pdv_merkle_anchors와 동일 관례.
migrate((db) => {
  const collection = new Collection({
    "id": "fs0snapshot001",
    "created": "2026-09-07 00:00:00.000Z",
    "updated": "2026-09-07 00:00:00.000Z",
    "name": "fs_snapshots",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "fss0000000001", "name": "guid", "type": "text", "required": true, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "fss0000000002", "name": "seq", "type": "number", "required": true, "presentable": true, "unique": false, "options": { "min": 1, "max": null } },
      { "system": false, "id": "fss0000000003", "name": "snapshot", "type": "text", "required": true, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "fss0000000004", "name": "content_hash", "type": "text", "required": true, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "fss0000000005", "name": "prev_hash", "type": "text", "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "fss0000000006", "name": "commit_hash", "type": "text", "required": true, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "fss0000000007", "name": "openhash_anchored", "type": "bool", "required": false, "presentable": false, "unique": false, "options": {} }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX `idx_fs_snapshots_guid_seq` ON `fs_snapshots` (`guid`, `seq`)",
      "CREATE INDEX `idx_fs_snapshots_anchored` ON `fs_snapshots` (`openhash_anchored`)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("fs0snapshot001");
  return dao.deleteCollection(collection);
})
