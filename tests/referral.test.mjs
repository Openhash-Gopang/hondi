/** tests/referral.test.mjs — 친구 초대(추천인) 순수 계산. 네트워크 없음. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { referralCode, isReferralCode, inviteLink, inviteText, withinClaimWindow, REFERRAL_REWARD_KRW } from '../src/worker/referral.js';

test('보상은 1,000원(=1,000 GDC)', () => { assert.equal(REFERRAL_REWARD_KRW, 1000); });
test('추천 코드: 같은 guid 는 같은 코드, 다른 guid·다른 비밀값은 다른 코드, 10자리 16진', async () => {
  const a = await referralCode('s', 'g1'), b = await referralCode('s', 'g1'), c = await referralCode('s', 'g2'), d = await referralCode('t', 'g1');
  assert.equal(a, b); assert.notEqual(a, c); assert.notEqual(a, d);
  assert.ok(isReferralCode(a)); assert.ok(!a.includes('g1'));
});
test('코드 형식 검사', () => {
  for (const x of ['', 'abc', 'ZZZZZZZZZZ', '0123456789a', "0123456789'"]) assert.equal(isReferralCode(x), false, x);
  assert.equal(isReferralCode('0123456789'), true);
});
test('초대 문구: 가입 주소·보상 안내 포함, 이름은 있을 때만', () => {
  const t = inviteText('0123456789', '김동');
  assert.match(t, /^김동입니다\. /); assert.match(t, /1,000 GDC/); assert.ok(t.includes(inviteLink('0123456789')));
  assert.ok(!/입니다\. /.test(inviteText('0123456789', '')));
  assert.equal(inviteLink('abc'), 'https://naviweb.kr/webapp.html?ref=abc');
});
test('청구 기간: 가입 72시간 안만', () => {
  const now = Date.parse('2026-11-15T12:00:00Z');
  assert.equal(withinClaimWindow('2026-11-15 11:00:00.000Z', now), true);
  assert.equal(withinClaimWindow('2026-11-12 11:59:00.000Z', now), false);
  assert.equal(withinClaimWindow('', now), false);
  assert.equal(withinClaimWindow('2026-11-16 00:00:00Z', now), false);
});
