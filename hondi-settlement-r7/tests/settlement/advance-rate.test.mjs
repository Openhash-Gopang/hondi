import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAdvance, estimateSigma, liquidityTier, ADVANCE_CAP_BPS, ADVANCE_STEP_BPS, LIQUIDITY_TIERS, MIN_EMPIRICAL_N } from '../../src/gopang/ai/hondi-advance-rate.js';
import { settleAdvance, settleSale } from '../../src/gopang/ai/hondi-settlement.js';

const RATE = 800;
const apt = (o = {}) => ({ txn_12m: 40, comps_count: 25, comps_cv: 0.04, months_stale: 1, annual_rate_bps: RATE, ...o });
const thinHouse = (o = {}) => ({ txn_12m: 1, comps_count: 1, comps_cv: 0.45, months_stale: 6, annual_rate_bps: RATE, ...o });

test('liquidityTier — 경계값(30/10/3), 잘못된 입력', () => {
  const t = n => liquidityTier(n).tier;
  assert.deepEqual([t(30), t(29), t(10), t(9), t(3), t(2), t(0), t(500)], ['high', 'medium', 'medium', 'low', 'low', 'thin', 'thin', 'high']);
  assert.throws(() => liquidityTier(-1), RangeError); assert.throws(() => liquidityTier(NaN), RangeError);
});

test('estimateSigma — 손계산 일치(σ_pred, σ_drift, 합성) 및 데이터 부족 시 보수적 산포', () => {
  const s = estimateSigma({ comps_count: 25, comps_cv: 0.04, months_stale: 1, days_to_sell: 60 });
  const pred = 0.04 * Math.sqrt(1 + 1 / 25), drift = 0.06 * Math.sqrt(1 / 12 + 60 / 365);
  assert.ok(Math.abs(s.sigma - Math.sqrt(pred ** 2 + drift ** 2 + 0.03 ** 2)) < 1e-12);
  assert.equal(s.thin_data, false);
  const thin = estimateSigma({ comps_count: 2, comps_cv: 0.02, months_stale: 1, days_to_sell: 60 });
  assert.equal(thin.thin_data, true); assert.equal(thin.cv_used, 0.25);           // 사례 2건의 낮은 산포는 믿지 않는다
  assert.equal(estimateSigma({ comps_count: 10, comps_cv: null, months_stale: 0, days_to_sell: 0 }).cv_used, 0.25);
});

test('σ는 사례가 적을수록·오래될수록·산포가 클수록 커진다(단조성)', () => {
  const s = o => estimateSigma({ comps_count: 10, comps_cv: 0.08, months_stale: 3, days_to_sell: 120, ...o }).sigma;
  assert.ok(s({ comps_count: 5 }) > s({ comps_count: 10 }) && s({ comps_count: 10 }) > s({ comps_count: 40 }));
  assert.ok(s({ months_stale: 12 }) > s({ months_stale: 3 }));
  assert.ok(s({ comps_cv: 0.15 }) > s({ comps_cv: 0.08 }));
});

test('활발한 아파트 — 높은 선지급률(통계적 한도가 제약), 100bp 단위', () => {
  const r = computeAdvance(apt());
  assert.equal(r.tier, 'high'); assert.equal(r.binding, 'statistical');
  assert.ok(r.advance_bps >= 7000 && r.advance_bps <= ADVANCE_CAP_BPS, `advance=${r.advance_bps}`);
  assert.equal(r.advance_bps % ADVANCE_STEP_BPS, 0);
  assert.ok(r.statistical_bps < 9000);   // 기본 가정에서는 90%까지 통계가 뒷받침하지 못한다 — 정책 상한이 아니라 통계가 제약
});

test('거래 적은 지역 단독주택 — 통계 한도가 있어도 정책 상한 10%로 묶인다', () => {
  const r = computeAdvance(thinHouse());
  assert.equal(r.tier, 'thin'); assert.equal(r.binding, 'policy_cap');
  assert.equal(r.advance_bps, 1000); assert.ok(r.statistical_bps > 1000);
  assert.ok(r.reasons.some(x => x.includes('정책 상한')));
});

test('거부 조건 — 소유권 미확정·선순위 불명·고위험 법적 쟁점이면 0%, σ 과대도 0%', () => {
  for (const f of ['unresolved_title', 'unknown_senior_claims', 'high_severity_legal_issue']) {
    const r = computeAdvance(apt({ flags: { [f]: true } }));
    assert.equal(r.advance_bps, 0); assert.equal(r.binding, 'veto'); assert.ok(r.reasons[0].startsWith('거부'));
  }
  const wide = computeAdvance(thinHouse({ comps_cv: 1.2 }));
  assert.equal(wide.advance_bps, 0); assert.equal(wide.binding, 'veto');
});

test('유동성 등급이 높을수록(다른 입력 동일) 선지급률은 같거나 높다', () => {
  const rates = [0, 2, 5, 15, 45].map(n => computeAdvance(apt({ txn_12m: n })).advance_bps);
  for (let i = 1; i < rates.length; i++) assert.ok(rates[i] >= rates[i - 1], rates.join(','));
});

test('백테스트 실측이 이론보다 나쁘면 낮추고(empirical), 더 좋아도 올리지 않으며, 표본이 적으면 무시한다', () => {
  const base = computeAdvance(apt());
  const worse = computeAdvance(apt({ empirical_ratio_p05: 0.5, empirical_n: 100 }));
  assert.ok(worse.advance_bps < base.advance_bps); assert.equal(worse.binding, 'empirical');
  const better = computeAdvance(apt({ empirical_ratio_p05: 1.2, empirical_n: 100 }));
  assert.equal(better.advance_bps, base.advance_bps);
  const tiny = computeAdvance(apt({ empirical_ratio_p05: 0.3, empirical_n: MIN_EMPIRICAL_N - 1 }));
  assert.equal(tiny.advance_bps, base.advance_bps);
  assert.throws(() => computeAdvance(apt({ empirical_ratio_p05: 3, empirical_n: 100 })), RangeError);
});

test('전체 상한(cap_bps) 인자가 등급 상한보다 낮으면 그 값이 적용된다', () => {
  assert.ok(computeAdvance(apt({ cap_bps: 5000 })).advance_bps <= 5000);
  assert.equal(computeAdvance(apt({ cap_bps: 5000 })).binding, 'policy_cap');
});

test('선지급률 0%는 1단계 정산과 동일한 결과를 낸다', () => {
  const claim = 40_000_000, sale = 55_000_000, costs = 2_750_000;
  const a = settleAdvance({ estimated_price: 60_000_000, advance_bps: 0, creditor_claim: claim, sale_price: sale, selling_costs: costs, annual_rate_bps: RATE, days: 400 });
  const s = settleSale({ sale_price: sale, selling_costs: costs, creditor_claim: claim });
  assert.equal(a.advance, 0); assert.equal(a.carry, 0); assert.equal(a.system_net, 0);
  assert.equal(a.creditor_total, s.creditor_paid); assert.equal(a.debtor_total, s.debtor_proceeds); assert.ok(a.balanced);
});

test('속성 검사(무작위 2000건) — 항상 0~90%·100bp 단위·등급 상한 이하, 위험 요인이 늘면 선지급률은 늘지 않는다', () => {
  let s = 777; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < 2000; i++) {
    const p = { txn_12m: Math.floor(rnd() * 80), comps_count: Math.floor(rnd() * 40), comps_cv: rnd() < 0.2 ? null : rnd() * 0.3,
                months_stale: rnd() * 18, annual_rate_bps: Math.floor(rnd() * 1500) };
    const r = computeAdvance(p);
    const tier = LIQUIDITY_TIERS.find(t => t.tier === r.tier);
    assert.ok(r.advance_bps >= 0 && r.advance_bps <= ADVANCE_CAP_BPS && r.advance_bps <= tier.cap_bps && r.advance_bps % 100 === 0);
    if (p.comps_cv != null) assert.ok(computeAdvance({ ...p, comps_cv: p.comps_cv + 0.05 }).advance_bps <= r.advance_bps);   // 산포↑ → 선지급률 ↛↑
    assert.ok(computeAdvance({ ...p, months_stale: p.months_stale + 6 }).advance_bps <= r.advance_bps);                       // 사례가 낡음 → ↛↑
    assert.ok(computeAdvance({ ...p, annual_rate_bps: p.annual_rate_bps + 300 }).advance_bps <= r.advance_bps);               // 이자↑ → ↛↑
    assert.ok(computeAdvance({ ...p, flags: { unresolved_title: true } }).advance_bps === 0);
  }
});
