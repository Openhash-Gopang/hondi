import test from 'node:test';
import assert from 'node:assert/strict';
import { terminationExposure, allocateLoss, terminationThrottle, poolThrottle, checkConcentration, applyDefenses, downturnCapBps } from '../../src/gopang/ai/hondi-loss-defense.js';
import { settleTermination, carryAmount } from '../../src/gopang/ai/hondi-settlement.js';

test('settleTermination — 회수 0이면 원금+자본비용이 손실, 회수가 충분하면 손실 0과 초과분은 당사자 몫', () => {
  const a = settleTermination({ advance: 50_000_000, annual_rate_bps: 800, days: 331 });
  assert.equal(a.carry, 3_627_398); assert.equal(a.system_shortfall, 53_627_398); assert.equal(a.system_net, -50_000_000); assert.ok(a.balanced);
  const b = settleTermination({ advance: 50_000_000, annual_rate_bps: 800, days: 331, recovery: 60_000_000 });
  assert.equal(b.system_shortfall, 0); assert.equal(b.recovered, 53_627_398); assert.equal(b.surplus_to_parties, 6_372_602); assert.equal(b.system_net, 3_627_398);
  const c = settleTermination({ advance: 50_000_000, annual_rate_bps: 800, days: 331, recovery: 52_000_000 });
  assert.equal(c.system_shortfall, 1_627_398); assert.equal(c.system_net, 2_000_000);
  assert.throws(() => settleTermination({ advance: 1, annual_rate_bps: 800, days: 1, recovery: -1 }), RangeError);
  assert.equal(carryAmount({ advance: 0, annual_rate_bps: 800, days: 100 }), 0);
});

test('terminationExposure — 담보로 원금이 덮이면 노출은 자본비용+집행비용, 담보가 없으면 원금이 더해진다', () => {
  const covered = terminationExposure({ advance: 50_000_000, annual_rate_bps: 800, days_outstanding: 331, enforcement_cost_bps: 300 });
  assert.equal(covered.carry, 3_627_398); assert.equal(covered.enforcement_cost, 1_500_000); assert.equal(covered.principal_at_risk, 0);
  assert.equal(covered.exposure, 5_127_398);
  const half = terminationExposure({ advance: 50_000_000, annual_rate_bps: 800, days_outstanding: 331, enforcement_cost_bps: 300, principal_coverage_bps: 5000, margin_bps: 100 });
  assert.equal(half.principal_at_risk, 25_000_000); assert.equal(half.margin, 500_000); assert.equal(half.exposure, 3_627_398 + 1_500_000 + 25_000_000 + 500_000);
  const none = terminationExposure({ advance: 50_000_000, annual_rate_bps: 800, days_outstanding: 0, principal_coverage_bps: 0 });
  assert.equal(none.exposure, 50_000_000);
  assert.throws(() => terminationExposure({ advance: 1, annual_rate_bps: 800, days_outstanding: 1, principal_coverage_bps: 10001 }), RangeError);
});

test('allocateLoss — 첫 손실 층부터 채우고, 모든 층을 넘으면 uncovered(합계 보존)', () => {
  const layers = [{ name: 'case_reserve', capacity: 1_000_000 }, { name: 'pool', capacity: 3_000_000 }, { name: 'junior', capacity: 10_000_000 }];
  const a = allocateLoss(2_500_000, layers);
  assert.deepEqual(a.allocation.map(x => x.amount), [1_000_000, 1_500_000, 0]); assert.equal(a.uncovered, 0);
  const b = allocateLoss(20_000_000, layers);
  assert.deepEqual(b.allocation.map(x => x.amount), [1_000_000, 3_000_000, 10_000_000]); assert.equal(b.uncovered, 6_000_000);
  const c = allocateLoss(20_000_000, [...layers, { name: 'senior', capacity: Infinity }]);
  assert.equal(c.uncovered, 0); assert.equal(c.allocation[3].amount, 6_000_000);
  assert.equal(allocateLoss(0, layers).uncovered, 0);
  assert.throws(() => allocateLoss(1, []), RangeError);
  assert.throws(() => allocateLoss(1, [{ name: 'a', capacity: 1 }, { name: 'a', capacity: 1 }]), RangeError);
  assert.throws(() => allocateLoss(1, [{ name: 'a', capacity: -1 }]), RangeError);
});

test('allocateLoss 속성(무작위 2000건) — 합 보존, 층별 한도 준수, 앞 층이 다 차야 뒤 층이 쓰인다', () => {
  let s = 5; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < 2000; i++) {
    const layers = Array.from({ length: 1 + Math.floor(rnd() * 5) }, (_, k) => ({ name: 'L' + k, capacity: Math.floor(rnd() * 5_000_000) }));
    const loss = Math.floor(rnd() * 15_000_000), r = allocateLoss(loss, layers);
    assert.equal(r.allocation.reduce((t, x) => t + x.amount, 0) + r.uncovered, loss);
    r.allocation.forEach((x, k) => { assert.ok(x.amount <= layers[k].capacity); if (k > 0 && x.amount > 0) assert.equal(r.allocation[k - 1].amount, layers[k - 1].capacity); });
  }
});

test('terminationThrottle — 소표본에 과민 반응하지 않고, 종결이 몰리면 조이고, 극단이면 중단', () => {
  const p = { prior_rate_bps: 350 };
  assert.equal(terminationThrottle({ ...p, events: 0, total: 0 }).multiplier_bps, 10000);           // 표본 없음 = 사전값
  assert.equal(terminationThrottle({ ...p, events: 1, total: 1 }).multiplier_bps, 10000);           // 1건 종결로는 안 조인다
  const mid = terminationThrottle({ ...p, events: 30, total: 100 });
  assert.ok(mid.multiplier_bps > 0 && mid.multiplier_bps < 5000, JSON.stringify(mid));              // 30%가 종결이면 크게 조임
  assert.equal(terminationThrottle({ ...p, events: 90, total: 100 }).multiplier_bps, 0);            // 90% → 신규 선지급 중단
  assert.equal(terminationThrottle({ ...p, events: 0, total: 500 }).multiplier_bps, 10000);
  assert.throws(() => terminationThrottle({ ...p, events: 5, total: 3 }), RangeError);
  assert.throws(() => terminationThrottle({ ...p, events: 1, total: 10, tighten_at_bps: 2000, halt_at_bps: 500 }), RangeError);
  assert.throws(() => terminationThrottle({ events: 1, total: 10 }), RangeError);                    // prior_rate_bps는 반드시 명시(모르는 값을 가정으로 숨기지 않는다)
});

test('terminationThrottle 단조성 — 종결이 늘수록 승수는 줄고 결코 늘지 않는다(속성)', () => {
  for (const total of [20, 100, 400]) {
    let prev = 10000;
    for (let e = 0; e <= total; e += Math.max(1, Math.floor(total / 40))) {
      const m = terminationThrottle({ prior_rate_bps: 350, events: e, total }).multiplier_bps;
      assert.ok(m <= prev && m >= 0 && m <= 10000); prev = m;
    }
  }
});

test('poolThrottle — 풀 커버리지가 높으면 100%, 낮아지면 조이고, 바닥이면 중단, 노출 0이면 제한 없음', () => {
  assert.equal(poolThrottle({ pool_balance: 0, outstanding_exposure: 0 }).multiplier_bps, 10000);
  assert.equal(poolThrottle({ pool_balance: 2_000_000, outstanding_exposure: 10_000_000 }).multiplier_bps, 10000);   // 커버리지 20% ≥ 목표 10%
  const mid = poolThrottle({ pool_balance: 600_000, outstanding_exposure: 10_000_000 });                              // 6% → 사이
  assert.ok(mid.multiplier_bps > 0 && mid.multiplier_bps < 10000);
  assert.equal(poolThrottle({ pool_balance: 100_000, outstanding_exposure: 10_000_000 }).multiplier_bps, 0);          // 1% ≤ 중단선 2%
  assert.throws(() => poolThrottle({ pool_balance: 1, outstanding_exposure: 1, target_ratio_bps: 100, halt_ratio_bps: 100 }), RangeError);
});

test('checkConcentration — 키별 상한을 넘는 부분은 허용하지 않는다', () => {
  const base = { key: '부산 영도구|단독주택', capital_base: 1_000_000_000, max_share_bps: 500, portfolio: { '부산 영도구|단독주택': 30_000_000 } };   // 상한 5천만
  const ok = checkConcentration({ ...base, new_advance: 10_000_000 });
  assert.equal(ok.allowed, true); assert.equal(ok.allowed_amount, 10_000_000);
  const cut = checkConcentration({ ...base, new_advance: 40_000_000 });
  assert.equal(cut.allowed, false); assert.equal(cut.allowed_amount, 20_000_000); assert.equal(cut.key_total_after, 50_000_000);
  assert.equal(checkConcentration({ ...base, new_advance: 5_000_000, portfolio: { [base.key]: 80_000_000 } }).allowed_amount, 0);   // 이미 초과 → 0
  assert.equal(checkConcentration({ ...base, new_advance: 1_000_000, portfolio: {} }).allowed, true);
  assert.throws(() => checkConcentration({ ...base, new_advance: 1, key: '' }), RangeError);
});

test('applyDefenses — 선지급률을 결코 늘리지 않고, 100bp 단위로 내림, 승수 0이면 0', () => {
  assert.equal(applyDefenses(8300, []), 8300);
  assert.equal(applyDefenses(8300, [10000, 10000]), 8300);
  assert.equal(applyDefenses(8300, [5000]), 4100);                 // 4150 → 100bp 내림
  assert.equal(applyDefenses(8300, [5000, 5000]), 2000);           // 2075 → 2000
  assert.equal(applyDefenses(8300, [0]), 0);
  let s = 11; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < 2000; i++) {
    const a = Math.floor(rnd() * 9001), ms = Array.from({ length: Math.floor(rnd() * 4) }, () => Math.floor(rnd() * 10001));
    const r = applyDefenses(a, ms);
    assert.ok(r <= a && r >= 0 && r % 100 === 0);
    if (ms.length) assert.ok(applyDefenses(a, [...ms, 9000]) <= r);        // 승수를 더할수록 같거나 작아진다
  }
  assert.throws(() => applyDefenses(8300, [10001]), RangeError);
});

test('downturnCapBps — 손계산 일치, 경과일 0이면 집행비용만, 경과일·하락률·이율이 클수록 상한은 낮아진다', () => {
  // 연 20% 하락, 331일, 집행비용 3%, 연 8%: 0.8^(331/365) × 0.97 / (1 + 0.08×331/365)
  const yrs = 331 / 365, expected = Math.floor(Math.pow(0.8, yrs) * 0.97 / (1 + 0.08 * yrs) * 10000);
  assert.equal(downturnCapBps({ annual_decline_bps: 2000, days_outstanding: 331, annual_rate_bps: 800, enforcement_cost_bps: 300 }), expected);
  assert.ok(expected > 7300 && expected < 7500);
  assert.equal(downturnCapBps({ annual_decline_bps: 2000, days_outstanding: 0, annual_rate_bps: 800, enforcement_cost_bps: 300 }), 9700);
  assert.equal(downturnCapBps({ annual_decline_bps: 0, days_outstanding: 0, annual_rate_bps: 0 }), 10000);
  const cap = o => downturnCapBps({ annual_decline_bps: 2000, days_outstanding: 200, annual_rate_bps: 800, enforcement_cost_bps: 300, ...o });
  assert.ok(cap({ days_outstanding: 100 }) > cap({ days_outstanding: 300 }));
  assert.ok(cap({ annual_decline_bps: 1000 }) > cap({ annual_decline_bps: 3000 }));
  assert.ok(cap({ annual_rate_bps: 400 }) > cap({ annual_rate_bps: 1200 }));
  assert.equal(cap({ margin_bps: 500 }), cap() - 500);
  assert.equal(downturnCapBps({ annual_decline_bps: 9999, days_outstanding: 3650, annual_rate_bps: 800 }), 0);      // 극단 하락 → 0(음수로 내려가지 않는다)
  assert.throws(() => downturnCapBps({ annual_decline_bps: 10000, days_outstanding: 1, annual_rate_bps: 800 }), RangeError);
  assert.throws(() => downturnCapBps({ annual_decline_bps: 2000, days_outstanding: 3651, annual_rate_bps: 800 }), RangeError);
  assert.throws(() => downturnCapBps({ annual_decline_bps: 2000, days_outstanding: 1.5, annual_rate_bps: 800 }), RangeError);
});
