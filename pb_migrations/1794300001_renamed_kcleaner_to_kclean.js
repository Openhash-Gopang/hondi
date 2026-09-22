/// <reference path="../pb_data/types.d.ts" />
// gwp_registry의 fiil-kcleaner 레코드 표시명 정정 — 2026-09-22.
//
// 1783500009_seeded_gwp_registry_core.js가 이미 프로덕션에 적용된 뒤라
// 그 파일 자체를 고쳐도 서버에는 반영되지 않는다(마이그레이션은 한 번만
// 실행됨). 그래서 UPDATE 전용 마이그레이션을 새로 추가한다.
//
// gwp-registry.js·services/fiil-kcleaner/manifest.json 등 클라이언트가
// 직접 참조하는 소스는 이번 커밋에서 이미 "K-Clean"으로 바뀌었다 —
// 이 마이그레이션은 그것과 별개로 존재하는 gwp_registry 테이블(검색용
// 사본, GWP-REGISTRY-SCALING_v1_0.md 참고)의 표시명만 맞춘다.
// gwp_id·file_ref 등 내부 식별자는 그대로 "fiil-kcleaner"로 둔다 —
// 이번 변경은 사용자에게 보이는 이름(name)만의 정정이다.
migrate((db) => {
  const dao = new Dao(db);
  const rec = dao.findFirstRecordByFilter("gwp_registry", "gwp_id = 'fiil-kcleaner'");
  if (!rec) return; // 해당 환경에 아직 시딩 전이면 조용히 스킵
  rec.set("name", "K-Clean");
  dao.saveRecord(rec);
}, (db) => {
  const dao = new Dao(db);
  const rec = dao.findFirstRecordByFilter("gwp_registry", "gwp_id = 'fiil-kcleaner'");
  if (!rec) return;
  rec.set("name", "K-Cleaner");
  dao.saveRecord(rec);
})
