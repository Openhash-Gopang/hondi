import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DOC_FORM_ROOT_KEYS, EXPERT_REGISTRY } from '../gopang/ai/expert-registry.js';
import { shotsToAttachment, HANDOFF_PARAM, HANDOFF_TTL_MS } from '../gopang/ai/form-shots-handoff.js';

const read = p => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

describe('서식 촬영 → 전문가 채팅 전달', () => {
  it('촬영 화면의 전문가 선택지 = 서류 작성 직역 루트 목록(드리프트 방지)', () => {
    const html = read('pages/digit-code.html');
    const sel = html.match(/<select id="formPersona"[\s\S]*?<\/select>/)[0];
    const ids = [...sel.matchAll(/<option value="([^"]+)"/g)].map(m => m[1]).sort();
    const want = DOC_FORM_ROOT_KEYS.map(k => k.replace(/^SP_/, '')).sort();
    assert.deepEqual(ids, want);
    for (const id of ids) assert.ok(EXPERT_REGISTRY[id], `레지스트리에 없음: ${id}`);
  });
  it('보내는 쪽과 받는 쪽이 같은 쿼리 파라미터를 쓴다', () => {
    assert.equal(HANDOFF_PARAM, 'formshots');
    assert.match(read('pages/expert-chat.html'), /_qs\.get\(HANDOFF_PARAM\)/);
    assert.match(read('pages/digit-code.html'), /H\.HANDOFF_PARAM/);
  });
  it('첨부 객체: 여러 장 모두 보존, 첫 장이 dataUrl', () => {
    const a = shotsToAttachment(['data:image/jpeg;base64,AAA', 'data:image/jpeg;base64,BBB']);
    assert.equal(a.name, '서식 사진 2장'); assert.equal(a.images.length, 2); assert.equal(a.dataUrl, a.images[0]); assert.equal(a.isImage, true);
  });
  it('유효 시간 30분', () => assert.equal(HANDOFF_TTL_MS, 30 * 60 * 1000));
  it('자동 전송하지 않는다(받는 쪽은 첨부·문구만 채움)', () => {
    const html = read('pages/expert-chat.html');
    const blk = html.slice(html.indexOf('if (_qs.get(HANDOFF_PARAM))'));
    assert.ok(!/sendTurn\(|doSend\(\)/.test(blk.slice(0, blk.indexOf('}).catch'))));
  });
});
