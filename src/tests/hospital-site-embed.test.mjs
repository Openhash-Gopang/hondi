// 병원·의원 통합 전문가 페이지(doctor.hondi.net) 연동 — 통합 SP 등록과 임베드 허용
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { CORE_REGISTRY as EXPERT_REGISTRY } from '../gopang/ai/expert-registry-core.js';
import { DOC_FORM_ROOT_KEYS } from '../gopang/ai/expert-registry.js';
import { ASSISTANT_SP_CODES } from '../worker/assistant-sp-codes.js';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

describe('병원·의원 통합 SP 연동', () => {
  it('doctor.hondi.net 이 임베드 부모 오리진에 있다', () => {
    assert.ok(read('pages/expert-chat.html').includes("'https://doctor.hondi.net'];"));
  });
  it('페르소나 hospital 이 등록되고 서류 작성 직역 루트에 있다', () => {
    const d = EXPERT_REGISTRY.hospital;
    assert.ok(d);
    assert.equal(d.key, 'SP_hospital');
    assert.ok(DOC_FORM_ROOT_KEYS.includes('SP_hospital'));
  });
  it('임베드는 -assistant SP 를 연다 (_PRO_WRITE_PERSONAS)', () => {
    assert.ok(/_PRO_WRITE_PERSONAS = new Set\(\['judicial-scrivener',[\s\S]*?'hospital'\]\);/.test(read('pages/expert-chat.html')));
  });
  it('sp-catalog 두 키가 같은 통합 SP 파일을 가리키고 파일이 있다', () => {
    const c = JSON.parse(read('prompts/sp-catalog.json'));
    assert.equal(c['SP_hospital-assistant'], 'SP_hospital-assistant_v1_0.md');
    assert.equal(c['SP_hospital'], 'SP_hospital-assistant_v1_0.md');
    assert.ok(existsSync(new URL('../../prompts/SP_hospital-assistant_v1_0.md', import.meta.url)));
  });
  it('SP 제목 코드가 직역 id hospital 로 매핑된다', () => {
    assert.equal(ASSISTANT_SP_CODES['SP-HEALTH-26A'], 'hospital');
  });
  it('통합 SP 가 의사·간호사·원무 영역과 금지 규칙을 모두 담는다', () => {
    const sp = read('prompts/SP_hospital-assistant_v1_0.md');
    for (const k of ['## §LEGAL-LIMIT', '### A-1. 진단서·증명서', '### A-10. 간호기록', '### A-17. 수납·정산', '### A-19. 진료기록 열람', '## STEP W', '### C-2. 서식 출력 규격',
      '[의사 기재', '[간호사 기재', '[원무 기재', '[CONNECT_HUMAN_EXPERT]', '출력 금지 태그']) {
      assert.ok(sp.includes(k), k);
    }
    assert.ok(/^# SP-HEALTH-26A · 병원·의원 보조 AI/m.test(sp));
    assert.ok(!/^# SP-HEALTH-16A|^# SP-HEALTH-07A/m.test(sp));
  });
  it('K-Doctor 소개는 kdoctor.html 로 옮겨졌고 새 사이트가 tab 서비스로 등록된다', () => {
    const reg = read('gwp-registry.js');
    const k = reg.indexOf("id: 'kdoctor'");
    assert.ok(k > 0);
    assert.match(reg.slice(k, reg.indexOf('},', k)), /url: 'https:\/\/doctor\.hondi\.net\/kdoctor\.html'/);
    const n = reg.indexOf("id: 'navidoctor'");
    assert.ok(n > 0);
    const block = reg.slice(n, reg.indexOf('},', n));
    assert.match(block, /type: 'tab'/); assert.match(block, /url: 'https:\/\/doctor\.hondi\.net\/'/); assert.match(block, /status: 'active'/);
    assert.ok(read('src/gopang/gwp/allowed-origins.js').includes("'https://doctor.hondi.net'"));
  });
  it('서비스 메뉴에 병원·의원 서류 링크가 있다', () => {
    const s = read('desktop.html'), pre = 'var MEGA_MENU_SECTIONS = ', i = s.indexOf(pre), j = s.indexOf(';\n', i);
    const arr = JSON.parse(s.slice(i + pre.length, j));
    const it = arr.flatMap((x) => x.items).find((x) => x.href === 'https://doctor.hondi.net/');
    assert.ok(it && it.target === '_blank');
  });
});
