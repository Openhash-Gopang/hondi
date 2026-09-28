import test from 'node:test';
import assert from 'node:assert/strict';
import { quantile, evaluate, evaluateBy, evaluateByTag, compareToBaseline, LOW_SAMPLE_N } from '../../src/gopang/ai/hondi-valuation-metrics.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const rec = (e, a, x = {}) => ({ estimated_price: e, realized_price: a, ...x });

test('quantile — 선형보간, 경계, 빈 배열', () => {
  assert.equal(quantile([], 0.5), null);
  assert.equal(quantile([7], 0.9), 7);
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantile([1, 2, 3, 4], 0), 1); assert.equal(quantile([1, 2, 3, 4], 1), 4);
});

test('evaluate — 손계산과 일치(APE는 실제가 기준)', () => {
  const m = evaluate([rec(100, 100), rec(100, 110), rec(100, 80), rec(100, 200)]);
  // APE: 0, 10/110, 20/80=0.25, 100/200=0.5
  near(m.mdape, (10 / 110 + 0.25) / 2); near(m.mape, (0 + 10 / 110 + 0.25 + 0.5) / 4);
  near(m.bias, (0 - 10 / 110 + 0.25 - 0.5) / 4);
  near(m.pe10, 0.5); near(m.pe20, 0.5); assert.equal(m.n_used, 4);
  near(m.ratio.p50, quantile([0.8, 1, 1.1, 2], 0.5));   // ratio = 실제/추정 (선지급률 역산 입력)
});

test('evaluate — 미매각(취하 등)은 제외하되 건수를 항상 알린다, 무효 값도 분리', () => {
  const m = evaluate([rec(100, 100), rec(100, null), rec(100, undefined), rec(0, 100), rec(100, -5), rec(NaN, 100)]);
  assert.equal(m.n_total, 6); assert.equal(m.n_used, 1); assert.equal(m.n_unrealized, 2); assert.equal(m.n_invalid, 3);
  assert.equal(m.low_sample, true);
});

test('evaluate — 표본이 없으면 지표는 null(0으로 위장하지 않는다)', () => {
  const m = evaluate([rec(100, null)]);
  assert.equal(m.n_used, 0); assert.equal(m.mdape, null); assert.equal(m.ratio, null);
});

test('bias 부호 — 과대평가면 +, 과소평가면 −', () => {
  assert.ok(evaluate([rec(120, 100), rec(130, 100)]).bias > 0);
  assert.ok(evaluate([rec(80, 100), rec(70, 100)]).bias < 0);
});

test('evaluateBy — 그룹별 평가와 low_sample 표시', () => {
  const rs = [];
  for (let i = 0; i < LOW_SAMPLE_N; i++) rs.push(rec(100, 100, { property_type: '아파트' }));
  rs.push(rec(100, 50, { property_type: '단독주택' }), rec(100, 60), );
  const g = evaluateBy(rs, r => r.property_type);
  assert.equal(g['아파트'].low_sample, false); assert.equal(g['단독주택'].low_sample, true);
  assert.equal(g['(미분류)'].n_used, 1);
});

test('evaluateByTag — 한 건이 여러 원인 태그에 속할 수 있고, 태그 없으면 원인 미분석', () => {
  const g = evaluateByTag([
    rec(100, 70, { cause_tags: ['권리하자', '시점'] }), rec(100, 100, { cause_tags: ['시점'] }), rec(100, 90),
  ]);
  assert.equal(g['시점'].n_used, 2); assert.equal(g['권리하자'].n_used, 1); assert.equal(g['(원인 미분석)'].n_used, 1);
});

test('compareToBaseline — 같은 표본에서 모델과 기준선 비교', () => {
  const good = [rec(100, 100, { baseline_price: 140 }), rec(200, 210, { baseline_price: 300 }), rec(50, 50, { baseline_price: 90 })];
  const c1 = compareToBaseline(good);
  assert.equal(c1.n_common, 3); assert.equal(c1.beats_baseline, true);
  const bad = [rec(140, 100, { baseline_price: 100 }), rec(300, 200, { baseline_price: 210 })];
  assert.equal(compareToBaseline(bad).beats_baseline, false);
  assert.equal(compareToBaseline([rec(100, 100)]).beats_baseline, null);   // 기준선 없으면 판정 불가
});
