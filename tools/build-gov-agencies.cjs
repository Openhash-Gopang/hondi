#!/usr/bin/env node
/* build-gov-agencies.cjs — pages/k-government.html 의 기관 데이터를 assets/gov-agency-data.js 로 뽑는다.
   pages/gov-agency.html(행정기관 공통 페이지)이 gov_code 로 기관 이름·소속·SP 원문 경로를 동기적으로 찾기 위한 색인이다.
   k-government.html 의 기관 목록이 바뀌면 이 스크립트를 다시 실행한다:  node tools/build-gov-agencies.cjs */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'pages/k-government.html'), 'utf8');
const lines = html.split('\n');

// 데이터 선언(var GOV_… / SP_… / Object.assign(SP_PATH_INDEX…) 한 줄짜리)과 govResolveSpPath 함수만 뽑아 실행한다.
const picks = [];
lines.forEach((l, i) => {
  if (/^var (GOV_NATIONAL|GOV_LEGISLATIVE|GOV_JUDICIAL|GOV_CAT_LABEL|GOV_PROVINCES|GOV_PROVINCE_ORDER|SP_PATH_INDEX|SP_DOMAIN_TEMPLATE|GOV_CITY|NAT_AGENCY_TEMPLATE) =/.test(l)
      || /^Object\.assign\((SP_PATH_INDEX|GOV_PROVINCES[^,]*),/.test(l)) picks.push(l);
});
const fnStart = lines.findIndex(l => l.startsWith('function govResolveSpPath'));
if (fnStart < 0) throw new Error('govResolveSpPath 를 찾지 못했습니다 — k-government.html 구조가 바뀌었습니다.');
let fnEnd = fnStart; while (!/^}/.test(lines[fnEnd])) fnEnd++;
const code = picks.join('\n') + '\n' + lines.slice(fnStart, fnEnd + 1).join('\n') +
  '\n;({GOV_NATIONAL, GOV_LEGISLATIVE, GOV_JUDICIAL, GOV_CAT_LABEL, GOV_PROVINCES, GOV_PROVINCE_ORDER, GOV_CITY: typeof GOV_CITY!=="undefined"?GOV_CITY:null, govResolveSpPath})';
const ctx = vm.createContext({});
const D = vm.runInContext(code, ctx);

// SP 파일이 새 버전으로 올라가도 k-government.html 의 경로 표는 옛 버전에 머물러 있는 경우가 있다(2026-10-19 조사: 98개 중 73개).
// 저장소에 그 파일이 없으면 같은 폴더의 같은 이름에서 가장 높은 버전을 대신 쓰고, 그것도 없으면 null 로 둔다(방법론 탭이 404 를 내지 않게).
function latestExisting(p) {
  if (!p) return { path: null };
  if (fs.existsSync(path.join(root, p))) return { path: p };
  const dir = path.dirname(p), stem = path.basename(p).replace(/_v[\d_.]+\.md$/, '');
  let files = [];
  try { files = fs.readdirSync(path.join(root, dir)); } catch (e) { return { path: null, missing: p }; }
  const ver = (f) => (f.match(/_v([\d_.]+)\.md$/) || [, '0'])[1].split(/[_.]/).map(Number);
  const cands = files.filter(f => f.startsWith(stem + '_v') && /_v[\d_.]+\.md$/.test(f) && f.slice(0, stem.length) === stem)
    .sort((a, b) => { const x = ver(a), y = ver(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (y[i] || 0) - (x[i] || 0); if (d) return d; } return 0; });
  return cands.length ? { path: dir + '/' + cands[0], bumped: p } : { path: null, missing: p };
}
const bumped = [], missingSp = [];
const out = {};      // govCode -> [이름, 소속(그룹), SP 경로|null]
const dup = [];
function add(item, group) {
  if (!item || !item.govCode) return;
  if (out[item.govCode]) { dup.push(item.govCode); return; }
  const r = latestExisting(D.govResolveSpPath(item.govCode) || null);
  if (r.bumped) bumped.push(item.govCode); if (r.missing) missingSp.push([item.govCode, item.label, r.missing]);
  out[item.govCode] = [item.label, group, r.path];
}
(D.GOV_NATIONAL || []).forEach(s => add(s, '중앙정부 · ' + (D.GOV_CAT_LABEL[s.cat] || s.cat)));
(D.GOV_LEGISLATIVE || []).forEach(s => add(s, '입법'));
(D.GOV_JUDICIAL || []).forEach(s => add(s, '사법'));
Object.keys(D.GOV_PROVINCES || {}).forEach(pk => {
  const p = D.GOV_PROVINCES[pk], L = p.label;
  const groups = [['dept', L + ' 부서'], ['agency', L + ' 직속기관'], ['org', L + ' 출자출연기관'], ['emd', L + ' 읍·면·동'],
                  ['natAgency', '국가기관 지역사무소(' + L + ' 소재)'], ['deptDivision', L + ' 부서 세부과'],
                  ['agencyDivision', L + ' 직속기관 세부과'], ['orgDivision', L + ' 출자출연기관 세부팀']];
  groups.forEach(([k, g]) => (p[k] || []).forEach(s => add(s, g)));
  Object.keys(p.city || {}).forEach(ck => (p.city[ck].dept || []).forEach(s => add(s, p.city[ck].label + ' 부서(시청)')));
});

const body = '/* 자동 생성 — 직접 고치지 말고 `node tools/build-gov-agencies.cjs` 로 다시 만든다. 원천: pages/k-government.html\n' +
  '   형식: { govCode: [이름, 소속, SP 원문 경로(prompts/… 또는 null)] } */\n' +
  'window.GOV_AGENCIES = ' + JSON.stringify(out) + ';\n';
fs.writeFileSync(process.env.GOV_AGENCY_OUT || path.join(root, 'assets/gov-agency-data.js'), body);   // GOV_AGENCY_OUT: 테스트용 출력 경로
if (process.env.GOV_AGENCY_VERBOSE) missingSp.forEach(m => console.log('  SP 파일 없음:', m.join(' | ')));
console.log('최신 버전으로 보정 ' + bumped.length + '개, 저장소에 SP 파일이 없는 기관 ' + missingSp.length + '개(경로 null 처리)');
console.log('기관 ' + Object.keys(out).length + '개 기록, 중복 govCode ' + dup.length + '개, SP 경로 없음 ' +
  Object.values(out).filter(v => !v[2]).length + '개, 크기 ' + (body.length / 1024).toFixed(0) + ' KB');
