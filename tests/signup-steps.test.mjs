// 가입 화면 2단계 분할 + 나비 숫자 코드(전화번호) 표시 + 아이디 문구 (2026-11-15, 주피터 지시)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../src/gopang/core/auth.js', import.meta.url), 'utf8');

test('가입 화면에 단계 표시·숫자 코드·프로필 주소·이전 버튼이 있다', () => {
  for (const id of ['_step-ind', '_step-label', '_code-box', '_code-val', '_addr-box', '_addr-mail', '_addr-prof', '_prev-btn', '_terms-line']) {
    assert.ok(src.includes(`id="${id}"`), id + ' 없음');
  }
});

test('가입은 1단계(전화번호·아이디·이메일 ID, 문자 인증) → 2단계(백업 키 이메일) 순서다', () => {
  assert.match(src, /let _step = 1;/);
  assert.match(src, /const _submitStep2 = async/);
  assert.match(src, /if \(_signupMode && _step === 2\) return _submitStep2\(\);/);
  // 계정 생성(_completeRegistration)은 2단계에서만 부른다
  const calls = src.match(/await _completeRegistration\(/g) || [];
  assert.equal(calls.length, 1);
  assert.ok(src.indexOf('const _submitStep2') < src.indexOf('await _completeRegistration('));
});

test('나비 숫자 코드는 전화번호에서 계산하고 정하는 입력칸은 없다', () => {
  assert.match(src, /function _updateCodeBox\(\)/);
  assert.match(src, /phoneToDigits\(\{ type: 'mobile', subscriberNumber: d \}\)/);
  assert.ok(!src.includes('id="_code-input"'));
});

test('입력 화면 문구는 닉네임이 아니라 아이디다', () => {
  assert.ok(!/color:#6b7280">닉네임<\/span>/.test(src));
  assert.ok(/color:#6b7280">아이디<\/span>/.test(src));
});

test('코드 표시는 2·4·4자리로 끊는다', () => {
  assert.match(src, /code\.slice\(0, 2\)\}-\$\{code\.slice\(2, 6\)\}-\$\{code\.slice\(6\)\}/);
});
