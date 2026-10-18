import test from 'node:test';
import assert from 'node:assert/strict';
import { settleSale, settleAdvance, advanceAmount, annualizedReturn, maxAdvanceBps } from '../../src/gopang/ai/hondi-settlement.js';

test('1단계 — 정상 매각: 판매비용 → 채권자 → 채무자 순, 현금 보존', () => {
  const r = settleSale({ sale_price: 60_000_000, selling_costs: 3_000_000, creditor_claim: 40_000_000, estimated_price: 55_000_000 });
  assert.equal(r.net_proceeds, 57_000_000);
  assert.equal(r.creditor_paid, 40_000_000); assert.equal(r.debtor_proceeds, 17_000_000);
  assert.equal(r.creditor_shortfall, 0); assert.ok(r.balanced);
  assert.ok(Math.abs(r.realization_ratio - 60 / 55) < 1e-12);
});

test('1단계 — 매각가가 청구액에 못 미치면 채권자가 전액 가져가고 잔여 채권이 남는다', () => {
  const r = settleSale({ sale_price: 30_000_000, selling_costs: 2_000_000, creditor_claim: 40_000_000 });
  assert.equal(r.creditor_paid, 28_000_000); assert.equal(r.debtor_proceeds, 0);
  assert.equal(r.creditor_shortfall, 12_000_000); assert.ok(r.balanced);
});

test('1단계 — 수수료는 판매비용 차감 후 금액 기준(내림), 판매비용 초과분은 uncovered로 남는다', () => {
  const a = settleSale({ sale_price: 10_000_001, selling_costs: 1, fee_bps: 100, creditor_claim: 0 });
  assert.equal(a.fee, 100_000);                       // (10,000,001 − 1) × 1% = 100,000
  const b = settleSale({ sale_price: 1_000_000, selling_costs: 1_500_000, creditor_claim: 500_000 });
  assert.equal(b.costs_paid, 1_000_000); assert.equal(b.uncovered_costs, 500_000);
  assert.equal(b.creditor_paid, 0); assert.ok(b.balanced);
});

test('입력 검증 — 소수·음수·문자열·범위 밖은 RangeError', () => {
  assert.throws(() => settleSale({ sale_price: 1.5, creditor_claim: 0 }), RangeError);
  assert.throws(() => settleSale({ sale_price: -1, creditor_claim: 0 }), RangeError);
  assert.throws(() => settleSale({ sale_price: '100', creditor_claim: 0 }), RangeError);
  assert.throws(() => settleSale({ sale_price: 100, creditor_claim: 0, fee_bps: 1001 }), RangeError);
  assert.throws(() => settleAdvance({ estimated_price: 100, creditor_claim: 0, sale_price: 100, annual_rate_bps: 800, days: 3651 }), RangeError);
});

test('대금 규모가 커도 정수 정밀도가 유지된다(BigInt) — 5e12원, 수수료 10%', () => {
  const r = settleSale({ sale_price: 5_000_000_000_001, fee_bps: 1000, creditor_claim: 0 });
  assert.equal(r.fee, Number((5_000_000_000_001n * 1000n) / 10000n));
  assert.ok(r.balanced);
});

test('2단계 — 정상: 선지급 50%, 원금+자본비용 최우선 회수 후 잔액 정산', () => {
  const r = settleAdvance({ estimated_price: 60_000_000, advance_bps: 5000, creditor_claim: 40_000_000,
    sale_price: 66_000_000, selling_costs: 3_300_000, annual_rate_bps: 800, days: 365 });
  assert.equal(r.advance, 30_000_000); assert.equal(r.carry, 2_400_000);
  assert.equal(r.creditor_advance, 30_000_000); assert.equal(r.debtor_advance, 0);
  assert.equal(r.net_proceeds, 62_700_000);
  assert.equal(r.system_recovery, 32_400_000); assert.equal(r.system_net, 2_400_000);
  assert.equal(r.creditor_final, 10_000_000); assert.equal(r.debtor_final, 20_300_000);
  assert.equal(r.creditor_shortfall, 0); assert.ok(r.balanced);
  assert.ok(Math.abs(annualizedReturn({ advance: r.advance, system_net: r.system_net, days: 365 }) - 0.08) < 1e-12);
});

test('2단계 — 손실: 실현가 부족분은 시스템이 부담, 당사자에게 되돌려 받지 않는다(무소구)', () => {
  const r = settleAdvance({ estimated_price: 60_000_000, advance_bps: 5000, creditor_claim: 40_000_000,
    sale_price: 30_000_000, selling_costs: 1_500_000, annual_rate_bps: 800, days: 365 });
  assert.equal(r.net_proceeds, 28_500_000);
  assert.equal(r.system_recovery, 28_500_000); assert.equal(r.system_net, -1_500_000);
  assert.equal(r.system_shortfall, 3_900_000);        // 원금 1.5M + 미회수 이자 2.4M
  assert.equal(r.creditor_final, 0); assert.equal(r.debtor_final, 0);
  assert.equal(r.creditor_total, 30_000_000);         // 이미 받은 선지급은 그대로
  assert.ok(annualizedReturn({ advance: r.advance, system_net: r.system_net, days: 365 }) < 0);
  assert.ok(r.balanced);
});

test('2단계 — 채권자 청구가 선지급액보다 작으면 남는 선지급은 채무자에게', () => {
  const r = settleAdvance({ estimated_price: 60_000_000, creditor_claim: 20_000_000, sale_price: 60_000_000,
    annual_rate_bps: 800, days: 100 });
  assert.equal(r.creditor_advance, 20_000_000); assert.equal(r.debtor_advance, 10_000_000);
  assert.equal(r.creditor_final, 0); assert.ok(r.balanced);
});

test('advanceAmount / maxAdvanceBps — 하위 분위에서 선지급률 역산', () => {
  assert.equal(advanceAmount({ estimated_price: 60_000_001, advance_bps: 5000 }), 30_000_000);   // 내림
  // 하위 5% 분위 실현비율 0.6, 판매비용 5%, 연 8%, 1년 → 0.6×0.95/1.08 = 52.77%
  assert.equal(maxAdvanceBps({ ratio_quantile: 0.6, selling_cost_bps: 500, annual_rate_bps: 800, days: 365 }), 5277);
  assert.equal(maxAdvanceBps({ ratio_quantile: 0.1, selling_cost_bps: 500, annual_rate_bps: 800, days: 365 }) < 1000, true);
  assert.throws(() => maxAdvanceBps({ ratio_quantile: 0, annual_rate_bps: 800, days: 1 }), RangeError);
});

test('속성 검사(무작위 3000건) — 어떤 입력에서도 현금 보존·지급액 비음수·손실은 시스템에만', () => {
  let s = 12345; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const pick = max => Math.floor(rnd() * max);
  for (let i = 0; i < 3000; i++) {
    const est = 1 + pick(500_000_000), sale = pick(700_000_000), costs = pick(60_000_000), claim = pick(600_000_000);
    const fee_bps = pick(300), adv = pick(10001), rate = pick(2000), days = pick(1500);
    const a = settleSale({ sale_price: sale, selling_costs: costs, fee_bps, creditor_claim: claim });
    assert.ok(a.balanced); assert.ok(a.creditor_paid >= 0 && a.debtor_proceeds >= 0 && a.creditor_paid <= claim);
    const b = settleAdvance({ estimated_price: est, advance_bps: adv, creditor_claim: claim, sale_price: sale, selling_costs: costs, fee_bps, annual_rate_bps: rate, days });
    assert.ok(b.balanced, JSON.stringify(b));
    for (const k of ['creditor_final', 'debtor_final', 'creditor_total', 'debtor_total', 'system_recovery', 'system_shortfall'])
      assert.ok(b[k] >= 0, `${k} < 0`);
    if (b.system_shortfall > 0) assert.ok(b.creditor_final === 0 && b.debtor_final === 0);   // 손실이면 당사자 추가 지급 없음
  }
});
