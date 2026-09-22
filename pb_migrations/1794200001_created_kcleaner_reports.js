/// <reference path="../pb_data/types.d.ts" />
// kcleaner_reports — 2026-09-22 신설. K-Clean(clean.hondi.net, 구 fiil.kr)
// 신고 저장소. state.js에 남아 있던 TODO(주피터) 해소 — fiil-kcleaner의
// reports 테이블(Supabase, 이미 2026-08-12 시크릿 스캔에서 노출 확인된
// anon key로 클라이언트가 직접 호출하고 있었음)을 대체한다.
//
// citizen_reports(2026-08-11 신설, 교통위반·바가지요금 등 시민 신고)와
// 같은 컨벤션 — Worker(worker.js의 handleKCleanerReport*)만 admin 토큰으로
// 읽고 쓴다(rule=null 전부). report_code는 클라이언트가 만드는 사람이 읽는
// 접수번호("RPT-2026-0000")이고, PocketBase 자체 시스템 id와는 별개다.
//
// reported_at/approved_at은 date 필드가 아니라 text로 둔다 — 클라이언트가
// 순수 UTC(Z)가 아니라 KST 오프셋(+09:00)이 붙은 ISO 문자열을 그대로
// 저장해왔고(_nowKST()), PocketBase의 date 필드 검증이 그 포맷을 거부할
// 위험을 피하기 위함이다.
//
// approved_at/approved_cost/income_before_tax는 dashboard.html·
// budget.html·report.html의 승인/정산 플로우(2단계, 아직 Worker 이관
// 전) 대비용 — 지금은 존재만 하고 아무 것도 채우지 않는다.
migrate((db) => {
  const collection = new Collection({
    "id": "kclean01reports",
    "created": "2026-09-22 00:00:00.000Z",
    "updated": "2026-09-22 00:00:00.000Z",
    "name": "kcleaner_reports",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "kc01code",   "name": "report_code",       "type": "text",   "required": true,  "presentable": true,  "unique": true,  "options": { "min": null, "max": null, "pattern": "" }, "description": "사람이 읽는 접수번호(RPT-2026-0000) — PocketBase 시스템 id와 별개" },
      { "system": false, "id": "kc02guid",   "name": "user_guid",         "type": "text",   "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" }, "description": "혼디 계정 guid — 없으면 익명 신고" },
      { "system": false, "id": "kc03type",   "name": "type",              "type": "text",   "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "kc04tcode",  "name": "type_code",         "type": "text",   "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" }, "description": "SP 코드(SP-14 등)" },
      { "system": false, "id": "kc05loc",    "name": "location",          "type": "text",   "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "kc06gps",    "name": "gps",               "type": "text",   "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "kc07rpat",   "name": "reported_at",       "type": "text",   "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" }, "description": "ISO+KST 오프셋 문자열 — date 타입 아님(위 설명 참고)" },
      { "system": false, "id": "kc08urg",    "name": "urgency",           "type": "text",   "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "kc09stat",   "name": "status",            "type": "text",   "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" }, "description": "접수/처리중/완료/승인 등 — enum 고정하지 않음(budget.html이 '승인' 사용)" },
      { "system": false, "id": "kc10img",    "name": "image_url",         "type": "text",   "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "kc11cost",   "name": "cost",              "type": "json",   "required": false, "presentable": false, "unique": false, "options": {} },
      { "system": false, "id": "kc12disp",   "name": "dispatch",          "type": "json",   "required": false, "presentable": false, "unique": false, "options": {} },
      { "system": false, "id": "kc13anal",   "name": "analysis",          "type": "json",   "required": false, "presentable": false, "unique": false, "options": {} },
      { "system": false, "id": "kc14apat",   "name": "approved_at",       "type": "text",   "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" }, "description": "2단계(관리자 승인 플로우 이관) 대비 — 아직 미사용" },
      { "system": false, "id": "kc15apcost", "name": "approved_cost",     "type": "number", "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "noDecimal": false }, "description": "2단계 대비 — 아직 미사용" },
      { "system": false, "id": "kc16inctax", "name": "income_before_tax", "type": "number", "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "noDecimal": false }, "description": "2단계 대비 — 아직 미사용" }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_kcleaner_reports_code ON kcleaner_reports (report_code)",
      "CREATE INDEX idx_kcleaner_reports_guid ON kcleaner_reports (user_guid)",
      "CREATE INDEX idx_kcleaner_reports_status ON kcleaner_reports (status, reported_at)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kclean01reports");
  return dao.deleteCollection(collection);
})
