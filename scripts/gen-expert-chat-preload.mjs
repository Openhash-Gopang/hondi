// pages/expert-chat.html 의 정적 import 그래프를 <link rel="modulepreload"> 로 미리 선언한다(2026-11-04).
// 왜: 이 페이지는 인라인 모듈이 import → import → … 5단계로 모듈 38개를 차례로 불러온다. 요청마다 왕복 0.5~0.8초가 들어서 서류 작성 엔진(임베드)이
//     준비되기까지 7초 넘게 걸렸다. 그래프 전체를 처음부터 한꺼번에 요청하면 단계가 1~2로 줄어든다.
// 사용: node scripts/gen-expert-chat-preload.mjs --write   (목록 갱신)   ·   테스트가 목록이 실제 import 그래프와 같은지 검사한다.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = 'pages/expert-chat.html';
export const BEGIN = '<!-- modulepreload:begin (scripts/gen-expert-chat-preload.mjs) -->';
export const END = '<!-- modulepreload:end -->';

// 정적 import 만(동적 import() 는 필요할 때 불러오는 것이라 미리 받지 않는다). 주석·문자열 안의 import 는 줄 시작 기준으로 거른다.
const IMPORT_RE = /^[ \t]*import\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
function specifiers(src) { const out = []; let m; IMPORT_RE.lastIndex = 0; while ((m = IMPORT_RE.exec(src))) out.push(m[1]); return out; }
function resolveSpec(from, spec) {
  if (/^https?:/.test(spec)) return null;
  const p = spec.startsWith('/') ? posix.normalize(spec) : posix.normalize(posix.join(posix.dirname(from), spec));
  return p.split('?')[0];
}
function inlineModule(html) {
  const m = /<script type="module">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error('인라인 모듈 스크립트를 찾지 못했습니다');
  return m[1];
}
export function computePreload(root = ROOT) {
  const html = readFileSync(join(root, PAGE), 'utf8');
  const seen = new Set(), queue = [];
  for (const s of specifiers(inlineModule(html))) { const p = resolveSpec('/pages/x', s); if (p && !seen.has(p)) { seen.add(p); queue.push(p); } }
  while (queue.length) {
    const p = queue.shift();
    let src; try { src = readFileSync(join(root, p), 'utf8'); } catch { continue; }
    for (const s of specifiers(src)) { const q = resolveSpec(p, s); if (q && !seen.has(q)) { seen.add(q); queue.push(q); } }
  }
  return [...seen].sort();
}
export function renderBlock(list) { return BEGIN + '\n' + list.map(p => '<link rel="modulepreload" href="' + p + '">').join('\n') + '\n' + END; }
export function currentBlock(html) {
  const a = html.indexOf(BEGIN), b = html.indexOf(END);
  return a >= 0 && b > a ? html.slice(a, b + END.length) : '';
}
if (process.argv[1] && process.argv[1].endsWith('gen-expert-chat-preload.mjs') && process.argv.includes('--write')) {
  const file = join(ROOT, PAGE); let html = readFileSync(file, 'utf8');
  const block = renderBlock(computePreload());
  const cur = currentBlock(html);
  if (cur) html = html.replace(cur, () => block);
  else html = html.replace('<meta name="description"', () => block + '\n<meta name="description"');
  writeFileSync(file, html);
  console.log('modulepreload', computePreload().length + '개');
}
