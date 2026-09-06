/// <reference path="../pb_data/types.d.ts" />
// 2026-09-07 신설 — gdc_test_loans.credit_snapshot(json)에 options.maxSize가
// 누락돼 실서버(l1-hanlim)에서 저장 시 validation_json_size_limit(허용
// 최대 0바이트)으로 거부되던 문제 수정. 정확히 account_risk_score.score_basis
// 때와 같은 PocketBase 0.22.x 숨은 필수값 문제(docs/POCKETBASE-STRUCTURE-
// GUIDE_v1_1_addendum_2026-07-19.md §5, pb_migrations/1788100001_fixed_
// account_risk_score_basis_maxsize.js 참고) — 원래 마이그레이션
// (1793800002)에서 또 놓쳤다. 관례대로 2000000(2MB)로 설정.
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("gdctln00000001");
  const field = collection.schema.getFieldById("gdctln0000f008");
  field.options.maxSize = 2000000;
  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("gdctln00000001");
  const field = collection.schema.getFieldById("gdctln0000f008");
  field.options.maxSize = 0;
  return dao.saveCollection(collection);
});
