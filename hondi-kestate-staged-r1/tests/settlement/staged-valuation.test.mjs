import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validEvidence, nationalStage, regionalStage, individualStage, reconcile, parseStagedBlock, buildTracksFromStaged,
  STAGED_SCHEMA, MAX_INDEX_AGE_DAYS,
} from '../../src/gopang/ai/hondi-staged-valuation.js';
import { estimateSigma } from '../../src/gopang/ai/hondi-advance-rate.js';

const AS_OF = '2026-09-28';
const ev = (o = {}) => ({ source_name: '한국부동산원 R-ONE', source_url: 'https://www.reb.or.kr/r-one/portal/stat/briefStatPage.do', retrieved_at: '2026-09-28', basis_date: '2026-08-31', ...o });
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} ≉ ${b}`);

// 완전한 예시 입력(가상의 단독주택): 사례 3건(중앙값 1억, 변동계수 4%), 시점수정 1.03, 지역요인 0.98, 인수 부담 500만원
function staged(over = {}) {
  return {
    as_of: AS_OF,
    base: { evidence: ev({ source_name: '국토교통부 실거래가 공개시스템', source_url: 'https://rt.molit.go.kr/', basis_date: '2026-09-20' }),
            comps: [{ price: 96_000_000, date: '2026-07-10' }, { price: 100_000_000, date: '2026-07-20' }, { price: 104_000_000, date: '2026-08-05' }] },
    national: { index: { ...ev(), value_at_comps: 100, value_now: 103 } },
    regional: { level_ratio: { ...ev({ source_name: '국토교통부 실거래가 공개시스템 지역 평균 단가' }), subject_level: 98, comps_level: 100 },
                population: { ...ev({ source_name: '행정안전부 주민등록 인구통계', source_url: 'https://jumin.mois.go.kr/statMonth.do' }), yoy_change: -0.005, depopulation_designated: false },
                redevelopment: { ...ev({ source_name: '지자체 정비구역 고시' }), status: 'none' } },
    individual: { rights: { origin: 'registry_document', viewed_at: '2026-09-25', mortgages: [{ max_claim: 50_000_000, is_third_party: true }], tenant_deposits_assumed: 5_000_000, other_assumed_burden: 0 } },
    liquidity: { ...ev({ source_name: '국토교통부 실거래가 공개시스템' }), txn_12m: 40 },
    ...over,
  };
}

test('validEvidence — 출처명·URL·조회일·기준일 필수, 조회일이 기준일보다 앞서면 거부, 당사자 주장 거부', () => {
  assert.equal(validEvidence(ev()).ok, true);
  assert.equal(validEvidence(ev({ source_name: '' })).ok, false);
  assert.equal(validEvidence(ev({ source_url: 'reb.or.kr' })).ok, false);
  assert.equal(validEvidence(ev({ source_url: undefined })).ok, false);
  assert.equal(validEvidence(ev({ retrieved_at: '2026-9-28' })).ok, false);
  assert.equal(validEvidence(ev({ basis_date: '2026-13-40' })).ok, false);
  assert.equal(validEvidence(ev({ basis_date: '2026-02-31' })).ok, false);            // 존재하지 않는 날짜(JS Date.parse는 통과시킨다)
  assert.equal(validEvidence(ev({ basis_date: '2026-04-31', retrieved_at: '2026-09-28' })).ok, false);
  assert.equal(validEvidence(ev({ basis_date: '2024-02-29' })).ok, true);              // 윤년은 유효
  assert.equal(validEvidence(ev({ basis_date: '2026-02-29', retrieved_at: '2026-09-28' })).ok, false);   // 평년 2월 29일은 무효
  assert.equal(validEvidence(ev({ retrieved_at: '2026-08-01', basis_date: '2026-08-31' })).ok, false);
  assert.equal(validEvidence(ev({ origin: 'party_claim' })).ok, false);
  assert.equal(validEvidence(null).ok, false);
});

test('국가 단계 — 계수는 원자료(현재/사례시점 지수)로 다시 계산하고, LLM이 낸 계수는 무시하며 불일치를 기록한다', () => {
  const n = nationalStage({ index: { ...ev(), value_at_comps: 100, value_now: 103 }, claimed_factor: 1.5 }, AS_OF);
  assert.equal(n.status, 'ok'); near(n.time_adjust_factor, 1.03); assert.ok(n.flags.includes('claimed_factor_mismatch')); assert.equal(n.sigma_extra, 0);
  assert.ok(!nationalStage({ index: { ...ev(), value_at_comps: 100, value_now: 103 }, claimed_factor: 1.03 }, AS_OF).flags.includes('claimed_factor_mismatch'));
});

test('국가 단계 — 오래된 지수는 stale(불확실성 가산), 지수 없음·증거 부적합·미래 기준일은 계수 1.0 + 큰 불확실성(지어내지 않는다)', () => {
  const stale = nationalStage({ index: { ...ev({ basis_date: '2026-04-30' }), value_at_comps: 100, value_now: 96 } }, AS_OF);
  assert.ok(new Date(AS_OF) - new Date('2026-04-30') > MAX_INDEX_AGE_DAYS * 86_400_000);
  assert.equal(stale.status, 'stale'); near(stale.time_adjust_factor, 0.96); assert.equal(stale.sigma_extra, 0.02);
  const none = nationalStage(undefined, AS_OF);
  assert.equal(none.status, 'unavailable'); assert.equal(none.time_adjust_factor, 1); assert.equal(none.sigma_extra, 0.04);
  const bad = nationalStage({ index: { ...ev({ source_url: 'x' }), value_at_comps: 100, value_now: 110 } }, AS_OF);
  assert.equal(bad.status, 'invalid'); assert.equal(bad.time_adjust_factor, 1);                     // 출처 없는 110은 채택하지 않는다
  assert.equal(nationalStage({ index: { ...ev({ basis_date: '2026-10-15' }), value_at_comps: 100, value_now: 101 } }, AS_OF).status, 'invalid');
  assert.equal(nationalStage({ index: { ...ev(), value_at_comps: 0, value_now: 101 } }, AS_OF).status, 'invalid');
});

test('국가 단계 — 시점수정 한계(0.6~1.4) 클램프, 지수 시계열이 있으면 연변동성을 실측하고 없으면 기본값', () => {
  const up = nationalStage({ index: { ...ev(), value_at_comps: 100, value_now: 200 } }, AS_OF);
  assert.equal(up.time_adjust_factor, 1.4); assert.ok(up.flags.includes('time_adjust_clamped'));
  const series = [100]; for (let i = 0; i < 12; i++) series.push(series[i] * Math.exp(i % 2 ? -0.02 : 0.02));
  const s = nationalStage({ index: { ...ev(), value_at_comps: 100, value_now: 101 }, series }, AS_OF);
  assert.equal(s.annual_vol_source, 'series'); near(s.annual_vol, 0.0724, 0.002);
  const flat = nationalStage({ index: { ...ev(), value_at_comps: 100, value_now: 101 }, series: Array.from({ length: 13 }, () => 100) }, AS_OF);
  assert.equal(flat.annual_vol, 0.02);                                                                 // 최소 하한
  const short = nationalStage({ index: { ...ev(), value_at_comps: 100, value_now: 101 }, series: [100, 101, 102] }, AS_OF);
  assert.equal(short.annual_vol_source, 'default'); assert.ok(short.flags.includes('series_unusable'));
});

test('지역 단계 — 중앙 추정을 움직이는 것은 지역 수준비뿐이고, 정성 위험(인구·정비·인프라)은 σ만 키운다', () => {
  const r = regionalStage({ level_ratio: { ...ev(), subject_level: 98, comps_level: 100 } }, AS_OF);
  near(r.regional_factor, 0.98); assert.equal(r.items_valid, 1);
  const q = regionalStage({ population: { ...ev(), yoy_change: -0.03, depopulation_designated: true }, redevelopment: { ...ev(), status: 'designated' } }, AS_OF);
  assert.equal(q.regional_factor, 1);                                                                  // 정성 위험은 계수를 움직이지 않는다
  near(q.sigma_regional, Math.sqrt(0.02 ** 2 + 0.02 ** 2 + 0.01 ** 2 + 0.03 ** 2), 1e-12);            // base·인구감소지역·인구감소추세·정비 초기 — 제곱합
  assert.ok(q.components.every(c => c.effect === 'sigma'));
  const big = regionalStage({ level_ratio: { ...ev(), subject_level: 300, comps_level: 100 } }, AS_OF);
  assert.equal(big.regional_factor, 2.0); assert.ok(big.flags.includes('regional_factor_clamped'));
});

test('지역 단계 — 정비 단계표(초기일수록 불확실), 정비 여부 미확인·증거 전무는 그것 자체가 불확실성, 부적합 증거는 무시하고 사유 기록', () => {
  const sig = st => regionalStage({ population: { ...ev(), yoy_change: 0 }, redevelopment: { ...ev(), status: st } }, AS_OF).sigma_regional;
  assert.ok(sig('none') < sig('construction') && sig('construction') < sig('management_disposal') && sig('management_disposal') < sig('project_approved') && sig('project_approved') < sig('association') && sig('association') < sig('designated'));
  const unrec = regionalStage({ redevelopment: { ...ev(), status: '아무말' } }, AS_OF);
  assert.ok(unrec.flags.includes('redevelopment_status_unrecognized')); near(unrec.sigma_regional, Math.sqrt(0.02 ** 2 + 0.03 ** 2), 1e-12);
  const empty = regionalStage({}, AS_OF);
  assert.equal(empty.items_valid, 0); assert.ok(empty.flags.includes('regional_evidence_missing'));
  near(empty.sigma_regional, Math.sqrt(0.02 ** 2 + 0.03 ** 2 + 0.03 ** 2), 1e-12);                    // base + 정비 미확인 + 증거 전무
  const invalid = regionalStage({ population: { ...ev({ source_url: 'x' }), yoy_change: -0.05, depopulation_designated: true } }, AS_OF);
  assert.ok(invalid.problems.length > 0 && invalid.items_valid === 0);                                 // 출처 없는 인구감소 주장은 반영하지 않는다
  const infra = regionalStage({ infrastructure: [{ ...ev(), type: 'school', change: 'planned_closing' }, { ...ev(), type: 'transit', change: 'opening' }] }, AS_OF);
  assert.equal(infra.items_valid, 2); assert.equal(infra.components.filter(c => c.item.startsWith('infrastructure')).length, 1);
});

test('개별 단계 — 제3자 근저당은 대출 담보 차감액, 인수 부담은 공정가치 차감액, 자기 채권은 제외', () => {
  const i = individualStage({ rights: { origin: 'registry_document', viewed_at: '2026-09-25',
    mortgages: [{ max_claim: 50_000_000, is_third_party: true }, { max_claim: 20_000_000, is_third_party: false }, { max_claim: 10_000_000, is_third_party: true }],
    tenant_deposits_assumed: 30_000_000, other_assumed_burden: 5_000_000 } }, AS_OF);
  assert.equal(i.third_party_liens, 60_000_000); assert.equal(i.assumed_burden, 35_000_000);
  assert.deepEqual(i.veto_flags, { unresolved_title: false, unknown_senior_claims: false }); near(i.sigma_individual, 0.01, 1e-12);
});

test('개별 단계 — 등기부가 없거나 당사자 주장뿐이면 선순위 권리 불명(거부), 금액 형식 오류도 불명, 상속 미확정은 소유권 미확정(거부)', () => {
  const none = individualStage({}, AS_OF);
  assert.equal(none.veto_flags.unknown_senior_claims, true); near(none.sigma_individual, Math.sqrt(0.01 ** 2 + 0.05 ** 2), 1e-12);
  assert.equal(individualStage({ rights: { origin: 'party_claim', viewed_at: '2026-09-25', mortgages: [] } }, AS_OF).veto_flags.unknown_senior_claims, true);
  const badMoney = individualStage({ rights: { origin: 'registry_document', viewed_at: '2026-09-25', mortgages: [{ max_claim: 5e7 + 0.5, is_third_party: true }] } }, AS_OF);
  assert.equal(badMoney.veto_flags.unknown_senior_claims, true); assert.equal(badMoney.third_party_liens, 0);
  const noThirdFlag = individualStage({ rights: { origin: 'registry_document', viewed_at: '2026-09-25', mortgages: [{ max_claim: 1_000_000 }] } }, AS_OF);
  assert.equal(noThirdFlag.veto_flags.unknown_senior_claims, true);                                    // 제3자 여부를 모르면 낙관하지 않는다
  assert.equal(individualStage({ title_unresolved: true, rights: { origin: 'registry_document', viewed_at: '2026-09-25', mortgages: [] } }, AS_OF).veto_flags.unresolved_title, true);
  const stale = individualStage({ rights: { origin: 'registry_document', viewed_at: '2026-06-01', mortgages: [] } }, AS_OF);
  assert.ok(stale.flags.includes('registry_stale')); assert.equal(stale.veto_flags.unknown_senior_claims, false);
  const seizure = individualStage({ rights: { origin: 'registry_document', viewed_at: '2026-09-25', mortgages: [], seizure_count: 1 } }, AS_OF);
  assert.ok(seizure.sigma_individual > 0.01 && seizure.flags.includes('seizure_or_injunction'));
});

test('결합 — 손계산: 중앙값 1억 × 시점수정 1.03 × 지역요인 0.98 − 인수 부담 500만 = 9,594만원', () => {
  const r = reconcile(staged());
  assert.equal(r.comps.n, 3); assert.equal(r.comps.median, 100_000_000); near(r.comps.cv, 0.04, 1e-12);
  assert.equal(r.central_before_burden, 100_940_000); assert.equal(r.fair_value, 95_940_000);
  assert.deepEqual(r.deductions, { assumed_burden: 5_000_000, third_party_liens: 50_000_000 });
  assert.equal(r.data_quality, 'complete'); assert.equal(r.txn_12m, 40);
  const base = estimateSigma({ comps_count: 3, comps_cv: r.comps.cv, months_stale: r.comps.months_stale, days_to_sell: 60, annual_vol: 0.06 });
  assert.ok(r.sigma > base.sigma);                                                                     // 세 단계의 추가 불확실성이 σ에 들어갔다
  near(r.sigma_parts.sigma_extra, r.sigma_extra_total, 1e-12);
  const expectedExtra = Math.sqrt(0 + (Math.sqrt(0.02 ** 2 + 0 /*none*/) ** 2) + 0.01 ** 2);           // 국가 0, 지역 base, 개별 base
  assert.ok(r.sigma_extra_total >= expectedExtra - 1e-9);
});

test('결합 — LLM이 낸 중앙값·계수는 채택하지 않고, 잘못된 사례는 걸러 개수를 기록하며, 출처 없는 사례 집합은 추정 불가', () => {
  const claimed = staged(); claimed.base.median_price = 150_000_000; claimed.national.claimed_factor = 2; claimed.fair_value_claimed = 1;
  assert.equal(reconcile(claimed).fair_value, 95_940_000);                                             // 주장값 전부 무시
  const dirty = staged(); dirty.base.comps.push({ price: -5, date: '2026-08-01' }, { price: 1.5, date: '2026-08-01' }, { price: 90_000_000, date: '2027-01-01' });
  const rd = reconcile(dirty); assert.equal(rd.comps.n, 3); assert.equal(rd.comps.dropped, 3);        // 음수·소수·미래 날짜 제외
  const noSrc = staged(); noSrc.base.evidence = ev({ source_url: 'x' });
  const ri = reconcile(noSrc);
  assert.equal(ri.data_quality, 'insufficient'); assert.equal(ri.fair_value, null); assert.ok(ri.flags.includes('no_usable_comps'));
  assert.throws(() => buildTracksFromStaged(noSrc, { annual_rate_bps: 800 }), /추정 불가/);
  assert.throws(() => reconcile({ ...staged(), as_of: '2026/09/28' }), RangeError);
});

test('이중 계산 방지 — 인구감소지역 지정 여부·정비 초기 단계는 공정가치를 바꾸지 않고 σ만 키운다', () => {
  const a = staged(), b = staged();
  b.regional.population = { ...a.regional.population, depopulation_designated: true, yoy_change: -0.04 };
  b.regional.redevelopment = { ...a.regional.redevelopment, status: 'designated' };
  const ra = reconcile(a), rb = reconcile(b);
  assert.equal(ra.fair_value, rb.fair_value); assert.ok(rb.sigma > ra.sigma);
});

test('증거를 못 구할수록 불확실성은 결코 줄지 않는다(단조성)', () => {
  const full = reconcile(staged()).sigma;
  const noNat = staged(); delete noNat.national;
  const noReg = staged(); noReg.regional = {};
  const noReg2 = staged(); delete noReg2.regional;
  const noRights = staged(); delete noRights.individual;
  for (const s of [noNat, noReg, noReg2, noRights]) assert.ok(reconcile(s).sigma >= full - 1e-12);
  assert.equal(reconcile(noRights).data_quality, 'partial'); assert.equal(reconcile(noNat).data_quality, 'partial');
});

test('두 트랙 산출 — 중재 공정가치와 대출 담보가 서로 어긋나지 않고, 제3자 근저당이 클수록 선지급이 줄어든다', () => {
  const lad = { max_round: 61, round_interval_days: 1, reduction_ppm: 5_570 };
  const t = buildTracksFromStaged(staged(), { annual_rate_bps: 800, ladder: lad });
  assert.equal(t.mediation.fair_value, t.staged.fair_value); assert.equal(t.lending.fair_value_ref, t.mediation.fair_value);
  assert.ok(t.lending.collateral_value <= t.mediation.fair_value);
  assert.ok(t.lending.advance <= t.lending.collateral_net && t.lending.collateral_net <= t.lending.collateral_value);
  assert.equal(t.lending.liens, 50_000_000);
  assert.ok(t.mediation.basis.includes('시점수정') && t.mediation.basis.includes('complete'));
  const noLien = staged(); noLien.individual.rights.mortgages = [];
  const t0 = buildTracksFromStaged(noLien, { annual_rate_bps: 800, ladder: lad });
  assert.ok(t0.lending.advance >= t.lending.advance);                                                  // 제3자 근저당이 없으면 선지급은 같거나 늘어난다
  assert.equal(t0.lending.liens, 0);
  const huge = staged(); huge.individual.rights.mortgages = [{ max_claim: 500_000_000, is_third_party: true }];
  const th = buildTracksFromStaged(huge, { annual_rate_bps: 800, ladder: lad });
  assert.equal(th.lending.advance, 0); assert.equal(th.lending.collateral_net, 0); assert.equal(th.lending.binding, 'lien_deduction');
  assert.equal(th.mediation.fair_value, t.mediation.fair_value);                                       // 근저당은 자산 가치가 아니라 분배 순대금을 줄인다 — 중재 공정가치는 그대로
});

test('두 트랙 산출 — 등기부가 없으면 대출은 거부(중재는 진행), 소유권 미확정도 거부', () => {
  const lad = { max_round: 61, round_interval_days: 1, reduction_ppm: 5_570 };
  const noReg = staged(); delete noReg.individual;
  const t = buildTracksFromStaged(noReg, { annual_rate_bps: 800, ladder: lad });
  assert.equal(t.lending.binding, 'veto'); assert.equal(t.lending.advance, 0); assert.ok(t.mediation.fair_value > 0);
  const dead = staged(); dead.individual.title_unresolved = true;
  assert.equal(buildTracksFromStaged(dead, { annual_rate_bps: 800, ladder: lad }).lending.binding, 'veto');
  const noLiq = staged(); delete noLiq.liquidity;
  const tl = buildTracksFromStaged(noLiq, { annual_rate_bps: 800, ladder: lad });                       // 유동성을 못 구하면 0으로 보수적 처리 → 확신도 차단
  assert.equal(tl.lending.binding, 'confidence_gate'); assert.equal(tl.lending.advance, 0);
});

test('parseStagedBlock — 정상 블록, 태그 없음, 잘못된 JSON, 다른 스키마', () => {
  const ok = parseStagedBlock(`설명...\n[STAGED_VALUATION]${JSON.stringify({ schema: STAGED_SCHEMA, as_of: AS_OF })}[/STAGED_VALUATION]\n끝`);
  assert.equal(ok.as_of, AS_OF);
  assert.throws(() => parseStagedBlock('블록 없음'), /블록이 없습니다/);
  assert.throws(() => parseStagedBlock('[STAGED_VALUATION]{oops[/STAGED_VALUATION]'), /JSON 오류/);
  assert.throws(() => parseStagedBlock(`[STAGED_VALUATION]${JSON.stringify({ schema: 'other/1' })}[/STAGED_VALUATION]`), /스키마/);
  assert.throws(() => parseStagedBlock(undefined), /블록이 없습니다/);
});

test('속성(무작위 300건) — 어떤 증거 조합에서도 공정가치 ≥ 1, σ ≥ 증거 전무 시 하한, 체인 담보 순가치 ≤ 담보 ≤ 공정가치, 선지급 ≤ 담보 순가치', () => {
  let s = 90210; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const lad = { max_round: 61, round_interval_days: 1, reduction_ppm: 5_570 };
  for (let i = 0; i < 300; i++) {
    const st = staged();
    st.base.comps = Array.from({ length: 1 + Math.floor(rnd() * 8) }, () => ({ price: 30_000_000 + Math.floor(rnd() * 300_000_000), date: '2026-08-01' }));
    if (rnd() < 0.3) delete st.national; else st.national.index.value_now = 60 + rnd() * 80;
    if (rnd() < 0.3) st.regional = {}; else st.regional.level_ratio.subject_level = 40 + rnd() * 120;
    if (rnd() < 0.3) delete st.individual; else st.individual.rights.mortgages = [{ max_claim: Math.floor(rnd() * 400_000_000), is_third_party: rnd() < 0.7 }];
    st.individual && st.individual.rights && (st.individual.rights.tenant_deposits_assumed = Math.floor(rnd() * 20_000_000));
    if (rnd() < 0.2) delete st.liquidity; else st.liquidity.txn_12m = Math.floor(rnd() * 80);
    const t = buildTracksFromStaged(st, { annual_rate_bps: Math.floor(rnd() * 1200), ladder: rnd() < 0.5 ? lad : null });
    assert.ok(t.staged.fair_value >= 1);
    assert.ok(t.lending.advance <= t.lending.collateral_net && t.lending.collateral_net <= t.lending.collateral_value && t.lending.collateral_value <= t.mediation.fair_value);
    assert.ok(t.staged.sigma >= 0.03);                                                                   // 모형 오차 하한 이하로 내려가지 않는다
  }
});

import { readFileSync, existsSync } from 'node:fs';
import { REDEVELOPMENT_SIGMA } from '../../src/gopang/ai/hondi-staged-valuation.js';

test('SP 문서와 코드가 어긋나지 않는다 — 스키마·정비 단계 값·최신성 기준일·필수 규칙이 SP-24a에 그대로 있다', () => {
  const path = new URL('../../prompts/SP-24a_kestate_appraisal_v0_1.txt', import.meta.url);
  assert.ok(existsSync(path), 'SP-24a 파일이 없습니다');
  const sp = readFileSync(path, 'utf-8');
  assert.ok(sp.includes(STAGED_SCHEMA));
  for (const status of Object.keys(REDEVELOPMENT_SIGMA)) assert.ok(sp.includes(status), `SP에 정비 단계 '${status}'가 없습니다`);
  assert.ok(sp.includes(`${MAX_INDEX_AGE_DAYS}일`));                                        // 코드의 stale 기준과 같은 숫자
  for (const change of ['opening', 'closing', 'planned_opening', 'planned_closing']) assert.ok(sp.includes(change));
  for (const key of ['source_name', 'source_url', 'retrieved_at', 'basis_date', 'party_claim', 'registry_document', 'title_unresolved', 'is_third_party']) assert.ok(sp.includes(key), `SP에 '${key}'가 없습니다`);
  for (const rule of ['R1 ', 'R6 ', 'R7 ', 'R8 ', 'R10 ', 'R13 ']) assert.ok(sp.includes(`**${rule}`), `SP에 규칙 ${rule}가 없습니다`);
  assert.ok(sp.includes('[WEB_SEARCH:'));                                                    // 웹 검색 태그 규약(SP_appraiser와 동일)
  assert.ok(sp.includes('[STAGED_VALUATION]') && sp.includes('[/STAGED_VALUATION]'));
});

test('SP 예시 블록의 필드 이름이 코드가 읽는 필드와 같다(SP대로 쓰면 코드가 읽는다)', () => {
  // SP §4의 필드명으로 만든 최소 입력이 코드에서 실제로 채택되는지 — 이름이 어긋나면 조용히 무시되어 불확실성만 커진다
  const built = {
    schema: STAGED_SCHEMA, as_of: AS_OF,
    base: { evidence: ev(), comps: [{ price: 100_000_000, date: '2026-08-01' }] },
    liquidity: { ...ev(), txn_12m: 5, counted_from_listing: true },
    national: { index: { ...ev(), region_label: '가상', value_at_comps: 100, value_now: 102 }, regime: 'flat' },
    regional: { level_ratio: { ...ev(), subject_level: 99, comps_level: 100 }, population: { ...ev(), yoy_change: -0.012, depopulation_designated: false },
                redevelopment: { ...ev(), status: 'none' }, infrastructure: [{ ...ev(), type: 'school', change: 'none' }] },
    individual: { rights: { origin: 'registry_document', viewed_at: '2026-09-25', mortgages: [{ max_claim: 1_000_000, is_third_party: true }],
                            seizure_count: 0, injunction_count: 0, tenant_deposits_assumed: 0, other_assumed_burden: 0, title_unresolved: false }, physical: { issues: [] } },
  };
  const r = reconcile(built);
  assert.equal(r.stages.national.status, 'ok'); assert.equal(r.stages.regional.items_valid, 4);
  assert.equal(r.stages.individual.third_party_liens, 1_000_000); assert.equal(r.txn_12m, 5);
  assert.equal(r.stages.regional.regional_factor, 0.99); assert.deepEqual(r.veto_flags, { unresolved_title: false, unknown_senior_claims: false });
});
