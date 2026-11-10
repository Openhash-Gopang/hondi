// SP 피드백·갱신 신호 서버측 수집 — 태그 파싱·마스킹·저장·스트립
import test from 'node:test';
import assert from 'node:assert/strict';
import { _parseSpFeedbackTags, _interceptSpFeedback, _withSpFeedback } from '../../worker.js';

test('파싱: USER_FEEDBACK / SP_UPDATE_SIGNAL, 따옴표 안의 쉼표·대괄호 허용', () => {
  const t = _parseSpFeedbackTags('답변입니다.\n[USER_FEEDBACK: sp="SP-DO-AGRI", kind="bug", raw="접수 창구가 틀려요, [번호] 다름"]\n[SP_UPDATE_SIGNAL: sp="SP-DO-AGRI", what="창구 이관", source="https://x.go.kr/a", published="2026-11-01"]');
  assert.equal(t.length, 2);
  assert.equal(t[0].type, 'feedback');
  assert.equal(t[0].fields.sp, 'SP-DO-AGRI');
  assert.equal(t[0].fields.kind, 'bug');
  assert.match(t[0].fields.raw, /\[번호\]/);
  assert.equal(t[1].type, 'signal');
  assert.equal(t[1].fields.source, 'https://x.go.kr/a');
});

test('인터셉트: 태그 제거 + 저장(개인정보 마스킹, 사용자 해시, SP ID 검증, 응답당 3건)', async () => {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response('{}', { status: 200 }); };
  try {
    const data = { choices: [{ message: { content: '안내 본문\n[USER_FEEDBACK: sp="SP-DO-AGRI", kind="suggestion", raw="연락처 010-1234-5678 로 알려줘, a@b.com"]\n[USER_FEEDBACK: sp="bad id!", kind="complaint", raw="불만"]' } }] };
    await _interceptSpFeedback({}, data, 'guid-1', null);
    await new Promise(r => setTimeout(r, 10));
    assert.equal(data.choices[0].message.content, '안내 본문');
    assert.equal(calls.length, 2);
    const a = calls[0].body;
    assert.equal(a.context_sp, 'SP-DO-AGRI');
    assert.equal(a.category, 'feature_request');
    assert.equal(a.status, 'new');
    assert.match(a.guid, /^h:[0-9a-f]{16}$/);
    assert.ok(!/010-1234|a@b\.com/.test(a.raw_text));
    assert.match(a.context_summary, /kind=suggestion;src=sp_tag;dk=[0-9a-f]{12}/);
    assert.equal(calls[1].body.context_sp, 'unspecified');   // 형식이 틀린 SP ID
  } finally { globalThis.fetch = orig; }
});

test('인터셉트: 태그가 없으면 아무것도 하지 않는다', async () => {
  const data = { choices: [{ message: { content: '그냥 답변' } }] };
  await _interceptSpFeedback({}, data, 'g', null);
  assert.equal(data.choices[0].message.content, '그냥 답변');
});

test('중앙 래퍼: 어떤 릴레이의 JSON 응답이든 태그를 저장·제거, 태그 없으면 그대로, 비JSON은 통과', async () => {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); };
  const mk = (o, ct = 'application/json') => new Response(typeof o === 'string' ? o : JSON.stringify(o), { status: 200, headers: { 'content-type': ct } });
  try {
    const r = await _withSpFeedback(Promise.resolve(mk({ choices: [{ message: { content: '본문\n[USER_FEEDBACK: sp="K-Tax", kind="bug", raw="세율이 틀렸어요"]' } }] })), JSON.stringify({ guid: 'g1' }), {}, null);
    const j = await r.json();
    await new Promise(r2 => setTimeout(r2, 10));
    assert.equal(j.choices[0].message.content, '본문');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].context_sp, 'K-Tax');
    const plain = mk({ choices: [{ message: { content: '태그 없음' } }] });
    assert.equal(await _withSpFeedback(Promise.resolve(plain), '{}', {}, null), plain);
    const sse = mk('data: [USER_FEEDBACK: sp="X"]', 'text/event-stream');
    assert.equal(await _withSpFeedback(Promise.resolve(sse), '{}', {}, null), sse);
    assert.equal(calls.length, 1);
  } finally { globalThis.fetch = orig; }
});
