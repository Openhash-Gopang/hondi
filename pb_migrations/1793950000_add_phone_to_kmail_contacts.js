/// <reference path="../pb_data/types.d.ts" />
// 2026-09-11 신설 — 주소록을 표(테이블)로 구성할 때 전화번호도 쓸 수
// 있도록 필드 추가(주피터 지시: "소속·직위·이름·이메일·전화번호 등
// 가용한 데이터로 테이블을 구성"). 지금까지는 스키마에 전화번호
// 자체가 없어서 K-Mail·K-Address 어느 쪽도 저장할 방법이 없었다.
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0001contact");
  collection.schema.addField(new SchemaField({
    "system": false, "id": "kmc011phone", "name": "phone", "type": "text",
    "required": false, "presentable": true, "unique": false,
    "options": { "min": null, "max": null, "pattern": "" },
  }));
  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0001contact");
  collection.schema.removeField("kmc011phone");
  return dao.saveCollection(collection);
})
