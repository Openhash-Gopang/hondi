/**
 * navi_guide_start_field.test.js — 「나비 안내」 시작 영역(대화창)을 붙인 5개 소개 페이지의 정적 검사 (2026-10-24)
 * 대상: persona.html, pages/hondi-market.html, pages/usage-guide.html, pages/ai-assistant.html, pages/professional-ai.html
 * 이 대화는 특정 서비스 제공자가 아니라 나비 안내 역할(HONDI_VISITOR_SP)이다. 실제 동작(대화)은 브라우저가 필요해 여기서 다루지 않는다.
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
const PAGES = ['persona.html', 'pages/hondi-market.html', 'pages/usage-guide.html', 'pages/ai-assistant.html', 'pages/professional-ai.html'];

for (const f of PAGES) {
  describe(`${f} 나비 안내`, () => {
    const html = read(f);
    it('시작 영역·위젯이 하나씩, 올바른 순서로 있다', () => {
      assert.equal(count(html, 'id="startBox"'), 1);
      assert.equal(count(html, '<script src="/assets/chat-widget.js"></script>'), 1);
      assert.ok(html.includes('panelMode: "inline"') && html.includes('inlineMount: "#startChatMount"'));
      const iW = html.indexOf('/assets/chat-widget.js'), iMd = html.indexOf('/assets/md-view.js'), iSf = html.indexOf('/assets/start-field.js');
      assert.ok(iW > 0 && iMd > iW && iSf > iMd, 'chat-widget → md-view → start-field 순서');
      assert.ok(html.includes('/assets/start-field.css'));
    });
    it('나비 안내 SP(HONDI_VISITOR_SP)가 카탈로그와 파일에 실재하고, 안내 역할임을 맥락에 밝힌다', () => {
      assert.ok(html.includes('sp: "HONDI_VISITOR_SP"'));
      assert.ok(catalog.HONDI_VISITOR_SP && existsSync(join(ROOT, 'prompts', catalog.HONDI_VISITOR_SP)));
      assert.ok(/나비 안내 역할/.test(html), '안내 역할 명시 누락');
    });
  });
}
