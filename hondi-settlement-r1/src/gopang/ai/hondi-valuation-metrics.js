/**
 * hondi-valuation-metrics.js — 추정가 정확도 평가 (2026-09-28 신설)
 *
 * 목적: 시스템이 낸 추정가와 실제 매각가를 대조해 "추정을 얼마나 정확히 하는가"를 재고,
 * 오차의 원인을 유형·지역·원인 태그별로 쪼개 SP를 갱신할 근거를 만든다.
 *
 * 지표(부동산 자동평가 업계 관행):
 *   - APE = |추정 − 실제| / 실제, MdAPE = APE 중앙값(이상치에 강함), MAPE = 평균
 *   - bias = 평균((추정 − 실제) / 실제): +면 체계적 과대평가
 *   - PE10/PE20 = APE가 10%/20% 이내인 비율. 단, 이진 지표라 10.1% 빗나감과 30% 빗나감을 같게
 *     세므로 MdAPE·bias·하방 분위와 반드시 함께 본다.
 *   - ratio 분위수 = 실제/추정. 하위 분위(p05·p10)가 선지급률을 정하는 핵심 입력이다
 *     (hondi-settlement.js의 maxAdvanceBps) — 평균 오차가 아니라 하방 꼬리가 위험이기 때문.
 *
 * ★ 검열(censoring) 주의: 실제 매각가는 "매각된 사건"에만 존재한다. 취하·정지·미매각 건은 정답이
 *   없어 표본에서 빠지므로, 결과가 좋아 보이는 방향의 선택 편향이 생길 수 있다. 제외 건수를
 *   n_unrealized로 항상 함께 돌려주어 해석하는 사람이 알 수 있게 한다.
 *
 * 입력 레코드: { estimated_price, realized_price|null, baseline_price?, property_type?, region?,
 *               cause_tags?: string[] }  — 금액은 원 단위 양수.
 */

export const LOW_SAMPLE_N = 30;   // 이보다 적은 그룹은 low_sample 표시 — 통계적 결론을 내리지 말 것

/** 정렬된 배열의 p분위(0~1), 선형보간 */
export function quantile(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const asc = (a, b) => a - b;

export function evaluate(records) {
  let n_unrealized = 0, n_invalid = 0;
  const ape = [], pe = [], ratio = [];
  for (const r of records) {
    const e = r.estimated_price, a = r.realized_price;
    if (a == null) { n_unrealized++; continue; }
    if (!(Number.isFinite(e) && e > 0) || !(Number.isFinite(a) && a > 0)) { n_invalid++; continue; }
    ape.push(Math.abs(e - a) / a); pe.push((e - a) / a); ratio.push(a / e);
  }
  const n = ape.length;
  const base = { n_total: records.length, n_used: n, n_unrealized, n_invalid, low_sample: n < LOW_SAMPLE_N };
  if (!n) return { ...base, mdape: null, mape: null, bias: null, pe10: null, pe20: null, ratio: null };
  const apeS = [...ape].sort(asc), ratioS = [...ratio].sort(asc);
  return {
    ...base,
    mdape: quantile(apeS, 0.5), mape: mean(ape), bias: mean(pe),
    pe10: ape.filter(x => x <= 0.10).length / n, pe20: ape.filter(x => x <= 0.20).length / n,
    ratio: { p05: quantile(ratioS, 0.05), p10: quantile(ratioS, 0.10), p50: quantile(ratioS, 0.5), p90: quantile(ratioS, 0.9), p95: quantile(ratioS, 0.95) },
  };
}

/** keyFn(record) 값별로 나누어 각각 평가. 키가 없으면 '(미분류)'. */
export function evaluateBy(records, keyFn) {
  const groups = new Map();
  for (const r of records) {
    const k = keyFn(r) ?? '(미분류)';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return Object.fromEntries([...groups].map(([k, rs]) => [k, evaluate(rs)]));
}

/** 오차 원인 태그(cause_tags)별 평가 — 한 건이 여러 태그에 동시에 속할 수 있다. 태그 없으면 '(원인 미분석)'. */
export function evaluateByTag(records) {
  const groups = new Map();
  for (const r of records) {
    const tags = r.cause_tags?.length ? r.cause_tags : ['(원인 미분석)'];
    for (const t of tags) { if (!groups.has(t)) groups.set(t, []); groups.get(t).push(r); }
  }
  return Object.fromEntries([...groups].map(([t, rs]) => [t, evaluate(rs)]));
}

/**
 * 단순 기준선(baseline_price, 예: 감정가 × 지역 최근 낙찰가율 중앙값)과 비교.
 * 모델이 기준선을 이기지 못하면 정교함은 비용일 뿐이다 — 같은 표본(둘 다 값이 있는 건)에서 비교한다.
 */
export function compareToBaseline(records) {
  const common = records.filter(r => r.baseline_price > 0);
  const model = evaluate(common);
  const baseline = evaluate(common.map(r => ({ ...r, estimated_price: r.baseline_price })));
  return {
    n_common: common.length, model, baseline,
    beats_baseline: model.mdape != null && baseline.mdape != null ? model.mdape < baseline.mdape : null,
  };
}
