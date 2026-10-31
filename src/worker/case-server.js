// ═════════════════════════════════════════════════
// src/worker/case-server.js — Case(일) 서버 측: 초대 등록·가입 확인, 봉인 우편함(push/pull/ack)
// 2026-11-01. 설계: hondi-case-process v0.2/구현 계획 v1.2 (M2·M3).
// 원칙: 서버는 사용자 본문을 갖지 않는다. 저장하는 것은
//   · 초대: token 해시 → 초청자 guid, 만료, 상태 (초대받는 사람의 메일 주소·Case 내용 없음)
//   · 우편함: 종단 암호화된 봉투(서버는 못 읽음). 수신 확인(ack) 즉시 삭제, 최대 30일.
//   · 관계: 초대 가입이 확인된 두 guid 쌍 — 이 쌍 사이에서만 우편함 전달 허용(스팸 방지).
// 저장소(KV)·인증(resolveGuid)·알림(notify)은 주입 → worker.js 와 분리해 단독 테스트.
// 클라이언트 쪽 계약: case-invite.js(초대), case-mailbox.js(봉투 검증) — 규칙을 같게 유지한다.
// ═════════════════════════════════════════════════

export const CASE_POLICY = {
  INVITE_TTL_DAYS: 14,
  INVITES_PER_DAY: 20,
  MAILBOX_TTL_DAYS: 30,
  MAX_ENVELOPE_BYTES: 64 * 1024,
  MAX_PENDING_PER_RECIPIENT: 500,
  PULL_LIMIT: 100,
};
const KINDS = ['invite_notice', 'agreement', 'history_entry', 'chat', 'request', 'file_ref', 'close'];
const HEX64 = /^[0-9a-f]{64}$/;
const ENV_KEYS = ['to', 'from', 'kind', 'nonce', 'ciphertext', 'content_hash', 'case_id_hash', 'created_at'];
const DAY = 86400;

export function validateEnvelope(e) {
  const errs = [];
  e = e || {};
  if (!e.to) errs.push('to 필수');
  if (!e.from) errs.push('from 필수');
  if (!KINDS.includes(e.kind)) errs.push('kind 오류');
  if (!e.nonce) errs.push('nonce 필수');
  if (!HEX64.test(e.content_hash || '')) errs.push('content_hash(sha256 hex) 필수');
  if (!HEX64.test(e.case_id_hash || '')) errs.push('case_id_hash(sha256 hex) 필수');
  if (typeof e.ciphertext !== 'string' || !e.ciphertext) errs.push('ciphertext 필수');
  else if (!/^[A-Za-z0-9+/_-]+=*$/.test(e.ciphertext)) errs.push('ciphertext 는 base64');
  else if (e.ciphertext.length * 0.75 > CASE_POLICY.MAX_ENVELOPE_BYTES) errs.push('봉투 크기 초과');
  Object.keys(e).forEach(k => { if (!ENV_KEYS.includes(k)) errs.push('허용되지 않은 필드: ' + k); });
  return errs;
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const pairKey = (a, b) => 'caserel:' + [a, b].sort().join('|');
const out = (status, json) => ({ status, json });
const bad = (status, code, message) => out(status, { ok: false, code, message });

// deps: { resolveGuid(env, body, {sigMsg}), kv, now():ms, notify(guid, info):Promise, env }
export function makeCaseServer(deps) {
  const { resolveGuid, kv, env } = deps;
  const now = deps.now || (() => Date.now());
  const notify = deps.notify || (async () => {});
  const getJson = async k => { const r = await kv.get(k); try { return r ? JSON.parse(r) : null; } catch (_) { return null; } };
  const putJson = (k, v, ttl) => kv.put(k, JSON.stringify(v), ttl ? { expirationTtl: Math.max(60, Math.ceil(ttl)) } : undefined);

  async function auth(body, route) {
    const b = body || {};
    const a = await resolveGuid(env, b, { sigMsg: `${route}:${b.guid}:${b.ts}` });
    return a.ok ? a : { ok: false, res: bad(a.status || 403, a.code || 'AUTH_REQUIRED', a.message || '인증 필요') };
  }

  // 초청자가 초대를 등록한다. { token_hash, expires_at? }. 토큰 평문은 메일에만 있다.
  async function inviteRegister(body) {
    const a = await auth(body, 'case-invite-register'); if (!a.ok) return a.res;
    if (!HEX64.test(body.token_hash || '')) return bad(400, 'BAD_TOKEN_HASH', 'token_hash(sha256 hex) 필수');
    if (await getJson('caseinv:' + body.token_hash)) return bad(409, 'ALREADY_REGISTERED', '이미 등록된 초대');
    // 하루 한도(스팸 방지)
    const day = new Date(now()).toISOString().slice(0, 10), rk = `caseinvrate:${a.guid}:${day}`;
    const used = parseInt((await kv.get(rk)) || '0', 10) || 0;
    if (used >= CASE_POLICY.INVITES_PER_DAY) return bad(429, 'INVITE_RATE_LIMIT', `하루 초대는 ${CASE_POLICY.INVITES_PER_DAY}건까지입니다`);
    const expires_at = now() + CASE_POLICY.INVITE_TTL_DAYS * DAY * 1000;
    await putJson('caseinv:' + body.token_hash, { inviter: a.guid, expires_at, state: 'issued' }, CASE_POLICY.INVITE_TTL_DAYS * DAY + DAY);
    await kv.put(rk, String(used + 1), { expirationTtl: 2 * DAY });
    return out(200, { ok: true, expires_at: new Date(expires_at).toISOString() });
  }

  // 초대받은 사람이 가입한 직후 호출. { token, mail_id }. 로그인한 본인 guid 로 확인한다.
  async function inviteClaim(body) {
    const a = await auth(body, 'case-invite-claim'); if (!a.ok) return a.res;
    if (!body.token || !body.mail_id) return bad(400, 'MISSING_FIELD', 'token, mail_id 필수');
    const key = 'caseinv:' + await sha256Hex('inv:' + body.token);
    const inv = await getJson(key);
    if (!inv) return bad(404, 'INVITE_NOT_FOUND', '초대를 찾을 수 없습니다(만료되었거나 잘못된 링크)');
    if (inv.state !== 'issued') return bad(409, 'INVITE_USED', '이미 사용된 초대입니다');
    if (now() >= inv.expires_at) return bad(410, 'INVITE_EXPIRED', '만료된 초대입니다');
    if (inv.inviter === a.guid) return bad(400, 'SELF_INVITE', '자기 자신은 초대할 수 없습니다');
    inv.state = 'signed_up'; inv.invitee = a.guid;
    await putJson(key, inv, CASE_POLICY.INVITE_TTL_DAYS * DAY);
    await putJson(pairKey(inv.inviter, a.guid), { at: now() });       // 이 쌍 사이에서만 우편함 허용(만료 없음)
    // 가입 사실·아이디·메일 아이디를 초청자에게 전달(서버가 아는 계정 메타정보이며 Case 내용은 아님)
    const notice = { type: 'invite_signed_up', signed_up: true, invitee_user_id: a.guid,
      invitee_mail_id: `${String(body.mail_id).replace(/@.*$/, '')}@naviweb.kr`, signed_up_at: new Date(now()).toISOString() };
    await deliver(inv.inviter, { id: undefined, server_notice: notice, from: 'server', kind: 'invite_notice' });
    return out(200, { ok: true, inviter_user_id: inv.inviter, room_peer: inv.inviter });
  }

  async function deliver(to, item) {
    const id = `${String(now()).padStart(15, '0')}-${(await sha256Hex(JSON.stringify(item) + Math.random())).slice(0, 8)}`;
    await putJson(`casemb:${to}:${id}`, Object.assign({}, item, { id, stored_at: now() }), CASE_POLICY.MAILBOX_TTL_DAYS * DAY);
    try { await notify(to, { kind: item.kind }); } catch (_) { /* 알림 실패는 전달 성공에 영향 없음 */ }
    return id;
  }
  async function listBox(guid) {
    const l = await kv.list({ prefix: `casemb:${guid}:` });
    return (l.keys || []).map(k => k.name).sort();
  }

  // 우편함 넣기: 보낸 사람 = 로그인한 본인, 이미 관계(초대 가입 확인)가 있는 상대에게만.
  async function mailboxPush(body) {
    const a = await auth(body, 'case-mb-push'); if (!a.ok) return a.res;
    const e = body.envelope;
    const errs = validateEnvelope(e);
    if (errs.length) return bad(400, 'BAD_ENVELOPE', errs.join(' · '));
    if (e.from !== a.guid) return bad(403, 'FROM_MISMATCH', 'from 은 로그인한 본인이어야 합니다');
    if (e.to === a.guid) return bad(400, 'SELF_SEND', '본인에게 보낼 수 없습니다');
    if (!(await getJson(pairKey(a.guid, e.to)))) return bad(403, 'NO_RELATION', '초대·가입으로 연결된 상대에게만 보낼 수 있습니다');
    if ((await listBox(e.to)).length >= CASE_POLICY.MAX_PENDING_PER_RECIPIENT) return bad(429, 'MAILBOX_FULL', '상대의 우편함이 가득 찼습니다');
    const id = await deliver(e.to, { envelope: e });
    return out(200, { ok: true, id, expires_in: CASE_POLICY.MAILBOX_TTL_DAYS * DAY });
  }

  // 내 우편함 읽기(삭제하지 않음 — 받은 뒤 ack 로 지운다).
  async function mailboxPull(body) {
    const a = await auth(body, 'case-mb-pull'); if (!a.ok) return a.res;
    const names = (await listBox(a.guid)).slice(0, CASE_POLICY.PULL_LIMIT);
    const items = [];
    for (const n of names) { const v = await getJson(n); if (v) items.push(v); }
    return out(200, { ok: true, items, more: names.length >= CASE_POLICY.PULL_LIMIT });
  }

  // 받았음을 알리면 즉시 삭제. 남의 항목은 지울 수 없다(키에 수신자 guid 포함).
  async function mailboxAck(body) {
    const a = await auth(body, 'case-mb-ack'); if (!a.ok) return a.res;
    if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 200) return bad(400, 'BAD_IDS', 'ids 배열(1~200) 필수');
    let deleted = 0;
    for (const id of body.ids) {
      if (typeof id !== 'string' || !/^[0-9]{15}-[0-9a-f]{8}$/.test(id)) continue;
      const k = `casemb:${a.guid}:${id}`;
      if (await kv.get(k)) { await kv.delete(k); deleted++; }
    }
    return out(200, { ok: true, deleted });
  }

  return { inviteRegister, inviteClaim, mailboxPush, mailboxPull, mailboxAck };
}
