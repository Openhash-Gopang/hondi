import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isLeapYear, daysInMonth, isValidCalendarDate, parseEvidenceDate, daysBetween,
  combineSigma, evidenceOk, reconcileLlmFigure, realizedAnnualVol,
  nationalAdjustment, regionalAdjustment, individualAdjustment, stagedValuation,
  deductLienFromCollateral, NATIONAL_SIGMA_NONE, DEFAULT_ANNUAL_VOL, REGIONAL_SIGMA_NONE,
} from '../../src/gopang/ai/hondi-staged-valuation.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const src = (value, asof = '2026-09-01') => ({ value, source: '테스트 출처', asof });
const ev = (asof = '2026-09-01') => ({ source: '테스트 출처', asof });

// ───────────────────────────── 달력 검증 ─────────────────────────────

test('isLeapYear — 그레고리력 규칙(4의 배수, 100의 배수 예외, 400의 배수 재예외)', () => {
  assert.equal(isLeapYear(2024), true);
  assert.equal(isLeapYear(2026), false);
  assert.equal(isLeapYear(1900), false);   // 100의 배수지만 400의 배수 아님 → 평년
  assert.equal(isLeapYear(2000), true);    // 400의 배수 → 윤년
});

test('daysInMonth — 2월은 윤년일 때만 29일', () => {
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2026, 4), 30);
  assert.equal(daysInMonth(2026, 1), 31);
});

test('isValidCalendarDate — 존재하지 않는 날짜(2026-02-31 등)를 거부한다(Date.parse의 날짜 굴림 버그 재현 방지)', () => {
  assert.equal(isValidCalendarDate('2026-02-31'), false);   // new Date('2026-02-31')는 3월 3일로 굴려 넘어감 — 여기서는 거부해야 함
  assert.equal(isValidCalendarDate('2026-04-31'), false);   // 4월은 30일까지
  assert.equal(isValidCalendarDate('2024-02-29'), true);    // 윤년 2월 29일은 유효
  assert.equal(isValidCalendarDate('2026-02-29'), false);   // 평년 2월 29일은 무효
  assert.equal(isValidCalendarDate('2026-09-28'), true);
  assert.equal(isValidCalendarDate('2026-13-01'), false);
  assert.equal(isValidCalendarDate('2026-00-01'), false);
  assert.equal(isValidCalendarDate('not-a-date'), false);
  assert.equal(isValidCalendarDate(null), false);
  assert.equal(isValidCalendarDate(20260928), false);
});

test('parseEvidenceDate — 무효한 날짜면 던지고, 유효하면 그대로 돌려준다', () => {
  assert.throws(() => parseEvidenceDate('2026-02-31', 'asof'), RangeError);
  assert.equal(parseEvidenceDate('2026-09-28', 'asof'), '2026-09-28');
});

test('daysBetween — 검증된 날짜 사이 일수, 윤년 포함', () => {
  assert.equal(daysBetween('2026-01-01', '2026-02-01'), 31);
  assert.equal(daysBetween('2024-01-01', '2025-01-01'), 366);   // 2024는 윤년
  assert.equal(daysBetween('2026-01-01', '2027-01-01'), 365);
  assert.throws(() => daysBetween('2026-02-31', '2026-03-01'), RangeError);
});

// ───────────────────────────── 공통 유틸 ─────────────────────────────

test('combineSigma — 분산의 제곱합의 제곱근', () => {
  near(combineSigma([0.03, 0.04]), 0.05);   // 3-4-5 직각삼각형
  assert.equal(combineSigma([]), 0);
  near(combineSigma([0.1]), 0.1);
});

test('evidenceOk — value·source·asof(유효한 날짜) 모두 있어야 true', () => {
  assert.equal(evidenceOk({ value: 1, source: 'a', asof: '2026-09-01' }), true);
  assert.equal(evidenceOk({ value: 1, source: '', asof: '2026-09-01' }), false);
  assert.equal(evidenceOk({ value: 1, source: 'a', asof: '2026-02-31' }), false);
  assert.equal(evidenceOk({ value: NaN, source: 'a', asof: '2026-09-01' }), false);
  assert.equal(evidenceOk(null), false);
  assert.equal(evidenceOk({ value: 1 }), false);
});

test('reconcileLlmFigure — LLM 제출값은 무시하고 항상 코드 계산값을 채택, 불일치는 기록만', () => {
  const close = reconcileLlmFigure(100, 103, { tolerance: 0.05 });
  assert.equal(close.value, 100);
  assert.match(close.note, /근사/);
  const far = reconcileLlmFigure(100, 150, { tolerance: 0.05 });
  assert.equal(far.value, 100);   // 여전히 코드 계산값
  assert.match(far.note, /불일치 기록/);
  const none = reconcileLlmFigure(100, null);
  assert.equal(none.value, 100);
  assert.equal(none.llm_claimed, null);
});

test('realizedAnnualVol — 월간 시계열의 로그수익률 표준편차를 연율화, 점 부족하면 null', () => {
  assert.equal(realizedAnnualVol([{ date: '2026-01-01', value: 100 }]), null);
  const flat = Array.from({ length: 13 }, (_, i) => ({ date: `2026-${String(i + 1).padStart(2, '0')}-01`, value: 100 }));
  near(realizedAnnualVol(flat), 0, 1e-9);   // 변화 없으면 변동성 0
  const rising = Array.from({ length: 13 }, (_, i) => ({ date: `2026-${String(i + 1).padStart(2, '0')}-01`, value: 100 * (1 + i * 0.01) }));
  assert.ok(realizedAnnualVol(rising) > 0);
});

// ───────────────────────────── STEP 1: 국가(시점수정) ─────────────────────────────

test('nationalAdjustment — 지수 자료 없으면 미적용(비율 1), 보수적 σ', () => {
  const r = nationalAdjustment({ comps: [{ price: 100_000_000, txn_date: '2026-06-01', index_at_txn: null }], valuation_index: null, valuation_date: '2026-09-28' });
  assert.equal(r.applied, false);
  assert.equal(r.adjusted_prices[0], 100_000_000);
  assert.ok(r.sigma_national >= NATIONAL_SIGMA_NONE);
});

test('nationalAdjustment — 지수비로 비교사례 가격을 보정한다(하락장: 지수 100→97.5)', () => {
  const r = nationalAdjustment({
    comps: [{ price: 100_000_000, txn_date: '2026-01-01', index_at_txn: src(100, '2026-01-01') }],
    valuation_index: src(97.5, '2026-09-28'),
    valuation_date: '2026-09-28',
  });
  assert.equal(r.applied, true);
  near(r.index_ratio_median, 0.975);
  assert.equal(r.adjusted_prices[0], Math.round(100_000_000 * 0.975));
});

test('nationalAdjustment — 여러 사례 중 일부만 지수 자료가 있으면 나머지는 비율 1, σ 가산', () => {
  const r = nationalAdjustment({
    comps: [
      { price: 100_000_000, txn_date: '2026-01-01', index_at_txn: src(100, '2026-01-01') },
      { price: 100_000_000, txn_date: '2026-02-01', index_at_txn: null },
    ],
    valuation_index: src(100, '2026-09-28'),
    valuation_date: '2026-09-28',
  });
  assert.equal(r.n_missing, 1);
  assert.equal(r.adjusted_prices[1], 100_000_000);
  assert.ok(r.sigma_national > DEFAULT_ANNUAL_VOL - 1e-9);
});

test('nationalAdjustment — 존재하지 않는 거래일(달력 버그 재현)은 거부한다', () => {
  assert.throws(() => nationalAdjustment({
    comps: [{ price: 100_000_000, txn_date: '2026-02-31', index_at_txn: src(100) }],
    valuation_index: src(100), valuation_date: '2026-09-28',
  }), RangeError);
});

// ───────────────────────────── STEP 2: 지역(σ만) ─────────────────────────────

test('regionalAdjustment — 가격 수준비 없으면 중앙값 미조정(1.0)이지만 σ는 더 큼', () => {
  const r = regionalAdjustment({});
  assert.equal(r.central_multiplier, 1);
  assert.equal(r.applied, false);
  assert.ok(r.sigma_regional > REGIONAL_SIGMA_NONE);
});

test('regionalAdjustment — 가격 수준비 관측값은 중앙 추정을 움직인다', () => {
  const r = regionalAdjustment({ price_level_ratio: src(1.05, '2026-09-01') });
  assert.equal(r.applied, true);
  near(r.central_multiplier, 1.05);
});

test('regionalAdjustment — 정성 위험 요인(인구감소·정비단계 등)은 중앙 추정을 그대로 두고 σ만 키운다', () => {
  const base = regionalAdjustment({ price_level_ratio: src(1.0) });
  const withRisk = regionalAdjustment({
    price_level_ratio: src(1.0),
    risk_factors: [{ type: 'population_decline', evidence: ev() }, { type: 'redevelopment_early', evidence: ev() }],
  });
  assert.equal(base.central_multiplier, withRisk.central_multiplier);   // 중앙 추정 불변
  assert.ok(withRisk.sigma_regional > base.sigma_regional);             // σ만 커짐
  assert.equal(withRisk.adopted_risk_factors.length, 2);
});

test('regionalAdjustment — 출처·조회일 없는 위험 요인 주장은 채택하지 않는다', () => {
  const r = regionalAdjustment({ risk_factors: [{ type: 'population_decline', evidence: { source: '', asof: '2026-09-01' } }] });
  assert.equal(r.adopted_risk_factors.length, 0);
  assert.equal(r.rejected_risk_factors.length, 1);
});

// ───────────────────────────── STEP 3: 개별(권리 차감) ─────────────────────────────

test('individualAdjustment — 등기부 미확인이면 거부(선순위 권리 불명)하고 veto 플래그를 세운다', () => {
  const r = individualAdjustment({ registry: { confirmed: null } });
  assert.equal(r.rejected, true);
  assert.equal(r.registry_flags.unknown_senior_claims, true);
});

test('individualAdjustment — 인수 부담(선순위 임차보증금)은 공정가치 차감 대상, 제3자 근저당은 별도 집계', () => {
  const r = individualAdjustment({
    registry: {
      confirmed: ev(),
      assumed_burdens: [{ amount: 20_000_000, type: '선순위 임차보증금(대항력)', evidence: ev() }],
      third_party_liens: [{ amount: 50_000_000, type: '근저당', evidence: ev() }],
    },
  });
  assert.equal(r.rejected, false);
  assert.equal(r.assumed_burden_deduction, 20_000_000);
  assert.equal(r.third_party_lien_total, 50_000_000);
  assert.equal(r.registry_flags.unknown_senior_claims, false);
});

test('individualAdjustment — 출처 없는 금액 주장은 차감하지 않는다', () => {
  const r = individualAdjustment({
    registry: { confirmed: ev(), assumed_burdens: [{ amount: 20_000_000, type: '주장', evidence: { source: '', asof: '2026-09-01' } }] },
  });
  assert.equal(r.assumed_burden_deduction, 0);
});

// ───────────────────────────── 종합 ─────────────────────────────

test('stagedValuation — 가상 사례: 사례 3건 중앙값 1억, 지수 100→97.5, 정비구역 초기+인구감소, 제3자 근저당 5천만', () => {
  const r = stagedValuation({
    comps: [
      { price: 95_000_000, txn_date: '2026-01-01', index_at_txn: src(100, '2026-01-01') },
      { price: 100_000_000, txn_date: '2026-02-01', index_at_txn: src(100, '2026-02-01') },
      { price: 105_000_000, txn_date: '2026-03-01', index_at_txn: src(100, '2026-03-01') },
    ],
    valuation_index: src(97.5, '2026-09-28'),
    valuation_date: '2026-09-28',
    regional: {
      risk_factors: [{ type: 'redevelopment_early', evidence: ev() }, { type: 'population_decline', evidence: ev() }, { type: 'school_consolidation', evidence: ev() }],
    },
    registry: { confirmed: ev(), third_party_liens: [{ amount: 50_000_000, type: '근저당', evidence: ev() }] },
    model_version: 'staged-v0.1',
  });
  assert.equal(r.rejected, false);
  near(r.fair_value, 97_500_000, 1);          // 1억 중앙값 × 0.975, 지역 배율 1.0, 인수부담 0
  assert.equal(r.third_party_lien_total, 50_000_000);
  assert.ok(r.sigma > 0);
  assert.equal(r.registry_flags.unknown_senior_claims, false);
});

test('stagedValuation — 등기부 미확인이면 전체를 거부하고 fair_value는 null', () => {
  const r = stagedValuation({
    comps: [{ price: 100_000_000, txn_date: '2026-01-01', index_at_txn: null }],
    valuation_date: '2026-09-28', registry: { confirmed: null }, model_version: 'staged-v0.1',
  });
  assert.equal(r.rejected, true);
  assert.equal(r.fair_value, null);
  assert.equal(r.registry_flags.unknown_senior_claims, true);
});

test('stagedValuation — model_version 없으면 던진다', () => {
  assert.throws(() => stagedValuation({ comps: [{ price: 1, txn_date: '2026-01-01' }], valuation_date: '2026-09-28', registry: { confirmed: ev() } }), RangeError);
});

// ───────────────────────────── 제3자 근저당 → 담보가치만 차감 ─────────────────────────────

test('deductLienFromCollateral — 자산 공정가치는 불변, 담보가치·선지급만 근저당만큼 줄어든다', () => {
  const lendingResult = Object.freeze({
    track: 'lending', fair_value_ref: 100_000_000, collateral_value: 60_000_000, advance: 40_000_000, ltv_bps: 6666, reasons: ['기존 사유'],
  });
  const r = deductLienFromCollateral(lendingResult, 50_000_000);
  assert.equal(r.fair_value_ref, 100_000_000);          // 자산 가치 불변
  assert.equal(r.collateral_value_gross, 60_000_000);
  assert.equal(r.collateral_value, 10_000_000);          // 60M - 50M
  assert.equal(r.advance, 10_000_000);                    // 기존 40M이 새 담보가치 10M을 넘으므로 10M으로 축소
  assert.ok(r.reasons.length > lendingResult.reasons.length);
});

test('deductLienFromCollateral — 근저당이 담보가치를 넘으면 0으로 바닥 처리', () => {
  const lendingResult = Object.freeze({ track: 'lending', fair_value_ref: 100_000_000, collateral_value: 30_000_000, advance: 20_000_000, ltv_bps: 6666, reasons: [] });
  const r = deductLienFromCollateral(lendingResult, 50_000_000);
  assert.equal(r.collateral_value, 0);
  assert.equal(r.advance, 0);
  assert.equal(r.ltv_bps, 0);
});

test('deductLienFromCollateral — 근저당 0이면 원본을 그대로 돌려준다', () => {
  const lendingResult = Object.freeze({ track: 'lending', collateral_value: 30_000_000, advance: 20_000_000, reasons: [] });
  assert.strictEqual(deductLienFromCollateral(lendingResult, 0), lendingResult);
});

test('deductLienFromCollateral — 음수·비정수 근저당은 거부한다', () => {
  const lendingResult = Object.freeze({ collateral_value: 1, advance: 1, reasons: [] });
  assert.throws(() => deductLienFromCollateral(lendingResult, -1), RangeError);
  assert.throws(() => deductLienFromCollateral(lendingResult, 1.5), RangeError);
});
