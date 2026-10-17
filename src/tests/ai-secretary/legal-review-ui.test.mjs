// legal-review-ui.test.mjs (2026-10-17 신설) — 실행: node --test src/tests/ai-secretary/legal-review-ui.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
const ui = await import(new URL('../../gopang/ui/legal-review-ui.js', import.meta.url));

test('배너 숨김 저장·복원', () => {
  assert.equal(ui.isLegalReviewBannerHidden(), false);
  ui.setLegalReviewBannerHidden(true);
  assert.equal(ui.isLegalReviewBannerHidden(), true);
  ui.setLegalReviewBannerHidden(false);
  assert.equal(ui.isLegalReviewBannerHidden(), false);
});

test('저장소 접근이 막혀도 예외 없이 이번 탭에서는 유지', () => {
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  ui.setLegalReviewBannerHidden(true);
  assert.equal(ui.isLegalReviewBannerHidden(), true);
  ui.setLegalReviewBannerHidden(false);
  assert.equal(ui.isLegalReviewBannerHidden(), false);
});

test('법률 검토 URL', () => {
  assert.equal(ui.legalReviewUrl('administrative-scrivener'), '/pages/expert-chat.html?persona=administrative-scrivener&mode=review');
});

test('배너 문구가 인간 변호사 비대체를 명시', () => {
  assert.ok(ui.LEGAL_REVIEW_BANNER_TEXT.includes('인간 변호사를 대신하지 않습니다'));
});
