import test from 'node:test';
import assert from 'node:assert/strict';
import { openMain, markMainTab, markCallTab, isMainTab, MAIN_WINDOW, MAIN_URL } from '../src/gopang/ui/navi-home.js';
test('이름 붙은 창으로 메인을 연다(열려 있으면 재사용, 없으면 새로)', () => {
  const calls = []; let focused = 0;
  globalThis.window = { name: '', open: (u, n) => { calls.push([u, n]); return { focus: () => { focused++; } }; } };
  openMain(); assert.deepEqual(calls[0], [MAIN_URL, MAIN_WINDOW]); assert.equal(focused, 1);
  assert.equal(isMainTab(), false); markMainTab(); assert.equal(isMainTab(), true); markCallTab(); assert.equal(isMainTab(), false);
});
test('팝업이 막혀 null 이어도 예외 없음', () => { globalThis.window = { name: '', open: () => null }; assert.equal(openMain(), null); });
