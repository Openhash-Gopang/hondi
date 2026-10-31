/**
 * tests/case-scenarios.test.mjs — 사고 실험: 맡은 일·맡긴 일·나 홀로 프로세스를 실제 코드로 끝까지 돌려 본다.
 * 두 사람의 "기기"(각자 PDV=MemoryAdapter)와 "서버"(case-server + 가짜 KV)를 연결한다.
 * 실행: node --test tests/case-scenarios.test.mjs
 *
 * 이 파일은 두 종류를 담는다.
 *  [동작] 지금 코드로 실제로 되는 것을 검증한다.
 *  [한계] 사고 실험에서 드러난 빈틈을 "현재 동작 그대로" 고정해 둔다 — 고치면 이 테스트가 깨지므로
 *         그때 기대값을 바꾸면서 해결 여부를 확인한다. (번호 G1~G12 는 보고서와 같다)
 * 봉투 암호화는 아직 연결되지 않아 sealed()는 base64 로 흉내만 낸다(서버가 읽을 수 있는 상태 — G2).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
await import('../case-core.js'); await import('../case-invite.js'); await import('../case-mailbox.js'); await import('../case-store.js');
import { makeCaseServer } from '../src/worker/case-server.js';
const C = globalThis.CaseCore, I = globalThis.CaseInvite, { CaseStore, MemoryAdapter } = globalThis.CaseStore;

const sha = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64');
const unb64 = s => JSON.parse(Buffer.from(s, 'base64').toString());

function world() {
  let t = Date.UTC(2026, 10, 1, 0, 0, 0);
  const m = new Map();
  const kv = { get: async k => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); },
    list: async ({ prefix }) => ({ keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }) };
  const pushes = [];
  const server = makeCaseServer({ kv, env: {}, now: () => t, notify: async g => { pushes.push(g); },
    resolveGuid: async (e, b) => (b && b.guid ? { ok: true, guid: b.guid } : { ok: false, status: 403 }) });
  const now = () => new Date(t).toISOString();
  const tick = ms => { t += ms; };
  const device = guid => {
    const store = new CaseStore(MemoryAdapter(), { now });
    const call = (op, body) => server[op](Object.assign({ guid, ts: t }, body));
    return { guid, store, call };
  };
  return { server, kv, m, pushes, now, tick, device, clock: () => t };
}
const env = (from, to, kind, obj, case_id) => ({ from, to, kind, nonce: 'n' + Math.random().toString(36).slice(2), ciphertext: b64(obj),
  content_hash: 'a'.repeat(64), case_id_hash: 'b'.repeat(64), created_at: new Date().toISOString() });
const inbox = async d => (await d.call('mailboxPull', {})).json.items;
const confirmationsOf = h => ({ provider: h.some(e => e.type === 'agreement_confirm' && e.actor_side === 'provider'), consumer: h.some(e => e.type === 'agreement_confirm' && e.actor_side === 'consumer') });

// ───────────────────────────────────────────────────────────────
// 1. 맡은 일(변호사) ↔ 맡긴 일(의뢰인): 초대 → 가입 → 합의 → 진행 → 종료
// ───────────────────────────────────────────────────────────────
test('[동작] 초대 → 가입 → 알림 → 합의 → 진행 → 종료 요청 → 동의 → 보관, 양쪽 기록 모두 무결', async () => {
  const w = world(), lawyer = w.device('u-lawyer'), client = w.device('u-client'), CID = 'case-1';

  // ① 변호사가 일을 만들고 초대권을 발행해 서버에 해시만 등록
  const created = await lawyer.store.createCase({ case_id: CID, title: '김○○ 임금 사건', kind: 'case', my_side: 'provider' });
  assert.equal(created.value.state, 'proposed');
  const inv = await I.createInvitation({ case_id: CID, inviter_id: lawyer.guid, inviter_side: 'provider', invitee_email: 'client@example.com' }, w.now());
  assert.equal((await lawyer.call('inviteRegister', { token_hash: inv.server_record.token_hash })).status, 200);
  await lawyer.store.patchCase(CID, { invitation: inv.invitation });

  // ② 의뢰인이 링크로 가입 → 서버가 변호사 우편함에 가입 사실·아이디·메일 아이디를 넣고 푸시
  w.tick(3600e3);
  const claim = await client.call('inviteClaim', { token: inv.token, mail_id: 'park' });
  assert.equal(claim.json.inviter_user_id, lawyer.guid);
  assert.deepEqual(w.pushes, [lawyer.guid]);
  const notice = (await inbox(lawyer))[0].server_notice;
  assert.equal(notice.invitee_user_id, client.guid);
  assert.equal(notice.invitee_mail_id, 'park@naviweb.kr');
  const room = await I.chatRoomFor(CID, lawyer.guid, client.guid);
  assert.equal(room.members.length, 2);

  // ③ 변호사가 제안서를 보내고(봉투), 의뢰인이 받아 자기 쪽 기록(맡긴 일)을 만든다
  await lawyer.call('mailboxAck', { ids: [(await inbox(lawyer))[0].id] });
  assert.equal((await lawyer.call('mailboxPush', { envelope: env(lawyer.guid, client.guid, 'agreement', { case_id: CID, title: '김○○ 임금 사건', kind: 'case' }) })).status, 200);
  const prop = (await inbox(client)).find(i => i.envelope);
  const body = unb64(prop.envelope.ciphertext);
  await client.call('mailboxAck', { ids: [prop.id] });
  await client.store.createCase({ case_id: body.case_id, title: body.title, kind: body.kind, my_side: 'consumer' });
  assert.equal((await client.store.getCase(CID)).state, 'proposed');

  // ④ 양측 확인 기록 → 합의 완료 → 시작
  await lawyer.store.append(CID, { type: 'agreement_confirm', actor_side: 'provider', visibility: 'shared', payload: {} });
  await client.store.append(CID, { type: 'agreement_confirm', actor_side: 'consumer', visibility: 'shared', payload: {} });
  await lawyer.store.append(CID, { type: 'agreement_confirm', actor_side: 'consumer', visibility: 'shared', payload: { via: 'mailbox' } });   // 의뢰인의 확인을 변호사 기록에 반영
  await client.store.append(CID, { type: 'agreement_confirm', actor_side: 'provider', visibility: 'shared', payload: { via: 'mailbox' } });
  for (const d of [lawyer, client]) {
    const cf = confirmationsOf(await d.store.history(CID));
    assert.deepEqual(cf, { provider: true, consumer: true });
    assert.equal((await d.store.applyTransition(CID, 'accept', { side: d.guid === lawyer.guid ? 'provider' : 'consumer', confirmations: cf })).state, 'agreed');
    assert.equal((await d.store.applyTransition(CID, 'activate', { side: d.guid === lawyer.guid ? 'provider' : 'consumer' })).state, 'active');
  }

  // ⑤ 진행: 변호사 내부 메모(비공개) + 공유 진행 상황 → 의뢰인 투영에는 공유만
  await lawyer.store.append(CID, { type: 'note', actor_side: 'provider', visibility: 'internal', payload: { text: '상대 변호사 약점 메모' } });
  await lawyer.store.append(CID, { type: 'note', actor_side: 'provider', visibility: 'shared', payload: { text: '소장 접수 완료' } });
  const proj = C.projectForConsumer(await lawyer.store.history(CID));
  assert.ok(proj.every(p => p.payload == null || !JSON.stringify(p.payload).includes('약점')));
  assert.ok(proj.some(p => p.payload && p.payload.text === '소장 접수 완료'));

  // ⑥ 종료: 미결제 청구서가 있으면 동의해도 종료 불가 → 해결 후 종료 → 보관
  assert.equal((await lawyer.store.applyTransition(CID, 'request_close', { side: 'provider' })).ok, false);          // 결과 없이 불가
  assert.equal((await lawyer.store.applyTransition(CID, 'request_close', { side: 'provider', outcome: '승소' }, { payload: { outcome: '승소' } })).state, 'closing');
  assert.equal((await client.store.applyTransition(CID, 'request_close', { side: 'provider', outcome: '승소' }, { payload: { outcome: '승소' } })).state, 'closing');
  assert.equal((await client.store.applyTransition(CID, 'close_agree', { side: 'consumer', closeRequestedBy: 'provider', unpaidInvoices: 1 })).ok, false);
  assert.equal((await client.store.applyTransition(CID, 'close_agree', { side: 'consumer', closeRequestedBy: 'provider', unpaidInvoices: 0 })).state, 'closed');
  assert.equal((await lawyer.store.applyTransition(CID, 'close_agree', { side: 'consumer', closeRequestedBy: 'provider', unpaidInvoices: 0 })).state, 'closed');
  for (const d of [lawyer, client]) {
    assert.equal((await d.store.applyTransition(CID, 'archive', { side: d.guid === lawyer.guid ? 'provider' : 'consumer' })).state, 'archived');
    assert.equal((await d.store.verify(CID)).ok, true);
  }
  // 보관된 일은 되살릴 수 없다
  assert.equal((await lawyer.store.applyTransition(CID, 'activate', { side: 'provider' })).ok, false);

  // ⑦ 해시 앵커: 변호사 기록 수만큼 큐에 쌓이고, 본문·제목·평문 case_id 는 전송되지 않는다
  const sent = [];
  const l2 = new CaseStore(MemoryAdapter(), { now: w.now, endpoint: 'e', who: 'w', fetch: async (u, i) => { sent.push(i.body); return { ok: true }; } });
  await l2.createCase({ case_id: 'x', title: '비밀 제목', kind: 'case', my_side: 'provider' });
  await l2.append('x', { type: 'note', actor_side: 'provider', visibility: 'internal', payload: { text: '비밀 본문' } });
  assert.deepEqual(await l2.flushAnchors(), { sent: 1, failed: 0, pending: 0 });
  assert.ok(!sent.join('').includes('비밀') && !sent.join('').includes('"x"'));
});

test('[동작] 종료 이의·보류: 되돌아가 계속 진행, 요청자는 자기 요청에 이의 불가', async () => {
  const w = world(), a = w.device('a'), id = 'c';
  await a.store.createCase({ case_id: id, title: 't', kind: 'case', my_side: 'provider' });
  const cf = { provider: true, consumer: true };
  await a.store.applyTransition(id, 'accept', { side: 'provider', confirmations: cf }); await a.store.applyTransition(id, 'activate', { side: 'provider' });
  await a.store.applyTransition(id, 'request_close', { side: 'provider', outcome: '합의' });
  assert.equal((await a.store.applyTransition(id, 'close_dispute', { side: 'provider', closeRequestedBy: 'provider' })).ok, false);
  assert.equal((await a.store.applyTransition(id, 'close_dispute', { side: 'consumer', closeRequestedBy: 'provider' })).state, 'active');
  await a.store.applyTransition(id, 'request_close', { side: 'consumer', outcome: '다시' });
  assert.equal((await a.store.applyTransition(id, 'close_hold', { side: 'provider', closeRequestedBy: 'consumer' })).state, 'on_hold');
});

test('[동작] 소통 이력: 수기 기록은 미확인, 상대가 확인/이의 가능, 기록자 본인은 불가', async () => {
  const w = world(), lawyer = w.device('l'), client = w.device('c');
  const c = C.buildCommunication({ recorder_side: 'provider', who: '김변호사', with: '박의뢰인', occurred_at: '2026-10-31T09:00:00Z', channel: 'phone', how: 'manual', summary: '기일 안내', purpose: 'info' }, w.now());
  assert.equal(c.value.confirm_status, 'unconfirmed');
  assert.equal(C.respondCommunication(c.value, 'provider', 'confirmed').ok, false);
  assert.equal(C.respondCommunication(c.value, 'consumer', 'confirmed').confirm_status, 'confirmed');
});

// ───────────────────────────────────────────────────────────────
// 2. 나 홀로
// ───────────────────────────────────────────────────────────────
test('[동작] 나 홀로: 합의 없이 시작 → 기록 → 보류/재개 → 결과 적고 종료 → 보관, 제3자 소통은 본인 기록', async () => {
  const w = world(), me = w.device('me'), id = 'solo-1';
  assert.equal((await me.store.createCase({ mode: 'solo', case_id: id, title: '내 임대차 소송' })).value.state, 'active');
  await me.store.append(id, { type: 'note', actor_side: 'self', payload: { text: '소장 초안' } });
  const comm = C.buildCommunication({ recorder_side: 'self', who: '나', with: '○○지방법원', occurred_at: '2026-10-31T09:00:00Z', channel: 'in_person', place: '민원실', how: 'manual', summary: '소장 접수', purpose: 'report' }, w.now());
  assert.equal(comm.value.confirm_status, 'self');
  await me.store.append(id, { type: 'comm', actor_side: 'self', payload: comm.value });
  assert.equal((await me.store.applyTransition(id, 'hold', { side: 'self' })).state, 'on_hold');
  assert.equal((await me.store.applyTransition(id, 'resume', { side: 'self' })).state, 'active');
  assert.equal((await me.store.applyTransition(id, 'close_self', { side: 'self' })).ok, false);                      // 결과 필수
  assert.equal((await me.store.applyTransition(id, 'close_self', { side: 'self', outcome: '승소' }, { payload: { outcome: '승소' } })).state, 'closed');
  assert.equal((await me.store.applyTransition(id, 'archive', { side: 'self' })).state, 'archived');
  assert.equal((await me.store.verify(id)).ok, true);
  assert.equal((await me.store.history(id)).at(-2).payload.outcome, '승소');
});

test('[동작] 나 홀로에는 합의·상대 응답 절차가 없고, 맡은 일 전용 side 와 섞이지 않는다', async () => {
  const w = world(), me = w.device('me');
  await me.store.createCase({ mode: 'solo', case_id: 's', title: 't' });
  for (const ev of ['accept', 'request_close', 'close_agree', 'close_dispute', 'close_hold']) assert.equal((await me.store.applyTransition('s', ev, { side: 'self', outcome: 'x', closeRequestedBy: 'self' })).ok, false, ev);
  assert.equal((await me.store.applyTransition('s', 'hold', { side: 'provider' })).ok, false);
  await me.store.createCase({ case_id: 'e', title: 't', kind: 'case', my_side: 'provider' });
  assert.equal((await me.store.applyTransition('e', 'close_self', { side: 'self', outcome: 'x' })).ok, false);
});

test('[동작] 한 사람이 서로 다른 일에서 공급자이자 소비자: 일별로 역할이 다르고 서로 섞이지 않는다', async () => {
  const w = world(), lawyer = w.device('lawyer'), doctor = w.device('doctor');
  await lawyer.store.createCase({ case_id: 'L1', title: '변호사로 맡은 일', kind: 'case', my_side: 'provider' });
  await lawyer.store.createCase({ case_id: 'L2', title: '환자로 맡긴 일', kind: 'case', my_side: 'consumer' });
  await lawyer.store.createCase({ mode: 'solo', case_id: 'L3', title: '내 일', kind: 'case' });
  const all = await lawyer.store.listCases();
  assert.deepEqual(all.map(c => c.mode + ':' + (c.my_side || '-')).sort(), ['engaged:consumer', 'engaged:provider', 'solo:-']);
  const rooms = new Set([(await I.chatRoomFor('L1', 'lawyer', 'doctor')).room_id, (await I.chatRoomFor('L2', 'lawyer', 'doctor')).room_id]);
  assert.equal(rooms.size, 2);
});

// ───────────────────────────────────────────────────────────────
// 3. 서버·초대 보안
// ───────────────────────────────────────────────────────────────
test('[동작] 보안: 관계 없는 전송 차단, 토큰 재사용·만료·자기초대·위조 from 거부, 우편함 상한', async () => {
  const w = world(), lawyer = w.device('l'), client = w.device('c'), eve = w.device('eve');
  const inv = await I.createInvitation({ case_id: 'c', inviter_id: 'l', inviter_side: 'provider', invitee_email: 'a@b.co' }, w.now());
  await lawyer.call('inviteRegister', { token_hash: inv.server_record.token_hash });
  assert.equal((await eve.call('mailboxPush', { envelope: env('eve', 'l', 'chat', {}) })).json.code, 'NO_RELATION');
  assert.equal((await lawyer.call('inviteClaim', { token: inv.token, mail_id: 'x' })).json.code, 'SELF_INVITE');
  assert.equal((await client.call('inviteClaim', { token: inv.token, mail_id: 'c' })).status, 200);
  assert.equal((await eve.call('inviteClaim', { token: inv.token, mail_id: 'e' })).json.code, 'INVITE_USED');
  assert.equal((await client.call('mailboxPush', { envelope: env('l', 'l', 'chat', {}) })).json.code, 'FROM_MISMATCH');
  const inv2 = await I.createInvitation({ case_id: 'd', inviter_id: 'l', inviter_side: 'provider', invitee_email: 'a@b.co' }, w.now());
  await lawyer.call('inviteRegister', { token_hash: inv2.server_record.token_hash });
  w.tick(15 * 86400e3);
  assert.equal((await eve.call('inviteClaim', { token: inv2.token, mail_id: 'e' })).json.code, 'INVITE_EXPIRED');
});

// ───────────────────────────────────────────────────────────────
// 4. 한계 — 사고 실험에서 드러난 빈틈 (현재 동작을 고정)
// ───────────────────────────────────────────────────────────────
test('[한계 G1] 기록에 서명이 없다: 변호사가 의뢰인의 확인을 마음대로 자기 기록에 써넣을 수 있다', async () => {
  const w = world(), lawyer = w.device('l');
  await lawyer.store.createCase({ case_id: 'c', title: 't', kind: 'case', my_side: 'provider' });
  await lawyer.store.append('c', { type: 'agreement_confirm', actor_side: 'provider', visibility: 'shared', payload: {} });
  await lawyer.store.append('c', { type: 'agreement_confirm', actor_side: 'consumer', visibility: 'shared', payload: { forged: true } });   // 의뢰인은 한 일이 없음
  const cf = confirmationsOf(await lawyer.store.history('c'));
  assert.deepEqual(cf, { provider: true, consumer: true });                                                                              // 코어는 막지 못함
  assert.equal((await lawyer.store.applyTransition('c', 'accept', { side: 'provider', confirmations: cf })).state, 'agreed');
  assert.ok(!('signature' in (await lawyer.store.history('c'))[1]));
});

test('[한계 G2] 우편함 봉투가 아직 암호화되지 않았다: 서버(KV)에서 내용이 읽힌다', async () => {
  const w = world(), a = w.device('a'), b = w.device('b');
  const inv = await I.createInvitation({ case_id: 'c', inviter_id: 'a', inviter_side: 'provider', invitee_email: 'x@y.co' }, w.now());
  await a.call('inviteRegister', { token_hash: inv.server_record.token_hash }); await b.call('inviteClaim', { token: inv.token, mail_id: 'b' });
  await a.call('mailboxPush', { envelope: env('a', 'b', 'chat', { text: '기밀 내용' }) });
  const stored = [...w.m.entries()].filter(([k]) => k.startsWith('casemb:b:')).map(([, v]) => unb64(JSON.parse(v).envelope.ciphertext));
  assert.equal(stored[0].text, '기밀 내용');   // 실제 X25519 봉인 연결 전 — 연결되면 이 줄은 실패해야 정상
});

test('[한계 G3] 소비자는 받은 투영의 해시를 검증할 수 없다(원본 필드가 투영에 없음)', async () => {
  const w = world(), lawyer = w.device('l');
  await lawyer.store.createCase({ case_id: 'c', title: 't', kind: 'case', my_side: 'provider' });
  await lawyer.store.append('c', { type: 'note', actor_side: 'provider', visibility: 'shared', payload: { text: '진행' } });
  const [p] = C.projectForConsumer(await lawyer.store.history('c'));
  assert.ok(!('prev_hash' in p) && !('case_id' in p) && !('actor' in p));
  const guess = await sha(C.canonical({ case_id: 'c', seq: p.seq, type: p.type, actor_side: p.actor_side, actor: null, visibility: 'shared', payload: p.payload, at: p.at, corrects: null }));
  assert.notEqual(guess, p.hash);                                   // prev_hash 가 빠져 재계산 불가
  assert.equal(C.verifyProjection([p], await lawyer.store.history('c')).ok, true);   // 원본 전체가 있어야만 검증됨 — 소비자는 원본이 없다
});

test('[한계 G4] 상태 전이를 상대에게 전달·반영하는 함수가 없다: 호출자가 side 를 직접 넣어 흉내 낸다', async () => {
  const w = world(), c = w.device('c');
  assert.equal(typeof c.store.applyRemoteTransition, 'undefined');
  assert.equal(typeof c.store.ingestShared, 'undefined');
  assert.equal(typeof C.deriveConfirmations, 'undefined');
  assert.equal(typeof C.closeRequestedBy, 'undefined');
});

test('[한계 G5] 청구서(Invoice)·GDC 결제 엔티티가 없다: 종료 가드의 unpaidInvoices 는 호출자가 숫자로 넘긴다', async () => {
  assert.equal(typeof C.createInvoice, 'undefined');
  assert.equal(C.transition('closing', 'close_agree', { side: 'consumer', closeRequestedBy: 'provider', unpaidInvoices: 0 }).ok, true);
  assert.equal(C.transition('closing', 'close_agree', { side: 'consumer', closeRequestedBy: 'provider' }).ok, true);   // 값을 안 넘기면 미결제 0 으로 통과
});

test('[한계 G6] 수기 소통의 확인/이의 결과가 원본에 반영되지 않는다(상태 도출 함수 없음)', async () => {
  const w = world(), l = w.device('l');
  await l.store.createCase({ case_id: 'c', title: 't', kind: 'case', my_side: 'provider' });
  const comm = C.buildCommunication({ recorder_side: 'provider', who: 'a', with: 'b', occurred_at: '2026-10-31T09:00:00Z', channel: 'phone', how: 'manual', summary: 's', purpose: 'info' }, w.now()).value;
  await l.store.append('c', { type: 'comm', actor_side: 'provider', visibility: 'shared', payload: comm });
  await l.store.append('c', { type: 'comm_response', actor_side: 'consumer', visibility: 'shared', payload: { target_seq: 1, answer: 'confirmed' } });
  const h = await l.store.history('c');
  assert.equal(h[0].payload.confirm_status, 'unconfirmed');          // 원본은 불변이라 그대로
  assert.equal(typeof C.effectiveConfirmStatus, 'undefined');         // 응답을 합쳐 보여 줄 함수가 없음
});

test('[한계 G7] 여러 기기에서 같은 일에 기록하면 체인이 갈라지고 합칠 방법이 없다', async () => {
  const w = world(), pc = w.device('u'), phone = w.device('u');
  await pc.store.createCase({ case_id: 'c', title: 't', kind: 'case', my_side: 'provider' });
  await pc.store.append('c', { type: 'note', actor_side: 'provider', payload: { text: '공통' } });
  // 폰이 PC 기록을 복사해 간 뒤 서로 따로 기록
  await phone.store.createCase({ case_id: 'c', title: 't', kind: 'case', my_side: 'provider' });
  for (const e of await pc.store.history('c')) await phone.store.append('c', { type: e.type, actor_side: e.actor_side, payload: e.payload, at: e.at });
  await pc.store.append('c', { type: 'note', actor_side: 'provider', payload: { text: 'PC 에서' } });
  await phone.store.append('c', { type: 'note', actor_side: 'provider', payload: { text: '폰에서' } });
  const merged = [...(await pc.store.history('c')), ...(await phone.store.history('c'))];
  assert.equal((await C.verifyChain(merged)).ok, false);
  assert.equal(typeof pc.store.mergeFrom, 'undefined');
});

test('[한계 G8] 나 홀로 → 맡기기(전문가에게 넘기기) 전환이 없다', async () => {
  const w = world(), me = w.device('me');
  await me.store.createCase({ mode: 'solo', case_id: 's', title: 't' });
  assert.equal(typeof me.store.handover, 'undefined');
  assert.equal(typeof me.store.continueAsSolo, 'undefined');
});

test('[한계 G9] 한번 연결된 관계는 해제할 수 없고, 초대는 서버에서 취소할 수 없다', async () => {
  const w = world(), a = w.device('a'), b = w.device('b');
  const inv = await I.createInvitation({ case_id: 'c', inviter_id: 'a', inviter_side: 'provider', invitee_email: 'x@y.co' }, w.now());
  await a.call('inviteRegister', { token_hash: inv.server_record.token_hash }); await b.call('inviteClaim', { token: inv.token, mail_id: 'b' });
  assert.equal(typeof w.server.inviteRevoke, 'undefined');
  assert.equal(typeof w.server.relationBlock, 'undefined');
  w.tick(365 * 86400e3);                                                                                  // 1년 뒤에도
  assert.equal((await a.call('mailboxPush', { envelope: env('a', 'b', 'chat', {}) })).status, 200);       // 관계는 영구
});

test('[한계 G10] 해시 앵커의 사용자 식별자(who.ipv6)를 어디서 얻는지 정해지지 않았다 — 설정이 없으면 전송하지 않고 대기만', async () => {
  const w = world(), s = new CaseStore(MemoryAdapter(), { now: w.now });
  await s.createCase({ mode: 'solo', case_id: 's', title: 't' });
  await s.append('s', { type: 'n', actor_side: 'self' });
  const r = await s.flushAnchors();
  assert.equal(r.sent, 0); assert.ok(r.skipped);
});

test('[한계 G11] 우편함 서버는 KV 최종 일관성이라 두 요청이 겹치면 상한·한도 계산이 어긋날 수 있다(순차 호출에서는 정확)', async () => {
  const w = world(), a = w.device('a');
  const hashes = await Promise.all(Array.from({ length: 25 }, (_, i) => sha('r' + i)));
  const res = await Promise.all(hashes.map(h => a.call('inviteRegister', { token_hash: h })));
  const ok = res.filter(r => r.status === 200).length;
  assert.ok(ok >= 20, '동시 25건 — 한도 20 이므로 정확하면 20, 어긋나면 그 이상: ' + ok);   // 이 가짜 KV 는 즉시 일관이라 ok===20 이 나올 수 있다. 실제 KV 에서는 보장되지 않음.
});

test('[한계 G12] 일의 종류(transaction/case/event)가 엔진에서 같게 취급된다: 종류별 단계·가드 차이가 없다', async () => {
  const w = world(), a = w.device('a');
  for (const kind of ['transaction', 'case', 'event']) {
    await a.store.createCase({ mode: 'solo', case_id: kind, title: kind, kind });
    assert.equal((await a.store.getCase(kind)).state, 'active');
  }
  assert.equal(typeof C.packFor, 'undefined');                     // 도메인 팩(M9)이 오기 전까지 종류별 규칙 없음
});
