import test from 'node:test';
import assert from 'node:assert/strict';
for (const f of ['case-core', 'case-sync', 'case-store', 'assistant-core', 'assistant-rules', 'assistant-runtime', 'assistant-host']) await import(`../${f}.js`);
const Y = globalThis.CaseSync, { CaseStore, MemoryAdapter } = globalThis.CaseStore, H = globalThis.AssistantHostLib;
const T0 = '2026-11-01T00:00:00.000Z', plus = d => new Date(Date.parse(T0) + d * 86400000).toISOString();
let clock = T0;
async function mk() {
  const identity = await Y.generateIdentity(), store = new CaseStore(MemoryAdapter(), { now: () => clock, identity });
  return { identity, store, host: H.create({ store, identity, now: () => clock }) };
}

test('기본 규칙팩은 이 기기 키로 서명·검증되어 로드된다(외부 서명 없는 팩은 거부)', async () => {
  clock = T0; const { host, identity } = await mk();
  const l = await host.init();
  assert.equal(l.rejected.length, 0); assert.equal(l.packs.length, 1); assert.equal(l.packs[0].id, 'hondi-case-process');
  assert.equal(l.packs[0].publisher.pub, identity.pub);
  const bad = H.create({ store: (await mk()).store, identity, now: () => clock, packs: [{ id: 'x', version: '1', domain: 'law', effective_from: T0, publisher: { id: 'x', pub: 'AAAA' }, rules: [], sig: 'AAAA' }] });
  const l2 = await bad.init(); assert.deepEqual(l2.rejected.map(r => r.code), ['UNTRUSTED_PUBLISHER']);
});

test('합의 서명 앞 점검: 키 지문 미확인이면 WARN(사용자 선택 필요), 확인했으면 PASS', async () => {
  clock = T0; const { host } = await mk();
  const act = { type: 'case.agree', effect: 'signature', domain: 'law' };
  const w = await host.check(act, { peer_fp_verified: false });
  assert.equal(w.g.result, 'WARN'); assert.ok(w.needs_decision); assert.match(w.notice.text, /지문/);
  const p = await host.check(act, { peer_fp_verified: true });
  assert.equal(p.g.result, 'PASS');
  // 값을 모르면(미평가) 고위험(서명)이라 인간 전문가 권유 — 막지 않고, 특정인을 추천하지 않는다
  const u = await host.check(act, {});
  assert.equal(u.g.result, 'ADVISE_HUMAN'); assert.equal(u.notice.recommends_person, false); assert.match(u.notice.text, /인간 변호사/);
});

test('공유 앞 점검: 주민번호·카드번호 패턴이 있으면 WARN, 없으면 PASS', async () => {
  const { host } = await mk();
  const act = { type: 'case.share', effect: 'external', domain: 'law' };
  assert.equal(H.hasSensitive('연락처 010-1234-5678 / 주민번호 900101-1234567'), true);
  assert.equal(H.hasSensitive('2026년 11월 1일 소장 접수'), false);
  assert.equal((await host.check(act, { has_sensitive: true })).g.result, 'WARN');
  assert.equal((await host.check(act, { has_sensitive: false })).g.result, 'PASS');
});

test('종료 앞 점검: 미결제 청구서가 있으면 BLOCK(진행 불가), 0건이면 PASS, 모르면 WARN(확인 못 함)', async () => {
  const { host } = await mk();
  const act = { type: 'case.close', effect: 'external', domain: 'law' };
  const b = await host.check(act, { unpaid_invoices: 2 }); assert.equal(b.g.result, 'BLOCK'); assert.ok(b.blocked);
  assert.equal((await host.check(act, { unpaid_invoices: 0 })).g.result, 'PASS');
  assert.equal((await host.check(act, {})).g.result, 'WARN');
});

test('선택·결과는 원장에 증명으로 남고(입력은 해시만), 원장 체인은 무결하다', async () => {
  const { host } = await mk();
  const act = { type: 'case.agree', effect: 'signature', domain: 'law', ref: 'c1' }, ctx = { peer_fp_verified: false };
  const c = await host.check(act, ctx);
  await host.record(act, ctx, c.g, { choice: 'continue', reason: '전화로 확인함' });
  const e = (await host.ledger.entries()).filter(x => x.type === 'attestation');
  assert.equal(e.length, 1); assert.equal(e[0].payload.result, 'WARN'); assert.equal(e[0].payload.user_decision, 'continue');
  assert.match(e[0].payload.input_hash, /^[0-9a-f]{64}$/); assert.ok(!JSON.stringify(e[0].payload).includes('peer_fp_verified'));
  assert.equal((await host.ledger.verify()).ok, true);
});

test('기한 알림: findings 는 열린 일 전체를 한국어 한 줄로, lines 는 새 알림만(같은 날 중복 없음)', async () => {
  clock = T0; const { host, store } = await mk();
  await store.createCase({ mode: 'solo', case_id: 's1', title: '임대차 분쟁', kind: 'case' });
  await store.patchCase('s1', { deadlines: [{ label: '답변서 제출', due: plus(1) }] });
  const f = await host.findings();
  assert.equal(f[0].kind, 'deadline'); assert.match(f[0].text, /임대차 분쟁.*답변서 제출.*1일 남았습니다/);
  const l1 = await host.lines(); assert.ok(l1.some(x => x.startsWith('기한:답변서 제출')));
  const l2 = await host.lines(); assert.equal(l2.filter(x => x.startsWith('기한:')).length, 0);   // 같은 날 두 번째 호출은 같은 알림을 다시 내지 않는다
});
