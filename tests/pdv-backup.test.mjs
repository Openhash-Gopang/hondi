import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../src/gopang/pdv/backup.js';

const FAST = { iterations: 1000 };
const recs = [{ ts: 1, what: '소유권보존등기 상담', serviceId: 'klaw' }, { ts: 2, what: '한글 😀 내용' }];

test('복구 문구 강도: 짧음/숫자뿐/반복/연속 거절, 정상 문구 허용', () => {
  assert.equal(B.checkPhrase('짧은문구').ok, false);
  assert.equal(B.checkPhrase('123456789012').ok, false);
  assert.equal(B.checkPhrase('aaaaaaaaaaaa').ok, false);
  assert.equal(B.checkPhrase('abcdefghijkl').ok, false);
  assert.equal(B.checkPhrase('귤밭에서 보낸 가을 오후').ok, true);
  assert.equal(B.checkPhrase('  ').ok, false);
});

test('백업→복구 왕복, 저장소에는 평문이 없다', async () => {
  const ad = new B.MemoryAdapter();
  const { dek } = await B.initBackup(ad, '귤밭에서 보낸 가을 오후', FAST);
  const r = await B.backupSnapshot(ad, dek, recs, { now: 1000 });
  assert.equal(r.count, 2);
  const raw = Buffer.from(await ad.get(r.key)).toString();
  assert.ok(!raw.includes('소유권') && !raw.includes('klaw'));
  const hdr = Buffer.from(await ad.get(B.HEADER_KEY)).toString();
  assert.ok(!hdr.includes('귤밭'));
  const out = await B.restoreLatest(ad, '귤밭에서 보낸 가을 오후');
  assert.deepEqual(out.records, recs);
});

test('틀린 문구는 거절, 최신 스냅샷을 고른다', async () => {
  const ad = new B.MemoryAdapter();
  const { dek } = await B.initBackup(ad, '귤밭에서 보낸 가을 오후', FAST);
  await B.backupSnapshot(ad, dek, [recs[0]], { now: 1 });
  await B.backupSnapshot(ad, dek, recs, { now: 2 });
  await assert.rejects(B.restoreLatest(ad, '다른 문구 다른 문구 다른'), /맞지 않/);
  assert.equal((await B.restoreLatest(ad, '귤밭에서 보낸 가을 오후')).count, 2);
});

test('문구 변경: 본문은 그대로, 새 문구로만 열린다', async () => {
  const ad = new B.MemoryAdapter();
  const { dek, header } = await B.initBackup(ad, '귤밭에서 보낸 가을 오후', FAST);
  await B.backupSnapshot(ad, dek, recs, { now: 5 });
  const nh = await B.changePhrase(header, '귤밭에서 보낸 가을 오후', '한라산 아래 겨울 아침빛');
  await ad.put(B.HEADER_KEY, new TextEncoder().encode(JSON.stringify(nh)));
  await assert.rejects(B.restoreLatest(ad, '귤밭에서 보낸 가을 오후'));
  assert.equal((await B.restoreLatest(ad, '한라산 아래 겨울 아침빛')).count, 2);
  await assert.rejects(B.changePhrase(nh, '한라산 아래 겨울 아침빛', '짧다'), /12자/);
});

test('본문 변조·다른 이름 바꿔치기는 복호화 실패(AAD)', async () => {
  const ad = new B.MemoryAdapter();
  const { dek } = await B.initBackup(ad, '귤밭에서 보낸 가을 오후', FAST);
  const a = await B.backupSnapshot(ad, dek, recs, { now: 1 });
  await assert.rejects(B.decryptObject(dek, 'pdv/snap-other.bin', await ad.get(a.key)));
});

test('PAR 어댑터: PUT/GET/인덱스 경로', async () => {
  const store = new Map();
  const f = async (url, o = {}) => {
    const m = o.method || 'GET';
    if (m === 'PUT') { store.set(url, new Uint8Array(o.body)); return { ok: true, status: 200 }; }
    if (m === 'DELETE') { store.delete(url); return { ok: true, status: 204 }; }
    const v = store.get(url); return v ? { ok: true, status: 200, arrayBuffer: async () => v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) } : { ok: false, status: 404 };
  };
  const ad = new B.ParUrlAdapter('https://objectstorage.ap-chuncheon-1.oraclecloud.com/p/TOK/n/ns/b/bk/o', f);
  const { dek } = await B.initBackup(ad, '귤밭에서 보낸 가을 오후', FAST);
  await B.backupSnapshot(ad, dek, recs, { now: 9 });
  assert.ok([...store.keys()].every((u) => u.startsWith('https://objectstorage.ap-chuncheon-1.oraclecloud.com/p/TOK/n/ns/b/bk/o/pdv/')));
  assert.equal((await B.restoreLatest(ad, '귤밭에서 보낸 가을 오후')).count, 2);
});
