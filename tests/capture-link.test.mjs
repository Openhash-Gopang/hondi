import test from 'node:test';
import assert from 'node:assert/strict';
await import('../assets/capture-link.js');   // 브라우저용 스크립트 — globalThis.NaviCapture 로 붙는다

function fakeServer() {
  // capture-server 를 그대로 붙여 PC↔폰 왕복(봉인·개봉·sha 검증)을 시험한다
  return import('../src/worker/capture-server.js').then(({ makeCaptureServer }) => {
    const m = new Map();
    const kv = { get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); } };
    const srv = makeCaptureServer({ env: {}, kv, resolveGuid: async (_e, b) => b.phone_verify_token === 'TOK' ? { ok: true, guid: 'g1' } : { ok: false, status: 401, code: 'TOKEN_INVALID', message: 'x' } });
    return async (url, init) => {
      const op = url.split('/capture/')[1]; const r = await srv[op](JSON.parse(init.body));
      return { status: r.status, json: async () => r.json };
    };
  });
}

test('봉인·개봉 왕복, 다른 키로는 열리지 않는다', async () => {
  const N = globalThis.NaviCapture;
  const a = await N._t.generateKeyPair(), b = await N._t.generateKeyPair();
  const s = await N._t.seal(a.pub, 'data:image/jpeg;base64,AAAA');
  assert.equal(await N._t.open(a.privateKey, s), 'data:image/jpeg;base64,AAAA');
  await assert.rejects(N._t.open(b.privateKey, s));
});

test('PC start ↔ 폰 phoneSession 왕복: 사진 2장 도착, 위변조는 거부', async () => {
  const N = globalThis.NaviCapture;
  globalThis.KAuth = { getToken: () => 'TOK' };
  const f = await fakeServer(); globalThis.fetch = f;
  const got = [], states = [];
  const pc = await N.start({ label: '소장', onPhoto: (u, m) => got.push([u, m.seq]), onState: s => states.push(s.state) });
  const ph = await N.phoneSession(pc.sid);
  assert.equal(ph.label, '소장');
  await ph.send('data:image/jpeg;base64,ONE'); await ph.send('data:image/jpeg;base64,TWO');
  await new Promise(r => setTimeout(r, 4200));
  assert.deepEqual(got.map(x => x[0]), ['data:image/jpeg;base64,ONE', 'data:image/jpeg;base64,TWO']);
  await pc.stop();
  await assert.rejects(N.phoneSession(pc.sid));   // 종료 후 세션 없음
});

test('로그인 없으면 시작 불가', async () => {
  const N = globalThis.NaviCapture;
  globalThis.KAuth = { getToken: () => null };
  await assert.rejects(N.start({}), /LOGIN_REQUIRED/);
});

test('자료 이름 규칙: 소송 서류는 갑 제N호증, 그 밖은 자료 N', () => {
  const N = globalThis.NaviCapture;
  assert.equal(N.defaultLabel('소장 작성 — 대여금 청구', 1), '갑 제1호증');
  assert.equal(N.defaultLabel('준비서면', 3), '갑 제3호증');
  assert.equal(N.defaultLabel('진단서 발급 신청', 2), '자료 2');
  assert.equal(N.defaultLabel('', 1), '자료 1');
});

test('buildNote: 채택한 자료만, 순서·출처 표기 규칙 포함, 없으면 null', () => {
  const N = globalThis.NaviCapture;
  const items = [{ url: 'u1', label: '갑 제1호증', on: true }, { url: 'u2', label: '버릴 것', on: false }, { url: 'u3', label: '갑 제2호증', on: true }];
  const r = N.buildNote(items, '소장');
  assert.deepEqual(r.images, ['u1', 'u3']);
  assert.match(r.note, /1\) 갑 제1호증, 2\) 갑 제2호증/);
  assert.match(r.note, /\(갑 제1호증 참조\)/);
  assert.match(r.note, /고치지 말고 먼저 알려/);
  assert.match(r.note, /새로 만들지/);
  assert.equal(N.buildNote([{ url: 'x', on: false }], '소장'), null);
  assert.match(N.buildNote([{ url: 'a', label: '자료 1', on: true }], '진단서').note, /\(자료 1 참조\)/);
});
