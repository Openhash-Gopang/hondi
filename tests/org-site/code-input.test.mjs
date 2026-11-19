import test from 'node:test';
import assert from 'node:assert/strict';
import { toDigitCode } from '../../src/gopang/gov/code-input.js';
import { phoneToDigits, digitsToPhone } from '../../src/gopang/ai/hondi-digit-code.js';

test('휴대폰 번호 → 10+8자리 (hondi-digit-code.js와 같은 결과)', () => {
  assert.equal(toDigitCode('010-9880-7170'), '1098807170');
  assert.equal(toDigitCode('010-9880-7170'), phoneToDigits({ type: 'mobile', subscriberNumber: '98807170' }).join(''));
  assert.equal(toDigitCode('+82 10-9880-7170'), '1098807170');
});
test('유선 번호 → 앞의 0을 빼고 9자리면 0 채움', () => {
  assert.equal(toDigitCode('064-000-0001'), '0640000001');
  assert.equal(toDigitCode('064-980-1234'), '0649801234');
  assert.equal(toDigitCode('02-1234-5678'), '0212345678');
  assert.equal(toDigitCode('064-980-1234'), phoneToDigits({ type: 'landline', areaCode: '64', subscriberNumber: '9801234' }).join(''));
});
test('이미 코드면 그대로, 이상한 입력은 null', () => {
  assert.equal(toDigitCode('1098807170'), '1098807170');
  assert.equal(toDigitCode('0640000001'), '0640000001');
  assert.equal(toDigitCode(''), null);
  assert.equal(toDigitCode('123'), null);
  assert.equal(toDigitCode('abc'), null);
});
test('왕복: 코드 → 전화번호 표기', () => {
  assert.equal(digitsToPhone('1098807170').display, '010-9880-7170');
});
