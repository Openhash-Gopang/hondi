import test from 'node:test';
import assert from 'node:assert/strict';
import { _matchUserSearchIntent as m } from '../src/gopang/ui/user-search-intent.js';
test('이름+동사(띄어쓰기 없어도)는 이름을 채워 바로 검색', () => {
  assert.deepEqual(m('김동호출'), { query: '김동' });
  assert.deepEqual(m('김동 호출'), { query: '김동' });
  assert.deepEqual(m('김동님 연결해줘'), { query: '김동' });
  assert.deepEqual(m('홍길동에게 전화'), { query: '홍길동' });
  assert.deepEqual(m('김동연결'), { query: '김동' });
});
test('전화번호·영문 아이디', () => {
  assert.deepEqual(m('010-9880-7170'), { query: '010-9880-7170' });
  assert.deepEqual(m('kimdong 호출'), { query: 'kimdong' });
  assert.deepEqual(m('@kimdong'), { query: '@kimdong' });
});
test('질문·일반 대화·장소는 AI 로', () => {
  assert.equal(m('사용자 검색 방법 알려줘'), null);
  assert.equal(m('오늘 날씨 어때'), null);
  assert.equal(m('병원 예약 연결해줘'), null);
});
test('사용자 검색 같은 명사형은 빈 검색 창', () => {
  assert.deepEqual(m('사용자 검색'), { query: '' });
});
test('직역·기관명은 사람 이름으로 보지 않고 AI(기관·전문가 라우팅)로 넘긴다', () => {
  for (const t of ['법무사 불러줘', '제주시청 불러줘', '변호사 연결해줘', '한림읍사무소 호출', '세무사 불러줘']) assert.equal(m(t), null, t);
  assert.deepEqual(m('김동 불러줘'), { query: '김동' });   // 사람 이름은 그대로
});
