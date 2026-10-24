/**
 * jeju_gov_automation_start_field.test.js — 제주 AI 행정(pages/jeju-gov-automation.html) 시작 영역(대화창) 정적 검사 (2026-10-24)
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
const html = read('pages/jeju-gov-automation.html');
const catalog = JSON.parse(read('prompts/sp-catalog.json'));

describe('제주 AI 행정 시작 영역', () => {
  it('시작 영역·위젯이 하나씩, 올바른 순서로 있다', () => {
    assert.equal(count(html, 'id="startBox"'), 1);
    assert.equal(count(html, '<script src="/assets/chat-widget.js"></script>'), 1);
    assert.ok(html.includes('panelMode: "inline"') && html.includes('inlineMount: "#startChatMount"'));
    const iW = html.indexOf('/assets/chat-widget.js'), iMd = html.indexOf('/assets/md-view.js'), iSf = html.indexOf('/assets/start-field.js');
    assert.ok(iW > 0 && iMd > iW && iSf > iMd, 'chat-widget → md-view → start-field 순서');
    assert.ok(html.includes('/assets/start-field.css'));
  });
  it('SP-10_kpublic 이 카탈로그와 파일에 실재한다', () => {
    assert.ok(html.includes('sp: "SP-10_kpublic"'));
    assert.ok(catalog['SP-10_kpublic'] && existsSync(join(ROOT, 'prompts', catalog['SP-10_kpublic'])));
  });
  it('고른 기관·부서를 말에 덧붙이는 훅이 있고, 기본 선택은 싣지 않는다', () => {
    assert.ok(html.includes('beforeSend') && html.includes('__jejuSel0') && html.includes('__jejuSelNow'));
  });
  it('K-Law 버튼(이전 PR)이 그대로 있다', () => {
    assert.ok(html.includes('klaw-nav-btn'));
  });
});
