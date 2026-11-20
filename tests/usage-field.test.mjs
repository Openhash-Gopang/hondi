import test from 'node:test';
import assert from 'node:assert/strict';
import { usageField, fieldFromOrigin } from '../src/worker/usage-field.js';
test('usage_field: 본문 지정값을 걸러서 쓴다', () => {
  assert.equal(usageField(JSON.stringify({ usage_field: '병원·의원 · 피부과' }), ''), '병원·의원 · 피부과');
  assert.equal(usageField(JSON.stringify({ usage_field: '<b>[x]</b>' + 'a'.repeat(80) }), '').length <= 40, true);
});
test('usage_field: 지정이 없으면 요청 사이트로 짐작한다', () => {
  assert.equal(usageField('{}', 'https://doctor.hondi.net'), '병원·의원 전문가 AI');
  assert.equal(fieldFromOrigin('https://tax.hondi.net'), '세무·회계 전문가 AI');
  assert.equal(fieldFromOrigin('https://mail.naviweb.kr'), '메일');
});
test('usage_field: 모르는 사이트·본문은 빈 값', () => {
  assert.equal(usageField('not json', 'https://example.com'), '');
  assert.equal(fieldFromOrigin('https://evil.example.com/hondi.net'), '');
  assert.equal(fieldFromOrigin('https://naviweb.kr'), '');
});
