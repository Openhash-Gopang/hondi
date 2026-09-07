/**
 * phase31_protective_settings_regression.test.mjs
 *
 * 2026-09-07 사용자 지시 — 가입 이후 지문을 광범위한 디폴트로 적용하되,
 * 사용자가 "완화"(보호를 약하게 하는 방향)를 선택할 수 있게 열어준다.
 * 다만 완화 자체를 무심코/공격당해서 되돌릴 수 없게, 완화는 반드시
 *   ① 그 순간의 지문(step-up) 확인
 *   ② 24시간 유예(즉시 반영 안 됨)
 *   ③ 다른 기기로 사전 알림(_sendPushToGuid, best-effort)
 * 을 거치게 했다. "강화"(보호를 높이는 방향)는 서명만으로 즉시 반영.
 *
 * 이 파일은 그 공용 모듈(PROTECTIVE_SETTINGS, handleProtectiveSettingGet/
 * Set/CancelPending)과, 그걸 실제로 소비하는 handleDeviceLinkVerify의
 * 조건부 분기를 검증한다. handleBizOrder의 문턱값 게이트는 카탈로그·L1
 * tx 목업까지 필요해 이 파일 범위 밖 — 별도 통합 테스트로 남긴다.
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

// push 발송(_sendPushToGuid)이 실제로 시도됐는지만 관찰 — 내용 검증은
// 안 하고, 완화 시 알림 경로가 안 죽는지(에러로 요청 전체가 실패하지
// 않는지)만 확인한다. push_subscription이 없으면 함수 자체가 조용히
// 아무 것도 안 하므로, VAPID 키도 안 넣어 best-effort 무해함을 그대로
// 검증한다.
function installMockFetch() {
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.pathname === '/api/admins/auth-with-password') {
      return new Response(JSON.stringify({ token: 'mock-admin-token' }), { status: 200 });
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
async function genEd25519() {
  const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const rawPub = await crypto.subtle.exportKey('raw', kp.publicKey);
  return { privateKey: kp.privateKey, pubkeyB64u: toB64u(rawPub) };
}
async function sign(privateKey, message) {
  const sig = await crypto.subtle.sign('Ed25519', privateKey, new TextEncoder().encode(message));
  return toB64u(sig);
}

let worker;
const ENV = {
  L1_ADMIN_EMAIL: 'admin@test', L1_ADMIN_PASSWORD: 'pw',
  PHONE_VERIFY_SECRET: 'test-secret-key',
  QR_SESSIONS_KV: { get: async () => null, put: async () => {}, delete: async () => {} },
  DEVICE_LINK_SESSIONS: makeDeviceLinkSessionsStub(),
};

before(async () => {
  installMockFetch();
  worker = (await import('../../../worker.js')).default;
});

beforeEach(() => { resetDb(); dlStore.clear(); });

function req(pathname, method, body) {
  const init = { method, headers: { 'Origin': 'http://localhost' } };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return new Request(`https://hondi-proxy.example${pathname}`, init);
}
async function call(pathname, method, body) {
  const res = await worker.fetch(req(pathname, method, body), ENV, {});
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function seedProfile(overrides = {}) {
  const rec = { id: `mock_p_${++idSeq}`, extra: {}, ...overrides };
  db.profiles.push(rec);
  return rec;
}

async function makeStepUpToken(guid, txHash, privateKey) {
  const exp = Date.now() + 2 * 60 * 1000;
  const payload = JSON.stringify([guid, txHash, exp]);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('test-secret-key'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const sig = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
  return payload + '.' + sig;
}

// ══════════════════════════════════════════════════════════════════
// P31-1: 강화(보호 강도 높이기)는 즉시 반영, 지문 불필요
// ══════════════════════════════════════════════════════════════════

describe('P31-1: 보호 설정 강화 — 즉시 반영, 지문 불필요', () => {
  it('biz_step_up_threshold를 낮추면(강화) 서명만으로 즉시 적용된다', async () => {
    const keys = await genEd25519();
    const guid = 'guid-tighten-1';
    seedProfile({ guid, pubkey_ed25519: keys.pubkeyB64u, extra: { biz_step_up_threshold: { value: 10000, pending: null } } });

    const ts = Date.now();
    const value = 5000; // 1만원 -> 5천원, 더 낮춤 = 강화
    const sigMsg = `protective-setting-set:${guid}:biz_step_up_threshold:${JSON.stringify(value)}:${ts}`;
    const signature = await sign(keys.privateKey, sigMsg);

    const { status, json } = await call('/account/protective-setting/set', 'POST', {
      guid, key: 'biz_step_up_threshold', value, pubkey: keys.pubkeyB64u, signature, ts,
    });
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.applied, 'immediate');
    assert.equal(json.value, 5000);
    assert.equal(json.pending, null);
  });

  it('device_link_biometric_required를 true로 되돌리면(강화) 즉시 반영된다', async () => {
    const keys = await genEd25519();
    const guid = 'guid-tighten-2';
    seedProfile({ guid, pubkey_ed25519: keys.pubkeyB64u, extra: { device_link_biometric_required: { value: false, pending: null } } });

    const ts = Date.now();
    const sigMsg = `protective-setting-set:${guid}:device_link_biometric_required:${JSON.stringify(true)}:${ts}`;
    const signature = await sign(keys.privateKey, sigMsg);
    const { status, json } = await call('/account/protective-setting/set', 'POST', {
      guid, key: 'device_link_biometric_required', value: true, pubkey: keys.pubkeyB64u, signature, ts,
    });
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.applied, 'immediate');
    assert.equal(json.value, true);
  });
});

// ══════════════════════════════════════════════════════════════════
// P31-2: 완화는 지문 필수 + 24시간 유예
// ══════════════════════════════════════════════════════════════════

describe('P31-2: 보호 설정 완화 — 지문 없이는 거부, 있으면 24시간 유예 예약', () => {
  it('문턱값을 올리려 하면(완화) step_up_token 없이는 403', async () => {
    const keys = await genEd25519();
    const guid = 'guid-loosen-1';
    seedProfile({ guid, pubkey_ed25519: keys.pubkeyB64u, extra: {} }); // 기본값 1만원

    const ts = Date.now();
    const value = 50000;
    const sigMsg = `protective-setting-set:${guid}:biz_step_up_threshold:${JSON.stringify(value)}:${ts}`;
    const signature = await sign(keys.privateKey, sigMsg);

    const { status, json } = await call('/account/protective-setting/set', 'POST', {
      guid, key: 'biz_step_up_threshold', value, pubkey: keys.pubkeyB64u, signature, ts,
    });
    assert.equal(status, 403);
    assert.equal(json.error, 'BIOMETRIC_REQUIRED');

    // 실제로 값이 안 바뀌었는지도 확인
    const { json: getData } = await call(`/account/protective-setting?guid=${guid}&key=biz_step_up_threshold`, 'GET');
    assert.equal(getData.value, 10000);
  });

  it('유효한 step_up_token과 함께면 즉시 적용 대신 24시간 유예로 예약된다', async () => {
    const keys = await genEd25519();
    const guid = 'guid-loosen-2';
    seedProfile({ guid, pubkey_ed25519: keys.pubkeyB64u, extra: {} });

    const value = 50000;
    const stepUpToken = await makeStepUpToken(guid, 'protective-setting-loosen:biz_step_up_threshold', keys.privateKey);
    // makeStepUpToken은 HMAC(PHONE_VERIFY_SECRET)만 쓰므로 privateKey는 안 쓰지만
    // 시그니처 유지를 위해 인자로 남겨둠(실제로는 안 쓰임).

    const ts = Date.now();
    const sigMsg = `protective-setting-set:${guid}:biz_step_up_threshold:${JSON.stringify(value)}:${ts}`;
    const signature = await sign(keys.privateKey, sigMsg);

    const { status, json } = await call('/account/protective-setting/set', 'POST', {
      guid, key: 'biz_step_up_threshold', value, pubkey: keys.pubkeyB64u, signature, ts, step_up_token: stepUpToken,
    });
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.applied, 'pending_24h');
    assert.equal(json.value, 10000, '유예 기간 동안은 기존 값이 유지되어야 함');
    assert.ok(json.pending?.value === 50000);
    assert.ok(json.pending?.effective_at > Date.now());

    // 즉시 조회해도 아직 기존 값 그대로여야 함
    const { json: getData } = await call(`/account/protective-setting?guid=${guid}&key=biz_step_up_threshold`, 'GET');
    assert.equal(getData.value, 10000);
    assert.ok(getData.pending);
  });

  it('유예 기간이 지나면 조회 시점에 자동으로 승격된다', async () => {
    const guid = 'guid-loosen-3';
    // 이미 유예가 끝난(과거 시각) pending을 직접 심어서 승격 로직만 검증
    seedProfile({
      guid, pubkey_ed25519: 'x',
      extra: { biz_step_up_threshold: { value: 10000, pending: { value: 50000, effective_at: Date.now() - 1000 } } },
    });

    const { status, json } = await call(`/account/protective-setting?guid=${guid}&key=biz_step_up_threshold`, 'GET');
    assert.equal(status, 200);
    assert.equal(json.value, 50000, '유예 시각이 지났으면 완화된 값으로 승격돼야 함');
    assert.equal(json.pending, null);

    // 실제로 저장까지 됐는지(다음 조회에서 다시 안 물어봐도 그대로)
    const profile = db.profiles.find(p => p.guid === guid);
    assert.deepEqual(profile.extra.biz_step_up_threshold, { value: 50000, pending: null });
  });
});

// ══════════════════════════════════════════════════════════════════
// P31-3: 완화 예약 취소 — 지문 불필요(취소 자체는 강화 방향)
// ══════════════════════════════════════════════════════════════════

describe('P31-3: 완화 예약 취소', () => {
  it('서명만으로 즉시 취소되고 기존 값이 유지된다', async () => {
    const keys = await genEd25519();
    const guid = 'guid-cancel-1';
    seedProfile({
      guid, pubkey_ed25519: keys.pubkeyB64u,
      extra: { biz_step_up_threshold: { value: 10000, pending: { value: 50000, effective_at: Date.now() + 100000 } } },
    });

    const ts = Date.now();
    const sigMsg = `protective-setting-cancel-pending:${guid}:biz_step_up_threshold:${ts}`;
    const signature = await sign(keys.privateKey, sigMsg);
    const { status, json } = await call('/account/protective-setting/cancel-pending', 'POST', {
      guid, key: 'biz_step_up_threshold', pubkey: keys.pubkeyB64u, signature, ts,
    });
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.value, 10000);
    assert.equal(json.pending, null);
  });

  it('서명 없이는 취소할 수 없다(공격자가 남의 예약을 마음대로 못 없앰)', async () => {
    const guid = 'guid-cancel-2';
    seedProfile({
      guid, pubkey_ed25519: 'x',
      extra: { biz_step_up_threshold: { value: 10000, pending: { value: 50000, effective_at: Date.now() + 100000 } } },
    });
    const { status, json } = await call('/account/protective-setting/cancel-pending', 'POST', {
      guid, key: 'biz_step_up_threshold', ts: Date.now(),
    });
    assert.equal(status, 403);
    assert.equal(json.error, 'AUTH_REQUIRED');
  });
});

// ══════════════════════════════════════════════════════════════════
// P31-4: device-link 지문 필수 여부가 handleDeviceLinkVerify에 실제로 반영되는지
// ══════════════════════════════════════════════════════════════════

describe('P31-4: handleDeviceLinkVerify가 device_link_biometric_required를 존중한다', () => {
  it('기본값(true)이면 여전히 step_up_token 없이는 거부된다', async () => {
    const guid = 'guid-dl-default';
    seedProfile({ guid, pubkey_ed25519: 'x', extra: {} }); // 설정 안 함 = 기본값 true
    dlStore.set('sess-default', { guid, code: '111111', attempts: 0, state: 'pending', e164: '+821000000000' });

    const { status, json } = await call('/auth/device-link/verify', 'POST', { sessionId: 'sess-default', code: '111111' });
    assert.equal(status, 403);
    assert.equal(json.error, 'BIOMETRIC_REQUIRED');
  });

  it('완화가 승격돼 false가 된 계정은 step_up_token 없이도 승인된다', async () => {
    const guid = 'guid-dl-off';
    seedProfile({
      guid, pubkey_ed25519: 'x',
      extra: { device_link_biometric_required: { value: false, pending: null } },
    });
    dlStore.set('sess-off', { guid, code: '222222', attempts: 0, state: 'pending', e164: '+821000000000' });

    const { status, json } = await call('/auth/device-link/verify', 'POST', { sessionId: 'sess-off', code: '222222' });
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.ok, true);
  });

  it('꺼진 계정이라도 profile 조회 자체가 실패하면 안전한 쪽(필수)으로 처리된다', async () => {
    // 프로필이 아예 없는 guid — _l1FindProfileByGuid가 null 반환
    dlStore.set('sess-noprofile', { guid: 'guid-does-not-exist', code: '333333', attempts: 0, state: 'pending', e164: '+821000000000' });
    const { status, json } = await call('/auth/device-link/verify', 'POST', { sessionId: 'sess-noprofile', code: '333333' });
    assert.equal(status, 403);
    assert.equal(json.error, 'BIOMETRIC_REQUIRED', '프로필을 못 찾으면 안전한 기본값(필수)으로 처리돼야 함');
  });
});
