#!/usr/bin/env node
/**
 * assemble-specialist.mjs — K-Doctor 과목 SP 조립·lint (2026-09-30)
 *
 * 과목 SP 파일의 `@@BASE_INCLUDE@@` 한 줄을 공통 골격(SP-29-COMMON)의 본문으로 치환한다.
 * 공통 골격의 [조립 규칙] 절은 본문에서 제외한다.
 * lint: 과목 훅이 공통 규칙을 약화·삭제하려는 시도(예: "[규칙 C1] 무시", "규칙 C2 적용하지 않는다")를 막고,
 *       과목 SP에 필수 요소(과목 훅 절, 위험 신호, handoff)가 있는지 확인한다.
 *
 * 사용: node scripts/kdoctor/assemble-specialist.mjs prompts/SP-29a_kdoctor_emergency_v0_1.txt
 *       (stdout으로 조립 결과, lint 실패 시 종료 코드 1)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

export const INCLUDE_MARK = '@@BASE_INCLUDE@@';
const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_BASE = resolve(HERE, '../../prompts/SP-29-COMMON_kdoctor_specialist_base_v0_1.txt');

export function baseBody(baseText) {
  const i = baseText.indexOf('[조립 규칙]');
  // 조립 규칙 절 바로 앞의 구분선(=====) 한 줄까지 함께 잘라낸다
  if (i < 0) return baseText;
  const cut = baseText.lastIndexOf('====', i);
  return baseText.slice(0, cut > 0 ? cut : i).trimEnd() + '\n';
}

const WEAKEN = /(규칙\s*C[1-8][^\n]{0,30}(무시|적용하지\s*않|예외|생략|건너뛴|면제)|(무시|생략|면제)[^\n]{0,20}규칙\s*C[1-8]|확진(해도|한다|할\s*수\s*있다)|용량[^\n]{0,20}출처\s*없이)/;

export function lintSpecialist(specText) {
  const errors = [];
  if ((specText.match(new RegExp(INCLUDE_MARK, 'g')) ?? []).length !== 1) errors.push('include_mark_must_appear_once');
  const hookIdx = specText.indexOf('[과목 훅');
  if (hookIdx < 0) errors.push('hook_section_missing');
  const hook = hookIdx >= 0 ? specText.slice(hookIdx) : '';
  if (hook && WEAKEN.test(hook)) errors.push('hook_weakens_base_rule');
  if (hook && !/위험 신호/.test(hook)) errors.push('hook_missing_red_flags');
  if (hook && !/handoff/.test(hook)) errors.push('hook_missing_handoff');
  const idm = specText.match(/id:\s*(kdoctor-[a-z-]+)/);
  if (!idm) errors.push('specialty_id_missing');
  return { ok: errors.length === 0, errors, id: idm ? idm[1] : null };
}

export function assemble(specText, baseText) {
  const lint = lintSpecialist(specText);
  if (!lint.ok) return { ok: false, lint, text: null };
  return { ok: true, lint, text: specText.replace(INCLUDE_MARK, baseBody(baseText)) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const spec = process.argv[2];
  if (!spec) { console.error('사용: node assemble-specialist.mjs <과목 SP 파일>'); process.exit(2); }
  const res = assemble(readFileSync(spec, 'utf8'), readFileSync(process.argv[3] ?? DEFAULT_BASE, 'utf8'));
  if (!res.ok) { console.error('lint 실패:', res.lint.errors.join(', ')); process.exit(1); }
  process.stdout.write(res.text);
}
