// pro-sub-handler.js 의 l1 저장소 어댑터 — L1 PocketBase `pro_subscriptions` (2026-10-21 신설)
//   create(rec) · get(id) · listByPubkey(pk) · findByPayRef(ref) · update(id, patch)
//   listExpiring(from, to)  → 활성 구독 중 expires_ts 가 [from, to) 인 행(임박 순)
//   listRecent(limit)       → 최근 부여 순
//   countActive(now)        → 지금 유효한 활성 구독 수
const COLLECTION = 'pro_subscriptions';
const q = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export function makePocketBaseProSubStore({ base, getToken, fetchImpl = fetch }) {
  if (!base || typeof getToken !== 'function') throw new Error('makePocketBaseProSubStore: base, getToken 필요');
  const url = p => `${base}/api/collections/${COLLECTION}/records${p}`;
  const headers = async () => ({ 'Authorization': `Bearer ${await getToken()}`, 'Content-Type': 'application/json' });
  async function query(filter, sort, perPage) {
    const res = await fetchImpl(url(`?filter=${encodeURIComponent(filter)}&sort=${sort}&perPage=${perPage}`), { headers: await headers() });
    if (!res.ok) throw new Error(`L1 조회 실패 (HTTP ${res.status})`);
    return res.json();
  }
  return {
    async create(rec) {
      const res = await fetchImpl(url(''), { method: 'POST', headers: await headers(), body: JSON.stringify(rec) });
      if (!res.ok) throw new Error(`L1 저장 실패 (HTTP ${res.status}) ${(await res.text().catch(() => '')).slice(0, 200)}`);
      return res.json();
    },
    async get(id) {
      if (!/^[a-z0-9]{15}$/.test(String(id))) return null;
      const res = await fetchImpl(url(`/${id}`), { headers: await headers() });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`L1 조회 실패 (HTTP ${res.status})`);
      return res.json();
    },
    async listByPubkey(pk) { return (await query(`subscriber_pubkey='${q(pk)}'`, '-ts', 100)).items || []; },
    async findByPayRef(ref) { return ((await query(`pay_ref='${q(ref)}'`, '-ts', 1)).items || [])[0] || null; },
    async update(id, patch) {
      const res = await fetchImpl(url(`/${id}`), { method: 'PATCH', headers: await headers(), body: JSON.stringify(patch) });
      if (!res.ok) throw new Error(`L1 갱신 실패 (HTTP ${res.status})`);
      return res.json();
    },
    async listExpiring(from, to) { return (await query(`status='active' && expires_ts>=${Number(from) | 0} && expires_ts<${Number(to) | 0}`, 'expires_ts', 200)).items || []; },
    async listRecent(limit = 30) { return (await query(`ts>0`, '-ts', Math.min(Number(limit) | 0 || 30, 100))).items || []; },
    async countActive(now) { return (await query(`status='active' && start_ts<=${Number(now) | 0} && expires_ts>${Number(now) | 0}`, '-ts', 1)).totalItems || 0; },
  };
}
