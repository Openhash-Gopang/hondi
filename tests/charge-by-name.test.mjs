// 입금자 이름으로 일반 GDC 충전: 알림 문자 → 가입자 이름 매칭 → 입금액만큼 발행 (L1은 가짜 fetch로 대체)
import test from 'node:test';
import assert from 'node:assert/strict';
import w from '../worker.js';

const SMS = '[Web발신]\n2026/11/21 21:34\n입금 1,000원\n잔액 384,000원\n도영민\n315***02804011\n기업';
const mkKv = () => { const m = new Map(); return { m, kv: { get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); }, list: async ({ prefix }) => ({ keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }) } }; };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

function withL1(profiles, run) {
  const calls = [], orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url); calls.push({ u, method: init.method || 'GET', body: init.body });
    if (u.includes('/api/admins/auth-with-password')) return json({ token: 't' });
    if (u.includes('/api/collections/profiles/records')) return json({ items: profiles });
    if (u.includes('/api/mint')) return json({ ok: true, content_hash: 'h1' });
    if (u.includes('/api/collections/charge_requests/records') && (init.method || 'GET') === 'POST') return json({ id: 'rq1' });
    return json({ items: [] });
  };
  return run(calls).finally(() => { globalThis.fetch = orig; });
}
const env = (kv) => ({ ADMIN_ACTION_SECRET: 's', AI_SETUP_SEALS_KV: kv, L1_ADMIN_EMAIL: 'a@b', L1_ADMIN_PASSWORD: 'p', MINT_SECRET: 'm' });
const notify = (e, text, key, extra = {}) => w.fetch(new Request('https://x/biz/charge-confirm-notification', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ secret: 's', raw_text: text, notification_key: key, source: 'sms', ...extra }) }), e, { waitUntil() {} });

test('이름이 가입자와 같으면 입금액만큼 자동 충전한다(요금제 신청 없이)', async () => {
  const { kv } = mkKv();
  await withL1([{ guid: 'g-do', name: '도영민' }], async (calls) => {
    const r = await notify(env(kv), SMS, 'n1'); const j = await r.json();
    assert.equal(r.status, 200); assert.equal(j.matched, true); assert.equal(j.name_match, true);
    const mint = calls.find(c => c.u.includes('/api/mint')); assert.ok(mint, '발행 호출이 있어야 한다');
    const b = JSON.parse(mint.body); assert.equal(b.guid, 'g-do'); assert.equal(Number(b.krw_amount), 1000);
  });
});

test('이름 사이 공백이 달라도(가입 "도 영민") 같은 사람으로 본다', async () => {
  const { kv } = mkKv();
  await withL1([{ guid: 'g-do', name: '도 영민' }], async (calls) => {
    const j = await (await notify(env(kv), SMS, 'n2')).json();
    assert.equal(j.matched, true); assert.equal(JSON.parse(calls.find(c => c.u.includes('/api/mint')).body).guid, 'g-do');
  });
});

test('같은 이름의 가입자가 둘이면 자동 충전하지 않고 관리자 기록을 남긴다', async () => {
  const { m, kv } = mkKv();
  await withL1([{ guid: 'g1', name: '도영민' }, { guid: 'g2', real_name: '도영민' }], async (calls) => {
    const j = await (await notify(env(kv), SMS, 'n3')).json();
    assert.notEqual(j.matched, true); assert.equal(calls.some(c => c.u.includes('/api/mint')), false);
    const ev = JSON.parse(m.get('hondi:plan_events')); assert.equal(ev[0].kind, 'charge_ambiguous'); assert.deepEqual(ev[0].guids.sort(), ['g1', 'g2']);
  });
});

test('가입자 이름과 맞는 후보가 없으면 충전하지 않는다', async () => {
  const { kv } = mkKv();
  await withL1([], async (calls) => {
    const j = await (await notify(env(kv), SMS, 'n4')).json();
    assert.notEqual(j.matched, true); assert.equal(calls.some(c => c.u.includes('/api/mint')), false);
  });
});

test('이름과 맞는 가입자가 없으면 관리자 화면에서 보이도록 사유를 기록한다', async () => {
  const { m, kv } = mkKv();
  await withL1([], async () => {
    await notify(env(kv), SMS, 'n4b');
    const ev = JSON.parse(m.get('hondi:plan_events')); assert.equal(ev[0].kind, 'charge_unmatched'); assert.equal(ev[0].reason, 'NO_ACCOUNT'); assert.deepEqual(ev[0].names, ['도영민']);
  });
});

test('플랜 요청과 금액이 10원 미만 차이면 GDC가 아니라 플랜으로 처리한다', async () => {
  const { m, kv } = mkKv(); const now = Date.now();
  m.set('hondi:plan_req:g-do', JSON.stringify({ guid: 'g-do', names: ['도영민'], display_name: '도영민', tier: 'p200', grant: 'p200', krw: 1004, expires: now + 3600e3 }));
  await withL1([{ guid: 'g-do', name: '도영민' }], async (calls) => {
    const j = await (await notify({ ...env(kv), GDC_FREE_TEST: '1' }, SMS, 'n5')).json();
    assert.equal(j.plan, true); assert.equal(calls.some(c => c.u.includes('/api/mint')), false, '플랜 입금은 GDC로 충전하지 않는다');
  });
});

test('전화번호 뒤 8자리 숫자만으로는 더 이상 가입자를 찾지 않는다', async () => {
  const { kv } = mkKv();
  await withL1([{ guid: 'g-x', name: '김철수', e164: '+821012345678' }], async (calls) => {
    const j = await (await notify(env(kv), '[입금] 5,000원 12345678', 'n6')).json();
    assert.notEqual(j.matched, true); assert.equal(calls.some(c => c.u.includes('/api/mint')), false);
  });
});
