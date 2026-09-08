/**
 * 혼디 검색 (Hondi Search) 백엔드 릴레이 - Cloudflare Worker 라우트 스켈레톤
 * 기존 worker.js에 라우트로 추가하는 형태를 가정.
 *
 * 필요 바인딩(wrangler.toml 예시):
 *   [[kv_namespaces]]
 *   binding = "HONDI_SEARCH_HISTORY"
 *
 *   [vars]
 *   DEEPSEEK_API_URL = "https://api.deepseek.com/v4/flash/chat/completions" // 실제 엔드포인트로 교체
 *
 *   시크릿: DEEPSEEK_API_KEY (wrangler secret put)
 */

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
const MANIFEST_KV_KEY = "site-manifest";

// KV/원본 모두 실패했을 때를 대비한 최소 폴백 매니페스트.
// 실제 페이지가 추가/변경되면 site-manifest.json(정본)을 갱신하는 것이 원칙이며,
// 이 배열은 원본 로드가 실패했을 때만 쓰이는 비상용 스냅샷이다.
const FALLBACK_MANIFEST = [
  {
    path: "/services/kmail",
    title: "K-Mail",
    description: "자연어 명령으로 메일을 보내고 받는 혼디 사용자 메일 기능",
    keywords: ["메일", "이메일", "K-Mail", "발신", "수신", "메일 보내기"],
  },
  {
    path: "/docs/kmail-intro",
    title: "K-Mail 소개",
    description: "K-Mail 시스템 자체의 개념과 사용법을 설명하는 문서",
    keywords: ["메일 시스템", "K-Mail이란", "메일 기능 소개", "혼디 메일 시스템"],
  },
  {
    path: "/services/klaw",
    title: "K-Law",
    description: "법률 상담 및 판례 시뮬레이션 AI 서비스",
    keywords: ["법률", "K-Law", "판례", "법률 상담", "소송"],
  },
  {
    path: "/services/kjob",
    title: "K-Job",
    description: "구인·구직 및 업무 오케스트레이션 서비스",
    keywords: ["구직", "구인", "일자리", "K-Job", "채용"],
  },
];

async function fetchManifestFromOrigin(env) {
  const url = env.SITE_MANIFEST_URL || "https://hondi.net/site-manifest.json";
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`site-manifest fetch failed: ${res.status}`);
  }
  return res.json();
}

async function loadManifest(env) {
  const cached = await env.HONDI_SEARCH_HISTORY.get(MANIFEST_KV_KEY, "json");
  if (cached) return cached;

  let manifest;
  try {
    manifest = await fetchManifestFromOrigin(env);
  } catch (err) {
    console.error("[hondi-search] site-manifest 원본 로드 실패, 폴백 사용:", err);
    manifest = FALLBACK_MANIFEST;
  }

  await env.HONDI_SEARCH_HISTORY.put(MANIFEST_KV_KEY, JSON.stringify(manifest), {
    expirationTtl: MANIFEST_CACHE_TTL_SECONDS,
  });

  return manifest;
}

async function loadHistory(env, conversationId) {
  if (!conversationId) return [];
  const raw = await env.HONDI_SEARCH_HISTORY.get(`conv:${conversationId}`, "json");
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
    .replace("{{SITE_MANIFEST_JSON}}", JSON.stringify(manifest))
    .replace("{{CONVERSATION_HISTORY}}", JSON.stringify(history));

  return [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: message },
  ];
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {
      type: "clarify",
      message: "죄송합니다, 다시 한번 말씀해주시겠어요?",
    };
  }
}

export async function handleHondiSearch(request, env) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { conversation_id, message } = body;
  if (!message || typeof message !== "string") {
    return new Response(JSON.stringify({ error: "message_required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const [manifest, history] = await Promise.all([
    loadManifest(env),
    loadHistory(env, conversation_id),
  ]);

  const messages = buildMessages(HONDI_SEARCH_SP, manifest, history, message);

  const deepseekRes = await fetch(env.DEEPSEEK_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-v4-flash", // TODO: 정확한 모델 식별자로 교체
      messages,
      response_format: { type: "json_object" },
      max_tokens: 500,
    }),
  });

  if (!deepseekRes.ok) {
    return new Response(
      JSON.stringify({
        type: "clarify",
        message: "검색 엔진 연결에 문제가 있습니다. 잠시 후 다시 시도해주세요.",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  const deepseekData = await deepseekRes.json();
  const rawText = deepseekData?.choices?.[0]?.message?.content ?? "{}";
  const parsed = safeParseJson(rawText);

  const newHistory = [
    ...history,
    { role: "user", content: message },
    { role: "assistant", content: parsed.message || "" },
  ];

  if (parsed.type !== "navigate") {
    await saveHistory(env, conversation_id, newHistory);
  } else {
    // navigate로 종료되면 세션 정리
    if (conversation_id) {
      await env.HONDI_SEARCH_HISTORY.delete(`conv:${conversation_id}`);
    }
  }

  return new Response(JSON.stringify(parsed), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// worker.js의 라우터에 등록하는 예시:
// if (url.pathname === "/api/hondi-search") return handleHondiSearch(request, env);
