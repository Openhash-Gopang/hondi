import test from 'node:test';
import assert from 'node:assert/strict';
import { minPriceAtRound, buildLadder, roundsAtOrAbove, requiredDeposit, resolveRound, ladderAdvanceCapBps, PRESETS, roundAt, minPriceAtElapsed } from '../../src/gopang/ai/hondi-sale-ladder.js';
import { computeAdvance } from '../../src/gopang/ai/hondi-advance-rate.js';
import { settleAdvance } from '../../src/gopang/ai/hondi-settlement.js';

test('유찰마다 20% 저감 — 6천만 원 시작가의 회차별 최저가(1,000원 절사)', () => {
  const p = r => minPriceAtRound(60_000_000, r);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(p), [60_000_000, 48_000_000, 38_400_000, 30_720_000, 24_576_000, 19_660_000]);
  assert.equal(minPriceAtRound(60_000_000, 6, { round_unit: 1 }), 19_660_800);     // 절사 전 정확값 0.8^5 × 6천만
  assert.equal(minPriceAtRound(100, 3, { round_unit: 1, reduction_bps: 3000 }), 49); // 다른 저감률(30%)도 지원: 100×0.49
});

test('minPriceAtRound — 정수 정밀도(BigInt): 큰 금액·깊은 회차에서도 단조 감소, 잘못된 입력은 RangeError', () => {
  let prev = Infinity;
  for (let r = 1; r <= 40; r++) { const v = minPriceAtRound(9_000_000_000_000, r, { round_unit: 1 }); assert.ok(v < prev || v === prev); prev = v; }
  assert.throws(() => minPriceAtRound(0, 1), RangeError);
  assert.throws(() => minPriceAtRound(100, 0), RangeError);
  assert.throws(() => minPriceAtRound(100.5, 1), RangeError);
  assert.throws(() => minPriceAtRound(100, 1, { reduction_bps: 9500 }), RangeError);
});

test('buildLadder / roundsAtOrAbove — 바닥가 아래로는 회차를 만들지 않는다', () => {
  const l = buildLadder({ start_price: 60_000_000, max_round: 10, floor_price: 25_000_000 });
  assert.deepEqual(l.map(x => x.round), [1, 2, 3, 4]);                    // 5회차 24,576,000 < 25,000,000
  assert.ok(Math.abs(l[1].ratio - 0.8) < 1e-12);
  assert.equal(roundsAtOrAbove(60_000_000, 30_000_000), 4);               // 4회차 30.72M ≥ 30M, 5회차 24.576M < 30M
  assert.equal(roundsAtOrAbove(60_000_000, 61_000_000), 0);               // 1회차부터 미달이면 0
});

test('requiredDeposit — 최저가의 10%(올림)', () => {
  assert.equal(requiredDeposit(48_000_000), 4_800_000);
  assert.equal(requiredDeposit(19_660_000), 1_966_000);
  assert.equal(requiredDeposit(1_005), 101);                              // 100.5 → 올림
});

test('resolveRound — 최저가 이상 최고가가 그 가격으로 낙찰', async () => {
  const r = await resolveRound({ case_id: 'C1', round: 2, min_price: 48_000_000, bids: [
    { bidder: 'a', amount: 50_000_000, deposit: 4_800_000 }, { bidder: 'b', amount: 52_500_000, deposit: 5_000_000 }, { bidder: 'c', amount: 47_000_000, deposit: 9_000_000 },
  ] });
  assert.equal(r.outcome, 'sold'); assert.equal(r.winner, 'b'); assert.equal(r.price, 52_500_000);
  assert.deepEqual(r.invalid, [{ bidder: 'c', reason: 'below_minimum' }]);
});

test('resolveRound — 유효 입찰이 없으면 유찰(다음 회차 예고), 보증금 부족·형식 오류는 무효', async () => {
  const r = await resolveRound({ case_id: 'C1', round: 3, min_price: 38_400_000, bids: [
    { bidder: 'a', amount: 40_000_000, deposit: 3_000_000 },                // 보증금 부족(필요 3,840,000)
    { bidder: 'b', amount: 1.5, deposit: 9_000_000 },
  ] });
  assert.equal(r.outcome, 'failed'); assert.equal(r.next_round, 4); assert.equal(r.required_deposit, 3_840_000);
  assert.deepEqual(r.invalid.map(x => x.reason).sort(), ['insufficient_deposit', 'malformed']);
  assert.equal((await resolveRound({ case_id: 'C1', round: 1, min_price: 100, bids: [] })).outcome, 'failed');
});

test('resolveRound — 동점은 입력 순서와 무관하게 같은 승자(공개 재계산 가능한 해시 규칙)', async () => {
  const mk = order => order.map(n => ({ bidder: n, amount: 60_000_000, deposit: 6_000_000 }));
  const a = await resolveRound({ case_id: 'C9', round: 1, min_price: 60_000_000, bids: mk(['x', 'y', 'z']) });
  const b = await resolveRound({ case_id: 'C9', round: 1, min_price: 60_000_000, bids: mk(['z', 'y', 'x']) });
  assert.equal(a.tie_broken, true); assert.equal(a.winner, b.winner);
  const c = await resolveRound({ case_id: 'C10', round: 1, min_price: 60_000_000, bids: mk(['x', 'y', 'z']) });
  assert.ok(['x', 'y', 'z'].includes(c.winner));                          // 사건이 다르면 다른 승자일 수 있다
});

test('resolveRound — 한 입찰자의 중복 입찰·잘못된 입력은 거부', async () => {
  await assert.rejects(() => resolveRound({ case_id: 'C', round: 1, min_price: 100, bids: [{ bidder: 'a', amount: 100, deposit: 10 }, { bidder: 'a', amount: 200, deposit: 10 }] }), RangeError);
  await assert.rejects(() => resolveRound({ case_id: '', round: 1, min_price: 100, bids: [] }), RangeError);
  await assert.rejects(() => resolveRound({ case_id: 'C', round: 1, min_price: 100, bids: 'x' }), RangeError);
});

test('ladderAdvanceCapBps — 손계산 일치 및 단조성', () => {
  // 2회차(80%), 판매비용 3%, 연 8%, 60일: 0.8 × 0.97 / (1 + 0.08×60/365) = 0.7659…
  assert.equal(ladderAdvanceCapBps({ max_round: 2, selling_cost_bps: 300, annual_rate_bps: 800, days: 60 }), 7659);
  assert.equal(ladderAdvanceCapBps({ max_round: 1, selling_cost_bps: 0, annual_rate_bps: 0, days: 0 }), 10000);
  const cap = m => ladderAdvanceCapBps({ max_round: m, selling_cost_bps: 300, annual_rate_bps: 800, days: 60 });
  assert.ok(cap(1) > cap(2) && cap(2) > cap(3) && cap(3) > cap(6));                     // 깊은 회차 허용 → 상한 하락
  assert.ok(ladderAdvanceCapBps({ max_round: 3, annual_rate_bps: 1200, days: 60 }) < ladderAdvanceCapBps({ max_round: 3, annual_rate_bps: 400, days: 60 }));
});

test('결정적 회수 보장(속성, 무작위 3000건) — start_price를 주면 허용 최심 회차 최저가에 팔아도 손실이 원 단위로 0', () => {
  let s = 4242; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < 3000; i++) {
    const E = 1_000_000 + Math.floor(rnd() * 499_000_000), max_round = 1 + Math.floor(rnd() * 6);
    const cost = Math.floor(rnd() * 800), fee = Math.floor(rnd() * 200), rate = Math.floor(rnd() * 1500), days = 1 + Math.floor(rnd() * 900);
    const cap = ladderAdvanceCapBps({ max_round, selling_cost_bps: cost, fee_bps: fee, annual_rate_bps: rate, days, start_price: E });
    const sale = minPriceAtRound(E, max_round);
    const r = settleAdvance({ estimated_price: E, advance_bps: cap, creditor_claim: Math.floor(E * 0.8), sale_price: sale,
      selling_costs: Math.ceil(sale * cost / 10000), fee_bps: fee, annual_rate_bps: rate, days });
    assert.equal(r.system_shortfall, 0, `E=${E} round=${max_round} cap=${cap} shortfall=${r.system_shortfall}`);
    assert.ok(r.balanced);
  }
});

test('비율만으로 계산한 상한은 근사 — 절사 단위 안팎의 오차를 문서화(정확한 보장은 start_price 모드)', () => {
  // 보고된 반례: E=84,896,123, 4회차 → 비율 모드는 461원 부족, start_price 모드는 0원
  const E = 84_896_123, base = { max_round: 4, selling_cost_bps: 300, annual_rate_bps: 800, days: 60 };
  const run = cap => { const sale = minPriceAtRound(E, 4); return settleAdvance({ estimated_price: E, advance_bps: cap, creditor_claim: Math.floor(E * 0.8),
    sale_price: sale, selling_costs: Math.ceil(sale * 300 / 10000), annual_rate_bps: 800, days: 60 }); };
  assert.ok(run(ladderAdvanceCapBps(base)).system_shortfall <= 2000);                    // 근사: 절사 단위(1,000원)의 수 배 이내
  assert.equal(run(ladderAdvanceCapBps({ ...base, start_price: E })).system_shortfall, 0); // 정확
  assert.ok(ladderAdvanceCapBps({ ...base, start_price: E }) <= ladderAdvanceCapBps(base));  // 정확 모드는 결코 더 후하지 않다
});

test('computeAdvance 통합 — 사다리를 주면 상한이 추가되고, 안 주면 기존 동작과 완전히 같다', () => {
  const apt = { txn_12m: 40, comps_count: 25, comps_cv: 0.04, months_stale: 1, annual_rate_bps: 800 };
  const plain = computeAdvance(apt);
  assert.equal(plain.ladder_cap_bps, null);
  assert.equal(computeAdvance({ ...apt, ladder: null }).advance_bps, plain.advance_bps);            // 회귀: 인자 없음 = 이전 결과
  const two = computeAdvance({ ...apt, ladder: { max_round: 2 } });
  assert.equal(two.binding, 'ladder_cap'); assert.ok(two.advance_bps < plain.advance_bps);
  assert.ok(two.advance_bps <= two.ladder_cap_bps);
  assert.ok(two.reasons.some(x => x.includes('사다리 상한')));
  const one = computeAdvance({ ...apt, ladder: { max_round: 1 } });                                  // 1회차만 허용하면 사다리는 제약이 아님
  assert.equal(one.advance_bps, plain.advance_bps); assert.notEqual(one.binding, 'ladder_cap');
  const deep = computeAdvance({ ...apt, ladder: { max_round: 5 } });
  assert.ok(deep.advance_bps < two.advance_bps);
  // 추정가를 알면 원 단위 정확 모드: 계산된 선지급률로 2회차 최저가에 팔아도 손실이 없다
  const E = 100_000_000, exact = computeAdvance({ ...apt, ladder: { max_round: 2, start_price: E } });
  const sale = minPriceAtRound(E, 2), costBps = 300;
  const sim = settleAdvance({ estimated_price: E, advance_bps: exact.advance_bps, creditor_claim: 80_000_000, sale_price: sale,
    selling_costs: Math.ceil(sale * costBps / 10000), annual_rate_bps: 800, days: 60 });
  assert.equal(sim.system_shortfall, 0);
  const thin = computeAdvance({ txn_12m: 1, comps_count: 1, comps_cv: 0.45, months_stale: 6, annual_rate_bps: 800, ladder: { max_round: 3 } });
  assert.ok(thin.advance_bps <= 1000);                                                               // 거래 적은 물건은 정책 상한 10%가 이미 더 낮다
});

// ───────── 시간 기반 하락(24시간 0.557% / 시간당 0.0232%) — 2026-09-28 주피터님 결정 ─────────
const E100 = 100_000_000;
const within = (v, lo, hi) => assert.ok(v >= lo && v <= hi, `${v} not in [${lo}, ${hi}]`);

test('하락 속도가 법원과 같다 — 일 단위 5,570ppm·시간 단위 232ppm 모두 40일 후 약 80%', () => {
  const daily = minPriceAtRound(E100, 41, { reduction_ppm: PRESETS.hondi_daily.reduction_ppm, round_unit: 1 });   // 40일 = 40단계 후 = 41회차
  const hourly = minPriceAtRound(E100, 961, { reduction_ppm: PRESETS.hondi_hourly.reduction_ppm, round_unit: 1 }); // 960시간 = 960단계 후
  within(daily, 79_900_000, 80_100_000); within(hourly, 79_900_000, 80_200_000);
  // 하루(24 시간 단계) ≈ 일 단위 1단계
  const oneDayHourly = minPriceAtRound(E100, 25, { reduction_ppm: 232, round_unit: 1 });
  const oneDayDaily = minPriceAtRound(E100, 2, { reduction_ppm: 5_570, round_unit: 1 });
  assert.ok(Math.abs(oneDayHourly - oneDayDaily) < E100 * 1e-4);
});

test('주피터님이 말한 값을 문자 그대로 쓰면: 하루 0.56%는 법원과 같고, 시간당 0.02%는 더 느리다(40일 후 약 82.5%)', () => {
  const literalDaily = minPriceAtRound(E100, 41, { reduction_ppm: 5_600, round_unit: 1 });
  const literalHourly = minPriceAtRound(E100, 961, { reduction_ppm: 200, round_unit: 1 });
  within(literalDaily, 79_800_000, 80_000_000);
  within(literalHourly, 82_400_000, 82_700_000);
  assert.ok(literalHourly > literalDaily);                                   // 두 표기는 같은 속도가 아니다
});

test('reduction_bps(구 방식)와 reduction_ppm은 같은 결과 — 호환성', () => {
  for (const r of [1, 2, 5, 9]) assert.equal(minPriceAtRound(60_000_000, r, { reduction_bps: 2000 }), minPriceAtRound(60_000_000, r, { reduction_ppm: 200_000 }));
});

test('ppm 정밀도 — BigInt 정확 재계산과 일치, 항상 단조 감소, 잘못된 값은 RangeError', () => {
  for (const [ppm, r] of [[5_570, 37], [232, 500], [1, 100_000]]) {
    const exact = Number(((BigInt(E100) * BigInt(1_000_000 - ppm) ** BigInt(r - 1)) / BigInt(1_000_000) ** BigInt(r - 1) / 1000n) * 1000n);
    assert.equal(minPriceAtRound(E100, r, { reduction_ppm: ppm }), exact);
  }
  let prev = Infinity;
  for (let r = 1; r <= 2500; r++) { const v = minPriceAtRound(E100, r, { reduction_ppm: 232, round_unit: 1 }); assert.ok(v <= prev); prev = v; }
  assert.throws(() => minPriceAtRound(E100, 2, { reduction_ppm: -1 }), RangeError);
  assert.throws(() => minPriceAtRound(E100, 2, { reduction_ppm: 900_001 }), RangeError);
  assert.throws(() => minPriceAtRound(E100, 2, { reduction_ppm: 5.5 }), RangeError);
});

test('roundAt / minPriceAtElapsed — 창 경계: 0~23시간은 1회차, 24시간부터 2회차, 창 안에서는 가격 고정', () => {
  assert.deepEqual([0, 23, 24, 47, 48].map(h => roundAt(h, 24)), [1, 1, 2, 2, 3]);
  const d = PRESETS.hondi_daily;
  assert.equal(minPriceAtElapsed(E100, 0, d), E100); assert.equal(minPriceAtElapsed(E100, 23, d), E100);
  assert.equal(minPriceAtElapsed(E100, 24, d), minPriceAtElapsed(E100, 47, d));
  assert.ok(minPriceAtElapsed(E100, 48, d) < minPriceAtElapsed(E100, 47, d));
  assert.throws(() => roundAt(-1, 24), RangeError); assert.throws(() => roundAt(5, 0), RangeError);
});

test('roundsAtOrAbove(이분 탐색) — 완만한 하락에서도 정확, 경계에서 한 칸 차이', () => {
  const o = { reduction_ppm: 5_570 };
  const n = roundsAtOrAbove(E100, 90_000_000, o);
  assert.ok(minPriceAtRound(E100, n, o) >= 90_000_000 && minPriceAtRound(E100, n + 1, o) < 90_000_000);
  assert.ok(n >= 18 && n <= 20);                                             // 90%까지 약 19일
  assert.equal(roundsAtOrAbove(E100, 200_000_000, o), 0);
  assert.equal(roundsAtOrAbove(E100, 1, { ...o, max_round: 50 }), 50);       // 상한에 걸리면 max_round
});

test('시간 기반 하락에서도 결정적 회수 보장이 원 단위로 성립(속성, 무작위 2000건)', () => {
  let s = 99; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < 2000; i++) {
    const E = 1_000_000 + Math.floor(rnd() * 499_000_000), max_round = 1 + Math.floor(rnd() * 400);
    const ppm = [232, 5_570, 5_600, 200, 200_000][Math.floor(rnd() * 5)];
    const cost = Math.floor(rnd() * 800), rate = Math.floor(rnd() * 1500), days = 1 + Math.floor(rnd() * 900);
    const cap = ladderAdvanceCapBps({ max_round, reduction_ppm: ppm, selling_cost_bps: cost, annual_rate_bps: rate, days, start_price: E });
    const sale = minPriceAtRound(E, max_round, { reduction_ppm: ppm });
    const r = settleAdvance({ estimated_price: E, advance_bps: cap, creditor_claim: Math.floor(E * 0.8), sale_price: sale,
      selling_costs: Math.ceil(sale * cost / 10000), annual_rate_bps: rate, days });
    assert.equal(r.system_shortfall, 0, `E=${E} n=${max_round} ppm=${ppm} cap=${cap}`);
  }
});

test('computeAdvance — 일 단위 하락(0.557%/일)에서 "최대 허용 일수"가 길수록 선지급 상한이 내려간다', () => {
  const apt = { txn_12m: 40, comps_count: 25, comps_cv: 0.04, months_stale: 1, annual_rate_bps: 800 };
  const at = days => computeAdvance({ ...apt, ladder: { max_round: days + 1, round_interval_days: 1, reduction_ppm: 5_570, start_price: E100 } });
  const [d7, d30, d60, d120] = [at(7), at(30), at(60), at(120)];
  assert.ok(d7.advance_bps >= d30.advance_bps && d30.advance_bps > d60.advance_bps && d60.advance_bps > d120.advance_bps);
  assert.equal(d60.binding, 'ladder_cap'); assert.ok(d60.advance_bps <= 6900);   // 60일 후 약 71.5% → 상한 약 68%
  assert.ok(d60.reasons.some(x => x.includes('0.557')));
  const thin = computeAdvance({ txn_12m: 1, comps_count: 1, comps_cv: 0.45, months_stale: 6, annual_rate_bps: 800,
    ladder: { max_round: 61, round_interval_days: 1, reduction_ppm: 5_570, start_price: E100 } });
  assert.ok(thin.advance_bps <= 1000);
});
