/**
 * tests/case-core.test.mjs — case-core.js 순수 로직 단위 테스트(저장소·네트워크 없음).
 * 실행: node --test tests/case-core.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
// package.json이 type:module이라 .js는 ESM으로 로드된다 → 브라우저 전역(CaseCore)으로 접근한다.
await import('../case-core.js');
const C = globalThis.CaseCore;

const mk = (o = {}) => ({ case_id: 'c1', type: 'note', actor_side: 'provider', actor: 'u1', visibility: 'internal', payload: { t: 1 }, at: '2026-11-01T00:00:00.000Z', ...o });
async function chain(n, f) {
  const h = [];
  for (let i = 0; i < n; i++) h.push(await C.appendEntry(h, mk(f ? f(i) : {})));
  return h;
}

test('canonical: 키 순서 무관, undefined 제거, NaN 거부', () => {
  assert.equal(C.canonical({ b: 1, a: [2, { d: 1, c: undefined }] }), '{"a":[2,{"d":1}],"b":1}');
  assert.equal(C.canonical({ a: 1, b: 2 }), C.canonical({ b: 2, a: 1 }));
  assert.throws(() => C.canonical({ a: NaN }));
});

test('sha256Hex: 알려진 값', async () => {
  assert.equal(await C.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('상태기계: 정상 경로 proposed→agreed→active→closing→closed→archived', () => {
  const p = { side: 'provider' }, c = { side: 'consumer' };
  assert.equal(C.transition('proposed', 'accept', { ...p, confirmations: { provider: true, consumer: true } }).to, 'agreed');
  assert.equal(C.transition('agreed', 'activate', p).to, 'active');
  const rc = C.transition('active', 'request_close', { ...p, outcome: '승소' });
  assert.equal(rc.to, 'closing');
  assert.equal(C.transition('closing', 'close_agree', { ...c, closeRequestedBy: 'provider', unpaidInvoices: 0 }).to, 'closed');
  assert.equal(C.transition('closed', 'archive', p).to, 'archived');
});

test('상태기계 가드: 한쪽 확인만으로 합의 불가', () => {
  const r = C.transition('proposed', 'accept', { side: 'consumer', confirmations: { provider: true, consumer: false } });
  assert.equal(r.ok, false);
});

test('상태기계 가드: outcome 없는 종료 요청, 요청자 자기 동의, 미결제 청구서 거부', () => {
  assert.equal(C.transition('active', 'request_close', { side: 'provider' }).ok, false);
  assert.equal(C.transition('closing', 'close_agree', { side: 'provider', closeRequestedBy: 'provider' }).ok, false);
  assert.equal(C.transition('closing', 'close_agree', { side: 'consumer', closeRequestedBy: 'provider', unpaidInvoices: 1 }).ok, false);
});

test('상태기계: 이의/보류는 상대편만, 종료된 일은 되살릴 수 없음', () => {
  assert.equal(C.transition('closing', 'close_dispute', { side: 'consumer', closeRequestedBy: 'provider' }).to, 'active');
  assert.equal(C.transition('closing', 'close_hold', { side: 'provider', closeRequestedBy: 'provider' }).ok, false);
  assert.equal(C.transition('closed', 'activate', { side: 'provider' }).ok, false);
  assert.equal(C.transition('declined', 'accept', { side: 'provider' }).ok, false);
});

test('History: 해시체인 정상 검증, 연속 seq/prev_hash', async () => {
  const h = await chain(5);
  assert.deepEqual(h.map(e => e.seq), [1, 2, 3, 4, 5]);
  assert.equal(h[0].prev_hash, C.GENESIS);
  assert.equal(h[3].prev_hash, h[2].hash);
  const v = await C.verifyChain(h);
  assert.equal(v.ok, true);
  assert.equal(v.head, h[4].hash);
});

test('History: 내용 변조·삭제·순서 바꿈 탐지', async () => {
  const h = await chain(4);
  const t1 = JSON.parse(JSON.stringify(h)); t1[1].payload = { t: 999 };
  assert.deepEqual(await C.verifyChain(t1), { ok: false, brokenAt: 2, reason: '내용 변조(hash 불일치)' });
  const t2 = h.filter(e => e.seq !== 2);
  assert.equal((await C.verifyChain(t2)).ok, false);
  const t3 = [h[0], h[2], h[1], h[3]];
  assert.equal((await C.verifyChain(t3)).ok, false);
});

test('History: 정정은 새 항목으로, 없는 seq 정정 거부, appendEntry는 입력 history 불변', async () => {
  const h = await chain(2);
  const len = h.length;
  const fix = await C.appendEntry(h, mk({ corrects: 1, type: 'note_fix' }));
  assert.equal(h.length, len);
  assert.equal(fix.corrects, 1);
  await assert.rejects(() => C.appendEntry(h, mk({ corrects: 99 })));
  await assert.rejects(() => C.appendEntry(h, mk({ actor_side: 'x' })));
  await assert.rejects(() => C.appendEntry(h, mk({ visibility: 'public' })));
});

test('anchorPayload: 본문·평문 case_id 없이 해시만', async () => {
  const [e] = await chain(1, () => ({ payload: { secret: '비밀 사건 내용' } }));
  const a = await C.anchorPayloadFor(e);
  const s = JSON.stringify(a);
  assert.equal(a.content_hash, e.hash);
  assert.ok(!s.includes('비밀'));
  assert.ok(!s.includes('"c1"'));
  assert.equal(a.type, 'case_note');
});

test('소비자 투영: internal 제외, 정정 표시, 원본 대조 통과', async () => {
  const h = [];
  h.push(await C.appendEntry(h, mk({ visibility: 'internal', payload: { memo: '내부 전략' } })));
  h.push(await C.appendEntry(h, mk({ visibility: 'shared', type: 'status', payload: { s: '접수' } })));
  h.push(await C.appendEntry(h, mk({ visibility: 'shared', type: 'status', payload: { s: '접수(정정)' }, corrects: 2 })));
  const p = C.projectForConsumer(h);
  assert.equal(p.length, 2);
  assert.ok(!JSON.stringify(p).includes('내부 전략'));
  assert.equal(p[0].superseded_by, 3);
  assert.equal(p[1].superseded_by, null);
  assert.equal(C.verifyProjection(p, h).ok, true);
});

test('투영 검증: 위조 해시·internal 해시 포함 탐지', async () => {
  const h = [];
  h.push(await C.appendEntry(h, mk({ visibility: 'internal' })));
  h.push(await C.appendEntry(h, mk({ visibility: 'shared' })));
  const p = C.projectForConsumer(h);
  assert.equal(C.verifyProjection([{ ...p[0], hash: 'f'.repeat(64) }], h).ok, false);
  assert.equal(C.verifyProjection([{ seq: 1, hash: h[0].hash }], h).ok, false);
});

const comm = (o = {}) => ({ recorder_side: 'provider', who: '김변호사', with: '박의뢰인', occurred_at: '2026-10-31T09:00:00Z', channel: 'phone', how: 'manual', summary: '기일 안내', purpose: 'info', ...o });
const NOW = '2026-11-01T00:00:00.000Z';

test('소통 이력: 6하 필수 검증', () => {
  assert.equal(C.buildCommunication(comm(), NOW).ok, true);
  for (const k of ['who', 'with', 'occurred_at', 'summary']) {
    const r = C.buildCommunication(comm({ [k]: '' }), NOW);
    assert.equal(r.ok, false, k);
  }
  assert.equal(C.buildCommunication(comm({ channel: 'fax' }), NOW).ok, false);
  assert.equal(C.buildCommunication(comm({ purpose: '?' }), NOW).ok, false);
  assert.equal(C.buildCommunication(comm({ channel: 'in_person' }), NOW).ok, false);
  assert.equal(C.buildCommunication(comm({ channel: 'in_person', place: '법원 앞 카페' }), NOW).ok, true);
  assert.equal(C.buildCommunication(comm({ occurred_at: '2027-01-01T00:00:00Z' }), NOW).ok, false);
});

test('소통 이력: 언제/기록시각 분리, 자동은 auto·수기는 unconfirmed', () => {
  const m = C.buildCommunication(comm(), NOW).value;
  assert.equal(m.occurred_at, '2026-10-31T09:00:00.000Z');
  assert.equal(m.recorded_at, NOW);
  assert.equal(m.confirm_status, 'unconfirmed');
  assert.equal(C.buildCommunication(comm({ how: 'auto', channel: 'mail' }), NOW).value.confirm_status, 'auto');
  assert.equal(C.buildCommunication(comm(), NOW).visibility, 'internal');
});

test('소통 이력 확인: 상대만, 1회만, 자동 기록은 대상 아님', () => {
  const m = C.buildCommunication(comm(), NOW).value;
  assert.equal(C.respondCommunication(m, 'provider', 'confirmed').ok, false);
  assert.equal(C.respondCommunication(m, 'consumer', 'confirmed').confirm_status, 'confirmed');
  assert.equal(C.respondCommunication({ ...m, confirm_status: 'confirmed' }, 'consumer', 'disputed').ok, false);
  const a = C.buildCommunication(comm({ how: 'auto', channel: 'mail' }), NOW).value;
  assert.equal(C.respondCommunication(a, 'consumer', 'confirmed').ok, false);
});
