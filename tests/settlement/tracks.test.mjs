import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeInputs, mediationEstimate, lendingEstimate, assertSeparation, evaluateMediationTrack, evaluateLendingTrack,
  wilson95, pinballLoss, trackSpread, ALLOWED_INPUTS, TRACKS,
} from '../../src/gopang/ai/hondi-valuation-tracks.js';
import { evaluate } from '../../src/gopang/ai/hondi-valuation-metrics.js';

const F = 100_000_000;
const APT = { txn_12m: 40, comps_count: 25, comps_cv: 0.04, months_stale: 1 };
const THIN = { txn_12m: 1, comps_count: 1, comps_cv: 0.45, months_stale: 6 };
const lend = (o = {}) => lendingEstimate({ fair_value: F, inputs: APT, annual_rate_bps: 800, model_version: 'lend-1', ...o });

test('입력 분리 — 대출 트랙은 당사자 제공 서술을 버리고(dropped 기록), 중재 트랙은 허용한다', () => {
  const inputs = { ...APT, party_notes: '리모델링 완료, 시세보다 싸게 내놓음', condition_notes: '상태 양호', bogus: 1 };
  const l = sanitizeInputs('lending', inputs), m = sanitizeInputs('mediation', inputs);
  assert.deepEqual(l.dropped.sort(), ['bogus', 'condition_notes', 'party_notes']);
  assert.equal(l.clean.txn_12m, 40); assert.equal('party_notes' in l.clean, false);
  assert.deepEqual(m.dropped, ['bogus']); assert.equal(m.clean.party_notes.length > 0, true);
  assert.throws(() => sanitizeInputs('nope', {}), RangeError);
  assert.ok(!ALLOWED_INPUTS.lending.includes('party_notes') && ALLOWED_INPUTS.mediation.includes('party_notes'));
});

test('당사자 서술을 바꿔도 대출 결과는 같다(입력 조작으로 선지급을 못 올린다)', () => {
  const a = lend({ inputs: { ...APT, party_notes: '없음' }}), b = lend({ inputs: { ...APT, party_notes: '초우량 신축, 감정가 2배 예상', condition_notes: '최상' } });
  assert.equal(a.advance, b.advance); assert.equal(a.collateral_value, b.collateral_value);
  assert.deepEqual(b.dropped_inputs.sort(), ['condition_notes', 'party_notes']);
});

test('중재 산출물 — 공정가치는 중앙 추정을 그대로(보수 조정 없음), 구간은 로그 대칭', () => {
  const m = mediationEstimate({ point: F, sigma: 0.10, model_version: 'med-1', basis: '비교사례 25건' });
  assert.equal(m.fair_value, F); assert.ok(m.low_p10 < F && F < m.high_p90);
  assert.ok(Math.abs(Math.log(F / m.low_p10) - Math.log(m.high_p90 / F)) < 1e-6);
  assert.ok(Object.isFrozen(m));
  assert.throws(() => mediationEstimate({ point: 0, sigma: 0.1, model_version: 'x' }), RangeError);
  assert.throws(() => mediationEstimate({ point: F, sigma: -1, model_version: 'x' }), RangeError);
  assert.throws(() => mediationEstimate({ point: F, sigma: 0.1, model_version: '' }), RangeError);
});

test('대출 산출물 — 담보가치는 공정가치 이하, 선지급은 담보가치 이하, LTV는 100% 미만', () => {
  const l = lend();
  assert.ok(l.collateral_value > 0 && l.collateral_value <= F);
  assert.ok(l.advance > 0 && l.advance <= l.collateral_value); assert.ok(l.ltv_bps > 0 && l.ltv_bps < 10000);
  assert.equal(l.tier, 'high'); assert.equal(l.fair_value_ref, F);
  const t = lend({ inputs: THIN });
  assert.ok(t.collateral_value < l.collateral_value);                                  // 불확실한 물건은 담보가치가 훨씬 낮다
  assert.ok(t.advance <= 0.10 * F);                                                    // 정책 상한 10%
});

test('거부 조건(소유권 미확정)이면 담보가치 0·선지급 0 — 대출 불가, 중재는 그대로 가능', () => {
  const l = lend({ inputs: { ...APT, registry_flags: { unresolved_title: true } } });
  assert.equal(l.collateral_value, 0); assert.equal(l.advance, 0); assert.equal(l.binding, 'veto');
  const m = mediationEstimate({ point: F, sigma: 0.1, model_version: 'med-1' });
  assert.equal(m.fair_value, F);                                                        // 대출이 막혀도 시장 중재의 공정가치는 영향받지 않는다
});

test('트랙 독립성 — 대출 쪽 파라미터를 아무리 바꿔도 중재 산출물은 변하지 않는다', () => {
  const m0 = mediationEstimate({ point: F, sigma: 0.08, model_version: 'med-1' });
  for (const p of [{ annual_rate_bps: 200 }, { annual_rate_bps: 1500 }, { cap_bps: 3000 }, { ladder: { max_round: 61, round_interval_days: 1, reduction_ppm: 5570 } }, { fee_bps: 200 }]) {
    const l = lend(p), m = mediationEstimate({ point: F, sigma: 0.08, model_version: 'med-1' });
    assert.deepEqual(m, m0); assert.ok(assertSeparation(m, l));
  }
});

test('assertSeparation — 참조 공정가치 불일치, 트랙 표식 오류, 담보가치 초과를 잡는다', () => {
  const m = mediationEstimate({ point: F, sigma: 0.1, model_version: 'med-1' }), l = lend();
  assert.ok(assertSeparation(m, l));
  assert.throws(() => assertSeparation(m, { ...l, fair_value_ref: F + 1 }), /다른 공정가치/);
  assert.throws(() => assertSeparation(m, { ...l, collateral_value: F + 1 }), /넘었습니다/);
  assert.throws(() => assertSeparation(l, m), /표식/);
});

test('속성(무작위 1500건) — 어떤 입력에서도 담보가치 ≤ 공정가치, 선지급 ≤ 담보가치', () => {
  let s = 2026; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < 1500; i++) {
    const fv = 1_000_000 + Math.floor(rnd() * 900_000_000);
    const inputs = { txn_12m: Math.floor(rnd() * 80), comps_count: Math.floor(rnd() * 40), comps_cv: rnd() < 0.2 ? null : rnd() * 0.4, months_stale: rnd() * 18 };
    const l = lendingEstimate({ fair_value: fv, inputs, annual_rate_bps: Math.floor(rnd() * 1500), model_version: 'p' });
    assert.ok(l.collateral_value <= fv && l.advance <= l.collateral_value, JSON.stringify({ fv, inputs, l }));
  }
});

// 실제 매각가 표본 생성: 공정가치 F 기준 중앙 배율 med, 로그 표준편차 sig. 순회수(net)는 담보가치와 같은 기준(판매비용 3%·자본비용 60일 8%)으로 환산.
function world(sig, med, n = 3000, seed = 77) {
  let s = seed; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const norm = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  return Array.from({ length: n }, () => { const realized = Math.round(F * med * Math.exp(sig * norm())); return { realized, net: realized * (1 - 0.03) / (1 + 0.08 * 60 / 365) }; });
}

test('왜 분리하는가 ① — 모델이 일관될 때: 담보가치를 시작가로 쓰면 편향, 공정가치를 담보로 쓰면 커버리지 붕괴', () => {
  const l = lend(), rows = world(0.0588, 0.99);                                 // 진실 σ = 모델이 아는 σ(APT 약 5.9%)
  const fairAsMediation = evaluateMediationTrack(rows.map(r => ({ fair_value: F, realized_price: r.realized })));
  const collateralAsMediation = evaluateMediationTrack(rows.map(r => ({ fair_value: l.collateral_value, realized_price: r.realized })));
  assert.equal(fairAsMediation.verdict, 'ok'); assert.ok(Math.abs(fairAsMediation.bias) < 0.03);
  assert.equal(collateralAsMediation.verdict, 'biased'); assert.ok(collateralAsMediation.bias < -0.10);      // 13% 낮게 공시 → 낙찰가도 끌려 내려간다
  const lendingOf = value => evaluateLendingTrack(rows.map(r => ({ collateral_value: value, realized_net: r.net })));
  assert.ok(lendingOf(l.collateral_value).coverage_incl_unsold > 0.93);                                       // 설계 목표(95%) 부근
  assert.ok(lendingOf(F).coverage_incl_unsold < 0.5);                                                         // 공정가치를 담보로 삼으면 대부분 그 아래로 팔린다
  assert.equal(lendingOf(F).verdict, 'fail');
});

test('왜 분리하는가 ② — 위험을 과소평가하면 중재 점수는 멀쩡한데 대출 점수만 실패한다(한 점수로는 못 잡는다)', () => {
  const l = lend(), rows = world(0.10, 1.0);                                    // 진실 σ 10% > 모델이 아는 5.9%
  const med = evaluateMediationTrack(rows.map(r => ({ fair_value: F, realized_price: r.realized })));
  const lnd = evaluateLendingTrack(rows.map(r => ({ collateral_value: l.collateral_value, realized_net: r.net })));
  assert.equal(med.verdict, 'ok');                                              // 중재: 편향 없음(중앙값은 맞다)
  assert.ok(lnd.coverage_incl_unsold < 0.90); assert.equal(lnd.verdict, 'fail'); // 대출: 하방 꼬리를 놓침 → 커버리지 미달
  assert.ok(lnd.worst_shortfall > 0.05);
});

test('evaluateMediationTrack — 편향 없으면 ok, 체계적으로 낮게 공시하면 biased, 표본 부족·무데이터 구분', () => {
  const mk = (bias, n) => Array.from({ length: n }, (_, i) => ({ fair_value: Math.round(100 * (1 + bias)), realized_price: 100 + (i % 3) - 1 }));
  assert.equal(evaluateMediationTrack(mk(0, 60)).verdict, 'ok');
  assert.equal(evaluateMediationTrack(mk(-0.15, 60)).verdict, 'biased');
  assert.equal(evaluateMediationTrack(mk(0, 5)).verdict, 'low_sample');
  assert.equal(evaluateMediationTrack([{ fair_value: 100, realized_price: null }]).verdict, 'no_data');
  assert.equal(evaluateMediationTrack(mk(0.05, 60), { bias_tolerance: 0.10 }).verdict, 'ok');
});

test('evaluateLendingTrack — 커버리지, 부족 폭, 보수성 비용, 미매각 처리, 판정', () => {
  const rows = [];
  for (let i = 0; i < 95; i++) rows.push({ collateral_value: 80, realized_net: 100 });        // 커버됨(보수성 비용 20%)
  for (let i = 0; i < 5; i++) rows.push({ collateral_value: 80, realized_net: 60 });          // 5건 미달(부족 25%)
  const a = evaluateLendingTrack(rows);
  assert.equal(a.coverage_incl_unsold, 0.95); assert.equal(a.verdict, 'ok');
  assert.ok(Math.abs(a.shortfall_severity - 0.25) < 1e-12); assert.ok(Math.abs(a.conservatism_cost - 0.2) < 1e-12);
  const b = evaluateLendingTrack([...rows, ...Array.from({ length: 10 }, () => ({ collateral_value: 80, realized_net: null, unsold: true }))]);
  assert.ok(b.coverage_incl_unsold < 0.90); assert.equal(b.n_unsold, 10); assert.equal(b.verdict, 'fail');   // 미매각 종결은 회수 실패로 센다
  assert.equal(b.coverage_realized, 0.95);
  const w = evaluateLendingTrack([...rows.slice(0, 92), ...rows.slice(95, 100), ...rows.slice(0, 3)].slice(0, 100));  // 커버 95→92/100 안팎
  assert.ok(['warn', 'fail', 'ok'].includes(w.verdict));
  assert.equal(evaluateLendingTrack([{ collateral_value: 0, realized_net: 100 }]).verdict, 'no_data');    // 대출 안 한 건은 채점 제외
  assert.equal(evaluateLendingTrack(rows.slice(90, 100)).verdict, 'low_sample');
});

test('wilson95 / pinballLoss / trackSpread — 손계산과 일치', () => {
  const w = wilson95(95, 100); assert.ok(w.low > 0.88 && w.low < 0.90 && w.high > 0.97 && w.high < 0.99);
  assert.deepEqual(wilson95(0, 0), { low: 0, high: 1 });
  // tau=0.05: q=80,y=100 → 0.05×20/100 = 0.01 ; q=80,y=60 → 0.95×20/60 = 0.31666…
  assert.ok(Math.abs(pinballLoss([{ q: 80, y: 100 }], 0.05) - 0.01) < 1e-12);
  assert.ok(Math.abs(pinballLoss([{ q: 80, y: 60 }], 0.05) - 0.95 * 20 / 60) < 1e-12);
  assert.equal(pinballLoss([], 0.05), null);
  assert.ok(Math.abs(trackSpread([{ fair_value: 100, collateral_value: 80 }, { fair_value: 100, collateral_value: 90 }, { fair_value: 100, collateral_value: 60 }]) - 0.2) < 1e-12);
  assert.equal(trackSpread([]), null);
});

test('TRACKS 메타 — 두 트랙의 목표와 주지표가 서로 다르게 선언되어 있다', () => {
  assert.notEqual(TRACKS.mediation.objective, TRACKS.lending.objective);
  assert.deepEqual(TRACKS.mediation.primary_metrics.filter(m => TRACKS.lending.primary_metrics.includes(m)), []);
});

test('중재 판정은 중앙값 편향을 쓴다 — 극단값 1건이 평균 편향을 폭발시켜도 판정은 흔들리지 않는다', () => {
  const rows = Array.from({ length: 99 }, () => ({ fair_value: 100, realized_price: 100 }));
  rows.push({ fair_value: 100, realized_price: 1 });                                                 // 극단값
  const r = evaluateMediationTrack(rows);
  assert.ok(r.bias > 0.5); assert.equal(r.verdict, 'ok');                                            // 평균 편향은 폭발했지만 시스템은 정상 판정
});

test('대출 판정은 통계적 양립성을 본다 — 정확히 보정된 모델의 표본 잡음은 통과, 유의한 미달은 실패', () => {
  const mk = (k, n) => [...Array.from({ length: k }, () => ({ collateral_value: 80, realized_net: 100 })), ...Array.from({ length: n - k }, () => ({ collateral_value: 80, realized_net: 60 }))];
  const a = evaluateLendingTrack(mk(9480, 10000));                 // 94.8% — 95% 분위 모델이 잡음으로 낼 수 있는 값
  assert.equal(a.verdict, 'ok'); assert.ok(a.wilson95.high >= 0.95);
  const b = evaluateLendingTrack(mk(9400, 10000));                 // 94.0% — 표본이 크면 유의하게 미달
  assert.equal(b.verdict, 'fail'); assert.ok(b.wilson95.high < 0.95);
  const c = evaluateLendingTrack(mk(92, 100));                     // 소표본 92% — 통계적으로 아직 미달을 입증 못 함
  assert.equal(c.verdict, 'ok'); assert.ok(c.wilson95.low < 0.95 && c.wilson95.high >= 0.95);
  const d = evaluateLendingTrack(mk(85, 100));                     // 85% — 소표본이어도 미달이 유의
  assert.equal(d.verdict, 'fail');
  assert.equal(evaluateLendingTrack(mk(20, 25)).verdict, 'low_sample');
});

const LADDER60 = { max_round: 61, round_interval_days: 1, reduction_ppm: 5_570 };
const MED = { txn_12m: 15, comps_count: 8, comps_cv: 0.10, months_stale: 3 };
const LOW = { txn_12m: 5, comps_count: 4, comps_cv: 0.15, months_stale: 4 };

test('확신도 차단 — 60일 허용 기준: 아파트·보통은 통과, 거래 적은 물건은 선지급 0(담보가치는 정보로 남는다)', () => {
  const run = inputs => lendingEstimate({ fair_value: F, inputs, annual_rate_bps: 800, ladder: LADDER60, model_version: 'g' });
  const apt = run(APT), med = run(MED), low = run(LOW), thin = run(THIN);
  assert.equal(apt.gate.passed, true); assert.ok(apt.advance > 0);
  assert.equal(med.gate.passed, true); assert.ok(med.advance > 0);                 // 확신도 약 0.57 ≥ 0.5
  assert.equal(low.gate.passed, false); assert.equal(low.advance, 0); assert.equal(low.binding, 'confidence_gate');
  assert.equal(thin.gate.passed, false); assert.equal(thin.advance, 0); assert.equal(thin.binding, 'confidence_gate');
  assert.ok(thin.collateral_value > 0 && thin.confidence.score10 < 2);             // 담보가치는 계산되어 남고, 확신도 점수도 기록
  assert.equal(thin.confidence.limiting, 'precision');
  assert.ok(thin.reasons.some(x => x.includes('선지급 차단')));
  assert.equal(apt.window_days, 61);
});

test('임계값을 올리면 더 많이 차단되고, 0이면 차단 없음(이전 동작), 중재 트랙은 무관', () => {
  const at = (inputs, m) => lendingEstimate({ fair_value: F, inputs, annual_rate_bps: 800, ladder: LADDER60, min_confidence: m, model_version: 'g' });
  assert.ok(at(MED, 0.4).advance > 0); assert.equal(at(MED, 0.7).advance, 0); assert.equal(at(MED, 0.7).binding, 'confidence_gate');
  assert.ok(at(APT, 0.85).advance > 0); assert.equal(at(APT, 0.95).advance, 0);
  assert.ok(at(THIN, 0).advance >= 0 && at(THIN, 0).binding !== 'confidence_gate');   // 0 = 차단 해제
  const m0 = mediationEstimate({ point: F, sigma: 0.1, model_version: 'm' });
  for (const th of [0, 0.5, 0.95]) { assert.ok(assertSeparation(mediationEstimate({ point: F, sigma: 0.1, model_version: 'm' }), at(APT, th))); }
  assert.equal(m0.fair_value, F);                                                      // 선지급이 막혀도 시장 중재의 공정가치는 그대로
  assert.throws(() => at(APT, 1.5), RangeError);
});

test('거부 조건(veto)이 확신도 차단보다 우선한다', () => {
  const l = lendingEstimate({ fair_value: F, inputs: { ...APT, registry_flags: { unresolved_title: true } }, annual_rate_bps: 800, ladder: LADDER60, model_version: 'v' });
  assert.equal(l.binding, 'veto'); assert.equal(l.advance, 0); assert.equal(l.confidence.components.legal, 0);
});

test('하락장 스트레스 상한 — 완만한 하락(연 20%)에서는 사다리 상한이 이미 더 촘촘하고, 가혹한 하락(연 30%)이나 긴 회수에서만 걸린다', () => {
  const st = (decline, recovery_days) => lendingEstimate({ fair_value: F, inputs: APT, annual_rate_bps: 800, ladder: LADDER60, model_version: 's',
    stress: { annual_decline_bps: decline, recovery_days, enforcement_cost_bps: 300 } });
  const none = lendingEstimate({ fair_value: F, inputs: APT, annual_rate_bps: 800, ladder: LADDER60, model_version: 's' });
  const mild = st(2000, 270);                                  // 연 20% 하락, 회수 270일 → 스트레스 상한 약 73% > 사다리 상한 약 68%
  assert.equal(mild.binding, 'ladder_cap'); assert.equal(mild.advance, none.advance); assert.ok(mild.stress_cap_bps > mild.advance_bps);
  const harsh = st(3000, 270);                                 // 연 30% 하락 → 스트레스 상한 약 65% < 사다리 상한
  assert.equal(harsh.binding, 'stress_cap'); assert.ok(harsh.advance < none.advance);
  const court = st(2000, 517);                                 // 회수가 법원 경매 경로(약 17개월)처럼 길면 20% 하락에서도 걸린다
  assert.equal(court.binding, 'stress_cap'); assert.ok(court.advance < none.advance);
  const fast = st(3000, 90);                                   // 같은 가혹한 하락이라도 회수가 빠르면 스트레스 상한이 풀린다
  assert.notEqual(fast.binding, 'stress_cap'); assert.ok(fast.advance > harsh.advance);
  assert.ok(harsh.reasons.some(x => x.includes('하락장 스트레스'))); assert.equal(none.stress_cap_bps, null);
  const gated = lendingEstimate({ fair_value: F, inputs: THIN, annual_rate_bps: 800, ladder: LADDER60, model_version: 's', stress: { annual_decline_bps: 2000, recovery_days: 270 } });
  assert.equal(gated.binding, 'confidence_gate'); assert.equal(gated.advance, 0);      // 차단은 스트레스 상한보다 강하다
});

test('속성(무작위 1000건) — 차단이 켜져 있어도 담보가치 ≤ 공정가치, 선지급 ≤ 담보가치, 차단된 건은 선지급 0', () => {
  let s = 8080; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < 1000; i++) {
    const fv = 1_000_000 + Math.floor(rnd() * 900_000_000);
    const inputs = { txn_12m: Math.floor(rnd() * 80), comps_count: Math.floor(rnd() * 40), comps_cv: rnd() < 0.2 ? null : rnd() * 0.4, months_stale: rnd() * 18 };
    const l = lendingEstimate({ fair_value: fv, inputs, annual_rate_bps: Math.floor(rnd() * 1500), ladder: rnd() < 0.5 ? LADDER60 : null,
      min_confidence: rnd(), stress: rnd() < 0.5 ? { annual_decline_bps: Math.floor(rnd() * 5000), recovery_days: Math.floor(rnd() * 500) } : null, model_version: 'p' });
    assert.ok(l.collateral_value <= fv && l.advance <= l.collateral_value);
    if (!l.gate.passed) assert.equal(l.advance, 0);
  }
});
