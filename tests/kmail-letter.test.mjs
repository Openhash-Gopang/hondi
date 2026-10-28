/**
 * tests/kmail-letter.test.mjs — "편지 작성(AI)" 모드(캠페인이 아니라 개인 편지로 바로 발송, 보낸메일함에만 기록). 네트워크 없음.
 * 실행: node --test tests/kmail-letter.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { letterMax, evaluateLetter, buildLetterStatus, LETTER_MODE_NOTE, LETTER_MAX_RECIPIENTS } from '../src/worker/kmail-letter.js';

const NOW = Date.parse('2026-10-28T00:00:00Z');
const base = { recipients: [{ name: '주피터', email: 'tensor.city@gmail.com' }], subject: '안부', body: '안녕하세요', send_at: '2026-10-28T00:00:00Z' };

test('letterMax: 기본 1명, 최대 5명', () => {
  assert.equal(letterMax(undefined), 1); assert.equal(letterMax(0), 1); assert.equal(letterMax(3), 3); assert.equal(letterMax(50), LETTER_MAX_RECIPIENTS);
});
test('evaluateLetter: 정상 편지는 통과', () => {
  const v = evaluateLetter(base, { nowMs: NOW, max: 1 });
  assert.equal(v.ok, true); assert.equal(v.recipients[0].email, 'tensor.city@gmail.com'); assert.equal(v.subject, '안부');
});
test('evaluateLetter: 보낼 시각이 없으면 바로 보내는 것으로 본다', () => {
  assert.equal(evaluateLetter({ ...base, send_at: undefined }, { nowMs: NOW, max: 1 }).ok, true);
});
test('evaluateLetter: 예약·다수·빈 제목·잘못된 이메일은 보내지 않고 이유를 말한다', () => {
  assert.match(evaluateLetter({ ...base, send_at: '2026-10-29T00:00:00Z' }, { nowMs: NOW, max: 1 }).message, /새 캠페인.*아직 보내지 않았습니다/);
  assert.match(evaluateLetter({ ...base, recipients: [{ email: 'a@x.com' }, { email: 'b@x.com' }] }, { nowMs: NOW, max: 1 }).message, /한 번에 1명까지/);
  assert.match(evaluateLetter({ ...base, subject: ' ' }, { nowMs: NOW, max: 1 }).message, /제목과 본문/);
  assert.match(evaluateLetter({ ...base, recipients: [{ email: 'not-an-email' }] }, { nowMs: NOW, max: 1 }).message, /받는 사람 이메일/);
});
test('buildLetterStatus: 성공·일부·실패 문구', () => {
  assert.match(buildLetterStatus({ success: 1, fail: 0, nowMs: NOW }).line, /발송 완료.*보낸메일함.*캠페인으로는 기록하지 않았습니다/);
  assert.equal(buildLetterStatus({ success: 1, fail: 1, nowMs: NOW }).state, 'partial');
  assert.equal(buildLetterStatus({ success: 0, fail: 2, nowMs: NOW }).state, 'failed');
});
test('모델 안내: 캠페인 시작 금지·즉시 발송만·KMAIL_SEND_CAMPAIGN 사용을 말한다', () => {
  assert.match(LETTER_MODE_NOTE, /KMAIL_CAMPAIGN_START/); assert.match(LETTER_MODE_NOTE, /즉시/); assert.match(LETTER_MODE_NOTE, /KMAIL_SEND_CAMPAIGN/);
});
test('worker.js: 편지 모드는 캠페인을 만들지 않고 직접 발송한다', () => {
  const w = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  assert.match(w, /const letterMode = body\.mode === 'letter';/);
  const a = w.indexOf('if (letterMode) {\n      // 2026-10-28 — 편지 작성(AI)');
  const b = w.indexOf('const result = await _kmailChatCreateCampaign(env, guid, parsed);', a);
  assert.ok(a > 0 && b > a, '편지 분기가 캠페인 생성보다 먼저 와야 한다');
  const branch = w.slice(a, b);
  assert.ok(!branch.includes('_kmailChatCreateCampaign'));
  assert.match(branch, /_kmailSendOneEmail\(env,/);
  assert.match(branch, /type: 'letter_sent'/);
});
