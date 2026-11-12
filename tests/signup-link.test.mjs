// PC 회원 가입(폰으로 이어 가기) 세션 로직 시험 — src/worker/signup-link.js (2026-11-12)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSignupLinkApi } from '../src/worker/signup-link.js';

function mkKv() {
  const m = new Map();
  return { m, get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); } };
}
function mk(over = {}) {
  const kv = mkKv(); let t = 1_000_000; let n = 0; const sms = [];
  const api = createSignupLinkApi({
    kv, now: () => t, uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    resolveToken: async (tok) => (tok === 'good' ? { ok: true, guid: 'g1', e164: '+821012345678' } : { ok: false }),
    findProfileByE164: async () => null,
    sendSms: async (to, text) => { sms.push({ to, text }); },
    ...over,
  });
  return { api, kv, sms, tick: (ms) => { t += ms; } };
}

test('init(qr): 세션을 만들고 정답은 후보에 섞여 있되 session 응답에는 pcMatch 가 없다', async () => {
  const { api } = mk();
  const r = await api.init({ pcMatch: '42', pcLabel: 'K-Law' }, '1.2.3.4');
  assert.equal(r.status, 200); assert.ok(r.body.approveUrl.includes('/auth/signup-approve.html?sessionId='));
  const s = await api.session(r.body.sessionId);
  assert.equal(s.body.matchChoices.length, 3); assert.ok(s.body.matchChoices.includes('42'));
  assert.equal(JSON.stringify(s.body).includes('pcMatch'), false);
  assert.equal(s.body.plan, undefined);   // 가입은 모두 무료 — 플랜 선택 없음
});

test('init: pcMatch 형식이 틀리면 400', async () => {
  const { api } = mk();
  assert.equal((await api.init({ pcMatch: '5' })).status, 400);
  assert.equal((await api.init({})).status, 400);
});

test('verify: 맞으면 verified, 세 번 틀리면 denied', async () => {
  const { api } = mk();
  const { body: { sessionId } } = await api.init({ pcMatch: '42' });
  assert.equal((await api.verify({ sessionId, picked: '11' })).body.error, 'WRONG_NUMBER');
  assert.equal((await api.verify({ sessionId, picked: '12' })).body.error, 'WRONG_NUMBER');
  assert.equal((await api.verify({ sessionId, picked: '13' })).body.error, 'DENIED');
  assert.equal((await api.verify({ sessionId, picked: '42' })).status, 409);   // 이미 거절됨
  assert.equal((await api.poll(sessionId)).body.state, 'denied');
  const { body: { sessionId: s2 } } = await api.init({ pcMatch: '42' });
  assert.equal((await api.verify({ sessionId: s2, picked: '42' })).status, 200);
  assert.equal((await api.poll(s2)).body.state, 'verified');
});

test('complete: 숫자 확인 전에는 거절, 확인 후 토큰이 맞아야 registered 가 되고 그때만 poll 이 e164 를 준다', async () => {
  const { api } = mk();
  const { body: { sessionId } } = await api.init({ pcMatch: '42' });
  assert.equal((await api.complete({ sessionId, phone_verify_token: 'good' })).body.error, 'NOT_VERIFIED');
  await api.verify({ sessionId, picked: '42' });
  assert.equal((await api.complete({ sessionId, phone_verify_token: 'bad' })).status, 401);
  assert.equal((await api.poll(sessionId)).body.e164, undefined);
  assert.equal((await api.complete({ sessionId, phone_verify_token: 'good' })).status, 200);
  const p = await api.poll(sessionId);
  assert.equal(p.body.state, 'registered'); assert.equal(p.body.e164, '+821012345678');
});

test('init(sms): 이미 가입된 번호는 409, 문자는 시간당 3회까지', async () => {
  const a = mk({ findProfileByE164: async () => ({ id: 'x' }) });
  assert.equal((await a.api.init({ pcMatch: '42', method: 'sms', e164: '+821012345678' })).body.error, 'ALREADY_REGISTERED');
  assert.equal(a.sms.length, 0);
  const b = mk();
  for (let i = 0; i < 3; i++) assert.equal((await b.api.init({ pcMatch: '42', method: 'sms', e164: '+821012345678' })).status, 200);
  assert.equal((await b.api.init({ pcMatch: '42', method: 'sms', e164: '+821012345678' })).status, 429);
  assert.equal(b.sms.length, 3); assert.ok(b.sms[0].text.includes('signup-approve.html'));
  assert.equal((await b.api.init({ pcMatch: '42', method: 'sms', e164: '+82112345678' })).body.error, 'BAD_PHONE');
});

test('complete(sms): 문자를 받은 번호와 다른 번호로 가입하면 거절', async () => {
  const { api } = mk();
  const { body: { sessionId } } = await api.init({ pcMatch: '42', method: 'sms', e164: '+821099999999' });
  await api.verify({ sessionId, picked: '42' });
  assert.equal((await api.complete({ sessionId, phone_verify_token: 'good' })).body.error, 'PHONE_MISMATCH');
});

test('세션이 없거나 형식이 틀리면 expired/404', async () => {
  const { api } = mk();
  assert.equal((await api.poll('nope')).body.state, 'expired');
  assert.equal((await api.session('nope')).status, 404);
});

test('PC 화면·폰 화면·worker 연결이 모두 있다(문자열 확인)', () => {
  const w = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  for (const a of ['init', 'session', 'verify', 'complete', 'poll']) assert.ok(w.includes(`/auth/signup-link/${a}'`), a);
  const k = fs.readFileSync(new URL('../auth/k-service-auth-client.js', import.meta.url), 'utf8');
  assert.ok(k.includes('/auth/signup-link/init') && k.includes('/auth/free-plan') && k.includes("plan: 'free'"));
  const au = fs.readFileSync(new URL('../src/gopang/core/auth.js', import.meta.url), 'utf8');
  assert.ok(au.includes('/auth/signup-link/complete'));
});
