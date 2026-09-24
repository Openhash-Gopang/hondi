import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyFreshPhoneToken, verifyPhoneAndStepUp, canonPhone } from '../../src/worker/phone-token.js';

const SECRET = 'test-secret', TTL = 30 * 24 * 3600 * 1000, GUID = '2001:db8::7', NOW = 1_800_000_000_000;
const enc = new TextEncoder();
async function hex(secret, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
// handlePhoneOtpVerify 와 같은 방식으로 토큰을 만든다: 발급 시각 = exp - TTL
async function token({ e164 = '+8201096627170', guid = GUID, issuedAgoMs = 60_000, secret = SECRET, bound = true } = {}) {
  const exp = NOW - issuedAgoMs + TTL;
  const payload = bound ? `${e164}:${guid}:${exp}` : `${e164}:${exp}`;
  return payload + '.' + await hex(secret, payload);
}
const base = { secret: SECRET, guid: GUID, accountPhone: '01096627170', ttlMs: TTL, now: NOW };

test('방금(1분 전) 문자 인증한 토큰 + 계정 전화번호 일치 → 통과', async () => {
  assert.deepEqual(await verifyFreshPhoneToken({ ...base, token: await token() }), { ok: true });
});
test('계정 전화번호 표기가 010-9662-7170 처럼 달라도 숫자만 비교해 통과', async () => {
  assert.ok((await verifyFreshPhoneToken({ ...base, accountPhone: '010-9662-7170', token: await token() })).ok);
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
  const r = await verifyFreshPhoneToken({ ...base, token: await token({ guid: '2001:db8::99' }) });
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
test('토큰 전화번호가 계정 전화번호와 다르면 거절(남의 번호로 인증한 토큰)', async () => {
  const r = await verifyFreshPhoneToken({ ...base, accountPhone: '01011112222', token: await token() });
  assert.equal(r.code, 'PHONE_MISMATCH');
  // 계정에 전화번호가 아예 없으면 "다르다"가 아니라 "찾지 못했다"고 정확히 알린다
  assert.equal((await verifyFreshPhoneToken({ ...base, accountPhone: '', token: await token() })).code, 'ACCOUNT_PHONE_MISSING');
});
test('형식 오류·빈 토큰·비밀값 없음', async () => {
  for (const t of ['', 'abc', 'a:b.c', undefined, null]) assert.equal((await verifyFreshPhoneToken({ ...base, token: t })).ok, false);
  assert.equal((await verifyFreshPhoneToken({ ...base, secret: '', token: await token() })).code, 'SECRET_NOT_SET');
});

// ── 지문(WebAuthn) 계정: SMS + step-up ──
const suArgs = (over = {}) => ({ secret: SECRET, guid: GUID, ttlMs: TTL, now: NOW, ...over });
test('지문 등록이 없는 계정은 SMS 토큰만으로 통과(step-up 검증기를 부르지 않음)', async () => {
  let called = false;
  const r = await verifyPhoneAndStepUp(suArgs({ token: await token(), profile: { phone: '01096627170', extra: {} }, verifyStepUp: async () => { called = true; return { ok: true }; } }));
  assert.ok(r.ok); assert.equal(called, false);
});
test('지문 계정: step-up 토큰 없거나 검증 실패 → 403 BIOMETRIC_REQUIRED', async () => {
  const profile = { phone: '01096627170', extra: { webauthn_credentials: [{ credentialId: 'abc' }] } };
  const r = await verifyPhoneAndStepUp(suArgs({ token: await token(), profile, stepUpToken: undefined, verifyStepUp: async () => ({ ok: false, reason: 'MISSING_TOKEN' }) }));
  assert.equal(r.status, 403); assert.equal(r.code, 'BIOMETRIC_REQUIRED'); assert.match(r.message, /MISSING_TOKEN/);
});
test('지문 계정: step-up 통과 시 등록 허용, 검증기는 (토큰, guid, "phone-reclaim:<e164>")를 받는다', async () => {
  const profile = { phone: '01096627170', extra: { webauthn_credentials: [{ credentialId: 'abc' }] } }; let seen;
  const r = await verifyPhoneAndStepUp(suArgs({ token: await token(), profile, stepUpToken: 'su-1', verifyStepUp: async (t, g, tx) => { seen = [t, g, tx]; return { ok: true }; } }));
  assert.ok(r.ok); assert.deepEqual(seen, ['su-1', GUID, 'phone-reclaim:+8201096627170']);
});
test('SMS 토큰이 이미 부적합하면 step-up 검사 전에 그 오류를 돌려준다', async () => {
  const r = await verifyPhoneAndStepUp(suArgs({ token: await token({ issuedAgoMs: 20 * 60_000 }), freshMs: 10 * 60_000, profile: { phone: '01096627170', extra: { webauthn_credentials: [{}] } }, verifyStepUp: async () => ({ ok: true }) }));
  assert.equal(r.code, 'PHONE_TOKEN_STALE');
});

// ── 회귀: "문자 인증한 본인 번호가 계정 번호와 다르다"는 오거절 (표기 차이 + 계정의 e164 칸) ──
test('canonPhone: 혼디의 실제 저장형(+82 뒤 0 유지)과 통상 E.164·국내형·대시형이 모두 같은 값', () => {
  for (const x of ['+8201096627170', '+821096627170', '01096627170', '010-9662-7170', '8201096627170', ' +82 010 9662 7170 '])
    assert.equal(canonPhone(x), '8201096627170', x);
  assert.equal(canonPhone(''), ''); assert.equal(canonPhone(null), '');
});
test('계정 e164가 +8201096627170(실제 저장형)이고 토큰도 같은 형이면 통과 — 이번에 오거절되던 경우', async () => {
  assert.ok((await verifyFreshPhoneToken({ ...base, accountPhone: '+8201096627170', token: await token() })).ok);
});
test('계정 e164가 통상형(+821096627170)이어도 토큰(+8201096627170)과 같은 번호로 인정', async () => {
  assert.ok((await verifyFreshPhoneToken({ ...base, accountPhone: '+821096627170', token: await token() })).ok);
});
test('verifyPhoneAndStepUp은 계정의 e164 칸을 쓴다(phone 칸이 비어 있어도 통과, phone만 있으면 보조로 통과)', async () => {
  const su = async () => ({ ok: true });
  assert.ok((await verifyPhoneAndStepUp(suArgs({ token: await token(), profile: { e164: '+8201096627170', phone: '', extra: {} }, verifyStepUp: su }))).ok);
  assert.ok((await verifyPhoneAndStepUp(suArgs({ token: await token(), profile: { phone: '01096627170', extra: {} }, verifyStepUp: su }))).ok);
  assert.equal((await verifyPhoneAndStepUp(suArgs({ token: await token(), profile: { e164: '+8201011112222', extra: {} }, verifyStepUp: su }))).code, 'PHONE_MISMATCH');
  assert.equal((await verifyPhoneAndStepUp(suArgs({ token: await token(), profile: null, verifyStepUp: su }))).code, 'ACCOUNT_PHONE_MISSING');
});
