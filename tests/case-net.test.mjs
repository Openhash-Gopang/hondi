import test from 'node:test';
import assert from 'node:assert/strict';
for (const f of ['core', 'sync', 'seal', 'invite', 'store', 'net']) await import(`../case-${f}.js`);
import { makeCaseServer } from '../src/worker/case-server.js';
const C = globalThis.CaseCore, Y = globalThis.CaseSync, S = globalThis.CaseSeal, I = globalThis.CaseInvite;
const { CaseStore, MemoryAdapter } = globalThis.CaseStore, { CaseNet } = globalThis.CaseNet;

function world() {
  const m = new Map(), t = Date.UTC(2026, 10, 1);
  const kv = { get: async k => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); },
    list: async ({ prefix }) => ({ keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }) };
  const server = makeCaseServer({ kv, env: {}, now: () => t, resolveGuid: async (e, b) => (b && b.guid ? { ok: true, guid: b.guid } : { ok: false, status: 403 }) });
  const ops = { '/case/key/register': 'keyRegister', '/case/key/get': 'keyGet', '/case/mailbox/push': 'mailboxPush', '/case/mailbox/pull': 'mailboxPull', '/case/mailbox/ack': 'mailboxAck' };
  return { m, server, now: () => new Date(t).toISOString(), callFor: guid => (route, body) => server[ops[route]](Object.assign({ guid, ts: t }, body)) };
}
async function dev(w, guid) {
  const identity = await Y.generateIdentity(), box = await S.generateBoxKey(), store = new CaseStore(MemoryAdapter(), { now: w.now, identity });
  const net = CaseNet({ store, box, identity, call: w.callFor(guid), guid });
  return { guid, identity, box, store, net, rec: await S.bindBoxKey(identity, box.pub) };
}

test('종단 간: 키 교환 → 합의·진행 이벤트를 봉인 전송 → 상대가 수신·복호화·반영, 서버는 평문을 못 본다', async () => {
  const w = world(), a = await dev(w, 'a'), b = await dev(w, 'b');
  assert.equal((await a.net.registerKeys()).status, 200);
  const inv = await I.createInvitation({ case_id: 'c', inviter_id: 'a', inviter_side: 'provider', invitee_email: 'x@y.co' }, w.now());
  await w.server.inviteRegister({ guid: 'a', ts: 1, token_hash: inv.server_record.token_hash });
  const claim = await w.server.inviteClaim({ guid: 'b', ts: 1, token: inv.token, mail_id: 'b', key_record: b.rec });
  assert.equal(claim.status, 200);
  await a.store.createCase({ case_id: 'c', title: '비밀 사건명', kind: 'case', my_side: 'provider' });
  await b.store.createCase({ case_id: 'c', title: '비밀 사건명', kind: 'case', my_side: 'consumer' });
  const pa = await a.net.peerKeys('c', 'b'), pb = await b.net.peerKeys('c', 'a');
  assert.deepEqual([pa.ok, pb.ok], [true, true]);
  const keys = { provider: a.identity.pub, consumer: b.identity.pub };
  assert.deepEqual([pa.record.sign_pub, pb.record.sign_pub], [b.identity.pub, a.identity.pub]);
  await a.store.setKeys('c', keys); await b.store.setKeys('c', keys);

  const pr = { t: 1 }, ca = await a.store.confirmAgreement('c', pr), cb = await b.store.confirmAgreement('c', pr);
  assert.equal((await a.net.sendEvents('c', 'b', [ca.event])).sent, 1);
  assert.equal((await b.net.sendEvents('c', 'a', [cb.event])).sent, 1);
  const ra = await a.net.poll(), rb = await b.net.poll();
  assert.deepEqual([ra.applied, rb.applied], [1, 1]);
  assert.ok(ra.notices.some(n => n.type === 'invite_signed_up'));                                  // 가입 알림도 같은 경로로 도착
  for (const d of [a, b]) { assert.equal((await d.store.applyTransition('c', 'accept', {})).state, 'agreed'); await d.store.applyTransition('c', 'activate', {}); }
  assert.equal((await b.net.poll()).applied, 0);                                                    // ack 되어 다시 오지 않음

  await a.store.append('c', { type: 'note', actor_side: 'provider', visibility: 'shared', payload: { text: '소장 접수' } });
  await a.net.sendEvents('c', 'b', (await a.store.buildShareEvents('c', 0)).events);
  assert.equal((await b.net.poll()).applied, 1);
  assert.ok(JSON.stringify(await b.store.peerEntries('c')).includes('소장 접수'));
  assert.ok(![...w.m.values()].join('').includes('소장 접수') && ![...w.m.values()].join('').includes('비밀 사건명'));
});

test('TOFU: 저장된 상대 서명키와 다른 키가 나타나면 KEY_CHANGED 로 막고, 깨진 봉투는 처리·ack 한다', async () => {
  const w = world(), a = await dev(w, 'a'), b = await dev(w, 'b');
  await a.net.registerKeys(); await b.net.registerKeys();
  const inv = await I.createInvitation({ case_id: 'c', inviter_id: 'a', inviter_side: 'provider', invitee_email: 'x@y.co' }, w.now());
  await w.server.inviteRegister({ guid: 'a', ts: 1, token_hash: inv.server_record.token_hash });
  await w.server.inviteClaim({ guid: 'b', ts: 1, token: inv.token, mail_id: 'b' });
  await a.store.createCase({ case_id: 'c', title: 't', kind: 'case', my_side: 'provider' });
  assert.equal((await a.net.peerKeys('c', 'b')).first_seen, true);
  // 서버가 b 의 키를 다른 서명키로 바꿔치기해도(서명키는 서버에서 고정되지만 저장소가 오염된 경우를 가정) 클라이언트가 막는다
  const other = await Y.generateIdentity(), ob = await S.generateBoxKey();
  w.m.set('casekey:b', JSON.stringify({ ...(await S.bindBoxKey(other, ob.pub)), at: 1 }));
  assert.equal((await a.net.peerKeys('c', 'b')).code, 'KEY_CHANGED');
  assert.equal((await a.net.sendEvents('c', 'b', [{ x: 1 }])).code, 'KEY_CHANGED');
  // 엉터리 암호문은 영구 오류로 보고하고 우편함에서 지운다
  const env = await S.seal({ from: 'a', to: 'b', kind: 'chat', case_id_hash: await C.sha256Hex('case:c') }, { x: 1 }, a.box.pub);   // b 가 못 여는 봉투
  await w.server.mailboxPush({ guid: 'a', ts: 1, envelope: env });
  const r = await b.net.poll();
  assert.equal(r.errors[0].code, 'DECRYPT_FAILED');
  assert.equal((await w.server.mailboxPull({ guid: 'b', ts: 1 })).json.items.length, 0);
  assert.equal(a.net.fingerprint(a.identity.pub).split(' ').length, 3);
});
