/**
 * phase29_webauthn_push_auth_regression.test.mjs
 *
 * 2026-09-07 사고실험으로 발견 — handleWebAuthnRegisterKey·handlePushSubscribe
 * 둘 다 guid만 body에 넣으면 누구나 "다른 사람의" 계정에 자기 지문(WebAuthn)
 * credential이나 자기 기기의 push 구독을 등록할 수 있었다(서명 검증 완전 부재).
 * guid는 공개 정보(GET /profile?guid=)라 사실상 전 계정이 노출된 상태였고,
 * 이 두 값은 재가입/기기 재바인딩 판별의 "이 기기가 계정 소유자의 것"이라는
 * 전제로 쓰이므로, 구멍이 막히지 않으면 그 판별 로직 전체가 무력화된다.
 * 이 테스트는 handleStepUpThresholdSet(09-06)과 동일한 서명 검증 패턴이
 * 이 두 엔드포인트에도 실제로 적용됐는지 회귀 방지 목적으로 고정한다.
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ══════════════════════════════════════════════════════════════════
// 픽스처 — 가짜 L1 PocketBase (profiles 컬렉션만 필요, phase25와 동일 패턴)
// ══════════════════════════════════════════════════════════════════

let db;
let idSeq;

function resetDb() {
  db = { profiles: [] };
  idSeq = 0;
}

function evalFilter(rec, filter) {
  const decoded = decodeURIComponent(filter);
  const m = decoded.match(/^(\w+)='(.*)'$/);
  if (m) return String(rec[m[1]] ?? '') === m[2].replace(/\\'/g, "'");
  throw new Error(`mock: 필터 파싱 실패: ${decoded}`);
}

function installMockFetch() {
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));

    if (u.pathname === '/api/admins/auth-with-password') {
      return new Response(JSON.stringify({ token: 'mock-admin-token' }), { status: 200 });
    }

    const collMatch = u.pathname.match(/^\/api\/collections\/(\w+)\/records\/?(.*)$/);
    if (!collMatch) throw new Error(`mock: 처리 못하는 경로: ${u.pathname}`);
    const [, collection, recordId] = collMatch;
    if (!db[collection]) throw new Error(`mock: 알 수 없는 컬렉션: ${collection}`);

    if ((!init.method || init.method === 'GET') && !recordId) {
      const filter = u.searchParams.get('filter');
      let items = db[collection];
      if (filter) items = items.filter(r => evalFilter(r, filter));
      return new Response(JSON.stringify({ items, page: 1, perPage: 200, totalItems: items.length }), { status: 200 });
    }

    if (init.method === 'PATCH' && recordId) {
      const idx = db[collection].findIndex(r => r.id === recordId);
      if (idx === -1) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
      const body = JSON.parse(init.body);
      db[collection][idx] = { ...db[collection][idx], ...body };
      return new Response(JSON.stringify(db[collection][idx]), { status: 200 });
    }

    throw new Error(`mock: 처리 못하는 요청: ${init.method || 'GET'} ${u.pathname}`);
  };
}

// ══════════════════════════════════════════════════════════════════
// Ed25519 헬퍼 (phase25와 동일)
// ══════════════════════════════════════════════════════════════════

function toB64u(bytes) {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function genKeyPair() {
  const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const rawPub = await crypto.subtle.exportKey('raw', kp.publicKey);
  return { privateKey: kp.privateKey, pubkeyB64u: toB64u(rawPub) };
}
async function sign(privateKey, message) {
  const sig = await crypto.subtle.sign('Ed25519', privateKey, new TextEncoder().encode(message));
  return toB64u(sig);
}
async function genEcdsaSpki() {
  // handleWebAuthnRegisterKey는 publicKeySpkiB64u를 ECDSA P-256 SPKI로
  // import 가능한지 검증한다 — WebAuthn credential 공개키 형식과 동일하게
  // 흉내낸다(서명 인증과는 무관한 별개 필드).
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const spki = await crypto.subtle.exportKey('spki', kp.publicKey);
  return toB64u(spki);
}

// ══════════════════════════════════════════════════════════════════

let worker;
const ENV = { L1_ADMIN_EMAIL: 'admin@test', L1_ADMIN_PASSWORD: 'pw' };

before(async () => {
  installMockFetch();
  worker = (await import('../../../worker.js')).default;
});

beforeEach(() => { resetDb(); });

function req(pathname, body) {
  return new Request(`https://hondi-proxy.example${pathname}`, {
    method: 'POST',
    headers: { 'Origin': 'http://localhost', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function call(pathname, body) {
  const res = await worker.fetch(req(pathname, body), ENV, {});
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function seedProfile(overrides = {}) {
  const rec = { id: `mock_p_${++idSeq}`, guid: 'victim-guid', extra: {}, ...overrides };
  db.profiles.push(rec);
  return rec;
}

// ══════════════════════════════════════════════════════════════════
// P29-1: /auth/webauthn/register-key — 서명 없이는 등록 불가
// ══════════════════════════════════════════════════════════════════

describe('P29-1: handleWebAuthnRegisterKey — 인증 없는 원격 등록 차단', () => {
  it('공격자가 피해자 guid로 서명 없이 자기 지문 credential을 등록하려 하면 403', async () => {
    const victimKeys = await genKeyPair();
    seedProfile({ guid: 'victim-guid', pubkey_ed25519: victimKeys.pubkeyB64u });

    const attackerSpki = await genEcdsaSpki();
    const { status, json } = await call('/auth/webauthn/register-key', {
      guid: 'victim-guid', credentialId: 'attacker-cred-id', publicKeySpkiB64u: attackerSpki,
      // pubkey/signature/ts 없음 — 09-07 이전엔 이것만으로 통과했다
    });

    assert.equal(status, 403, '서명 없는 등록 요청은 거부되어야 한다');
    assert.equal(json.error, 'AUTH_REQUIRED');
    const profile = db.profiles.find(p => p.guid === 'victim-guid');
    assert.deepEqual(profile.extra?.webauthn_credentials, undefined, 'credential이 실제로 등록되면 안 된다');
  });

  it('공격자가 훔친 서명이 아니라 남의 pubkey를 자기 서명과 짜맞춰 보내도 403', async () => {
    const victimKeys   = await genKeyPair();
    const attackerKeys = await genKeyPair();
    seedProfile({ guid: 'victim-guid', pubkey_ed25519: victimKeys.pubkeyB64u });

    const attackerSpki = await genEcdsaSpki();
    const ts = Date.now();
    const sigMsg = `webauthn-register-key:victim-guid:attacker-cred-id:${ts}`;
    // 공격자는 victim의 개인키가 없으므로 자기 개인키로 서명하고,
    // pubkey 필드에 victim의 공개키를 사칭해 넣어본다.
    const forgedSignature = await sign(attackerKeys.privateKey, sigMsg);

    const { status, json } = await call('/auth/webauthn/register-key', {
      guid: 'victim-guid', credentialId: 'attacker-cred-id', publicKeySpkiB64u: attackerSpki,
      pubkey: victimKeys.pubkeyB64u, signature: forgedSignature, ts,
    });

    assert.equal(status, 403, 'pubkey를 사칭해도 서명 자체가 그 pubkey로 검증되지 않으면 거부되어야 한다');
    assert.equal(json.error, 'AUTH_REQUIRED');
  });

  it('계정 소유자 본인의 서명이면 정상 등록된다(정상 경로 회귀 방지)', async () => {
    const ownerKeys = await genKeyPair();
    seedProfile({ guid: 'owner-guid', pubkey_ed25519: ownerKeys.pubkeyB64u });

    const spki = await genEcdsaSpki();
    const ts = Date.now();
    const sigMsg = `webauthn-register-key:owner-guid:my-cred-id:${ts}`;
    const signature = await sign(ownerKeys.privateKey, sigMsg);

    const { status, json } = await call('/auth/webauthn/register-key', {
      guid: 'owner-guid', credentialId: 'my-cred-id', publicKeySpkiB64u: spki,
      pubkey: ownerKeys.pubkeyB64u, signature, ts,
    });

    assert.equal(status, 200);
    assert.equal(json.ok, true);
    const profile = db.profiles.find(p => p.guid === 'owner-guid');
    assert.equal(profile.extra.webauthn_credentials.length, 1);
    assert.equal(profile.extra.webauthn_credentials[0].credentialId, 'my-cred-id');
  });
});

// ══════════════════════════════════════════════════════════════════
// P29-2: /push/subscribe — 서명 없이는 "신뢰 기기" 등록 불가
// ══════════════════════════════════════════════════════════════════

describe('P29-2: handlePushSubscribe — 인증 없는 원격 기기 등록 차단', () => {
  it('공격자가 피해자 guid로 서명 없이 자기 기기를 구독시키려 하면 403', async () => {
    const victimKeys = await genKeyPair();
    seedProfile({ guid: 'victim-guid', pubkey_ed25519: victimKeys.pubkeyB64u, push_subscription: '' });

    const { status, json } = await call('/push/subscribe', {
      guid: 'victim-guid', deviceId: 'attacker-device',
      subscription: { endpoint: 'https://fake/attacker' },
      // pubkey/signature/ts 없음
    });

    assert.equal(status, 403, '서명 없는 구독 등록은 거부되어야 한다');
    assert.equal(json.error, 'AUTH_REQUIRED');
    const profile = db.profiles.find(p => p.guid === 'victim-guid');
    assert.equal(profile.push_subscription, '', '공격자 기기가 실제로 등록되면 안 된다');
  });

  it('guid를 모르는 상태에서 존재하지 않는 계정을 노려도 프로필 존재 여부가 새지 않는다(403, 404 아님)', async () => {
    const { status, json } = await call('/push/subscribe', {
      guid: 'no-such-guid', deviceId: 'attacker-device',
      subscription: { endpoint: 'https://fake/attacker' },
    });
    assert.equal(status, 403);
    assert.equal(json.error, 'AUTH_REQUIRED');
  });

  it('계정 소유자 본인의 서명이면 정상 구독 등록된다(정상 경로 회귀 방지)', async () => {
    const ownerKeys = await genKeyPair();
    seedProfile({ guid: 'owner-guid', pubkey_ed25519: ownerKeys.pubkeyB64u, push_subscription: '' });

    const ts = Date.now();
    const sigMsg = `push-subscribe:owner-guid:my-phone:sub:${ts}`;
    const signature = await sign(ownerKeys.privateKey, sigMsg);

    const { status, json } = await call('/push/subscribe', {
      guid: 'owner-guid', deviceId: 'my-phone',
      subscription: { endpoint: 'https://fake/my-phone' },
      pubkey: ownerKeys.pubkeyB64u, signature, ts,
    });

    assert.equal(status, 200);
    assert.equal(json.ok, true);
    const profile = db.profiles.find(p => p.guid === 'owner-guid');
    const devices = JSON.parse(profile.push_subscription);
    assert.equal(devices.length, 1);
    assert.equal(devices[0].deviceId, 'my-phone');
  });
});
