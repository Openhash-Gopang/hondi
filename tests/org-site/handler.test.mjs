import test from 'node:test';
import assert from 'node:assert/strict';
import { makeOrgSiteHandler, sha256Hex, signedMessage } from '../../src/worker/org-site-handler.js';
import { stableStringify } from '../../src/gopang/gov/org-site-config.js';

const b64u = u8 => Buffer.from(u8).toString('base64url');
async function newKey() {
  const kp = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  return { priv: kp.privateKey, pub: b64u(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))) };
}
const sign = async (k, msg) => b64u(new Uint8Array(await crypto.subtle.sign('Ed25519', k.priv, new TextEncoder().encode(msg))));

function memStore() {
  const rows = [];
  return {
    rows,
    latest: async s => { const r = rows.filter(x => x.site === s).sort((a, b) => b.version - a.version)[0]; return r || null; },
    get: async (s, v) => rows.find(x => x.site === s && x.version === v) || null,
    list: async s => rows.filter(x => x.site === s).sort((a, b) => b.version - a.version).map(({ version, note, author, ts }) => ({ version, note, author, ts })),
    append: async r => { if (rows.some(x => x.site === r.site && x.version === r.version)) throw new Error('CONFLICT'); rows.push(r); },
  };
}
const CFG = { name: '테스트기관', greeting: '안녕하세요', blocks: ['programs'], programs: [{ title: '사업 A' }] };
const NOW = 1_800_000_000_000;

async function setup(admins) {
  const admin = await newKey(), other = await newKey();
  const store = memStore();
  const pins = { gAdmin: admin.pub, gOther: other.pub };
  const h = makeOrgSiteHandler({ store, getPinnedPubKey: async (_e, g) => pins[g] || null, now: () => NOW });
  const env = { ORG_SITE_ADMINS: admins ?? 'gAdmin' };
  const call = (path, init) => h.handle(new Request('https://x' + path, init), new URL('https://x' + path), env, {});
  async function save(key, guid, { site = 'jtp', config = CFG, baseVersion = 0, ts = NOW, note = '' } = {}) {
    const hash = await sha256Hex(stableStringify((await import('../../src/gopang/gov/org-site-config.js')).sanitizeConfig(config).config || config));
    const sig = await sign(key, signedMessage(site, baseVersion, ts, hash));
    const res = await call('/org-site/save', { method: 'POST', body: JSON.stringify({ site, config, baseVersion, note, guid, ts, sig }) });
    return { res, j: await res.json() };
  }
  return { admin, other, store, call, save };
}

test('관리자 서명으로 저장하면 v1이 생기고 공개 조회로 보인다', async () => {
  const t = await setup();
  const { res, j } = await t.save(t.admin, 'gAdmin');
  assert.equal(res.status, 200); assert.equal(j.version, 1);
  const g = await (await t.call('/org-site/config?site=jtp')).json();
  assert.equal(g.version, 1); assert.equal(g.config.name, '테스트기관');
});

test('저장된 설정이 없으면 version 0, config null', async () => {
  const t = await setup();
  const g = await (await t.call('/org-site/config?site=jtp')).json();
  assert.deepEqual([g.ok, g.version, g.config], [true, 0, null]);
});

test('관리자가 아니면 403', async () => {
  const t = await setup();
  const { res, j } = await t.save(t.other, 'gOther');
  assert.equal(res.status, 403); assert.equal(j.code, 'NOT_ADMIN');
});

test('관리자 목록이 비어 있으면 503', async () => {
  const t = await setup('');
  const { res } = await t.save(t.admin, 'gAdmin');
  assert.equal(res.status, 503);
});

test('다른 사람 키로 서명하면 401', async () => {
  const t = await setup();
  const { res, j } = await t.save(t.other, 'gAdmin');   // gAdmin 계정인 척 other 키로 서명
  assert.equal(res.status, 401); assert.equal(j.code, 'BAD_SIG');
});

test('내용을 바꿔치기하면 서명이 맞지 않아 401', async () => {
  const t = await setup();
  const hash = await sha256Hex(stableStringify(CFG));
  const sig = await sign(t.admin, signedMessage('jtp', 0, NOW, hash));
  const res = await t.call('/org-site/save', { method: 'POST', body: JSON.stringify({ site: 'jtp', config: { ...CFG, greeting: '변조된 인사말' }, baseVersion: 0, guid: 'gAdmin', ts: NOW, sig }) });
  assert.equal(res.status, 401);
});

test('오래된 baseVersion은 409 STALE', async () => {
  const t = await setup();
  await t.save(t.admin, 'gAdmin');
  const { res, j } = await t.save(t.admin, 'gAdmin', { baseVersion: 0 });
  assert.equal(res.status, 409); assert.equal(j.code, 'STALE'); assert.equal(j.version, 1);
});

test('시각이 너무 어긋나면 거절', async () => {
  const t = await setup();
  const { res, j } = await t.save(t.admin, 'gAdmin', { ts: NOW - 3_600_000 });
  assert.equal(res.status, 400); assert.equal(j.code, 'STALE_TS');
});

test('잘못된 설정은 422', async () => {
  const t = await setup();
  const { res } = await t.save(t.admin, 'gAdmin', { config: { name: '', greeting: '' } });
  assert.equal(res.status, 422);
});

test('롤백: 옛 버전을 불러와 다시 저장하면 새 버전이 되고 기록이 남는다', async () => {
  const t = await setup();
  await t.save(t.admin, 'gAdmin', { baseVersion: 0, note: '처음' });
  await t.save(t.admin, 'gAdmin', { baseVersion: 1, config: { ...CFG, greeting: '두 번째 인사' }, note: '수정' });
  const v1 = await (await t.call('/org-site/version?site=jtp&version=1')).json();
  assert.equal(v1.config.greeting, '안녕하세요');
  const { j } = await t.save(t.admin, 'gAdmin', { baseVersion: 2, config: v1.config, note: 'v1로 되돌림' });
  assert.equal(j.version, 3);
  const cur = await (await t.call('/org-site/config?site=jtp')).json();
  assert.equal(cur.config.greeting, '안녕하세요');
  const hist = await (await t.call('/org-site/history?site=jtp')).json();
  assert.deepEqual(hist.versions.map(v => v.version), [3, 2, 1]);
});

test('사이트 id 형식이 틀리면 400', async () => {
  const t = await setup();
  assert.equal((await t.call('/org-site/config?site=../x')).status, 400);
});

test('관리자 목록에 guid 대신 공개키를 넣어도 된다', async () => {
  const probe = await setup();
  const t = await setup(probe.admin.pub);          // 다른 키쌍이므로 일치하지 않아야 한다
  assert.equal((await t.save(t.admin, 'gAdmin')).res.status, 403);
  // 같은 환경에서 자기 공개키를 목록에 넣은 경우
  const admin = await newKey(); const store = memStore();
  const h = makeOrgSiteHandler({ store, getPinnedPubKey: async () => admin.pub, now: () => NOW });
  const hash = await sha256Hex(stableStringify((await import('../../src/gopang/gov/org-site-config.js')).sanitizeConfig(CFG).config));
  const sig = await sign(admin, signedMessage('jtp', 0, NOW, hash));
  const res = await h.handle(new Request('https://x/org-site/save', { method: 'POST', body: JSON.stringify({ site: 'jtp', config: CFG, baseVersion: 0, guid: 'gZ', ts: NOW, sig }) }),
    new URL('https://x/org-site/save'), { ORG_SITE_ADMINS: admin.pub }, {});
  assert.equal(res.status, 200);
});
