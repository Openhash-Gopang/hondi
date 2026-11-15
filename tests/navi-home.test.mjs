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

// ── 열린 탭 목록 ──
function bus() {
  const subs = new Set();
  return class BC { constructor() { this.l = []; subs.add(this); this.addEventListener = (t, f) => this.l.push(f); }
    set onmessage(f) { this.l.push(f); } postMessage(d) { subs.forEach((o) => { if (o !== this) o.l.forEach((f) => f({ data: JSON.parse(JSON.stringify(d)) })); }); } };
}
const mkWin = (BC, extra = {}) => ({ name: '', BroadcastChannel: BC, setInterval: () => 0, addEventListener() {}, document: { title: '전문가 업무 보조 AI', addEventListener() {}, hidden: false, getElementById: () => null, documentElement: { hasAttribute: () => false }, body: null }, location: { pathname: '/pages/expert-chat.html' }, ...extra });
const loadG = (win) => { vm.runInNewContext(code, { window: win, setInterval: () => 0, Date, Object, JSON }); return win.NaviHome; };

test('다른 탭이 알리면 메인이 목록으로 받는다(종류 추측·고유 창 이름)', () => {
  const BC = bus(); const main = loadG(mkWin(BC)); main.markMainTab();
  let got = []; main.watchTabs((l) => { got = l; });
  const w2 = mkWin(BC); const t = loadG(w2); t.registerTab();
  assert.equal(got.length, 1); assert.equal(got[0].kind, 'expert'); assert.match(got[0].name, /^naviweb-tab-/); assert.equal(got[0].label, '전문가 업무 보조 AI');
});
test('탭이 닫히면(bye) 목록에서 빠진다 / 메인 탭은 스스로를 알리지 않는다', () => {
  const BC = bus(); const main = loadG(mkWin(BC)); main.markMainTab(); let got = [];
  main.watchTabs((l) => { got = l; });
  const w2 = mkWin(BC); const t = loadG(w2); t.registerTab({ kind: 'friend', label: '김철수' });
  assert.equal(got[0].label, '김철수'); assert.equal(got[0].kind, 'friend');
  const bc = new BC(); bc.postMessage({ t: 'bye', id: got[0].id }); assert.equal(got.length, 0);
  main.registerTab(); assert.equal(got.length, 0);
});
test('gotoTab: 이름 있는 창을 열어 focus, 새 빈 창이면 닫고 실패', () => {
  let focused = 0, closed = 0, name = null;
  const live = { location: { href: 'https://app.naviweb.kr/pages/expert-chat.html' }, focus: () => focused++ };
  const BC = bus(); const api = loadG(mkWin(BC, { open: (u, n) => { name = n; return live; } }));
  assert.equal(api.gotoTab({ id: 'a', name: 'naviweb-tab-a' }), true); assert.equal(name, 'naviweb-tab-a'); assert.equal(focused, 1);
  const api2 = loadG(mkWin(BC, { open: () => ({ location: { href: 'about:blank' }, close: () => closed++ }) }));
  assert.equal(api2.gotoTab({ id: 'b', name: 'x' }), false); assert.equal(closed, 1);
});

test('iframe 안의 페이지는 탭으로 등록하지 않는다', () => {
  const BC = bus(); const main = loadG(mkWin(BC)); main.markMainTab(); let got = [];
  main.watchTabs((l) => { got = l; });
  const w = mkWin(BC); w.top = {}; w.self = w;   // self !== top
  loadG(w).registerTab({ kind: 'service', label: '메뉴' });
  assert.equal(got.length, 0);
});

test('PC(/desktop) 로고는 메인 채팅창을 부르지 않고 desktop 홈으로 간다', () => {
  let opened = 0, assigned = null, reloaded = 0;
  const mk = (path, search = '', hash = '') => ({ name: '', open: () => { opened++; return null; }, location: { pathname: path, search, hash, href: 'x', assign: (u) => { assigned = u; }, reload: () => { reloaded++; } }, dispatchEvent: () => true, CustomEvent: function () { this.defaultPrevented = false; } });
  let api = load(mk('/desktop.html', '?case=1')); assert.equal(api.isDesktopPage(), true);
  api.logoClick(); assert.equal(opened, 0); assert.equal(assigned, '/desktop.html');
  assigned = null; api = load(mk('/desktop')); api.logoClick(); assert.equal(opened, 0); assert.equal(reloaded, 1);
  api = load(mk('/webapp')); assert.equal(api.isDesktopPage(), false); api.logoClick(); assert.equal(opened, 1);
});
test('PC 페이지가 홈 이벤트를 처리하면 이동하지 않는다', () => {
  let assigned = null, reloaded = 0;
  const win = { name: '', location: { pathname: '/desktop', search: '?x=1', hash: '', assign: () => { assigned = 1; }, reload: () => { reloaded++; } }, CustomEvent: function () { this.defaultPrevented = false; }, dispatchEvent: (ev) => { ev.defaultPrevented = true; return false; } };
  load(win).logoClick(); assert.equal(assigned, null); assert.equal(reloaded, 0);
});
