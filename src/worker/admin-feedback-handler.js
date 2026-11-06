// ═════════════════════════════════════════════════
// 관리자 대시보드용 사용자 제보·기능 개선 제안 조회 API (2026-11-06 신설)
//
//   GET /admin/feedback-inbox?days=30&limit=300
//     → { ok, reports:[{id,kind,doc,problem,right,text,ctx,dev,status,created}], suggestions:[{id,content,category,status,visibility,vote_count,admin_note,created}] }
//   reports      나비웹 제보([naviweb:<종류>] 말머리, user_feedback 컬렉션) — 최근 days 일
//   suggestions  기능 개선 제안 게시판(feedback 컬렉션) — 공개·비공개 모두, 투표 많은 순(같으면 최신순)
//
// 읽기 전용. 관리자 Bearer 토큰(requireAdmin = worker.js 의 _requireAdmin)을 먼저 확인하고, 실패하면 401 외에는 아무것도 알려 주지 않는다.
// 작성자 guid 는 내려 주지 않는다(대시보드에서 필요 없음 — 개인 식별을 줄인다).
// ═════════════════════════════════════════════════
const json = (body, status, cors = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors } });

/** raw_text "[naviweb:<kind>] 서류=… | 문제=… | 올바른기관=… | 용도=… | 내용=…" → 필드 (맞지 않으면 null) */
export function parseReport(raw) {
  const m = /^\[naviweb:(attach|newdoc|bug)\]\s*(.*)$/s.exec(String(raw || '')); if (!m) return null;
  const f = { kind: m[1] };
  for (const part of m[2].split(' | ')) { const i = part.indexOf('='); if (i > 0) f[part.slice(0, i).trim()] = part.slice(i + 1).trim(); }
  return { kind: f.kind, doc: f['서류'] || '', problem: f['문제'] || '', right: f['올바른기관'] || '', use: f['용도'] || '', text: f['내용'] || '' };
}
export const MAX_LIMIT = 500;

export function makeAdminFeedbackHandler({ requireAdmin, base, getToken, fetchImpl = fetch, now = () => Date.now() }) {
  async function list(collection, params) {
    const res = await fetchImpl(`${base}/api/collections/${collection}/records?${params}`, { headers: { 'Authorization': 'Bearer ' + (await getToken()) } });
    if (!res.ok) throw new Error(`${collection} HTTP ${res.status}`);
    return (await res.json()).items || [];
  }
  async function handle(request, url, env, cors = {}) {
    if (url.pathname !== '/admin/feedback-inbox') return null;
    if (request.method !== 'GET') return json({ ok: false, code: 'METHOD' }, 405, cors);
    if (!(await requireAdmin(request, env))) return json({ ok: false, code: 'UNAUTHORIZED' }, 401, cors);
    const days = Math.max(1, Math.min(365, parseInt(url.searchParams.get('days') || '30', 10) || 30));
    const limit = Math.max(1, Math.min(MAX_LIMIT, parseInt(url.searchParams.get('limit') || '300', 10) || 300));
    const since = new Date(now() - days * 864e5).toISOString().slice(0, 10);
    try {
      const [rawReports, rawSug] = await Promise.all([
        list('user_feedback', `filter=${encodeURIComponent(`raw_text~'[naviweb:' && created>='${since}'`)}&sort=-created&perPage=${limit}&fields=id,raw_text,context_summary,status,created`),
        list('feedback', `sort=-created&perPage=${limit}&fields=id,content,category,status,visibility,vote_count,admin_note,created`),
      ]);
      const reports = rawReports.map((r) => {
        const p = parseReport(r.raw_text); if (!p) return null;
        const dev = /(?:^|; )dev=([^;]+)/.exec(r.context_summary || '');
        return { id: r.id, ...p, ctx: r.context_summary || '', dev: dev ? dev[1] : '', status: r.status || '', created: r.created || '' };
      }).filter(Boolean);
      const suggestions = rawSug.map((r) => ({ id: r.id, content: String(r.content || '').slice(0, 600), category: r.category || '', status: r.status || '', visibility: r.visibility || 'public', vote_count: Number(r.vote_count) || 0, admin_note: r.admin_note || '', created: r.created || '' }))
        .sort((a, b) => b.vote_count - a.vote_count || String(b.created).localeCompare(String(a.created)));
      return json({ ok: true, days, reports, suggestions }, 200, cors);
    } catch (e) {
      return json({ ok: false, code: 'L1_FAILED', message: '조회하지 못했습니다.' }, 502, cors);
    }
  }
  return { handle };
}
