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

const out = {};      // govCode -> [이름, 소속(그룹), SP 경로|null]
const dup = [];
function add(item, group) {
  if (!item || !item.govCode) return;
  if (out[item.govCode]) { dup.push(item.govCode); return; }
  out[item.govCode] = [item.label, group, D.govResolveSpPath(item.govCode) || null];
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
console.log('기관 ' + Object.keys(out).length + '개 기록, 중복 govCode ' + dup.length + '개, SP 경로 없음 ' +
  Object.values(out).filter(v => !v[2]).length + '개, 크기 ' + (body.length / 1024).toFixed(0) + ' KB');
