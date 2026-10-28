/** tests/signal-auth.test.mjs — 대화 신호 검증(서버 순수 함수)과 단말의 증명 붙이기. 네트워크 없음. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSignalInput, canDeleteSignal, sendRateOk, isGuidLike, SIGNAL_PAYLOAD_MAX } from '../src/worker/signal-auth.js';

test('보내기 검증: 정상·필드 누락·type·guid·크기', () => {
  const ok = validateSignalInput({ from_guid: 'fd00::1', to_guid: 'fd00::2', type: 'offer', payload: { sdp: 'x' } });
  assert.equal(ok.ok, true); assert.equal(ok.from, 'fd00::1');
  assert.equal(validateSignalInput(null).code, 'INVALID_JSON');
  assert.equal(validateSignalInput({ from_guid: 'a1b', type: 'offer', payload: 1 }).code, 'MISSING_FIELDS');
  assert.equal(validateSignalInput({ from_guid: 'a1b', to_guid: 'c2d', type: 'bye', payload: 1 }).code, 'INVALID_TYPE');
  assert.equal(validateSignalInput({ from_guid: "a'b", to_guid: 'c2d', type: 'ice', payload: 1 }).code, 'INVALID_GUID');
  assert.equal(validateSignalInput({ from_guid: 'a1b', to_guid: 'c2d', type: 'ice', payload: 'x'.repeat(SIGNAL_PAYLOAD_MAX + 1) }).status, 413);
  assert.equal(isGuidLike('x'.repeat(101)), false);
});
test('삭제 권한: 받는 사람·보낸 사람만', () => {
  const r = { from_guid: 'a', to_guid: 'b' };
  assert.equal(canDeleteSignal(r, 'a'), true); assert.equal(canDeleteSignal(r, 'b'), true);
  assert.equal(canDeleteSignal(r, 'c'), false); assert.equal(canDeleteSignal(null, 'a'), false); assert.equal(canDeleteSignal(r, ''), false);
});
test('분당 한도', () => { assert.equal(sendRateOk(119), true); assert.equal(sendRateOk(120), false); });

test('단말: 쿠키 증명 → 거부되면 지갑 증명으로 한 번 더', async () => {
  const calls = [];
  globalThis.document = { cookie: 'hondi_pvt=' + encodeURIComponent('+821000000000:1.sig') + '; hondi_pvt_exp=' + (Date.now() + 3600000) };
  globalThis.window = { gopangWallet: { publicKeyB64u: 'PUB', signPayload: async () => 'SIG' } };
  globalThis.fetch = async (url, o) => {
    const b = JSON.parse(o.body); calls.push({ url: String(url), b });
    const J = (x, s = 200) => new Response(JSON.stringify(x), { status: s });
    if (String(url).endsWith('/auth/issue')) return J({ ok: true, token: 'GT' });
    if (b.phone_verify_token) return J({ error: 'FROM_MISMATCH' }, 403);
    return b.gopang_token === 'GT' ? J({ ok: true }) : J({ error: 'AUTH_REQUIRED' }, 401);
  };
  const { signalPost } = await import('../src/gopang/p2p/signal-auth.js');
  const r = await signalPost('/signal/send', 'g1', { from_guid: 'g1', to_guid: 'g2', type: 'offer', payload: {} });
  assert.equal(r.ok, true);
  assert.ok(calls[0].b.phone_verify_token, '처음엔 쿠키 증명');
  assert.ok(calls.some(c => c.url.endsWith('/auth/issue') && c.b.svc === 'p2p-signal'), '지갑 서명으로 토큰 발급');
  assert.ok(calls.at(-1).b.gopang_token === 'GT', '다시 지갑 토큰으로 보냄');
  const n = calls.length;
  await signalPost('/signal/send', 'g1', { from_guid: 'g1', to_guid: 'g2', type: 'ice', payload: {} });
  assert.equal(calls.slice(n).filter(c => c.url.endsWith('/auth/issue')).length, 0, '발급한 토큰은 재사용');
});
