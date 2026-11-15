/// <reference path="../pb_data/types.d.ts" />
// 2026-11-15 신설 — 대화 상대 찾기 허용 여부를 이름·이메일 ID·전화번호 세 가지로 따로 정한다(주피터 지시).
//   name_findable : 이름(닉네임)으로 나를 찾도록 허용했는가(기본 꺼짐).
//   mail_hidden   : 이메일 ID로 찾히는 것을 막았는가(기본 꺼짐 = 이메일 ID로는 찾을 수 있음. 기존 가입자도 그대로 찾힌다).
//   phone_findable: (기존) 전화번호로 찾도록 허용했는가(기본 꺼짐).
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("1fjkz4szfer124h")
  collection.schema.addField(new SchemaField({
    "system": false, "id": "ffnamefnd01", "name": "name_findable", "type": "bool",
    "required": false, "presentable": false, "unique": false, "options": {}
  }))
  collection.schema.addField(new SchemaField({
    "system": false, "id": "ffmailhid001", "name": "mail_hidden", "type": "bool",
    "required": false, "presentable": false, "unique": false, "options": {}
  }))
  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("1fjkz4szfer124h")
  collection.schema.removeField("ffnamefnd01")
  collection.schema.removeField("ffmailhid001")
  return dao.saveCollection(collection)
})
