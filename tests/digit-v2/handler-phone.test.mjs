import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDigitClaimHandler } from '../../src/worker/digit-claim-handler.js';
import { makeClaim } from '../../src/gopang/ai/hondi-digit-claim.js';

const b64u = buf => Buffer.from(buf).toString('base64url');
async function wallet() {
  const kp = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  return { publicKeyB64u: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)),
           sign: async m => b64u(await crypto.subtle.sign('Ed25519', kp.privateKey, new TextEncoder().encode(m))) };
}
function fakeStore() {
  const rows = [];
  return { rows,
    async listRecords(serial) { return rows.filter(r => r.serial === serial).sort((a, b) => a.seq - b.seq); },
    async appendRecord(rec) { if (rows.some(r => (r.serial === rec.serial && r.seq === rec.seq) || r.hash === rec.hash)) throw new Error('CONFLICT'); rows.push({ ...rec }); } };
}
async function setup(verifyPhoneToken) {
  const l1 = fakeStore(), alice = await wallet();
  const h = makeDigitClaimHandler({ l1, getPinnedPubKey: async (_e, g) => (g === 'g-alice' ? alice.publicKeyB64u : null), verifyPhoneToken });
  const post = async (body) => { const res = await h.handle(new Request('https://x/digit/record', { method: 'POST', body: JSON.stringify(body) }), new URL('https://x/digit/record'), {}); return { status: res.status, body: await res.json() }; };
  return { l1, alice, post };
}

test('verifyPhoneToken이 주입되면 토큰 없는 요청은 401 PHONE_TOKEN_REQUIRED, 저장되지 않음', async () => {
  const { l1, alice, post } = await setup(async () => ({ ok: true }));
  const r = await post({ record: await makeClaim(alice, '48210'), guid: 'g-alice' });
  assert.equal(r.status, 401); assert.equal(r.body.code, 'PHONE_TOKEN_REQUIRED'); assert.equal(l1.rows.length, 0);
});
test('검증기가 거절하면 그 상태코드·코드 그대로 전달, 저장되지 않음', async () => {
  const { l1, alice, post } = await setup(async () => ({ ok: false, status: 401, code: 'PHONE_TOKEN_STALE', message: '방금 진행한 문자 인증만…' }));
  const r = await post({ record: await makeClaim(alice, '48210'), guid: 'g-alice', phone_verify_token: 'x' });
  assert.equal(r.status, 401); assert.equal(r.body.code, 'PHONE_TOKEN_STALE'); assert.equal(l1.rows.length, 0);
});
test('검증기 통과 + 서명 정상 → 등록. 검증기는 (env, 토큰, guid)를 받는다', async () => {
  let seen; const { l1, alice, post } = await setup(async (env, tok, guid, extra) => { seen = { tok, guid, su: extra.step_up_token }; return { ok: true }; });
  const r = await post({ record: await makeClaim(alice, '73019'), guid: 'g-alice', phone_verify_token: 'tok-1', step_up_token: 'su-9' });
  assert.equal(r.status, 200); assert.deepEqual(seen, { tok: 'tok-1', guid: 'g-alice', su: 'su-9' }); assert.equal(l1.rows.length, 1);
});
test('문자 토큰이 유효해도 서명 키가 계정 키와 다르면 여전히 거절(두 요소 모두 필요)', async () => {
  const { alice, post } = await setup(async () => ({ ok: true }));
  const eve = await wallet();
  const r = await post({ record: await makeClaim(eve, '90417'), guid: 'g-alice', phone_verify_token: 'tok' });
  assert.equal(r.status, 403); assert.equal(r.body.code, 'KEY_MISMATCH');
});
test('검증기를 주입하지 않으면(기존 동작) 토큰 없이도 등록 — 하위 호환', async () => {
  const { alice, post } = await setup(null);
  assert.equal((await post({ record: await makeClaim(alice, '31872'), guid: 'g-alice' })).status, 200);
});
