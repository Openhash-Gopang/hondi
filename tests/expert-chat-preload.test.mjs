/**
 * tests/expert-chat-preload.test.mjs — 서류 작성 엔진(pages/expert-chat.html) 로딩 단축(2026-11-04)
 * 실행: node --test tests/expert-chat-preload.test.mjs
 * 인라인 모듈의 정적 import 그래프 전체가 <link rel="modulepreload"> 로 미리 선언돼 있어야 한다(없으면 import 가 5단계 폭포로 이어져 7초 넘게 걸린다).
 * import 를 추가·삭제했다면: node scripts/gen-expert-chat-preload.mjs --write
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computePreload, renderBlock, currentBlock } from '../scripts/gen-expert-chat-preload.mjs';

const html = readFileSync(new URL('../pages/expert-chat.html', import.meta.url), 'utf8');

test('modulepreload 목록이 실제 import 그래프와 같다 (갱신: node scripts/gen-expert-chat-preload.mjs --write)', () => {
  const list = computePreload();
  assert.ok(list.length >= 20, '그래프가 비정상적으로 작다: ' + list.length);
  assert.equal(currentBlock(html), renderBlock(list));
});

test('modulepreload 는 <head> 안, 인라인 모듈 스크립트보다 앞에 있다', () => {
  const a = html.indexOf('<link rel="modulepreload"'), head = html.indexOf('</head>'), mod = html.indexOf('<script type="module">');
  assert.ok(a > 0 && a < head && head < mod);
});

test('gopang-wallet.js 는 렌더를 막지 않는다(defer) — 저장 버튼에서만 쓰고 window.gopangWallet 을 기다린다', () => {
  assert.match(html, /<script src="\/gopang-wallet\.js" defer><\/script>/);
});
