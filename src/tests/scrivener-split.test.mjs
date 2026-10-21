/** 법무사·행정사 SP 분리(2026-10-21): 일반인용에는 서류 작성 도구가 없고 전문가용에만 있다. 임베드는 전문가용을 쓰고 인증 세션을 보낸다. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { detectAssistantSp } from '../worker/pro-gate.js';
import { ASSISTANT_SP_CODES } from '../worker/assistant-sp-codes.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const cat = JSON.parse(read('prompts/sp-catalog.json'));
for (const [pid, role, code] of [['judicial-scrivener', '법무사', 'SP-LAW-02'], ['administrative-scrivener', '행정사', 'SP-LAW-08']]) {
  describe(`${role} 분리`, () => {
    const pub = read('prompts/' + cat[`SP_${pid}`]), asst = read('prompts/' + cat[`SP_${pid}-assistant`]);
    it('일반인용: 서류 작성 단계(STEP C·W)가 없고 전문가용으로 식별되지 않는다', () => {
      assert.ok(!/^## STEP C — 서류 작성/m.test(pub) && !/^## STEP W — /m.test(pub));
      assert.equal(detectAssistantSp({ system: pub }).assistant, false);
    });
    it('전문가용: STEP C·W와 부록 A가 있고 전문가용으로 식별된다', () => {
      assert.ok(/^## STEP C — 서류 작성/m.test(asst) && /^## STEP W — /m.test(asst) && /^## 부록 A/m.test(asst));
      assert.deepEqual(detectAssistantSp({ system: asst }), { assistant: true, persona: pid });
      assert.ok(Object.values(ASSISTANT_SP_CODES).includes(pid) || JSON.stringify(ASSISTANT_SP_CODES).includes(code + 'A'));
    });
  });
}
describe('서류 작성하기 임베드', () => {
  const chat = read('pages/expert-chat.html');
  it('전문가용 SP 를 고르고 pro_session 을 보낸다', () => {
    assert.ok(chat.includes("def.key + '-assistant'") && chat.includes('pro_session: proSession'));
    assert.ok(chat.includes("'judicial-scrivener', 'administrative-scrivener'"));
  });
});
