// 사용자 제보 내보내기 (2026-11-06 신설) — 나비웹이 /user-feedback/submit 로 모은 제보([naviweb:<종류>] 말머리)를 운영자·자동 집계가 가져간다.
//   GET /user-feedback/export?since=<ISO 날짜>&limit=<건수>   Authorization: Bearer env.USER_FEEDBACK_EXPORT_TOKEN
//   → { ok:true, count, items:[{ id, guid, raw_text, context_summary, category, status, created }] }
// 읽기 전용. 토큰이 없거나 틀리면 401. L1 `user_feedback` 은 Worker(admin 토큰)만 읽는다.
const json = (body, status, cors = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors } });
function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
export const EXPORT_MAX = 2000;
export const TAG = '[naviweb:';

export function makeUserFeedbackExportHandler({ base, getToken, fetchImpl = fetch }) {
  async function handle(request, url, env, cors = {}) {
    if (url.pathname !== '/user-feedback/export') return null;
    if (request.method !== 'GET') return json({ ok: false, code: 'METHOD' }, 405, cors);
    const token = env?.USER_FEEDBACK_EXPORT_TOKEN;
    const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token || !given || !safeEqual(given, token)) return json({ ok: false, code: 'UNAUTHORIZED', message: '권한이 없습니다.' }, 401, cors);
    const sinceRaw = url.searchParams.get('since') || '';
    const since = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+Z?)?$/.test(sinceRaw) ? sinceRaw.replace('T', ' ').replace(/Z$/, '') : '';
    const limit = Math.max(1, Math.min(EXPORT_MAX, parseInt(url.searchParams.get('limit') || '500', 10) || 500));
    const filter = `raw_text~'${TAG}'` + (since ? ` && created>='${since}'` : '');
    try {
      const items = []; let page = 1;
      for (;;) {
        const res = await fetchImpl(`${base}/api/collections/user_feedback/records?filter=${encodeURIComponent(filter)}&sort=-created&page=${page}&perPage=200&fields=id,guid,raw_text,context_summary,category,status,created`,
          { headers: { 'Authorization': `Bearer ${await getToken()}` } });
        if (!res.ok) return json({ ok: false, code: 'L1_FAILED', message: `L1 조회 실패 (HTTP ${res.status})` }, 502, cors);
        const j = await res.json();
        items.push(...(j.items || []));
        if (items.length >= limit || page >= (j.totalPages || 1)) break;
        page++;
      }
      const out = items.slice(0, limit);
      return json({ ok: true, count: out.length, items: out }, 200, cors);
    } catch (e) {
      return json({ ok: false, code: 'INTERNAL', message: '처리하지 못했습니다.' }, 500, cors);
    }
  }
  return { handle };
}
