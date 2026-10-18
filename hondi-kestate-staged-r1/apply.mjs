// apply.mjs — K-Estate 3단계 가치평가(국가·지역·개별) + 두 트랙 확장 (2026-09-28)
// 사용법: 이 zip을 푼 폴더에서  node apply.mjs <repo-root> [--force]
// 안전장치: 수정되는 기존 파일이 "메인의 예상 내용"도 "이 zip의 내용"도 아니면(그 사이 메인이 바뀌었으면) 덮어쓰지 않고 멈춘다.
//          검토 후 그래도 덮어쓰려면 --force. 이미 적용한 뒤 다시 실행해도 안전하다(멱등).
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';   // Windows+한글 경로에서 new URL().pathname 대신 반드시 이걸 쓴다
import path from 'node:path';

const args = process.argv.slice(2), force = args.includes('--force'), repoRoot = args.find(a => !a.startsWith('--'));
if (!repoRoot || !existsSync(repoRoot)) { console.error('사용법: node apply.mjs <repo-root> [--force]'); process.exit(1); }

const NEW_FILES = [
  "src/gopang/ai/hondi-staged-valuation.js",
  "tests/settlement/staged-valuation.test.mjs",
  "tests/settlement/example-staged.mjs",
  "prompts/SP-24a_kestate_appraisal_v0_1.txt",
  "docs/kestate/VALIDATION_PROTOCOL_v0_1.md"
];
const MODIFIED = {
  "src/gopang/ai/hondi-advance-rate.js": {
    "base": "f9407bda531c7f5b88971eaad1eb7095feb8814b1611d51add2e360fdba4f83f",
    "next": "18b455ecb3b83f26a480b0661613098641e46c30c70a4b11342266e1ada6b978"
  },
  "src/gopang/ai/hondi-valuation-tracks.js": {
    "base": "5fd807c85fcc8ae56343deefc2a502fd130c4b13f7bec22c6f68bdb5a9d58bb0",
    "next": "a0068a81df803429fb17de7e55bd7b572d7e36cde36756516bd5d5fa5392d1b4"
  },
  "src/gopang/ai/hondi-valuation-metrics.js": {
    "base": "92b1b3bead9f294cebd1902d70a221582f82285400900a8eae70a134e1d69223",
    "next": "9b25f3a872d08f62e153e012a516d064480b37926d593fe55c8479899801b462"
  },
  "tests/settlement/package.json": {
    "base": "bee8677c55f4a608eccf718e9d4cf0994a4ae0d71cba54bb63eb2cf3a760718e",
    "next": "af170c95600815bff8ef73ed85cc5b155b7d0c7984c95703937a37a7d291ad69"
  },
  "tests/settlement/tracks.test.mjs": {
    "base": "2fe30169329af86356f9e33ae784456418aaaa9c77aaa8b34eabbdf226ceffe4",
    "next": "95874b8a9d44ca1e2ad323ba87a2341fff4d070a308af5cd9db9064b113b4581"
  },
  "tests/settlement/advance-rate.test.mjs": {
    "base": "a33614e55aed2dd0e8f35936dcae50c193339f654637494b138f51065acf227b",
    "next": "5b0ea7b27bdbd6e64763c554d6c000404d22bb6577f6a1c034e2b98693592d6c"
  },
  "tests/settlement/metrics.test.mjs": {
    "base": "e7a85fdc7cd34af4928716c98770f6850cabda6054b28f835e07d58a6c99763e",
    "next": "e1698d150317d96c0905e9de210649d80bc19efda6b077ce39074db195707227"
  }
};   // { 파일: { base: 수정 전 main 해시, next: 이 zip 해시 } }
const HERE = path.dirname(fileURLToPath(import.meta.url));
const sha = p => createHash('sha256').update(readFileSync(p)).digest('hex');

// 1) 덮어쓰기 전 검사
const diverged = [];
for (const [rel, h] of Object.entries(MODIFIED)) {
  const dst = path.join(repoRoot, rel);
  if (!existsSync(dst)) { diverged.push(`${rel} (대상에 없음)`); continue; }
  const cur = sha(dst);
  if (cur !== h.base && cur !== h.next) diverged.push(rel);
}
if (diverged.length && !force) {
  console.error('✗ 대상 저장소의 다음 파일이 이 zip이 기대하는 내용과 다릅니다(그 사이 메인이 바뀐 것으로 보입니다):');
  diverged.forEach(f => console.error('   - ' + f));
  console.error('  덮어쓰면 그 변경이 사라집니다. 변경을 확인한 뒤 그래도 진행하려면 --force로 다시 실행하세요.');
  process.exit(2);
}
if (diverged.length) console.warn(`⚠ --force: 다음 파일을 검토 없이 덮어씁니다: ${diverged.join(', ')}`);

// 2) 복사
for (const rel of [...NEW_FILES, ...Object.keys(MODIFIED)]) {
  const src = path.join(HERE, rel), dst = path.join(repoRoot, rel);
  if (!existsSync(src)) { console.error(`✗ 소스 없음: ${src}`); process.exit(1); }
  mkdirSync(path.dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  console.log(`✓ 복사: ${rel}`);
}

// 3) SP-24_kestate 에 "가격 추정은 SP-24a로 위임" 규칙 1개를 멱등 삽입(파일 전체를 덮어쓰지 않는다)
const sp24 = path.join(repoRoot, 'prompts/SP-24_kestate_v1.0.txt');
const RULE = [
  '6-b. ★ 가격 추정·감정 요청은 이 SP가 직접 값을 만들지 않는다 — SP-24a(3단계 가치평가: 국가·지역·개별)로',
  '   위임한다. SP-24a는 웹 검색으로 공식 출처의 증거(가격지수·인구 통계·정비구역·등기부 권리)를 모아',
  '   [STAGED_VALUATION] 블록으로 제출하고, 조정계수·불확실성·차감액은 코드(hondi-staged-valuation.js)가',
  '   다시 계산한다. 출처 없는 수치와 당사자 주장은 반영하지 않으며, 결과는 법적 효력 없는 참고치다.',
].join('\n');
if (!existsSync(sp24)) console.warn('⚠ prompts/SP-24_kestate_v1.0.txt가 없어 위임 규칙(6-b)을 넣지 못했습니다 — 수동으로 추가하세요.');
else {
  const txt = readFileSync(sp24, 'utf-8');
  if (txt.includes('SP-24a')) console.log('· SP-24_kestate: 위임 규칙(6-b)이 이미 있음 — 건너뜀');
  else {
    const m = /^7\. 매물 정보\(/m.exec(txt);
    if (!m) console.warn('⚠ SP-24_kestate에서 규칙 7 위치를 찾지 못해 위임 규칙(6-b)을 넣지 못했습니다 — 수동으로 추가하세요.');
    else { writeFileSync(sp24, txt.slice(0, m.index) + RULE + '\n' + txt.slice(m.index)); console.log('✓ SP-24_kestate: 위임 규칙(6-b) 삽입'); }
  }
}

// 4) 검증
console.log('\n— node --check —');
for (const f of [...NEW_FILES, ...Object.keys(MODIFIED)].filter(f => f.startsWith('src/'))) execSync(`node --check ${f}`, { cwd: repoRoot, stdio: 'inherit' });
console.log('\n— tests/settlement 단위 테스트(117개) —');
execSync('npm run test:unit', { cwd: path.join(repoRoot, 'tests/settlement'), stdio: 'inherit' });
console.log('\n모두 통과. 실행 예시(가상 데이터): cd tests/settlement && npm run example:staged');
