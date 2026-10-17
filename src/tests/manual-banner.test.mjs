// manual-banner.test.mjs (2026-10-18 신설) — 실행: node --test src/tests/manual-banner.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

await import(new URL('../../assets/manual-banner.js', import.meta.url));   // 브라우저용 스크립트 — 문서가 없으면 globalThis.HondiManualBanner 로 기능만 노출한다
const mb = globalThis.HondiManualBanner;

function makeStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}
const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
const page = (path, top = true) => { const w = { location: { pathname: path } }; w.self = w; w.top = top ? w : {}; return w; };

// 최소한의 가짜 DOM — 구조와 클릭 동작만 확인한다.
class El {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.parentNode = null; this.className = ''; this.textContent = ''; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, f) { this.listeners[t] = f; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter(x => x !== c); c.parentNode = null; }
  find(cls) { if (this.className === cls) return this; for (const c of this.children) { const r = c.find(cls); if (r) return r; } return null; }
}
const fakeDoc = { createElement: tag => new El(tag) };

test('매뉴얼 주소와 문구', () => {
  assert.equal(mb.MANUAL_URL, 'https://hondi.net/assets/presentations/navi-user-manual-20261016.pdf');
  assert.ok(mb.CLOSE_LABEL.includes('다시 보지 않기 (X)'));
  assert.ok(mb.LINK_LABEL.includes('나비 매뉴얼'));
});

test('숨김 저장·복원', () => {
  const s = makeStorage();
  assert.equal(mb.isHidden(s), false);
  mb.setHidden(s, true);
  assert.equal(mb.isHidden(s), true);
  assert.equal(s.getItem(mb.STORE_KEY), '1');
  mb.setHidden(s, false);
  assert.equal(mb.isHidden(s), false);
});

test('저장소 접근이 막혀도 예외 없이 이번 탭에서는 유지', () => {
  mb.setHidden(blocked, true);
  assert.equal(mb.isHidden(blocked), true);
  mb.setHidden(blocked, false);
  assert.equal(mb.isHidden(blocked), false);
});

test('표시 조건: 직접 연 /pages/ 페이지, 최상위 창, 숨김 아님', () => {
  const s = makeStorage();
  assert.equal(mb.shouldShow(page('/pages/lawyer-civil.html'), s), true);
  assert.equal(mb.shouldShow(page('/pages/expert-personas.html'), s), true);
  assert.equal(mb.shouldShow(page('/desktop.html'), s), false);          // 오버레이가 열린 상위 페이지
  assert.equal(mb.shouldShow(page('/pages/lawyer-civil.html', false), s), false);   // iframe 안
  mb.setHidden(s, true);
  assert.equal(mb.shouldShow(page('/pages/lawyer-civil.html'), s), false);
  mb.setHidden(s, false);
});

test('배너 구성: 안내 문구, 매뉴얼 링크(새 탭), 다시 보지 않기 버튼', () => {
  const el = mb.buildBanner(fakeDoc, () => {});
  assert.equal(el.attrs.role, 'region');
  const a = el.find('nmb-link');
  assert.equal(a.href, mb.MANUAL_URL);
  assert.equal(a.target, '_blank');
  assert.ok(a.rel.includes('noopener'));
  assert.equal(el.find('nmb-close').textContent, '다시 보지 않기 (X)');
  assert.ok(el.find('nmb-text').textContent.includes('나비 매뉴얼'));
});

test('다시 보지 않기를 누르면 저장하고 배너를 제거', () => {
  const s = makeStorage();
  const host = new El('body');
  let closed = 0;
  const el = mb.buildBanner(fakeDoc, () => { closed++; mb.setHidden(s, true); });
  host.appendChild(el);
  el.find('nmb-close').listeners.click();
  assert.equal(closed, 1);
  assert.equal(host.children.length, 0);
  assert.equal(s.getItem(mb.STORE_KEY), '1');
});
