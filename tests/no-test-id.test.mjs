// 테스트 아이디 입장 폐지 (2026-11-15, 주피터 지시) — 모든 사용자는 전화 인증·아이디·이메일 ID로 가입한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('가입 앱(auth.js)에 테스트 아이디 입장 코드가 없다', () => {
  const s = read('src/gopang/core/auth.js');
  for (const name of ['_testEnter', '_applyTestEnter', '_showTestIdPopup', '_refreshTestSession', '_handleTestIdParam', '_isTestAuthEnabled', '_showTestNoticeBanner', '/auth/test-enter', '/auth/test-mode']) {
    assert.ok(!s.includes(name), name + ' 남아 있음');
  }
  // 이 기기에 남은 옛 테스트 계정은 지운다
  assert.match(s, /_loadStored\(\)\?\.test_account/);
});

test('K 서비스 로그인 클라이언트는 테스트 입장을 하지 않고 옛 테스트 토큰을 지운다', () => {
  const s = read('auth/k-service-auth-client.js');
  assert.ok(!s.includes('autoTestEnter'));
  assert.ok(!s.includes('/auth/test-enter'));
  assert.ok(!s.includes('/auth/test-mode'));
  assert.match(s, /if \(isTestToken\(token\)\) clear\(\);/);
});

test('서버는 테스트 입장 경로를 열지 않는다', () => {
  const s = read('worker.js');
  assert.ok(!/pathname === '\/auth\/test-mode'/.test(s));
  assert.ok(!/pathname === '\/auth\/test-enter'/.test(s));
});
