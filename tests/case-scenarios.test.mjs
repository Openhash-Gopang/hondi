/**
 * tests/case-scenarios.test.mjs — 사고 실험: 맡은 일·맡긴 일·나 홀로 프로세스를 실제 코드로 끝까지 돌려 본다.
 * 두 사람의 "기기"(각자 PDV=MemoryAdapter)와 "서버"(case-server + 가짜 KV)를 연결한다.
 * 실행: node --test tests/case-scenarios.test.mjs
 *
 * 이 파일은 세 종류를 담는다.
 *  [동작] 지금 코드로 실제로 되는 것을 검증한다.
 *  [해결] 사고 실험에서 드러난 빈틈이 고쳐졌음을 확인한다(S1: G1·G3·G4·G5·G6).
 *  [한계] 아직 남은 빈틈을 "현재 동작 그대로" 고정해 둔다 — 고치면 이 테스트가 깨지므로 그때 기대값을 바꾼다. (G 번호는 보고서와 같다)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
await import('../case-core.js'); await import('../case-sync.js'); await import('../case-seal.js'); await import('../case-invite.js'); await import('../case-mailbox.js'); await import('../case-store.js');
import { makeCaseServer } from '../src/worker/case-server.js';
const C = globalThis.CaseCore, Y = globalThis.CaseSync, I = globalThis.CaseInvite, { CaseStore, MemoryAdapter } = globalThis.CaseStore;

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
  // 서명 키를 가진 기기(맡은 일/맡긴 일용)
  const signedDevice = async guid => {
    const identity = await Y.generateIdentity();
    const store = new CaseStore(MemoryAdapter(), { now, identity });
    const call = (op, body) => server[op](Object.assign({ guid, ts: t }, body));
    return { guid, store, call, identity };
  };
  return { server, kv, m, pushes, now, tick, device, signedDevice, clock: () => t };
}
const env = (from, to, kind, obj, case_id) => ({ from, to, kind, nonce: 'n' + Math.random().toString(36).slice(2), ciphertext: b64(obj),
  content_hash: 'a'.repeat(64), case_id_hash: 'b'.repeat(64), created_at: new Date().toISOString() });
const inbox = async d => (await d.call('mailboxPull', {})).json.items;

// ───────────────────────────────────────────────────────────────
// 1. 맡은 일(변호사) ↔ 맡긴 일(의뢰인): 초대 → 가입 → 합의 → 진행 → 종료
// ───────────────────────────────────────────────────────────────
test('[동작] 초대 → 가입 → 알림 → 합의(서명) → 진행 → 청구·정산 → 종료 요청 → 동의 → 보관, 양쪽 기록 모두 무결', async () => {
  const w = world(), lawyer = await w.signedDevice('u-lawyer'), client = await w.signedDevice('u-client'), CID = 'case-1';

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
  assert.equal((await I.chatRoomFor(CID, lawyer.guid, client.guid)).members.length, 2);

  // ③ 변호사가 제안서를 보내고(봉투), 의뢰인이 받아 자기 쪽 기록(맡긴 일)을 만든다
  await lawyer.call('mailboxAck', { ids: [(await inbox(lawyer))[0].id] });
  const proposal = { case_id: CID, title: '김○○ 임금 사건', kind: 'case' };
  assert.equal((await lawyer.call('mailboxPush', { envelope: env(lawyer.guid, client.guid, 'agreement', proposal) })).status, 200);
  const prop = (await inbox(client)).find(i => i.envelope);
  const body = unb64(prop.envelope.ciphertext);
  await client.call('mailboxAck', { ids: [prop.id] });
  await client.store.createCase({ case_id: body.case_id, title: body.title, kind: body.kind, my_side: 'consumer' });

  // ④ 공개키 교환 → 각자 제안 내용에 서명 확인 → 상대 이벤트를 검증·반영 → 합의 → 시작
  const keys = { provider: lawyer.identity.pub, consumer: client.identity.pub };
  assert.equal((await lawyer.store.setKeys(CID, keys)).ok, true);
  assert.equal((await client.store.setKeys(CID, keys)).ok, true);
  assert.equal((await lawyer.store.applyTransition(CID, 'accept', {})).ok, false);                       // 확인 전에는 불가
  const cl = await lawyer.store.confirmAgreement(CID, proposal), cc = await client.store.confirmAgreement(CID, proposal);
  assert.equal((await client.store.ingestEvent(CID, cl.event)).ok, true);
  assert.equal((await lawyer.store.ingestEvent(CID, cc.event)).ok, true);
  assert.equal((await client.store.ingestEvent(CID, cl.event)).duplicate, true);                          // 재전송은 한 번만 반영
  for (const d of [lawyer, client]) {
    assert.equal((await d.store.applyTransition(CID, 'accept', {})).state, 'agreed');
    assert.equal((await d.store.applyTransition(CID, 'activate', {})).state, 'active');
  }

  // ⑤ 진행: 내부 메모(비공개) + 공유 진행 상황 → 의뢰인 쪽에는 공유 항목만, 해시를 직접 검증할 수 있다
  await lawyer.store.append(CID, { type: 'note', actor_side: 'provider', visibility: 'internal', payload: { text: '상대 변호사 약점 메모' } });
  await lawyer.store.append(CID, { type: 'note', actor_side: 'provider', visibility: 'shared', payload: { text: '소장 접수 완료' } });
  const share = await lawyer.store.buildShareEvents(CID, 0);
  for (const ev of share.events) assert.equal((await client.store.ingestEvent(CID, ev)).ok, true);
  const got = await client.store.peerEntries(CID);
  assert.ok(got.some(p => p.payload && p.payload.text === '소장 접수 완료'));
  assert.ok(!JSON.stringify(got).includes('약점'));
  for (const p of got) assert.equal(await C.verifyEntryHash(p), true);

  // ⑥ 청구서: 제공자가 발행 → 미결제면 동의해도 종료 불가 → 제공자가 정산 서명 → 종료 가능
  const issued = await lawyer.store.signedAppend(CID, { type: 'invoice_issued', body: { invoice_id: 'inv-1', amount: 100000, currency: 'GDC' } });
  assert.equal((await client.store.ingestEvent(CID, issued.event)).ok, true);
  assert.equal((await client.store.signedAppend(CID, { type: 'invoice_settled', body: { invoice_id: 'inv-1' } })).ok, false);   // 소비자는 정산 서명 불가
  assert.equal((await lawyer.store.applyTransition(CID, 'request_close', {})).ok, false);                                       // 결과 없이 불가
  const rc = await lawyer.store.applyTransition(CID, 'request_close', { outcome: '승소' }, { payload: { outcome: '승소' } });
  assert.equal(rc.state, 'closing');
  assert.equal((await client.store.ingestEvent(CID, rc.event)).state, 'closing');
  assert.equal((await client.store.applyTransition(CID, 'close_agree', {})).ok, false);                                         // 미결제 1건
  const settled = await lawyer.store.signedAppend(CID, { type: 'invoice_settled', body: { invoice_id: 'inv-1', tx_ref: 'gdc-tx-1' } });
  assert.equal((await client.store.ingestEvent(CID, settled.event)).ok, true);
  const ca = await client.store.applyTransition(CID, 'close_agree', {});
  assert.equal(ca.state, 'closed');
  assert.equal((await lawyer.store.ingestEvent(CID, ca.event)).state, 'closed');
  for (const d of [lawyer, client]) {
    assert.equal((await d.store.applyTransition(CID, 'archive', {})).state, 'archived');
    assert.equal((await d.store.verify(CID)).ok, true);
  }
  assert.equal((await lawyer.store.applyTransition(CID, 'activate', {})).ok, false);                                            // 보관된 일은 되살릴 수 없음

  // ⑦ 해시 앵커: 본문·제목·평문 case_id 는 전송되지 않는다
  const sent = [];
  const l2 = new CaseStore(MemoryAdapter(), { now: w.now, endpoint: 'e', who: 'w', fetch: async (u, i) => { sent.push(i.body); return { ok: true }; } });
  await l2.createCase({ case_id: 'x', title: '비밀 제목', kind: 'case', my_side: 'provider' });
  await l2.append('x', { type: 'note', actor_side: 'provider', visibility: 'internal', payload: { text: '비밀 본문' } });
  assert.deepEqual(await l2.flushAnchors(), { sent: 1, failed: 0, pending: 0 });
  assert.ok(!sent.join('').includes('비밀') && !sent.join('').includes('"x"'));
});
test('[동작] 종료 이의·보류: 되돌아가 계속 진행, 요청자는 자기 요청에 이의 불가', async () => {
  const w = world(), a = await w.signedDevice('a'), b = await w.signedDevice('b'), id = 'c', pr = { t: 1 };
  await a.store.createCase({ case_id: id, title: 't', kind: 'case', my_side: 'provider' });
  await b.store.createCase({ case_id: id, title: 't', kind: 'case', my_side: 'consumer' });
  const keys = { provider: a.identity.pub, consumer: b.identity.pub };
  await a.store.setKeys(id, keys); await b.store.setKeys(id, keys);
  const x = await a.store.confirmAgreement(id, pr), y = await b.store.confirmAgreement(id, pr);
  await b.store.ingestEvent(id, x.event); await a.store.ingestEvent(id, y.event);
  for (const d of [a, b]) { await d.store.applyTransition(id, 'accept', {}); await d.store.applyTransition(id, 'activate', {}); }
  const rc = await a.store.applyTransition(id, 'request_close', { outcome: '합의' }, { payload: { outcome: '합의' } });
  await b.store.ingestEvent(id, rc.event);
  assert.equal((await a.store.applyTransition(id, 'close_dispute', {})).ok, false);                  // 요청자 본인
  const dis = await b.store.applyTransition(id, 'close_dispute', {});
  assert.equal(dis.state, 'active');
  assert.equal((await a.store.ingestEvent(id, dis.event)).state, 'active');
  const rc2 = await b.store.applyTransition(id, 'request_close', { outcome: '다시' }, { payload: { outcome: '다시' } });
  await a.store.ingestEvent(id, rc2.event);
  const hold = await a.store.applyTransition(id, 'close_hold', {});
  assert.equal(hold.state, 'on_hold');
  assert.equal((await b.store.ingestEvent(id, hold.event)).state, 'on_hold');
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
test('[해결 G1] 기록에 서명이 필요하다: 변호사가 의뢰인의 확인을 위조해도 합의로 인정되지 않는다', async () => {
  const w = world(), lawyer = await w.signedDevice('l'), client = await w.signedDevice('c'), pr = { t: 1 };
  await lawyer.store.createCase({ case_id: 'c', title: 't', kind: 'case', my_side: 'provider' });
  await client.store.createCase({ case_id: 'c', title: 't', kind: 'case', my_side: 'consumer' });
  const keys = { provider: lawyer.identity.pub, consumer: client.identity.pub };
  await lawyer.store.setKeys('c', keys); await client.store.setKeys('c', keys);
  await lawyer.store.confirmAgreement('c', pr);
  // 위조 1: 서명 없이 "소비자 확인" 항목을 자기 기록에 써넣기
  await lawyer.store.append('c', { type: 'agreement_confirm', actor_side: 'consumer', visibility: 'shared', payload: { forged: true } });
  // 위조 2: 자기 키로 서명한 항목을 소비자 것인 척 기록
  const fake = await Y.signPayload(lawyer.identity, 'c', 'agreement_confirm', 'consumer', { proposal_hash: await C.sha256Hex(C.canonical(pr)) });
  await lawyer.store.append('c', { type: 'agreement_confirm', actor_side: 'consumer', visibility: 'shared', payload: fake });
  const cf = await Y.deriveConfirmations(await lawyer.store.history('c'), keys);
  assert.deepEqual([cf.provider, cf.consumer], [true, false]);
  assert.equal((await lawyer.store.applyTransition('c', 'accept', {})).ok, false);
  // 위조 3: 소비자 쪽으로 가장한 이벤트를 자기 키로 서명해 의뢰인에게 보내기
  const ev = await Y.buildEvent(lawyer.identity, { kind: 'entry', case_id: 'c', side: 'consumer', data: { type: 'agreement_confirm', payload: fake } });
  assert.equal((await lawyer.store.ingestEvent('c', ev)).ok, false);                                    // 내 쪽 이벤트라 거부
  assert.equal((await client.store.ingestEvent('c', ev)).code, 'WRONG_SIDE');                           // 소비자는 상대(제공자)가 보낸 것만 받음
  // 호출자가 side/confirmations 를 속여도 소용없다
  assert.equal((await lawyer.store.applyTransition('c', 'accept', { side: 'consumer', confirmations: { provider: true, consumer: true } })).ok, false);
});
test('[해결 G2] 우편함 봉투가 종단 암호화된다: 서버(KV)에서 내용이 읽히지 않고 수신자만 연다', async () => {
  const S = globalThis.CaseSeal;
  const w = world(), a = w.device('a'), b = w.device('b');
  const inv = await I.createInvitation({ case_id: 'c', inviter_id: 'a', inviter_side: 'provider', invitee_email: 'x@y.co' }, w.now());
  await a.call('inviteRegister', { token_hash: inv.server_record.token_hash }); await b.call('inviteClaim', { token: inv.token, mail_id: 'b' });
  const box = await S.generateBoxKey();
  const e = await S.seal({ from: 'a', to: 'b', kind: 'chat', case_id_hash: await sha('c') }, { text: '기밀 내용' }, box.pub, w.now());
  assert.equal((await a.call('mailboxPush', { envelope: e })).status, 200);
  const stored = [...w.m.entries()].filter(([k]) => k.startsWith('casemb:b:')).map(([, v]) => v).join('');
  assert.ok(!stored.includes('기밀') && !Buffer.from(JSON.parse(stored).envelope.ciphertext, 'base64').toString('latin1').includes('기밀'));
  const item = (await b.call('mailboxPull', {})).json.items[0];
  assert.deepEqual((await S.open(item.envelope, box)).value, { text: '기밀 내용' });
});

test('[해결 G3] 소비자는 받은 항목의 해시를 직접 검증하고, 변조·다른 일 항목은 거부한다', async () => {
  const w = world(), lawyer = await w.signedDevice('l'), client = await w.signedDevice('c');
  await lawyer.store.createCase({ case_id: 'c', title: 't', kind: 'case', my_side: 'provider' });
  await client.store.createCase({ case_id: 'c', title: 't', kind: 'case', my_side: 'consumer' });
  const keys = { provider: lawyer.identity.pub, consumer: client.identity.pub };
  await lawyer.store.setKeys('c', keys); await client.store.setKeys('c', keys);
  await lawyer.store.append('c', { type: 'note', actor_side: 'provider', visibility: 'internal', payload: { text: '내부' } });
  await lawyer.store.append('c', { type: 'note', actor_side: 'provider', visibility: 'shared', payload: { text: '진행' } });
  const [p] = C.projectForConsumer(await lawyer.store.history('c'));
  for (const k of ['prev_hash', 'case_id', 'actor', 'visibility', 'corrects']) assert.ok(k in p, k);
  assert.equal(await C.verifyEntryHash(p), true);                                       // 원본 전체 없이 검증
  assert.equal(await C.verifyEntryHash({ ...p, payload: { text: '변조' } }), false);
  assert.ok(!JSON.stringify(p).includes('내부'));
  // 서명된 이벤트로 받되, 내용이 바뀌면 서명 검증에서, 일이 다르면 거부
  const { events } = await lawyer.store.buildShareEvents('c', 0);
  const tampered = { ...events[0], data: { ...events[0].data, payload: { text: '변조' } } };
  assert.equal((await client.store.ingestEvent('c', tampered)).code, 'BAD_SIGNATURE');
  assert.equal((await client.store.ingestEvent('other', events[0])).code, 'NO_CASE');
  assert.equal((await client.store.ingestEvent('c', events[0])).ok, true);
});
test('[해결 G4] 상태 전이를 상대에게 전달·반영하고, 양쪽 상태가 어긋나면 탐지한다', async () => {
  const w = world(), a = await w.signedDevice('a'), b = await w.signedDevice('b'), id = 'c', pr = { t: 1 };
  await a.store.createCase({ case_id: id, title: 't', kind: 'case', my_side: 'provider' });
  await b.store.createCase({ case_id: id, title: 't', kind: 'case', my_side: 'consumer' });
  const keys = { provider: a.identity.pub, consumer: b.identity.pub };
  await a.store.setKeys(id, keys); await b.store.setKeys(id, keys);
  const x = await a.store.confirmAgreement(id, pr), y = await b.store.confirmAgreement(id, pr);
  await b.store.ingestEvent(id, x.event); await a.store.ingestEvent(id, y.event);
  for (const d of [a, b]) { await d.store.applyTransition(id, 'accept', {}); await d.store.applyTransition(id, 'activate', {}); }
  // 의뢰인이 보류했는데(변호사는 아직 모름) 변호사가 종료 요청 → 의뢰인 쪽에서 상태 불일치 탐지
  await b.store.applyTransition(id, 'hold', {});
  const rc = await a.store.applyTransition(id, 'request_close', { outcome: '끝' }, { payload: { outcome: '끝' } });
  const r = await b.store.ingestEvent(id, rc.event);
  assert.equal(r.code, 'STATE_MISMATCH');
  assert.equal((await b.store.getCase(id)).state, 'on_hold');                           // 불일치 이벤트는 반영되지 않는다
  // 서명 없는 전이 조작: 서명 payload 를 바꾸면 거부
  const forged = { ...rc.event, data: { ...rc.event.data, payload: { ...rc.event.data.payload, outcome: '조작' } } };
  assert.equal((await b.store.ingestEvent(id, forged)).code, 'BAD_SIGNATURE');
  // 가드 입력은 호출자가 못 속인다(키 없이 합의·종료 불가)
  const c = await w.signedDevice('c2'); await c.store.createCase({ case_id: 'k', title: 't', kind: 'case', my_side: 'provider' });
  assert.equal((await c.store.applyTransition('k', 'accept', {})).code, 'KEYS_REQUIRED');
});
test('[해결 G5] 종료 가드는 모르면 막는다: 미결제 정보 없이는 종료 불가, 청구서는 제공자 서명만 인정', async () => {
  assert.equal(C.transition('closing', 'close_agree', { side: 'consumer', closeRequestedBy: 'provider' }).ok, false);
  assert.equal(C.transition('closing', 'close_agree', { side: 'consumer', closeRequestedBy: 'provider', unpaidInvoices: null }).ok, false);
  assert.equal(C.transition('closing', 'close_agree', { side: 'consumer', closeRequestedBy: 'provider', unpaidInvoices: 0 }).ok, true);
  const w = world(), l = await w.signedDevice('l'), c = await w.signedDevice('c');
  await l.store.createCase({ case_id: 'x', title: 't', kind: 'case', my_side: 'provider' });
  const keys = { provider: l.identity.pub, consumer: c.identity.pub };
  await l.store.setKeys('x', keys);
  const a = await l.store.signedAppend('x', { type: 'invoice_issued', body: { invoice_id: 'i1', amount: 1 } });
  const b = await l.store.signedAppend('x', { type: 'invoice_issued', body: { invoice_id: 'i2', amount: 1 } });
  assert.equal(await Y.unpaidInvoices(await l.store.history('x'), keys), 2);
  await l.store.signedAppend('x', { type: 'invoice_void', body: { invoice_id: 'i2' } });
  assert.equal(await Y.unpaidInvoices(await l.store.history('x'), keys), 1);
  // 소비자 이름으로 위조한 정산 기록은 무시
  await l.store.append('x', { type: 'invoice_settled', actor_side: 'provider', visibility: 'shared', payload: { invoice_id: 'i1' } });
  assert.equal(await Y.unpaidInvoices(await l.store.history('x'), keys), 1);
  assert.equal(await Y.unpaidInvoices([], null), null);
});
test('[해결 G6] 수기 소통의 확인/이의가 서명된 응답으로 유효 상태에 반영된다(위조 응답은 무시)', async () => {
  const w = world(), l = await w.signedDevice('l'), c = await w.signedDevice('c');
  await l.store.createCase({ case_id: 'c', title: 't', kind: 'case', my_side: 'provider' });
  await c.store.createCase({ case_id: 'c', title: 't', kind: 'case', my_side: 'consumer' });
  const keys = { provider: l.identity.pub, consumer: c.identity.pub };
  await l.store.setKeys('c', keys); await c.store.setKeys('c', keys);
  const comm = C.buildCommunication({ recorder_side: 'provider', who: 'a', with: 'b', occurred_at: '2026-10-31T09:00:00Z', channel: 'phone', how: 'manual', summary: 's', purpose: 'info' }, w.now()).value;
  await l.store.append('c', { type: 'comm', actor_side: 'provider', visibility: 'shared', payload: comm });
  assert.equal(await Y.effectiveConfirmStatus(await l.store.history('c'), 1, keys), 'unconfirmed');
  // 제공자가 자기 기록에 소비자 응답을 위조
  await l.store.append('c', { type: 'comm_response', actor_side: 'consumer', visibility: 'shared', payload: { target_seq: 1, answer: 'confirmed' } });
  assert.equal(await Y.effectiveConfirmStatus(await l.store.history('c'), 1, keys), 'unconfirmed');
  // 의뢰인이 진짜 서명해 이의 → 제공자가 이벤트로 받아 반영
  const resp = await c.store.signedAppend('c', { type: 'comm_response', body: { target_seq: 1, answer: 'disputed' } });
  assert.equal((await l.store.ingestEvent('c', resp.event)).ok, true);
  assert.equal(await Y.effectiveConfirmStatus(await l.store.history('c'), 1, keys), 'disputed');
  assert.equal((await l.store.getCase('c')).state, 'proposed');
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

test('[해결 G9] 초대 취소, 관계 차단/해제: 차단하면 양방향 전달 중단·쌓인 봉투 삭제, 해제는 차단한 본인만', async () => {
  const w = world(), a = w.device('a'), b = w.device('b'), c = w.device('c');
  // 가입 전 초대 취소 → 가입 불가, 남의 초대는 취소 불가
  const i1 = await I.createInvitation({ case_id: 'c', inviter_id: 'a', inviter_side: 'provider', invitee_email: 'x@y.co' }, w.now());
  await a.call('inviteRegister', { token_hash: i1.server_record.token_hash });
  assert.equal((await c.call('inviteRevoke', { token_hash: i1.server_record.token_hash })).status, 404);
  assert.equal((await a.call('inviteRevoke', { token_hash: i1.server_record.token_hash })).status, 200);
  assert.equal((await b.call('inviteClaim', { token: i1.token, mail_id: 'b' })).json.code, 'INVITE_REVOKED');
  // 연결 후 차단
  const i2 = await I.createInvitation({ case_id: 'c', inviter_id: 'a', inviter_side: 'provider', invitee_email: 'x@y.co' }, w.now());
  await a.call('inviteRegister', { token_hash: i2.server_record.token_hash }); await b.call('inviteClaim', { token: i2.token, mail_id: 'b' });
  assert.equal((await a.call('inviteRevoke', { token_hash: i2.server_record.token_hash })).status, 409);       // 가입 후엔 차단으로
  await a.call('mailboxPush', { envelope: env('a', 'b', 'chat', { t: 1 }) });
  assert.equal((await b.call('relationBlock', { peer: 'a' })).json.purged, 1);                                 // b 의 우편함에서 a 의 봉투 삭제
  assert.equal((await a.call('mailboxPush', { envelope: env('a', 'b', 'chat', {}) })).json.code, 'BLOCKED');
  assert.equal((await b.call('mailboxPush', { envelope: env('b', 'a', 'chat', {}) })).json.code, 'BLOCKED');
  assert.equal((await a.call('keyGet', { peer: 'b' })).json.code, 'BLOCKED');
  assert.equal((await a.call('relationUnblock', { peer: 'b' })).json.still_blocked, true);                     // 차단자가 아니면 못 푼다
  assert.equal((await a.call('mailboxPush', { envelope: env('a', 'b', 'chat', {}) })).json.code, 'BLOCKED');
  assert.equal((await b.call('relationUnblock', { peer: 'a' })).json.still_blocked, false);
  assert.equal((await a.call('mailboxPush', { envelope: env('a', 'b', 'chat', {}) })).status, 200);
  assert.equal((await c.call('relationBlock', { peer: 'a' })).status, 404);
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

