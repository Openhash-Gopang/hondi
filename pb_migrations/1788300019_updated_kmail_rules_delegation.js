/// <reference path="../pb_data/types.d.ts" />
// 2026-09-03 신설 — docs/KPLAN_KMAIL_AGENT_TO_AGENT_ARCHITECTURE_v1_0_20260903.md
// §4-C(위임 정책)의 최초 구현. 기존 kmail_rules(자동삭제 규칙)와
// 완전히 같은 패턴을 재사용한다 — 자연어 문장을 그대로 저장하고,
// 판정 시점에 다른 AI가 그 문장을 읽고 수행(설계 원칙: "개발 초기엔
// 위임 문구를 단순하게, 점차 정련"). action에 'delegate_execute'를
// 추가하고, K-Plan 체크포인트 단위로 위임 범위를 좁힐 수 있도록
// kplan_plan_id/kplan_checkpoint_label을 선택 필드로 둔다 — 둘 다
// 비어있으면 이 사용자의 K-Mail 전체에 적용되는 전역 위임 규칙이다.
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0003rule");
  const actionField = collection.schema.getFieldByName("action");
  actionField.options.values = ["auto_delete", "delegate_execute"];
  collection.schema.addField(new SchemaField({
    "system": false, "id": "krl005plan", "name": "kplan_plan_id", "type": "text",
    "required": false, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" },
    "description": "비어있으면 이 사용자의 K-Mail 전체에 적용. 채워지면 그 K-Plan 플랜과 관련된 메일에만 이 위임이 적용된다.",
  }));
  collection.schema.addField(new SchemaField({
    "system": false, "id": "krl006chk", "name": "kplan_checkpoint_label", "type": "text",
    "required": false, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" },
  }));
  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0003rule");
  const actionField = collection.schema.getFieldByName("action");
  actionField.options.values = ["auto_delete"];
  collection.schema.removeField("krl005plan");
  collection.schema.removeField("krl006chk");
  return dao.saveCollection(collection);
})
