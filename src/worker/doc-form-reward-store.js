// doc-form-reward.js 의 l1 저장소 어댑터 — L1 PocketBase `doc_form_ratings`, `doc_form_rewards` (2026-10-17 신설)
//   ratingStore: find(keyHash, version, rater) · upsert(rec) · listFor(keyHash, version) · countSince(rater, ts) · hasRatedContributor(rater, contributor)
//   rewardStore: get(keyHash, version, kind) · create(rec) · update(id, patch) · countSince(contributor, ts) · listForForm(keyHash, version)
// 두 컬렉션 모두 규칙 null — Worker(admin 토큰)만 읽고 쓴다.
const q = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

function client({ base, getToken, fetchImpl = fetch }, collection) {
  const url = p => `${base}/api/collections/${collection}/records${p}`;
  const auth = async () => ({ 'Authorization': `Bearer ${await getToken()}`, 'Content-Type': 'application/json' });
  return {
    async page(filter, sort, page, perPage, fields) {
      const res = await fetchImpl(url(`?filter=${encodeURIComponent(filter)}&sort=${sort}&page=${page}&perPage=${perPage}${fields ? '&fields=' + fields : ''}`), { headers: await auth() });
      if (!res.ok) throw new Error(`L1 조회 실패 (HTTP ${res.status})`);
      return res.json();
    },
    async all(filter, sort = 'ts') {            // 보상 판정에 쓰므로 잘림 없이 끝까지 읽는다
      const out = []; let page = 1;
      for (;;) {
        const j = await this.page(filter, sort, page, 200);
        out.push(...(j.items || []));
        if (page >= (j.totalPages || 1)) return out;
        if (++page > 200) throw new Error('L1 조회 한도 초과');
      }
    },
    async total(filter) { return (await this.page(filter, 'ts', 1, 1, 'id')).totalItems || 0; },
    async post(rec) {
      const res = await fetchImpl(url(''), { method: 'POST', headers: await auth(), body: JSON.stringify(rec) });
      if (res.ok) return res.json();
      const body = await res.text().catch(() => '');
      if (res.status === 400) { const e = new Error('CONFLICT'); e.detail = body.slice(0, 200); throw e; }
      throw new Error(`L1 저장 실패 (HTTP ${res.status}) ${body.slice(0, 200)}`);
    },
    async patch(id, patch) {
      const res = await fetchImpl(url(`/${id}`), { method: 'PATCH', headers: await auth(), body: JSON.stringify(patch) });
      if (!res.ok) throw new Error(`L1 갱신 실패 (HTTP ${res.status})`);
      return res.json();
    },
  };
}

export function makePocketBaseRatingStore(cfg) {
  const c = client(cfg, 'doc_form_ratings');
  const key = (k, v, r) => `key_hash='${q(k)}' && version=${Number(v) | 0} && rater='${q(r)}'`;
  return {
    async find(k, v, rater) { return (await c.page(key(k, v, rater), '-ts', 1, 1)).items?.[0] || null; },
    async upsert(rec) {
      const prev = await this.find(rec.key_hash, rec.version, rec.rater);
      if (prev) { await c.patch(prev.id, rec); return; }
      try { await c.post(rec); }
      catch (e) { if (e.message !== 'CONFLICT') throw e; const again = await this.find(rec.key_hash, rec.version, rec.rater); if (!again) throw e; await c.patch(again.id, rec); }
    },
    async listFor(k, v) { return c.all(`key_hash='${q(k)}' && version=${Number(v) | 0}`); },
    async countSince(rater, ts) { return c.total(`rater='${q(rater)}' && ts>=${Number(ts) | 0}`); },
    async hasRatedContributor(rater, contributor) { return (await c.total(`rater='${q(rater)}' && form_contributor='${q(contributor)}'`)) > 0; },
  };
}

export function makePocketBaseRewardStore(cfg) {
  const c = client(cfg, 'doc_form_rewards');
  return {
    async get(k, v, kind) { return (await c.page(`key_hash='${q(k)}' && version=${Number(v) | 0} && kind='${q(kind)}'`, '-ts', 1, 1)).items?.[0] || null; },
    // (key_hash,version,kind) 유일 인덱스 → 이미 있으면 CONFLICT. 400 이 중복이 아니라 검증 실패면 그대로 오류로 올린다(조용히 삼키면 지급이 영영 안 된다).
    async create(rec) {
      try { return await c.post(rec); }
      catch (e) {
        if (e.message === 'CONFLICT' && !(await this.get(rec.key_hash, rec.version, rec.kind))) throw new Error(`L1 저장 거절 (HTTP 400) ${e.detail || ''}`);
        throw e;
      }
    },
    async update(id, patch) { return c.patch(id, patch); },
    async countSince(contributor, ts) { return c.total(`contributor='${q(contributor)}' && ts>=${Number(ts) | 0} && status!='void' && status!='failed'`); },
    async listForForm(k, v) { return c.all(`key_hash='${q(k)}' && version=${Number(v) | 0}`); },
  };
}
