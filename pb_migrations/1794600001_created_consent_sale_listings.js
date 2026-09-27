/// <reference path="../pb_data/types.d.ts" />
// consent_sale_listings — 2026-09-27 신설. K-Estate에 통합된 "합의매각" — 채권자·
// 채무자 두 계정이 각자 지갑으로 서명해야만 등록이 확정되는 부동산 매물(주피터님
// 지시). 대법원 경매를 참고하되 법원 개시결정에 의한 절차가 아니므로 "경매"라는
// 말은 쓰지 않는다.
//
// 설계는 digit_claim_records(혼디 숫자 코드)와 같은 원리 — 서버 장부가 아니라
// 당사자 Ed25519 서명으로 확정을 남긴다 — 이나, 요구사항이 다르다: 숫자 코드는
// "한 사람이 서명하는 레코드 체인"인 반면 이건 "같은 한 장의 제안서에 두 사람이
// 각자 서명 — 둘 다 모여야 확정"이다(hondi-consent-sale.js 참고). 그래서 레코드
// 체인이 아니라 컬렉션 한 행 = 매물 하나로 단순하게 둔다.
//
// status 전이: draft_unsigned(제안자 서명 전) → pending_countersign(제안자만
// 서명) → active(둘 다 서명, 검색에 노출) → cancelled(양측 합의 시 등록 취소,
// 이번 1단계 범위 밖 — 컬럼만 마련) | sold(거래 완료, 1단계 범위 밖 — 컬럼만 마련)
//
// 규칙은 전부 null — Worker(src/worker/consent-sale-handler.js)만 admin
// 토큰으로 읽고 쓴다. 검색(GET /consent-sale/search)은 active 매물만 공개 노출.
migrate((db) => {
  const collection = new Collection({
    "id": "consentsalelst1",
    "created": "2026-09-27 00:00:00.000Z",
    "updated": "2026-09-27 00:00:00.000Z",
    "name": "consent_sale_listings",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "cs01region",   "name": "region",          "type": "text",   "required": true,  "presentable": true,  "options": { "min": 2, "max": 60 } },
      { "system": false, "id": "cs02ptype",    "name": "property_type",   "type": "text",   "required": true,  "presentable": true,  "options": { "min": 1, "max": 10, "pattern": "^(단독주택|아파트|연립다세대|상가|토지|기타)$" } },
      { "system": false, "id": "cs03price",    "name": "price",           "type": "number", "required": true,  "presentable": true,  "options": { "min": 1, "max": 1000000000000, "noDecimal": true } },
      { "system": false, "id": "cs04desc",     "name": "description",     "type": "text",   "required": false, "presentable": false, "options": { "min": null, "max": 2000 } },
      { "system": false, "id": "cs05dhash",    "name": "description_hash","type": "text",   "required": true,  "presentable": false, "options": { "min": 64, "max": 64, "pattern": "^[0-9a-f]{64}$" } },
      { "system": false, "id": "cs06cpub",     "name": "creditor_pubkey", "type": "text",   "required": true,  "presentable": false, "options": { "min": 20, "max": 100 } },
      { "system": false, "id": "cs07dpub",     "name": "debtor_pubkey",   "type": "text",   "required": true,  "presentable": false, "options": { "min": 20, "max": 100 } },
      { "system": false, "id": "cs08cguid",    "name": "creditor_guid",   "type": "text",   "required": true,  "presentable": false, "options": { "min": null, "max": 100 } },
      { "system": false, "id": "cs09dguid",    "name": "debtor_guid",     "type": "text",   "required": true,  "presentable": false, "options": { "min": null, "max": 100 } },
      { "system": false, "id": "cs10csig",     "name": "creditor_sig",    "type": "text",   "required": false, "presentable": false, "options": { "min": null, "max": 200 } },
      { "system": false, "id": "cs11dsig",     "name": "debtor_sig",      "type": "text",   "required": false, "presentable": false, "options": { "min": null, "max": 200 } },
      { "system": false, "id": "cs12ts",       "name": "ts",              "type": "number", "required": true,  "presentable": false, "options": { "min": 0, "max": null, "noDecimal": true } },
      { "system": false, "id": "cs13hash",     "name": "payload_hash",    "type": "text",   "required": true,  "presentable": false, "options": { "min": 64, "max": 64, "pattern": "^[0-9a-f]{64}$" } },
      { "system": false, "id": "cs14status",   "name": "status",          "type": "text",   "required": true,  "presentable": true,  "options": { "min": null, "max": 24, "pattern": "^(draft_unsigned|pending_countersign|active|cancelled|sold)$" } },
      { "system": false, "id": "cs15proposer", "name": "proposer_role",   "type": "text",   "required": true,  "presentable": false, "options": { "min": null, "max": 10, "pattern": "^(creditor|debtor)$" } },
      { "system": false, "id": "cs16aval",     "name": "appraisal_value", "type": "number", "required": false, "presentable": true,  "options": { "min": 0, "max": null, "noDecimal": true } },
      { "system": false, "id": "cs17anote",    "name": "appraisal_note",  "type": "text",   "required": false, "presentable": false, "options": { "min": null, "max": 1000 } },
      { "system": false, "id": "cs18aat",      "name": "appraised_at",    "type": "number", "required": false, "presentable": false, "options": { "min": 0, "max": null, "noDecimal": true } }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_consent_sale_hash ON consent_sale_listings (payload_hash)",
      "CREATE INDEX idx_consent_sale_status ON consent_sale_listings (status)",
      "CREATE INDEX idx_consent_sale_region ON consent_sale_listings (region)",
      "CREATE INDEX idx_consent_sale_creditor ON consent_sale_listings (creditor_pubkey)",
      "CREATE INDEX idx_consent_sale_debtor ON consent_sale_listings (debtor_pubkey)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("consentsalelst1");
  return dao.deleteCollection(collection);
})
