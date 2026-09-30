/**
 * hondi-doctor-verdict.js — K-Doctor 진단 참고 결과의 결정론적 검증기 (2026-09-30 신설)
 *
 * 역할: SP-29(총괄)가 낸 [DIAGNOSIS_REPORT] JSON을 LLM 말이 아니라 코드로 다시 계산·제한한다.
 * K-Estate의 hondi-staged-valuation.js와 같은 원칙 — "LLM은 계산하지 않고, 코드가 다시 계산해 그 값을 채택한다."
 *
 *   ① 종합 확신도 = min(임상, 정보). SP가 낸 claimed_kind·종합값은 참고로만 기록하고 버린다.
 *   ② 결론 유형: <4 deferred / 4~6 conditional / 7~10 confirmed. 위험 신호가 있으면 확신도와 무관하게
 *      emergency_referral 강제(SP-29 규칙 1).
 *   ③ 미배제 can't-miss(must_not_miss이면서 반대 근거가 없는 가설)가 남으면 confirmed → conditional로 낮춘다.
 *   ④ 근거 유형(history/image/measurement/guideline/consult)이 없는 항목은 버린다(규칙 4).
 *   ⑤ 용량은 text·source·asof가 모두 있어야 남긴다(규칙 5). 소아는 체중 확인값이 없으면 용량을 제거한다.
 *      생후 3개월 미만에는 자가관리·일반의약품 제안을 제거한다(SP-29c 소아 규칙 2).
 *   ⑥ prescription_drug·procedure는 requires_clinician=true로 강제(SP-29 B-3).
 *   ⑦ 사용자 층위: 현재 단계(2026-09-30 결정)는 "모든 사용자가 의료인"이라고 가정한다 —
 *      VERIFICATION_ENFORCED=false이면 신호와 무관하게 전문가 뷰. 면허 검증 메커니즘을 붙이는 최종 단계에서
 *      이 상수를 true로 바꾸면(또는 opts.enforce=true) 인증된 의료인 신호(verified_clinician === true,
 *      level ≠ L0)일 때만 전문가 뷰, 그 외는 환자 참조 뷰(ICD-10·용량·협진 요약·전문의약품 세부 제거)로
 *      동작한다. 환자 참조 뷰 코드는 남겨 두었고 테스트로 검증돼 있다. 자기 진술은 신호가 아니다.
 *   ⑧ 진단서·처방전·"확진"·"퇴원"·"완치 판정" 문구가 있으면 결과를 무효(ok:false)로 표시한다(규칙 2·10).
 *   ⑨ 케이스 단계 전이 표(intake→…→resolved/referred/closed)를 검증한다.
 *
 * 하지 않는 것: 임상 판단(병명 선택·용량 계산)을 하지 않는다. 검증·제한만 한다. LLM이 실제 대화에서 이 SP의
 * 규칙을 지키는지는 이 모듈이 보장하지 않는다(design-notes 참조 — 실행 검증 CLI는 아직 없다).
 */

export const VALID_BASIS = Object.freeze(['history', 'image', 'measurement', 'guideline', 'consult']);
export const TRIAGE_LEVELS = Object.freeze(['emergency', 'urgent', 'routine']);
export const TREATMENT_KINDS = Object.freeze(['self_care', 'otc', 'prescription_drug', 'procedure', 'referral']);
export const DEFER_BELOW = 4;      // 종합 < 4 → deferred
export const CONFIRM_FROM = 7;     // 종합 ≥ 7 → confirmed
export const INFANT_MIN_AGE_YEARS = 0.25; // 생후 3개월(근사)

const FORBIDDEN_ISSUANCE = /(진단서|처방전|소견서|진료확인서|확진)/;
const FORBIDDEN_CLOSURE = /(퇴원|완치\s*판정)/;

// ─────────────────────────── 기본 헬퍼 ───────────────────────────

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const clamp10 = (x) => (isNum(x) ? Math.min(10, Math.max(0, x)) : 0); // 값이 없거나 이상하면 0(안전 쪽)

/** 'YYYY-MM-DD' 실제 달력 날짜인지. */
export function isValidDateString(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** 종합 확신도 = min(임상, 정보). 비정상 값은 0으로 처리(안전 쪽). */
export function combinedConfidence(conf) {
  const c = clamp10(conf?.clinical);
  const i = clamp10(conf?.information);
  return Math.min(c, i);
}

/** 종합 확신도 → 결론 유형(위험 신호·can't-miss 보정 전 기본 분기). */
export function baseKind(overall) {
  if (overall < DEFER_BELOW) return 'deferred';
  if (overall < CONFIRM_FROM) return 'conditional';
  return 'confirmed';
}

/** 근거 유형이 유효한 항목만 남긴다. 버린 개수를 함께 돌려준다. */
export function filterByBasis(items) {
  const arr = Array.isArray(items) ? items : [];
  const kept = arr.filter((it) => it && VALID_BASIS.includes(it.basis) && typeof it.text === 'string' && it.text.trim() !== '');
  return { kept, dropped: arr.length - kept.length };
}

/** 용량이 채택 가능한가: text·source 비어 있지 않고 asof가 실제 날짜. */
export function doseOk(dose) {
  return !!dose && typeof dose.text === 'string' && dose.text.trim() !== ''
    && typeof dose.source === 'string' && dose.source.trim() !== '' && isValidDateString(dose.asof);
}

/**
 * 면허 검증 강제 여부. false = 모든 사용자를 의료인으로 가정(현재 단계). 면허 검증 경로를 붙이는 최종 단계에서 true로.
 * 함수별 opts.enforce로 덮어쓸 수 있다(테스트·점진 배포용).
 */
export const VERIFICATION_ENFORCED = false;

/** 의료인 뷰를 받을 자격. 강제 전에는 모두 true, 강제 후에는 플랫폼 신호로만 판단한다. */
export function isVerifiedClinician(audience, opts = {}) {
  const enforce = opts.enforce ?? VERIFICATION_ENFORCED;
  if (!enforce) return true;
  return !!audience && audience.verified_clinician === true
    && typeof audience.level === 'string' && ['L1', 'L2', 'L3'].includes(audience.level);
}

/** 위험 신호가 있는가: triage.level=emergency 이거나 red_flags 항목이 하나라도 있다. */
export function hasRedFlag(report) {
  const t = report?.triage;
  if (!t) return false;
  if (t.level === 'emergency') return true;
  return Array.isArray(t.red_flags) && t.red_flags.length > 0;
}

/** 미배제 can't-miss: must_not_miss이면서 반대 근거(유효 basis)가 하나도 없는 가설 목록. */
export function unresolvedMustNotMiss(hypotheses) {
  return (Array.isArray(hypotheses) ? hypotheses : []).filter(
    (h) => h && h.must_not_miss === true && filterByBasis(h.against).kept.length === 0);
}

// ─────────────────────────── 핵심: 검증·재계산 ───────────────────────────

/**
 * @param {object} report  [DIAGNOSIS_REPORT] 파싱 결과(SP 제출)
 * @param {object} audience 플랫폼 신호 { level, verified_clinician }
 * @returns {{ ok:boolean, errors:string[], changes:string[], kind:string, overall:number,
 *             claimed_kind:string|null, report:object }}
 *  ok=false: 형식·금지 문구 위반으로 결과를 그대로 쓰면 안 됨(재생성 또는 판단 유보 + 대면 진료 권고).
 *  report: 코드가 정리한 사본(원본 불변). 층위 제한은 audienceView가 따로 적용한다.
 */
export function validateDiagnosis(report, audience, opts = {}) {
  const errors = [];
  const changes = [];
  if (!report || typeof report !== 'object') {
    return { ok: false, errors: ['report_missing'], changes, kind: 'deferred', overall: 0, claimed_kind: null,
      report: failSafeReport('report_missing') };
  }
  const r = JSON.parse(JSON.stringify(report));
  const claimed = r.final?.claimed_kind ?? null;

  // 1) 금지 문구(진단서·처방전·확진 / 퇴원·완치 판정)
  const textBlob = JSON.stringify([r.summary_clinical, r.summary_plain, r.final, r.plan, r.warnings]);
  if (FORBIDDEN_ISSUANCE.test(textBlob)) errors.push('forbidden_issuance_wording');
  if (FORBIDDEN_CLOSURE.test(textBlob)) errors.push('forbidden_closure_wording');

  // 2) 근거 유형 필터(규칙 4)
  r.hypotheses = (Array.isArray(r.hypotheses) ? r.hypotheses : []).map((h) => {
    const s = filterByBasis(h?.supports);
    const a = filterByBasis(h?.against);
    if (s.dropped || a.dropped) changes.push(`hypothesis[${h?.name ?? '?'}]: 근거 유형 없는 항목 ${s.dropped + a.dropped}건 제거`);
    return { ...h, supports: s.kept, against: a.kept };
  });
  // 지지 근거가 하나도 없고 can't-miss도 아닌 가설은 채택 불가
  const before = r.hypotheses.length;
  r.hypotheses = r.hypotheses.filter((h) => h.supports.length > 0 || h.must_not_miss === true);
  if (r.hypotheses.length !== before) changes.push(`지지 근거 없는 가설 ${before - r.hypotheses.length}건 제거`);

  // 3) 계획 정리
  const plan = r.plan ?? {};
  const age = isNum(r.patient?.age_years) ? r.patient.age_years : null;
  const weightOk = isNum(r.patient?.weight_kg) && r.patient.weight_kg > 0;
  const isChild = age !== null && age < 18;
  const isInfant = age !== null && age < INFANT_MIN_AGE_YEARS;
  const emergency = hasRedFlag(r);

  plan.tests = (Array.isArray(plan.tests) ? plan.tests : []).filter((t) => {
    const okBasis = t && typeof t.basis === 'string' && t.basis.trim() !== '' && typeof t.name === 'string' && t.name.trim() !== '';
    if (!okBasis) changes.push('근거 없는 검사 제안 1건 제거');
    return okBasis;
  });

  plan.treatments = (Array.isArray(plan.treatments) ? plan.treatments : []).flatMap((t) => {
    if (!t || !TREATMENT_KINDS.includes(t.kind) || typeof t.description !== 'string' || t.description.trim() === '') {
      changes.push('형식이 잘못된 처치 제안 1건 제거');
      return [];
    }
    if (typeof t.basis !== 'string' || t.basis.trim() === '') {
      changes.push(`처치 제안(${t.kind}) 근거 없음 → 제거`);
      return [];
    }
    if (emergency && (t.kind === 'prescription_drug' || t.kind === 'procedure' || t.kind === 'otc')) {
      changes.push(`위험 신호 → ${t.kind} 제안 제거(응급실 평가 후 결정)`);
      return [];
    }
    if (isInfant && (t.kind === 'self_care' || t.kind === 'otc')) {
      changes.push('생후 3개월 미만 → 자가관리·일반의약품 제안 제거(대면 진료)');
      return [];
    }
    const out = { ...t };
    if (out.kind === 'prescription_drug' || out.kind === 'procedure') {
      if (out.requires_clinician !== true) changes.push(`${out.kind} requires_clinician=true 강제`);
      out.requires_clinician = true;
    }
    if (out.dose !== undefined) {
      if (!doseOk(out.dose)) { delete out.dose; changes.push('출처·조회일 없는 용량 제거'); }
      else if (isChild && !weightOk) { delete out.dose; changes.push('소아 + 체중 확인값 없음 → 용량 제거'); }
    }
    return [out];
  });
  if (!plan.followup || typeof plan.followup !== 'object') plan.followup = { reassess_in_days: null, return_if: [] };
  r.plan = plan;

  // 4) 확신도 재계산과 결론 유형
  const overall = combinedConfidence(r.confidence);
  let kind = baseKind(overall);
  if (emergency) {
    kind = 'emergency_referral';
    if (r.triage.level !== 'emergency') { r.triage.level = 'emergency'; changes.push('위험 신호 → triage.level=emergency 강제'); }
  } else {
    const unresolved = unresolvedMustNotMiss(r.hypotheses);
    if (kind === 'confirmed' && unresolved.length > 0) {
      kind = 'conditional';
      changes.push(`미배제 can't-miss ${unresolved.length}건 → confirmed를 conditional로 하향`);
    }
    if (claimed === 'emergency_referral') {
      // SP가 응급이라 했는데 위험 신호 항목이 없다 → 근거 없는 응급 주장. 안전 쪽으로 유지하되 기록한다.
      kind = 'emergency_referral';
      changes.push('SP가 emergency_referral을 제출 — 근거 항목은 없으나 안전 쪽으로 유지');
    }
  }
  if (claimed && claimed !== kind) changes.push(`결론 유형 재계산: SP 제출 ${claimed} → 코드 ${kind}`);

  // 5) 결론 정합성: primary가 가설 목록에 있는지(있어야 confirmed/conditional에서 근거를 추적 가능)
  r.final = r.final ?? {};
  r.final.claimed_kind = claimed;
  r.final.kind = kind;
  if ((kind === 'confirmed' || kind === 'conditional') && r.final.primary?.name) {
    if (!r.hypotheses.some((h) => h.name === r.final.primary.name)) {
      errors.push('primary_not_in_hypotheses');
    }
  }
  if ((kind === 'confirmed' || kind === 'conditional') && !r.final.primary?.name) errors.push('primary_missing');
  if (kind === 'deferred' || kind === 'emergency_referral') {
    if (r.final.primary?.name) { changes.push(`${kind}: primary 제거`); }
    r.final.primary = { name: '', icd10: '' };
  }

  // 6) 복귀 기준(재평가·응급 외에는 필수)
  if (kind !== 'emergency_referral' && (!Array.isArray(r.plan.followup.return_if) || r.plan.followup.return_if.length === 0)) {
    errors.push('return_if_missing');
  }

  r.confidence = { clinical: clamp10(r.confidence?.clinical), information: clamp10(r.confidence?.information), overall };
  r.audience_signal = { level: audience?.level ?? 'L0', verified_clinician: isVerifiedClinician(audience, opts), assumed: !(opts.enforce ?? VERIFICATION_ENFORCED) ? true : undefined };

  return { ok: errors.length === 0, errors, changes, kind, overall, claimed_kind: claimed, report: r };
}

function failSafeReport(reason) {
  return {
    model_version: 'SP-29-v0.1', final: { claimed_kind: null, kind: 'deferred', primary: { name: '', icd10: '' }, alternatives: [] },
    hypotheses: [], plan: { tests: [], treatments: [{ kind: 'referral', description: '대면 진료를 받으세요', requires_clinician: false, basis: 'guideline' }], followup: { reassess_in_days: null, return_if: [] } },
    summary_clinical: '판단 유보(검증 실패). 대면 진료 권고.', summary_plain: '지금은 판단하기 어렵습니다. 가까운 병원에서 진료를 받아 보세요. 숨쉬기 어렵거나 의식이 흐리면 바로 119에 연락하세요.',
    warnings: [reason],
  };
}

// ─────────────────────────── 사용자 층위 뷰 ───────────────────────────

/**
 * validateDiagnosis가 돌려준 report를 사용자 층위에 맞게 줄인다.
 * 인증된 의료인: 전체(단, 용량은 이미 출처 검증 통과분만). 그 외: 환자 참조 뷰.
 * 위험 신호(emergency)는 어떤 층위에서도 전부 보여 준다.
 */
export function audienceView(validated, audience, opts = {}) {
  const r = JSON.parse(JSON.stringify(validated.report));
  if (isVerifiedClinician(audience, opts)) {
    return { view: 'clinician', report: r };
  }
  const drop = [];
  for (const h of r.hypotheses ?? []) {
    delete h.icd10; delete h.supports; delete h.against; drop.push('icd10/근거 상세');
  }
  if (r.final?.primary) delete r.final.primary.icd10;
  for (const a of r.final?.alternatives ?? []) delete a.icd10;
  r.specialties_consulted = (r.specialties_consulted ?? []).map((s) => ({ id: s.id })); // 협진 요약 제거
  r.plan.treatments = (r.plan.treatments ?? []).map((t) => {
    const o = { ...t };
    delete o.dose;
    if (o.kind === 'prescription_drug') o.description = '의사 처방이 필요합니다';
    else if (o.kind === 'procedure') o.description = '의사의 처치가 필요합니다';
    return o;
  });
  delete r.summary_clinical;
  delete r.patient?.weight_kg;
  r.audience_signal = { level: audience?.level ?? 'L0', verified_clinician: false };
  return { view: 'patient_reference', report: r };
}

// ─────────────────────────── 케이스 단계 전이 ───────────────────────────

export const CASE_STAGES = Object.freeze(['intake', 'triaged', 'consulting', 'assessed', 'following', 'reassessed', 'resolved', 'referred', 'closed']);
export const TERMINAL_STAGES = Object.freeze(['resolved', 'referred', 'closed']);
const TRANSITIONS = {
  intake: ['triaged', 'referred', 'closed'],
  triaged: ['consulting', 'assessed', 'referred', 'closed'],
  consulting: ['assessed', 'referred', 'closed'],
  assessed: ['following', 'referred', 'closed'],
  following: ['reassessed', 'referred', 'closed'],
  reassessed: ['following', 'resolved', 'referred', 'closed'],
  resolved: ['reassessed'],   // 증상 재발 시 같은 케이스에서 이어감(SP-29 F-2)
  referred: [],
  closed: [],
};

export function canTransition(from, to) {
  return Array.isArray(TRANSITIONS[from]) && TRANSITIONS[from].includes(to);
}

/** 단계 전이 검증. 잘못된 전이는 { ok:false, reason }. 'resolved'는 재평가(reassessed)를 거쳐야만 갈 수 있다. */
export function transitionCase(state, to) {
  if (!state || !CASE_STAGES.includes(state.stage)) return { ok: false, reason: 'unknown_stage' };
  if (!CASE_STAGES.includes(to)) return { ok: false, reason: 'unknown_target' };
  if (!canTransition(state.stage, to)) return { ok: false, reason: `illegal_transition:${state.stage}->${to}` };
  return { ok: true, state: { ...state, stage: to } };
}
