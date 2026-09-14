/// <reference path="../pb_data/types.d.ts" />
// goal_path_candidates — 2026-09-15 신설. goal_path_traces를 집계해 발견한
// "새 경로 후보"가 여기 쌓인다. status 흐름:
//   pending_verification → (SP-PATH-VERIFIER) →
//     verification_failed(=끝, 후보 폐기) 또는
//     pending_admin_review → (인간 관리자) →
//       approved(=goal_path_current에 반영) 또는 rejected
// 이 컬렉션의 레코드는 어떤 단계에서도 시스템이 스스로 "approved"로
// 바꿀 수 없다 — 그 전이는 오직 인간 관리자의 명시적 승인 액션
// (POST /goal-path-guardian/approve)에서만 일어난다(worker.js 참고).
migrate((db) => {
  const collection = new Collection({
    "id": "gpc0candid0000001",
    "created": "2026-09-15 00:00:00.000Z",
    "updated": "2026-09-15 00:00:00.000Z",
    "name": "goal_path_candidates",
    "type": "base",
    "system": false,
    "schema": [
        {
            "system": false, "id": "gpc100000001", "name": "goal_id", "type": "text",
            "required": true, "presentable": true, "unique": false,
            "options": { "min": null, "max": null, "pattern": "" }
        },
        {
            "system": false, "id": "gpc100000002", "name": "proposed_sequence", "type": "text",
            "required": true, "presentable": true, "unique": false,
            "options": { "min": null, "max": 4000, "pattern": "" },
            "description": "JSON 배열 문자열 — [{agency_id, typical_duration_sec, notes}] 순서대로"
        },
        {
            "system": false, "id": "gpc100000003", "name": "basis_summary", "type": "text",
            "required": true, "presentable": true, "unique": false,
            "options": { "min": null, "max": 2000, "pattern": "" },
            "description": "이 후보를 만든 집계 근거 — sample_size, success_rate, avg_duration, 현재 goal_path_current와의 비교"
        },
        {
            "system": false, "id": "gpc100000004", "name": "sample_size", "type": "number",
            "required": false, "presentable": true, "unique": false,
            "options": { "min": 0, "max": null }
        },
        {
            "system": false, "id": "gpc100000005", "name": "status", "type": "select",
            "required": true, "presentable": true, "unique": false,
            "options": {
                "maxSelect": 1,
                "values": ["pending_verification", "verification_failed", "pending_admin_review", "approved", "rejected"]
            }
        },
        {
            "system": false, "id": "gpc100000006", "name": "verification_report", "type": "text",
            "required": false, "presentable": false, "unique": false,
            "options": { "min": null, "max": 4000, "pattern": "" },
            "description": "SP-PATH-VERIFIER의 산출물 — 통계적 타당성·기존 GOAL-PLAYBOOK 제약과의 모순 여부·확신도"
        },
        {
            "system": false, "id": "gpc100000007", "name": "verification_confidence", "type": "select",
            "required": false, "presentable": true, "unique": false,
            "options": { "maxSelect": 1, "values": ["high", "medium", "low"] }
        },
        {
            "system": false, "id": "gpc100000008", "name": "needs_special_review", "type": "bool",
            "required": false, "presentable": true, "unique": false, "options": {},
            "description": "금전·법률·개인정보·아동안전 등에 영향을 주는 변경이면 SP-PATH-VERIFIER가 true로 표시 — 관리자 화면에서 강조 표시용(승인 절차 자체는 이미 모든 후보에 동일하게 필요하므로 게이트를 추가로 걸지는 않음, 단지 검토 우선순위 신호)"
        },
        {
            "system": false, "id": "gpc100000009", "name": "reviewed_by", "type": "text",
            "required": false, "presentable": true, "unique": false,
            "options": { "min": null, "max": null, "pattern": "" }
        },
        {
            "system": false, "id": "gpc100000010", "name": "review_note", "type": "text",
            "required": false, "presentable": false, "unique": false,
            "options": { "min": null, "max": 2000, "pattern": "" }
        }
    ],
    "indexes": [
        "CREATE INDEX idx_goal_path_candidates_status ON goal_path_candidates (status)",
        "CREATE INDEX idx_goal_path_candidates_goal_id ON goal_path_candidates (goal_id)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
});

  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("gpc0candid0000001");
  return dao.deleteCollection(collection);
})
