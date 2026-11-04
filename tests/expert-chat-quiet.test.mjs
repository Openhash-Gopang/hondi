import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../pages/expert-chat.html', import.meta.url), 'utf8');

test('expert-chat: quiet=1 임베드는 시작 인사 턴을 건너뛰고, 그 밖에는 인사를 그대로 한다', () => {
  const fn = html.slice(html.indexOf('async function startGreeting()'), html.indexOf('// 입력 바'));
  const quiet = fn.indexOf("_embedOn() && _qs.get('quiet') === '1'");
  const intro = fn.indexOf("sendTurn('[INTERNAL: 사용자가 방금 대화를 시작했습니다");
  assert.ok(quiet > 0 && intro > quiet, 'quiet 확인이 인사 턴보다 앞에 있어야 한다');
  assert.ok(fn.indexOf('GWP_CTX && !_gwpSeedUsed') < quiet, 'GWP_CTX 로 넘어온 첫 발화는 quiet 와 상관없이 그대로 보낸다');
});
