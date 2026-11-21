import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dropUnansweredUserTurns as d } from '../worker/kaddr-history.js';

const u = (c) => ({ role: 'user', content: c }), a = (c) => ({ role: 'assistant', content: c });

test('답 없이 이어진 사용자 메시지는 마지막 것만 남긴다', () => {
  assert.deepEqual(d([u('연습-가와 연습-나 삭제'), u('연습-가 삭제'), u('practice1 삭제')]), [u('practice1 삭제')]);
});
test('정상 대화(사용자/비서 번갈아)는 그대로', () => {
  const m = [u('1'), a('2'), u('3'), a('4'), u('5')];
  assert.deepEqual(d(m), m);
});
test('답변이 있었던 요청은 보존, 그 뒤 실패한 요청만 정리', () => {
  assert.deepEqual(d([u('조회'), a('결과'), u('삭제1(실패)'), u('삭제2')]), [u('조회'), a('결과'), u('삭제2')]);
});
test('빈 입력', () => { assert.deepEqual(d([]), []); assert.deepEqual(d(null), []); });

test('worker.js 가 K-Address 대화에 이 정리를 쓰고 SP 는 v1.8 이며 §0-A 가 있다', () => {
  const w = readFileSync(new URL('../../worker.js', import.meta.url), 'utf8');
  assert.match(w, /_dropUnansweredUserTurns\(messages/);
  const cat = JSON.parse(readFileSync(new URL('../../prompts/sp-catalog.json', import.meta.url), 'utf8'));
  assert.equal(cat['SP-26_kaddress'], 'SP-26_kaddress_v1_8.txt');
  const sp = readFileSync(new URL('../../prompts/SP-26_kaddress_v1_8.txt', import.meta.url), 'utf8');
  assert.match(sp, /§0-A/); assert.match(sp, /가장 최근 메시지/);
});
