// doc-form-handler.js 의 l1 저장소 어댑터 — L1 PocketBase `doc_forms` (2026-10-14 신설)
//   latest(keyHash)              → 내부 행 | null   (최신 version)
//   get(keyHash, version)        → 내부 행 | null
//   search({agency,q,limit})     → 내부 행[] (본문 제외, 최신 version만은 아니고 서식별 최신만 추려 반환)
//   append(rec)                  → 저장. (key_hash,version) 중복이면 Error('CONFLICT')
//   setStatus(keyHash,version,p) → 상태·공식 URL·검토자 갱신
//   countSince(contributor, ts)  → 이 기여자가 ts 이후 올린 서식 수(일일 한도용)
const COLLECTION = 'doc_forms';
const q = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export function makePocketBaseDocFormStore({ base, getToken, fetchImpl = fetch }) {
  if (!base || typeof getToken !== 'function') throw new Error('makePocketBaseDocFormStore: base, getToken 필요');
  const url = p => `${base}/api/collections/${COLLECTION}/records${p}`;
  const auth = async () => ({ 'Authorization': `Bearer ${await getToken()}`, 'Content-Type': 'application/json' });

  async function query(filter, sort, perPage, fields) {
    const res = await fetchImpl(url(`?filter=${encodeURIComponent(filter)}&sort=${sort}&perPage=${perPage}${fields ? '&fields=' + fields : ''}`), { headers: await auth() });
    if (!res.ok) throw new Error(`L1 조회 실패 (HTTP ${res.status})`);
    return (await res.json()).items || [];
  }
  return {
    async latest(keyHash) { return (await query(`key_hash='${q(keyHash)}'`, '-version', 1))[0] || null; },
    async get(keyHash, version) { return (await query(`key_hash='${q(keyHash)}' && version=${Number(version) | 0}`, '-version', 1))[0] || null; },
    async search({ agency = '', q: kw = '', persona = '', limit = 50 } = {}) {
      const conds = [];
      if (persona) conds.push(`persona~'${q(persona)}'`);
      if (agency) conds.push(`agency='${q(agency)}'`);
      if (kw) conds.push(`name~'${q(kw)}'`);
      const items = await query(conds.join(' && ') || "version>0", '-ts', 200,
        'id,key_hash,version,agency,name,form_no,form_class,status,version_date,source,persona,ts');
      const seen = new Map();
      for (const it of items) {
        // persona는 직역 id(예: lawyer-criminal). 상위 직역(lawyer) 페이지에서는 하위(lawyer-*)까지 포함한다.
        if (persona && !(it.persona === persona || String(it.persona || '').startsWith(persona + '-'))) continue; const p = seen.get(it.key_hash); if (!p || it.version > p.version) seen.set(it.key_hash, it); }
      return [...seen.values()].slice(0, limit);
    },
    async append(rec) {
      const res = await fetchImpl(url(''), { method: 'POST', headers: await auth(), body: JSON.stringify(rec) });
      if (res.ok) return;
      if (res.status === 400 && await this.get(rec.key_hash, rec.version)) throw new Error('CONFLICT');
      throw new Error(`L1 저장 실패 (HTTP ${res.status}) ${(await res.text().catch(() => '')).slice(0, 200)}`);
    },
    async setStatus(keyHash, version, patch) {
      const row = await this.get(keyHash, version);
      if (!row) return false;
      const res = await fetchImpl(url(`/${row.id}`), { method: 'PATCH', headers: await auth(), body: JSON.stringify(patch) });
      if (!res.ok) throw new Error(`L1 갱신 실패 (HTTP ${res.status})`);
      return true;
    },
    async countSince(contributor, ts) {
      const res = await fetchImpl(url(`?filter=${encodeURIComponent(`contributor='${q(contributor)}' && ts>=${Number(ts) | 0}`)}&perPage=1&fields=id`), { headers: await auth() });
      if (!res.ok) throw new Error(`L1 조회 실패 (HTTP ${res.status})`);
      return (await res.json()).totalItems || 0;
    },
  };
}
