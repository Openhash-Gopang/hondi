// ═════════════════════════════════════════════════
// 전문가 면허 인증 API (2026-10-21 신설) — 계획 W1: 면허증 사본 업로드 → 관리자 수동 승인
//
//   POST /pro-verify/apply    multipart: persona, role(professional|staff), license_no, supervisor_guid?(staff), guid, ts, sig, file
//                             → 승인 대기 신청 생성. 서명 메시지는 applyMessage() 참고(파일 SHA-256 포함).
//   GET  /pro-verify/status   ?guid=  → 내 인증 상태 목록(면허번호·사본 비노출)
//   POST /pro-verify/session  { guid, ts, sig }  → 승인된 전문가에게 30분짜리 세션 토큰 { token, exp, personas } (전문가용 AI 호출 시 body.pro_session 으로 보냄)
//   POST /pro-verify/pending  { guid, ts, sig }                  (운영자) 승인 대기 목록 — 면허번호는 마스킹본만
//   POST /pro-verify/file     { id, guid, ts, sig }              (운영자) 면허증 사본 열람 — 열람 기록 남김
//   POST /pro-verify/decide   { id, decision, note?, guid, ts, sig } (운영자) approve | reject | revoke
//
// 원칙
//   · 면허증 사본은 승인·반려 즉시 삭제한다(clearFile). 서버에는 직역·마스킹 면허번호·면허번호 해시·승인자·승인/만료일만 남는다.
//   · 면허번호 원문은 저장하지 않는다. 같은 면허번호를 다른 계정이 이미 승인받았으면 신청을 거절한다(면허 공유 방지).
//   · 직원(staff)은 소속 전문가(supervisor)의 승인이 유효한 동안에만 유효하다.
//   · 운영자는 env.PRO_VERIFY_ADMINS(guid 또는 공개키, 쉼표 구분). 모든 운영 호출은 지갑 서명.
//   · 인증 유효기간 1년. 만료는 expires_ts 로 계산한다(별도 상태 전이 없음).
//   · 전문가용 AI 호출 게이트(W1-5)는 activeVerification() 을 쓴다 — 이 파일은 인증 장부까지만 담당한다.
// ═════════════════════════════════════════════════
import { verifySig } from '../gopang/ai/hondi-digit-claim.js';
import { issueSession } from './pro-session.js';

const json = (body, status, cors = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors } });
const err = (status, code, message, cors, extra = {}) => json({ ok: false, code, message, ...extra }, status, cors);

export const MAX_FILE = 5 * 1024 * 1024;
export const VALID_MS = 365 * 24 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const DAILY_APPLY_LIMIT = 5;
const ROLES = ['professional', 'staff'];
const DECISIONS = { approve: 'approved', reject: 'rejected', revoke: 'revoked' };
const PERSONA_RE = /^[a-z][a-z0-9-]{1,59}$/;

export const applyMessage = (persona, role, licenseHash, fileSha, supervisorGuid, ts) =>
  `hondi-pro-verify\napply\n${persona}\n${role}\n${licenseHash}\n${fileSha}\n${supervisorGuid || ''}\n${ts}`;
export const listMessage = ts => `hondi-pro-verify\npending\n${ts}`;
export const fileMessage = (id, ts) => `hondi-pro-verify\nfile\n${id}\n${ts}`;
export const sessionMessage = ts => `hondi-pro-verify\nsession\n${ts}`;
export const decideMessage = (id, decision, ts) => `hondi-pro-verify\ndecide\n${id}\n${decision}\n${ts}`;

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
export const sha256Hex = async data => hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? new TextEncoder().encode(data) : data));

// 하위 직역(lawyer-criminal)은 상위 직역(lawyer) 인증이 덮는다.
export const personaCovers = (approved, requested) => approved === requested || String(requested).startsWith(approved + '-');

export const normLicenseNo = s => String(s || '').normalize('NFKC').replace(/[\s\-_.\/]/g, '').toUpperCase();
export const maskLicenseNo = s => {
  const n = normLicenseNo(s);
  return n.length <= 4 ? '*'.repeat(n.length) : '*'.repeat(n.length - 4) + n.slice(-4);
};
export const licenseHashOf = (persona, licenseNo) => sha256Hex(`hondi-license\n${persona}\n${normLicenseNo(licenseNo)}`);

// 매직 바이트로 형식 확인(클라이언트가 보낸 Content-Type 을 믿지 않는다).
export function sniffType(b) {
  if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

// 이 공개키가 이 직역에서 지금 유효하게 인증돼 있는가 → 유효 행 | null. 직원은 소속 전문가 인증이 유효해야 한다.
export async function activeVerification(store, pubkey, persona, now = Date.now(), _depth = 0) {
  const rows = await store.listByPubkey(pubkey);
  for (const r of rows) {
    if (r.status !== 'approved' || !(r.expires_ts > now) || !personaCovers(r.persona, persona)) continue;
    if (r.role === 'professional') return r;
    if (r.role === 'staff' && r.supervisor_pubkey && _depth < 1 && await activeVerification(store, r.supervisor_pubkey, persona, now, _depth + 1)) return r;
  }
  return null;
}

function pubStatus(r, now) {
  const active = r.status === 'approved' && r.expires_ts > now;
  return { id: r.id, persona: r.persona, role: r.role, status: r.status === 'approved' && !active ? 'expired' : r.status, license_no_masked: r.license_no_masked, applied_ts: r.ts, reviewed_ts: r.reviewed_ts || null, expires_ts: r.expires_ts || null, note: r.status === 'rejected' || r.status === 'revoked' ? (r.review_note || '') : '' };
}

export function makeProVerifyHandler({ store, getPinnedPubKey, findPubKeyByGuid = getPinnedPubKey, now = () => Date.now(), maxSkewMs = 5 * 60 * 1000 }) {
  if (!store || typeof getPinnedPubKey !== 'function') throw new Error('makeProVerifyHandler: store, getPinnedPubKey 필요');

  async function requireAdmin(env, b, message, cors) {
    const admins = String(env?.PRO_VERIFY_ADMINS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!admins.length) return { res: err(503, 'NO_ADMIN', '운영자가 설정되지 않았습니다(PRO_VERIFY_ADMINS).', cors) };
    if (!b.guid || !b.sig || !Number.isInteger(b.ts)) return { res: err(400, 'MISSING', '요청 형식이 올바르지 않습니다.', cors) };
    if (Math.abs(now() - b.ts) > maxSkewMs) return { res: err(400, 'STALE_TS', '시각 차이가 너무 큽니다.', cors) };
    const pinned = await getPinnedPubKey(env, b.guid);
    if (!pinned) return { res: err(404, 'NO_ACCOUNT', '계정을 찾을 수 없습니다.', cors) };
    if (!admins.includes(b.guid) && !admins.includes(pinned)) return { res: err(403, 'NOT_ADMIN', '운영 권한이 없습니다.', cors) };
    if (!(await verifySig(pinned, message, b.sig))) return { res: err(401, 'BAD_SIG', '서명이 유효하지 않습니다.', cors) };
    return { pinned };
  }

  return {
    async handle(request, url, env, cors = {}) {
      const path = url.pathname;
      if (!path.startsWith('/pro-verify/')) return null;
      try {
        // ── 신청 ──
        if (request.method === 'POST' && path === '/pro-verify/apply') {
          let fd; try { fd = await request.formData(); } catch { return err(400, 'FORM', 'multipart 형식이 필요합니다.', cors); }
          const persona = String(fd.get('persona') || '').trim();
          const role = String(fd.get('role') || '').trim();
          const licenseNo = String(fd.get('license_no') || '');
          const guid = String(fd.get('guid') || '').trim();
          const supGuid = String(fd.get('supervisor_guid') || '').trim();
          const sig = String(fd.get('sig') || '');
          const ts = Number(fd.get('ts'));
          const file = fd.get('file');
          if (!PERSONA_RE.test(persona) || !ROLES.includes(role) || !guid || !sig || !Number.isInteger(ts)) return err(400, 'MISSING', '직역(persona), 구분(role), guid, ts, sig가 필요합니다.', cors);
          const nLic = normLicenseNo(licenseNo);
          if (nLic.length < 3 || nLic.length > 40) return err(400, 'LICENSE_NO', '면허번호 형식이 올바르지 않습니다.', cors);
          if (role === 'staff' && !supGuid) return err(400, 'SUPERVISOR', '직원은 소속 전문가(supervisor_guid)가 필요합니다.', cors);
          if (Math.abs(now() - ts) > maxSkewMs) return err(400, 'STALE_TS', '시각 차이가 너무 큽니다. 기기 시계를 확인해 주세요.', cors);
          if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') return err(400, 'NO_FILE', '면허증 사본 파일이 필요합니다.', cors);
          if (file.size > MAX_FILE) return err(413, 'TOO_LARGE', `파일은 ${MAX_FILE / 1024 / 1024}MB 이하여야 합니다.`, cors);
          const bytes = new Uint8Array(await file.arrayBuffer());
          const type = sniffType(bytes);
          if (!type) return err(415, 'FILE_TYPE', 'JPG, PNG, WEBP, PDF 파일만 올릴 수 있습니다.', cors);

          const pinned = await getPinnedPubKey(env, guid);
          if (!pinned) return err(404, 'NO_ACCOUNT', '계정을 찾을 수 없습니다.', cors);
          const fileSha = await sha256Hex(bytes);
          const licenseHash = await licenseHashOf(persona, licenseNo);
          if (!(await verifySig(pinned, applyMessage(persona, role, licenseHash, fileSha, supGuid, ts), sig))) return err(401, 'BAD_SIG', '서명이 유효하지 않습니다.', cors);

          let supPub = '';
          if (role === 'staff') {
            supPub = await findPubKeyByGuid(env, supGuid) || '';
            if (!supPub) return err(404, 'NO_SUPERVISOR', '소속 전문가 계정을 찾을 수 없습니다.', cors);
            if (supPub === pinned) return err(400, 'SUPERVISOR', '본인을 소속 전문가로 지정할 수 없습니다.', cors);
            if (!(await activeVerification(store, supPub, persona, now()))) return err(409, 'SUPERVISOR_NOT_VERIFIED', '소속 전문가가 이 직역에서 인증된 상태가 아닙니다.', cors);
          }
          const mine = await store.listByPubkey(pinned);
          if (mine.some(r => r.persona === persona && r.role === role && r.status === 'pending')) return err(409, 'PENDING', '이미 승인 대기 중인 신청이 있습니다.', cors);
          if ((await store.countSince(pinned, now() - DAY_MS)) >= DAILY_APPLY_LIMIT) return err(429, 'RATE', `하루 ${DAILY_APPLY_LIMIT}건까지 신청할 수 있습니다.`, cors);
          if (role === 'professional') {
            const used = await store.findApprovedByLicense(licenseHash);
            if (used.some(r => r.applicant_pubkey !== pinned && r.expires_ts > now())) return err(409, 'LICENSE_IN_USE', '이 면허번호는 이미 다른 계정에서 인증되었습니다. 문의가 필요하면 운영자에게 연락하세요.', cors);
          }
          const rec = {
            applicant_pubkey: pinned, persona, role, license_no_masked: maskLicenseNo(licenseNo), license_hash: licenseHash,
            supervisor_pubkey: supPub, status: 'pending', file_sha256: fileSha, ts, sig,
          };
          const saved = await store.create(rec, { bytes, type, name: `license.${EXT[type]}` });
          return json({ ok: true, application: pubStatus({ ...rec, id: saved?.id }, now()) }, 200, cors);
        }

        // ── 내 상태 ──
        if (request.method === 'GET' && path === '/pro-verify/status') {
          const guid = (url.searchParams.get('guid') || '').trim();
          if (!guid) return err(400, 'MISSING_GUID', 'guid 필수', cors);
          const pinned = await getPinnedPubKey(env, guid);
          if (!pinned) return err(404, 'NO_ACCOUNT', '계정을 찾을 수 없습니다.', cors);
          const t = now();
          const rows = await store.listByPubkey(pinned);
          return json({ ok: true, items: rows.map(r => pubStatus(r, t)) }, 200, cors);
        }

        // ── 전문가 세션 발급 ──
        if (request.method === 'POST' && path === '/pro-verify/session') {
          const b = await request.json().catch(() => null) || {};
          if (!b.guid || !b.sig || !Number.isInteger(b.ts)) return err(400, 'MISSING', '요청 형식이 올바르지 않습니다.', cors);
          if (Math.abs(now() - b.ts) > maxSkewMs) return err(400, 'STALE_TS', '시각 차이가 너무 큽니다. 기기 시계를 확인해 주세요.', cors);
          if (!env?.PRO_SESSION_SECRET) return err(503, 'NO_SECRET', '전문가 세션 서명 키가 설정되지 않았습니다(PRO_SESSION_SECRET).', cors);
          const pinned = await getPinnedPubKey(env, b.guid);
          if (!pinned) return err(404, 'NO_ACCOUNT', '계정을 찾을 수 없습니다.', cors);
          if (!(await verifySig(pinned, sessionMessage(b.ts), b.sig))) return err(401, 'BAD_SIG', '서명이 유효하지 않습니다.', cors);
          const t = now();
          const personas = [];
          for (const r of await store.listByPubkey(pinned)) {
            if (r.status === 'approved' && r.expires_ts > t && !personas.includes(r.persona) && await activeVerification(store, pinned, r.persona, t)) personas.push(r.persona);
          }
          if (!personas.length) return err(403, 'NOT_VERIFIED', '면허 인증이 승인된 직역이 없습니다.', cors);
          const { token, exp } = await issueSession(env.PRO_SESSION_SECRET, { pk: pinned, personas }, t);
          return json({ ok: true, token, exp, personas }, 200, cors);
        }

        // ── 운영: 대기 목록 ──
        if (request.method === 'POST' && path === '/pro-verify/pending') {
          const b = await request.json().catch(() => null) || {};
          const a = await requireAdmin(env, b, listMessage(b.ts), cors); if (a.res) return a.res;
          const items = (await store.listPending(50)).map(r => ({ id: r.id, persona: r.persona, role: r.role, license_no_masked: r.license_no_masked, applicant: String(r.applicant_pubkey).slice(0, 12), supervisor: r.supervisor_pubkey ? String(r.supervisor_pubkey).slice(0, 12) : '', has_file: !!r.license_file, ts: r.ts }));
          return json({ ok: true, items }, 200, cors);
        }

        // ── 운영: 사본 열람 ──
        if (request.method === 'POST' && path === '/pro-verify/file') {
          const b = await request.json().catch(() => null) || {};
          if (!/^[a-z0-9]{15}$/.test(b.id || '')) return err(400, 'MISSING', 'id가 필요합니다.', cors);
          const a = await requireAdmin(env, b, fileMessage(b.id, b.ts), cors); if (a.res) return a.res;
          const rec = await store.get(b.id);
          if (!rec) return err(404, 'NO_RECORD', '신청을 찾을 수 없습니다.', cors);
          if (rec.status !== 'pending' || !rec.license_file) return err(410, 'FILE_GONE', '사본이 이미 삭제되었거나 대기 중인 신청이 아닙니다.', cors);
          const f = await store.readFile(b.id);
          if (!f) return err(410, 'FILE_GONE', '사본이 없습니다.', cors);
          const log = Array.isArray(rec.view_log) ? rec.view_log.slice(-19) : [];
          log.push({ by: String(a.pinned).slice(0, 12), ts: now() });
          await store.update(b.id, { view_log: log });
          return new Response(f.bytes, { status: 200, headers: { 'Content-Type': sniffType(f.bytes) || 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Disposition': 'inline', ...cors } });
        }

        // ── 운영: 승인·반려·철회 ──
        if (request.method === 'POST' && path === '/pro-verify/decide') {
          const b = await request.json().catch(() => null) || {};
          if (!/^[a-z0-9]{15}$/.test(b.id || '') || !(b.decision in DECISIONS)) return err(400, 'MISSING', 'id, decision(approve|reject|revoke)이 필요합니다.', cors);
          const a = await requireAdmin(env, b, decideMessage(b.id, b.decision, b.ts), cors); if (a.res) return a.res;
          const rec = await store.get(b.id);
          if (!rec) return err(404, 'NO_RECORD', '신청을 찾을 수 없습니다.', cors);
          const note = String(b.note || '').slice(0, 300);
          const t = now();
          if (b.decision === 'revoke') {
            if (rec.status !== 'approved') return err(409, 'INVALID_STATE', '승인된 인증만 철회할 수 있습니다.', cors);
          } else if (rec.status !== 'pending') return err(409, 'INVALID_STATE', `대기 중인 신청만 처리할 수 있습니다(현재: ${rec.status}).`, cors);
          if (b.decision === 'reject' && !note) return err(400, 'NOTE', '반려 사유(note)가 필요합니다.', cors);
          if (b.decision === 'approve') {
            if (rec.role === 'staff' && !(await activeVerification(store, rec.supervisor_pubkey, rec.persona, t))) return err(409, 'SUPERVISOR_NOT_VERIFIED', '소속 전문가의 인증이 유효하지 않아 승인할 수 없습니다.', cors);
            if (rec.role === 'professional') {
              const used = await store.findApprovedByLicense(rec.license_hash);
              if (used.some(r => r.applicant_pubkey !== rec.applicant_pubkey && r.expires_ts > t)) return err(409, 'LICENSE_IN_USE', '같은 면허번호가 다른 계정에서 이미 인증되어 있습니다.', cors);
            }
          }
          const hadFile = !!rec.license_file;
          const patch = { status: DECISIONS[b.decision], reviewer: a.pinned, reviewed_ts: t, review_note: note };
          if (b.decision === 'approve') patch.expires_ts = t + VALID_MS;
          await store.update(b.id, patch);
          if (hadFile) await store.clearFile(b.id, t);          // 승인·반려 즉시 사본 삭제
          return json({ ok: true, status: patch.status, expires_ts: patch.expires_ts || null, file_deleted: hadFile }, 200, cors);
        }

        return err(404, 'NOT_FOUND', '알 수 없는 경로입니다.', cors);
      } catch (e) {
        return err(502, 'PRO_VERIFY_FAILED', String(e?.message || e).slice(0, 200), cors);
      }
    },
  };
}
