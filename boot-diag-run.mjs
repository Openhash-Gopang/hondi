// 혼디 webapp 시동(부팅) 진단 — 실제 사이트에서 webapp.html이 불러오는 모든 스크립트/모듈을 따라가며
// ① 응답 상태(200이 아니면 시동이 멈춘다) ② 내용 유형(JS인데 HTML이 오면 오류) ③ 저장소 파일과 같은지 를 검사한다.
// 사용: 저장소 폴더에서  node check-boot-graph.mjs https://hondi.net [저장소경로=.]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const base = (process.argv[2] || 'https://hondi.net').replace(/\/$/, '');
const TIMEOUT = 15000;      // 요청 하나가 15초 안에 끝나지 않으면 "멈춤"으로 기록하고 다음으로 넘어간다
const repo = process.argv[3] || '.';
const seen = new Map(), queue = [];
const sha = b => crypto.createHash('sha1').update(b).digest('hex').slice(0, 10);
const norm = s => s.replace(/\r\n/g, '\n');

function add(url, from) { const u = url.split('#')[0]; if (!seen.has(u)) { seen.set(u, { from }); queue.push(u); } }
function refs(text) {
  const out = new Set();
  for (const m of text.matchAll(/(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g)) out.add(m[1]);
  for (const m of text.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) out.add(m[1]);
  return [...out];
}

// 시작점: webapp.html 의 <script src>
console.log('webapp.html 요청 중 …');
let html;
try {
  const t0 = Date.now();
  const htmlRes = await fetch(base + '/webapp.html', { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT) });
  console.log(`webapp.html → HTTP ${htmlRes.status} (헤더 ${Date.now() - t0}ms)`);
  html = await htmlRes.text();
  console.log(`webapp.html 본문 ${html.length}자 (${Date.now() - t0}ms)`);
} catch (e) { console.log(`✗ webapp.html 을 ${TIMEOUT / 1000}초 안에 끝까지 받지 못함 (${e.name}) — 서버가 본문을 보내다 멈춘 것입니다.`); process.exit(1); }
for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)) add(new URL(m[1], base + '/webapp.html').href, 'webapp.html');
for (const m of html.matchAll(/import\s+[^'"]*from\s+['"](\.[^'"]+)['"]/g)) add(new URL(m[1], base + '/webapp.html').href, 'webapp.html(inline)');

const problems = [];
let n = 0;
while (queue.length) {
  const url = queue.shift(); n++;
  if (!url.startsWith(base)) continue;                                   // 외부(CDN 등)는 건너뜀
  let res, body;
  const t0 = Date.now();
  process.stdout.write(`… ${url.replace(base, '')}`);
  try { res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT) }); body = Buffer.from(await res.arrayBuffer()); }
  catch (e) { console.log(`  ✗ ${e.name === 'TimeoutError' ? '멈춤(' + TIMEOUT / 1000 + '초 초과)' : e.message}`); problems.push(`${e.name === 'TimeoutError' ? '응답 멈춤' : '요청 실패'}  ${url}  ← ${seen.get(url).from}`); continue; }
  console.log(`  ${res.status} ${Date.now() - t0}ms`);
  const ct = res.headers.get('content-type') || '';
  const rel = decodeURIComponent(new URL(url).pathname).replace(/^\//, '');
  if (!res.ok) { problems.push(`HTTP ${res.status}  ${url}  ← ${seen.get(url).from}`); continue; }
  if (/\.m?js($|\?)/.test(url) && /html/i.test(ct)) { problems.push(`JS 자리에 HTML이 옴(사실상 404)  ${url}  ← ${seen.get(url).from}`); continue; }
  let note = '';
  const local = path.join(repo, rel);
  if (fs.existsSync(local)) {
    const a = norm(fs.readFileSync(local, 'utf8')), b = norm(body.toString('utf8'));
    if (a !== b) { note = '  ⚠ 저장소 파일과 다름'; problems.push(`저장소와 다름  ${rel}  (사이트 ${sha(b)} / 저장소 ${sha(a)})`); }
  } else note = '  (저장소에 없음)';
  if (/\.m?js($|\?)/.test(url)) for (const r of refs(body.toString('utf8'))) if ((r.startsWith('.') || r.startsWith('/')) && !/\.\.\.|\$\{|\s/.test(r)) add(new URL(r, url).href, rel);   // 주석·문자열 속 예시 경로(...)는 제외
  if (process.env.VERBOSE) console.log(`${res.status} ${rel}${note}`);
}
console.log(`\n검사한 파일 ${seen.size}개`);
if (!problems.length) console.log('문제 없음 — 모든 파일이 200이고 저장소와 같습니다. (시동 정지는 서버 응답/캐시 쪽일 수 있음)');
else { console.log(`\n문제 ${problems.length}건:`); problems.forEach(p => console.log(' - ' + p)); }
