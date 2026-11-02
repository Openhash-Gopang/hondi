import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('worker /usage-log: KST 시계열(series.hourly 24칸·series.daily)을 돌려준다', () => {
  const w = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  assert.match(w, /series: \{ today: todayKst, hourly, daily \}/);
  assert.match(w, /Array\.from\(\{ length: 24 \}/);
});
test('usage.html: 오늘/7일/30일 막대 그래프와 mail 임베드 모드', () => {
  const u = readFileSync(new URL('../usage.html', import.meta.url), 'utf8');
  for (const k of ['id="u-filters"', 'function _barChart(', 'function _renderUse(', 'body.embed .topbar', "embed=mail"]) assert.ok(u.includes(k), k);
});
