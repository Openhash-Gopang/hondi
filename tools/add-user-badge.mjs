// tools/add-user-badge.mjs — 모든 HTML 페이지에 공용 아이디 표시(user-badge.js)를 한 줄씩 넣는다.
// 실행(저장소 루트):  node tools/add-user-badge.mjs [--dry]
//  · 여러 번 실행해도 안전(이미 들어 있으면 건너뜀) · BOM·줄바꿈(CRLF/LF) 유지
//  · 건너뛰는 것: node_modules/, auth/(로그인 절차 화면), </body>가 없는 조각 파일, <script> 안에서만 </body>가 보이는 파일
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const DRY = process.argv.includes('--dry');
const TAG = '<script src="https://hondi.net/auth/user-badge.js?v=20261027" defer></script>';
const files = execSync("git ls-files '*.html'", { encoding: 'utf8' }).split('\n').filter(Boolean);
const stat = { added: 0, already: 0, skipPrefix: 0, fragment: 0, inScript: 0 };
const notes = [];

for (const f of files) {
  if (f.startsWith('node_modules/') || f.startsWith('auth/')) { stat.skipPrefix++; continue; }
  const buf = fs.readFileSync(f);
  const bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  let s = buf.toString('utf8');
  if (bom) s = s.slice(1);
  if (s.includes('auth/user-badge.js')) { stat.already++; continue; }

  let idx = -1; const re = /<\/body\s*>/gi; let m;
  while ((m = re.exec(s)) !== null) idx = m.index;
  if (idx < 0) { stat.fragment++; notes.push('조각(</body> 없음): ' + f); continue; }

  const before = s.slice(0, idx);
  if (before.toLowerCase().lastIndexOf('<script') > before.toLowerCase().lastIndexOf('</script')) {
    stat.inScript++; notes.push('스크립트 안: ' + f); continue;
  }
  const nl = s.includes('\r\n') ? '\r\n' : '\n';
  const out = before + TAG + nl + s.slice(idx);
  if (!DRY) fs.writeFileSync(f, Buffer.concat([bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(out, 'utf8')]));
  stat.added++;
}
console.log((DRY ? '[dry-run] ' : '') + JSON.stringify(stat));
notes.forEach(n => console.log(' - ' + n));
