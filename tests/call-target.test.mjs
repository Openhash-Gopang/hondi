import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCallRequest, classifyTarget, matchExpert, matchService, resolveCallTarget, traceLine } from '../src/gopang/ui/call-target.js';
import { buildIndex, lookupCounterpart } from '../src/gopang/ui/counterpart-index.js';

const REG = { 'judicial-scrivener': { label: '법무사 보조 AI' }, lawyer: { label: '변호사' }, 'lawyer-civil': { label: '변호사(민사법)' }, accountant: { label: '공인회계사' }, 'tax-accountant': { label: '세무사' } };
const SVC = [{ id: 'kmail', name: 'K-Mail', url: 'https://x', status: 'active' }, { id: 'klaw', name: 'K-Law', url: 'https://y', status: 'active' }, { id: 'old', name: 'K-Old', url: '', status: 'active' }];

test('호출 문장에서 대상만 뽑는다(호출해 줘·불러줘·연결해 등, 오타 쥐 포함)', () => {
  for (const [t, w] of [['김동 호출해 쥐', '김동'], ['김동 호출해 줘', '김동'], ['법무사 불러줘', '법무사'], ['제주시청 연결해', '제주시청'], ['김동님께 연결해줘', '김동'], ['K-Mail 호출', 'K-Mail'], ['01098807170', '01098807170'], ['@98807170', '@98807170']])
    assert.equal(parseCallRequest(t)?.target, w, t);
});
test('질문·긴 글·일반 말은 호출 요청이 아니다', () => {
  for (const t of ['법무사 비용이 어떻게 돼?', '오늘 날씨 알려줘', '사용자 검색 방법 알려줘', '[INTERNAL: x]', '', '친구 불러줘', '연결해']) assert.equal(parseCallRequest(t), null, t);
});
test('대상 종류 분류', () => {
  assert.equal(classifyTarget('010-9880-7170'), 'phone'); assert.equal(classifyTarget('@kimdong'), 'id');
  assert.equal(classifyTarget('김동'), 'name'); assert.equal(classifyTarget('제주시청'), 'other'); assert.equal(classifyTarget('법무사'), 'name');
});
test('전문가: 직역명 → 가장 상위 페르소나, 별칭(회계사)도', () => {
  assert.equal(matchExpert('법무사', REG).id, 'judicial-scrivener');
  assert.equal(matchExpert('변호사', REG).id, 'lawyer');
  assert.equal(matchExpert('회계사', REG).id, 'accountant');
  assert.equal(matchExpert('김동', REG), null);
});
test('K-서비스: 이름·id 정확히 같고 활성·url 있는 것만', () => {
  assert.equal(matchService('k mail', SVC).id, 'kmail'); assert.equal(matchService('KLAW', SVC).id, 'klaw');
  assert.equal(matchService('K-Old', SVC), null); assert.equal(matchService('메일', SVC), null);
});
const IDX = buildIndex([['제주시청', 'gov1', 'institution'], ['제주특별자치도청', 'gov2', 'institution'], ['김동', 'gov9', 'org']]);
const mk = (extra = {}) => ({ expertRegistry: REG, services: SVC, friendsLocal: () => [], institutionIndex: (t, o) => lookupCounterpart(IDX, t, o),
  findFriend: async (q) => (q === '홍길동' ? { ok: true, found: true, user: { guid: 'g1', handle: '@hong', nickname: '홍길동' } } : { ok: true, found: false }), ...extra });
test('검색 순서: 친구 → 전문가 → 기관 → 서비스 → 사용자, 앞에서 찾으면 멈춘다', async () => {
  let r = await resolveCallTarget('김동 호출해 쥐', mk({ friendsLocal: (t) => (t === '김동' ? [{ guid: 'f1', handle: '@98807170', nickname: '김동' }] : []) }));
  assert.deepEqual(r.trace.map(t => t.step), ['friends']); assert.equal(r.candidates[0].type, 'person');
  r = await resolveCallTarget('법무사 불러줘', mk()); assert.deepEqual(r.trace.map(t => t.step), ['friends', 'expert']); assert.equal(r.candidates[0].type, 'expert');
  r = await resolveCallTarget('제주시청 연결해', mk()); assert.deepEqual(r.trace.map(t => t.step), ['expert', 'institution']); assert.equal(r.candidates[0].id, 'gov1');
  r = await resolveCallTarget('K-Mail 호출', mk()); assert.deepEqual(r.trace.map(t => t.step), ['friends', 'expert', 'institution', 'service']); assert.equal(r.candidates[0].type, 'service');
  r = await resolveCallTarget('홍길동 불러줘', mk()); assert.deepEqual(r.trace.map(t => t.step), ['friends', 'expert', 'institution', 'service', 'users']); assert.equal(r.candidates[0].user.guid, 'g1');
  r = await resolveCallTarget('김철수 불러줘', mk()); assert.equal(r.candidates.length, 0);
  assert.equal(await resolveCallTarget('오늘 날씨', mk()), null);
});
test('사람 이름처럼 보이는 말은 기관 이름과 정확히 같을 때만 기관으로 본다(부분 일치로 가로채지 않음)', async () => {
  let r = await resolveCallTarget('제주시 불러줘', mk());   // 기관명 부분 일치는 '기관처럼 보이는 말'에서만
  assert.ok(r.candidates.length === 0 || r.candidates[0].type !== 'person');
  r = await resolveCallTarget('제주특별자치도 연결해', mk()); assert.equal(r.candidates[0].id, 'gov2');
});
test('찾기 실패(서버 오류)는 후보 없음 + error, 그래도 trace 는 남는다', async () => {
  const r = await resolveCallTarget('홍길동 호출', mk({ findFriend: async () => { throw new Error('401'); } }));
  assert.equal(r.candidates.length, 0); assert.equal(r.error, '401'); assert.equal(r.trace.at(-1).step, 'users');
});
test('찾은 순서 한 줄', async () => {
  const r = await resolveCallTarget('홍길동 불러줘', mk());
  assert.match(traceLine(r.trace), /^내 친구 ✗ → 전문가 ✗ → 기관 ✗ → 서비스 ✗ → 나비웹 사용자 ✓ \(\d+\.\d\d초\)$/);
});
