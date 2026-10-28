import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAddressList, validateMailRecipients } from '../src/worker/kmail-recipients.js';

test('문자열·이름<주소>·쉼표·세미콜론 목록을 파싱', () => {
  const r = parseAddressList('A@X.com, 홍길동 <b@y.com>; c@z.com\nd@w.kr');
  assert.deepEqual(r.emails, ['a@x.com', 'b@y.com', 'c@z.com', 'd@w.kr']);
  assert.deepEqual(r.bad, []);
});
test('배열({email})과 잘못된 주소', () => {
  const r = parseAddressList([{ email: 'a@x.com' }, 'nope', 'b@y.com']);
  assert.deepEqual(r.emails, ['a@x.com', 'b@y.com']);
  assert.deepEqual(r.bad, ['nope']);
});
test('중복은 받는 사람 > 참조 > 숨은참조 순으로 우선', () => {
  const r = validateMailRecipients({ to: 'a@x.com', cc: ['a@x.com', 'b@x.com'], bcc: ['b@x.com', 'c@x.com'] });
  assert.equal(r.ok, true);
  assert.deepEqual([r.to, r.cc, r.bcc], [['a@x.com'], ['b@x.com'], ['c@x.com']]);
});
test('받는 사람 없음·잘못된 주소·50명 초과는 거절', () => {
  assert.equal(validateMailRecipients({ to: '', cc: 'a@x.com' }).ok, false);
  assert.equal(validateMailRecipients({ to: 'bad' }).ok, false);
  const many = Array.from({ length: 51 }, (_, i) => `u${i}@x.com`);
  assert.equal(validateMailRecipients({ to: many }).ok, false);
  assert.equal(validateMailRecipients({ to: many.slice(0, 50) }).ok, true);
});
