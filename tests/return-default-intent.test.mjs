import assert from 'node:assert';
import { matchReturnToDefaultIntent as m } from '../src/gopang/ai/return-default-intent.js';
for (const t of ['나비로 돌아가','나만의 AI 비서로 돌아가줘','처음으로','기본으로','비서로 복귀','원래대로','그림자 AI로 돌아가','K-Compose 그만 나비로 돌아가']) assert.ok(m(t), t);
for (const t of ['','안녕','서울 날씨 알려줘','돌아가는 방법 알려줘','김동 불러줘','세금 신고 어떻게 해','나비 설명해줘']) assert.ok(!m(t), t);
console.log('ok');
