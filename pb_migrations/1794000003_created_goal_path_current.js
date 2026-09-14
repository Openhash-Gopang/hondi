/// <reference path="../pb_data/types.d.ts" />
// goal_path_current — 2026-09-15 신설. K-Compose 등이 실제로 참조하는
// "현재 권장 경로" 단일 진실 공급원. 이 컬렉션에 쓰는 코드는 오직
// handleGoalPathApprove(worker.js) 하나뿐이다 — 관리자가
// goal_path_candidates의 한 후보를 승인할 때만 갱신되며, 스윕이나
// SP-PATH-VERIFIER가 직접 쓰지 않는다(둘 다 goal_path_candidates까지만
// 관여). goal_id당 레코드 1건을 유지하는 게 원칙(새 승인이 오면 기존
// 레코드를 갱신 — 이력은 goal_path_candidates.status='approved' 레코드
// 자체가 감사 로그 역할을 한다).
migrate((db) => {
  const collection = new Collection({
    "id": "gpc0current0000001",
    "created": "2026-09-15 00:00:00.000Z",
    "updated": "2026-09-15 00:00:00.000Z",
    "name": "goal_path_current",
    "type": "base",
    "system": false,
    "schema": [
        {
            "system": false, "id": "gpcur0000001", "name": "goal_id", "type": "text",
            "required": true, "presentable": true, "unique": true,
            "options": { "min": null, "max": null, "pattern": "" }
        },
        {
            "system": false, "id": "gpcur0000002", "name": "recommended_sequence", "type": "text",
            "required": true, "presentable": true, "unique": false,
            "options": { "min": null, "max": 4000, "pattern": "" },
            "description": "JSON 배열 문자열 — [{agency_id, typical_duration_sec, notes}]"
        },
        {
            "system": false, "id": "gpcur0000003", "name": "confidence_score", "type": "number",
            "required": false, "presentable": true, "unique": false,
            "options": { "min": 0, "max": 1 }
        },
        {
            "system": false, "id": "gpcur0000004", "name": "sample_size", "type": "number",
            "required": false, "presentable": true, "unique": false,
            "options": { "min": 0, "max": null }
        },
        {
            "system": false, "id": "gpcur0000005", "name": "source_candidate_id", "type": "text",
            "required": false, "presentable": true, "unique": false,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "이 값을 만들어낸 goal_path_candidates 레코드 id — 감사 추적용"
        },
        {
            "system": false, "id": "gpcur0000006", "name": "approved_by", "type": "text",
            "required": true, "presentable": true, "unique": false,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "승인한 인간 관리자 계정 — 이 필드가 비어 있는 레코드는 존재할 수 없다(코드가 강제)"
        },
        {
            "system": false, "id": "gpcur0000007", "name": "version", "type": "number",
            "required": false, "presentable": true, "unique": false,
            "options": { "min": 1, "max": null },
            "description": "이 goal_id가 승인 갱신된 횟수"
        }
    ],
    "indexes": [
        "CREATE UNIQUE INDEX idx_goal_path_current_goal_id ON goal_path_current (goal_id)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
});

  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("gpc0current0000001");
  return dao.deleteCollection(collection);
})
