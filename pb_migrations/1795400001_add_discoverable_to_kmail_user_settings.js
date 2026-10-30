/// <reference path="../pb_data/types.d.ts" />
// 2026-10-31 신설 — K-Mail 가입자 검색(주피터 지시: 검색을 허용한 가입자만).
// discoverable: 다른 가입자가 빠른 발송의 "받는 사람 검색"에서 나를 찾을 수 있게 허용했는가. 기본 꺼짐(false).
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0012usrst");
  collection.schema.addField(new SchemaField({
    "system": false, "id": "kus009discov", "name": "discoverable", "type": "bool",
    "required": false, "presentable": false, "unique": false, "options": {}
  }));
  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0012usrst");
  collection.schema.removeField("kus009discov");
  return dao.saveCollection(collection);
})
