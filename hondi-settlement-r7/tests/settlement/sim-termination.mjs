// 미매각 종결 손실과 자동 조임(종결률 기반 승수)의 효과 — 신호 지연(lag)에 따른 보호력 측정
// ★ 종결 확률·회수율·하락장 구조는 전부 예시 가정(미보정). 절대 수치가 아니라 "구조적 비교"로 읽을 것.
// 실행: node sim-termination.mjs
import { computeAdvance } from '../../src/gopang/ai/hondi-advance-rate.js';
import { terminationThrottle, applyDefenses } from '../../src/gopang/ai/hondi-loss-defense.js';

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const E = 100_000_000, RATE = 800, DAYS = 1095, PER_DAY = 5, LIFE = 61, RECOVER_DAYS = 270, SEEDS = 20, TRAIL = 180;
const tiers = [
  { name: 'high',   share: 0.40, inp: { txn_12m: 40, comps_count: 25, comps_cv: 0.04, months_stale: 1 }, pTerm: 0.005 },
  { name: 'medium', share: 0.30, inp: { txn_12m: 15, comps_count: 8,  comps_cv: 0.10, months_stale: 3 }, pTerm: 0.02 },
  { name: 'low',    share: 0.20, inp: { txn_12m: 5,  comps_count: 4,  comps_cv: 0.15, months_stale: 4 }, pTerm: 0.06 },
  { name: 'thin',   share: 0.10, inp: { txn_12m: 1,  comps_count: 1,  comps_cv: 0.45, months_stale: 6 }, pTerm: 0.15 },
];
for (const t of tiers) t.baseBps = computeAdvance({ ...t.inp, annual_rate_bps: RATE, ladder: { max_round: 61, round_interval_days: 1, reduction_ppm: 5_570, start_price: E } }).advance_bps;
const priorBps = Math.round(tiers.reduce((s, t) => s + t.share * t.pTerm, 0) * 10000);   // 사전 종결률 = 평상시 평균

function makeWorld(seed) {
  const rnd = mulberry32(seed); let stress = false; const cases = [];
  for (let d = 0; d < DAYS; d++) {
    stress = stress ? rnd() > 0.01 : rnd() < 0.002;                                       // 하락장: 평균 100일 지속, 약 500일에 한 번 시작
    for (let k = 0; k < PER_DAY; k++) {
      let u = rnd(), tier = tiers[0]; for (const t of tiers) { if (u < t.share) { tier = t; break; } u -= t.share; }
      const p = Math.min(0.6, tier.pTerm * (stress ? 4 : 1));
      cases.push({ day: d, tier, stress, terminated: rnd() < p, rr: stress ? 0.75 : 0.97 });      // rr = 종결 후 원금 회수율(담보 처분)
    }
  }
  return cases;
}

function run(cases, lag, scale = {}) {                                                                  // lag=null → 방어책 없음
  const nDay = new Int32Array(DAYS), tDay = new Int32Array(DAYS);
  for (const c of cases) { nDay[c.day]++; if (c.terminated) tDay[c.day]++; }
  const cumN = new Int32Array(DAYS + 1), cumT = new Int32Array(DAYS + 1);
  for (let d = 0; d < DAYS; d++) { cumN[d + 1] = cumN[d] + nDay[d]; cumT[d + 1] = cumT[d] + tDay[d]; }
  let volume = 0, loss = 0, lossStress = 0; const lossByTier = {}; const lossByDay = new Float64Array(DAYS + LIFE + 2);
  const cache = new Map();
  for (const c of cases) {
    let bps = Math.floor(c.tier.baseBps * (scale[c.tier.name] ?? 1) / 100) * 100;
    if (lag != null) {
      if (!cache.has(c.day)) {
        const hi = Math.max(0, c.day - LIFE - lag), lo = Math.max(0, hi - TRAIL);           // 결과가 확정된 사건의 최근 TRAIL일
        cache.set(c.day, terminationThrottle({ prior_rate_bps: priorBps, events: cumT[hi] - cumT[lo], total: cumN[hi] - cumN[lo] }).multiplier_bps);
      }
      bps = applyDefenses(bps, [cache.get(c.day)]);
    }
    const adv = E * bps / 10000; volume += adv;
    if (c.terminated) {
      const l = Math.max(0, adv + adv * RATE / 10000 * (LIFE + RECOVER_DAYS) / 365 - adv * c.rr);
      loss += l; lossByDay[c.day + LIFE] += l; if (c.stress) lossStress += l; lossByTier[c.tier.name] = (lossByTier[c.tier.name] ?? 0) + l;
    }
  }
  let worst = 0, win = 0; for (let d = 0; d < lossByDay.length; d++) { win += lossByDay[d] - (d >= 90 ? lossByDay[d - 90] : 0); worst = Math.max(worst, win); }
  return { volume, loss, worst, lossStress, lossByTier };
}

console.log(`기본 선지급률(60일 허용, 연 ${RATE / 100}%): ${tiers.map(t => `${t.name} ${t.baseBps / 100}%`).join(' / ')}  |  사전 종결률 ${(priorBps / 100).toFixed(2)}%`);
console.log(`가정: 종결 확률 ${tiers.map(t => `${t.name} ${t.pTerm * 100}%`).join(', ')} (하락장 ×4) · 종결 후 원금 회수율 평상 97% / 하락장 75% · 회수 ${RECOVER_DAYS}일 · 사건 수명 ${LIFE}일\n`);
const policies = [['방어책 없음', null], ['구조 조정: medium·low 선지급 절반', null, { medium: 0.5, low: 0.5 }], ['자동 조임(추가 지연 0일)', 0], ['자동 조임(추가 지연 30일)', 30], ['자동 조임(추가 지연 60일)', 60], ['자동 조임(추가 지연 120일)', 120]];
const agg = policies.map(() => ({ volume: 0, loss: 0, worst: 0, worstKRW: 0 }));
const decomp = { stress: 0, tiers: {}, total: 0 };
for (let s = 1; s <= SEEDS; s++) { const w = makeWorld(s * 7919); policies.forEach(([, lag, scale], i) => { const r = run(w, lag, scale); agg[i].volume += r.volume; agg[i].loss += r.loss; agg[i].worst += r.worst; agg[i].worstKRW += r.worst; if (i === 0) { decomp.stress += r.lossStress; decomp.total += r.loss; for (const [k, v] of Object.entries(r.lossByTier)) decomp.tiers[k] = (decomp.tiers[k] ?? 0) + v; } }); }
const base = agg[0];
console.log(`${'정책'.padEnd(28)} ${'손실/선지급'.padStart(10)} ${'손실 절감'.padStart(9)} ${'선지급 유지'.padStart(10)} ${'최악 90일 손실(연 선지급 대비)'.padStart(24)}`);
policies.forEach(([name], i) => {
  const a = agg[i], lossRate = a.loss / a.volume * 100, cut = (1 - a.loss / base.loss) * 100, keep = a.volume / base.volume * 100;
  console.log(`${name.padEnd(28)} ${lossRate.toFixed(2).padStart(9)}% ${(i ? cut.toFixed(0) + '%' : '-').padStart(9)} ${keep.toFixed(0).padStart(9)}% ${(a.worst / (a.volume / 3) * 100).toFixed(2).padStart(23)}%`);
});
{
  const worstKRW = agg[0].worstKRW / SEEDS, deposit = E * 0.01, maxOutstanding = PER_DAY * LIFE;
  console.log('\n[예치 풀 충분성 — 하락장 한 분기(최악 90일) 손실 대 1% 예치 풀]');
  console.log(`  최악 90일 손실 평균 ${(worstKRW / 1e6).toFixed(0)}백만원 ÷ 건당 예치(추정가 1% = ${(deposit / 1e6).toFixed(0)}백만원) = 예치금 ${(worstKRW / deposit).toFixed(0)}건분 필요`);
  console.log(`  동시에 살아 있는 사건은 최대 ${maxOutstanding}건(하루 ${PER_DAY}건 × 수명 ${LIFE}일)이므로 풀은 최대 ${maxOutstanding}건분 → 필요량의 ${(maxOutstanding / (worstKRW / deposit) * 100).toFixed(0)}% 이하`);
}
console.log('\n[방어책 없음 기준 손실의 출처]');
console.log(`  하락장에서 발생한 종결 손실: ${(decomp.stress / decomp.total * 100).toFixed(0)}%  |  등급별: ${tiers.map(t => `${t.name} ${((decomp.tiers[t.name] ?? 0) / decomp.total * 100).toFixed(0)}%`).join(', ')}`);
console.log('\n해석(측정된 것만):');
console.log('  - 종결률 기반 자동 조임만으로는 손실을 일부(표의 절감률)만 줄이고 선지급 규모도 함께 줄어든다. 종결은 사건 수명(61일)이 지나야');
console.log('    확정되어 짧은 하락장에는 본질적으로 늦고, 하락장이 끝난 뒤에도 추적 창 동안 조임이 남는다.');
console.log('  - 추가 지연이 길수록 절감률이 줄어드는 방향은 표에서 확인된다.');
console.log('  - 더 빠른 신호(유찰 창 비율·입찰자 수)가 효과적일 것이라는 것은 아직 검증되지 않은 가설이다 — 이 모델은 그 신호를 갖고 있지 않다.');
