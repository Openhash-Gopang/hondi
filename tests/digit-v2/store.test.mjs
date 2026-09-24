import test from 'node:test';
import assert from 'node:assert/strict';
import { makePocketBaseDigitStore } from '../../src/worker/digit-claim-store.js';
import { makeDigitClaimHandler } from '../../src/worker/digit-claim-handler.js';
import { makeClaim } from '../../src/gopang/ai/hondi-digit-claim.js';

const b64u = buf => Buffer.from(buf).toString('base64url');
async function wallet() {
  const kp = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  return { publicKeyB64u: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)),
           sign: async m => b64u(await crypto.subtle.sign('Ed25519', kp.privateKey, new TextEncoder().encode(m))) };
}
// PocketBase REST 흉내: 필터 serial='…' 목록, 유니크 인덱스((serial,seq),hash) 위반 시 400
function fakePocketBase() {
  const rows = []; let n = 0;
  return async (input, init = {}) => {
    const u = new URL(input); const method = (init.method || 'GET').toUpperCase();
    if (method === 'GET') {
      const m = /serial='((?:[^'\\]|\\.)*)'/.exec(u.searchParams.get('filter') || '');
      const items = rows.filter(r => !m || r.serial === m[1]).sort((a, b) => a.seq - b.seq);
      return new Response(JSON.stringify({ items, page: 1, perPage: 200, totalItems: items.length }), { status: 200 });
    }
    const body = JSON.parse(init.body);
    if (rows.some(r => (r.serial === body.serial && r.seq === body.seq) || r.hash === body.hash))
      return new Response(JSON.stringify({ code: 400, message: 'Failed to create record.' }), { status: 400 });
    const row = { id: 'r' + (++n), ...body }; rows.push(row);
    return new Response(JSON.stringify(row), { status: 200 });
  };
}

test('어댑터: 저장 후 목록 복원 시 v·ns가 되살아나 체인 검증을 통과한다', async () => {
  const store = makePocketBaseDigitStore({ base: 'https://l1', getToken: async () => 't', fetchImpl: fakePocketBase() });
  const a = await wallet(); const c = await makeClaim(a, '48210');
  await store.appendRecord(c);
  const got = await store.listRecords('48210');
  assert.equal(got.length, 1); assert.equal(got[0].v, 1); assert.equal(got[0].ns, 'hondi.net/digit'); assert.equal(got[0].to, null);
  const { verifyChain } = await import('../../src/gopang/ai/hondi-digit-claim.js');
  assert.ok((await verifyChain(got)).ok);
});

test('어댑터: 같은 (serial,seq) 재저장은 CONFLICT', async () => {
  const store = makePocketBaseDigitStore({ base: 'https://l1', getToken: async () => 't', fetchImpl: fakePocketBase() });
  const a = await wallet(), b = await wallet();
  await store.appendRecord(await makeClaim(a, '77031'));
  await assert.rejects(async () => store.appendRecord(await makeClaim(b, '77031', Date.now() + 1)), /CONFLICT/);
});

test('어댑터: 400이지만 중복이 아니면 CONFLICT가 아닌 저장 실패로 알린다', async () => {
  const fetchImpl = async (u, init = {}) => (init.method || 'GET') === 'GET'
    ? new Response(JSON.stringify({ items: [] }), { status: 200 }) : new Response('bad', { status: 400 });
  const store = makePocketBaseDigitStore({ base: 'https://l1', getToken: async () => 't', fetchImpl });
  const a = await wallet();
  await assert.rejects(async () => store.appendRecord(await makeClaim(a, '12500')), /L1 저장 실패/);
});

test('핸들러+어댑터 통합: 동시 청구 12건 → 정확히 1건 성공', async () => {
  const l1 = makePocketBaseDigitStore({ base: 'https://l1', getToken: async () => 't', fetchImpl: fakePocketBase() });
  const users = {}; const accounts = new Map();
  for (let i = 0; i < 12; i++) { users[i] = await wallet(); accounts.set('g' + i, users[i].publicKeyB64u); }
  const h = makeDigitClaimHandler({ l1, getPinnedPubKey: async (_e, g) => accounts.get(g) || null });
  const results = await Promise.all(Object.keys(users).map(async i => {
    const rec = await makeClaim(users[i], '90417', Date.now() + Number(i));
    const res = await h.handle(new Request('https://x/digit/record', { method: 'POST', body: JSON.stringify({ record: rec, guid: 'g' + i }) }), new URL('https://x/digit/record'), {});
    return res.status;
  }));
  assert.equal(results.filter(s => s === 200).length, 1, results.join(','));
});
