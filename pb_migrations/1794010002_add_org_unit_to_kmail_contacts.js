/// <reference path="../pb_data/types.d.ts" />
// 2026-09-20 신설 — 주소록 소속 기관 계층 분류 2단계: kmail_contacts를
// org_units 트리에 연결한다(1794010001_created_org_units.js 선행 필요).
//
//  · org_unit — 이 연락처가 속한 "가장 하위" 노드의 org_units 레코드 id.
//    relation이 아니라 text다(org_units.parent_id와 같은 이유 — 무결성은
//    워커 코드에서 검증).
//  · org_path — 그 노드의 전체 경로를 연락처 레코드에 복사해 둔 비정규화
//    값이다. 이유: PocketBase 필터는 JOIN이 안 돼서, "제주대학교 전체
//    (하위 포함)"를 조회하려면 연락처 쪽에 경로 문자열이 있어야 한다.
//    ★ 조회 필터는 반드시 (org_path='X' || org_path~'X>%') 형태로 쓴다.
//    org_path~'X%'(단순 접두)는 같은 접두어를 공유하는 형제 노드까지
//    잡는다 — 예: '학교>대학>제주대학교%'가 '학교>대학>제주대학교병원'도
//    포함(PocketBase 0.22.14에서 실측 확인). 노드 이름을 바꾸거나
//    이동하면 워커가 소속 연락처의 org_path를 다시 채운다.
//
// 기존 org / dept(자유 텍스트 원문)는 건드리지 않는다 — 계층은 그 위에
// 얹는 것이고, 원문은 분류가 틀렸을 때 되돌아갈 근거다. 기존 category
// (KSIC 21종)도 그대로 둔다.
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0001contact");
  collection.schema.addField(new SchemaField({
    "system": false, "id": "kmc015ounit", "name": "org_unit", "type": "text",
    "required": false, "presentable": false, "unique": false,
    "options": { "min": null, "max": null, "pattern": "" },
    "description": "가장 하위 소속 노드의 org_units 레코드 id. 미분류면 빈 값.",
  }));
  collection.schema.addField(new SchemaField({
    "system": false, "id": "kmc016opath", "name": "org_path", "type": "text",
    "required": false, "presentable": false, "unique": false,
    "options": { "min": null, "max": 1000, "pattern": "" },
    "description": "org_unit 노드의 전체 경로(비정규화). 하위 포함 조회: (org_path='X' || org_path~'X>%').",
  }));
  collection.indexes = (collection.indexes || []).concat([
    "CREATE INDEX idx_kmail_contacts_org_path ON kmail_contacts (owner_user_guid, org_path)",
  ]);
  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0001contact");
  collection.indexes = (collection.indexes || []).filter(i => !i.includes("idx_kmail_contacts_org_path"));
  collection.schema.removeField("kmc015ounit");
  collection.schema.removeField("kmc016opath");
  return dao.saveCollection(collection);
})
