// jsdom 스모크 — gopang-pwa.js의 업데이트 정책: 자동 새로고침 없음, 안내는 세션당 한 번, 「지금 적용」에서만 한 번 새로고침.
// 실행: node src/tests/pwa/update-notice.smoke.mjs   (jsdom 필요 — 저장소 의존성에는 없다)
import fs from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const src = fs.readFileSync(new URL('../../pwa/gopang-pwa.js', import.meta.url), 'utf8');

function boot() {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'dangerously', url: 'https://hondi.net/', pretendToBeVisual: true });
  const w = dom.window;
  const posted = []; const swListeners = {}; const regListeners = {};
  const waiting = { postMessage: m => posted.push(m) };
  const reg = {
    waiting, installing: null, scope: '/', update: () => Promise.resolve(),
    addEventListener: (t, f) => { regListeners[t] = f; },
  };
  Object.defineProperty(w.navigator, 'serviceWorker', { value: {
    controller: {}, register: async () => reg, ready: Promise.resolve(reg),
    addEventListener: (t, f) => { (swListeners[t] ||= []).push(f); },
  } });
  Object.defineProperty(w.navigator, 'userAgent', { value: 'test', configurable: true });
  w.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  let reloads = 0;
  w.eval(src);
  w._reloadPage = () => { reloads++; };          // 실제 새로고침 대신 센다
  return { w, reg, swListeners, regListeners, posted, reloadCount: () => reloads };
}
const tick = ms => new Promise(r => setTimeout(r, ms));
const banners = w => w.document.querySelectorAll('#update-banner').length;

// 1) 새 버전이 대기 중이어도 자동으로 적용·새로고침하지 않는다. 안내는 한 번만 뜬다.
{
  const t = boot(); t.w.dispatchEvent(new t.w.Event('load')); await tick(50);
  assert.equal(banners(t.w), 1, '안내 배너 1개');
  assert.match(t.w.document.getElementById('update-banner').textContent, /새 버전이 있습니다/);
  assert.ok(!/자동 적용/.test(t.w.document.getElementById('update-banner').textContent), '카운트다운 없음');
  await tick(7000);
  assert.equal(t.reloadCount(), 0, '7초가 지나도 새로고침 없음');
  assert.equal(t.posted.length, 0, 'SKIP_WAITING 보내지 않음');

  // 2) 포그라운드 복귀·재확인을 반복해도 배너가 다시 뜨지 않는다 — 「나중에」 후에도.
  t.w.document.getElementById('update-later-btn').click();
  assert.equal(banners(t.w), 0);
  for (let i = 0; i < 3; i++) { t.w.document.dispatchEvent(new t.w.Event('visibilitychange')); await tick(20); }
  assert.equal(banners(t.w), 0, '닫은 뒤 다시 뜨지 않음');
  assert.equal(t.reloadCount(), 0);

  // 3) controllerchange(다른 이유)로는 새로고침하지 않는다.
  t.swListeners.controllerchange.forEach(f => f());
  assert.equal(t.reloadCount(), 0, '사용자가 시작하지 않은 controllerchange는 무시');
}

// 4) 「지금 적용」: SKIP_WAITING 한 번 → controllerchange에서 새로고침 한 번.
{
  const t = boot(); t.w.dispatchEvent(new t.w.Event('load')); await tick(50);
  t.w.document.getElementById('update-apply-btn').click(); await tick(20);
  assert.equal(t.posted.length, 1); assert.equal(t.posted[0].type, 'SKIP_WAITING');
  assert.equal(t.reloadCount(), 0, 'SW 교체 전에는 새로고침하지 않음');
  t.swListeners.controllerchange.forEach(f => f());
  assert.equal(t.reloadCount(), 1, '교체 후 한 번 새로고침');
  t.swListeners.controllerchange.forEach(f => f());
  assert.equal(t.reloadCount(), 1, '두 번째 controllerchange는 무시');
}
console.log('update-notice smoke: OK');
process.exit(0);
