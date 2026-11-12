// 폰 승인 화면(2026-11-12): "지갑 잠금 해제" 화면 없이 숫자 선택 화면이 바로 뜨고,
// 숫자를 누르는 터치 안에서 지갑을 연다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const a = readFileSync(new URL('../auth/device-link-approve.html', import.meta.url), 'utf8');

test('지갑 잠금 해제 화면이 없다', () => {
  assert.doesNotMatch(a, /id="unlock"|btn-unlock|지갑 잠금 해제/);
  assert.doesNotMatch(a, /show\('unlock'\)/);
});
test('지갑 없이 저장된 guid 로 세션을 먼저 조회한다', () => {
  assert.match(a, /function _storedGuid\(\)[\s\S]*?gopang_user_v4[\s\S]*?\.ipv6/);
  assert.match(a, /async function init\(\)[\s\S]*?_storedGuid\(\)[\s\S]*?showRequest\(guid\)/);
  assert.doesNotMatch(a, /async function init\(\)[\s\S]*?proceedWithWallet/);
});
test('승인 핸들러는 첫 동작으로 지갑을 연다(타이머·네트워크 대기 없음)', () => {
  const h = a.slice(a.indexOf("$('btn-approve').addEventListener('click'"));
  const first = h.slice(0, h.indexOf('unlockWalletDirectly()') + 30);
  assert.doesNotMatch(first, /waitForWallet|await fetch/);
  assert.match(h, /_isSessionProxy\) \? window\.gopangWallet : await unlockWalletDirectly\(\)/);
});
test('보호 설정은 화면이 뜰 때 미리 조회하고 승인 때는 결과만 쓴다', () => {
  assert.match(a, /_biometricSetting = fetch\(/);
  const h = a.slice(a.indexOf("$('btn-approve').addEventListener('click'"));
  assert.doesNotMatch(h.slice(0, h.indexOf('requireStepUpBiometric')), /protective-setting/);
  assert.match(h, /_biometricSetting \? await _biometricSetting : true/);
});
test('지갑 계정이 요청 계정과 다르면 거절한다', () => {
  assert.match(a, /wallet\.guid !== sessionGuid\) throw new Error/);
});

test('숫자 선택 화면 단순화: 요약 한 줄 + 숫자 + 안내 한 줄, 거부·세부 정보는 숨김', () => {
  assert.match(a, /\.dl-match #btn-deny, \.dl-match #pc-label, \.dl-match #dl-rows \{ display: none; \}/);
  assert.match(a, /id="match-hint">PC 화면을 보고 있지 않거나 숫자가 없다면 선택하지 마세요\./);
  assert.match(a, /function applyMatchLayout\(data\)[\s\S]*?kauth-login:[\s\S]*?부근\(대략\)/);
  assert.match(a, /matchChoices\.length\) applyMatchLayout\(data\);\s*\n\s*show\('content'\)/);
});
test('서버 위치는 시·군·구까지만(IP 추정은 동 단위 정확도가 없다)', () => {
  const g = readFileSync(new URL('../src/worker/device-geo.js', import.meta.url), 'utf8');
  assert.match(g, /export const ADDR_DEPTH = 2;/);
});
