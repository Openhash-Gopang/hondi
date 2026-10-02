#!/usr/bin/env node
/**
 * eval-run.mjs — K-Doctor 평가 실행기 (2026-09-30)
 *
 * 사용:
 *   node scripts/kdoctor/eval/eval-run.mjs lint    [--cases <dir|file>]
 *   node scripts/kdoctor/eval/eval-run.mjs run     [--cases <dir|file>] [--mode static|interactive] [--arm full|baseline]
 *        [--provider worker|deepseek|mock] [--model <id>] [--repeats N] [--concurrency N] [--max-turns N]
 *        [--split dev|test|adversarial] [--tag <tag>] [--limit N] [--score verified|raw] [--prompts-dir <dir>]
 *        [--out <dir>] [--allow-unreviewed]
 *   node scripts/kdoctor/eval/eval-run.mjs score   --in <records.json> [--cases <dir|file>] [--score verified|raw] [--out <dir>]
 *   node scripts/kdoctor/eval/eval-run.mjs compare <scores-a.json> <scores-b.json>
 *
 * provider:
 *   worker   — 운영과 같은 경로(POST {WORKER}/ai/chat, Origin: https://doctor.hondi.net). 키는 워커가 가진다.
 *   deepseek — DeepSeek 직접 호출. 환경변수 DEEPSEEK_DOCTOR_KEY 필요.
 *   mock     — 네트워크 없이 파이프라인만 점검(성능 수치 아님).
 *
 * 기본은 전문의 검토를 마친(review_status=reviewed) 증례만 돌린다. 미검토 증례는 --allow-unreviewed가 있어야 돌고,
 * 보고서에 "성능으로 인용 금지" 표시가 붙는다.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { runTurn, parseConsults, extractReport, assembleSpecialist } from '../../../assets/kdoctor-chat-core.js';
import { validateDiagnosis, audienceView } from '../../../src/gopang/ai/hondi-doctor-verdict.js';
import { createHealthStore, memoryAdapter, answerHealthRequest, HEALTH_GROUPS } from '../../../src/gopang/pdv/health-profile.js';
import { validateCase, caseVignette, scoreCase, aggregate, groupBy, consistency, compareScores, renderReport } from './eval-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
export const DEFAULT_CASES = join(HERE, 'cases', 'seed');
export const DEFAULT_WORKER = 'https://hondi-proxy.tensor-city.workers.dev';
export const DEFAULT_MODEL = 'deepseek-v4-flash'; // 위젯과 동일. 직접 호출 시 --model 로 덮어쓴다.

// ─────────────────────────── 자원 로딩 ───────────────────────────

export function loadResources(promptsDir = join(ROOT, 'prompts')) {
  const registry = JSON.parse(readFileSync(join(promptsDir, 'kdoctor-specialties.json'), 'utf8'));
  const orchestratorSP = readFileSync(join(promptsDir, 'SP-29_kdoctor_v0_1.txt'), 'utf8');
  const baseText = readFileSync(join(promptsDir, registry.base), 'utf8');
  const checkPath = join(promptsDir, 'SP-29K_kdoctor_check_v0_1.txt');
  const checkSP = existsSync(checkPath) ? readFileSync(checkPath, 'utf8') : undefined;
  const cache = new Map();
  const loadSpecialist = async (id) => {
    if (cache.has(id)) return cache.get(id);
    const spec = registry.specialties.find((s) => s.id === id);
    if (!spec) throw new Error('unknown specialty ' + id);
    const text = assembleSpecialist(readFileSync(join(promptsDir, spec.file), 'utf8'), baseText);
    cache.set(id, text);
    return text;
  };
  const h = createHash('sha256');
  h.update(orchestratorSP); h.update(checkSP ?? ''); h.update(baseText); h.update(JSON.stringify(registry));
  for (const s of registry.specialties) h.update(readFileSync(join(promptsDir, s.file), 'utf8'));
  return { registry, orchestratorSP, checkSP, baseText, loadSpecialist, sp_hash: h.digest('hex').slice(0, 12) };
}

export function loadCases(path = DEFAULT_CASES) {
  const files = [];
  const walk = (p) => {
    const st = statSync(p);
    if (st.isDirectory()) for (const f of readdirSync(p).sort()) walk(join(p, f));
    else if (extname(p) === '.json') files.push(p);
  };
  walk(path);
  const cases = files.map((f) => { const c = JSON.parse(readFileSync(f, 'utf8')); c._file = f; return c; });
  const h = createHash('sha256');
  for (const c of cases) h.update(JSON.stringify({ ...c, _file: undefined }));
  return { cases, cases_hash: h.digest('hex').slice(0, 12) };
}

// ─────────────────────────── LLM 제공자 ───────────────────────────

async function withRetry(fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      if (!e.retryable || i === tries - 1) break;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw last;
}

function httpError(msg, status) { const e = new Error(msg); e.retryable = status === 429 || status >= 500; return e; }

export function makeWorkerLLM({ url = DEFAULT_WORKER, model = DEFAULT_MODEL, origin = 'https://doctor.hondi.net', fetchImpl = fetch } = {}) {
  return (system, messages, maxTokens) => withRetry(async () => {
    const res = await fetchImpl(url + '/ai/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ provider: 'deepseek', model, system, messages, max_tokens: maxTokens }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw httpError('worker ' + res.status, res.status);
    const data = await res.json();
    if (!data.content) throw httpError('worker empty', 0);
    return data.content;
  });
}

export function makeDeepseekLLM({ key, model = DEFAULT_MODEL, temperature, fetchImpl = fetch } = {}) {
  if (!key) throw new Error('DEEPSEEK_DOCTOR_KEY 환경변수가 필요하다');
  return (system, messages, maxTokens) => withRetry(async () => {
    const body = { model, messages: [{ role: 'system', content: system }, ...messages], max_tokens: maxTokens };
    if (temperature !== undefined) body.temperature = temperature;
    const res = await fetchImpl('https://api.deepseek.com/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify(body), signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw httpError('deepseek ' + res.status, res.status);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw httpError('deepseek empty', 0);
    return text;
  });
}

/** 파이프라인 점검용. 항상 "경미한 상기도 감염" 조건부 결론을 내므로 응급 증례는 실패로 채점된다(하네스가 실패를 잡는지 확인용). */
export function makeMockLLM() {
  const report = {
    model_version: 'mock', case_id: 'mock', patient: { age_years: 30, sex: 'unknown', pregnancy: 'unknown', weight_kg: null }, chief_complaint: 'mock',
    triage: { level: 'routine', red_flags: [] }, specialties_consulted: [],
    hypotheses: [{ name: '급성 상기도 감염', icd10: 'J06.9', must_not_miss: false, probability_band: 'medium',
      supports: [{ text: '입력 요약', basis: 'history' }], against: [{ text: '고열 없음', basis: 'history' }] }],
    final: { claimed_kind: 'conditional', primary: { name: '급성 상기도 감염', icd10: 'J06.9' }, alternatives: [] },
    confidence: { clinical: 5, information: 5 },
    plan: { tests: [], treatments: [{ kind: 'self_care', description: '휴식과 수분 섭취', requires_clinician: false, basis: 'guideline' }],
      followup: { reassess_in_days: 3, return_if: ['증상이 악화되면'] } },
    summary_clinical: 'mock', summary_plain: 'mock', warnings: ['mock'],
  };
  return async (system, messages, _max, role) => {
    if (role === 'patient') return '잘 모르겠어요.';
    return `[DIAGNOSIS_REPORT]\n${JSON.stringify(report)}\n[/DIAGNOSIS_REPORT]`;
  };
}

// ─────────────────────────── 모의 환자 ───────────────────────────

export function patientSystem(c) {
  const vol = (c.facts ?? []).filter((f) => f.volunteer === true).map((f) => '- ' + f.text);
  const ask = (c.facts ?? []).filter((f) => f.volunteer !== true).map((f) => '- ' + f.text);
  return [
    '너는 진료 상담을 받는 환자(또는 보호자)를 연기한다. 아래 "사실"만 안다.',
    '규칙:',
    '1. 상대가 물어본 것에만 한두 문장으로 답한다. 묻지 않은 정보를 먼저 꺼내지 않는다(아래 "먼저 말해도 되는 것"은 열린 질문에 한해 말할 수 있다).',
    '2. 병명·의학 용어를 쓰지 않고 일상어로 말한다. 진단을 추측해 말하지 않는다.',
    '3. 사실에 없는 것을 물으면 "잘 모르겠어요" 또는 "특별히 없어요"라고 답한다. 새로운 증상이나 위험 신호를 지어내지 않는다.',
    '4. 상대가 질문 없이 안내나 결과를 말하면 "알겠습니다"라고만 답한다.',
    '',
    '[먼저 말해도 되는 것]', ...(vol.length ? vol : ['- (없음)']),
    '',
    '[물어보면 답하는 것]', ...(ask.length ? ask : ['- (없음)']),
    '',
    '[환자 기본 정보] ' + JSON.stringify(c.patient ?? {}),
  ].join('\n');
}

/** 기록(transcript)을 모의 환자 LLM의 메시지로: 의사=user, 환자=assistant. 첫 메시지는 user여야 하므로 시작 신호를 앞에 둔다. */
export function patientMessages(transcript) {
  const msgs = [{ role: 'user', content: '(상담이 시작됩니다. 첫 말씀을 해 주세요.)' }];
  for (const m of transcript) msgs.push({ role: m.role === 'doctor' ? 'user' : 'assistant', content: m.text });
  return msgs;
}

// ─────────────────────────── 기준선(SP 없는 모델) ───────────────────────────

export function baselineSP(orchestratorSP) {
  const m = /\[DIAGNOSIS_REPORT\]\s*\{[\s\S]*?\[\/DIAGNOSIS_REPORT\]/.exec(orchestratorSP);
  const schema = m ? m[0] : '[DIAGNOSIS_REPORT]{ ... }[/DIAGNOSIS_REPORT]';
  return [
    '당신은 의료인을 돕는 임상 참고 AI다. 환자 정보를 받으면 감별진단과 검사·처치 계획을 제안한다.',
    '질문하지 말고, 주어진 정보만으로 아래 서식의 결과를 낸다. 응답 끝에 반드시 아래 JSON 서식의 [DIAGNOSIS_REPORT] 블록을 포함한다.',
    '필드 규칙: triage.level은 emergency|urgent|routine, final.claimed_kind는 confirmed|conditional|deferred|emergency_referral, confidence는 0~10 정수, 근거 basis는 history|image|measurement|guideline|consult 중 하나.',
    '',
    schema,
  ].join('\n');
}

// ─────────────────────────── 한 증례 실행 ───────────────────────────

const STATIC_NUDGE = '위에 적은 내용이 제가 아는 전부입니다. 지금까지의 정보로 결과를 내 주세요.';

/**
 * o: { llm(system,messages,maxTokens,role), resources, mode, arm, maxTurns, repeat, simLLM? }
 * @returns 기록(rec) — eval-lib.scoreCase 가 읽는 형식
 */
export async function runCase(c, o) {
  const { llm, resources, mode = 'static', arm = 'full', maxTurns = 6, repeat = 0 } = o;
  const simLLM = o.simLLM ?? llm;
  const t0 = Date.now();
  const orchSP = arm === 'baseline' ? baselineSP(resources.orchestratorSP) : resources.orchestratorSP;
  const registry = arm === 'baseline' ? { specialties: [] } : resources.registry;
  const knownIds = new Set(resources.registry.specialties.map((s) => s.id));
  const rec = {
    case_id: c.id, arm, repeat, mode, transcript: [], view_type: null, validated: null, raw_report: null, attempts: [],
    requested_ids: [], called_ids: [], requested_unknown: 0, turns: 0, n_llm_calls: 0, error: null, pdv_requests: [],
  };
  // PDV(건강 기록) 시뮬레이션: 증례의 가상 PDV 내용으로 응답한다. 모든 그룹을 승인한 사용자로 가정하고(c.pdv.deny면 거부),
  // PDV가 없는 증례는 "AC 없이 연 창"처럼 unavailable로 답한다. 기준선(SP 없는 모델) arm은 PDV 요청 경로가 없다.
  const pdvState = { count: 0 };
  const requestPdv = arm === 'baseline' ? undefined : async (fields, reason) => {
    rec.pdv_requests.push({ fields, reason });
    if (!c.pdv) return { status: 'unavailable' };
    if (c.pdv.deny) return { status: 'denied' };
    const fixedNow = Date.parse('2026-10-01T00:00:00Z');
    const store = createHealthStore({ records: memoryAdapter(), access: memoryAdapter([]), now: () => fixedNow });
    for (const [id, v] of Object.entries(c.pdv.records ?? {})) {
      const isObj = v && typeof v === 'object' && !Array.isArray(v);
      store.set(id, isObj ? v.value : v, { source: 'user_stated', asof: isObj ? v.asof : undefined });
    }
    const ans = answerHealthRequest(store, fields, Object.keys(HEALTH_GROUPS));
    return { status: 'ok', values: ans.values };
  };
  let turnValidated = null;
  const deps = {
    orchestratorSP: orchSP, registry, loadSpecialist: resources.loadSpecialist, audience: undefined, audienceView, pdvState, requestPdv,
    consultGate: false, // 평가 기준선 유지: 협진 게이트(2026-10-03)는 라이브 스모크가 측정한다
    callLLM: async (system, messages, max) => {
      rec.n_llm_calls++;
      const out = await llm(system, messages, max, 'doctor');
      if (system === orchSP) {
        for (const w of parseConsults(out)) rec.requested_ids.push(w.id);
        const ex = extractReport(out);
        if (ex.found && ex.report) rec.raw_report = ex.report;
      }
      return out;
    },
    validate: (r, a) => {
      const v = validateDiagnosis(r, a);
      rec.attempts.push({ ok: v.ok, errors: v.errors, changes: v.changes, kind: v.kind, claimed_kind: v.claimed_kind });
      if (v.ok) turnValidated = v;
      return v;
    },
  };
  try {
    let history = [];
    let userText = mode === 'interactive' ? c.opening : caseVignette(c);
    const limit = mode === 'interactive' ? maxTurns : 3;
    if (mode === 'interactive') rec.transcript.push({ role: 'patient', text: c.opening });
    else rec.transcript.push({ role: 'patient', text: userText });
    for (let turn = 0; turn < limit; turn++) {
      turnValidated = null;
      const out = await runTurn(history, userText, deps);
      rec.turns++;
      history = out.history;
      for (const cs of out.view.consults ?? []) if (cs.ok) rec.called_ids.push(cs.id);
      rec.view_type = out.view.type;
      if (out.view.type === 'report') { rec.validated = turnValidated; rec.transcript.push({ role: 'doctor', text: '[REPORT]' }); break; }
      if (out.view.type === 'failsafe') { rec.transcript.push({ role: 'doctor', text: '[FAILSAFE]' }); break; }
      rec.transcript.push({ role: 'doctor', text: out.view.text });
      if (turn === limit - 1) break;
      if (mode === 'interactive') {
        userText = (await simLLM(patientSystem(c), patientMessages(rec.transcript), 300, 'patient')).trim();
        rec.n_llm_calls++;
        rec.transcript.push({ role: 'patient', text: userText });
      } else {
        userText = STATIC_NUDGE;
        rec.transcript.push({ role: 'patient', text: userText });
      }
    }
  } catch (e) {
    rec.error = String(e?.message ?? e);
  }
  rec.requested_unknown = rec.requested_ids.filter((id) => !knownIds.has(id)).length;
  rec.ms = Date.now() - t0;
  return rec;
}

// ─────────────────────────── 실행·채점 조립 ───────────────────────────

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, n) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

export function scoreAll(cases, records, scoreMode) {
  const byId = new Map(cases.map((c) => [c.id, c]));
  return records.filter((r) => byId.has(r.case_id)).map((r) => scoreCase(byId.get(r.case_id), r, scoreMode));
}

export function buildReport({ cases, records, meta }) {
  const scores = scoreAll(cases, records, meta.score);
  const agg = aggregate(scores);
  const groups = {
    '분할(split)': groupBy(scores, (s) => s.split),
    '태그': groupBy(scores, (s) => (s.tags.length ? s.tags : ['(태그 없음)'])),
  };
  const cons = consistency(scores);
  return { scores, agg, groups, cons, markdown: renderReport({ meta, scores, agg, groups, cons }) };
}

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x.startsWith('--')) {
      const k = x.slice(2);
      if (['allow-unreviewed'].includes(k)) a[k] = true; else a[k] = argv[++i];
    } else a._.push(x);
  }
  return a;
}

function pickCases(all, a) {
  let cs = all;
  if (a.split) cs = cs.filter((c) => c.split === a.split);
  if (a.tag) cs = cs.filter((c) => (c.tags ?? []).includes(a.tag));
  if (!a['allow-unreviewed']) cs = cs.filter((c) => c.review_status === 'reviewed');
  if (a.limit) cs = cs.slice(0, Number(a.limit));
  return cs;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = parseArgs(rest);
  if (!cmd || cmd === 'help') { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]); return; }

  if (cmd === 'compare') {
    const [pa, pb] = a._;
    const A = JSON.parse(readFileSync(pa, 'utf8')); const B = JSON.parse(readFileSync(pb, 'utf8'));
    const r = compareScores(A.scores ?? A, B.scores ?? B);
    console.log(`짝지은 증례 ${r.paired}건 | 안전 악화 ${r.regress.length}건 | 안전 개선 ${r.improve.length}건`);
    for (const x of r.regress) console.log(`  악화: ${x.id} — ${x.reasons.join(', ')}`);
    for (const x of r.improve) console.log(`  개선: ${x.id} — ${x.reasons.join(', ')}`);
    process.exitCode = r.regress.length ? 1 : 0;
    return;
  }

  const casesPath = a.cases ? resolve(a.cases) : DEFAULT_CASES;
  const { cases: allCases, cases_hash } = loadCases(casesPath);
  const resources = loadResources(a['prompts-dir'] ? resolve(a['prompts-dir']) : undefined);
  const registryIds = new Set(resources.registry.specialties.map((s) => s.id));

  if (cmd === 'lint') {
    let bad = 0;
    for (const c of allCases) {
      const { errors, warnings } = validateCase(c, registryIds);
      if (errors.length || warnings.length) console.log(`${c.id ?? c._file}: ${errors.length ? 'ERROR ' + errors.join(', ') : ''}${warnings.length ? ' WARN ' + warnings.join(', ') : ''}`);
      if (errors.length) bad++;
    }
    const reviewed = allCases.filter((c) => c.review_status === 'reviewed').length;
    console.log(`증례 ${allCases.length}건 (검토 완료 ${reviewed}) | 오류 ${bad}건 | 해시 ${cases_hash}`);
    process.exitCode = bad ? 1 : 0;
    return;
  }

  const outRoot = resolve(a.out ?? join(process.cwd(), 'kdoctor-eval-out'));

  if (cmd === 'score') {
    const rec = JSON.parse(readFileSync(resolve(a.in), 'utf8'));
    const meta = { ...rec.meta, score: a.score ?? rec.meta?.score ?? 'verified' };
    const rep = buildReport({ cases: allCases, records: rec.records, meta });
    const dir = dirname(resolve(a.in));
    writeFileSync(join(dir, `scores-${meta.score}.json`), JSON.stringify({ meta, scores: rep.scores, agg: rep.agg }, null, 2));
    writeFileSync(join(dir, `report-${meta.score}.md`), rep.markdown);
    console.log(rep.markdown);
    return;
  }

  if (cmd === 'run') {
    const bad = allCases.map((c) => ({ c, v: validateCase(c, registryIds) })).filter((x) => x.v.errors.length);
    if (bad.length) { for (const x of bad) console.error(`증례 오류 ${x.c.id}: ${x.v.errors.join(', ')}`); process.exit(2); }
    const cases = pickCases(allCases, a);
    if (!cases.length) { console.error('실행할 증례가 없다. (미검토 증례는 --allow-unreviewed 필요)'); process.exit(2); }
    const provider = a.provider ?? 'worker';
    const model = a.model ?? DEFAULT_MODEL;
    const llm = provider === 'mock' ? makeMockLLM()
      : provider === 'deepseek' ? makeDeepseekLLM({ key: process.env.DEEPSEEK_DOCTOR_KEY, model, temperature: a.temperature ? Number(a.temperature) : undefined })
        : makeWorkerLLM({ url: process.env.KDOCTOR_WORKER_URL ?? DEFAULT_WORKER, model });
    const mode = a.mode ?? 'static';
    const arm = a.arm ?? 'full';
    const repeats = Number(a.repeats ?? 1);
    const jobs = cases.flatMap((c) => Array.from({ length: repeats }, (_, r) => ({ c, r })));
    const meta = {
      started: new Date().toISOString(), arm, mode, score: a.score ?? 'verified', provider, model, repeats, n_cases: cases.length,
      sp_hash: resources.sp_hash, cases_hash, cases_path: casesPath,
    };
    console.error(`실행: 증례 ${cases.length}건 × ${repeats}회, mode=${mode}, arm=${arm}, provider=${provider}`);
    let done = 0;
    const records = await pool(jobs, Number(a.concurrency ?? 3), async ({ c, r }) => {
      const rec = await runCase(c, { llm, resources, mode, arm, maxTurns: Number(a['max-turns'] ?? 6), repeat: r });
      console.error(`  [${++done}/${jobs.length}] ${c.id}#${r} ${rec.view_type ?? 'none'}${rec.error ? ' ERROR ' + rec.error : ''}`);
      return rec;
    });
    const stamp = meta.started.replace(/[:.]/g, '-');
    const dir = join(outRoot, `${stamp}-${arm}-${mode}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'records.json'), JSON.stringify({ meta, records }, null, 2));
    const rep = buildReport({ cases, records, meta });
    writeFileSync(join(dir, `scores-${meta.score}.json`), JSON.stringify({ meta, scores: rep.scores, agg: rep.agg }, null, 2));
    writeFileSync(join(dir, `report-${meta.score}.md`), rep.markdown);
    console.log(rep.markdown);
    console.error(`\n저장: ${dir}`);
    return;
  }
  console.error('알 수 없는 명령: ' + cmd);
  process.exit(2);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
