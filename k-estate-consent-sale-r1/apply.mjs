// apply.mjs — K-Estate "합의매각" 신설 (2026-09-27)
// 사용법: 이 zip을 풀어서 나온 폴더 안에서
//   node apply.mjs <repo-root>
// repo-root는 Openhash-Gopang/hondi를 클론한 새 브랜치의 워킹 디렉터리 경로.
//
// 하는 일: 새 파일 8개를 만들고, 기존 파일 3개(worker.js, pages/k-services.html,
// prompts/SP-24_kestate_v1.0.txt)를 통째로 교체한다. 패치(.patch) 방식이
// 반복적으로 실패했던 이력이 있어(HANDOFF 문서 참고) 항상 전체 파일 복사 방식을 쓴다.

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
// fileURLToPath()를 쓴다 — Windows + 한글 사용자 경로에서 new URL(...).pathname을
// 쓰면 드라이브 문자·한글 인코딩이 깨지는 문제가 이전 라운드에서 실사로
// 확인됐다(HANDOFF 참고). 절대 되돌리지 말 것.
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

console.log('\n— tests/consent-sale 단위 테스트 —');
execSync('npm run test:unit', { cwd: path.join(repoRoot, 'tests/consent-sale'), stdio: 'inherit' });

console.log('\n모두 통과. git status로 변경 확인 후 커밋하세요.');
console.log('\n★ 참고: pb_migrations/1794600001_created_consent_sale_listings.js는 별도 배포');
console.log('경로(Deploy PB Migrations to L1)를 탄다 — worker.js/pages 배포와 별개로');
console.log('마이그레이션이 실제 반영됐는지 확인해야 한다(인수인계서 "알아두어야 할');
console.log('환경/제약사항" 참고).');
