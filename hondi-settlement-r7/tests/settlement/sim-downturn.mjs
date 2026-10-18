// 하락장 위험과 거래 시간 — 시간 단위 조정(24시간 창, 하루 0.557%)이 법원식 40일 회차 대비 얼마나 위험을 줄이는가
// ★ 입찰가 분포(최고 입찰가/시작가)·하락 폭·회수 기간은 예시 가정(미보정). 절대 수치가 아니라 구조적 비교로 읽을 것.
// 실행: node sim-downturn.mjs
import { downturnCapBps } from '../../src/gopang/ai/hondi-loss-defense.js';

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(20261001);
const normal = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());

const N = 200_000, TOL = 61, SHADE = 0.97, SIG_BID = 0.06, Q = 1 - 0.00557;
const states = [                                        // vs = 실제 시장가치 / 공시 시작가(추정)
  ['정상 시장',                         1.00],
  ['하락 15% + 추정이 낡음',            0.85],
  ['하락 25% + 추정이 낡음',            0.75],
  ['하락 25% + 시점수정으로 추정 갱신', 1.00],           // 추정을 현재 시세로 다시 잡으면 시작가가 시장가치와 같아진다
];
const stat = a => { a.sort((x, y) => x - y); return { mean: a.reduce((s, x) => s + x, 0) / a.length, med: a[Math.floor(a.length / 2)], p90: a[Math.floor(a.length * 0.9)] }; };

console.log(`가정: 최고 입찰가 = 시작가 × 시장가치비 × ${SHADE}(입찰 할인) × exp(${SIG_BID}·z). 허용 매각 기간 ${TOL}일. 하락 속도는 두 방식 모두 법원과 같다(20%/40일 ≡ 0.557%/일).`);
console.log(`\n${'시장 상태'.padEnd(30)} | 법원식(40일 회차): ${'미매각'.padStart(6)} ${'평균일'.padStart(6)} | 시간 단위(24시간): ${'미매각'.padStart(6)} ${'평균일'.padStart(6)} ${'p90일'.padStart(6)}`);
const unsoldRates = {};
for (const [name, vs] of states) {
  const court = [], daily = []; let cu = 0, du = 0;
  for (let i = 0; i < N; i++) {
    const ratio = SHADE * vs * Math.exp(SIG_BID * normal());
    const r = ratio >= 1 ? 0 : Math.ceil(Math.log(ratio) / Math.log(0.8));                 // 법원식: 창은 0일, 40일, 80일…
    if (40 * r <= TOL) court.push(40 * r); else cu++;
    const k = ratio >= 1 ? 0 : Math.ceil(Math.log(ratio) / Math.log(Q));                   // 시간 단위: 창은 매일
    if (k <= TOL - 1) daily.push(k); else du++;
  }
  const c = stat(court.length ? court : [0]), d = stat(daily.length ? daily : [0]);
  unsoldRates[name] = { court: cu / N, daily: du / N };
  console.log(`${name.padEnd(30)} |                   ${(cu / N * 100).toFixed(1).padStart(5)}% ${c.mean.toFixed(1).padStart(6)} |                   ${(du / N * 100).toFixed(1).padStart(5)}% ${d.mean.toFixed(1).padStart(6)} ${String(d.p90).padStart(6)}`);
}

// 미매각 종결 손실 = P(미매각) × 종결 시 손실률. 종결 시 손실률은 예시: 원금 회수율 75%(하락장) + 331일 자본비용 8%
const lgd = 1 - 0.75 + 0.08 * 331 / 365;
console.log(`\n[선지급 대비 기대 손실 ≈ P(미매각) × 종결 시 손실률 ${(lgd * 100).toFixed(0)}% (회수율 75%·자본비용 331일 8% 가정)]`);
for (const [name] of states) console.log(`${name.padEnd(30)} | 법원식 ${(unsoldRates[name].court * lgd * 100).toFixed(2).padStart(6)}%  | 시간 단위 ${(unsoldRates[name].daily * lgd * 100).toFixed(2).padStart(6)}%`);

console.log('\n[종결 경로 하락장 스트레스 상한(선지급률 %)] — 연 하락률, 사건 수명 61일 + 회수 기간, 집행비용 3%, 연 8%');
console.log(`${'회수 기간'.padEnd(20)} ${['연 10%', '연 20%', '연 30%'].map(x => x.padStart(8)).join('')}`);
for (const rec of [90, 180, 270, 517]) {
  console.log(`${(rec + '일' + (rec === 517 ? '(법원 경매 사례 17개월)' : '')).padEnd(24)} ${[1000, 2000, 3000].map(d => (downturnCapBps({ annual_decline_bps: d, days_outstanding: TOL + rec, annual_rate_bps: 800, enforcement_cost_bps: 300 }) / 100).toFixed(0).padStart(7) + '%').join('')}`);
}
console.log(`\n사건 수명을 61일 → 7일로 줄일 때(회수 270일, 연 20%): ${(downturnCapBps({ annual_decline_bps: 2000, days_outstanding: 61 + 270, annual_rate_bps: 800, enforcement_cost_bps: 300 }) / 100).toFixed(0)}% → ${(downturnCapBps({ annual_decline_bps: 2000, days_outstanding: 7 + 270, annual_rate_bps: 800, enforcement_cost_bps: 300 }) / 100).toFixed(0)}%  |  회수 기간을 270일 → 90일로 줄일 때: ${(downturnCapBps({ annual_decline_bps: 2000, days_outstanding: 61 + 90, annual_rate_bps: 800, enforcement_cost_bps: 300 }) / 100).toFixed(0)}%`);
