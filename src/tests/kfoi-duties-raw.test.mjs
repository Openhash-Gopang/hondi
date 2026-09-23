// 별표(분장사무) 원문 추출 결과 검증 — 2026-09-22.
// prompts/gov-tree/kfoi-digest/duties-raw-2024-01-22.json (별표 7·8·9·10·11 전문 추출)와
// duties-usable-now.json(confirmed-current와 부서명이 일치하는 것만 추린 목록)을 확인한다.
// K-FOI 도구에는 아직 연결하지 않았다(§2 작성 여부를 사람이 먼저 검토해야 해서) — 파일 자체의 무결성만 본다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'prompts/gov-tree/kfoi-digest');
let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log(`✅ ${name}`); }
  catch (e) { fail++; console.log(`❌ ${name}\n     ${String(e && e.message).split('\n')[0]}`); }
}

const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'duties-raw-2024-01-22.json'), 'utf8'));
const usable = JSON.parse(fs.readFileSync(path.join(DIR, 'duties-usable-now.json'), 'utf8'));

await test('원문 추출: 별표 5개 전부 있고, 행 수가 합리적이다(빈 표 없음)', () => {
  for (const key of ['별표7_본청', '별표8_직속기관', '별표9_사업소', '별표10_합의제행정기관', '별표11_하부행정기관']) {
    assert.ok(Array.isArray(raw[key].rows) && raw[key].rows.length > 0, key);
  }
  assert.equal(raw['별표7_본청'].rows.length, 62);
  assert.equal(raw['별표11_하부행정기관'].rows.length, 83);
});
await test('원문 추출: 모든 행에 부서명과 업무 목록이 있다(빈 부서명·빈 업무 없음)', () => {
  for (const key of Object.keys(raw)) {
    if (key === '_meta') continue;
    for (const r of raw[key].rows) {
      assert.ok(r.dept && r.dept.trim().length > 0, `${key}: 빈 부서명`);
      assert.ok(Array.isArray(r.duties) && r.duties.length > 0, `${key}: ${r.dept} 업무 없음`);
    }
  }
});
await test('원문 추출: 부서명이 같은 문자열의 반복(파싱 결함)이 아니다', () => {
  for (const key of Object.keys(raw)) {
    if (key === '_meta') continue;
    for (const r of raw[key].rows) {
      const n = r.dept.length;
      for (let k = 1; k <= n / 2; k++) {
        if (n % k === 0 && r.dept.slice(0, k).repeat(n / k) === r.dept) {
          assert.fail(`${key}: "${r.dept}"가 반복 문자열로 보임(dedupe 결함)`);
        }
      }
    }
  }
});
await test('중요: 별표 7·8·9·11은 2024.01.22 개정본이라는 사실이 메타데이터에 명시돼 있다(본문 2026.8.21 개정보다 오래됨)', () => {
  assert.ok(raw._meta.CRITICAL_WARNING.includes('2024') && raw._meta.CRITICAL_WARNING.includes('2026'));
  for (const key of ['별표7_본청', '별표8_직속기관', '별표9_사업소', '별표11_하부행정기관']) {
    assert.ok(raw[key].개정일_원문표기 && raw[key].개정일_원문표기.includes('2024'), key);
  }
});
await test('사용 가능 목록: do 45건·city 68건이 confirmed-current org-baseline과 실제로 대응한다(스팟 체크)', () => {
  assert.equal(usable.do.length, 45); assert.equal(usable.city.length, 68);
  const climate = usable.do.find(x => x.spId === 'SP-DIV-CLIMATE-ENVPOLICY' && x.dept === '환경정책과');
  assert.ok(climate && climate.duties.length > 10, '환경산림자원국(환경정책과)의 업무가 있어야 함');
  assert.ok(usable.city.some(x => x.tier === 'seogwipo'), '서귀포시 항목이 있어야 함');
  assert.ok(usable.city.some(x => x.tier === 'jeju-si'), '제주시 항목이 있어야 함');
});
await test('사용 가능 목록: 2026년에 개편·신설된 부서(구 조직 명칭)는 섞여 있지 않다', () => {
  const staleNames = raw._meta.do_tier_classification.stale_dept_names;
  for (const item of usable.do) assert.ok(!staleNames.includes(item.dept), `구 조직명이 섞임: ${item.dept}`);
});

import { execFileSync } from 'node:child_process';
import { buildDigest } from '../../tools/build_kfoi_digest.mjs';

await test('작업 #4: 실제 반영된 도청 SP 40개의 §2가 분장사무로 바뀌었고, 요약본(digest)의 does에 caveat 인용문이 아니라 사무 항목만 잡힌다', () => {
  const digest = buildDigest();
  const applied = usable.do.filter(x => x.applied);
  assert.equal(applied.length, 40);
  let checked = 0;
  for (const hit of applied) {
    const t = digest.tiers.do.entries.find(e => e.id === hit.spId);
    assert.ok(t, `${hit.spId}(${hit.dept}): digest에 없음`);
    checked++;
    assert.equal(t.state, 'revised', `${hit.spId}: v1.0 그대로면 갱신이 안 된 것`);
    assert.ok(t.does && t.does.length > 0, `${hit.spId}: does가 비어 있음`);
    for (const line of t.does) {
      assert.ok(!line.startsWith('>'), `${hit.spId}: caveat 인용문이 does에 섞임 — ${line.slice(0, 40)}`);
      assert.ok(/^\d{1,3}\.\s/.test(line), `${hit.spId}: 번호 매긴 사무 형식이 아님 — ${line.slice(0, 40)}`);
    }
  }
  assert.equal(checked, 40);
});
await test('작업 #4: 반영하지 않은 5건(도시계획과·소방안전본부 4개)은 applied:false로 정직하게 남아 있다', () => {
  const notApplied = usable.do.filter(x => !x.applied);
  assert.equal(notApplied.length, 5);
  assert.ok(notApplied.some(x => x.dept === '도시계획과'));
  assert.equal(notApplied.filter(x => x.spId === 'SP-AGY-FIRE').length, 4);
});
await test('작업 #4 회귀: 파일 경로 참조(division-tables.js·페이지 인벤토리·gov-router.js)가 전부 새 버전 파일명을 가리킨다(check_stale_refs 0건)', () => {
  const out = execFileSync('python3', ['tools/check_stale_refs.py'], { cwd: ROOT }).toString();
  assert.ok(out.includes('모든 참조가 최신 파일과 일치합니다'), out);
});

await test('결함 수정 회귀: 제주시·서귀포시 duty 항목의 tier가 이름 겹침으로 뒤섞이지 않는다(별표11의 섹션 헤더로 확정)', () => {
  // 두 도시 모두에 있는 부서명("공보실"·"총무과"·"자치행정과" 등)이 최소 하나씩은 제주시 쪽에도 있어야 한다 —
  // 예전 결함은 이런 이름이 전부 서귀포시로 쏠렸다(이름만으로 대조 + 사전 순회 순서 때문에 뒤에 오는 도시가 덮어씀).
  const jejusiDepts = new Set(usable.city.filter(x => x.tier === 'jeju-si').map(x => x.dept));
  const seogwipoDepts = new Set(usable.city.filter(x => x.tier === 'seogwipo').map(x => x.dept));
  const overlap = [...jejusiDepts].filter(d => seogwipoDepts.has(d));
  assert.ok(overlap.length >= 5, `두 도시에 같은 이름의 부서가 이만큼은 있어야 정상: ${overlap.length}`);
  assert.ok(usable.city.filter(x => x.tier === 'jeju-si').length >= 30, 'jeju-si 항목이 비정상적으로 적음(결함 재발 의심)');
  assert.ok(usable.city.filter(x => x.tier === 'seogwipo').length >= 25, 'seogwipo 항목이 비정상적으로 적음(결함 재발 의심)');
});
await test('작업 #5: 실제 반영된 city SP 51개의 §2가 분장사무로 바뀌었다(도청과 같은 검증)', () => {
  const digest = buildDigest();
  const applied = usable.city.filter(x => x.applied);
  assert.equal(applied.length, 51);
  let checked = 0;
  for (const hit of applied) {
    const tierEntries = digest.tiers[hit.tier].entries;
    const t = tierEntries.find(e => e.id === hit.spId);
    assert.ok(t, `${hit.tier}/${hit.spId}(${hit.dept}): digest에 없음`);
    checked++;
    assert.equal(t.state, 'revised', `${hit.spId}: 갱신이 안 됨`);
    assert.ok(t.does && t.does.length > 0, `${hit.spId}: does가 비어 있음`);
    for (const line of t.does) {
      assert.ok(!line.startsWith('>'), `${hit.spId}: caveat이 does에 섞임`);
      assert.ok(/^\d{1,3}\.\s/.test(line), `${hit.spId}: 번호 매긴 사무 형식 아님`);
    }
  }
  assert.equal(checked, 51);
});
await test('작업 #5: 접수 파이프라인(task_key) 표를 가진 12개 division은 §2를 건드리지 않았다(실제 서비스 배선 보호)', () => {
  const digest = buildDigest();
  const notApplied = usable.city.filter(x => !x.applied && x.reason && x.reason.includes('task_key'));
  assert.equal(notApplied.length, 12);
  for (const x of notApplied) {
    const t = digest.tiers[x.tier].entries.find(e => e.id === x.spId);
    assert.ok(t, `${x.spId}: digest에 없음`);
    // task_key 표는 does로 추출되지 않아야 한다(파이프라인 표는 does 목록 형식이 아니므로) — 있어도 caveat류는 아니어야 함
    if (t.does) for (const line of t.does) assert.ok(!line.startsWith('>'), `${x.spId}: 잘못 건드림`);
  }
});
await test('작업 #5 회귀: city 파일 경로 참조(division-tables.js·페이지 인벤토리)가 전부 새 버전 파일명을 가리킨다', () => {
  const out = execFileSync('python3', ['tools/check_stale_refs.py'], { cwd: ROOT }).toString();
  assert.ok(out.includes('모든 참조가 최신 파일과 일치합니다'), out);
});

await test('작업 #6: 농업기술원·보건환경연구원·축산생명연구원 division 20개가 실제 분장사무(별표 8·9)로 신설됐다', () => {
  const digest = buildDigest();
  const created = [
    ['SP-AGY-AGRITECH', 9], ['SP-AGY-BOHWAN', 9], ['SP-AGY-CHUKSAN', 2],
  ];
  for (const [parentId, n] of created) {
    const divs = digest.tiers.agency.entries.filter(e => e.kind === 'division' &&
      digest.tiers.agency.entries.find(p => p.kind === 'institution' && p.id === parentId)?.name === e.parent);
    assert.equal(divs.length, n, `${parentId}: division 개수가 안 맞음`);
    for (const d of divs) {
      assert.equal(d.state, 'draft', `${d.id}: v1.0 신설이니 draft여야 함(초안이지만 내용은 실제 사무)`);
      assert.ok(d.does && d.does.length > 0, `${d.id}: does가 비어 있음`);
      for (const line of d.does) assert.ok(/^\d{1,3}\.\s/.test(line), `${d.id}: 번호 매긴 사무 형식 아님`);
    }
  }
});
await test('작업 #6 안전장치: 실제 접수 파이프라인(task_key)이 걸린 division 6개는 이번 배치에서 건드리지 않았다', () => {
  // 처음엔 "GOV_TASK"·"REQUIRED_DOCUMENTS_REGISTRY" 문자열이 있으면 배선된 것으로 잡았는데, LIBRARY-INFOSERVICE·
  // POLICE-SAFETY는 그 반대(등록 대상이 "아니다"라고 판정한 기록)였다 — task_key 실제 대입 여부로 다시 확인해 걸러냈다.
  // 그 둘은 다음 배치에서 다른 기관들처럼 완전히 새로 만들 수 있는 후보다(LIBRARY는 2개 division 전부 미배선이라
  // 통째로 가능할 수도 있다).
  const wired = [
    'SP-AGYDIV-ARTMUSEUM-JHYUN', 'SP-AGYDIV-ARTMUSEUM-MAIN', 'SP-AGYDIV-FOLKMUSEUM-ADMIN',
    'SP-AGYDIV-HERITAGE-MANAGEMENT', 'SP-AGYDIV-POLICE-TRAFFIC', 'SP-AGYDIV-WATER-WATERSUPPLY',
  ];
  for (const id of wired) {
    const path = execFileSync('bash', ['-c', `grep -rl "^# 문서 코드  : ${id}$" prompts/gov-tree/03-do-agency/divisions/*.md || true`], { cwd: ROOT }).toString().trim();
    assert.ok(path, `${id}: 파일을 못 찾음(실수로 이동·삭제됐을 수 있음)`);
    const content = fs.readFileSync(path, 'utf8');
    assert.ok(content.includes('task_key'), `${id}: task_key 배선이 사라짐 — 실제 서비스가 끊겼을 수 있음`);
  }
});
await test('작업 #6 회귀: archive로 옮긴 6개 파일이 실제로 archive/에 있고, live 디렉터리엔 없다', () => {
  const moved = [
    'SP-AGYDIV-AGRITECH-ADMIN_v1.0.md', 'SP-AGYDIV-AGRITECH-EXTENSION_v1.0.md', 'SP-AGYDIV-AGRITECH-RESEARCH_v1.0.md',
    'SP-AGYDIV-BOHWAN-ENVIRONMENT_v1.0.md', 'SP-AGYDIV-BOHWAN-HEALTH_v1.0.md', 'SP-AGYDIV-CHUKSAN-RESEARCH_v1.0.md',
  ];
  for (const f of moved) {
    assert.ok(fs.existsSync(path.join(ROOT, 'prompts/gov-tree/03-do-agency/archive', f)), `${f}: archive에 없음`);
    assert.ok(!fs.existsSync(path.join(ROOT, 'prompts/gov-tree/03-do-agency/divisions', f)), `${f}: live에 아직 있음`);
  }
});
await test('작업 #6: 축산진흥과→축산생명과 개명이 division 표시 이름에 반영됐다(별표의 옛 이름을 그대로 쓰지 않음)', () => {
  const digest = buildDigest();
  const names = digest.tiers.agency.entries.filter(e => e.kind === 'division' && e.parent === '축산생명연구원').map(e => e.name);
  assert.ok(names.some(n => n.includes('축산생명과')), names.join(','));
  assert.ok(!names.some(n => n.includes('축산진흥과')), '개명 전 이름이 그대로 노출됨: ' + names.join(','));
});

await test('작업 #7: 한라도서관 division 2개가 실제 분장사무(별표9)로 신설됐고 옛 "(추정)" 파일은 archive로 이동했다', () => {
  const digest = buildDigest();
  const inst = digest.tiers.agency.entries.find(e => e.id === 'SP-AGY-LIBRARY');
  const divs = digest.tiers.agency.entries.filter(e => e.kind === 'division' && e.parent === inst.name);
  assert.equal(divs.length, 2);
  for (const d of divs) {
    assert.equal(d.state, 'draft');
    assert.ok(!d.name.includes('추정'), `${d.id}: 이름에 "추정"이 남아 있음`);
    assert.ok(d.does && d.does.length > 0);
    for (const line of d.does) assert.ok(/^\d{1,3}\.\s/.test(line));
  }
  for (const f of ['SP-AGYDIV-LIBRARY-INFOSERVICE_v1.1.md', 'SP-AGYDIV-LIBRARY-POLICY_v1.0.md']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'prompts/gov-tree/03-do-agency/archive', f)), `${f}: archive에 없음`);
    assert.ok(!fs.existsSync(path.join(ROOT, 'prompts/gov-tree/03-do-agency/divisions', f)), `${f}: live에 아직 있음`);
  }
});

await test('작업 #8: 자치경찰단 division 6개가 실제 분장사무(별표8)로 신설되고, 배선된 교통과는 손대지 않았다', () => {
  const digest = buildDigest();
  const inst = digest.tiers.agency.entries.find(e => e.id === 'SP-AGY-POLICE');
  const divs = digest.tiers.agency.entries.filter(e => e.kind === 'division' && e.parent === inst.name);
  assert.equal(divs.length, 7, '새 6개 + 배선된 교통과 1개 = 7개여야 함');
  const traffic = divs.find(e => e.id === 'SP-AGYDIV-POLICE-TRAFFIC');
  assert.ok(traffic, '배선된 교통과가 남아 있어야 함');
  const tpath = execFileSync('bash', ['-c', 'grep -rl "^# 문서 코드  : SP-AGYDIV-POLICE-TRAFFIC$" prompts/gov-tree/03-do-agency/divisions/*.md || true'], { cwd: ROOT }).toString().trim();
  assert.ok(tpath, '교통과 파일을 못 찾음');
  assert.ok(fs.readFileSync(tpath, 'utf8').includes("task_key: 'parking_violation_fine_objection'"), '교통과의 실제 배선이 사라짐');
  const newDivs = divs.filter(e => e.id !== 'SP-AGYDIV-POLICE-TRAFFIC');
  assert.equal(newDivs.length, 6);
  for (const d of newDivs) {
    assert.equal(d.state, 'draft');
    assert.ok(d.does && d.does.length > 0);
    for (const line of d.does) assert.ok(/^\d{1,3}\.\s/.test(line));
  }
  for (const f of ['SP-AGYDIV-POLICE-SAFETY_v1.1.md', 'SP-AGYDIV-POLICE-WOMENYOUTH_v1.0.md']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'prompts/gov-tree/03-do-agency/archive', f)), `${f}: archive에 없음`);
    assert.ok(!fs.existsSync(path.join(ROOT, 'prompts/gov-tree/03-do-agency/divisions', f)), `${f}: live에 아직 있음`);
  }
  assert.ok(!fs.existsSync(path.join(ROOT, 'prompts/gov-tree/03-do-agency/archive', 'SP-AGYDIV-POLICE-TRAFFIC_v1.1.md')), '배선된 교통과가 실수로 archive에 옮겨지면 안 됨');
});

await test('작업 #9: 민속자연사박물관 division 2개가 실제 분장사무(별표9)로 신설되고, 배선된 관리실은 손대지 않았다', () => {
  const digest = buildDigest();
  const inst = digest.tiers.agency.entries.find(e => e.id === 'SP-AGY-FOLKMUSEUM');
  const divs = digest.tiers.agency.entries.filter(e => e.kind === 'division' && e.parent === inst.name);
  assert.equal(divs.length, 3, '새 2개 + 배선된 관리실 1개 = 3개여야 함');
  const admin = divs.find(e => e.id === 'SP-AGYDIV-FOLKMUSEUM-ADMIN');
  assert.ok(admin, '배선된 관리실이 남아 있어야 함');
  const apath = execFileSync('bash', ['-c', 'grep -rl "^# 문서 코드  : SP-AGYDIV-FOLKMUSEUM-ADMIN$" prompts/gov-tree/03-do-agency/divisions/*.md || true'], { cwd: ROOT }).toString().trim();
  assert.ok(apath, '관리실 파일을 못 찾음');
  assert.ok(fs.readFileSync(apath, 'utf8').includes("task_key: 'folkmuseum_facility_rental'"), '관리실의 실제 배선이 사라짐');
  const newDivs = divs.filter(e => e.id !== 'SP-AGYDIV-FOLKMUSEUM-ADMIN');
  assert.equal(newDivs.length, 2);
  for (const d of newDivs) {
    assert.equal(d.state, 'draft');
    assert.ok(d.does && d.does.length > 0);
    for (const line of d.does) assert.ok(/^\d{1,3}\.\s/.test(line));
  }
  for (const f of ['SP-AGYDIV-FOLKMUSEUM-ARCHAEOFOLK_v1.0.md', 'SP-AGYDIV-FOLKMUSEUM-MARINE_v1.0.md', 'SP-AGYDIV-FOLKMUSEUM-MINERALBOTANY_v1.0.md', 'SP-AGYDIV-FOLKMUSEUM-ZOOLOGY_v1.0.md']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'prompts/gov-tree/03-do-agency/archive', f)), `${f}: archive에 없음`);
    assert.ok(!fs.existsSync(path.join(ROOT, 'prompts/gov-tree/03-do-agency/divisions', f)), `${f}: live에 아직 있음`);
  }
  assert.ok(!fs.existsSync(path.join(ROOT, 'prompts/gov-tree/03-do-agency/archive', 'SP-AGYDIV-FOLKMUSEUM-ADMIN_v1.1.md')), '배선된 관리실이 실수로 archive에 옮겨지면 안 됨');
});

await test('작업 #10: 도립미술관·상하수도본부·세계유산본부 division 21개가 실제 분장사무(별표9)로 신설되고, 배선된 5개(JHYUN·MAIN·WATERSUPPLY·MANAGEMENT + 새로 옮긴 KIMTSCHANGYEUL)는 손대지 않았거나 이름 일치만 반영했다', () => {
  const digest = buildDigest();
  const created = [
    ['SP-AGY-ARTMUSEUM', 2], ['SP-AGY-WATER', 9], ['SP-AGY-HERITAGE', 10],
  ];
  for (const [parentId, n] of created) {
    const parentName = digest.tiers.agency.entries.find(p => p.kind === 'institution' && p.id === parentId)?.name;
    const divs = digest.tiers.agency.entries.filter(e => e.kind === 'division' && e.parent === parentName);
    // 새로 만든 순수 신설 division만 셀 것 — 배선된 기존 division·이번에 이름만 갱신한 KIMTSCHANGYEUL은 제외
    const wiredOrRevised = ['SP-AGYDIV-ARTMUSEUM-JHYUN', 'SP-AGYDIV-ARTMUSEUM-MAIN', 'SP-AGYDIV-ARTMUSEUM-KIMTSCHANGYEUL', 'SP-AGYDIV-WATER-WATERSUPPLY', 'SP-AGYDIV-HERITAGE-MANAGEMENT'];
    const newDivs = divs.filter(e => !wiredOrRevised.includes(e.id));
    assert.equal(newDivs.length, n, `${parentId}: 순수 신설 division 개수가 안 맞음`);
    for (const d of newDivs) {
      assert.equal(d.state, 'draft', `${d.id}: v1.0 신설이니 draft여야 함`);
      assert.ok(d.does && d.does.length > 0, `${d.id}: does가 비어 있음`);
      for (const line of d.does) assert.ok(/^\d{1,3}\.\s/.test(line), `${d.id}: 번호 매긴 사무 형식 아님`);
    }
  }
});
await test('작업 #10 안전장치: 실제 접수 파이프라인(task_key)이 걸린 4개 division은 이번 배치에서도 건드리지 않았다', () => {
  const wired = [
    'SP-AGYDIV-ARTMUSEUM-JHYUN', 'SP-AGYDIV-ARTMUSEUM-MAIN',
    'SP-AGYDIV-HERITAGE-MANAGEMENT', 'SP-AGYDIV-WATER-WATERSUPPLY',
  ];
  for (const id of wired) {
    const p = execFileSync('bash', ['-c', `grep -rl "^# 문서 코드  : ${id}$" prompts/gov-tree/03-do-agency/divisions/*.md || true`], { cwd: ROOT }).toString().trim();
    assert.ok(p, `${id}: 파일을 못 찾음(실수로 이동·삭제됐을 수 있음)`);
    const content = fs.readFileSync(p, 'utf8');
    assert.ok(content.includes('task_key'), `${id}: task_key 배선이 사라짐 — 실제 서비스가 끊겼을 수 있음`);
  }
});
await test('작업 #10: 김창열미술관(배선 없음)은 이름은 이미 일치했지만 §2를 별표9 실제 사무로 다시 썼다(division-tables.js 라우팅 참조를 깨지 않도록 파일명·버전은 v1.0 그대로 유지)', () => {
  const p = execFileSync('bash', ['-c', 'grep -rl "^# 문서 코드  : SP-AGYDIV-ARTMUSEUM-KIMTSCHANGYEUL$" prompts/gov-tree/03-do-agency/divisions/*.md || true'], { cwd: ROOT }).toString().trim();
  assert.ok(p.endsWith('SP-AGYDIV-ARTMUSEUM-KIMTSCHANGYEUL_v1.0.md'), 'v1.0 파일명이어야 함(division-tables.js가 이 경로를 참조): ' + p);
  const content = fs.readFileSync(p, 'utf8');
  assert.ok(!/task_key\s*:\s*'/.test(content), '원래 배선이 없던 division에 실제 task_key 대입이 생기면 안 됨(설명 문구 속 "task_key" 단어는 무관)');
  assert.ok(content.includes('제주도립김창열미술관 운영 및 관리'), '별표9 실제 사무가 반영돼야 함');
  const dt = fs.readFileSync(path.join(ROOT, 'src/gopang/gov/division-tables.js'), 'utf8');
  assert.ok(dt.includes('SP-AGYDIV-ARTMUSEUM-KIMTSCHANGYEUL_v1.0.md'), 'division-tables.js의 라우팅 참조가 살아있어야 함');
});
await test('작업 #10 회귀: archive로 옮긴 3개 파일(경영지원과·하수도과·한라산연구과)이 실제로 archive/에 있고, live 디렉터리엔 없다', () => {
  const moved = [
    'SP-AGYDIV-WATER-ADMIN_v1.0.md', 'SP-AGYDIV-WATER-SEWAGE_v1.0.md', 'SP-AGYDIV-HERITAGE-HALLASAN_v1.0.md',
  ];
  for (const f of moved) {
    assert.ok(fs.existsSync(path.join(ROOT, 'prompts/gov-tree/03-do-agency/archive', f)), `${f}: archive에 없음`);
    assert.ok(!fs.existsSync(path.join(ROOT, 'prompts/gov-tree/03-do-agency/divisions', f)), `${f}: live에 아직 있음`);
  }
  assert.ok(!fs.existsSync(path.join(ROOT, 'prompts/gov-tree/03-do-agency/archive', 'SP-AGYDIV-ARTMUSEUM-JHYUN_v1.1.md')), '배선된 JHYUN이 실수로 archive에 옮겨지면 안 됨');
  assert.ok(!fs.existsSync(path.join(ROOT, 'prompts/gov-tree/03-do-agency/archive', 'SP-AGYDIV-ARTMUSEUM-MAIN_v1.1.md')), '배선된 MAIN이 실수로 archive에 옮겨지면 안 됨');
  assert.ok(!fs.existsSync(path.join(ROOT, 'prompts/gov-tree/03-do-agency/archive', 'SP-AGYDIV-WATER-WATERSUPPLY_v1.1.md')), '배선된 WATERSUPPLY가 실수로 archive에 옮겨지면 안 됨');
  assert.ok(!fs.existsSync(path.join(ROOT, 'prompts/gov-tree/03-do-agency/archive', 'SP-AGYDIV-HERITAGE-MANAGEMENT_v1.1.md')), '배선된 MANAGEMENT가 실수로 archive에 옮겨지면 안 됨');
});
await test('작업 #10: 세계유산본부 유산정책부 4개(유산정책과·문화유산과·자연유산과·세계유산과)는 §10-2(본문·별표 이름 불일치)를 §4에서 스스로 밝힌다', () => {
  for (const id of ['SP-AGYDIV-HERITAGE-POLICY', 'SP-AGYDIV-HERITAGE-WORLDHERITAGE', 'SP-AGYDIV-HERITAGE-CULTURALHERITAGE', 'SP-AGYDIV-HERITAGE-NATURALHERITAGE']) {
    const p = execFileSync('bash', ['-c', `grep -rl "^# 문서 코드  : ${id}$" prompts/gov-tree/03-do-agency/divisions/*.md || true`], { cwd: ROOT }).toString().trim();
    assert.ok(p, `${id}: 파일을 못 찾음`);
    const content = fs.readFileSync(p, 'utf8');
    assert.ok(content.includes('§10-2'), `${id}: §10-2 플래그가 없음 — 사무 배정이 추정이라는 사실을 숨기면 안 됨`);
  }
});

await test('작업 #11: 배선된 division과 새 division이 겹치는 3쌍(본관↔운영과, 상수도과↔상수도정책시설과, 유산관리과↔문화유산과·자연유산과) 모두 양쪽에 "2026-09-23 정리" 경계 문구가 있다', () => {
  const pairs = [
    ['SP-AGYDIV-ARTMUSEUM-MAIN', 'SP-AGYDIV-ARTMUSEUM-ADMIN'],
    ['SP-AGYDIV-WATER-WATERSUPPLY', 'SP-AGYDIV-WATER-POLICYFACILITY'],
    ['SP-AGYDIV-HERITAGE-MANAGEMENT', 'SP-AGYDIV-HERITAGE-CULTURALHERITAGE'],
    ['SP-AGYDIV-HERITAGE-MANAGEMENT', 'SP-AGYDIV-HERITAGE-NATURALHERITAGE'],
  ];
  for (const [wiredId, otherId] of pairs) {
    for (const id of [wiredId, otherId]) {
      const p = execFileSync('bash', ['-c', `grep -rl "^# 문서 코드  : ${id}$" prompts/gov-tree/03-do-agency/divisions/*.md || true`], { cwd: ROOT }).toString().trim();
      assert.ok(p, `${id}: 파일을 못 찾음`);
      const content = fs.readFileSync(p, 'utf8');
      assert.ok(/2026-09-23( §3)? 정리/.test(content), `${id}: 경계 정리 문구가 없음`);
    }
  }
});
await test('작업 #11 안전장치: 경계 정리 이후에도 배선된 4개 division의 task_key는 그대로다', () => {
  const wired = {
    'SP-AGYDIV-ARTMUSEUM-MAIN': 'artmuseum_main_facility_rental',
    'SP-AGYDIV-WATER-WATERSUPPLY': 'water_connection_application',
    'SP-AGYDIV-HERITAGE-MANAGEMENT': 'heritage_alteration_permit',
  };
  for (const [id, key] of Object.entries(wired)) {
    const p = execFileSync('bash', ['-c', `grep -rl "^# 문서 코드  : ${id}$" prompts/gov-tree/03-do-agency/divisions/*.md || true`], { cwd: ROOT }).toString().trim();
    const content = fs.readFileSync(p, 'utf8');
    assert.ok(content.includes(`task_key: '${key}'`), `${id}: task_key가 바뀌거나 사라짐`);
  }
});

await test('작업 #12: 공공정책연수원·보훈청(그동안 SP 자체가 없던 missing_in_inventory 2건)이 기관 2개·division 4개로 신설됐다', () => {
  const digest = buildDigest();
  const created = [
    ['SP-AGY-PUBLICPOLICY', 1], ['SP-AGY-VETERANS', 3],
  ];
  for (const [parentId, n] of created) {
    const inst = digest.tiers.agency.entries.find(e => e.kind === 'institution' && e.id === parentId);
    assert.ok(inst, `${parentId}: 기관 항목이 digest에 없음`);
    const divs = digest.tiers.agency.entries.filter(e => e.kind === 'division' && e.parent === inst.name);
    assert.equal(divs.length, n, `${parentId}: division 개수가 안 맞음`);
    for (const d of divs) {
      assert.equal(d.state, 'draft', `${d.id}: v1.0 신설이니 draft여야 함(초안이지만 내용은 실제 사무)`);
      assert.ok(d.does && d.does.length > 0, `${d.id}: does가 비어 있음`);
      for (const line of d.does) assert.ok(/^\d{1,3}\.\s/.test(line), `${d.id}: 번호 매긴 사무 형식 아님`);
    }
  }
});
await test('작업 #12: 공공정책연수원 교육운영과는 원문의 뭉친 25번 항목을 25·26·27로 풀어 실제 28개 사무 항목을 담았다', () => {
  const p = execFileSync('bash', ['-c', 'grep -rl "^# 문서 코드  : SP-AGYDIV-PUBLICPOLICY-EDUCATION$" prompts/gov-tree/03-do-agency/divisions/*.md || true'], { cwd: ROOT }).toString().trim();
  assert.ok(p, 'SP-AGYDIV-PUBLICPOLICY-EDUCATION 파일을 못 찾음');
  const content = fs.readFileSync(p, 'utf8');
  assert.ok(content.includes('28. 그 밖에 교육운영 및 관리에 관한 사항'), '28번 항목(뭉친 25번을 풀어낸 결과)이 없음');
  assert.ok(content.includes('26. 자치경찰 직무교육 등 운영'), '26번 항목이 없음');
  assert.ok(content.includes('27. 공공기관(공기업, 출자출연기관) 직무교육 등 운영'), '27번 항목이 없음');
});
await test('작업 #12 안전장치: 이번에 신설한 기관 2개·division 4개 어디에도 실제 접수 파이프라인(task_key)이 실수로 생기지 않았다', () => {
  const files = [
    'prompts/gov-tree/03-do-agency/SP-AGY-PUBLICPOLICY_v1.0.md',
    'prompts/gov-tree/03-do-agency/SP-AGY-VETERANS_v1.0.md',
    'prompts/gov-tree/03-do-agency/divisions/SP-AGYDIV-PUBLICPOLICY-EDUCATION_v1.0.md',
    'prompts/gov-tree/03-do-agency/divisions/SP-AGYDIV-VETERANS-AFFAIRS_v1.0.md',
    'prompts/gov-tree/03-do-agency/divisions/SP-AGYDIV-VETERANS-COMPENSATION_v1.0.md',
    'prompts/gov-tree/03-do-agency/divisions/SP-AGYDIV-VETERANS-MEMORIAL_v1.0.md',
  ];
  for (const f of files) {
    const full = path.join(ROOT, f);
    assert.ok(fs.existsSync(full), `${f}: 파일이 없음`);
    const content = fs.readFileSync(full, 'utf8');
    assert.ok(!/task_key\s*:\s*'/.test(content), `${f}: 실수로 task_key가 대입됨(브랜드 신규 기관이라 배선이 없어야 함)`);
  }
});
await test('작업 #12: org-baseline-agency.json에서 공공정책연수원·보훈청이 missing_in_inventory에서 mapping으로 옮겨졌다', () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(DIR, 'org-baseline-agency.json'), 'utf8'));
  assert.ok(!baseline.missing_in_inventory.some(m => m.name === '공공정책연수원'), '공공정책연수원이 여전히 missing_in_inventory에 있음');
  assert.ok(!baseline.missing_in_inventory.some(m => m.name === '보훈청'), '보훈청이 여전히 missing_in_inventory에 있음');
  assert.equal(baseline.mapping['SP-AGY-PUBLICPOLICY'].status, 'match');
  assert.deepEqual(baseline.mapping['SP-AGY-PUBLICPOLICY'].current_divisions, ['교육운영과']);
  assert.equal(baseline.mapping['SP-AGY-VETERANS'].status, 'match');
  assert.deepEqual(baseline.mapping['SP-AGY-VETERANS'].current_divisions, ['보훈과', '보상과', '항일기념관']);
});
await test('작업 #12 회귀: division-tables.js·페이지 인벤토리 양쪽에 새 기관 2개·division 4개 라우팅 항목이 있다', () => {
  const dt = fs.readFileSync(path.join(ROOT, 'src/gopang/gov/division-tables.js'), 'utf8');
  const page = fs.readFileSync(path.join(ROOT, 'pages/jeju-gov-automation.html'), 'utf8');
  for (const id of ['SP-AGY-PUBLICPOLICY', 'SP-AGY-VETERANS', 'SP-AGYDIV-PUBLICPOLICY-EDUCATION', 'SP-AGYDIV-VETERANS-AFFAIRS', 'SP-AGYDIV-VETERANS-COMPENSATION', 'SP-AGYDIV-VETERANS-MEMORIAL']) {
    assert.ok(dt.includes(`"${id}"`), `division-tables.js에 ${id} 없음`);
    assert.ok(page.includes(`"${id}"`), `jeju-gov-automation.html에 ${id} 없음`);
  }
});

await test('작업 #13: 문화예술진흥원 등 7개(그동안 SP 자체가 없던 missing_in_inventory 7건)이 기관 7개·division 17개로 신설됐다', () => {
  const digest = buildDigest();
  const created = [
    ['SP-AGY-CULTUREARTS', 2], ['SP-AGY-MARINEFISHERIES', 5], ['SP-AGY-ANIMALHYGIENE', 2],
    ['SP-AGY-SEOLMUNDAE', 1], ['SP-AGY-STONEPARK', 2], ['SP-AGY-EMPLOYMENT', 4], ['SP-AGY-CENTRALCOOP', 1],
  ];
  for (const [parentId, n] of created) {
    const inst = digest.tiers.agency.entries.find(e => e.kind === 'institution' && e.id === parentId);
    assert.ok(inst, `${parentId}: 기관 항목이 digest에 없음`);
    const divs = digest.tiers.agency.entries.filter(e => e.kind === 'division' && e.parent === inst.name);
    assert.equal(divs.length, n, `${parentId}: division 개수가 안 맞음`);
    for (const d of divs) {
      assert.equal(d.state, 'draft', `${d.id}: v1.0 신설이니 draft여야 함(초안이지만 내용은 실제 사무)`);
      assert.ok(d.does && d.does.length > 0, `${d.id}: does가 비어 있음`);
      for (const line of d.does) assert.ok(/^\d{1,3}\.\s/.test(line), `${d.id}: 번호 매긴 사무 형식 아님`);
    }
  }
});
await test('작업 #13 안전장치: 이번에 신설한 기관 7개·division 17개 어디에도 실제 접수 파이프라인(task_key)이 실수로 생기지 않았다', () => {
  const insts = ['CULTUREARTS', 'MARINEFISHERIES', 'ANIMALHYGIENE', 'SEOLMUNDAE', 'STONEPARK', 'EMPLOYMENT', 'CENTRALCOOP'];
  const files = insts.map(c => `prompts/gov-tree/03-do-agency/SP-AGY-${c}_v1.0.md`);
  for (const f of fs.readdirSync(path.join(ROOT, 'prompts/gov-tree/03-do-agency/divisions'))) {
    if (insts.some(c => f.startsWith(`SP-AGYDIV-${c}-`))) files.push(`prompts/gov-tree/03-do-agency/divisions/${f}`);
  }
  assert.equal(files.length, 7 + 17, `이번 배치 파일 수가 24개가 아님(${files.length})`);
  for (const f of files) {
    const full = path.join(ROOT, f);
    assert.ok(fs.existsSync(full), `${f}: 파일이 없음`);
    const content = fs.readFileSync(full, 'utf8');
    assert.ok(!/task_key\s*:\s*'/.test(content), `${f}: 실수로 task_key가 대입됨(브랜드 신규 기관이라 배선이 없어야 함)`);
  }
});
await test('작업 #13: org-baseline-agency.json에서 7개 기관이 missing_in_inventory에서 mapping으로 옮겨졌고, 산하 division 개수가 맞다', () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(DIR, 'org-baseline-agency.json'), 'utf8'));
  const names = ['문화예술진흥원', '해양수산연구원', '동물위생시험소', '설문대여성문화센터', '돌문화공원관리소', '고용센터', '중앙협력본부'];
  for (const n of names) assert.ok(!baseline.missing_in_inventory.some(m => m.name === n), `${n}이 여전히 missing_in_inventory에 있음`);
  assert.equal(baseline.mapping['SP-AGY-CULTUREARTS'].current_divisions.length, 2);
  assert.equal(baseline.mapping['SP-AGY-MARINEFISHERIES'].current_divisions.length, 5);
  assert.equal(baseline.mapping['SP-AGY-ANIMALHYGIENE'].current_divisions.length, 2);
  assert.equal(baseline.mapping['SP-AGY-SEOLMUNDAE'].current_divisions.length, 1);
  assert.equal(baseline.mapping['SP-AGY-STONEPARK'].current_divisions.length, 2);
  assert.equal(baseline.mapping['SP-AGY-EMPLOYMENT'].current_divisions.length, 4);
  assert.equal(baseline.mapping['SP-AGY-CENTRALCOOP'].current_divisions.length, 1);
  for (const code of ['SP-AGY-EMPLOYMENT', 'SP-AGY-CENTRALCOOP']) {
    assert.ok(baseline.mapping[code].note.includes('명칭'), `${code}: 명칭 중복 유의사항이 note에 없음`);
  }
});
await test('작업 #13 회귀: division-tables.js·페이지 인벤토리 양쪽에 새 기관 7개·division 17개 라우팅 항목이 있다', () => {
  const dt = fs.readFileSync(path.join(ROOT, 'src/gopang/gov/division-tables.js'), 'utf8');
  const page = fs.readFileSync(path.join(ROOT, 'pages/jeju-gov-automation.html'), 'utf8');
  const ids = [
    'SP-AGY-CULTUREARTS', 'SP-AGYDIV-CULTUREARTS-ADMIN', 'SP-AGYDIV-CULTUREARTS-PERFORMANCE',
    'SP-AGY-MARINEFISHERIES', 'SP-AGYDIV-MARINEFISHERIES-RESOURCES', 'SP-AGYDIV-MARINEFISHERIES-ENVIRONMENT',
    'SP-AGYDIV-MARINEFISHERIES-SEED', 'SP-AGYDIV-MARINEFISHERIES-SAFETY', 'SP-AGYDIV-MARINEFISHERIES-FLATFISH',
    'SP-AGY-ANIMALHYGIENE', 'SP-AGYDIV-ANIMALHYGIENE-LIVESTOCKSAFETY', 'SP-AGYDIV-ANIMALHYGIENE-QUARANTINE',
    'SP-AGY-SEOLMUNDAE', 'SP-AGYDIV-SEOLMUNDAE-ADMIN',
    'SP-AGY-STONEPARK', 'SP-AGYDIV-STONEPARK-OPERATIONS', 'SP-AGYDIV-STONEPARK-RESEARCH',
    'SP-AGY-EMPLOYMENT', 'SP-AGYDIV-EMPLOYMENT-JOBSUPPORT', 'SP-AGYDIV-EMPLOYMENT-SUPPORT',
    'SP-AGYDIV-EMPLOYMENT-BENEFITS', 'SP-AGYDIV-EMPLOYMENT-SEOGWIPO',
    'SP-AGY-CENTRALCOOP', 'SP-AGYDIV-CENTRALCOOP-ASSEMBLY',
  ];
  assert.equal(ids.length, 7 + 17);
  for (const id of ids) {
    assert.ok(dt.includes(`"${id}"`), `division-tables.js에 ${id} 없음`);
    assert.ok(page.includes(`"${id}"`), `jeju-gov-automation.html에 ${id} 없음`);
  }
});
await test('작업 #13 안전장치: 고용센터·중앙협력본부 division-tables.js 항목에 bare 충돌 키워드("고용", "고용센터", "중앙협력본부", "실업급여", "취업지원 대상자")가 없다', () => {
  const dt = fs.readFileSync(path.join(ROOT, 'src/gopang/gov/division-tables.js'), 'utf8');
  const m = dt.match(/export const JEJU_AGENCY_TABLE = \[[\s\S]*?\n\];/);
  const m2 = dt.match(/export const JEJU_AGENCY_DIVISION_TABLE = \[[\s\S]*?\n\];/);
  assert.ok(m && m2, '테이블을 찾지 못함');
  const block = m[0] + m2[0];
  // kw 배열 안에서만 검사 — 주석(설명 텍스트)에는 이 단어들이 나와도 된다.
  const kwArrays = [...block.matchAll(/kw:\s*\[([^\]]*)\]/g)].map(x => x[1]);
  for (const arr of kwArrays) {
    assert.ok(!/"고용"/.test(arr), 'bare "고용" 키워드가 있음(SP-DIV-ECON-EMPLOYCENTER와 충돌)');
    assert.ok(!/"고용센터"/.test(arr), 'bare "고용센터" 키워드가 있음(SP-DIV-ECON-EMPLOYCENTER와 충돌)');
    assert.ok(!/"중앙협력본부"/.test(arr), 'bare "중앙협력본부" 키워드가 있음(SP-DO-LIAISON과 충돌)');
    assert.ok(!/"실업급여"/.test(arr), 'bare "실업급여" 키워드가 있음(SP-NAT-LABOR와 충돌)');
    assert.ok(!/"취업지원 대상자"/.test(arr), '"취업지원 대상자" 키워드가 있음(SP-NAT-VETERANS와 충돌)');
  }
});

await test('작업 #14: 제주환경자원순환센터·제주안전체험관(그동안 SP 자체가 없던 missing_in_inventory 2건)이 기관 2개·division 5개로 신설됐다', () => {
  const digest = buildDigest();
  const created = [
    ['SP-AGY-ENVCIRCULATION', 2], ['SP-AGY-SAFETYEXPERIENCE', 3],
  ];
  for (const [parentId, n] of created) {
    const inst = digest.tiers.agency.entries.find(e => e.kind === 'institution' && e.id === parentId);
    assert.ok(inst, `${parentId}: 기관 항목이 digest에 없음`);
    const divs = digest.tiers.agency.entries.filter(e => e.kind === 'division' && e.parent === inst.name);
    assert.equal(divs.length, n, `${parentId}: division 개수가 안 맞음`);
    for (const d of divs) {
      assert.equal(d.state, 'draft', `${d.id}: v1.0 신설이니 draft여야 함`);
      assert.ok(d.does && d.does.length > 0, `${d.id}: does가 비어 있음`);
      assert.ok(d.does.length <= 6, `${d.id}: 명칭 추정 항목은 3~6건 수준으로 modest해야 함(${d.does.length}건)`);
      for (const line of d.does) assert.ok(/^\d{1,3}\.\s/.test(line), `${d.id}: 번호 매긴 사무 형식 아님`);
    }
  }
});
await test('작업 #14 정직 공시: 별표8·9 원문에 사무가 없어 명칭 추정으로 작성했다는 문구가 기관·division SP 전부에 있다(confidence: low)', () => {
  const files = [
    'prompts/gov-tree/03-do-agency/SP-AGY-ENVCIRCULATION_v1.0.md',
    'prompts/gov-tree/03-do-agency/SP-AGY-SAFETYEXPERIENCE_v1.0.md',
    'prompts/gov-tree/03-do-agency/divisions/SP-AGYDIV-ENVCIRCULATION-FACILITY_v1.0.md',
    'prompts/gov-tree/03-do-agency/divisions/SP-AGYDIV-ENVCIRCULATION-FOODWASTE_v1.0.md',
    'prompts/gov-tree/03-do-agency/divisions/SP-AGYDIV-SAFETYEXPERIENCE-SUPPORT_v1.0.md',
    'prompts/gov-tree/03-do-agency/divisions/SP-AGYDIV-SAFETYEXPERIENCE-PLANNING_v1.0.md',
    'prompts/gov-tree/03-do-agency/divisions/SP-AGYDIV-SAFETYEXPERIENCE-OPERATIONS_v1.0.md',
  ];
  for (const f of files) {
    const full = path.join(ROOT, f);
    assert.ok(fs.existsSync(full), `${f}: 파일이 없음`);
    const content = fs.readFileSync(full, 'utf8');
    assert.ok(content.includes('정직하게 밝힘'), `${f}: "정직하게 밝힘" 공시 문구가 없음`);
    assert.ok(content.includes('confidence: low') || content.includes('confidence: low)'), `${f}: confidence: low 표기가 없음`);
    assert.ok(content.includes('별표') && (content.includes('없다') || content.includes('없음')), `${f}: "별표에 원문이 없다"는 취지의 문구가 없음`);
    assert.ok(!/task_key\s*:\s*'/.test(content), `${f}: 실수로 task_key가 대입됨(브랜드 신규 기관이라 배선이 없어야 함)`);
  }
});
await test('작업 #14: org-baseline-agency.json에서 제주환경자원순환센터·제주안전체험관이 missing_in_inventory에서 mapping으로 옮겨졌고, confidence가 low다', () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(DIR, 'org-baseline-agency.json'), 'utf8'));
  assert.ok(!baseline.missing_in_inventory.some(m => m.name === '제주환경자원순환센터'), '제주환경자원순환센터가 여전히 missing_in_inventory에 있음');
  assert.ok(!baseline.missing_in_inventory.some(m => m.name === '제주안전체험관'), '제주안전체험관이 여전히 missing_in_inventory에 있음');
  assert.equal(baseline.mapping['SP-AGY-ENVCIRCULATION'].status, 'match');
  assert.equal(baseline.mapping['SP-AGY-ENVCIRCULATION'].confidence, 'low', '원문 없이 명칭 추정이라 low여야 함(이전 배치의 high와 다름)');
  assert.deepEqual(baseline.mapping['SP-AGY-ENVCIRCULATION'].current_divisions, ['자원순환시설관리과', '음식물자원화과']);
  assert.equal(baseline.mapping['SP-AGY-SAFETYEXPERIENCE'].status, 'match');
  assert.equal(baseline.mapping['SP-AGY-SAFETYEXPERIENCE'].confidence, 'low', '원문 없이 명칭 추정이라 low여야 함(이전 배치의 high와 다름)');
  assert.deepEqual(baseline.mapping['SP-AGY-SAFETYEXPERIENCE'].current_divisions, ['체험지원과', '체험기획과', '체험운영과']);
  for (const code of ['SP-AGY-ENVCIRCULATION', 'SP-AGY-SAFETYEXPERIENCE']) {
    assert.ok(baseline.mapping[code].note.includes('정직하게 밝힘'), `${code}: note에 정직 공시 문구가 없음`);
  }
});
await test('작업 #14 회귀: division-tables.js·페이지 인벤토리 양쪽에 새 기관 2개·division 5개 라우팅 항목이 있다', () => {
  const dt = fs.readFileSync(path.join(ROOT, 'src/gopang/gov/division-tables.js'), 'utf8');
  const page = fs.readFileSync(path.join(ROOT, 'pages/jeju-gov-automation.html'), 'utf8');
  const ids = [
    'SP-AGY-ENVCIRCULATION', 'SP-AGYDIV-ENVCIRCULATION-FACILITY', 'SP-AGYDIV-ENVCIRCULATION-FOODWASTE',
    'SP-AGY-SAFETYEXPERIENCE', 'SP-AGYDIV-SAFETYEXPERIENCE-SUPPORT', 'SP-AGYDIV-SAFETYEXPERIENCE-PLANNING',
    'SP-AGYDIV-SAFETYEXPERIENCE-OPERATIONS',
  ];
  assert.equal(ids.length, 2 + 5);
  for (const id of ids) {
    assert.ok(dt.includes(`"${id}"`), `division-tables.js에 ${id} 없음`);
    assert.ok(page.includes(`"${id}"`), `jeju-gov-automation.html에 ${id} 없음`);
  }
});
await test('작업 #14 안전장치: division-tables.js의 SP-AGY-ENVCIRCULATION 관련 kw 배열에 bare "자원순환" 키워드가 없다(SP-DIV-CLIMATE-RECYCLING·gov-router.js 여러 항목과 충돌)', () => {
  const dt = fs.readFileSync(path.join(ROOT, 'src/gopang/gov/division-tables.js'), 'utf8');
  const m = dt.match(/export const JEJU_AGENCY_TABLE = \[[\s\S]*?\n\];/);
  const m2 = dt.match(/export const JEJU_AGENCY_DIVISION_TABLE = \[[\s\S]*?\n\];/);
  assert.ok(m && m2, '테이블을 찾지 못함');
  const block = m[0] + m2[0];
  const kwArrays = [...block.matchAll(/kw:\s*\[([^\]]*)\]/g)].map(x => x[1]);
  for (const arr of kwArrays) {
    assert.ok(!/"자원순환"/.test(arr), 'bare "자원순환" 키워드가 있음(SP-DIV-CLIMATE-RECYCLING·gov-router.js와 충돌)');
    assert.ok(!/"자원순환과"/.test(arr), 'bare "자원순환과" 키워드가 있음(SP-DIV-CLIMATE-RECYCLING와 충돌)');
  }
});

await test('작업 #15: 소방서 4개(제주·서귀포·서부·동부)가 기관 4개·division 13개(과)로 신설됐다(별표8 원문, confidence: high)', () => {
  const digest = buildDigest();
  const created = [
    ['SP-AGY-FIREJEJU', 4], ['SP-AGY-FIRESEOGWIPO', 3], ['SP-AGY-FIRESEOBU', 3], ['SP-AGY-FIREDONGBU', 3],
  ];
  for (const [parentId, n] of created) {
    const inst = digest.tiers.agency.entries.find(e => e.kind === 'institution' && e.id === parentId);
    assert.ok(inst, `${parentId}: 기관 항목이 digest에 없음`);
    const divs = digest.tiers.agency.entries.filter(e => e.kind === 'division' && e.parent === inst.name);
    assert.equal(divs.length, n, `${parentId}: division 개수가 안 맞음`);
    for (const d of divs) {
      assert.equal(d.state, 'draft', `${d.id}: v1.0 신설이니 draft여야 함(초안이지만 §2 내용은 별표8 실제 사무)`);
      assert.ok(d.does && d.does.length > 0, `${d.id}: does가 비어 있음`);
      for (const line of d.does) assert.ok(/^\d{1,3}\.\s/.test(line), `${d.id}: 번호 매긴 사무 형식 아님`);
    }
  }
});
await test('작업 #15 안전장치: 이번에 신설한 기관 4개·division 13개 어디에도 실제 접수 파이프라인(task_key)이 실수로 생기지 않았고, 기존 SP-AGYDIV-FIRE-ADMIN/PREVENTION/RESPONSE(소방안전본부 자체)의 task_key는 그대로 유지됐다(회귀 방지)', () => {
  const codes = ['FIREJEJU', 'FIRESEOGWIPO', 'FIRESEOBU', 'FIREDONGBU'];
  const files = codes.map(c => `prompts/gov-tree/03-do-agency/SP-AGY-${c}_v1.0.md`);
  for (const f of fs.readdirSync(path.join(ROOT, 'prompts/gov-tree/03-do-agency/divisions'))) {
    if (codes.some(c => f.startsWith(`SP-AGYDIV-${c}-`))) files.push(`prompts/gov-tree/03-do-agency/divisions/${f}`);
  }
  assert.equal(files.length, 4 + 13, `이번 배치 기관·division 파일 수가 17개가 아님(${files.length})`);
  for (const f of files) {
    const full = path.join(ROOT, f);
    assert.ok(fs.existsSync(full), `${f}: 파일이 없음`);
    const content = fs.readFileSync(full, 'utf8');
    assert.ok(!/task_key\s*:\s*'/.test(content), `${f}: 실수로 task_key가 대입됨(신규 기관이라 배선이 없어야 함)`);
  }
  // 회귀: 기존 소방안전본부(SP-AGY-FIRE) 산하 division 3개는 이번 배치에서 건드리지 않았어야 하고,
  // 그중 예방안전과의 실제 task_key 배선은 그대로 남아 있어야 한다.
  const prevention = fs.readFileSync(path.join(ROOT, 'prompts/gov-tree/03-do-agency/divisions/SP-AGYDIV-FIRE-PREVENTION_v1.1.md'), 'utf8');
  assert.ok(prevention.includes("task_key: 'hazardous_material_facility_permit'"), 'SP-AGYDIV-FIRE-PREVENTION의 기존 task_key 배선이 사라짐(회귀)');
});
await test('작업 #15: org-baseline-agency.json에서 소방서 4곳이 missing_in_inventory에서 mapping으로 옮겨졌고, confidence가 high다', () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(DIR, 'org-baseline-agency.json'), 'utf8'));
  assert.ok(!baseline.missing_in_inventory.some(m => m.name.includes('소방서')), '소방서가 여전히 missing_in_inventory에 있음');
  // ★ 병합 재현 참고(2026-09-24, 작업 #15/#16): 원 작업 #15는 이 시점에 missing_in_inventory가
  // 3개(합의제행정기관)만 남는다고 가정했으나, 이 저장소에서는 작업 #16(합의제행정기관 tier 분리)이
  // 바로 뒤이어 같은 파일을 갱신해 최종 missing_in_inventory는 0건이다 — 아래 작업 #16 테스트가 그 상태를 검증한다.
  assert.ok(baseline.missing_in_inventory.length <= 3, '소방서 4곳 반영 후 남은 항목은 합의제행정기관 3개 이하여야 함');
  for (const code of ['SP-AGY-FIREJEJU', 'SP-AGY-FIRESEOGWIPO', 'SP-AGY-FIRESEOBU', 'SP-AGY-FIREDONGBU']) {
    assert.equal(baseline.mapping[code].status, 'match');
    assert.equal(baseline.mapping[code].confidence, 'high', '별표8 원문 사무가 있어 high여야 함');
  }
});
await test('작업 #15 회귀: division-tables.js·페이지 인벤토리 양쪽에 새 기관 4개·division 13개 라우팅 항목이 있다', () => {
  const dt = fs.readFileSync(path.join(ROOT, 'src/gopang/gov/division-tables.js'), 'utf8');
  const page = fs.readFileSync(path.join(ROOT, 'pages/jeju-gov-automation.html'), 'utf8');
  const ids = [
    'SP-AGY-FIREJEJU', 'SP-AGYDIV-FIREJEJU-ADMIN', 'SP-AGYDIV-FIREJEJU-PREVENTION', 'SP-AGYDIV-FIREJEJU-RESPONSE', 'SP-AGYDIV-FIREJEJU-FIELDCOMMAND',
    'SP-AGY-FIRESEOGWIPO', 'SP-AGYDIV-FIRESEOGWIPO-ADMIN', 'SP-AGYDIV-FIRESEOGWIPO-PREVENTIONRESCUE', 'SP-AGYDIV-FIRESEOGWIPO-FIELDCOMMAND',
    'SP-AGY-FIRESEOBU', 'SP-AGYDIV-FIRESEOBU-ADMIN', 'SP-AGYDIV-FIRESEOBU-PREVENTIONRESCUE', 'SP-AGYDIV-FIRESEOBU-FIELDCOMMAND',
    'SP-AGY-FIREDONGBU', 'SP-AGYDIV-FIREDONGBU-ADMIN', 'SP-AGYDIV-FIREDONGBU-PREVENTIONRESCUE', 'SP-AGYDIV-FIREDONGBU-FIELDCOMMAND',
  ];
  assert.equal(ids.length, 4 + 13);
  for (const id of ids) {
    assert.ok(dt.includes(`"${id}"`), `division-tables.js에 ${id} 없음`);
    assert.ok(page.includes(`"${id}"`), `jeju-gov-automation.html에 ${id} 없음`);
  }
});
await test('작업 #15 안전장치: 새 소방서 division kw가 전부 "{소방서명} {과명}" 복합어라 기존 SP-AGYDIV-FIRE-ADMIN/PREVENTION/RESPONSE의 bare kw("소방행정과"·"예방안전과"·"현장대응과")와 겹치지 않는다', () => {
  const dt = fs.readFileSync(path.join(ROOT, 'src/gopang/gov/division-tables.js'), 'utf8');
  const m2 = dt.match(/export const JEJU_AGENCY_DIVISION_TABLE = \[[\s\S]*?\n\];/);
  assert.ok(m2, '테이블을 찾지 못함');
  const newCodes = ['FIREJEJU', 'FIRESEOGWIPO', 'FIRESEOBU', 'FIREDONGBU'];
  const kwArrays = [...m2[0].matchAll(/code:\s*"SP-AGYDIV-(FIRE(?:JEJU|SEOGWIPO|SEOBU|DONGBU)-[A-Z]+)"[\s\S]*?kw:\s*\[([^\]]*)\]/g)];
  assert.equal(kwArrays.length, 13, '새 소방서 division 13개의 kw를 다 찾지 못함');
  for (const [, code, arr] of kwArrays) {
    assert.ok(!arr.split(',').map(s => s.trim().replace(/"/g, '')).includes('소방행정과'), `${code}: bare "소방행정과" 키워드가 있음(SP-AGYDIV-FIRE-ADMIN과 충돌)`);
    assert.ok(!arr.split(',').map(s => s.trim().replace(/"/g, '')).includes('예방안전과'), `${code}: bare "예방안전과" 키워드가 있음(SP-AGYDIV-FIRE-PREVENTION과 충돌)`);
    assert.ok(!arr.split(',').map(s => s.trim().replace(/"/g, '')).includes('현장대응과'), `${code}: bare "현장대응과" 키워드가 있음(SP-AGYDIV-FIRE-RESPONSE와 충돌)`);
  }
});
await test('작업 #15 정직 공시: 현장 단위(119안전센터·구조대·지역대) SP 31개가 field-units/에 신설됐고, 전부 state: draft·나무위키 출처 등급 공시가 있으며 라우팅 테이블에는 등록돼 있지 않다', () => {
  const dir = path.join(ROOT, 'prompts/gov-tree/03-do-agency/divisions/field-units');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  assert.equal(files.length, 31, `현장단위 파일 수가 31개가 아님(${files.length})`);
  const dt = fs.readFileSync(path.join(ROOT, 'src/gopang/gov/division-tables.js'), 'utf8');
  const page = fs.readFileSync(path.join(ROOT, 'pages/jeju-gov-automation.html'), 'utf8');
  for (const f of files) {
    const content = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(content.includes('state: draft'), `${f}: state: draft 표기가 없음`);
    assert.ok(content.includes('정직하게 밝힘'), `${f}: 정직하게 밝힘 문구가 없음`);
    assert.ok(!/task_key\s*:\s*'/.test(content), `${f}: 실수로 task_key가 대입됨`);
    const code = f.replace(/_v1\.0\.md$/, '');
    assert.ok(!dt.includes(`"${code}"`), `${f}: division-tables.js에 등록돼 있음(현장단위는 라우팅 대상 아님)`);
    assert.ok(!page.includes(`"${code}"`), `${f}: jeju-gov-automation.html에 등록돼 있음(현장단위는 라우팅 대상 아님)`);
  }
  const jejuCenters = files.filter(f => f.startsWith('SP-AGYDIV-FIREJEJU-CENTER-'));
  assert.equal(jejuCenters.length, 9, '제주소방서 119안전센터는 9개여야 함');
  const dongbuRegional = files.filter(f => f.startsWith('SP-AGYDIV-FIREDONGBU-REGIONAL-'));
  assert.equal(dongbuRegional.length, 3, '동부소방서 119지역대는 3개(우도·김녕·성읍)여야 함');
  for (const code of ['FIREJEJU', 'FIRESEOGWIPO', 'FIRESEOBU']) {
    assert.ok(!files.some(f => f.startsWith(`SP-AGYDIV-${code}-REGIONAL-`)), `${code}: 119지역대를 만들지 않았어야 함(우도119지역대가 동부소방서 소속으로 확인돼 중복 배정하지 않음)`);
  }
});

// ── 작업 #16(2026-09-24) — 합의제행정기관 새 tier(collegial) 신설 ──────────────────────
await test('작업 #16: 감사위원회·지방노동위원회·자치경찰위원회(합의제행정기관 3개)가 새 디렉토리(03b-collegial-agency)에 기관 3개·division 7개로 신설됐다', () => {
  const files = [
    'prompts/gov-tree/03b-collegial-agency/SP-COMM-AUDIT_v1.0.md',
    'prompts/gov-tree/03b-collegial-agency/SP-COMM-LABOR_v1.0.md',
    'prompts/gov-tree/03b-collegial-agency/SP-COMM-POLICE_v1.0.md',
    'prompts/gov-tree/03b-collegial-agency/divisions/SP-COMMDIV-AUDIT-AUDIT_v1.0.md',
    'prompts/gov-tree/03b-collegial-agency/divisions/SP-COMMDIV-AUDIT-INVESTIGATION_v1.0.md',
    'prompts/gov-tree/03b-collegial-agency/divisions/SP-COMMDIV-AUDIT-DELIBERATION_v1.0.md',
    'prompts/gov-tree/03b-collegial-agency/divisions/SP-COMMDIV-AUDIT-ANTICORRUPTION_v1.0.md',
    'prompts/gov-tree/03b-collegial-agency/divisions/SP-COMMDIV-LABOR-SECRETARIAT_v1.0.md',
    'prompts/gov-tree/03b-collegial-agency/divisions/SP-COMMDIV-POLICE-GENERAL_v1.0.md',
    'prompts/gov-tree/03b-collegial-agency/divisions/SP-COMMDIV-POLICE-COOP_v1.0.md',
  ];
  for (const f of files) assert.ok(fs.existsSync(path.join(ROOT, f)), `${f}: 파일이 없음`);
});
await test('작업 #16 안전장치: 새 기관 3개·division 7개 어디에도 실제 접수 파이프라인(task_key)이 실수로 생기지 않았다', () => {
  const files = [
    'prompts/gov-tree/03b-collegial-agency/SP-COMM-AUDIT_v1.0.md',
    'prompts/gov-tree/03b-collegial-agency/SP-COMM-LABOR_v1.0.md',
    'prompts/gov-tree/03b-collegial-agency/SP-COMM-POLICE_v1.0.md',
    'prompts/gov-tree/03b-collegial-agency/divisions/SP-COMMDIV-AUDIT-AUDIT_v1.0.md',
    'prompts/gov-tree/03b-collegial-agency/divisions/SP-COMMDIV-AUDIT-INVESTIGATION_v1.0.md',
    'prompts/gov-tree/03b-collegial-agency/divisions/SP-COMMDIV-AUDIT-DELIBERATION_v1.0.md',
    'prompts/gov-tree/03b-collegial-agency/divisions/SP-COMMDIV-AUDIT-ANTICORRUPTION_v1.0.md',
    'prompts/gov-tree/03b-collegial-agency/divisions/SP-COMMDIV-LABOR-SECRETARIAT_v1.0.md',
    'prompts/gov-tree/03b-collegial-agency/divisions/SP-COMMDIV-POLICE-GENERAL_v1.0.md',
    'prompts/gov-tree/03b-collegial-agency/divisions/SP-COMMDIV-POLICE-COOP_v1.0.md',
  ];
  for (const f of files) {
    const content = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(!/task_key\s*:\s*'/.test(content), `${f}: 실수로 task_key가 대입됨(신규 tier라 배선이 없어야 함)`);
  }
});
await test('작업 #16: 감사위원회 4개 division은 원문 없이 명칭 추정(confidence: low)이라는 정직 공시 문구가 있다', () => {
  const files = [
    'prompts/gov-tree/03b-collegial-agency/SP-COMM-AUDIT_v1.0.md',
    'prompts/gov-tree/03b-collegial-agency/divisions/SP-COMMDIV-AUDIT-AUDIT_v1.0.md',
    'prompts/gov-tree/03b-collegial-agency/divisions/SP-COMMDIV-AUDIT-INVESTIGATION_v1.0.md',
    'prompts/gov-tree/03b-collegial-agency/divisions/SP-COMMDIV-AUDIT-DELIBERATION_v1.0.md',
    'prompts/gov-tree/03b-collegial-agency/divisions/SP-COMMDIV-AUDIT-ANTICORRUPTION_v1.0.md',
  ];
  for (const f of files) {
    const content = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(content.includes('정직하게 밝힘'), `${f}: "정직하게 밝힘" 공시 문구가 없음`);
    assert.ok(content.includes('confidence: low'), `${f}: confidence: low 표기가 없음`);
    assert.ok(content.includes('별표') && (content.includes('없다') || content.includes('없음')), `${f}: "별표에 원문이 없다"는 취지의 문구가 없음`);
  }
});
await test('작업 #16: 지방노동위원회 사무국·자치경찰총괄과는 별표10(2024.01.22. 개정본) 원문을 그대로 사용해 confidence: high다', () => {
  const laborFile = fs.readFileSync(path.join(ROOT, 'prompts/gov-tree/03b-collegial-agency/divisions/SP-COMMDIV-LABOR-SECRETARIAT_v1.0.md'), 'utf8');
  assert.ok(laborFile.includes('부당해고 등 구제신청 사건'), '별표10 원문 사무가 실려야 함');
  assert.ok(laborFile.includes('재해보상 심사·중재 사건'));
  const policeGeneral = fs.readFileSync(path.join(ROOT, 'prompts/gov-tree/03b-collegial-agency/divisions/SP-COMMDIV-POLICE-GENERAL_v1.0.md'), 'utf8');
  assert.ok(policeGeneral.includes('위원구성협의체'), '별표10 원문 사무가 실려야 함');
  const baseline = JSON.parse(fs.readFileSync(path.join(DIR, 'org-baseline-collegial.json'), 'utf8'));
  assert.equal(baseline.mapping['SP-COMM-LABOR'].confidence, 'high');
});
await test('작업 #16 정직 공시: 자치경찰협력과(SP-COMMDIV-POLICE-COOP)는 별표10의 옛 이름(자치경찰정책과)과 다르다는 점을 confidence: medium으로 밝혔다', () => {
  const coop = fs.readFileSync(path.join(ROOT, 'prompts/gov-tree/03b-collegial-agency/divisions/SP-COMMDIV-POLICE-COOP_v1.0.md'), 'utf8');
  assert.ok(coop.includes('자치경찰정책과'), '옛 이름 언급이 있어야 함');
  assert.ok(coop.includes('confidence: medium'), 'medium 표기가 있어야 함');
  const baseline = JSON.parse(fs.readFileSync(path.join(DIR, 'org-baseline-collegial.json'), 'utf8'));
  assert.equal(baseline.mapping['SP-COMM-POLICE'].confidence, 'medium');
});
await test('작업 #16: org-baseline-agency.json에서 감사위원회·지방노동위원회·자치경찰위원회 3건이 missing_in_inventory에서 완전히 빠지고, 새 org-baseline-collegial.json의 mapping으로 옮겨졌다', () => {
  const agencyBaseline = JSON.parse(fs.readFileSync(path.join(DIR, 'org-baseline-agency.json'), 'utf8'));
  for (const n of ['감사위원회', '지방노동위원회', '자치경찰위원회']) {
    assert.ok(!agencyBaseline.missing_in_inventory.some(m => m.name === n), `${n}가 여전히 org-baseline-agency.json의 missing_in_inventory에 있음`);
  }
  // ★ 병합 재현 참고(2026-09-24, 작업 #15/#16): 원 작업 #16은 66d8287b(작업 #15 이전) 기준으로
  // 작성돼 이 시점에 소방서 4곳이 아직 missing_in_inventory에 남아 1건이 될 것으로 가정했으나, 이
  // 저장소는 작업 #15가 먼저 반영돼(e663875b) 소방서 4곳이 이미 mapping으로 옮겨진 상태다 — 그래서
  // 이 배치 이후 최종 missing_in_inventory는 1건이 아니라 0건(빈 배열)이다.
  assert.equal(agencyBaseline.missing_in_inventory.length, 0, '작업 #15에서 소방서까지 이미 반영된 상태라 남는 항목이 없어야 함');
  const collegialBaseline = JSON.parse(fs.readFileSync(path.join(DIR, 'org-baseline-collegial.json'), 'utf8'));
  assert.equal(collegialBaseline.tier, 'collegial');
  assert.equal(collegialBaseline.missing_in_inventory.length, 0);
  for (const code of ['SP-COMM-AUDIT', 'SP-COMM-LABOR', 'SP-COMM-POLICE']) {
    assert.equal(collegialBaseline.mapping[code].status, 'match');
  }
});
await test('작업 #16 회귀: division-tables.js(JEJU_COLLEGIAL_TABLE·JEJU_COLLEGIAL_DIVISION_TABLE)·페이지 인벤토리(DO_COLLEGIAL) 양쪽에 새 기관 3개·division 7개 라우팅 항목이 있다', () => {
  const dt = fs.readFileSync(path.join(ROOT, 'src/gopang/gov/division-tables.js'), 'utf8');
  const page = fs.readFileSync(path.join(ROOT, 'pages/jeju-gov-automation.html'), 'utf8');
  const gr = fs.readFileSync(path.join(ROOT, 'src/gopang/gov/gov-router.js'), 'utf8');
  const ids = [
    'SP-COMM-AUDIT', 'SP-COMM-LABOR', 'SP-COMM-POLICE',
    'SP-COMMDIV-AUDIT-AUDIT', 'SP-COMMDIV-AUDIT-INVESTIGATION', 'SP-COMMDIV-AUDIT-DELIBERATION', 'SP-COMMDIV-AUDIT-ANTICORRUPTION',
    'SP-COMMDIV-LABOR-SECRETARIAT', 'SP-COMMDIV-POLICE-GENERAL', 'SP-COMMDIV-POLICE-COOP',
  ];
  assert.equal(ids.length, 3 + 7);
  for (const id of ids) {
    assert.ok(dt.includes(`"${id}"`), `division-tables.js에 ${id} 없음`);
    assert.ok(page.includes(`"${id}"`), `jeju-gov-automation.html에 ${id} 없음`);
  }
  assert.ok(dt.includes('JEJU_COLLEGIAL_TABLE') && dt.includes('JEJU_COLLEGIAL_DIVISION_TABLE'));
  assert.ok(gr.includes('JEJU_COLLEGIAL_TABLE') && gr.includes('JEJU_COLLEGIAL_DIVISION_TABLE'), 'gov-router.js가 새 테이블을 배선(import)해야 함');
  assert.ok(gr.includes("collegial:") && gr.includes("collegialDivision:"), 'PROVINCE_TABLES.jeju에 collegial 필드가 배선돼야 함');
});
await test('작업 #16 안전장치: 명칭 중복 위험 키워드(bare "감사"·"노동위원회"·"부당해고"·"자치경찰")가 새 테이블 kw에 없다', () => {
  const dt = fs.readFileSync(path.join(ROOT, 'src/gopang/gov/division-tables.js'), 'utf8');
  const m = dt.match(/export const JEJU_COLLEGIAL_TABLE = \[[\s\S]*?\n\];/);
  const m2 = dt.match(/export const JEJU_COLLEGIAL_DIVISION_TABLE = \[[\s\S]*?\n\];/);
  assert.ok(m && m2, '테이블을 찾지 못함');
  const block = m[0] + m2[0];
  const kwArrays = [...block.matchAll(/kw:\s*\[([^\]]*)\]/g)].map(x => x[1]);
  for (const arr of kwArrays) {
    for (const bare of ['"감사"', '"노동위원회"', '"부당해고"', '"자치경찰"']) {
      assert.ok(!arr.includes(bare), `bare ${bare} 키워드가 있음(기존 등록된 SP와 충돌 위험)`);
    }
  }
});
await test('작업 #16 명칭 중복 발견 기록: gov-router.js의 JEJU_NATIONAL_TABLE에 이미 SP-NAT-LABORREL(노동위원회·부당해고 키워드)이 있고, org-baseline-collegial.json의 open_questions에 이 중복이 정직하게 기록돼 있다', () => {
  const gr = fs.readFileSync(path.join(ROOT, 'src/gopang/gov/gov-router.js'), 'utf8');
  assert.ok(gr.includes('SP-NAT-LABORREL'), '기존 국가기관 라우팅 표에 SP-NAT-LABORREL이 있어야 함(이번에 발견한 명칭 중복의 전제)');
  const collegialBaseline = JSON.parse(fs.readFileSync(path.join(DIR, 'org-baseline-collegial.json'), 'utf8'));
  assert.ok(collegialBaseline.open_questions.some(q => q.includes('SP-NAT-LABORREL')), 'open_questions에 SP-NAT-LABORREL 중복 기록이 있어야 함');
  assert.ok(collegialBaseline.open_questions.some(q => q.includes('자치경찰단')), 'open_questions에 자치경찰위원회 vs 자치경찰단 구분 기록이 있어야 함');
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
