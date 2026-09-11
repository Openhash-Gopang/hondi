/// <reference path="../pb_data/types.d.ts" />
// 2026-09-11 신설 — Mail SP ↔ 주소록 SP 협업 설계 논의에서 나온 요구:
// "저번에 보낸 캠페인에 회신한 사람들 중 긍정적 반응만 보여줘" 같은
// 캠페인 성격과 무관한(행사 초대든 아니든) 범용 질의를 받으려면,
// 기존 reply_classification(참석/불참/문의/기타/무응답 — 행사 초대
// 캠페인 전용 값)과는 별도로 캠페인 종류에 관계없이 항상 채울 수 있는
// 감정 축이 필요하다. 기존 필드를 고치는 대신 새 필드를 추가한다 —
// 과거 캠페인 데이터(참석/불참 값)를 깨뜨리지 않기 위함(phone/address
// 추가 때와 같은 원칙: 추가만 하고 기존 걸 건드리지 않는다).
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0018recip");
  collection.schema.addField(new SchemaField({
    "system": false, "id": "kcr017sent", "name": "reply_sentiment", "type": "select",
    "required": false, "presentable": true, "unique": false,
    "options": { "maxSelect": 1, "values": ["긍정", "부정", "중립"] },
    "description": "회신 내용의 전반적 어조 — reply_classification(행사 초대 전용: 참석/불참/문의)과 별도로, 캠페인 종류와 무관하게 항상 채워지는 범용 축. 다이제스트 생성 시 reply_classification과 같이 산출됨.",
  }));
  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0018recip");
  collection.schema.removeField("kcr017sent");
  return dao.saveCollection(collection);
})
