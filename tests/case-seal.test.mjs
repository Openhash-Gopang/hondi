import test from 'node:test';
import assert from 'node:assert/strict';
await import('../case-core.js'); await import('../case-sync.js'); await import('../case-seal.js');
import { makeCaseServer } from '../src/worker/case-server.js';
const C = globalThis.CaseCore, Y = globalThis.CaseSync, S = globalThis.CaseSeal;
const sha = s => C.sha256Hex(s);

test('봉인 → 열기: 받는 사람만 복호화, 겉면 변조·다른 키·암호문 변조는 실패', async () => {
  const bob = await S.generateBoxKey(), eve = await S.generateBoxKey();
  const meta = { from: 'a', to: 'b', kind: 'chat', case_id_hash: await sha('c') };
  const env = await S.seal(meta, { text: '기밀 내용' }, bob.pub);
  assert.ok(!Buffer.from(env.ciphertext, 'base64').toString('latin1').includes('기밀'));
  assert.deepEqual((await S.open(env, bob)).value, { text: '기밀 내용' });
  assert.equal((await S.open(env, eve)).ok, false);
  assert.equal((await S.open({ ...env, from: 'x' }, bob)).code, 'DECRYPT_FAILED');            // AAD 로 묶임
  assert.equal((await S.open({ ...env, kind: 'close' }, bob)).ok, false);
  const raw = Buffer.from(env.ciphertext, 'base64'); raw[40] ^= 1;
  assert.equal((await S.open({ ...env, ciphertext: raw.toString('base64') }, bob)).ok, false);
  const env2 = await S.seal(meta, { text: '기밀 내용' }, bob.pub);
  assert.notEqual(env.ciphertext, env2.ciphertext);                                              // 매번 일회용 키
});

test('봉인키 묶음: 서명키가 다르거나 내용이 바뀌면 검증 실패', async () => {
  const id = await Y.generateIdentity(), other = await Y.generateIdentity(), bx = await S.generateBoxKey(), by = await S.generateBoxKey();
  const rec = await S.bindBoxKey(id, bx.pub);
  assert.equal(await S.verifyBoxKey(rec), true);
  assert.equal(await S.verifyBoxKey({ ...rec, box_pub: by.pub }), false);
  assert.equal(await S.verifyBoxKey({ ...rec, sign_pub: other.pub }), false);
});

function world() {
  const m = new Map();
  const kv = { get: async k => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); },
    list: async ({ prefix }) => ({ keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }) };
  const server = makeCaseServer({ kv, env: {}, now: () => Date.UTC(2026, 10, 1), resolveGuid: async (e, b) => (b && b.guid ? { ok: true, guid: b.guid } : { ok: false, status: 403 }) });
  return { m, server };
}
async function party(guid) { const id = await Y.generateIdentity(), box = await S.generateBoxKey(); return { guid, id, box, rec: await S.bindBoxKey(id, box.pub) }; }

test('서버 키 등록부: 서명 검증·관계 없는 조회 거부·서명키 고정', async () => {
  const { server } = world(), a = await party('a'), b = await party('b'), c = await party('c');
  assert.equal((await server.keyRegister({ guid: 'a', record: a.rec })).status, 200);
  assert.equal((await server.keyRegister({ guid: 'b', record: { ...b.rec, box_pub: a.box.pub } })).json.code, 'BAD_KEY_SIGNATURE');
  assert.equal((await server.keyRegister({ guid: 'a', record: c.rec })).json.code, 'SIGN_KEY_LOCKED');
  const nb = await S.generateBoxKey();                                                           // 같은 서명키로 봉인키 교체는 허용
  assert.equal((await server.keyRegister({ guid: 'a', record: await S.bindBoxKey(a.id, nb.pub) })).status, 200);
  assert.equal((await server.keyGet({ guid: 'b', peer: 'a' })).json.code, 'NO_RELATION');
});

test('초대 가입 시 키 교환 → 봉인 우편함: KV 에는 암호문뿐, 수신자만 복호화', async () => {
  const { server, m } = world(), a = await party('a'), b = await party('b');
  const I = (await import('../case-invite.js'), globalThis.CaseInvite);
  await server.keyRegister({ guid: 'a', record: a.rec });
  const inv = await I.createInvitation({ case_id: 'c', inviter_id: 'a', inviter_side: 'provider', invitee_email: 'x@y.co' }, new Date(Date.UTC(2026, 10, 1)).toISOString());
  await server.inviteRegister({ guid: 'a', token_hash: inv.server_record.token_hash });
  const claim = await server.inviteClaim({ guid: 'b', token: inv.token, mail_id: 'b', key_record: b.rec });
  assert.equal(claim.status, 200);
  assert.equal(claim.json.inviter_keys.box_pub, a.rec.box_pub);                                  // 가입자는 초청자 키를 받는다
  assert.equal(await S.verifyBoxKey(claim.json.inviter_keys), true);
  const notice = JSON.parse([...m.entries()].find(([k]) => k.startsWith('casemb:a:'))[1]).server_notice;
  assert.equal(notice.invitee_keys.box_pub, b.rec.box_pub);                                      // 초청자도 가입자 키를 받는다
  const got = (await server.keyGet({ guid: 'a', peer: 'b' })).json.record;
  assert.equal(got.sign_pub, b.id.pub);
  const env = await S.seal({ from: 'a', to: 'b', kind: 'chat', case_id_hash: await sha('c') }, { text: '기밀 내용' }, got.box_pub);
  assert.equal((await server.mailboxPush({ guid: 'a', envelope: env })).status, 200);
  const stored = [...m.entries()].filter(([k]) => k.startsWith('casemb:b:')).map(([, v]) => v).join('');
  assert.ok(!stored.includes('기밀'));
  const item = (await server.mailboxPull({ guid: 'b' })).json.items[0];
  assert.deepEqual((await S.open(item.envelope, b.box)).value, { text: '기밀 내용' });
});
