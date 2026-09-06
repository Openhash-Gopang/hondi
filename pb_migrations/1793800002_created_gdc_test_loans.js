/// <reference path="../pb_data/types.d.ts" />
// ── 2026-09-06 신설 — 대출 목업(gdc_test_loans). js/gdc-bank.js의
// 2026-07-18 LEGAL-HOLD 중 대출 기능을 "현직 금융기관 종사자 필드테스트"
// 범위로 한정해 재개한다. gdc_test_financial_statements 레코드가 있는
// user_guid만 신청 가능(서버측 gate, handleGdcTestLoanApply 참고).
migrate((db) => {
  const collection = new Collection({
    "id": "gdctln00000001",
    "created": "2026-09-06 00:00:00.000Z",
    "updated": "2026-09-06 00:00:00.000Z",
    "name": "gdc_test_loans",
    "type": "base",
    "system": false,
    "schema": [
        { "system": false, "id": "gdctln0000f001", "name": "user_guid",           "type": "text",   "required": true,  "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "gdctln0000f002", "name": "principal",           "type": "number", "required": true,  "presentable": true, "unique": false, "options": { "min": 0, "max": null } },
        { "system": false, "id": "gdctln0000f003", "name": "outstanding_principal","type": "number","required": true,  "presentable": true, "unique": false, "options": { "min": 0, "max": null } },
        { "system": false, "id": "gdctln0000f004", "name": "grade",               "type": "text",   "required": true,  "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "gdctln0000f005", "name": "annual_rate",         "type": "number", "required": true,  "presentable": true, "unique": false, "options": { "min": 0, "max": 1 } },
        { "system": false, "id": "gdctln0000f006", "name": "status",              "type": "text",   "required": true,  "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" }, "note": "active | repaid | defaulted" },
        { "system": false, "id": "gdctln0000f007", "name": "disbursed_tx_hash",   "type": "text",   "required": true,  "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "gdctln0000f008", "name": "credit_snapshot",     "type": "json",   "required": false, "presentable": false, "unique": false, "options": {}, "note": "신청 시점 evaluateCredit() 출력 원본(감사용)" }
    ],
    "indexes": [ "CREATE INDEX idx_gdc_test_loans_user_guid ON gdc_test_loans (user_guid)" ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
});
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("gdctln00000001");
  return dao.deleteCollection(collection);
})
