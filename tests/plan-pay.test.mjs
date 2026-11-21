import test from 'node:test';
import assert from 'node:assert/strict';
import { planPriceUsd, grantedTier, planKrw, normName, nameCandidates, matchPlanRequest, distinctKrw, makePlanRequest, judgeDeposit, nextPaidUntil, isBeta, validTier, PLAN_REQ_TTL_MS } from '../src/worker/plan-pay.js';

const BETA = Date.parse('2026-11-06T12:00:00+09:00'), AFTER = Date.parse('2027-01-02T12:00:00+09:00'), D = 86400000;

test('베타 기간에는 어느 등급이든 $20, 지정 등급은 p200 / 이후에는 정가·고른 등급', () => {
  assert.equal(isBeta(BETA), true); assert.equal(isBeta(AFTER), false);
  for (const t of ['p10', 'p100', 'p200']) { assert.equal(planPriceUsd(t, BETA), 20); assert.equal(grantedTier(t, BETA), 'p200'); }
  assert.equal(planPriceUsd('p10', AFTER), 10); assert.equal(planPriceUsd('p100', AFTER), 100); assert.equal(planPriceUsd('p200', AFTER), 200);
  assert.equal(grantedTier('p100', AFTER), 'p100');
  assert.equal(validTier('p10'), true); assert.equal(validTier('x'), false); assert.equal(validTier('toString'), false);
});
test('입금액은 환율을 곱해 원 미만 올림, 입금자명은 공백·기호를 없애 비교한다', () => {
  assert.equal(planKrw(20, 1300), 26000); assert.equal(planKrw(20, 1342.37), 26848);
  assert.equal(normName(' 홍 길동 (주) '), '홍길동주'); assert.equal(normName('Kim.Min-su'), 'kimminsu');
  assert.deepEqual(nameCandidates('홍길동', '홍 길동', '', null, '김'), ['홍길동']);   // 중복 제거, 2자 미만 제외
});
test('입금 요청 만들기·판정: 금액 차이가 10원 미만이면 통과, 만료·없음·불일치는 사유를 돌려준다', () => {
  const r = makePlanRequest({ guid: 'g1', names: ['홍길동'], tier: 'p100', krwPerUsd: 1400, now: BETA });
  assert.equal(r.krw, 28000); assert.equal(r.grant, 'p200'); assert.deepEqual(r.names, ['홍길동']); assert.equal(r.code, undefined, '전화번호 매칭키는 쓰지 않는다'); assert.equal(r.expires, BETA + PLAN_REQ_TTL_MS);
  assert.deepEqual(judgeDeposit(r, 28000, BETA + 1000), { ok: true, reason: 'OK' });
  assert.equal(judgeDeposit(r, 27999, BETA + 1000).ok, true, '1원 차이는 무시');
  assert.equal(judgeDeposit(r, 28009, BETA + 1000).ok, true); assert.equal(judgeDeposit(r, 27991, BETA + 1000).ok, true, '9원 차이까지 통과');
  assert.equal(judgeDeposit(r, 27990, BETA + 1000).reason, 'PLAN_AMOUNT_MISMATCH'); assert.equal(judgeDeposit(r, 28010, BETA + 1000).reason, 'PLAN_AMOUNT_MISMATCH', '10원 차이는 불일치');
  assert.equal(judgeDeposit(r, 56000, BETA + 1000).reason, 'PLAN_AMOUNT_MISMATCH');         // 초과 입금도 자동 처리하지 않는다
  assert.equal(judgeDeposit(r, 28000, BETA + PLAN_REQ_TTL_MS + 1).reason, 'PLAN_REQUEST_EXPIRED');
  assert.equal(judgeDeposit(null, 28000).reason, 'NO_PLAN_REQUEST');
  assert.equal(makePlanRequest({ guid: 'g1', names: ['홍길동'], tier: 'bad', krwPerUsd: 1400 }), null);
  assert.equal(makePlanRequest({ guid: '', names: ['홍길동'], tier: 'p10', krwPerUsd: 1400 }), null);
  assert.equal(makePlanRequest({ guid: 'g1', names: [], tier: 'p10', krwPerUsd: 1400 }), null, '이름이 없으면 요청을 만들지 않는다');
});
test('만료일: 같은 등급이 유효하면 이어 붙이고, 만료됐거나 등급이 다르면 지금부터 30일', () => {
  assert.equal(nextPaidUntil(null, 'p200', BETA), BETA + 30 * D);
  assert.equal(nextPaidUntil({ tier: 'p200', paid_until: BETA + 10 * D }, 'p200', BETA), BETA + 40 * D);
  assert.equal(nextPaidUntil({ tier: 'p200', paid_until: BETA - D }, 'p200', BETA), BETA + 30 * D);
  assert.equal(nextPaidUntil({ tier: 'p100', paid_until: BETA + 10 * D }, 'p200', BETA), BETA + 30 * D);
});

test('이름+금액 매칭: 하나일 때만 자동, 동명이인·금액 불일치·이름 없음·만료는 자동 처리하지 않는다', () => {
  const mk = (guid, name, krw = 28000, over = {}) => ({ guid, names: [normName(name)], krw, expires: BETA + 3600e3, ...over });
  const text = '[입금] 28,000원 홍 길동 잔액 1,000,000원', now = BETA;
  assert.equal(matchPlanRequest([mk('g1', '홍길동'), mk('g2', '김철수')], text, 28000, now).req.guid, 'g1');
  assert.equal(matchPlanRequest([mk('g1', '홍길동'), mk('g2', '홍길동')], text, 28000, now).status, 'ambiguous');
  assert.equal(matchPlanRequest([mk('g1', '홍길동')], text, 27000, now).status, 'mismatch');
  assert.equal(matchPlanRequest([mk('g2', '김철수')], text, 28000, now).status, 'none');
  assert.equal(matchPlanRequest([mk('g1', '홍길동', 28000, { expires: BETA - 1 })], text, 28000, now).status, 'none');
  assert.equal(matchPlanRequest([{ guid: 'old', krw: 28000, expires: BETA + 1e6 }], text, 28000, now).status, 'none', '이름이 없는 옛 요청은 건너뛴다');
  assert.equal(matchPlanRequest([mk('g1', '홍길동'), mk('g3', '홍길동', 26000)], text, 28000, now).req.guid, 'g1', '같은 이름이어도 금액이 다르면 구분된다');
});

test('동명이인 구분: 같은 이름·같은 금액 요청이 있으면 끝자리를 1~9로 바꾸고, 없으면 금액을 그대로 둔다', () => {
  const mk = (guid, name, krw, over = {}) => ({ guid, names: [normName(name)], krw, expires: BETA + 3600e3, ...over });
  const me = mk('g2', '홍길동', 28000);
  assert.equal(distinctKrw(me, [], BETA), 28000, '겹치는 요청이 없으면 그대로');
  assert.equal(distinctKrw(me, [mk('g1', '김철수', 28000)], BETA), 28000, '이름이 다르면 그대로');
  assert.equal(distinctKrw(me, [mk('g1', '홍길동', 26000)], BETA), 28000, '금액이 다르면 그대로');
  assert.equal(distinctKrw(me, [mk('g1', '홍길동', 28000, { expires: BETA - 1 })], BETA), 28000, '만료된 요청은 무시');
  assert.equal(distinctKrw(me, [me], BETA), 28000, '내 요청은 겹침으로 보지 않는다');
  for (const r of [0, 0.3, 0.99]) {
    const k = distinctKrw(me, [mk('g1', '홍길동', 28000)], BETA, () => r);
    assert.ok(k >= 28001 && k <= 28019 && k % 10 >= 1, '정가 이상, 끝자리 1~9: ' + k);
  }
  assert.equal(distinctKrw(me, [mk('g1', '홍길동', 28000)], BETA, () => 0), 28001);
  // 세 번째 사람: 이미 쓰인 금액은 피한다
  const used = [mk('g1', '홍길동', 28000), mk('g3', '홍길동', 28001)];
  for (let i = 0; i < 50; i++) { const k = distinctKrw(me, used, BETA); assert.ok(![28000, 28001].includes(k)); assert.ok(k % 10 >= 1); }
  // 올림이 필요한 금액(끝자리가 있는 환율 금액)도 정가 아래로 내려가지 않는다
  const odd = mk('g2', '홍길동', 26848);
  for (let i = 0; i < 30; i++) { const k = distinctKrw(odd, [mk('g1', '홍길동', 26848)], BETA); assert.ok(k > 26848 && k <= 26869 && k % 10 >= 1, String(k)); }
});

test('금액 허용 오차 10원 미만: 가장 가까운 요청이 하나면 적용, 같은 거리면 ambiguous, 10원 이상이면 mismatch', () => {
  const mk = (guid, krw) => ({ guid, names: [normName('홍길동')], krw, expires: BETA + 3600e3 });
  const t = '입금 홍길동', now = BETA;
  assert.equal(matchPlanRequest([mk('g1', 28000)], t, 28007, now).req.guid, 'g1');
  assert.equal(matchPlanRequest([mk('g1', 28000)], t, 28010, now).status, 'mismatch');
  assert.equal(matchPlanRequest([mk('g1', 28000)], t, 27991, now).status, 'one');
  // 끝자리로 구분한 두 요청: 입금액에 더 가까운 쪽
  const two = [mk('g1', 28000), mk('g2', 28003)];
  assert.equal(matchPlanRequest(two, t, 28003, now).req.guid, 'g2');
  assert.equal(matchPlanRequest(two, t, 28000, now).req.guid, 'g1');
  assert.equal(matchPlanRequest(two, t, 28001, now).req.guid, 'g1');
  assert.equal(matchPlanRequest(two, t, 28002, now).req.guid, 'g2');
  // 정확히 가운데(같은 거리)면 자동 처리하지 않는다
  assert.equal(matchPlanRequest([mk('g1', 28000), mk('g2', 28004)], t, 28002, now).status, 'ambiguous');
});
