// 전문가용 보조 AI SP(SP_<id>-assistant) 점검 — 일반인용/전문가용 이분화 (2026-10-17)
// C-01 데이터(data/assistant-sp)에서 생성한 SP 가 저장소의 SP 와 한 글자도 다르지 않다
// C-02 전문가용 SP 마다 필수 골격(§LEGAL-LIMIT, 부록 A, 서식 출력 규격 C-2, 금지 태그 안내)이 있고, 일반인용 SP 가 짝으로 있다
// C-03 sp-catalog-categories.json 의 total 이 최상위 카테고리 count 합계와 같다
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CAT = JSON.parse(fs.readFileSync(path.join(ROOT, 'prompts/sp-catalog.json'), 'utf8'));

test('C-01 생성 데이터와 SP 일치', (t) => {
  const dir = path.join(ROOT, 'data/assistant-sp');
  if (!fs.existsSync(dir) || !fs.readdirSync(dir).some((f) => f.endsWith('.json'))) return;
  // Windows 의 python3 는 Store 안내 껍데기일 수 있다(종료 코드 9009) — 다른 테스트(B-02·B-05)와 같이 건너뛴다.
  if (spawnSync('python3', ['--version']).status !== 0) return t.skip('python3 없음');
  const r = spawnSync('python3', ['scripts/gen-assistant-sp.py', '--check', '--all'], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, (r.stdout || '') + (r.stderr || ''));
});

test('C-02 전문가용 SP 골격과 일반인용 짝', () => {
  const keys = Object.keys(CAT).filter((k) => /^SP_.+-assistant$/.test(k));
  assert.ok(keys.length > 0);
  for (const k of keys) {
    const f = path.join(ROOT, 'prompts', CAT[k]);
    assert.ok(fs.existsSync(f), `${k}: 파일 없음 ${CAT[k]}`);
    const t = fs.readFileSync(f, 'utf8');
    assert.ok(/## §LEGAL-LIMIT/.test(t), `${k}: §LEGAL-LIMIT 없음`);
    assert.ok(/## 부록 A/.test(t), `${k}: 부록 A 없음`);
    assert.ok(/### C-2\. 서식 출력 규격/.test(t), `${k}: C-2 없음`);
    assert.ok(/\[CONNECT_HUMAN_EXPERT\]/.test(t) && /출력 금지 태그|출력하지 않는다/.test(t), `${k}: [CONNECT_HUMAN_EXPERT] 금지 안내 없음`);
    const pub = k.replace(/-assistant$/, '');
    assert.ok(CAT[pub], `${k}: 일반인용 짝 ${pub} 이 sp-catalog.json 에 없음`);
  }
});

test('C-03 카테고리 total', () => {
  const c = JSON.parse(fs.readFileSync(path.join(ROOT, 'prompts/sp-catalog-categories.json'), 'utf8'));
  const sum = c.categories.filter((x) => !x.parent).reduce((a, x) => a + x.count, 0);
  assert.strictEqual(c.total, sum, 'total 과 최상위 카테고리 count 합계가 다름');
  for (const it of c.items) if (it.cat.endsWith('-assistant')) assert.ok(fs.existsSync(path.join(ROOT, it.file)), `item 파일 없음 ${it.file}`);
});
