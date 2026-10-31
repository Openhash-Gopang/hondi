// expert-chat 임베드 — 부모가 서식 이미지·PDF를 넘기고(expert-embed-attach), 서식 DB 조회 결과를 돌려받는다(2026-10-31)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const chat = readFileSync(join(ROOT, 'pages/expert-chat.html'), 'utf8');

describe('expert-chat 임베드 — 서식 첨부', () => {
  it('부모 허용 목록·같은 창 검사 아래에서만 expert-embed-attach 를 받는다', () => {
    const msgBlock = chat.slice(chat.indexOf("if (_embedOn()) {\n  window.addEventListener('message'"));
    assert.ok(msgBlock.indexOf('!_EMBED_PARENT_ORIGINS.includes(e.origin) || e.source !== window.parent') < msgBlock.indexOf("'expert-embed-attach'"));
  });
  it('이미지·PDF 만, 8MB 이하만 받는다', () => {
    assert.ok(chat.includes('e.data.data.byteLength <= 8 * 1024 * 1024'));
    assert.ok(chat.includes("/^(image\\/|application\\/pdf$)/.test(String(e.data.mime || ''))"));
  });
  it('첨부를 읽지 못하면 보내지 않고 부모에 오류를 알린다', () => {
    assert.ok(chat.includes("_embedPost({ type: 'expert-embed-error'"));
  });
  it('서식 DB 조회 결과(found/missing/error)를 부모에 알린다', () => {
    assert.ok(chat.includes("type: 'expert-embed-form', status: form ? 'found' : 'missing'"));
    assert.ok(chat.includes("type: 'expert-embed-form', status: 'error'"));
  });
  it("부모로 보낼 때 targetOrigin '*' 를 쓰지 않는다", () => {
    assert.ok(chat.includes('window.parent.postMessage(msg, _embedParentOrigin())'));
    assert.ok(!chat.includes("}, '*')"));
  });
});
