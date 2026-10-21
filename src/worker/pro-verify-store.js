// pro-verify-handler.js 의 l1 저장소 어댑터 — L1 PocketBase `pro_verifications` (2026-10-21 신설)
//   create(rec, file)                  → 저장된 행 (file: {bytes:Uint8Array, type, name} | null)
//   get(id)                            → 행 | null
//   listByPubkey(pubkey)               → 이 신청자의 행(최신순)
//   listPending(limit)                 → 승인 대기 행(오래된 순)
//   findApprovedByLicense(hash)        → 같은 면허 해시로 승인된 행들
//   countSince(pubkey, ts)             → ts 이후 이 신청자의 신청 수(남용 한도용)
//   update(id, patch)                  → 행 갱신
//   clearFile(id, ts)                  → 면허증 사본 삭제 + 삭제 시각 기록
//   readFile(id)                       → { bytes, type } | null  (protected 파일 — 파일 토큰으로 읽음)
const COLLECTION = 'pro_verifications';
const q = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export function makePocketBaseProVerifyStore({ base, getToken, fetchImpl = fetch }) {
  if (!base || typeof getToken !== 'function') throw new Error('makePocketBaseProVerifyStore: base, getToken 필요');
  const url = p => `${base}/api/collections/${COLLECTION}/records${p}`;
  const jsonHeaders = async () => ({ 'Authorization': `Bearer ${await getToken()}`, 'Content-Type': 'application/json' });
  const authOnly = async () => ({ 'Authorization': `Bearer ${await getToken()}` });

  async function query(filter, sort, perPage) {
    const res = await fetchImpl(url(`?filter=${encodeURIComponent(filter)}&sort=${sort}&perPage=${perPage}`), { headers: await authOnly() });
    if (!res.ok) throw new Error(`L1 조회 실패 (HTTP ${res.status})`);
    return (await res.json()).items || [];
  }
  return {
    async create(rec, file) {
      let init;
      if (file) {
        const fd = new FormData();
        for (const [k, v] of Object.entries(rec)) if (v !== null && v !== undefined) fd.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
        fd.append('license_file', new Blob([file.bytes], { type: file.type }), file.name || 'license');
        init = { method: 'POST', headers: await authOnly(), body: fd };
      } else {
        init = { method: 'POST', headers: await jsonHeaders(), body: JSON.stringify(rec) };
      }
      const res = await fetchImpl(url(''), init);
      if (!res.ok) throw new Error(`L1 저장 실패 (HTTP ${res.status}) ${(await res.text().catch(() => '')).slice(0, 200)}`);
      return res.json();
    },
    async get(id) {
      if (!/^[a-z0-9]{15}$/.test(String(id))) return null;
      const res = await fetchImpl(url(`/${id}`), { headers: await authOnly() });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`L1 조회 실패 (HTTP ${res.status})`);
      return res.json();
    },
    async listByPubkey(pubkey) { return query(`applicant_pubkey='${q(pubkey)}'`, '-ts', 100); },
    async listPending(limit = 50) { return query(`status='pending'`, 'ts', Math.min(Number(limit) | 0 || 50, 200)); },
    async findApprovedByLicense(hash) { return query(`license_hash='${q(hash)}' && status='approved'`, '-ts', 20); },
    async countSince(pubkey, ts) {
      const res = await fetchImpl(url(`?filter=${encodeURIComponent(`applicant_pubkey='${q(pubkey)}' && ts>=${Number(ts) | 0}`)}&perPage=1&fields=id`), { headers: await authOnly() });
      if (!res.ok) throw new Error(`L1 조회 실패 (HTTP ${res.status})`);
      return (await res.json()).totalItems || 0;
    },
    async update(id, patch) {
      const res = await fetchImpl(url(`/${id}`), { method: 'PATCH', headers: await jsonHeaders(), body: JSON.stringify(patch) });
      if (!res.ok) throw new Error(`L1 갱신 실패 (HTTP ${res.status})`);
      return res.json();
    },
    async clearFile(id, ts) {
      const res = await fetchImpl(url(`/${id}`), { method: 'PATCH', headers: await jsonHeaders(), body: JSON.stringify({ license_file: null, license_file_deleted_ts: ts }) });
      if (!res.ok) throw new Error(`L1 사본 삭제 실패 (HTTP ${res.status})`);
    },
    async readFile(id) {
      const rec = await this.get(id);
      const name = rec?.license_file;
      if (!name) return null;
      const tk = await fetchImpl(`${base}/api/files/token`, { method: 'POST', headers: await authOnly() });
      if (!tk.ok) throw new Error(`L1 파일 토큰 실패 (HTTP ${tk.status})`);
      const { token } = await tk.json();
      const res = await fetchImpl(`${base}/api/files/${rec.collectionId || COLLECTION}/${rec.id}/${encodeURIComponent(name)}?token=${encodeURIComponent(token)}`);
      if (!res.ok) throw new Error(`L1 파일 읽기 실패 (HTTP ${res.status})`);
      return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get('Content-Type') || 'application/octet-stream' };
    },
  };
}
