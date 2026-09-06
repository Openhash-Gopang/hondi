/// <reference path="../pb_data/types.d.ts" />
// ── 2026-09-06 신설 — 신용평가 목업용 재무상태표(bs-*)/손익(pl-*) 필드.
//
// 🔬 필드테스트 승인 범위 (2026-09-06, 대표 지시) — js/gdc-credit.js의
// 2026-07-18 LEGAL-HOLD 중 조건(2)(bs-* 스키마 부재)를 해소하기 위해
// 신설한다. 단, 이 컬렉션의 레코드가 존재하는 계정은 "현직 금융기관
// 종사자 필드테스터"로 한정한다 — 일반 이용자에게는 노출/생성되지
// 않는다(gdc-credit.js evaluateCredit()이 이 레코드 존재 여부로
// TESTER_ONLY 가드를 건다).
//
// bs-cash는 여기 저장하지 않는다 — 실제 GDC 지갑 잔액(handleLedgerReconcile
// 경로)에서 매번 살아있는 값을 가져와 쓴다. 그 외 5개 재무상태표 항목과
// 4개 손익 항목은 테스터가 다양한 가상 시나리오를 입력해 신용평가·대출
// 로직의 동작을 검증할 수 있도록 직접 편집 가능한 목업 값이다 — 실제
// 회계 시스템과 연동되지 않는다.
//
// 이 컬렉션 자체가 "일반 상용 서비스 아님"의 구조적 표식이므로 컬렉션명에
// gdc_test_ 접두어를 쓴다. 향후 실제 재무제표 연동으로 전환할 경우 별도
// 컬렉션(gdc_financial_statements)을 신설하고 이 컬렉션은 보존만 한다.
migrate((db) => {
  const collection = new Collection({
    "id": "gdctfs00000001",
    "created": "2026-09-06 00:00:00.000Z",
    "updated": "2026-09-06 00:00:00.000Z",
    "name": "gdc_test_financial_statements",
    "type": "base",
    "system": false,
    "schema": [
        { "system": false, "id": "gdctfs0000f001", "name": "user_guid",   "type": "text",   "required": true,  "presentable": true, "unique": true,  "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "gdctfs0000f002", "name": "tester_org",  "type": "text",   "required": false, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" }, "note": "소속 금융기관(테스터 식별용, 자유 텍스트)" },
        { "system": false, "id": "gdctfs0000f003", "name": "bs_ar",       "type": "number", "required": false, "presentable": false, "unique": false, "options": { "min": 0, "max": null } },
        { "system": false, "id": "gdctfs0000f004", "name": "bs_ap",       "type": "number", "required": false, "presentable": false, "unique": false, "options": { "min": 0, "max": null } },
        { "system": false, "id": "gdctfs0000f005", "name": "bs_debt",     "type": "number", "required": false, "presentable": false, "unique": false, "options": { "min": 0, "max": null } },
        { "system": false, "id": "gdctfs0000f006", "name": "bs_equity",   "type": "number", "required": false, "presentable": false, "unique": false, "options": { "min": 0, "max": null } },
        { "system": false, "id": "gdctfs0000f007", "name": "bs_inventory","type": "number", "required": false, "presentable": false, "unique": false, "options": { "min": 0, "max": null } },
        { "system": false, "id": "gdctfs0000f008", "name": "pl_revenue",  "type": "number", "required": false, "presentable": false, "unique": false, "options": { "min": 0, "max": null } },
        { "system": false, "id": "gdctfs0000f009", "name": "pl_cogs",     "type": "number", "required": false, "presentable": false, "unique": false, "options": { "min": 0, "max": null } },
        { "system": false, "id": "gdctfs0000f010", "name": "pl_opex",     "type": "number", "required": false, "presentable": false, "unique": false, "options": { "min": 0, "max": null } },
        { "system": false, "id": "gdctfs0000f011", "name": "cf_op",       "type": "number", "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null } },
        { "system": false, "id": "gdctfs0000f012", "name": "note",        "type": "text",   "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" }, "note": "테스터가 이 시나리오를 왜 입력했는지 메모(리뷰용)" }
    ],
    "indexes": [ "CREATE UNIQUE INDEX idx_gdc_test_fs_user_guid ON gdc_test_financial_statements (user_guid)" ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
});
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("gdctfs00000001");
  return dao.deleteCollection(collection);
})
