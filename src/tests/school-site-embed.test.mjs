// 나비 스쿨(school.hondi.net) 연동 — 학교 서류 작성 도우미 SP 등록, 임베드 허용, GWP 탭 서비스
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { CORE_REGISTRY as EXPERT_REGISTRY } from '../gopang/ai/expert-registry-core.js';
import { DOC_FORM_ROOT_KEYS } from '../gopang/ai/expert-registry.js';
import { detectAssistantSp } from '../worker/pro-gate.js';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

describe('나비 스쿨(school.hondi.net) 연동', () => {
  it('school.hondi.net 이 임베드 부모 오리진과 PDV·서명 허용 출처에 있다', () => {
    assert.ok(read('pages/expert-chat.html').includes("'https://law.hondi.net', 'https://school.hondi.net'"));
    assert.ok(read('src/gopang/gwp/allowed-origins.js').includes("'https://school.hondi.net'"));
  });
  it('페르소나 school-docs 가 등록되고 서류 작성 직역 루트에 있다', () => {
    const d = EXPERT_REGISTRY['school-docs'];
    assert.ok(d); assert.equal(d.key, 'SP_school-docs'); assert.equal(d.category, 'EDU');
    assert.ok(DOC_FORM_ROOT_KEYS.includes('SP_school-docs'));
  });
  it('임베드는 -assistant 키로 같은 SP 를 연다 (_PRO_WRITE_PERSONAS)', () => {
    assert.ok(/_PRO_WRITE_PERSONAS = new Set\(\['judicial-scrivener',[\s\S]*?'school-docs'/.test(read('pages/expert-chat.html')));
  });
  it('sp-catalog 두 키가 같은 SP 파일을 가리키고 파일이 있다', () => {
    const c = JSON.parse(read('prompts/sp-catalog.json'));
    assert.equal(c['SP_school-docs-assistant'], 'SP_school-docs_v1_0.md');
    assert.equal(c['SP_school-docs'], 'SP_school-docs_v1_0.md');
    assert.ok(existsSync(new URL('../../prompts/SP_school-docs_v1_0.md', import.meta.url)));
  });
  it('SP 는 자기소개 문구와 금지 규칙을 담고, 면허 직역용(전문가 게이트) SP 로 오인되지 않는다', () => {
    const sp = read('prompts/SP_school-docs_v1_0.md');
    for (const k of ['저는 학교 서류 작성을 보조하는 AI입니다.', '## §LIMIT', '## §MINOR', '## §DRAFT-FIRST', '## STEP W', '[학교 서류 보조 AI | 서류 작성 트랙', '대필', '서명·날인']) assert.ok(sp.includes(k), k);
    assert.ok(!/\[CONNECT_HUMAN_EXPERT\]\s*$/m.test(sp.split('\n').filter((l) => !/쓰지 않는다|태그/.test(l)).join('\n')));
    const r = detectAssistantSp({ system: sp });
    assert.equal(r.assistant, false, '학생·보호자도 쓰는 SP 라 전문가 면허 게이트 대상이 아니어야 한다');
  });
  it('GWP 에 navischool(tab)이 등록되고 기존 K-School(kedu)은 그대로다', () => {
    const reg = read('gwp-registry.js'), k = reg.indexOf("id: 'navischool'");
    assert.ok(k > 0);
    const block = reg.slice(k, reg.indexOf('},', k));
    assert.match(block, /type: 'tab'/); assert.ok(block.includes("url: 'https://school.hondi.net/'")); assert.match(block, /status: 'active'/);
    assert.ok(reg.includes("id: 'kedu', name: 'K-School'"));
    assert.ok(reg.includes("url: 'https://school.hondi.net/webapp.html'"));
  });
  it('서비스 메뉴에 school.hondi.net 링크가 있다', () => {
    const s = read('desktop.html'), pre = 'var MEGA_MENU_SECTIONS = ', i = s.indexOf(pre), j = s.indexOf(';\n', i);
    const arr = JSON.parse(s.slice(i + pre.length, j));
    const it2 = arr.flatMap((x) => x.items).find((x) => x.href === 'https://school.hondi.net');
    assert.ok(it2 && it2.target === '_blank');
  });
});
