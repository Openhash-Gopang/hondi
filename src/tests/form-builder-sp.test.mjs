// 양식 작성 SP(SP_form-builder) — 내 서류함 새 양식 만들기 오른쪽 대화창 전용 페르소나 등록·표기법 계약
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { CORE_REGISTRY as EXPERT_REGISTRY } from '../gopang/ai/expert-registry-core.js';
import { DOC_FORM_ROOT_KEYS, DOC_FORM_LEARNING_ROOT_KEYS } from '../gopang/ai/expert-registry.js';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

describe('양식 작성 SP (form-builder)', () => {
  it('페르소나가 등록되고, 라우팅 트리거가 없으며, 서류 서식(SP_DOC_FORM)을 결합하지 않는다', () => {
    const d = EXPERT_REGISTRY['form-builder'];
    assert.ok(d); assert.equal(d.key, 'SP_form-builder'); assert.equal(d.category, 'PLATFORM');
    assert.deepEqual(d.triggers, []);
    assert.ok(!DOC_FORM_ROOT_KEYS.includes('SP_form-builder'));
    assert.ok(!DOC_FORM_LEARNING_ROOT_KEYS.includes('SP_form-builder'));
  });
  it('sp-catalog 가 SP 파일을 가리키고 파일이 있다', () => {
    const c = JSON.parse(read('prompts/sp-catalog.json'));
    assert.equal(c['SP_form-builder'], 'SP_form-builder_v1_0.md');
    assert.ok(existsSync(new URL('../../prompts/SP_form-builder_v1_0.md', import.meta.url)));
  });
  it('SP 는 면허 직역용(-assistant) 게이트에 걸리는 "보조 AI" 제목을 쓰지 않는다', () => {
    const sp = read('prompts/SP_form-builder_v1_0.md');
    assert.ok(/^# SP-DOC-FORM-BUILDER · 양식 작성 SP/.test(sp));
    assert.ok(!/^#.*보조 AI/m.test(sp.split('\n').slice(0, 1).join('\n')));
  });
  it('SP 는 호스트(mail desktop.html)가 읽는 표기법·응답 계약을 정의한다', () => {
    const sp = read('prompts/SP_form-builder_v1_0.md');
    for (const k of ['[현재 양식]', '[요청]', '```form', '제목:', '짧은글', '긴글', '날짜', '금액:', '선택:', '폭3', '폭12', '줄2', '줄12', '묶음 8개 이하, 항목 40개 이하',
      '§OUTPUT', '§DRAFT-FIRST', '§EDIT', '§LIMIT']) assert.ok(sp.includes(k), k);
  });
});
