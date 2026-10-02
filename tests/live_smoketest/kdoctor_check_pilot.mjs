#!/usr/bin/env node
/**
 * kdoctor_check_pilot.mjs — K-Doctor-Check(검수 SP) 오류 주입 파일럿 (2026-10-02)
 *
 * K-Law-Check가 616497(조문 환각)·617151(프레임 대체) 사례로 먼저 검증된 것과 같은 방식이다.
 * 일부러 결함을 심은 보고서(지어낸 용량, 대상 값 불일치, must-not-miss 누락 …)와 정상 대조 보고서를 검수 SP에 주고
 * 기대 모듈이 지적을 내는지, 정상 보고서는 통과시키는지 잰다.
 *
 * 사용: DEEPSEEK_CHECK_KEY=sk-... node kdoctor_check_pilot.mjs [--cases check_pilot_cases_20261002.json] [--out ../../results/kdoctor-check-pilot] [--repeat 1] [--provider deepseek|mock]
 * 채점: seeded → 지적(HIGH 또는 MED) 중 expected_modules에 속하는 것이 있고 판정이 '재검토 불요'가 아니면 DETECTED.
 *       clean  → 판정이 '재검토 불요'이고 HIGH 지적이 없으면 CLEAN-OK, 아니면 FALSE-ALARM.
 *       판정 줄이 없으면 UNPARSED.
 */
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCheckInput, parseCheckVerdict } from '../../assets/kdoctor-chat-core.js';
import { makeDeepseekLLM, parseArgs, MODEL_DEFAULT } from './kdoctor_consult_live_smoketest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

export function scoreCheck(c, parsed) {
  if (!parsed.verdict) return { status: 'UNPARSED' };
  const strong = parsed.findings.filter((f) => f.severity === 'HIGH' || f.severity === 'MED');
  if (c.kind === 'clean') {
    const high = parsed.findings.filter((f) => f.severity === 'HIGH');
    return parsed.verdict === '재검토 불요' && !high.length ? { status: 'CLEAN-OK' } : { status: 'FALSE-ALARM', verdict: parsed.verdict };
  }
  const hit = strong.filter((f) => c.expected_modules.includes(f.module));
  const any = strong.length > 0;
  if (hit.length && parsed.verdict !== '재검토 불요') return { status: 'DETECTED', modules: [...new Set(hit.map((f) => f.module))] };
  if (any && parsed.verdict !== '재검토 불요') return { status: 'DETECTED-OTHER-MODULE', modules: [...new Set(strong.map((f) => f.module))] };
  return { status: 'MISSED' };
}

export function summarizePilot(rows) {
  const seeded = rows.filter((r) => r.kind === 'seeded'), clean = rows.filter((r) => r.kind === 'clean');
  const n = (rs, s) => rs.filter((r) => r.score.status === s).length;
  return {
    seeded: { n: seeded.length, detected: n(seeded, 'DETECTED'), detected_other_module: n(seeded, 'DETECTED-OTHER-MODULE'), missed: n(seeded, 'MISSED'), unparsed: n(seeded, 'UNPARSED') },
    clean: { n: clean.length, ok: n(clean, 'CLEAN-OK'), false_alarm: n(clean, 'FALSE-ALARM'), unparsed: n(clean, 'UNPARSED') },
  };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const cases = JSON.parse(readFileSync(resolve(HERE, a.cases ?? 'check_pilot_cases_20261002.json'), 'utf8'));
  const outDir = resolve(HERE, a.out ?? '../../results/kdoctor-check-pilot');
  mkdirSync(outDir, { recursive: true });
  const checkSP = readFileSync(join(ROOT, 'prompts/SP-29K_kdoctor_check_v0_1.txt'), 'utf8');
  const provider = a.provider ?? 'deepseek';
  const key = process.env.DEEPSEEK_CHECK_KEY || process.env.DEEPSEEK_DOCTOR_KEY || process.env.DEEPSEEK_API_KEY;
  const llm = provider === 'deepseek' ? makeDeepseekLLM({ key, model: a.model ?? MODEL_DEFAULT }) : async () => '[CHECK_VERDICT: 재검토 불요 | 지적 0건]';
  const repeat = Number(a.repeat ?? 1);
  const rows = [];
  for (let k = 0; k < repeat; k++) {
    for (const c of cases) {
      let text = '', err = null;
      try { text = await llm(checkSP, [{ role: 'user', content: buildCheckInput({ caseText: c.case_text, consultTexts: c.consult_texts, report: c.report }) }], 4000, 'check', {}); }
      catch (e) { err = String(e?.message ?? e); }
      const parsed = parseCheckVerdict(text);
      const row = { id: c.id, kind: c.kind, expected_modules: c.expected_modules, run: k + 1, verdict: parsed.verdict, findings: parsed.findings, score: err ? { status: 'ERROR', error: err } : scoreCheck(c, parsed), text };
      rows.push(row);
      appendFileSync(join(outDir, 'pilot_results.jsonl'), JSON.stringify(row) + '\n');
      console.log(`${row.score.status.padEnd(22)} ${c.id} verdict=${parsed.verdict ?? '-'} findings=${parsed.findings.map((f) => f.module + ':' + f.severity).join(',') || '-'}`);
    }
  }
  const summary = summarizePilot(rows);
  const md = ['# K-Doctor-Check 오류 주입 파일럿', '', `결함 보고서 ${summary.seeded.n}건 — 기대 모듈 검출 ${summary.seeded.detected} / 다른 모듈로 검출 ${summary.seeded.detected_other_module} / 놓침 ${summary.seeded.missed} / 판정 파싱 실패 ${summary.seeded.unparsed}`,
    `정상 대조 ${summary.clean.n}건 — 통과 ${summary.clean.ok} / 오경보 ${summary.clean.false_alarm} / 파싱 실패 ${summary.clean.unparsed}`, '',
    '| id | 종류 | 점수 | 판정 | 지적 |', '|---|---|---|---|---|', ...rows.map((r) => `| ${r.id} | ${r.kind} | ${r.score.status} | ${r.verdict ?? '-'} | ${r.findings.map((f) => f.module + '/' + f.severity).join(', ') || '-'} |`)].join('\n') + '\n';
  writeFileSync(join(outDir, 'pilot_summary.json'), JSON.stringify({ ...summary, model: a.model ?? MODEL_DEFAULT, provider, separate_key: !!process.env.DEEPSEEK_CHECK_KEY }, null, 2));
  writeFileSync(join(outDir, 'pilot_summary.md'), md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  console.log('\n' + md);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
