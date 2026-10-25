// ═════════════════════════════════════════════════
// 관리자 전용 문서 보관소 API (2026-10-25 신설)
//
//   GET  /admin/proposals               목록(본문 제외): [{slug,title,profession,sha256,size,ts}]
//   GET  /admin/proposals/{slug}        본문(HTML) — Content-Type: text/html, noindex, no-store, CSP sandbox
//   POST /admin/proposals/save          { slug, title, profession?, html } — slug 기준 upsert
//
// 원칙
//   · 모든 경로가 관리자 Bearer 토큰(requireAdmin = worker.js의 _requireAdmin)을 먼저 확인한다. 실패하면 401 이외에는 아무것도 알려 주지 않는다.
//   · 문서는 PocketBase admin_proposals 컬렉션에만 있다(규칙 전부 null — L1 관리자 토큰을 가진 Worker만 접근). 정적 파일·저장소에 두지 않는다.
//   · 본문은 HTML 문서만 받고(<html 포함), 크기는 MAX_HTML(약 6MB) 이하.
// ═════════════════════════════════════════════════
const json = (body, status, cors = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors },
});
const err = (status, code, message, cors) => json({ ok: false, code, message }, status, cors);

export const MAX_HTML = 6_000_000;
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;

export async function sha256Hex(s) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...h].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function makeAdminProposalsHandler({ requireAdmin, base, getToken, now = () => Date.now() }) {
  const col = `${base}/api/collections/admin_proposals/records`;
  const auth = async () => ({ 'Authorization': 'Bearer ' + (await getToken()), 'Content-Type': 'application/json' });

  async function findBySlug(slug) {
    const f = encodeURIComponent(`slug='${slug}'`);            // slug는 SLUG_RE를 통과한 값만 들어온다(따옴표 불가)
    const res = await fetch(`${col}?filter=${f}&perPage=1`, { headers: await auth() });
    if (!res.ok) return { error: res.status };
    const data = await res.json().catch(() => ({}));
    return { row: data.items?.[0] || null };
  }

  return {
    async handle(request, url, env, cors) {
      const p = url.pathname;
      if (p !== '/admin/proposals' && !p.startsWith('/admin/proposals/')) return null;
      const admin = await requireAdmin(request, env);
      if (!admin) return err(401, 'ADMIN_AUTH_REQUIRED', '관리자 인증이 필요합니다(/admin/login)', cors);
      const who = String(admin?.admin || admin?.email || 'admin').slice(0, 100);

      try {
        if (p === '/admin/proposals' && request.method === 'GET') {
          const res = await fetch(`${col}?perPage=200&sort=slug&fields=slug,title,profession,sha256,size,ts`, { headers: await auth() });
          if (!res.ok) return err(503, 'STORE_UNAVAILABLE', '보관소를 사용할 수 없습니다(컬렉션 미생성 또는 L1 오류)', cors);
          const data = await res.json().catch(() => ({ items: [] }));
          const items = (data.items || []).map(r => ({ slug: r.slug, title: r.title, profession: r.profession || '', sha256: r.sha256, size: r.size, ts: r.ts }));
          return json({ ok: true, items }, 200, cors);
        }

        if (p === '/admin/proposals/save' && request.method === 'POST') {
          const body = await request.json().catch(() => null);
          if (!body) return err(400, 'INVALID_JSON', 'JSON body 필수', cors);
          const slug = String(body.slug || '');
          const title = String(body.title || '').trim();
          const html = typeof body.html === 'string' ? body.html : '';
          if (!SLUG_RE.test(slug)) return err(400, 'INVALID_SLUG', 'slug는 영문 소문자·숫자·하이픈 3~64자', cors);
          if (!title || title.length > 200) return err(400, 'INVALID_TITLE', 'title은 1~200자', cors);
          if (html.length < 200 || !/<html[\s>]/i.test(html)) return err(400, 'INVALID_HTML', 'HTML 문서가 아닙니다', cors);
          if (new TextEncoder().encode(html).length > MAX_HTML) return err(413, 'TOO_LARGE', `본문은 ${MAX_HTML}바이트 이하여야 합니다`, cors);
          const payload = {
            slug, title, profession: String(body.profession || '').slice(0, 40), html,
            sha256: await sha256Hex(html), size: new TextEncoder().encode(html).length, ts: now(), updated_by: who,
          };
          const found = await findBySlug(slug);
          if (found.error) return err(503, 'STORE_UNAVAILABLE', '보관소를 사용할 수 없습니다', cors);
          const res = found.row
            ? await fetch(`${col}/${encodeURIComponent(found.row.id)}`, { method: 'PATCH', headers: await auth(), body: JSON.stringify(payload) })
            : await fetch(col, { method: 'POST', headers: await auth(), body: JSON.stringify(payload) });
          if (!res.ok) return err(502, 'SAVE_FAILED', 'L1 저장 실패: ' + (await res.text()).slice(0, 200), cors);
          return json({ ok: true, slug, sha256: payload.sha256, size: payload.size, updated: !!found.row }, 200, cors);
        }

        const m = p.match(/^\/admin\/proposals\/([^/]+)$/);
        if (m && request.method === 'GET' && m[1] !== 'save') {
          const slug = decodeURIComponent(m[1]);
          if (!SLUG_RE.test(slug)) return err(400, 'INVALID_SLUG', 'slug 형식 오류', cors);
          const found = await findBySlug(slug);
          if (found.error) return err(503, 'STORE_UNAVAILABLE', '보관소를 사용할 수 없습니다', cors);
          if (!found.row) return err(404, 'NOT_FOUND', '문서가 없습니다', cors);
          return new Response(found.row.html, {
            status: 200,
            headers: {
              'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow',
              'Content-Security-Policy': 'sandbox', 'X-Content-Type-Options': 'nosniff', ...cors,
            },
          });
        }
        return err(404, 'NOT_FOUND', '없는 경로입니다', cors);
      } catch (e) {
        return err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, cors);
      }
    },
  };
}
