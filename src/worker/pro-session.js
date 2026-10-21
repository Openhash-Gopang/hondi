// 전문가 세션 토큰 (2026-10-21) — 면허 인증이 승인된 계정에 발급하는 짧은 수명의 HMAC 서명 토큰.
//   토큰 = base64url(JSON{pk, personas, iat, exp}) + '.' + base64url(HMAC-SHA256(secret, 앞부분))
// 서버 게이트(pro-gate.js)가 전문가용 SP 호출에서 이 토큰을 확인한다. 철회·만료는 토큰 수명(4시간) 안에 반영된다.
export const SESSION_TTL_MS = 4 * 60 * 60 * 1000;   // 4시간 — 짧으면 지갑 서명(생체인증) 창이 자주 뜬다. 철회·만료는 토큰 만료 시점에 반영된다.
const enc = new TextEncoder();
const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const key = secret => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

export async function issueSession(secret, { pk, personas }, now = Date.now(), ttl = SESSION_TTL_MS) {
  if (!secret || String(secret).length < 16) throw new Error('PRO_SESSION_SECRET 은 16자 이상이어야 합니다');
  const payload = b64u(enc.encode(JSON.stringify({ pk, personas, iat: now, exp: now + ttl })));
  const sig = b64u(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(payload)));
  return { token: `${payload}.${sig}`, exp: now + ttl };
}

// 유효하면 { pk, personas, exp }, 아니면 null (형식 오류·서명 불일치·만료 모두 null).
export async function verifySession(secret, token, now = Date.now()) {
  try {
    if (!secret || typeof token !== 'string' || token.length > 4000) return null;
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    if (!(await crypto.subtle.verify('HMAC', await key(secret), unb64u(sig), enc.encode(payload)))) return null;
    const p = JSON.parse(new TextDecoder().decode(unb64u(payload)));
    if (!(p.exp > now) || !Array.isArray(p.personas)) return null;
    return { pk: p.pk, personas: p.personas, exp: p.exp };
  } catch { return null; }
}
