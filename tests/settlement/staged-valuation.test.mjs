import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isLeapYear, daysInMonth, isValidCalendarDate, parseEvidenceDate, daysBetween,
  combineSigma, evidenceOk, reconcileLlmFigure, realizedAnnualVol,
  nationalAdjustment, regionalAdjustment, individualAdjustment, stagedValuation,
  deductLienFromCollateral, NATIONAL_SIGMA_NONE, DEFAULT_ANNUAL_VOL, REGIONAL_SIGMA_NONE,
  INDIVIDUAL_DEFECT_SIGMA, INDIVIDUAL_DEFECT_SIGMA_SEVERE,
  floorComparison, propertyScopeCheck, FLOOR_WINDOW, MIN_FLOOR_MATCHED_COMPS, FLOOR_UNMATCHED_SIGMA, SUPPORTED_PROPERTY_TYPES,
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

// ───────────────────────────── 가압류·가처분·유치권 → 전체 거부(2026-09-28 3차) ─────────────────────────────

test('individualAdjustment — 등기부 확인됐어도 가압류가 확인되면 말소기준권리 판정 없이 전체 거부한다', () => {
  const r = individualAdjustment({
    registry: {
      confirmed: ev(),
      unresolved_encumbrances: [{ type: 'provisional_attachment', evidence: ev() }],
    },
  });
  assert.equal(r.rejected, true);
  assert.equal(r.sigma_individual, null);
  assert.equal(r.registry_flags.unknown_senior_claims, false);
  assert.equal(r.registry_flags.high_severity_legal_issue, true);
});

test('individualAdjustment — 가처분·유치권도 동일하게 거부하고, 라벨이 이유에 포함된다', () => {
  const r1 = individualAdjustment({ registry: { confirmed: ev(), unresolved_encumbrances: [{ type: 'injunction', evidence: ev() }] } });
  assert.equal(r1.rejected, true);
  assert.ok(r1.reasons.some(x => x.includes('가처분')));

  const r2 = individualAdjustment({ registry: { confirmed: ev(), unresolved_encumbrances: [{ type: 'possessory_lien', evidence: ev() }] } });
  assert.equal(r2.rejected, true);
  assert.ok(r2.reasons.some(x => x.includes('유치권')));
});

test('individualAdjustment — 출처 없는 가압류 주장은 채택하지 않고 정상 진행한다(지어내지 않는다 원칙)', () => {
  const r = individualAdjustment({
    registry: {
      confirmed: ev(),
      unresolved_encumbrances: [{ type: 'provisional_attachment', evidence: { source: '', asof: '2026-09-01' } }],
    },
  });
  assert.equal(r.rejected, false);
});

test('individualAdjustment — 알 수 없는 encumbrance type은 무시한다(화이트리스트 밖)', () => {
  const r = individualAdjustment({
    registry: { confirmed: ev(), unresolved_encumbrances: [{ type: 'unknown_type_xyz', evidence: ev() }] },
  });
  assert.equal(r.rejected, false);
});

test('individualAdjustment — 정상 케이스는 high_severity_legal_issue: false를 명시한다', () => {
  const r = individualAdjustment({ registry: { confirmed: ev() } });
  assert.equal(r.rejected, false);
  assert.equal(r.registry_flags.high_severity_legal_issue, false);
});

// ───────────────────────────── 맹지 등 건축 제약형 하자 → σ 가산치 확대(2026-09-28 3차) ─────────────────────────────

test('individualAdjustment — road_access_blocked 하자는 일반 하자보다 σ가 크다', () => {
  const normal = individualAdjustment({
    registry: { confirmed: ev() },
    defects: [{ type: '누수', evidence: ev() }],
  });
  const severe = individualAdjustment({
    registry: { confirmed: ev() },
    defects: [{ type: 'road_access_blocked', evidence: ev() }],
  });
  assert.ok(severe.sigma_individual > normal.sigma_individual);
  assert.ok(INDIVIDUAL_DEFECT_SIGMA_SEVERE > INDIVIDUAL_DEFECT_SIGMA);
});

test('individualAdjustment — 출처 없는 road_access_blocked 주장은 채택하지 않는다', () => {
  const r1 = individualAdjustment({ registry: { confirmed: ev() } });
  const r2 = individualAdjustment({
    registry: { confirmed: ev() },
    defects: [{ type: 'road_access_blocked', evidence: { source: '', asof: '2026-09-01' } }],
  });
  near(r1.sigma_individual, r2.sigma_individual, 1e-9);
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

test('stagedValuation — 등기부는 확인됐지만 가압류가 있으면 전체를 거부하고 high_severity_legal_issue를 세운다', () => {
  const r = stagedValuation({
    comps: [{ price: 100_000_000, txn_date: '2026-01-01', index_at_txn: null }],
    valuation_date: '2026-09-28',
    registry: { confirmed: ev(), unresolved_encumbrances: [{ type: 'provisional_attachment', evidence: ev() }] },
    model_version: 'staged-v0.1',
  });
  assert.equal(r.rejected, true);
  assert.equal(r.fair_value, null);
  assert.equal(r.registry_flags.unknown_senior_claims, false);
  assert.equal(r.registry_flags.high_severity_legal_issue, true);
});

test('stagedValuation — model_version 없으면 던진다', () => {
  assert.throws(() => stagedValuation({ comps: [{ price: 1, txn_date: '2026-01-01' }], valuation_date: '2026-09-28', registry: { confirmed: ev() } }), RangeError);
});

// ───────────────────────────── 층(floor) 비교 · 물건 유형 범위 가드 (2026-09-30) ─────────────────────────────

const floorComps = (floors_prices) => floors_prices.map(([floor, price]) => ({ floor, price, txn_date: '2026-06-01', index_at_txn: null }));

test('floorComparison — 대상 층이 없으면 아무것도 하지 않고 사유도 남기지 않는다(하위호환)', () => {
  const comps = floorComps([[3, 100], [11, 200]]);
  const r = floorComparison({ comps });
  assert.equal(r.applied, false);
  assert.strictEqual(r.comps, comps);
  assert.equal(r.sigma_floor, 0);
  assert.deepEqual(r.reasons, []);
});

test('floorComparison — 대상 층 ±FLOOR_WINDOW 사례가 충분하면 그 사례만 쓴다(계수 조정 없음, 가격은 그대로)', () => {
  const comps = floorComps([[10, 430], [11, 430], [12, 440], [15, 410], [2, 380]]);
  const r = floorComparison({ comps, subject_floor: src(11) });
  assert.equal(r.applied, true);
  assert.deepEqual(r.comps.map(c => c.floor), [10, 11, 12]);   // 15층(차이 4)·2층(차이 9)은 제외
  assert.deepEqual(r.comps.map(c => c.price), [430, 430, 440]);  // 가격 값은 손대지 않는다
  assert.equal(r.sigma_floor, 0);
  assert.equal(r.n_before, 5); assert.equal(r.n_after, 3);
  assert.ok(FLOOR_WINDOW === 3 && MIN_FLOOR_MATCHED_COMPS === 3);
});

test('floorComparison — 경계: 정확히 FLOOR_WINDOW 차이는 포함, 그보다 1층 더 멀면 제외', () => {
  const comps = floorComps([[8, 1], [11, 1], [14, 1], [15, 1]]);   // 대상 11층: 8(−3)·11·14(+3) 포함, 15(+4) 제외
  const r = floorComparison({ comps, subject_floor: src(11) });
  assert.deepEqual(r.comps.map(c => c.floor), [8, 11, 14]);
});

test('floorComparison — 비슷한 층 사례가 부족하면 전체를 쓰고 σ를 키운다', () => {
  const comps = floorComps([[10, 1], [11, 1], [20, 1], [21, 1]]);   // 대상 11층 근처는 2건뿐
  const r = floorComparison({ comps, subject_floor: src(11) });
  assert.equal(r.applied, false);
  assert.strictEqual(r.comps, comps);
  assert.equal(r.sigma_floor, FLOOR_UNMATCHED_SIGMA);
  assert.ok(r.reasons[0].includes('전체 4건 사용'));
});

test('floorComparison — 비교사례에 floor가 없거나 비정수면 확인 불가로 선별에서 제외한다', () => {
  const comps = floorComps([[undefined, 1], [null, 1], [11.5, 1], ['11', 1], [11, 1], [12, 1]]);
  const r = floorComparison({ comps, subject_floor: src(11) });
  assert.equal(r.applied, false);            // 유효한 근접 사례는 2건(11, 12)뿐 → 최소 3건 미달
  assert.equal(r.sigma_floor, FLOOR_UNMATCHED_SIGMA);
});

test('floorComparison — 대상 층 증거가 출처·조회일 없거나 정수가 아니면 채택하지 않는다(σ 가산도 없음)', () => {
  const comps = floorComps([[10, 1], [11, 1], [12, 1]]);
  for (const bad of [{ value: 11, source: '', asof: '2026-09-01' }, { value: 11, source: 'x', asof: '2026-02-31' }, src(0), src(-2), src(11.5)]) {
    const r = floorComparison({ comps, subject_floor: bad });
    assert.equal(r.applied, false);
    assert.strictEqual(r.comps, comps);
    assert.equal(r.sigma_floor, 0);
    assert.equal(r.reasons.length, 1);
  }
});

test('stagedValuation — 층 선별이 실제로 중앙값을 바꾼다: 저층 3건이 섞이면 전체 중앙값이 끌려 내려가지만 대상 층 근처만 쓰면 그렇지 않다', () => {
  const base = {
    comps: [
      { price: 430_000_000, floor: 10, txn_date: '2026-06-01', index_at_txn: null },
      { price: 430_000_000, floor: 11, txn_date: '2026-06-02', index_at_txn: null },
      { price: 440_000_000, floor: 12, txn_date: '2026-06-03', index_at_txn: null },
      { price: 300_000_000, floor: 1, txn_date: '2026-06-04', index_at_txn: null },
      { price: 300_000_000, floor: 2, txn_date: '2026-06-05', index_at_txn: null },
      { price: 300_000_000, floor: 1, txn_date: '2026-06-06', index_at_txn: null },
    ],
    valuation_date: '2026-09-28', registry: { confirmed: ev() }, model_version: 'staged-v0.2',
  };
  const without = stagedValuation(base);
  const withFloor = stagedValuation({ ...base, subject_floor: src(11) });
  assert.equal(without.fair_value, 365_000_000);           // 6건 중앙값 (300+430)/2
  assert.equal(withFloor.fair_value, 430_000_000);         // 10·11·12층 3건 중앙값
  assert.ok(withFloor.stages.floor.applied);
  assert.equal(withFloor.stages.floor.n_after, 3);
  assert.ok(withFloor.reasons.some(r => r.startsWith('층 비교:')));
  assert.equal(without.stages.floor.applied, false);
  assert.ok(!without.reasons.some(r => r.startsWith('층 비교:')));   // 하위호환: 층 미제출이면 사유 문장도 안 늘어난다
  // 대상이 저층이면 반대로 저층 사례만 쓴다
  const low = stagedValuation({ ...base, subject_floor: src(2) });
  assert.equal(low.fair_value, 300_000_000);
});

test('stagedValuation — 층 사례가 부족하면 σ가 정확히 √(σ_개별²+σ_층²) 방식으로만 커진다', () => {
  const base = {
    comps: [
      { price: 100_000_000, floor: 20, txn_date: '2026-06-01', index_at_txn: null },
      { price: 100_000_000, floor: 21, txn_date: '2026-06-02', index_at_txn: null },
      { price: 100_000_000, floor: 22, txn_date: '2026-06-03', index_at_txn: null },
    ],
    valuation_date: '2026-09-28', registry: { confirmed: ev() }, model_version: 'staged-v0.2',
  };
  const a = stagedValuation(base);
  const b = stagedValuation({ ...base, subject_floor: src(3) });   // 대상 3층 — 근접 사례 0건
  assert.equal(b.fair_value, a.fair_value);                          // 값은 그대로(전체 사용)
  const expected = combineSigma([a.stages.national.sigma_national, a.stages.regional.sigma_regional, combineSigma([a.stages.individual.sigma_individual, FLOOR_UNMATCHED_SIGMA])]);
  near(b.sigma, expected, 1e-12);
  assert.ok(b.sigma > a.sigma);
});

test('stagedValuation — 층 비교로 선별 후 등기부 거부 경로에서도 stages.floor가 남는다', () => {
  const r = stagedValuation({
    comps: floorComps([[10, 100], [11, 100], [12, 100]]).map(c => ({ ...c, index_at_txn: null })),
    valuation_date: '2026-09-28', registry: { confirmed: null }, subject_floor: src(11), model_version: 'staged-v0.2',
  });
  assert.equal(r.rejected, true);
  assert.equal(r.stages.floor.applied, true);
});

test('propertyScopeCheck — property_type 미제출이면 null(가드 안 함), apartment만 지원', () => {
  assert.equal(propertyScopeCheck(undefined), null);
  assert.equal(propertyScopeCheck(null), null);
  assert.equal(propertyScopeCheck('apartment').supported, true);
  for (const t of ['commercial', 'officetel', 'land', 'detached_house', '', 42, {}]) assert.equal(propertyScopeCheck(t).supported, false);
  assert.deepEqual([...SUPPORTED_PROPERTY_TYPES], ['apartment']);
});

test('stagedValuation — 지원하지 않는 물건 유형이면 값을 내지 않고 out_of_scope로 거부한다(등기부 veto 플래그와 구분)', () => {
  const r = stagedValuation({
    comps: [{ price: 100_000_000, txn_date: '2026-01-01', index_at_txn: null }],
    valuation_date: '2026-09-28', registry: { confirmed: ev() }, property_type: 'commercial', model_version: 'staged-v0.2',
  });
  assert.equal(r.rejected, true);
  assert.equal(r.out_of_scope, true);
  assert.equal(r.fair_value, null);
  assert.equal(r.sigma, null);
  assert.equal(r.registry_flags.unknown_senior_claims, false);
  assert.equal(r.registry_flags.high_severity_legal_issue, false);
  assert.ok(r.reasons[0].includes('commercial'));
});

test('stagedValuation — apartment이면 정상 산출, out_of_scope 키는 정상 결과에 없다', () => {
  const r = stagedValuation({
    comps: [{ price: 100_000_000, txn_date: '2026-01-01', index_at_txn: null }],
    valuation_date: '2026-09-28', registry: { confirmed: ev() }, property_type: 'apartment', model_version: 'staged-v0.2',
  });
  assert.equal(r.rejected, false);
  assert.equal(r.out_of_scope, undefined);
  assert.equal(r.fair_value, 100_000_000);
});

test('stagedValuation — 물건 유형 가드는 comps 검증보다 먼저다(지원 밖 유형은 comps 형식 오류로 던지지 않는다)', () => {
  const r = stagedValuation({ comps: [], valuation_date: '2026-09-28', registry: { confirmed: ev() }, property_type: 'land', model_version: 'staged-v0.2' });
  assert.equal(r.out_of_scope, true);
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
