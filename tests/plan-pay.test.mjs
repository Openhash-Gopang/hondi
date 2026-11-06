import test from 'node:test';
import assert from 'node:assert/strict';
import { planPriceUsd, grantedTier, planKrw, matchKeyOf, makePlanRequest, judgeDeposit, nextPaidUntil, isBeta, validTier, PLAN_REQ_TTL_MS } from '../src/worker/plan-pay.js';

const BETA = Date.parse('2026-11-06T12:00:00+09:00'), AFTER = Date.parse('2027-01-02T12:00:00+09:00'), D = 86400000;

test('베타 기간에는 어느 등급이든 $20, 지정 등급은 p200 / 이후에는 정가·고른 등급', () => {
  assert.equal(isBeta(BETA), true); assert.equal(isBeta(AFTER), false);
  for (const t of ['p10', 'p100', 'p200']) { assert.equal(planPriceUsd(t, BETA), 20); assert.equal(grantedTier(t, BETA), 'p200'); }
  assert.equal(planPriceUsd('p10', AFTER), 10); assert.equal(planPriceUsd('p100', AFTER), 100); assert.equal(planPriceUsd('p200', AFTER), 200);
  assert.equal(grantedTier('p100', AFTER), 'p100');
  assert.equal(validTier('p10'), true); assert.equal(validTier('x'), false); assert.equal(validTier('toString'), false);
});
test('입금액은 환율을 곱해 원 미만 올림, 매칭키는 전화번호 뒤 8자리', () => {
  assert.equal(planKrw(20, 1300), 26000); assert.equal(planKrw(20, 1342.37), 26848);
  assert.equal(matchKeyOf('+821012345678'), '12345678'); assert.equal(matchKeyOf('123'), null); assert.equal(matchKeyOf(''), null);
});
test('입금 요청 만들기·판정: 금액이 정확히 같을 때만 통과, 만료·없음·불일치는 사유를 돌려준다', () => {
  const r = makePlanRequest({ guid: 'g1', e164: '+821012345678', tier: 'p100', krwPerUsd: 1400, now: BETA });
  assert.equal(r.krw, 28000); assert.equal(r.grant, 'p200'); assert.equal(r.code, '12345678'); assert.equal(r.expires, BETA + PLAN_REQ_TTL_MS);
  assert.deepEqual(judgeDeposit(r, 28000, BETA + 1000), { ok: true, reason: 'OK' });
  assert.equal(judgeDeposit(r, 27999, BETA + 1000).reason, 'PLAN_AMOUNT_MISMATCH');
  assert.equal(judgeDeposit(r, 56000, BETA + 1000).reason, 'PLAN_AMOUNT_MISMATCH');         // 초과 입금도 자동 처리하지 않는다
  assert.equal(judgeDeposit(r, 28000, BETA + PLAN_REQ_TTL_MS + 1).reason, 'PLAN_REQUEST_EXPIRED');
  assert.equal(judgeDeposit(null, 28000).reason, 'NO_PLAN_REQUEST');
  assert.equal(makePlanRequest({ guid: 'g1', e164: '+821012345678', tier: 'bad', krwPerUsd: 1400 }), null);
  assert.equal(makePlanRequest({ guid: '', e164: '+821012345678', tier: 'p10', krwPerUsd: 1400 }), null);
});
test('만료일: 같은 등급이 유효하면 이어 붙이고, 만료됐거나 등급이 다르면 지금부터 30일', () => {
  assert.equal(nextPaidUntil(null, 'p200', BETA), BETA + 30 * D);
  assert.equal(nextPaidUntil({ tier: 'p200', paid_until: BETA + 10 * D }, 'p200', BETA), BETA + 40 * D);
  assert.equal(nextPaidUntil({ tier: 'p200', paid_until: BETA - D }, 'p200', BETA), BETA + 30 * D);
  assert.equal(nextPaidUntil({ tier: 'p100', paid_until: BETA + 10 * D }, 'p200', BETA), BETA + 30 * D);
});
