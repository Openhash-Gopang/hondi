// 전문가 목록: 전문가 페이지가 있으면 버튼 본체=페이지, 상담(채팅)은 오른쪽 아이콘 자리.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const s = fs.readFileSync(new URL('../../pages/expert-personas.html', import.meta.url), 'utf8');

test('페이지가 있는 직역: 본체는 페이지로, 오른쪽 아이콘은 상담으로', () => {
  assert.match(s, /href="' \+ esc\(pageLink \? pageLink\.url : expertChatUrl\(/);
  assert.match(s, /chatIco = pageLink \? '<a class="section-page-link is-chat" href="' \+ esc\(expertChatUrl\(/);
});
test('예전 페이지 이동 아이콘(pageIco)은 단일 직역 행에서 삭제됐다', () => {
  assert.ok(!/\bpageIco\b/.test(s));
});
test('페이지 없는 직역은 본체가 상담으로 간다(폴백)', () => {
  assert.match(s, /\(pageLink \? '' : CHAT_ICO_SVG\)/);
});
