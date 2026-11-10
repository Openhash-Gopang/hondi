/// <reference path="../pb_data/types.d.ts" />
// 2026-11-11 — 일치도 평가 결과를 이력(klaw_sessions)에 보존한다.
//   - match_report: 평가 보고서 전문 + 비교에 쓴 통합 판결문(부록)
//   - match_basis : 평가 기준 정보(JSON 문자열: 버전·초안 여부·평가 시각)
// 이미 같은 이름의 필드가 있으면(Admin UI로 먼저 추가한 경우) 건너뛴다.
migrate((db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId("kls0000session");
  if (!c.schema.getFieldByName("match_report")) {
    c.schema.addField(new SchemaField({
      "system": false, "id": "kls00000030", "name": "match_report", "type": "text",
      "required": false, "presentable": false, "unique": false,
      "options": { "min": null, "max": 250000, "pattern": "" }
    }));
  }
  if (!c.schema.getFieldByName("match_basis")) {
    c.schema.addField(new SchemaField({
      "system": false, "id": "kls00000031", "name": "match_basis", "type": "text",
      "required": false, "presentable": false, "unique": false,
      "options": { "min": null, "max": 600, "pattern": "" }
    }));
  }
  return dao.saveCollection(c);
}, (db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId("kls0000session");
  c.schema.removeField("kls00000030");
  c.schema.removeField("kls00000031");
  return dao.saveCollection(c);
})
