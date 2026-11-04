// doc-form-feedback.js 의 l1 저장소 어댑터 — L1 PocketBase `doc_form_feedback` (2026-11-04 신설). 규칙 null — Worker(admin 토큰)만 읽고 쓴다.
//   add(rec) → true(새로 저장) | false(같은 이용자가 이미 보냄) · countSince(cidHash, ts) · since(ts, limit) → 최근 기록
const q = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export function makePocketBaseFeedbackStore({ base, getToken, fetchImpl = fetch }) {
  const url = p => `${base}/api/collections/doc_form_feedback/records${p}`;
  const auth = async () => ({ 'Authorization': `Bearer ${await getToken()}`, 'Content-Type': 'application/json' });
  const page = async (filter, sort, pageNo, perPage, fields) => {
    const res = await fetchImpl(url(`?filter=${encodeURIComponent(filter)}&sort=${sort}&page=${pageNo}&perPage=${perPage}${fields ? '&fields=' + fields : ''}`), { headers: await auth() });
    if (!res.ok) throw new Error(`L1 조회 실패 (HTTP ${res.status})`);
    return res.json();
  };
  return {
    async add(rec) {
      const res = await fetchImpl(url(''), { method: 'POST', headers: await auth(), body: JSON.stringify(rec) });
      if (res.ok) return true;
      if (res.status === 400) {                       // 유일 인덱스 충돌(같은 이용자의 같은 제안)과 검증 실패를 구분한다
        const dup = await page(`form_id='${q(rec.form_id)}' && version=${Number(rec.version) | 0} && kind='${q(rec.kind)}' && label_norm='${q(rec.label_norm)}' && cid_hash='${q(rec.cid_hash)}'`, 'ts', 1, 1, 'id');
        if (dup.totalItems > 0) return false;
      }
      throw new Error(`L1 저장 실패 (HTTP ${res.status})`);
    },
    async countSince(cidHash, ts) { return (await page(`cid_hash='${q(cidHash)}' && ts>=${Number(ts) | 0}`, 'ts', 1, 1, 'id')).totalItems || 0; },
    async since(ts, limit = 5000) {
      const out = []; let p = 1;
      for (;;) {
        const j = await page(`ts>=${Number(ts) | 0}`, '-ts', p, 200);
        out.push(...(j.items || []));
        if (out.length >= limit || p >= (j.totalPages || 1)) return out.slice(0, limit);
        p++;
      }
    },
  };
}
