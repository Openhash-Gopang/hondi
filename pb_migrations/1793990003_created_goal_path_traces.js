/// <reference path="../pb_data/types.d.ts" />
// goal_path_traces — 2026-09-14 신설, Phase A(순수 기록)만.
//
// 배경: "여러 기관/부서/직책이 상호 독립적으로 운용되는데, 다기관 목표
// (예: 개인회생·개인파산, 10여 개 기관 관여)를 위한 최적 경로를 어떻게
// 수시로 갱신하나"는 설계 논의(2026-09-14)에서 나온 답의 1단계.
//
// ⚠️ 범위 제한(의도적, 주피터 지시): 이 마이그레이션은 실행 이력을
// "기록"만 한다. 원래 설계안에는 (B) goal_path_current(권장 경로 테이블)
// ·(C) 자동 스윕/DAWN 투표 갱신·(D) 기관 상향식 제안까지 포함됐지만,
// 재검토 결과 법률·금전이 걸린 고위험 목표에서 "경미한 최적화는 자동
// 반영"을 알고리즘이 판단하게 하는 게 위험하다고 판단해 전부 보류했다.
// 지금은 데이터를 쌓기만 하고, 그 데이터를 실제로 추천에 쓰는 로직은
// 아직 없다 — 몇 달 데이터가 쌓인 뒤 별도로 재설계한다. 개인회생·개인
// 파산처럼 이미 알려진 소수 고빈도·고위험 목표는 대신
// prompts/GOAL-PLAYBOOKS/(사람이 직접 쓴 플레이북)로 먼저 커버한다.
//
// 이 컬렉션에 쓰는 코드(_interceptGoalPathTrace, worker.js)도 아직
// 어떤 SP 프롬프트에도 [GOAL_TRACE_STEP: ...] 태그를 실제로 내보내라는
// 지시를 추가하지 않았다 — "준비는 됐지만 아직 켜지 않은" 상태다. 태그가
// 나타나면 파싱해서 저장할 준비만 돼 있다.
migrate((db) => {
  const collection = new Collection({
    "id": "gpt0traces0000001",
    "created": "2026-09-14 00:00:00.000Z",
    "updated": "2026-09-14 00:00:00.000Z",
    "name": "goal_path_traces",
    "type": "base",
    "system": false,
    "schema": [
        {
            "system": false, "id": "gpt100000001", "name": "goal_id", "type": "text",
            "required": true, "presentable": true, "unique": false,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "예: 'personal-bankruptcy-rehab' — prompts/GOAL-PLAYBOOKS/의 파일명과 대응"
        },
        {
            "system": false, "id": "gpt100000002", "name": "trace_id", "type": "text",
            "required": true, "presentable": true, "unique": false,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "세션 범위 UUID — 같은 목표를 향한 한 사용자의 한 여정을 묶는 키(여러 step 레코드가 같은 trace_id를 공유)"
        },
        {
            "system": false, "id": "gpt100000003", "name": "guid_hash", "type": "text",
            "required": false, "presentable": false, "unique": false,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "owner_pdv의 who_hash와 동일 원칙 — 원문 GUID 저장 금지, salt 해시만"
        },
        {
            "system": false, "id": "gpt100000004", "name": "agency_id", "type": "text",
            "required": true, "presentable": true, "unique": false,
            "options": { "min": null, "max": null, "pattern": "" }
        },
        {
            "system": false, "id": "gpt100000005", "name": "step_index", "type": "number",
            "required": false, "presentable": true, "unique": false,
            "options": { "min": 0, "max": null }
        },
        {
            "system": false, "id": "gpt100000006", "name": "outcome", "type": "select",
            "required": true, "presentable": true, "unique": false,
            "options": { "maxSelect": 1, "values": ["success", "rejected", "skipped", "retry"] }
        },
        {
            "system": false, "id": "gpt100000007", "name": "note", "type": "text",
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
  const collection = dao.findCollectionByNameOrId("gpt0traces0000001");
  return dao.deleteCollection(collection);
})
