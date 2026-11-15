import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCallRequest, classifyTarget, matchExpert, matchService, resolveCallTarget } from '../src/gopang/ui/call-target.js';

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
test('검색 순서: 전문가 → 서비스 → 사람 → 기관, 못 찾으면 후보 없음', async () => {
  const calls = [];
  const deps = { expertRegistry: REG, services: SVC,
    findFriend: async (q) => { calls.push('friend:' + q); return q === '김동' ? { ok: true, found: true, user: { guid: 'g1', handle: '@98807170', nickname: '김동' } } : { ok: true, found: false }; },
    searchEntities: async (q) => { calls.push('ent:' + q); return q === '제주시청' ? [{ entity_type: 'institution', primary_guid: 'gov1', name: '제주시청' }, { entity_type: 'person', primary_guid: 'p' }] : []; } };
  let r = await resolveCallTarget('법무사 불러줘', deps); assert.equal(r.candidates[0].type, 'expert'); assert.deepEqual(calls, []);
  r = await resolveCallTarget('K-Mail 호출', deps); assert.equal(r.candidates[0].type, 'service'); assert.deepEqual(calls, []);
  r = await resolveCallTarget('김동 호출해 쥐', deps); assert.equal(r.candidates[0].type, 'person'); assert.equal(r.candidates[0].user.guid, 'g1');
  r = await resolveCallTarget('제주시청 연결해', deps); assert.deepEqual(r.candidates.map(c => c.type), ['institution']);
  r = await resolveCallTarget('홍길동 불러줘', deps); assert.equal(r.candidates.length, 0);   // 사람·기관 모두 없음
  assert.equal(await resolveCallTarget('오늘 날씨', deps), null);
});
test('찾기 실패(서버 오류)는 후보 없음 + error', async () => {
  const deps = { expertRegistry: {}, services: [], findFriend: async () => { throw new Error('401'); }, searchEntities: async () => [] };
  const r = await resolveCallTarget('김동 호출', deps); assert.equal(r.candidates.length, 0); assert.equal(r.error, '401');
});
