// webapp.html의 modulepreload 목록이 gopang-app.js 정적 import 그래프와 일치하는지 검증
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import assert from 'node:assert';
const seen = new Set();
const re = /(?:^|\n)\s*(?:import|export)\s[^;\n]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
function walk(f) {
  if (seen.has(f) || !existsSync(f)) return;
  seen.add(f);
  const s = readFileSync(f, 'utf8');
  for (const m of s.matchAll(re)) {
    const p = m[1] || m[2];
    if (p.startsWith('.')) walk(normalize(join(dirname(f), p)));
  }
}
walk('gopang-app.js');
const html = readFileSync('webapp.html', 'utf8');
const pre = new Set([...html.matchAll(/<link rel="modulepreload" href="\/([^"?]+)/g)].map((m) => m[1]));
for (const f of seen) assert.ok(pre.has(f), 'modulepreload 누락: ' + f);
for (const f of pre) assert.ok(seen.has(f), '불필요한 modulepreload: ' + f);
console.log('ok', seen.size);
