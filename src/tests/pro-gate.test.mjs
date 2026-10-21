import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectAssistantSp, checkProGate, CLASS_MARKS } from '../worker/pro-gate.js';
import { issueSession, verifySession, SESSION_TTL_MS } from '../worker/pro-session.js';
import { makeProVerifyHandler, sessionMessage } from '../worker/pro-verify-handler.js';
import { buildCodeMap, render } from '../../scripts/gen-assistant-sp-codes.mjs';
import { ASSISTANT_SP_CODES } from '../worker/assistant-sp-codes.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const prompts = path.join(root, 'prompts');
const read = f => fs.readFileSync(path.join(prompts, f), 'utf8');
const latest = id => fs.readdirSync(prompts).filter(f => new RegExp(`^SP_${id}-assistant_v\\d+_\\d+\\.md$`).test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
const SECRET = 'test-secret-0123456789-abcdef';
const NOW = 1_800_000_000_000;
const chatBody = (sp, extra = {}) => JSON.stringify({ provider: 'deepseek', system: sp, messages: [{ role: 'user', content: '안녕' }], ...extra });

describe('전문가용 SP 식별', () => {
  it('제목 코드로 직역을 알아낸다 (변리사·변호사 세부 분야)', () => {
    assert.deepEqual(detectAssistantSp({ system: read(latest('patent-attorney')) }), { assistant: true, persona: 'patent-attorney' });
    assert.deepEqual(detectAssistantSp({ system: read(latest('lawyer-criminal')) }), { assistant: true, persona: 'lawyer-criminal' });
  });
  it('제목을 지워도 고유 줄 2개로 전문가용임을 알아본다 (직역 불명)', () => {
    const t = read(latest('lawyer')).replace(/^# SP-.*$/m, '# 내 비서');
    assert.deepEqual(detectAssistantSp({ system: t }), { assistant: true, persona: null });
  });
  it('messages 안의 system 문자열도 찾는다', () => {
    assert.equal(detectAssistantSp({ messages: [{ role: 'system', content: read(latest('physician')) }] }).persona, 'physician');
  });
  it('일반인용 SP 전부 — 전문가용으로 오인하지 않는다', () => {
    const bad = fs.readdirSync(prompts).filter(f => f.endsWith('.md') && !/-assistant_v/.test(f) && detectAssistantSp({ system: fs.readFileSync(path.join(prompts, f), 'utf8') }).assistant);
    assert.deepEqual(bad, []);
  });
  it('전문가용 SP 전 파일 — 식별된다 (생성기가 고유 줄·제목을 유지하는지 감시)', () => {
    const miss = fs.readdirSync(prompts).filter(f => /-assistant_v\d+_\d+\.md$/.test(f) && !(detectAssistantSp({ system: read(f) }).assistant && CLASS_MARKS.every(m => read(f).includes(m))));
    assert.deepEqual(miss, []);
  });
  it('assistant-sp-codes.js 가 prompts 와 일치 (SP 추가·개명 후 gen-assistant-sp-codes.mjs 재실행)', () => {
    assert.equal(fs.readFileSync(path.join(root, 'src/worker/assistant-sp-codes.js'), 'utf8'), render(buildCodeMap()));
    assert.ok(Object.keys(ASSISTANT_SP_CODES).length >= 100);
  });
});

describe('세션 토큰', () => {
  it('발급 → 검증', async () => {
    const { token, exp } = await issueSession(SECRET, { pk: 'k', personas: ['lawyer'] }, NOW);
    assert.equal(exp, NOW + SESSION_TTL_MS);
    assert.deepEqual(await verifySession(SECRET, token, NOW + 1000), { pk: 'k', personas: ['lawyer'], exp });
  });
  it('만료·변조·다른 키·형식 오류는 null', async () => {
    const { token } = await issueSession(SECRET, { pk: 'k', personas: ['lawyer'] }, NOW);
    assert.equal(await verifySession(SECRET, token, NOW + SESSION_TTL_MS + 1), null);
    const [p, s] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ pk: 'k', personas: ['lawyer', 'physician'], iat: NOW, exp: NOW + 1e9 })).toString('base64url');
    assert.equal(await verifySession(SECRET, `${forged}.${s}`, NOW), null);
    assert.equal(await verifySession('another-secret-0123456789', token, NOW), null);
    for (const bad of [undefined, '', 'a', 'a.b', 123]) assert.equal(await verifySession(SECRET, bad, NOW), null);
  });
  it('짧은 비밀키는 발급 거부', async () => { await assert.rejects(issueSession('short', { pk: 'k', personas: [] })); });
});

describe('서버 게이트', () => {
  const env = mode => ({ PRO_SESSION_SECRET: SECRET, ...(mode ? { PRO_GATE_MODE: mode } : {}) });
  const sp = read(latest('patent-attorney'));

  it('enforce: 세션 없이 전문가용 SP → 401', async () => {
    const r = await checkProGate({ bodyText: chatBody(sp), env: env('enforce'), now: NOW });
    assert.equal(r.ok, false); assert.equal(r.status, 401); assert.equal(r.code, 'PRO_SESSION_REQUIRED');
  });
  it('enforce: 키만 바꿔 호출(다른 직역 SP) — 해당 직역 인증이 없으면 403', async () => {
    const { token } = await issueSession(SECRET, { pk: 'k', personas: ['patent-attorney'] }, NOW);
    const r = await checkProGate({ bodyText: chatBody(read(latest('physician')), { pro_session: token }), env: env('enforce'), now: NOW });
    assert.equal(r.ok, false); assert.equal(r.status, 403); assert.equal(r.code, 'PRO_PERSONA_MISMATCH');
  });
  it('enforce: 해당 직역 세션이면 통과하고 pro_session 은 본문에서 제거', async () => {
    const { token } = await issueSession(SECRET, { pk: 'k', personas: ['patent-attorney'] }, NOW);
    const r = await checkProGate({ bodyText: chatBody(sp, { pro_session: token }), env: env('enforce'), now: NOW });
    assert.equal(r.ok, true); assert.ok(!r.bodyText.includes('pro_session')); assert.equal(JSON.parse(r.bodyText).messages[0].content, '안녕');
  });
  it('enforce: 상위 직역 인증은 하위 세부 분야 SP 를 덮는다, 반대는 불가', async () => {
    const up = await issueSession(SECRET, { pk: 'k', personas: ['lawyer'] }, NOW);
    assert.equal((await checkProGate({ bodyText: chatBody(read(latest('lawyer-criminal')), { pro_session: up.token }), env: env('enforce'), now: NOW })).ok, true);
    const down = await issueSession(SECRET, { pk: 'k', personas: ['lawyer-criminal'] }, NOW);
    assert.equal((await checkProGate({ bodyText: chatBody(read(latest('lawyer')), { pro_session: down.token }), env: env('enforce'), now: NOW })).ok, false);
  });
  it('enforce: 만료된 토큰 → 401', async () => {
    const { token } = await issueSession(SECRET, { pk: 'k', personas: ['patent-attorney'] }, NOW);
    const r = await checkProGate({ bodyText: chatBody(sp, { pro_session: token }), env: env('enforce'), now: NOW + SESSION_TTL_MS + 1 });
    assert.equal(r.status, 401);
  });
  it('enforce: 직역 불명(제목 삭제) 전문가용 SP 는 아무 직역 세션이면 통과, 세션 없으면 401', async () => {
    const t = sp.replace(/^# SP-.*$/m, '# x');
    assert.equal((await checkProGate({ bodyText: chatBody(t), env: env('enforce'), now: NOW })).status, 401);
    const { token } = await issueSession(SECRET, { pk: 'k', personas: ['accountant'] }, NOW);
    assert.equal((await checkProGate({ bodyText: chatBody(t, { pro_session: token }), env: env('enforce'), now: NOW })).ok, true);
  });
  it('일반인용 SP·일반 대화는 enforce 에서도 영향 없음', async () => {
    const r = await checkProGate({ bodyText: chatBody(read(fs.readdirSync(prompts).find(f => /^SP_patent-attorney_v/.test(f)))), env: env('enforce'), now: NOW });
    assert.equal(r.ok, true);
    assert.equal((await checkProGate({ bodyText: 'not json', env: env('enforce') })).ok, true);
  });
  it('log(기본): 차단하지 않고 wouldBlock 만 기록', async () => {
    const r = await checkProGate({ bodyText: chatBody(sp), env: env(), now: NOW });
    assert.equal(r.ok, true); assert.equal(r.wouldBlock, 'PRO_SESSION_REQUIRED'); assert.equal(r.mode, 'log');
  });
  it('off: 아무것도 하지 않음', async () => {
    const r = await checkProGate({ bodyText: chatBody(sp), env: env('off'), now: NOW });
    assert.equal(r.ok, true); assert.equal(r.wouldBlock, undefined);
  });
  it('PRO_SESSION_SECRET 이 없으면 enforce 에서 전문가용 SP 는 모두 거절 (실패 시 열어 두지 않는다)', async () => {
    const { token } = await issueSession(SECRET, { pk: 'k', personas: ['patent-attorney'] }, NOW);
    const r = await checkProGate({ bodyText: chatBody(sp, { pro_session: token }), env: { PRO_GATE_MODE: 'enforce' }, now: NOW });
    assert.equal(r.ok, false);
  });
});

describe('/pro-verify/session 발급', () => {
  const b64u = buf => Buffer.from(buf).toString('base64url');
  async function wallet() {
    const kp = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
    return { pub: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)), sign: async m => b64u(await crypto.subtle.sign('Ed25519', kp.privateKey, new TextEncoder().encode(m))) };
  }
  async function setup(rows) {
    const w = await wallet();
    const store = { async listByPubkey(p) { return rows(w.pub).filter(r => r.applicant_pubkey === p); } };
    const h = makeProVerifyHandler({ store, getPinnedPubKey: async (e, g) => (g === 'g1' ? w.pub : null), now: () => NOW });
    const call = async (env, over = {}) => {
      const body = { guid: 'g1', ts: NOW, ...over }; body.sig = over.sig ?? await w.sign(sessionMessage(body.ts));
      const res = await h.handle(new Request('https://x/pro-verify/session', { method: 'POST', body: JSON.stringify(body) }), new URL('https://x/pro-verify/session'), env);
      return { status: res.status, j: await res.json() };
    };
    return { call };
  }
  const approved = pk => [{ applicant_pubkey: pk, persona: 'patent-attorney', role: 'professional', status: 'approved', expires_ts: NOW + 1e9 }];

  it('승인된 전문가에게 토큰 발급, 토큰으로 게이트 통과', async () => {
    const { call } = await setup(approved);
    const r = await call({ PRO_SESSION_SECRET: SECRET });
    assert.equal(r.status, 200); assert.deepEqual(r.j.personas, ['patent-attorney']);
    const g = await checkProGate({ bodyText: chatBody(read(latest('patent-attorney')), { pro_session: r.j.token }), env: { PRO_SESSION_SECRET: SECRET, PRO_GATE_MODE: 'enforce' }, now: NOW });
    assert.equal(g.ok, true);
  });
  it('승인된 직역이 없거나 만료면 403', async () => {
    assert.equal((await (await setup(() => [])).call({ PRO_SESSION_SECRET: SECRET })).j.code, 'NOT_VERIFIED');
    assert.equal((await (await setup(pk => [{ ...approved(pk)[0], expires_ts: NOW - 1 }])).call({ PRO_SESSION_SECRET: SECRET })).j.code, 'NOT_VERIFIED');
    assert.equal((await (await setup(pk => [{ ...approved(pk)[0], status: 'revoked' }])).call({ PRO_SESSION_SECRET: SECRET })).j.code, 'NOT_VERIFIED');
  });
  it('서명 오류 401, 비밀키 미설정 503, 시각 오차 400', async () => {
    const { call } = await setup(approved);
    assert.equal((await call({ PRO_SESSION_SECRET: SECRET }, { sig: 'AAAA' })).status, 401);
    assert.equal((await call({})).status, 503);
    assert.equal((await call({ PRO_SESSION_SECRET: SECRET }, { ts: NOW - 3600_000 })).j.code, 'STALE_TS');
  });
});
