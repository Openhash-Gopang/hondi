import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  isFcmSubscription, normalizeFcmSubscription, channelForTag,
  buildFcmMessage, sendFcm, parseServiceAccount, _resetFcmCacheForTest,
} from '../src/worker/fcm-push.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const SA = { client_email: 't@x.iam.gserviceaccount.com', private_key: pem, project_id: 'naviweb-app' };
const env = { FCM_SERVICE_ACCOUNT_JSON: JSON.stringify(SA) };
const TOKEN = 'a'.repeat(60);

function mockFetch(fcmStatus = 200) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('oauth2.googleapis.com')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'AT', expires_in: 3600 }) };
    }
    return { ok: fcmStatus >= 200 && fcmStatus < 300, status: fcmStatus, json: async () => ({}) };
  };
  fn.calls = calls;
  return fn;
}

describe('fcm-push', () => {
  beforeEach(() => _resetFcmCacheForTest());

  it('구독 검증/정규화', () => {
    assert.equal(isFcmSubscription({ kind: 'fcm', token: TOKEN }), true);
    assert.equal(isFcmSubscription({ endpoint: 'https://x' }), false);
    assert.deepEqual(normalizeFcmSubscription({ kind: 'fcm', token: ` ${TOKEN} `, extra: 1 }), { kind: 'fcm', token: TOKEN });
    assert.equal(normalizeFcmSubscription({ kind: 'fcm', token: 'short' }), null);
    assert.equal(normalizeFcmSubscription({ kind: 'fcm', token: 'a'.repeat(30) + ' ' + 'b'.repeat(30) }), null);
    assert.equal(normalizeFcmSubscription({ kind: 'fcm', token: 'a'.repeat(5000) }), null);
  });

  it('채널 매핑', () => {
    assert.equal(channelForTag('gopang-device-link-s1-0'), 'calls');
    assert.equal(channelForTag('p2p-invite-abc'), 'calls');
    assert.equal(channelForTag('gopang-call-abc12345'), 'calls');
    assert.equal(channelForTag('gopang-version-update'), 'system');
    assert.equal(channelForTag('referral-reward'), 'messages');
    assert.equal(channelForTag(undefined), 'messages');
  });

  it('메시지: data 값은 전부 문자열, high 우선순위', () => {
    const m = buildFcmMessage(TOKEN, JSON.stringify({ title: 'T', body: 'B', tag: 'p2p-invite-1', url: '/u', sound: 'ping' }), 'high').message;
    assert.equal(m.token, TOKEN);
    assert.equal(m.android.priority, 'HIGH');
    assert.equal(m.android.ttl, '3600s');
    for (const v of Object.values(m.data)) assert.equal(typeof v, 'string');
    assert.equal(m.data.channel, 'calls');
    assert.equal(m.data.url, '/u');
    assert.equal(buildFcmMessage(TOKEN, '{}', 'normal').message.android.priority, 'NORMAL');
  });

  it('발송 성공: OAuth 1회 후 토큰 캐시 재사용', async () => {
    const f = mockFetch(200);
    const r1 = await sendFcm(env, { kind: 'fcm', token: TOKEN }, '{"title":"a"}', 'high', { fetchImpl: f });
    const r2 = await sendFcm(env, { kind: 'fcm', token: TOKEN }, '{"title":"b"}', 'high', { fetchImpl: f });
    assert.deepEqual(r1, { ok: true, status: 200 });
    assert.deepEqual(r2, { ok: true, status: 200 });
    assert.equal(f.calls.filter(c => c.url.includes('oauth2')).length, 1);
    const send = f.calls.find(c => c.url.includes('fcm.googleapis.com'));
    assert.match(send.url, /projects\/naviweb-app\/messages:send$/);
    assert.equal(send.init.headers.Authorization, 'Bearer AT');
  });

  it('404는 status 그대로 반환(호출부가 죽은 토큰 정리)', async () => {
    const r = await sendFcm(env, { kind: 'fcm', token: TOKEN }, '{}', 'normal', { fetchImpl: mockFetch(404) });
    assert.deepEqual(r, { ok: false, status: 404 });
  });

  it('키 미설정/형식 오류는 throw 없이 실패 반환', async () => {
    assert.equal(parseServiceAccount({}), null);
    assert.equal(parseServiceAccount({ FCM_SERVICE_ACCOUNT_JSON: '{bad' }), null);
    const r = await sendFcm({}, { kind: 'fcm', token: TOKEN }, '{}', 'normal', { fetchImpl: mockFetch() });
    assert.deepEqual(r, { ok: false, status: 0 });
  });

  it('네트워크 예외도 throw 하지 않는다', async () => {
    const f = async () => { throw new Error('boom'); };
    const r = await sendFcm(env, { kind: 'fcm', token: TOKEN }, '{}', 'normal', { fetchImpl: f });
    assert.deepEqual(r, { ok: false, status: 0 });
  });
});
