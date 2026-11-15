import test from 'node:test';
import assert from 'node:assert/strict';
import { appendTurn, loadThread, listThreads, setSummary, forgetThread, buildResumeContext, counterpartKey, MAX_TURNS, MAX_THREADS } from '../src/gopang/ui/conversation-log.js';

const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, v); }, _m: m }; };
const G = '2601:db80:b50f::1';
const LAW = { kind: 'expert', id: 'SP-LAW-01', name: '변호사' };
const KIM = { kind: 'person', id: '@98807170', name: '김동' };

test('상대 키는 종류+아이디(@·대소문자 무시)', () => {
  assert.equal(counterpartKey(KIM), 'person:98807170');
  assert.equal(counterpartKey({ kind: 'expert', id: 'SP-LAW-01' }), 'expert:sp-law-01');
  assert.equal(counterpartKey({ kind: 'person' }), '');
});

test('턴을 상대별로 따로 저장하고 불러온다', () => {
  const s = mem();
  appendTurn(s, G, LAW, 'user', '임대차 계약 문의', 1000);
  appendTurn(s, G, LAW, 'assistant', '계약 기간이 어떻게 되나요?', 2000);
  appendTurn(s, G, KIM, 'user', '안녕', 3000);
  assert.equal(loadThread(s, G, LAW).turns.length, 2);
  assert.equal(loadThread(s, G, KIM).turns.length, 1);
  assert.equal(loadThread(s, G, { kind: 'expert', id: 'SP-TAX-01' }), null);
  assert.deepEqual(listThreads(s, G).map(t => t.id), ['@98807170', 'SP-LAW-01']);   // 최근 순
});

test('계정(guid)이 다르면 기록이 섞이지 않는다', () => {
  const s = mem();
  appendTurn(s, G, LAW, 'user', 'A의 질문');
  assert.equal(loadThread(s, 'other-guid', LAW), null);
});

test('빈 글·잘못된 역할·상대 없음은 저장하지 않는다', () => {
  const s = mem();
  assert.equal(appendTurn(s, G, LAW, 'user', '   '), false);
  assert.equal(appendTurn(s, G, LAW, 'system', '안녕'), false);
  assert.equal(appendTurn(s, G, {}, 'user', '안녕'), false);
  assert.equal(listThreads(s, G).length, 0);
});

test('턴 수·글자 수·상대 수 상한', () => {
  const s = mem();
  for (let i = 0; i < MAX_TURNS + 10; i++) appendTurn(s, G, LAW, i % 2 ? 'assistant' : 'user', 'm' + i, i);
  const th = loadThread(s, G, LAW);
  assert.equal(th.turns.length, MAX_TURNS);
  assert.equal(th.turns[0].text, 'm10');                                   // 오래된 턴부터 사라짐
  appendTurn(s, G, KIM, 'user', 'x'.repeat(5000));
  assert.ok(loadThread(s, G, KIM).turns[0].text.length <= 2001);
  for (let i = 0; i < MAX_THREADS + 5; i++) appendTurn(s, G, { kind: 'person', id: 'u' + i, name: 'u' + i }, 'user', 'hi', 10000 + i);
  assert.equal(listThreads(s, G).length, MAX_THREADS);
  assert.ok(!listThreads(s, G).some(t => t.id === 'SP-LAW-01'));            // 가장 오래 안 쓴 상대가 밀려남
});

test('재개 글: 기록 없으면 빈 글, 있으면 이어가기 지침 + 최근 대화', () => {
  const s = mem();
  assert.equal(buildResumeContext(loadThread(s, G, LAW)), '');
  appendTurn(s, G, LAW, 'user', '임대차 계약 문의', 1);
  appendTurn(s, G, LAW, 'assistant', '계약 기간이 어떻게 되나요?', 2);
  setSummary(s, G, LAW, '임대차 계약 상담 중, 기간 확인 단계');
  const c = buildResumeContext(loadThread(s, G, LAW));
  assert.ok(c.includes('이전 대화 이어가기') && c.includes('요약: 임대차 계약 상담 중'));
  assert.ok(c.includes('사용자: 임대차 계약 문의') && c.includes('변호사: 계약 기간이 어떻게 되나요?'));
});

test('재개 글은 길이 상한 안에서 오래된 턴부터 버린다', () => {
  const s = mem();
  for (let i = 0; i < 20; i++) appendTurn(s, G, LAW, i % 2 ? 'assistant' : 'user', `턴${i}-` + 'ㅇ'.repeat(300), i);
  const c = buildResumeContext(loadThread(s, G, LAW), { maxTurns: 20, maxChars: 1500 });
  assert.ok(c.length <= 1500);
  assert.ok(c.includes('턴19-') && !c.includes('턴0-'));
});

test('잊기는 그 상대만 지우고, 깨진 저장값은 빈 목록으로 본다', () => {
  const s = mem();
  appendTurn(s, G, LAW, 'user', 'a'); appendTurn(s, G, KIM, 'user', 'b');
  assert.equal(forgetThread(s, G, LAW), true);
  assert.deepEqual(listThreads(s, G).map(t => t.id), ['@98807170']);
  s.setItem('hondi_conv_log_v1:' + G, '{깨진');
  assert.deepEqual(listThreads(s, G), []);
});
