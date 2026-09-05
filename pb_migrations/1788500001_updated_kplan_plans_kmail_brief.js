/// <reference path="../pb_data/types.d.ts" />
// 2026-09-05 신설 — K-Plan→K-Mail 함수 수준 핸드오프(§9).
//
// 배경: docs/KPLAN_KMAIL_AGENT_TO_AGENT_ARCHITECTURE_v1_0_20260903.md §9는
// "이 브리프는 §7의 함수 수준 API와 같은 방식(같은 Worker 내 함수 호출)으로
// K-Mail에 전달된다"고 명시했지만, 실제로는 K-Mail→K-Plan 방향
// (_kplanDecideForKMail, _kmailTriggerKPlanRecompose)만 구현돼 있었고
// K-Plan→K-Mail 방향은 코드가 전혀 없었다 — K-Plan의 SP(§9)는 "K-Mail에
// 넘긴다"고만 지시할 뿐 실제로 넘길 방법이 없어, 실사에서 K-Plan이
// "K-Mail에 접속할 수 없다"며 스스로 메일 초안까지 작성해버리는(전략/
// 전술 분리 위반) 문제가 재현됨(주피터 지시로 발견).
//
// 이 마이그레이션은 그 빠진 절반을 메운다 — K-Plan이 브리프를 여기
// 적어두면(_kplanIssueBriefToKMail), 사용자가 mail.hondi.net에서 새
// K-Mail 대화를 시작하는 첫 턴에 handleKmailChat이 이 필드를 조회해
// 자동으로 대화 맥락에 주입하고 'consumed'로 표시한다(worker.js 참고).
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kpl0000plans1");
  collection.schema.addField(new SchemaField({
    "system": false, "id": "kpf00000009", "name": "kmail_brief_text", "type": "text",
    "required": false, "presentable": false, "unique": false,
    "options": { "min": null, "max": 8000, "pattern": "" },
    "description": "K-Plan이 K-Execute 단계에서 K-Mail에 넘기는 육하원칙 정형 브리프 원문(전략 수준까지만 — 회차·일정·문구 같은 전술은 포함하지 않음).",
  }));
  collection.schema.addField(new SchemaField({
    "system": false, "id": "kpf00000010", "name": "kmail_brief_status", "type": "select",
    "required": false, "presentable": true, "unique": false,
    "options": { "maxSelect": 1, "values": ["pending", "consumed"] },
    "description": "pending=K-Mail이 아직 안 읽음, consumed=K-Mail 새 대화 시작 시 이미 주입·소비됨(같은 브리프가 두 번 자동 주입되지 않도록).",
  }));
  collection.schema.addField(new SchemaField({
    "system": false, "id": "kpf00000011", "name": "kmail_brief_issued_at", "type": "date",
    "required": false, "presentable": false, "unique": false,
    "options": { "min": "", "max": "" },
  }));
  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kpl0000plans1");
  collection.schema.removeField("kpf00000009");
  collection.schema.removeField("kpf00000010");
  collection.schema.removeField("kpf00000011");
  return dao.saveCollection(collection);
})
