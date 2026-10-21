// 검수 시트(docs/review/sheets)가 SP와 같은지 — SP를 고치고 gen-review-packages.py 를 다시 돌리지 않으면 실패한다 (2026-10-21).
import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('검수 시트가 SP와 일치한다', (t) => {
  if (spawnSync('python3', ['--version']).status !== 0) return t.skip('python3 없음');
  const r = spawnSync('python3', ['scripts/gen-review-packages.py', '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, (r.stdout || '') + (r.stderr || ''));
});

test('검수 시트 구성 — 이해관계 공개·판정란·종합 판정', () => {
  const dir = path.join(ROOT, 'docs/review/sheets');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  assert.ok(files.length >= 11, `시트 수 ${files.length}`);
  for (const f of files) {
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const k of ['## 0. 검수자 정보와 이해관계 공개', '## 1. 서류 목록 검수', '## 2. SP가 스스로', '## 3. AI가 하지 않는 일', '## 4. 종합 판정과 대외 표기 동의', '검수 전 초안']) assert.ok(t.includes(k), `${f}: ${k}`);
    assert.ok(/\| A-1-1 \|/.test(t) || /\| [A-Z]-1-1 \|/.test(t), `${f}: 서류 행 없음`);
  }
});

test('안내서가 세 트랙·교차 확인 규칙·표기 규칙을 담는다', () => {
  const t = fs.readFileSync(path.join(ROOT, 'docs/review/README.md'), 'utf8');
  for (const k of ['트랙 A', '트랙 B', '트랙 C', '교차 확인 규칙', '검수 완료 (', '이해관계', '법령 원문 대조(W3)는 검수자에게 요구하지 않는다']) assert.ok(t.includes(k), k);
  assert.ok(fs.existsSync(path.join(ROOT, 'docs/review/review-log.md')));
});
