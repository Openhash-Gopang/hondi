import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDigitClaimHandler } from '../../src/worker/digit-claim-handler.js';
import { issueDigitCode } from '../../src/gopang/ai/hondi-digit-issue.js';

const b64u = buf => Buffer.from(buf).toString('base64url');
async function wallet() {
  const kp = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  return { publicKeyB64u: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)),
           signPayload: async m => b64u(await crypto.subtle.sign('Ed25519', kp.privateKey, new TextEncoder().encode(m))) };
}
function env() {
  const rows = [];
  const l1 = {
    async listRecords(serial) { await new Promise(r => setTimeout(r, 1)); return rows.filter(r => r.serial === serial).sort((a, b) => a.seq - b.seq); },
    async appendRecord(rec) { await new Promise(r => setTimeout(r, 1)); if (rows.some(r => (r.serial === rec.serial && r.seq === rec.seq) || r.hash === rec.hash)) throw new Error('CONFLICT'); rows.push({ ...rec }); },
    async countClaims() { return rows.filter(r => r.seq === 0).length; },
  };
  const keys = new Map();
  const h = makeDigitClaimHandler({ l1, getPinnedPubKey: async (_e, g) => keys.get(g) || null });
  globalThis.fetch = async (u, init = {}) => { const url = new URL(u); return h.handle(new Request(url, init), url, {}); };
  return { rows, keys };
}

test('가입 때 자동 발급: 순번대로 10002, 10003 … (제외 번호 건너뜀) + 한 계정 한 번호', async () => {
  const { rows, keys } = env();
  const got = [];
  for (const g of ['a', 'b', 'c']) {
    const w = await wallet(); keys.set(g, w.publicKeyB64u);
    const r = await issueDigitCode({ guid: g, wallet: w, worker: 'https://x' });
    assert.equal(r.ok, true); got.push(r.serial);
  }
  assert.deepEqual(got, ['10002', '10003', '10004']);
  assert.equal(rows.length, 3);
});

test('동시 가입 10건 → 모두 서로 다른 번호를 받는다(경쟁 시 재시도)', async () => {
  const { keys } = env();
  const ws = await Promise.all(Array.from({ length: 10 }, async (_, i) => { const w = await wallet(); keys.set('g' + i, w.publicKeyB64u); return w; }));
  const rs = await Promise.all(ws.map((w, i) => issueDigitCode({ guid: 'g' + i, wallet: w, worker: 'https://x', maxTries: 12 })));
  assert.ok(rs.every(r => r.ok), JSON.stringify(rs.filter(r => !r.ok)));
  assert.equal(new Set(rs.map(r => r.serial)).size, 10);
});

test('계정에 핀되지 않은 키로는 발급 거절(KEY_MISMATCH)', async () => {
  const { keys } = env();
  const w = await wallet(); keys.set('x', (await wallet()).publicKeyB64u);
  const r = await issueDigitCode({ guid: 'x', wallet: w, worker: 'https://x' });
  assert.equal(r.ok, false); assert.equal(r.code, 'KEY_MISMATCH');
});
