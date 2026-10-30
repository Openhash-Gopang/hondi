import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../pages/expert-chat.html'), 'utf8');
test('expert-chat: embed 에서는 응답 상한이 넓고 일반 대화는 1200 그대로', () => {
  assert.match(html, /max_tokens: _embedOn\(\) \? 3200 : 1200,/);
  assert.ok(/function _embedOn\b|const _embedOn\b|_embedOn *=/.test(html), '_embedOn 정의가 있어야 한다');
  assert.equal((html.match(/max_tokens: 1200/g) || []).length, 0);
});
