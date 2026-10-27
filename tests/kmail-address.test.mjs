/**
 * tests/kmail-address.test.mjs — 보내는 주소(메일 아이디)와 들어오는 주소 해석 규칙. 네트워크 없음.
 * 실행: node --test tests/kmail-address.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { senderLocalPart, senderAddress, classifyInboundLocalPart, guidToLocalPart, GUID_LOCAL_RE } from '../src/worker/kmail-address.js';
import { defaultMailIdFromHash, checkMailId } from '../src/worker/mail-id.js';

const randGuid = () => '2601:db80:' + Array.from({ length: 6 }, () => crypto.randomBytes(2).toString('hex')).join(':');
const GUID = '2601:db80:c342:fd1b:bc4a:2dce:9ed8:04b6';          // 보고된 실제 사례의 guid

test('보내는 주소: 메일 아이디가 있으면 그것, 없거나 형식이 맞지 않으면 예전 guid 주소', () => {
  assert.equal(senderAddress(GUID, 'swift-heron-482'), 'swift-heron-482@hondi.kr');
  assert.equal(senderAddress(GUID, 'Swift-Heron-482'), 'swift-heron-482@hondi.kr', '대문자는 소문자로');
  assert.equal(senderAddress(GUID, ''), '2601-db80-c342-fd1b-bc4a-2dce-9ed8-04b6@hondi.kr');
  assert.equal(senderAddress(GUID, undefined), '2601-db80-c342-fd1b-bc4a-2dce-9ed8-04b6@hondi.kr');
  assert.equal(senderAddress(GUID, 'a b'), '2601-db80-c342-fd1b-bc4a-2dce-9ed8-04b6@hondi.kr', '형식이 틀린 값은 쓰지 않는다');
  assert.equal(senderAddress(GUID, 'x@y'), '2601-db80-c342-fd1b-bc4a-2dce-9ed8-04b6@hondi.kr', '@가 들어간 값은 쓰지 않는다');
});

test('예전에 자동 배정된 8자리 16진수(숫자만일 수도 있음)도 보내는 주소로는 그대로 쓴다', () => {
  assert.equal(senderAddress(GUID, 'a3f09c1e'), 'a3f09c1e@hondi.kr');
  assert.equal(senderAddress(GUID, '12345678'), '12345678@hondi.kr');
  assert.equal(checkMailId('12345678').ok, false, '새로 정할 때는 숫자만 안 되지만');
});

test('들어오는 주소 분류: 캠페인 회신 / guid / 메일 아이디 / 알 수 없음', () => {
  assert.deepEqual(classifyInboundLocalPart('kmail-abc123def456ghi'), { kind: 'campaign', campaignId: 'abc123def456ghi' });
  assert.deepEqual(classifyInboundLocalPart('2601-db80-c342-fd1b-bc4a-2dce-9ed8-04b6'), { kind: 'guid', guid: GUID });
  assert.deepEqual(classifyInboundLocalPart('swift-heron-482'), { kind: 'mail_id', mailId: 'swift-heron-482' });
  assert.deepEqual(classifyInboundLocalPart('Swift-Heron-482'), { kind: 'mail_id', mailId: 'swift-heron-482' });
  assert.deepEqual(classifyInboundLocalPart('a3f09c1e'), { kind: 'mail_id', mailId: 'a3f09c1e' });
  for (const bad of ['', 'a', 'ab', 'a.b', 'a+b', 'a'.repeat(31), '한글']) assert.equal(classifyInboundLocalPart(bad).kind, 'unknown', JSON.stringify(bad));
});

test('guid 주소는 왕복하고(2,000개), 어떤 guid도 메일 아이디로 분류되지 않는다', () => {
  for (let i = 0; i < 2000; i++) {
    const g = randGuid(); const lp = guidToLocalPart(g);
    assert.equal(lp.length, 39); assert.match(lp, GUID_LOCAL_RE);
    assert.deepEqual(classifyInboundLocalPart(lp), { kind: 'guid', guid: g });
  }
});

test('어떤 메일 아이디도 guid나 캠페인 주소로 오분류되지 않는다 — 기본 아이디 5,000개와 최대 길이 30자', () => {
  for (let i = 0; i < 5000; i++) {
    const id = defaultMailIdFromHash(crypto.createHmac('sha256', 'k').update('g' + i).digest('hex'));
    assert.deepEqual(classifyInboundLocalPart(id), { kind: 'mail_id', mailId: id }, id);
  }
  const longest = 'a'.repeat(29) + 'b';
  assert.equal(classifyInboundLocalPart(longest).kind, 'mail_id');
  assert.ok(longest.length <= 30 && GUID_LOCAL_RE.test(longest) === false);
});

test('캠페인 회신 주소(kmail-…)는 메일 아이디로 만들 수 없다(예약어) — 서로 겹치지 않는다', () => {
  for (const id of ['kmail-abc', 'kmail', 'k-mail', 'kmailer1', 'kmail_x']) assert.equal(checkMailId(id).ok, false, id);
});

test('보내는 주소로 쓴 값이 그대로 받는 주소 해석에서 같은 사용자 아이디로 돌아온다(왕복)', () => {
  for (const mailId of ['swift-heron-482', 'my_name', 'a1b', 'a3f09c1e']) {
    const lp = senderLocalPart(GUID, mailId);
    assert.deepEqual(classifyInboundLocalPart(lp), { kind: 'mail_id', mailId });
  }
  const lp = senderLocalPart(GUID, '');                         // 아이디가 없으면 guid 주소 → 받을 때도 guid로
  assert.deepEqual(classifyInboundLocalPart(lp), { kind: 'guid', guid: GUID });
});
