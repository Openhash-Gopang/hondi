/// <reference path="../pb_data/types.d.ts" />
// 2026-09-04 신설 — docs/KPLAN_KMAIL_AGENT_TO_AGENT_ARCHITECTURE_v1_0_
// 20260903.md §6-2(스레드 단위 상태 모델, 미해결로 남아있던 항목)의
// 최소 구현. 완전히 새로운 kmail_threads 컬렉션을 만드는 대신, 이미
// "사람 1명 × 캠페인 1건"을 가리키고 있던 kmail_campaign_recipients를
// 스레드 단위로 취급한다 — 회신 매칭(§SP v1.8)이 이미 이 레코드
// 단위로 이뤄지고 있어 자연스러운 확장이다. thread_status는 지금
// 이 상대와의 대화가 어느 상태인지(추가 인바운드가 왔을 때 K-Mail이
// 참고)를 나타낸다.
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0018recip");
  collection.schema.addField(new SchemaField({
    "system": false, "id": "kcr012thst", "name": "thread_status", "type": "select",
    "required": false, "presentable": true, "unique": false,
    "options": { "maxSelect": 1, "values": ["open", "pending_kplan", "pending_human", "resolved"] },
    "description": "open=회신 대기/일반 진행 중, pending_kplan=K-Plan 사전질의 응답 대기, pending_human=사람 에스컬레이션 대기, resolved=이 스레드는 종결(위임 승인 처리 완료 등)",
  }));
  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0018recip");
  collection.schema.removeField("kcr012thst");
  return dao.saveCollection(collection);
})
