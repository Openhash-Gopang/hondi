import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDocFormFeedbackHandler, normLabel, cleanLabel, aggregateCandidates, DAILY_LIMIT } from '../src/worker/doc-form-feedback.js';

function fakeStore() {
  const rows = [];
  return {
    rows,
    async add(r) { if (rows.some(x => ['form_id', 'version', 'kind', 'label_norm', 'cid_hash'].every(k => x[k] === r[k]))) return false; rows.push(r); return true; },
    async countSince(cid, ts) { return rows.filter(r => r.cid_hash === cid && r.ts >= ts).length; },
    async since(ts) { return rows.filter(r => r.ts >= ts); },
  };
}
const post = (h, body) => h.handle(new Request('https://x/doc-form/feedback', { method: 'POST', body: JSON.stringify(body) }), new URL('https://x/doc-form/feedback'), {}, {});
const cid = n => String(n).padStart(20, 'a');

test('normLabel: 공백·구두점·대소문자·전각 차이를 무시한다', () => {
  assert.equal(normLabel('  채권 양도·통지 (일자) '), normLabel('채권양도통지일자'));
  assert.equal(normLabel('ＡＢＣ'), 'abc');
});
test('cleanLabel: 개인정보로 보이거나 길이가 맞지 않으면 버린다', () => {
  assert.equal(cleanLabel(' 채권 번호 '), '채권 번호');
  assert.equal(cleanLabel('가'), null);
  assert.equal(cleanLabel('가'.repeat(41)), null);
  assert.equal(cleanLabel('계좌 123456-78-901234'), null);
  assert.equal(cleanLabel('a@b.com 연락'), null);
  assert.equal(cleanLabel('https://x.y 참고'), null);
});
test('POST: 잘못된 요청은 400, 쓸 수 있는 라벨이 없으면 accepted 0', async () => {
  const h = makeDocFormFeedbackHandler({ store: fakeStore() });
  assert.equal((await post(h, { form_id: 'A B', v: 1, cid: cid(1), adds: ['x'] })).status, 400);
  assert.equal((await post(h, { form_id: 'complaint', v: 0, cid: cid(1), adds: ['사건 번호'] })).status, 400);
  assert.equal((await post(h, { form_id: 'complaint', v: 1, cid: 'short', adds: ['사건 번호'] })).status, 400);
  const j = await (await post(h, { form_id: 'complaint', v: 1, cid: cid(1), adds: ['1', '010-1234-5678'] })).json();
  assert.deepEqual(j, { ok: true, accepted: 0 });
});
test('POST: 같은 이용자의 같은 제안은 1표, cid 는 해시로만 저장', async () => {
  const store = fakeStore(), h = makeDocFormFeedbackHandler({ store });
  const body = { form_id: 'complaint', v: 1, cid: cid(1), adds: ['사건 번호', '사건번호 '] };
  assert.equal((await (await post(h, body)).json()).accepted, 1);
  assert.equal((await (await post(h, body)).json()).accepted, 0);
  assert.equal(store.rows.length, 1);
  assert.ok(!JSON.stringify(store.rows).includes(cid(1)));
  assert.match(store.rows[0].cid_hash, /^[0-9a-f]{64}$/);
});
test('POST: 하루 한도를 넘으면 429', async () => {
  const store = fakeStore(), h = makeDocFormFeedbackHandler({ store, now: () => 1e12 });
  for (let i = 0; i < DAILY_LIMIT; i++) await post(h, { form_id: 'complaint', v: 1, cid: cid(7), adds: ['항목 ' + i + '번'] });
  assert.equal((await post(h, { form_id: 'complaint', v: 1, cid: cid(7), adds: ['또 하나'] })).status, 429);
});
test('candidates: 토큰이 없거나 틀리면 401, 서로 다른 이용자 min 명 이상만 후보', async () => {
  const store = fakeStore(), h = makeDocFormFeedbackHandler({ store });
  for (let u = 1; u <= 5; u++) await post(h, { form_id: 'complaint', v: 1, cid: cid(u), persona: 'law', adds: ['사건 번호'] });
  for (let u = 1; u <= 2; u++) await post(h, { form_id: 'complaint', v: 1, cid: cid(u), persona: 'law', adds: ['증인 목록'] });
  const get = (tok, q = '') => h.handle(new Request('https://x/doc-form/feedback/candidates' + q, { headers: tok ? { Authorization: 'Bearer ' + tok } : {} }), new URL('https://x/doc-form/feedback/candidates' + q), { DOC_FORM_FEEDBACK_TOKEN: 'secret-token' }, {});
  assert.equal((await get('')).status, 401);
  assert.equal((await get('wrong-token')).status, 401);
  const j = await (await get('secret-token')).json();
  assert.deepEqual(j.candidates.map(c => [c.label, c.users]), [['사건 번호', 5]]);
  const j2 = await (await get('secret-token', '?min=2')).json();
  assert.equal(j2.candidates.length, 2);
});
test('aggregateCandidates: 같은 이용자가 여러 번 내도 1명, 대표 라벨은 가장 많이 쓰인 표기', () => {
  const rows = [
    { form_id: 'f', version: 1, kind: 'add', label_norm: 'a1', label: '채권 번호', cid_hash: 'u1', ts: 1 },
    { form_id: 'f', version: 1, kind: 'add', label_norm: 'a1', label: '채권번호', cid_hash: 'u2', ts: 2 },
    { form_id: 'f', version: 1, kind: 'add', label_norm: 'a1', label: '채권번호', cid_hash: 'u3', ts: 3 },
    { form_id: 'f', version: 2, kind: 'add', label_norm: 'a1', label: '채권번호', cid_hash: 'u1', ts: 4 },
  ];
  const r = aggregateCandidates(rows, { min: 3 });
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].label, r[0].users, r[0].version], ['채권번호', 3, 1]);
});

// ── 사용자 제보 내보내기 · [FEEDBACK] 태그 (2026-11-06) ──
import { makeUserFeedbackExportHandler } from '../src/worker/user-feedback-export.js';
await import('../embed-delegate.js');
test('제보 내보내기: 토큰이 없거나 틀리면 401, 맞으면 [naviweb:] 제보만 L1 에서 가져온다', async () => {
  const calls = [];
  const fetchImpl = async (u, o) => { calls.push([u, o]); return new Response(JSON.stringify({ items: [{ id: 'a', raw_text: '[naviweb:bug] 내용=x' }], totalPages: 1 }), { status: 200 }); };
  const h = makeUserFeedbackExportHandler({ base: 'https://l1', getToken: async () => 'ADMIN', fetchImpl });
  const get = (qs, tok) => h.handle(new Request('https://x/user-feedback/export' + qs, { headers: tok ? { Authorization: 'Bearer ' + tok } : {} }), new URL('https://x/user-feedback/export' + qs), { USER_FEEDBACK_EXPORT_TOKEN: 'SECRET' });
  assert.equal((await get('', null)).status, 401);
  assert.equal((await get('', 'wrong')).status, 401);
  assert.equal(calls.length, 0, '인증 전에는 L1 을 부르지 않는다');
  const r = await get('?since=2026-11-01&limit=10', 'SECRET'); const j = await r.json();
  assert.equal(r.status, 200); assert.equal(j.count, 1);
  assert.match(decodeURIComponent(calls[0][0]), /raw_text~'\[naviweb:' && created>='2026-11-01'/); assert.equal(calls[0][1].headers.Authorization, 'Bearer ADMIN');
  assert.equal(await h.handle(new Request('https://x/other'), new URL('https://x/other'), {}), null);
  const bad = await get("?since=2026-11-01'%20||%20true", 'SECRET'); assert.equal(bad.status, 200);
  assert.ok(!/true/.test(decodeURIComponent(calls[1][0])), 'since 는 날짜 모양만 받는다');
  const nokTok = makeUserFeedbackExportHandler({ base: 'https://l1', getToken: async () => 't', fetchImpl });
  assert.equal((await nokTok.handle(new Request('https://x/user-feedback/export'), new URL('https://x/user-feedback/export'), {})).status, 401, '토큰 미설정이면 거부');
});
test('[FEEDBACK] 태그: 오류·기관·서류 요청을 뽑고 화면에서는 지운다', () => {
  const E = globalThis.EmbedDelegate;
  const r = E.parseDocTags('죄송합니다. 알려 드리겠습니다.\n[FEEDBACK: kind=attach; label=가족관계증명서; problem=agency; right=대법원; text=정부24에서는 안 나와요]');
  assert.deepEqual(r.feedback, { kind: 'attach', label: '가족관계증명서', problem: 'agency', right: '대법원', text: '정부24에서는 안 나와요' });
  assert.equal(r.clean, '죄송합니다. 알려 드리겠습니다.');
  assert.equal(E.parseDocTags('[FEEDBACK: kind=hack; text=x]').feedback, null);
  assert.equal(E.parseDocTags('[FEEDBACK: kind=bug; problem=zzz; text=멈춰요]').feedback.problem, '');
  assert.equal(E.parseDocTags('[AGENT_TASK: slot=a; goal=b]').feedback, null);
});
