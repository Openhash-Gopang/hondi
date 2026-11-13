// PC 회원 가입(폰으로 이어 가기) — 세션 로직 (2026-11-12, 주피터 지시)
//
// 배경: 신규 사용자는 폰에 계정이 없어 device-link(웹푸시 승인)를 쓸 수 없고, 암호키(GDC Wallet)는 폰에서만 만든다(기존 원칙).
// 그래서 PC 가입 창은 "가입 세션"만 만들고, 실제 가입(번호 인증·암호키 생성·프로필 등록)은 폰에서 기존 절차 그대로 한다.
//   PC  : init  → QR(또는 문자 링크) 표시 + 두 자리 숫자 표시 → poll 로 기다림
//   폰  : session(숫자 후보 3개) → verify(PC 숫자 고르기) → 기존 가입 → complete(가입 증거 = phone_verify_token)
//   PC  : poll 이 registered 가 되면 e164 를 받아 일반 로그인(device-link, 숫자 대조)으로 이어 간다.
// 정답 숫자는 폰에 내려주지 않는다(matchChoices 만 내려간다) — device-link 숫자 대조와 같은 원칙.

const SESSION_TTL_SECONDS = 600;          // 가입은 번호 인증·닉네임 입력까지 있어 로그인(90초)보다 길게 둔다
const MAX_WRONG_PICKS = 3;
const SMS_PER_PHONE_PER_HOUR = 3;
const INIT_PER_IP_PER_HOUR = 20;
const KEY = (id) => `signup_link:${id}`;

const KR_MOBILE_E164 = /^\+8210\d{8}$/;
// 가입 직후에는 무료 이용 기간(AI 사용 500원어치 또는 24시간)이 시작된다. (2026-11-14 요금제에서 "무료 플랜"은 없앴다.) 유료 서비스가 필요한 순간(예: K-Law)에 그 지점에서 유료 전환을 요청한다.

function json(status, body) { return { status, body }; }
const err = (status, code, message) => json(status, { ok: false, error: code, message });

function shuffled(arr, randInt) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = randInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/**
 * @param {object} deps
 *  kv                    — get/put(expirationTtl) 를 가진 KV (QR_SESSIONS_KV)
 *  resolveToken(token)   — phone_verify_token → { ok, guid, e164 }
 *  findProfileByE164(e)  — 이미 가입된 번호인지(있으면 truthy)
 *  sendSms(e164, text)   — SMS 발송(실패 시 throw)
 *  now, uuid, randInt    — 시험용 주입
 */
export function createSignupLinkApi(deps) {
  const { kv, resolveToken, findProfileByE164, sendSms } = deps;
  const now = deps.now || (() => Date.now());
  const uuid = deps.uuid || (() => crypto.randomUUID());
  const randInt = deps.randInt || ((n) => crypto.getRandomValues(new Uint32Array(1))[0] % n);
  const origin = deps.origin || 'https://app.naviweb.kr';

  async function load(sessionId) {
    if (!sessionId || !/^[0-9a-f-]{36}$/i.test(String(sessionId))) return null;
    const raw = await kv.get(KEY(sessionId));
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }
  async function save(sessionId, rec) {
    const left = Math.max(60, Math.ceil((rec.expiresAt - now()) / 1000));
    await kv.put(KEY(sessionId), JSON.stringify(rec), { expirationTtl: left });
  }
  async function bump(key, limit, ttl) {
    const raw = await kv.get(key);
    const n = raw ? parseInt(raw, 10) || 0 : 0;
    if (n >= limit) return false;
    await kv.put(key, String(n + 1), { expirationTtl: ttl });
    return true;
  }

  // POST init { pcLabel?, pcMatch, method?: 'qr'|'sms', e164? (sms 일 때) }
  async function init(body, ip) {
    body = body || {};
    const pcMatch = String(body.pcMatch || '');
    if (!/^[1-9][0-9]$/.test(pcMatch)) return err(400, 'BAD_MATCH', 'pcMatch(두 자리 숫자)가 필요합니다');
    const method = body.method === 'sms' ? 'sms' : 'qr';
    if (ip && !(await bump(`signup_link_ip:${ip}`, INIT_PER_IP_PER_HOUR, 3600))) {
      return err(429, 'RATE_LIMITED', '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요');
    }
    let e164 = null;
    if (method === 'sms') {
      e164 = String(body.e164 || '');
      if (!KR_MOBILE_E164.test(e164)) return err(400, 'BAD_PHONE', '휴대폰 번호(010)를 확인해 주세요');
      let exists = null;
      try { exists = await findProfileByE164(e164); } catch { return err(503, 'LOOKUP_FAILED', '잠시 후 다시 시도해 주세요'); }
      if (exists) return err(409, 'ALREADY_REGISTERED', '이미 가입된 번호입니다. 로그인해 주세요');
      if (!(await bump(`signup_link_sms:${e164}`, SMS_PER_PHONE_PER_HOUR, 3600))) {
        return err(429, 'PHONE_RATE_LIMITED', '이 번호로 문자를 너무 많이 요청했습니다. 잠시 후 다시 시도해 주세요');
      }
    }
    const decoys = new Set();
    while (decoys.size < 2) { const n = 10 + randInt(90); if (String(n) !== pcMatch) decoys.add(String(n)); }
    const sessionId = uuid();
    const rec = {
      state: 'pending', pcLabel: String(body.pcLabel || 'PC').slice(0, 40), pcMatch,
      matchChoices: shuffled([pcMatch, ...decoys], randInt),
      method, e164, wrong: 0, guid: null, createdAt: now(), expiresAt: now() + SESSION_TTL_SECONDS * 1000,
    };
    const approveUrl = `${origin}/auth/signup-approve.html?sessionId=${encodeURIComponent(sessionId)}`;
    if (method === 'sms') {
      try { await sendSms(e164, `[나비] PC에서 회원 가입을 요청했습니다. 본인이면 열어 주세요: ${approveUrl} (${SESSION_TTL_SECONDS / 60}분 이내)`); }
      catch { return err(502, 'SMS_SEND_FAILED', '문자 발송에 실패했습니다. 잠시 후 다시 시도해 주세요'); }
    }
    await save(sessionId, rec);
    return json(200, { ok: true, sessionId, approveUrl, expires_in: SESSION_TTL_SECONDS, method });
  }

  // GET session?sessionId — 폰이 호출. 정답(pcMatch)은 내려주지 않는다.
  async function session(sessionId) {
    const rec = await load(sessionId);
    if (!rec) return err(404, 'SESSION_EXPIRED', '요청이 만료됐거나 없습니다');
    return json(200, { ok: true, state: rec.state, pcLabel: rec.pcLabel, method: rec.method,
      phoneHint: rec.method === 'sms' && rec.e164 ? rec.e164.slice(-8) : null,
      matchChoices: rec.state === 'pending' ? rec.matchChoices : null });
  }

  // POST verify { sessionId, picked } — 폰이 PC 숫자를 골랐는지. 세 번 틀리면 세션을 거절 상태로 닫는다.
  async function verify(body) {
    const rec = await load(body && body.sessionId);
    if (!rec) return err(404, 'SESSION_EXPIRED', '요청이 만료됐거나 없습니다');
    if (rec.state !== 'pending') return err(409, 'ALREADY_PROGRESSED', '이미 진행된 요청입니다');
    if (String(body.picked || '') !== rec.pcMatch) {
      rec.wrong += 1;
      if (rec.wrong >= MAX_WRONG_PICKS) rec.state = 'denied';
      await save(body.sessionId, rec);
      return err(403, rec.state === 'denied' ? 'DENIED' : 'WRONG_NUMBER', rec.state === 'denied' ? '숫자를 여러 번 잘못 골라 요청이 취소됐습니다' : 'PC 화면의 숫자와 다릅니다');
    }
    rec.state = 'verified';
    await save(body.sessionId, rec);
    return json(200, { ok: true });
  }

  // POST complete { sessionId, phone_verify_token } — 폰에서 가입이 끝난 뒤. 토큰이 가입 증거다.
  async function complete(body) {
    const rec = await load(body && body.sessionId);
    if (!rec) return err(404, 'SESSION_EXPIRED', '요청이 만료됐거나 없습니다');
    if (rec.state !== 'verified') return err(409, 'NOT_VERIFIED', '숫자 확인이 끝나지 않은 요청입니다');
    const r = await resolveToken(body.phone_verify_token);
    if (!r || !r.ok || !r.e164) return err(401, 'TOKEN_INVALID', '전화번호 인증을 확인하지 못했습니다');
    if (rec.e164 && rec.e164 !== r.e164) return err(403, 'PHONE_MISMATCH', '문자를 받은 번호로 가입해 주세요');
    rec.state = 'registered'; rec.e164 = r.e164; rec.guid = r.guid || null;
    await save(body.sessionId, rec);
    return json(200, { ok: true });
  }

  // GET poll?sessionId — PC 가 호출. 가입이 끝났을 때만 e164 를 알려 준다.
  async function poll(sessionId) {
    const rec = await load(sessionId);
    if (!rec) return json(200, { ok: true, state: 'expired' });
    if (rec.state === 'registered') return json(200, { ok: true, state: 'registered', e164: rec.e164 });
    return json(200, { ok: true, state: rec.state });
  }

  return { init, session, verify, complete, poll };
}
