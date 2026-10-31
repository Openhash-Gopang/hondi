import test from 'node:test';
import assert from 'node:assert/strict';
await import('../case-core.js'); await import('../case-sync.js');
const C = globalThis.CaseCore, Y = globalThis.CaseSync;

test('서명 증명: 올바른 키만 통과, 본문·타입·측면·키가 바뀌면 실패', async () => {
  const a = await Y.generateIdentity(), b = await Y.generateIdentity();
  const p = await Y.signPayload(a, 'c', 'agreement_confirm', 'provider', { proposal_hash: 'h' });
  const e = { case_id: 'c', type: 'agreement_confirm', actor_side: 'provider', payload: p };
  assert.equal(await Y.verifyEntryProof(e, a.pub), true);
  assert.equal(await Y.verifyEntryProof(e, b.pub), false);
  assert.equal(await Y.verifyEntryProof({ ...e, type: 'invoice_issued' }, a.pub), false);
  assert.equal(await Y.verifyEntryProof({ ...e, actor_side: 'consumer' }, a.pub), false);
  assert.equal(await Y.verifyEntryProof({ ...e, case_id: 'z' }, a.pub), false);
  assert.equal(await Y.verifyEntryProof({ ...e, payload: { ...p, proposal_hash: 'x' } }, a.pub), false);
  assert.equal(await Y.verifyEntryProof({ ...e, payload: { proposal_hash: 'h' } }, a.pub), false);
});

test('합의 도출: 같은 제안 해시에 양측이 서명해야 한다', async () => {
  const a = await Y.generateIdentity(), b = await Y.generateIdentity(), keys = { provider: a.pub, consumer: b.pub };
  const mk = async (id, side, h) => ({ case_id: 'c', type: 'agreement_confirm', actor_side: side, payload: await Y.signPayload(id, 'c', 'agreement_confirm', side, { proposal_hash: h }) });
  assert.deepEqual((await Y.deriveConfirmations([await mk(a, 'provider', 'h1')], keys)).consumer, false);
  const d = await Y.deriveConfirmations([await mk(a, 'provider', 'h1'), await mk(b, 'consumer', 'h2')], keys);
  assert.equal(d.provider && d.consumer, false); assert.equal(d.proposal_hash, null);
  const ok = await Y.deriveConfirmations([await mk(a, 'provider', 'h1'), await mk(b, 'consumer', 'h1')], keys);
  assert.deepEqual([ok.provider, ok.consumer, ok.proposal_hash], [true, true, 'h1']);
  assert.equal((await Y.deriveConfirmations([await mk(a, 'provider', 'h1')], null)).provider, false);
});

test('이벤트: 서명·키·변조 검증', async () => {
  const a = await Y.generateIdentity(), b = await Y.generateIdentity();
  const ev = await Y.buildEvent(a, { kind: 'entry', case_id: 'c', side: 'provider', data: { x: 1 } });
  assert.equal(await Y.verifyEvent(ev, a.pub), true);
  assert.equal(await Y.verifyEvent(ev, b.pub), false);
  assert.equal(await Y.verifyEvent({ ...ev, data: { x: 2 } }, a.pub), false);
  assert.equal(await Y.verifyEvent({ ...ev, case_id: 'd' }, a.pub), false);
  assert.equal(await Y.verifyEvent(null, a.pub), false);
});

test('종료 요청자: 서명된 state_request_close 만 인정', async () => {
  const a = await Y.generateIdentity(), b = await Y.generateIdentity(), keys = { provider: a.pub, consumer: b.pub };
  const signed = { case_id: 'c', type: 'state_request_close', actor_side: 'provider', payload: await Y.signPayload(a, 'c', 'state_request_close', 'provider', { outcome: 'o' }) };
  const forged = { case_id: 'c', type: 'state_request_close', actor_side: 'consumer', payload: { outcome: 'o' } };
  assert.equal(await Y.closeRequestedBy([forged], keys), null);
  assert.equal(await Y.closeRequestedBy([signed, forged], keys), 'provider');
});
