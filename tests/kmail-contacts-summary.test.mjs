import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContactsNote, sumRegisteredInMessages, summarizeContacts, buildSummaryContext, describeLookupScope } from '../src/worker/kmail-contacts-summary.js';

test('현황 한 줄과 안내가 들어간다', () => {
  const n = buildContactsNote({ total: 310, confirmed: 300, pending: 10 });
  assert.match(n, /전체 310건 \(승인됨 300건, 승인 대기 10건\)/);
  assert.match(n, /KMAIL_CONTACTS_SUMMARY/);
  assert.doesNotMatch(n, /대화 이력 안내/);
});
test('건수 조회 실패 시 숫자를 말하지 말라고 안내', () => {
  assert.match(buildContactsNote({}), /조회에 실패/);
});
test('생략된 앞부분의 등록 합계', () => {
  const msgs = [
    { role: 'assistant', content: '좋아요\n✅ 19건 주소록에 바로 등록됨' },
    { role: 'user', content: '✅ 5건 등록' },
    { role: 'assistant', content: '✅ 22건 주소록에 바로 등록됨 (이미 있던 3건은 중복)' },
    { role: 'assistant', content: '✅ 승인 대기 3건' },
  ];
  assert.equal(sumRegisteredInMessages(msgs), 41);
  const n = buildContactsNote({ total: 1, confirmed: 1, pending: 0, omittedCount: 12, omittedRegistered: 41 });
  assert.match(n, /앞부분 12개/); assert.match(n, /합계 41건/);
});
test('소속·카테고리 집계, 거부 제외, 최근 24시간', () => {
  const now = Date.parse('2026-10-28T12:00:00Z');
  const s = summarizeContacts([
    { org: '연세대학교', category: 'P', status: 'confirmed', created: '2026-10-28 10:00:00.000Z' },
    { org: '연세대학교', category: 'P', status: 'confirmed', created: '2026-10-20 10:00:00.000Z' },
    { org: '고려대학교', category: '', status: 'confirmed', created: '2026-10-20 10:00:00.000Z' },
    { org: '서울대학교', category: 'P', status: 'rejected', created: '2026-10-28 10:00:00.000Z' },
  ], now);
  assert.deepEqual(s.orgs, [{ name: '연세대학교', count: 2 }, { name: '고려대학교', count: 1 }]);
  assert.equal(s.added24h, 1);
  assert.deepEqual(s.categories[1], { name: '(미분류)', count: 1 });
  assert.match(buildSummaryContext({ ...s, total: 4, confirmed: 3, pending: 0, rejected: 1 }), /전체 4건/);
});
test('조회 범위 설명은 전체 건수가 아님을 밝힌다', () => {
  assert.match(describeLookupScope({ q: '경희대' }), /검색어 '경희대'.*전체 건수가 아님/);
  assert.match(describeLookupScope({}), /조건 없음/);
});
