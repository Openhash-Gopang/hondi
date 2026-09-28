/**
 * hondi-sale-ladder.js — 매각 진행 규칙: 법원 경매와 동일한 봉인입찰 + 하향 사다리 (2026-09-28 신설)
 *
 * 지시(주피터님, 2026-09-28): 이 시스템은 법원 경매의 대체제이며 작동 메커니즘은 동일하다. 법원은 유찰마다
 * 20% 저감(회차 약 40일)인데, 입찰 참여자도 AI 비서를 쓰므로 "24시간마다 0.56% 하락, 또는 시간당 0.02% 하락"으로
 * 한다. 40일에 20%씩 내려가는 속도(하루 0.5563%, 시간당 0.02324%)와 같아 하락 속도는 법원과 동일하고,
 * 회차(창)만 잘게 나뉜다 — 준비된 매수인은 40일을 기다리지 않고 다음 창에서 낙찰받는다.
 *
 * "회차" = 하나의 입찰 창. 창마다 최저가가 고정되고(그 창의 시작 시점 가격), 창이 끝나면 봉인 입찰을 열어
 * 유효 최고가가 낙찰, 없으면 유찰이며 다음 창에서 가격이 한 단계 내려간다. 창 길이 = 하락 단계 길이.
 *
 * 법원 경매와 같은 것(확인된 것만):
 *   - 1회차 최저매각가격 = 시작가(법원: 감정가 / 여기: 공시된 추정가).
 *   - 매수신청 보증금 = 최저매각가격의 10%.
 *   - 회차마다 봉인 입찰. 최저매각가격 이상 입찰 중 최고가가 그 가격으로 낙찰(1가격 봉인입찰). 유효 입찰이 없으면 유찰.
 * 확인하지 못한 것(가정 — 매개변수로 두었다):
 *   - 최저가 절사 단위(round_unit, 기본 1,000원), 동점 처리(법원 방식 미확인 → 공개 재계산이 가능한 결정적 해시 규칙),
 *     법원 회차 주기 40일(주피터님 제시값; 공고 후 2주 이후 매각기일이라는 법정 최소만 확인).
 *
 * 하락 속도 표기: 정수 ppm(백만분율)로 다룬다(bps보다 세밀). 20% = 200,000ppm, 0.5570% = 5,570ppm, 0.0232% = 232ppm.
 * 금액 계산은 전부 BigInt 정수 연산이라 브라우저·Worker·Node 어디서나 같은 값이 나온다(공개 검증 가능).
 *
 * ★ 선지급과의 관계: 최저가는 결정적으로 내려간다. 그래서 "허용하는 가장 깊은 회차"의 최저가에 팔려도
 *   선지급 원금+자본비용+판매비용이 회수되도록 선지급률에 상한을 걸 수 있다(ladderAdvanceCapBps).
 *   깊은 회차까지 허용할수록 상한은 내려간다 — 가격 위험을 미매각·시간 위험으로 바꾸는 선택이다.
 */

export const DEFAULT_REDUCTION_BPS = 2000;    // (구) 유찰 시 20% 저감 — 회차 방식 호환용 기본값
export const DEFAULT_DEPOSIT_BPS = 1000;      // 매수신청 보증금 10%
export const DEFAULT_ROUND_UNIT = 1000;       // 최저가 절사 단위(가정)
const BPS = 10000;
const PPM = 1_000_000;

/** 하락 규칙 프리셋. reduction_ppm = 한 단계(창)마다의 하락률(ppm), step_hours = 한 단계의 길이(시간). */
export const PRESETS = Object.freeze({
  court_like:   Object.freeze({ reduction_ppm: 200_000, step_hours: 960 }),  // 법원 방식: 40일마다 20%
  hondi_daily:  Object.freeze({ reduction_ppm: 5_570,   step_hours: 24 }),   // 24시간마다 0.557% — 법원과 같은 하락 속도
  hondi_hourly: Object.freeze({ reduction_ppm: 232,     step_hours: 1 }),    // 시간당 0.0232% — 위와 같은 속도
});

const enc = new TextEncoder();
async function sha256Hex(str) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(str)));
  return [...h].map(b => b.toString(16).padStart(2, '0')).join('');
}
function posInt(name, v, min = 0) {
  if (!Number.isSafeInteger(v) || v < min) throw new RangeError(`${name}: ${min} 이상의 정수여야 합니다 (받은 값: ${v})`);
  return v;
}
/** reduction_ppm이 있으면 우선, 없으면 reduction_bps(기본 2000=20%)를 ppm으로 환산. 0~90%만 허용. */
function resolvePpm({ reduction_bps, reduction_ppm } = {}) {
  if (reduction_ppm != null) {
    if (!Number.isSafeInteger(reduction_ppm) || reduction_ppm < 0 || reduction_ppm > 900_000) throw new RangeError(`reduction_ppm: 0~900000 정수여야 합니다 (받은 값: ${reduction_ppm})`);
    return reduction_ppm;
  }
  const b = reduction_bps ?? DEFAULT_REDUCTION_BPS;
  if (!Number.isSafeInteger(b) || b < 0 || b > 9000) throw new RangeError(`reduction_bps: 0~9000 정수여야 합니다 (받은 값: ${b})`);
  return b * 100;
}

/** 회차 r의 최저매각가격 = floor(시작가 × (1−하락률)^(r−1)), 절사 단위 적용. BigInt 정수 연산(반올림 오차 없음). */
export function minPriceAtRound(start_price, round, opts = {}) {
  posInt('start_price', start_price, 1); posInt('round', round, 1);
  const ppm = resolvePpm(opts), round_unit = posInt('round_unit', opts.round_unit ?? DEFAULT_ROUND_UNIT, 1);
  const k = BigInt(round - 1), num = BigInt(PPM - ppm) ** k, den = BigInt(PPM) ** k;
  const exact = (BigInt(start_price) * num) / den;                       // floor
  const unit = BigInt(round_unit);
  return Number((exact / unit) * unit);
}

/** 경과 시간(시간)에 해당하는 회차(창) 번호. 0시간~step_hours 미만 = 1회차. */
export function roundAt(elapsed_hours, step_hours) {
  posInt('elapsed_hours', elapsed_hours, 0); posInt('step_hours', step_hours, 1);
  return Math.floor(elapsed_hours / step_hours) + 1;
}

/** 프리셋(또는 {reduction_ppm, step_hours, round_unit})으로 경과 시간의 최저매각가격. */
export function minPriceAtElapsed(start_price, elapsed_hours, preset = PRESETS.hondi_daily) {
  const { reduction_ppm, step_hours, round_unit } = preset;
  return minPriceAtRound(start_price, roundAt(elapsed_hours, step_hours), { reduction_ppm, round_unit });
}

/** 1회차부터 max_round까지의 사다리. floor_price를 주면 그 아래로 내려가는 회차는 만들지 않는다. */
export function buildLadder({ start_price, max_round, floor_price = 0, ...opts }) {
  posInt('max_round', max_round, 1); posInt('floor_price', floor_price, 0);
  const ladder = [];
  for (let r = 1; r <= max_round; r++) {
    const p = minPriceAtRound(start_price, r, opts);
    if (p < floor_price || p <= 0) break;
    ladder.push({ round: r, min_price: p, ratio: p / start_price });
  }
  return ladder;
}

/** 최저가가 threshold 이상인 회차의 수(1회차부터 연속, 최대 max_round) — 가격이 단조 감소하므로 이분 탐색. */
export function roundsAtOrAbove(start_price, threshold, { max_round = 20000, ...opts } = {}) {
  if (minPriceAtRound(start_price, 1, opts) < threshold) return 0;
  if (minPriceAtRound(start_price, max_round, opts) >= threshold) return max_round;
  let lo = 1, hi = max_round;                                            // 불변식: price(lo) ≥ threshold > price(hi)
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (minPriceAtRound(start_price, mid, opts) >= threshold) lo = mid; else hi = mid; }
  return lo;
}

/** 매수신청 보증금 = ceil(최저매각가격 × 10%) */
export function requiredDeposit(min_price, deposit_bps = DEFAULT_DEPOSIT_BPS) {
  posInt('min_price', min_price, 1); posInt('deposit_bps', deposit_bps, 0);
  const n = BigInt(min_price) * BigInt(deposit_bps), d = BigInt(BPS);
  return Number((n + d - 1n) / d);
}

/**
 * 한 회차의 입찰 결과를 결정한다.
 * bids: [{ bidder: string, amount: 정수(원), deposit: 정수(원) }] — 한 입찰자는 한 번만 입찰한다.
 * 유효 조건: amount ≥ min_price 이고 deposit ≥ 보증금(최저가의 10%).
 * 낙찰: 유효 입찰 중 최고가, 낙찰가 = 그 입찰가(1가격). 동점이면 sha256(case_id:round:bidder)가 가장
 *       작은 입찰자 — 입력 순서·제출 시각과 무관하고 누구나 재계산해 검증할 수 있다.
 */
export async function resolveRound({ case_id, round, min_price, bids, deposit_bps = DEFAULT_DEPOSIT_BPS }) {
  if (typeof case_id !== 'string' || !case_id) throw new RangeError('case_id: 비어 있지 않은 문자열이어야 합니다');
  posInt('round', round, 1); posInt('min_price', min_price, 1);
  if (!Array.isArray(bids)) throw new RangeError('bids: 배열이어야 합니다');
  const seen = new Set(), valid = [], invalid = [], need = requiredDeposit(min_price, deposit_bps);
  for (const b of bids) {
    if (typeof b?.bidder !== 'string' || !b.bidder) throw new RangeError('bidder: 비어 있지 않은 문자열이어야 합니다');
    if (seen.has(b.bidder)) throw new RangeError(`입찰자 ${b.bidder}가 한 회차에 두 번 입찰했습니다`);
    seen.add(b.bidder);
    if (!Number.isSafeInteger(b.amount) || b.amount < 0 || !Number.isSafeInteger(b.deposit) || b.deposit < 0) {
      invalid.push({ bidder: b.bidder, reason: 'malformed' }); continue;
    }
    if (b.amount < min_price) { invalid.push({ bidder: b.bidder, reason: 'below_minimum' }); continue; }
    if (b.deposit < need) { invalid.push({ bidder: b.bidder, reason: 'insufficient_deposit' }); continue; }
    valid.push(b);
  }
  if (!valid.length) return { outcome: 'failed', round, min_price, next_round: round + 1, required_deposit: need, invalid };
  const top = Math.max(...valid.map(b => b.amount));
  const tied = valid.filter(b => b.amount === top);
  let winner = tied[0];
  if (tied.length > 1) {
    const keyed = await Promise.all(tied.map(async b => ({ b, k: await sha256Hex(`${case_id}:${round}:${b.bidder}`) })));
    keyed.sort((x, y) => (x.k < y.k ? -1 : x.k > y.k ? 1 : 0));
    winner = keyed[0].b;
  }
  return { outcome: 'sold', round, min_price, winner: winner.bidder, price: top, tie_broken: tied.length > 1, required_deposit: need, invalid };
}

/**
 * 선지급률 상한(bp): "허용하는 가장 깊은 회차 max_round의 최저가에 팔려도 선지급 원금+자본비용+판매비용이
 * 회수되는" 최대 선지급률. 통계가 아니라 사다리에서 나오는 결정적 한도다.
 *
 * 두 가지 모드:
 *  ① start_price를 주면(권장) — 금액(원) 단위로 정확히 계산한다. 실제 최저가(절사 단위 반영)에서 판매비용(올림)·
 *     수수료를 빼고, 자본비용(올림)까지 더한 값이 그 순매각대금을 넘지 않는 최대 정수 선지급액 A를 구해
 *     bp로 환산(내림)한다. settleAdvance와 같은 반올림 규칙이라 "그 회차 최저가에 팔면 손실 0"이 원 단위로
 *     정확히 성립한다(속성 테스트로 보장).
 *  ② start_price 없이 — 비율만으로 계산한다:
 *        상한 = (1−저감률)^(max_round−1) × (1−판매비용률−수수료율) / (1 + 연이율 × 일수/365)
 *     절사·올림을 무시하므로 실제 금액에서는 절사 단위 안팎(수백 원)의 오차가 있을 수 있다.
 * days = 선지급 후 그 회차에서 매각되기까지의 예상 일수(호출자가 정한다).
 */
export function ladderAdvanceCapBps({
  max_round, reduction_bps, reduction_ppm, selling_cost_bps = 0, fee_bps = 0, annual_rate_bps, days,
  start_price = null, round_unit = DEFAULT_ROUND_UNIT,
}) {
  const ppm = resolvePpm({ reduction_bps, reduction_ppm });
  posInt('max_round', max_round, 1); posInt('selling_cost_bps', selling_cost_bps, 0); posInt('fee_bps', fee_bps, 0);
  posInt('annual_rate_bps', annual_rate_bps, 0); posInt('days', days, 0);

  if (start_price == null) {
    const floorRatio = Math.pow((PPM - ppm) / PPM, max_round - 1);
    const netFactor = floorRatio * (1 - (selling_cost_bps + fee_bps) / BPS);
    const carryFactor = 1 + (annual_rate_bps / BPS) * (days / 365);
    return Math.max(0, Math.min(BPS, Math.floor((netFactor / carryFactor) * BPS)));
  }

  posInt('start_price', start_price, 1);
  const sale = BigInt(minPriceAtRound(start_price, max_round, { reduction_ppm: ppm, round_unit }));
  const costs = (sale * BigInt(selling_cost_bps) + BigInt(BPS) - 1n) / BigInt(BPS);            // ceil (settlement의 판매비용 반올림과 동일 방향)
  const afterCosts = sale > costs ? sale - costs : 0n;
  const fee = (afterCosts * BigInt(fee_bps)) / BigInt(BPS);                                     // floor
  const net = afterCosts - fee;
  if (net <= 0n) return 0;
  const D = BigInt(BPS * 365), rd = BigInt(annual_rate_bps) * BigInt(days);
  const carryOf = a => (a * rd + D - 1n) / D;                                                   // ceil
  let A = (net * D) / (D + rd);                                                                 // A·(1+ρ) ≤ net 의 근사 해
  while (A > 0n && A + carryOf(A) > net) A -= 1n;                                               // 올림 때문에 넘으면 한 걸음씩 내림
  const bps = Number((A * BigInt(BPS)) / BigInt(start_price));                                 // floor
  return Math.max(0, Math.min(BPS, bps));
}
