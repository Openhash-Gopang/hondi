/**
 * hondi-valuation-tracks.js — 추정의 두 트랙 분리: 시장 거래 중재 / 담보 대출 (2026-09-28 신설)
 *
 * 지시(주피터님, 2026-09-28): 중재 기능의 추정 가격은 합리성을, 대출 기능은 안전성(보수적 추정)을 우선한다.
 * 둘은 별도의 트랙으로 진행한다.
 *
 * 왜 하나의 추정으로 못 하는가 — 목표 함수가 다르다:
 *   중재(mediation): 시장에 공시하는 시작가. 편향 없는 공정가치(중앙 추정)가 목표다. 오차는 위·아래가 같은
 *     무게이고 체계적 편향(bias)이 0에 가까워야 한다. 보수적으로 낮게 공시하면 봉인 입찰 낙찰가(자기 입찰가)가
 *     함께 낮아져 당사자가 손해를 본다.
 *   대출(lending): 돈을 내주는 근거. 하방 분위(5%)의 순회수 가능 가치가 목표다. 오차가 비대칭이다 — 과소
 *     추정은 싸고 과대추정은 손실이다. 그러므로 체계적으로 낮아야 하고(음의 편향), 얼마나 자주 그 아래로
 *     떨어지는지(커버리지)로 평가한다.
 *
 * 분리의 세 겹(코드가 강제):
 *   ① 산출물 분리: 중재는 fair_value(+구간), 대출은 collateral_value·선지급액·LTV. 서로의 값을 입력으로 쓰지 않는다.
 *      대출은 공정가치를 "참조"만 하며 collateral_value ≤ fair_value가 항상 성립한다(대출이 공정가치를 올릴 수 없다).
 *   ② 입력 분리: 대출 트랙은 당사자가 제공한 서술·주장(party_notes 등)을 받지 않는다. 공식 출처 데이터만
 *      허용 목록으로 통과시키고 나머지는 버린 목록(dropped)과 함께 기록한다(입력 조작·담합 방지).
 *   ③ 평가 분리: 중재는 MdAPE·bias·PE20, 대출은 커버리지·부족 폭·보수성 비용·핀볼 손실로 채점한다.
 *      한 트랙의 좋은 점수가 다른 트랙의 점수를 대신하지 못한다.
 *
 * ★ 임계값(편향 허용 3%, 목표 커버리지 95%, 소표본 30건)은 가정이며 보정되지 않았다.
 */
import { computeAdvance, LIQUIDITY_TIERS } from './hondi-advance-rate.js';
import { transactionConfidence, gate, DEFAULT_MIN_CONFIDENCE } from './hondi-confidence-gate.js';
import { downturnCapBps } from './hondi-loss-defense.js';
import { advanceAmount } from './hondi-settlement.js';
import { evaluate, LOW_SAMPLE_N } from './hondi-valuation-metrics.js';

export const Z80 = 1.2816;   // 80% 구간(10~90%)의 z

const COMMON_INPUTS = ['txn_12m', 'comps_count', 'comps_cv', 'months_stale', 'region_code', 'property_type', 'official_price', 'registry_flags'];
export const ALLOWED_INPUTS = Object.freeze({
  mediation: Object.freeze([...COMMON_INPUTS, 'condition_notes', 'party_notes']),   // 중재는 물건 상태 등 당사자 제공 정보도 참고(합리성)
  lending: Object.freeze([...COMMON_INPUTS]),                                        // 대출은 공식 출처 데이터만
});
export const TRACKS = Object.freeze({
  mediation: Object.freeze({ objective: '합리성 — 편향 없는 공정가치(중앙 추정)', primary_metrics: ['mdape', 'bias', 'pe20'], loss: '대칭' }),
  lending: Object.freeze({ objective: '안전성 — 하방 분위 기반 보수적 담보가치', primary_metrics: ['coverage', 'shortfall_severity', 'conservatism_cost', 'pinball'], loss: '비대칭(과대추정이 손실)' }),
});

function posInt(name, v, min = 0) {
  if (!Number.isSafeInteger(v) || v < min) throw new RangeError(`${name}: ${min} 이상의 정수여야 합니다 (받은 값: ${v})`);
  return v;
}
const mulBpsFloor = (amount, b) => Number((BigInt(amount) * BigInt(b)) / 10000n);

/** 트랙별 허용 입력만 통과시킨다. 버려진 키는 dropped로 돌려준다(조용히 무시하지 않는다). */
export function sanitizeInputs(track, inputs = {}) {
  if (!ALLOWED_INPUTS[track]) throw new RangeError(`알 수 없는 트랙: ${track}`);
  const allow = new Set(ALLOWED_INPUTS[track]), clean = {}, dropped = [];
  for (const [k, v] of Object.entries(inputs)) (allow.has(k) ? (clean[k] = v) : dropped.push(k));
  return { clean, dropped };
}

/** 중재 트랙 산출물 — 공정가치는 입력 중앙 추정을 그대로 공시한다(보수 조정 없음). 구간은 참고용 투명성 정보. */
export function mediationEstimate({ point, sigma, model_version, basis = '' }) {
  posInt('point', point, 1);
  if (!Number.isFinite(sigma) || sigma < 0) throw new RangeError('sigma: 0 이상의 수여야 합니다');
  if (typeof model_version !== 'string' || !model_version) throw new RangeError('model_version이 필요합니다');
  return Object.freeze({
    track: 'mediation', model_version, fair_value: point,
    low_p10: Math.floor(point * Math.exp(-Z80 * sigma)), high_p90: Math.ceil(point * Math.exp(Z80 * sigma)), sigma, basis,
  });
}

/**
 * 대출 트랙 산출물 — 공정가치를 참조해 보수적 담보가치·선지급액·LTV를 낸다.
 * collateral_value = 하위 5% 시나리오에서 판매비용·자본비용을 뺀 순회수 가능 가치(공정가치 이하).
 * ltv_bps = 선지급액 / 담보가치. 안전 여유·정책 상한·사다리 상한만큼 항상 100% 아래다.
 *
 * 선지급 한도에 걸리는 제약(강한 순서): veto(소유권 미확정 등) → confidence_gate(거래 확신도 미달, 주피터님 2026-09-28)
 *   → stress_cap(하락장 스트레스, 선택) → 통계·정책·사다리 상한. 확신도 미달이면 선지급은 0이지만 담보가치는
 *   정보로 남기고, 시장 거래 중재(중재 트랙)는 영향받지 않는다.
 * window_days = 허용 매각 기간: ladder에 round_interval_days가 있으면 max_round × 간격, 없으면 등급의 기본 예상 일수.
 * stress: { annual_decline_bps, recovery_days, enforcement_cost_bps?, margin_bps? } — 주면 종결 경로 하락장 상한을 건다.
 */
export function lendingEstimate({
  fair_value, inputs, annual_rate_bps, fee_bps = 0, ladder = null, cap_bps, empirical_ratio_p05 = null, empirical_n = 0,
  min_confidence = DEFAULT_MIN_CONFIDENCE, stress = null, model_version,
}) {
  posInt('fair_value', fair_value, 1);
  if (typeof model_version !== 'string' || !model_version) throw new RangeError('model_version이 필요합니다');
  const { clean, dropped } = sanitizeInputs('lending', inputs);
  const r = computeAdvance({
    txn_12m: clean.txn_12m, comps_count: clean.comps_count, comps_cv: clean.comps_cv ?? null, months_stale: clean.months_stale ?? 0,
    annual_rate_bps, fee_bps, flags: clean.registry_flags ?? {}, empirical_ratio_p05, empirical_n,
    ...(cap_bps != null ? { cap_bps } : {}),
    ladder: ladder ? { ...ladder, start_price: fair_value } : null,
  });
  const tierRow = LIQUIDITY_TIERS.find(t => t.tier === r.tier);
  const window_days = ladder?.round_interval_days ? ladder.max_round * ladder.round_interval_days : tierRow.expected_days;
  const confidence = transactionConfidence({ txn_12m: clean.txn_12m, sigma: r.sigma, window_days, flags: clean.registry_flags ?? {} });
  const g = gate(confidence, min_confidence);

  let advance_bps = r.advance_bps, binding = r.binding, stress_cap_bps = null;
  const reasons = [...r.reasons];
  if (stress) {
    stress_cap_bps = downturnCapBps({
      annual_decline_bps: stress.annual_decline_bps, days_outstanding: window_days + stress.recovery_days, annual_rate_bps,
      enforcement_cost_bps: stress.enforcement_cost_bps ?? 0, margin_bps: stress.margin_bps ?? 0,
    });
    const capped = Math.floor(stress_cap_bps / 100) * 100;
    reasons.push(`하락장 스트레스 상한 ${stress_cap_bps / 100}% (연 ${stress.annual_decline_bps / 100}% 하락, 사건 ${window_days}일 + 회수 ${stress.recovery_days}일)`);
    if (capped < advance_bps) { advance_bps = capped; binding = 'stress_cap'; }
  }
  if (r.binding !== 'veto') {
    reasons.push(`거래 확신도 ${confidence.score10}/10 (제약 요인: ${confidence.limiting}) — 차단 기준 ${g.threshold * 10}/10 ${g.passed ? '통과' : '미달 → 선지급 차단'}`);
    if (!g.passed) { advance_bps = 0; binding = 'confidence_gate'; }
  }

  const collateral_value = mulBpsFloor(fair_value, r.collateral_bps);
  const advance = advanceAmount({ estimated_price: fair_value, advance_bps });
  if (collateral_value > fair_value) throw new Error('불변식 위반: 담보가치가 공정가치를 넘었습니다');
  if (advance > collateral_value) throw new Error('불변식 위반: 선지급액이 담보가치를 넘었습니다');
  const ltv_bps = collateral_value > 0 ? Number((BigInt(advance) * 10000n) / BigInt(collateral_value)) : 0;
  return Object.freeze({
    track: 'lending', model_version, fair_value_ref: fair_value, collateral_value, advance_bps, advance, ltv_bps,
    binding, tier: r.tier, ratio_quantile_used: r.ratio_quantile_used, dropped_inputs: dropped, reasons,
    confidence, gate: g, stress_cap_bps, window_days,
  });
}

/** 두 산출물이 분리 규칙을 지키는지 검사한다(호출 측 방어용). */
export function assertSeparation(mediation, lending) {
  if (mediation.track !== 'mediation' || lending.track !== 'lending') throw new Error('트랙 표식이 맞지 않습니다');
  if (lending.fair_value_ref !== mediation.fair_value) throw new Error('대출 트랙이 다른 공정가치를 참조했습니다');
  if (lending.collateral_value > mediation.fair_value) throw new Error('담보가치가 공정가치를 넘었습니다');
  return true;
}

// ───────────────────────────── 트랙별 채점 ─────────────────────────────

/** 중재 트랙 채점: 편향 없는 정확도. records: { fair_value, realized_price|null }. */
export function evaluateMediationTrack(records, { bias_tolerance = 0.03 } = {}) {
  const m = evaluate(records.map(r => ({ estimated_price: r.fair_value, realized_price: r.realized_price ?? null })));
  const verdict = m.n_used === 0 ? 'no_data' : m.low_sample ? 'low_sample' : Math.abs(m.bias_median) > bias_tolerance ? 'biased' : 'ok';   // 중앙값 편향으로 판정(극단값에 강함)
  return { ...m, bias_tolerance, verdict };
}

/** 이항 비율의 Wilson 95% 신뢰구간 */
export function wilson95(k, n) {
  if (n === 0) return { low: 0, high: 1 };
  const z = 1.959964, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return { low: (c - h) / d, high: (c + h) / d };
}

/** 핀볼(분위) 손실 — 하위 tau 분위 추정의 표준 채점. 값이 작을수록 좋다. */
export function pinballLoss(pairs, tau) {
  if (!pairs.length) return null;
  return pairs.reduce((s, { q, y }) => s + (y >= q ? tau * (y - q) : (1 - tau) * (q - y)) / y, 0) / pairs.length;
}

/**
 * 대출 트랙 채점: 안전성. records: { collateral_value, realized_net|null, unsold?:boolean }.
 *   realized_net = 실제 매각가에서 판매비용·자본비용을 반영한 순회수(collateral_value와 같은 기준의 값).
 *   collateral_value = 0(대출 안 함)은 채점에서 제외. unsold(미매각 종결)는 "회수 실패"로 센다.
 */
export function evaluateLendingTrack(records, { target_coverage = 0.95 } = {}) {
  const lent = records.filter(r => r.collateral_value > 0);
  const realized = lent.filter(r => r.realized_net != null && !r.unsold);
  const unsold = lent.filter(r => r.unsold).length;
  const covered = realized.filter(r => r.realized_net >= r.collateral_value);
  const violations = realized.filter(r => r.realized_net < r.collateral_value);
  const n = realized.length + unsold;
  const base = { n_lent: lent.length, n_realized: realized.length, n_unsold: unsold, target_coverage, low_sample: n < LOW_SAMPLE_N };
  if (!n) return { ...base, coverage_realized: null, coverage_incl_unsold: null, wilson95: null, shortfall_severity: null, worst_shortfall: null, conservatism_cost: null, pinball: null, verdict: 'no_data' };
  const cov = covered.length / n;
  const sf = violations.map(r => (r.collateral_value - r.realized_net) / r.collateral_value);
  // 판정: 95% 분위로 정확히 보정된 모델도 표본 잡음으로 커버리지가 95%를 조금 밑돌 수 있다. 그래서 점추정이 아니라
  // "목표와 통계적으로 양립하는가"를 본다 — Wilson 상한이 목표 이상이면 ok, 상한마저 목표 미만이면(유의하게 미달) fail.
  const wl = wilson95(covered.length, n);
  const verdict = base.low_sample ? 'low_sample' : (cov >= target_coverage || wl.high >= target_coverage) ? 'ok' : 'fail';
  return {
    ...base,
    coverage_realized: realized.length ? covered.length / realized.length : null,
    coverage_incl_unsold: cov, wilson95: wl,
    shortfall_severity: sf.length ? sf.reduce((a, b) => a + b, 0) / sf.length : 0, worst_shortfall: sf.length ? Math.max(...sf) : 0,
    conservatism_cost: covered.length ? covered.reduce((s, r) => s + (r.realized_net - r.collateral_value) / r.realized_net, 0) / covered.length : null,
    pinball: pinballLoss(realized.map(r => ({ q: r.collateral_value, y: r.realized_net })), 1 - target_coverage),
    verdict,
  };
}

/** 두 트랙의 간격(보수성): 1 − 담보가치/공정가치의 중앙값. 너무 작으면 위험, 너무 크면 대출이 쓸모없다. */
export function trackSpread(pairs) {
  const xs = pairs.filter(p => p.fair_value > 0).map(p => 1 - p.collateral_value / p.fair_value).sort((a, b) => a - b);
  if (!xs.length) return null;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}
