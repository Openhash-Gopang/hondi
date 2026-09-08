/**
 * tests/live_smoketest/hondi-search.smoke.js
 *
 * 혼디 검색(Hondi Search) 실제 운영 엔드포인트 대상 라이브 스모크 테스트.
 * 기존 tests/live_smoketest 컨벤션에 맞춘 독립 실행 스크립트 (외부 의존성 없음, Node 18+ 내장 fetch 사용).
 *
 * 실행:
 *   node tests/live_smoketest/hondi-search.smoke.js
 *   HONDI_BASE_URL=https://hondi-proxy.tensor-city.workers.dev node tests/live_smoketest/hondi-search.smoke.js
 *
 * 종료 코드: 0 = 전부 통과, 1 = 하나 이상 실패 (CI에서 그대로 사용 가능)
 */

const BASE_URL = process.env.HONDI_BASE_URL || "https://hondi.net";
// 2026-09-08 실사로 발견/수정 — worker.js에 실제 등록된 라우트는 '/hondi-search'
// (접두어 '/api' 없음, worker.js의 기존 라우트 컨벤션과 동일). 이전 버전은
// 설계 초안 단계의 '/api/hondi-search'를 그대로 남겨둬서 workers.dev 직접
// 테스트 시 404(Not Found, path 필드로 실제 요청 경로가 찍혀 발견됨)가 났었다.
const SEARCH_ENDPOINT = `${BASE_URL}/hondi-search`;
const MANIFEST_URL = `${BASE_URL}/site-manifest.json`;

const results = [];

function record(name, pass, detail) {
  results.push({ name, pass, detail });
  const mark = pass ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}${detail ? " - " + detail : ""}`);
}

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function postSearch(body) {
  const res = await fetch(SEARCH_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // 응답이 JSON이 아닌 경우 json은 null로 남음 - 테스트에서 별도 체크
  }
  return { status: res.status, json };
}

// 1. site-manifest.json이 실제로 서빙되는지 - 이게 깨지면 FALLBACK_MANIFEST로 조용히 저하 운영됨
async function testManifestIsLive() {
  try {
    const res = await fetch(MANIFEST_URL);
    if (!res.ok) {
      record("site-manifest.json 접근 가능", false, `HTTP ${res.status}`);
      return;
    }
    const data = await res.json();
    const ok = Array.isArray(data) && data.length >= 10;
    record(
      "site-manifest.json 접근 가능",
      ok,
      ok ? `${data.length}개 항목` : "배열이 아니거나 항목이 너무 적음(폴백 4개와 혼동 주의)"
    );
  } catch (e) {
    record("site-manifest.json 접근 가능", false, e.message);
  }
}

// 2. GET 요청은 405로 거부되어야 함
async function testMethodNotAllowed() {
  try {
    const res = await fetch(SEARCH_ENDPOINT, { method: "GET" });
    record("GET 요청 405 거부", res.status === 405, `실제 status=${res.status}`);
  } catch (e) {
    record("GET 요청 405 거부", false, e.message);
  }
}

// 3. message 누락 시 400
async function testMissingMessage() {
  const { status, json } = await postSearch({ conversation_id: uuid() });
  record(
    "message 누락 시 400 반환",
    status === 400 && json?.error === "message_required",
    `status=${status}, body=${JSON.stringify(json)}`
  );
}

// 4. 모호한 질의 → clarify, 이후 명확화 응답 → navigate (대화 세션 연속성 검증)
async function testClarifyThenNavigate() {
  const conversationId = uuid();

  const turn1 = await postSearch({
    conversation_id: conversationId,
    message: "메일 검색",
  });
  const turn1Ok = turn1.status === 200 && turn1.json?.type === "clarify";
  record(
    "1턴 모호한 질의 → clarify",
    turn1Ok,
    `status=${turn1.status}, type=${turn1.json?.type}, message=${turn1.json?.message}`
  );
  if (!turn1Ok) return;

  const turn2 = await postSearch({
    conversation_id: conversationId,
    message: "혼디 메일 시스템",
  });
  const turn2Ok =
    turn2.status === 200 &&
    turn2.json?.type === "navigate" &&
    typeof turn2.json?.url === "string" &&
    turn2.json.url.length > 0;
  record(
    "2턴 명확화 응답 → navigate (세션 연속성 유지)",
    turn2Ok,
    `status=${turn2.status}, type=${turn2.json?.type}, url=${turn2.json?.url}`
  );

  if (turn2Ok) {
    const knownManifestPaths = ["/docs/kmail-intro", "/services/kmail"];
    const matchesKnownManifestEntry = knownManifestPaths.includes(turn2.json.url);
    record(
      "navigate URL이 실제 매니페스트에 존재하는 경로임",
      matchesKnownManifestEntry,
      `url=${turn2.json.url} (site-manifest.json에 없는 임의 경로가 나오면 모델이 매니페스트를 못 본 것 = 버그 재발 신호)`
    );
  }
}

// 5. 명확한 단건 질의는 명확화 없이 바로 navigate 되어야 함
async function testDirectQueryNavigatesImmediately() {
  const conversationId = uuid();
  const { status, json } = await postSearch({
    conversation_id: conversationId,
    message: "K-Law 페이지 열어줘",
  });
  const ok = status === 200 && json?.type === "navigate" && json?.url === "/services/klaw";
  record(
    "명확한 질의 → 1턴만에 navigate",
    ok,
    `status=${status}, type=${json?.type}, url=${json?.url}`
  );
}

// 6. 사용자 데이터 검색 요청은 K-Search로 위임되어야 함 (SP 규칙 4번)
async function testDelegatesToKSearch() {
  const conversationId = uuid();
  const { status, json } = await postSearch({
    conversation_id: conversationId,
    message: "지난주에 김민수한테 받은 메일 찾아줘",
  });
  const ok = status === 200 && json?.type === "delegate_ksearch";
  record(
    "사용자 데이터 검색 요청 → K-Search로 위임",
    ok,
    `status=${status}, type=${json?.type}, message=${json?.message}`
  );
}

async function main() {
  console.log(`혼디 검색 라이브 스모크 테스트 시작 (BASE_URL=${BASE_URL})\n`);

  await testManifestIsLive();
  await testMethodNotAllowed();
  await testMissingMessage();
  await testClarifyThenNavigate();
  await testDirectQueryNavigatesImmediately();
  await testDelegatesToKSearch();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n총 ${results.length}건 중 실패 ${failed.length}건`);

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("스모크 테스트 실행 중 예외 발생:", e);
  process.exitCode = 1;
});
