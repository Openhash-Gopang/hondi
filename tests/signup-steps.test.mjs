// 가입 화면 한 화면 통합 + 나비 숫자 코드(전화번호) 표시 + 아이디 문구 (2026-11-15, 주피터 지시)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../src/gopang/core/auth.js', import.meta.url), 'utf8');

test('가입 화면에 숫자 코드·프로필 주소·백업 이메일·약정서 문구가 있고 단계 표시·이전 버튼은 없다', () => {
  for (const id of ['_code-box', '_code-val', '_addr-box', '_addr-mail', '_addr-prof', '_bke-input', '_terms-line']) {
    assert.ok(src.includes(`id="${id}"`), id + ' 없음');
  }
  for (const id of ['_step-ind', '_step-label', '_prev-btn', '_step-seg1', '_step-seg2']) {
    assert.ok(!src.includes(id), id + ' 남아 있음');
  }
});

test('가입은 한 화면: 입력 검증(백업 이메일 포함) → 문자 인증 → 계정 생성 순서다', () => {
  assert.ok(!/\b_step\b|_submitStep2/.test(src));
  const calls = src.match(/await _completeRegistration\(/g) || [];
  assert.equal(calls.length, 1);
  const iBke = src.indexOf('백업 키를 받을 이메일을 입력해 주세요.');
  const iOtp = src.indexOf('await _requestAndVerifyPhoneOtp(e164)');
  const iReg = src.indexOf('await _completeRegistration(');
  assert.ok(iBke > 0 && iBke < iOtp && iOtp < iReg);
  assert.match(src, /btn\.textContent = !_signupMode \? '로그인' : '가입하기'/);
});

test('나비 숫자 코드는 전화번호에서 계산하고 정하는 입력칸은 없다', () => {
  assert.match(src, /function _updateCodeBox\(\)/);
  assert.match(src, /phoneToDigits\(\{ type: 'mobile', subscriberNumber: d \}\)/);
  assert.ok(!src.includes('id="_code-input"'));
});

test('입력 화면 문구는 닉네임이 아니라 아이디다', () => {
  assert.ok(!/color:#6b7280">닉네임<\/span>/.test(src));
  assert.ok(/">아이디\(한글, 영어\)<\/span>/.test(src));
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
  assert.match(src, /generateDigitCodeDataURL\(_codeSerial\(code\)\)\.then/);
  assert.match(src, /from '\.\.\/ai\/hondi-digit-render\.js'/);   // 노란 나비 로고 배치
  assert.ok(!src.includes('전화번호로 정해집니다'));
  assert.ok(!src.includes('내가 공개하기 전에는 보이지 않습니다'));
});

test('백업 키 이메일 칸은 브라우저 자동완성을 끈다', () => {
  assert.match(src, /id="_bke-input" type="email" autocomplete="off"/);
});

test('전화 입력 칸에는 문구·국기 없이 아이콘만 두고, 이용 약정서 문구는 가입 화면에만 보인다', () => {
  assert.ok(!/color:#6b7280">전화번호<\/span>/.test(src));
  assert.match(src, /id="_flag-icon" style="display:none"/);
  assert.match(src, /id="_phone-input" type="tel" aria-label="전화번호"/);
  assert.match(src, /_terms-line'\)\.style\.display = _signupMode \? '' : 'none'/);
});

test('로그인 화면에서 가입되지 않은 번호여도 안내 문구를 띄우지 않는다', () => {
  assert.ok(!src.includes('가입되지 않은 번호입니다'));
});

test('주소 상자에 "두 주소가 함께 정해집니다" 안내 문구를 두지 않는다', () => {
  assert.ok(!src.includes('두 주소가 함께 정해집니다'));
});

test('가입 화면에 전화 아이콘·열쇠 아이콘을 보이지 않는다', () => {
  assert.ok(!src.includes('&#9742;') && !src.includes('&#128273;'));
});

test('아이디·이메일 ID는 아이콘 없이 이름과 입력칸이 한 줄에 있다', () => {
  assert.ok(!src.includes('&#9786;') && !src.includes('&#9993;'));
  assert.match(src, /">아이디\(한글, 영어\)<\/span>\s*<input id="_nick-input"/);
  assert.match(src, /line-height:1\.5">이메일 ID<\/span>/);
});

test('아이디·이메일 ID는 "사용할 수 있다"는 안내 없이, 쓸 수 없을 때만 "사용할 수 없습니다."를 보인다', () => {
  assert.ok(!src.includes('처음 사용하는 아이디입니다'));
  assert.ok(!src.includes('쓸 수 있습니다. 내 메일 주소'));
  assert.ok(!src.includes('이미 ${total}명이 사용 중'));
  assert.ok((src.match(/사용할 수 없습니다\./g) || []).length >= 2);
});

test('이메일 ID는 입력하는 즉시(0.25초) 사용 가능 여부를 확인한다', () => {
  assert.match(src, /\}, 250\);   \/\/ 입력을 멈추면 바로 확인/);
});
