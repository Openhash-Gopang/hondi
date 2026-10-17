#!/usr/bin/env node
// tools/build_repo_digest.mjs
// 「제안 및 질문」 SP(SP_SUGGEST_QUESTION)가 근거로 쓰는 저장소 요약 data/repo-digest.md 를 만든다.
// 저장소를 실시간으로 읽는 것이 아니라, 이 스크립트가 주기적으로(.github/workflows/refresh-repo-digest.yml)
// 최근 변경·페이지 목록·로드맵 발췌를 뽑아 한 파일로 남기고, 페이지가 그 파일을 읽어 대화 컨텍스트에 붙인다.
// 같은 저장소 상태에서는 같은 결과가 나오도록 시각은 '마지막 비-chore 커밋'의 시각을 쓴다(불필요한 커밋 방지).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'repo-digest.md');
const MAX_CHARS = 14000;

const git = (...a) => { try { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return ''; } };
// 비밀처럼 보이는 줄은 요약에 넣지 않는다.
const SECRET = /(api[_-]?key|secret|password|passwd|token|private[_-]?key)\s*[:=]/i;
const clean = (s) => s.split('\n').filter((l) => !SECRET.test(l)).join('\n');
const read = (f) => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { return ''; } };
const kst = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '알 수 없음';
  const p = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d);
  return p.replace(',', '') + ' KST';
};

// 1) 기준 커밋(마지막 비-chore 커밋)
const head = git('log', '-1', '--grep=^chore: ', '--invert-grep', '--format=%h|%cI') || git('log', '-1', '--format=%h|%cI');
const [sha = '?', iso = ''] = head.split('|');

// 2) 최근 변경 — chore/bump 제외, 최대 40건
const logRaw = git('log', '-n', '120', '--format=%cI|%s', '--grep=^chore: ', '--invert-grep');
const recent = logRaw.split('\n').filter(Boolean).slice(0, 40).map((l) => {
  const i = l.indexOf('|');
  return `- ${kst(l.slice(0, i)).slice(0, 10)} ${l.slice(i + 1).replace(/\s+\(#\d+\)$/, '')}`;
});

// 3) 페이지 목록 — 전문가 페르소나 페이지(startBox 사용)는 개수만, 나머지는 제목 목록
const pagesDir = path.join(ROOT, 'pages');
const personaPages = [];
const otherPages = [];
if (fs.existsSync(pagesDir)) {
  for (const f of fs.readdirSync(pagesDir).filter((x) => x.endsWith('.html')).sort()) {
    const t = read(path.join('pages', f));
    const title = ((t.match(/<title>([^<]*)<\/title>/i) || [])[1] || f).replace(/\s*[—-]\s*나비\s*$/, '').trim();
    if (t.includes('id="startBox"')) personaPages.push(f.replace(/\.html$/, ''));
    else otherPages.push(`- /pages/${f} — ${title}`);
  }
}

// 4) SP 개수
let spCount = 0;
try { spCount = Object.keys(JSON.parse(read('prompts/sp-catalog.json'))).length; } catch {}

// 5) 로드맵/README 발췌
const excerpt = (f, n) => clean(read(f).split('\n').slice(0, n).join('\n')).trim();

const parts = [];
parts.push('# hondi.net 저장소 요약');
parts.push(`- 갱신: ${kst(iso)} · 기준 커밋 ${sha}`);
parts.push(`- 전문가 페르소나 전용 페이지 ${personaPages.length}개 · 등록된 SP ${spCount}건`);
parts.push('- 이 요약은 자동 생성되며 저장소의 확정된 내용만 담는다. 계획·논의 단계 항목은 확정이 아니다.');
parts.push('\n## 최근 변경(최신순)\n' + (recent.join('\n') || '- (없음)'));
parts.push('\n## 주요 페이지(전문가 페르소나 전용 페이지 제외)\n' + (otherPages.slice(0, 70).join('\n') || '- (없음)'));
parts.push('\n## 전문가 페르소나 전용 페이지 id\n' + personaPages.join(', '));
const rm = excerpt('ROADMAP.md', 70);
if (rm) parts.push('\n## ROADMAP.md 발췌(계획 — 확정 아님)\n' + rm);
const rd = excerpt('README.md', 40);
if (rd) parts.push('\n## README.md 발췌\n' + rd);

let md = parts.join('\n') + '\n';
if (md.length > MAX_CHARS) md = md.slice(0, MAX_CHARS - 40).replace(/\n[^\n]*$/, '') + '\n…(길이 제한으로 잘림)\n';
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, md, 'utf8');
console.log(`repo digest: ${md.length} chars -> ${path.relative(ROOT, OUT)}`);
