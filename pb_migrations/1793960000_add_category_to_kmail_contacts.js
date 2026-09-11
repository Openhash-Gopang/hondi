/// <reference path="../pb_data/types.d.ts" />
// 2026-09-11 신설 — 주소록 자동 분류 요청(주피터 지시: "학계/공공기관/
// 금융기관 같은 상위 카테고리로 자동 묶는 기능")에 대한 구현. 논의
// 결과(§ K-Mail 대화 기록) KSIC(한국표준산업분류) 대분류 21개까지만
// 쓰고 중분류 이하로는 내려가지 않기로 확정 — 그 아래 세부 구분은
// 이미 있는 occupation/dept 필드가 맡는다. 이메일 도메인·소속명만
// 보고 세분류까지 정확히 추정하는 건 현실적으로 불가능해서, 대분류도
// 애매하면 빈 값으로 두고 사용자가 나중에 고치게 한다(추측해서
// 채우지 않는다 — 지어내지 않는 원칙).
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0001contact");
  collection.schema.addField(new SchemaField({
    "system": false, "id": "kmc012ksic", "name": "category", "type": "select",
    "required": false, "presentable": true, "unique": false,
    "options": { "maxSelect": 1, "values": [
      "A 농업,임업 및 어업", "B 광업", "C 제조업",
      "D 전기,가스,증기 및 공기조절 공급업", "E 수도,하수 및 폐기물 처리,원료 재생업",
      "F 건설업", "G 도매 및 소매업", "H 운수 및 창고업", "I 숙박 및 음식점업",
      "J 정보통신업", "K 금융 및 보험업", "L 부동산업", "M 전문,과학 및 기술 서비스업",
      "N 사업시설 관리,사업 지원 및 임대 서비스업", "O 공공행정,국방 및 사회보장 행정",
      "P 교육 서비스업", "Q 보건업 및 사회복지 서비스업", "R 예술,스포츠 및 여가관련 서비스업",
      "S 협회 및 단체,수리 및 기타 개인 서비스업", "T 가구내 고용활동 및 자가소비 생산활동",
      "U 국제 및 외국기관",
    ] },
    "description": "KSIC(한국표준산업분류) 대분류 21개 중 하나. 애매하면 비워둠(추측 금지) — 세부 구분은 occupation/dept가 담당.",
  }));
  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0001contact");
  collection.schema.removeField("kmc012ksic");
  return dao.saveCollection(collection);
})
