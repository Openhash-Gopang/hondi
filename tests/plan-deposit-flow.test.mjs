// 은행 입금 알림 → 플랜 지정(B안) 흐름: 워커의 /biz/charge-confirm-notification 을 가짜 KV로 끝까지 돌린다(네트워크 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import w from '../worker.js';

const mk = () => { const m = new Map(); return { m, kv: { get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); } } }; };
const call = (env, raw, key) => w.fetch(new Request('https://x/biz/charge-confirm-notification', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ secret: 's', raw_text: raw, notification_key: key, source: 'app_push' }) }), env, { waitUntil() {} });
const seed = (m, over = {}) => { const now = Date.now(); m.set('hondi:plan_req:12345678', JSON.stringify({ guid: 'g1', code: '12345678', tier: 'p100', grant: 'p200', usd: 20, krw: 28000, rate: 1400, created: now, expires: now + 3600e3, ...over })); };

test('정확한 금액의 입금 알림이면 플랜(p200, 30일)을 지정하고 GDC는 충전하지 않는다', async () => {
  const { m, kv } = mk(); const env = { ADMIN_ACTION_SECRET: 's', AI_SETUP_SEALS_KV: kv, GDC_FREE_TEST: '1' }; seed(m);
  const r = await call(env, '[입금] 28,000원 입금 홍길동 12345678 잔액 1,000,000원', 'k1');
  const j = await r.json();
  assert.equal(r.status, 200); assert.equal(j.matched, true); assert.equal(j.plan, true); assert.equal(j.tier, 'p200');
  const st = JSON.parse(m.get('hondi:test_quota:g1'));
  assert.equal(st.tier, 'p200'); assert.ok(st.paid_until > Date.now() + 29 * 86400000);
  assert.equal(m.has('hondi:plan_req:12345678'), false, '요청은 한 번 쓰고 지운다');
  const ev = JSON.parse(m.get('hondi:plan_events')); assert.equal(ev[0].kind, 'applied');
});

test('같은 알림이 다시 와도 플랜을 한 번만 적용하고, 일반 충전으로 넘어가지 않는다', async () => {
  const { m, kv } = mk(); const env = { ADMIN_ACTION_SECRET: 's', AI_SETUP_SEALS_KV: kv, GDC_FREE_TEST: '1' }; seed(m);
  await call(env, '[입금] 28,000원 입금 12345678', 'k1');
  const until = JSON.parse(m.get('hondi:test_quota:g1')).paid_until;
  const r2 = await call(env, '[입금] 28,000원 입금 12345678', 'k1');
  const j2 = await r2.json();
  assert.equal(r2.status, 200); assert.equal(j2.matched, true); assert.equal(j2.already, true);
  assert.equal(JSON.parse(m.get('hondi:test_quota:g1')).paid_until, until, '만료일이 늘어나지 않는다');
});

test('금액이 다르면 플랜을 지정하지 않고 불일치 기록을 남긴다(관리자 화면에서 보인다)', async () => {
  const { m, kv } = mk(); const env = { ADMIN_ACTION_SECRET: 's', AI_SETUP_SEALS_KV: kv, GDC_FREE_TEST: '1' }; seed(m);
  await call(env, '[입금] 27,000원 입금 12345678', 'k9');   // 이후 일반 충전 흐름은 L1이 필요해 가짜 환경에서는 오류로 끝난다 — 여기서는 플랜 쪽만 본다
  assert.equal(m.has('hondi:test_quota:g1'), false);
  const ev = JSON.parse(m.get('hondi:plan_events')); assert.equal(ev[0].kind, 'mismatch'); assert.equal(ev[0].reason, 'PLAN_AMOUNT_MISMATCH');
  assert.equal(ev[0].expected_krw, 28000); assert.equal(ev[0].amount_krw, 27000);
  assert.ok(m.has('hondi:plan_req:12345678'), '요청은 남겨 두어 올바른 금액으로 다시 입금할 수 있다');
});

test('같은 등급을 유효 기간 중에 다시 사면 만료일 뒤로 30일이 이어 붙는다', async () => {
  const { m, kv } = mk(); const env = { ADMIN_ACTION_SECRET: 's', AI_SETUP_SEALS_KV: kv, GDC_FREE_TEST: '1' };
  seed(m); await call(env, '[입금] 28,000원 입금 12345678', 'a1');
  const first = JSON.parse(m.get('hondi:test_quota:g1')).paid_until;
  seed(m); await call(env, '[입금] 28,000원 입금 12345678', 'a2');
  assert.equal(JSON.parse(m.get('hondi:test_quota:g1')).paid_until, first + 30 * 86400000);
});
