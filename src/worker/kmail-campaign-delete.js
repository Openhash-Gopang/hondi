// 2026-10-28 — "내 캠페인" 삭제 요청 해석.
export const CAMPAIGN_DELETE_MAX_IDS = 200;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

// { all:true } | { campaign_ids:[...] } → { ok, all, ids } | { ok:false, message }
export function parseCampaignDeleteRequest(body) {
  const b = body || {};
  if (b.all === true) return { ok: true, all: true, ids: [] };
  const raw = Array.isArray(b.campaign_ids) ? b.campaign_ids : [];
  const ids = [...new Set(raw.map(x => String(x || '').trim()).filter(Boolean))];
  if (!ids.length) return { ok: false, message: '삭제할 캠페인을 선택해 주세요.' };
  if (ids.some(id => !ID_RE.test(id))) return { ok: false, message: '캠페인 id 형식이 올바르지 않습니다.' };
  if (ids.length > CAMPAIGN_DELETE_MAX_IDS) return { ok: false, message: `한 번에 ${CAMPAIGN_DELETE_MAX_IDS}건까지 삭제할 수 있습니다. 나눠서 삭제하거나 "전체 삭제"를 이용하세요.` };
  return { ok: true, all: false, ids };
}

// PocketBase 필터 문자열: 본인 소유 + (선택 시) id 목록
export function ownedCampaignFilter(guid, ids) {
  const esc = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  let f = `owner_user_guid='${esc(guid)}'`;
  if (Array.isArray(ids) && ids.length) f += ' && (' + ids.map(id => `id='${esc(id)}'`).join(' || ') + ')';
  return f;
}
