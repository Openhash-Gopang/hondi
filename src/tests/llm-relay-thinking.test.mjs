// /llm/relay: DeepSeek flash 는 thinking 을 기본으로 끄고, 클라이언트가 명시하면 그대로 전달한다
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../worker.js', import.meta.url), 'utf8');
const i = src.indexOf('async function handleLLMRelay(');
const body = src.slice(i, src.indexOf('\n}\n', i));

describe('LLM relay thinking 기본값', () => {
  it('payload 조립부에 thinking 기본값이 있다', () => {
    assert.ok(body.includes('LLM_RELAY_THINKING_DEFAULT'));
    assert.ok(body.includes("payload.thinking = { type: 'disabled' }"));
  });
  it('클라이언트 지정값이 우선한다', () => {
    assert.ok(/if \(body\.thinking !== undefined\) payload\.thinking = body\.thinking;/.test(body));
  });
  it('flash 모델·deepseek.com 호스트에만 적용한다', () => {
    assert.ok(body.includes('deepseek\\.com$') && body.includes('flash'));
  });
  it('thinking 은 payload 조립 뒤, fetch 앞에 있다', () => {
    assert.ok(body.indexOf('payload.thinking') > body.indexOf('const payload =') && body.indexOf('payload.thinking') < body.indexOf('await fetch(targetUrl'));
  });
});
