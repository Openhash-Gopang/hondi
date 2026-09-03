/// <reference path="../pb_data/types.d.ts" />
// 2026-09-04 신설 — 사고실험(혼디 필드 베타 홍보 캠페인)에서 나온
// 요구사항: 메일 회신뿐 아니라 "이 기관이 실제로 hondi.net에 접속
//했는가, PC로 왔는가 폰으로 왔는가"까지 수신자 단위로 측정한다.
// tracking_token은 캠페인 생성 시 수신자마다 하나씩 발급되는 무작위
// 문자열 — 캠페인 본문에 {{TRACKING_LINK}}로 삽입되면 발송 시점에
// https://hondi.net/r/<token> 형태의 실제 링크로 치환된다(worker.js
// _kmailSendCampaign 참고). GET /r/<token>이 클릭될 때마다 이 행에
// click_count를 올리고 최초 클릭 시각·기기를 기록한다.
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0018recip");
  collection.schema.addField(new SchemaField({
    "system": false, "id": "kcr013tok",  "name": "tracking_token", "type": "text",
    "required": false, "presentable": true, "unique": false, "options": { "min": null, "max": 64, "pattern": "" },
    "description": "캠페인 생성 시 발급되는 무작위 토큰. https://hondi.net/r/<token>으로 접속을 추적한다.",
  }));
  collection.schema.addField(new SchemaField({
    "system": false, "id": "kcr014clk",  "name": "click_count", "type": "number",
    "required": false, "presentable": true, "unique": false, "options": { "min": 0, "max": null, "noDecimal": true },
  }));
  collection.schema.addField(new SchemaField({
    "system": false, "id": "kcr015fca",  "name": "first_click_at", "type": "date",
    "required": false, "presentable": true, "unique": false, "options": { "min": "", "max": "" },
  }));
  collection.schema.addField(new SchemaField({
    "system": false, "id": "kcr016fcd",  "name": "first_click_device", "type": "select",
    "required": false, "presentable": true, "unique": false,
    "options": { "maxSelect": 1, "values": ["pc", "mobile", "unknown"] },
  }));
  collection.indexes = [
    ...collection.indexes,
    "CREATE INDEX idx_kmail_campaign_recipients_token ON kmail_campaign_recipients (tracking_token)",
  ];
  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0018recip");
  collection.schema.removeField("kcr013tok");
  collection.schema.removeField("kcr014clk");
  collection.schema.removeField("kcr015fca");
  collection.schema.removeField("kcr016fcd");
  return dao.saveCollection(collection);
})
