/**
 * tests/case-server.test.mjs — src/worker/case-server.js: 초대 등록·가입 확인, 봉인 우편함.
 * 실행: node --test tests/case-server.test.mjs  (가짜 KV·가짜 인증, 네트워크 없음)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCaseServer, validateEnvelope, CASE_POLICY } from '../src/worker/case-server.js';

const H = 'a'.repeat(64), H2 = 'b'.repeat(64);
function fakeKv() {
  const m = new Map();
  return { m,
    get: async k => (m.has(k) ? m.get(k) : null),
    put: async (k, v) => { m.set(k, v); },
    delete: async k => { m.delete(k); },
    list: async ({ prefix }) => ({ keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }) };
}
// 인증: body.guid 가 'bad-' 로 시작하면 실패
const resolveGuid = async (env, b) => (b && b.guid && !String(b.guid).startsWith('bad-') ? { ok: true, guid: b.guid } : { ok: false, status: 403, code: 'AUTH_REQUIRED', message: 'x' });
function setup(extra = {}) {
  let t = Date.UTC(2026, 10, 1); const kv = fakeKv(); const notes = [];
  const s = makeCaseServer({ resolveGuid, kv, env: {}, now: () => t, notify: async (g, i) => { notes.push([g, i.kind]); }, ...extra });
  return { s, kv, notes, adv: ms => { t += ms; }, now: () => t };
}
const sha = async str => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)))].map(b => b.toString(16).padStart(2, '0')).join('');
async function invited(ctx, token = 'tok-1') {
  const token_hash = await sha('inv:' + token);
  return { token, token_hash, reg: await ctx.s.inviteRegister({ guid: 'lawyer', token_hash }) };
}
const env = (o = {}) => ({ to: 'client', from: 'lawyer', kind: 'chat', nonce: 'n', ciphertext: 'QUJD', content_hash: H, case_id_hash: H2, created_at: '2026-11-01T00:00:00Z', ...o });

test('초대 등록: 인증 필요, 해시 형식, 중복 거부, 서버에는 메일 주소·평문 토큰 없음', async () => {
  const c = setup();
  assert.equal((await c.s.inviteRegister({ guid: 'bad-x', token_hash: H })).status, 403);
  assert.equal((await c.s.inviteRegister({ guid: 'lawyer', token_hash: 'zz' })).status, 400);
  const r = await c.s.inviteRegister({ guid: 'lawyer', token_hash: H });
  assert.equal(r.status, 200);
  assert.equal(r.json.expires_at, '2026-11-15T00:00:00.000Z');
  assert.equal((await c.s.inviteRegister({ guid: 'lawyer', token_hash: H })).status, 409);
  const stored = [...c.kv.m.values()].join(' ');
  assert.ok(!stored.includes('@'));
});

test('초대 등록: 하루 한도 초과 시 429, 다음 날 풀림', async () => {
  const c = setup();
  for (let i = 0; i < CASE_POLICY.INVITES_PER_DAY; i++) assert.equal((await c.s.inviteRegister({ guid: 'lawyer', token_hash: (await sha('x' + i)) })).status, 200);
  assert.equal((await c.s.inviteRegister({ guid: 'lawyer', token_hash: await sha('over') })).status, 429);
  c.adv(86400e3);
  assert.equal((await c.s.inviteRegister({ guid: 'lawyer', token_hash: await sha('next') })).status, 200);
});

test('가입 확인: 초청자 우편함에 가입 사실·아이디·메일 아이디 전달, 푸시 알림, 상대 정보 반환', async () => {
  const c = setup(); const { token } = await invited(c);
  const r = await c.s.inviteClaim({ guid: 'client', token, mail_id: 'park' });
  assert.equal(r.status, 200);
  assert.equal(r.json.inviter_user_id, 'lawyer');
  assert.deepEqual(c.notes, [['lawyer', 'invite_notice']]);
  const pull = await c.s.mailboxPull({ guid: 'lawyer' });
  assert.equal(pull.json.items.length, 1);
  const n = pull.json.items[0].server_notice;
  assert.equal(n.signed_up, true);
  assert.equal(n.invitee_user_id, 'client');
  assert.equal(n.invitee_mail_id, 'park@naviweb.kr');
});

test('가입 확인 거부: 잘못된 토큰·재사용·만료·자기초대·미인증', async () => {
  const c = setup(); const { token } = await invited(c);
  assert.equal((await c.s.inviteClaim({ guid: 'client', token: 'nope', mail_id: 'p' })).status, 404);
  assert.equal((await c.s.inviteClaim({ guid: 'lawyer', token, mail_id: 'p' })).status, 400);
  assert.equal((await c.s.inviteClaim({ guid: 'bad-z', token, mail_id: 'p' })).status, 403);
  assert.equal((await c.s.inviteClaim({ guid: 'client', token })).status, 400);
  assert.equal((await c.s.inviteClaim({ guid: 'client', token, mail_id: 'p' })).status, 200);
  assert.equal((await c.s.inviteClaim({ guid: 'other', token, mail_id: 'p' })).status, 409);
  const c2 = setup(); const t2 = await invited(c2, 'tok-2'); c2.adv(15 * 86400e3);
  assert.equal((await c2.s.inviteClaim({ guid: 'client', token: t2.token, mail_id: 'p' })).status, 410);
});

test('우편함 push: 관계가 생긴 상대에게만, from 은 본인만, 봉투 검증', async () => {
  const c = setup();
  assert.equal((await c.s.mailboxPush({ guid: 'lawyer', envelope: env() })).status, 403);            // 아직 관계 없음
  const { token } = await invited(c); await c.s.inviteClaim({ guid: 'client', token, mail_id: 'p' });
  const ok = await c.s.mailboxPush({ guid: 'lawyer', envelope: env() });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.expires_in, 30 * 86400);
  assert.equal((await c.s.mailboxPush({ guid: 'client', envelope: env({ from: 'lawyer', to: 'client' }) })).json.code, 'FROM_MISMATCH');
  assert.equal((await c.s.mailboxPush({ guid: 'client', envelope: env({ from: 'client', to: 'lawyer' }) })).status, 200);   // 양방향
  assert.equal((await c.s.mailboxPush({ guid: 'lawyer', envelope: env({ text: '평문' }) })).json.code, 'BAD_ENVELOPE');
  assert.equal((await c.s.mailboxPush({ guid: 'lawyer', envelope: env({ to: 'stranger' }) })).json.code, 'NO_RELATION');
  assert.equal((await c.s.mailboxPush({ guid: 'lawyer', envelope: env({ to: 'lawyer' }) })).json.code, 'SELF_SEND');
  assert.equal(c.notes.filter(n => n[0] === 'client').length, 1);
});

test('우편함 pull/ack: 내 것만 보이고, ack 하면 삭제, 남의 항목은 못 지움', async () => {
  const c = setup(); const { token } = await invited(c); await c.s.inviteClaim({ guid: 'client', token, mail_id: 'p' });
  const id = (await c.s.mailboxPush({ guid: 'lawyer', envelope: env() })).json.id;
  assert.equal((await c.s.mailboxPull({ guid: 'lawyer' })).json.items.some(i => i.envelope), false);   // 내 우편함엔 알림만
  const mine = await c.s.mailboxPull({ guid: 'client' });
  assert.equal(mine.json.items.length, 1);
  assert.equal(mine.json.items[0].envelope.from, 'lawyer');
  assert.equal((await c.s.mailboxAck({ guid: 'lawyer', ids: [id] })).json.deleted, 0);            // 남의 것
  assert.equal((await c.s.mailboxPull({ guid: 'client' })).json.items.length, 1);
  assert.equal((await c.s.mailboxAck({ guid: 'client', ids: [id, 'bad', '../x'] })).json.deleted, 1);
  assert.equal((await c.s.mailboxPull({ guid: 'client' })).json.items.length, 0);
  assert.equal((await c.s.mailboxPull({ guid: 'bad-q' })).status, 403);
  assert.equal((await c.s.mailboxAck({ guid: 'client', ids: [] })).status, 400);
});

test('우편함: 수신자별 적체 상한', async () => {
  const c = setup(); const { token } = await invited(c); await c.s.inviteClaim({ guid: 'client', token, mail_id: 'p' });
  for (let i = 0; i < CASE_POLICY.MAX_PENDING_PER_RECIPIENT; i++) c.kv.m.set(`casemb:client:${String(i).padStart(15, '0')}-deadbeef`, '{}');
  assert.equal((await c.s.mailboxPush({ guid: 'lawyer', envelope: env() })).json.code, 'MAILBOX_FULL');
});

test('알림이 실패해도 전달은 성공', async () => {
  const c = setup({ notify: async () => { throw new Error('push down'); } });
  const { token } = await invited(c);
  assert.equal((await c.s.inviteClaim({ guid: 'client', token, mail_id: 'p' })).status, 200);
  assert.equal((await c.s.mailboxPull({ guid: 'lawyer' })).json.items.length, 1);
});

test('validateEnvelope: 클라이언트(case-mailbox.js)와 같은 규칙', async t => {
  // case-mailbox.js 는 PR #869(case-core) 와 함께 들어온다 — 아직 없으면 건너뛴다.
  try { await import('../case-mailbox.js'); } catch (_) { return t.skip('case-mailbox.js 없음(PR #869 머지 후 활성화)'); }
  const M = globalThis.CaseMailbox;
  const cases = [env(), env({ text: 'x' }), env({ kind: 'z' }), env({ content_hash: 'q' }), env({ ciphertext: 'A'.repeat(90000) }), env({ ciphertext: '평문!' }), env({ nonce: '' })];
  for (const e of cases) assert.equal(validateEnvelope(e).length === 0, M.validateEnvelope(e).ok, JSON.stringify(e).slice(0, 60));
});
