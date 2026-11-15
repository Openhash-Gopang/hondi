/** tests/friend-find.test.mjs — 대화 상대 찾기 입력 해석·검증. 네트워크 없음. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, classifyQuery, publicCard, rateLimitOk } from '../src/worker/friend-find.js';

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
test('classifyQuery: 번호/이메일 ID/빈값/그 밖', () => {
  assert.deepEqual(classifyQuery('010-1111-2222'), { kind: 'phone', e164: '+821011112222' });
  assert.deepEqual(classifyQuery('  @CEO '), { kind: 'id', id: 'ceo' });
  assert.deepEqual(classifyQuery('ceo@naviweb.kr'), { kind: 'id', id: 'ceo' });
  assert.deepEqual(classifyQuery('happy-fox-123'), { kind: 'id', id: 'happy-fox-123' });
  assert.deepEqual(classifyQuery('주피터'), { kind: 'name', name: '주피터' });
  assert.deepEqual(classifyQuery('  김동  '), { kind: 'name', name: '김동' });
  assert.equal(classifyQuery('김'). kind, 'invalid');
  assert.equal(classifyQuery('가'.repeat(21)).kind, 'invalid');
  assert.equal(classifyQuery('a').kind, 'invalid');
  // 2026-11-16: 번호 뒤 8자리 검색 — 국가 무관, 같은 번호가 여럿이면 사용자가 고른다
  assert.deepEqual(classifyQuery('@96627170'), { kind: 'last8', last8: '96627170' });
  assert.deepEqual(classifyQuery('9662-7170'), { kind: 'last8', last8: '96627170' });
  assert.equal(classifyQuery('966271').kind, 'invalid');
  assert.deepEqual(classifyQuery('  '), { kind: 'empty' });
  assert.deepEqual(classifyQuery('@'), { kind: 'empty' });
});
test('공개 카드에는 전화번호·이메일 필드가 없다', () => {
  const c = publicCard({ guid: 'g', handle: 'h', nickname: 'n', e164: '+8210', e164_hash: 'x', e164_last8: '12345678', email: 'a@b', extra: { a: 1 } });
  assert.deepEqual(Object.keys(c).sort(), ['avatar_emoji', 'country_code', 'guid', 'handle', 'mail_id', 'nickname', 'region']);
  assert.equal(publicCard(null), null);
});
test('시간당 한도', () => {
  assert.equal(rateLimitOk(0), true); assert.equal(rateLimitOk(39), true); assert.equal(rateLimitOk(40), false);
});
