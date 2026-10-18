#!/usr/bin/env node
/* extract-gov-sp.cjs — 기관 SP(prompts/gov-tree/…)에서 "업무 초안표"를 뽑는다 (2026-10-19 신설, 기관별 customization 1단계)

   뽑는 것: §LEGAL-BASIS(법적 근거) · §2 완결 처리 업무 · §3 연계 업무(표) · §4 연락처 · SP 버전 · 상속 여부.
   웹 조사는 하지 않는다 — SP 가 이미 말하는 범위만 정리한다. 서류 조사(2단계)의 출발점이자, 페이지 내용이 SP 와 어긋나는지 대조하는 기준이다.
   같은 SP 파일을 여러 기관이 공유하면(시·도 부서 189곳 = 20개 도메인 템플릿, 국가기관 지역사무소 143곳 = 34개 도메인) 파일당 한 번만 뽑고 적용 기관을 함께 적는다.

   사용:  node tools/extract-gov-sp.cjs --group "제주시 부서(시청)" --tag jejusi-city-depts   # 소속 그룹 하나(소속 이름은 --list-groups) — 출력 파일명은 영문 --tag
          node tools/extract-gov-sp.cjs --code city-dept:jejusi:SP-CITYDIV-JEJUSI-JACHI-TAX
          node tools/extract-gov-sp.cjs --list-groups                      # 그룹 목록과 기관 수
   출력:  docs/gov-agency-research/drafts/<그룹>.md  (사람이 읽는 표)  +  <그룹>.json  (기계가 읽는 표) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.resolve(__dirname, '..');
const outDir = process.env.GOV_EXTRACT_OUT || path.join(root, 'docs/gov-agency-research/drafts');
const w = {}; vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/gov-agency-data.js'), 'utf8'), { window: w });
const AG = w.GOV_AGENCIES;

const tw = {}; try { vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/gov-agency-tasks.js'), 'utf8'), { window: tw }); } catch (e) {}
const TASKS = tw.GOV_TASKS || {};
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
if (process.argv.includes('--list-groups')) {
  const m = {}; Object.values(AG).forEach(v => { m[v[1]] = (m[v[1]] || 0) + 1; });
  Object.entries(m).sort((a, b) => b[1] - a[1]).forEach(([g, n]) => console.log(String(n).padStart(4), g)); process.exit(0);
}
const group = arg('--group'), code = arg('--code');
if (!group && !code) { console.error('--group "<소속>" 또는 --code <govCode> 가 필요합니다 (--list-groups 로 목록 확인)'); process.exit(1); }
const targets = Object.entries(AG).filter(([c, v]) => code ? c === code : v[1] === group);
if (!targets.length) { console.error('해당하는 기관이 없습니다'); process.exit(1); }

const clean = (s) => s.replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim();
function section(text, re) {           // "## …" 제목이 re 에 맞는 절의 본문(다음 "## " 전까지)
  const lines = text.split('\n'); let on = false, out = [];
  for (const l of lines) {
    if (/^## /.test(l)) { if (on) break; on = re.test(l); continue; }
    if (on) out.push(l);
  }
  return out;
}
function parse(file) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const ver = (path.basename(file).match(/_v([\d_.]+)\.md$/) || [, ''])[1];
  const legal = section(text, /§LEGAL-BASIS/).map(clean).filter(l => l.startsWith('-') || l.length > 2).map(l => l.replace(/^-\s*/, '')).filter(Boolean);
  const t2 = section(text, /^## §2\b/);
  const tasks = []; t2.forEach(l => {
    const m = l.match(/^\s*(?:\d+\.|[-*])\s+(.*\S)/);
    if (m && !/^>/.test(l)) tasks.push(clean(m[1]));
  });
  // 파이프라인형 SP(도시건설국 등): §2 가 "| task_key | 필요 서류 | 수수료 |" 표다. 완결 처리 업무 대신 접수 task 로 따로 뽑는다.
  const pipeline = [];
  section(text, /^## §2\b/).forEach(l => {
    if (!/^\s*\|/.test(l) || /^\s*\|\s*-/.test(l)) return;
    const c = l.trim().replace(/^\||\|$/g, '').split('|').map(clean);
    if (/^task_key$/i.test(c[0])) return;
    if (c[0] && /^[a-z0-9_]+$/.test(c[0])) pipeline.push({ taskKey: c[0], docs: c[1] || '', fee: c[2] || '' });
  });
  const t3 = section(text, /^## §3\b|^## §4\b/);
  const refs = []; t3.forEach(l => {
    if (!/^\s*\|/.test(l) || /^\s*\|\s*-/.test(l)) return;
    const c = l.trim().replace(/^\||\|$/g, '').split('|').map(clean);
    if (c[0] && c[0] !== '업무영역') refs.push({ area: c[0], handler: c[1] || '', sp: c[2] || '' });
  });
  const contacts = section(text, /^## §4\b/).filter(l => /^\s*[-*]/.test(l)).map(l => clean(l.replace(/^\s*[-*]\s*/, '')));
  const inherits = legal.some(l => /상속/.test(l));
  const verified = (legal.join(' ').match(/legal_basis_last_verified:\s*([\d-]+)/) || [, ''])[1];
  return { version: ver, legalBasis: legal, tasks, pipelineTasks: pipeline, referrals: refs, contacts, inheritsLegalBasis: inherits, legalBasisVerified: verified };
}

const byFile = new Map();
const noSp = [];
for (const [c, [name, grp, sp]] of targets) {
  if (!sp) { noSp.push({ code: c, name }); continue; }
  if (!byFile.has(sp)) byFile.set(sp, { file: sp, agencies: [], ...parse(sp) });
  byFile.get(sp).agencies.push({ code: c, name });
  // SP 가 선언한 접수 task 가 서버 레지스트리(worker.js)에 있는지 대조한다. 키는 "<지역 접두>:<task_key>" (예: jejusi:building_permit).
  const prefix = c.split(':')[1];
  byFile.get(sp).pipelineTasks.forEach(p => { if (!TASKS[prefix + ':' + p.taskKey]) (byFile.get(sp).unregistered = byFile.get(sp).unregistered || []).push(prefix + ':' + p.taskKey); });
}
const units = [...byFile.values()];
// 파일 이름은 ASCII 로 둔다(Windows PowerShell 5.1 의 Expand-Archive 가 한글 파일명 zip 을 못 푼다). 그룹 이름이 한글이면 --tag 로 이름을 정한다.
const tag = (arg('--tag') || (code || group)).replace(/[\\/:*?"<>|\s]+/g, '_');
if (/[^\x20-\x7e]/.test(tag)) { console.error('출력 파일 이름에 한글이 들어갑니다 — --tag <영문-이름> 을 지정하세요 (예: --tag jejusi-city-depts)'); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, tag + '.json'), JSON.stringify({ source: code || group, generated: new Date().toISOString().slice(0, 10), units, noSp }, null, 1));

let md = `# 업무 초안표 — ${code || group}\n\n` +
  `> SP 에서 자동 추출한 초안입니다(\`node tools/extract-gov-sp.cjs\`). 웹 조사는 하지 않았습니다. 서류 조사(2단계)의 출발점이며, 정본은 각 SP 입니다.\n` +
  `> 기관 ${targets.length}곳 → SP 파일 ${units.length}개` + (noSp.length ? `, SP 없음 ${noSp.length}곳` : '') + `\n\n`;
for (const u of units) {
  md += `## ${u.agencies.map(a => a.name).join(' · ')}\n\n- SP: \`${u.file}\` (v${u.version})\n`;
  if (u.agencies.length > 1) md += `- 같은 SP 를 쓰는 기관 ${u.agencies.length}곳: ${u.agencies.map(a => a.code).join(', ')}\n`;
  md += `- 법적 근거${u.inheritsLegalBasis ? '(상위 상속)' : ''}${u.legalBasisVerified ? ', 마지막 확인 ' + u.legalBasisVerified : ''}: ${u.legalBasis.filter(l => !/^legal_basis_last_verified|^페르소나 유형/.test(l)).join(' / ') || '(없음)'}\n`;
  md += `- 완결 처리 업무 ${u.tasks.length}건` + (u.tasks.length ? '\n' + u.tasks.map((t, i) => `  ${i + 1}. ${t}`).join('\n') : ' — 없음(일반 템플릿일 가능성)') + '\n';
  if (u.pipelineTasks.length) md += `- 접수 연동 task(SP §2 표)\n` + u.pipelineTasks.map(p => `  - \`${p.taskKey}\` — 필요 서류: ${p.docs}` + (p.fee ? ` / 수수료: ${p.fee}` : '')).join('\n') + '\n';
  if (u.unregistered && u.unregistered.length) md += `- ⚠ 서버 레지스트리 미등록 task: ${[...new Set(u.unregistered)].join(', ')} (SP 는 선언했으나 worker.js REQUIRED_DOCUMENTS_REGISTRY 에 없음)\n`;
  if (u.referrals.length) md += `- 연계 업무\n` + u.referrals.map(r => `  - ${r.area} → ${r.handler}`).join('\n') + '\n';
  if (u.contacts.length) md += `- 연락처·안내: ${u.contacts.join(' / ')}\n`;
  md += '\n';
}
if (noSp.length) md += `## SP 없음\n\n` + noSp.map(n => `- ${n.name} (${n.code})`).join('\n') + '\n';
fs.writeFileSync(path.join(outDir, tag + '.md'), md);
const withTasks = units.filter(u => u.tasks.length).length;
console.log(`${code || group}: 기관 ${targets.length}곳 → SP ${units.length}개 (완결 업무 있음 ${withTasks}, 연계 업무 있음 ${units.filter(u => u.referrals.length).length}), SP 없음 ${noSp.length}`);
const unreg = units.filter(u => u.unregistered && u.unregistered.length);
if (unreg.length) console.log('⚠ 서버 레지스트리 미등록 task: ' + unreg.map(u => [...new Set(u.unregistered)].join(',')).join(' / '));
console.log('→ ' + path.relative(root, path.join(outDir, tag + '.md')));
