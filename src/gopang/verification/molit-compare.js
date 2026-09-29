/**
 * verification/molit-compare.js — 혼디 추정치 vs 실거래가 대조
 *
 * ★ 2026-09-29 신설. hondi-staged-valuation.js의 stagedValuation() 출력
 * (fair_value, sigma_total)을 molit-client.js가 가져온 실거래 comps와
 * 대조해 편차를 계산한다.
 *
 * ★ 이것은 verification-protocol.md의 정식 표본 밖 백테스트(실제 정산
 * 완료 사건 — 추정가·실제 매각가 쌍 — 필요)를 대체하지 않는다. 그
 * 문서에 명시된 대로 이 저장소에는 아직 그런 정산 사건 데이터가 없다.
 * 지금 시점에 할 수 있는 것은 "시장에 나온 비교사례와 우리 추정치가
 * 그럴듯한 범위에 있는가"를 보는 즉시 대조 점검(sanity check)뿐이며,
 * 이 모듈은 그 점검 전용이다. hondi-valuation-metrics.js의 채점 기준을
 * 대체하지 않는다.
 */

export const DEAL_AMOUNT_FIELD = '거래금액'; // 만원 단위, 쉼표/공백 포함 문자열로 옴

/** MOLIT 응답의 "거래금액" 필드(예: " 50,000")를 원 단위 숫자로 변환. */
export function parseDealAmount(raw) {
  if (raw == null) return null;
  const n = Number(String(raw).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n * 10000 : null; // 만원 → 원
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function stdev(nums) {
  if (nums.length < 2) return 0;
  const m = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((a, b) => a + (b - m) ** 2, 0) / (nums.length - 1);
  return Math.sqrt(variance);
}

/**
 * compareToComps
 * @param {object} args
 * @param {number} args.fairValue - stagedValuation()의 fair_value
 * @param {number|null} [args.sigmaTotal] - stagedValuation()의 sigma_total(비율, 예: 0.08).
 *   있으면 허용범위 산정 기준으로 쓴다. 없으면 comps 자체의 표준편차를 쓴다.
 *   둘 다 없거나 계산 불가하면 판정을 내리지 않는다(임의 상수로 대체하지 않음).
 * @param {Array<object>} args.items - fetchTrades()가 반환한 items(MOLIT raw record)
 * @param {number} [args.toleranceSigma=2] - 몇 시그마 밖이면 '이탈'로 표시할지
 */
export function compareToComps({ fairValue, sigmaTotal = null, items, toleranceSigma = 2 }) {
  if (typeof fairValue !== 'number' || !Number.isFinite(fairValue)) {
    throw new Error('[MOLIT] fairValue가 유효한 숫자가 아닙니다.');
  }
  const amounts = (items || [])
    .map((it) => parseDealAmount(it[DEAL_AMOUNT_FIELD]))
    .filter((v) => v != null);

  if (amounts.length === 0) {
    return {
      matched: false,
      comp_count: 0,
      reason: '대조 가능한 실거래 comps 없음(같은 법정동코드·계약년월 조회 결과 0건)',
    };
  }

  const med = median(amounts);
  const sd = stdev(amounts);
  const deviationPct = ((fairValue - med) / med) * 100;

  const toleranceBasis = sigmaTotal != null ? fairValue * sigmaTotal : sd;
  const withinTolerance =
    toleranceBasis > 0 ? Math.abs(fairValue - med) <= toleranceSigma * toleranceBasis : null;

  return {
    matched: true,
    comp_count: amounts.length,
    comp_median: med,
    comp_stdev: sd,
    comp_min: Math.min(...amounts),
    comp_max: Math.max(...amounts),
    fair_value: fairValue,
    deviation_pct: deviationPct,
    tolerance_basis: sigmaTotal != null ? 'sigma_total' : 'comp_stdev',
    within_tolerance: withinTolerance,
  };
}
