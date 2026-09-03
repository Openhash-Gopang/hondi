/// <reference path="../pb_data/types.d.ts" />
// 2026-09-03 신설 — 사용자가 "혼디 마케팅 캠페인" 같은 이름을 붙여
// 여러 검색·발송 단계를 아우르는 캠페인을 지칭할 수 있게 title 필드를
// 추가한다. subject(메일 제목)와는 별개 — subject는 수신자가 받는
// 메일의 제목이고, title은 사용자가 나중에 "그 캠페인"이라고 부를 때
// 쓰는 내부 식별용 이름이다(비어있으면 subject로 대체 표시).
// closed_at은 KMAIL_CAMPAIGN_REPORT(§2-11)가 사용자 요청으로 캠페인을
// "종료"할 때 찍는 타임스탬프 — digest_status와 별개 개념이다: digest는
// 자동 회신취합 완료 여부, closed_at은 사용자가 명시적으로 "이제 이
// 캠페인 끝"이라고 선언한 시점이다.
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0002campaign");
  collection.schema.addField(new SchemaField({
    "system": false, "id": "kcp014title", "name": "title", "type": "text",
    "required": false, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" },
    "description": "사용자가 붙인 캠페인 이름(예: '혼디 마케팅 캠페인'). 비어있으면 subject로 대체 표시.",
  }));
  collection.schema.addField(new SchemaField({
    "system": false, "id": "kcp015closed", "name": "closed_at", "type": "date",
    "required": false, "presentable": true, "unique": false, "options": { "min": "", "max": "" },
    "description": "사용자가 KMAIL_CAMPAIGN_REPORT로 명시적으로 캠페인을 종료 처리한 시각. 비어있으면 아직 진행 중으로 취급.",
  }));
  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0002campaign");
  collection.schema.removeField("kcp014title");
  collection.schema.removeField("kcp015closed");
  return dao.saveCollection(collection);
})
