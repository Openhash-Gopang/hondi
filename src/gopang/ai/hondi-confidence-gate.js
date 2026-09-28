/**
 * hondi-confidence-gate.js — 거래 확신도와 선지급 차단 (2026-09-28 신설)
 *
 * 지시(주피터님, 2026-09-28): 거래 확신도가 일정 수준 이하면 선지급 시스템을 이용할 수 없게 차단한다.
 *
 * 확신도를 "그럴듯한 점수"가 아니라 해석 가능한 확률 세 개의 약한 고리(최솟값)로 정의한다
 * (기존 SP_appraiser의 "종합확신도 = min(방법론, 데이터)" 원칙과 같다):
 *   ① 유동성 확신도 = P(허용 기간 안에 비교 거래가 최소 1건 일어난다) = 1 − exp(−연 거래건수 × 허용일수/365)
 *      포아송 근사. "이 물건이 열려 있는 동안 시장에 매수 수요가 실제로 나타날 확률"의 대리 지표다.
 *      (가정: 이 매물이 비교 거래와 같은 매수층을 두고 경쟁한다 — 검증되지 않았다.)
 *   ② 정밀도 확신도 = P(추정이 실제 가치의 ±10% 이내) = 2Φ(ln(1.10)/σ) − 1   (로그정규 가정)
 *      σ는 추정 불확실성(hondi-advance-rate.js estimateSigma). 업계의 PE10과 같은 의미다.
 *   ③ 법적 확신도 = 소유권 미확정·선순위 권리 불명·고위험 법적 쟁점이 있으면 0, 아니면 1.
 * 종합 확신도 = min(①,②,③). 0~1, 그리고 10점 척도(score10)를 함께 낸다.
 *
 * 차단: 종합 확신도 < min_confidence이면 선지급을 0으로 한다(시장 거래 중재는 그대로 진행).
 * ★ 기본 임계값 0.5는 가정이다. 이 값은 돈이 나가는 한도를 정하는 상수라 자동 갱신 대상에서 제외하고
 *   사람이 코드로만 바꾼다.
 */
import { VETO_FLAGS } from './hondi-advance-rate.js';

export const DEFAULT_MIN_CONFIDENCE = 0.5;

/** 표준정규 누적분포 Φ(x) — Abramowitz & Stegun 7.1.26 (최대 오차 약 1.5e-7) */
export function normalCdf(x) {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

function nonNeg(name, v) {
  if (!Number.isFinite(v) || v < 0) throw new RangeError(`${name}: 0 이상의 수여야 합니다 (받은 값: ${v})`);
  return v;
}

export function liquidityConfidence({ txn_12m, window_days }) {
  nonNeg('txn_12m', txn_12m); nonNeg('window_days', window_days);
  return 1 - Math.exp(-(txn_12m * window_days) / 365);
}

export function precisionConfidence({ sigma, tolerance = 0.10 }) {
  nonNeg('sigma', sigma); nonNeg('tolerance', tolerance);
  if (sigma === 0) return 1;
  return 2 * normalCdf(Math.log(1 + tolerance) / sigma) - 1;
}

export function transactionConfidence({ txn_12m, sigma, window_days, flags = {} }) {
  const components = {
    liquidity: liquidityConfidence({ txn_12m, window_days }),
    precision: precisionConfidence({ sigma }),
    legal: VETO_FLAGS.some(f => flags[f]) ? 0 : 1,
  };
  let limiting = 'liquidity', score = components.liquidity;
  for (const [k, v] of Object.entries(components)) if (v < score) { score = v; limiting = k; }
  return { score, score10: Math.round(score * 100) / 10, components, limiting };
}

/** 임계값 아래면 passed=false. min_confidence=0이면 차단하지 않는다. */
export function gate(confidence, min_confidence = DEFAULT_MIN_CONFIDENCE) {
  if (!Number.isFinite(min_confidence) || min_confidence < 0 || min_confidence > 1) throw new RangeError('min_confidence: 0~1 사이여야 합니다');
  return { passed: confidence.score >= min_confidence, threshold: min_confidence, score: confidence.score };
}
