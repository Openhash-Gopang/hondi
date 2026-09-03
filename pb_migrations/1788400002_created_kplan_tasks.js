/// <reference path="../pb_data/types.d.ts" />
// 2026-09-03 신설 — K-Plan 작업 보드(kplan_tasks).
//
// Vikunja/Kanboard 스키마를 참고해 필드를 정형화했다(단일 바이너리+
// SQLite 기반 셀프호스팅 도구들이라 혼디 인프라 철학과 맞음 — 직접
// 셀프호스팅하지는 않고, 필드 설계만 참고).
//
// 범위: 순수 태스크 관리만. K-Mail 캠페인 연동(kmail_campaign_recipients
// 등)은 이번 마이그레이션에 포함하지 않는다 — K-Mail은 별도 프로젝트로
// 다뤄, 필요한 작업은 별도 지시서로 넘긴다(주피터 지시, 2026-09-03).
// 나중에 연동이 필요해지면 kplan_tasks.plan_id로 kmail_campaigns.
// kplan_plan_id를 필터링해 붙이는 식으로 확장 가능하도록 plan_id 필드는
// 처음부터 kplan_plans.plan_id와 같은 값 공간을 쓰게 설계해뒀다.
migrate((db) => {
  const collection = new Collection({
    "id": "kpltask0001",
    "created": "2026-09-03 00:00:00.000Z",
    "updated": "2026-09-03 00:00:00.000Z",
    "name": "kplan_tasks",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false, "id": "kptf0000001", "name": "guid", "type": "text",
        "required": true, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" },
        "description": "작업 소유자"
      },
      {
        "system": false, "id": "kptf0000002", "name": "plan_id", "type": "text",
        "required": true, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" },
        "description": "kplan_plans.plan_id — 어느 플랜에 속한 작업인지"
      },
      {
        "system": false, "id": "kptf0000003", "name": "title", "type": "text",
        "required": true, "presentable": true, "unique": false,
        "options": { "min": null, "max": 200, "pattern": "" }
      },
      {
        "system": false, "id": "kptf0000004", "name": "description", "type": "text",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "kptf0000005", "name": "status", "type": "select",
        "required": true, "presentable": true, "unique": false,
        "options": { "maxSelect": 1, "values": ["backlog", "todo", "in_progress", "in_review", "done"] }
      },
      {
        "system": false, "id": "kptf0000006", "name": "priority", "type": "select",
        "required": false, "presentable": true, "unique": false,
        "options": { "maxSelect": 1, "values": ["low", "medium", "high", "urgent"] }
      },
      {
        "system": false, "id": "kptf0000007", "name": "labels", "type": "json",
        "required": false, "presentable": false, "unique": false,
        "options": { "maxSize": 5000 },
        "description": "문자열 배열, 예: [\"마케팅\",\"1단계\"]"
      },
      {
        "system": false, "id": "kptf0000008", "name": "due_date", "type": "date",
        "required": false, "presentable": true, "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false, "id": "kptf0000009", "name": "progress", "type": "number",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": 0, "max": 100, "noDecimal": true }
      },
      {
        "system": false, "id": "kptf0000010", "name": "order_index", "type": "number",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "noDecimal": true },
        "description": "같은 status 컬럼 안에서의 정렬 순서"
      }
    ],
    "indexes": [
      "CREATE INDEX idx_kplan_tasks_plan_id ON kplan_tasks (plan_id)",
      "CREATE INDEX idx_kplan_tasks_guid ON kplan_tasks (guid)"
    ],
    "listRule": null,
    "viewRule": null,
    "createRule": null,
    "updateRule": null,
    "deleteRule": null,
    "options": {}
  });

  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kpltask0001");

  return dao.deleteCollection(collection);
})
