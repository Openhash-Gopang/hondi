import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rememberUser, loadFrequent, matchFrequent, forgetUser } from '../src/gopang/ui/frequent-users.js';

const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, v) }; };

test('저장·갱신·계정별 분리·삭제', () => {
  const s = mem();
  rememberUser(s, 'g1', { handle: '@abcd1234', nickname: '김동' }, 1);
  rememberUser(s, 'g1', { handle: 'abcd1234', nickname: '김동', region: '제주' }, 2, true);
  const l = loadFrequent(s, 'g1');
  assert.equal(l.length, 1);
  assert.equal(l[0].count, 1);
  assert.equal(l[0].region, '제주');
  assert.equal(loadFrequent(s, 'g2').length, 0);
  assert.equal(forgetUser(s, 'g1', 'abcd1234').length, 0);
});

test('이름·아이디 매칭', () => {
  const l = [{ handle: '@abcd1234', nickname: '김동' }, { handle: '@zzzz9999', nickname: '김동민' }];
  assert.equal(matchFrequent('김동', l).user.handle, '@abcd1234');
  assert.equal(matchFrequent('김동님', l).user.handle, '@abcd1234');
  assert.equal(matchFrequent('김동민', l).user.handle, '@zzzz9999');   // 긴 이름 우선
  assert.equal(matchFrequent('김동이랑 채팅 연결해줘', l).user.handle, '@abcd1234');
  assert.equal(matchFrequent('@zzzz9999', l).user.handle, '@zzzz9999');
  assert.equal(matchFrequent('zzzz9999 연결', l)?.user?.handle ?? null, null);   // @ 없는 아이디+동사는 오탐 방지로 무시
});

test('동명이인은 many, 일반 질문은 null', () => {
  const l = [{ handle: '@aaaa1111', nickname: '김동' }, { handle: '@bbbb2222', nickname: '김동' }];
  assert.equal(matchFrequent('김동', l).many.length, 2);
  assert.equal(matchFrequent('김동 씨가 어제 말한 보험 청구는 어떻게 되나요 알려주세요 자세히', l), null);   // 40자 초과
  assert.equal(matchFrequent('오늘 날씨 어때?', l), null);
  assert.equal(matchFrequent('김동', []), null);
});
