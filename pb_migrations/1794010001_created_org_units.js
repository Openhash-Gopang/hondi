/// <reference path="../pb_data/types.d.ts" />
// 2026-09-20 신설 — 주소록 소속 기관 계층 분류(주피터 지시: "학교-대학-
// 제주대학-컴퓨터공학과" 같은 계층 구조). 1단계: 소속 트리의 노드를 담는
// org_units 컬렉션만 만든다. kmail_contacts에 org_unit/org_path를 붙이는 건
// 바로 다음 마이그레이션(1794010002)이 맡는다 — 컬렉션 생성과 필드 추가를
// 한 파일에 섞으면 한쪽만 실패했을 때 되돌리기 어렵다.
//
// 설계 결정:
//  · 트리는 사용자(owner_user_guid)별이다 — 주소록 자체가 사용자별이고,
//    노드를 사용자가 자유롭게 추가·이동하기로 했으므로 공유 트리로 두면
//    한 사용자의 정리가 다른 사용자에게 새어 나간다.
//  · parent_id는 relation이 아니라 text다(빈 값 = 루트). 자기참조
//    relation은 컬렉션 생성 시점에 자기 id를 미리 알아야 하고, 삭제 시
//    cascade 동작이 노드 이동/병합 로직과 충돌할 수 있어서, 무결성(부모
//    존재·순환 방지)은 워커 코드에서 검증한다.
//  · path는 "학교>대학>제주대학교>컴퓨터공학과"처럼 ">"로 이은 전체
//    경로다. 노드 이름에는 ">"를 못 쓰게 pattern으로 DB에서도 막는다.
//    (owner, path) UNIQUE라서 같은 자리에 같은 노드가 두 번 생기지 않는다.
//  · aliases는 표기 통일용("제주대" / "제주대학교" / 영문명 → 한 노드).
//    json 타입이라 options.maxSize를 반드시 명시한다 — PocketBase 0.22.x는
//    누락 시 0바이트로 저장돼 레코드 생성 자체가 막힌다
//    (1788300007_fixed_kmail_json_fields_maxsize.js 사고와 동일).
//  · origin은 노드가 어디서 왔는지: seed(시드 템플릿) / user(사용자가
//    직접 추가) / auto(등록 시 소속명에서 자동 생성).
migrate((db) => {
  const collection = new Collection({
    "id": "kmou0001units",
    "created": "2026-09-20 00:00:00.000Z",
    "updated": "2026-09-20 00:00:00.000Z",
    "name": "org_units",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "kmo001owner", "name": "owner_user_guid", "type": "text",   "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "kmo002name",  "name": "name",            "type": "text",   "required": true,  "presentable": true,  "unique": false, "options": { "min": 1, "max": 100, "pattern": "^[^>]+$" }, "description": "노드 이름. '>'는 경로 구분자라 사용 불가." },
      { "system": false, "id": "kmo003par",   "name": "parent_id",       "type": "text",   "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" }, "description": "부모 org_units 레코드 id. 빈 값이면 루트." },
      { "system": false, "id": "kmo004path",  "name": "path",            "type": "text",   "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": 1000, "pattern": "" }, "description": "루트부터 이 노드까지 '>'로 이은 전체 경로 (예: 학교>대학>제주대학교>컴퓨터공학과)." },
      { "system": false, "id": "kmo005depth", "name": "depth",           "type": "number", "required": false, "presentable": false, "unique": false, "options": { "min": 1, "max": 12, "noDecimal": true }, "description": "루트=1." },
      { "system": false, "id": "kmo006alias", "name": "aliases",         "type": "json",   "required": false, "presentable": false, "unique": false, "options": { "maxSize": 2000000 }, "description": "표기 통일용 별칭 문자열 배열 (예: [\"제주대\", \"Jeju National University\"])." },
      { "system": false, "id": "kmo007orig",  "name": "origin",          "type": "select", "required": false, "presentable": false, "unique": false, "options": { "maxSelect": 1, "values": ["seed", "user", "auto"] } }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_org_units_owner_path ON org_units (owner_user_guid, path)",
      "CREATE INDEX idx_org_units_owner_parent ON org_units (owner_user_guid, parent_id)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmou0001units");
  return dao.deleteCollection(collection);
})
