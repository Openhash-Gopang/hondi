/// <reference path="../pb_data/types.d.ts" />
// 2026-09-04 신설 — docs/KPLAN_KMAIL_AGENT_TO_AGENT_ARCHITECTURE_v1_0_
// 20260903.md §7-3(재고·영업시간 같은 실시간 상태 조회, 미해결로
// 남아있던 항목)의 최소 구현. 짜장면집 사고실험(주피터 예시)의 "지금
// 재고가 있는가"를 K-Plan이 참조할 수 있게 하는 범용 key-value
// 저장소다. K-JIT 같은 전용 모듈이 아직 없으므로, 지금은 사람이나
// 어떤 외부 연동이든 이 컬렉션에 값을 써넣기만 하면 K-Plan의
// 판단(_kplanDecideForKMail)이 자동으로 참조한다 — 값을 채우는
// 주체(사람 수동 입력 vs 미래의 K-JIT 자동 연동)를 구분하지 않는
// 설계라, 나중에 K-JIT이 생기면 이 컬렉션에 쓰는 것만으로 바로
// 연동된다. key는 자유 문자열("재고", "영업시간" 등) — 스키마를
// 미리 정하지 않는다(설계 원칙: 초기엔 단순하게, 점차 정련).
migrate((db) => {
  const collection = new Collection({
    "id": "kmc0021state",
    "created": "2026-09-04 00:00:00.000Z",
    "updated": "2026-09-04 00:00:00.000Z",
    "name": "kplan_plan_state",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "kps001owner", "name": "owner_user_guid", "type": "text", "required": true, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "kps002plan",  "name": "plan_id",         "type": "text", "required": true, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "kps003key",   "name": "state_key",       "type": "text", "required": true, "presentable": true, "unique": false, "options": { "min": null, "max": 100, "pattern": "" }, "description": "자유 문자열 — 예: '재고', '영업시간'" },
      { "system": false, "id": "kps004val",   "name": "state_value",     "type": "text", "required": true, "presentable": true, "unique": false, "options": { "min": null, "max": 1000, "pattern": "" } },
      { "system": false, "id": "kps005src",   "name": "source",          "type": "text", "required": false, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" }, "description": "누가/무엇이 이 값을 갱신했는지(예: 'user', 'k-jit'). 후속 K-JIT 연동 시 출처 구분용." }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_kplan_plan_state_key ON kplan_plan_state (plan_id, state_key)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0021state");
  return dao.deleteCollection(collection);
})
