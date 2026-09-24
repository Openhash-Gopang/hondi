import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDigitClaimHandler } from '../../src/worker/digit-claim-handler.js';
import { makeClaim, makeTransfer, makeRevoke, verifyChain } from '../../src/gopang/ai/hondi-digit-claim.js';

const b64u = buf => Buffer.from(buf).toString('base64url');
async function wallet() {
  const kp = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  return { publicKeyB64u: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)),
           sign: async m => b64u(await crypto.subtle.sign('Ed25519', kp.privateKey, new TextEncoder().encode(m))) };
}
// 유니크 인덱스((serial,seq), hash)를 흉내 낸 메모리 저장소 — 비동기 지연을 넣어 경쟁을 유발
function fakeStore() {
  const rows = [];
  return {
    rows,
    async listRecords(serial) { await new Promise(r => setTimeout(r, 1)); return rows.filter(r => r.serial === serial).sort((a, b) => a.seq - b.seq); },
    async appendRecord(rec) {
      await new Promise(r => setTimeout(r, 1));
      if (rows.some(r => (r.serial === rec.serial && r.seq === rec.seq) || r.hash === rec.hash)) throw new Error('CONFLICT');
      rows.push({ ...rec });
    },
  };
}
async function setup() {
  const l1 = fakeStore();
  const accounts = new Map(); const users = {};
  for (const n of ['alice', 'bob', 'eve']) { users[n] = await wallet(); accounts.set('guid-' + n, users[n].publicKeyB64u); }
  const authority = await wallet();
  const h = makeDigitClaimHandler({ l1, getPinnedPubKey: async (_e, g) => accounts.get(g) || null, authorityPubKey: authority.publicKeyB64u });
  const post = async (record, guid, grant) => {
    const res = await h.handle(new Request('https://x/digit/record', { method: 'POST', body: JSON.stringify({ record, guid, grant }) }), new URL('https://x/digit/record'), {});
    return { status: res.status, body: await res.json() };
  };
  const get = async (path) => { const u = new URL('https://x' + path); const res = await h.handle(new Request(u), u, {}); return { status: res.status, body: await res.json() }; };
  return { l1, users, authority, post, get };
}

test('정상 청구 → status=claimed, 공개 체인으로 서버 없이 소유자 검증', async () => {
  const { users, post, get } = await setup();
  const r = await post(await makeClaim(users.alice, '48210'), 'guid-alice');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const st = await get('/digit/status?serial=48210');
  assert.equal(st.body.status, 'claimed'); assert.equal(st.body.owner, users.alice.publicKeyB64u);
  const ch = await get('/digit/chain?serial=48210');
  const v = await verifyChain(ch.body.records);
  assert.ok(v.ok); assert.equal(v.state.owner, users.alice.publicKeyB64u);
});

test('동시에 같은 번호 청구 20건 → 정확히 1건만 성공(RACE_LOST/ALREADY_CLAIMED)', async () => {
  const { l1, users, post } = await setup();
  // 각 요청자를 서로 다른 계정 키로 — 여기선 alice/bob/eve를 번갈아 사용
  const names = ['alice', 'bob', 'eve'];
  const recs = await Promise.all(Array.from({ length: 20 }, async (_, i) => {
    const n = names[i % 3]; return { n, rec: await makeClaim(users[n], '73019', Date.now() + i) };
  }));
  const results = await Promise.all(recs.map(({ n, rec }) => post(rec, 'guid-' + n)));
  const oks = results.filter(r => r.status === 200);
  assert.equal(oks.length, 1, results.map(r => r.status + ':' + (r.body.code || 'ok')).join(' '));
  assert.equal(l1.rows.filter(r => r.serial === '73019').length, 1);
  assert.ok(results.filter(r => r.status !== 200).every(r => ['RACE_LOST', 'ALREADY_CLAIMED'].includes(r.body.code)));
});

test('다른 계정의 키로 서명한 청구는 거절(KEY_MISMATCH) — 폰 인증된 계정 ↔ 지갑 키 결합', async () => {
  const { users, post } = await setup();
  const rec = await makeClaim(users.eve, '90909');                 // eve 키로 서명
  const r = await post(rec, 'guid-alice');                         // alice 계정으로 제출
  assert.equal(r.status, 403); assert.equal(r.body.code, 'KEY_MISMATCH');
});

test('존재하지 않는 계정·잘못된 번호·누락 필드', async () => {
  const { users, post } = await setup();
  assert.equal((await post(await makeClaim(users.alice, '48211'), 'guid-nobody')).body.code, 'NO_ACCOUNT');
  assert.equal((await post({ serial: '0123' }, 'guid-alice')).body.code, 'SERIAL');
  assert.equal((await post(null, 'guid-alice')).status, 400);
});

test('예약(5자리 미만)·공공번호는 청구 불가, grant가 있어야 예약번호 청구', async () => {
  const { users, authority, post, get } = await setup();
  assert.equal((await get('/digit/status?serial=1004')).body.status, 'reserved');
  assert.equal((await get('/digit/status?serial=112')).body.status, 'blocked');
  assert.equal((await post(await makeClaim(users.alice, '1004'), 'guid-alice')).body.code, 'RESERVED');
  const grant = { serial: '1004', owner: users.alice.publicKeyB64u, sig: await authority.sign(`hondi-digit-grant\n1004\n${users.alice.publicKeyB64u}`) };
  assert.equal((await post(await makeClaim(users.alice, '1004'), 'guid-alice', grant)).status, 200);
  const g112 = { serial: '112', owner: users.alice.publicKeyB64u, sig: await authority.sign(`hondi-digit-grant\n112\n${users.alice.publicKeyB64u}`) };
  assert.equal((await post(await makeClaim(users.alice, '112'), 'guid-alice', g112)).body.code, 'PUBLIC_SAFETY');
});

test('양도·폐기 전 과정 + 폐기 번호 재청구 불가 + 제3자 양도 시도 거절', async () => {
  const { users, post, get } = await setup();
  const c = await makeClaim(users.alice, '55123');
  assert.equal((await post(c, 'guid-alice')).status, 200);
  const head = { serial: '55123', seq: 0, hash: c.hash };
  // eve가 (자기 계정으로) 남의 번호를 양도받으려는 위조 시도
  const evil = await makeTransfer(users.eve, head, users.eve.publicKeyB64u);
  assert.equal((await post(evil, 'guid-eve')).body.code, 'NOT_OWNER');
  const t = await makeTransfer(users.alice, head, users.bob.publicKeyB64u);
  assert.equal((await post(t, 'guid-alice')).status, 200);
  assert.equal((await get('/digit/status?serial=55123')).body.owner, users.bob.publicKeyB64u);
  const rv = await makeRevoke(users.bob, { serial: '55123', seq: 1, hash: t.hash });
  assert.equal((await post(rv, 'guid-bob')).status, 200);
  assert.equal((await get('/digit/status?serial=55123')).body.status, 'revoked');
  assert.equal((await post(await makeClaim(users.eve, '55123'), 'guid-eve')).status, 409);
});

test('저장소가 변조되면(체인 손상) 500 CHAIN_CORRUPT — 조용히 넘어가지 않는다', async () => {
  const { l1, users, post, get } = await setup();
  await post(await makeClaim(users.alice, '31000'), 'guid-alice');
  l1.rows[0].owner = users.eve.publicKeyB64u;                       // DB 직접 조작
  const r = await get('/digit/status?serial=31000');
  assert.equal(r.status, 500); assert.equal(r.body.code, 'CHAIN_CORRUPT');
});
