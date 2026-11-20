/// <reference path="../pb_data/types.d.ts" />
// 2026-11-21 신설 — 사용 분야(주피터 지시). 요청 본문의 usage_field(없으면 요청 사이트로 짐작)를 남겨, 설정 › GDC 지갑이
// 서류 작성·전문가 AI(피부과 등)별로 사용량을 보여 줄 수 있게 한다. 비어 있으면 service_id 로만 구분한다.
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("a1u5g3l0g0000n1")
  collection.schema.addField(new SchemaField({
    "system": false, "id": "aulfield00001", "name": "field", "type": "text",
    "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": 40, "pattern": "" }
  }))
  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("a1u5g3l0g0000n1")
  collection.schema.removeField("aulfield00001")
  return dao.saveCollection(collection)
})
