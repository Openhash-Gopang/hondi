import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const pages = fs.readdirSync(path.join(root, 'pages')).filter(f => f.endsWith('.html'))
  .map(f => [f, fs.readFileSync(path.join(root, 'pages', f), 'utf8')])
  .filter(([, s]) => s.includes('id="askOther"'));

test('「목록에 없는 서류 작성하기」 버튼은 서류 목록(탭) 위에 있다', () => {
  assert.ok(pages.length >= 17);
  for (const [f, s] of pages) {
    const btn = s.indexOf('id="askOther"'), tabs = s.indexOf('id="svcTabs"');
    assert.ok(btn > 0 && tabs > 0 && btn < tabs, f);
    assert.match(s, /class="svc-link-btn solid ask-other" id="askOther"/, f);
  }
});

test('채팅 위젯에 카메라·파일 첨부 버튼이 있다', () => {
  const w = fs.readFileSync(path.join(root, 'assets/chat-widget.js'), 'utf8');
  assert.match(w, /id="hcw-cam"/);
  assert.match(w, /id="hcw-clip"/);
  assert.match(w, /capture="environment"/);
  assert.match(w, /image_url/);
});
