/// <reference path="../pb_data/types.d.ts" />
// ── 2026-09-07 신설(사용자 지시) — 재무제표 스냅샷(fs_snapshots)의
// commit_hash들을 머클트리로 묶어 OpenHash에 앵커링한 배치 기록.
// anchorFsSnapshotsMerkleRoot(worker.js, 10분 주기 크론)가 쓰고,
// GET /fs/verify가 읽어 머클루트를 재계산·대조한다.
// pdv_merkle_anchors와 완전히 동일한 구조 — leaf만 commit_hash로 다르다.
migrate((db) => {
  const collection = new Collection({
    "id": "fs0anchor00001",
    "created": "2026-09-07 00:00:00.000Z",
    "updated": "2026-09-07 00:00:00.000Z",
    "name": "fs_merkle_anchors",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "fma0000000001", "name": "merkle_root", "type": "text", "required": true, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "fma0000000002", "name": "block_count", "type": "number", "required": true, "presentable": true, "unique": false, "options": { "min": 0, "max": null } },
      { "system": false, "id": "fma0000000003", "name": "snapshot_ids", "type": "text", "required": true, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "fma0000000004", "name": "status", "type": "text", "required": true, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "fma0000000005", "name": "anchored_at", "type": "date", "required": true, "presentable": true, "unique": false, "options": { "min": "", "max": "" } }
    ],
    "indexes": [ "CREATE INDEX `idx_fs_merkle_anchors_anchored_at` ON `fs_merkle_anchors` (`anchored_at`)" ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("fs0anchor00001");
  return dao.deleteCollection(collection);
})
