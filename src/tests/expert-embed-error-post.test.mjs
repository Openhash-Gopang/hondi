// expert-chat 임베드 — 응답 실패 시 부모에 expert-embed-error 를 즉시 보낸다(안 보내면 부모는 90초 뒤 '연결 실패'로만 본다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../pages/expert-chat.html', import.meta.url), 'utf8');

test('sendTurn 의 catch 가 embed 부모에게 expert-embed-error 를 보낸다', () => {
  const i = src.indexOf('응답 중 오류가 발생했습니다');
  assert.ok(i > 0);
  const tail = src.slice(i, i + 700);
  assert.match(tail, /_embedPost\(\{ type: 'expert-embed-error'/);
});

test('send 를 받으면 expert-embed-ack 를 보내고 ready 에 ack:true 를 싣는다', () => {
  assert.match(src, /expert-embed-send'[^\n]*\n\s*_embedPost\(\{ type: 'expert-embed-ack' \}\)/);
  assert.match(src, /type: 'expert-embed-ready', ack: true/);
});
