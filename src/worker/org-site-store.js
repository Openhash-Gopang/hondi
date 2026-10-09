// org-site-handler.js 의 l1 저장소 어댑터 — L1 PocketBase `org_site_versions` (2026-10-09 신설)
//   latest(site)            → {version, config, note, author, ts, hash} | null
//   get(site, version)      → 같은 모양 | null
//   list(site, limit)       → [{version, note, author, ts}] 최신순 (config 제외)
//   append(rec)             → 저장. (site,version) 중복이면 Error('CONFLICT')
const COLLECTION = 'org_site_versions';
const q = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export function makePocketBaseOrgSiteStore({ base, getToken, fetchImpl = fetch }) {
  if (!base || typeof getToken !== 'function') throw new Error('makePocketBaseOrgSiteStore: base, getToken 필요');
  const url = p => `${base}/api/collections/${COLLECTION}/records${p}`;
  const auth = async () => ({ 'Authorization': `Bearer ${await getToken()}`, 'Content-Type': 'application/json' });
  const row = r => ({ version: r.version, config: r.config, note: r.note || '', author: r.author, ts: r.ts, hash: r.hash });

  async function query(filter, sort, perPage, fields) {
    const f = encodeURIComponent(filter);
    const res = await fetchImpl(url(`?filter=${f}&sort=${sort}&perPage=${perPage}${fields ? '&fields=' + fields : ''}`), { headers: await auth() });
    if (!res.ok) throw new Error(`L1 조회 실패 (HTTP ${res.status})`);
    return (await res.json()).items || [];
  }
  return {
    async latest(site) { const it = await query(`site='${q(site)}'`, '-version', 1); return it[0] ? row(it[0]) : null; },
    async get(site, version) { const it = await query(`site='${q(site)}' && version=${Number(version) | 0}`, '-version', 1); return it[0] ? row(it[0]) : null; },
    async list(site, limit = 50) {
      const it = await query(`site='${q(site)}'`, '-version', limit, 'version,note,author,ts');
      return it.map(r => ({ version: r.version, note: r.note || '', author: r.author, ts: r.ts }));
    },
    async append(rec) {
      const res = await fetchImpl(url(''), { method: 'POST', headers: await auth(), body: JSON.stringify(rec) });
      if (res.ok) return;
      if (res.status === 400) {
        const cur = await this.get(rec.site, rec.version);
        if (cur) throw new Error('CONFLICT');
      }
      throw new Error(`L1 저장 실패 (HTTP ${res.status}) ${(await res.text().catch(() => '')).slice(0, 200)}`);
    },
  };
}
