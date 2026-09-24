/**
 * hondi-digit-claim.js — 혼디 숫자 번호 "서명된 청구 레코드" (Signed Claim Record)
 *
 * 목적: 번호 소유권을 서버의 장부가 아니라 "소유자 서명이 든 레코드 체인"으로 남긴다.
 *  · 단기: L1 PocketBase가 최초 순서(누가 먼저 청구했나)만 정하는 순서 결정자.
 *  · 장기: 같은 레코드를 Openhash L1~L5 원장에 그대로 재생(replay) → 번호를 다시 발급하지 않는다.
 *  누구나 이 파일의 verifyChain()으로 "번호 → 소유자 공개키"를 서버 신뢰 없이 검증할 수 있다.
 *
 * 레코드(번호 하나당 하나의 체인, seq 0부터):
 *   { v, ns, type, serial, seq, prev, owner, to?, ts }  + sig(현재 소유자의 Ed25519 서명)
 *   hash = SHA-256( 정규화문자열 + "." + sig )       ← 다음 레코드의 prev
 *   type: 'claim'(seq 0 전용) | 'transfer'(to=새 소유자) | 'revoke'(영구 폐기 — 재사용 금지)
 *
 * 키/서명 형식은 gopang-wallet.js와 동일: Ed25519 raw 공개키 Base64URL, 서명 Base64URL(UTF-8 메시지).
 * WebCrypto(Ed25519)만 쓰므로 브라우저·Cloudflare Worker·Node 22에서 그대로 동작한다.
 */

import { isValidSerial, normalizeSerial } from './hondi-digit-core.js';

export const CLAIM_VERSION = 1;
export const CLAIM_NS = 'hondi.net/digit';          // 도메인 분리 — 다른 용도의 서명과 섞이지 않게
export const GENESIS_PREV = '0'.repeat(64);
export const TYPES = ['claim', 'transfer', 'revoke'];

// ── 바이트/인코딩 ─────────────────────────────────────────────
const enc = new TextEncoder();
function b64uToBytes(s) {
  const b = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64u(buf) {
  const u = new Uint8Array(buf); let s = '';
  for (const c of u) s += String.fromCharCode(c);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256Hex(str) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(str)));
  return [...h].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** 서명 대상 정규화 문자열 — 필드 순서·형식을 고정한다(JSON 순서 의존 금지). */
export function canonical(r) {
  return [
    `v=${r.v}`, `ns=${r.ns}`, `type=${r.type}`, `serial=${r.serial}`, `seq=${r.seq}`,
    `prev=${r.prev}`, `owner=${r.owner}`, `to=${r.to ?? ''}`, `ts=${r.ts}`,
  ].join('\n');
}
export async function recordHash(rec) { return sha256Hex(canonical(rec) + '.' + rec.sig); }

// ── 서명/검증 ─────────────────────────────────────────────────
async function importPub(pubB64u) {
  return crypto.subtle.importKey('raw', b64uToBytes(pubB64u), { name: 'Ed25519' }, false, ['verify']);
}
export async function verifySig(pubB64u, message, sigB64u) {
  try {
    return await crypto.subtle.verify('Ed25519', await importPub(pubB64u), b64uToBytes(sigB64u), enc.encode(message));
  } catch { return false; }
}

/**
 * 레코드 생성 + 서명.
 * @param {{sign:(msg:string)=>Promise<string>, publicKeyB64u:string}} signer  gopangWallet 호환
 * @param {object} p {type, serial, seq, prev, to?, ts?}
 */
export async function makeRecord(signer, { type, serial, seq, prev, to = null, ts = Date.now() }) {
  const rec = {
    v: CLAIM_VERSION, ns: CLAIM_NS, type, serial: normalizeSerial(serial), seq, prev,
    owner: signer.publicKeyB64u, to, ts,
  };
  rec.sig = await signer.sign(canonical(rec));
  rec.hash = await recordHash(rec);
  return rec;
}
export const makeClaim    = (signer, serial, ts)            => makeRecord(signer, { type: 'claim', serial, seq: 0, prev: GENESIS_PREV, ts });
export const makeTransfer = (signer, head, toPubB64u, ts)   => makeRecord(signer, { type: 'transfer', serial: head.serial, seq: head.seq + 1, prev: head.hash, to: toPubB64u, ts });
export const makeRevoke   = (signer, head, ts)              => makeRecord(signer, { type: 'revoke', serial: head.serial, seq: head.seq + 1, prev: head.hash, ts });

// ── 상태 전이 (서버/클라/원장 어디서든 똑같이 적용) ────────────────
/**
 * state: null(청구 이력 없음) 또는 {serial, owner, seq, hash, revoked, ts}
 * 반환: {ok:true, state} | {ok:false, code, message}
 */
export async function applyRecord(state, rec, { maxSkewMs = 10 * 60 * 1000, now = Date.now() } = {}) {
  const bad = (code, message) => ({ ok: false, code, message });
  if (!rec || typeof rec !== 'object') return bad('MALFORMED', '레코드가 객체가 아닙니다.');
  if (rec.v !== CLAIM_VERSION || rec.ns !== CLAIM_NS) return bad('VERSION', '지원하지 않는 버전/네임스페이스입니다.');
  if (!TYPES.includes(rec.type)) return bad('TYPE', '알 수 없는 레코드 종류입니다.');
  if (!isValidSerial(rec.serial)) return bad('SERIAL', '번호는 1~10자리, 첫 자리 1~9여야 합니다.');
  if (!Number.isInteger(rec.seq) || rec.seq < 0) return bad('SEQ', 'seq가 올바르지 않습니다.');
  if (typeof rec.owner !== 'string' || typeof rec.sig !== 'string') return bad('MALFORMED', 'owner/sig 누락');
  if (!Number.isFinite(rec.ts)) return bad('TS', 'ts가 올바르지 않습니다.');

  if (!(await verifySig(rec.owner, canonical(rec), rec.sig))) return bad('BAD_SIG', '서명이 유효하지 않습니다.');
  if ((await recordHash(rec)) !== rec.hash) return bad('BAD_HASH', 'hash가 내용과 일치하지 않습니다.');

  if (rec.type === 'claim') {
    if (state) return bad('ALREADY_CLAIMED', state.revoked ? '폐기된 번호는 다시 청구할 수 없습니다.' : '이미 청구된 번호입니다.');
    if (rec.seq !== 0 || rec.prev !== GENESIS_PREV) return bad('SEQ', '최초 청구는 seq=0, prev=0…0이어야 합니다.');
    if (Math.abs(now - rec.ts) > maxSkewMs) return bad('TS_SKEW', '시각이 서버 시각과 너무 다릅니다.');
    return { ok: true, state: { serial: rec.serial, owner: rec.owner, seq: 0, hash: rec.hash, revoked: false, ts: rec.ts } };
  }

  if (!state) return bad('NOT_CLAIMED', '청구되지 않은 번호입니다.');
  if (state.serial !== rec.serial) return bad('SERIAL', '번호가 다릅니다.');
  if (state.revoked) return bad('REVOKED', '폐기된 번호입니다.');
  if (rec.seq !== state.seq + 1) return bad('SEQ', `seq는 ${state.seq + 1}여야 합니다.`);
  if (rec.prev !== state.hash) return bad('PREV', 'prev가 현재 head와 일치하지 않습니다(분기/재전송).');
  if (rec.owner !== state.owner) return bad('NOT_OWNER', '현재 소유자의 서명이 아닙니다.');
  if (rec.ts < state.ts) return bad('TS', 'ts가 이전 레코드보다 앞섭니다.');

  if (rec.type === 'transfer') {
    if (!rec.to || rec.to === rec.owner) return bad('TO', '새 소유자 공개키가 올바르지 않습니다.');
    try { await importPub(rec.to); } catch { return bad('TO', '새 소유자 공개키 형식이 올바르지 않습니다.'); }
    return { ok: true, state: { ...state, owner: rec.to, seq: rec.seq, hash: rec.hash, ts: rec.ts } };
  }
  // revoke — 영구 폐기(번호 재사용 금지)
  return { ok: true, state: { ...state, revoked: true, seq: rec.seq, hash: rec.hash, ts: rec.ts } };
}

/** 체인 전체를 처음부터 재생해 검증. 누구나(서버 없이) 소유자를 확인하는 함수. */
export async function verifyChain(records, opts = {}) {
  let state = null;
  for (let i = 0; i < records.length; i++) {
    // 과거 레코드의 ts-skew는 재생 시 의미가 없으므로 끈다
    const r = await applyRecord(state, records[i], { ...opts, maxSkewMs: Infinity });
    if (!r.ok) return { ok: false, index: i, code: r.code, message: r.message };
    state = r.state;
  }
  return { ok: true, state };
}

// ── 번호 정책 (체인 유효성과 분리 — 정책은 바뀔 수 있고 서명은 바뀌지 않는다) ──
// 공공 안내·긴급 번호: 경매/청구 대상에서 영구 제외(해당 기관에 위임). 목록은 검토 필요.
export const PUBLIC_SAFETY_SERIALS = new Set(['112', '119', '110', '120', '182', '1330', '1388', '1366', '129', '117', '114', '131', '132']);

const isRepeat = s => /^(\d)\1+$/.test(s);
const isRun = s => s.length >= 3 && ([...s].every((c, i) => i === 0 || +c === +s[i-1] + 1) || [...s].every((c, i) => i === 0 || +c === +s[i-1] - 1));
const isPalin = s => s.length >= 3 && s === [...s].reverse().join('');
const trailingZeros = s => s.length >= 4 && /^[1-9]0+$/.test(s);

/**
 * @param {string} serial
 * @param {{premiumList?: Set<string>}} cfg  premiumList = 한국어 발음 번호 등 운영자가 정하는 목록
 * @returns {{tier:'open'|'reserved-short'|'reserved-premium'|'public-safety', reasons:string[]}}
 */
export function classifySerial(serial, cfg = {}) {
  const s = normalizeSerial(serial);
  if (PUBLIC_SAFETY_SERIALS.has(s)) return { tier: 'public-safety', reasons: ['공공 안내·긴급 번호'] };
  if (s.length < 5) return { tier: 'reserved-short', reasons: ['5자리 미만'] };
  const reasons = [];
  if (isRepeat(s)) reasons.push('같은 숫자 반복');
  if (isRun(s)) reasons.push('연속 수열');
  if (isPalin(s)) reasons.push('회문');
  if (trailingZeros(s)) reasons.push('뒤가 모두 0');
  if (cfg.premiumList?.has(s)) reasons.push('지정 프리미엄 번호');
  return reasons.length ? { tier: 'reserved-premium', reasons } : { tier: 'open', reasons: [] };
}

/**
 * 청구 정책 검사. open 번호는 누구나 청구 가능. reserved-*는 운영 권한이 서명한 grant가 있어야 한다.
 * grant = { serial, owner, sig }  — sig는 authorityPubKey가 `hondi-digit-grant\n{serial}\n{owner}`에 한 서명.
 */
export async function checkClaimPolicy(rec, { grant = null, authorityPubKey = null, premiumList } = {}) {
  const c = classifySerial(rec.serial, { premiumList });
  if (c.tier === 'open') return { ok: true, tier: c.tier };
  if (c.tier === 'public-safety') return { ok: false, tier: c.tier, code: 'PUBLIC_SAFETY', message: '공공 안내·긴급 번호는 청구할 수 없습니다.' };
  if (!grant || !authorityPubKey || grant.serial !== rec.serial || grant.owner !== rec.owner) {
    return { ok: false, tier: c.tier, code: 'RESERVED', message: `예약 번호(${c.reasons.join(', ')})입니다. 경매/지정을 통해서만 청구할 수 있습니다.` };
  }
  const ok = await verifySig(authorityPubKey, `hondi-digit-grant\n${grant.serial}\n${grant.owner}`, grant.sig);
  return ok ? { ok: true, tier: c.tier } : { ok: false, tier: c.tier, code: 'BAD_GRANT', message: '예약 번호 권한 서명이 유효하지 않습니다.' };
}
