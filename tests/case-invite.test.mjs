/**
 * tests/case-invite.test.mjs — case-invite.js(M2) · case-mailbox.js(M3 계약) 단위 테스트.
 * 실행: node --test tests/case-invite.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
await import('../case-invite.js');
await import('../case-mailbox.js');
const I = globalThis.CaseInvite, M = globalThis.CaseMailbox;
const NOW = '2026-11-01T00:00:00.000Z';
const base = { case_id: 'c1', inviter_id: 'u-lawyer', inviter_side: 'provider', invitee_email: 'client@example.com' };

test('초대 생성: 링크는 naviweb.kr 가입 화면, 상대 역할은 반대편, 만료 14일', async () => {
  const r = await I.createInvitation(base, NOW);
  assert.equal(r.ok, true);
  assert.ok(r.link.startsWith('https://naviweb.kr/signup?inv='));
  assert.equal(r.invitation.invitee_side, 'consumer');
  assert.equal(r.invitation.expires_at, '2026-11-15T00:00:00.000Z');
  const c = await I.createInvitation({ ...base, inviter_side: 'consumer' }, NOW);
  assert.equal(c.invitation.invitee_side, 'provider');
});

test('초대 생성: 서버 기록에는 메일 주소·case_id·토큰 평문이 없다', async () => {
  const r = await I.createInvitation(base, NOW);
  const s = JSON.stringify(r.server_record);
  assert.ok(!s.includes('client@example.com'));
  assert.ok(!s.includes('c1"'));
  assert.ok(!s.includes(r.token));
  assert.deepEqual(Object.keys(r.server_record).sort(), ['expires_at', 'inviter_id', 'state', 'token_hash']);
});

test('초대 생성: 입력 오류 거부, 토큰은 매번 다름', async () => {
  assert.equal((await I.createInvitation({ ...base, invitee_email: 'x' }, NOW)).ok, false);
  assert.equal((await I.createInvitation({ ...base, inviter_side: 'self' }, NOW)).ok, false);
  assert.equal((await I.createInvitation({}, NOW)).ok, false);
  const a = await I.createInvitation(base, NOW), b = await I.createInvitation(base, NOW);
  assert.notEqual(a.token, b.token);
});

test('가입: 가입 사실·아이디·메일 아이디가 초청자에게 전달되고 채팅방이 열린다', async () => {
  const r = await I.createInvitation(base, NOW);
  const s = await I.onSignup(r.invitation, { token: r.token, user_id: 'u-client', mail_id: 'park', email: 'Client@Example.com' }, '2026-11-02T00:00:00.000Z');
  assert.equal(s.ok, true);
  assert.equal(s.state, 'signed_up');
  assert.equal(s.notice.signed_up, true);
  assert.equal(s.notice.invitee_user_id, 'u-client');
  assert.equal(s.notice.invitee_mail_id, 'park@naviweb.kr');
  assert.equal(s.notice.email_match, true);
  assert.deepEqual(s.room.members, ['u-client', 'u-lawyer']);
  assert.equal(s.room.room_id.length, 32);
});

test('가입: 다른 메일로 가입하면 email_match=false 로 알림(차단은 아님)', async () => {
  const r = await I.createInvitation(base, NOW);
  const s = await I.onSignup(r.invitation, { token: r.token, user_id: 'u2', mail_id: 'kim', email: 'other@example.com' }, NOW);
  assert.equal(s.ok, true);
  assert.equal(s.notice.email_match, false);
});

test('가입 거부: 틀린 토큰·만료·재사용·취소·자기초대', async () => {
  const r = await I.createInvitation(base, NOW);
  const ok = { token: r.token, user_id: 'u2', mail_id: 'kim' };
  assert.equal((await I.onSignup(r.invitation, { ...ok, token: 'bad' }, NOW)).ok, false);
  assert.equal((await I.onSignup(r.invitation, ok, '2026-11-20T00:00:00.000Z')).ok, false);
  assert.equal((await I.onSignup({ ...r.invitation, state: 'signed_up' }, ok, NOW)).ok, false);
  assert.equal((await I.onSignup({ ...r.invitation, state: 'revoked' }, ok, NOW)).ok, false);
  assert.equal((await I.onSignup(r.invitation, { ...ok, user_id: 'u-lawyer' }, NOW)).ok, false);
  assert.equal((await I.onSignup(r.invitation, { token: r.token }, NOW)).ok, false);
});

test('초대 상태 전이: issued→signed_up→connected, 종료 상태는 되돌릴 수 없음', () => {
  assert.equal(I.transitionInvite('issued', 'signup').to, 'signed_up');
  assert.equal(I.transitionInvite('signed_up', 'connect').to, 'connected');
  assert.equal(I.transitionInvite('issued', 'revoke').to, 'revoked');
  assert.equal(I.transitionInvite('expired', 'signup').ok, false);
  assert.equal(I.transitionInvite('connected', 'revoke').ok, false);
});

test('채팅방: 같은 둘·같은 일이면 순서와 무관하게 같은 방, 일이 다르면 다른 방', async () => {
  const a = await I.chatRoomFor('c1', 'x', 'y'), b = await I.chatRoomFor('c1', 'y', 'x'), c = await I.chatRoomFor('c2', 'x', 'y');
  assert.equal(a.room_id, b.room_id);
  assert.notEqual(a.room_id, c.room_id);
});

test('채팅 한 줄은 소통 이력(자동 수집) 입력으로 변환되어 6하 검증을 통과', async () => {
  await import('../case-core.js');
  const room = await I.chatRoomFor('c1', 'x', 'y');
  const input = I.chatToCommunication({ side: 'provider', from: '김변호사', to: '박의뢰인', at: '2026-11-01T00:00:00Z', text: '서류 보내주세요' }, room);
  const r = globalThis.CaseCore.buildCommunication(input, '2026-11-01T00:01:00.000Z');
  assert.equal(r.ok, true);
  assert.equal(r.value.confirm_status, 'auto');
  assert.equal(r.value.channel, 'chat');
});

const env = (o = {}) => ({ to: 'u2', from: 'u1', kind: 'chat', nonce: 'n1', ciphertext: 'QUJD', content_hash: 'a'.repeat(64), case_id_hash: 'b'.repeat(64), created_at: NOW, ...o });

test('우편함 봉투: 정상은 30일 만료, 평문 필드·크기 초과·형식 오류 거부', () => {
  const v = M.validateEnvelope(env());
  assert.equal(v.ok, true);
  assert.equal(v.expires_at, '2026-12-01T00:00:00.000Z');
  assert.equal(M.validateEnvelope(env({ text: '평문' })).ok, false);
  assert.equal(M.validateEnvelope(env({ kind: 'x' })).ok, false);
  assert.equal(M.validateEnvelope(env({ content_hash: 'zz' })).ok, false);
  assert.equal(M.validateEnvelope(env({ ciphertext: 'A'.repeat(90000) })).ok, false);
  assert.equal(M.validateEnvelope(env({ ciphertext: '평문!' })).ok, false);
  assert.equal(M.isExpired('2026-12-01T00:00:00.000Z', '2026-12-02T00:00:00.000Z'), true);
  assert.equal(M.isExpired('2026-12-01T00:00:00.000Z', NOW), false);
});

test('signup_base 로 링크 주소를 바꿀 수 있다(? 가 있으면 & 로 이음), https 가 아니면 거부', async () => {
  const base = { case_id: 'c', inviter_id: 'u1', inviter_side: 'provider', invitee_email: 'a@b.co' };
  const r1 = await globalThis.CaseInvite.createInvitation(Object.assign({ signup_base: 'https://mail.hondi.net/desktop.html?case=1' }, base));
  assert.ok(r1.ok && r1.link.startsWith('https://mail.hondi.net/desktop.html?case=1&inv='));
  const r2 = await globalThis.CaseInvite.createInvitation(Object.assign({ signup_base: 'https://naviweb.kr/signup' }, base));
  assert.ok(r2.link.startsWith('https://naviweb.kr/signup?inv='));
  const r3 = await globalThis.CaseInvite.createInvitation(Object.assign({ signup_base: 'javascript:alert(1)' }, base));
  assert.equal(r3.ok, false);
});
