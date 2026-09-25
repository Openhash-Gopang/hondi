import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyFreshPhoneToken, verifyPhoneAndStepUp } from '../../src/worker/phone-token.js';

const SECRET = 'test-secret', TTL = 30 * 24 * 3600 * 1000, GUID = '2601:db80:c342:fd1b:bc4a:2dce:9ed8:04b6', NOW = 1_800_000_000_000;
const enc = new TextEncoder();
async function hex(secret, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
// worker.js의 handlePhoneOtpVerify와 정확히 같은 방식으로 토큰을 만든다: payload = e164:guid:exp, 발급 시각 = exp - TTL
async function token({ e164 = '+8201096627170', guid = GUID, issuedAgoMs = 60_000, secret = SECRET, bound = true } = {}) {
  const exp = NOW - issuedAgoMs + TTL;
  const payload = bound ? `${e164}:${guid}:${exp}` : `${e164}:${exp}`;
  return payload + '.' + await hex(secret, payload);
}
const base = { secret: SECRET, guid: GUID, ttlMs: TTL, now: NOW };
const suArgs = (over = {}) => ({ secret: SECRET, guid: GUID, ttlMs: TTL, now: NOW, ...over });

test('방금(1분 전) 문자 인증한 토큰 → 통과, 토큰의 e164도 함께 돌려준다', async () => {
  const r = await verifyFreshPhoneToken({ ...base, token: await token() });
  assert.deepEqual(r, { ok: true, e164: '+8201096627170' });
});
test('한 달 전 인증한 토큰(아직 30일 유효)은 신선도 때문에 거절', async () => {
  const r = await verifyFreshPhoneToken({ ...base, token: await token({ issuedAgoMs: 29 * 24 * 3600 * 1000 }) });
  assert.equal(r.ok, false); assert.equal(r.code, 'PHONE_TOKEN_STALE'); assert.equal(r.status, 401);
});
test('11분 전 토큰은 거절, 9분 전 토큰은 통과(기본 10분)', async () => {
  assert.equal((await verifyFreshPhoneToken({ ...base, token: await token({ issuedAgoMs: 11 * 60_000 }) })).code, 'PHONE_TOKEN_STALE');
  assert.ok((await verifyFreshPhoneToken({ ...base, token: await token({ issuedAgoMs: 9 * 60_000 }) })).ok);
});
test('다른 계정(guid)용 토큰 거절', async () => {
  const r = await verifyFreshPhoneToken({ ...base, token: await token({ guid: '2601:db80:c342:fd1b:bc4a:2dce:9ed8:9999' }) });
  assert.equal(r.code, 'PHONE_TOKEN_GUID_MISMATCH'); assert.equal(r.status, 403);
});
test('guid가 묶이지 않은 2필드 토큰 거절', async () => {
  assert.equal((await verifyFreshPhoneToken({ ...base, token: await token({ bound: false }) })).code, 'PHONE_TOKEN_NOT_BOUND');
});
test('서명 위조·비밀값 불일치 거절', async () => {
  assert.equal((await verifyFreshPhoneToken({ ...base, token: await token({ secret: 'other' }) })).code, 'PHONE_TOKEN_INVALID');
  const t = await token(); const forged = t.replace('+8201096627170', '+8201000000000');
  assert.equal((await verifyFreshPhoneToken({ ...base, token: forged })).code, 'PHONE_TOKEN_INVALID');
});
test('만료된 토큰 거절', async () => {
  const exp = NOW - 1000, payload = `+8201096627170:${GUID}:${exp}`;
  assert.equal((await verifyFreshPhoneToken({ ...base, token: payload + '.' + await hex(SECRET, payload) })).code, 'PHONE_TOKEN_EXPIRED');
});
test('형식 오류·빈 토큰·비밀값 없음', async () => {
  for (const t of ['', 'abc', 'a:b.c', undefined, null]) assert.equal((await verifyFreshPhoneToken({ ...base, token: t })).ok, false);
  assert.equal((await verifyFreshPhoneToken({ ...base, secret: '', token: await token() })).code, 'SECRET_NOT_SET');
});
test('guid는 IPv6(콜론 다수)라도 정확히 추출된다 — payload의 마지막 콜론이 guid/exp 경계', async () => {
  const r = await verifyFreshPhoneToken({ ...base, token: await token({ guid: GUID }) });
  assert.ok(r.ok);
});

// ── verifyPhoneAndStepUp: 저장된 e164_hash/e164와 무관하게(계정에 그런 값이 없어도) 문자 인증만으로 통과 ──
test('지문 등록이 없는 계정은 SMS 토큰만으로 통과(step-up 검증기를 부르지 않음), profile이 없거나 비어 있어도 통과', async () => {
  let called = false;
  for (const profile of [undefined, null, {}, { e164: '', extra: {} }]) {
    const r = await verifyPhoneAndStepUp(suArgs({ token: await token(), profile, verifyStepUp: async () => { called = true; return { ok: true }; } }));
    assert.ok(r.ok, JSON.stringify(r));
  }
  assert.equal(called, false);
});
test('지문 계정: step-up 토큰 없거나 검증 실패 → 403 BIOMETRIC_REQUIRED', async () => {
  const profile = { extra: { webauthn_credentials: [{ credentialId: 'abc' }] } };
  const r = await verifyPhoneAndStepUp(suArgs({ token: await token(), profile, stepUpToken: undefined, verifyStepUp: async () => ({ ok: false, reason: 'MISSING_TOKEN' }) }));
  assert.equal(r.status, 403); assert.equal(r.code, 'BIOMETRIC_REQUIRED'); assert.match(r.message, /MISSING_TOKEN/);
});
test('지문 계정: step-up 통과 시 등록 허용, 검증기는 (토큰, guid, "phone-reclaim:<토큰의 e164>")를 받는다', async () => {
  const profile = { extra: { webauthn_credentials: [{ credentialId: 'abc' }] } }; let seen;
  const r = await verifyPhoneAndStepUp(suArgs({ token: await token(), profile, stepUpToken: 'su-1', verifyStepUp: async (t, g, tx) => { seen = [t, g, tx]; return { ok: true }; } }));
  assert.ok(r.ok); assert.deepEqual(seen, ['su-1', GUID, 'phone-reclaim:+8201096627170']);
});
test('SMS 토큰이 이미 부적합하면 step-up 검사 전에 그 오류를 돌려준다', async () => {
  const r = await verifyPhoneAndStepUp(suArgs({ token: await token({ issuedAgoMs: 20 * 60_000 }), freshMs: 10 * 60_000, profile: { extra: { webauthn_credentials: [{}] } }, verifyStepUp: async () => ({ ok: true }) }));
  assert.equal(r.code, 'PHONE_TOKEN_STALE');
});
