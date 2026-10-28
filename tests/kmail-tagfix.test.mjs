import test from 'node:test';
import assert from 'node:assert/strict';
import { trimTrailingAfterTag, findJsonEnd } from '../src/worker/kmail-tagfix.js';

test('태그 뒤 설명 문장을 잘라낸다', () => {
  const r = trimTrailingAfterTag('찾아볼게요.\nKMAIL_SEARCH_CONTACTS {"query":"서울대 경제학과"}\n\n검색 결과를 기다려 주세요.');
  assert.equal(r, '찾아볼게요.\nKMAIL_SEARCH_CONTACTS {"query":"서울대 경제학과"}');
});
test('코드펜스·닫는 괄호 군더더기 제거', () => {
  assert.equal(trimTrailingAfterTag('KMAIL_SAVE_CONTACTS {"candidates":[{"name":"a"}]}\n```'), 'KMAIL_SAVE_CONTACTS {"candidates":[{"name":"a"}]}');
});
test('문자열 안의 중괄호는 무시', () => {
  const t = 'KMAIL_SEND_CAMPAIGN {"body":"안녕 {이름}님 }"} 끝';
  assert.equal(trimTrailingAfterTag(t), 'KMAIL_SEND_CAMPAIGN {"body":"안녕 {이름}님 }"}');
});
test('잘린(괄호 미완결) 응답과 태그 없는 응답은 그대로', () => {
  const cut = 'KMAIL_SAVE_CONTACTS {"candidates":[{"name":"a"},{"name":';
  assert.equal(trimTrailingAfterTag(cut), cut);
  assert.equal(trimTrailingAfterTag('그냥 문장입니다.'), '그냥 문장입니다.');
  assert.equal(findJsonEnd(cut, cut.indexOf('{')), -1);
});
test('이미 깨끗하면 변화 없음', () => {
  const ok = '확인했습니다.\nKMAIL_LOOKUP_CONTACTS {"q":"김"}';
  assert.equal(trimTrailingAfterTag(ok), ok);
});
