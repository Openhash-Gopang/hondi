/**
 * citizen_consent_start_field.test.js — 불법행위 신고 정리(citizen-report.html)·합의매각(pages/consent-sale.html) 시작 영역(대화창) 정적 검사 (2026-10-24)
 * 실제 동작(대화)은 브라우저가 필요해 여기서 다루지 않는다.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const count = (s, sub) => s.split(sub).length - 1;
const catalog = JSON.parse(read('prompts/sp-catalog.json'));

for (const [file, sp] of [['citizen-report.html', 'k-watch'], ['pages/consent-sale.html', 'SP-24_kestate']]) {
  describe(`${file} 시작 영역`, () => {
    const html = read(file);
    it('시작 영역·위젯이 하나씩, 올바른 순서로 있다', () => {
      assert.equal(count(html, 'id="startBox"'), 1);
      assert.equal(count(html, '<script src="/assets/chat-widget.js"></script>'), 1);
      assert.ok(html.includes('panelMode: "inline"') && html.includes('inlineMount: "#startChatMount"'));
      const iW = html.indexOf('/assets/chat-widget.js'), iMd = html.indexOf('/assets/md-view.js'), iSf = html.indexOf('/assets/start-field.js');
      assert.ok(iW > 0 && iMd > iW && iSf > iMd, 'chat-widget → md-view → start-field 순서');
      assert.ok(html.includes('/assets/start-field.css'));
    });
    it(`SP ${sp} 가 카탈로그와 파일에 실재한다`, () => {
      assert.ok(html.includes(`sp: "${sp}"`));
      assert.ok(catalog[sp] && existsSync(join(ROOT, 'prompts', catalog[sp])));
    });
  });
}
describe('화면별 안전 문구', () => {
  it('신고 정리: 나비가 직접 접수하지 않는다는 점을 대화창 맥락에도 싣는다', () => {
    const h = read('citizen-report.html');
    assert.ok(h.includes('직접 접수하지 않는다') && h.includes('접수를 대신했다고 말하지 않는다'));
  });
  it('합의매각: 법원 경매가 아니라는 점과 consent_sale 모드를 싣는다', () => {
    const h = read('pages/consent-sale.html');
    assert.ok(h.includes('mode=consent_sale') && h.includes('경매가 아니라 당사자 합의'));
    assert.ok(h.includes(':where(#startBox) button'), '전역 button 규칙 되돌림 누락');
  });
});
