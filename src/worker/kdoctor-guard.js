/**
 * kdoctor-guard.js — doctor.hondi.net 요청의 서버측 제한 (2026-10-01)
 *
 * worker.js handleAIChat의 doctor 분기(전용 키 DEEPSEEK_DOCTOR_KEY)에서만 쓴다.
 * 전용 키로 과금되는 경로이므로 클라이언트가 고를 수 있는 것을 좁힌다:
 *   - 모델: 텍스트는 고정, 이미지가 있으면 비전 모델로 서버가 정한다(클라이언트가 고른 model은 무시).
 *   - 이미지: user 메시지의 image_url 파트만, data:image/(jpeg|png|webp);base64 만, 요청당 3장, 장당 길이 상한.
 *   - max_tokens 상한.
 * 이 모듈은 순수 함수다(네트워크·env 접근 없음, env는 인자로 받는다).
 */
// 2026-10-01 확인(api-docs.deepseek.com): 현재 모델 이름은 deepseek-flash(텍스트·이미지 입력 겸용, V4.1-Flash).
// 예전 이름 deepseek-v4-flash·deepseek-v4-flash-vision-exp는 "여전히 받지만 폐기됨 — 같은 Flash 모델이 대신 처리"하는 별칭이다.
export const DOCTOR_TEXT_MODEL = 'deepseek-flash';
export const DOCTOR_VISION_MODEL_DEFAULT = 'deepseek-flash';
export const MAX_IMAGES_PER_REQUEST = 3;
export const MAX_IMAGE_DATAURL_CHARS = 3_000_000; // base64 약 2.2MB — 클라이언트가 1280px JPEG로 줄여 보낸다
export const MAX_OUTPUT_TOKENS = 4000;
const DATA_URL = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * @param {{messages?:any[], model?:string, max_tokens?:number}} req  클라이언트가 보낸 값
 * @param {{DOCTOR_VISION_MODEL?:string}} [env]
 * @returns {{ok:true, model:string, max_tokens:number, imageCount:number, thinking:{type:string}} | {ok:false, status:number, code:string, message:string}}
 */
export function prepareDoctorRequest(req, env = {}) {
  const messages = req?.messages;
  let imageCount = 0;
  if (messages !== undefined && !Array.isArray(messages)) return fail(400, 'INVALID_MESSAGES', 'messages must be an array');
  for (const m of messages ?? []) {
    if (!m || typeof m !== 'object') return fail(400, 'INVALID_MESSAGES', 'invalid message');
    if (typeof m.content === 'string') continue;
    if (!Array.isArray(m.content)) return fail(400, 'INVALID_MESSAGES', 'content must be string or parts');
    if (m.role !== 'user') return fail(400, 'INVALID_ATTACHMENT', 'only user messages may carry parts');
    for (const p of m.content) {
      if (p && p.type === 'text' && typeof p.text === 'string') continue;
      if (p && p.type === 'image_url' && typeof p.image_url?.url === 'string') {
        const url = p.image_url.url;
        if (url.length > MAX_IMAGE_DATAURL_CHARS) return fail(413, 'IMAGE_TOO_LARGE', 'image too large');
        if (!DATA_URL.test(url)) return fail(400, 'INVALID_ATTACHMENT', 'image must be a jpeg/png/webp data URL');
        imageCount++;
        continue;
      }
      return fail(400, 'INVALID_ATTACHMENT', 'unsupported content part');
    }
  }
  if (imageCount > MAX_IMAGES_PER_REQUEST) return fail(413, 'TOO_MANY_IMAGES', 'too many images');
  const model = imageCount > 0 ? (env?.DOCTOR_VISION_MODEL || DOCTOR_VISION_MODEL_DEFAULT) : DOCTOR_TEXT_MODEL;
  const asked = Number(req?.max_tokens);
  const max_tokens = Math.min(Number.isFinite(asked) && asked > 0 ? Math.floor(asked) : 2000, MAX_OUTPUT_TOKENS);
  // thinking 모드는 기본 켜짐이고 사고 과정이 max_tokens를 먼저 써서 content가 빈 문자열로 오는 사고가 이 저장소에서 이미 있었다
  // (NEXT_SESSION_HANDOFF_20260809_v2 §1-2). 다른 경로와 같은 원칙으로 끈다. 켜려면 DOCTOR_THINKING=enabled (그때는 출력 예산을 함께 검토).
  const thinking = { type: env?.DOCTOR_THINKING === 'enabled' ? 'enabled' : 'disabled' };
  return { ok: true, model, max_tokens, imageCount, thinking };
}

function fail(status, code, message) { return { ok: false, status, code, message }; }

/**
 * 속도 제한 항목(워커가 _checkRateLimitN으로 검사한다: KV 카운터, 고정 구간 버킷, 요청마다 +1).
 * 한 번의 상담 턴이 총괄 호출과 협진 호출을 합쳐 여러 번의 /ai/chat을 부르므로(턴당 최대 약 8회) 분당 한도는 그 배수로 잡았다.
 * 값은 초안이다 — env(DOCTOR_RL_MIN / _HOUR / _IMG_HOUR / _GLOBAL_HOUR)로 조정한다. KV가 없으면 워커가 통과시킨다(fail-open).
 * @returns {{action:string, key:string, limit:number, ttl:number, retryAfter:number}[]}
 */
export function doctorRateLimits({ ip, imageCount = 0, nowMs = Date.now(), env = {} } = {}) {
  const n = (v, d) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? Math.floor(x) : d; };
  const who = String(ip || 'unknown').replace(/[^A-Za-z0-9:._-]/g, '').slice(0, 64) || 'unknown';
  const min = Math.floor(nowMs / 60000); const hr = Math.floor(nowMs / 3600000);
  const left = (unitMs) => Math.max(1, Math.ceil(((Math.floor(nowMs / unitMs) + 1) * unitMs - nowMs) / 1000));
  const out = [
    { action: 'doctor_min', key: `${who}:${min}`, limit: n(env.DOCTOR_RL_MIN, 40), ttl: 120, retryAfter: left(60000) },
    { action: 'doctor_hour', key: `${who}:${hr}`, limit: n(env.DOCTOR_RL_HOUR, 400), ttl: 7200, retryAfter: left(3600000) },
  ];
  if (imageCount > 0) out.push({ action: 'doctor_img_hour', key: `${who}:${hr}`, limit: n(env.DOCTOR_RL_IMG_HOUR, 20), ttl: 7200, retryAfter: left(3600000) });
  out.push({ action: 'doctor_global_hour', key: `all:${hr}`, limit: n(env.DOCTOR_RL_GLOBAL_HOUR, 5000), ttl: 7200, retryAfter: left(3600000) });
  return out;
}
