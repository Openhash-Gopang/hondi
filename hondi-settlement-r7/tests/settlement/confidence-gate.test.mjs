import test from 'node:test';
import assert from 'node:assert/strict';
import { normalCdf, liquidityConfidence, precisionConfidence, transactionConfidence, gate, DEFAULT_MIN_CONFIDENCE } from '../../src/gopang/ai/hondi-confidence-gate.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('normalCdf — 알려진 값과 대칭·단조성', () => {
  near(normalCdf(0), 0.5, 1e-7); near(normalCdf(1.96), 0.9750021, 5e-7); near(normalCdf(-1), 0.1586553, 5e-7); near(normalCdf(1.6449), 0.95, 1e-4);
  for (const x of [0.1, 0.7, 1.3, 2.9]) near(normalCdf(x) + normalCdf(-x), 1, 1e-9);
  let prev = 0; for (let x = -6; x <= 6; x += 0.25) { const v = normalCdf(x); assert.ok(v >= prev); prev = v; }
});

test('liquidityConfidence — 손계산(포아송), 경계, 단조성, 잘못된 입력', () => {
  near(liquidityConfidence({ txn_12m: 40, window_days: 60 }), 1 - Math.exp(-40 * 60 / 365));
  near(liquidityConfidence({ txn_12m: 1, window_days: 60 }), 1 - Math.exp(-60 / 365));            // 약 0.152
  assert.equal(liquidityConfidence({ txn_12m: 0, window_days: 60 }), 0);
  assert.equal(liquidityConfidence({ txn_12m: 10, window_days: 0 }), 0);
  assert.ok(liquidityConfidence({ txn_12m: 5, window_days: 120 }) > liquidityConfidence({ txn_12m: 5, window_days: 60 }));   // 허용 기간이 길수록 ↑
  assert.ok(liquidityConfidence({ txn_12m: 20, window_days: 60 }) > liquidityConfidence({ txn_12m: 5, window_days: 60 }));    // 거래가 많을수록 ↑
  assert.throws(() => liquidityConfidence({ txn_12m: -1, window_days: 1 }), RangeError);
  assert.throws(() => liquidityConfidence({ txn_12m: 1, window_days: NaN }), RangeError);
});

test('precisionConfidence — σ가 클수록 낮고, σ=0이면 1, ±10% 이내 확률의 손계산', () => {
  near(precisionConfidence({ sigma: 0.0588 }), 2 * normalCdf(Math.log(1.1) / 0.0588) - 1);
  assert.ok(precisionConfidence({ sigma: 0.0588 }) > 0.88 && precisionConfidence({ sigma: 0.0588 }) < 0.91);
  assert.ok(precisionConfidence({ sigma: 0.643 }) < 0.13);
  assert.equal(precisionConfidence({ sigma: 0 }), 1);
  assert.ok(precisionConfidence({ sigma: 0.1, tolerance: 0.2 }) > precisionConfidence({ sigma: 0.1, tolerance: 0.1 }));
  let prev = 1; for (const s of [0.02, 0.05, 0.1, 0.2, 0.4, 0.8]) { const v = precisionConfidence({ sigma: s }); assert.ok(v < prev); prev = v; }
  assert.throws(() => precisionConfidence({ sigma: -0.1 }), RangeError);
});

test('transactionConfidence — 약한 고리(최솟값)와 제약 요인, 10점 척도, 법적 거부', () => {
  const apt = transactionConfidence({ txn_12m: 40, sigma: 0.0588, window_days: 61 });
  assert.equal(apt.limiting, 'precision'); assert.ok(apt.score > 0.88 && apt.score10 > 8.8 && apt.score10 <= 10);
  const thin = transactionConfidence({ txn_12m: 1, sigma: 0.643, window_days: 61 });
  assert.equal(thin.limiting, 'precision'); assert.ok(thin.score < 0.13);
  const illiquidButPrecise = transactionConfidence({ txn_12m: 1, sigma: 0.03, window_days: 61 });
  assert.equal(illiquidButPrecise.limiting, 'liquidity'); near(illiquidButPrecise.score, 1 - Math.exp(-61 / 365));
  const legal = transactionConfidence({ txn_12m: 40, sigma: 0.05, window_days: 61, flags: { unresolved_title: true } });
  assert.equal(legal.score, 0); assert.equal(legal.limiting, 'legal');
  assert.equal(transactionConfidence({ txn_12m: 40, sigma: 0.05, window_days: 61, flags: { unknown_senior_claims: false } }).components.legal, 1);
  assert.equal(apt.score, Math.min(...Object.values(apt.components)));
});

test('gate — 임계값 미달이면 차단, 임계값 이상이면 통과, 0이면 차단 안 함, 잘못된 값은 거부', () => {
  const c = s => ({ score: s });
  assert.equal(gate(c(0.49)).passed, false); assert.equal(gate(c(0.5)).passed, true); assert.equal(gate(c(0.9)).passed, true);
  assert.equal(gate(c(0.0), 0).passed, true); assert.equal(gate(c(0.7), 0.8).passed, false);
  assert.equal(gate(c(0.6)).threshold, DEFAULT_MIN_CONFIDENCE);
  assert.throws(() => gate(c(0.5), 1.5), RangeError); assert.throws(() => gate(c(0.5), -0.1), RangeError); assert.throws(() => gate(c(0.5), NaN), RangeError);
});

test('속성(무작위 2000건) — 확신도는 항상 0~1이고, 거래가 늘거나 σ가 줄면 결코 낮아지지 않는다', () => {
  let s = 4; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < 2000; i++) {
    const p = { txn_12m: rnd() * 80, sigma: 0.01 + rnd() * 0.9, window_days: 1 + rnd() * 400 };
    const c = transactionConfidence(p);
    assert.ok(c.score >= 0 && c.score <= 1 && c.score10 >= 0 && c.score10 <= 10);
    assert.ok(transactionConfidence({ ...p, txn_12m: p.txn_12m + 5 }).score >= c.score - 1e-12);
    assert.ok(transactionConfidence({ ...p, sigma: p.sigma * 0.8 }).score >= c.score - 1e-12);
    assert.ok(transactionConfidence({ ...p, window_days: p.window_days + 30 }).score >= c.score - 1e-12);
  }
});
