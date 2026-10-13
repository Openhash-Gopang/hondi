// 보급 계획 문서(admin/jeju-nabi-code-plan.html)의 샘플 코드 7개가 각 기관 AI 사이트로 연결되는지, 설정이 올바른지 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ORG_SITES, findSiteByDigitCode } from '../../src/gopang/gov/org-sites.js';
import { sanitizeConfig, SITE_ID_RE } from '../../src/gopang/gov/org-site-config.js';
import { isValidSerial } from '../../src/gopang/ai/hondi-digit-core.js';

const SAMPLES = {
  '73905': 'jeju-do', '4816203': 'jtp', '25918': 'jeju-univ-hospital', '6049172853': 'gwangju-court-jeju',
  '380614': 'jeju-tax-office', '91742650': 'hongseongbang', '2057': 'saebyeol-oreum',
};

test('샘플 코드 → 기관 사이트', () => {
  for (const [code, id] of Object.entries(SAMPLES)) assert.equal(findSiteByDigitCode(code), id, code);
  assert.equal(findSiteByDigitCode('99999'), null);
});
test('번호는 모두 유효하고 사이트 사이에 겹치지 않는다', () => {
  const all = Object.values(ORG_SITES).flatMap(s => s.digitCodes);
  assert.equal(new Set(all).size, all.length);
  for (const c of all) assert.ok(isValidSerial(c), c);
});
test('사이트 id·govCode·config', () => {
  for (const [id, s] of Object.entries(ORG_SITES)) {
    assert.match(id, SITE_ID_RE);
    assert.ok(s.name && s.greeting, id);
    if (s.govCode === 'none') { const r = sanitizeConfig(s.config); assert.ok(r.ok, id + ' ' + (r.errors || '')); assert.match(s.greeting, /시연용/); }
  }
});
