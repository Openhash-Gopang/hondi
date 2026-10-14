// 전문가 목록의 페이지 링크(SECTION_PAGE_LINKS)가 가리키는 파일이 모두 존재하고, 생성 대상 직역이 빠짐없이 연결돼 있는지 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root = new URL('../../', import.meta.url);
const src = fs.readFileSync(new URL('pages/expert-personas.html', root), 'utf8');
const blk = src.match(/var SECTION_PAGE_LINKS = (\{[\s\S]*?\});\n/)[1];
const links = [...blk.matchAll(/'([^']+)':\s*\{\s*url:\s*'([^']+)'/g)].map(m => [m[1], m[2]]);
const SECTIONS = JSON.parse(src.match(/var SECTIONS = (\[[\s\S]*?\]);\n/)[1]);

test('링크가 가리키는 페이지 파일이 모두 있다', () => {
  assert.ok(links.length >= 100);
  for (const [id, url] of links) assert.ok(fs.existsSync(new URL('.' + url, root)), `${id} → ${url}`);
});
test('업종(supplier)·교수(edu)를 뺀 단일 직역은 모두 페이지가 있다', () => {
  for (const s of SECTIONS) {
    if (['supplier', 'edu'].includes(s.cat) || s.personas.length > 1) continue;
    assert.ok(links.some(([id]) => id === s.id || id === s.personas[0].id), `${s.id} 페이지 없음`);
  }
});
test('법률·의사 펼침 분류와 그 하위 분야 전부에 페이지가 있다', () => {
  for (const sid of ['lawyer', 'physician']) {
    const s = SECTIONS.find(x => x.id === sid);
    assert.ok(links.some(([id]) => id === sid), `${sid} 상위 페이지`);
    for (const p of s.personas) assert.ok(links.some(([id]) => id === p.id), `${p.id} 페이지 없음`);
  }
});
