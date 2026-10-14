// 생성된 전문가 페이지의 문구 — 일반인 대상 "상담" 표현을 쓰지 않고, 전문가와 소속 직원의 서류 작성을 대화로 보조하는 도구로 표시한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const dir = new URL('../../pages/', import.meta.url);
const gen = fs.readdirSync(dir).filter(f => f.endsWith('.html') && fs.readFileSync(new URL(f, dir), 'utf8').includes('gen-expert-pages'));

test('생성 페이지가 존재한다', () => assert.ok(gen.length >= 120, `생성 페이지 ${gen.length}개`));
test('생성 페이지에 상담 안내·대화로 시작 문구가 없다', () => {
  for (const f of gen) {
    const t = fs.readFileSync(new URL(f, dir), 'utf8');
    for (const bad of ['상담 AI', '상담을', '상담하기', '상담 예시', '대화로 시작합니다', '궁금한 점'])
      assert.ok(!t.includes(bad), `${f}: "${bad}"`);
    assert.match(t, /서류 작성을<br>대화로 보조합니다/, f);
    assert.match(t, /전문가가 검토·확정/, f);
  }
});
test('전문가 목록·채팅 제목에도 상담 AI 문구가 없다', () => {
  const l = fs.readFileSync(new URL('expert-personas.html', dir), 'utf8');
  assert.ok(!l.includes(' 상담 AI 페이지"') && !l.includes("— 상담 시작'"));
  const c = fs.readFileSync(new URL('expert-chat.html', dir), 'utf8');
  assert.ok(!c.includes('<title>전문가 AI 상담</title>') && !c.includes("' AI 상담';"));
});
