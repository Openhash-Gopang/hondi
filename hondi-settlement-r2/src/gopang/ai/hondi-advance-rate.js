/**
 * hondi-advance-rate.js — 위험 비례 선지급률 (2026-09-28 신설)
 *
 * 지시: 선지급률을 추정 난이도·위험도에 비례해 0%~90%로 차등한다. 거래가 활발한 아파트 단지는
 * 최대 90%, 거래가 거의 없는 지역의 단독주택은 10% 수준(주피터님, 2026-09-28).
 *
 * 선지급률 = min( 통계적 한도, 유동성 등급 정책 상한, 전체 상한 90% ), 100bp 단위 내림, 하한 0%.
 * 0%는 선지급 없이 1단계(시장 정산만)로 처리한다는 뜻이다 — settleAdvance(advance_bps:0)는
 * settleSale과 같은 결과를 낸다(테스트로 보장).
 *
 *  ① 통계적 한도(안전): 실현비율(실제 매각가/추정가)의 5% 하위 분위 q에서 역산한다
 *     (hondi-settlement.js maxAdvanceBps). q는 추정의 불확실성 σ에서 나온다:
 *        σ² = σ_pred² + σ_drift² + σ_model²
 *        σ_pred  = cv × √(1 + 1/n)   비교사례 n건·산포 cv로 "개별 물건 한 건"을 예측할 때의 오차
 *        σ_drift = 연변동성 × √(사례 경과기간 + 매각기간)   시세가 그 사이 움직일 위험
 *        σ_model = 조정·모형 오차
 *     q_이론 = 기대실현비율 × exp(−1.645 σ)  (로그정규 가정, 5% 분위)
 *     백테스트 실측 하위 5% 분위(empirical_ratio_p05)가 표본 30건 이상이면 min(q_이론, q_실측)을
 *     쓴다 — "이론이 과신했다면 실측이 낮춘다". 실측이 더 좋아 보여도 이론 한도를 넘겨 올리지는
 *     않는다(위로의 교정은 cv·연변동성 같은 입력을 데이터로 다시 맞추는 방식으로만).
 *  ② 정책 상한(거버넌스): 유동성 등급별 고정 상한. 통계가 아무리 좋아도 이 값을 넘지 않는다.
 *  ③ 거부 조건(0%): 소유권 미확정·선순위 권리 불명·법적 검토 고위험 쟁점, 또는 σ 과대.
 *
 * ★ 이 파일의 수치(등급 경계·상한·기대실현비율·매각기간·비용률·변동성·안전여유)는 전부 가정이며
 *   보정되지 않았다. 과거 사건 백테스트로 다시 맞춰야 한다. 정책 상한·전체 상한·거부 조건은
 *   돈의 한도를 정하는 상수라 자동 갱신 대상에서 제외하고 사람이 코드로만 바꾼다(무인 자율 체계의
 *   안전장치). medium/low 등급 값은 주피터님이 준 두 예시(high 90%, thin 10%) 사이의 내삽이라
 *   확인이 필요하다.
 */
import { maxAdvanceBps } from './hondi-settlement.js';

export const ADVANCE_CAP_BPS = 9000;
export const ADVANCE_FLOOR_BPS = 0;
export const ADVANCE_STEP_BPS = 100;
export const SAFETY_MARGIN_BPS = 300;      // σ 자체를 모르는 위험에 대한 여유
export const MIN_COMPS = 3;                 // 이보다 적은 사례면 산포(cv)를 믿지 않고 보수적 사전값을 쓴다
export const MIN_EMPIRICAL_N = 30;          // 실측 하위 분위를 신뢰하는 최소 표본
export const SIGMA_VETO = 0.8;              // σ가 이보다 크면 추정 자체가 무의미 → 0%
const Z95 = 1.6449;

/** min_txn_12m 내림차순 — liquidityTier가 첫 일치 등급을 고른다 */
export const LIQUIDITY_TIERS = [
  { tier: 'high',   min_txn_12m: 30, cap_bps: 9000, expected_ratio: 0.99, expected_days: 60,  selling_cost_bps: 300 },
  { tier: 'medium', min_txn_12m: 10, cap_bps: 6000, expected_ratio: 0.97, expected_days: 120, selling_cost_bps: 400 },
  { tier: 'low',    min_txn_12m: 3,  cap_bps: 3000, expected_ratio: 0.94, expected_days: 270, selling_cost_bps: 500 },
  { tier: 'thin',   min_txn_12m: 0,  cap_bps: 1000, expected_ratio: 0.90, expected_days: 540, selling_cost_bps: 700 },
];
export const VETO_FLAGS = ['unresolved_title', 'unknown_senior_claims', 'high_severity_legal_issue'];
const VETO_LABEL = {
  unresolved_title: '소유권 미확정(상속 미확정·소유권 다툼 등)',
  unknown_senior_claims: '선순위 권리·인수 부담 불명',
  high_severity_legal_issue: '법적 검토에서 고위험 쟁점 발견',
};

/** 같은 단지·동에서 최근 12개월 실거래 건수로 유동성 등급을 정한다(유형 라벨이 아니라 실측). */
export function liquidityTier(txn_12m) {
  if (!Number.isFinite(txn_12m) || txn_12m < 0) throw new RangeError(`txn_12m: 0 이상의 수여야 합니다 (받은 값: ${txn_12m})`);
  return LIQUIDITY_TIERS.find(t => txn_12m >= t.min_txn_12m);
}

export function estimateSigma({ comps_count, comps_cv = null, months_stale, days_to_sell, annual_vol = 0.06, model_sigma = 0.03, prior_cv = 0.25 }) {
  if (!Number.isSafeInteger(comps_count) || comps_count < 0) throw new RangeError('comps_count: 0 이상의 정수여야 합니다');
  if (comps_cv != null && !(Number.isFinite(comps_cv) && comps_cv >= 0)) throw new RangeError('comps_cv: 0 이상의 수 또는 null');
  for (const [k, v] of Object.entries({ months_stale, days_to_sell, annual_vol, model_sigma, prior_cv }))
    if (!Number.isFinite(v) || v < 0) throw new RangeError(`${k}: 0 이상의 수여야 합니다 (받은 값: ${v})`);
  const thin_data = comps_count < MIN_COMPS || comps_cv == null;
  const cv_used = thin_data ? Math.max(comps_cv ?? 0, prior_cv) : comps_cv;
  const sigma_pred = cv_used * Math.sqrt(1 + 1 / Math.max(comps_count, 1));
  const sigma_drift = annual_vol * Math.sqrt(months_stale / 12 + days_to_sell / 365);
  const sigma = Math.sqrt(sigma_pred ** 2 + sigma_drift ** 2 + model_sigma ** 2);
  return { sigma, sigma_pred, sigma_drift, sigma_model: model_sigma, cv_used, thin_data };
}

/**
 * @param {number} p.txn_12m       최근 12개월 동일 단지·동 실거래 건수(유동성 등급 결정)
 * @param {number} p.comps_count   실제로 쓴 비교사례 수
 * @param {number|null} p.comps_cv 조정 후 비교사례 가격의 변동계수(예: 0.05 = 5%). 모르면 null
 * @param {number} p.months_stale  비교사례의 평균 경과 개월
 * @param {number} p.annual_rate_bps 부과 자본비용 연이율(bp)
 * @param {object} [p.flags]       { unresolved_title, unknown_senior_claims, high_severity_legal_issue }
 * @param {number|null} [p.empirical_ratio_p05] 같은 세그먼트 백테스트의 (실제/추정) 하위 5% 분위
 * @param {number} [p.empirical_n] 그 표본 수
 */
export function computeAdvance({
  txn_12m, comps_count, comps_cv = null, months_stale = 0, annual_rate_bps, fee_bps = 0,
  flags = {}, empirical_ratio_p05 = null, empirical_n = 0,
  annual_vol, model_sigma, prior_cv, cap_bps = ADVANCE_CAP_BPS,
}) {
  const t = liquidityTier(txn_12m);
  const sg = estimateSigma({ comps_count, comps_cv, months_stale, days_to_sell: t.expected_days, annual_vol, model_sigma, prior_cv });
  const base = { tier: t.tier, policy_cap_bps: Math.min(t.cap_bps, cap_bps), sigma: sg.sigma, sigma_parts: sg };

  const vetoed = VETO_FLAGS.filter(f => flags[f]);
  if (vetoed.length || sg.sigma > SIGMA_VETO) {
    const reasons = vetoed.map(f => `거부: ${VETO_LABEL[f]}`);
    if (sg.sigma > SIGMA_VETO) reasons.push(`거부: 추정 불확실성 σ=${sg.sigma.toFixed(2)}가 한계 ${SIGMA_VETO}를 넘음`);
    return { ...base, advance_bps: 0, binding: 'veto', statistical_bps: 0, ratio_quantile_theory: null, ratio_quantile_used: null, reasons };
  }

  const q_theory = t.expected_ratio * Math.exp(-Z95 * sg.sigma);
  const useEmp = empirical_ratio_p05 != null && empirical_n >= MIN_EMPIRICAL_N;
  if (useEmp && !(empirical_ratio_p05 > 0 && empirical_ratio_p05 <= 2)) throw new RangeError('empirical_ratio_p05: 0 초과 2 이하여야 합니다');
  const q_used = useEmp ? Math.min(q_theory, empirical_ratio_p05) : q_theory;
  const statistical = maxAdvanceBps({ ratio_quantile: q_used, selling_cost_bps: t.selling_cost_bps, fee_bps, annual_rate_bps, days: t.expected_days }) - SAFETY_MARGIN_BPS;
  const statistical_bps = Math.max(0, statistical);

  const raw = Math.min(statistical_bps, base.policy_cap_bps);
  const advance_bps = Math.max(ADVANCE_FLOOR_BPS, Math.floor(raw / ADVANCE_STEP_BPS) * ADVANCE_STEP_BPS);
  const binding = statistical_bps <= base.policy_cap_bps
    ? (useEmp && q_used < q_theory ? 'empirical' : 'statistical') : 'policy_cap';

  const reasons = [
    `유동성 등급 ${t.tier}(최근 12개월 실거래 ${txn_12m}건) — 정책 상한 ${base.policy_cap_bps / 100}%`,
    `추정 불확실성 σ=${sg.sigma.toFixed(3)}${sg.thin_data ? ' (비교사례 부족 → 보수적 사전 산포 적용)' : ''}`,
    `하위 5% 실현비율 ${q_used.toFixed(3)}${binding === 'empirical' ? ' (백테스트 실측이 이론보다 낮아 실측 적용)' : ''} → 통계적 한도 ${statistical_bps / 100}%`,
    `최종 ${advance_bps / 100}% (제약: ${binding === 'policy_cap' ? '유동성 등급 정책 상한' : binding === 'empirical' ? '백테스트 실측' : '통계적 한도'})`,
  ];
  return { ...base, advance_bps, binding, statistical_bps, ratio_quantile_theory: q_theory, ratio_quantile_used: q_used, reasons };
}
