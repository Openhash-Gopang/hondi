/// <reference path="../pb_data/types.d.ts" />
// ── 2026-09-06 신설 — 대출 상환 목업 기록. 매 상환마다 원금/이자 분리
// 기록 — 이자 부분의 합이 정산(F: 대출수익-서버비용=예금이자재원) 단계의
// "대출수익" 입력값이 된다.
migrate((db) => {
  const collection = new Collection({
    "id": "gdcrpy00000001",
    "created": "2026-09-06 00:00:00.000Z",
    "updated": "2026-09-06 00:00:00.000Z",
    "name": "gdc_test_loan_repayments",
    "type": "base",
    "system": false,
    "schema": [
        { "system": false, "id": "gdcrpy0000f001", "name": "loan_id",          "type": "text",   "required": true, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "gdcrpy0000f002", "name": "user_guid",        "type": "text",   "required": true, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "gdcrpy0000f003", "name": "amount",           "type": "number", "required": true, "presentable": true, "unique": false, "options": { "min": 0, "max": null } },
        { "system": false, "id": "gdcrpy0000f004", "name": "principal_portion","type": "number", "required": true, "presentable": true, "unique": false, "options": { "min": 0, "max": null } },
        { "system": false, "id": "gdcrpy0000f005", "name": "interest_portion", "type": "number", "required": true, "presentable": true, "unique": false, "options": { "min": 0, "max": null } },
        { "system": false, "id": "gdcrpy0000f006", "name": "tx_hash",          "type": "text",   "required": true, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" } }
    ],
    "indexes": [
        "CREATE INDEX idx_gdc_test_repay_loan_id ON gdc_test_loan_repayments (loan_id)",
        "CREATE INDEX idx_gdc_test_repay_user_guid ON gdc_test_loan_repayments (user_guid)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
});
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("gdcrpy00000001");
  return dao.deleteCollection(collection);
})
