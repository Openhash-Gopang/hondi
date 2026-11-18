// fcm-push.js — 나비웹 안드로이드 앱용 FCM(HTTP v1) 발송 (2026-11-17 신설)
//
// 배경: 앱(TWA + 소규모 네이티브)은 웹 푸시 대신 FCM 토큰을 서버에 등록한다.
// 기기 목록(profiles.push_subscription)의 항목은 그대로 { deviceId, subscription, ... }
// 모양을 유지하고, subscription 자리에 { kind:'fcm', token } 을 넣는다 — 그러면
// 기존 발송 지점(_sendWebPush를 부르는 모든 곳)이 코드 변경 없이 FCM 기기도 처리한다.
// 반환값은 _sendWebPush와 같은 { ok, status } 모양이다(404/410 → 호출부가 죽은 토큰 정리).
//
// 비밀값: env.FCM_SERVICE_ACCOUNT_JSON (Firebase 서비스 계정 키 JSON 전체, Worker Secret).
// 키 내용은 로그·응답에 절대 남기지 않는다.

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_TOKEN_MIN = 20;
const FCM_TOKEN_MAX = 4096;

export function isFcmSubscription(sub) {
  return !!sub && sub.kind === 'fcm' && typeof sub.token === 'string';
}

// 등록 요청의 subscription 검증 — 통과하면 정규화된 객체, 아니면 null.
export function normalizeFcmSubscription(sub) {
  if (!isFcmSubscription(sub)) return null;
  const token = sub.token.trim();
  if (token.length < FCM_TOKEN_MIN || token.length > FCM_TOKEN_MAX) return null;
  if (/\s/.test(token)) return null;
  return { kind: 'fcm', token };
}

// 알림 채널 선택 — 앱의 알림 채널 id(calls / messages / system)와 맞춘다.
export function channelForTag(tag) {
  const t = String(tag || '');
  if (t.startsWith('gopang-device-link-') || t.startsWith('p2p-invite-') || t.startsWith('gopang-call-')) return 'calls';   // 대화 호출(gopang-call-)도 소리·진동이 강한 calls 채널로
  if (t === 'gopang-version-update') return 'system';
  return 'messages';
}

function b64u(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64uStr(str) { return b64u(new TextEncoder().encode(str)); }

function pemToPkcs8(pem) {
  const body = String(pem).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function parseServiceAccount(env) {
  const raw = env && env.FCM_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const sa = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!sa.client_email || !sa.private_key || !sa.project_id) return null;
    return sa;
  } catch (e) { return null; }
}

let _cache = { token: null, exp: 0, key: '' };

async function getAccessToken(sa, fetchImpl, now) {
  const cacheKey = sa.client_email + ':' + sa.project_id;
  if (_cache.token && _cache.key === cacheKey && _cache.exp - 60 > now) return _cache.token;

  const iat = Math.floor(now / 1000);
  const header = b64uStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64uStr(JSON.stringify({
    iss: sa.client_email, scope: FCM_SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600,
  }));
  const input = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    'pkcs8', pemToPkcs8(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input)));
  const jwt = `${input}.${b64u(sig)}`;

  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(jwt)}`,
  });
  if (!res.ok) throw new Error('FCM_OAUTH_' + res.status);
  const j = await res.json();
  if (!j.access_token) throw new Error('FCM_OAUTH_NO_TOKEN');
  _cache = { token: j.access_token, exp: now + (Number(j.expires_in) || 3600) * 1000, key: cacheKey };
  return j.access_token;
}

// FCM data 메시지 본문 생성 (data 값은 전부 문자열이어야 한다).
export function buildFcmMessage(token, payloadStr, urgency) {
  let p = {};
  try { p = JSON.parse(payloadStr) || {}; } catch (e) { p = { body: String(payloadStr || '') }; }
  const data = {
    title: String(p.title || '나비웹'),
    body: String(p.body || ''),
    tag: String(p.tag || ''),
    url: String(p.url || '/webapp.html'),
    sound: String(p.sound || ''),
    channel: channelForTag(p.tag),
  };
  return {
    message: {
      token,
      data,                                   // 데이터 전용 — 앱의 수신 서비스가 채널을 골라 알림을 그린다
      android: {
        priority: urgency === 'high' ? 'HIGH' : 'NORMAL',
        ttl: '3600s',
      },
    },
  };
}

// _sendWebPush와 같은 계약: { ok, status }. 절대 throw 하지 않는다.
export async function sendFcm(env, subscription, payloadStr, urgency = 'normal', opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const now = opts.now || Date.now();
  const sa = parseServiceAccount(env);
  if (!sa) {
    console.warn('[FCM] FCM_SERVICE_ACCOUNT_JSON 미설정/형식 오류 — 발송 건너뜀');
    return { ok: false, status: 0 };
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5000);
  try {
    const at = await getAccessToken(sa, fetchImpl, now);
    const res = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${at}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildFcmMessage(subscription.token, payloadStr, urgency)),
      signal: ac.signal,
    });
    if (!res.ok) {
      // 404 = UNREGISTERED(토큰 소멸) → 호출부가 정리. 토큰 자체는 로그에 남기지 않는다.
      console.warn('[FCM] 발송 실패:', res.status);
      if (res.status === 401) _cache = { token: null, exp: 0, key: '' };
    }
    return { ok: res.ok, status: res.status };
  } catch (e) {
    console.warn('[FCM] 발송 실패(타임아웃/네트워크/인증):', e && e.message);
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

export function _resetFcmCacheForTest() { _cache = { token: null, exp: 0, key: '' }; }
