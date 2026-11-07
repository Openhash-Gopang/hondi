import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('가입: 테스트 간소화 스위치는 꺼져 있다(PC 가입 차단·생체인증 등록 복원)', () => {
  assert.match(read('src/gopang/core/auth.js'), /const SIMPLE_SIGNUP_TEST = false;/);
});
test('서버: 문자 인증 없는 테스트 입장은 환경변수와 무관하게 닫혀 있다', () => {
  assert.match(read('worker.js'), /function _testAuthOn\(env\) \{ return false; \}/);
});
test('로그인 팝업: 폰이 없으면 "문자로 받기" 버튼으로만 문자를 보낸다(자동 발송 없음)', () => {
  const s = read('auth/k-service-auth-client.js');
  assert.match(s, /id="ksa-sms-btn"/);
  assert.match(s, /\/auth\/device-link\/resend-sms/);
  assert.match(s, /showSmsButton\(data\.hasMobileDevice === false\)/);
  assert.doesNotMatch(s, /문자로 안내해 드립니다/, '실제로는 보내지 않는 문구를 쓰지 않는다');
});
test('폐기된 QR 로그인 파일은 없다', () => {
  assert.equal(existsSync(new URL('../auth/qr-login.html', import.meta.url)), false);
  assert.equal(existsSync(new URL('../auth/qr-scan.html', import.meta.url)), false);
});
test('푸시 구독 점검은 1시간마다 다시 시도한다', () => {
  assert.match(read('gopang-app.js'), /PUSH_RETRY_COOLDOWN_MS = 60 \* 60 \* 1000/);
});
