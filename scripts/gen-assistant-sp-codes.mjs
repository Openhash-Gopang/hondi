// prompts/SP_*-assistant_v*.md 의 제목 코드(예: SP-LAW-13) → 직역 id 표를 src/worker/assistant-sp-codes.js 로 생성한다 (2026-10-21).
// 서버 게이트(pro-gate.js)가 요청에 실린 전문가용 SP 가 어느 직역 것인지 식별할 때 쓴다. SP 를 추가·개명하면 다시 실행한다:
//   node scripts/gen-assistant-sp-codes.mjs          (파일 갱신)
//   node scripts/gen-assistant-sp-codes.mjs --check  (최신 여부만 검사 — 테스트가 같은 로직을 쓴다)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TITLE_RE = /^# (SP-[A-Z]+-[0-9A-Za-z]+(?:-[0-9A-Za-z]+)*) · [^\n]*보조 AI/m;

export function buildCodeMap(dir = path.join(root, 'prompts')) {
  const latest = new Map();                       // personaId → { v, text }
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(/^SP_(.+)-assistant_v(\d+)_(\d+)\.md$/);
    if (!m) continue;
    const v = Number(m[2]) * 1000 + Number(m[3]);
    if (!latest.has(m[1]) || latest.get(m[1]).v < v) latest.set(m[1], { v, file: f });
  }
  const codes = {};
  for (const [id, { file }] of [...latest].sort((a, b) => a[0].localeCompare(b[0]))) {
    const head = fs.readFileSync(path.join(dir, file), 'utf8').slice(0, 3000);
    const t = head.match(TITLE_RE);
    if (!t) throw new Error(`제목 코드를 찾지 못함: ${file}`);
    if (codes[t[1]] && codes[t[1]] !== id) throw new Error(`코드 중복 ${t[1]}: ${codes[t[1]]} / ${id}`);
    codes[t[1]] = id;
  }
  return codes;
}

export function render(codes) {
  const body = Object.entries(codes).map(([c, id]) => `  ${JSON.stringify(c)}: ${JSON.stringify(id)},`).join('\n');
  return `// 자동 생성 — scripts/gen-assistant-sp-codes.mjs (직접 고치지 마세요). 전문가용 SP 제목 코드 → 직역 id.\nexport const ASSISTANT_SP_CODES = {\n${body}\n};\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.join(root, 'src/worker/assistant-sp-codes.js');
  const text = render(buildCodeMap());
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
    if (cur !== text) { console.error('assistant-sp-codes.js 가 최신이 아닙니다. node scripts/gen-assistant-sp-codes.mjs 실행'); process.exit(1); }
    console.log('최신입니다.');
  } else { fs.writeFileSync(out, text); console.log('생성:', out, Object.keys(buildCodeMap()).length, '개'); }
}
