// usage.html은 알림 등록(push.js → 지갑 서명)을 쓰므로 gopang-wallet.js를 먼저 불러와야 한다 (2026-11-15)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../usage.html', import.meta.url), 'utf8');
test('usage.html은 push 모듈을 부르기 전에 지갑 스크립트를 불러온다', () => {
  const iw = html.indexOf('/gopang-wallet.js');
  const ip = html.indexOf('/src/gopang/services/push.js');
  assert.ok(iw > 0 && ip > 0 && iw < ip);
});
