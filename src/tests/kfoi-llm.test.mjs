// K-FOI BYOK 어댑터(src/worker/kfoi-llm.js) 검증 — 2026-09-21.
// 실제 회사 API는 부르지 않는다. 모의 fetch로 요청 모양(URL·헤더·본문), 응답 해석, 오류 매핑, 키 비노출을 확인한다.
// 실행: node src/tests/kfoi-llm.test.mjs
import assert from 'node:assert/strict';
import { parseLlmChoice, callByokLlm, redact, LLM_ENDPOINTS, EFFORT_STEPS } from '../worker/kfoi-llm.js';

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log(`✅ ${name}`); }
  catch (e) { fail++; console.log(`❌ ${name}\n     ${String(e && e.message).split('\n')[0]}`); }
}
const KEY = 'sk-test-ABCDEFGH12345678';
const ok = (obj) => new Response(JSON.stringify(obj), { status: 200 });

await test('parseLlmChoice: 기본은 키 없이 통과, 조사 깊이 → 조사 횟수', () => {
  assert.deepEqual(parseLlmChoice(undefined, undefined), { ok: true, choice: { provider: 'default', model: '', effort: 'medium', maxSteps: 8 } });
  assert.equal(parseLlmChoice({ provider: 'default', effort: 'low' }).choice.maxSteps, EFFORT_STEPS.low);
  assert.equal(parseLlmChoice({ provider: 'default', effort: 'high' }).choice.maxSteps, 12);
  assert.equal(parseLlmChoice({ provider: 'default', effort: 'weird' }).choice.effort, 'medium');
});
await test('parseLlmChoice: 허용목록 밖 제공자·URL 주입 시도 거부', () => {
  assert.equal(parseLlmChoice({ provider: 'evil', model: 'x' }, KEY).code, 'LLM_UNKNOWN_PROVIDER');
  assert.equal(parseLlmChoice({ provider: 'https://evil.example/v1', model: 'x' }, KEY).code, 'LLM_UNKNOWN_PROVIDER');
  assert.equal(parseLlmChoice({ provider: '__proto__', model: 'x' }, KEY).code, 'LLM_UNKNOWN_PROVIDER');
  assert.equal(parseLlmChoice({ provider: 'constructor', model: 'x' }, KEY).code, 'LLM_UNKNOWN_PROVIDER');
});
await test('parseLlmChoice: 모델 ID 형식 검증(Anthropic은 claude-*, 그 밖은 안전한 문자만)', () => {
  assert.equal(parseLlmChoice({ provider: 'anthropic', model: 'claude-sonnet-5' }, KEY).ok, true);
  assert.equal(parseLlmChoice({ provider: 'anthropic', model: 'gpt-4' }, KEY).code, 'LLM_BAD_MODEL');
  assert.equal(parseLlmChoice({ provider: 'openai', model: 'my-model_v1.5:latest' }, KEY).ok, true);
  for (const m of ['', 'a b', '../x', 'x;rm -rf', 'x'.repeat(90), '-lead', 'a\nb']) assert.equal(parseLlmChoice({ provider: 'openai', model: m }, KEY).code, 'LLM_BAD_MODEL', JSON.stringify(m));
});
await test('parseLlmChoice: 키 없음·너무 짧음·공백/제어문자 포함 → LLM_KEY_MISSING', () => {
  for (const k of [undefined, '', 'short', 'sk-abc def12345', 'sk-abc\ndef12345', 'x'.repeat(401)]) assert.equal(parseLlmChoice({ provider: 'openai', model: 'm' }, k).code, 'LLM_KEY_MISSING');
  assert.ok(parseLlmChoice({ provider: 'openai', model: 'm' }, '').message.includes('LLM_AUTH_FAILED'));
});
await test('redact: 키 원문과 흔한 키 패턴을 지운다', () => {
  const t = redact(`Incorrect API key provided: ${KEY}. also sk-proj-abcdef123456 and AIzaSyA1234567890abcdef and Bearer abcdefgh12345`, KEY);
  assert.ok(!t.includes(KEY) && !t.includes('sk-proj') && !t.includes('AIza') && !t.includes('abcdefgh12345'), t);
});

await test('redact: 흔한 패턴에 안 맞는 키도 원문 일치로 지운다', async () => {
  const K2 = 'zzTOPSECRET-9876543210';
  assert.ok(!redact(`bad key ${K2}`, K2).includes(K2));
  for (const st of [400, 401, 404, 429, 500]) {
    const r = await callByokLlm({ choice: { provider: 'openai', model: 'm' }, apiKey: K2, system: 's', messages: [], fetchImpl: async () => new Response(`echo ${K2}`, { status: st }) });
    assert.ok(!JSON.stringify(r).includes(K2), `status ${st}`);
  }
});
await test('Anthropic: URL·헤더·본문 모양과 응답 해석', async () => {
  let seen;
  const f = async (url, o) => { seen = { url, o, body: JSON.parse(o.body) }; return ok({ content: [{ type: 'text', text: '안녕' }, { type: 'text', text: '하세요' }] }); };
  const r = await callByokLlm({ choice: { provider: 'anthropic', model: 'claude-sonnet-5' }, apiKey: KEY, system: 'SYS', messages: [{ role: 'user', content: 'q' }], fetchImpl: f });
  assert.deepEqual(r, { ok: true, text: '안녕하세요' });
  assert.equal(seen.url, LLM_ENDPOINTS.anthropic);
  assert.equal(seen.o.headers['x-api-key'], KEY); assert.equal(seen.o.headers['anthropic-version'], '2023-06-01');
  assert.ok(!('authorization' in seen.o.headers));
  assert.equal(seen.body.model, 'claude-sonnet-5'); assert.equal(seen.body.system, 'SYS');
  assert.equal(seen.body.max_tokens, 8000); assert.deepEqual(seen.body.messages, [{ role: 'user', content: 'q' }]);
});
await test('OpenAI 호환: Bearer 헤더, system 메시지 선두, temperature·max_tokens 미전송, 응답 해석', async () => {
  let seen;
  const f = async (url, o) => { seen = { url, o, body: JSON.parse(o.body) }; return ok({ choices: [{ message: { content: '응답' } }] }); };
  const r = await callByokLlm({ choice: { provider: 'openai', model: 'some-model' }, apiKey: KEY, system: 'SYS', messages: [{ role: 'user', content: 'q' }], fetchImpl: f });
  assert.deepEqual(r, { ok: true, text: '응답' });
  assert.equal(seen.url, LLM_ENDPOINTS.openai); assert.equal(seen.o.headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(seen.body.messages[0], { role: 'system', content: 'SYS' });
  assert.ok(!('temperature' in seen.body) && !('max_tokens' in seen.body) && !('max_completion_tokens' in seen.body));
});
await test('Gemini는 OpenAI 호환 엔드포인트(고정 URL)를 쓴다', async () => {
  let url;
  const f = async (u) => { url = u; return ok({ choices: [{ message: { content: 'x' } }] }); };
  await callByokLlm({ choice: { provider: 'gemini', model: 'm' }, apiKey: KEY, system: 's', messages: [{ role: 'user', content: 'q' }], fetchImpl: f });
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
});
await test('호출 대상은 사용자 입력이 아니라 고정 목록이다(임의 URL 불가)', async () => {
  const f = async () => { throw new Error('호출되면 안 됨'); };
  const r = await callByokLlm({ choice: { provider: 'https://evil.example', model: 'm' }, apiKey: KEY, system: 's', messages: [], fetchImpl: f });
  assert.equal(r.code, 'LLM_UNKNOWN_PROVIDER');
});
await test('오류 매핑: 401/403→AUTH, 404→MODEL, 429→RATE, 400→BAD_REQUEST, 500→UPSTREAM', async () => {
  const codes = {};
  for (const st of [401, 403, 404, 429, 400, 500]) {
    const f = async () => new Response('{"error":"x"}', { status: st });
    codes[st] = (await callByokLlm({ choice: { provider: 'openai', model: 'm' }, apiKey: KEY, system: 's', messages: [], fetchImpl: f })).code;
  }
  assert.deepEqual(codes, { 401: 'LLM_AUTH_FAILED', 403: 'LLM_AUTH_FAILED', 404: 'LLM_MODEL_NOT_FOUND', 429: 'LLM_RATE_LIMITED', 400: 'LLM_BAD_REQUEST', 500: 'LLM_UPSTREAM_ERROR' });
});
await test('회사가 오류 문구에 키를 되돌려 줘도 결과에 키가 없다', async () => {
  for (const st of [400, 401, 404, 429, 500]) {
    const f = async () => new Response(`Incorrect API key provided: ${KEY} (org-x)`, { status: st });
    const r = await callByokLlm({ choice: { provider: 'openai', model: 'm' }, apiKey: KEY, system: 's', messages: [], fetchImpl: f });
    assert.ok(!JSON.stringify(r).includes(KEY), `status ${st}: ${JSON.stringify(r)}`);
  }
});
await test('빈 응답·깨진 JSON·네트워크 오류·시간 초과', async () => {
  const mk = (f) => callByokLlm({ choice: { provider: 'anthropic', model: 'claude-x1' }, apiKey: KEY, system: 's', messages: [], fetchImpl: f, timeoutMs: 30 });
  assert.equal((await mk(async () => ok({ content: [] }))).code, 'LLM_EMPTY');
  assert.equal((await mk(async () => new Response('not json', { status: 200 }))).code, 'LLM_BAD_RESPONSE');
  assert.equal((await mk(async () => { throw new TypeError('boom ' + KEY); })).code, 'LLM_NETWORK_ERROR');
  const slow = async (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  assert.equal((await mk(slow)).code, 'LLM_TIMEOUT');
  const netErr = await mk(async () => { throw new TypeError('boom ' + KEY); });
  assert.ok(!JSON.stringify(netErr).includes(KEY));
});
await test('OpenAI 호환 응답의 content가 배열(부분 목록)이어도 해석한다', async () => {
  const f = async () => ok({ choices: [{ message: { content: [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }] } }] });
  const r = await callByokLlm({ choice: { provider: 'openai', model: 'm' }, apiKey: KEY, system: 's', messages: [], fetchImpl: f });
  assert.equal(r.text, 'AB');
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
