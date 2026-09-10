/// <reference path="../pb_data/types.d.ts" />
// 2026-09-10 신설 — K-Mail SP §0-1 ①-c(캠페인 시작) 지원. 지금까지
// kmail_campaigns.status는 ["scheduled","sent","failed"]만 허용했고
// subject/body는 required=true였다 — 즉 "수신자·제목·본문·발송시각을
// 전부 확정한 순간"에만 레코드가 생길 수 있었다(KMAIL_SEND_CAMPAIGN,
// §2-2). 사용자가 그보다 먼저 "이 캠페인을 시작하세요"라고 명시적으로
// 말했을 때는(KMAIL_CAMPAIGN_START) subject/body/수신자가 아직 없는
// 상태로도 레코드를 먼저 만들어 "내 캠페인" 탭에 즉시 나타나야 하므로,
// status에 "draft"를 추가하고 subject/body를 선택 필드로 완화한다.
// draft 레코드는 발송 스윕 필터(status='scheduled' && send_at<=now)에
// 안 걸리므로 이 완화가 실수 발송으로 이어지지 않는다.
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0002campaign");

  const statusField = collection.schema.getFieldById("kcp007status");
  statusField.options.values = ["draft", "scheduled", "sent", "failed"];

  const subjectField = collection.schema.getFieldById("kcp004subj");
  subjectField.required = false;

  const bodyField = collection.schema.getFieldById("kcp005body");
  bodyField.required = false;

  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0002campaign");

  const statusField = collection.schema.getFieldById("kcp007status");
  statusField.options.values = ["scheduled", "sent", "failed"];

  const subjectField = collection.schema.getFieldById("kcp004subj");
  subjectField.required = true;

  const bodyField = collection.schema.getFieldById("kcp005body");
  bodyField.required = true;

  return dao.saveCollection(collection);
})
