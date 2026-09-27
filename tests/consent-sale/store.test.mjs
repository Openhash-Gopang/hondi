import test from 'node:test';
import assert from 'node:assert/strict';
import { makeConsentSaleStore } from '../../src/worker/consent-sale-store.js';

// PocketBase REST 흉내 — filter의 필드=값/부분일치(~)/비교(>=,<=)를 아주 단순하게 파싱한다.
// 실제 PocketBase 문법 전체를 흉내내지 않고, 이 스토어가 실제로 만드는 필터 모양만 지원한다.
function fakePocketBase() {
  const rows = []; let n = 0;
  function matches(row, filter) {
    if (!filter) return true;
    return filter.split(' && ').every(clause => {
      let m;
      if ((m = /^(\w+)='((?:[^'\\]|\\.)*)'$/.exec(clause))) return row[m[1]] === m[2];
      if ((m = /^(\w+)~'((?:[^'\\]|\\.)*)'$/.exec(clause))) return String(row[m[1]] || '').includes(m[2]);
      if ((m = /^(\w+)>=(\d+)$/.exec(clause))) return row[m[1]] >= Number(m[2]);
      if ((m = /^(\w+)<=(\d+)$/.exec(clause))) return row[m[1]] <= Number(m[2]);
      throw new Error('unsupported clause: ' + clause);
    });
  }
  return async (input, init = {}) => {
    const u = new URL(input); const method = (init.method || 'GET').toUpperCase();
    if (method === 'GET') {
      const tail = u.pathname.split('/records')[1] || ''; // '', or '/r3' for a single-record GET
      if (tail && tail !== '/') {
        const id = tail.replace(/^\//, '');
        const row = rows.find(r => r.id === id);
        return row ? new Response(JSON.stringify(row), { status: 200 }) : new Response('not found', { status: 404 });
      }
      // OR 필터(creditor_pubkey='x' || debtor_pubkey='x')는 findMine 전용 — 별도 처리
      const rawFilter = u.searchParams.get('filter') || '';
      let items;
      const orParts = rawFilter.split(' || ');
      if (orParts.length > 1) items = rows.filter(r => orParts.some(p => matches(r, p)));
      else items = rows.filter(r => matches(r, rawFilter));
      return new Response(JSON.stringify({ items, page: 1, perPage: 100, totalItems: items.length }), { status: 200 });
    }
    if (method === 'POST') {
      const body = JSON.parse(init.body);
      const row = { id: 'r' + (++n), created: n, ...body };
      rows.push(row);
      return new Response(JSON.stringify(row), { status: 200 });
    }
    if (method === 'PATCH') {
      const id = u.pathname.split('/').pop();
      const row = rows.find(r => r.id === id);
      if (!row) return new Response('not found', { status: 404 });
      Object.assign(row, JSON.parse(init.body));
      return new Response(JSON.stringify(row), { status: 200 });
    }
    return new Response('unsupported method', { status: 400 });
  };
}

function store() {
  return makeConsentSaleStore({ base: 'https://l1', getToken: async () => 't', fetchImpl: fakePocketBase() });
}

test('create/getById — 저장한 레코드를 id로 다시 읽을 수 있다', async () => {
  const s = store();
  const rec = await s.create({ region: '부산 영도구', property_type: '단독주택', price: 45000000, status: 'draft_unsigned' });
  const got = await s.getById(rec.id);
  assert.equal(got.region, '부산 영도구');
});

test('getById — 없는 id는 null', async () => {
  const s = store();
  assert.equal(await s.getById('nope'), null);
});

test('update — 부분 갱신 후 갱신된 필드가 반영된다', async () => {
  const s = store();
  const rec = await s.create({ region: '제주', property_type: '토지', price: 1000, status: 'draft_unsigned', creditor_sig: '', debtor_sig: '' });
  const updated = await s.update(rec.id, { creditor_sig: 'abc', status: 'pending_countersign' });
  assert.equal(updated.creditor_sig, 'abc');
  assert.equal(updated.status, 'pending_countersign');
});

test('search — status/region/property_type/가격 범위로 필터링된다', async () => {
  const s = store();
  await s.create({ region: '부산 영도구', property_type: '단독주택', price: 40000000, status: 'active' });
  await s.create({ region: '부산 영도구', property_type: '아파트', price: 90000000, status: 'active' });
  await s.create({ region: '서울 강남구', property_type: '단독주택', price: 30000000, status: 'active' });
  await s.create({ region: '부산 영도구', property_type: '단독주택', price: 40000000, status: 'draft_unsigned' }); // 미확정 — 검색 제외돼야 함

  const r1 = await s.search({ status: 'active', region: '부산', max_price: 50000000 });
  assert.equal(r1.length, 1);
  assert.equal(r1[0].property_type, '단독주택');

  const r2 = await s.search({ status: 'active', property_type: '단독주택' });
  assert.equal(r2.length, 2); // 부산 단독주택 + 서울 단독주택(draft 제외)
});

test('findMine — 이 pubkey가 채권자 또는 채무자인 매물만 돌려준다', async () => {
  const s = store();
  await s.create({ region: 'A', creditor_pubkey: 'pk-alice', debtor_pubkey: 'pk-bob', status: 'active' });
  await s.create({ region: 'B', creditor_pubkey: 'pk-carol', debtor_pubkey: 'pk-alice', status: 'draft_unsigned' });
  await s.create({ region: 'C', creditor_pubkey: 'pk-carol', debtor_pubkey: 'pk-bob', status: 'active' });

  const mine = await s.findMine('pk-alice');
  assert.deepEqual(mine.map(r => r.region).sort(), ['A', 'B']);
});
