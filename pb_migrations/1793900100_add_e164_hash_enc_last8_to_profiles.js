/// <reference path="../pb_data/types.d.ts" />
// 2026-09-07 신설 — "혼디는 서버에 개인정보를 저장하지 않는다"는 로컬 우선
// 원칙과 profiles.e164 평문 저장이 실질적으로 충돌한다는 사용자 지적에서
// 시작된 마이그레이션. e164 자체는 (1) 재가입/재클레임 시 동일 번호
// 중복탐지(exact match), (2) device-link SMS 재발송에 실제 번호 필요,
// (3) "숫자코드" 기능의 뒷자리 부분일치 검색, 세 가지 용도로 쓰이는데
// 셋 다 단순 단방향 해시로는 성립하지 않는다(SMS 발송은 원문이 필요하고,
// 부분일치는 해시로 원천 불가능). 그래서 세 필드로 쪼갠다:
//   - e164_hash  : HMAC-SHA256(PHONE_VERIFY_SECRET, "e164-lookup:"+e164)
//                  — 정확일치 조회 전용(중복탐지). 원문 복원 불가.
//   - e164_enc   : $security.encrypt(e164, PHONE_ENC_KEY) (AES-256-GCM)
//                  — SMS 재발송 등 원문이 꼭 필요한 극소수 경로에서만,
//                    새로 만든 내부 전용 라우트를 통해서만 복호화한다.
//   - e164_last8 : 뒷자리 8자리 평문 — "숫자코드" 기능은 원래도 사용자
//                  화면에 일부 공개되는 정보라 예외로 둘 만하다고 판단.
// 기존 e164 필드는 스키마에 남겨두되(하위 호환), pb_hooks가 신규 생성
// 레코드부터는 항상 빈 문자열로 덮어써서 더 이상 평문이 새로 쌓이지
// 않게 한다. 기존에 이미 쌓인 프로덕션 레코드의 평문 e164 백필/제거는
// 별도 일회성 마이그레이션 작업으로 분리한다(이 커밋 범위 밖).
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("1fjkz4szfer124h")

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "e164hash01",
    "name": "e164_hash",
    "type": "text",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": { "min": null, "max": null, "pattern": "" }
  }))

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "e164enc001",
    "name": "e164_enc",
    "type": "text",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": { "min": null, "max": null, "pattern": "" }
  }))

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "e164last801",
    "name": "e164_last8",
    "type": "text",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": { "min": null, "max": null, "pattern": "" }
  }))

  // e164_hash 조회는 중복탐지 핫패스라 인덱스를 건다(e164 자체엔
  // 원래 인덱스가 없었다 — 이 참에 개선).
  collection.indexes = collection.indexes || []
  collection.indexes.push("CREATE INDEX idx_profiles_e164_hash ON profiles (e164_hash)")

  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("1fjkz4szfer124h")

  collection.schema.removeField("e164hash01")
  collection.schema.removeField("e164enc001")
  collection.schema.removeField("e164last801")
  collection.indexes = (collection.indexes || []).filter(
    (idx) => idx.indexOf("idx_profiles_e164_hash") === -1
  )

  return dao.saveCollection(collection)
})
