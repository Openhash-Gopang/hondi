/**
 * tests/case-store.test.mjs — case-store.js(M1) 단위 테스트: 메모리 어댑터, 가짜 fetch.
 * 실행: node --test tests/case-store.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
await import('../case-core.js');
await import('../case-store.js');
const { CaseStore, MemoryAdapter } = globalThis.CaseStore;

let t = 0;
const clock = () => new Date(Date.UTC(2026, 10, 1, 0, 0, t++)).toISOString();
const mkStore = (extra = {}) => new CaseStore(MemoryAdapter(), { now: clock, ...extra });

test('Case 생성: 나 홀로는 active, engaged 는 proposed, 중복·입력오류 거부', async () => {
  const s = mkStore();
  assert.equal((await s.createCase({ mode: 'solo', case_id: 's1', title: '내 소송' })).value.state, 'active');
  assert.equal((await s.createCase({ case_id: 'e1', title: '수임', my_side: 'provider' })).value.state, 'proposed');
  assert.equal((await s.createCase({ mode: 'solo', case_id: 's1', title: 'x' })).ok, false);
  assert.equal((await s.createCase({ title: 'x' })).ok, false);
  assert.equal((await s.listCases()).length, 2);
  assert.equal((await s.getCase('s1')).domain, 'work');
});

test('기록 추가: 해시체인이 이어지고 verify 통과, 순서대로 조회', async () => {
  const s = mkStore();
  await s.createCase({ mode: 'solo', case_id: 's1', title: 't' });
  for (let i = 0; i < 12; i++) await s.append('s1', { type: 'note', actor_side: 'self', payload: { i } });
  const h = await s.history('s1');
  assert.deepEqual(h.map(e => e.seq), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal((await s.verify('s1')).ok, true);
  assert.equal((await s.append('nope', { type: 'n', actor_side: 'self' })).ok, false);
});

test('Case 간 기록 분리: 다른 case_id 의 기록이 섞이지 않는다(접두사 충돌 포함)', async () => {
  const s = mkStore();
  await s.createCase({ mode: 'solo', case_id: 'a', title: 't' });
  await s.createCase({ mode: 'solo', case_id: 'a2', title: 't' });
  await s.append('a', { type: 'n', actor_side: 'self' });
  await s.append('a2', { type: 'n', actor_side: 'self' });
  assert.equal((await s.history('a')).length, 1);
  assert.equal((await s.history('a2')).length, 1);
});

test('상태 전이: 가드 통과 시에만 상태+기록 저장, 실패하면 아무것도 바뀌지 않음', async () => {
  const s = mkStore();
  await s.createCase({ mode: 'solo', case_id: 's1', title: 't' });
  const bad = await s.applyTransition('s1', 'close_self', { side: 'self' });
  assert.equal(bad.ok, false);
  assert.equal((await s.getCase('s1')).state, 'active');
  assert.equal((await s.history('s1')).length, 0);
  const ok = await s.applyTransition('s1', 'close_self', { side: 'self', outcome: '완치' });
  assert.equal(ok.state, 'closed');
  assert.equal((await s.getCase('s1')).state, 'closed');
  assert.equal((await s.history('s1')).length, 1);
  assert.equal((await s.verify('s1')).ok, true);
});

test('앵커: 본문 없이 해시만 전송, 성공 시 anchored, 재호출 시 중복 전송 없음', async () => {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true }; };
  const s = mkStore({ endpoint: 'https://x/pdv/report', fetch, who: '2001:db8::1' });
  await s.createCase({ mode: 'solo', case_id: 's1', title: '비밀 제목' });
  await s.append('s1', { type: 'note', actor_side: 'self', payload: { memo: '비밀 본문' } });
  await s.append('s1', { type: 'note', actor_side: 'self', payload: { memo: '또 비밀' } });
  const r = await s.flushAnchors();
  assert.deepEqual(r, { sent: 2, failed: 0, pending: 0 });
  const wire = JSON.stringify(calls);
  assert.ok(!wire.includes('비밀'));
  assert.ok(!wire.includes('"s1"'));
  assert.equal(calls[0].body.report.who.ipv6, '2001:db8::1');
  assert.match(calls[0].body.report.content_hash, /^[0-9a-f]{64}$/);
  assert.equal((await s.flushAnchors()).sent, 0);
  assert.equal(calls.length, 2);
});

test('앵커: 오프라인(예외/비정상 응답)이면 pending 유지 후 복구되면 전송', async () => {
  let online = false, n = 0;
  const fetch = async () => { n++; if (!online) throw new Error('offline'); return { ok: true }; };
  const s = mkStore({ endpoint: 'e', fetch, who: 'w' });
  await s.createCase({ mode: 'solo', case_id: 's1', title: 't' });
  await s.append('s1', { type: 'note', actor_side: 'self' });
  assert.deepEqual(await s.flushAnchors(), { sent: 0, failed: 1, pending: 1 });
  online = true;
  assert.deepEqual(await s.flushAnchors(), { sent: 1, failed: 0, pending: 0 });
  assert.equal((await s.history('s1')).length, 1);   // 오프라인 중에도 로컬 기록은 확정되어 있었음
});

test('앵커: 서버가 403(서비스 미등록)을 주면 pending 유지, 설정 없으면 skipped', async () => {
  const s1 = mkStore({ endpoint: 'e', fetch: async () => ({ ok: false, status: 403 }), who: 'w' });
  await s1.createCase({ mode: 'solo', case_id: 's1', title: 't' });
  await s1.append('s1', { type: 'n', actor_side: 'self' });
  assert.equal((await s1.flushAnchors()).pending, 1);
  const s2 = mkStore();
  await s2.createCase({ mode: 'solo', case_id: 's1', title: 't' });
  await s2.append('s1', { type: 'n', actor_side: 'self' });
  const r = await s2.flushAnchors();
  assert.equal(r.sent, 0);
  assert.ok(r.skipped);
});

test('저장 후 변조는 verify 가 잡는다(저장소를 직접 수정)', async () => {
  const ad = MemoryAdapter();
  const s = new CaseStore(ad, { now: clock });
  await s.createCase({ mode: 'solo', case_id: 's1', title: 't' });
  await s.append('s1', { type: 'n', actor_side: 'self', payload: { a: 1 } });
  await s.append('s1', { type: 'n', actor_side: 'self', payload: { a: 2 } });
  const e = await ad.get('history', 's1/000001'); e.payload = { a: 999 }; await ad.put('history', 's1/000001', e);
  assert.equal((await s.verify('s1')).ok, false);
});
