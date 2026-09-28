import test from 'node:test';
import assert from 'node:assert/strict';
import { openCase, currentWindow, applyRound, assertInvariants } from '../../src/gopang/ai/hondi-case-state.js';
import { resolveRound, PRESETS, minPriceAtRound } from '../../src/gopang/ai/hondi-sale-ladder.js';
import { computeAdvance } from '../../src/gopang/ai/hondi-advance-rate.js';
import { settleAdvance, settleTermination } from '../../src/gopang/ai/hondi-settlement.js';

const E = 100_000_000;
const noBid = st => { const w = currentWindow(st); return resolveRound({ case_id: st.case_id, round: w.round, min_price: w.min_price, bids: [] }); };

test('openCase — 30일 허용: 마지막 창은 31회차, 바닥가는 그 창의 최저가, 수명 31일', () => {
  const st = openCase({ case_id: 'C1', start_price: E, max_hours: 30 * 24 });
  assert.equal(st.terminal_round, 31); assert.equal(st.lifetime_hours, 31 * 24);
  assert.equal(st.floor_price, minPriceAtRound(E, 31, PRESETS.hondi_daily));
  assert.equal(st.status, 'open'); assert.ok(Object.isFrozen(st));
  assert.throws(() => openCase({ case_id: '', start_price: E, max_hours: 24 }), RangeError);
  assert.throws(() => openCase({ case_id: 'x', start_price: 0, max_hours: 24 }), RangeError);
});

test('계속 유찰되면 정확히 마지막 창에서 미매각 종결되고, 그 뒤에는 창도 입찰도 없다', async () => {
  let st = openCase({ case_id: 'C2', start_price: E, max_hours: 5 * 24 });                // 6회차가 마지막
  const seen = [];
  while (st.status === 'open') { seen.push(currentWindow(st)); st = applyRound(st, await noBid(st)); }
  assert.equal(st.status, 'terminated_unsold'); assert.equal(st.terminated_round, 6); assert.equal(seen.length, 6);
  assert.deepEqual(seen.map(w => w.is_terminal), [false, false, false, false, false, true]);
  assert.ok(seen.every((w, i) => i === 0 || w.min_price < seen[i - 1].min_price));         // 최저가 단조 감소
  assert.ok(seen.every(w => w.min_price >= st.floor_price));                                // 바닥가 아래 창은 만들어지지 않는다
  assert.throws(() => currentWindow(st), /종결/);
  assert.throws(() => applyRound(st, { round: 6, min_price: 1, outcome: 'failed' }), /종결/);
  assert.ok(assertInvariants(st));
});

test('중간에 낙찰되면 sold로 끝나고 낙찰가는 바닥가 이상, 이후 전이는 없다', async () => {
  let st = openCase({ case_id: 'C3', start_price: E, max_hours: 30 * 24 });
  for (let i = 0; i < 9; i++) st = applyRound(st, await noBid(st));                          // 9번 유찰 → 10회차
  const w = currentWindow(st);
  const r = await resolveRound({ case_id: 'C3', round: w.round, min_price: w.min_price, bids: [{ bidder: 'a', amount: w.min_price + 1000, deposit: w.required_deposit }] });
  st = applyRound(st, r);
  assert.equal(st.status, 'sold'); assert.equal(st.sold_round, 10); assert.ok(st.sale_price >= st.floor_price); assert.ok(assertInvariants(st));
  assert.throws(() => applyRound(st, r), /종결/);
});

test('잘못된 결과는 거부 — 회차 순서 오류, 사다리와 다른 최저가, 최저가 미만 낙찰', async () => {
  const st = openCase({ case_id: 'C4', start_price: E, max_hours: 10 * 24 });
  const w = currentWindow(st);
  assert.throws(() => applyRound(st, { round: 2, min_price: w.min_price, outcome: 'failed' }), /회차 순서/);
  assert.throws(() => applyRound(st, { round: 1, min_price: w.min_price - 1000, outcome: 'failed' }), /사다리/);
  assert.throws(() => applyRound(st, { round: 1, min_price: w.min_price, outcome: 'sold', price: w.min_price - 1, winner: 'x' }), /낮습니다/);
  assert.throws(() => applyRound(st, { round: 1, min_price: w.min_price, outcome: 'bogus' }), /알 수 없는/);
  assert.throws(() => assertInvariants({ ...st, status: 'sold', sale_price: st.floor_price - 1 }), /불변식/);
});

test('무작위 사건 500건 — 어떤 경로로도 바닥가 미만 매각·조기 종결·초과 회차가 없다(속성)', async () => {
  let s = 31337; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < 500; i++) {
    const start = 1_000_000 + Math.floor(rnd() * 400_000_000), maxH = Math.floor(rnd() * 90) * 24;
    const preset = rnd() < 0.5 ? PRESETS.hondi_daily : PRESETS.hondi_hourly;
    let st = openCase({ case_id: 'R' + i, start_price: start, max_hours: preset === PRESETS.hondi_hourly ? Math.floor(maxH / 4) : maxH, preset });
    const sellAt = rnd() < 0.5 ? Infinity : 1 + Math.floor(rnd() * st.terminal_round);
    while (st.status === 'open') {
      const w = currentWindow(st);
      const bids = w.round === sellAt ? [{ bidder: 'b', amount: w.min_price + Math.floor(rnd() * 5000), deposit: w.required_deposit }] : [];
      st = applyRound(st, await resolveRound({ case_id: st.case_id, round: w.round, min_price: w.min_price, bids }));
      assertInvariants(st);
    }
    assert.ok(st.status === 'sold' ? st.sold_round === sellAt : st.terminated_round === st.terminal_round);
  }
});

test('선지급 방어의 짝: 바닥가에 팔면 손실 0, 아예 안 팔려 종결되면 원금+자본비용이 남는다(회수 0 가정)', () => {
  const apt = { txn_12m: 40, comps_count: 25, comps_cv: 0.04, months_stale: 1, annual_rate_bps: 800 };
  const adv = computeAdvance({ ...apt, ladder: { max_round: 31, round_interval_days: 1, reduction_ppm: 5_570, start_price: E } });
  const st = openCase({ case_id: 'P', start_price: E, max_hours: 30 * 24 });
  const soldAtFloor = settleAdvance({ estimated_price: E, advance_bps: adv.advance_bps, creditor_claim: 80_000_000, sale_price: st.floor_price,
    selling_costs: Math.ceil(st.floor_price * 300 / 10000), annual_rate_bps: 800, days: 60 });
  assert.equal(soldAtFloor.system_shortfall, 0);                                              // 가격 위험은 바닥가에서 차단됨
  const advance = soldAtFloor.advance;
  const term = settleTermination({ advance, annual_rate_bps: 800, days: 31, recovery: 0 });
  assert.equal(term.system_shortfall, advance + term.carry); assert.ok(term.system_shortfall > advance); // 종결의 손실은 별도 방어책이 막아야 한다
});
