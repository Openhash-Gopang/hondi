import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { rememberImages, recallImages, forgetImages, MAX_KEPT, KEEP_MS } from '../gopang/ai/attach-memory.js';

const img = n => `data:image/jpeg;base64,${n}`;

describe('메인 채팅 첨부 사진 기억', () => {
  it('저장·조회, 이미지가 아닌 값은 무시', () => {
    forgetImages(); rememberImages([img('A'), 'http://x', 42, img('B')]);
    assert.deepEqual(recallImages(), [img('A'), img('B')]);
  });
  it('최대 개수 초과 시 오래된 것부터 버림', () => {
    forgetImages(); rememberImages(Array.from({ length: MAX_KEPT + 2 }, (_, i) => img('N' + i)));
    const r = recallImages(); assert.equal(r.length, MAX_KEPT); assert.equal(r[0], img('N2'));
  });
  it('30분 지나면 사라진다', () => {
    forgetImages(); const t0 = 1_000_000; rememberImages([img('A')], () => t0);
    assert.equal(recallImages(() => t0 + KEEP_MS).length, 1);
    assert.equal(recallImages(() => t0 + KEEP_MS + 1).length, 0);
  });
});

describe('배선(소스 확인)', () => {
  const read = p => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
  it('call-ai: 이미지 첨부 시 기억, expert-session: 전문가 호출 때 인계', () => {
    assert.match(read('src/gopang/ai/call-ai.js'), /rememberImages\(\[`data:\$\{mimeType\};base64,\$\{base64\}`\]\)/);
    const es = read('src/gopang/ai/expert-session.js');
    assert.match(es, /recallImages\(\)/); assert.match(es, /putShots\(small\)/); assert.match(es, /_gwpLaunch\(launchDef,/);
  });
});
