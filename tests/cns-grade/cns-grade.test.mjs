import test from 'node:test';
import assert from 'node:assert/strict';
import { validateItems, parseJsonLoose, scoreFromLlm, makeCnsGradeHandler } from '../../src/worker/cns-grade.js';

const item = { id: 'L1-1-18', q: '질문', max: 12, rubric: [{ p: 'a', s: 3 }, { p: 'b', s: 3 }, { p: 'c', s: 3 }, { p: 'd', s: 3 }], model: '모범', answer: '내 답' };
const mkReq = (b) => new Request('https://x/cns/grade', { method: 'POST', body: JSON.stringify(b) });
const err = (status, code, message) => new Response(JSON.stringify({ ok: false, code, message }), { status });
const base = { caller: async () => ({ ok: true, guid: 'g' }), err, fetchSp: async () => 'SP', resolveDeepseekModel: (m) => m };

test('validateItems: 정상/배점 합 불일치/중복 id', () => {
  assert.equal(validateItems([item]), null);
  assert.match(validateItems([{ ...item, max: 10 }]), /배점 합/);
  assert.match(validateItems([item, item]), /id/);
  assert.match(validateItems([]), /items/);
});
test('parseJsonLoose: 코드블록·군더더기 허용, 깨지면 null', () => {
  assert.deepEqual(parseJsonLoose('```json\n{"points":[1]}\n```'), { points: [1] });
  assert.deepEqual(parseJsonLoose('결과: {"points":[2]} 끝'), { points: [2] });
  assert.equal(parseJsonLoose('아님'), null);
});
test('scoreFromLlm: 항목 배점으로 잘라내고 합계는 직접 계산, 길이 불일치는 null', () => {
  assert.deepEqual(scoreFromLlm(item, { points: [9, 3, -2, 1.9], feedback: 'ok' }), { score: 3 + 3 + 0 + 1, points: [3, 3, 0, 1], feedback: 'ok' });
  assert.equal(scoreFromLlm(item, { points: [1, 2, 3] }), null);
  assert.equal(scoreFromLlm(item, { points: [1, 2, 3, 'x'] }), null);
  assert.equal(scoreFromLlm(item, { total: 12 }), null);
});
test('handler: 인증 실패 401, 빈 답안은 LLM 없이 0점', async () => {
  const h1 = makeCnsGradeHandler({ ...base, caller: async () => ({ ok: false }), deepseekChatText: async () => { throw new Error('호출되면 안 됨'); } });
  assert.equal((await h1(mkReq({ items: [item] }), {}, {})).status, 401);
  const h2 = makeCnsGradeHandler({ ...base, deepseekChatText: async () => { throw new Error('호출되면 안 됨'); } });
  const r = await (await h2(mkReq({ items: [{ ...item, answer: '  ' }] }), {}, {})).json();
  assert.equal(r.results[0].score, 0);
});
test('handler: 정상 채점, LLM이 합계를 부풀려도 무시, 형식 오류면 502', async () => {
  const h = makeCnsGradeHandler({ ...base, deepseekChatText: async () => '{"points":[3,3,3,3],"total":99,"feedback":"좋아요"}' });
  const r = await (await h(mkReq({ items: [item] }), {}, {})).json();
  assert.equal(r.ok, true); assert.equal(r.results[0].score, 12);
  const h2 = makeCnsGradeHandler({ ...base, deepseekChatText: async () => '모르겠음' });
  assert.equal((await h2(mkReq({ items: [item] }), {}, {})).status, 502);
});
test('handler: SP 로드 실패 503, 잘못된 items 400', async () => {
  const h = makeCnsGradeHandler({ ...base, fetchSp: async () => { throw new Error('x'); }, deepseekChatText: async () => '' });
  assert.equal((await h(mkReq({ items: [item] }), {}, {})).status, 503);
  assert.equal((await h(mkReq({ items: 'x' }), {}, {})).status, 400);
});
