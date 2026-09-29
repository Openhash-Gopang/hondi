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
 * ★ 2026-09-29 실행 검증 중 두 번째 발견 — [WEB_SEARCH] 자체는 신뢰하지
 * 못해 SP가 "저는 직접 접속할 수 없습니다"라며 이용자에게 조회를 떠넘기는
 * 사례를 실제로 확인했다(모델이 자기 태그의 실행이 보장되는지 확신하지
 * 못해 스스로 포기하는 패턴). 국토부 실거래가만큼은 이미 검증된
 * molit-client.js(apt_trade, 2026-09-29 실 호출 검증됨)가 있으므로, 이
 * 데이터에 한해 LLM의 판단에 맡기지 않고 **대화 중 사람이 `/molit` 명령
 * 으로 코드가 직접 조회한 값을 주입**한다 — "LLM은 계산하지 않는다"는
 * 원칙을 "LLM은 이 데이터를 직접 가져오지도 않는다"로 확장한 것.
 *
 * 사용법:
 *   node scripts/kestate/sp24a-dry-run.mjs
 * (hondi-proxy 호출에 별도 API 키는 필요 없다 — DEEPSEEK_API_KEY·
 * WEB_SEARCH_API_KEY는 이미 Cloudflare Worker 시크릿으로 설정돼 있다.
 * /molit 명령을 쓰려면 MOLIT_SERVICE_KEY 환경변수가 필요하다.)
 *
 * 대화 중 사용할 수 있는 명령:
 *   /molit <법정동코드 5자리> <계약년월 YYYYMM>
 *     — molit-client.js로 실제 아파트 매매 실거래가를 조회해 대화에
 *       주입한다(현재 apt_trade만 지원 — 다른 유형은 End Point 미확인).
 */
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stagedValuation } from '../../src/gopang/ai/hondi-staged-valuation.js';
import { fetchTrades } from '../../src/gopang/verification/molit-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const PROMPT_PATH = join(REPO_ROOT, 'prompts', 'SP-24a_kestate_appraisal_v0_1.txt');
const WORKER_URL = 'https://hondi-proxy.tensor-city.workers.dev';
// ALLOWED_ORIGINS에 있는 값이면 무엇이든 된다(worker.js 확인) — 이 CLI는
// 브라우저가 아니라 Origin 헤더가 안 붙으므로 명시적으로 넣어준다.
const FAKE_ORIGIN = 'https://hondi.net';

const MAX_WEB_SEARCH_HOPS = 6; // 한 턴 안에서 SP가 연속으로 검색을 반복할 때의 안전판
const MAX_TURNS = 40; // 대화가 끝없이 이어지는 걸 막는 안전판

// ★ 2026-09-29 실행 검증 중 발견 — SP-24a는 규칙이 많은 긴 시스템
// 프롬프트라 deepseek-v4-flash(추론형)가 reasoning_content에 토큰을
// 다 쓰고 최종 답변(content)을 한 글자도 못 낸 채 finish_reason=
// "length"로 끝나는 사례를 실제로 확인했다(1800으로 시작, 추론만
// 1800 토큰을 다 씀). max_tokens를 넉넉히 잡고, 그래도 모자라면 자동으로
// 한 단계 더 올려 재시도한다(이 스크립트는 사람이 수동으로 돌리는
// 검증용 CLI라 비용보다 검증 완주가 우선).
const INITIAL_MAX_TOKENS = 6000;
const RETRY_MAX_TOKENS = 12000;

function loadSystemPrompt() {
  return readFileSync(PROMPT_PATH, 'utf8');
}

/** DeepSeek가 reasoning_content만 채우고 content 없이 length로 끝났는지 판별. */
function isReasoningExhausted(rawErrorMessage) {
  return (
    typeof rawErrorMessage === 'string' &&
    rawErrorMessage.includes('"finish_reason":"length"') &&
    rawErrorMessage.includes('"content":""')
  );
}

async function callChatOnce(system, messages, maxTokens) {
  const res = await fetch(`${WORKER_URL}/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: FAKE_ORIGIN },
    body: JSON.stringify({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      system,
      messages,
      max_tokens: maxTokens,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || JSON.stringify(data);
    const err = new Error(`/ai/chat HTTP ${res.status}: ${msg}`);
    err.raw = msg;
    throw err;
  }
  if (!data.content) {
    const err = new Error(`/ai/chat 응답에 content 없음: ${JSON.stringify(data)}`);
    err.raw = JSON.stringify(data);
    throw err;
  }
  return data.content;
}

async function callChat(system, messages) {
  try {
    return await callChatOnce(system, messages, INITIAL_MAX_TOKENS);
  } catch (e) {
    if (isReasoningExhausted(e.raw)) {
      console.warn(
        `  [경고] 모델이 추론(reasoning)에 max_tokens(${INITIAL_MAX_TOKENS})를 전부 쓰고 답변을 못 냈습니다 — ` +
          `max_tokens=${RETRY_MAX_TOKENS}로 재시도합니다.`
      );
      return await callChatOnce(system, messages, RETRY_MAX_TOKENS);
    }
    throw e;
  }
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

/** /molit <lawdCd> <dealYmd> 명령을 실제 조회 → 대화 주입 텍스트로 변환. */
async function fetchMolitInjection(lawdCd, dealYmd) {
  const serviceKey = process.env.MOLIT_SERVICE_KEY;
  if (!serviceKey) {
    return null;
  }
  const result = await fetchTrades('apt_trade', { lawdCd, dealYmd, serviceKey });
  const items = result.items || [];
  const lines = items.slice(0, 15).map((it) => {
    const amt = String(it.dealAmount || '').replace(/\s/g, '');
    const date = `${it.dealYear}-${String(it.dealMonth).padStart(2, '0')}-${String(it.dealDay).padStart(2, '0')}`;
    return `- ${it.aptNm || '(단지명 없음)'} · 전용 ${it.excluUseAr}㎡ · ${it.floor}층 · ${date} · ${amt}만원`;
  });
  const today = new Date().toISOString().slice(0, 10);
  return (
    `[국토부 실거래가 API 조회 결과 — 출처: 공공데이터포털 실거래가 공개시스템(molit-client.js, apt_trade), 조회일 ${today}] ` +
    `법정동코드 ${lawdCd}, 계약년월 ${dealYmd}, 총 ${items.length}건 중 최근 ${lines.length}건:\n` +
    (lines.length > 0 ? lines.join('\n') : '(해당 조건 조회 결과 0건)') +
    `\n\n이 값은 실제로 API에서 조회된 데이터입니다(추측 아님). 이 중 대상 물건과 조건이 ` +
    `비슷하고 최근 12개월 이내인 거래를 comps로 채택하십시오. index_at_txn(지수)은 ` +
    `여전히 실제로 확인된 값만 반영하고, 확인되지 않으면 null로 두십시오 — 이 조회 결과에는 ` +
    `지수가 포함돼 있지 않습니다.`
  );
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
  console.log('당신은 "이용자" 역할입니다. SP의 질문에 실제 답을 입력하세요.');
  console.log('명령: /molit <법정동코드 5자리> <계약년월 YYYYMM> — 실제 실거래가 조회 후 대화에 주입\n');

  let pendingReplyNeeded = true;

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    if (pendingReplyNeeded) {
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
    }

    const userInput = await rl.question('나: ');
    if (!userInput.trim()) {
      console.log('(빈 입력 — 종료)');
      break;
    }

    const molitMatch = userInput.trim().match(/^\/molit\s+(\d{5})\s+(\d{6})\s*$/);
    if (molitMatch) {
      const [, lawdCd, dealYmd] = molitMatch;
      if (!process.env.MOLIT_SERVICE_KEY) {
        console.log('MOLIT_SERVICE_KEY 환경변수가 설정돼 있지 않습니다. /molit 명령을 쓰려면 먼저 설정하세요.\n');
        pendingReplyNeeded = false;
        continue;
      }
      console.log(`  [MOLIT] 법정동코드 ${lawdCd}, 계약년월 ${dealYmd} 조회 중...`);
      let injection;
      try {
        injection = await fetchMolitInjection(lawdCd, dealYmd);
      } catch (e) {
        console.log(`  [MOLIT 오류] ${e.message}\n`);
        pendingReplyNeeded = false;
        continue;
      }
      messages.push({ role: 'user', content: injection });
      pendingReplyNeeded = true;
      continue;
    }

    messages.push({ role: 'user', content: userInput });
    pendingReplyNeeded = true;
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
