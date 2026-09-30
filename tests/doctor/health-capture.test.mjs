import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  shouldExtract, parseExtraction, dropKnown, captureHealthFromMessage, renderCaptureHtml, isCaptureEnabled, isHealthRecordCommand,
  renderRecordsHtml, showHealthRecords, buildCaptureLlmCaller, CAPTURE_SYSTEM_PROMPT,
} from '../../src/gopang/pdv/health-capture.js';
import { createHealthStore, memoryAdapter } from '../../src/gopang/pdv/health-profile.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const now = Date.parse('2026-10-01T00:00:00Z');
const mkStore = () => createHealthStore({ records: memoryAdapter(), access: memoryAdapter([]), now: () => now });
function fakeRoot(checked) {
  const hs = [];
  const root = {
    addEventListener: (t, f) => hs.push(f),
    querySelectorAll: () => checked.map((c, i) => ({ checked: c, getAttribute: () => String(i) })),
    set innerHTML(v) { root.html = v; }, html: '',
    click: (attr, val = '') => hs.forEach((h) => h({ target: { getAttribute: (n) => (n === attr ? val : null) } })),
  };
  return root;
}

test('shouldExtract: 건강 사실이 있을 법한 메시지만 통과', () => {
  assert.equal(shouldExtract('저는 페니실린 알레르기가 있어요'), true);
  assert.equal(shouldExtract('아버지가 당뇨가 있으세요'), true);
  assert.equal(shouldExtract('요즘 매일 술을 마셔요'), true);
  assert.equal(shouldExtract('오늘 날씨 어때?'), false);
  assert.equal(shouldExtract('부동산 전세 계약 알려줘'), false);
  assert.equal(shouldExtract('수술'), false, '너무 짧음');
});

test('parseExtraction: 근거가 원문에 없으면 버리고, 잘못된 필드·형식도 버린다', () => {
  const user = '저는 페니실린 알레르기가 있고 아버지가 당뇨였어요. 담배는 안 피웁니다.';
  const raw = '```json\n' + JSON.stringify([
    { field: 'health.allergies', value: ['페니실린'], evidence: '저는 페니실린 알레르기가 있고' },
    { field: 'health.family_history', value: ['아버지: 당뇨'], evidence: '아버지가 당뇨였어요' },
    { field: 'health.smoking', value: '비흡연', evidence: '담배는 안 피웁니다' },
    { field: 'health.conditions', value: ['폐렴'], evidence: '폐렴으로 진단받았다' },       // 원문에 없음 → 버림
    { field: 'diagnosis.primary', value: 'x', evidence: '저는 페니실린' },                   // 필드 아님
    { field: 'health.sleep', value: '짧음' },                                               // 근거 없음
  ]) + '\n```';
  const p = parseExtraction(raw, user);
  assert.deepEqual(p.map((x) => x.field), ['health.allergies', 'health.family_history', 'health.smoking']);
  assert.deepEqual(parseExtraction('없음', user), []);
  assert.deepEqual(parseExtraction('{"a":1}', user), []);
  assert.deepEqual(parseExtraction('앞말 [] 뒷말', user), []);
  assert.ok(parseExtraction('설명: ' + JSON.stringify([{ field: 'health.allergies', value: '페니실린', evidence: '페니실린 알레르기가 있고' }]), user).length === 1);
});

test('dropKnown: 이미 있는 값은 빼고 새 항목만', () => {
  const s = mkStore(); s.set('health.allergies', ['페니실린']); s.set('health.smoking', '비흡연');
  const p = dropKnown(s, [
    { field: 'health.allergies', label: 'a', value: ['페니실린', '땅콩'], evidence: 'e' },
    { field: 'health.smoking', label: 's', value: '비흡연', evidence: 'e' },
    { field: 'health.alcohol', label: 'l', value: '주 1회', evidence: 'e' },
  ]);
  assert.deepEqual(p.map((x) => [x.field, x.value]), [['health.allergies', ['땅콩']], ['health.alcohol', '주 1회']]);
});

test('captureHealthFromMessage: 게이트·LLM·승인 저장·거절 기억', async () => {
  const s = mkStore(); let llm = 0; const bubbles = []; let root;
  const text = '저는 페니실린 알레르기가 있어요';
  const ctx = {
    store: s, appendBubble: (...a) => bubbles.push(a),
    callLLM: async ({ systemPrompt, userMessage }) => { llm++; assert.equal(systemPrompt, CAPTURE_SYSTEM_PROMPT); assert.equal(userMessage, text); return JSON.stringify([{ field: 'health.allergies', value: ['페니실린'], evidence: '페니실린 알레르기가 있어요' }]); },
    getEl: () => root,
  };
  assert.equal(await captureHealthFromMessage('오늘 날씨 어때요 알려주세요', ctx), 'skipped'); assert.equal(llm, 0);
  assert.equal(await captureHealthFromMessage(text, { ...ctx, enabled: false }), 'disabled'); assert.equal(llm, 0);
  root = fakeRoot([true]);
  assert.equal(await captureHealthFromMessage(text, ctx), 'prompted');
  assert.equal(s.get('health.allergies'), null, '클릭 전에는 저장하지 않는다');
  root.click('data-act', 'approve'); root.click('data-act', 'approve');
  assert.deepEqual(s.get('health.allergies').value, ['페니실린']); assert.equal(s.get('health.allergies').source, 'ac_conversation');
  assert.equal(s.log().filter((l) => l.decision === 'ac_capture').length, 1, '중복 클릭은 한 번만');
  // 이미 저장된 값이면 다시 묻지 않는다
  assert.equal(await captureHealthFromMessage(text, ctx), 'none');
  // 거절하면 이 세션에서 다시 묻지 않는다
  const t2 = '저는 땅콩 알레르기가 있어요';
  const ctx2 = { ...ctx, callLLM: async () => JSON.stringify([{ field: 'health.allergies', value: ['땅콩'], evidence: '땅콩 알레르기가 있어요' }]) };
  root = fakeRoot([true]); assert.equal(await captureHealthFromMessage(t2, ctx2), 'prompted'); root.click('data-act', 'deny');
  assert.equal(s.get('health.allergies').value.length, 1);
  assert.equal(await captureHealthFromMessage(t2, ctx2), 'none');
});

test('captureHealthFromMessage: LLM 오류는 예외로 새지 않는다, 체크 해제한 항목은 저장 안 함', async () => {
  const s = mkStore();
  assert.equal(await captureHealthFromMessage('저는 고혈압 약을 먹고 있어요', { store: s, appendBubble() {}, getEl() {}, callLLM: async () => { throw new Error('x'); } }), 'error');
  const root = fakeRoot([false, true]);
  const llm = async () => JSON.stringify([{ field: 'health.conditions', value: ['고혈압'], evidence: '고혈압' }, { field: 'health.medications', value: ['혈압약'], evidence: '약을 먹고' }]);
  assert.equal(await captureHealthFromMessage('저는 고혈압 약을 먹고 있어요', { store: s, appendBubble() {}, getEl: () => root, callLLM: llm }), 'prompted');
  root.click('data-act', 'approve');
  assert.equal(s.get('health.conditions'), null); assert.deepEqual(s.get('health.medications').value, ['혈압약']);
});

test('렌더링은 값을 이스케이프한다', () => {
  const h = renderCaptureHtml([{ field: 'health.allergies', label: '알레르기', value: ['<img onerror=x>'], evidence: 'e' }], 'id1');
  assert.ok(!h.includes('<img') && h.includes('&lt;img'));
});

test('조회·삭제 명령', () => {
  assert.equal(isHealthRecordCommand('내 건강 기록 보여줘'), true);
  assert.equal(isHealthRecordCommand('건강 기록 삭제해줘'), true);
  assert.equal(isHealthRecordCommand('부동산 알려줘'), false);
  const s = mkStore(); s.set('health.allergies', ['페니실린']); s.appendLog({ service: 'kdoctor', decision: 'approved', provided: ['health.allergies'] });
  const html = renderRecordsHtml(s, 'r1');
  assert.ok(html.includes('페니실린') && html.includes('data-del="health.allergies"') && html.includes('kdoctor'));
  assert.ok(renderRecordsHtml(mkStore(), 'r2').includes('저장된 기록이 없습니다'));
  const root = fakeRoot([]);
  assert.equal(showHealthRecords({ store: s, appendBubble() {}, getEl: () => root }), true);
  root.click('data-del', 'health.allergies');
  assert.equal(s.get('health.allergies'), null);
  assert.equal(s.log().at(-1).decision, 'user_deleted');
  root.click('data-del', 'not.a.field'); // 무시
});

test('isCaptureEnabled, 호출자 경로·과금 원칙(/deepseek, 본인 guid)', async () => {
  assert.equal(isCaptureEnabled({ getItem: () => 'off' }), false);
  assert.equal(isCaptureEnabled({ getItem: () => null }), true);
  assert.equal(isCaptureEnabled({ getItem() { throw new Error('x'); } }), true);
  let seen;
  const call = buildCaptureLlmCaller({ endpoint: 'https://w.example/', guid: 'G1', fetchImpl: async (u, o) => { seen = [u, JSON.parse(o.body)]; return { ok: true, json: async () => ({ choices: [{ message: { content: '[]' } }] }) }; } });
  assert.equal(await call({ systemPrompt: 's', userMessage: 'u' }), '[]');
  assert.equal(seen[0], 'https://w.example/deepseek'); assert.equal(seen[1].guid, 'G1'); assert.equal(seen[1].model, 'hondi-flash');
  await assert.rejects(buildCaptureLlmCaller({ endpoint: 'x', fetchImpl: async () => ({ ok: false, status: 500 }) })({ systemPrompt: 's', userMessage: 'u' }));
});

test('send-message.js 배선', () => {
  const s = readFileSync(join(ROOT, 'src/gopang/ui/send-message.js'), 'utf8');
  assert.ok(s.includes("import('../pdv/health-capture.js')") && s.includes('_captureHealthBackground(text)') && s.includes('_showHealthRecordsLocal'));
  assert.ok(s.indexOf('_captureHealthBackground(text)') < s.indexOf('await _sendP2P'), '훅은 전송 분기 앞');
  assert.ok(/!_peer && \(aiActive \|\| _isRegistered\(\)\)/.test(s), 'P2P(사람과의 대화)에서는 추출하지 않는다');
});
