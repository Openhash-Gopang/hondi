// phase10_push_l1_priority.test.js
// 실행: node --test src/tests/network/phase10_push_l1_priority.test.js
//
// BUG-FIX(2026-07-17): 이 파일은 원래 "L1 우선, 실패 시 Supabase 폴백/
// 미러링" 아키텍처를 검증하도록 작성됐다. 그런데 worker.js는 2026-07-14에
// Supabase를 완전히 폐기했다(주석: "Supabase 백업 폴백 제거 — L1 연결
// 실패는 그대로 실패로 처리한다. 재시도는 호출부(클라이언트) 책임").
// handlePushSend/handlePushSubscribe 어디에도 Supabase 참조가 이제
// 없는데, 이 테스트들은 여전히 Supabase 목(mock)을 기대하고 있어 전부
// 실패하고 있었다(PL-01/03/04 — 실사로 재현·확인). 지금의 "L1 only,
// 실패 시 즉시 502" 설계에 맞춰 전면 재작성한다.
//
// 추가로 PL-01의 구독 픽스처가 { endpoint: 'https://fake/x' }만 있고
// keys:{p256dh,auth}가 없어 _sendWebPush가 조용히 false를 반환하던
// 문제도 함께 수정(PB-04와 동일한 클래스의 픽스처 버그).

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import worker from '../../../worker.js';

const L1_BASE = 'https://l1-hanlim.hondi.net';
const ORIGIN  = 'https://hondi-proxy.tensor-city.workers.dev';

function b64uEncodeBytes(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
async function makeVapidEnv(overrides = {}) {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const rawPub  = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const jwkPriv = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return {
    L1_ADMIN_EMAIL: 'a@a.com', L1_ADMIN_PASSWORD: 'pw',
    VAPID_PUBLIC_KEY:  b64uEncodeBytes(rawPub),
    VAPID_PRIVATE_KEY: jwkPriv.d.replace(/=+$/, ''),
    VAPID_SUBJECT: 'mailto:a@a.com',
    ...overrides,
  };
}
async function makeSubscriberKeys() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  return { p256dh: b64uEncodeBytes(rawPub), auth: b64uEncodeBytes(authSecret) };
}
function req(path, body) {
  return new Request(`${ORIGIN}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

// ── 2026-09-07 신설 — /push/subscribe 서명 인증 요구 반영 ─────────────
// handlePushSubscribe가 guid만으로 아무나 기기를 등록할 수 있던 결함이
// 수정되면서, 이 계정 지갑의 Ed25519 서명 없이는 통과하지 않는다.
// phase25_security_regression.test.mjs와 동일한 헬퍼로 서명한다.
function toB64u(bytes) {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function genEd25519() {
  const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const rawPub = await crypto.subtle.exportKey('raw', kp.publicKey);
  return { privateKey: kp.privateKey, pubkeyB64u: toB64u(rawPub) };
}
async function signEd25519(privateKey, message) {
  const sig = await crypto.subtle.sign('Ed25519', privateKey, new TextEncoder().encode(message));
  return toB64u(sig);
}
async function pushSubscribeSigned({ guid, deviceId = 'legacy', unsubscribe = false, keyPair, ...rest }) {
  const ts = Date.now();
  const sigMsg = `push-subscribe:${guid}:${deviceId}:${unsubscribe ? 'unsub' : 'sub'}:${ts}`;
  const signature = await signEd25519(keyPair.privateKey, sigMsg);
  return req('/push/subscribe', {
    guid, deviceId, unsubscribe, ...rest,
    pubkey: keyPair.pubkeyB64u, signature, ts,
  });
}

let originalFetch;
beforeEach(() => { originalFetch = globalThis.fetch; });
afterEach(()  => { globalThis.fetch = originalFetch; });

describe('PL: push 구독 L1 전용 동작(2026-07-14 Supabase 완전 폐기 이후)', () => {
  it('PL-01: handlePushSend는 L1에 유효한 구독이 있으면 실제로 발송한다(source=l1)', async () => {
    const keys = await makeSubscriberKeys();
    globalThis.fetch = async (u, init = {}) => {
      const url = typeof u === 'string' ? u : u.url;
      if (url === `${L1_BASE}/api/admins/auth-with-password`)
        return new Response(JSON.stringify({ token: 't' }), { status: 200 });
      if (url.startsWith(`${L1_BASE}/api/collections/profiles/records`))
        return new Response(JSON.stringify({ items: [{ id: 'r1', push_subscription: JSON.stringify({ endpoint: 'https://fake/x', keys }), push_sound: 'bell' }] }), { status: 200 });
      if (url.startsWith('https://fake/')) return new Response('', { status: 201 });
      throw new Error('unexpected fetch: ' + url);
    };
    const res = await worker.fetch(req('/push/send', { to_guid: 'g1' }), await makeVapidEnv());
    const data = await res.json();
    assert.equal(data.source, 'l1');
    assert.equal(data.sent, 1);
  });

  it('PL-02: handlePushSend는 L1이 정상 응답했지만 구독이 없으면 NO_SUBSCRIPTION', async () => {
    globalThis.fetch = async (u) => {
      const url = typeof u === 'string' ? u : u.url;
      if (url === `${L1_BASE}/api/admins/auth-with-password`)
        return new Response(JSON.stringify({ token: 't' }), { status: 200 });
      if (url.startsWith(`${L1_BASE}/api/collections/profiles/records`))
        return new Response(JSON.stringify({ items: [{ id: 'r1', push_subscription: '' }] }), { status: 200 });
      throw new Error('unexpected fetch: ' + url);
    };
    const res = await worker.fetch(req('/push/send', { to_guid: 'g1' }), await makeVapidEnv());
    const data = await res.json();
    assert.equal(data.sent, 0);
    assert.equal(data.reason, 'NO_SUBSCRIPTION');
    assert.equal(data.source, 'l1');
  });

  it('PL-03: handlePushSend는 L1 연결 자체가 실패하면 502 L1_UNREACHABLE로 즉시 실패한다(폴백 없음)', async () => {
    // 2026-07-14 이후 설계: Supabase 폴백이 없으므로 L1 실패는 그대로 실패.
    globalThis.fetch = async (u) => {
      const url = typeof u === 'string' ? u : u.url;
      if (url === `${L1_BASE}/api/admins/auth-with-password`)
        throw new Error('L1 다운');
      throw new Error('unexpected fetch: ' + url);
    };
    const res = await worker.fetch(req('/push/send', { to_guid: 'g1' }), await makeVapidEnv());
    assert.equal(res.status, 502);
    const data = await res.json();
    assert.equal(data.error, 'L1_UNREACHABLE');
  });

  it('PL-04: handlePushSubscribe는 L1에만 저장한다(Supabase 미러링 없음) — 2026-07-23: 기기별 배열 형식', async () => {
    const keyPair = await genEd25519();
    let patchedBody = null;
    globalThis.fetch = async (u, init = {}) => {
      const url = typeof u === 'string' ? u : u.url;
      if (url === `${L1_BASE}/api/admins/auth-with-password`)
        return new Response(JSON.stringify({ token: 't' }), { status: 200 });
      if (url.startsWith(`${L1_BASE}/api/collections/profiles/records`) && !url.includes('/records/'))
        return new Response(JSON.stringify({ items: [{ id: 'r1', guid: 'g1', pubkey_ed25519: keyPair.pubkeyB64u }] }), { status: 200 });
      if (url.includes('/records/r1')) {
        patchedBody = JSON.parse(init.body);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      throw new Error('unexpected fetch: ' + url);
    };
    const signedReq = await pushSubscribeSigned({
      guid: 'g1', deviceId: 'dev-pc-1', subscription: { endpoint: 'https://fake/z' }, sound: 'drop', keyPair,
    });
    const res = await worker.fetch(signedReq, await makeVapidEnv());
    assert.equal(res.status, 200);
    assert.ok(patchedBody, 'L1 PATCH가 호출돼야 함');
    const devices = JSON.parse(patchedBody.push_subscription);
    assert.ok(Array.isArray(devices), 'push_subscription은 기기별 배열이어야 함');
    assert.equal(devices.length, 1);
    assert.equal(devices[0].deviceId, 'dev-pc-1');
    assert.equal(devices[0].subscription.endpoint, 'https://fake/z');
    assert.equal(devices[0].sound, 'drop');
    assert.equal(patchedBody.push_sound, 'drop');
  });

  it('PL-05: handlePushSubscribe는 가입(L1 프로필)이 없으면 404 PROFILE_NOT_FOUND', async () => {
    // (2026-09-07 갱신) — 서명 인증이 프로필 존재 확인보다 먼저 검사되므로
    // (동일 guid에 실제로 등록된 pubkey가 없으면 _verifyClaimsRequester가
    // 이미 false), 유효한 키페어로 서명해서 "인증은 통과했지만 프로필이
    // 없는" 상황을 별도로 재현할 수 없다 — 그 자체가 이번 수정의 목적
    // (guid 존재 여부를 공격자에게 구분해서 알려주지 않음)이므로, 이제는
    // 서명 없는 요청이 404가 아니라 403 AUTH_REQUIRED로 먼저 막히는 것이
    // 올바른 동작이다.
    globalThis.fetch = async (u) => {
      const url = typeof u === 'string' ? u : u.url;
      if (url === `${L1_BASE}/api/admins/auth-with-password`)
        return new Response(JSON.stringify({ token: 't' }), { status: 200 });
      if (url.startsWith(`${L1_BASE}/api/collections/profiles/records`))
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      throw new Error('unexpected fetch: ' + url);
    };
    const res = await worker.fetch(req('/push/subscribe', { guid: 'no-such-guid', subscription: { endpoint: 'https://fake/z' } }), await makeVapidEnv());
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.equal(data.error, 'AUTH_REQUIRED');
  });
});
