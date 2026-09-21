// ═══════════════════════════════════════════════════════════════
// K-FOI — 사용자가 고른 LLM(BYOK: 자기 API 키) 호출 어댑터. 2026-09-21 신설.
//
// mail.hondi.net "정보 공개 청구"의 대화 창에서 사용자가 기본 모델(혼디 기본) 대신 다른 LLM을 고르면
// 그 회사의 API 키를 입력하게 하고, 그 키로 이 어댑터가 해당 회사 API를 부른다.
//
// 설계 원칙
//   - 키는 요청 본문으로만 오고, 이 요청을 처리하는 동안에만 메모리에 있다. 저장하지 않고, 로그로 남기지 않고,
//     응답·오류 문구·대화 기록(append)에 넣지 않는다(redact가 마지막 안전장치).
//   - 호출 대상은 고정 목록(허용목록)이다. 사용자가 임의의 URL을 넣을 수 없다 — 그렇지 않으면 이 Worker가
//     사용자의 키를 들고 아무 주소나 부르는 열린 프록시(SSRF)가 된다. 모델 ID만 사용자가 정할 수 있고,
//     문자 형식을 검증한다.
//   - 회사마다 요청 형식이 다르다. 여기서는 형식이 안정적인 두 가지만 지원한다:
//       Anthropic Messages API, 그리고 OpenAI 호환 chat/completions(OpenAI, Google Gemini 호환 엔드포인트).
//   - OpenAI 호환 호출은 temperature·max_tokens를 보내지 않는다. 모델에 따라(추론 모델 등) 이 값을 거부하거나
//     다른 이름(max_completion_tokens)을 요구하므로, 보내지 않는 것이 가장 넓은 모델에서 동작한다.
//
// 이 어댑터는 실제 회사 API에 대해 검증하지 못했다(요청 형식은 각 회사 공개 문서 기준). 테스트는 모의 fetch로
// URL·헤더·본문 모양과 응답 해석, 오류 매핑을 확인한다. 배포 후 실제 키로 한 번씩 시험해 봐야 한다.
// ═══════════════════════════════════════════════════════════════

export const LLM_ENDPOINTS = {
  anthropic: 'https://api.anthropic.com/v1/messages',
  openai: 'https://api.openai.com/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
};

// 조사 깊이(화면의 "낮음/중간/높음") → 한 질문에서 쓸 수 있는 조사 횟수(아카이브·검색·열람 합계)
export const EFFORT_STEPS = { low: 4, medium: 8, high: 12 };

const ANTHROPIC_MODEL_RE = /^claude-[A-Za-z0-9.\-]{2,60}$/;
const CUSTOM_MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:\-\/]{0,79}$/;
const ANTHROPIC_MAX_TOKENS = 8000;
const DEFAULT_TIMEOUT_MS = 90000;

// 화면에서 온 llm 선택과 키를 검증한다. provider가 없거나 'default'이면 혼디 기본 모델(키 불필요).
export function parseLlmChoice(rawLlm, rawKey) {
  const llm = rawLlm && typeof rawLlm === 'object' ? rawLlm : {};
  const effort = Object.prototype.hasOwnProperty.call(EFFORT_STEPS, llm.effort) ? llm.effort : 'medium';
  const maxSteps = EFFORT_STEPS[effort];
  const provider = String(llm.provider || 'default');
  if (provider === 'default') return { ok: true, choice: { provider: 'default', model: '', effort, maxSteps } };
  if (!Object.prototype.hasOwnProperty.call(LLM_ENDPOINTS, provider)) {
    return { ok: false, code: 'LLM_UNKNOWN_PROVIDER', message: '지원하지 않는 LLM 제공자입니다.' };
  }
  const model = String(llm.model || '').trim();
  const modelOk = provider === 'anthropic' ? ANTHROPIC_MODEL_RE.test(model) : CUSTOM_MODEL_RE.test(model);
  if (!modelOk) return { ok: false, code: 'LLM_BAD_MODEL', message: '모델 ID 형식이 올바르지 않습니다.' };
  const apiKey = typeof rawKey === 'string' ? rawKey.trim() : '';
  if (apiKey.length < 8 || apiKey.length > 400 || /[\s\u0000-\u001f\u007f]/.test(apiKey)) {
    return { ok: false, code: 'LLM_KEY_MISSING', message: '[LLM_AUTH_FAILED] 이 모델을 쓰려면 API 키가 필요합니다.' };
  }
  return { ok: true, choice: { provider, model, effort, maxSteps }, apiKey };
}

// 응답·오류 문구에서 키를 지운다(회사가 오류에 키 일부를 되돌려 주는 경우가 있다).
export function redact(text, apiKey) {
  let t = String(text == null ? '' : text);
  if (apiKey) t = t.split(apiKey).join('[키]');
  return t
    .replace(/sk-[A-Za-z0-9_\-]{6,}/g, '[키]')
    .replace(/AIza[0-9A-Za-z_\-]{10,}/g, '[키]')
    .replace(/\bBearer\s+[A-Za-z0-9._\-]{8,}/gi, 'Bearer [키]');
}

function fail(code, message, status) { return { ok: false, code, message, status }; }

function mapHttpError(status, upstreamText, apiKey) {
  const detail = redact(upstreamText, apiKey).replace(/\s+/g, ' ').trim().slice(0, 200);
  if (status === 401 || status === 403) return fail('LLM_AUTH_FAILED', '[LLM_AUTH_FAILED] API 키가 거부되었습니다 — 키가 맞는지, 이 모델을 쓸 권한이 있는지 확인해 주세요.', status);
  if (status === 404) return fail('LLM_MODEL_NOT_FOUND', `모델을 찾을 수 없습니다 — 모델 ID를 확인해 주세요.${detail ? ' (' + detail + ')' : ''}`, status);
  if (status === 429) return fail('LLM_RATE_LIMITED', `해당 회사 API의 사용 한도에 걸렸습니다 — 잠시 후 다시 시도하세요.${detail ? ' (' + detail + ')' : ''}`, status);
  if (status === 400) return fail('LLM_BAD_REQUEST', `모델이 요청을 받아들이지 않았습니다${detail ? ': ' + detail : ''}`, status);
  return fail('LLM_UPSTREAM_ERROR', `해당 회사 API 오류(${status})${detail ? ': ' + detail : ''}`, status);
}

// system: 문자열, messages: [{role:'user'|'assistant', content}] — 역할이 번갈아 나오고 user로 시작한다.
export async function callByokLlm({ choice, apiKey, system, messages, fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const doFetch = fetchImpl || globalThis.fetch;
  const url = LLM_ENDPOINTS[choice.provider];
  if (!url) return fail('LLM_UNKNOWN_PROVIDER', '지원하지 않는 LLM 제공자입니다.');

  let headers, body;
  if (choice.provider === 'anthropic') {
    headers = { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
    body = { model: choice.model, max_tokens: ANTHROPIC_MAX_TOKENS, temperature: 0.2, system, messages };
  } else {
    headers = { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` };
    body = { model: choice.model, messages: [{ role: 'system', content: system }, ...messages] };
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await doFetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal });
  } catch (e) {
    clearTimeout(timer);
    if (e && e.name === 'AbortError') return fail('LLM_TIMEOUT', '모델 응답이 너무 오래 걸립니다 — 조사 깊이를 낮추거나 다시 시도해 주세요.');
    return fail('LLM_NETWORK_ERROR', '해당 회사 API에 연결하지 못했습니다.');
  }
  clearTimeout(timer);

  const raw = await res.text().catch(() => '');
  if (!res.ok) return mapHttpError(res.status, raw, apiKey);
  let data;
  try { data = JSON.parse(raw); } catch { return fail('LLM_BAD_RESPONSE', '모델 응답을 해석하지 못했습니다.'); }

  let text = '';
  if (choice.provider === 'anthropic') {
    text = (Array.isArray(data.content) ? data.content : []).filter(b => b && b.type === 'text').map(b => b.text || '').join('');
  } else {
    const c = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    text = typeof c === 'string' ? c : (Array.isArray(c) ? c.map(p => (p && p.text) || '').join('') : '');
  }
  text = String(text || '').trim();
  if (!text) return fail('LLM_EMPTY', '모델이 빈 응답을 돌려주었습니다 — 다시 시도해 주세요.');
  return { ok: true, text };
}
