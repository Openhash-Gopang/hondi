/// <reference path="../pb_data/types.d.ts" />
// 2026-11-16 신설 — 가입 유형과 본명(주피터 지시). 전화번호·신분증 본인 인증의 바탕이 되는 값이다(신분증 번호 같은 식별번호는 저장하지 않는다).
//   account_type       : 가입 유형 — person(개인) / org(기관) / dept(부서) / biz(사업자) / other(기타). 비어 있으면 기존 가입자(개인으로 본다).
//   real_name          : 본명. 기관·부서·사업자·기타는 그 명칭(기관명·부서명·상호). 본인 인증 전에는 '입력한 값'일 뿐이다.
//   real_name_findable : 본명으로 나를 찾도록 허용했는가(기본 꺼짐). 허용한 경우에만, 정확히 같을 때만 검색된다.
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("1fjkz4szfer124h")
  collection.schema.addField(new SchemaField({
    "system": false, "id": "acctype00001", "name": "account_type", "type": "text",
    "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": 12, "pattern": "" }
  }))
  collection.schema.addField(new SchemaField({
    "system": false, "id": "realname00001", "name": "real_name", "type": "text",
    "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": 60, "pattern": "" }
  }))
  collection.schema.addField(new SchemaField({
    "system": false, "id": "rnfind000001", "name": "real_name_findable", "type": "bool",
    "required": false, "presentable": false, "unique": false, "options": {}
  }))
  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("1fjkz4szfer124h")
  collection.schema.removeField("acctype00001")
  collection.schema.removeField("realname00001")
  collection.schema.removeField("rnfind000001")
  return dao.saveCollection(collection)
})
