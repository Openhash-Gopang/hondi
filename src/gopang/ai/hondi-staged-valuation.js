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
 * ★ 2026-09-28(3차) 추가 — docs/kestate/valuation-methodology.md 갭 분석 반영:
 *   ④ 가압류·가처분·유치권은 "말소기준권리" 순위 판정(어떤 권리가 매각으로 소멸되고 어떤 권리가
 *      인수되는지)이 필요한 복잡한 법적 판단이라, 이 코드는 그 판정을 시도하지 않는다. 등기부에서
 *      이런 권리가 하나라도 확인되면(evidence 있음) 전체를 거부한다(hondi-advance-rate.js의
 *      high_severity_legal_issue veto 플래그로 연결 — K-Law·변호사 상담 필요). 이는 "확실하지 않으면
 *      계산하지 않고 거부한다"는 ①·③의 원칙을 그대로 확장한 것이다. 말소기준권리 순위를 실제로
 *      계산하는 로직은 이번 버전에 포함하지 않는다(향후 과제, valuation-methodology.md §4-1).
 *   ⑤ 개별 하자(defects) 중 "맹지·도로 미접합"처럼 건축 가능성 자체를 제약하는 유형은 일반 물리적
 *      하자보다 σ 가산치를 더 크게 둔다(INDIVIDUAL_DEFECT_SEVERE_TYPES) — valuation-methodology.md
 *      §3-D의 "차량 진입 가능 여부는 지역요인이 아니라 개별요인" 판단을 반영.
 *
 * ★ 2026-09-30 추가 — docs/kestate/valuation-methodology.md §6·§9·§10 우선순위 갭 반영:
 *   ⑥ 층(floor) 비교(floorComparison): 대상 물건의 층과 가까운 비교사례가 충분하면(FLOOR_WINDOW 이내가
 *      MIN_FLOOR_MATCHED_COMPS건 이상) 그 사례만으로 중앙값을 구한다 — "관측 가능한 값은 중앙값 조정 대상,
 *      정량화가 애매하면 σ 확대"(§6) 중 앞쪽이다. 층별 가격 프리미엄 계수를 지어내지 않고 비교사례 선별만
 *      한다(계수 신설은 보정 표본이 없어 불가). 충분한 사례가 없으면 전체를 쓰되 σ를 키운다.
 *      대상 층은 출처·조회일이 붙은 증거({value, source, asof})여야 채택한다(건축물대장·등기부 등).
 *   ⑦ 물건 유형 범위 가드: property_type이 제출됐고 SUPPORTED_PROPERTY_TYPES에 없으면(상가·오피스텔·토지·
 *      단독주택 등) 값을 내지 않고 거부한다(§9 — "억지로 값을 내면 안 된다"). 유형 미제출은 하위호환을 위해
 *      가드하지 않지만 SP-24a는 항상 제출해야 한다.
 *   말소기준권리 순위 계산은 법률 검토 선행이라 이번에도 구현하지 않는다(④ 그대로).
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

// ───────────────────────────── STEP 2-b: 물건 유형 범위 가드 ─────────────────────────────

// ★ valuation-methodology.md §9 — 지금 안전하게 다룰 수 있는 범위는 "아파트(구분소유 공동주택) 매매"뿐이다.
export const SUPPORTED_PROPERTY_TYPES = Object.freeze(['apartment']);

/** property_type이 없으면 null(가드하지 않음, 하위호환). 있으면 지원 범위 안인지 판정한다. */
export function propertyScopeCheck(property_type) {
  if (property_type == null) return null;
  const supported = typeof property_type === 'string' && SUPPORTED_PROPERTY_TYPES.includes(property_type);
  return Object.freeze({
    supported,
    reason: supported
      ? `물건 유형 '${property_type}' — 지원 범위(아파트 매매) 안`
      : `물건 유형 ${JSON.stringify(property_type)}은(는) 이 평가 범위 밖(현재 아파트 매매만 지원 — 상가·오피스텔·토지·단독주택은 주방식이 달라 값을 내지 않음)`,
  });
}

// ───────────────────────────── STEP 3-a: 개별요인 — 층(floor) 비교 ─────────────────────────────

export const FLOOR_WINDOW = 3;                  // ★ 가정, 미보정 — 대상 층과 이 차이 이내인 비교사례를 "비슷한 층"으로 본다
export const MIN_FLOOR_MATCHED_COMPS = 3;       // ★ 가정, 미보정 — 선별 후에도 남아야 하는 최소 비교사례 수(SP-24a R1과 동일)
export const FLOOR_UNMATCHED_SIGMA = 0.015;     // ★ 가정, 미보정 — 비슷한 층 사례가 부족해 전체를 쓸 때의 σ 가산치

const isFloor = f => Number.isInteger(f) && f >= 1;

/**
 * 층 비교: 대상 층과 비슷한 층의 비교사례로 좁힌다(계수 조정 아님 — 사례 선별).
 * subject_floor: {value(정수 ≥1), source, asof}|null|undefined — 없으면 아무것도 하지 않는다(하위호환).
 * comps[].floor: 정수 ≥1 — 국토부 실거래 응답의 floor 필드. 없거나 이상하면 그 사례는 층 일치 여부를 확인할 수 없어 선별에서 제외된다.
 * 반환: { applied, comps(선별 결과 — 미적용이면 원본 그대로), sigma_floor, n_before, n_after, reasons }
 */
export function floorComparison({ comps, subject_floor = null }) {
  const untouched = (reasons = [], sigma_floor = 0) => Object.freeze({
    applied: false, comps, sigma_floor, n_before: comps.length, n_after: comps.length, reasons,
  });
  if (subject_floor == null) return untouched();
  if (!evidenceOk(subject_floor) || !isFloor(subject_floor.value)) {
    return untouched([`대상 층 증거가 채택 조건(정수 층수 + 출처·조회일)을 못 채워 층 비교 미적용: ${JSON.stringify(subject_floor?.value ?? null)}`]);
  }
  const near = comps.filter(c => isFloor(c.floor) && Math.abs(c.floor - subject_floor.value) <= FLOOR_WINDOW);
  if (near.length >= MIN_FLOOR_MATCHED_COMPS) {
    return Object.freeze({
      applied: true, comps: near, sigma_floor: 0, n_before: comps.length, n_after: near.length,
      reasons: [`층 비교: 대상 ${subject_floor.value}층(출처: ${subject_floor.source}, 조회일 ${subject_floor.asof}) ±${FLOOR_WINDOW}층 비교사례 ${near.length}/${comps.length}건만 사용`],
    });
  }
  return untouched([
    `층 비교: 대상 ${subject_floor.value}층 ±${FLOOR_WINDOW}층 비교사례가 ${near.length}건뿐(최소 ${MIN_FLOOR_MATCHED_COMPS}건 필요) → 전체 ${comps.length}건 사용, σ +${FLOOR_UNMATCHED_SIGMA}`,
  ], FLOOR_UNMATCHED_SIGMA);
}

// ───────────────────────────── STEP 3: 개별(개별요인 + 권리 차감) ─────────────────────────────

export const INDIVIDUAL_SIGMA_NONE = 0.01;   // ★ 가정, 미보정
export const INDIVIDUAL_DEFECT_SIGMA = 0.01; // ★ 가정, 미보정 — 물리적 하자 1건당 σ 가산치
// ★ 2026-09-28(3차) 추가, 가정·미보정 — 맹지·도로 미접합 등 건축 가능성 자체를 제약하는 하자는
// 일반 하자보다 σ를 더 크게 둔다(valuation-methodology.md §3-D). 목록에 없는 type은 일반 하자로 취급.
export const INDIVIDUAL_DEFECT_SEVERE_TYPES = ['road_access_blocked'];
export const INDIVIDUAL_DEFECT_SIGMA_SEVERE = 0.03; // ★ 가정, 미보정

// ★ 2026-09-28(3차) 추가 — 이 목록에 있는 유형이 등기부에서 하나라도 확인되면(evidence 있음)
// 말소기준권리 순위를 판정하지 않고 전체를 거부한다(위 파일 머리 ④ 참조).
export const UNRESOLVED_ENCUMBRANCE_TYPES = ['provisional_attachment', 'injunction', 'possessory_lien'];
const UNRESOLVED_ENCUMBRANCE_LABEL = {
  provisional_attachment: '가압류', injunction: '가처분', possessory_lien: '유치권',
};

/**
 * 개별(개별요인 + 권리 차감): 등기부를 확인하지 못했으면 거부한다(선순위 권리 불명).
 * registry: {
 *   confirmed: {source, asof}|null,                              // 등기부 열람·확인 여부(사실 확인, 없으면 거부)
 *   assumed_burdens: [{amount, type, evidence:{source,asof}}],    // 매수인이 인수 — 공정가치에서 차감
 *   third_party_liens: [{amount, type, evidence:{source,asof}}],  // 제3자 근저당 — 담보가치(분배 순대금)에서만 차감
 *   unresolved_encumbrances: [{type, evidence:{source,asof}}],    // 가압류·가처분·유치권 등 — 확인되면 전체 거부
 * }
 * defects: [{ type, evidence:{source,asof} }]  — 물리적 하자 등, σ만 가산(type이
 *   INDIVIDUAL_DEFECT_SEVERE_TYPES에 있으면 더 큰 σ)
 */
export function individualAdjustment({ registry, defects = [] }) {
  const confirmed = registry && evidenceOk({ value: 1, ...registry.confirmed });
  if (!confirmed) {
    return Object.freeze({
      rejected: true, assumed_burden_deduction: 0, third_party_lien_total: 0,
      sigma_individual: null,
      registry_flags: { unknown_senior_claims: true, high_severity_legal_issue: false },
      reasons: ['등기부 확인 안 됨(출처·조회일 필요) → 선순위 권리 불명으로 거부(선지급 차단, hondi-advance-rate.js veto 플래그로 전달)'],
    });
  }

  const unresolvedEncumbrances = (Array.isArray(registry.unresolved_encumbrances) ? registry.unresolved_encumbrances : [])
    .filter(x => x && UNRESOLVED_ENCUMBRANCE_TYPES.includes(x.type) && x.evidence && evidenceOk({ value: 1, ...x.evidence }));
  if (unresolvedEncumbrances.length > 0) {
    const labels = unresolvedEncumbrances.map(x => UNRESOLVED_ENCUMBRANCE_LABEL[x.type] || x.type).join(', ');
    return Object.freeze({
      rejected: true, assumed_burden_deduction: 0, third_party_lien_total: 0, sigma_individual: null,
      registry_flags: { unknown_senior_claims: false, high_severity_legal_issue: true },
      reasons: [
        `등기부 확인됨(출처: ${registry.confirmed.source}, 조회일 ${registry.confirmed.asof})`,
        `중대 법적 쟁점 확인됨(${labels}) → 말소기준권리 순위 판정은 이 코드의 범위 밖이라 전체 거부` +
          '(K-Law·변호사 상담 필요, hondi-advance-rate.js VETO_FLAGS.high_severity_legal_issue로 전달)',
      ],
    });
  }

  const sumEvidenced = list => (Array.isArray(list) ? list : [])
    .filter(x => Number.isFinite(x.amount) && x.amount > 0 && evidenceOk({ value: x.amount, ...x.evidence }))
    .reduce((s, x) => s + Math.round(x.amount), 0);
  const assumed_burden_deduction = sumEvidenced(registry.assumed_burdens);
  const third_party_lien_total = sumEvidenced(registry.third_party_liens);

  const adoptedDefects = (Array.isArray(defects) ? defects : []).filter(d => d.evidence && evidenceOk({ value: 1, ...d.evidence }));
  const defectSigmas = adoptedDefects.map(d => INDIVIDUAL_DEFECT_SEVERE_TYPES.includes(d.type) ? INDIVIDUAL_DEFECT_SIGMA_SEVERE : INDIVIDUAL_DEFECT_SIGMA);
  const sigma_individual = combineSigma([INDIVIDUAL_SIGMA_NONE, ...defectSigmas]);
  const severeCount = adoptedDefects.filter(d => INDIVIDUAL_DEFECT_SEVERE_TYPES.includes(d.type)).length;

  return Object.freeze({
    rejected: false, assumed_burden_deduction, third_party_lien_total, sigma_individual,
    registry_flags: { unknown_senior_claims: false, high_severity_legal_issue: false },
    reasons: [
      `등기부 확인됨(출처: ${registry.confirmed.source}, 조회일 ${registry.confirmed.asof})`,
      '가압류·가처분·유치권 없음(또는 미확인 — 확인됐다면 위에서 이미 거부됨)',
      assumed_burden_deduction > 0 ? `인수 부담(선순위 임차보증금 등) ${assumed_burden_deduction.toLocaleString()}원 → 공정가치에서 차감` : '인수 부담 없음',
      third_party_lien_total > 0 ? `제3자 근저당 ${third_party_lien_total.toLocaleString()}원 → 자산 공정가치는 그대로, 대출 담보가치(분배 순대금)에서만 차감 예정` : '제3자 근저당 없음',
      `물리적 하자 등 개별 위험 요인 ${adoptedDefects.length}건 채택(σ 가산, 그중 건축 제약형 ${severeCount}건)`,
    ],
  });
}

// ───────────────────────────── 종합 ─────────────────────────────

/**
 * 세 단계를 종합해 mediationEstimate/lendingEstimate에 넣을 fair_value·sigma를 만든다.
 * 순서: 국가(지수보정, 사례별) → 중앙값 → 지역(가격수준비, 배율) → 개별(인수 부담 차감, 금액).
 * 제3자 근저당은 여기서 빼지 않는다 — 대출 트랙 산출 후 deductLienFromCollateral로 별도 처리한다.
 */
export function stagedValuation({ comps, valuation_index = null, index_series = null, valuation_date, regional = {}, registry, defects = [], model_version, property_type = null, subject_floor = null }) {
  if (typeof model_version !== 'string' || !model_version) throw new RangeError('model_version이 필요합니다');

  // ⑦ 물건 유형 범위 가드 — 지원하지 않는 유형이면 계산 자체를 하지 않는다(valuation-methodology.md §9).
  const scope = propertyScopeCheck(property_type);
  if (scope && !scope.supported) {
    return Object.freeze({
      model_version, valuation_date, rejected: true, out_of_scope: true, fair_value: null, sigma: null,
      registry_flags: { unknown_senior_claims: false, high_severity_legal_issue: false },
      stages: null,
      reasons: [scope.reason, '평가 범위 밖 물건이라 값을 산출하지 않음(등기부 미확인·법적 쟁점 거부와는 다른 사유 — veto 플래그 없음)'],
    });
  }

  // ⑥ 층 비교 — 국가 단계 전에 비교사례를 선별한다(comps 형식 오류는 아래 nationalAdjustment가 그대로 던진다).
  const floor = Array.isArray(comps) ? floorComparison({ comps, subject_floor }) : null;
  const national = nationalAdjustment({ comps: floor ? floor.comps : comps, valuation_index, index_series, valuation_date });
  const median_after_national = median(national.adjusted_prices);
  const regionalResult = regionalAdjustment(regional);
  const before_individual = Math.round(median_after_national * regionalResult.central_multiplier);
  const individualResult = individualAdjustment({ registry, defects });
  const floorReasons = floor ? floor.reasons : [];

  if (individualResult.rejected) {
    return Object.freeze({
      model_version, valuation_date, rejected: true, fair_value: null, sigma: null,
      registry_flags: individualResult.registry_flags,
      stages: { national, regional: regionalResult, individual: individualResult, floor },
      reasons: [...floorReasons, ...national.reasons, ...regionalResult.reasons, ...individualResult.reasons, '개별 단계 거부로 전체 가치평가를 산출하지 않음(선지급은 veto 플래그로 별도 차단됨)'],
    });
  }
  const fair_value = Math.max(0, before_individual - individualResult.assumed_burden_deduction);
  // 층은 개별요인이므로 σ_개별에 합성한다: σ_개별' = √(σ_개별² + σ_층²) — 층 정보가 없으면 σ_층=0이라 기존 결과와 같다.
  const sigma_individual_total = combineSigma([individualResult.sigma_individual, floor ? floor.sigma_floor : 0]);
  const sigma = combineSigma([national.sigma_national, regionalResult.sigma_regional, sigma_individual_total]);
  return Object.freeze({
    model_version, valuation_date, rejected: false, fair_value, sigma,
    third_party_lien_total: individualResult.third_party_lien_total,
    registry_flags: individualResult.registry_flags,
    stages: { national, regional: regionalResult, individual: individualResult, floor },
    reasons: [
      ...floorReasons, ...national.reasons, ...regionalResult.reasons, ...individualResult.reasons,
      `종합: 국가 보정 후 중앙값 ${median_after_national.toLocaleString()}원 → 지역 배율 ${regionalResult.central_multiplier.toFixed(4)} → ${before_individual.toLocaleString()}원 → 개별 인수부담 차감 → 공정가치 ${fair_value.toLocaleString()}원, σ=${sigma.toFixed(4)}(=√(σ국가²+σ지역²+σ개별²), 개별에 층 σ 포함)`,
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
