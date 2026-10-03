import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// 2026-10-03 — GDC 신용평가 서버 구현(_gdcEvaluateCreditServer)이 방법론 v1.0(gdc 저장소 gdc_credit_v1_0.md)과
// 같은 결과를 내는지 gdc 저장소 라운드 2 시나리오로 대조한다. v0 대비 변경은 순자산 <= 0 일 때의 부채비율 점수뿐이다.

describe('_gdcEvaluateCreditServer — v1.0 시나리오 일치', () => {
  let evaluate, scenarios;
  before(async () => {
    global.fetch = async () => { throw new Error('이 테스트는 네트워크를 쓰지 않는다'); };
    ({ _gdcEvaluateCreditServer: evaluate } = await import('../worker.js?cr=' + Date.now()));
    const fx = JSON.parse(await readFile(new URL('./fixtures/gdc_credit_v1_0_scenarios.json', import.meta.url), 'utf8'));
    scenarios = fx.scenarios;
  });
  test('시나리오가 충분히 들어 있다', () => assert.ok(scenarios.length >= 50, String(scenarios.length)));
  test('모든 시나리오의 등급·금리·점수가 expected와 같다', () => {
    for (const s of scenarios) {
      const r = evaluate(s.inputs.bsCash, s.inputs.fs);
      assert.equal(r.grade, s.expected.grade, s.id);
      assert.equal(r.annualRate, s.expected.annualRate, s.id);
      assert.equal(r.score, s.expected.score, s.id);
    }
  });
  test('순자산 0 + 부채 있음은 부채비율 점수 5 (v0은 50)', () => {
    const base = { bs_ar: 0, bs_ap: 500, bs_debt: 500, bs_equity: 0, pl_revenue: 10000, pl_cogs: 7000, pl_opex: 1000, cf_op: 200 };
    const r = evaluate(1000, base);
    assert.equal(r.score, 71.3);   // 25 + 1.25 + 30 + 15 = 71.25 -> 동점은 올림
    assert.equal(r.grade, 'A');
  });
  test('순자산 0 + 부채 0은 50점, 음수 순자산은 항상 5점', () => {
    const f = { bs_ar: 0, bs_ap: 500, bs_debt: 0, bs_equity: 0, pl_revenue: 10000, pl_cogs: 7000, pl_opex: 1000, cf_op: 0 };
    const a = evaluate(1000, f).score;
    const b = evaluate(1000, { ...f, bs_equity: -1 }).score;
    assert.ok(a > b, `${a} > ${b}`);
    assert.ok(Math.abs((a - b) - 11.25) <= 0.1, `${a} - ${b}`);   // (50 - 5) * 0.25 = 11.25, 표시 점수는 소수 첫째 자리 반올림이라 0.1 오차 허용
  });
});
