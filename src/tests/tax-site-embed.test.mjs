// 세무·회계 통합 전문가 페이지(tax.hondi.net) 연동 — 통합 SP 등록과 임베드 허용
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { CORE_REGISTRY as EXPERT_REGISTRY } from '../gopang/ai/expert-registry-core.js';
import { DOC_FORM_ROOT_KEYS } from '../gopang/ai/expert-registry.js';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

describe('세무·회계 통합 SP 연동', () => {
  it('tax.hondi.net 이 임베드 부모 오리진에 있다', () => {
    assert.ok(read('pages/expert-chat.html').includes("'https://tax.hondi.net'];"));
  });
  it('페르소나 tax-accounting 이 등록되고 서류 작성 직역 루트에 있다', () => {
    const d = EXPERT_REGISTRY['tax-accounting'];
    assert.ok(d);
    assert.equal(d.key, 'SP_tax-accounting');
    assert.ok(DOC_FORM_ROOT_KEYS.includes('SP_tax-accounting'));
  });
  it('임베드는 -assistant SP 를 연다 (_PRO_WRITE_PERSONAS)', () => {
    assert.ok(/_PRO_WRITE_PERSONAS = new Set\(\['judicial-scrivener',[\s\S]*?'tax-accounting'/.test(read('pages/expert-chat.html')));
  });
  it('sp-catalog 두 키가 같은 통합 SP 파일을 가리키고 파일이 있다', () => {
    const c = JSON.parse(read('prompts/sp-catalog.json'));
    assert.equal(c['SP_tax-accounting-assistant'], 'SP_tax-accounting-assistant_v1_0.md');
    assert.equal(c['SP_tax-accounting'], 'SP_tax-accounting-assistant_v1_0.md');
    assert.ok(existsSync(new URL('../../prompts/SP_tax-accounting-assistant_v1_0.md', import.meta.url)));
  });
  it('통합 SP 가 세무·회계 영역과 금지 규칙을 모두 담는다', () => {
    const sp = read('prompts/SP_tax-accounting-assistant_v1_0.md');
    for (const k of ['## §LEGAL-LIMIT', '### A-1. 부가가치세', '### A-21. 외부감사', '### A-38.', '### L-8.', '## STEP T', '[회계사 판단]', '[CONNECT_HUMAN_EXPERT]']) {
      assert.ok(sp.includes(k), k);
    }
    assert.ok(!/^# SP-FIN-09|^# SP-FIN-10/m.test(sp));
  });
});
