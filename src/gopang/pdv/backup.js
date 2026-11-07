/**
 * pdv/backup.js — PDV 방식 C(백업): 폰에서 암호화한 사본을 사용자가 지정한 저장소에 보관.
 *
 * 설계 (2026-11-07 결정): 방식 P(폰 원본)가 기본, 방식 C는 백업·복구용.
 *  - 백업은 폰에서 AES-256-GCM 으로 암호화한다. 저장소(클라우드)는 평문을 보지 못한다.
 *  - 데이터 키(DEK)는 무작위. 사용자가 정한 복구 문구(12자 이상)에서 PBKDF2 로 만든 키로 DEK 를
 *    감싸 "헤더"에 둔다. 문구를 바꿔도 본문을 다시 올릴 필요가 없다.
 *  - 복구 문구는 서버로 보내지도, 저장하지도 않는다.
 *  - 저장소는 어댑터 인터페이스 {put,get,list,remove}. 기본 대상은 Oracle 춘천(PAR URL 어댑터).
 * 순수 Web Crypto — 브라우저/Node 모두 동작.
 */

export const BACKUP_VERSION = 1;
export const KDF_ITERATIONS = 600000; // OWASP 2023 PBKDF2-HMAC-SHA256 권고
export const MIN_PHRASE_LEN = 12;

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;
const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

export const b64 = (u8) => {
  let s = ''; for (const b of u8) s += String.fromCharCode(b);
  return btoa(s);
};
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// ── 복구 문구 강도 검사 ────────────────────────────────────────────
const COMMON = ['123456789012', 'qwertyuiop12', 'password1234', 'abcdefghijkl', '000000000000', '111111111111', '비밀번호비밀번호비밀번호', '123412341234'];
export function normalizePhrase(p) { return String(p ?? '').normalize('NFC').trim(); }

/** @returns {{ok:boolean, reason?:string}} */
export function checkPhrase(phrase) {
  const p = normalizePhrase(phrase);
  const chars = [...p];
  if (chars.length < MIN_PHRASE_LEN) return { ok: false, reason: `복구 문구는 ${MIN_PHRASE_LEN}자 이상이어야 합니다.` };
  if (new Set(chars).size < 6) return { ok: false, reason: '서로 다른 글자가 6개 이상 들어가야 합니다.' };
  if (/^\d+$/.test(p)) return { ok: false, reason: '숫자만으로는 만들 수 없습니다.' };
  if (COMMON.includes(p.toLowerCase())) return { ok: false, reason: '너무 흔한 문구입니다.' };
  // 연속 증가/감소(abcd.., 1234..) 4자 이상이 문구의 대부분을 차지하면 거절
  let run = 1, best = 1;
  for (let i = 1; i < chars.length; i++) {
    const d = chars[i].codePointAt(0) - chars[i - 1].codePointAt(0);
    run = (d === 1 || d === -1) ? run + 1 : 1;
    best = Math.max(best, run);
  }
  if (best >= Math.ceil(chars.length * 0.7)) return { ok: false, reason: '연속된 글자로만 이루어진 문구는 쓸 수 없습니다.' };
  return { ok: true };
}

// ── 키 ─────────────────────────────────────────────────────────────
async function deriveWrapKey(phrase, salt, iterations) {
  const base = await subtle().importKey('raw', enc.encode(normalizePhrase(phrase)), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/**
 * 복구 설정: 무작위 DEK 를 만들고 복구 문구로 감싼다.
 * @returns {{dek: CryptoKey, rawDek: Uint8Array, header: object}} header 는 저장소에 평문 보관해도 안전.
 */
export async function setupRecovery(phrase, { iterations = KDF_ITERATIONS } = {}) {
  const chk = checkPhrase(phrase);
  if (!chk.ok) throw new Error(chk.reason);
  const rawDek = rand(32);
  const header = await wrapDek(rawDek, phrase, iterations);
  return { rawDek, dek: await importDek(rawDek), header };
}

export async function wrapDek(rawDek, phrase, iterations = KDF_ITERATIONS) {
  const salt = rand(16), iv = rand(12);
  const kek = await deriveWrapKey(phrase, salt, iterations);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode('pdv-dek-v1') }, kek, rawDek));
  return { v: BACKUP_VERSION, kdf: 'PBKDF2-SHA256', iter: iterations, salt: b64(salt), iv: b64(iv), wrapped: b64(ct) };
}

const importDek = (raw) => subtle().importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

/** 헤더 + 복구 문구 → DEK. 문구가 틀리면 예외(복호화 실패). */
export async function unlockDek(header, phrase) {
  if (!header || header.v !== BACKUP_VERSION) throw new Error('지원하지 않는 백업 형식입니다.');
  const kek = await deriveWrapKey(phrase, unb64(header.salt), header.iter);
  let raw;
  try {
    raw = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: unb64(header.iv), additionalData: enc.encode('pdv-dek-v1') }, kek, unb64(header.wrapped)));
  } catch { throw new Error('복구 문구가 맞지 않습니다.'); }
  return { rawDek: raw, dek: await importDek(raw) };
}

/** 복구 문구 변경: DEK 는 그대로, 헤더만 새로 만든다. */
export async function changePhrase(header, oldPhrase, newPhrase) {
  const chk = checkPhrase(newPhrase);
  if (!chk.ok) throw new Error(chk.reason);
  const { rawDek } = await unlockDek(header, oldPhrase);
  return wrapDek(rawDek, newPhrase, header.iter);
}

// ── 본문 암복호 ────────────────────────────────────────────────────
export async function encryptObject(dek, name, value) {
  const iv = rand(12);
  const pt = enc.encode(JSON.stringify(value));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(name) }, dek, pt));
  return enc.encode(JSON.stringify({ v: BACKUP_VERSION, iv: b64(iv), ct: b64(ct) }));
}
export async function decryptObject(dek, name, bytes) {
  const o = JSON.parse(dec.decode(bytes));
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(o.iv), additionalData: enc.encode(name) }, dek, unb64(o.ct));
  return JSON.parse(dec.decode(pt));
}

// ── 저장소 어댑터 ──────────────────────────────────────────────────
export const HEADER_KEY = 'pdv/header.json';
const snapKey = (ts) => `pdv/snap-${String(ts).padStart(15, '0')}.bin`;

/** 테스트·임시용. */
export class MemoryAdapter {
  constructor() { this.m = new Map(); }
  async put(k, bytes) { this.m.set(k, new Uint8Array(bytes)); }
  async get(k) { const v = this.m.get(k); if (!v) throw new Error('not found: ' + k); return v; }
  async list(prefix = '') { return [...this.m.keys()].filter((k) => k.startsWith(prefix)).sort(); }
  async remove(k) { this.m.delete(k); }
}

/**
 * Oracle Object Storage 등 "버킷 하위 PUT/GET 이 가능한 사전 인증 URL(PAR)" 어댑터.
 * baseUrl 예: https://objectstorage.ap-chuncheon-1.oraclecloud.com/p/<토큰>/n/<ns>/b/<bucket>/o/
 * (list/remove 는 PAR 권한이 있을 때만 동작 — 없으면 인덱스 객체로 대체)
 */
export class ParUrlAdapter {
  constructor(baseUrl, fetchImpl = globalThis.fetch) {
    this.base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
    this.f = fetchImpl;
  }
  _u(k) { return this.base + k.split('/').map(encodeURIComponent).join('/'); }
  async put(k, bytes) {
    const r = await this.f(this._u(k), { method: 'PUT', body: bytes });
    if (!r.ok) throw new Error(`저장소 쓰기 실패 (${r.status})`);
  }
  async get(k) {
    const r = await this.f(this._u(k));
    if (!r.ok) throw new Error(`저장소 읽기 실패 (${r.status})`);
    return new Uint8Array(await r.arrayBuffer());
  }
  async list(prefix = '') {
    // 인덱스 객체(평문 파일명 목록: 이름은 시각뿐, 내용 없음)
    try { return JSON.parse(dec.decode(await this.get('pdv/index.json'))).filter((k) => k.startsWith(prefix)).sort(); }
    catch { return []; }
  }
  async remove(k) {
    const r = await this.f(this._u(k), { method: 'DELETE' });
    if (!r.ok && r.status !== 404) throw new Error(`저장소 삭제 실패 (${r.status})`);
  }
}

async function addToIndex(adapter, key) {
  let idx = [];
  try { idx = JSON.parse(dec.decode(await adapter.get('pdv/index.json'))); } catch { /* 첫 백업 */ }
  if (!idx.includes(key)) idx.push(key);
  await adapter.put('pdv/index.json', enc.encode(JSON.stringify(idx)));
}

// ── 백업 / 복구 ────────────────────────────────────────────────────
/** 최초 설정: 헤더를 저장소에 올린다. 문구는 전달만 하고 저장하지 않는다. */
export async function initBackup(adapter, phrase, opts) {
  const { dek, header } = await setupRecovery(phrase, opts);
  await adapter.put(HEADER_KEY, enc.encode(JSON.stringify(header)));
  return { dek, header };
}

/** 스냅샷 1건을 암호화해 올린다. records 는 PDV 레코드 배열(원본). */
export async function backupSnapshot(adapter, dek, records, { now = Date.now() } = {}) {
  const key = snapKey(now);
  const body = await encryptObject(dek, key, { ts: now, count: records.length, records });
  await adapter.put(key, body);
  await addToIndex(adapter, key);
  return { key, count: records.length, bytes: body.length };
}

/** 복구: 문구로 DEK 를 풀고 가장 최근 스냅샷(또는 지정 키)을 복호화한다. */
export async function restoreLatest(adapter, phrase, { key } = {}) {
  const header = JSON.parse(dec.decode(await adapter.get(HEADER_KEY)));
  const { dek } = await unlockDek(header, phrase);
  const snaps = (await adapter.list('pdv/snap-'));
  const target = key || snaps[snaps.length - 1];
  if (!target) throw new Error('복구할 백업이 없습니다.');
  const data = await decryptObject(dek, target, await adapter.get(target));
  return { key: target, ts: data.ts, count: data.count, records: data.records };
}
