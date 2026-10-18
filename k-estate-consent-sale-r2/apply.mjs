// apply.mjs — K-Estate "합의매각" + 법적 검토 (2026-09-27, r2)
// 사용법: 이 zip을 풀어서 나온 폴더 안에서
//   node apply.mjs <repo-root>
//
// r1(합의매각 신설)이 이미 main에 merge되어 있어도, 아직 안 되어 있어도
// 상관없다 — 이 zip은 그 기능 전체(신규 8개 + 기존 3개 수정)를 항상
// 완결된 상태로 다시 통째로 담고 있다(r1 위에 법적 검토 기능만 추가한
// 증분이 아니라 "지금 상태 전체"). 패치(.patch) 방식이 반복적으로
// 실패했던 이력이 있어(HANDOFF 문서 참고) 항상 전체 파일 복사 방식을 쓴다.

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = process.argv[2];
if (!repoRoot || !existsSync(repoRoot)) {
  console.error('사용법: node apply.mjs <repo-root>');
  process.exit(1);
}

const FILES = [
  'worker.js',
  'pages/consent-sale.html',
  'pages/k-services.html',
  'pb_migrations/1794600001_created_consent_sale_listings.js',
  'prompts/SP-24_kestate_v1.0.txt',
  'src/gopang/ai/hondi-consent-sale.js',
  'src/worker/consent-sale-handler.js',
  'src/worker/consent-sale-store.js',
  'tests/consent-sale/handler.test.mjs',
  'tests/consent-sale/package.json',
  'tests/consent-sale/protocol.test.mjs',
  'tests/consent-sale/store.test.mjs',
];
const HERE = path.dirname(fileURLToPath(import.meta.url));

for (const rel of FILES) {
  const src = path.join(HERE, rel);
  const dst = path.join(repoRoot, rel);
  if (!existsSync(src)) { console.error(`✗ 소스 없음: ${src}`); process.exit(1); }
  mkdirSync(path.dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  console.log(`✓ 복사: ${rel}`);
}

console.log('\n— node --check —');
for (const f of ['worker.js', 'src/worker/consent-sale-handler.js', 'src/worker/consent-sale-store.js', 'src/gopang/ai/hondi-consent-sale.js']) {
  execSync(`node --check ${f}`, { cwd: repoRoot, stdio: 'inherit' });
}

console.log('\n— tests/digit-v2 단위 테스트(회귀 확인) —');
execSync('npm run test:unit', { cwd: path.join(repoRoot, 'tests/digit-v2'), stdio: 'inherit' });

console.log('\n— tests/consent-sale 단위 테스트(23개 — 신규 법적 검토 3건 포함) —');
execSync('npm run test:unit', { cwd: path.join(repoRoot, 'tests/consent-sale'), stdio: 'inherit' });

console.log('\n모두 통과. git status로 변경 확인 후 커밋하세요.');
console.log('\n★ 참고: 이번 라운드는 새 PocketBase 필드를 추가하지 않았다(법적 검토는');
console.log('저장하지 않는 무상태 도구) — pb_migrations 파일은 r1과 동일 파일이며,');
console.log('r1 적용 때 이미 마이그레이션을 반영했다면 이번엔 다시 신경 쓸 것 없다.');
