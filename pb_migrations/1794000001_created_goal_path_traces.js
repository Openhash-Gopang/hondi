/// <reference path="../pb_data/types.d.ts" />
// goal_path_traces — 2026-09-15 신설.
//
// 배경: "여러 기관/부서/직책이 상호 독립적으로 운용되는데, 다기관 목표
// (예: 개인회생·개인파산, 10여 개 기관 관여)를 위한 최적 경로를 어떻게
// 수시로 갱신하나"는 설계 논의(2026-09-14~15)의 최종 결정판.
//
// ★ 범위(주피터 지시, 2026-09-15) — 이전 초안(Phase A만, 법률·금전
// 도메인 제외)은 되돌려졌다. 이번 버전은 **모든 도메인에 적용**한다 —
// 안전장치는 "위험 도메인은 자동화 제외"가 아니라 "새 경로는 자기검증
// (SP-PATH-VERIFIER) 통과 후에도 반드시 인간 관리자 승인을 거쳐야만
// goal_path_current(실제 사용되는 경로)에 반영된다"는 2단계 게이트로
// 대체됐다. 이 컬렉션 자체는 그 파이프라인의 원재료(실행 이력)만 쌓고,
// 아무것도 자동으로 적용하지 않는다 — goal_path_candidates→
// goal_path_current 파이프라인 참고.
migrate((db) => {
  const collection = new Collection({
    "id": "gpt0traces0000002",
    "created": "2026-09-15 00:00:00.000Z",
    "updated": "2026-09-15 00:00:00.000Z",
    "name": "goal_path_traces",
    "type": "base",
    "system": false,
    "schema": [
        {
            "system": false, "id": "gpt200000001", "name": "goal_id", "type": "text",
            "required": true, "presentable": true, "unique": false,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "예: 'personal-bankruptcy-rehab' — prompts/GOAL-PLAYBOOKS/의 파일명과 대응(있는 경우)"
        },
        {
            "system": false, "id": "gpt200000002", "name": "trace_id", "type": "text",
            "required": true, "presentable": true, "unique": false,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "세션 범위 UUID — 같은 목표를 향한 한 사용자의 한 여정을 묶는 키"
        },
        {
            "system": false, "id": "gpt200000003", "name": "guid_hash", "type": "text",
            "required": false, "presentable": false, "unique": false,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "owner_pdv의 who_hash와 동일 원칙 — 원문 GUID 저장 금지, salt 해시만"
        },
        {
            "system": false, "id": "gpt200000004", "name": "agency_id", "type": "text",
            "required": true, "presentable": true, "unique": false,
            "options": { "min": null, "max": null, "pattern": "" }
        },
        {
            "system": false, "id": "gpt200000005", "name": "step_index", "type": "number",
            "required": false, "presentable": true, "unique": false,
            "options": { "min": 0, "max": null }
        },
        {
            "system": false, "id": "gpt200000006", "name": "outcome", "type": "select",
            "required": true, "presentable": true, "unique": false,
            "options": { "maxSelect": 1, "values": ["success", "rejected", "skipped", "retry"] }
        },
        {
            "system": false, "id": "gpt200000007", "name": "note", "type": "text",
            "required": false, "presentable": false, "unique": false,
            "options": { "min": null, "max": 500, "pattern": "" },
            "description": "반려 사유 등 짧은 메모 — 원문 대화 저장 금지(U5 개인정보 원칙 상속), 요지만"
        }
    ],
    "indexes": [
        "CREATE INDEX idx_goal_path_traces_goal_id ON goal_path_traces (goal_id)",
        "CREATE INDEX idx_goal_path_traces_trace_id ON goal_path_traces (trace_id)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
});

  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("gpt0traces0000002");
  return dao.deleteCollection(collection);
})
