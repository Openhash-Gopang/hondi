import test from 'node:test';
import assert from 'node:assert/strict';
import { guardReply, GUARD_MESSAGE } from '../src/gopang/ai/reply-guard.js';

test('거짓 실행 보고·나중에 알림 약속을 막는다', () => {
  for (const t of [
    '안녕하세요, 김동 님 호출 요청을 다시 넣었습니다. 검색 결과가 확인되는 대로 바로 알려드리겠습니다.',
    '이번 요청은 번호 010-9880-7170으로 호출하겠습니다. 다시 요청합니다.',
    '상대방을 채팅으로 초대하겠습니다.',
    '알림을 보냈습니다.',
  ]) { const r = guardReply(t); assert.equal(r.blocked, true, t); assert.equal(r.text, GUARD_MESSAGE); }
});
test('실행 태그가 있거나 평범한 답은 통과', () => {
  assert.equal(guardReply('[SEARCH: query=@98807170, type=user]').blocked, false);
  assert.equal(guardReply('상대의 @아이디나 전화번호를 입력해 주세요.').blocked, false);
  assert.equal(guardReply('모릅니다.').blocked, false);
  assert.equal(guardReply('').blocked, false);
});
