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
...(HONDI_SEARCH_DESIGN.md의 SP 전문을 그대로 삽입)...
반드시 JSON 스키마만 출력하십시오.`;

const HISTORY_TTL_SECONDS = 60 * 10; // 10분 미사용 시 세션 만료

async function loadManifest(env) {
  // TODO: SP-TREE-REGISTRY 또는 site-manifest.json을 KV/R2/PocketBase에서 로드.
  // 우선 캐시 우선, 없으면 원본에서 재생성.
  const cached = await env.HONDI_SEARCH_HISTORY.get("site-manifest", "json");
  if (cached) return cached;
  return []; // TODO: 실제 매니페스트 로더 연결
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
