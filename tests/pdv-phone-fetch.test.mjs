import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as F from '../src/gopang/pdv/phone-fetch.js';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const seal = async (plain) => ({ ct: Buffer.from(plain, 'utf8').toString('base64') });      // 테스트용 가짜 봉투
const open = async (s) => Buffer.from(s.ct, 'base64').toString('utf8');

test('splitText: 조각 수·합치면 원문', () => {
  assert.deepEqual(F.splitText('abcdef', 4), ['abcd', 'ef']);
  assert.deepEqual(F.splitText('', 4), ['']);
  const t = 'x'.repeat(250001); assert.equal(F.splitText(t, 90000).join(''), t);
});

test('폰→PC 왕복: 여러 조각·한글·이모지가 그대로', async () => {
  const records = Array.from({ length: 300 }, (_, i) => ({ ts: i, what: '소유권보존등기 상담 😀 ' + 'ㄱ'.repeat(200) }));
  const store = new Map(); let delivered = null;
  await F.phoneRespond({
    records, seal, partChars: 5000,
    postPart: async (i, total, sealed) => { store.set(i, sealed); },
    deliver: async (info) => { delivered = info; },
  });
  assert.ok(delivered.partCount > 3 && delivered.count === 300);
  const got = await F.pcCollect({ partCount: delivered.partCount, getPart: async (i) => store.get(i), open });
  assert.deepEqual(got.records, records);
});

test('조각 수 한도 초과는 폰에서 거절, PC 는 잘못된 형식 거절', async () => {
  await assert.rejects(F.phoneRespond({ records: [{ a: 'x'.repeat(300) }], seal, partChars: 1, postPart: async () => {}, deliver: async () => {} }), /너무 커서/);
  await assert.rejects(F.pcCollect({ partCount: 0, getPart: async () => ({}), open }), /조각 수/);
  await assert.rejects(F.pcCollect({ partCount: 1, getPart: async () => ({ ct: Buffer.from('{"v":2}').toString('base64') }), open }), /형식/);
});

test('requestFromPhone: init→poll(대기→전달)→part, 만료·시간 초과는 오류', async () => {
  const records = [{ ts: 1, what: '문서' }];
  const parts = new Map(); let polls = 0, inited = null;
  const fetchImpl = async (url, o = {}) => {
    const u = new URL(url), json = (b, ok = true) => ({ ok, status: ok ? 200 : 404, json: async () => b });
    if (u.pathname.endsWith('/init')) { inited = JSON.parse(o.body); return json({ ok: true, sessionId: 'S1', pushSentToMobile: true }); }
    if (u.pathname.endsWith('/poll')) { polls++; if (polls < 3) return json({ ok: true, state: 'pending' });
      await F.phoneRespond({ records, seal, postPart: async (i, t, s) => parts.set(i, s), deliver: async () => {} });
      return json({ ok: true, state: 'delivered', partCount: parts.size }); }
    if (u.pathname.endsWith('/part')) { const i = Number(u.searchParams.get('i')); const s = parts.get(i); parts.delete(i); return s ? json({ ok: true, sealed: s }) : json({ ok: false, error: 'PART_NOT_FOUND' }, false); }
  };
  const states = [];
  const out = await F.requestFromPhone({ worker: 'https://w', e164: '+821012345678', keyPair: { publicKeyB64u: 'PUB', privateKey: 'PRIV' }, openWithKey: (s) => open(s), fetchImpl, onState: (s) => states.push(s), sleep: async () => {}, });
  assert.deepEqual(out.records, records);
  assert.equal(inited.purpose, 'pdv_fetch'); assert.equal(inited.pcPubKeyB64u, 'PUB');
  assert.ok(states.includes('pushed') && states.includes('waiting') && states.includes('receiving'));
  assert.equal(parts.size, 0, '가져간 조각은 서버에서 지워진다');

  const expired = async (url) => url.includes('/init') ? { ok: true, status: 200, json: async () => ({ ok: true, sessionId: 'S2' }) } : { ok: true, status: 200, json: async () => ({ ok: true, state: 'expired' }) };
  await assert.rejects(F.requestFromPhone({ worker: 'w', e164: '+82', keyPair: { publicKeyB64u: 'P', privateKey: 'K' }, openWithKey: open, fetchImpl: expired, sleep: async () => {} }), /만료/);
  let t = 0; const realNow = Date.now; Date.now = () => (t += 50000);
  try {
    const waiting = async (url) => url.includes('/init') ? { ok: true, status: 200, json: async () => ({ ok: true, sessionId: 'S3' }) } : { ok: true, status: 200, json: async () => ({ ok: true, state: 'pending' }) };
    await assert.rejects(F.requestFromPhone({ worker: 'w', e164: '+82', keyPair: { publicKeyB64u: 'P', privateKey: 'K' }, openWithKey: open, fetchImpl: waiting, sleep: async () => {} }), /시간이 지났/);
  } finally { Date.now = realNow; }
});

test('worker.js: pdv_fetch 목적 — init/deliver/poll/조각 라우트와 보호 장치', () => {
  const w = read('worker.js');
  assert.match(w, /body\.purpose === 'pdv_fetch' \? 'pdv_fetch'/);
  assert.match(w, /purpose === 'key_transfer' \|\| purpose === 'pdv_fetch'\) \{\s*\n\s*if \(!pcPubKeyB64u\)/);
  assert.match(w, /pathname === '\/auth\/device-link\/deliver-part' && request\.method === 'POST'/);
  assert.match(w, /pathname === '\/auth\/device-link\/part'\s+&& request\.method === 'GET'/);
  const dp = w.slice(w.indexOf('async function handleDeviceLinkDeliverPart'), w.indexOf('async function handleDeviceLinkPart'));
  assert.match(dp, /record\.guid !== guid/); assert.match(dp, /record\.purpose !== 'pdv_fetch'/); assert.match(dp, /record\.state !== 'approved'/);
  assert.match(dp, /expirationTtl: DEVICE_LINK_PDV_PART_TTL/);
  const pt = w.slice(w.indexOf('async function handleDeviceLinkPart'), w.indexOf('// GET /auth/device-link/poll'));
  assert.match(pt, /KV\.delete\(key\)/, '한 번 가져가면 삭제');
  assert.match(w, /if \(record\.purpose === 'pdv_fetch'\) return 180;/);
  assert.match(w, /payload\.partCount = record\.partCount/);
});

test('폰 승인 화면·PDV 저장소: pdv_fetch 분기와 exportAll', () => {
  const a = read('auth/device-link-approve.html'), s = read('pdv-store.js');
  assert.match(a, /else if \(data\.purpose === 'pdv_fetch'\) renderPdvFetch\(data\)/);
  assert.match(a, /sessionData\.purpose === 'pdv_fetch'[\s\S]*?phoneRespond\(\{[\s\S]*?GopangWallet\.sealForRecipient\(sessionData\.pcPubKeyB64u/);
  assert.match(a, /<script src="\/pdv-store\.js"><\/script>/);
  assert.match(s, /async function exportAll\(\)[\s\S]*?delete o\._id/);
  assert.match(s, /global\.GopangPDV = \{\s*\n\s*importRecords,\s*\n\s*exportAll,/);
});

test('PDV 화면: 폰 원본 + PC 의 "폰에서 불러오기"(대안)', () => {
  const h = read('pdv.html'), s = read('pdv-store.js');
  assert.match(h, /name="pdv-mode" value="phone" checked/);
  assert.match(h, /name="pdv-mode" value="phone" checked disabled/);
  assert.match(h, /id="btn-phone-fetch">폰에서 불러오기/);
  assert.match(h, /010을 제외한 폰 번호 뒷자리 8자를 입력하십시오/);
  assert.match(h, /requestFromPhone\(\{[\s\S]*?importRecords\(data\.records\)/);
  assert.match(h, /<script src="\/gopang-wallet\.js"><\/script>/);
  assert.match(s, /async function importRecords\(records, via\)/);
  assert.match(s, /global\.GopangPDV = \{\s*\n\s*importRecords,/);
});
