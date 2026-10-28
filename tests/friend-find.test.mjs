/** tests/friend-find.test.mjs — 대화 상대 찾기 입력 해석·검증. 네트워크 없음. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, classifyQuery, validateSearchId, publicCard, rateLimitOk } from '../src/worker/friend-find.js';

test('전화번호 정규화: 한국 번호는 +82 로', () => {
  assert.equal(normalizePhone('010-1234-5678'), '+821012345678');
  assert.equal(normalizePhone('01012345678'), '+821012345678');
  assert.equal(normalizePhone('+82 10 1234 5678'), '+821012345678');
  assert.equal(normalizePhone('+82 010-1234-5678'), '+821012345678');
  assert.equal(normalizePhone('821012345678'), '+821012345678');
  assert.equal(normalizePhone('(02) 123-4567'), '+82021234567'.replace('+820', '+82'));
  assert.equal(normalizePhone('+1 415 555 0100'), '+14155550100');
});
test('번호가 아닌 입력은 null', () => {
  for (const s of ['', 'ceo', 'hong123', '@abc', '12345', '1234567890', '010-abcd', '박지성']) assert.equal(normalizePhone(s), null, s);
});
test('classifyQuery: 번호/아이디/빈값', () => {
  assert.deepEqual(classifyQuery('010-1111-2222'), { kind: 'phone', e164: '+821011112222' });
  assert.deepEqual(classifyQuery('  @CEO '), { kind: 'id', id: 'ceo' });
  assert.deepEqual(classifyQuery('주피터'), { kind: 'id', id: '주피터' });
  assert.deepEqual(classifyQuery('  '), { kind: 'empty' });
  assert.deepEqual(classifyQuery('@'), { kind: 'empty' });
});
test('검색용 아이디 규칙', () => {
  assert.deepEqual(validateSearchId('Gildong_01'), { ok: true, id: 'gildong_01' });
  assert.deepEqual(validateSearchId('@홍길동'), { ok: true, id: '홍길동' });
  for (const bad of ['', 'ab', 'a'.repeat(21), '_abc', 'a b c', 'tid-ceo', 'admin', 'Hondi', '01012345678', 'a@b.com', 'x!y']) assert.equal(validateSearchId(bad).ok, false, bad);
});
test('공개 카드에는 전화번호·이메일 필드가 없다', () => {
  const c = publicCard({ guid: 'g', handle: 'h', nickname: 'n', e164: '+8210', e164_hash: 'x', e164_last8: '12345678', email: 'a@b', extra: { a: 1 } });
  assert.deepEqual(Object.keys(c).sort(), ['avatar_emoji', 'country_code', 'guid', 'handle', 'nickname', 'region']);
  assert.equal(publicCard(null), null);
});
test('시간당 한도', () => {
  assert.equal(rateLimitOk(0), true); assert.equal(rateLimitOk(39), true); assert.equal(rateLimitOk(40), false);
});
