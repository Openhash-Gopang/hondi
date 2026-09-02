/// <reference path="../pb_data/types.d.ts" />
// 2026-09-02 신설 — K-Mail↔K-Plan 데이터 파이프라인(K-Recompose 트리거용).
// 캠페인이 어떤 K-Plan 플랜의 어느 체크포인트에 해당하는지 표시하는
// 필드 2개를 추가한다. 둘 다 optional — K-Plan과 무관한 일반 K-Mail
// 캠페인(예: 개인 메일 발송)은 이 필드 없이 그대로 동작한다. worker.js의
// _kmailGenerateDigest가 다이제스트 생성 후 kplan_plan_id가 채워진
// 캠페인만 골라 K-Recompose를 트리거한다(kplan-recompose-trigger.patch
// 참고) — 일반 캠페인의 기존 동작에는 영향 없음.
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0002campaign");
  collection.schema.addField(new SchemaField({
    "system": false, "id": "kcp012kpid", "name": "kplan_plan_id", "type": "text",
    "required": false, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" },
    "description": "이 캠페인이 속한 K-Plan 플랜의 식별자(사용자가 K-Plan과의 대화에서 부여한 임의 문자열, 예: 'hondi-kmail-campaign-2026-09'). 비어있으면 K-Plan과 무관한 일반 캠페인.",
  }));
  collection.schema.addField(new SchemaField({
    "system": false, "id": "kcp013kplbl", "name": "kplan_checkpoint_label", "type": "text",
    "required": false, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" },
    "description": "K-Compose가 이 캠페인을 위해 미리 지정한 체크포인트 라벨(예: '트랙 B 회신 마감'). kplan_plan_id가 있을 때만 의미를 가짐.",
  }));
  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0002campaign");
  collection.schema.removeField("kcp012kpid");
  collection.schema.removeField("kcp013kplbl");
  return dao.saveCollection(collection);
})
