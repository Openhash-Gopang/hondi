import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCaptureServer, validateItem } from '../src/worker/capture-server.js';

function kv() { const m = new Map(); return { m, get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); } }; }
const S = 'abcdefghijklmnop1234';
const PUB = 'A'.repeat(43);
const item = (seq) => ({ seq, sha256: 'a'.repeat(64), sealed: { ephemeralPubKey: 'AAAA', iv: 'BBBB', ciphertext: 'CCCC' } });
function mk(over = {}) {
  const store = kv(); const notes = [];
  const srv = makeCaptureServer({
    env: {}, kv: store,
    resolveGuid: async (_e, b, o) => b.guid === 'g1' && o.sigMsg === `capture-${o.sigMsg.split(':')[0].slice(8)}:g1:${S}:${b.ts}` ? { ok: true, guid: 'g1' } : { ok: false, status: 403, code: 'AUTH_REQUIRED', message: 'x' },
    notify: async (g, i) => { notes.push([g, i]); }, ...over,
  });
  return { srv, store, notes };
}
const B = (extra = {}) => ({ guid: 'g1', s: S, ts: 1, ...extra });

test('open: 세션 저장·폰 알림', async () => {
  const { srv, store, notes } = mk();
  const r = await srv.open(B({ pc_pub: PUB, label: '소장 초안' }));
  assert.equal(r.status, 200); assert.equal(r.json.notified, true);
  assert.equal(notes.length, 1); assert.ok(store.m.has(`capture:g1:${S}`));
});
test('open: 인증 실패·잘못된 세션 id·공개키 거부', async () => {
  const { srv } = mk();
  assert.equal((await srv.open({ ...B({ pc_pub: PUB }), guid: 'other' })).status, 403);
  assert.equal((await srv.open(B({ s: 'short', pc_pub: PUB }))).json.code, 'BAD_SESSION_ID');
  assert.equal((await srv.open(B({ pc_pub: '!!' }))).json.code, 'BAD_PC_PUB');
});
test('push→pull: 1회 소비, 중복 seq 무시', async () => {
  const { srv } = mk(); await srv.open(B({ pc_pub: PUB }));
  assert.equal((await srv.get(B())).json.pc_pub, PUB);
  assert.equal((await srv.push(B({ item: item(0) }))).json.queued, 1);
  assert.equal((await srv.push(B({ item: item(0) }))).json.duplicate, true);
  await srv.push(B({ item: item(1) }));
  const p = await srv.pull(B()); assert.equal(p.json.items.length, 2);
  assert.deepEqual(Object.keys(p.json.items[0]).sort(), ['sealed', 'seq', 'sha256']);
  assert.equal((await srv.pull(B())).json.items.length, 0);
});
test('세션 없으면 push/get 404, close 후 폐기', async () => {
  const { srv } = mk();
  assert.equal((await srv.push(B({ item: item(0) }))).status, 404);
  await srv.open(B({ pc_pub: PUB })); await srv.push(B({ item: item(0) }));
  assert.equal((await srv.close(B())).status, 200);
  assert.equal((await srv.get(B())).status, 404);
  assert.equal((await srv.pull(B())).status, 404);
});
test('봉투 검증: 평문 필드·크기·형식', () => {
  assert.deepEqual(validateItem(item(0)), []);
  assert.ok(validateItem({ ...item(0), image: 'data:...' }).length);
  assert.ok(validateItem({ ...item(0), sha256: 'zz' }).length);
  assert.ok(validateItem({ ...item(0), sealed: { ephemeralPubKey: 'A', iv: 'B', ciphertext: 'C'.repeat(3 * 1024 * 1024) } }).length);
  assert.ok(validateItem({ ...item(0), sealed: { ...item(0).sealed, plain: 'x' } }).length);
});
test('대기열 한도(30장) 초과는 429', async () => {
  const { srv } = mk(); await srv.open(B({ pc_pub: PUB }));
  for (let i = 0; i < 30; i++) assert.equal((await srv.push(B({ item: item(i) }))).status, 200);
  assert.equal((await srv.push(B({ item: item(30) }))).status, 429);
});
test('알림 실패해도 세션은 열린다', async () => {
  const { srv } = mk({ notify: async () => { throw new Error('x'); } });
  const r = await srv.open(B({ pc_pub: PUB })); assert.equal(r.status, 200); assert.equal(r.json.notified, false);
});
