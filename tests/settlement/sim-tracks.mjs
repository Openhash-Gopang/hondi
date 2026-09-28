// 두 트랙(중재 / 대출)의 채점표 비교 — 같은 물건·같은 실제 매각가를 다른 잣대로 채점한다
// ★ 세그먼트의 "실제" 분포는 예시 가정(미보정). 실행: node sim-tracks.mjs
import { mediationEstimate, lendingEstimate, evaluateMediationTrack, evaluateLendingTrack, trackSpread } from '../../src/gopang/ai/hondi-valuation-tracks.js';
import { LIQUIDITY_TIERS } from '../../src/gopang/ai/hondi-advance-rate.js';

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(20260930);
const normal = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
const t5 = () => { let c = 0; for (let i = 0; i < 5; i++) c += normal() ** 2; return normal() / Math.sqrt(c / 5) / Math.sqrt(5 / 3); };   // 두꺼운 꼬리(분산 1)

const E = 60_000_000, RATE = 800, N = 20_000;
const segments = [
  { name: '활발한 아파트 단지', inputs: { txn_12m: 40, comps_count: 25, comps_cv: 0.04, months_stale: 1 }, truth: { sigma: 0.059, ratio: 0.99, tMed: 60 / 365 } },
  { name: '보통 유동성 주택',   inputs: { txn_12m: 15, comps_count: 8,  comps_cv: 0.10, months_stale: 3 }, truth: { sigma: 0.120, ratio: 0.97, tMed: 120 / 365 } },
  { name: '거래 적은 단독주택', inputs: { txn_12m: 1,  comps_count: 1,  comps_cv: 0.45, months_stale: 6 }, truth: { sigma: 0.640, ratio: 0.90, tMed: 540 / 365 } },
];
const pct = (x, d = 1) => (x == null ? '  -  ' : (x * 100).toFixed(d) + '%');

for (const [label, mult] of [['A) 모델의 위험 인식이 정확한 경우', 1.0], ['B) 실제 불확실성이 인식의 1.6배인 경우(과소평가)', 1.6]]) {
  console.log(`\n=== ${label} ===`);
  console.log(`${'세그먼트'.padEnd(20)} | 중재 트랙: ${'중앙편향'.padStart(8)} ${'MdAPE'.padStart(6)} ${'PE20'.padStart(6)} ${'판정'.padStart(7)} | 대출 트랙: ${'담보/공정'.padStart(8)} ${'커버리지'.padStart(8)} ${'평균부족'.padStart(8)} ${'보수성비용'.padStart(9)} ${'판정'.padStart(6)}`);
  for (const seg of segments) {
    const med = mediationEstimate({ point: E, sigma: 0.1, model_version: 'med-1' });
    const lnd = lendingEstimate({ fair_value: E, inputs: seg.inputs, annual_rate_bps: RATE, model_version: 'lend-1' });
    const cost = LIQUIDITY_TIERS.find(t => t.tier === lnd.tier).selling_cost_bps / 10000;
    const medRows = [], lndRows = [];
    for (let i = 0; i < N; i++) {
      const R = seg.truth.ratio * Math.exp(seg.truth.sigma * mult * t5());
      const days = Math.max(1, Math.round(365 * seg.truth.tMed * Math.exp(0.6 * normal())));
      const realized = Math.max(1, Math.round(E * R));
      medRows.push({ fair_value: med.fair_value, realized_price: realized });
      lndRows.push({ collateral_value: lnd.collateral_value, realized_net: realized * (1 - cost) / (1 + RATE / 10000 * days / 365) });
    }
    const m = evaluateMediationTrack(medRows), l = evaluateLendingTrack(lndRows);
    console.log(`${seg.name.padEnd(20)} |            ${pct(m.bias_median).padStart(8)} ${pct(m.mdape).padStart(6)} ${pct(m.pe20, 0).padStart(6)} ${m.verdict.padStart(7)} |            ${pct(trackSpread([{ fair_value: E, collateral_value: lnd.collateral_value }]) == null ? null : lnd.collateral_value / E, 0).padStart(8)} ${pct(l.coverage_incl_unsold).padStart(8)} ${pct(l.shortfall_severity).padStart(8)} ${pct(l.conservatism_cost).padStart(9)} ${l.verdict.padStart(6)}`);
  }
}
console.log('\n읽는 법: 중재는 "체계적으로 틀렸는가(편향)와 얼마나 빗나가는가(MdAPE)"를, 대출은 "담보 아래로 떨어진 빈도(커버리지)와 그때 얼마나 부족했는가"를 본다.');
console.log('        같은 물건이라도 두 점수는 따로 움직인다 — B에서 중재 편향은 그대로여도 대출 커버리지는 무너질 수 있다.');
