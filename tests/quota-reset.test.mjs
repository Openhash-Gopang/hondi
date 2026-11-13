import test from 'node:test';
import assert from 'node:assert/strict';
import { resetFree, getStatus, addSpend, quotaConfig } from '../src/worker/test-quota.js';
const kv = () => { const m = new Map(); return { get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); } }; };
test('resetFree: 500원을 다 쓴 계정도 지금부터 다시 active', async () => {
  const k = kv(), cfg = quotaConfig({}), t0 = Date.parse('2026-11-05T00:00:00Z');
  await resetFree(k, 'g1', t0); await addSpend(k, 'g1', 600, t0 + 1000, cfg);
  assert.notEqual((await getStatus(k, 'g1', t0 + 2000, cfg)).status, 'active');
  const t1 = t0 + 86400000 * 2; await resetFree(k, 'g1', t1);
  const st = await getStatus(k, 'g1', t1 + 1000, cfg);
  assert.equal(st.status, 'active'); assert.equal(st.phase, 'trial');
});
