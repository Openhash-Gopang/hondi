#!/usr/bin/env node
/* extract-gov-tasks.cjs — 서버(worker.js)의 REQUIRED_DOCUMENTS_REGISTRY(실제로 접수되는 GOV_TASK 목록과 필수 서류)를
   assets/gov-agency-tasks.js 로 뽑고, 각 task 를 기관 색인(assets/gov-agency-data.js)의 기관과 이름으로 연결한다 (2026-10-19 신설).

   왜: 기관 페이지의 「민원 서류 목록」이 서버가 실제로 접수하는 task 와 따로 놀면 안 된다. 접수 연동이 되는 민원은 이 레지스트리가 정본이다.
   연결 규칙: task 의 agency_name 과 기관 색인의 이름이 정확히 같으면 연결하고, 아니면 TASK_AGENCY_OVERRIDE(아래, 사람이 확인한 것만)를 쓴다.
              어느 쪽도 아니면 연결하지 않고 "미연결"로 보고한다 — 추측해서 잇지 않는다.
   사용: node tools/extract-gov-tasks.cjs   (worker.js 의 레지스트리가 바뀌면 다시 실행. GOV_TASK_OUT 으로 출력 경로 변경 가능) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');

const start = src.indexOf('const REQUIRED_DOCUMENTS_REGISTRY = {');
if (start < 0) throw new Error('worker.js 에서 REQUIRED_DOCUMENTS_REGISTRY 를 찾지 못했습니다.');
let i = start + 'const REQUIRED_DOCUMENTS_REGISTRY = '.length, depth = 0, end = -1, inStr = null, esc = false, lineC = false, blockC = false;
for (let k = i; k < src.length; k++) {   // 문자열·주석 안의 중괄호를 세지 않는 균형 스캔
  const c = src[k], n = src[k + 1];
  if (lineC) { if (c === '\n') lineC = false; continue; }
  if (blockC) { if (c === '*' && n === '/') { blockC = false; k++; } continue; }
  if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === inStr) inStr = null; continue; }
  if (c === '/' && n === '/') { lineC = true; continue; }
  if (c === '/' && n === '*') { blockC = true; continue; }
  if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
  if (c === '{') depth++;
  else if (c === '}') { depth--; if (depth === 0) { end = k; break; } }
}
if (end < 0) throw new Error('레지스트리의 끝을 찾지 못했습니다.');
const REG = vm.runInNewContext('(' + src.slice(i, end + 1) + ')', {});

const w = {}; vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/gov-agency-data.js'), 'utf8'), { window: w });
const AG = w.GOV_AGENCIES;
const byName = {}; Object.entries(AG).forEach(([c, v]) => { (byName[v[0]] = byName[v[0]] || []).push(c); });

// 사람이 확인한 연결만 적는다. 형식: 'task키': ['기관 코드', …]
const TASK_AGENCY_OVERRIDE = {};

const tasks = {}, byAgency = {}, unlinked = [];
Object.entries(REG).forEach(([key, t]) => {
  tasks[key] = {
    name: t.task_name, agency: t.agency_name, basis: t.legal_basis || '',
    docs: (t.documents || []).map(d => [d.name, d.required ? 1 : 0, d.acquisition || ''])
  };
  let codes = TASK_AGENCY_OVERRIDE[key] || (byName[t.agency_name] && byName[t.agency_name].length === 1 ? byName[t.agency_name] : null);
  if (!codes) { unlinked.push([key, t.agency_name]); return; }
  codes.forEach(c => { (byAgency[c] = byAgency[c] || []).push(key); });
});

const body = '/* 자동 생성 — 직접 고치지 말고 `node tools/extract-gov-tasks.cjs` 로 다시 만든다. 원천: worker.js 의 REQUIRED_DOCUMENTS_REGISTRY\n' +
  '   GOV_TASKS: task 키 → {name, agency, basis(근거 법령), docs:[[서류 이름, 필수(1/0), 발급 경로]]}   GOV_TASK_BY_AGENCY: 기관 코드 → task 키 목록 */\n' +
  'window.GOV_TASKS = ' + JSON.stringify(tasks) + ';\nwindow.GOV_TASK_BY_AGENCY = ' + JSON.stringify(byAgency) + ';\n';
fs.writeFileSync(process.env.GOV_TASK_OUT || path.join(root, 'assets/gov-agency-tasks.js'), body);
console.log(`task ${Object.keys(tasks).length}개 → 기관 연결 ${Object.values(byAgency).reduce((a, b) => a + b.length, 0)}건 (기관 ${Object.keys(byAgency).length}곳), 미연결 ${unlinked.length}개`);
unlinked.forEach(([k, n]) => console.log('  미연결:', k, '|', n));
