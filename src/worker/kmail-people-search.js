// K-Mail 가입자 검색 — 검색을 허용(discoverable)한 가입자만, 이름·메일 아이디 부분 일치.
// 순수 함수만 담는다(네트워크 없음). L1 조회는 worker.js 의 handleKmailPeopleSearch 가 한다.
export const MIN_Q = 2, MAX_Q = 40, MAX_RESULTS = 8, RATE_LIMIT = 60, RATE_TTL = 600;

/** 검색어를 정리한다. 너무 짧거나 길면 '' (검색하지 않음). 필터를 깨는 글자는 뺀다. */
export function normalizeQuery(raw) {
  const q = String(raw == null ? '' : raw).trim().toLowerCase().replace(/^@/, '').replace(/[%'"\\]/g, '').trim();
  return q.length >= MIN_Q && q.length <= MAX_Q ? q : '';
}

/** PocketBase 필터. q 는 normalizeQuery 를 거친 값이어야 한다. */
export function buildFilter(q, selfGuid) {
  const me = String(selfGuid || '').replace(/[\\']/g, '\\$&');
  return `discoverable=true && mail_id!='' && owner_user_guid!='${me}' && (mail_id~'${q}' || sender_display_name~'${q}')`;
}

/** 돌려줄 공개 카드 — 이 필드 밖의 정보(guid·전화번호 등)는 절대 담지 않는다. */
export function publicRow(row, senderLocalPart, effectiveName) {
  if (!row || row.discoverable !== true || !row.mail_id) return null;
  const local = senderLocalPart(row.owner_user_guid, row.mail_id);
  return {
    name: (effectiveName ? effectiveName(row.sender_display_name) : String(row.sender_display_name || '')) || '',
    mail_id: String(row.mail_id),
    email: `${local}@hondi.kr`,
  };
}
