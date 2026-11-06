import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeAdminFeedbackHandler, parseReport } from '../src/worker/admin-feedback-handler.js';

const mk = (admin) => {
  const calls = [];
  const fetchImpl = async (u) => { calls.push(decodeURIComponent(u));
    const items = /user_feedback/.test(u)
      ? [{ id: 'r1', raw_text: '[naviweb:attach] 서류=가족관계증명서 | 문제=agency | 올바른기관=대법원 | 내용=틀려요', context_summary: 'doc=소장; dev=abc12345', status: 'new', created: '2026-11-05 10:00:00Z' }, { id: 'x', raw_text: '일반 제보', context_summary: '' }]
      : [{ id: 'f1', guid: 'SECRET-GUID', content: '다크 모드', category: 'ui', status: 'pending', visibility: 'private', vote_count: 1, created: '2026-11-01' }, { id: 'f2', guid: 'G2', content: '엑셀 내보내기', category: 'feature', status: 'reviewing', visibility: 'public', vote_count: 5, created: '2026-10-20' }];
    return new Response(JSON.stringify({ items }), { status: 200 }); };
  return { calls, h: makeAdminFeedbackHandler({ requireAdmin: async () => admin, base: 'https://l1', getToken: async () => 'T', fetchImpl, now: () => Date.parse('2026-11-06T00:00:00Z') }) };
};
const get = (h, qs = '') => h.handle(new Request('https://x/admin/feedback-inbox' + qs), new URL('https://x/admin/feedback-inbox' + qs), {}, {});

test('관리자 제보함: 관리자가 아니면 401이고 L1 을 부르지 않는다', async () => {
  const { h, calls } = mk(null);
  assert.equal((await get(h)).status, 401); assert.equal(calls.length, 0);
  assert.equal(await h.handle(new Request('https://x/other'), new URL('https://x/other'), {}, {}), null);
});
test('관리자 제보함: 나비웹 제보를 풀고, 제안은 찬성순으로 주며 작성자 guid 는 내려 주지 않는다', async () => {
  const { h, calls } = mk({ admin: true });
  const j = await (await get(h, '?days=7')).json();
  assert.equal(j.ok, true);
  assert.deepEqual(j.reports.map(r => [r.kind, r.doc, r.problem, r.right, r.dev]), [['attach', '가족관계증명서', 'agency', '대법원', 'abc12345']]);
  assert.deepEqual(j.suggestions.map(s => s.id), ['f2', 'f1']);
  assert.ok(!JSON.stringify(j).includes('GUID') && !JSON.stringify(j).includes('G2'));
  assert.match(calls[0], /created>='2026-10-30'/);
  assert.equal(parseReport('[naviweb:nope] x'), null);
});
test('관리자 화면: 제보함 섹션과 조회 함수가 있고 로그인 후 불러온다', () => {
  const a = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
  assert.match(a, /id="admin-feedback-menu"/); assert.match(a, /\/admin\/feedback-inbox/);
  assert.match(a, /_loadLetters\(\);\s*_loadFeedbackInbox\(\);/);
  assert.match(a, /_fbiEsc\(x\.content\)/, '제안 내용은 이스케이프해서 그린다');
  const w = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  assert.match(w, /pathname === '\/admin\/feedback-inbox'/);
});
