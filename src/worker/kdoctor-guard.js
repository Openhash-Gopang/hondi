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
export const DOCTOR_TEXT_MODEL = 'deepseek-v4-flash';
export const DOCTOR_VISION_MODEL_DEFAULT = 'deepseek-v4-flash-vision-exp';
export const MAX_IMAGES_PER_REQUEST = 3;
export const MAX_IMAGE_DATAURL_CHARS = 3_000_000; // base64 약 2.2MB — 클라이언트가 1280px JPEG로 줄여 보낸다
export const MAX_OUTPUT_TOKENS = 4000;
const DATA_URL = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * @param {{messages?:any[], model?:string, max_tokens?:number}} req  클라이언트가 보낸 값
 * @param {{DOCTOR_VISION_MODEL?:string}} [env]
 * @returns {{ok:true, model:string, max_tokens:number, imageCount:number} | {ok:false, status:number, code:string, message:string}}
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
  return { ok: true, model, max_tokens, imageCount };
}

function fail(status, code, message) { return { ok: false, status, code, message }; }
