/**
 * tests/kmail-send-status.test.mjs — 대화에서 "보내세요" 뒤의 발송 결과 문구(실제 일어난 일만 말하는가)를 확인한다. 네트워크 없음.
 * 실행: node --test tests/kmail-send-status.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { formatKst, isImmediate, instantSendMax, buildSendStatus, IMMEDIATE_WINDOW_MS, DEFAULT_INSTANT_SEND_MAX } from '../src/worker/kmail-send-status.js';

const NOW = Date.parse('2026-10-27T07:58:16.000Z');            // 한국 시간 16:58:16 — 보고된 실제 사례의 시각

test('시각은 UTC ISO가 아니라 한국 시간으로 보여 준다', () => {
  assert.equal(formatKst(NOW, NOW), '10월 27일 16:58');
  assert.equal(formatKst(Date.parse('2026-10-28T00:30:00Z'), NOW), '10월 28일 09:30');
  assert.equal(formatKst(Date.parse('2026-10-27T15:05:00Z'), NOW), '10월 28일 00:05', '자정을 넘기면 한국 날짜가 바뀐다');
  assert.equal(formatKst(Date.parse('2027-01-02T23:59:00Z'), NOW), '2027년 1월 3일 08:59', '해가 다르면 연도를 붙인다');
});

test('"지금 즉시" 판정: 1분 이내면 즉시, 그보다 미래면 예약', () => {
  assert.equal(isImmediate(NOW, NOW), true); assert.equal(isImmediate(NOW - 5000, NOW), true); assert.equal(isImmediate(NOW + IMMEDIATE_WINDOW_MS, NOW), true);
  assert.equal(isImmediate(NOW + IMMEDIATE_WINDOW_MS + 1, NOW), false); assert.equal(isImmediate(NaN, NOW), false);
});

test('즉시 발송 상한: 기본 1명, 환경 변수로 조정, 0이면 끔, 이상한 값은 기본값', () => {
  assert.equal(DEFAULT_INSTANT_SEND_MAX, 1); assert.equal(instantSendMax({}), 1); assert.equal(instantSendMax(null), 1);
  assert.equal(instantSendMax({ KMAIL_INSTANT_SEND_MAX: '5' }), 5); assert.equal(instantSendMax({ KMAIL_INSTANT_SEND_MAX: '0' }), 0);
  assert.equal(instantSendMax({ KMAIL_INSTANT_SEND_MAX: 'abc' }), 1); assert.equal(instantSendMax({ KMAIL_INSTANT_SEND_MAX: '-3' }), 1);
});

test('바로 보냈고 모두 성공 → "발송 완료" (보고된 사례의 문장을 대체)', () => {
  const r = buildSendStatus({ nowMs: NOW, sendAtMs: NOW, recipientCount: 1, newContactCount: 1, outcome: { dispatched: true, success: 1, fail: 0 } });
  assert.equal(r.state, 'sent');
  assert.equal(r.line, '✅ 발송 완료 — 1명에게 보냈습니다. (10월 27일 16:58) · 받는 사람 1명을 주소록에 새로 저장했습니다');
  assert.ok(!/예약|예정|Z\b/.test(r.line), '예약·예정·UTC 표기가 없어야 한다');
});

test('바로 보냈지만 일부 실패·전부 실패 → 실제 결과를 그대로', () => {
  const p = buildSendStatus({ nowMs: NOW, sendAtMs: NOW, recipientCount: 3, outcome: { dispatched: true, success: 2, fail: 1 } });
  assert.equal(p.state, 'partial'); assert.match(p.line, /2명 성공, 1명 실패/); assert.match(p.line, /내 캠페인/);
  const f = buildSendStatus({ nowMs: NOW, sendAtMs: NOW, recipientCount: 1, outcome: { dispatched: true, success: 0, fail: 1 } });
  assert.equal(f.state, 'failed'); assert.match(f.line, /발송하지 못했습니다/); assert.ok(!/완료/.test(f.line));
});

test('지금 보내려 했지만 이번 요청에서 못 보냄(수신자가 많거나 시도 실패) → "발송 접수"이며 완료라고 하지 않는다', () => {
  for (const outcome of [null, { dispatched: false }]) {
    const r = buildSendStatus({ nowMs: NOW, sendAtMs: NOW, recipientCount: 40, outcome });
    assert.equal(r.state, 'queued'); assert.match(r.line, /발송 접수 — 40명/); assert.match(r.line, /아직 발송 전/); assert.match(r.line, /10분 이내/);
    assert.ok(!/발송 완료|보냈습니다/.test(r.line));
  }
});

test('미래 시각 → "예약 완료"에 한국 시간과 "아직 발송 전" 안내', () => {
  const r = buildSendStatus({ nowMs: NOW, sendAtMs: Date.parse('2026-10-28T00:00:00Z'), recipientCount: 3, newContactCount: 0 });
  assert.equal(r.state, 'scheduled'); assert.equal(r.line, '⏰ 예약 완료 — 10월 28일 09:00에 3명에게 발송됩니다. 아직 발송 전입니다.');
  const withOutcome = buildSendStatus({ nowMs: NOW, sendAtMs: Date.parse('2026-10-28T00:00:00Z'), recipientCount: 1, outcome: { dispatched: true, success: 1, fail: 0 } });
  assert.equal(withOutcome.state, 'scheduled', '미래 예약이면 시도 결과가 와도 예약으로 말한다');
});

test('주소록 새 저장 안내는 있을 때만, 어느 상태에서나 같은 문장', () => {
  for (const outcome of [null, { dispatched: true, success: 1, fail: 0 }]) {
    const a = buildSendStatus({ nowMs: NOW, sendAtMs: NOW, recipientCount: 1, newContactCount: 2, outcome });
    assert.ok(a.line.endsWith('받는 사람 2명을 주소록에 새로 저장했습니다'));
    assert.ok(!buildSendStatus({ nowMs: NOW, sendAtMs: NOW, recipientCount: 1, newContactCount: 0, outcome }).line.includes('주소록'));
  }
});

test('시스템 프롬프트: 발송 확정 직후 비서가 결과를 앞질러 말하지 않도록 규칙이 있다', () => {
  const sp = fs.readFileSync(new URL('../prompts/SP-25_kmail_v1_30.txt', import.meta.url), 'utf8');
  assert.match(sp, /발송 확정 직후 응답\(2026-10-27 신설\)/);
  for (const w of ['지금 바로 발송하겠습니다', '발송 완료', '서버가 실제 결과를 확인해서 응답 끝에 직접 덧붙입니다', '한국 시간']) assert.ok(sp.includes(w), w);
  assert.match(sp, /2026-10-27 보정\(v1\.30\)/);
});
