/**
 * equity_bid_model.test.js — 지분 입찰 테스트 하위 페이지의 계산 모델(assets/equity-bid-model.js).
 * 관리자 「자회사 10개 설립과 이사진 구성」 2.1·2.4·2.6의 표를 그대로 재현하는지 확인한다.
 * 시스템 테스트 전용이며 모든 숫자는 가정이다(이익 약속·예측 아님).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const ctx = {}; ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(readFileSync(join(ROOT, 'assets/equity-bid-model.js'), 'utf8'), ctx);
const M = ctx.EquityBidModel;
const PRESET = (id) => M.PRESETS.find((x) => x.id === id).params;
const DOC = PRESET('docraw');   // 관리자 문서 2.6 가정(서버 원가와 고정비만 반영, 다른 비용 없음)
const near = (a, b, eps = 0.006) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

describe('equity-bid-model: 관리자 문서 재현', () => {
  it('직역 10개, 시장 규모 합계 394,022명, 5% 매각 목표 합계 5억 원(2.1·2.4)', () => {
    assert.equal(M.PROFESSIONS.length, 10);
    assert.equal(M.PROFESSIONS.reduce((s, p) => s + p.market, 0), 394022);
    // 문서 2.4 표는 직역별 값을 만 원 단위로 반올림해 합이 49,999로 나온다(문서는 합계를 50,000으로 표기).
    near(M.PROFESSIONS.reduce((s, p) => s + p.target5pctMan, 0), 50000, 1);
  });
  it('회원 1인 단위 경제(2.6): 공급가 90,000 + 종량제 226,670 ≈ 매출 316,667, 법인 몫 ≈ 294,000', () => {
    const A = M.merge(M.DEFAULTS, DOC);
    assert.equal(M.feeSupply(A), 90000);
    assert.equal(M.revenuePerMember(A), 90000 + 226670);
    near(M.revenuePerMember(A) - A.serverCostPerMember, 294003, 5);
  });
  it('변호사 목표 회원 9,600명(2.6 표): 매출 30.40억, 세전 27.71억, 세후 22.65억', () => {
    const r = M.computeByMembers(9600, M.merge(M.DEFAULTS, DOC), true);
    near(r.revenue / 1e8, 30.40); near(r.operatingProfit / 1e8, 27.71); near(r.netIncome / 1e8, 22.65);
  });
  it('법무사·사무원 4,700명 / 의사 35,400명 (2.6 표)', () => {
    const A = M.merge(M.DEFAULTS, DOC);
    const a = M.computeByMembers(4700, A, true);
    near(a.revenue / 1e8, 14.88); near(a.netIncome / 1e8, 10.98);
    const b = M.computeByMembers(35400, A, true);
    near(b.revenue / 1e8, 112.10); near(b.netIncome / 1e8, 84.09);
  });
  it('손익분기: 유지비만 약 51명, 임원 보수 포함 약 174명(2.6)', () => {
    near(M.breakEvenMembers(DOC, false), 51, 0.5);
    near(M.breakEvenMembers(DOC, true), 174, 0.7);   // 문서 원안: 이분 탐색 결과가 문서 값과 같다
  });
  it('법인세 구간: 2억 이하 9%, 2억 초과분 19%', () => {
    assert.equal(M.corporateTax(100000000), 9000000);
    assert.equal(M.corporateTax(300000000), 18000000 + 19000000);
    assert.equal(M.corporateTax(-5), 0);
  });
});

describe('equity-bid-model: 점유율 시나리오', () => {
  it('점유율 10·30·50·70·90%가 순서대로 회원 수 = 시장 × 점유율', () => {
    assert.deepEqual(Array.from(M.SHARES), [0.1, 0.3, 0.5, 0.7, 0.9]);
    const p = M.findProfession('lawyer');
    assert.deepEqual(Array.from(M.SHARES, (s) => M.compute(p, s, DOC).members), [3210, 9630, 16050, 22470, 28890]);
  });
  it('점유율이 오를수록 매출·세후 이익·배당이 늘어난다(임계 이상에서)', () => {
    const p = M.findProfession('lawyer');
    const rs = M.SHARES.map((s) => M.compute(p, s, DOC));
    for (let i = 1; i < rs.length; i++) {
      assert.ok(rs[i].revenue > rs[i - 1].revenue);
      assert.ok(rs[i].stakeDividend > rs[i - 1].stakeDividend);
    }
  });
  it('5% 지분 취득가는 5% 매각 목표(만 원)이고 수익률 = 배당 ÷ 취득가', () => {
    const p = M.findProfession('lawyer');
    const r = M.compute(p, 0.3, DOC);
    assert.equal(r.stakeCost, 40730000);
    near(r.yieldPct, r.stakeDividend / 40730000, 1e-9);
    near(r.stakeDividend, r.netIncome * 0.05, 1);
  });
  it('적자 구간은 배당 0, 회수 기간 null', () => {
    const p = M.findProfession('patent-attorney');
    const r = M.compute(p, 0.001, PRESET('floor'));
    assert.equal(r.stakeDividend, 0); assert.equal(r.paybackYears, null);
  });
  it('전 직역 합계는 직역별 합과 같다', () => {
    const all = M.computeAll(0.1, DOC);
    const sum = M.PROFESSIONS.reduce((s, p) => s + M.compute(p, 0.1, DOC).revenue, 0);
    near(all.revenue, sum, 1);
  });
  it('회원이 내는 연 금액(부가세 포함): 하한 99,000원, 문서 기준 약 348,000원', () => {
    assert.equal(M.payPerMemberGross(M.merge(M.DEFAULTS, PRESET('floor'))), 99000);
    near(M.payPerMemberGross(M.merge(M.DEFAULTS, DOC)), 99000 + 226670 * 1.1, 1);
  });
});

describe('equity-bid-model: 표시 서식', () => {
  it('fmtWon: 억·만 원 단위, 끝자리 0을 잘못 지우지 않는다(100억 → "100억 원")', () => {
    assert.equal(M.fmtWon(1e10), '100억 원');
    assert.equal(M.fmtWon(3.45e8), '3.45억 원');
    assert.equal(M.fmtWon(1.2e8), '1.2억 원');
    assert.equal(M.fmtWon(40730000), '4,073만 원');
    assert.equal(M.fmtWon(-5e8), '-5억 원');
    assert.equal(M.fmtWon(9900), '9,900원');
  });
});

describe('equity-bid-model: 비용 반영(연구개발·인건비·마케팅·관리·로열티)', () => {
  const lawyer = () => M.findProfession('lawyer');
  it('프리셋 4개: 하한·보수·문서 매출·문서 원안, 문서 원안만 비현실 표시', () => {
    assert.deepEqual(Array.from(M.PRESETS, (x) => x.id), ['floor', 'conservative', 'docrev', 'docraw']);
    assert.equal(M.PRESETS.filter((x) => x.unrealistic).length, 1);
    assert.equal(M.PRESETS.find((x) => x.id === 'docraw').unrealistic, true);
  });
  it('비용을 반영하면 같은 매출에서 영업이익이 문서 원안보다 크게 줄어든다', () => {
    const raw = M.compute(lawyer(), 0.3, PRESET('docraw')), cur = M.compute(lawyer(), 0.3, PRESET('docrev'));
    assert.equal(raw.revenue, cur.revenue);
    assert.ok(cur.operatingProfit < raw.operatingProfit * 0.3);
    assert.ok(cur.yieldPct < raw.yieldPct * 0.3);
  });
  it('문서 원안은 로열티율 0이라 로열티 = 서버 원가이고, 다른 비용은 0', () => {
    const r = M.compute(lawyer(), 0.3, PRESET('docraw'));
    assert.equal(r.royalty, r.serverCost);
    assert.equal(r.rd + r.support + r.mkt + r.admin, 0);
  });
  it('로열티는 서버 원가 아래로 내려가지 않는다(로열티율을 낮춰도)', () => {
    const r = M.compute(lawyer(), 0.3, M.merge(PRESET('floor'), { royaltyRate: 0.01 }));
    assert.ok(r.royalty >= r.serverCost);
    assert.equal(r.royalty, r.serverCost);
  });
  it('소규모에서는 연 최소 비용이 걸린다(R&D 1억, 지원·운영 2.1억, 마케팅 5천만)', () => {
    const r = M.computeByMembers(100, M.merge(M.DEFAULTS, PRESET('floor')), false);
    assert.equal(r.rd, 100000000); assert.equal(r.support, 210000000); assert.equal(r.mkt, 50000000);
    assert.ok(r.operatingProfit < 0);
  });
  it('규모가 커지면 비율이 적용된다(R&D 15%, 지원 10%, 마케팅 20%, 관리 10%, 로열티 30%)', () => {
    const A = M.merge(M.DEFAULTS, PRESET('docrev')), r = M.computeByMembers(30000, A, true);
    near(r.rd / r.revenue, 0.15, 1e-9); near(r.support / r.revenue, 0.10, 1e-9); near(r.mkt / r.revenue, 0.20, 1e-9);
    near(r.admin / r.revenue, 0.10, 1e-9); near(r.royalty / r.revenue, 0.30, 1e-9);
  });
  it('비용 반영 영업이익률은 현실적인 범위: 문서 매출 30% 점유에서 5~25%, 문서 원안은 85% 초과', () => {
    const cur = M.compute(lawyer(), 0.3, PRESET('docrev')).margin, raw = M.compute(lawyer(), 0.3, PRESET('docraw')).margin;
    assert.ok(cur > 0.05 && cur < 0.25, `margin=${cur}`);
    assert.ok(raw > 0.85);
  });
  it('하한·보수 가정에서 시장의 10%에서는 적자(변호사)이고 배당이 없다', () => {
    ['floor', 'conservative'].forEach((id) => {
      const r = M.compute(lawyer(), 0.10, PRESET(id));
      assert.ok(r.operatingProfit < 0); assert.equal(r.stakeDividend, 0); assert.equal(r.paybackYears, null);
    });
  });
  it('수익률은 하한 ≤ 보수 ≤ 문서 매출 ≤ 문서 원안(같은 점유율)', () => {
    [0.3, 0.5, 0.9].forEach((s) => {
      const y = ['floor', 'conservative', 'docrev', 'docraw'].map((id) => M.compute(lawyer(), s, PRESET(id)).yieldPct);
      for (let i = 1; i < y.length; i++) assert.ok(y[i] >= y[i - 1], `${s}: ${y}`);
    });
  });
  it('손익분기: 비용 반영 시 문서 원안(약 174명)보다 훨씬 많고, 하한은 종량제가 없어 더 많다', () => {
    const raw = M.breakEvenMembers(PRESET('docraw'), true), docrev = M.breakEvenMembers(PRESET('docrev'), true), floor = M.breakEvenMembers(PRESET('floor'), true);
    assert.ok(docrev > raw * 10); assert.ok(floor > docrev);
    assert.ok(M.computeByMembers(Math.ceil(floor), M.merge(M.DEFAULTS, PRESET('floor')), true).operatingProfit >= -1);
  });
  it('기여이익이 0 이하이면 손익분기는 null(로열티+비용 비율이 100% 이상)', () => {
    assert.equal(M.breakEvenMembers(M.merge(PRESET('floor'), { mktRate: 0.6 }), true), null);
  });
  it('전 직역 합계는 비용 항목별로도 직역 합과 같다', () => {
    const all = M.computeAll(0.3, PRESET('docrev'));
    ['royalty', 'rd', 'support', 'mkt', 'admin', 'costTotal'].forEach((k) => near(all[k], M.PROFESSIONS.reduce((s, p) => s + M.compute(p, 0.3, PRESET('docrev'))[k], 0), 1));
  });
});

