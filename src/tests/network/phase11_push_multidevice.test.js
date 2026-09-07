// phase11_push_multidevice.test.js
// 실행: node --test src/tests/network/phase11_push_multidevice.test.js
//
// 배경: docs/PUSH_SUBSCRIPTION_HIJACK_2026_07_21.md — device-link(PC 로그인)
// 승인 알림이 폰이 아니라 PC 자신에게 도착하던 사고. 07-21 수정(지갑 키
// 없는 기기만 자가치유에서 걸러냄)으로도 "PC가 실제로 지갑 키를 가진
// 정당한 기기"인 경우엔 여전히 재현됐다(§4 잔여 한계로 문서에 명시).
//
// 이번 근본 수정: profiles.push_subscription을 "구독 객체 1개"에서
// "기기별 항목 배열"로 바꿔, 여러 기기가 각자 독립적으로 구독을 유지하고
// device-link 알림은 등록된 모든 기기로 발송한다(어느 기기가 실제
// 지갑 키로 승인하든 상관없음 — 다른 기기의 알림은 그냥 무해하게 뜬다).

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
  // ★ 2026-08-30 추가 — handleDeviceLinkInit(_dlPut 경유)이 필요로 하는
  // DEVICE_LINK_SESSIONS(Durable Object 네임스페이스) 바인딩이 이
  // 픽스처에 아예 없어서, 'DO_NOT_BOUND'(500) 가드에 걸려 push 로직
  // 자체에 도달하기 전에 조기 종료되고 있었다(PM-02 실패 원인). 실제
  // DO 인스턴스 대신, _dlStub이 기대하는 최소 인터페이스
  // (idFromName→get→fetch)만 흉내내는 stub으로 대체 — PUT 요청이면
  // 무조건 성공 응답만 반환해도 _dlPut 호출부는 그 결과를 안 쓴다.
  const deviceLinkSessionsStub = {
    idFromName: () => 'stub-id',
    get: () => ({ fetch: async () => new Response('{}', { status: 200 }) }),
  };
  return {
    L1_ADMIN_EMAIL: 'a@a.com', L1_ADMIN_PASSWORD: 'pw',
    VAPID_PUBLIC_KEY:  b64uEncodeBytes(rawPub),
    VAPID_PRIVATE_KEY: jwkPriv.d.replace(/=+$/, ''),
    VAPID_SUBJECT: 'mailto:a@a.com',
    DEVICE_LINK_SESSIONS: deviceLinkSessionsStub,
    // 2026-09-07 추가 — profiles.e164 평문 저장 제거(_e164Hash 신설)로
    // handleDeviceLinkInit이 _l1FindProfileByE164 경유로 이제 이 값을
    // 필요로 한다 — 없으면 PM-02가 조용히 500으로 실패한다.
    PHONE_VERIFY_SECRET: 'test-phone-verify-secret',
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

// ── 2026-09-07 신설 — /push/subscribe 서명 인증 요구 반영(phase10과 동일 헬퍼) ──
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

describe('PM: push 구독 기기별 분리 (2026-07-23 — device-link 알림이 PC로 가던 사고 근본 수정)', () => {

  it('PM-01: 두 기기(PC, 폰)가 각자 구독하면 서로 덮어쓰지 않고 둘 다 저장된다', async () => {
    const keyPair = await genEd25519();
    let stored = ''; // L1에 저장된 push_subscription 값(순차적으로 갱신됨)
    globalThis.fetch = async (u, init = {}) => {
      const url = typeof u === 'string' ? u : u.url;
      if (url === `${L1_BASE}/api/admins/auth-with-password`)
        return new Response(JSON.stringify({ token: 't' }), { status: 200 });
      if (url.startsWith(`${L1_BASE}/api/collections/profiles/records`) && !url.includes('/records/'))
        return new Response(JSON.stringify({ items: [{ id: 'r1', guid: 'g1', pubkey_ed25519: keyPair.pubkeyB64u, push_subscription: stored }] }), { status: 200 });
      if (url.includes('/records/r1')) {
        stored = JSON.parse(init.body).push_subscription;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      throw new Error('unexpected fetch: ' + url);
    };

    // 1) PC가 먼저 구독
    await worker.fetch(await pushSubscribeSigned({
      guid: 'g1', deviceId: 'pc-1', subscription: { endpoint: 'https://fake/pc' }, sound: 'ping', keyPair,
    }), await makeVapidEnv());

    // 2) 폰이 나중에 구독 — 이전(PC) 구독을 덮어쓰면 안 됨
    await worker.fetch(await pushSubscribeSigned({
      guid: 'g1', deviceId: 'phone-1', subscription: { endpoint: 'https://fake/phone' }, sound: 'ping', keyPair,
    }), await makeVapidEnv());

    const devices = JSON.parse(stored);
    assert.equal(devices.length, 2, 'PC 구독이 폰 구독으로 덮어써지지 않고 둘 다 남아있어야 함');
    const endpoints = devices.map(d => d.subscription.endpoint).sort();
    assert.deepEqual(endpoints, ['https://fake/pc', 'https://fake/phone']);
  });

  it('PM-02: device-link 알림은 등록된 모바일 기기로만 발송된다(PC 자기수신 차단, 2026-08-29 근본 수정 반영)', async () => {
    const keysPc    = await makeSubscriberKeys();
    const keysPhone = await makeSubscriberKeys();
    const sentTo = [];
    // ★ 2026-08-30 수정 — deviceType 필드는 2026-07-28 신설, 2026-08-29에
    // "device-link 알림은 mobile 기기에만 보낸다"로 발송 자체를 원천
    // 차단하는 근본 수정이 추가됐다(PC가 자기 요청을 스스로 받던 사고
    // 방지). 이 테스트는 그 이전(2026-07-23) "등록된 모든 기기로 발송"
    // 설계를 검증하던 것이라 픽스처에 deviceType이 아예 없었다 — 지금은
    // deviceType 미지정 시 'unknown'으로 취급돼 mobile 필터에 안 걸려
    // 발송 자체가 스킵된다. 현재 의도(모바일만 발송)에 맞게 각 기기의
    // deviceType을 명시하고, 검증 방향도 "PC 제외"로 뒤집는다.
    const existingDevices = JSON.stringify([
      { deviceId: 'pc-1',    subscription: { endpoint: 'https://fake/pc',    keys: keysPc },    sound: 'ping', updatedAt: 2000, deviceType: 'desktop' },
      { deviceId: 'phone-1', subscription: { endpoint: 'https://fake/phone', keys: keysPhone }, sound: 'ping', updatedAt: 1000, deviceType: 'mobile' },
    ]);

    globalThis.fetch = async (u, init = {}) => {
      const url = typeof u === 'string' ? u : u.url;
      if (url === `${L1_BASE}/api/admins/auth-with-password`)
        return new Response(JSON.stringify({ token: 't' }), { status: 200 });
      // e164 조회(가입 확인)와 guid 조회(fresh profile) 둘 다 같은 프로필을 반환
      if (url.startsWith(`${L1_BASE}/api/collections/profiles/records`))
        return new Response(JSON.stringify({ items: [{ id: 'r1', guid: 'g1', push_subscription: existingDevices }] }), { status: 200 });
      if (url.startsWith('https://fake/')) { sentTo.push(url); return new Response('', { status: 201 }); }
      throw new Error('unexpected fetch: ' + url);
    };

    const res = await worker.fetch(req('/auth/device-link/init', {
      e164: '+821012345678', pcPubKeyB64u: b64uEncodeBytes(new Uint8Array(32)), pcLabel: '테스트 PC',
    }), await makeVapidEnv({ QR_SESSIONS_KV: { get: async () => null, put: async () => {} } }));

    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.pushSent, true);
    assert.equal(data.pushSentToMobile, true);
    assert.equal(sentTo.length, 1, '모바일 기기에만 발송돼야 함(PC 자기수신 차단이 이번 사고의 핵심)');
    assert.ok(sentTo.some(u => u.startsWith('https://fake/phone')));
    assert.ok(!sentTo.some(u => u.startsWith('https://fake/pc')), 'PC(desktop)는 발송 대상에서 제외돼야 함');
  });

  it('PM-03: 구독 취소는 그 기기 항목만 제거하고 다른 기기는 그대로 남는다', async () => {
    const keyPair = await genEd25519();
    let stored = JSON.stringify([
      { deviceId: 'pc-1',    subscription: { endpoint: 'https://fake/pc' },    sound: 'ping', updatedAt: 2000 },
      { deviceId: 'phone-1', subscription: { endpoint: 'https://fake/phone' }, sound: 'ping', updatedAt: 1000 },
    ]);
    globalThis.fetch = async (u, init = {}) => {
      const url = typeof u === 'string' ? u : u.url;
      if (url === `${L1_BASE}/api/admins/auth-with-password`)
        return new Response(JSON.stringify({ token: 't' }), { status: 200 });
      if (url.startsWith(`${L1_BASE}/api/collections/profiles/records`) && !url.includes('/records/'))
        return new Response(JSON.stringify({ items: [{ id: 'r1', guid: 'g1', pubkey_ed25519: keyPair.pubkeyB64u, push_subscription: stored }] }), { status: 200 });
      if (url.includes('/records/r1')) {
        stored = JSON.parse(init.body).push_subscription;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      throw new Error('unexpected fetch: ' + url);
    };

    await worker.fetch(await pushSubscribeSigned({ guid: 'g1', deviceId: 'pc-1', unsubscribe: true, keyPair }), await makeVapidEnv());

    const devices = JSON.parse(stored);
    assert.equal(devices.length, 1, 'pc-1만 제거되고 phone-1은 남아야 함');
    assert.equal(devices[0].deviceId, 'phone-1');
  });

  it('PM-04: 구버전(단일 구독 객체) 데이터도 계속 읽을 수 있다(하위호환)', async () => {
    // 이번 수정 이전 형식 — 배열이 아니라 구독 객체 하나
    const legacyStored = JSON.stringify({ endpoint: 'https://fake/legacy-device', keys: await makeSubscriberKeys() });
    const sentTo = [];
    globalThis.fetch = async (u) => {
      const url = typeof u === 'string' ? u : u.url;
      if (url === `${L1_BASE}/api/admins/auth-with-password`)
        return new Response(JSON.stringify({ token: 't' }), { status: 200 });
      if (url.startsWith(`${L1_BASE}/api/collections/profiles/records`))
        return new Response(JSON.stringify({ items: [{ id: 'r1', push_subscription: legacyStored, push_sound: 'bell' }] }), { status: 200 });
      if (url.startsWith('https://fake/')) { sentTo.push(url); return new Response('', { status: 201 }); }
      throw new Error('unexpected fetch: ' + url);
    };
    const res = await worker.fetch(req('/push/send', { to_guid: 'g1' }), await makeVapidEnv());
    const data = await res.json();
    assert.equal(data.sent, 1, '구버전 단일 객체 형식도 정상적으로 읽혀서 발송돼야 함');
    assert.ok(sentTo[0].startsWith('https://fake/legacy-device'));
  });

  it('PM-05: 같은 deviceId로 재구독하면 교체될 뿐 중복 추가되지 않는다', async () => {
    const keyPair = await genEd25519();
    let stored = '';
    globalThis.fetch = async (u, init = {}) => {
      const url = typeof u === 'string' ? u : u.url;
      if (url === `${L1_BASE}/api/admins/auth-with-password`)
        return new Response(JSON.stringify({ token: 't' }), { status: 200 });
      if (url.startsWith(`${L1_BASE}/api/collections/profiles/records`) && !url.includes('/records/'))
        return new Response(JSON.stringify({ items: [{ id: 'r1', guid: 'g1', pubkey_ed25519: keyPair.pubkeyB64u, push_subscription: stored }] }), { status: 200 });
      if (url.includes('/records/r1')) {
        stored = JSON.parse(init.body).push_subscription;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      throw new Error('unexpected fetch: ' + url);
    };
    const env = await makeVapidEnv();
    await worker.fetch(await pushSubscribeSigned({ guid: 'g1', deviceId: 'pc-1', subscription: { endpoint: 'https://fake/pc-old' }, keyPair }), env);
    await worker.fetch(await pushSubscribeSigned({ guid: 'g1', deviceId: 'pc-1', subscription: { endpoint: 'https://fake/pc-new' }, keyPair }), env);

    const devices = JSON.parse(stored);
    assert.equal(devices.length, 1, '같은 deviceId는 추가가 아니라 교체여야 함');
    assert.equal(devices[0].subscription.endpoint, 'https://fake/pc-new');
  });
});
