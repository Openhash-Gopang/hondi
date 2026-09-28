/**
 * hondi-staged-valuation.js — K-Estate 국가·지역·개별 3단계 가치평가 (2026-09-28 신설)
 *
 * 배경(주피터님, 2026-09-28): 감정평가법의 조정 순서 — 거래사례비교법의 사정보정·시점수정·가치형성요인
 * 비교, 공시지가기준법의 시점수정·지역요인/개별요인 비교·그 밖의 요인 보정 — 을 그대로 세 단계로 나눈다.
 * 국가=시점수정, 지역=지역요인, 개별=개별요인(+권리 차감).
 *
 * 핵심 설계 결정(2026-09-28, 동의됨):
 *   ① LLM(SP-24a)은 계산하지 않는다. SP는 출처·조회일·기준일이 붙은 원자료만 [STAGED_VALUATION] 블록으로
 *      제출하고, 계수·불확실성·차감액은 이 모듈이 다시 계산한다. LLM이 함께 낸 계수는 참고로만 기록하고
 *      버린다(reconcileLlmFigure). 출처·조회일·기준일이 없거나 당사자 주장뿐인 수치는 채택하지 않는다 —
 *      그 단계는 "없음"이 되고 대신 불확실성(σ)이 커진다.
 *   ② 지역요인(인구 감소·정비구역 단계·인프라)은 공정가치 중앙 추정을 움직이지 않고 σ만 키운다.
 *      중앙 추정을 움직이는 유일한 지역 요소는 "비교사례 지역 대비 대상 지역의 가격 수준비" 관측값이다
 *      (지역 지수에 이미 반영된 것을 정성 평가로 또 반영하는 이중계산을 피하기 위함). 정성 위험은
 *      대신 확신도·선지급 한도(hondi-confidence-gate.js, hondi-advance-rate.js)에 σ를 통해 반영된다.
 *   ③ 권리 차감은 두 갈래다. 매수인이 인수하는 부담(대항력 있는 선순위 임차보증금 등)은 매수인이 값을
 *      깎아서 사므로 "공정가치"에서 뺀다. 제3자 근저당은 매각 대금에서 먼저 변제되는 것이라 자산
 *      가치 자체를 깎지 않고, "대출 담보가치(분배 순대금)"에서만 뺀다(deductLienFromCollateral).
 *      등기부를 확인하지 못했으면 "선순위 권리 불명"으로 거부한다(hondi-advance-rate.js의
 *      unknown_senior_claims veto 플래그와 그대로 연결된다).
 *
 * 세 단계의 σ는 서로 독립이라 가정하고 분산으로 합친다: σ² = σ_국가² + σ_지역² + σ_개별²
 * (hondi-advance-rate.js의 σ² = σ_pred² + σ_drift² + σ_model² 과 같은 합성 방식).
 * 산출된 fair_value·sigma는 hondi-valuation-tracks.js의 mediationEstimate/lendingEstimate에
 * 그대로 입력한다 — 이 모듈은 두 트랙 분리 로직을 새로 만들지 않고 "입력을 만드는" 앞단이다.
 *
 * ★ 이 파일의 상수(지수 데이터 없을 때의 사전 σ, 정성 위험 요인별 σ 가산치, 연변동성 기본값 6%)는
 *   전부 가정이며 백테스트로 보정되지 않았다. 지수·인구·정비구역 자료의 출처는 호출 측(SP-24a)이
 *   웹 검색으로 채워 evidence로 넘긴다 — 이 모듈은 출처 형식(source+asof)만 검증하고 내용의 진위는
 *   검증하지 않는다.
 */

// ───────────────────────────── 달력 검증(왕복 검증, 윤년 포함) ─────────────────────────────
// 배경: JS의 Date.parse/new Date는 존재하지 않는 날짜(예: 2026-02-31)를 다음 달로 "굴려서" 유효하다고
// 판정한다(2026-02-31 → 2026-03-03). 증거의 기준일(asof)·거래일(txn_date)에 이런 값이 들어오면
// 시점수정 계산이 조용히 틀어질 수 있어, 달력 표에 직접 대조하는 왕복 검증으로 막는다.

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** 그레고리력 윤년 판정 */
export function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** 해당 연·월의 일수(2월은 윤년 반영) */
export function daysInMonth(y, m) {
  if (m === 2 && isLeapYear(y)) return 29;
  return DAYS_IN_MONTH[m - 1];
}

/** 'YYYY-MM-DD' 형식이고 달력에 실제로 존재하는 날짜인지 검사한다. Date.parse의 날짜 굴림을 쓰지 않는다. */
export function isValidCalendarDate(dateStr) {
  if (typeof dateStr !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12) return false;
  if (d < 1 || d > daysInMonth(y, mo)) return false;
  return true;
}

/** 유효하지 않으면 던진다. 유효하면 그대로 돌려준다(체이닝용). */
export function parseEvidenceDate(dateStr, label = 'date') {
  if (!isValidCalendarDate(dateStr)) throw new RangeError(`${label}: 유효하지 않은 날짜입니다(달력에 없는 날짜, 또는 형식이 YYYY-MM-DD가 아님) — 받은 값: ${JSON.stringify(dateStr)}`);
  return dateStr;
}

/** 검증된 두 날짜(YYYY-MM-DD) 사이의 일수(b - a). Date.UTC는 검증 후에만 쓴다. */
export function daysBetween(a, b) {
  parseEvidenceDate(a, 'a'); parseEvidenceDate(b, 'b');
  const toUTC = s => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}

// ───────────────────────────── 공통 유틸 ─────────────────────────────

function median(nums) {
  const xs = [...nums].sort((a, b) => a - b);
  if (!xs.length) return null;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}

/** 분산 합성(독립 가정): σ = sqrt(Σ σᵢ²) */
export function combineSigma(sigmas) {
  return Math.sqrt(sigmas.reduce((s, x) => s + x * x, 0));
}

/** 증거 하나가 "채택 가능"한지 — value가 유한수이고 source(출처)·asof(조회일)가 실제 문자열로 있어야 한다.
 * 당사자 주장(party_notes 등)은 이 형태로 넘어오지 않게 호출 측(SP-24a)에서 걸러야 한다. */
export function evidenceOk(e) {
  if (!e || typeof e !== 'object') return false;
  if (!Number.isFinite(e.value)) return false;
  if (typeof e.source !== 'string' || !e.source.trim()) return false;
  if (typeof e.asof !== 'string' || !isValidCalendarDate(e.asof)) return false;
  return true;
}

/**
 * LLM(SP)이 함께 제출한 계수·차감액은 참고로만 기록하고 채택하지 않는다(핵심 설계 결정 ①).
 * 코드가 계산한 값과 크게 어긋나면 감사용으로 불일치를 기록한다. 반환값은 항상 computed다.
 */
export function reconcileLlmFigure(computed, llmClaimed, { label = '값', tolerance = 0.05 } = {}) {
  if (llmClaimed == null || !Number.isFinite(llmClaimed)) {
    return { value: computed, llm_claimed: null, discrepancy: null, note: `LLM 제출값 없음 — 코드 계산값(${computed}) 채택` };
  }
  const base = Math.abs(computed) > 0 ? Math.abs(computed) : 1;
  const discrepancy = Math.abs(llmClaimed - computed) / base;
  return {
    value: computed, llm_claimed: llmClaimed, discrepancy,
    note: discrepancy > tolerance
      ? `불일치 기록: LLM 제출 ${label}=${llmClaimed}, 코드 계산=${computed} (차이 ${(discrepancy * 100).toFixed(1)}%) — 코드 계산값을 채택하고 LLM 제출값은 버림`
      : `LLM 제출 ${label}과 코드 계산값이 근사(차이 ${(discrepancy * 100).toFixed(1)}%) — 코드 계산값 채택`,
  };
}

// ───────────────────────────── STEP 1: 국가(시점수정) ─────────────────────────────

export const NATIONAL_SIGMA_NONE = 0.05;      // ★ 가정, 미보정 — 지수 자료가 전혀 없을 때의 보수적 사전 σ
export const DEFAULT_ANNUAL_VOL = 0.06;       // ★ 가정, 미보정 — 지수 시계열이 없을 때의 기본 연변동성(hondi-advance-rate.js와 동일 값)
export const MIN_INDEX_POINTS = 12;           // 연변동성을 실측하기 위한 지수 시계열 최소 점 수(월간 기준 1년)

/** 지수 시계열(오름차순, {date, value})의 로그수익률 표준편차를 연율화한다. */
export function realizedAnnualVol(index_series) {
  if (!Array.isArray(index_series) || index_series.length < 2) return null;
  const rets = [];
  for (let i = 1; i < index_series.length; i++) {
    const a = index_series[i - 1], b = index_series[i];
    if (!(a.value > 0 && b.value > 0)) continue;
    rets.push(Math.log(b.value / a.value));
  }
  if (rets.length < 2) return null;
  const m = rets.reduce((s, x) => s + x, 0) / rets.length;
  const variance = rets.reduce((s, x) => s + (x - m) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(12);   // 월간 시계열 가정 → 연율화
}

/**
 * 국가(시점수정): 비교사례 각 건을 evaluation_date 시점의 지수로 보정한다.
 * comps: [{ price, txn_date, index_at_txn: {value, source, asof}|null }]
 * valuation_index: {value, source, asof}|null — 평가 기준 시점의 지수 값
 * index_series: [{date, value}]|null — 연변동성 실측용(선택)
 * 한국부동산원 R-ONE과 국토부 실거래가는 집계 기준(신고일/계약일)이 달라 섞으면 안 되므로,
 * 호출 측이 index_at_txn과 valuation_index를 같은 출처(source)로만 채우도록 강제하지는 않지만
 * source 문자열을 그대로 기록해 감사 가능하게 한다.
 */
export function nationalAdjustment({ comps, valuation_index, index_series = null, valuation_date }) {
  parseEvidenceDate(valuation_date, 'valuation_date');
  if (!Array.isArray(comps) || !comps.length) throw new RangeError('comps: 최소 1건이 필요합니다');
  for (const c of comps) if (!(Number.isFinite(c.price) && c.price > 0)) throw new RangeError('comps[].price: 양수여야 합니다');

  const vol = index_series && index_series.length >= MIN_INDEX_POINTS ? realizedAnnualVol(index_series) : null;
  const annual_vol = vol ?? DEFAULT_ANNUAL_VOL;
  const vol_source = vol != null ? `지수 시계열 실측(점 ${index_series.length}개)` : `가정값 ${DEFAULT_ANNUAL_VOL}(미보정, 지수 시계열 부족)`;

  if (!evidenceOk(valuation_index)) {
    return Object.freeze({
      applied: false, adjusted_prices: comps.map(c => c.price), index_ratio_median: 1,
      annual_vol, vol_source, sigma_national: Math.max(NATIONAL_SIGMA_NONE, annual_vol),
      reasons: ['지수 자료 없음(출처·조회일 필요) → 시점수정 미적용, 보수적 σ 적용'],
    });
  }
  const ratios = [], adjusted = [];
  let n_missing = 0;
  for (const c of comps) {
    if (!evidenceOk(c.index_at_txn)) { n_missing++; ratios.push(1); adjusted.push(c.price); continue; }
    parseEvidenceDate(c.txn_date, 'txn_date');
    const ratio = valuation_index.value / c.index_at_txn.value;
    ratios.push(ratio);
    adjusted.push(Math.round(c.price * ratio));
  }
  const index_ratio_median = median(ratios);
  const sigma_national = n_missing > 0
    ? combineSigma([annual_vol, NATIONAL_SIGMA_NONE * (n_missing / comps.length)])
    : annual_vol;
  return Object.freeze({
    applied: true, adjusted_prices: adjusted, index_ratio_median, annual_vol, vol_source, sigma_national,
    n_missing, reasons: [
      `시점수정 지수비 중앙값 ${index_ratio_median.toFixed(4)} (기준 지수 출처: ${valuation_index.source}, 조회일 ${valuation_index.asof})`,
      `연변동성 ${(annual_vol * 100).toFixed(1)}% (${vol_source})`,
      ...(n_missing > 0 ? [`비교사례 ${n_missing}/${comps.length}건은 지수 자료 없어 시점수정 미적용(σ 가산)`] : []),
    ],
  });
}

// ───────────────────────────── STEP 2: 지역(지역요인 — σ만) ─────────────────────────────

export const REGIONAL_SIGMA_NONE = 0.01;   // ★ 가정, 미보정 — 관측된 지역 가격 수준비가 없을 때
export const REGIONAL_RISK_SIGMA = Object.freeze({   // ★ 가정, 미보정 — 정성 위험 요인별 σ 가산치(요인당)
  population_decline: 0.015,
  redevelopment_early: 0.02,     // 정비구역 지정 초기 — 불확실성 큼
  redevelopment_late: 0.008,     // 정비구역 관리처분 이후 — 불확실성 작음
  school_consolidation: 0.01,
  infra_downgrade: 0.01,
});

/**
 * 지역(지역요인): 중앙 추정은 "비교사례 지역 대비 대상 지역의 가격 수준비" 관측값으로만 움직인다
 * (핵심 설계 결정 ②). 인구·정비·인프라 등 정성 위험은 σ만 키운다.
 * price_level_ratio: {value, source, asof}|null
 * risk_factors: [{ type: keyof REGIONAL_RISK_SIGMA, evidence: {value?, source, asof} }] — source·asof 없는 항목은 채택하지 않는다.
 */
export function regionalAdjustment({ price_level_ratio = null, risk_factors = [] }) {
  const applied = evidenceOk(price_level_ratio);
  const central_multiplier = applied ? price_level_ratio.value : 1;
  const reasons = [];
  reasons.push(applied
    ? `지역 가격 수준비 ${central_multiplier.toFixed(4)} 적용(출처: ${price_level_ratio.source}, 조회일 ${price_level_ratio.asof})`
    : '지역 가격 수준비 관측값 없음 → 중앙 추정 미조정(1.0), 대신 보수적 σ 적용');

  const adopted = [], rejected = [];
  for (const f of Array.isArray(risk_factors) ? risk_factors : []) {
    const perFactorSigma = REGIONAL_RISK_SIGMA[f?.type];
    if (perFactorSigma == null) { rejected.push(f); continue; }
    if (!f.evidence || typeof f.evidence.source !== 'string' || !f.evidence.source.trim() || !isValidCalendarDate(f.evidence.asof)) {
      rejected.push(f);
      reasons.push(`지역 위험 요인 '${f.type}' 출처·조회일 없어 채택하지 않음`);
      continue;
    }
    adopted.push({ type: f.type, sigma: perFactorSigma, source: f.evidence.source, asof: f.evidence.asof });
    reasons.push(`지역 위험 요인 '${f.type}' 채택(σ+${perFactorSigma}, 출처: ${f.evidence.source})`);
  }
  const sigma_regional = combineSigma([applied ? REGIONAL_SIGMA_NONE : REGIONAL_SIGMA_NONE * 2, ...adopted.map(a => a.sigma)]);
  return Object.freeze({ applied, central_multiplier, sigma_regional, adopted_risk_factors: adopted, rejected_risk_factors: rejected, reasons });
}

// ───────────────────────────── STEP 3: 개별(개별요인 + 권리 차감) ─────────────────────────────

export const INDIVIDUAL_SIGMA_NONE = 0.01;   // ★ 가정, 미보정
export const INDIVIDUAL_DEFECT_SIGMA = 0.01; // ★ 가정, 미보정 — 물리적 하자 1건당 σ 가산치

/**
 * 개별(개별요인 + 권리 차감): 등기부를 확인하지 못했으면 거부한다(선순위 권리 불명).
 * registry: {
 *   confirmed: {source, asof}|null,                              // 등기부 열람·확인 여부(사실 확인, 없으면 거부)
 *   assumed_burdens: [{amount, type, evidence:{source,asof}}],    // 매수인이 인수 — 공정가치에서 차감
 *   third_party_liens: [{amount, type, evidence:{source,asof}}],  // 제3자 근저당 — 담보가치(분배 순대금)에서만 차감
 * }
 * defects: [{ type, evidence:{source,asof} }]  — 물리적 하자 등, σ만 가산
 */
export function individualAdjustment({ registry, defects = [] }) {
  const confirmed = registry && evidenceOk({ value: 1, ...registry.confirmed });
  if (!confirmed) {
    return Object.freeze({
      rejected: true, assumed_burden_deduction: 0, third_party_lien_total: 0,
      sigma_individual: null,
      registry_flags: { unknown_senior_claims: true },
      reasons: ['등기부 확인 안 됨(출처·조회일 필요) → 선순위 권리 불명으로 거부(선지급 차단, hondi-advance-rate.js veto 플래그로 전달)'],
    });
  }
  const sumEvidenced = list => (Array.isArray(list) ? list : [])
    .filter(x => Number.isFinite(x.amount) && x.amount > 0 && evidenceOk({ value: x.amount, ...x.evidence }))
    .reduce((s, x) => s + Math.round(x.amount), 0);
  const assumed_burden_deduction = sumEvidenced(registry.assumed_burdens);
  const third_party_lien_total = sumEvidenced(registry.third_party_liens);

  const adoptedDefects = (Array.isArray(defects) ? defects : []).filter(d => d.evidence && evidenceOk({ value: 1, ...d.evidence }));
  const sigma_individual = combineSigma([INDIVIDUAL_SIGMA_NONE, ...adoptedDefects.map(() => INDIVIDUAL_DEFECT_SIGMA)]);

  return Object.freeze({
    rejected: false, assumed_burden_deduction, third_party_lien_total, sigma_individual,
    registry_flags: { unknown_senior_claims: false },
    reasons: [
      `등기부 확인됨(출처: ${registry.confirmed.source}, 조회일 ${registry.confirmed.asof})`,
      assumed_burden_deduction > 0 ? `인수 부담(선순위 임차보증금 등) ${assumed_burden_deduction.toLocaleString()}원 → 공정가치에서 차감` : '인수 부담 없음',
      third_party_lien_total > 0 ? `제3자 근저당 ${third_party_lien_total.toLocaleString()}원 → 자산 공정가치는 그대로, 대출 담보가치(분배 순대금)에서만 차감 예정` : '제3자 근저당 없음',
      `물리적 하자 등 개별 위험 요인 ${adoptedDefects.length}건 채택(σ 가산)`,
    ],
  });
}

// ───────────────────────────── 종합 ─────────────────────────────

/**
 * 세 단계를 종합해 mediationEstimate/lendingEstimate에 넣을 fair_value·sigma를 만든다.
 * 순서: 국가(지수보정, 사례별) → 중앙값 → 지역(가격수준비, 배율) → 개별(인수 부담 차감, 금액).
 * 제3자 근저당은 여기서 빼지 않는다 — 대출 트랙 산출 후 deductLienFromCollateral로 별도 처리한다.
 */
export function stagedValuation({ comps, valuation_index = null, index_series = null, valuation_date, regional = {}, registry, defects = [], model_version }) {
  if (typeof model_version !== 'string' || !model_version) throw new RangeError('model_version이 필요합니다');
  const national = nationalAdjustment({ comps, valuation_index, index_series, valuation_date });
  const median_after_national = median(national.adjusted_prices);
  const regionalResult = regionalAdjustment(regional);
  const before_individual = Math.round(median_after_national * regionalResult.central_multiplier);
  const individualResult = individualAdjustment({ registry, defects });

  if (individualResult.rejected) {
    return Object.freeze({
      model_version, valuation_date, rejected: true, fair_value: null, sigma: null,
      registry_flags: individualResult.registry_flags,
      stages: { national, regional: regionalResult, individual: individualResult },
      reasons: [...national.reasons, ...regionalResult.reasons, ...individualResult.reasons, '개별 단계 거부로 전체 가치평가를 산출하지 않음(선지급은 veto 플래그로 별도 차단됨)'],
    });
  }
  const fair_value = Math.max(0, before_individual - individualResult.assumed_burden_deduction);
  const sigma = combineSigma([national.sigma_national, regionalResult.sigma_regional, individualResult.sigma_individual]);
  return Object.freeze({
    model_version, valuation_date, rejected: false, fair_value, sigma,
    third_party_lien_total: individualResult.third_party_lien_total,
    registry_flags: individualResult.registry_flags,
    stages: { national, regional: regionalResult, individual: individualResult },
    reasons: [
      ...national.reasons, ...regionalResult.reasons, ...individualResult.reasons,
      `종합: 국가 보정 후 중앙값 ${median_after_national.toLocaleString()}원 → 지역 배율 ${regionalResult.central_multiplier.toFixed(4)} → ${before_individual.toLocaleString()}원 → 개별 인수부담 차감 → 공정가치 ${fair_value.toLocaleString()}원, σ=${sigma.toFixed(4)}(=√(σ국가²+σ지역²+σ개별²))`,
    ],
  });
}

/**
 * 대출 트랙 산출(hondi-valuation-tracks.js lendingEstimate) 이후, 제3자 근저당을 담보가치(분배 순대금)에서만 뺀다.
 * 자산 공정가치(fair_value_ref)는 건드리지 않는다(핵심 설계 결정 ③).
 */
export function deductLienFromCollateral(lendingResult, third_party_lien_total) {
  if (!Number.isSafeInteger(third_party_lien_total) || third_party_lien_total < 0) throw new RangeError('third_party_lien_total: 0 이상의 정수여야 합니다');
  if (third_party_lien_total === 0) return lendingResult;
  const collateral_value_gross = lendingResult.collateral_value;
  const collateral_value = Math.max(0, collateral_value_gross - third_party_lien_total);
  const advance = Math.min(lendingResult.advance, collateral_value);
  const ltv_bps = collateral_value > 0 ? Number((BigInt(advance) * 10000n) / BigInt(collateral_value)) : 0;
  return Object.freeze({
    ...lendingResult, collateral_value_gross, third_party_lien_total, collateral_value, advance, ltv_bps,
    reasons: [...lendingResult.reasons, `제3자 근저당 ${third_party_lien_total.toLocaleString()}원 차감(자산 공정가치는 불변) → 순 담보가치 ${collateral_value.toLocaleString()}원, 선지급 ${advance.toLocaleString()}원`],
  });
}
