import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as B from '../src/gopang/pdv/backup.js';
import { makePdvBackupServer, makePocketBasePdvBackupStore, MAX_OBJECTS } from '../src/worker/pdv-backup-handler.js';

const FAST = { iterations: 1000 };
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const recs = [{ ts: 1, what: '소유권보존등기 상담' }, { ts: 2, what: '한글 😀 내용' }];

function memStore() {
  const m = new Map(); const k = (g, n) => g + '\u0000' + n;
  return {
    m,
    async get(g, n) { return m.get(k(g, n)) || null; },
    async put(g, n, v) { m.set(k(g, n), v); },
    async list(g, p) { return [...m.keys()].filter((x) => x.startsWith(g + '\u0000')).map((x) => x.split('\u0000')[1]).filter((n) => n.startsWith(p)); },
    async remove(g, n) { m.delete(k(g, n)); },
    async count(g) { return [...m.keys()].filter((x) => x.startsWith(g + '\u0000')).length; },
  };
}
// 인증: signature === 'sig:'+guid+':'+ts+':'+op 이면 통과 (서명 검증 자체는 worker 의 _kAuth 가 담당)
const makeServer = (store) => makePdvBackupServer({
  store, now: () => 123,
  auth: async (b) => (b.guid && b.signature === `sig:${b.guid}:${b.ts}` ? { ok: true, guid: b.guid } : { ok: false, status: 403, code: 'AUTH_REQUIRED', message: '본인 인증 필요' }),
});
const wallet = (guid) => ({ guid, publicKeyB64u: 'PK', signPayload: async (msg) => 'sig:' + guid + ':' + msg.split(':').pop() });
const fetchTo = (srv) => async (url, init) => {
  const op = url.split('/').pop(); const r = await srv[op](JSON.parse(init.body));
  return { ok: r.status < 400, status: r.status, json: async () => r.json };
};

test('서버: 인증 없으면 거절, 본인 guid 영역만 읽고 쓴다', async () => {
  const st = memStore(); const srv = makeServer(st);
  assert.equal((await srv.put({ guid: 'usr1', ts: '1', signature: 'bad', name: 'pdv/header.json', data: 'AAAA' })).status, 403);
  assert.equal((await srv.put({ guid: 'usr1', ts: '1', signature: 'sig:usr1:1', name: 'pdv/header.json', data: 'AAAA' })).status, 200);
  assert.equal((await srv.get({ guid: 'usr2', ts: '1', signature: 'sig:usr2:1', name: 'pdv/header.json' })).status, 404);
  assert.equal((await srv.get({ guid: 'usr1', ts: '1', signature: 'sig:usr1:1', name: 'pdv/header.json' })).json.data, 'AAAA');
});

test('서버: 이름·본문 검증과 한도', async () => {
  const st = memStore(); const srv = makeServer(st); const a = { guid: 'usr1', ts: '1', signature: 'sig:usr1:1' };
  assert.equal((await srv.put({ ...a, name: "pdv/x' || 1=1", data: 'AAAA' })).status, 400);
  assert.equal((await srv.put({ ...a, name: '../x', data: 'AAAA' })).status, 400);
  assert.equal((await srv.put({ ...a, name: 'pdv/a.bin', data: '<script>' })).status, 400);
  assert.equal((await srv.put({ ...a, name: 'pdv/a.bin', data: 'A'.repeat(8_000_001) })).status, 413);
  for (let i = 0; i < MAX_OBJECTS; i++) st.m.set('usr1\u0000pdv/o' + i, { data: 'AA' });
  assert.equal((await srv.put({ ...a, name: 'pdv/new.bin', data: 'AAAA' })).status, 409);
  assert.equal((await srv.put({ ...a, name: 'pdv/o1', data: 'BBBB' })).status, 200); // 덮어쓰기는 허용
});

test('폰 백업 → L1(서버) → PC 복원: 어댑터·서버·암호화 전 구간, 서버는 평문을 못 본다', async () => {
  const st = memStore(); const srv = makeServer(st); const f = fetchTo(srv);
  const phone = new B.HondiL1Adapter({ worker: 'https://w', wallet: wallet('usr1'), fetchImpl: f });
  const { dek } = await B.initBackup(phone, '귤밭에서 보낸 가을 오후', FAST);
  await B.backupSnapshot(phone, dek, recs, { now: 5 });
  const stored = JSON.stringify([...st.m.values()]);
  assert.ok(!stored.includes('소유권보존등기') && !stored.includes('귤밭에서'));
  const pc = new B.HondiL1Adapter({ worker: 'https://w', wallet: wallet('usr1'), fetchImpl: f });
  const r = await B.restoreLatest(pc, '귤밭에서 보낸 가을 오후');
  assert.deepEqual(r.records, recs);
  await assert.rejects(B.restoreLatest(pc, '틀린 복구 문구 입니다 하하'));
  const other = new B.HondiL1Adapter({ worker: 'https://w', wallet: wallet('usr2'), fetchImpl: f });
  await assert.rejects(B.restoreLatest(other, '귤밭에서 보낸 가을 오후')); // 다른 사용자는 못 읽음
});

test('PocketBase 저장소: 필터 이스케이프와 upsert', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: decodeURIComponent(url), method: init.method || 'GET', body: init.body });
    if (!init.method) return { ok: true, json: async () => ({ items: [{ id: 'r1' }], totalItems: 1, totalPages: 1 }) };
    return { ok: true, json: async () => ({}) };
  };
  const s = makePocketBasePdvBackupStore({ base: 'https://l1', getToken: async () => 'T', fetchImpl });
  await s.put("g'1", 'pdv/a.bin', { data: 'AA', size: 2, ts: 1 });
  assert.ok(calls[0].url.includes("guid='g\\'1'"));
  assert.equal(calls[1].method, 'PATCH');
  assert.ok(calls[1].url.endsWith('/records/r1'));
});

test('연결: worker 라우트·마이그레이션·화면 기본값(L1)·PC 복원 버튼', () => {
  const w = read('worker.js'), h = read('pdv.html');
  assert.match(w, /\/pdv\\\/backup\\\/\(put\|get\|list\|remove\)/);
  assert.match(w, /sigMsg: `pdv-backup-\$\{op\}:\$\{b\.guid\}:\$\{b\.ts\}`/);
  assert.match(read('pb_migrations/1795600001_created_pdv_backups.js'), /"name": "pdv_backups"/);
  assert.match(h, /name="pdv-cloud" value="l1" checked/);
  assert.match(h, /id="btn-cl-restore"/);
  assert.match(h, /new B\.HondiL1Adapter\(\{ worker: WORKER, wallet \}\)/);
  assert.match(h, /new B\.ParUrlAdapter\(u\)/);
});

test('기본 fetch 는 어댑터의 메서드로 불려도 Illegal invocation 이 나지 않는다', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = function () { if (this !== globalThis && this !== undefined) throw new TypeError('Illegal invocation'); return Promise.resolve({ ok: true, json: async () => ({ ok: true, names: ['pdv/a'] }), arrayBuffer: async () => new ArrayBuffer(1) }); };
  try {
    assert.deepEqual(await new B.HondiL1Adapter({ worker: 'https://w', wallet: wallet('usr1') }).list(), ['pdv/a']);
    assert.equal((await new B.ParUrlAdapter('https://x/o/').get('pdv/a')).length, 1);
  } finally { globalThis.fetch = orig; }
});
