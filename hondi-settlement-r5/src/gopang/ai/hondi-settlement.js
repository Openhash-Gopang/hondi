/**
 * hondi-settlement.js — 합의매각 정산 엔진 (2026-09-28 신설)
 *
 * 두 정산 방식을 순수 함수로 구현한다(입출력 모두 정수 원, 부수효과 없음 → 어디서나 재현 가능).
 *
 *   1단계 settleSale     — 시스템은 추정가를 공시하고 시장 거래만 중재한다. 실제 매각대금으로
 *                          판매비용 → 수수료 → 채권자 → 채무자 순으로 정산한다. 자금 위험 없음.
 *   2단계 settleAdvance  — (시행 시점: 시스템 가동 약 1년 후, 주피터님 지시 2026-09-28)
 *                          추정가의 일정 비율을 먼저 지급하고, 실제 매각 후 원금+자본비용을
 *                          최우선 회수한 뒤 잔액을 정산한다. 실현가가 부족하면 그 손실은 선지급
 *                          자금 제공자가 진다(무소구 — 당사자에게 추가 청구하지 않는다).
 *                          ★ 이 파일은 계산만 한다. 어떤 엔드포인트에도 연결하지 않았고, 실제
 *                          선지급 자금 흐름은 아직 없다(시뮬레이션·백테스트 전용).
 *
 * 돈 계산 규칙(항상 지킨다):
 *   - 금액은 0 이상의 안전한 정수(원)만 받는다. 소수·음수·문자열은 RangeError.
 *   - 비율(bp) 곱셈은 BigInt로 계산해 내림(floor) — 1e12원 규모에서도 부동소수 오차가 없다.
 *   - 자본비용(carry)만 올림(ceil) — 자금 제공자에게 불리하게 깎이지 않도록.
 *   - 모든 결과에 balanced(현금 보존) 검사를 담는다: 어떤 입력에서도 돈이 새거나 생기지 않는다.
 *
 * 정산 순서(폭포수)와 그 근거는 가정이며 주피터님의 확정이 필요하다:
 *   2단계에서 선지급 원금+자본비용은 채권자의 잔여 청구권보다 선순위다(자금 출처이므로).
 */

export const SETTLEMENT_VERSION = 1;

const BPS = 10000;
const DAYS_PER_YEAR = 365;
export const MAX_FEE_BPS = 1000;          // 수수료 상한 10% — 오설정 방지 안전장치
export const MAX_DAYS = 3650;

function money(name, v) {
  if (!Number.isSafeInteger(v) || v < 0) throw new RangeError(`${name}: 0 이상의 정수(원)여야 합니다 (받은 값: ${v})`);
  return v;
}
function bps(name, v, max = BPS) {
  if (!Number.isSafeInteger(v) || v < 0 || v > max) throw new RangeError(`${name}: 0~${max} 범위의 정수(bp)여야 합니다 (받은 값: ${v})`);
  return v;
}
/** floor(amount × b / 10000) — BigInt로 정밀 계산 */
function mulBps(amount, b) { return Number((BigInt(amount) * BigInt(b)) / BigInt(BPS)); }
function ceilDiv(n, d) { return (n + d - 1n) / d; }

/** 판매비용 → 수수료 → 순매각대금. 판매비용이 매각가를 넘으면 초과분은 uncovered_costs로 남긴다. */
function netProceeds(sale_price, selling_costs, fee_bps) {
  const costs_paid = Math.min(selling_costs, sale_price);
  const uncovered_costs = selling_costs - costs_paid;
  const after_costs = sale_price - costs_paid;
  const fee = mulBps(after_costs, fee_bps);          // 수수료는 판매비용 차감 후 금액 기준
  return { costs_paid, uncovered_costs, fee, net: after_costs - fee };
}

/**
 * 1단계 — 시장 매각대금 정산 (자금 위험 없음)
 * @param {object} p
 * @param {number} p.sale_price      실제 시장 매각가(원)
 * @param {number} [p.selling_costs] 실제 판매비용(중개보수·등기비용 등 실비, 원)
 * @param {number} [p.fee_bps]       시스템 수수료(bp, 판매비용 차감 후 금액 기준)
 * @param {number} p.creditor_claim  채권자 정산 청구액(원)
 * @param {number} [p.estimated_price] 공시했던 추정가 — 주어지면 realization_ratio를 계산(정확도 평가용)
 */
export function settleSale({ sale_price, selling_costs = 0, fee_bps = 0, creditor_claim, estimated_price = null }) {
  money('sale_price', sale_price); money('selling_costs', selling_costs);
  bps('fee_bps', fee_bps, MAX_FEE_BPS); money('creditor_claim', creditor_claim);
  const { costs_paid, uncovered_costs, fee, net } = netProceeds(sale_price, selling_costs, fee_bps);

  const creditor_paid = Math.min(net, creditor_claim);
  const debtor_proceeds = net - creditor_paid;
  const creditor_shortfall = creditor_claim - creditor_paid;      // 남은 채권(정산 후에도 못 받은 몫)

  return {
    version: SETTLEMENT_VERSION, mode: 'sale',
    sale_price, costs_paid, uncovered_costs, fee, net_proceeds: net,
    creditor_paid, creditor_shortfall, debtor_proceeds,
    realization_ratio: estimated_price > 0 ? sale_price / estimated_price : null,
    balanced: costs_paid + fee + creditor_paid + debtor_proceeds === sale_price,
  };
}

/** 선지급액 = floor(추정가 × 선지급률). */
export function advanceAmount({ estimated_price, advance_bps }) {
  money('estimated_price', estimated_price); bps('advance_bps', advance_bps);
  return mulBps(estimated_price, advance_bps);
}

/** 자본비용 = ceil(선지급액 × 연이율 × 일수 / 365) — 단리, 올림(자금 제공자에게 불리하게 깎이지 않도록). */
export function carryAmount({ advance, annual_rate_bps, days }) {
  money('advance', advance); bps('annual_rate_bps', annual_rate_bps, 10000);
  if (!Number.isSafeInteger(days) || days < 0 || days > MAX_DAYS) throw new RangeError(`days: 0~${MAX_DAYS} 정수여야 합니다 (받은 값: ${days})`);
  return Number(ceilDiv(BigInt(advance) * BigInt(annual_rate_bps) * BigInt(days), BigInt(BPS * DAYS_PER_YEAR)));
}

/**
 * 미매각 종결 정산 — 허용한 최심 시점까지 매각되지 않아 사건이 종결된 경우(주피터님 결정 2026-09-28).
 * 선지급은 이미 당사자에게 지급되었고 무소구라 당사자에게 되돌려 받지 않는다. 시스템에는 원금+자본비용이
 * 남으며, 종결 후 회수액(recovery: 담보권 실행·재매각 등으로 실제 회수한 금액, 없으면 0)으로 메운다.
 * 회수액이 원금+자본비용을 넘으면 초과분은 당사자 몫(surplus_to_parties)이다.
 * ★ 종결 후 회수는 시스템이 선지급과 함께 채권자의 담보권을 넘겨받는(대위) 등 집행 가능한 청구권을
 *   갖는다는 가정에 기댄다. 그 가정이 없으면 recovery는 0이고 손실은 원금 전액이다(법·제도 검토 보류 중).
 */
export function settleTermination({ advance, annual_rate_bps, days, recovery = 0 }) {
  money('recovery', recovery);
  const carry = carryAmount({ advance, annual_rate_bps, days });
  const owed = advance + carry;
  const recovered = Math.min(recovery, owed);
  return {
    version: SETTLEMENT_VERSION, mode: 'termination',
    advance, carry, owed_to_system: owed, recovered,
    system_shortfall: owed - recovered, system_net: recovered - advance, surplus_to_parties: recovery - recovered,
    balanced: recovered + (owed - recovered) === owed,
  };
}

/**
 * 2단계 — 선지급 후 정산 (계산 전용, 미시행)
 * 선지급 시점: 선지급액을 채권자 청구액 한도로 먼저 채권자에게, 남으면 채무자에게 지급.
 * 정산 시점 폭포수: (1) 판매비용 (2) 수수료 (3) 선지급 원금+자본비용(시스템 회수)
 *                   (4) 채권자 잔여 청구 (5) 채무자 잔액. 부족분은 위에서부터 채워지고
 *                   나머지는 0이 된다 — 채권자·채무자에게 되돌려 받지 않는다(무소구).
 * @param {number} p.advance_bps     선지급률(bp, 기본 5000=50%)
 * @param {number} p.annual_rate_bps 자본비용 연이율(bp) — 단리, 실제일수/365
 * @param {number} p.days            선지급 후 정산까지 경과 일수
 */
export function settleAdvance({
  estimated_price, advance_bps = 5000, creditor_claim, sale_price, selling_costs = 0, fee_bps = 0,
  annual_rate_bps, days,
}) {
  money('estimated_price', estimated_price); bps('advance_bps', advance_bps);
  money('creditor_claim', creditor_claim); money('sale_price', sale_price); money('selling_costs', selling_costs);
  bps('fee_bps', fee_bps, MAX_FEE_BPS); bps('annual_rate_bps', annual_rate_bps, 10000);
  if (!Number.isSafeInteger(days) || days < 0 || days > MAX_DAYS) throw new RangeError(`days: 0~${MAX_DAYS} 정수여야 합니다 (받은 값: ${days})`);

  const advance = mulBps(estimated_price, advance_bps);
  const creditor_advance = Math.min(advance, creditor_claim);
  const debtor_advance = advance - creditor_advance;
  const carry = carryAmount({ advance, annual_rate_bps, days });

  const { costs_paid, uncovered_costs, fee, net } = netProceeds(sale_price, selling_costs, fee_bps);
  const owed_to_system = advance + carry;
  const system_recovery = Math.min(net, owed_to_system);
  const system_shortfall = owed_to_system - system_recovery;      // 원금+자본비용 중 회수 못한 몫
  const system_net = system_recovery - advance;                   // 음수 = 원금 손실, 양수 = 이자 수익

  const remaining = net - system_recovery;
  const creditor_final = Math.min(remaining, creditor_claim - creditor_advance);
  const debtor_final = remaining - creditor_final;

  return {
    version: SETTLEMENT_VERSION, mode: 'advance',
    advance, carry, creditor_advance, debtor_advance,
    sale_price, costs_paid, uncovered_costs, fee, net_proceeds: net,
    system_recovery, system_shortfall, system_net,
    creditor_final, debtor_final,
    creditor_total: creditor_advance + creditor_final,
    debtor_total: debtor_advance + debtor_final,
    creditor_shortfall: creditor_claim - (creditor_advance + creditor_final),
    balanced: (creditor_advance + creditor_final) + (debtor_advance + debtor_final) + system_net + costs_paid + fee === sale_price,
  };
}

/** 선지급 자금 제공자의 연환산 수익률(단리 근사): 손실이면 음수. */
export function annualizedReturn({ advance, system_net, days }) {
  if (!(advance > 0) || !(days > 0)) return 0;
  return (system_net / advance) * (DAYS_PER_YEAR / days);
}

/**
 * 선지급률 역산 — "실현가가 하위 분위 수준으로 떨어져도 원금+자본비용을 회수"하도록
 * 선지급률 상한(bp)을 구한다. 평균 오차가 아니라 하방 꼬리로 정하기 위한 함수.
 * @param {number} p.ratio_quantile  (실현 매각가 / 추정가)의 하위 분위 값(예: 5% 분위가 0.6)
 * @param {number} [p.selling_cost_bps] 판매비용률(bp, 매각가 대비 근사)
 */
export function maxAdvanceBps({ ratio_quantile, selling_cost_bps = 0, fee_bps = 0, annual_rate_bps, days }) {
  if (!(ratio_quantile > 0 && ratio_quantile <= 2)) throw new RangeError('ratio_quantile: 0 초과 2 이하여야 합니다');
  bps('selling_cost_bps', selling_cost_bps); bps('fee_bps', fee_bps, MAX_FEE_BPS); bps('annual_rate_bps', annual_rate_bps, 10000);
  if (!Number.isSafeInteger(days) || days < 0 || days > MAX_DAYS) throw new RangeError('days 범위 오류');
  const netFactor = ratio_quantile * (1 - selling_cost_bps / BPS) * (1 - fee_bps / BPS);
  const carryFactor = 1 + (annual_rate_bps / BPS) * (days / DAYS_PER_YEAR);
  return Math.max(0, Math.min(BPS, Math.floor((netFactor / carryFactor) * BPS)));
}
