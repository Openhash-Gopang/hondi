// apply.mjs — 혼디 숫자 코드 "프로필 연결" ① (2026-09-27)
// 사용법: 이 zip을 풀어서 나온 폴더 안에서
//   node apply.mjs <repo-root>
// repo-root는 Openhash-Gopang/hondi를 클론한 새 브랜치의 워킹 디렉터리 경로.
//
// 하는 일: 통째로 교체된 파일 2개(worker.js, pages/digit-code.html)를
// repo-root의 같은 경로로 복사한다. 패치(.patch) 방식이 반복적으로
// 실패했던 이력이 있어(HANDOFF 문서 참고) 항상 이 방식(전체 파일 복사)을 쓴다.

import { copyFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = process.argv[2];
if (!repoRoot || !existsSync(repoRoot)) {
  console.error('사용법: node apply.mjs <repo-root>');
  process.exit(1);
}

const FILES = ['worker.js', 'pages/digit-code.html'];
// 2026-09-27 수정 — Windows + 한글 사용자 경로(C:\Users\주피터\...)에서
// new URL(import.meta.url).pathname을 쓰면 (1) 드라이브 문자 앞에 잘못된
// 슬래시가 붙고 (2) 한글이 %EC%A3%BC... 형태로 퍼센트 인코딩된 채 남아
// existsSync가 실패했다(실사로 확인, 2026-09-27). fileURLToPath()가 두
// 문제를 모두 정확히 처리한다 — 항상 이걸 쓴다.
const HERE = path.dirname(fileURLToPath(import.meta.url));

for (const rel of FILES) {
  const src = path.join(HERE, rel);
  const dst = path.join(repoRoot, rel);
  if (!existsSync(src)) { console.error(`✗ 소스 없음: ${src}`); process.exit(1); }
  copyFileSync(src, dst);
  console.log(`✓ 복사: ${rel}`);
}

console.log('\n— node --check worker.js —');
execSync('node --check worker.js', { cwd: repoRoot, stdio: 'inherit' });

console.log('\n— tests/digit-v2 단위 테스트 —');
execSync('npm run test:unit', { cwd: path.join(repoRoot, 'tests/digit-v2'), stdio: 'inherit' });

console.log('\n모두 통과. git status로 변경 확인 후 커밋하세요.');
