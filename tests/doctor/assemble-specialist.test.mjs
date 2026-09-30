import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemble, lintSpecialist, baseBody, INCLUDE_MARK, DEFAULT_BASE } from '../../scripts/kdoctor/assemble-specialist.mjs';

const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), '../../prompts');
const base = readFileSync(DEFAULT_BASE, 'utf8');
const specs = readdirSync(PROMPTS).filter((f) => /^SP-29[a-z]_kdoctor_.*\.txt$/.test(f));

test('과목 SP 4종이 존재한다', () => {
  assert.deepEqual(specs.sort(), [
    'SP-29a_kdoctor_emergency_v0_1.txt', 'SP-29b_kdoctor_internal_v0_1.txt',
    'SP-29c_kdoctor_pediatrics_v0_1.txt', 'SP-29d_kdoctor_dermatology_v0_1.txt']);
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

test('총괄 SP가 호출하는 4개 id와 과목 SP의 id가 일치한다', () => {
  const orch = readFileSync(join(PROMPTS, 'SP-29_kdoctor_v0_1.txt'), 'utf8');
  const ids = specs.map((f) => lintSpecialist(readFileSync(join(PROMPTS, f), 'utf8')).id).sort();
  assert.deepEqual(ids, ['kdoctor-dermatology', 'kdoctor-emergency', 'kdoctor-internal', 'kdoctor-pediatrics']);
  for (const id of ids) assert.ok(orch.includes(id), `${id}가 총괄 SP에 없음`);
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
