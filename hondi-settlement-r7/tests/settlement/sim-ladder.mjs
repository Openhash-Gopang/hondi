// 매각 사다리(법원과 같은 하락 속도: 24시간마다 0.557% ≡ 40일마다 20%)와 선지급률의 관계
// ★ 등급별 비용·기간·이율은 예시 가정(미보정). 실행: node sim-ladder.mjs
import { PRESETS, minPriceAtElapsed, minPriceAtRound, requiredDeposit } from '../../src/gopang/ai/hondi-sale-ladder.js';
import { computeAdvance } from '../../src/gopang/ai/hondi-advance-rate.js';

const E = 60_000_000, RATE = 800, daily = PRESETS.hondi_daily;
console.log(`[가격 경로] 시작가(추정가) ${E.toLocaleString()}원 — 24시간마다 0.557% 하락(법원 20%/40일과 같은 속도), 1,000원 절사`);
console.log(`${'경과'.padEnd(8)} ${'최저가(원)'.padStart(13)} ${'시작가 대비'.padStart(9)} ${'보증금 10%(원)'.padStart(14)}   (참고: 법원 방식 같은 시점)`);
for (const d of [0, 1, 7, 14, 30, 40, 60, 90, 120, 180, 365]) {
  const p = minPriceAtElapsed(E, d * 24, daily);
  const court = minPriceAtRound(E, Math.floor(d / 40) + 1, PRESETS.court_like);
  console.log(`${(d + '일').padEnd(8)} ${p.toLocaleString().padStart(13)} ${((p / E) * 100).toFixed(1).padStart(8)}% ${requiredDeposit(p).toLocaleString().padStart(14)}   ${court.toLocaleString().padStart(12)}원 (${((court / E) * 100).toFixed(0)}%)`);
}

const archetypes = [
  ['활발한 아파트 단지', { txn_12m: 40, comps_count: 25, comps_cv: 0.04, months_stale: 1 }],
  ['보통 유동성 주택',   { txn_12m: 15, comps_count: 8,  comps_cv: 0.10, months_stale: 3 }],
  ['거래 적은 단독주택', { txn_12m: 1,  comps_count: 1,  comps_cv: 0.45, months_stale: 6 }],
];
const horizons = [7, 14, 30, 60, 90, 180];
console.log(`\n[허용하는 최대 매각 기간별 선지급률(%)] — 그 기간 안에 안 팔려 최저가가 내려가도 선지급 원금·자본비용·판매비용 회수, 연 ${RATE / 100}%`);
console.log(`${'세그먼트'.padEnd(20)} ${'제한 없음'.padStart(8)} ${horizons.map(d => (d + '일').padStart(6)).join(' ')}   (제약: L=사다리, P=정책상한, S=통계)`);
for (const [name, inp] of archetypes) {
  const base = computeAdvance({ ...inp, annual_rate_bps: RATE });
  const cells = horizons.map(d => computeAdvance({ ...inp, annual_rate_bps: RATE, ladder: { max_round: d + 1, round_interval_days: 1, reduction_ppm: daily.reduction_ppm, start_price: E } }));
  console.log(`${name.padEnd(20)} ${(base.advance_bps / 100).toFixed(0).padStart(7)}% ${cells.map(c => `${(c.advance_bps / 100).toFixed(0)}%`.padStart(6)).join(' ')}   ${cells.map(c => c.binding === 'ladder_cap' ? 'L' : c.binding === 'policy_cap' ? 'P' : 'S').join('')}`);
}
console.log('\n해석: 하락이 완만하므로 짧은 기간(수일~2주) 안에서는 선지급 상한이 통계적 한도를 거의 깎지 않고,');
console.log('      기간이 길어질수록(60일 이상) 안전한 선지급률이 눈에 띄게 내려간다. 위험한 물건은 정책 상한(10%)이 이미 더 낮아 영향이 없다.');
