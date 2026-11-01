import test from 'node:test';
import assert from 'node:assert/strict';
await import('../embed-delegate.js');
const E = globalThis.EmbedDelegate;
const PARENT = {}; const OTHER = {};
const mk = (opts = {}) => { const sent = []; const d = E.create({ parent: PARENT, post: (m, o) => sent.push([m, o]), ...opts }); return { d, sent }; };
const ev = (data, origin = 'https://mail.hondi.net', source = PARENT) => ({ data, origin, source });

test('위임을 알리기 전에는 보내지 않는다(undefined → 호출자가 기존 처리)', () => {
  const { d, sent } = mk(); assert.equal(d.active(), false); assert.equal(d.send('안녕'), undefined); assert.equal(sent.length, 0);
});
test('호스트가 위임을 알리면 보내고, 응답이 오면 문장을 돌려준다', async () => {
  const { d, sent } = mk(); d.onMessage(ev({ type: 'hondi-embed-host', v: 1, ai: 'delegate' }));
  assert.equal(d.active(), true);
  const p = d.send('신청 사유를 고쳐 줘');
  assert.equal(sent[0][0].type, 'hondi-embed-ai'); assert.equal(sent[0][1], 'https://mail.hondi.net');
  d.onMessage(ev({ type: 'hondi-embed-ai-reply', id: sent[0][0].id, text: '고쳤습니다' }));
  assert.equal(await p, '고쳤습니다');
});
test('부모가 아니거나 허용 출처가 아니면 무시한다', () => {
  const { d } = mk();
  assert.equal(d.onMessage(ev({ type: 'hondi-embed-host', ai: 'delegate' }, 'https://evil.example')), false);
  assert.equal(d.onMessage(ev({ type: 'hondi-embed-host', ai: 'delegate' }, 'https://mail.hondi.net', OTHER)), false);
  assert.equal(d.active(), false);
  d.onMessage(ev({ type: 'hondi-embed-host', ai: 'delegate' }, 'https://naviweb.kr')); assert.equal(d.active(), true);
});
test('위임 해제, 엉뚱한 id 응답 무시, 시간 초과는 null, 길이 제한', async () => {
  const { d, sent } = mk({ waitMs: 20 }); d.onMessage(ev({ type: 'hondi-embed-host', ai: 'delegate' }));
  const p = d.send('x'.repeat(5000)); assert.equal(sent[0][0].text.length, 2000);
  d.onMessage(ev({ type: 'hondi-embed-ai-reply', id: 'zzz', text: 'no' }));
  assert.equal(await p, null);
  assert.equal(d.send('   '), undefined);
  d.onMessage(ev({ type: 'hondi-embed-host', ai: '' })); assert.equal(d.active(), false);
});
test('note 는 콜백으로 전달된다', () => {
  const { d } = mk(); let got = ''; d.onNote(t => { got = t; });
  d.onMessage(ev({ type: 'hondi-embed-ai-note', text: '되돌렸습니다' })); assert.equal(got, '되돌렸습니다');
});
