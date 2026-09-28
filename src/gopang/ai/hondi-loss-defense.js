/**
 * hondi-loss-defense.js — 시스템 손실 방어책 (2026-09-28 신설)
 *
 * 배경: 미매각 종결을 택하면(주피터님, 2026-09-28) 가격 위험은 사다리 바닥에서 차단되지만 세 가지가 남는다.
 *   ① 종결 시점에 선지급 원금+자본비용이 회수되지 않은 채 남는다 → terminationExposure, allocateLoss
 *   ② 종결 뒤 회수까지의 시간·비용                                → terminationExposure (회수 기간·집행 비용 반영)
 *   ③ 종결이 한꺼번에 몰리는 상관 위험(하락장·특정 지역)            → terminationThrottle, poolThrottle, checkConcentration
 *
 * 설계 원칙(무인 자율 체계의 안전장치 — hondi-advance-rate.js와 같은 원칙):
 *   - 방어책은 선지급을 "줄이는" 방향으로만 자동 작동한다. 이 파일의 승수(multiplier)는 항상 0~1이라
 *     기본 선지급률을 절대 늘리지 못한다. 완화(상향)는 사람이 상수를 바꿀 때만 가능하다.
 *   - 소표본에 과민 반응하지 않도록 사전 종결률에 가중치를 둔 평활 추정(smoothing)을 쓴다.
 *   - 종결 통계는 "지연 지표"다(종결이 확정되기까지 사건 수명만큼 걸린다). 하락장 초기에는 그 사이에도
 *     선지급이 계속 나가므로, 가능하면 더 빠른 지표(유찰 창 비율·입찰자 수 감소)를 같은 함수에 넣어 쓴다.
 * ★ 임계값·기본값은 가정이며 미보정이다. 종결 확률·회수율은 그림자 운영 데이터로 측정해 채워야 한다.
 */
import { carryAmount } from './hondi-settlement.js';

const BPS = 10000;
function money(name, v) {
  if (!Number.isSafeInteger(v) || v < 0) throw new RangeError(`${name}: 0 이상의 정수(원)여야 합니다 (받은 값: ${v})`);
  return v;
}
function bpsRange(name, v, max = BPS) {
  if (!Number.isSafeInteger(v) || v < 0 || v > max) throw new RangeError(`${name}: 0~${max} 범위의 정수(bp)여야 합니다 (받은 값: ${v})`);
  return v;
}
const mulBpsCeil = (amount, b) => Number((BigInt(amount) * BigInt(b) + BigInt(BPS) - 1n) / BigInt(BPS));
const mulBpsFloor = (amount, b) => Number((BigInt(amount) * BigInt(b)) / BigInt(BPS));

/**
 * 종결 시 시스템이 질 수 있는 노출액(회수 기간 동안의 자본비용 + 집행 비용 + 담보 미회수 원금 + 여유).
 * principal_coverage_bps: 선지급 원금 중 담보(바닥가 이상의 가치)로 덮인다고 보는 비율. 선지급률 상한이
 *   바닥가 기준이므로 담보를 넘겨받는 구조라면 10000(전액)에 가깝고, 담보가 없으면 0이다.
 * days_outstanding: 선지급일부터 종결·회수 완료까지의 총 일수(사건 수명 + 종결 후 회수 기간).
 */
export function terminationExposure({ advance, annual_rate_bps, days_outstanding, enforcement_cost_bps = 0, principal_coverage_bps = BPS, margin_bps = 0 }) {
  money('advance', advance); bpsRange('enforcement_cost_bps', enforcement_cost_bps); bpsRange('principal_coverage_bps', principal_coverage_bps); bpsRange('margin_bps', margin_bps);
  const carry = carryAmount({ advance, annual_rate_bps, days: days_outstanding });
  const enforcement_cost = mulBpsCeil(advance, enforcement_cost_bps);
  const principal_at_risk = advance - mulBpsFloor(advance, principal_coverage_bps);
  const margin = mulBpsCeil(advance, margin_bps);
  return { carry, enforcement_cost, principal_at_risk, margin, exposure: carry + enforcement_cost + principal_at_risk + margin };
}

/**
 * 손실 폭포수 — 손실을 첫 손실 층부터 차례로 흡수시킨다. layers: [{ name, capacity }] (capacity는 0 이상의 정수
 * 또는 Infinity=최후 층). 합계 보존: 배분 합 + uncovered = loss, 각 층 배분 ≤ capacity.
 * 예: [{case_reserve}, {pool}, {junior_capital}, {senior_capital}] — 손실이 모든 층을 넘으면 uncovered가 남는다.
 */
export function allocateLoss(loss, layers) {
  money('loss', loss);
  if (!Array.isArray(layers) || !layers.length) throw new RangeError('layers: 한 개 이상의 층이 필요합니다');
  const names = new Set();
  let remaining = loss; const allocation = [];
  for (const l of layers) {
    if (typeof l?.name !== 'string' || !l.name || names.has(l.name)) throw new RangeError('층 이름은 비어 있지 않고 서로 달라야 합니다');
    names.add(l.name);
    if (!(l.capacity === Infinity || (Number.isSafeInteger(l.capacity) && l.capacity >= 0))) throw new RangeError(`capacity(${l.name}): 0 이상의 정수 또는 Infinity`);
    const amount = Math.min(remaining, l.capacity);
    allocation.push({ name: l.name, amount, remaining_capacity: l.capacity === Infinity ? Infinity : l.capacity - amount });
    remaining -= amount;
  }
  return { allocation, uncovered: remaining };
}

function linearMultiplier(value, good, bad) {          // value ≤ good → 10000, value ≥ bad → 0, 그 사이 선형(good<bad)
  if (value <= good) return BPS;
  if (value >= bad) return 0;
  return Math.floor((BPS * (bad - value)) / (bad - good));
}

/**
 * 종결률 기반 자동 조임. events/total은 최근 창의 "종결(또는 더 빠른 스트레스 신호) 건수"와 "결과가 확정된 건수".
 * 사전 종결률(prior_rate_bps)에 prior_weight건의 가상 표본을 주어 소표본에 과민 반응하지 않는다.
 *   추정률 = (events×10000 + prior_rate_bps×prior_weight) / (total + prior_weight)
 * 추정률 ≤ tighten_at_bps면 승수 100%, ≥ halt_at_bps면 0%(신규 선지급 중단), 그 사이는 선형으로 줄인다.
 */
export function terminationThrottle({ events, total, prior_rate_bps, prior_weight = 100, tighten_at_bps = 500, halt_at_bps = 2000 }) {
  money('events', events); money('total', total); bpsRange('prior_rate_bps', prior_rate_bps);
  if (events > total) throw new RangeError('events는 total을 넘을 수 없습니다');
  if (!Number.isSafeInteger(prior_weight) || prior_weight < 0) throw new RangeError('prior_weight: 0 이상의 정수');
  bpsRange('tighten_at_bps', tighten_at_bps); bpsRange('halt_at_bps', halt_at_bps);
  if (!(tighten_at_bps < halt_at_bps)) throw new RangeError('tighten_at_bps < halt_at_bps 여야 합니다');
  const est_rate_bps = (events * BPS + prior_rate_bps * prior_weight) / (total + prior_weight || 1);
  return { est_rate_bps, multiplier_bps: linearMultiplier(est_rate_bps, tighten_at_bps, halt_at_bps) };
}

/**
 * 풀 커버리지 기반 자동 조임: 풀 잔고 / 미결 노출액이 target 이상이면 100%, halt 이하이면 신규 선지급 중단.
 * outstanding_exposure = 진행 중인 사건들의 terminationExposure 합.
 */
export function poolThrottle({ pool_balance, outstanding_exposure, target_ratio_bps = 1000, halt_ratio_bps = 200 }) {
  money('pool_balance', pool_balance); money('outstanding_exposure', outstanding_exposure);
  bpsRange('target_ratio_bps', target_ratio_bps, 1_000_000); bpsRange('halt_ratio_bps', halt_ratio_bps, 1_000_000);
  if (!(halt_ratio_bps < target_ratio_bps)) throw new RangeError('halt_ratio_bps < target_ratio_bps 여야 합니다');
  if (outstanding_exposure === 0) return { coverage_bps: Infinity, multiplier_bps: BPS };
  const coverage_bps = (pool_balance * BPS) / outstanding_exposure;
  // coverage가 높을수록 좋다 → linearMultiplier의 방향을 뒤집어 계산
  const m = coverage_bps >= target_ratio_bps ? BPS : coverage_bps <= halt_ratio_bps ? 0 : Math.floor((BPS * (coverage_bps - halt_ratio_bps)) / (target_ratio_bps - halt_ratio_bps));
  return { coverage_bps, multiplier_bps: m };
}

/**
 * 집중도 제한 — 같은 키(지역·유형 등)에 자본이 몰리면 하락장에서 함께 종결된다. 키별 미결 선지급 합이
 * 자본 기반(capital_base)의 max_share_bps를 넘지 않도록 새 선지급의 허용액을 정한다.
 */
export function checkConcentration({ new_advance, key, portfolio, capital_base, max_share_bps }) {
  money('new_advance', new_advance); money('capital_base', capital_base); bpsRange('max_share_bps', max_share_bps);
  if (typeof key !== 'string' || !key) throw new RangeError('key: 비어 있지 않은 문자열이어야 합니다');
  const current = portfolio?.[key] ?? 0; money('portfolio[key]', current);
  const cap = mulBpsFloor(capital_base, max_share_bps);
  const allowed_amount = Math.max(0, Math.min(new_advance, cap - current));
  return { allowed: allowed_amount === new_advance, allowed_amount, key_total_after: current + allowed_amount, key_cap: cap };
}

/** 여러 승수(bp, 0~10000)를 곱해 선지급률에 적용한다. 결과는 입력을 넘지 않고 100bp 단위로 내림. */
export function applyDefenses(advance_bps, multipliers_bps = []) {
  bpsRange('advance_bps', advance_bps);
  let m = BigInt(BPS);
  for (const x of multipliers_bps) { bpsRange('multiplier_bps', x); m = (m * BigInt(x)) / BigInt(BPS); }
  const v = Number((BigInt(advance_bps) * m) / BigInt(BPS));
  return Math.floor(v / 100) * 100;
}
