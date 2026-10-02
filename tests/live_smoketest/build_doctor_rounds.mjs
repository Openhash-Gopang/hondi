#!/usr/bin/env node
/**
 * build_doctor_rounds.mjs — 라이브 스모크 결과를 doctor 저장소의 라운드 페이지 데이터로 옮긴다 (2026-10-02)
 *
 * 사용(hondi 저장소의 tests/live_smoketest에서, results 브랜치를 받은 뒤):
 *   node build_doctor_rounds.mjs --results ../../results/kdoctor-consult-full2 --round 6 --site C:/Users/주피터/Downloads/doctor \
 *        --title "독립 검수·재조정 적용 100건" --date 2026-10-03 --changes "..." --finding "..." --next "..."
 * 하는 일: rounds/rNN/{round-meta.json, results.csv, cases/<id>.json}를 쓰고 rounds-manifest.json에서 해당 라운드를 갱신(없으면 추가)하며
 *          같은 번호의 예정(pending) 항목을 제거한다. 그다음 doctor 저장소에서 PR을 올리면 rounds.html이 새 라운드를 보여 준다.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from './kdoctor_consult_live_smoketest.mjs';

export function buildSlim(rec, detail) {
  const strip = (x) => String(x).replace(/^kdoctor-/, '');
  const d = detail ?? {};
  return { id: rec.id, group: rec.group, utterance: rec.utterance, expect_consult: rec.expect_consult, expect: (rec.expect_ids ?? []).map(strip), accept: (rec.accept_ids ?? []).map(strip),
    called: [...new Set(rec.called_ids)].map(strip), status: rec.score.status, reason: rec.score.reason, match: rec.score.match ?? null, turns: rec.turns ?? null, ms: rec.ms ?? null,
    art: { orch: !!d.orchestrator?.length, consults: !!d.consult_texts, report: !!d.report, check: !!d.check, reconcile: !!d.reconcile, final: !!d.final_report } };
}

export function csvOf(slim) {
  const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const rows = [['id', 'group', 'expect_consult', 'expect', 'accept', 'called', 'status', 'reason', 'match', 'turns', 'ms', 'utterance']];
  for (const s of slim) rows.push([s.id, s.group, s.expect_consult, s.expect.join('|'), s.accept.join('|'), s.called.join('|'), s.status, s.reason, s.match ?? '', s.turns ?? '', s.ms ?? '', s.utterance]);
  return '\uFEFF' + rows.map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}

export function updateManifest(man, meta) {
  const rounds = (man.rounds ?? []).filter((r) => r.round !== meta.round);
  rounds.push(meta); rounds.sort((a, b) => a.round - b.round);
  return { ...man, generated: new Date().toISOString().slice(0, 10), rounds, pending: (man.pending ?? []).filter((p) => p.round !== meta.round) };
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  for (const k of ['results', 'round', 'site']) if (!a[k]) { console.error('필수 옵션: --results --round --site'); process.exit(1); }
  const res = resolve(a.results), site = resolve(a.site), n = Number(a.round);
  const recs = JSON.parse(readFileSync(join(res, 'live_results.json'), 'utf8'));
  const summ = JSON.parse(readFileSync(join(res, 'live_summary.json'), 'utf8'));
  const rd = join(site, 'rounds', 'r' + String(n).padStart(2, '0')); mkdirSync(join(rd, 'cases'), { recursive: true });
  const slim = [];
  for (const rec of recs) {
    const f = join(res, 'cases', rec.id + '.json');
    const detail = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
    if (detail) { detail.round = n; writeFileSync(join(rd, 'cases', rec.id + '.json'), JSON.stringify(detail)); }
    slim.push(buildSlim(rec, detail));
  }
  writeFileSync(join(rd, 'results.csv'), csvOf(slim));
  const meta = { round: n, label: 'R' + n, date: a.date ?? new Date().toISOString().slice(0, 10), title: a.title ?? '', changes: a.changes ?? '', finding: a.finding ?? '', next: a.next ?? '',
    source_branch: a.branch ?? 'results/live-smoketest-kdoctor-consult-' + (a.label ?? 'full' + n), sp_hash: summ.meta?.sp_hash, finished: summ.meta?.finished, model: summ.meta?.model, review: summ.meta?.review ?? null,
    summary: { total: summ.total, by_group_kind: summ.by_group_kind, fail_reasons: summ.fail_reasons, truncated: summ.truncated_orchestrator_calls, orch_calls: summ.orchestrator_calls_total, avg_ms: summ.avg_ms, avg_consults: summ.avg_consults_per_case, review: summ.review ?? null },
    results_csv: 'rounds/r' + String(n).padStart(2, '0') + '/results.csv', cases: slim };
  writeFileSync(join(rd, 'round-meta.json'), JSON.stringify(meta, null, 1));
  const mp = join(site, 'rounds-manifest.json');
  const man = existsSync(mp) ? JSON.parse(readFileSync(mp, 'utf8').replace(/^\uFEFF/, '')) : { rounds: [], pending: [] };
  writeFileSync(mp, JSON.stringify(updateManifest(man, meta)));
  console.log(`라운드 ${n}: ${slim.length}건, 상세 파일 ${slim.filter((s) => s.art.orch).length}건 → ${rd}`);
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
