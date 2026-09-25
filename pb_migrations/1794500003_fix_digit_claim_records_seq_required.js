/// <reference path="../pb_data/types.d.ts" />
// 2026-09-26 신설 — 주피터 실사로 발견: digit_claim_records.seq(number, required:true)에
// PocketBase가 자기 자신의 최초 청구 레코드(seq=0)조차 "Missing required value"로 거절하고 있었다.
// PocketBase(ozzo-validation 기반)의 number 필드 required 검사는 "그 타입의 영값(0)"을 값이 아예 없는
// 것과 구분하지 못한다 — 0이 유효한 값인 이 필드에서는 항상 걸린다. 이 결함이 오늘 있었던 문자 인증
// 오거절 조사 전체를 통틀어 실제로는 처음부터 가려져 있던 별개의 원인이었다(문자 인증을 전부 통과해도
// 최초 등록(seq=0)은 이 필드 하나 때문에 마지막 저장 단계에서 계속 실패했다).
//
// 고치는 법: seq를 required:false로 바꾼다. 값이 없어도 되게 푸는 게 아니라, PocketBase의 "값이 있는데
// 0이라 없다고 오판하는" 결함을 피하는 것뿐이다 — 애플리케이션(hondi-digit-claim.js applyRecord)이 이미
// seq를 숫자로 강제하고, (serial, seq) 유니크 인덱스가 정합성을 그대로 지킨다. 실제 데이터 손실 위험 없음.
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("digitclaimrecs1")
  const field = collection.schema.getFieldById("dc02seq")
  field.required = false
  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("digitclaimrecs1")
  const field = collection.schema.getFieldById("dc02seq")
  field.required = true
  return dao.saveCollection(collection)
})
