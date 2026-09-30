import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidDateString, combinedConfidence, baseKind, filterByBasis, doseOk, isVerifiedClinician,
  hasRedFlag, unresolvedMustNotMiss, VERIFICATION_ENFORCED, validateDiagnosis, audienceView,
  canTransition, transitionCase, CASE_STAGES,
} from '../../src/gopang/ai/hondi-doctor-verdict.js';

const CLIN = { level: 'L2', verified_clinician: true };
const PAT = { level: 'L0', verified_clinician: false };

const hyp = (over = {}) => ({
  name: '급성 상기도 감염', icd10: 'J06.9', must_not_miss: false, probability_band: 'high',
  supports: [{ text: '3일 인후통·콧물', basis: 'history' }],
  against: [{ text: '고열 없음', basis: 'history' }], ...over,
});
const base = (over = {}) => ({
  model_version: 'SP-29-v0.1', case_id: 'C1',
  patient: { age_years: 30, sex: 'F', pregnancy: 'no', weight_kg: 60 },
  chief_complaint: '인후통',
  triage: { level: 'routine', red_flags: [] },
  specialties_consulted: [{ id: 'kdoctor-internal', summary: '상기도 감염 가능성' }],
  hypotheses: [hyp()],
  final: { claimed_kind: 'confirmed', primary: { name: '급성 상기도 감염', icd10: 'J06.9' }, alternatives: [] },
  confidence: { clinical: 8, information: 7 },
  plan: {
    tests: [{ name: '체온 측정', purpose: '발열 확인', urgency: 'routine', basis: 'history' }],
    treatments: [
      { kind: 'self_care', description: '휴식과 수분 섭취', requires_clinician: false, basis: 'guideline' },
      { kind: 'prescription_drug', description: '항생제 필요 여부는 의사 판단', requires_clinician: false, basis: 'guideline',
        dose: { text: '1회 500mg', source: '의약품안전나라', asof: '2026-09-30' } },
    ],
    followup: { reassess_in_days: 3, return_if: ['38.5℃ 이상 고열이 이틀 지속'] },
  },
  summary_clinical: '상기도 감염 가능성이 가장 높은 진단 참고.', summary_plain: '감기일 가능성이 높습니다.', warnings: [], ...over,
});

// ── 헬퍼 ──
test('isValidDateString — 실제 달력 날짜만', () => {
  assert.equal(isValidDateString('2026-09-30'), true);
  assert.equal(isValidDateString('2026-02-30'), false);
  assert.equal(isValidDateString('2024-02-29'), true);
  assert.equal(isValidDateString('2026-9-3'), false);
  assert.equal(isValidDateString(null), false);
});

test('combinedConfidence — min, 범위 클램프, 이상값은 0', () => {
  assert.equal(combinedConfidence({ clinical: 8, information: 5 }), 5);
  assert.equal(combinedConfidence({ clinical: 12, information: 9 }), 9);
  assert.equal(combinedConfidence({ clinical: -3, information: 9 }), 0);
  assert.equal(combinedConfidence({ clinical: 'x', information: 9 }), 0);
  assert.equal(combinedConfidence(undefined), 0);
});

test('baseKind — 경계값 3.99/4/6.99/7', () => {
  assert.equal(baseKind(3.99), 'deferred');
  assert.equal(baseKind(4), 'conditional');
  assert.equal(baseKind(6.99), 'conditional');
  assert.equal(baseKind(7), 'confirmed');
});

test('filterByBasis — 유형 없음·잘못된 유형·빈 텍스트 제거', () => {
  const r = filterByBasis([{ text: 'a', basis: 'history' }, { text: 'b' }, { text: 'c', basis: 'rumor' }, { text: ' ', basis: 'image' }]);
  assert.equal(r.kept.length, 1); assert.equal(r.dropped, 3);
});

test('doseOk — text·source·실제 날짜 모두 필요', () => {
  assert.equal(doseOk({ text: '1정', source: 'x', asof: '2026-09-30' }), true);
  assert.equal(doseOk({ text: '1정', source: '', asof: '2026-09-30' }), false);
  assert.equal(doseOk({ text: '1정', source: 'x', asof: '2026-13-01' }), false);
  assert.equal(doseOk(undefined), false);
});

const ENF = { enforce: true };
test('현재 단계 기본값 — 검증 미강제, 모든 사용자를 의료인으로 가정', () => {
  assert.equal(VERIFICATION_ENFORCED, false);
  assert.equal(isVerifiedClinician(undefined), true);
  assert.equal(isVerifiedClinician(PAT), true);
  assert.equal(audienceView(validateDiagnosis(base(), PAT), PAT).view, 'clinician');
  assert.equal(audienceView(validateDiagnosis(base(), undefined), undefined).report.hypotheses[0].icd10, 'J06.9');
});

test('강제 모드 isVerifiedClinician — 자기 진술·L0·문자열 "true"는 불가', () => {
  assert.equal(isVerifiedClinician(CLIN, ENF), true);
  assert.equal(isVerifiedClinician({ level: 'L0', verified_clinician: true }, ENF), false);
  assert.equal(isVerifiedClinician({ level: 'L2', verified_clinician: 'true' }, ENF), false);
  assert.equal(isVerifiedClinician({ level: 'L2', self_declared_clinician: true }, ENF), false);
  assert.equal(isVerifiedClinician(undefined, ENF), false);
});

// ── 결론 유형 ──
test('정상 케이스 — confirmed, 종합=min', () => {
  const v = validateDiagnosis(base(), CLIN);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal(v.kind, 'confirmed'); assert.equal(v.overall, 7);
});

test('SP가 confirmed를 주장해도 min<4면 deferred(코드 값 채택)', () => {
  const v = validateDiagnosis(base({ confidence: { clinical: 9, information: 3 } }), CLIN);
  assert.equal(v.kind, 'deferred');
  assert.equal(v.report.final.primary.name, '');
  assert.ok(v.changes.some((c) => c.includes('결론 유형 재계산')));
});

test('종합 4~6 → conditional', () => {
  assert.equal(validateDiagnosis(base({ confidence: { clinical: 6, information: 9 } }), CLIN).kind, 'conditional');
});

test('위험 신호가 있으면 확신도와 무관하게 emergency_referral, triage.level 강제', () => {
  const r = base({ triage: { level: 'routine', red_flags: [{ id: 'R3', evidence: '식은땀 동반 흉통' }] } });
  const v = validateDiagnosis(r, CLIN);
  assert.equal(v.kind, 'emergency_referral');
  assert.equal(v.report.triage.level, 'emergency');
  assert.equal(v.report.final.primary.name, '');
});

test('emergency_referral에서는 전문의약품·시술·일반의약품 제안 제거, referral·self_care 유지', () => {
  const r = base({ triage: { level: 'emergency', red_flags: [{ id: 'R2', evidence: '입술 청색' }] } });
  r.plan.treatments.push({ kind: 'referral', description: '119 또는 응급실', requires_clinician: false, basis: 'guideline' },
    { kind: 'otc', description: '해열제', requires_clinician: false, basis: 'guideline' });
  const kinds = validateDiagnosis(r, CLIN).report.plan.treatments.map((t) => t.kind).sort();
  assert.deepEqual(kinds, ['referral', 'self_care']);
});

test("미배제 can't-miss가 있으면 confirmed → conditional", () => {
  const r = base({ hypotheses: [hyp(), hyp({ name: '급성 후두개염', icd10: 'J05.1', must_not_miss: true, against: [] })] });
  const v = validateDiagnosis(r, CLIN);
  assert.equal(v.kind, 'conditional');
  assert.equal(unresolvedMustNotMiss(v.report.hypotheses).length, 1);
});

test("can't-miss에 반대 근거(유효 basis)가 있으면 배제된 것으로 보아 confirmed 유지", () => {
  const r = base({ hypotheses: [hyp(), hyp({ name: '급성 후두개염', must_not_miss: true, against: [{ text: '침 삼킴 가능·목소리 정상', basis: 'history' }] })] });
  assert.equal(validateDiagnosis(r, CLIN).kind, 'confirmed');
});

test("can't-miss의 반대 근거가 근거 유형 없음이면 배제로 인정하지 않는다", () => {
  const r = base({ hypotheses: [hyp(), hyp({ name: 'X', must_not_miss: true, against: [{ text: '아닐 것 같다' }] })] });
  assert.equal(validateDiagnosis(r, CLIN).kind, 'conditional');
});

test('hasRedFlag — emergency 레벨 또는 red_flags 항목', () => {
  assert.equal(hasRedFlag({ triage: { level: 'emergency', red_flags: [] } }), true);
  assert.equal(hasRedFlag({ triage: { level: 'urgent', red_flags: [{ id: 'R1' }] } }), true);
  assert.equal(hasRedFlag({ triage: { level: 'routine', red_flags: [] } }), false);
  assert.equal(hasRedFlag({}), false);
});

// ── 근거·용량·처방 ──
test('근거 유형 없는 지지 근거 제거, 지지 근거가 남지 않는 일반 가설 제거', () => {
  const r = base({ hypotheses: [hyp(), hyp({ name: '지어낸 가설', supports: [{ text: '느낌상' }] })] });
  const v = validateDiagnosis(r, CLIN);
  assert.deepEqual(v.report.hypotheses.map((h) => h.name), ['급성 상기도 감염']);
});

test('출처·조회일 없는 용량은 제거, 있으면(성인) 유지', () => {
  const r = base();
  r.plan.treatments.push({ kind: 'otc', description: '해열진통제', requires_clinician: false, basis: 'guideline', dose: { text: '1정', source: '', asof: '2026-09-30' } });
  const t = validateDiagnosis(r, CLIN).report.plan.treatments;
  assert.ok(t.find((x) => x.kind === 'prescription_drug').dose);
  assert.equal(t.find((x) => x.kind === 'otc').dose, undefined);
});

test('prescription_drug·procedure는 requires_clinician=true로 강제', () => {
  const r = base(); r.plan.treatments.push({ kind: 'procedure', description: '냉동치료', requires_clinician: false, basis: 'guideline' });
  const t = validateDiagnosis(r, CLIN).report.plan.treatments;
  assert.ok(t.filter((x) => x.kind === 'prescription_drug' || x.kind === 'procedure').every((x) => x.requires_clinician === true));
});

test('소아 + 체중 확인값 없음 → 용량 제거, 체중이 있으면 유지', () => {
  const noW = base({ patient: { age_years: 5, sex: 'M', pregnancy: 'na', weight_kg: null } });
  assert.equal(validateDiagnosis(noW, CLIN).report.plan.treatments.find((x) => x.kind === 'prescription_drug').dose, undefined);
  const w = base({ patient: { age_years: 5, sex: 'M', pregnancy: 'na', weight_kg: 18 } });
  assert.ok(validateDiagnosis(w, CLIN).report.plan.treatments.find((x) => x.kind === 'prescription_drug').dose);
});

test('생후 3개월 미만 → self_care·otc 제거', () => {
  const r = base({ patient: { age_years: 0.1, sex: 'M', pregnancy: 'na', weight_kg: 4 } });
  r.plan.treatments.push({ kind: 'referral', description: '대면 진료', requires_clinician: false, basis: 'guideline' });
  const kinds = validateDiagnosis(r, CLIN).report.plan.treatments.map((t) => t.kind);
  assert.ok(!kinds.includes('self_care')); assert.ok(kinds.includes('referral'));
});

test('근거 없는 처치·검사 제안은 제거', () => {
  const r = base(); r.plan.treatments.push({ kind: 'self_care', description: '이것저것', requires_clinician: false, basis: '' });
  r.plan.tests.push({ name: '전신 MRI', purpose: '', urgency: 'now', basis: '' });
  const v = validateDiagnosis(r, CLIN);
  assert.equal(v.report.plan.treatments.length, 2); assert.equal(v.report.plan.tests.length, 1);
});

// ── 금지 문구·필수 항목 ──
test('진단서·처방전·확진 문구 → ok=false', () => {
  for (const w of ['확진입니다', '진단서를 발급합니다', '처방전 참고']) {
    const v = validateDiagnosis(base({ summary_clinical: w }), CLIN);
    assert.equal(v.ok, false, w); assert.ok(v.errors.includes('forbidden_issuance_wording'));
  }
});

test('퇴원·완치 판정 문구 → ok=false', () => {
  assert.ok(validateDiagnosis(base({ summary_plain: '오늘 퇴원하세요' }), CLIN).errors.includes('forbidden_closure_wording'));
  assert.ok(validateDiagnosis(base({ summary_plain: '완치 판정입니다' }), CLIN).errors.includes('forbidden_closure_wording'));
});

test('"경과 관찰 종료" 표현은 허용', () => {
  assert.equal(validateDiagnosis(base({ summary_plain: '경과 관찰을 마칩니다(증상 소실 추정).' }), CLIN).ok, true);
});

test('return_if 없음 → ok=false(응급 제외), primary가 가설에 없음 → ok=false', () => {
  const r = base(); r.plan.followup.return_if = [];
  assert.ok(validateDiagnosis(r, CLIN).errors.includes('return_if_missing'));
  const r2 = base({ final: { claimed_kind: 'confirmed', primary: { name: '없는 병', icd10: '' }, alternatives: [] } });
  assert.ok(validateDiagnosis(r2, CLIN).errors.includes('primary_not_in_hypotheses'));
});

test('report 없음 → 페일세이프(deferred + 대면 진료 권고, 119 안내 포함)', () => {
  const v = validateDiagnosis(null, PAT);
  assert.equal(v.ok, false); assert.equal(v.kind, 'deferred');
  assert.ok(v.report.summary_plain.includes('119'));
});

test('원본 report는 변경되지 않는다', () => {
  const r = base(); const snap = JSON.stringify(r);
  validateDiagnosis(r, CLIN); assert.equal(JSON.stringify(r), snap);
});

// ── 사용자 층위 ──
test('의료인 뷰 — ICD-10·용량·협진 요약·임상 요약 유지', () => {
  const v = audienceView(validateDiagnosis(base(), CLIN, ENF), CLIN, ENF);
  assert.equal(v.view, 'clinician');
  assert.equal(v.report.hypotheses[0].icd10, 'J06.9');
  assert.ok(v.report.plan.treatments.find((t) => t.kind === 'prescription_drug').dose);
  assert.ok(v.report.summary_clinical);
});

test('강제 모드 환자 참조 뷰 — ICD-10·근거 상세·용량·협진 요약·임상 요약·체중 제거, 전문의약품은 문구만', () => {
  const v = audienceView(validateDiagnosis(base(), PAT, ENF), PAT, ENF);
  assert.equal(v.view, 'patient_reference');
  assert.equal(v.report.hypotheses[0].icd10, undefined);
  assert.equal(v.report.hypotheses[0].supports, undefined);
  const rx = v.report.plan.treatments.find((t) => t.kind === 'prescription_drug');
  assert.equal(rx.dose, undefined); assert.equal(rx.description, '의사 처방이 필요합니다');
  assert.deepEqual(v.report.specialties_consulted, [{ id: 'kdoctor-internal' }]);
  assert.equal(v.report.summary_clinical, undefined);
  assert.equal(v.report.patient.weight_kg, undefined);
  assert.ok(v.report.summary_plain);
});

test('강제 모드 — 자기 진술("의사입니다")만으로는 의료인 뷰가 열리지 않는다', () => {
  const a = { level: 'L2', verified_clinician: false, self_declared: 'physician' };
  const v = audienceView(validateDiagnosis(base(), a, ENF), a, ENF);
  assert.equal(v.view, 'patient_reference');
});

test('응급은 환자 참조 뷰에서도 안내(triage·red_flags)를 그대로 유지', () => {
  const r = base({ triage: { level: 'emergency', red_flags: [{ id: 'R2', evidence: '입술 청색' }] } });
  const v = audienceView(validateDiagnosis(r, PAT, ENF), PAT, ENF);
  assert.equal(v.report.triage.level, 'emergency'); assert.equal(v.report.triage.red_flags.length, 1);
});

// ── 케이스 단계 ──
test('정상 경로: intake→triaged→consulting→assessed→following→reassessed→resolved', () => {
  let s = { case_id: 'C1', stage: 'intake' };
  for (const to of ['triaged', 'consulting', 'assessed', 'following', 'reassessed', 'resolved']) {
    const t = transitionCase(s, to); assert.equal(t.ok, true, to); s = t.state;
  }
  assert.equal(s.stage, 'resolved');
});

test('건너뛰기·역행 금지: intake→assessed, following→resolved(재평가 없이) 거부', () => {
  assert.equal(canTransition('intake', 'assessed'), false);
  assert.equal(canTransition('following', 'resolved'), false);
  assert.equal(canTransition('assessed', 'triaged'), false);
});

test('referred·closed는 종착, resolved는 재평가로만 재개', () => {
  assert.deepEqual(['referred', 'closed'].map((s) => CASE_STAGES.map((t) => canTransition(s, t)).some(Boolean)), [false, false]);
  assert.equal(canTransition('resolved', 'reassessed'), true);
  assert.equal(canTransition('resolved', 'following'), false);
});

test('모든 비종착 단계에서 referred로 갈 수 있다(응급 전환 경로)', () => {
  for (const s of ['intake', 'triaged', 'consulting', 'assessed', 'following', 'reassessed']) assert.equal(canTransition(s, 'referred'), true, s);
});

test('transitionCase — 알 수 없는 단계·대상 거부', () => {
  assert.equal(transitionCase({ stage: 'zzz' }, 'triaged').ok, false);
  assert.equal(transitionCase({ stage: 'intake' }, 'zzz').ok, false);
  assert.equal(transitionCase(null, 'triaged').ok, false);
});
