// ═════════════════════════════════════════════════
// consent-sale-handler.js 의 l1 저장소 어댑터 — L1 PocketBase `consent_sale_listings`
// 컬렉션 (2026-09-27 신설, K-Estate "합의매각")
//
//   create(row)               → 저장, 생성된 레코드(id 포함) 반환
//   getById(id)                → 레코드 하나 또는 null
//   update(id, patch)          → 부분 갱신, 갱신된 레코드 반환
//   search({status, region, property_type, min_price, max_price}) → 배열
//   findMine(pubkey)            → 이 pubkey가 creditor 또는 debtor인 레코드 배열
//
// 의존성은 주입한다(단위 테스트 가능) — digit-claim-store.js와 동일 패턴:
//   makeConsentSaleStore({ base: L1_DEFAULT, getToken: () => _l1AdminToken(env) })
// ═════════════════════════════════════════════════
const COLLECTION = 'consent_sale_listings';
const q = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export function makeConsentSaleStore({ base, getToken, fetchImpl = fetch }) {
  if (!base || typeof getToken !== 'function') throw new Error('makeConsentSaleStore: base, getToken 필요');
  const url = path => `${base}/api/collections/${COLLECTION}/records${path}`;
  const auth = async () => ({ 'Authorization': `Bearer ${await getToken()}`, 'Content-Type': 'application/json' });

  async function create(row) {
    const res = await fetchImpl(url(''), { method: 'POST', headers: await auth(), body: JSON.stringify(row) });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`L1 저장 실패 (HTTP ${res.status}) ${text.slice(0, 200)}`);
    }
    return res.json();
  }

  async function getById(id) {
    const res = await fetchImpl(url(`/${encodeURIComponent(id)}`), { headers: await auth() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`L1 조회 실패 (HTTP ${res.status})`);
    return res.json();
  }

  async function update(id, patch) {
    const res = await fetchImpl(url(`/${encodeURIComponent(id)}`), { method: 'PATCH', headers: await auth(), body: JSON.stringify(patch) });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`L1 갱신 실패 (HTTP ${res.status}) ${text.slice(0, 200)}`);
    }
    return res.json();
  }

  async function search({ status, region, property_type, min_price, max_price } = {}) {
    const parts = [];
    if (status) parts.push(`status='${q(status)}'`);
    if (region) parts.push(`region~'${q(region)}'`);          // ~ = PocketBase 부분일치(LIKE)
    if (property_type) parts.push(`property_type='${q(property_type)}'`);
    if (Number.isFinite(min_price)) parts.push(`price>=${Math.floor(min_price)}`);
    if (Number.isFinite(max_price)) parts.push(`price<=${Math.floor(max_price)}`);
    const filter = encodeURIComponent(parts.join(' && '));
    const res = await fetchImpl(url(`?filter=${filter}&sort=-created&perPage=100`), { headers: await auth() });
    if (!res.ok) throw new Error(`L1 조회 실패 (HTTP ${res.status})`);
    const data = await res.json();
    return data.items || [];
  }

  async function findMine(pubkey) {
    const p = q(pubkey);
    const filter = encodeURIComponent(`creditor_pubkey='${p}' || debtor_pubkey='${p}'`);
    const res = await fetchImpl(url(`?filter=${filter}&sort=-created&perPage=100`), { headers: await auth() });
    if (!res.ok) throw new Error(`L1 조회 실패 (HTTP ${res.status})`);
    const data = await res.json();
    return data.items || [];
  }

  return { create, getById, update, search, findMine };
}
