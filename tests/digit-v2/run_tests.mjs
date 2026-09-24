// 사용: node run_tests.mjs [cases.json] [--out results.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { analyzeGray } from '../../src/gopang/ai/hondi-digit-core.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const casesFile = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(HERE, 'cases.json');
const outIdx = process.argv.indexOf('--out');
const outFile = outIdx > 0 ? process.argv[outIdx + 1] : path.join(HERE, 'results.json');

function loadGray(p) {
  const png = PNG.sync.read(fs.readFileSync(p));
  const { width: W, height: H, data } = png;
  const g = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = Math.round((data[i*4] + data[i*4+1] + data[i*4+2]) / 3);  // 스캐너와 동일 공식
  return { g, W, H };
}

const cases = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
const rows = [];
for (const c of cases) {
  const { g, W, H } = loadGray(path.join(HERE, c.path));
  const t0 = performance.now();
  const r = analyzeGray(g, W, H);
  const ms = performance.now() - t0;
  let verdict;
  if (c.expect) {                       // 코드가 있는 프레임
    verdict = !r.ok ? 'reject' : (r.serial === c.expect ? 'correct' : 'WRONG');
  } else if (c.suite === 'S4_truncated') {   // 잘린 프레임: 거절이 정상, 정답이 나와도 무해, 오답이 위험
    verdict = !r.ok ? 'reject' : (r.serial === c.serial ? 'benign-correct' : 'WRONG');
  } else {                              // 코드 없는 프레임: 무엇이든 인식되면 오탐
    verdict = !r.ok ? 'reject' : 'FALSE-ACCEPT';
  }
  rows.push({ id: c.id, suite: c.suite, level: c.level, expect: c.expect, serial: c.serial,
              got: r.ok ? r.serial : null, reason: r.ok ? null : r.reason, verdict, ms,
              cert: r.ok ? r.certainty : null });
}
fs.writeFileSync(outFile, JSON.stringify(rows));

// 요약
const by = new Map();
for (const r of rows) {
  const k = `${r.suite}|${r.level}`;
  if (!by.has(k)) by.set(k, { correct: 0, benign: 0, reject: 0, wrong: 0, fa: 0, n: 0 });
  const b = by.get(k); b.n++;
  if (r.verdict === 'correct') b.correct++;
  else if (r.verdict === 'benign-correct') b.benign++;
  else if (r.verdict === 'reject') b.reject++;
  else if (r.verdict === 'WRONG') b.wrong++;
  else b.fa++;
}
const lines = [];
for (const [k, b] of by) lines.push(`${k.padEnd(44)} n=${String(b.n).padStart(3)}  ok=${String(b.correct + b.benign).padStart(3)}  rej=${String(b.reject).padStart(3)}  WRONG=${b.wrong}  FA=${b.fa}`);
console.log(lines.join('\n'));
const tot = rows.reduce((a, r) => { a[r.verdict] = (a[r.verdict] || 0) + 1; return a; }, {});
console.log('\nTOTAL', rows.length, tot, 'avg ms', (rows.reduce((s, r) => s + r.ms, 0) / rows.length).toFixed(1));
