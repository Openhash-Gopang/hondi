import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeProVerifyHandler, applyMessage, listMessage, fileMessage, decideMessage, sha256Hex, licenseHashOf,
  maskLicenseNo, sniffType, activeVerification, personaCovers, VALID_MS, DAILY_APPLY_LIMIT,
} from '../worker/pro-verify-handler.js';

const b64u = buf => Buffer.from(buf).toString('base64url');
async function wallet() {
  const kp = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey));
  return { pub, sign: async m => b64u(await crypto.subtle.sign('Ed25519', kp.privateKey, new TextEncoder().encode(m))) };
}
const NOW = 1_800_000_000_000;
const PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4]);
const EXE = new Uint8Array([0x4D, 0x5A, 0x90, 0x00, 1, 2, 3, 4]);

function memStore() {
  const rows = []; let n = 0;
  return {
    rows,
    async create(rec, file) { const id = String(++n).padStart(15, 'a'); const r = { id, ...rec, license_file: file ? 'license.bin' : '', _bytes: file?.bytes }; rows.push(r); return r; },
    async get(id) { return rows.find(r => r.id === id) || null; },
    async listByPubkey(p) { return rows.filter(r => r.applicant_pubkey === p).sort((a, b) => b.ts - a.ts); },
    async listPending(l) { return rows.filter(r => r.status === 'pending').slice(0, l); },
    async findApprovedByLicense(h) { return rows.filter(r => r.license_hash === h && r.status === 'approved'); },
    async countSince(p, ts) { return rows.filter(r => r.applicant_pubkey === p && r.ts >= ts).length; },
    async update(id, patch) { Object.assign(rows.find(r => r.id === id), patch); },
    async clearFile(id, ts) { const r = rows.find(x => x.id === id); r.license_file = ''; r._bytes = null; r.license_file_deleted_ts = ts; },
    async readFile(id) { const r = rows.find(x => x.id === id); return r?._bytes ? { bytes: r._bytes, type: 'image/png' } : null; },
  };
}

async function setup() {
  const ws = { g1: await wallet(), g2: await wallet(), gs: await wallet(), admin: await wallet(), other: await wallet() };
  const store = memStore(); let t = NOW;
  const h = makeProVerifyHandler({ store, getPinnedPubKey: async (e, g) => ws[g]?.pub || null, now: () => t });
  const env = { PRO_VERIFY_ADMINS: 'admin' };
  const tick = ms => { t += ms; };
  const apply = async (guid, over = {}) => {
    const d = { persona: 'patent-attorney', role: 'professional', license_no: '12-3456', supervisor_guid: '', bytes: PNG, ts: t, ...over };
    const lh = await licenseHashOf(d.persona, d.license_no); const fs = await sha256Hex(d.bytes);
    const sig = over.sig ?? await ws[guid].sign(applyMessage(d.persona, d.role, lh, fs, d.supervisor_guid, d.ts));
    const fd = new FormData();
    for (const k of ['persona', 'role', 'license_no', 'supervisor_guid']) fd.append(k, d[k]);
    fd.append('guid', guid); fd.append('ts', String(d.ts)); fd.append('sig', sig);
    fd.append('file', new Blob([d.bytes]), 'x');
    const res = await h.handle(new Request('https://x/pro-verify/apply', { method: 'POST', body: fd }), new URL('https://x/pro-verify/apply'), env);
    return { status: res.status, j: await res.json() };
  };
  const post = async (path, body) => {
    const res = await h.handle(new Request('https://x' + path, { method: 'POST', body: JSON.stringify(body) }), new URL('https://x' + path), env);
    return res;
  };
  const adminCall = async (path, make, extra = {}, who = 'admin') => {
    const base = { guid: who, ts: t, ...extra };
    base.sig = await ws[who].sign(make(base));
    return post(path, base);
  };
  const decide = async (id, decision, note = '', who = 'admin') => {
    const res = await adminCall('/pro-verify/decide', b => decideMessage(b.id, b.decision, b.ts), { id, decision, note }, who);
    return { status: res.status, j: await res.json() };
  };
  const status = async guid => { const u = new URL('https://x/pro-verify/status?guid=' + guid); const res = await h.handle(new Request(u), u, env); return { status: res.status, j: await res.json() }; };
  return { ws, store, h, env, apply, decide, status, adminCall, tick, now: () => t };
}

describe('면허 인증 — 신청', () => {
  it('정상 신청 → pending, 면허번호는 마스킹본·해시만 저장', async () => {
    const { apply, store } = await setup();
    const r = await apply('g1');
    assert.equal(r.status, 200); assert.equal(r.j.application.status, 'pending');
    const row = store.rows[0];
    assert.equal(row.license_no_masked, '**3456'); assert.match(row.license_hash, /^[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(row).includes('12-3456') && !JSON.stringify(row).includes('123456'));
    assert.ok(!JSON.stringify(r.j).includes('applicant_pubkey'));
  });
  it('서명이 틀리면 401', async () => { const { apply } = await setup(); const r = await apply('g1', { sig: 'AAAA' }); assert.equal(r.status, 401); assert.equal(r.j.code, 'BAD_SIG'); });
  it('다른 계정 키로 서명하면 401', async () => {
    const { apply, ws } = await setup();
    const lh = await licenseHashOf('patent-attorney', '12-3456'); const fs = await sha256Hex(PNG);
    const sig = await ws.g2.sign(applyMessage('patent-attorney', 'professional', lh, fs, '', NOW));
    assert.equal((await apply('g1', { sig })).status, 401);
  });
  it('파일 내용이 서명 후 바뀌면 401 (파일 해시가 서명에 묶임)', async () => {
    const { apply, ws } = await setup();
    const lh = await licenseHashOf('patent-attorney', '12-3456'); const fs = await sha256Hex(new Uint8Array([0x89, 0x50, 0x4E, 0x47, 9, 9]));
    const sig = await ws.g1.sign(applyMessage('patent-attorney', 'professional', lh, fs, '', NOW));
    assert.equal((await apply('g1', { sig })).status, 401);
  });
  it('실행 파일 등 허용되지 않은 형식은 415', async () => { const { apply } = await setup(); assert.equal((await apply('g1', { bytes: EXE })).status, 415); });
  it('5MB 초과는 413', async () => { const { apply } = await setup(); const big = new Uint8Array(5 * 1024 * 1024 + 1); big.set(PNG); assert.equal((await apply('g1', { bytes: big })).status, 413); });
  it('시각이 어긋나면 400', async () => { const { apply } = await setup(); assert.equal((await apply('g1', { ts: NOW - 10 * 60 * 1000 })).j.code, 'STALE_TS'); });
  it('같은 직역 대기 신청이 있으면 409', async () => { const { apply } = await setup(); await apply('g1'); assert.equal((await apply('g1')).j.code, 'PENDING'); });
  it('면허번호가 너무 짧으면 400', async () => { const { apply } = await setup(); assert.equal((await apply('g1', { license_no: 'a' })).j.code, 'LICENSE_NO'); });
  it('하루 신청 한도(5건) 초과는 429', async () => {
    const { apply } = await setup();
    for (const persona of ['lawyer', 'physician', 'pharmacist', 'appraiser', 'accountant']) assert.equal((await apply('g1', { persona, license_no: persona + '-001' })).status, 200);
    assert.equal((await apply('g1', { persona: 'tax-accountant', license_no: 'TAX-001' })).j.code, 'RATE');
  });
});

describe('면허 인증 — 운영자 처리', () => {
  it('승인 → approved, 만료 1년, 사본 즉시 삭제', async () => {
    const { apply, decide, store, status } = await setup();
    const a = await apply('g1'); const id = a.j.application.id;
    assert.ok(store.rows[0].license_file);
    const d = await decide(id, 'approve');
    assert.equal(d.status, 200); assert.equal(d.j.status, 'approved'); assert.equal(d.j.expires_ts, NOW + VALID_MS); assert.equal(d.j.file_deleted, true);
    assert.equal(store.rows[0].license_file, ''); assert.equal(store.rows[0]._bytes, null); assert.equal(store.rows[0].license_file_deleted_ts, NOW);
    const s = await status('g1'); assert.equal(s.j.items[0].status, 'approved');
  });
  it('반려는 사유 필수, 사본 삭제', async () => {
    const { apply, decide, store } = await setup();
    const id = (await apply('g1')).j.application.id;
    assert.equal((await decide(id, 'reject')).j.code, 'NOTE');
    const d = await decide(id, 'reject', '면허번호 불일치');
    assert.equal(d.j.status, 'rejected'); assert.equal(store.rows[0].license_file, '');
  });
  it('일반 계정이 승인 시도하면 403', async () => {
    const { apply, decide } = await setup();
    const id = (await apply('g1')).j.application.id;
    const r = await decide(id, 'approve', '', 'g2'); assert.equal(r.status, 403); assert.equal(r.j.code, 'NOT_ADMIN');
  });
  it('운영자 미설정이면 503', async () => {
    const { apply, h, ws } = await setup();
    const id = (await apply('g1')).j.application.id;
    const body = { id, decision: 'approve', guid: 'admin', ts: NOW }; body.sig = await ws.admin.sign(decideMessage(id, 'approve', NOW));
    const res = await h.handle(new Request('https://x/pro-verify/decide', { method: 'POST', body: JSON.stringify(body) }), new URL('https://x/pro-verify/decide'), {});
    assert.equal(res.status, 503);
  });
  it('이미 처리된 신청은 다시 처리할 수 없다 (409)', async () => {
    const { apply, decide } = await setup();
    const id = (await apply('g1')).j.application.id; await decide(id, 'approve');
    assert.equal((await decide(id, 'approve')).j.code, 'INVALID_STATE');
    assert.equal((await decide(id, 'reject', 'x')).j.code, 'INVALID_STATE');
  });
  it('철회 → revoked, 이후 활성 인증 아님', async () => {
    const { apply, decide, store, ws, now } = await setup();
    const id = (await apply('g1')).j.application.id; await decide(id, 'approve');
    assert.ok(await activeVerification(store, ws.g1.pub, 'patent-attorney', now()));
    assert.equal((await decide(id, 'revoke', '면허 정지')).j.status, 'revoked');
    assert.equal(await activeVerification(store, ws.g1.pub, 'patent-attorney', now()), null);
  });
  it('대기 목록은 마스킹 면허번호만, 사본 열람은 열람 기록을 남긴다', async () => {
    const { apply, adminCall, store } = await setup();
    const id = (await apply('g1')).j.application.id;
    const list = await (await adminCall('/pro-verify/pending', b => listMessage(b.ts))).json();
    assert.equal(list.items.length, 1); assert.equal(list.items[0].license_no_masked, '**3456'); assert.ok(!JSON.stringify(list).includes('123456'));
    const f = await adminCall('/pro-verify/file', b => fileMessage(b.id, b.ts), { id });
    assert.equal(f.status, 200); assert.equal(f.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual([...new Uint8Array(await f.arrayBuffer())], [...PNG]);
    assert.equal(store.rows[0].view_log.length, 1);
  });
  it('처리 후에는 사본을 열 수 없다 (410)', async () => {
    const { apply, decide, adminCall } = await setup();
    const id = (await apply('g1')).j.application.id; await decide(id, 'approve');
    assert.equal((await adminCall('/pro-verify/file', b => fileMessage(b.id, b.ts), { id })).status, 410);
  });
});

describe('면허 인증 — 면허 공유 방지·직원', () => {
  it('같은 면허번호를 다른 계정이 이미 승인받았으면 신청 거절 (형식 차이는 무시)', async () => {
    const { apply, decide } = await setup();
    const id = (await apply('g1')).j.application.id; await decide(id, 'approve');
    const r = await apply('g2', { license_no: '12 3456' }); assert.equal(r.status, 409); assert.equal(r.j.code, 'LICENSE_IN_USE');
  });
  it('직원은 소속 전문가가 인증되기 전에는 신청할 수 없다', async () => {
    const { apply } = await setup();
    const r = await apply('gs', { role: 'staff', supervisor_guid: 'g1', license_no: 'STAFF-001' });
    assert.equal(r.j.code, 'SUPERVISOR_NOT_VERIFIED');
  });
  it('직원은 supervisor 필수, 본인 지정 불가', async () => {
    const { apply } = await setup();
    assert.equal((await apply('gs', { role: 'staff', supervisor_guid: '' })).j.code, 'SUPERVISOR');
    assert.equal((await apply('gs', { role: 'staff', supervisor_guid: 'gs' })).j.code, 'SUPERVISOR');
  });
  it('전문가 승인 후 직원 신청·승인, 전문가 철회 시 직원 인증도 무효', async () => {
    const { apply, decide, store, ws, now } = await setup();
    const p = (await apply('g1')).j.application.id; await decide(p, 'approve');
    const s = await apply('gs', { role: 'staff', supervisor_guid: 'g1', license_no: 'STAFF-001' }); assert.equal(s.status, 200);
    await decide(s.j.application.id, 'approve');
    assert.ok(await activeVerification(store, ws.gs.pub, 'patent-attorney', now()));
    await decide(p, 'revoke', '정지');
    assert.equal(await activeVerification(store, ws.gs.pub, 'patent-attorney', now()), null);
  });
  it('인증 만료 후에는 활성 아님, 상태는 expired', async () => {
    const { apply, decide, store, ws, now, tick, status } = await setup();
    const id = (await apply('g1')).j.application.id; await decide(id, 'approve');
    tick(VALID_MS + 1);
    assert.equal(await activeVerification(store, ws.g1.pub, 'patent-attorney', now()), null);
    assert.equal((await status('g1')).j.items[0].status, 'expired');
  });
});

describe('보조 함수', () => {
  it('하위 직역은 상위 인증이 덮는다', () => { assert.ok(personaCovers('lawyer', 'lawyer-criminal')); assert.ok(personaCovers('lawyer', 'lawyer')); assert.ok(!personaCovers('lawyer', 'lawyers')); assert.ok(!personaCovers('lawyer-criminal', 'lawyer')); });
  it('마스킹: 정규화 후 끝 4자만 노출', () => { assert.equal(maskLicenseNo('12-3456'), '**3456'); assert.equal(maskLicenseNo('ab'), '**'); });
  it('매직 바이트', () => { assert.equal(sniffType(PNG), 'image/png'); assert.equal(sniffType(EXE), null); assert.equal(sniffType(new TextEncoder().encode('%PDF-1.7')), 'application/pdf'); });
  it('인증 장부는 직역 간에 분리된다', async () => {
    const { apply, decide, store, ws, now } = await setup();
    const id = (await apply('g1')).j.application.id; await decide(id, 'approve');
    assert.equal(await activeVerification(store, ws.g1.pub, 'lawyer', now()), null);
  });
});
