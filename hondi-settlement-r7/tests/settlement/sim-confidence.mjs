// 거래 확신도와 선지급 차단 — 임계값별로 어떤 물건이 통과하는가
// ★ 물건 유형별 입력은 예시 가정(미보정). 실행: node sim-confidence.mjs
import { lendingEstimate } from '../../src/gopang/ai/hondi-valuation-tracks.js';

const F = 100_000_000, RATE = 800, LADDER = { max_round: 61, round_interval_days: 1, reduction_ppm: 5_570 };
const types = [
  ['활발한 아파트 단지', { txn_12m: 40, comps_count: 25, comps_cv: 0.04, months_stale: 1 }],
  ['보통 유동성 주택',   { txn_12m: 15, comps_count: 8,  comps_cv: 0.10, months_stale: 3 }],
  ['거래 드문 주택',     { txn_12m: 5,  comps_count: 4,  comps_cv: 0.15, months_stale: 4 }],
  ['거래 거의 없는 단독', { txn_12m: 1,  comps_count: 1,  comps_cv: 0.45, months_stale: 6 }],
];
const thresholds = [0, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
console.log(`허용 매각 기간 61일(24시간 창), 연 ${RATE / 100}% — 확신도 = min(유동성, 정밀도, 법적), 선지급률 %\n`);
console.log(`${'물건'.padEnd(20)} ${'유동성'.padStart(6)} ${'정밀도'.padStart(6)} ${'종합(10점)'.padStart(10)} ${'제약'.padStart(9)} | 임계값별 선지급률: ${thresholds.map(t => String(t).padStart(5)).join(' ')}`);
for (const [name, inp] of types) {
  const base = lendingEstimate({ fair_value: F, inputs: inp, annual_rate_bps: RATE, ladder: LADDER, min_confidence: 0, model_version: 'x' });
  const c = base.confidence;
  const cells = thresholds.map(th => { const l = lendingEstimate({ fair_value: F, inputs: inp, annual_rate_bps: RATE, ladder: LADDER, min_confidence: th, model_version: 'x' }); return `${(l.advance_bps / 100).toFixed(0)}%`.padStart(5); });
  console.log(`${name.padEnd(20)} ${c.components.liquidity.toFixed(2).padStart(6)} ${c.components.precision.toFixed(2).padStart(6)} ${c.score10.toFixed(1).padStart(10)} ${c.limiting.padStart(9)} |                    ${cells.join(' ')}`);
}
console.log('\n읽는 법: 임계값을 올릴수록 거래가 드문 물건부터 선지급이 0%가 된다. 임계값 0은 차단 해제.');
console.log('        앞서 예시로 든 "거래 거의 없는 지역의 단독주택 10%"는 임계값 0.12를 넘기는 순간 차단된다.');
