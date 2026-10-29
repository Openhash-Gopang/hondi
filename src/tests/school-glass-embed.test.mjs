// 끼운 화면 반투명(?embed=1&glass=1) — 나비 스쿨 대화창 안쪽 바탕을 투명하게
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../../pages/expert-chat.html', import.meta.url), 'utf8');
describe('expert-chat glass=1', () => {
  it('embed=1 이고 glass=1 일 때만 html 에 glass 클래스를 붙인다', () => {
    assert.ok(/get\('glass'\)==='1'/.test(html));
    assert.ok(html.includes("classList.add('glass')"));
  });
  it('glass 일 때 바탕·대화 영역은 투명, 입력 독은 반투명이다', () => {
    assert.ok(/html\.embed\.glass,\s*html\.embed\.glass body[^{]*\{[^}]*background:transparent/.test(html));
    assert.ok(/html\.embed\.glass #bottom-dock\{[^}]*rgba\(/.test(html));
  });
  it('glass 규칙은 embed.glass 로만 한정되어 일반 접속에 영향이 없다', () => {
    const rules = html.split('\n').filter((l) => /glass/.test(l) && /\{/.test(l) && !/classList/.test(l));
    assert.ok(rules.length >= 2);
    for (const r of rules) assert.ok(/html\.embed\.glass/.test(r), r);
  });
});
