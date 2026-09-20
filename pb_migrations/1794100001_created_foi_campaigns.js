/// <reference path="../pb_data/types.d.ts" />
// foi_campaigns — 2026-09-20 신설. K-FOI(정보 공개 청구 SP, SP-28_kfoi)의 "청구 건".
//
// 한 건의 정보공개 청구 "캠페인"은 사용자가 얻고 싶은 정보의 목록(items)과, 그것을
// 얻기 위해 기관에 낸 청구 회차(rounds)로 이뤄진다. 청구는 대개 1회로 끝나지 않고
// 후속 청구로 이어지므로 회차를 한 레코드 안에 쌓는다(K-Mail의 kmail_campaigns가
// 메일 발송 단위를 한 레코드로 묶는 것과 같은 발상). 얻고 싶은 정보를 모두 얻으면
// 사용자가 "종료·보관"(status=closed)하고, 그때 share=shared를 고르면 이 레코드가
// 혼디 사용자 전체가 검색할 수 있는 공유 아카이브가 된다.
//
// 이 컬렉션은 Worker(src/worker/kfoi-handler.js)만 읽고 쓴다(모든 rule=null).
// 공유 아카이브로 나가는 응답은 handler의 archiveView() 허용목록 필드만 담는다 —
// owner_guid·goal·접수번호·메모·회차별 요약은 어떤 경로로도 다른 사용자에게 나가지 않는다.
//
// 청구인의 성명·주소·연락처는 이 컬렉션에 저장하지 않는다(브라우저에만 남는다).
migrate((db) => {
  const collection = new Collection({
    "id": "foi0001campaign",
    "created": "2026-09-20 00:00:00.000Z",
    "updated": "2026-09-20 00:00:00.000Z",
    "name": "foi_campaigns",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "fc01owner",   "name": "owner_guid",        "type": "text",   "required": true,  "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" }, "description": "청구 건을 만든 사용자 guid — 어떤 공개 응답에도 포함하지 않는다" },
      { "system": false, "id": "fc02title",   "name": "title",             "type": "text",   "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "fc03goal",    "name": "goal",              "type": "text",   "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" }, "description": "사용자가 처음 적은 요청 원문(비공개)" },
      { "system": false, "id": "fc04agency",  "name": "agency",            "type": "text",   "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "fc05dept",    "name": "dept",              "type": "text",   "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "fc06agkey",   "name": "agency_key",        "type": "text",   "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" }, "description": "공백·접미사를 정리한 기관 검색 키" },
      { "system": false, "id": "fc07status",  "name": "status",            "type": "select", "required": true,  "presentable": true,  "unique": false, "options": { "maxSelect": 1, "values": ["active", "closed"] }, "description": "closed = 종료·보관됨(아카이브)" },
      { "system": false, "id": "fc08share",   "name": "share",             "type": "select", "required": true,  "presentable": true,  "unique": false, "options": { "maxSelect": 1, "values": ["private", "shared"] }, "description": "shared이면서 status=closed인 건만 공유 아카이브에서 검색된다" },
      { "system": false, "id": "fc09items",   "name": "items",             "type": "json",   "required": false, "presentable": false, "unique": false, "options": {}, "description": "얻고 싶은 정보 목록 [{id,title,scope,state,note,source_url,round_seq,prior,archive_id}]" },
      { "system": false, "id": "fc10rounds",  "name": "rounds",            "type": "json",   "required": false, "presentable": false, "unique": false, "options": {}, "description": "청구 회차 [{seq,status,item_ids,receipt_no,received_at,decided_at,memo}]" },
      { "system": false, "id": "fc11sources", "name": "public_sources",    "type": "json",   "required": false, "presentable": false, "unique": false, "options": {}, "description": "이미 공개돼 있는 것으로 확인한 웹 자료 [{title,url,covers}]" },
      { "system": false, "id": "fc12search",  "name": "search_text",       "type": "text",   "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" }, "description": "아카이브 검색용(소문자) — 제목·기관·부서·항목명" },
      { "system": false, "id": "fc13summary", "name": "shared_summary",    "type": "text",   "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" }, "description": "공유 시 사용자가 검토·승인한 결과 요약(아카이브에 나가는 유일한 자유 서술)" },
      { "system": false, "id": "fc14closed",  "name": "closed_at",         "type": "date",   "required": false, "presentable": true,  "unique": false, "options": { "min": "", "max": "" } },
      { "system": false, "id": "fc15reason",  "name": "closed_reason",     "type": "text",   "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "fc16srcarch", "name": "source_archive_id", "type": "text",   "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" }, "description": "다른 사용자의 아카이브 건에서 가져와 시작한 경우 그 원본 id" }
    ],
    "indexes": [
      "CREATE INDEX idx_foi_campaigns_owner ON foi_campaigns (owner_guid)",
      "CREATE INDEX idx_foi_campaigns_archive ON foi_campaigns (status, share, closed_at)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("foi0001campaign");
  return dao.deleteCollection(collection);
})
