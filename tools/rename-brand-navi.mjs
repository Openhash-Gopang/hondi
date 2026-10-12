#!/usr/bin/env node
// 혼디·고팡 상표(표시명) → 나비 일괄 치환 도구.
//  - 소문자 식별자 hondi / gopang, 도메인, 저장 키, 암호 상수, 경로는 건드리지 않는다.
//  - 사용법:  node tools/rename-brand-navi.mjs --dry   (보고서만)
//             node tools/rename-brand-navi.mjs --apply (파일 수정)
//  - 산출물: rename-navi-report/{summary.txt, changed-files.txt, review.txt}  (저장소에 커밋하지 말 것)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const APPLY = process.argv.includes('--apply');
const OUT = 'rename-navi-report';

// ── 제외 규칙 ──────────────────────────────────────────
const EXC_DIR = /^(_archive|pb_migrations|node_modules|reports|report|results|klaw-sim-records|profiles|\.github)\//;
const EXC_FILE = /(^|\/)(WORKLOG|NEXT_SESSION_HANDOFF|HANDOFF|APPLY_INSTRUCTIONS|CHANGELOG|wrangler\.toml|CNAME|package(-lock)?\.json)|\.bak|\.jsonl$|verify_\d+_results|_results_debug|live_results/i;
const EXC_DIGIT = /hondi-digit|digit-v2|digit-code|hondi-scanner|test-hondi-(digit|code)|hondi-7seg|hondi-6color|hondi-code|digit-claim|\/(hondi|gopang)-net-logo/i;
const BIN = /\.(png|jpe?g|gif|webp|ico|zip|xlsx|docx|pptx|pdf|woff2?|ttf|otf|mp[34]|wasm|gz|bin|jar|7z)$/i;
const DOCS_KEEP = /^docs\/[^/]*(MANUAL|GUIDE|README|SPEC)[^/]*$/i;     // docs/ 중 설명서류만 대상
const TOOL_SELF = /^tools\/rename-brand-navi\.mjs$/;

// ── 이어 보류할 맥락 ──────────────────────────────────
const ETYM = /(제주어|제주 방언|제주방언|방언|어원|어의|곳간|창고|'함께'|"함께"|“함께”|‘함께’|뜻은|라는 뜻|이라는 뜻|의미는)/;
const IS_TEST = /(^|\/)tests?\/|\.test\.|^run_tests\.mjs$|^test-/;
const CODE_MATCH = /\.(includes|indexOf|startsWith|endsWith|match|test|replace)\(\s*[^)]*(혼디|고팡)|new RegExp|===?\s*['"`][^'"`]*(혼디|고팡)|!==?\s*['"`][^'"`]*(혼디|고팡)|case\s+['"`][^'"`]*(혼디|고팡)|\/[^/\n]*(혼디|고팡)[^/\n]*\/[gimsuy]*[.,;)\s]/;
const DUAL = /(triggers|keywords|aliases|patterns|synonyms|wakeWords|wake_words|phrases)\s*[:=]/;
const KEYPOS = /"[^"\n]*(혼디|고팡)[^"\n]*"\s*:/;
const PROTECT = [/혼디제주/g, /혼디 제주 법인/g];                     // 법인명: 별도 결정

// ── 로고 파일 경로 교체 ───────────────────────────────
const LOGO_MAP = [
  ['/icons/icon-180.png', '/icons/navi-icon-180.png'],
  ['/icons/icon-192.png', '/icons/navi-icon-192.png'],
  ['/icons/icon-512.png', '/icons/navi-icon-512.png'],
  ['/icons/icon.png', '/icons/navi-icon.png'],
  ['/icons/wordmark.png', '/icons/navi-wordmark.png'],
  ['/icons/hondi-hero-badge.png', '/icons/navi-hero-badge.png'],
];

// ── 고팡 뒤 조사 교정 (나비는 받침이 없다. 혼디도 받침이 없어 교정 불필요) ──
const JOSA = [
  [/고팡(이라는|이란|이라고|이라)(?![가-힣])/g, (m, j) => '나비' + j.replace('이', '')],
  [/고팡은(?![가-힣])/g, '나비는'],
  [/고팡이(?![가-힣])/g, '나비가'],
  [/고팡을(?![가-힣])/g, '나비를'],
  [/고팡과(?![가-힣])/g, '나비와'],
  [/고팡으로(?=서|써|부터|의|$|[^가-힣])/g, '나비로'],
];
// 영문 표시명 (단독 단어일 때만)
const LAT = /(?<![\w.\-\/@:#$%{}])(Hondi|HONDI|Gopang|GOPANG)(?![\w\-\/@:$%{}]|\.\w)/g;
const latRep = (m) => (m === m.toUpperCase() ? 'NAVI' : 'Navi');

const NEED = ['assets/navi-logo.png', 'icons/navi-icon-180.png', 'icons/navi-icon-192.png', 'icons/navi-icon-512.png', 'icons/navi-icon.png', 'icons/navi-wordmark.png', 'icons/navi-hero-badge.png'];
const missing = NEED.filter((f) => !fs.existsSync(f));
if (missing.length) {                                              // 로고 파일 없이 경로만 바꾸면 아이콘·서비스워커 캐시가 깨진다
  console.error('중단: 나비 로고 파일이 없습니다 →', missing.join(', '), '\n압축 파일(hondi-brand-navi-final-20261012.zip)을 이 폴더에 풀어 주세요.');
  process.exit(1);
}
if (APPLY) {                                                       // 다른 사람의 미커밋 변경을 휩쓸지 않도록 깨끗한 트리에서만 실행
  const dirty = execFileSync('git', ['diff', '--name-only', '-z']).toString('utf8').split('\0').filter(Boolean).filter((f) => f !== 'favicon.ico');
  if (dirty.length) { console.error('중단: 커밋되지 않은 변경이 있습니다 →', dirty.slice(0, 5).join(', ')); process.exit(1); }
}
const files = execFileSync('git', ['ls-files', '-z'], { maxBuffer: 1 << 28 }).toString('utf8').split('\0').filter(Boolean);
const stat = { files: 0, changed: 0, ko: 0, lat: 0, josa: 0, logo: 0, dual: 0, review: 0 };
const reviewByKind = {};
const review = [];
const changed = [];

function addReview(kind, f, i, l) {
  review.push(`[${kind}] ${f}:${i}: ${l.trim().slice(0, 140)}`);
  reviewByKind[kind] = (reviewByKind[kind] || 0) + 1; stat.review++;
}

function transformLine(l, ctx) {
  // 1) 로고 경로
  for (const [a, b] of LOGO_MAP) if (l.includes(a)) { l = l.split(a).join(b); stat.logo++; }
  if (!/혼디|고팡|Hondi|HONDI|Gopang|GOPANG/.test(l)) return l;
  const hasKo = /혼디|고팡/.test(l);
  // 2) 보류 맥락
  if (hasKo && ETYM.test(l)) { addReview('어원/뜻', ctx.f, ctx.i, l); return l; }
  if (hasKo && ctx.json && KEYPOS.test(l)) { addReview('JSON키', ctx.f, ctx.i, l); return l; }
  if (hasKo && (ctx.code || ctx.json) && (DUAL.test(l) || ctx.inList)) {                               // 사용자 입력 트리거: 옛 표현 + 새 표현 둘 다
    let found = false;
    const out = l.replace(/(['"`])([^'"`\n]*(?:혼디|고팡)[^'"`\n]*)\1/g, (m, q, s) => {
      found = true;
      const added = `${q}${koRep(s)}${q}`;
      if (l.includes(added)) return m;                                 // 이미 새 표현이 있으면 다시 만들지 않는다(여러 번 실행해도 같은 결과)
      stat.dual++; return `${m}, ${added}`;
    });
    if (found) return out;                                             // 옛 표현은 그대로 두고 새 표현만 덧붙인 줄
  }
  if (hasKo && ctx.code && !ctx.isTest && CODE_MATCH.test(l)) { addReview('코드 비교/매칭', ctx.f, ctx.i, l); return l; }
  // 3) 치환
  let prot = [], n = 0;
  for (const re of PROTECT) l = l.replace(re, (m) => { prot.push(m); return `\u0000P${n++}\u0000`; });
  if (hasKo) l = koRep(l, true);
  if (ctx.latinOK) {
    l = l.replace(LAT, (m) => { stat.lat++; return latRep(m); });
  } else if (!ctx.latinOK && LAT.test(l)) { LAT.lastIndex = 0; if (ctx.code) addReview('영문 표시명(코드 안)', ctx.f, ctx.i, l); }
  LAT.lastIndex = 0;
  prot.forEach((p, k) => { l = l.replace(`\u0000P${k}\u0000`, p); });
  if (!prot.length && /혼디제주/.test(l)) addReview('법인명', ctx.f, ctx.i, l);
  return l;
}
function koRep(s, count) {
  let o = s.replace(/(혼디|고팡)(\s*)\((Hondi|Gopang|HONDI|GOPANG)\)/g, (m, a, sp, b) => { if (count) { stat.ko++; stat.lat++; } return '나비' + sp + '(' + (b === b.toUpperCase() ? 'NAVI' : 'Navi') + ')'; });
  for (const [re, rep] of JOSA) o = o.replace(re, (...a) => { if (count) stat.josa++; return typeof rep === 'function' ? rep(...a) : rep; });
  o = o.replace(/혼디|고팡/g, () => { if (count) stat.ko++; return '나비'; });
  return o;
}

for (const f of files) {
  if (EXC_DIR.test(f) || EXC_FILE.test(f) || EXC_DIGIT.test(f) || BIN.test(f) || TOOL_SELF.test(f)) continue;
  if (f.startsWith('docs/') && !DOCS_KEEP.test(f)) continue;
  let buf; try { buf = fs.readFileSync(f); } catch { continue; }
  if (buf.includes(0)) continue;
  const text = buf.toString('utf8');
  if (!/혼디|고팡|Hondi|HONDI|Gopang|GOPANG|icons\/(icon|wordmark|hondi-hero)/.test(text)) continue;
  stat.files++;
  const ext = path.extname(f).toLowerCase();
  const isCodeFile = ['.js', '.mjs', '.cjs', '.ts', '.py', '.sh', '.ps1', '.sql'].includes(ext);
  const isHtml = ext === '.html' || ext === '.htm';
  const isMd = ext === '.md' || ext === '.txt';
  const isJson = ext === '.json';
  let inScript = false, inFence = false, listOpen = false;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    let l = lines[i];
    if (isHtml) { if (/<script\b/i.test(l)) inScript = true; }
    if (isMd && /^\s*```/.test(l)) inFence = !inFence;
    const trimmed = l.trim();
    const comment = /^(\/\/|\*|\/\*|#|--)/.test(trimmed);
    const code = isCodeFile || (isHtml && inScript) || (isMd && inFence);
    const ctx = { f, i: i + 1, isTest: IS_TEST.test(f), code, json: isJson, latinOK: isMd ? !inFence : isHtml ? !inScript : isJson ? true : comment };
    // JSON에서 영문 표시명은 키 위치가 아닌 값일 때만
    if (isJson && /(Hondi|Gopang|HONDI|GOPANG)"\s*:/.test(l)) ctx.latinOK = false;
    if ((isCodeFile || isJson || isHtml) && /(triggers|keywords|aliases|patterns|synonyms|wakeWords|phrases)"?\s*[:=]\s*\[(?![^\]]*\])/.test(l)) listOpen = true;
    ctx.inList = listOpen;
    let nl;
    const em = ctx.inList && /^(\s*)(['"`])([^'"`\n]*(?:혼디|고팡)[^'"`\n]*)\2(,?)(\r?)$/.exec(l);
    const nextHas = em && lines[i + 1] !== undefined && lines[i + 1].includes(`${em[2]}${koRep(em[3])}${em[2]}`);
    if (em && nextHas) nl = l;
    else if (em) { stat.dual++; nl = `${em[1]}${em[2]}${em[3]}${em[2]},\n${em[1]}${em[2]}${koRep(em[3])}${em[2]}${em[4]}${em[5]}`; }
    else nl = transformLine(l, ctx);
    if (listOpen && /\]/.test(l)) listOpen = false;
    if (nl !== l) lines[i] = nl;
    if (isHtml && /<\/script>/i.test(l)) inScript = false;
  }
  const out = lines.join('\n');
  if (out !== text) {
    stat.changed++; changed.push(f);
    if (APPLY) fs.writeFileSync(f, out);
  }
}


// ── 2차: 검토 후 확정한 개별 항목 (정확한 문자열 기준이라 줄 번호가 바뀌어도 안전하다) ──
const MANUAL_EXACT = {
  'gopang-app.js': [["'Gopang Wallet'", "'Navi Wallet'"]],
  'src/gopang/ui/settings.js': [["_openSheet('Gopang Wallet'", "_openSheet('Navi Wallet'"]],
  'webapp.html': [["'Gopang Wallet'", "'Navi Wallet'"], ["'Gopang ウォレット'", "'Navi ウォレット'"], ["'Gopang 钱包'", "'Navi 钱包'"], ['(Gopang Wallet 시트)', '(Navi Wallet 시트)']],
  'gopang-wallet.js': [["name: 'Hondi Wallet'", "name: 'Navi Wallet'"], ["displayName: 'Gopang Wallet'", "displayName: 'Navi Wallet'"], ["'Gopang Wallet (재인증 전용)'", "'Navi Wallet (재인증 전용)'"]],
};
const MANUAL_REGEX = {                       // [정규식, 치환, 줄 필터]
  'worker.js': [[/(X-Title'\]?\s*[:=]\s*)'Hondi'/g, "$1'Navi'"], [/name: 'Gopang Prompt Editor'/g, "name: 'Navi Prompt Editor'"],
                [/Hondi(?=(는|가|를|와|과|에|의|도)|\s)/g, '나비', /^\s*note:/]],
  'src/gopang/ai/call-ai.js': [[/Hondi(?=(는|가|를|와|과|에|의|도)|\s)/g, '나비', /검증된|등록된/]],
};
for (const f of ['pages/expert-chat.html', 'pages/k-services.html', 'pdv-store.js', 'pdv.html', 'prompts/gov-tree/02-do-dept/SP-DO-TOURISM_v1.2.md', 'src/worker/order-queue-handler.js', 'src/tests/sp-intercall.test.mjs'])
  MANUAL_REGEX[f] = [[/Hondi(?=(는|가|를|와|과|에|의|도)|\s)/g, '나비']];
MANUAL_REGEX['온라인 민원 SP/AC-SIMULATION-AI-TO-AI-EXECUTION_2026-07-10.md'] = [[/Hondi AC/g, '나비 AC']];
stat.manual = 0;
if (APPLY || true) {
  for (const f of new Set([...Object.keys(MANUAL_EXACT), ...Object.keys(MANUAL_REGEX)])) {
    if (!files.includes(f)) continue;
    const t = fs.readFileSync(f, 'utf8'); let o = t;
    for (const [a, b] of MANUAL_EXACT[f] || []) o = o.split(a).join(b);
    for (const [re, rep, filt] of MANUAL_REGEX[f] || []) o = o.split('\n').map((l) => (!filt || filt.test(l)) ? l.replace(re, rep) : l).join('\n');
    if (o !== t) { stat.manual++; if (!changed.includes(f)) changed.push(f); if (APPLY) fs.writeFileSync(f, o); }
  }
}

if (APPLY && fs.existsSync('tools/build_kfoi_digest.mjs')) {          // 원문에서 만들어지는 요약 JSON은 다시 생성해야 한다
  try { execFileSync('node', ['tools/build_kfoi_digest.mjs'], { stdio: 'inherit' }); } catch (e) { console.error('! build_kfoi_digest 실패 — 수동 실행 필요'); }
}
if (APPLY) {
  const dirty = execFileSync('git', ['diff', '--name-only', '-z']).toString('utf8').split('\0').filter(Boolean);
  for (const f of dirty) if (!changed.includes(f)) changed.push(f);
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'changed-files.txt'), changed.join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'review.txt'), review.join('\n') + '\n');
const sum = [
  APPLY ? '[적용]' : '[건조 실행]',
  `검사 파일 ${stat.files} / 변경 파일 ${stat.changed}`,
  `한글 치환 ${stat.ko} (조사 교정 ${stat.josa}) / 영문 표시명 ${stat.lat} / 로고 경로 ${stat.logo} / 트리거 이중 등록 ${stat.dual} / 2차 개별 항목 ${stat.manual}개 파일`,
  `보류(검토 필요) ${stat.review}: ` + JSON.stringify(reviewByKind),
].join('\n');
fs.writeFileSync(path.join(OUT, 'summary.txt'), sum + '\n');
console.log(sum);
