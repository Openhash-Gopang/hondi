/// <reference path="../pb_data/types.d.ts" />
// ai_settlement_outbox — 2026-09-14 신설.
//
// 배경(사고실험으로 발견): worker.js의 callDeepSeek()은 AI 응답을 클라이언트에
// 반환한 뒤, 사용량 기록(_l1CreateUsageLog)과 실제 GDC 잔액 차감
// (_settleAiUsage → _chargeGdcForAiUsage)을 ctx.waitUntil()로 백그라운드
// 처리한다. 2026-08-14 주석에 이미 "ctx.waitUntil 없이는 51회 중 8회
// 유실"이 기록돼 있었고, ctx.waitUntil을 도입해 완화했지만 완전히 없애진
// 못했다 — 요청 자체가 오래 걸리면(예: 2026-09-14 GPS 역지오코딩 폭주로
// /deepseek이 20~60초까지 지연됐던 사고) 응답 반환 후 남은 waitUntil
// 유예 시간이 부족해 "waitUntil() tasks did not complete within the
// allowed time after invocation end" 경고와 함께 강제 취소되고, 그
// 턴의 사용량 기록·GDC 차감이 통째로 사라진다(조용한 매출 누락 +
// 감사 기록 공백, 실사 로그로 확인).
//
// 해결 방향(주피터님 지시, 2026-09-14): 채팅 응답 자체는 지연시키지
// 않되(waitUntil 방식 유지), 정산에 필요한 최소 정보를 응답 반환
// "직전"에 이 컬렉션에 status=pending으로 먼저 기록해둔다. 정상적으로
// waitUntil 작업이 끝까지 완료되면 status=settled로 갱신된다. 만약
// waitUntil이 취소돼 끝까지 못 갔다면 이 레코드가 pending인 채로
// 남으므로, 별도 크론 스윕(10분 주기, 기존 Merkle 앵커링 스윕과 동일
// 트리거)이 pending 레코드를 찾아 동일한 settlement_key(tx_hash)로
// 재정산을 시도한다 — /api/ai-charge가 이미 tx_hash 기준 멱등성을
// 보장하므로(pb_hooks/main.pb.js 참고), 재시도해도 이중 차감되지 않는다.
migrate((db) => {
  const collection = new Collection({
    "id": "ai0settle0outbox0001",
    "created": "2026-09-14 00:00:00.000Z",
    "updated": "2026-09-14 00:00:00.000Z",
    "name": "ai_settlement_outbox",
    "type": "base",
    "system": false,
    "schema": [
        {
            "system": false,
            "id": "aso100000001",
            "name": "guid",
            "type": "text",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" }
        },
        {
            "system": false,
            "id": "aso100000002",
            "name": "settlement_key",
            "type": "text",
            "required": true,
            "presentable": true,
            "unique": true,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "_chargeGdcForAiUsage가 /api/ai-charge에 보내는 tx_hash와 동일한 값 — 재시도 멱등성의 근거"
        },
        {
            "system": false,
            "id": "aso100000003",
            "name": "service_id",
            "type": "text",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" }
        },
        {
            "system": false,
            "id": "aso100000004",
            "name": "tier",
            "type": "text",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" }
        },
        {
            "system": false,
            "id": "aso100000005",
            "name": "model",
            "type": "text",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" }
        },
        {
            "system": false,
            "id": "aso100000006",
            "name": "hit_tokens",
            "type": "number",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": 0, "max": null }
        },
        {
            "system": false,
            "id": "aso100000007",
            "name": "miss_tokens",
            "type": "number",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": 0, "max": null }
        },
        {
            "system": false,
            "id": "aso100000008",
            "name": "out_tokens",
            "type": "number",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": 0, "max": null }
        },
        {
            "system": false,
            "id": "aso100000009",
            "name": "cost_krw",
            "type": "number",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": 0, "max": null }
        },
        {
            "system": false,
            "id": "aso100000010",
            "name": "billed_krw",
            "type": "number",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": 0, "max": null }
        },
        {
            "system": false,
            "id": "aso100000011",
            "name": "status",
            "type": "select",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": {
                "maxSelect": 1,
                "values": ["pending", "settled", "failed"]
            }
        },
        {
            "system": false,
            "id": "aso100000012",
            "name": "attempts",
            "type": "number",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": 0, "max": null }
        },
        {
            "system": false,
            "id": "aso100000013",
            "name": "extra_json",
            "type": "text",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "_recordAiUsage의 extraLogFields(meta) 등 원본 호출 컨텍스트를 JSON 문자열로 보존 — 스윕 재정산 시 그대로 재사용"
        },
        {
            "system": false,
            "id": "aso100000014",
            "name": "settled_at",
            "type": "date",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": "", "max": "" }
        }
    ],
    "indexes": [
        "CREATE UNIQUE INDEX idx_ai_settlement_outbox_key ON ai_settlement_outbox (settlement_key)",
        "CREATE INDEX idx_ai_settlement_outbox_status ON ai_settlement_outbox (status)",
        "CREATE INDEX idx_ai_settlement_outbox_guid ON ai_settlement_outbox (guid)"
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
  const collection = dao.findCollectionByNameOrId("ai0settle0outbox0001");

  return dao.deleteCollection(collection);
})
