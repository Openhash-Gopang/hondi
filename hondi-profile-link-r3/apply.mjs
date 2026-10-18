// apply.mjs — 혼디 숫자 코드 "프로필 연결" ② 대시보드 표시 + /digit/mine (2026-09-27)
// 사용법: 이 zip을 풀어서 나온 폴더 안에서
//   node apply.mjs <repo-root>
// repo-root는 Openhash-Gopang/hondi를 클론한 새 브랜치의 워킹 디렉터리 경로.
//
// 하는 일: 통째로 교체된 파일 7개를 repo-root의 같은 경로로 복사한다.
// 패치(.patch) 방식이 반복적으로 실패했던 이력이 있어(HANDOFF 문서 참고)
// 항상 이 방식(전체 파일 복사)을 쓴다.

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
  'pages/digit-code.html',
  'pages/dashboard.html',
  'src/worker/digit-claim-handler.js',
  'src/worker/digit-claim-store.js',
  'tests/digit-v2/handler.test.mjs',
  'tests/digit-v2/store.test.mjs',
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
for (const f of ['worker.js', 'src/worker/digit-claim-handler.js', 'src/worker/digit-claim-store.js']) {
  execSync(`node --check ${f}`, { cwd: repoRoot, stdio: 'inherit' });
}

console.log('\n— tests/digit-v2 단위 테스트 —');
execSync('npm run test:unit', { cwd: path.join(repoRoot, 'tests/digit-v2'), stdio: 'inherit' });

console.log('\n모두 통과. git status로 변경 확인 후 커밋하세요.');
