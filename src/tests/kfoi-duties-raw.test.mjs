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

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
