// 2단계(선지급) 자금 제공자 수익률 시뮬레이션 — 정산 엔진(settleAdvance)을 그대로 사용한다.
// ★ 가정(분포·헤어컷·비용)은 전부 예시이며 보정되지 않았다. 실제 판단은 과거 사건 백테스트로 대체할 것.
// 실행: node sim-advance-yield.mjs
import { settleAdvance } from '../../src/gopang/ai/hondi-settlement.js';

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(20260928);
const normal = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
const studentT = df => { let c = 0; for (let i = 0; i < df; i++) c += normal() ** 2; return normal() / Math.sqrt(c / df) / Math.sqrt(df / (df - 2)); };

const E = 60_000_000, ADVANCE_BPS = 5000, COST_RATE = 0.05, N = 60_000;
const scenarios = [
  ['가격이 잘 잡히는 물건 (σ0.15)',              { sigma: 0.15 }],
  ['평가가 어려운 물건 (σ0.30)',                 { sigma: 0.30 }],
  ['어려운 물건 + 매각 지연(중앙값 1.5년)',        { sigma: 0.30, tMed: 1.5 }],
  ['지연 + 하락장 충격 10%(−25%) + 두꺼운 꼬리',   { sigma: 0.30, tMed: 1.5, shockP: 0.10, shock: 0.25, df: 4 }],
];
const rates = [600, 800, 1000];

console.log('선지급 50% · 판매비용 5% · 헤어컷 0.93 (예시 가정, 미보정)\n');
console.log(`${'시나리오'.padEnd(40)} ${'부과이율'.padStart(6)} | ${'투자자 연환산수익'.padStart(14)} ${'원금손실확률'.padStart(10)} ${'손실 p99/선지급'.padStart(14)} ${'당사자 자본비용/추정가'.padStart(20)}`);
for (const [name, o] of scenarios) {
  // 같은 물건 표본에 세 이율을 적용해 이율 효과만 비교한다
  const deals = Array.from({ length: N }, () => {
    const z = o.df ? studentT(o.df) : normal();
    let R = 0.93 * Math.exp(o.sigma * z);
    if (o.shockP && rnd() < o.shockP) R *= 1 - o.shock;
    const years = (o.tMed ?? 0.67) * Math.exp(0.6 * normal());
    const sale = Math.max(1, Math.round(E * R));
    return { sale, days: Math.min(3650, Math.max(1, Math.round(365 * years))), costs: Math.round(sale * COST_RATE) };
  });
  for (const rate of rates) {
    let net = 0, capYears = 0, losses = 0, carry = 0; const lossPct = [];
    for (const d of deals) {
      const r = settleAdvance({ estimated_price: E, advance_bps: ADVANCE_BPS, creditor_claim: Math.round(E * 0.8), sale_price: d.sale, selling_costs: d.costs, annual_rate_bps: rate, days: d.days });
      net += r.system_net; capYears += r.advance * d.days / 365; carry += r.carry;
      if (r.system_net < 0) { losses++; lossPct.push(-r.system_net / r.advance); }
    }
    lossPct.sort((a, b) => a - b);
    const p99 = lossPct.length ? lossPct[Math.min(lossPct.length - 1, Math.floor(lossPct.length * 0.99))] : 0;
    console.log(`${name.padEnd(40)} ${(rate / 100).toFixed(1).padStart(5)}% | ${(net / capYears * 100).toFixed(2).padStart(13)}% ${(losses / N * 100).toFixed(2).padStart(9)}% ${(p99 * 100).toFixed(1).padStart(13)}% ${(carry / N / E * 100).toFixed(2).padStart(19)}%`);
  }
  console.log();
}
