import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeDocFormHandler, keyHashOf, saveMessage, reviewMessage, sha256Hex, normBody, findPii } from '../worker/doc-form-handler.js';

const b64u = buf => Buffer.from(buf).toString('base64url');
async function wallet() {
  const kp = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey));
  return { pub, sign: async m => b64u(await crypto.subtle.sign('Ed25519', kp.privateKey, new TextEncoder().encode(m))) };
}
function memStore() {
  const rows = [];
  return {
    rows,
    async latest(k) { return rows.filter(r => r.key_hash === k).sort((a, b) => b.version - a.version)[0] || null; },
    async get(k, v) { return rows.find(r => r.key_hash === k && r.version === v) || null; },
    async search({ agency, q }) { return rows.filter(r => (!agency || r.agency === agency) && (!q || r.name.includes(q))); },
    async append(r) { if (rows.some(x => x.key_hash === r.key_hash && x.version === r.version)) throw new Error('CONFLICT'); rows.push({ ...r }); },
    async setStatus(k, v, p) { const r = await this.get(k, v); if (!r) return false; Object.assign(r, p); return true; },
    async countSince(c, ts) { return rows.filter(r => r.contributor === c && r.ts >= ts).length; },
  };
}
const NOW = 1_800_000_000_000;
const req = (path, body, method = 'POST') => [new Request('https://x' + path, { method, body: body ? JSON.stringify(body) : undefined }), new URL('https://x' + path)];

async function setup() {
  const w = await wallet(); const store = memStore();
  const h = makeDocFormHandler({ store, getPinnedPubKey: async (e, g) => (g === 'g1' ? w.pub : null), now: () => NOW });
  const call = async (path, body, method, env = {}) => { const [r, u] = req(path, body, method); const res = await h.handle(r, u, env); return { status: res.status, j: await res.json() }; };
  const save = async (over = {}, ts = NOW) => {
    const d = { agency: '대법원', name: '이혼 소장', form_no: '', form_class: 'A', body: '# 소장\n원고: ____\n피고: ____', source: 'user_attached', consent: true, guid: 'g1', ts, ...over };
    d.sig = await w.sign(saveMessage(d.agency, d.name, d.form_no ?? '', d.ts, await sha256Hex(normBody(d.body))));
    return call('/doc-form/save', d);
  };
  return { w, store, call, save };
}

describe('서식 DB — 저장', () => {
  it('정상 저장 → v1 user_provided, 기여자·서명 비노출', async () => {
    const { save } = await setup();
    const r = await save();
    assert.equal(r.status, 200); assert.equal(r.j.form.version, 1); assert.equal(r.j.form.status, 'user_provided');
    assert.ok(!('contributor' in r.j.form) && !('sig' in r.j.form));
  });
  it('동의 없으면 400', async () => { const { save } = await setup(); assert.equal((await save({ consent: false })).j.code, 'NO_CONSENT'); });
  it('개인정보 포함 시 422 (주민번호·전화·이메일)', async () => {
    const { save } = await setup();
    for (const t of ['주민번호 900101-1234567', '연락처 010-1234-5678', 'a@b.com']) {
      const r = await save({ body: '원고: ' + t }); assert.equal(r.status, 422); assert.equal(r.j.code, 'PII');
    }
  });
  it('자리표시(000-0000-0000, ____)는 통과', async () => { const { save } = await setup(); assert.equal((await save({ body: '전화: 000-0000-0000 / ____' })).status, 200); });
  it('서명 불일치 401, 시계 오차 400, 미등록 계정 404', async () => {
    const { save, call } = await setup();
    const bad = await call('/doc-form/save', { agency: 'a', name: 'b', form_class: 'B', body: 'x', source: 'ai_composed', consent: true, guid: 'g1', ts: NOW, sig: 'AAAA' });
    assert.equal(bad.status, 401);
    assert.equal((await save({}, NOW - 3_600_000)).j.code, 'STALE_TS');
    assert.equal((await save({ guid: 'nobody' })).status, 404);
  });
  it('같은 본문 재저장 = duplicate, 다른 본문 = v2', async () => {
    const { save } = await setup();
    await save(); const d = await save(); assert.equal(d.j.duplicate, true);
    const v2 = await save({ body: '# 소장 개정\n원고: ____' }); assert.equal(v2.j.form.version, 2);
  });
  it('서식명 표기 차이(공백·대소문자)는 같은 서식', async () => {
    assert.equal(await keyHashOf('대법원', '이혼 소장', ''), await keyHashOf('대법원 ', '이혼소장', ''));
  });
  it('일일 한도 초과 429', async () => {
    const { save } = await setup();
    for (let i = 0; i < 20; i++) assert.equal((await save({ name: 'n' + i })).status, 200);
    assert.equal((await save({ name: 'over' })).status, 429);
  });
});

describe('서식 DB — 조회', () => {
  it('find: 있으면 본문+안내문, 없으면 found:false', async () => {
    const { save, call } = await setup(); await save();
    const f = await call('/doc-form/find?agency=대법원&name=이혼소장', null, 'GET');
    assert.equal(f.j.found, true); assert.match(f.j.form.body, /소장/); assert.match(f.j.form.notice, /공식 확인 전/);
    assert.equal((await call('/doc-form/find?agency=대법원&name=없는서식', null, 'GET')).j.found, false);
  });
  it('list: 본문 미포함', async () => {
    const { save, call } = await setup(); await save();
    const l = await call('/doc-form/list?agency=대법원', null, 'GET');
    assert.equal(l.j.forms.length, 1); assert.ok(!('body' in l.j.forms[0]));
  });
});

describe('서식 DB — 검토', () => {
  async function reviewed(status, url, env = { DOC_FORM_ADMINS: 'g1' }) {
    const s = await setup(); const saved = await s.save(); const k = saved.j.form.keyHash;
    const d = { keyHash: k, version: 1, status, official_url: url, guid: 'g1', ts: NOW };
    d.sig = await s.w.sign(reviewMessage(k, 1, status, NOW));
    return { ...s, r: await s.call('/doc-form/review', d, 'POST', env), k };
  }
  it('운영자: reviewed 성공', async () => { const { r, store } = await reviewed('reviewed'); assert.equal(r.status, 200); assert.equal(store.rows[0].status, 'reviewed'); });
  it('official_verified: .go.kr https만', async () => {
    assert.equal((await reviewed('official_verified', 'https://www.scourt.go.kr/x')).r.status, 200);
    assert.equal((await reviewed('official_verified', 'https://freeforms.co.kr/x')).r.j.code, 'OFFICIAL_URL');
    assert.equal((await reviewed('official_verified', 'https://evil-go.kr.com/x')).r.j.code, 'OFFICIAL_URL');
  });
  it('운영자 아니면 403, 운영자 미설정이면 503', async () => {
    assert.equal((await reviewed('reviewed', '', { DOC_FORM_ADMINS: 'other' })).r.status, 403);
    assert.equal((await reviewed('reviewed', '', {})).r.status, 503);
  });
});

describe('PII 탐지', () => { it('빈 문서는 통과', () => assert.deepEqual(findPii('성명 ____ 주민등록번호 ______-_______'), [])); });
