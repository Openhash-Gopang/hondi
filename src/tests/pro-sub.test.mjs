import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { coveredUntil, trialUntil, accessState, refundQuote, DAY_MS, SUB_YEAR_MS } from '../worker/pro-sub-core.js';
import { makeProSubHandler, grantMessage, quoteMessage, refundMessage, listMessage } from '../worker/pro-sub-handler.js';
import { makeProVerifyHandler, sessionMessage } from '../worker/pro-verify-handler.js';
import { checkProGate } from '../worker/pro-gate.js';
import { issueSession } from '../worker/pro-session.js';
import { ASSISTANT_SP_CODES } from '../worker/assistant-sp-codes.js';

const NOW = 1_800_000_000_000;
const b64u = buf => Buffer.from(buf).toString('base64url');
async function wallet() {
  const kp = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  return { pub: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)), sign: async m => b64u(await crypto.subtle.sign('Ed25519', kp.privateKey, new TextEncoder().encode(m))) };
}
const row = (s, e, o = {}) => ({ status: 'active', start_ts: s, expires_ts: e, amount: 99000, ts: s, ...o });

describe('구독 계산', () => {
  it('연장은 이어 붙고, 끊긴 구간은 덮지 않는다', () => {
    const a = row(NOW - 10 * DAY_MS, NOW + 5 * DAY_MS), b = row(NOW + 5 * DAY_MS, NOW + 370 * DAY_MS);
    assert.equal(coveredUntil([a, b], NOW), NOW + 370 * DAY_MS);
    assert.equal(coveredUntil([a, row(NOW + 9 * DAY_MS, NOW + 400 * DAY_MS)], NOW), NOW + 5 * DAY_MS);
    assert.equal(coveredUntil([row(NOW - 30 * DAY_MS, NOW - DAY_MS)], NOW), 0);
  });
  it('환불된 구독은 덮지 않는다', () => {
    assert.equal(coveredUntil([row(NOW - DAY_MS, NOW + 100 * DAY_MS, { status: 'refunded' })], NOW), 0);
  });
  it('체험: 처음 승인받은 시각 + 일수 — 철회 후 재승인으로 늘어나지 않는다', () => {
    const v1 = { status: 'revoked', expires_ts: NOW + 1, reviewed_ts: NOW - 20 * DAY_MS }, v2 = { status: 'approved', expires_ts: NOW + 1, reviewed_ts: NOW - DAY_MS };
    assert.equal(trialUntil([v1, v2], 7), NOW - 20 * DAY_MS + 7 * DAY_MS);
    assert.equal(trialUntil([{ status: 'rejected', reviewed_ts: NOW }], 7), 0);
    assert.equal(trialUntil([], 7), 0);
  });
  it('접근 상태와 안내 단계', () => {
    const ver = [{ status: 'approved', expires_ts: NOW + SUB_YEAR_MS, reviewed_ts: NOW - 2 * DAY_MS }];
    let s = accessState([], ver, NOW, 7);
    assert.ok(s.in_trial && s.notice === 'trial' && s.days_left === 5 && s.until > NOW);
    s = accessState([], [{ ...ver[0], reviewed_ts: NOW - 6 * DAY_MS }], NOW, 7);
    assert.equal(s.notice, 'trial_ending');
    s = accessState([], [{ ...ver[0], reviewed_ts: NOW - 30 * DAY_MS }], NOW, 7);
    assert.equal(s.until, 0); assert.equal(s.notice, 'expired');
    const old = [{ ...ver[0], reviewed_ts: NOW - 30 * DAY_MS }];
    assert.equal(accessState([row(NOW - 300 * DAY_MS, NOW + 29 * DAY_MS)], old, NOW, 7).notice, 'expiring_30');
    assert.equal(accessState([row(NOW - 300 * DAY_MS, NOW + 6 * DAY_MS)], old, NOW, 7).notice, 'expiring_7');
    assert.equal(accessState([row(NOW - 10 * DAY_MS, NOW + 200 * DAY_MS)], old, NOW, 7).notice, null);
  });
  it('환불 제안: 7일 이내 전액, 이후 잔여 비례', () => {
    const r = row(NOW - 2 * DAY_MS, NOW - 2 * DAY_MS + SUB_YEAR_MS);
    assert.deepEqual([refundQuote(r, NOW).suggested_amount, refundQuote(r, NOW).within_7d], [99000, true]);
    const r2 = row(NOW - 182.5 * DAY_MS, NOW + 182.5 * DAY_MS);
    const q = refundQuote(r2, NOW);
    assert.equal(q.within_7d, false); assert.ok(Math.abs(q.suggested_amount - 49500) <= 1);
  });
});

function memSub() {
  const rows = []; let n = 0;
  return { rows,
    async create(r) { const x = { id: String(++n).padStart(15, 's'), ...r }; rows.push(x); return x; },
    async get(id) { return rows.find(r => r.id === id) || null; },
    async listByPubkey(p) { return rows.filter(r => r.subscriber_pubkey === p); },
    async findByPayRef(ref) { return rows.find(r => r.pay_ref === ref) || null; },
    async update(id, p) { Object.assign(rows.find(r => r.id === id), p); },
    async listExpiring(a, b) { return rows.filter(r => r.status === 'active' && r.expires_ts >= a && r.expires_ts < b); },
    async listRecent() { return [...rows].reverse(); },
    async countActive(t) { return rows.filter(r => r.status === 'active' && r.start_ts <= t && r.expires_ts > t).length; },
  };
}
function memVer(rows = []) { return { rows, async listByPubkey(p) { return rows.filter(r => r.applicant_pubkey === p); } }; }

async function setup() {
  const ws = { u1: await wallet(), u2: await wallet(), admin: await wallet() };
  const store = memSub(), verStore = memVer(); let t = NOW;
  const getPinnedPubKey = async (e, g) => ws[g]?.pub || null;
  const h = makeProSubHandler({ store, verStore, getPinnedPubKey, now: () => t });
  const env = { PRO_VERIFY_ADMINS: 'admin' };
  const post = async (path, body) => { const res = await h.handle(new Request('https://x' + path, { method: 'POST', body: JSON.stringify(body) }), new URL('https://x' + path), env); return { status: res.status, j: await res.json() }; };
  const admin = async (path, make, extra = {}, who = 'admin') => { const b = { guid: who, ts: t, ...extra }; b.sig = await ws[who].sign(make(b)); return post(path, b); };
  const grant = (target = 'u1', over = {}) => admin('/pro-sub/grant', b => grantMessage(b.target_guid, b.kind, b.pay_ref, b.ts), { target_guid: target, kind: 'professional', pay_ref: 'hong-1021', ...over });
  const status = async g => { const u = new URL('https://x/pro-sub/status?guid=' + g); const res = await h.handle(new Request(u), u, env); return { status: res.status, j: await res.json() }; };
  return { ws, store, verStore, h, env, grant, status, admin, post, tick: ms => { t += ms; }, getPinnedPubKey, now: () => t };
}

describe('구독 API', () => {
  it('부여 → 상태에 반영, 기본 금액 99,000원·1년', async () => {
    const { grant, status, ws } = await setup();
    const r = await grant();
    assert.equal(r.status, 200); assert.equal(r.j.subscription.amount, 99000); assert.equal(r.j.subscription.expires_ts - r.j.subscription.start_ts, SUB_YEAR_MS);
    const s = await status('u1');
    assert.equal(s.j.sub_until, NOW + SUB_YEAR_MS); assert.equal(s.j.items.length, 1);
    assert.ok(!('pay_ref' in s.j.items[0]), '본인 상태에 입금 참조는 노출하지 않는다');
  });
  it('운영자가 아니면 거부, 서명이 틀리면 거부', async () => {
    const { admin, ws } = await setup();
    const r = await admin('/pro-sub/grant', b => grantMessage(b.target_guid, b.kind, b.pay_ref, b.ts), { target_guid: 'u1', kind: 'professional', pay_ref: 'x-1' }, 'u2');
    assert.equal(r.status, 403);
    const b = { guid: 'admin', ts: NOW, target_guid: 'u1', kind: 'professional', pay_ref: 'x-2', sig: await ws.admin.sign('엉뚱한 메시지') };
    // 서명 검증 실패
    const { post } = await setup();
    assert.equal((await post('/pro-sub/grant', { ...b, sig: 'AAAA' })).status, 401);
  });
  it('같은 입금 참조 중복 부여 거부', async () => {
    const { grant, store } = await setup();
    assert.equal((await grant()).status, 200);
    assert.equal((await grant('u2')).status, 409);
    assert.equal(store.rows.length, 1);
  });
  it('갱신은 만료 직후부터 이어 붙는다', async () => {
    const { grant, status, tick } = await setup();
    await grant();
    tick(300 * DAY_MS);
    await grant('u1', { pay_ref: 'hong-renew' });
    const s = await status('u1');
    assert.equal(s.j.sub_until, NOW + 2 * SUB_YEAR_MS);
  });
  it('입력 검증: kind·months·amount·pay_ref·없는 계정', async () => {
    const { grant } = await setup();
    assert.equal((await grant('u1', { kind: 'boss' })).status, 400);
    assert.equal((await grant('u1', { pay_ref: 'a' })).status, 400);
    assert.equal((await grant('u1', { months: 0 })).status, 400);
    assert.equal((await grant('u1', { months: 36 })).status, 400);
    assert.equal((await grant('u1', { amount: -1 })).status, 400);
    assert.equal((await grant('nobody')).status, 404);
  });
  it('환불: 제안액 조회 → 처리 → 접근 종료. 한도 초과·사유 없음 거부', async () => {
    const { grant, admin, status, store } = await setup();
    const id = (await grant()).j.subscription.id;
    const q = await admin('/pro-sub/quote', b => quoteMessage(b.id, b.ts), { id });
    assert.equal(q.j.quote.suggested_amount, 99000);
    assert.equal((await admin('/pro-sub/refund', b => refundMessage(b.id, b.ts), { id, amount: 100000, note: '사유' })).status, 400);
    assert.equal((await admin('/pro-sub/refund', b => refundMessage(b.id, b.ts), { id, amount: 99000, note: '' })).status, 400);
    const r = await admin('/pro-sub/refund', b => refundMessage(b.id, b.ts), { id, amount: 99000, note: '개시 전 철회' });
    assert.equal(r.status, 200); assert.equal(r.j.covered_until, 0);
    assert.equal((await status('u1')).j.sub_until, 0);
    assert.equal(store.rows[0].status, 'refunded');
    assert.equal((await admin('/pro-sub/refund', b => refundMessage(b.id, b.ts), { id, amount: 1, note: '또' })).status, 409);
  });
  it('관리자 목록: 만료 임박·유효 수', async () => {
    const { grant, admin, tick } = await setup();
    await grant(); await grant('u2', { pay_ref: 'kim-1' });
    tick(340 * DAY_MS);
    const r = await admin('/pro-sub/list', b => listMessage(b.ts), { within_days: 30 });
    assert.equal(r.j.active_count, 2); assert.equal(r.j.expiring.length, 2); assert.ok(r.j.expiring[0].days_left <= 30);
  });
});

describe('세션·게이트 연동', () => {
  const SECRET = 'test-secret-0123456789abcdef';
  it('세션 발급 시 체험·구독 만료 시각이 토큰에 실린다', async () => {
    const w = await wallet();
    const ver = [{ applicant_pubkey: w.pub, persona: 'lawyer', role: 'professional', status: 'approved', expires_ts: NOW + SUB_YEAR_MS, reviewed_ts: NOW - DAY_MS, ts: NOW - DAY_MS }];
    const verStore = { ...memVer(ver), async listByPubkey(p) { return ver.filter(r => r.applicant_pubkey === p); } };
    const sub = memSub();
    const h = makeProVerifyHandler({ store: verStore, subStore: sub, getPinnedPubKey: async () => w.pub, now: () => NOW });
    const call = async () => { const b = { guid: 'g', ts: NOW }; b.sig = await w.sign(sessionMessage(NOW)); return (await h.handle(new Request('https://x/pro-verify/session', { method: 'POST', body: JSON.stringify(b) }), new URL('https://x/pro-verify/session'), { PRO_SESSION_SECRET: SECRET })).json(); };
    let j = await call();
    assert.equal(j.sub_until, NOW - DAY_MS + 7 * DAY_MS); assert.equal(j.subscription.in_trial, true);
    await sub.create(row(NOW, NOW + SUB_YEAR_MS, { subscriber_pubkey: w.pub }));
    j = await call();
    assert.equal(j.sub_until, NOW + SUB_YEAR_MS);
  });
  const sp = () => { const code = Object.keys(ASSISTANT_SP_CODES).find(c => ASSISTANT_SP_CODES[c] === 'patent-attorney'); return `# ${code} · 변리사 보조 AI v1\n본문`; };
  const body = tok => JSON.stringify({ messages: [{ role: 'system', content: sp() }, { role: 'user', content: 'hi' }], pro_session: tok });
  it('PRO_SUB_MODE: off 는 통과, log 는 기록만, enforce(게이트도 enforce)는 402', async () => {
    const tok = (await issueSession(SECRET, { pk: 'k', personas: ['patent-attorney'], sub: 0 }, NOW)).token;
    const base = { PRO_SESSION_SECRET: SECRET, PRO_GATE_MODE: 'enforce' };
    assert.equal((await checkProGate({ bodyText: body(tok), env: base, now: NOW + 1000 })).ok, true);
    const lg = await checkProGate({ bodyText: body(tok), env: { ...base, PRO_SUB_MODE: 'log' }, now: NOW + 1000 });
    assert.ok(lg.ok && lg.wouldBlock === 'PRO_SUBSCRIPTION_REQUIRED');
    const en = await checkProGate({ bodyText: body(tok), env: { ...base, PRO_SUB_MODE: 'enforce' }, now: NOW + 1000 });
    assert.ok(!en.ok && en.status === 402 && en.code === 'PRO_SUBSCRIPTION_REQUIRED');
    const gateLog = await checkProGate({ bodyText: body(tok), env: { ...base, PRO_GATE_MODE: 'log', PRO_SUB_MODE: 'enforce' }, now: NOW + 1000 });
    assert.ok(gateLog.ok, '게이트가 log 면 구독도 차단하지 않는다');
  });
  it('구독·체험이 유효한 세션은 enforce 에서도 통과', async () => {
    const tok = (await issueSession(SECRET, { pk: 'k', personas: ['patent-attorney'], sub: NOW + SUB_YEAR_MS }, NOW)).token;
    const r = await checkProGate({ bodyText: body(tok), env: { PRO_SESSION_SECRET: SECRET, PRO_GATE_MODE: 'enforce', PRO_SUB_MODE: 'enforce' }, now: NOW + 1000 });
    assert.ok(r.ok && !r.wouldBlock);
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
describe('연결(정적 검사)', () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
  const rd = p => readFileSync(join(ROOT, p), 'utf8');
  it('worker.js: 라우트·핸들러·세션 구독 반영', () => {
    const w = rd('worker.js');
    assert.ok(w.includes("pathname.startsWith('/pro-sub/')) return handleProSubRoutes"));
    assert.ok(w.includes('makeProSubHandler({') && w.includes('subStore: makePocketBaseProSubStore'));
  });
  it('클라이언트: 402 구독 차단 인식·사유별 안내, 관리자 패널', () => {
    assert.ok(rd('assets/pro-verify.js').includes('PRO_SUBSCRIPTION_REQUIRED') && rd('assets/pro-verify.js').includes('blockMessage'));
    assert.ok(rd('assets/chat-widget.js').includes('HondiPro.blockMessage') && rd('pages/expert-chat.html').includes('HondiPro.blockMessage'));
    const a = rd('admin.html');
    for (const f of ['_loadProSubList', '_psGrant', '_psRefund', '/pro-sub/grant', '/pro-sub/refund', '/pro-sub/quote']) assert.ok(a.includes(f), f);
  });
  it('마이그레이션: 입금 참조 유니크 인덱스, 규칙 전부 null', () => {
    const m = rd('pb_migrations/1795000002_created_pro_subscriptions.js');
    assert.ok(m.includes('CREATE UNIQUE INDEX') && m.includes('"listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null'));
  });
});
