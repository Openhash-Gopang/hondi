/**
 * k_government_klaw_start_field.test.js — K-정부(pages/k-government.html)·K-Law(pages/klaw.html) 시작 영역(대화창) 정적 검사 (2026-10-24)
 * 실제 동작(탭 전환·대화)은 브라우저가 필요해 여기서 다루지 않는다.
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
const spOk = (k) => catalog[k] && existsSync(join(ROOT, 'prompts', catalog[k]));

for (const [name, firstSp] of [['k-government', 'SP-12_kdemocracy'], ['klaw', 'SP-01_klaw']]) {
  describe(`${name} 시작 영역`, () => {
    const html = read(`pages/${name}.html`);
    it('시작 영역·위젯이 하나씩, 올바른 순서로 있다', () => {
      assert.equal(count(html, 'id="startBox"'), 1);
      assert.equal(count(html, '<script src="/assets/chat-widget.js"></script>'), 1, '위젯 include 가 중복됨');
      assert.ok(html.includes('panelMode: "inline"') && html.includes('inlineMount: "#startChatMount"'));
      assert.ok(html.includes(`sp: "${firstSp}"`) && spOk(firstSp));
      const iW = html.indexOf('/assets/chat-widget.js'), iMd = html.indexOf('/assets/md-view.js'), iSf = html.indexOf('/assets/start-field.js');
      assert.ok(iW > 0 && iMd > iW && iSf > iMd, 'chat-widget → md-view → start-field 순서');
      assert.ok(html.includes('/assets/start-field.css'));
    });
  });
}
describe('k-government 탭별 SP', () => {
  const html = read('pages/k-government.html');
  it('입법·사법·행정이 각각 SP 로 연결된다', () => {
    const blk = (html.match(/var GOV_CHAT\s*=\s*\{([\s\S]*?)\n\};/) || [])[1] || '';
    for (const [tab, sp] of [['legislative', 'SP-12_kdemocracy'], ['judicial', 'SP-01_klaw'], ['administrative', 'SP-10_kpublic']]) {
      assert.ok(new RegExp(`${tab}:\\s*\\{\\s*sp:\\s*'${sp}'`).test(blk), `${tab} → ${sp}`);
      assert.ok(spOk(sp), sp);
    }
    assert.ok(/function renderBranch\(key\) \{\s*syncGovChat\(key\);/.test(html), 'renderBranch 가 syncGovChat 을 부르지 않음');
  });
});
