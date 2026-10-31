/**
 * 맡은 일/맡긴 일의 모든 상태 전이는 서명 이벤트로 상대에게 전해져 두 기기의 상태가 같아야 한다.
 * 실행: node --test tests/case-transitions.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
['case-core', 'case-store', 'case-sync'].forEach(f => require('../' + f + '.js'));
const { CaseStore, MemoryAdapter } = globalThis.CaseStore, { CaseSync } = globalThis;

async function pair() {
  const ia = await CaseSync.generateIdentity(), ib = await CaseSync.generateIdentity();
  const A = new CaseStore(MemoryAdapter(), { identity: ia }), B = new CaseStore(MemoryAdapter(), { identity: ib });
  await A.createCase({ case_id: 'c1', title: 't', kind: 'case', my_side: 'provider' });
  await B.createCase({ case_id: 'c1', title: 't', kind: 'case', my_side: 'consumer' });
  const keys = { provider: ia.pub, consumer: ib.pub };
  await A.setKeys('c1', keys); await B.setKeys('c1', keys);
  const prop = { case_id: 'c1', title: 't', kind: 'case' };
  const a = await A.confirmAgreement('c1', prop), b = await B.confirmAgreement('c1', prop);
  assert.ok((await B.ingestEvent('c1', a.event)).ok); assert.ok((await A.ingestEvent('c1', b.event)).ok);
  return { A, B };
}
async function step(from, to, ev, side, extra) {
  const r = await from.applyTransition('c1', ev, Object.assign({ side }, extra || {}), { visibility: 'shared', payload: extra && extra.outcome ? { outcome: extra.outcome } : undefined });
  assert.ok(r.ok, ev + ': ' + (r.error || ''));
  assert.ok(r.event, ev + ' 은 상대에게 보낼 서명 이벤트가 있어야 한다');
  const g = await to.ingestEvent('c1', r.event);
  assert.ok(g.ok, ev + ' 수신: ' + (g.code || ''));
}
const st = async (S) => (await S.getCase('c1')).state;

test('성립·시작·보류·재개·종료요청·동의·보관까지 두 기기의 상태가 매 단계 같다', async () => {
  const { A, B } = await pair();
  await step(A, B, 'accept', 'provider'); assert.equal(await st(A), await st(B));
  await step(A, B, 'activate', 'provider'); assert.equal(await st(B), 'active');
  await step(B, A, 'hold', 'consumer'); assert.equal(await st(A), 'on_hold');
  await step(A, B, 'resume', 'provider'); assert.equal(await st(B), 'active');
  await step(B, A, 'request_close', 'consumer', { outcome: '완료' }); assert.equal(await st(A), 'closing');
  await step(A, B, 'close_agree', 'provider'); assert.equal(await st(B), 'closed');
  await step(A, B, 'archive', 'provider'); assert.equal(await st(B), 'archived');
});

test('동시에 같은 전이를 한 경우는 충돌이 아니라 수렴으로 처리한다', async () => {
  const { A, B } = await pair();
  await step(A, B, 'accept', 'provider'); await step(A, B, 'activate', 'provider');
  const ra = await A.applyTransition('c1', 'hold', { side: 'provider' }, { visibility: 'shared' });
  const rb = await B.applyTransition('c1', 'hold', { side: 'consumer' }, { visibility: 'shared' });
  const g1 = await B.ingestEvent('c1', ra.event), g2 = await A.ingestEvent('c1', rb.event);
  assert.ok(g1.ok && g1.converged && g2.ok && g2.converged);
  assert.equal(await st(A), 'on_hold'); assert.equal(await st(B), 'on_hold');
});

test('서로 다른 전이가 엇갈리면 여전히 STATE_MISMATCH 로 막힌다', async () => {
  const { A, B } = await pair();
  await step(A, B, 'accept', 'provider'); await step(A, B, 'activate', 'provider');
  const ra = await A.applyTransition('c1', 'hold', { side: 'provider' }, { visibility: 'shared' });
  const rb = await B.applyTransition('c1', 'request_close', { side: 'consumer', outcome: 'x' }, { visibility: 'shared', payload: { outcome: 'x' } });
  assert.equal((await B.ingestEvent('c1', ra.event)).code, 'STATE_MISMATCH');
  void rb;
});
