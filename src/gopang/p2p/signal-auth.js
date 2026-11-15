/**
 * p2p/signal-auth.js — 대화 신호를 서버(/signal/*)에 보낼 때 붙이는 로그인 증명 (2026-10-28, 대화 신호 위조 방지)
 *
 * 증명 두 가지(서버가 확인해서 from_guid 를 그 계정으로 강제한다):
 *  ① 공유 로그인 쿠키 hondi_pvt (전화 인증·테스트 아이디 토큰) — 있으면 이것을 쓴다.
 *  ② 쿠키가 없거나 이 앱의 계정과 다르면, 지갑 서명으로 /auth/issue 에서 svc='p2p-signal' 토큰을 받아 쓴다(55분 캐시).
 * 어느 쪽도 없으면 증명 없이 보내 보지만 서버가 거부한다 — 그때는 호출부가 오류를 받는다.
 */
import { PROXY } from '../core/state.js';

const S = { skipCookie: false, tok: '', exp: 0, guid: '', why: '' };

function readCookie(name) {
  try { const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : ''; } catch { return ''; }
}
function cookieAuth() {
  if (S.skipCookie) return null;
  const t = readCookie('hondi_pvt'), e = Number(readCookie('hondi_pvt_exp') || 0);
  return t && (!e || Date.now() < e - 30000) ? { phone_verify_token: t } : null;
}
async function walletAuth(guid) {
  if (S.tok && S.guid === guid && S.exp > Date.now() + 60000) return { gopang_token: S.tok };
  const w = (typeof window !== 'undefined') ? window.gopangWallet : null;
  if (!w || !w.publicKeyB64u || typeof w.signPayload !== 'function' || !guid) {
    S.why = !guid ? 'no-guid' : !w ? (window.gopangWalletLocked ? 'wallet-locked' : window.gopangWalletNeedsSetup ? 'wallet-needs-setup' : 'no-wallet') : !w.publicKeyB64u ? 'no-pubkey' : 'no-sign';
    return null;
  }
  try {
    const ts = Date.now();
    const signature = await w.signPayload(`auth-issue:${guid}:${w.publicKeyB64u}:p2p-signal:${ts}`);
    const r = await fetch(`${PROXY}/auth/issue`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guid, pubkey: w.publicKeyB64u, signature, ts, level: 'L0', svc: 'p2p-signal' }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.token) { S.why = 'issue-' + r.status + (d.error ? '-' + d.error : ''); return null; }
    S.tok = d.token; S.exp = Date.now() + 55 * 60 * 1000; S.guid = guid;
    return { gopang_token: d.token };
  } catch (e) { S.why = 'issue-exc-' + (e && e.message || ''); return null; }
}

/** 지금 로그인한 계정 guid — 메모리의 _USER 가 비어 있어도(모듈 사본이 갈리거나 초기화 순서 때문에) 이 기기에 저장된 계정에서 읽는다. */
export function currentGuid(u) {
  const direct = (u && (u.ipv6 || u.guid)) || '';
  if (direct) return direct;
  try {
    const raw = localStorage.getItem('gopang_user_v4') || sessionStorage.getItem('gopang_user_v4');
    const o = raw ? JSON.parse(raw) : null;
    if (o && (o.ipv6 || o.guid) && !o.isGuest && !o.isTemp) return o.ipv6 || o.guid;
  } catch {}
  try { const w = window.gopangWallet; if (w && w.guid) return w.guid; } catch {}
  return '';
}

/** 서버 /signal/* 호출. 로그인 증명을 붙이고, 쿠키 계정이 다르거나 만료면 지갑 증명으로 한 번 더 시도한다. */
export async function signalPost(path, guid, body) {
  guid = currentGuid({ guid });
  const send = async (auth) => {
    const r = await fetch(`${PROXY}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(body || {}), ...(auth || {}) }) });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, code: data.error || data.code || '', data, authKind: auth ? (auth.phone_verify_token ? 'cookie' : 'wallet') : 'none:' + S.why };
  };
  let auth = cookieAuth() || await walletAuth(guid);
  let res = await send(auth);
  if (!res.ok && (res.status === 401 || res.status === 403)) {
    if (auth && auth.phone_verify_token) { S.skipCookie = true; auth = await walletAuth(guid); }     // 쿠키가 다른 계정/만료 → 지갑 증명
    else if (auth && auth.gopang_token) { S.tok = ''; auth = await walletAuth(guid); }               // 토큰 만료 → 다시 발급
    if (auth) res = await send(auth);
  }
  return res;
}
