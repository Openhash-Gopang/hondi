import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, lookupCounterpart, loadCounterpartIndex, normName, INDEX_TTL_MS } from '../src/gopang/ui/counterpart-index.js';

test('1만 개 색인에서 찾는 시간은 1초(실제로는 수 ms) 이내', () => {
  const items = []; for (let i = 0; i < 10000; i++) items.push([`테스트기관${i}센터`, 'g' + i, 'institution']);
  items.push(['제주시청', 'gov1', 'institution']);
  const idx = buildIndex(items);
  let t0 = performance.now(); assert.equal(lookupCounterpart(idx, '제주시청')[0].guid, 'gov1'); const exactMs = performance.now() - t0;
  t0 = performance.now(); const f = lookupCounterpart(idx, '기관9999', { fuzzy: true }); const fuzzyMs = performance.now() - t0;
  assert.ok(f.length >= 1); assert.ok(exactMs < 50 && fuzzyMs < 200, `exact ${exactMs}ms fuzzy ${fuzzyMs}ms`);
});
test('정확일치 우선, fuzzy 일 때만 부분 일치, 짧은 말은 부분 일치 안 함', () => {
  const idx = buildIndex([['제주시청', 'a', 'x'], ['제주시청 복지과', 'b', 'x'], ['서귀포시청', 'c', 'x']]);
  assert.deepEqual(lookupCounterpart(idx, '제주시청').map(e => e.guid), ['a']);
  assert.deepEqual(lookupCounterpart(idx, '제주시', { fuzzy: false }), []);
  assert.deepEqual(lookupCounterpart(idx, '제주시청 ', { fuzzy: true }).map(e => e.guid), ['a']);
  assert.deepEqual(lookupCounterpart(idx, '시청', { fuzzy: true }), []);   // 2자 이하는 부분 일치 금지
  assert.ok(lookupCounterpart(idx, '복지과', { fuzzy: true }).some(e => e.guid === 'b'));
  assert.equal(normName(' 제주 시청(본청) '), '제주시청본청');
});
test('보관본이 신선하면 서버를 부르지 않고, 오래되면 새로 받고, 실패하면 오래된 보관본을 쓴다', async () => {
  let saved = null, calls = 0;
  const store = { get: async () => saved, set: async (v) => { saved = v; } };
  const fetchIndex = async () => { calls++; return { items: [['제주시청', 'g', 'x']] }; };
  let idx = await loadCounterpartIndex({ store, fetchIndex, now: 1000 }); assert.equal(calls, 1); assert.equal(idx.size, 1);
  idx = await loadCounterpartIndex({ store, fetchIndex, now: 2000 }); assert.equal(calls, 1);
  idx = await loadCounterpartIndex({ store, fetchIndex, now: 1000 + INDEX_TTL_MS + 1 }); assert.equal(calls, 2);
  const failing = async () => { throw new Error('offline'); };
  idx = await loadCounterpartIndex({ store, fetchIndex: failing, now: 1000 + 3 * INDEX_TTL_MS }); assert.equal(idx.size, 1);
  assert.equal(await loadCounterpartIndex({ store: { get: async () => null, set: async () => {} }, fetchIndex: failing }), null);
});
