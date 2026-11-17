import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// push.js 는 브라우저 전역(location/history/sessionStorage/localStorage/window)을 쓴다 — 최소 스텁으로 검증.
const store = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }; };
const TOKEN = 'T'.repeat(40);

function setEnv(url) {
  globalThis.sessionStorage = store();
  globalThis.localStorage = store();
  globalThis.location = { href: url };
  globalThis.history = { state: null, replaceState(_s, _t, u) { globalThis.location.href = new URL(u, globalThis.location.href).href; } };
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Android Mobile' }, configurable: true });
  globalThis.window = globalThis;
}

setEnv('https://naviweb.kr/webapp.html?pwa=1');
const mod = await import('../src/gopang/services/push.js');

describe('push.js — 앱 FCM 토큰', () => {
  beforeEach(() => setEnv('https://naviweb.kr/webapp.html?pwa=1'));

  it('?fcm= 토큰을 세션에 저장하고 주소에서 지운다(다른 파라미터 유지)', () => {
    globalThis.location.href = `https://naviweb.kr/webapp.html?pwa=1&fcm=${TOKEN}#x`;
    mod.captureAppFcmToken();
    assert.equal(mod.getAppFcmToken(), TOKEN);
    assert.equal(globalThis.location.href, 'https://naviweb.kr/webapp.html?pwa=1#x');
    assert.equal(globalThis.localStorage.getItem('navi_fcm_token'), null); // 영구 저장 금지
  });

  it('잘못된 토큰은 저장하지 않지만 주소에서는 지운다', () => {
    globalThis.location.href = 'https://naviweb.kr/webapp.html?fcm=short';
    mod.captureAppFcmToken();
    assert.equal(mod.getAppFcmToken(), null);
    assert.equal(globalThis.location.href, 'https://naviweb.kr/webapp.html');
  });

  it('fcm 파라미터가 없으면 아무것도 바꾸지 않는다', () => {
    mod.captureAppFcmToken();
    assert.equal(mod.getAppFcmToken(), null);
    assert.equal(globalThis.location.href, 'https://naviweb.kr/webapp.html?pwa=1');
  });

  it('앱 토큰이 있으면 웹 푸시 대신 FCM으로 서명 등록한다(기기 ID에 :app)', async () => {
    globalThis.sessionStorage.setItem('navi_fcm_token', TOKEN);
    globalThis.localStorage.setItem('gopang_device_id', 'dev-1');
    let signed = null, sent = null;
    globalThis.GopangWallet = { load: async () => ({ publicKeyB64u: 'PUB', signPayload: async (m) => { signed = m; return 'SIG'; } }) };
    globalThis.fetch = async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return { ok: true, json: async () => ({ ok: true }) }; };
    const r = await mod.requestPushSubscription('guid-1');
    assert.deepEqual(r, { ok: true });
    assert.match(signed, /^push-subscribe:guid-1:dev-1:app:sub:\d+$/);
    assert.match(sent.url, /\/push\/subscribe$/);
    assert.deepEqual(sent.body.subscription, { kind: 'fcm', token: TOKEN });
    assert.equal(sent.body.deviceId, 'dev-1:app');
    assert.equal(sent.body.deviceType, 'mobile');
    assert.equal(sent.body.signature, 'SIG');
  });

  it('지갑이 준비되지 않으면 서버를 부르지 않는다', async () => {
    globalThis.sessionStorage.setItem('navi_fcm_token', TOKEN);
    globalThis.GopangWallet = { load: async () => null };
    let called = false;
    globalThis.fetch = async () => { called = true; return { ok: true, json: async () => ({}) }; };
    const r = await mod.requestPushSubscription('guid-1');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'wallet_not_ready');
    assert.equal(called, false);
  });
});
