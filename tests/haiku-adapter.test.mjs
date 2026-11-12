// Haiku 어댑터(worker.js) 단위 테스트 — 어댑터 구간만 잘라 실행한다.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const src = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const a = src.indexOf("const HAIKU_MODEL = ");
const b = src.indexOf("// ═", src.indexOf("async function _fetchHaikuAsOpenAI"));
const code = src.slice(a, b);
const make = new Function('HONDI_TIER_MODELS', 'fetch', `${code}; return { _haikuEnabled, _haikuUsage, _openAIToAnthropicBody, _fetchHaikuAsOpenAI };`);
const tiers = {};

test('enabled 조건', () => {
  const t = make(tiers, null);
  assert.equal(t._haikuEnabled({}), false);
  assert.equal(t._haikuEnabled({ ANTHROPIC_API_KEY: 'k' }), true);
  assert.equal(t._haikuEnabled({ ANTHROPIC_API_KEY: 'k', NAVI_LLM: 'deepseek' }), false);
});

test('요청 변환: system 분리·같은 역할 병합·첫 메시지 user', () => {
  const t = make(tiers, null);
  const b = t._openAIToAnthropicBody({ max_tokens: 99999, stream: true, messages: [
    { role: 'system', content: 'SP' }, { role: 'assistant', content: '안녕' },
    { role: 'user', content: 'a' }, { role: 'user', content: 'b' } ] });
  assert.equal(b.model, 'claude-haiku-5-5');
  assert.equal(b.max_tokens, 8192);
  assert.equal(b.system[0].text, 'SP');
  assert.deepEqual(b.system[0].cache_control, { type: 'ephemeral' });
  assert.equal(b.messages[0].role, 'user');
  assert.equal(b.messages[1].role, 'assistant');
  assert.equal(b.messages.length, 3);
  assert.equal(b.messages[2].content.length, 2);
});

test('사용량 변환', () => {
  const t = make(tiers, null);
  assert.deepEqual(t._haikuUsage({ input_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 2, output_tokens: 7 }),
    { prompt_tokens: 17, prompt_cache_hit_tokens: 5, prompt_cache_miss_tokens: 12, completion_tokens: 7, total_tokens: 24 });
});

test('비스트리밍 응답 변환', async () => {
  const fetchMock = async () => new Response(JSON.stringify({ id: 'x', model: 'claude-haiku-5-5', stop_reason: 'end_turn',
    content: [{ type: 'text', text: '답' }], usage: { input_tokens: 3, output_tokens: 1 } }), { status: 200 });
  const t = make(tiers, fetchMock);
  const r = await t._fetchHaikuAsOpenAI({ ANTHROPIC_API_KEY: 'k' }, { messages: [{ role: 'user', content: 'q' }] });
  const d = await r.json();
  assert.equal(d.choices[0].message.content, '답');
  assert.equal(d.usage.completion_tokens, 1);
});

test('스트리밍 응답 변환', async () => {
  const ev = (o) => 'event: x\ndata: ' + JSON.stringify(o) + '\n\n';
  const sse = ev({ type: 'message_start', message: { usage: { input_tokens: 4, cache_read_input_tokens: 6 } } })
    + ev({ type: 'content_block_delta', delta: { type: 'text_delta', text: '가' } })
    + ev({ type: 'content_block_delta', delta: { type: 'text_delta', text: '나' } })
    + ev({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } })
    + ev({ type: 'message_stop' });
  const t = make(tiers, async () => new Response(sse, { status: 200 }));
  const r = await t._fetchHaikuAsOpenAI({ ANTHROPIC_API_KEY: 'k' }, { stream: true, messages: [{ role: 'user', content: 'q' }] });
  const txt = await r.text();
  const chunks = txt.split('\n').filter(l => l.startsWith('data: ') && !l.includes('[DONE]')).map(l => JSON.parse(l.slice(6)));
  assert.equal(chunks.map(c => c.choices[0].delta.content || '').join(''), '가나');
  const last = chunks[chunks.length - 1];
  assert.equal(last.choices[0].finish_reason, 'stop');
  assert.equal(last.usage.prompt_cache_hit_tokens, 6);
  assert.equal(last.usage.completion_tokens, 2);
  assert.ok(txt.trim().endsWith('[DONE]'));
});
