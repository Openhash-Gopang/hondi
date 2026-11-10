/// <reference path="../pb_data/types.d.ts" />
// 2026-11-11 — 판결 이력 패널용 필드(klaw_sessions).
//   - case_no  : 사건번호(제목에 표시). 예: 2024도7082
//   - case_docs: 확보한 대법원·원심 판결문, 통합 판결문, 방법론 갱신 제안(JSON 문자열)
// 이미 같은 이름의 필드가 있으면(Admin UI로 먼저 추가한 경우) 건너뛴다.
migrate((db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId("kls0000session");
  if (!c.schema.getFieldByName("case_no")) {
    c.schema.addField(new SchemaField({
      "system": false, "id": "kls00000032", "name": "case_no", "type": "text",
      "required": false, "presentable": false, "unique": false,
      "options": { "min": null, "max": 40, "pattern": "" }
    }));
  }
  if (!c.schema.getFieldByName("case_docs")) {
    c.schema.addField(new SchemaField({
      "system": false, "id": "kls00000033", "name": "case_docs", "type": "text",
      "required": false, "presentable": false, "unique": false,
      "options": { "min": null, "max": 1000000, "pattern": "" }
    }));
  }
  return dao.saveCollection(c);
}, (db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId("kls0000session");
  c.schema.removeField("kls00000032");
  c.schema.removeField("kls00000033");
  return dao.saveCollection(c);
})
