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

test('코드 표시는 휴대폰·서울은 2·4·4, 그 외 지역은 3·3·4자리로 끊는다', () => {
  assert.match(src, /code\.slice\(0, 2\)\}-\$\{code\.slice\(2, 6\)\}-\$\{code\.slice\(6\)\}/);
  assert.match(src, /code\.slice\(0, 3\)\}-\$\{code\.slice\(3, 6\)\}-\$\{code\.slice\(6\)\}/);
});

test('로그인·가입 탭은 Material 탭(tablist·aria-selected·밑줄 표시)이다', () => {
  assert.match(src, /id="_mode-tabs" role="tablist"/);
  assert.match(src, /class="md-tab" role="tab"/);
  assert.match(src, /setAttribute\('aria-selected'/);
});

test('코드 상자에는 설명 글 없이 나비 숫자 코드 시안(그림)만 보인다', () => {
  assert.match(src, /id="_code-img"/);
  assert.match(src, /generateDigitCodeDataURL\(code\)\.then/);
  assert.ok(!src.includes('전화번호로 정해집니다'));
  assert.ok(!src.includes('내가 공개하기 전에는 보이지 않습니다'));
});

test('백업 키 이메일 칸은 브라우저 자동완성을 끈다', () => {
  assert.match(src, /id="_bke-input" type="email" autocomplete="off"/);
});

test('전화 입력 칸에는 문구·국기 없이 아이콘만 두고, 이용 약정서 문구는 가입 마지막 화면에만 보인다', () => {
  assert.ok(!/color:#6b7280">전화번호<\/span>/.test(src));
  assert.match(src, /id="_flag-icon" style="display:none"/);
  assert.match(src, /id="_phone-input" type="tel" aria-label="전화번호"/);
  assert.match(src, /_terms-line'\)\.style\.display = s2 \? '' : 'none'/);
});

test('로그인 화면에서 가입되지 않은 번호여도 안내 문구를 띄우지 않는다', () => {
  assert.ok(!src.includes('가입되지 않은 번호입니다'));
});

test('주소 상자에 "두 주소가 함께 정해집니다" 안내 문구를 두지 않는다', () => {
  assert.ok(!src.includes('두 주소가 함께 정해집니다'));
});
