/// <reference path="../pb_data/types.d.ts" />
// 2026-10-28 신설 — 대화 신호(webrtc_signals) 위조 방지의 2단계: 단말이 L1 에 직접 쓰는 길을 닫는다.
// 1단계(워커 /signal/* 가 로그인 증명을 확인하고 관리자 토큰으로 대신 쓴다)가 배포된 뒤에만 적용할 것 —
// 먼저 적용하면 아직 옛 화면을 쓰는 사용자의 신호 전송이 막힌다.
// 읽기·조회(listRule/viewRule)는 그대로 열어 둔다: 단말이 L1 실시간 구독(SSE)으로 자기 앞 신호를 받는다.
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("3nq6x0w73s783bq")
  collection.createRule = null
  collection.updateRule = null
  collection.deleteRule = null
  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("3nq6x0w73s783bq")
  collection.createRule = ""
  collection.updateRule = ""
  collection.deleteRule = ""
  return dao.saveCollection(collection)
})
