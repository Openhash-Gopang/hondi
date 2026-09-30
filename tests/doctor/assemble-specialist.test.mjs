import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemble, lintSpecialist, baseBody, INCLUDE_MARK, DEFAULT_BASE } from '../../scripts/kdoctor/assemble-specialist.mjs';

const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), '../../prompts');
const base = readFileSync(DEFAULT_BASE, 'utf8');
const specs = readdirSync(PROMPTS).filter((f) => /^SP-29[a-z]\d?_kdoctor_.*\.txt$/.test(f));

const REG = JSON.parse(readFileSync(join(PROMPTS, 'kdoctor-specialties.json'), 'utf8'));

test('과목 SP 41종(전문과목 26 + 내과 분과 9 + 소아 분과 6)이 레지스트리와 파일로 일치한다', () => {
  assert.equal(REG.specialties.length, 41);
  assert.equal(specs.length, 41);
  assert.deepEqual(REG.specialties.map((s) => s.file).sort(), [...specs].sort());
  assert.equal(new Set(REG.specialties.map((s) => s.id)).size, 41);
  assert.equal(REG.specialties.filter((s) => !s.parent).length, 26);
  assert.equal(REG.specialties.filter((s) => s.parent === 'kdoctor-internal').length, 9);
  assert.equal(REG.specialties.filter((s) => s.parent === 'kdoctor-pediatrics').length, 6);
});

test('분과의 parent는 레지스트리의 최상위 과목이고, 파일 머리의 `부모:` 줄과 일치한다', () => {
  const top = new Set(REG.specialties.filter((s) => !s.parent).map((s) => s.id));
  for (const s of REG.specialties.filter((x) => x.parent)) {
    assert.ok(top.has(s.parent), `${s.id}: parent ${s.parent}`);
    const text = readFileSync(join(PROMPTS, s.file), 'utf8');
    assert.ok(text.includes('부모: ' + s.parent) || new RegExp('부모[^\\n]*' + s.parent).test(text), `${s.file}: 부모 줄 없음`);
  }
});

test('부모 과목 SP가 자기 분과 id를 handoff로 안내한다', () => {
  for (const parent of ['kdoctor-internal', 'kdoctor-pediatrics']) {
    const pf = REG.specialties.find((s) => s.id === parent).file;
    const text = readFileSync(join(PROMPTS, pf), 'utf8');
    for (const c of REG.specialties.filter((x) => x.parent === parent)) assert.ok(text.includes(c.id), `${parent} → ${c.id} 안내 없음`);
  }
});

for (const f of specs) {
  test(`${f} — lint 통과 + 조립 시 공통 규칙 C1~C8이 모두 들어간다`, () => {
    const text = readFileSync(join(PROMPTS, f), 'utf8');
    const res = assemble(text, base);
    assert.equal(res.ok, true, JSON.stringify(res.lint));
    assert.ok(!res.text.includes(INCLUDE_MARK));
    for (let i = 1; i <= 8; i++) assert.ok(res.text.includes(`[규칙 C${i}]`), `C${i} 누락`);
    assert.ok(!res.text.includes('[조립 규칙]'), '조립 규칙 절은 제외돼야 함');
    assert.ok(res.text.includes('[과목 훅'));
  });
}

test('파일의 id 메타·레지스트리·총괄 SP 목록이 모두 같다', () => {
  const orch = readFileSync(join(PROMPTS, 'SP-29_kdoctor_v0_1.txt'), 'utf8');
  assert.ok(orch.includes('41개'));
  for (const s of REG.specialties) {
    const meta = lintSpecialist(readFileSync(join(PROMPTS, s.file), 'utf8')).id;
    assert.equal(meta, s.id, s.file);
    assert.ok(orch.includes(s.id.replace('kdoctor-', '') + '('), `${s.id}가 총괄 SP 목록에 없음`);
  }
});

test('어느 SP에 등장하든 kdoctor-* id는 레지스트리에 있어야 한다(지어낸 id 금지)', () => {
  const ids = new Set(REG.specialties.map((s) => s.id));
  for (const f of ['SP-29_kdoctor_v0_1.txt', ...specs]) {
    const text = readFileSync(join(PROMPTS, f), 'utf8');
    for (const m of text.matchAll(/kdoctor-([a-z]+(?:-[a-z]+)*)/g)) {
      if (['kdoctor-specialties'].includes(m[0])) continue;
      assert.ok(ids.has(m[0]), `${f}: 알 수 없는 id ${m[0]}`);
    }
  }
});

test('보고서 자문 과목 5종은 kind=report_consult, 나머지는 symptom', () => {
  const rc = REG.specialties.filter((s) => s.kind === 'report_consult').map((s) => s.id).sort();
  assert.deepEqual(rc, ['kdoctor-laboratory-medicine', 'kdoctor-nuclear-medicine', 'kdoctor-pathology', 'kdoctor-radiation-oncology', 'kdoctor-radiology']);
});

test('과목 SP에 약물 용량·검사 수치 형태의 숫자 표기가 없다', () => {
  for (const f of specs) {
    const text = readFileSync(join(PROMPTS, f), 'utf8');
    const m = text.match(/\d+(?:\.\d+)?\s?(?:mg|㎎|mcg|µg|mL|ml|IU|mmHg|mmol|mg\/dL)/);
    assert.equal(m, null, `${f}: ${m && m[0]}`);
  }
});

test('lint — 훅이 공통 규칙을 약화하면 거부', () => {
  const bad = `# x id: kdoctor-x\n${INCLUDE_MARK}\n[과목 훅 — x]\n위험 신호 handoff\n[규칙 C1]은 이 과목에서 무시한다`;
  assert.ok(lintSpecialist(bad).errors.includes('hook_weakens_base_rule'));
  const bad2 = `id: kdoctor-x\n${INCLUDE_MARK}\n[과목 훅]\n위험 신호 handoff\n이 과목은 확진할 수 있다`;
  assert.ok(lintSpecialist(bad2).errors.includes('hook_weakens_base_rule'));
});

test('lint — 필수 요소 누락과 include 마크 중복 거부', () => {
  assert.ok(lintSpecialist('id: kdoctor-x\n[과목 훅]\n위험 신호 handoff').errors.includes('include_mark_must_appear_once'));
  assert.ok(lintSpecialist(`id: kdoctor-x\n${INCLUDE_MARK}\n${INCLUDE_MARK}\n[과목 훅]\n위험 신호 handoff`).errors.includes('include_mark_must_appear_once'));
  assert.ok(lintSpecialist(`id: kdoctor-x\n${INCLUDE_MARK}\n[과목 훅]\nhandoff`).errors.includes('hook_missing_red_flags'));
  assert.ok(lintSpecialist(`${INCLUDE_MARK}\n[과목 훅]\n위험 신호 handoff`).errors.includes('specialty_id_missing'));
});

test('baseBody — 조립 규칙 절 제외', () => {
  assert.ok(!baseBody(base).includes('[조립 규칙]'));
  assert.ok(baseBody(base).includes('[한계]'));
});
