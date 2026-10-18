// apply.mjs — 정산 엔진 + 추정 정확도 평가 + 위험 비례 선지급률 (2026-09-28, r2)
// 사용법: 이 zip을 푼 폴더에서  node apply.mjs <repo-root>
// r1(정산 엔진·평가 모듈)이 이미 main에 있어도 없어도 된다 — 이 zip은 그 전체를 자기완결형으로 담고 있다.
// 기존 파일은 하나도 수정하지 않는다(신규 파일만 추가/동일 내용 덮어쓰기) — 기존 기능 회귀 위험 없음.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';   // Windows+한글 경로에서 new URL().pathname 대신 반드시 이걸 쓴다
import path from 'node:path';

const repoRoot = process.argv[2];
if (!repoRoot || !existsSync(repoRoot)) { console.error('사용법: node apply.mjs <repo-root>'); process.exit(1); }

const FILES = [
  'src/gopang/ai/hondi-settlement.js',
  'src/gopang/ai/hondi-valuation-metrics.js',
  'src/gopang/ai/hondi-advance-rate.js',
  'tests/settlement/package.json',
  'tests/settlement/settlement.test.mjs',
  'tests/settlement/metrics.test.mjs',
  'tests/settlement/advance-rate.test.mjs',
  'tests/settlement/sim-advance-yield.mjs',
  'tests/settlement/sim-advance-tiers.mjs',
];
const HERE = path.dirname(fileURLToPath(import.meta.url));
for (const rel of FILES) {
  const src = path.join(HERE, rel), dst = path.join(repoRoot, rel);
  if (!existsSync(src)) { console.error(`✗ 소스 없음: ${src}`); process.exit(1); }
  mkdirSync(path.dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  console.log(`✓ 복사: ${rel}`);
}
console.log('\n— node --check —');
for (const f of FILES.filter(f => f.startsWith('src/'))) execSync(`node --check ${f}`, { cwd: repoRoot, stdio: 'inherit' });
console.log('\n— tests/settlement 단위 테스트(29개) —');
execSync('npm run test:unit', { cwd: path.join(repoRoot, 'tests/settlement'), stdio: 'inherit' });
console.log('\n모두 통과. 시뮬레이션: cd tests/settlement && npm run sim / npm run sim:tiers');
