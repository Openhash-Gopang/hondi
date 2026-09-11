/// <reference path="../pb_data/types.d.ts" />
// 2026-09-11 신설 — 주소록 칼럼 확장(주피터 지시). phone에 이어
// address(우편/방문 주소)·website(개인·연구실 홈페이지 — source_url은
// "어디서 이 정보를 찾았는지"이지 본인 웹사이트가 아니라 별도 필드가
// 필요했음)·notes(자유 메모)를 추가한다.
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0001contact");
  collection.schema.addField(new SchemaField({
    "system": false, "id": "kmc012addr", "name": "address", "type": "text",
    "required": false, "presentable": true, "unique": false,
    "options": { "min": null, "max": null, "pattern": "" },
  }));
  collection.schema.addField(new SchemaField({
    "system": false, "id": "kmc013web", "name": "website", "type": "url",
    "required": false, "presentable": true, "unique": false,
    "options": {},
  }));
  collection.schema.addField(new SchemaField({
    "system": false, "id": "kmc014notes", "name": "notes", "type": "text",
    "required": false, "presentable": false, "unique": false,
    "options": { "min": null, "max": null, "pattern": "" },
  }));
  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0001contact");
  collection.schema.removeField("kmc012addr");
  collection.schema.removeField("kmc013web");
  collection.schema.removeField("kmc014notes");
  return dao.saveCollection(collection);
})
