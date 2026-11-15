import test from 'node:test';
import assert from 'node:assert/strict';
import { isStageTurn, stripStageTurns } from '../src/gopang/ui/stage-filter.js';
test('단계 SP 자기소개 턴과 그 질문을 지운다', () => {
  const h = [{ role: 'user', content: '안녕' }, { role: 'assistant', content: '안녕하세요, 주피터님. K-Intent입니다. 어떤 일을 도와드릴까요?' },
    { role: 'user', content: '너는 누구?' }, { role: 'assistant', content: '저는 K-Intent입니다. 이용자의 요청에서…' },
    { role: 'user', content: '날씨' }, { role: 'assistant', content: '🔄 요청 파악(K-Intent) 단계로 이동 중…' }, { role: 'user', content: '맛집' }, { role: 'assistant', content: '제주 맛집은…' }];
  const r = stripStageTurns(h); assert.deepEqual(r.map(m => m.content), ['제주 맛집은…'].length ? ['맛집', '제주 맛집은…'] : []);
});
test('일반 대화·나비 자기소개는 남긴다', () => {
  const h = [{ role: 'user', content: '누구야' }, { role: 'assistant', content: '저는 나비, 나만의 AI 비서입니다.' }, { role: 'assistant', content: 'K-Mail은 메일 서비스입니다.' }];
  assert.equal(stripStageTurns(h).length, 3); assert.equal(isStageTurn({ role: 'user', content: 'K-Intent입니다' }), false);
});
