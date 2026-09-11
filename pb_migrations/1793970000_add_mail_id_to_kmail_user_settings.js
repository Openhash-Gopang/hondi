/// <reference path="../pb_data/types.d.ts" />
// 2026-09-12 신설 — K-Mail ID(mail_id, 주피터 지시). 전화번호가 혼디의
// 유일 식별자이지만 타인에게 노출하면 안 되므로, "검색/호출용" +
// "메일 로컬파트"를 겸하는 별도 식별자를 kmail_user_settings에 추가한다.
//
// 실제 발신 주소(<guid>@hondi.kr, 스푸핑 방지)는 이 필드와 무관하게
// 그대로 고정 — mail_id는 그 위에 얹는 조회용 별칭일 뿐이다
// (worker.js _kmailSendOneEmail의 fromAddr 계산 로직은 이 마이그레이션과
// 무관, 손대지 않음).
//
// 주의(중요): 필드 옵션의 "unique": true는 걸지 않는다 — PocketBase
// 텍스트 필드는 값을 안 채우면 NULL이 아니라 빈 문자열('')로 저장되는데,
// 컬럼 자체에 표준 UNIQUE 제약을 걸면 "아직 mail_id를 설정하지 않은"
// 두 번째 사용자부터 그 UNIQUE 제약에 걸려 레코드 생성이 실패한다
// (kmail_user_settings는 사용자당 자동으로 1행 생성되는 테이블이라
// 이 경로를 거의 모든 신규 로그인이 탄다 — 매우 치명적인 회귀).
// 그래서 unique 보증은 아래 "빈 문자열 제외" 부분 인덱스(SQLite
// partial index) 하나로만 건다 — 빈 값끼리는 몇 개가 있든 충돌하지
// 않고, 실제 값이 채워진 mail_id끼리만 유일성을 검사한다.
// 값은 애플리케이션 레벨에서 항상 소문자로 정규화한 뒤 저장하므로
// (worker.js _kmailNormalizeMailId), DB 컬레이션은 대소문자 구분
// 그대로 두어도 무결성에 문제없다.
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0012usrst");

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "kus008mailid",
    "name": "mail_id",
    "type": "text",
    "required": false,
    "presentable": true,
    "unique": false,
    "options": { "min": null, "max": 30, "pattern": "^$|^[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])?$" },
  }));

  collection.indexes = collection.indexes || [];
  collection.indexes.push(
    "CREATE UNIQUE INDEX idx_kmail_user_settings_mail_id ON kmail_user_settings (mail_id) WHERE mail_id != ''"
  );

  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0012usrst");

  collection.schema.removeField("kus008mailid");
  collection.indexes = (collection.indexes || []).filter(
    (idx) => idx.indexOf("idx_kmail_user_settings_mail_id") === -1
  );

  return dao.saveCollection(collection);
})
