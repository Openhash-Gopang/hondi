import test from 'node:test';
import assert from 'node:assert/strict';
import { makeConsentSaleHandler } from '../../src/worker/consent-sale-handler.js';
import { canonical } from '../../src/gopang/ai/hondi-consent-sale.js';

const b64u = buf => Buffer.from(buf).toString('base64url');
async function wallet() {
  const kp = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  return {
    publicKeyB64u: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)),
    sign: async m => b64u(await crypto.subtle.sign('Ed25519', kp.privateKey, new TextEncoder().encode(m))),
  };
}

function fakeStore() {
  const rows = new Map(); let n = 0;
  return {
    rows,
    async create(row) { const id = 'r' + (++n); const rec = { id, ...row }; rows.set(id, rec); return rec; },
    async getById(id) { return rows.get(id) || null; },
    async update(id, patch) { const rec = rows.get(id); if (!rec) throw new Error('NOT_FOUND'); Object.assign(rec, patch); return rec; },
    async search({ status, region, property_type, min_price, max_price }) {
      return [...rows.values()].filter(r =>
        (!status || r.status === status) &&
        (!region || String(r.region).includes(region)) &&
        (!property_type || r.property_type === property_type) &&
        (min_price == null || r.price >= min_price) &&
        (max_price == null || r.price <= max_price));
    },
    async findMine(pubkey) { return [...rows.values()].filter(r => r.creditor_pubkey === pubkey || r.debtor_pubkey === pubkey); },
  };
}

async function setup(chatTextImpl) {
  const l1 = fakeStore();
  const accounts = new Map();
  const users = {};
  for (const n of ['alice', 'bob', 'eve']) { users[n] = await wallet(); accounts.set('guid-' + n, users[n].publicKeyB64u); }
  const h = makeConsentSaleHandler({
    l1, getPinnedPubKey: async (_e, g) => accounts.get(g) || null,
    ...(chatTextImpl ? { chatText: chatTextImpl } : {}),
  });
  const call = async (method, path, body) => {
    const u = new URL('https://x' + path);
    const req = body !== undefined ? new Request(u, { method, body: JSON.stringify(body) }) : new Request(u, { method });
    const res = await h.handle(req, u, {});
    return { status: res.status, body: await res.json() };
  };
  return { l1, users, call };
}

test('draft — 정상 제안이면 draft_unsigned로 생성되고 payload를 돌려준다', async () => {
  const { call } = await setup();
  const r = await call('POST', '/consent-sale/draft', {
    my_guid: 'guid-alice', role: 'creditor', counterparty_guid: 'guid-bob',
    region: '부산 영도구', property_type: '단독주택', price: 45000000, description: '방 2개',
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.id); assert.equal(r.body.payload.region, '부산 영도구');
});

test('draft — 모르는 계정·자기 자신과의 거래·잘못된 필드는 거절', async () => {
  const { call } = await setup();
  const base = { role: 'creditor', region: '부산', property_type: '단독주택', price: 1000 };
  assert.equal((await call('POST', '/consent-sale/draft', { ...base, my_guid: 'guid-nobody', counterparty_guid: 'guid-bob' })).body.code, 'NO_ACCOUNT');
  assert.equal((await call('POST', '/consent-sale/draft', { ...base, my_guid: 'guid-alice', counterparty_guid: 'guid-nobody' })).body.code, 'COUNTERPARTY_NOT_FOUND');
  assert.equal((await call('POST', '/consent-sale/draft', { ...base, my_guid: 'guid-alice', counterparty_guid: 'guid-alice' })).body.code, 'SELF_DEAL');
  assert.equal((await call('POST', '/consent-sale/draft', { ...base, my_guid: 'guid-alice', counterparty_guid: 'guid-bob', property_type: '경매장' })).body.code, 'FIELD');
});

test('sign — 두 서명이 다 모여야 active, 그 전까지 pending_countersign', async () => {
  const { call, users } = await setup();
  const d = await call('POST', '/consent-sale/draft', {
    my_guid: 'guid-alice', role: 'creditor', counterparty_guid: 'guid-bob',
    region: '부산 영도구', property_type: '단독주택', price: 45000000,
  });
  const { id, payload } = d.body;
  const msg = canonical(payload);

  const s1 = await call('POST', '/consent-sale/sign', { id, guid: 'guid-alice', sig: await users.alice.sign(msg) });
  assert.equal(s1.status, 200); assert.equal(s1.body.status, 'pending_countersign');

  const s2 = await call('POST', '/consent-sale/sign', { id, guid: 'guid-bob', sig: await users.bob.sign(msg) });
  assert.equal(s2.status, 200); assert.equal(s2.body.status, 'active');
});

test('sign — 잘못된 서명(BAD_SIG)·당사자 아님(NOT_PARTY)·중복 서명(ALREADY_SIGNED)·이미 확정(ALREADY_ACTIVE)', async () => {
  const { call, users } = await setup();
  const d = await call('POST', '/consent-sale/draft', {
    my_guid: 'guid-alice', role: 'creditor', counterparty_guid: 'guid-bob',
    region: '부산', property_type: '토지', price: 1000,
  });
  const { id, payload } = d.body;
  const msg = canonical(payload);

  assert.equal((await call('POST', '/consent-sale/sign', { id, guid: 'guid-eve', sig: await users.eve.sign(msg) })).body.code, 'NOT_PARTY');
  assert.equal((await call('POST', '/consent-sale/sign', { id, guid: 'guid-alice', sig: await users.eve.sign(msg) })).body.code, 'BAD_SIG');

  await call('POST', '/consent-sale/sign', { id, guid: 'guid-alice', sig: await users.alice.sign(msg) });
  assert.equal((await call('POST', '/consent-sale/sign', { id, guid: 'guid-alice', sig: await users.alice.sign(msg) })).body.code, 'ALREADY_SIGNED');

  await call('POST', '/consent-sale/sign', { id, guid: 'guid-bob', sig: await users.bob.sign(msg) });
  assert.equal((await call('POST', '/consent-sale/sign', { id, guid: 'guid-bob', sig: await users.bob.sign(msg) })).body.code, 'ALREADY_ACTIVE');
});

test('search — active만 노출되고, 신원 정보(guid/pubkey/sig)는 절대 포함되지 않는다', async () => {
  const { call, users } = await setup();
  const d = await call('POST', '/consent-sale/draft', {
    my_guid: 'guid-alice', role: 'creditor', counterparty_guid: 'guid-bob',
    region: '부산 영도구', property_type: '단독주택', price: 45000000,
  });
  const { id, payload } = d.body; const msg = canonical(payload);
  // draft_unsigned 상태 — 검색에 안 잡혀야 함
  assert.equal((await call('GET', '/consent-sale/search?region=부산')).body.listings.length, 0);

  await call('POST', '/consent-sale/sign', { id, guid: 'guid-alice', sig: await users.alice.sign(msg) });
  await call('POST', '/consent-sale/sign', { id, guid: 'guid-bob', sig: await users.bob.sign(msg) });

  const r = await call('GET', '/consent-sale/search?region=부산&max_price=50000000');
  assert.equal(r.body.listings.length, 1);
  const listing = r.body.listings[0];
  assert.equal(listing.region, '부산 영도구');
  for (const key of ['creditor_guid', 'debtor_guid', 'creditor_pubkey', 'debtor_pubkey', 'creditor_sig', 'debtor_sig']) {
    assert.equal(listing[key], undefined, `${key}가 검색 결과에 노출되면 안 됩니다`);
  }
});

test('search-nl — 파싱 성공 시 조건으로 검색, 실패 시 정직하게 parsed:null', async () => {
  const goodChat = async () => JSON.stringify({ region: '부산 영도구', property_type: '단독주택', max_price: 50000000, min_price: null });
  const { call, users } = await setup(goodChat);
  const d = await call('POST', '/consent-sale/draft', {
    my_guid: 'guid-alice', role: 'creditor', counterparty_guid: 'guid-bob',
    region: '부산 영도구', property_type: '단독주택', price: 45000000,
  });
  const { id, payload } = d.body; const msg = canonical(payload);
  await call('POST', '/consent-sale/sign', { id, guid: 'guid-alice', sig: await users.alice.sign(msg) });
  await call('POST', '/consent-sale/sign', { id, guid: 'guid-bob', sig: await users.bob.sign(msg) });

  const r = await call('POST', '/consent-sale/search-nl', { query: '부산 영도구의 부동산 매물 중에서 5천만 원 미만 단독 주택을 검색해 줘' });
  assert.equal(r.body.listings.length, 1);
  assert.equal(r.body.parsed.region, '부산 영도구');
});

test('search-nl — 조건을 못 찾으면 지어내지 않고 정직하게 알린다', async () => {
  const badChat = async () => '이건 JSON이 아닙니다';
  const { call } = await setup(badChat);
  const r = await call('POST', '/consent-sale/search-nl', { query: '아무 말이나' });
  assert.equal(r.status, 200);
  assert.equal(r.body.parsed, null);
  assert.equal(r.body.listings.length, 0);
});

test('appraise — 당사자만 요청 가능, active 매물만, 결과가 저장된다', async () => {
  const appraiseChat = async () => JSON.stringify({ value: 42000000, note: '주변 시세 대비 적정' });
  const { call, users } = await setup(appraiseChat);
  const d = await call('POST', '/consent-sale/draft', {
    my_guid: 'guid-alice', role: 'creditor', counterparty_guid: 'guid-bob',
    region: '부산 영도구', property_type: '단독주택', price: 45000000,
  });
  const { id, payload } = d.body; const msg = canonical(payload);

  // 아직 draft_unsigned — 거절
  assert.equal((await call('POST', '/consent-sale/appraise', { id, guid: 'guid-alice' })).body.code, 'NOT_ACTIVE');

  await call('POST', '/consent-sale/sign', { id, guid: 'guid-alice', sig: await users.alice.sign(msg) });
  await call('POST', '/consent-sale/sign', { id, guid: 'guid-bob', sig: await users.bob.sign(msg) });

  // 당사자가 아닌 eve는 거절
  assert.equal((await call('POST', '/consent-sale/appraise', { id, guid: 'guid-eve' })).body.code, 'NOT_PARTY');

  const r = await call('POST', '/consent-sale/appraise', { id, guid: 'guid-bob' });
  assert.equal(r.status, 200); assert.equal(r.body.appraisal_value, 42000000);

  const search = await call('GET', '/consent-sale/search?region=부산');
  assert.equal(search.body.listings[0].appraisal_value, 42000000);
});

test('mine — 내가 채권자·채무자인 매물 모두, 서명 여부와 역할을 함께 알려준다', async () => {
  const { call, users } = await setup();
  const d1 = await call('POST', '/consent-sale/draft', {
    my_guid: 'guid-alice', role: 'creditor', counterparty_guid: 'guid-bob', region: '지역A', property_type: '토지', price: 1000,
  });
  await call('POST', '/consent-sale/draft', {
    my_guid: 'guid-eve', role: 'debtor', counterparty_guid: 'guid-bob', region: '지역B', property_type: '상가', price: 2000,
  });
  await call('POST', '/consent-sale/sign', { id: d1.body.id, guid: 'guid-alice', sig: await users.alice.sign(canonical(d1.body.payload)) });

  const mine = await call('GET', '/consent-sale/mine?guid=guid-alice');
  assert.equal(mine.body.listings.length, 1);
  assert.equal(mine.body.listings[0].my_role, 'creditor');
  assert.equal(mine.body.listings[0].creditor_signed, true);
  assert.equal(mine.body.listings[0].debtor_signed, false);
});
