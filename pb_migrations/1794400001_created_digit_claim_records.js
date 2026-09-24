/// <reference path="../pb_data/types.d.ts" />
// digit_claim_records — 2026-09-24 신설. 혼디 숫자 코드(일련번호)의 "서명된 청구 레코드" 저장소.
//
// 설계(주피터 확정): 번호는 사용자가 아이디처럼 직접 고르고, 소유권은 서버 장부가 아니라
// 소유자 Ed25519 서명이 든 레코드 체인으로 남긴다. 단기에는 이 L1 PocketBase가 "누가 먼저
// 청구했는가"의 순서만 정하고, 장기에는 같은 레코드를 Openhash L1~L5 원장에 그대로 재생한다.
// (레코드 형식·검증: src/gopang/ai/hondi-digit-claim.js)
//
// ★ 이 컬렉션이 진실의 원천이다(현재 소유자 = 체인을 재생한 결과). 별도의 head 테이블은 두지 않는다.
//   → 캐시가 원장과 어긋나는 종류의 버그가 원천적으로 없다.
//
// ★ 유일성 = 이 컬렉션의 두 유니크 인덱스가 전부다:
//   (serial, seq)  — 같은 번호에 같은 순번 레코드가 둘 생길 수 없다 → 동시 청구는 정확히 한 건만 성공
//   hash           — 같은 레코드의 재전송 방지
//
// 규칙은 전부 null — Worker(src/worker/digit-claim-handler.js)만 admin 토큰으로 읽고 쓴다.
// 읽기는 Worker의 공개 GET /digit/chain 을 통해 누구나 할 수 있다(서명이 있으니 공개해도 안전).
//
// 주의: profiles.digit_code_id(2026-07-15 유니크 인덱스, /pay/code/mine이 무작위 발급하던 값)와는
// 별개다. 프로필 조회가 청구 체인을 보도록 옮기는 작업은 별도 단계(문서 참조).
migrate((db) => {
  const collection = new Collection({
    "id": "digitclaimrecs1",
    "created": "2026-09-24 00:00:00.000Z",
    "updated": "2026-09-24 00:00:00.000Z",
    "name": "digit_claim_records",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "dc01serial", "name": "serial", "type": "text",   "required": true,  "presentable": true,  "options": { "min": 1, "max": 10, "pattern": "^[1-9][0-9]{0,9}$" } },
      { "system": false, "id": "dc02seq",    "name": "seq",    "type": "number", "required": true,  "presentable": true,  "options": { "min": 0, "max": null, "noDecimal": true } },
      { "system": false, "id": "dc03type",   "name": "type",   "type": "text",   "required": true,  "presentable": true,  "options": { "min": null, "max": 16, "pattern": "^(claim|transfer|revoke)$" } },
      { "system": false, "id": "dc04prev",   "name": "prev",   "type": "text",   "required": true,  "presentable": false, "options": { "min": 64, "max": 64, "pattern": "^[0-9a-f]{64}$" } },
      { "system": false, "id": "dc05owner",  "name": "owner",  "type": "text",   "required": true,  "presentable": false, "options": { "min": 20, "max": 100, "pattern": "" } },
      { "system": false, "id": "dc06to",     "name": "to",     "type": "text",   "required": false, "presentable": false, "options": { "min": null, "max": 100, "pattern": "" } },
      { "system": false, "id": "dc07ts",     "name": "ts",     "type": "number", "required": true,  "presentable": false, "options": { "min": 0, "max": null, "noDecimal": true } },
      { "system": false, "id": "dc08sig",    "name": "sig",    "type": "text",   "required": true,  "presentable": false, "options": { "min": 20, "max": 200, "pattern": "" } },
      { "system": false, "id": "dc09hash",   "name": "hash",   "type": "text",   "required": true,  "presentable": false, "options": { "min": 64, "max": 64, "pattern": "^[0-9a-f]{64}$" } },
      { "system": false, "id": "dc10guid",   "name": "submitter_guid", "type": "text", "required": false, "presentable": false, "options": { "min": null, "max": 100, "pattern": "" } },
      { "system": false, "id": "dc11anchor", "name": "anchor", "type": "json",   "required": false, "presentable": false, "options": { "maxSize": 20000 } }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_digit_claim_serial_seq ON digit_claim_records (serial, seq)",
      "CREATE UNIQUE INDEX idx_digit_claim_hash ON digit_claim_records (hash)",
      "CREATE INDEX idx_digit_claim_owner ON digit_claim_records (owner)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("digitclaimrecs1");
  return dao.deleteCollection(collection);
})
