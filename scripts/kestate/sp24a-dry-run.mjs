#!/usr/bin/env node
/**
 * scripts/kestate/sp24a-dry-run.mjs — SP-24a 실행 검증용 대화형 CLI
 *
 * ★ 2026-09-29 신설. gwp-registry.js가 kestate-appraisal을 status:'pending'
 * 으로 묶어 둔 이유 — "SP-24a가 실제로 웹검색을 수행하고 올바른
 * [STAGED_VALUATION] 블록을 내는지 아직 실행 검증되지 않았다" —를
 * 해소하기 위한 도구다.
 *
 * ★ 이 스크립트는 gwp-registry.js·call-ai.js·candidate-prefilter.js
 * 어느 것도 건드리지 않는다. 프롬프트 파일을 직접 읽어 hondi-proxy의
 * /ai/chat, /web-search 엔드포인트만 호출하는 완전히 격리된 로컬 CLI다
 * (estate-search-widget.js가 SP-24b에 쓴 것과 같은 "프로덕션 디스패치
 * 우회" 패턴). 따라서 실행 검증 도중에도 실사용자에게 이 SP가 노출될
 * 위험이 구조적으로 없다.
 *
 * ★ 개발자(피터)가 직접 이용자 역할로 대화하며 SP의 질문·행동을
 * 육안으로 검토한다("한 턴에 정확히 하나의 질문만 하는가", "지어내지
 * 않고 실제로 [WEB_SEARCH]를 쓰는가" 등은 사람이 대화 내용을 보고
 * 판단해야 하는 항목이라 자동화하지 않는다). [STAGED_VALUATION] 블록이
 * 나오면 자동으로 파싱해 hondi-staged-valuation.js의 stagedValuation()에
 * 그대로 통과시켜, 스키마가 실제로 맞물리는지·크래시 없이 결과가
 * 나오는지만은 기계적으로 확인한다.
 *
 * ★ [WEB_SEARCH: query=...] 태그 처리는 call-ai.js의 _handleWebSearchTag와
 * 동일한 프로토콜(POST /web-search → 결과를 "[웹 검색결과 — 미검증,
 * 출처: 웹]" 접두로 재주입 → 재호출)을 그대로 재구현한다. /ai/chat은
 * 순수 패스스루라 이 처리를 직접 하지 않는다(2026-09-29 worker.js 확인 —
 * handleAIChat에 WEB_SEARCH 태그 처리 코드가 없음). 이 재구현이 없으면
 * SP가 [WEB_SEARCH] 태그를 내도 아무 일도 일어나지 않아 "지어내지 않고
 * 실제로 찾는지" 자체를 검증할 수 없다.
 *
 * ★ 여기서 나온 [STAGED_VALUATION] 결과는 어디에도 자동 반영되지
 * 않는다 — 콘솔에 출력하고 docs/kestate/dry-runs/에 저장할 뿐이며,
 * status를 'active'로 바꾸거나 call-ai.js에 배선하는 것은 이 스크립트가
 * 아니라 사람이 결과를 검토한 뒤 별도로 한다.
 *
 * 사용법:
 *   node scripts/kestate/sp24a-dry-run.mjs
 * (hondi-proxy 호출에 별도 API 키는 필요 없다 — DEEPSEEK_API_KEY·
 * WEB_SEARCH_API_KEY는 이미 Cloudflare Worker 시크릿으로 설정돼 있다.)
 */
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stagedValuation } from '../../src/gopang/ai/hondi-staged-valuation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const PROMPT_PATH = join(REPO_ROOT, 'prompts', 'SP-24a_kestate_appraisal_v0_1.txt');
const WORKER_URL = 'https://hondi-proxy.tensor-city.workers.dev';
// ALLOWED_ORIGINS에 있는 값이면 무엇이든 된다(worker.js 확인) — 이 CLI는
// 브라우저가 아니라 Origin 헤더가 안 붙으므로 명시적으로 넣어준다.
const FAKE_ORIGIN = 'https://hondi.net';

const MAX_WEB_SEARCH_HOPS = 6; // 한 턴 안에서 SP가 연속으로 검색을 반복할 때의 안전판
const MAX_TURNS = 40; // 대화가 끝없이 이어지는 걸 막는 안전판

function loadSystemPrompt() {
  return readFileSync(PROMPT_PATH, 'utf8');
}

async function callChat(system, messages) {
  const res = await fetch(`${WORKER_URL}/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: FAKE_ORIGIN },
    body: JSON.stringify({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      system,
      messages,
      max_tokens: 1800,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`/ai/chat HTTP ${res.status}: ${JSON.stringify(data)}`);
  if (!data.content) throw new Error(`/ai/chat 응답에 content 없음: ${JSON.stringify(data)}`);
  return data.content;
}

/** call-ai.js의 _handleWebSearchTag와 동일한 응답 포맷팅. */
async function webSearch(query) {
  const res = await fetch(`${WORKER_URL}/web-search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: FAKE_ORIGIN },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(45000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return `검색 불가: ${data.message || data.error || `HTTP ${res.status}`}`;
  const parts = [];
  if (data.answer_box) parts.push(`[요약] ${data.answer_box.title}: ${data.answer_box.snippet}`);
  if (data.knowledge_graph) parts.push(`[정보] ${data.knowledge_graph.title} — ${data.knowledge_graph.description}`);
  (data.organic || []).forEach((r, i) => parts.push(`${i + 1}. ${r.title} — ${r.snippet} (${r.link})`));
  return parts.length > 0 ? parts.join('\n') : '검색 결과 없음';
}

function extractWebSearchQuery(text) {
  const m = text.match(/\[WEB_SEARCH:\s*query=([^\]]+)\]/);
  return m ? m[1].trim() : null;
}

function extractStagedValuation(text) {
  const m = text.match(/\[STAGED_VALUATION\]([\s\S]*?)\[\/STAGED_VALUATION\]/);
  if (!m) return null;
  return m[1].trim();
}

let searchCallCount = 0;

/** 어시스턴트가 [WEB_SEARCH]를 낼 때까지 재귀적으로 검색→재주입→재호출한다. */
async function resolveTurn(system, messages) {
  let reply = await callChat(system, messages);
  let hops = 0;
  while (true) {
    const query = extractWebSearchQuery(reply);
    if (!query) return reply;
    hops += 1;
    searchCallCount += 1;
    if (hops > MAX_WEB_SEARCH_HOPS) {
      console.warn(`  [경고] 한 턴에서 [WEB_SEARCH] ${MAX_WEB_SEARCH_HOPS}회 초과 — 중단`);
      return reply;
    }
    console.log(`  [WEB_SEARCH] "${query}" 조회 중...`);
    const resultText = await webSearch(query);
    const searchInject = `[웹 검색결과 — 미검증, 출처: 웹] ${resultText}\n\n이 정보를 반영해 다음 단계를 계속하십시오.`;
    messages.push({ role: 'assistant', content: reply });
    messages.push({ role: 'user', content: searchInject });
    reply = await callChat(system, messages);
  }
}

async function main() {
  const system = loadSystemPrompt();
  const rl = createInterface({ input: stdin, output: stdout });
  const messages = [{ role: 'user', content: '감정평가를 받고 싶습니다.' }];

  console.log('=== SP-24a 실행 검증 대화 (Ctrl+C로 중단) ===\n');
  console.log('당신은 "이용자" 역할입니다. SP의 질문에 실제 답을 입력하세요.\n');

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    let reply;
    try {
      reply = await resolveTurn(system, messages);
    } catch (e) {
      console.error(`[오류] ${e.message}`);
      break;
    }
    messages.push({ role: 'assistant', content: reply });

    const staged = extractStagedValuation(reply);
    if (staged) {
      const shown = reply.replace(/\[STAGED_VALUATION\][\s\S]*?\[\/STAGED_VALUATION\]/, '[STAGED_VALUATION 블록 — 아래 별도 출력]');
      console.log(`\nSP: ${shown}\n`);
      await handleStagedValuation(staged, messages);
      break;
    }

    console.log(`\nSP: ${reply}\n`);
    const userInput = await rl.question('나: ');
    if (!userInput.trim()) {
      console.log('(빈 입력 — 종료)');
      break;
    }
    messages.push({ role: 'user', content: userInput });
  }

  rl.close();
  console.log(`\n총 [WEB_SEARCH] 호출 횟수: ${searchCallCount}`);
}

async function handleStagedValuation(rawJson, messages) {
  console.log('=== [STAGED_VALUATION] 파싱 및 계산 검증 ===');
  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch (e) {
    console.error(`✗ JSON 파싱 실패: ${e.message}`);
    console.error('원문:\n' + rawJson);
    await saveDryRun(messages, { parse_error: e.message, raw: rawJson });
    return;
  }

  let result;
  try {
    result = stagedValuation(parsed);
  } catch (e) {
    console.error(`✗ stagedValuation() 실행 실패: ${e.message}`);
    console.error('SP가 낸 스키마가 실제 함수 입력과 안 맞을 가능성 — 프롬프트 또는 함수 중 하나를 고쳐야 함.');
    await saveDryRun(messages, { parsed, staged_valuation_error: e.message });
    return;
  }

  console.log('✓ stagedValuation() 정상 실행');
  console.log(`  거부 여부(rejected): ${result.rejected}`);
  if (!result.rejected) {
    console.log(`  공정가치(fair_value): ${result.fair_value?.toLocaleString()}원`);
    console.log(`  σ(sigma): ${result.sigma?.toFixed(4)}`);
  }
  console.log(`  registry_flags: ${JSON.stringify(result.registry_flags)}`);
  console.log(`  reasons:\n    - ${result.reasons.join('\n    - ')}`);

  await saveDryRun(messages, { parsed, result });
}

async function saveDryRun(messages, outcome) {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const dir = join(REPO_ROOT, 'docs', 'kestate', 'dry-runs');
  await mkdir(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(dir, `${ts}.json`);
  await writeFile(
    path,
    JSON.stringify({ ts: new Date().toISOString(), transcript: messages, outcome }, null, 2),
    'utf8'
  );
  console.log(`\n기록 저장: ${path}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
