import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const code = fs.readFileSync(new URL('../navi-home.js', import.meta.url), 'utf8');
const load = (win) => { vm.runInNewContext(code, { window: win }); return win.NaviHome; };

test('열려 있는 메인 창은 주소를 바꾸지 않고 focus 만 한다(새로고침 없음)', () => {
  const calls = []; let focused = 0, replaced = 0;
  const existing = { get location() { throw new Error('SecurityError'); }, focus: () => { focused++; } };   // 다른 출처 = 읽기 불가
  const api = load({ name: '', open: (u, n) => { calls.push([u, n]); return existing; } });
  api.openMain(); assert.deepEqual(calls[0], ['', api.MAIN_WINDOW]); assert.equal(focused, 1); assert.equal(replaced, 0);
});
test('같은 출처의 기존 메인 창(주소가 about:blank 아님)도 그대로 둔다', () => {
  let replaced = 0, focused = 0;
  const w = { location: { href: 'https://app.naviweb.kr/webapp', replace: () => { replaced++; } }, focus: () => { focused++; } };
  load({ name: '', open: () => w }).openMain(); assert.equal(replaced, 0); assert.equal(focused, 1);
});
test('메인 창이 없으면 새 빈 창을 메인 주소로 보낸다', () => {
  let to = null, focused = 0;
  const w = { location: { href: 'about:blank', replace: (u) => { to = u; } }, focus: () => { focused++; } };
  const api = load({ name: '', open: () => w }); api.openMain(); assert.equal(to, api.MAIN_URL); assert.equal(focused, 1);
});
test('팝업이 막히면 이 탭을 메인 주소로 이동', () => {
  const win = { name: '', open: () => null, location: { href: 'x' } };
  const api = load(win); assert.equal(api.openMain(), null); assert.equal(win.location.href, api.MAIN_URL);
});
test('창 이름으로 메인·호출 탭 구분', () => {
  const api = load({ name: '' }); assert.equal(api.isMainTab(), false); api.markMainTab(); assert.equal(api.isMainTab(), true); api.markCallTab(); assert.equal(api.isMainTab(), false);
});
test('나중에 열린 메인이 알리면 먼저 열린 메인은 passive 가 된다', () => {
  const chans = [];
  class BC { constructor() { this.l = null; chans.push(this); } set onmessage(f) { this.l = f; } postMessage(m) { chans.filter(c => c !== this).forEach(c => c.l && c.l({ data: m })); } }
  const a = load({ name: '', BroadcastChannel: BC }); let passive = 0; a.watchMain(() => { passive++; });
  const b = load({ name: '', BroadcastChannel: BC }); b.watchMain(() => {});
  assert.equal(passive, 1);
});
