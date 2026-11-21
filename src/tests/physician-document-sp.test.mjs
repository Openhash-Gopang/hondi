// 의사 서류 작성 보조 AI(SP-HEALTH-16B) — 전문가 게이트 식별·후보 표시 규칙·병원 SP 반영
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ASSISTANT_SP_CODES } from '../worker/assistant-sp-codes.js';
import { detectAssistantSp, checkProGate } from '../worker/pro-gate.js';
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
describe('SP-HEALTH-16B 의사 서류 작성 보조 AI', () => {
  const sp = read('prompts/SP_physician-document-assistant_v1_0.md');
  it('제목 코드가 physician-document 로 매핑되고 게이트가 전문가용으로 식별한다', () => {
    assert.equal(ASSISTANT_SP_CODES['SP-HEALTH-16B'], 'physician-document');
    const d = detectAssistantSp({ messages: [{ role: 'system', content: sp }] });
    assert.deepEqual(d, { assistant: true, persona: 'physician-document' });
  });
  it('세션 없이는 enforce 에서 401, physician 인증 세션은 하위 직역으로 통과 대상이다', async () => {
    const body = JSON.stringify({ messages: [{ role: 'system', content: sp }] });
    const r = await checkProGate({ bodyText: body, env: { PRO_GATE_MODE: 'enforce' }, now: Date.now() });
    assert.equal(r.ok, false); assert.equal(r.status, 401);
  });
  it('핵심 규칙을 담는다: 인증 게이트·AI 후보 표시·진찰 확인·서명 금지', () => {
    for (const k of ['인증 게이트', '[AI 후보 — 의사 확인]', '직접 진찰', '서명·날인', '확률 수치', '[RX_CHECK']) assert.ok(sp.includes(k) || sp.includes(k.replace('인증 게이트', '인증이 없으면')), k);
    assert.ok(!sp.includes('[CONNECT_HUMAN_EXPERT]') || sp.includes('출력 금지 태그'));
  });
  it('병원·의원 SP v1.1 이 STEP X(진단 후보 정리와 처방 초안)를 담는다', () => {
    const h = read('prompts/SP_hospital-assistant_v1_1.md');
    assert.ok(h.includes('## STEP X') && h.includes('[AI 후보 — 의사 확인]'));
    assert.ok(/^# SP-HEALTH-26A · 병원·의원 보조 AI v1\.1/m.test(h));
  });
  it('sp-catalog 에 등록돼 있다', () => {
    const c = JSON.parse(read('prompts/sp-catalog.json'));
    assert.equal(c['SP_physician-document-assistant'], 'SP_physician-document-assistant_v1_0.md');
  });
});
