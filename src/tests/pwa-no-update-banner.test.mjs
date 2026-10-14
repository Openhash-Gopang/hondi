// 「새 버전이 있습니다」 배너 제거 회귀 방지 — 배너·자동 새로고침 코드가 다시 들어오지 않게 한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../pwa/gopang-pwa.js', import.meta.url), 'utf8');
const code = src.replace(/\/\/.*$/gm, '');   // 주석 제외

test('업데이트 안내 배너와 자동 적용 코드가 없다', () => {
  for (const w of ['update-banner', '새 버전이 있습니다', '지금 적용', '_showUpdateBanner', '_noticeUpdateOnce', '_applyUpdate'])
    assert.ok(!code.includes(w), `남아 있으면 안 됨: ${w}`);
});

test('수동 갱신(forceUpdateApp)은 그대로 남아 있고, 자동 적용 리스너는 없다', () => {
  assert.ok(!/addEventListener\('controllerchange'/.test(code), 'controllerchange 자동 새로고침 금지');
  assert.match(code, /window\.forceUpdateApp\s*=\s*forceUpdateApp/);
});

test('문법 오류 없음', () => { new Function(src); });
