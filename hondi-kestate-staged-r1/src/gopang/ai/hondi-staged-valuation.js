/**
 * hondi-staged-valuation.js — 3단계 가치평가(국가 → 지역 → 개별): 웹 검색 증거의 검증·결정적 계산·조정 (2026-09-28 신설)
 *
 * 지시(주피터님, 2026-09-28): 가격 추정에 국가 위험(부동산 경기 변동) → 지역 위험(인구 감소·재개발·학교 등 인프라) →
 * 개별 위험(근저당 등 권리 관계) 단계를 두고, 세 데이터(공개된 부동산 가격지수·인구 통계·정비구역 목록)는 웹 검색으로 얻는다.
 * 세 단계는 감정평가법의 조정 순서(시점수정 → 지역요인 비교 → 개별요인 비교)와 같다.
 *
 * 역할 분담(이 파일의 핵심 설계): 웹 검색·자료 해석은 SP(prompts/SP-24a_kestate_appraisal_v0_1.txt, LLM)가 하지만
 * LLM은 계산하지 않는다 — "원자료 수치 + 출처 증거"만 제출한다. 이 파일이 그 증거를 검증하고 조정계수·불확실성·차감액을
 * 결정적으로 다시 계산한다. LLM이 낸 계수(claimed_*)는 무시한다(불일치는 플래그로 기록).
 *   · 출처·조회일·기준일이 없는 수치는 채택하지 않는다(그 단계는 unavailable로 두고 불확실성을 키운다 — 지어내지 않는다).
 *   · 당사자 주장(origin='party_claim')은 증거가 아니다.
 *
 * 세 단계가 하는 일(그리고 하지 않는 일):
 *   국가(시점수정): 시장 지수의 (현재값 / 비교사례 시점값)으로 중앙 추정을 현재 시점으로 옮긴다. 지수 시계열이 있으면 연변동성을 실측한다.
 *   지역(지역요인 비교): 중앙 추정을 움직이는 것은 "비교사례 지역 대비 대상 지역의 가격 수준비"(같은 출처의 관측치)뿐이다.
 *     인구 감소·정비구역·인프라 같은 정성 위험은 중앙 추정을 움직이지 않고 불확실성(σ)만 키운다 — 지역 지수에 이미 반영된 것을 다시
 *     반영하는 이중 계산과, 보정되지 않은 계수를 지어내는 것을 모두 피하기 위해서다. (σ는 중재·대출 두 트랙에 다르게 쓰인다.)
 *   개별(개별요인 비교 + 권리 차감): 인수되는 부담(선순위 임차보증금 등)은 매수인이 값에 반영하므로 공정가치에서 뺀다.
 *     제3자 근저당은 매각 대금에서 먼저 변제되므로 자산 가치가 아니라 "분배 가능한 순대금"을 줄인다 — 대출 트랙의 담보에서만 뺀다.
 *     등기부가 없으면 선순위 권리 불명(거부 조건)으로 처리한다.
 *
 * ★ σ 가산 사전값(REGIONAL_SIGMA_PRIORS 등)과 정비 단계표는 가정이며 보정되지 않았다. 백테스트로 다시 맞춘다.
 *   구간·경계·사전값은 돈의 한도에 영향을 주므로 자동 갱신 대상이 아니고 사람이 코드로만 바꾼다.
 */
import { estimateSigma } from './hondi-advance-rate.js';
import { mediationEstimate, lendingEstimate, assertSeparation } from './hondi-valuation-tracks.js';

export const STAGED_SCHEMA = 'kestate-staged-valuation/1';
export const MAX_INDEX_AGE_DAYS = 120;          // 지수 기준일이 평가 기준일보다 이만큼 오래되면 stale
export const MAX_REGISTRY_AGE_DAYS = 30;        // 등기부 열람일이 이만큼 오래되면 stale
export const TIME_ADJUST_BOUNDS = [0.6, 1.4];
export const REGIONAL_FACTOR_BOUNDS = [0.5, 2.0];
export const DEFAULT_ANNUAL_VOL = 0.06;
export const NATIONAL_SIGMA_UNAVAILABLE = 0.04; // 지수를 못 구했을 때(사례 시점 이후 시세 변화를 모른다)
export const NATIONAL_SIGMA_STALE = 0.02;
export const REGIONAL_SIGMA_PRIORS = Object.freeze({
  base: 0.02, depopulation_designated: 0.02, population_decline: 0.01, school_or_transit_loss: 0.01, evidence_missing: 0.03,
});
/** 정비사업 단계별 불확실성 — 초기(구역 지정 전후)일수록 실현 여부·시기가 불확실하다(가정). */
export const REDEVELOPMENT_SIGMA = Object.freeze({
  none: 0, unknown: 0.03, designated: 0.03, committee: 0.03, association: 0.025, project_approved: 0.02, management_disposal: 0.015, construction: 0.01,
});
export const INDIVIDUAL_SIGMA_PRIORS = Object.freeze({ base: 0.01, rights_unverified: 0.05, registry_stale: 0.02, seizure_or_injunction: 0.02, physical_issues: 0.02 });

const DAY = 86_400_000;
const isoDate = s => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number), t = new Date(Date.UTC(y, m - 1, d));   // Date.parse는 2026-02-31을 3월 3일로 넘겨 통과시킨다 — 달력으로 왕복 검증
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);   // b − a
const clamp = (x, [lo, hi]) => Math.min(hi, Math.max(lo, x));
const quad = parts => Math.sqrt(parts.reduce((s, x) => s + x * x, 0));
const posMoney = v => Number.isSafeInteger(v) && v >= 0;

/** 웹 검색 증거의 최소 요건: 출처명·URL·조회일·기준일. 당사자 주장은 거부. */
export function validEvidence(ev) {
  const problems = [];
  if (!ev || typeof ev !== 'object') return { ok: false, problems: ['증거 객체가 없습니다'] };
  if (typeof ev.source_name !== 'string' || !ev.source_name.trim()) problems.push('source_name 누락');
  if (typeof ev.source_url !== 'string' || !/^https?:\/\/[^\s/]+\.[^\s/]+/.test(ev.source_url)) problems.push('source_url이 올바른 URL이 아닙니다');
  if (!isoDate(ev.retrieved_at)) problems.push('retrieved_at(YYYY-MM-DD) 누락·형식 오류');
  if (!isoDate(ev.basis_date)) problems.push('basis_date(YYYY-MM-DD) 누락·형식 오류');
  if (isoDate(ev.retrieved_at) && isoDate(ev.basis_date) && daysBetween(ev.basis_date, ev.retrieved_at) < 0) problems.push('retrieved_at이 basis_date보다 앞섭니다');
  if (ev.origin === 'party_claim') problems.push('당사자 주장은 증거로 인정하지 않습니다');
  return { ok: problems.length === 0, problems };
}

/** 국가 단계 — 시점수정. 원자료(지수 값)만 받아 계수를 다시 계산한다. */
export function nationalStage(n, as_of) {
  const out = { stage: 'national', status: 'unavailable', time_adjust_factor: 1, annual_vol: DEFAULT_ANNUAL_VOL, annual_vol_source: 'default', sigma_extra: NATIONAL_SIGMA_UNAVAILABLE, problems: [], flags: [] };
  if (!n?.index) { out.flags.push('national_index_missing'); return out; }
  const ev = validEvidence(n.index);
  if (!ev.ok) { out.status = 'invalid'; out.problems = ev.problems; out.flags.push('national_evidence_invalid'); return out; }
  const a = n.index.value_at_comps, b = n.index.value_now;
  if (!(Number.isFinite(a) && a > 0 && Number.isFinite(b) && b > 0)) { out.status = 'invalid'; out.problems = ['지수 값(value_at_comps, value_now)이 양수가 아닙니다']; out.flags.push('national_values_invalid'); return out; }
  const age = daysBetween(n.index.basis_date, as_of);
  if (age < 0) { out.status = 'invalid'; out.problems = ['지수 기준일이 평가 기준일보다 미래입니다']; out.flags.push('national_basis_in_future'); return out; }
  let f = b / a;
  if (n.claimed_factor != null && Math.abs(n.claimed_factor - f) > 0.005) out.flags.push('claimed_factor_mismatch');   // LLM의 계수는 채택하지 않는다
  const bounded = clamp(f, TIME_ADJUST_BOUNDS);
  if (bounded !== f) { out.flags.push('time_adjust_clamped'); f = bounded; }
  out.time_adjust_factor = f;
  out.status = age > MAX_INDEX_AGE_DAYS ? 'stale' : 'ok';
  out.sigma_extra = out.status === 'stale' ? NATIONAL_SIGMA_STALE : 0;
  if (out.status === 'stale') out.flags.push('national_index_stale');
  if (Array.isArray(n.series)) {
    if (n.series.length >= 13 && n.series.every(v => Number.isFinite(v) && v > 0)) {
      const r = []; for (let i = 1; i < n.series.length; i++) r.push(Math.log(n.series[i] / n.series[i - 1]));
      const mu = r.reduce((s, x) => s + x, 0) / r.length, sd = Math.sqrt(r.reduce((s, x) => s + (x - mu) ** 2, 0) / (r.length - 1));
      out.annual_vol = clamp(sd * Math.sqrt(12), [0.02, 0.30]); out.annual_vol_source = 'series';
    } else out.flags.push('series_unusable');
  }
  out.regime = ['rising', 'flat', 'falling'].includes(n.regime) ? n.regime : 'unknown';
  return out;
}

/** 지역 단계 — 지역요인 비교(가격 수준비)만 중앙 추정을 움직인다. 정성 위험은 σ만 키운다. */
export function regionalStage(r = {}, as_of) {
  const out = { stage: 'regional', regional_factor: 1, sigma_regional: 0, items_valid: 0, components: [], problems: [], flags: [] };
  const parts = [REGIONAL_SIGMA_PRIORS.base];
  const take = (label, item, fn) => {
    if (item == null) { out.flags.push(`${label}_missing`); return false; }
    const ev = validEvidence(item);
    if (!ev.ok) { out.problems.push(...ev.problems.map(p => `${label}: ${p}`)); out.flags.push(`${label}_evidence_invalid`); return false; }
    out.items_valid++; fn(item); return true;
  };
  take('level_ratio', r.level_ratio, it => {
    const s = it.subject_level, c = it.comps_level;
    if (Number.isFinite(s) && s > 0 && Number.isFinite(c) && c > 0) {
      let f = s / c; const b = clamp(f, REGIONAL_FACTOR_BOUNDS); if (b !== f) { out.flags.push('regional_factor_clamped'); f = b; }
      out.regional_factor = f; out.components.push({ item: 'level_ratio', effect: 'central', value: f });
    } else { out.problems.push('level_ratio: 지역 수준 값이 양수가 아닙니다'); out.items_valid--; }
  });
  take('population', r.population, it => {
    if (it.depopulation_designated === true) { parts.push(REGIONAL_SIGMA_PRIORS.depopulation_designated); out.components.push({ item: 'depopulation_designated', effect: 'sigma', value: REGIONAL_SIGMA_PRIORS.depopulation_designated }); }
    if (Number.isFinite(it.yoy_change) && it.yoy_change <= -0.01) { parts.push(REGIONAL_SIGMA_PRIORS.population_decline); out.components.push({ item: 'population_decline', effect: 'sigma', value: REGIONAL_SIGMA_PRIORS.population_decline }); }
  });
  const redevOk = take('redevelopment', r.redevelopment, it => {
    const st = Object.hasOwn(REDEVELOPMENT_SIGMA, it.status) ? it.status : 'unknown';
    if (st === 'unknown' && it.status !== 'unknown') out.flags.push('redevelopment_status_unrecognized');
    parts.push(REDEVELOPMENT_SIGMA[st]); out.components.push({ item: `redevelopment:${st}`, effect: 'sigma', value: REDEVELOPMENT_SIGMA[st] });
  });
  if (!redevOk) { parts.push(REDEVELOPMENT_SIGMA.unknown); out.components.push({ item: 'redevelopment:unknown', effect: 'sigma', value: REDEVELOPMENT_SIGMA.unknown }); }   // 정비 여부를 모르면 그것 자체가 불확실성
  if (Array.isArray(r.infrastructure)) r.infrastructure.forEach((it, i) => take(`infrastructure[${i}]`, it, x => {
    if (['closing', 'planned_closing'].includes(x.change)) { parts.push(REGIONAL_SIGMA_PRIORS.school_or_transit_loss); out.components.push({ item: `infrastructure:${x.type ?? 'unknown'}`, effect: 'sigma', value: REGIONAL_SIGMA_PRIORS.school_or_transit_loss }); }
  }));
  if (out.items_valid === 0) { parts.push(REGIONAL_SIGMA_PRIORS.evidence_missing); out.flags.push('regional_evidence_missing'); }
  out.sigma_regional = quad(parts);
  return out;
}

/** 개별 단계 — 권리 관계. 인수 부담은 공정가치에서, 제3자 근저당은 대출 담보에서 뺀다. 등기부가 없으면 선순위 권리 불명. */
export function individualStage(i = {}, as_of) {
  const out = { stage: 'individual', assumed_burden: 0, third_party_liens: 0, sigma_individual: 0, veto_flags: { unresolved_title: false, unknown_senior_claims: false }, problems: [], flags: [] };
  const parts = [INDIVIDUAL_SIGMA_PRIORS.base];
  const rights = i.rights;
  const regOk = rights && rights.origin === 'registry_document' && isoDate(rights.viewed_at) && daysBetween(rights.viewed_at, as_of) >= 0;
  const unknown = why => { out.veto_flags.unknown_senior_claims = true; out.problems.push(why); out.flags.push('rights_unverified'); parts.push(INDIVIDUAL_SIGMA_PRIORS.rights_unverified); };
  if (!regOk) unknown('등기부 원본(origin=registry_document, viewed_at)이 없습니다');
  else {
    if (daysBetween(rights.viewed_at, as_of) > MAX_REGISTRY_AGE_DAYS) { out.flags.push('registry_stale'); parts.push(INDIVIDUAL_SIGMA_PRIORS.registry_stale); }
    const mort = Array.isArray(rights.mortgages) ? rights.mortgages : [];
    let liens = 0, bad = false;
    for (const m of mort) { if (!posMoney(m?.max_claim) || typeof m.is_third_party !== 'boolean') { bad = true; break; } if (m.is_third_party) liens += m.max_claim; }
    const tenant = rights.tenant_deposits_assumed ?? 0, other = rights.other_assumed_burden ?? 0;
    if (bad || !posMoney(tenant) || !posMoney(other)) unknown('권리 금액이 0 이상의 정수(원)가 아니거나 제3자 여부가 불분명합니다');
    else {
      out.third_party_liens = liens; out.assumed_burden = tenant + other;
      if ((rights.seizure_count ?? 0) > 0 || (rights.injunction_count ?? 0) > 0) { out.flags.push('seizure_or_injunction'); parts.push(INDIVIDUAL_SIGMA_PRIORS.seizure_or_injunction); }
    }
    if (rights.title_unresolved === true) out.veto_flags.unresolved_title = true;
  }
  if (i.title_unresolved === true) out.veto_flags.unresolved_title = true;                       // 상속 미확정 등은 어느 출처에서 알게 되든 거부 조건
  if (Array.isArray(i.physical?.issues) && i.physical.issues.length) { out.flags.push('physical_issues'); parts.push(INDIVIDUAL_SIGMA_PRIORS.physical_issues); }
  out.sigma_individual = quad(parts);
  return out;
}

function compStats(comps, as_of) {
  const ok = (Array.isArray(comps) ? comps : []).filter(c => Number.isSafeInteger(c?.price) && c.price > 0 && isoDate(c?.date) && daysBetween(c.date, as_of) >= 0);
  const n = ok.length, prices = ok.map(c => c.price).sort((x, y) => x - y);
  const median = n ? (n % 2 ? prices[(n - 1) / 2] : Math.round((prices[n / 2 - 1] + prices[n / 2]) / 2)) : null;
  let cv = null;
  if (n >= 2) { const mean = prices.reduce((s, x) => s + x, 0) / n; cv = Math.sqrt(prices.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) / mean; }
  const months_stale = n ? ok.reduce((s, c) => s + daysBetween(c.date, as_of), 0) / n / 30.44 : 0;
  return { n, median, cv, months_stale, dropped: (Array.isArray(comps) ? comps.length : 0) - n };
}

/**
 * 세 단계를 결합한다. 중앙 추정 = 비교사례 중앙값 × 시점수정 × 지역요인 − 인수 부담. σ는 사례 산포·시세 변동·모형 오차에
 * 세 단계의 추가 불확실성을 제곱합으로 더한다(estimateSigma).
 */
export function reconcile({ as_of, base, national, regional, individual, liquidity, days_to_sell = 60 }) {
  if (!isoDate(as_of)) throw new RangeError('as_of(YYYY-MM-DD)가 필요합니다');
  const flags = [], baseEv = validEvidence(base?.evidence);
  const stats = baseEv.ok ? compStats(base?.comps, as_of) : { n: 0, median: null, cv: null, months_stale: 0, dropped: 0 };
  if (!baseEv.ok) flags.push('comps_evidence_invalid');
  const nat = nationalStage(national, as_of), reg = regionalStage(regional, as_of), ind = individualStage(individual, as_of);
  let txn_12m = 0; const liqEv = validEvidence(liquidity);
  if (liqEv.ok && Number.isSafeInteger(liquidity.txn_12m) && liquidity.txn_12m >= 0) txn_12m = liquidity.txn_12m; else flags.push('liquidity_unverified');
  const stages = { national: nat, regional: reg, individual: ind };
  if (stats.n === 0) return { data_quality: 'insufficient', fair_value: null, sigma: null, comps: stats, stages, flags: [...flags, 'no_usable_comps'], problems: baseEv.problems };
  const central = stats.median * nat.time_adjust_factor * reg.regional_factor;
  const fair_value = Math.max(1, Math.round(central) - ind.assumed_burden);
  const sigma_extra_total = quad([nat.sigma_extra, reg.sigma_regional, ind.sigma_individual]);
  const sg = estimateSigma({ comps_count: stats.n, comps_cv: stats.cv, months_stale: stats.months_stale, days_to_sell, annual_vol: nat.annual_vol, extra_sigma: sigma_extra_total });
  const complete = nat.status === 'ok' && reg.items_valid >= 1 && !ind.veto_flags.unknown_senior_claims && stats.n >= 3 && liqEv.ok;
  return {
    data_quality: complete ? 'complete' : 'partial', as_of, fair_value, central_before_burden: Math.round(central),
    sigma: sg.sigma, sigma_parts: sg, sigma_extra_total,
    deductions: { assumed_burden: ind.assumed_burden, third_party_liens: ind.third_party_liens },
    veto_flags: ind.veto_flags, txn_12m, comps: stats, stages, flags: [...flags, ...nat.flags, ...reg.flags, ...ind.flags],
  };
}

/** SP가 낸 [STAGED_VALUATION]{...}[/STAGED_VALUATION] 블록을 파싱하고 스키마를 확인한다. */
export function parseStagedBlock(text) {
  const m = /\[STAGED_VALUATION\]([\s\S]*?)\[\/STAGED_VALUATION\]/.exec(String(text ?? ''));
  if (!m) throw new Error('[STAGED_VALUATION] 블록이 없습니다');
  let obj; try { obj = JSON.parse(m[1]); } catch (e) { throw new Error(`[STAGED_VALUATION] JSON 오류: ${e.message}`); }
  if (obj?.schema !== STAGED_SCHEMA) throw new Error(`스키마가 ${STAGED_SCHEMA}가 아닙니다 (받은 값: ${obj?.schema})`);
  return obj;
}

/**
 * 검증된 단계 결과에서 두 트랙 산출물을 만든다. 중재는 공정가치(σ 포함 구간), 대출은 같은 공정가치와 σ를 참조하되
 * 제3자 권리를 담보에서 차감하고 거부 조건을 반영한다. 두 트랙의 분리 규칙(assertSeparation)을 통과해야 한다.
 */
export function buildTracksFromStaged(staged, { annual_rate_bps, fee_bps = 0, ladder = null, min_confidence, stress = null, cap_bps, days_to_sell, model_versions = {} } = {}) {
  const r = reconcile({ ...staged, days_to_sell: days_to_sell ?? staged.days_to_sell ?? 60 });
  if (r.data_quality === 'insufficient') throw new Error(`추정 불가: 사용 가능한 비교사례가 없습니다 (${(r.problems ?? []).join('; ') || r.flags.join(',')})`);
  const mediation = mediationEstimate({
    point: r.fair_value, sigma: r.sigma, model_version: model_versions.mediation ?? 'med-staged-0.1',
    basis: `3단계(국가·지역·개별) — 사례 ${r.comps.n}건, 시점수정 ${r.stages.national.time_adjust_factor.toFixed(4)}, 지역요인 ${r.stages.regional.regional_factor.toFixed(4)}, 인수 부담 ${r.deductions.assumed_burden.toLocaleString('ko-KR')}원, 자료 상태 ${r.data_quality}`,
  });
  const lending = lendingEstimate({
    fair_value: r.fair_value,
    inputs: { txn_12m: r.txn_12m, comps_count: r.comps.n, comps_cv: r.comps.cv, months_stale: r.comps.months_stale, registry_flags: r.veto_flags },
    annual_rate_bps, fee_bps, ladder, stress, cap_bps, extra_sigma: r.sigma_extra_total, liens: r.deductions.third_party_liens,
    ...(min_confidence != null ? { min_confidence } : {}), model_version: model_versions.lending ?? 'lend-staged-0.1',
  });
  assertSeparation(mediation, lending);
  return { mediation, lending, staged: r };
}
