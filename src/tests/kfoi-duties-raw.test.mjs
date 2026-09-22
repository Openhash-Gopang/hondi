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
  const climate = usable.do.find(x => x.spId === 'SP-DO-CLIMATE' && x.dept === '환경정책과');
  assert.ok(climate && climate.duties.length > 10, '환경산림자원국(환경정책과)의 업무가 있어야 함');
  assert.ok(usable.city.some(x => x.tier === 'seogwipo'), '서귀포시 항목이 있어야 함');
  assert.ok(usable.city.some(x => x.tier === 'jeju-si'), '제주시 항목이 있어야 함');
});
await test('사용 가능 목록: 2026년에 개편·신설된 부서(구 조직 명칭)는 섞여 있지 않다', () => {
  const staleNames = raw._meta.do_tier_classification.stale_dept_names;
  for (const item of usable.do) assert.ok(!staleNames.includes(item.dept), `구 조직명이 섞임: ${item.dept}`);
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
