/**
 * 혼디 검색 (Hondi Search) 백엔드 릴레이 - Cloudflare Worker 라우트
 *
 * worker.js 라우터 등록:
 *   import { handleHondiSearch } from './src/routes/hondi-search-worker.js';
 *   ...
 *   if (pathname === '/hondi-search' && request.method === 'POST')
 *     return handleHondiSearch(request, env, corsHeaders, { _err });
 *
 * 필요 바인딩(wrangler.toml):
 *   [[kv_namespaces]]
 *   binding = "HONDI_SEARCH_HISTORY"
 *   (id는 `wrangler kv namespace create HONDI_SEARCH_HISTORY`로 발급 후 실사 반영 —
 *    추측 ID를 넣지 않는다. 다른 바인딩들과 동일 원칙, wrangler.toml 상단 주석 참고.)
 *
 * DEEPSEEK_API_KEY는 이미 다른 기능들이 쓰고 있는 기존 시크릿을 그대로 재사용한다
 * (worker.js 여러 곳에서 env.DEEPSEEK_API_KEY 참조 확인됨 — 별도 시크릿 추가 불필요).
 * 모델 호출은 src/gopang/core/deepseek-client.js의 공용 deepseekChat()을 통해서만 한다
 * (개별 fetch 하드코딩 금지 — 이 모듈 헤더 주석에 명시된 원칙).
 */

import { deepseekChat } from '../gopang/core/deepseek-client.js';

const HONDI_SEARCH_SP = `당신은 혼디(hondi.net)의 사이트 내 검색 도우미 "혼디 검색"입니다.

역할:
- 사용자의 자연어 질의를 분석하여, 아래 제공되는 사이트 페이지 매니페스트 중
  사용자의 의도에 가장 부합하는 목적지를 찾습니다.
- 단순 키워드 매칭이 아니라 의도 파악에 기반합니다.

동작 규칙:
1. 질의가 모호하면(예: 여러 페이지가 후보이거나, 목적이 불분명하면)
   명확화 질문을 1회 던집니다. 명확화는 최대 2라운드까지만 허용합니다.
2. 명확화 후에도 여전히 모호하면 최상위 후보 3개를 candidates로 제시합니다.
3. 목적지가 명확해지면 navigate로 응답하며, 새 탭으로 이동할 URL을 반환합니다.
4. 당신은 사용자 데이터(메일함, 문서 등)에 접근하지 않습니다.
   데이터 자체를 찾는 요청은 K-Search 영역이므로,
   "OO을 찾으시는 건 K-Search가 담당합니다"라고 안내하고 K-Search로 위임합니다.
5. 응답은 반드시 아래 JSON 스키마만 출력합니다. 그 외 텍스트를 포함하지 않습니다.
   설명이나 마크다운 코드펜스 없이 순수 JSON 객체 하나만 출력하십시오.

응답 스키마:
{
  "type": "clarify" | "navigate" | "candidates" | "delegate_ksearch",
  "message": "사용자에게 보여줄 한국어 문장",
  "url": "type=navigate일 때만, 이동할 절대경로 URL",
  "candidates": [{"label": "...", "url": "..."}]  // type=candidates일 때만
}

[사이트 매니페스트]
{{SITE_MANIFEST_JSON}}

[대화 히스토리]
{{CONVERSATION_HISTORY}}`;

const HISTORY_TTL_SECONDS = 60 * 10; // 10분 미사용 시 세션 만료
const MANIFEST_CACHE_TTL_SECONDS = 60 * 60; // 매니페스트 캐시 1시간
const MANIFEST_KV_KEY = 'site-manifest';
const HONDI_SEARCH_MODEL = 'deepseek-v4-flash';

// KV/원본 모두 실패했을 때를 대비한 최소 폴백 매니페스트.
// 실제 페이지가 추가/변경되면 public/site-manifest.json(정본)을 갱신하는 것이 원칙이며,
// 이 배열은 원본 로드가 실패했을 때만 쓰이는 비상용 스냅샷이다.
const FALLBACK_MANIFEST = [
  {
    path: '/services/kmail',
    title: 'K-Mail',
    description: '자연어 명령으로 메일을 보내고 받는 혼디 사용자 메일 기능',
    keywords: ['메일', '이메일', 'K-Mail', '발신', '수신', '메일 보내기'],
  },
  {
    path: '/docs/kmail-intro',
    title: 'K-Mail 소개',
    description: 'K-Mail 시스템 자체의 개념과 사용법을 설명하는 문서',
    keywords: ['메일 시스템', 'K-Mail이란', '메일 기능 소개', '혼디 메일 시스템'],
  },
  {
    path: '/services/klaw',
    title: 'K-Law',
    description: '법률 상담 및 판례 시뮬레이션 AI 서비스',
    keywords: ['법률', 'K-Law', '판례', '법률 상담', '소송'],
  },
  {
    path: '/services/kjob',
    title: 'K-Job',
    description: '구인·구직 및 업무 오케스트레이션 서비스',
    keywords: ['구직', '구인', '일자리', 'K-Job', '채용'],
  },
];

async function fetchManifestFromOrigin(env) {
  const url = env.SITE_MANIFEST_URL || 'https://hondi.net/site-manifest.json' /* 리포 루트에 위치 - public/ 아님, GitHub Pages가 루트를 그대로 미러링하므로 */;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`site-manifest fetch failed: ${res.status}`);
  }
  return res.json();
}

async function loadManifest(env) {
  const cached = await env.HONDI_SEARCH_HISTORY.get(MANIFEST_KV_KEY, 'json');
  if (cached) return cached;

  let manifest;
  try {
    manifest = await fetchManifestFromOrigin(env);
  } catch (err) {
    console.error('[hondi-search] site-manifest 원본 로드 실패, 폴백 사용:', err);
    manifest = FALLBACK_MANIFEST;
  }

  await env.HONDI_SEARCH_HISTORY.put(MANIFEST_KV_KEY, JSON.stringify(manifest), {
    expirationTtl: MANIFEST_CACHE_TTL_SECONDS,
  });

  return manifest;
}

async function loadHistory(env, conversationId) {
  if (!conversationId) return [];
  const raw = await env.HONDI_SEARCH_HISTORY.get(`conv:${conversationId}`, 'json');
  return raw || [];
}

async function saveHistory(env, conversationId, history) {
  if (!conversationId) return;
  await env.HONDI_SEARCH_HISTORY.put(
    `conv:${conversationId}`,
    JSON.stringify(history),
    { expirationTtl: HISTORY_TTL_SECONDS }
  );
}

function buildMessages(sp, manifest, history, message) {
  const systemPrompt = sp
    .replace('{{SITE_MANIFEST_JSON}}', JSON.stringify(manifest))
    .replace('{{CONVERSATION_HISTORY}}', JSON.stringify(history));

  return [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: message },
  ];
}

// deepseek가 지시를 어기고 ```json 코드펜스를 씌워 보내는 경우까지 방어.
function safeParseJson(text) {
  const cleaned = String(text || '').replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return {
      type: 'clarify',
      message: '죄송합니다, 다시 한번 말씀해주시겠어요?',
    };
  }
}

export async function handleHondiSearch(request, env, corsHeaders, { _err }) {
  if (request.method !== 'POST') {
    return _err(405, 'METHOD_NOT_ALLOWED', 'POST만 허용됩니다', corsHeaders);
  }

  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  const { conversation_id, message } = body;
  if (!message || typeof message !== 'string') {
    return _err(400, 'message_required', 'message 필드가 필요합니다', corsHeaders);
  }

  const [manifest, history] = await Promise.all([
    loadManifest(env),
    loadHistory(env, conversation_id),
  ]);

  const messages = buildMessages(HONDI_SEARCH_SP, manifest, history, message);

  let parsed;
  try {
    const deepseekData = await deepseekChat({
      env,
      model: HONDI_SEARCH_MODEL,
      messages,
      max_tokens: 500,
    });
    const rawText = deepseekData?.choices?.[0]?.message?.content ?? '{}';
    parsed = safeParseJson(rawText);
  } catch (e) {
    console.error('[hondi-search] deepseek 호출 실패:', e);
    return new Response(
      JSON.stringify({
        type: 'clarify',
        message: '검색 엔진 연결에 문제가 있습니다. 잠시 후 다시 시도해주세요.',
      }),
      { status: 200, headers: corsHeaders }
    );
  }

  const newHistory = [
    ...history,
    { role: 'user', content: message },
    { role: 'assistant', content: parsed.message || '' },
  ];

  if (parsed.type !== 'navigate') {
    await saveHistory(env, conversation_id, newHistory);
  } else if (conversation_id) {
    // navigate로 종료되면 세션 정리
    await env.HONDI_SEARCH_HISTORY.delete(`conv:${conversation_id}`);
  }

  return new Response(JSON.stringify(parsed), { status: 200, headers: corsHeaders });
}
