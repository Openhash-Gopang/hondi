import test from 'node:test';
import assert from 'node:assert/strict';
import { KMAIL_DOMAIN, isKmailAddress, senderAddress, classifyInboundLocalPart } from '../worker/kmail-address.js';

test('보내는 주소는 naviweb.kr', () => {
  assert.equal(KMAIL_DOMAIN, 'naviweb.kr');
  assert.equal(senderAddress('aaaa:bbbb', 'jupiter'), 'jupiter@naviweb.kr');
});
test('받을 때는 naviweb.kr 과 옛 hondi.kr 모두 K-Mail 주소', () => {
  assert.ok(isKmailAddress('jupiter@naviweb.kr'));
  assert.ok(isKmailAddress('Jupiter@HONDI.KR'));
  assert.ok(isKmailAddress(' kmail-abc@hondi.kr '));
  assert.ok(!isKmailAddress('x@gmail.com'));
  assert.ok(!isKmailAddress('x@naviweb.kr.evil.com'));
  assert.ok(!isKmailAddress('x@hondi.net'));
  assert.ok(!isKmailAddress(''));
});
test('받는 주소 로컬파트 해석은 도메인과 무관하다', () => {
  assert.equal(classifyInboundLocalPart('kmail-abc123').kind, 'campaign');
  assert.equal(classifyInboundLocalPart('jupiter').kind, 'mail_id');
});
