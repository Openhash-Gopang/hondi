// 위험 비례 선지급률 vs 고정 50% — 세그먼트별 손실·수익 비교 (정산 엔진 settleAdvance 사용)
// ★ 세그먼트의 "실제" 분포와 입력값은 전부 예시 가정(미보정). 과거 사건 백테스트로 대체할 것.
// 실행: node sim-advance-tiers.mjs
import { settleAdvance } from '../../src/gopang/ai/hondi-settlement.js';
import { computeAdvance, liquidityTier } from '../../src/gopang/ai/hondi-advance-rate.js';

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(20260929);
const normal = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
const studentT5 = () => { let c = 0; for (let i = 0; i < 5; i++) c += normal() ** 2; return normal() / Math.sqrt(c / 5) / Math.sqrt(5 / 3); };

const RATE = 800, E = 60_000_000, N = 30_000;
// inputs = 시스템이 아는 값, truth = 실제 시장(시스템은 모름)
const segments = [
  { name: '활발한 아파트 단지', inputs: { txn_12m: 40, comps_count: 25, comps_cv: 0.04, months_stale: 1 }, truth: { sigma: 0.059, ratio: 0.99, tMed: 60 / 365 } },
  { name: '보통 유동성 주택',   inputs: { txn_12m: 15, comps_count: 8,  comps_cv: 0.10, months_stale: 3 }, truth: { sigma: 0.120, ratio: 0.97, tMed: 120 / 365 } },
  { name: '거래 적은 단독주택', inputs: { txn_12m: 1,  comps_count: 1,  comps_cv: 0.45, months_stale: 6 }, truth: { sigma: 0.640, ratio: 0.90, tMed: 540 / 365 } },
];

function run(seg, advance_bps, sigmaMult) {
  const t = liquidityTier(seg.inputs.txn_12m);
  let net = 0, capYears = 0, adv = 0, losses = 0; const lp = [];
  for (let i = 0; i < N; i++) {
    const R = seg.truth.ratio * Math.exp(seg.truth.sigma * sigmaMult * studentT5());
    const years = seg.truth.tMed * Math.exp(0.6 * normal());
    const sale = Math.max(1, Math.round(E * R)), days = Math.min(3650, Math.max(1, Math.round(365 * years)));
    const r = settleAdvance({ estimated_price: E, advance_bps, creditor_claim: Math.round(E * 0.8), sale_price: sale,
      selling_costs: Math.round(sale * t.selling_cost_bps / 10000), annual_rate_bps: RATE, days });
    net += r.system_net; capYears += r.advance * days / 365; adv += r.advance;
    if (r.system_net < 0) { losses++; lp.push(-r.system_net / Math.max(1, r.advance)); }
  }
  lp.sort((a, b) => a - b);
  return { adv, net, capYears, lossRate: losses / N, p99: lp.length ? lp[Math.min(lp.length - 1, Math.floor(lp.length * 0.99))] : 0, lossAmt: -Math.min(0, net) };
}

for (const [label, mult] of [['A) 시스템의 위험 인식이 정확한 경우', 1.0], ['B) 실제 불확실성이 인식의 1.6배(과신)인 경우', 1.6]]) {
  console.log(`\n=== ${label} ===`);
  console.log(`${'세그먼트'.padEnd(20)} ${'방식'.padEnd(12)} ${'선지급률'.padStart(7)} ${'원금손실확률'.padStart(10)} ${'손실p99/선지급'.padStart(13)} ${'투자자연수익'.padStart(11)}`);
  const tot = { flat: { adv: 0, net: 0, cy: 0 }, tier: { adv: 0, net: 0, cy: 0 } };
  for (const seg of segments) {
    const cfg = computeAdvance({ ...seg.inputs, annual_rate_bps: RATE });
    for (const [mode, bpsV] of [['고정 50%', 5000], ['위험 비례', cfg.advance_bps]]) {
      const r = run(seg, bpsV, mult);
      console.log(`${seg.name.padEnd(20)} ${mode.padEnd(12)} ${(bpsV / 100).toFixed(0).padStart(6)}% ${(r.lossRate * 100).toFixed(2).padStart(9)}% ${(r.p99 * 100).toFixed(1).padStart(12)}% ${(bpsV ? r.net / r.capYears * 100 : 0).toFixed(2).padStart(10)}%`);
      const k = mode === '고정 50%' ? 'flat' : 'tier'; tot[k].adv += r.adv; tot[k].net += r.net; tot[k].cy += r.capYears;
    }
  }
  for (const [k, n] of [['flat', '고정 50%'], ['tier', '위험 비례']])
    console.log(`  ▶ 세그먼트 균등 포트폴리오 ${n.padEnd(8)}: 평균 선지급 ${(tot[k].adv / (3 * N) / 1e6).toFixed(1)}백만원/건, 순손익 ${(tot[k].net / 1e6).toFixed(0)}백만원, 연수익률 ${(tot[k].net / tot[k].cy * 100).toFixed(2)}%`);
}
console.log('\n[대표 물건의 산정 근거]');
for (const seg of segments) { const c = computeAdvance({ ...seg.inputs, annual_rate_bps: RATE }); console.log(`- ${seg.name}: ${c.advance_bps / 100}% ← ${c.reasons.join(' / ')}`); }
