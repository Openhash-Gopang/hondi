import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const chat = readFileSync(new URL('../pages/expert-chat.html', import.meta.url), 'utf8');

test('worker: force_flash:true 이면 복잡도 점수와 무관하게 hondi-flash 로 고정하고 벤더에는 필드를 보내지 않는다', () => {
  assert.match(worker, /const _forceFlash = parsedBody\?\.force_flash === true && isKnownTierName;/);
  assert.match(worker, /const tierKey = _forceFlash\s*\n\s*\? 'hondi-flash'/);
  assert.match(worker, /delete outboundBody\.force_flash;/);
});

test('expert-chat: 서류 작성(embed)은 /deepseek 호출에 force_flash 를 싣고, 질문 턴은 max_tokens 600', () => {
  assert.match(chat, /force_flash: _embedOn\(\) \? true : undefined/);
  assert.match(chat, /includes\('서류 작성 화면에서 온 질문'\)/);
  assert.match(chat, /max_tokens: _quickAsk \? 600 : \(_embedOn\(\) \? 3200 : 1200\)/);
});

test('expert-chat: force_flash 는 deepseek-default 본문에만 싣는다(BYOK·legacy 벤더에 낯선 필드를 보내지 않음)', () => {
  const i = chat.indexOf('force_flash:');
  const before = chat.slice(Math.max(0, i - 400), i);
  assert.match(before, /\/deepseek/);
  assert.equal(chat.split('force_flash:').length - 1, 1);
});
