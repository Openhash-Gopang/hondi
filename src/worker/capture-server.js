// ═════════════════════════════════════════════════
// src/worker/capture-server.js — 폰 카메라 → PC 증거 전달 (촬영 세션) 서버 측
// 2026-11-19. 설계: docs/design/PHONE_CAMERA_TO_PC_HELPER_v0_1.html
// 원칙: 같은 계정(guid)의 PC·폰 사이에서만 전달. 서버는 봉인된(암호화된) 사진만 잠시 맡고 내용을 읽지 못한다.
//  · 세션  capture:{guid}:{s}   — PC 1회용 X25519 공개키, 비활동 2시간 TTL
//  · 대기열 capq:{guid}:{s}     — 봉인 사진, PC가 pull 하면 비운다(1회 소비), TTL 10분
// 저장소(KV)·인증(resolveGuid)·알림(notify)은 주입 → worker.js 와 분리해 단독 테스트.
// ═════════════════════════════════════════════════

export const CAPTURE_POLICY = {
  SESSION_TTL_SEC: 2 * 3600,
  QUEUE_TTL_SEC: 600,
  MAX_ITEM_BYTES: 2 * 1024 * 1024,   // 봉인 사진 1장(base64) 상한
  MAX_ITEMS: 30,
  MAX_QUEUE_BYTES: 12 * 1024 * 1024,
};
const SID = /^[A-Za-z0-9_-]{16,64}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const B64U = /^[A-Za-z0-9_-]+=*$/;
const out = (status, json) => ({ status, json });
const bad = (status, code, message) => out(status, { ok: false, code, message });

export function validateItem(it) {
  const e = [];
  it = it || {};
  if (!Number.isInteger(it.seq) || it.seq < 0 || it.seq > 999) e.push('seq 오류');
  if (!HEX64.test(it.sha256 || '')) e.push('sha256(hex) 필수');
  const s = it.sealed;
  if (!s || typeof s !== 'object') e.push('sealed 필수');
  else {
    for (const k of ['ephemeralPubKey', 'iv', 'ciphertext']) if (typeof s[k] !== 'string' || !B64U.test(s[k])) e.push('sealed.' + k + ' 오류');
    Object.keys(s).forEach(k => { if (!['ephemeralPubKey', 'iv', 'ciphertext'].includes(k)) e.push('sealed 허용되지 않은 필드: ' + k); });
    if (typeof s.ciphertext === 'string' && s.ciphertext.length * 0.75 > CAPTURE_POLICY.MAX_ITEM_BYTES) e.push('사진 크기 초과');
  }
  Object.keys(it).forEach(k => { if (!['seq', 'sha256', 'sealed'].includes(k)) e.push('허용되지 않은 필드: ' + k); });
  return e;
}

// deps: { resolveGuid(env, body, {sigMsg}), kv, now(), notify(guid, info), env }
export function makeCaptureServer(deps) {
  const { resolveGuid, kv, env } = deps;
  const now = deps.now || (() => Date.now());
  const notify = deps.notify || (async () => {});
  const P = CAPTURE_POLICY;

  async function auth(body, op) {
    const b = body || {};
    if (!SID.test(b.s || '')) return { err: bad(400, 'BAD_SESSION_ID', '세션 번호 형식 오류') };
    const a = await resolveGuid(env, b, { sigMsg: `capture-${op}:${b.guid}:${b.s}:${b.ts}` });
    if (!a.ok) return { err: out(a.status, { ok: false, code: a.code, message: a.message }) };
    return { guid: a.guid, s: b.s };
  }
  const skey = (g, s) => `capture:${g}:${s}`;
  const qkey = (g, s) => `capq:${g}:${s}`;
  async function getSession(g, s) {
    const raw = await kv.get(skey(g, s));
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) { return null; }
  }
  async function touch(g, s, sess) { await kv.put(skey(g, s), JSON.stringify(sess), { expirationTtl: P.SESSION_TTL_SEC }); }

  // PC: 세션 개설 + 폰 깨우기
  async function open(body) {
    const a = await auth(body, 'open'); if (a.err) return a.err;
    const pub = body.pc_pub;
    if (typeof pub !== 'string' || !B64U.test(pub) || pub.length < 40 || pub.length > 100) return bad(400, 'BAD_PC_PUB', 'PC 공개키 형식 오류');
    const label = String(body.label || '').slice(0, 40);
    const sess = { pc_pub: pub, label, state: 'open', received: 0, created_at: now() };
    await touch(a.guid, a.s, sess);
    let notified = true;
    try { await notify(a.guid, { s: a.s, label }); } catch (_) { notified = false; }
    return out(200, { ok: true, expires_in: P.SESSION_TTL_SEC, notified });
  }

  // 폰: 세션 조회 → PC 공개키
  async function get(body) {
    const a = await auth(body, 'get'); if (a.err) return a.err;
    const sess = await getSession(a.guid, a.s);
    if (!sess || sess.state !== 'open') return bad(404, 'SESSION_NOT_FOUND', '촬영 요청이 없거나 끝났습니다');
    return out(200, { ok: true, pc_pub: sess.pc_pub, label: sess.label || '' });
  }

  // 폰: 봉인 사진 1장 올리기
  async function push(body) {
    const a = await auth(body, 'push'); if (a.err) return a.err;
    const errs = validateItem(body.item);
    if (errs.length) return out(400, { ok: false, code: 'BAD_ITEM', message: '봉투 오류', errors: errs });
    const sess = await getSession(a.guid, a.s);
    if (!sess || sess.state !== 'open') return bad(404, 'SESSION_NOT_FOUND', '촬영 요청이 없거나 끝났습니다');
    let q = [];
    try { const raw = await kv.get(qkey(a.guid, a.s)); if (raw) q = JSON.parse(raw); } catch (_) { q = []; }
    if (!Array.isArray(q)) q = [];
    if (q.some(x => x.seq === body.item.seq)) return out(200, { ok: true, duplicate: true, queued: q.length });
    q.push({ ...body.item, ts: now() });
    const size = JSON.stringify(q).length;
    if (q.length > P.MAX_ITEMS || size > P.MAX_QUEUE_BYTES) return bad(429, 'QUEUE_FULL', 'PC가 아직 받지 않은 사진이 너무 많습니다. 잠시 뒤 다시 보내세요');
    await kv.put(qkey(a.guid, a.s), JSON.stringify(q), { expirationTtl: P.QUEUE_TTL_SEC });
    sess.received = (sess.received || 0) + 1;
    await touch(a.guid, a.s, sess);
    return out(200, { ok: true, queued: q.length });
  }

  // PC: 쌓인 사진을 가져가고 비운다(1회 소비)
  async function pull(body) {
    const a = await auth(body, 'pull'); if (a.err) return a.err;
    const sess = await getSession(a.guid, a.s);
    if (!sess) return bad(404, 'SESSION_NOT_FOUND', '촬영 세션이 없거나 만료되었습니다');
    let q = [];
    try { const raw = await kv.get(qkey(a.guid, a.s)); if (raw) q = JSON.parse(raw); } catch (_) { q = []; }
    if (!Array.isArray(q)) q = [];
    if (q.length) await kv.delete(qkey(a.guid, a.s));
    await touch(a.guid, a.s, sess);   // 비활동 만료 연장
    return out(200, { ok: true, items: q.map(({ seq, sha256, sealed }) => ({ seq, sha256, sealed })), state: sess.state });
  }

  // PC: 촬영 종료 — 세션·대기열 폐기
  async function close(body) {
    const a = await auth(body, 'close'); if (a.err) return a.err;
    await kv.delete(skey(a.guid, a.s));
    await kv.delete(qkey(a.guid, a.s));
    return out(200, { ok: true });
  }

  return { open, get, push, pull, close };
}
