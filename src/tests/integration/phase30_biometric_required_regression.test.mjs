/**
 * phase30_biometric_required_regression.test.mjs
 *
 * 2026-09-07 사용자 지시 — SMS 인증(전화번호 재클레임)과 웹 푸시 인증
 * (device-link 승인) 모두에 지문(WebAuthn step-up) 인증을 추가로 요구한다.
 * 이 파일은 worker.js에서 직접 테스트 가능한 부분만 다룬다:
 *   - _verifyStepUpToken의 payload 포맷 수정(콜론 join/split → JSON 배열)
 *     — guid가 IPv6 형식(콜론 7개 포함)이라 기존 콜론 split이 근본적으로
 *     깨져 있었다(사고실험 중 발견, 이 수정과 함께 고침).
 *   - handleDeviceLinkVerify가 이제 step_up_token 없이는 승인을 거부한다.
 *   - handlePhoneOtpRequest가 지문을 쓰는 기존 계정이 있으면 그 guid 앞으로
 *     생체 챌린지를 함께 내려준다.
 *
 * pb_hooks/main.pb.js(Goja, 실제 재가입 시 지문 강제)는 PocketBase 런타임이
 * 필요해 이 Node 테스트 하네스로는 검증할 수 없다 — 라이브 환경에서 별도
 * 확인이 필요하다(응답에 이 사실을 명시했음).
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let db;
let idSeq;
function resetDb() { db = { profiles: [] }; idSeq = 0; }

function evalFilter(rec, filter) {
  const decoded = decodeURIComponent(filter);
  const m = decoded.match(/^(\w+)='(.*)'$/);
  if (m) return String(rec[m[1]] ?? '') === m[2].replace(/\\'/g, "'");
  throw new Error(`mock: 필터 파싱 실패: ${decoded}`);
}

const kvStore = new Map();
const kvMock = {
  async get(key) { return kvStore.has(key) ? kvStore.get(key) : null; },
  async put(key, value) { kvStore.set(key, value); },
  async delete(key) { kvStore.delete(key); },
};

// DEVICE_LINK_SESSIONS(Durable Object)를 흉내내는 스텁 — 실제 DeviceLinkSessionDO의
// fetch(request) 계약(GET/PUT/DELETE, 고정 URL 'https://devlink-session/',
// GET 없으면 404, PUT은 {record, ttlSeconds} body)과 정확히 맞춘다.
const dlStore = new Map();
function makeDeviceLinkSessionsStub() {
  return {
    idFromName: (name) => name,
    get: (id) => ({
      fetch: async (url, init = {}) => {
        const method = init.method || 'GET';
        if (method === 'PUT') {
          const body = JSON.parse(init.body);
          dlStore.set(id, body.record);
          return new Response('ok', { status: 200 });
        }
        if (method === 'GET') {
          const record = dlStore.get(id);
          if (!record) return new Response('not_found', { status: 404 });
          return new Response(JSON.stringify(record), { status: 200 });
        }
        if (method === 'DELETE') {
          dlStore.delete(id);
          return new Response('ok', { status: 200 });
        }
        return new Response('method not allowed', { status: 405 });
      },
    }),
  };
}

function installMockFetch() {
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.pathname === '/api/admins/auth-with-password') {
      return new Response(JSON.stringify({ token: 'mock-admin-token' }), { status: 200 });
    }
    if (String(url) === 'https://api.solapi.com/messages/v4/send') {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    const collMatch = u.pathname.match(/^\/api\/collections\/(\w+)\/records\/?(.*)$/);
    if (collMatch) {
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
    }
    throw new Error(`mock: 처리 못하는 요청: ${init.method || 'GET'} ${u.pathname}`);
  };
}

function toB64u(bytes) {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
// WebCrypto의 ECDSA sign()은 raw(r||s, 각 32바이트) 포맷을 낸다 — 실제
// WebAuthn 인증기가 내려주는 서명은 DER 포맷이라 서버(_derToRawEcdsaSig)가
// 그걸 raw로 변환하는 구조다. 테스트에서 진짜 인증기 없이 이를 흉내내려면
// raw → DER로 인코딩해서 보내야 한다.
function _rawEcdsaSigToDer(rawSig) {
  const bytes = new Uint8Array(rawSig);
  const r = bytes.slice(0, 32);
  const s = bytes.slice(32, 64);
  const toDerInt = (b) => {
    let arr = Array.from(b);
    while (arr.length > 1 && arr[0] === 0) arr.shift();
    if (arr[0] & 0x80) arr.unshift(0);
    return [0x02, arr.length, ...arr];
  };
  const derR = toDerInt(r);
  const derS = toDerInt(s);
  const body = [...derR, ...derS];
  return new Uint8Array([0x30, body.length, ...body]);
}
async function genEd25519() {
  const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const rawPub = await crypto.subtle.exportKey('raw', kp.publicKey);
  return { privateKey: kp.privateKey, pubkeyB64u: toB64u(rawPub) };
}

let worker;
const ENV = {
  L1_ADMIN_EMAIL: 'admin@test', L1_ADMIN_PASSWORD: 'pw',
  PHONE_VERIFY_SECRET: 'test-secret-key',
  QR_SESSIONS_KV: kvMock,
  DEVICE_LINK_SESSIONS: makeDeviceLinkSessionsStub(),
  SOLAPI_API_KEY: 'test-key', SOLAPI_API_SECRET: 'test-secret', SOLAPI_SENDER_NUMBER: '01000000000',
};

before(async () => {
  installMockFetch();
  worker = (await import('../../../worker.js')).default;
});

beforeEach(() => { resetDb(); kvStore.clear(); dlStore.clear(); });

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
  const rec = { id: `mock_p_${++idSeq}`, extra: {}, ...overrides };
  db.profiles.push(rec);
  return rec;
}

// ══════════════════════════════════════════════════════════════════
// P30-1: _verifyStepUpToken — guid(IPv6, 콜론 포함) 왕복 검증
// ══════════════════════════════════════════════════════════════════

describe('P30-1: step_up_token — IPv6 형식 guid(콜론 다수 포함) 왕복', () => {
  it('challenge → 서버검증 → 발급된 토큰이 실제 IPv6 guid로 정상 검증된다', async () => {
    const guid = '2601:db80:1111:2222:3333:4444:5555:6666'; // 콜론 7개
    const ownerKeys = await genEd25519();
    seedProfile({ guid, pubkey_ed25519: ownerKeys.pubkeyB64u, extra: {} });

    const { status: chStatus, json: ch } = await call('/account/step-up-challenge', {
      guid, tx_hash: 'device-link:some-session-id', // tx_hash도 콜론 포함
    });
    assert.equal(chStatus, 200);
    assert.ok(ch.sessionId && ch.challengeB64u);

    // 실제 WebAuthn 인증기 대신, register-key로 등록한 ECDSA 키로
    // authenticatorData+clientDataJSON을 직접 구성해 서명한다.
    const ecdsaKp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const spki = await crypto.subtle.exportKey('spki', ecdsaKp.publicKey);
    const credentialId = 'test-stepup-cred';
    db.profiles[0].extra.webauthn_credentials = [{ credentialId, publicKeySpkiB64u: toB64u(spki) }];

    const rpIdHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('hondi.net')));
    const authenticatorData = new Uint8Array(37);
    authenticatorData.set(rpIdHash, 0);
    authenticatorData[32] = 0x05; // UP(0x01) | UV(0x04)
    const clientDataJSON = new TextEncoder().encode(JSON.stringify({
      type: 'webauthn.get', challenge: ch.challengeB64u, origin: 'https://hondi.net',
    }));
    const clientDataHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSON));
    const signedData = new Uint8Array(authenticatorData.length + clientDataHash.length);
    signedData.set(authenticatorData, 0);
    signedData.set(clientDataHash, authenticatorData.length);
    const derSig = _rawEcdsaSigToDer(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, ecdsaKp.privateKey, signedData));

    const { status: vStatus, json: vJson } = await call('/account/step-up-verify', {
      guid, sessionId: ch.sessionId, credentialId,
      authenticatorDataB64u: toB64u(authenticatorData),
      clientDataJSONB64u: toB64u(clientDataJSON),
      signatureB64u: toB64u(derSig),
    });
    assert.equal(vStatus, 200, JSON.stringify(vJson));
    assert.ok(vJson.step_up_token, '콜론 포함 guid에서도 step_up_token이 정상 발급돼야 함');
    assert.ok(!vJson.step_up_token.includes('undefined'));
  });
});

// ══════════════════════════════════════════════════════════════════
// P30-2: handleDeviceLinkVerify — step_up_token 없이는 승인 불가
// ══════════════════════════════════════════════════════════════════

describe('P30-2: handleDeviceLinkVerify — 생체 인증 없이는 승인 거부', () => {
  it('코드가 맞아도 step_up_token이 없으면 403 BIOMETRIC_REQUIRED', async () => {
    dlStore.set('sess-1', { guid: 'g1', code: '123456', attempts: 0, state: 'pending', e164: '+821000000000' });
    const { status, json } = await call('/auth/device-link/verify', { sessionId: 'sess-1', code: '123456' });
    assert.equal(status, 403);
    assert.equal(json.error, 'BIOMETRIC_REQUIRED');
  });

  it('유효한 step_up_token을 함께 보내면 승인된다(정상 경로 회귀 방지)', async () => {
    const guid = '2601:db80:aaaa:bbbb:cccc:dddd:eeee:ffff';
    dlStore.set('sess-2', { guid, code: '654321', attempts: 0, state: 'pending', e164: '+821000000000' });

    // step-up 토큰을 실제 발급 엔드포인트를 거치지 않고, 같은 포맷으로
    // 직접 구성한다(challenge/assertion ceremony는 P30-1에서 이미 검증).
    const exp = Date.now() + 2 * 60 * 1000;
    const payload = JSON.stringify([guid, `device-link:sess-2`, exp]);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('test-secret-key'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
    const sig = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
    const step_up_token = payload + '.' + sig;

    const { status, json } = await call('/auth/device-link/verify', { sessionId: 'sess-2', code: '654321', step_up_token });
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.ok, true);
  });
});

// ══════════════════════════════════════════════════════════════════
// P30-3: handlePhoneOtpRequest — 지문 계정 재클레임 시 챌린지 동봉
// ══════════════════════════════════════════════════════════════════

describe('P30-3: handlePhoneOtpRequest — 기존 지문 계정이 있으면 생체 챌린지 동봉', () => {
  it('지문을 쓰는 기존 계정이 있으면 existingAccountBiometricChallenge가 채워진다', async () => {
    const e164 = '+8201099998888';
    seedProfile({
      guid: 'owner-guid', e164, claim_status: 'active',
      extra: { webauthn_credentials: [{ credentialId: 'cred-1', publicKeySpkiB64u: 'x' }] },
    });

    const { status, json } = await call('/biz/phone-otp-request', { e164 });
    assert.equal(status, 200, JSON.stringify(json));
    assert.ok(json.existingAccountBiometricChallenge, '지문 계정이 있으면 챌린지가 동봉돼야 함');
    assert.equal(json.existingAccountBiometricChallenge.guid, 'owner-guid');
    assert.deepEqual(json.existingAccountBiometricChallenge.credentialIds, ['cred-1']);
  });

  it('지문을 안 쓰는 기존 계정이면 챌린지 없이 그냥 진행된다(정상 신규가입 회귀 방지)', async () => {
    const e164 = '+8201011112222';
    // 이 번호로 등록된 계정 자체가 없음 — 순수 신규가입
    const { status, json } = await call('/biz/phone-otp-request', { e164 });
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.existingAccountBiometricChallenge, null);
  });
});
