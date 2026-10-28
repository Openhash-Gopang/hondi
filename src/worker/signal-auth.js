// ═════════════════════════════════════════════════
// 대화 신호(WebRTC offer/answer/ice) 위조 방지 — 순수 검증 함수 (2026-10-28, 주피터 지시)
//   · 신호를 남기는 쪽은 서버가 확인한 로그인 증명(phone_verify_token 또는 서명으로 발급받은 gopang_token)을 내야 하고,
//     서버는 그 증명의 계정(guid)을 from_guid 로 강제한다. 남의 guid 를 적어 보내면 거부한다.
//   · 신호는 받는 사람(to_guid)이나 보낸 사람(from_guid) 본인만 지울 수 있다.
// 네트워크 없음 — 실제 인증·L1 호출은 worker.js 가 한다.
// ═════════════════════════════════════════════════

export const SIGNAL_TYPES = ['offer', 'answer', 'ice'];
export const SIGNAL_PAYLOAD_MAX = 64 * 1024;          // SDP 는 보통 수 KB — 64KB 를 넘으면 남용으로 본다
export const SIGNAL_SEND_PER_MINUTE = 120;            // 한 계정이 1분에 남길 수 있는 신호 수(ICE 후보가 많아 넉넉히)
const GUID_RE = /^[A-Za-z0-9:._-]{3,100}$/;

export function isGuidLike(g) { return typeof g === 'string' && GUID_RE.test(g); }

/** 보내기 요청 본문 검증. 성공 시 { ok:true, from, to, type, payload } */
export function validateSignalInput(body) {
  if (!body || typeof body !== 'object') return { ok: false, status: 400, code: 'INVALID_JSON', message: 'JSON body 필수' };
  const { from_guid, to_guid, type, payload } = body;
  if (!from_guid || !to_guid || !type || payload == null || payload === '') return { ok: false, status: 400, code: 'MISSING_FIELDS', message: 'from_guid, to_guid, type, payload 필수' };
  if (!SIGNAL_TYPES.includes(type)) return { ok: false, status: 400, code: 'INVALID_TYPE', message: 'offer|answer|ice 만 허용' };
  if (!isGuidLike(from_guid) || !isGuidLike(to_guid)) return { ok: false, status: 400, code: 'INVALID_GUID', message: 'guid 형식 오류' };
  let size = 0;
  try { size = (typeof payload === 'string' ? payload : JSON.stringify(payload)).length; } catch { size = Infinity; }
  if (size > SIGNAL_PAYLOAD_MAX) return { ok: false, status: 413, code: 'PAYLOAD_TOO_LARGE', message: '신호가 너무 큽니다' };
  return { ok: true, from: from_guid, to: to_guid, type, payload };
}

/** 이 신호를 caller(guid)가 지울 수 있는가 — 받는 사람 또는 보낸 사람 본인만. */
export function canDeleteSignal(record, callerGuid) {
  if (!record || !callerGuid) return false;
  return record.to_guid === callerGuid || record.from_guid === callerGuid;
}

/** 1분 단위 보내기 한도 판정. count 는 이번 분에 이미 쓴 횟수. */
export function sendRateOk(count, limit = SIGNAL_SEND_PER_MINUTE) { return Number(count || 0) < limit; }
