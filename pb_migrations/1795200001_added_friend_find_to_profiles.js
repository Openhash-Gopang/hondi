/// <reference path="../pb_data/types.d.ts" />
// 2026-10-28 신설 — 카카오톡 방식 대화 상대 찾기(주피터 지시).
//   search_id      : 사용자가 정한 "검색용 아이디"(소문자). 비어 있으면 아이디로는 찾을 수 없다. 값이 있으면 전체에서 유일.
//   phone_findable : 상대가 내 전화번호로 나를 찾도록 허용했는가(기본 꺼짐 = 허용 안 함).
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("1fjkz4szfer124h")

  collection.schema.addField(new SchemaField({
    "system": false, "id": "ffsearchid1", "name": "search_id", "type": "text",
    "required": false, "presentable": false, "unique": false,
    "options": { "min": null, "max": 40, "pattern": "" }
  }))
  collection.schema.addField(new SchemaField({
    "system": false, "id": "ffphonefnd1", "name": "phone_findable", "type": "bool",
    "required": false, "presentable": false, "unique": false, "options": {}
  }))

  collection.indexes = collection.indexes || []
  collection.indexes.push("CREATE UNIQUE INDEX idx_profiles_search_id ON profiles (search_id) WHERE search_id != ''")

  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("1fjkz4szfer124h")
  collection.schema.removeField("ffsearchid1")
  collection.schema.removeField("ffphonefnd1")
  collection.indexes = (collection.indexes || []).filter((idx) => idx.indexOf("idx_profiles_search_id") === -1)
  return dao.saveCollection(collection)
})
