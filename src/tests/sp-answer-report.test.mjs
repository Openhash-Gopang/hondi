// 정부 AI 답변 "문제 신고" — SP ID 도출(클라이언트) + 서버 저장(handleSpAnswerReport)
import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveSpIdFromTrace } from '../gopang/ui/answer-report.js';
import { handleSpAnswerReport } from '../../worker.js';

test('trace → 가장 구체적인 SP ID', () => {
  assert.equal(deriveSpIdFromTrace(['JEJU-GOV-COMMON', 'SP-DO-000', 'SP-DO-WELFARE']), 'SP-DO-WELFARE');
  assert.equal(deriveSpIdFromTrace(['JEJU-GOV-COMMON', 'JEJU-NATIONAL-SP', 'SP-POLICY-LAZY(BMTC/github)']), 'SP-POLICY-LAZY(BMTC)');
  assert.equal(deriveSpIdFromTrace(['JEJU-GOV-COMMON', 'SP-CITY-JEJU', 'SP-EMD-한림읍(directCode)', 'PERMIT-CRITERIA-PROTOCOL(a,b)', '(계층충돌 통합판단)']), 'SP-EMD-한림읍');
  assert.equal(deriveSpIdFromTrace(['JEJU-GOV-COMMON']), null);
  assert.equal(deriveSpIdFromTrace(null), null);
});

async function run(body) {
  const calls = []; const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push(JSON.parse(init.body)); return new Response('{"id":"rec1"}', { status: 200 }); };
  try { const r = await handleSpAnswerReport(JSON.stringify(body), {}, {}); return { r, calls }; }
  finally { globalThis.fetch = orig; }
}

test('서버: 저장(해시 사용자·마스킹·분류), 필수값 검증', async () => {
  const { r, calls } = await run({ guid: 'g-1', sp_id: 'SP-EMD-한림읍', kind: 'outdated', comment: '전화 010-1234-5678 로 연락 바뀜', trace: ['SP-CITY-JEJU', 'SP-EMD-한림읍'] });
  assert.equal(r.status, 200);
  const b = calls[0];
  assert.equal(b.context_sp, 'SP-EMD-한림읍');
  assert.equal(b.category, 'bug');
  assert.equal(b.status, 'new');
  assert.match(b.guid, /^h:[0-9a-f]{16}$/);
  assert.ok(!/010-1234/.test(b.raw_text));
  assert.match(b.context_summary, /kind=outdated;src=ui;dk=[0-9a-f]{12};trace=SP-CITY-JEJU>SP-EMD-한림읍/);

  const e1 = await run({ guid: 'g', kind: 'nope' }); assert.equal(e1.r.status, 400);
  const e2 = await run({ kind: 'bug' }); assert.equal(e2.r.status, 401);
  const e3 = await run({ guid: 'g', kind: 'suggestion', sp_id: 'bad id!' });
  assert.equal(e3.calls[0].context_sp, 'unspecified');
  assert.equal(e3.calls[0].category, 'feature_request');
  assert.match(e3.calls[0].raw_text, /개선 제안/);
});
