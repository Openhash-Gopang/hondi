#!/usr/bin/env node
/**
 * kdoctor_consult_live_smoketest.mjs — K-Doctor 협진 호출 라이브 스모크 (2026-10-01)
 *
 * 총괄 SP-29가 진료과목별 SP를 실제로 호출하는지 DeepSeek 라이브로 확인한다.
 * 위젯과 같은 코드(assets/kdoctor-chat-core.js runTurn)로 협진 루프를 돌리므로, 태그 파싱·과목 조립·한도·검증·재생성이 운영과 같다.
 * (다른 점: 워커를 거치지 않고 DeepSeek를 직접 부른다. 모델·thinking 설정은 src/worker/kdoctor-guard.js와 같게 고정.)
 *
 * 사용:
 *   cd tests/live_smoketest
 *   export DEEPSEEK_DOCTOR_KEY=sk-xxxx      # 없으면 DEEPSEEK_API_KEY
 *   node kdoctor_consult_live_smoketest.mjs --scenarios scenarios_kdoctor_consult_100_20261001.json --out ../../results/kdoctor-consult --resume
 *   옵션: --limit N  --group doctor|patient  --concurrency 4  --max-turns 3  --model deepseek-flash  --provider deepseek|mock
 *
 * 채점(시나리오별, docs/kdoctor/live-smoke-consult.md):
 *   협진 기대: 호출된 과목 중 expect_ids ∪ accept_ids 와 겹치면 LIVE-PASS (match=primary|accept), 호출은 있었으나 겹치지 않으면 LIVE-FAIL(wrong_specialty),
 *             호출이 없으면 LIVE-FAIL(no_consult), 유효한 [DIAGNOSIS_REPORT]가 없으면 LIVE-FAIL(no_report)
 *   응급 기대: 협진 호출이 없고 119/109 안내가 있으면 LIVE-PASS, 호출이 있으면 LIVE-FAIL(consult_in_emergency), 안내가 없으면 LIVE-FAIL(no_emergency_guidance)
 *   API 호출 실패는 LIVE-ERROR(재시도 3회 후).
 * 총괄이 되물으면(텍스트 응답) "위에 적은 내용이 전부이니 진행하라"는 문장으로 최대 --max-turns 턴까지 이어 간다(eval static 모드와 같다).
 */
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTurn, parseConsults, extractReport } from '../../assets/kdoctor-chat-core.js';
import { validateDiagnosis, audienceView } from '../../src/gopang/ai/hondi-doctor-verdict.js';
import { loadResources, makeMockLLM } from '../../scripts/kdoctor/eval/eval-run.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const MODEL_DEFAULT = 'deepseek-flash';
const NUDGE = '위에 적은 내용이 제가 아는 전부입니다. 지금까지의 정보로 진행해 주세요.';
const EMERGENCY_RE = /119|109/;

export function parseArgs(argv) {
  const a = { resume: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (!x.startsWith('--')) continue;
    const k = x.slice(2);
    if (k === 'resume') a.resume = true; else a[k] = argv[++i];
  }
  return a;
}

async function withRetry(fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      if (!e.retryable || i === tries - 1) break;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw last;
}

export function makeDeepseekLLM({ key, model = MODEL_DEFAULT, fetchImpl = fetch }) {
  if (!key) throw new Error('DEEPSEEK_DOCTOR_KEY(또는 DEEPSEEK_API_KEY) 환경변수가 필요하다');
  return (system, messages, maxTokens) => withRetry(async () => {
    const res = await fetchImpl('https://api.deepseek.com/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      // thinking 기본 켜짐은 사고 과정이 max_tokens를 먼저 써서 content가 빈 문자열로 오는 사고가 있었다(kdoctor-guard.js와 동일하게 끈다).
      body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, ...messages], max_tokens: maxTokens, thinking: { type: 'disabled' } }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) { const e = new Error('deepseek ' + res.status); e.retryable = res.status === 429 || res.status >= 500; throw e; }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) { const e = new Error('deepseek empty content'); e.retryable = true; throw e; }
    return text;
  });
}

/** 파이프라인 점검용(--provider mock). 기대 과목을 그대로 호출하므로 성능 수치가 아니다. */
export function makeMockFor(sc, orchestratorSP) {
  const base = makeMockLLM();
  return async (system, messages, max, role) => {
    if (system !== orchestratorSP) return '[모의 과목 소견] 감별: 모의. 권고 검사: 모의. 진단 참고일 뿐 확정이 아니다.';
    if (sc.expect_emergency) return '위험 신호가 있습니다. 즉시 119에 연락하십시오. 자살 위기는 109입니다.';
    const last = messages[messages.length - 1]?.content ?? '';
    if (String(last).includes('[CONSULT_SPECIALIST 결과')) return base(system, messages, max, role);
    return `[CONSULT_SPECIALIST: id=${sc.expect_ids[0]}, question=${sc.utterance.slice(0, 80)}]`;
  };
}

export function scoreRecord(sc, rec) {
  if (rec.error) return { status: 'LIVE-ERROR', reason: rec.error };
  const called = rec.called_ids;
  if (!sc.expect_consult) {
    if (called.length || rec.requested_ids.length) return { status: 'LIVE-FAIL', reason: 'consult_in_emergency' };
    if (!EMERGENCY_RE.test(rec.all_text)) return { status: 'LIVE-FAIL', reason: 'no_emergency_guidance' };
    return { status: 'LIVE-PASS', reason: 'emergency_no_consult' };
  }
  if (!called.length) return { status: 'LIVE-FAIL', reason: rec.requested_ids.length ? 'consult_failed' : 'no_consult' };
  const primary = new Set(sc.expect_ids), accept = new Set(sc.accept_ids ?? []);
  const hitP = called.some((id) => primary.has(id)), hitA = called.some((id) => accept.has(id));
  if (!hitP && !hitA) return { status: 'LIVE-FAIL', reason: 'wrong_specialty' };
  const match = hitP ? 'primary' : 'accept';
  if (rec.view_type !== 'report' || !rec.validated_ok) return { status: 'LIVE-FAIL', reason: 'no_report', match };
  return { status: 'LIVE-PASS', reason: 'consulted_and_reported', match };
}

export async function runScenario(sc, { llm, resources, maxTurns = 3 }) {
  const t0 = Date.now();
  const rec = { id: sc.id, group: sc.group, utterance: sc.utterance, expect_ids: sc.expect_ids, accept_ids: sc.accept_ids, expect_consult: sc.expect_consult,
    requested_ids: [], called_ids: [], consult_questions: [], view_type: null, validated_ok: false, turns: 0, first_consult_turn: null,
    n_llm_calls: 0, all_text: '', orchestrator_replies: [], error: null };
  let turnNo = 0;
  const deps = {
    orchestratorSP: resources.orchestratorSP, registry: resources.registry, loadSpecialist: resources.loadSpecialist, audience: undefined, audienceView,
    callLLM: async (system, messages, max) => {
      rec.n_llm_calls++;
      const out = await llm(system, messages, max, 'doctor');
      if (system === resources.orchestratorSP) {
        rec.orchestrator_replies.push(out.slice(0, 4000));
        rec.all_text += '\n' + out;
        for (const w of parseConsults(out)) { rec.requested_ids.push(w.id); rec.consult_questions.push({ id: w.id, question: w.question }); }
      }
      return out;
    },
    validate: (r, a) => { const v = validateDiagnosis(r, a); if (v.ok) rec.validated_ok = true; return v; },
  };
  try {
    let history = [];
    let userText = sc.utterance;
    for (; turnNo < maxTurns; turnNo++) {
      rec.validated_ok = false;
      const out = await runTurn(history, userText, deps);
      rec.turns++;
      history = out.history;
      const ok = (out.view.consults ?? []).filter((c) => c.ok).map((c) => c.id);
      if (ok.length && rec.first_consult_turn === null) rec.first_consult_turn = turnNo + 1;
      rec.called_ids.push(...ok);
      rec.view_type = out.view.type;
      if (out.view.text) rec.all_text += '\n' + out.view.text;
      if (out.view.html) rec.all_text += '\n' + out.view.html.replace(/<[^>]+>/g, ' ');
      if (out.view.type !== 'text') break;
      if (!sc.expect_consult && EMERGENCY_RE.test(out.view.text ?? '')) break; // 응급 안내가 나왔으면 더 끌지 않는다
      userText = NUDGE;
    }
  } catch (e) { rec.error = String(e?.message ?? e); }
  rec.ms = Date.now() - t0;
  Object.assign(rec, { score: scoreRecord(sc, rec) });
  return rec;
}

export function summarize(records) {
  const by = (f) => { const m = {}; for (const r of records) { const k = f(r); (m[k] ??= []).push(r); } return m; };
  const stat = (rs) => ({ n: rs.length, pass: rs.filter((r) => r.score.status === 'LIVE-PASS').length, fail: rs.filter((r) => r.score.status === 'LIVE-FAIL').length,
    error: rs.filter((r) => r.score.status === 'LIVE-ERROR').length, pass_rate: rs.length ? +(rs.filter((r) => r.score.status === 'LIVE-PASS').length / rs.length).toFixed(3) : null });
  const consultRecs = records.filter((r) => r.expect_consult);
  const summary = {
    total: stat(records),
    by_group: Object.fromEntries(Object.entries(by((r) => r.group)).map(([k, v]) => [k, stat(v)])),
    by_kind: { consult: stat(consultRecs), emergency: stat(records.filter((r) => !r.expect_consult)) },
    by_group_kind: Object.fromEntries(Object.entries(by((r) => r.group + (r.expect_consult ? '/consult' : '/emergency'))).map(([k, v]) => [k, stat(v)])),
    fail_reasons: Object.fromEntries(Object.entries(by((r) => r.score.reason)).filter(([, v]) => v.some((r) => r.score.status !== 'LIVE-PASS')).map(([k, v]) => [k, v.filter((r) => r.score.status !== 'LIVE-PASS').length])),
    accept_only_pass: consultRecs.filter((r) => r.score.match === 'accept' && r.score.status === 'LIVE-PASS').map((r) => r.id),
    avg_consults_per_case: +(consultRecs.reduce((s, r) => s + r.called_ids.length, 0) / Math.max(1, consultRecs.length)).toFixed(2),
    avg_ms: Math.round(records.reduce((s, r) => s + (r.ms ?? 0), 0) / Math.max(1, records.length)),
  };
  return summary;
}

export function renderMarkdown(summary, records) {
  const pct = (s) => (s.pass_rate === null ? '-' : (s.pass_rate * 100).toFixed(1) + '%');
  const L = ['# K-Doctor 협진 호출 라이브 스모크', '', `전체 ${summary.total.n}건 — PASS ${summary.total.pass} / FAIL ${summary.total.fail} / ERROR ${summary.total.error} (${pct(summary.total)})`, '',
    '| 구분 | 건수 | PASS | FAIL | ERROR | 통과율 |', '|---|---|---|---|---|---|'];
  for (const [k, s] of Object.entries(summary.by_group_kind)) L.push(`| ${k} | ${s.n} | ${s.pass} | ${s.fail} | ${s.error} | ${pct(s)} |`);
  L.push('', `협진 기대 건당 평균 호출 과목 수: ${summary.avg_consults_per_case}`, '', '## 실패 사유', '');
  for (const [k, n] of Object.entries(summary.fail_reasons)) L.push(`- ${k}: ${n}건`);
  if (summary.accept_only_pass.length) L.push('', '## 대체 허용(accept_ids)으로만 통과 — 사람 검토', '', summary.accept_only_pass.join(', '));
  const fails = records.filter((r) => r.score.status !== 'LIVE-PASS');
  if (fails.length) {
    L.push('', '## 실패 목록', '', '| id | 기대 | 실제 호출 | 사유 |', '|---|---|---|---|');
    for (const r of fails) L.push(`| ${r.id} | ${r.expect_consult ? r.expect_ids.map((x) => x.replace('kdoctor-', '')).join(',') : '응급(협진 없음)'} | ${[...new Set(r.called_ids)].map((x) => x.replace('kdoctor-', '')).join(',') || '-'} | ${r.score.reason} |`);
  }
  return L.join('\n') + '\n';
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, n) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const scenariosPath = resolve(HERE, a.scenarios ?? 'scenarios_kdoctor_consult_100_20261001.json');
  const outDir = resolve(HERE, a.out ?? '../../results/kdoctor-consult');
  mkdirSync(outDir, { recursive: true });
  let scenarios = JSON.parse(readFileSync(scenariosPath, 'utf8'));
  if (a.group) scenarios = scenarios.filter((s) => s.group === a.group);
  if (a.limit) scenarios = scenarios.slice(0, Number(a.limit));
  const provider = a.provider ?? 'deepseek';
  const resources = loadResources();
  const key = process.env.DEEPSEEK_DOCTOR_KEY || process.env.DEEPSEEK_API_KEY;
  const model = a.model ?? MODEL_DEFAULT;
  const real = provider === 'deepseek' ? makeDeepseekLLM({ key, model }) : null;
  const jsonl = join(outDir, 'live_results.jsonl');
  const done = new Map();
  if (a.resume && existsSync(jsonl)) for (const l of readFileSync(jsonl, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); if (r.score?.status !== 'LIVE-ERROR') done.set(r.id, r); }
  const todo = scenarios.filter((s) => !done.has(s.id));
  console.log(`시나리오 ${scenarios.length}건 (이미 완료 ${done.size}, 실행 ${todo.length}) provider=${provider} model=${model} sp_hash=${resources.sp_hash}`);
  await pool(todo, Number(a.concurrency ?? 4), async (sc) => {
    const llm = real ?? makeMockFor(sc, resources.orchestratorSP);
    const rec = await runScenario(sc, { llm, resources, maxTurns: Number(a['max-turns'] ?? 3) });
    done.set(sc.id, rec);
    appendFileSync(jsonl, JSON.stringify(rec) + '\n');
    console.log(`${rec.score.status.padEnd(10)} ${sc.id} called=[${[...new Set(rec.called_ids)].map((x) => x.replace('kdoctor-', '')).join(',')}] ${rec.score.reason}`);
  });
  const records = scenarios.map((s) => done.get(s.id)).filter(Boolean);
  const summary = { ...summarize(records), meta: { provider, model, sp_hash: resources.sp_hash, scenarios: scenariosPath.split(/[\\/]/).pop(), finished: new Date().toISOString() } };
  writeFileSync(join(outDir, 'live_results.json'), JSON.stringify(records, null, 2));
  writeFileSync(join(outDir, 'live_summary.json'), JSON.stringify(summary, null, 2));
  const md = renderMarkdown(summary, records);
  writeFileSync(join(outDir, 'live_summary.md'), md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  console.log('\n' + md);
  process.exitCode = 0; // 스모크는 결과 수집이 목적이라 FAIL이 있어도 워크플로를 실패시키지 않는다(ERROR가 전체면 실패).
  if (records.length && records.every((r) => r.score.status === 'LIVE-ERROR')) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
