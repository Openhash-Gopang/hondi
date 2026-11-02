/**
 * tests/charge-plans.test.mjs — 필드 테스트 정액 입금 → 지급 GDC 단위 시험(네트워크 없음).
 * 실행: node --test tests/charge-plans.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldTestPlanGdc, FIELD_TEST_END_MS } from '../src/worker/charge-plans.js';

const during = Date.parse('2026-11-02T12:00:00+09:00');

test('기간 안: 정확히 10,000원 → 100,000 GDC, 100,000원 → 120,000 GDC', () => {
  assert.equal(fieldTestPlanGdc(10000, during), 100000);
  assert.equal(fieldTestPlanGdc(100000, during), 120000);
  assert.equal(fieldTestPlanGdc('10000', during), 100000);
});

test('그 밖의 금액은 null(기존 구간 배율을 따른다)', () => {
  for (const k of [0, 9999, 10001, 50000, 99999, 100001, 1200000, -10000, NaN]) assert.equal(fieldTestPlanGdc(k, during), null, String(k));
});

test('기간 경계: 12월 31일 23:59:59 KST까지만 적용, 1월 1일 0시부터는 null', () => {
  assert.equal(FIELD_TEST_END_MS, Date.parse('2027-01-01T00:00:00+09:00'));
  assert.equal(fieldTestPlanGdc(10000, Date.parse('2026-12-31T23:59:59+09:00')), 100000);
  assert.equal(fieldTestPlanGdc(10000, Date.parse('2027-01-01T00:00:00+09:00')), null);
  assert.equal(fieldTestPlanGdc(100000, Date.parse('2027-03-01T00:00:00+09:00')), null);
});
