// 나비감정 Navi Appraisal(appraiser.hondi.net) 연동 — 임베드 허용, 서류 작성용 SP, 서비스 메뉴, registry
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CORE_REGISTRY as EXPERT_REGISTRY } from '../gopang/ai/expert-registry-core.js';
import { DOC_FORM_ROOT_KEYS } from '../gopang/ai/expert-registry.js';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

describe('나비감정 연동', () => {
  it('appraiser.hondi.net 이 임베드 부모 오리진과 PDV·서명 출처 허용 목록에 있다', () => {
    assert.ok(read('pages/expert-chat.html').includes("'https://appraiser.hondi.net'];"));
    assert.ok(read('src/gopang/gwp/allowed-origins.js').includes("'https://appraiser.hondi.net'"));
  });
  it('임베드는 서류 작성용 SP 를 연다: _PRO_WRITE_PERSONAS 에 appraiser 가 있고 SP_appraiser-assistant 가 카탈로그에 있다', () => {
    const chat = read('pages/expert-chat.html'), i = chat.indexOf('const _PRO_WRITE_PERSONAS = new Set(['), j = chat.indexOf(']);', i);
    assert.ok(/'appraiser'/.test(chat.slice(i, j)));
    const cat = JSON.parse(read('prompts/sp-catalog.json'));
    assert.ok(cat['SP_appraiser'] && cat['SP_appraiser-assistant']);
  });
  it('전문가 ID appraiser 가 registry 와 서식 직역 목록에 있다', () => {
    assert.ok(EXPERT_REGISTRY.appraiser && EXPERT_REGISTRY.appraiser.key === 'SP_appraiser');
    assert.ok(DOC_FORM_ROOT_KEYS.includes('SP_appraiser'));
  });
  it('서비스 메뉴에 나비로 다음 나비감정 링크가 있다', () => {
    const s = read('desktop.html'), pre = 'var MEGA_MENU_SECTIONS = ', i = s.indexOf(pre), j = s.indexOf(';\n', i);
    const sec = JSON.parse(s.slice(i + pre.length, j)).find((x) => x.label === '서비스' && x.items.length > 5);
    const k = sec.items.findIndex((x) => x.href === 'https://law.hondi.net');
    assert.equal(sec.items[k + 1].href, 'https://appraiser.hondi.net');
    assert.equal(sec.items[k + 1].target, '_blank');
  });
  it('registry 에 tab 서비스로 등록되고 triggers 는 서비스명·작업명뿐이다', () => {
    const reg = read('gwp-registry.js'), k = reg.indexOf("id: 'naviappraiser'");
    assert.ok(k > 0); const blk = reg.slice(k, reg.indexOf('},', k));
    assert.match(blk, /type: 'tab'/); assert.match(blk, /url: 'https:\/\/appraiser\.hondi\.net\/'/); assert.match(blk, /sp_key: null/);
  });
});
