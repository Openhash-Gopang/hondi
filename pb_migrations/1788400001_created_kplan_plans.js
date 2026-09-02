/// <reference path="../pb_data/types.d.ts" />
// 2026-09-02 신설 — K-Plan 플랜 영속화 컬렉션.
//
// 지금까지 K-Plan은 대화 세션 안에서만 존재했다 — kmail_campaigns의
// kplan_plan_id(1788300016 마이그레이션)는 사용자가 대화 중 임의로 붙이는
// 문자열일 뿐, 그 문자열이 가리키는 "플랜" 자체를 저장하는 곳이 없었다.
// 이 컬렉션이 그 실체다. plan_id 필드가 kmail_campaigns.kplan_plan_id와
// 같은 값 공간을 쓰도록 설계했다 — plan.hondi.net에서 플랜을 만들면
// 발급되는 plan_id를 K-Mail과의 대화에서 그대로 언급하면 두 컬렉션이
// 연결된다(K-Mail↔K-Plan 파이프라인, KPLAN_KMAIL_INTEGRATION_ARCHITECTURE_
// v1_0_20260902.md 참고).
//
// messages(json)에 전체 대화 이력(사용자 목표+실행방법 입력, AI 정련
// 결과, 각 체크포인트의 실행결과 피드백)을 누적 저장한다 — K-Recompose가
// 호출될 때마다 이 전체 이력을 다시 /kplan/relay에 실어 보내 문맥을
// 유지한다. refined_plan_md는 그중 가장 최근에 AI가 낸 정련된 계획서
// 원문만 별도로 뽑아둔 것 — 매번 messages 전체를 파싱하지 않고 바로
// 렌더링하기 위한 캐시 성격.
migrate((db) => {
  const collection = new Collection({
    "id": "kpl0000plans1",
    "created": "2026-09-02 00:00:00.000Z",
    "updated": "2026-09-02 00:00:00.000Z",
    "name": "kplan_plans",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false, "id": "kpf00000001", "name": "guid", "type": "text",
        "required": true, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" },
        "description": "플랜 소유자"
      },
      {
        "system": false, "id": "kpf00000002", "name": "plan_id", "type": "text",
        "required": true, "presentable": true, "unique": true,
        "options": { "min": null, "max": null, "pattern": "" },
        "description": "K-Mail 등 다른 K-서비스가 이 플랜을 참조할 때 쓰는 식별자. kmail_campaigns.kplan_plan_id와 같은 값 공간."
      },
      {
        "system": false, "id": "kpf00000003", "name": "title", "type": "text",
        "required": false, "presentable": true, "unique": false,
        "options": { "min": null, "max": 200, "pattern": "" }
      },
      {
        "system": false, "id": "kpf00000004", "name": "goal", "type": "text",
        "required": true, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" },
        "description": "사용자가 입력한 원래 목적·목표"
      },
      {
        "system": false, "id": "kpf00000005", "name": "messages", "type": "json",
        "required": false, "presentable": false, "unique": false,
        "options": { "maxSize": 2000000 },
        "description": "K-Intent~K-Recompose 전체 대화 이력(role/content 배열) — 다음 K-Recompose 호출 시 문맥으로 재사용"
      },
      {
        "system": false, "id": "kpf00000006", "name": "refined_plan_md", "type": "text",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" },
        "description": "가장 최근 AI 정련 결과(마크다운) — 렌더링용 캐시"
      },
      {
        "system": false, "id": "kpf00000007", "name": "checkpoint_count", "type": "number",
        "required": false, "presentable": true, "unique": false,
        "options": { "min": 0, "max": null, "noDecimal": true }
      },
      {
        "system": false, "id": "kpf00000008", "name": "status", "type": "select",
        "required": false, "presentable": true, "unique": false,
        "options": { "maxSelect": 1, "values": ["active", "completed", "abandoned"] }
      }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_kplan_plans_plan_id ON kplan_plans (plan_id)",
      "CREATE INDEX idx_kplan_plans_guid ON kplan_plans (guid)"
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
  const collection = dao.findCollectionByNameOrId("kpl0000plans1");

  return dao.deleteCollection(collection);
})
