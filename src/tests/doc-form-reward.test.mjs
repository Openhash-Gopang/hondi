import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeDocFormRewardHandler, scoreRatings, qualifies, isExcellent, rateMessage, mineMessage, adminRewardMessage, REWARD_RULES } from '../worker/doc-form-reward.js';

const b64u = buf => Buffer.from(buf).toString('base64url');
const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_800_000_000_000;
const KEY = 'a'.repeat(64);

async function wallet() {
  const kp = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  return { pub: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)), sign: async m => b64u(await crypto.subtle.sign('Ed25519', kp.privateKey, new TextEncoder().encode(m))) };
}

// ── 메모리 저장소 (실제 어댑터와 같은 메서드) ──
function memForms() {
  const rows = [];
  return {
    rows,
    async get(k, v) { return rows.find(r => r.key_hash === k && r.version === v) || null; },
    async listByContributor(c) { return rows.filter(r => r.contributor === c).sort((a, b) => b.ts - a.ts); },
    async earlierSameBody(bh, ts, k) { return rows.some(r => r.body_hash === bh && r.key_hash !== k && r.ts < ts); },
  };
}
function memRatings() {
  const rows = [];
  return {
    rows,
    async find(k, v, r) { return rows.find(x => x.key_hash === k && x.version === v && x.rater === r) || null; },
    async upsert(rec) { const p = await this.find(rec.key_hash, rec.version, rec.rater); if (p) Object.assign(p, rec); else rows.push({ ...rec }); },
    async listFor(k, v) { return rows.filter(x => x.key_hash === k && x.version === v); },
    async countSince(r, ts) { return rows.filter(x => x.rater === r && x.ts >= ts).length; },
    async hasRatedContributor(r, c) { return rows.some(x => x.rater === r && x.form_contributor === c); },
  };
}
function memRewards() {
  const rows = []; let n = 0;
  return {
    rows,
    async get(k, v, kind) { return rows.find(x => x.key_hash === k && x.version === v && x.kind === kind) || null; },
    async create(rec) { if (rows.some(x => x.key_hash === rec.key_hash && x.version === rec.version && x.kind === rec.kind)) throw new Error('CONFLICT'); const r = { id: 'r' + ++n, ...rec }; rows.push(r); return r; },
    async update(id, patch) { Object.assign(rows.find(x => x.id === id), patch); },
    async countSince(c, ts) { return rows.filter(x => x.contributor === c && x.ts >= ts && x.status !== 'void' && x.status !== 'failed').length; },
    async listForForm(k, v) { return rows.filter(x => x.key_hash === k && x.version === v); },
  };
}

async function setup({ mintImpl } = {}) {
  const clock = { t: T0 };
  const wallets = {};                      // guid → wallet
  const created = {};                      // guid → 가입 시각
  const forms = memForms(), ratings = memRatings(), rewards = memRewards();
  const mints = [];
  const h = makeDocFormRewardHandler({
    formStore: forms, ratingStore: ratings, rewardStore: rewards,
    getPinnedPubKey: async (_e, g) => wallets[g]?.pub || null,
    getAccount: async (_e, g) => (g in created ? { createdTs: created[g] } : null),
    mint: mintImpl ? (e, a) => mintImpl(e, a, mints) : async (e, a) => { mints.push(a); return { ok: true, gdc: a.krw, contentHash: 'hash' + mints.length }; },
    now: () => clock.t,
  });
  const user = async (guid, ageDays = 30) => { wallets[guid] = await wallet(); created[guid] = clock.t - ageDays * DAY; return wallets[guid]; };
  const addForm = (over = {}) => { const f = { key_hash: KEY, version: 1, agency: '해양수산부', name: '도선료 신고서', source: 'user_attached', body: '신고서 ____', body_hash: 'b'.repeat(64), contributor: wallets.owner.pub, ts: clock.t, status: 'user_provided', ...over }; forms.rows.push(f); return f; };
  const call = async (path, body, method = 'POST', env = {}) => {
    const url = new URL('https://x' + path);
    const res = await h.handle(new Request(url, { method, body: body ? JSON.stringify(body) : undefined }), url, env);
    return res ? { status: res.status, j: await res.json() } : null;
  };
  const rate = async (guid, rating, over = {}, key = KEY, version = 1) => {
    const d = { key_hash: key, version, rating, used: true, guid, ts: clock.t, ...over };
    d.sig = await wallets[guid].sign(rateMessage(d.key_hash, d.version, d.rating, d.ts));
    return call('/doc-form/rate', d);
  };
  return { clock, wallets, created, forms, ratings, rewards, mints, h, user, addForm, call, rate };
}
const ENV = { DOC_FORM_REWARD_KRW: '100' };

// 쿨링(72h) 지난 뒤 5명이 5점 — 기본 통과 상황을 만든다.
async function qualifiedScenario(s, { n = 5, score = 5 } = {}) {
  await s.user('owner'); s.addForm();
  for (let i = 0; i < n; i++) await s.user('u' + i);
  s.clock.t += 4 * DAY;
  for (let i = 0; i < n; i++) await s.rate('u' + i, score);
}

describe('순수 계산', () => {
  it('보정 평균: 5점 5표 통과, 4점 5표 미달, 4표 미달', () => {
    const five = Array(5).fill({ rating: 5 }), four = Array(5).fill({ rating: 4 });
    assert.ok(qualifies(scoreRatings(five)));
    assert.ok(!qualifies(scoreRatings(four)), '4점만 5표는 보정 평균 3.71');
    assert.ok(!qualifies(scoreRatings(five.slice(0, 4))), '평가자 4명');
  });
  it('4~5점 비율 70% 미만이면 평균이 높아도 미달', () => {
    const r = [5, 5, 5, 5, 5, 5, 1, 1, 1, 1].map(rating => ({ rating }));   // 평균 3.8 → 보정 3.67 이라 미달, 비율 60%
    assert.ok(!qualifies(scoreRatings(r)));
  });
  it('우수: 20명·보정 평균 4.5·85% 이상', () => {
    assert.ok(isExcellent(scoreRatings(Array(20).fill({ rating: 5 }))));
    assert.ok(!isExcellent(scoreRatings(Array(19).fill({ rating: 5 }))));
  });
});

describe('평가 /doc-form/rate', () => {
  it('정상 평가 → 집계, 응답에 식별자 없음', async () => {
    const s = await setup(); await s.user('owner'); s.addForm(); await s.user('u1');
    const r = await s.rate('u1', 5);
    assert.equal(r.status, 200); assert.equal(r.j.counted, true); assert.deepEqual(r.j.stats, { count: 1, avg: 5 });
    const raw = JSON.stringify(r.j);
    assert.ok(!raw.includes(s.wallets.owner.pub) && !raw.includes(s.wallets.u1.pub));
  });
  it('써 보지 않은 평가(used 없음)·범위 밖 점수·잘못된 키는 400', async () => {
    const s = await setup(); await s.user('owner'); s.addForm(); await s.user('u1');
    assert.equal((await s.rate('u1', 5, { used: false })).j.code, 'NOT_USED');
    assert.equal((await s.rate('u1', 6)).j.code, 'MISSING');
    assert.equal((await s.rate('u1', 0)).j.code, 'MISSING');
    assert.equal((await s.rate('u1', 3.5)).j.code, 'MISSING');
    assert.equal((await s.rate('u1', 5, {}, 'zz')).j.code, 'MISSING');
  });
  it('서명 불일치 401 · 시계 오차 400 · 미등록 계정 404 · 없는 서식 404', async () => {
    const s = await setup(); await s.user('owner'); s.addForm(); await s.user('u1'); await s.user('u2');
    const forged = { key_hash: KEY, version: 1, rating: 5, used: true, guid: 'u1', ts: s.clock.t, sig: await s.wallets.u2.sign(rateMessage(KEY, 1, 5, s.clock.t)) };
    assert.equal((await s.call('/doc-form/rate', forged)).status, 401);
    const tampered = { ...forged, sig: await s.wallets.u1.sign(rateMessage(KEY, 1, 5, s.clock.t)), rating: 4 };
    assert.equal((await s.call('/doc-form/rate', tampered)).status, 401, '점수를 바꾸면 서명이 맞지 않는다');
    assert.equal((await s.rate('u1', 5, { ts: s.clock.t - 3_600_000 })).j.code, 'STALE_TS');
    s.wallets.ghost = await wallet();
    assert.equal((await s.call('/doc-form/rate', { ...forged, guid: 'nobody' })).status, 404);
    assert.equal((await s.rate('u1', 5, {}, 'c'.repeat(64))).j.code, 'NO_FORM');
  });
  it('본인이 올린 서식은 평가할 수 없다', async () => {
    const s = await setup(); await s.user('owner'); s.addForm();
    const r = await s.rate('owner', 5); assert.equal(r.status, 403); assert.equal(r.j.code, 'SELF_RATING');
  });
  it('같은 이용자가 다시 평가하면 덮어쓴다(표 하나)', async () => {
    const s = await setup(); await s.user('owner'); s.addForm(); await s.user('u1');
    await s.rate('u1', 5); const r = await s.rate('u1', 2);
    assert.deepEqual(r.j.stats, { count: 1, avg: 2 }); assert.equal(s.ratings.rows.length, 1);
  });
  it('가입 7일 미만 계정의 평가는 받되 집계에 넣지 않는다', async () => {
    const s = await setup(); await s.user('owner'); s.addForm(); await s.user('newbie', 2);
    const r = await s.rate('newbie', 5); assert.equal(r.j.counted, false); assert.equal(r.j.stats.count, 0);
  });
  it('하루 30건 초과 429 (이미 평가한 서식 수정은 제외)', async () => {
    const s = await setup(); await s.user('owner'); await s.user('u1');
    for (let i = 0; i < 30; i++) { const k = i.toString(16).padStart(64, '0'); s.addForm({ key_hash: k }); assert.equal((await s.rate('u1', 5, {}, k)).status, 200); }
    const k31 = 'f'.repeat(64); s.addForm({ key_hash: k31 });
    assert.equal((await s.rate('u1', 5, {}, k31)).j.code, 'RATE');
    assert.equal((await s.rate('u1', 4, {}, '0'.padStart(64, '0'))).status, 200, '기존 평가 수정은 허용');
  });
});

describe('공개 집계 /doc-form/stats', () => {
  it('평가 수·평균만 돌려주고 잘못된 키는 건너뛴다', async () => {
    const s = await setup(); await s.user('owner'); s.addForm(); await s.user('u1'); await s.user('u2');
    await s.rate('u1', 5); await s.rate('u2', 4);
    const r = await s.call(`/doc-form/stats?keys=${KEY}:1,bad:1,${KEY}:9`, null, 'GET');
    assert.deepEqual(r.j.stats, { [`${KEY}:1`]: { count: 2, avg: 4.5 } });
  });
  it('다른 경로는 null (기존 서식 DB 핸들러로 넘김)', async () => {
    const s = await setup(); assert.equal(await s.call('/doc-form/find?agency=a&name=b', null, 'GET'), null);
  });
});

describe('보상 지급', () => {
  it('기본 통과 → 최초 기여자에게 1회 mint(memo·금액·수취인)', async () => {
    const s = await setup(); await qualifiedScenario(s);
    // 위 평가는 ENV 없이 호출돼 지급 안 됨 — env를 넣고 한 번 더 평가하면 점검이 돈다.
    assert.equal(s.mints.length, 0, 'env 미설정이면 지급하지 않는다');
    const r = await s.h.settle(await s.forms.get(KEY, 1), ENV);
    assert.equal(r.paid.length, 1); assert.equal(r.paid[0].status, 'paid');
    assert.equal(s.mints.length, 1);
    assert.equal(s.mints[0].pubkey, s.wallets.owner.pub); assert.equal(s.mints[0].krw, 100);
    assert.match(s.mints[0].memo, /^form_reward:qualified:a{12}:v1$/);
  });
  it('멱등: 같은 서식에 평가가 더 들어오고 점검이 반복돼도 mint는 1회', async () => {
    const s = await setup(); await qualifiedScenario(s);
    const f = await s.forms.get(KEY, 1);
    await s.h.settle(f, ENV); await s.h.settle(f, ENV); await s.h.settle(f, ENV);
    assert.equal(s.mints.length, 1); assert.equal(s.rewards.rows.length, 1);
  });
  it('평가 요청 안에서도 점검된다(rate 호출이 지급을 일으킴) — 평가자 응답에는 지급 정보가 없다', async () => {
    const s = await setup(); await s.user('owner'); s.addForm();
    for (let i = 0; i < 6; i++) await s.user('u' + i);
    s.clock.t += 4 * DAY;
    // env는 handle 호출 시 전달 — rate 헬퍼는 env를 안 넘기므로 직접 호출
    for (let i = 0; i < 5; i++) {
      const d = { key_hash: KEY, version: 1, rating: 5, used: true, guid: 'u' + i, ts: s.clock.t };
      d.sig = await s.wallets['u' + i].sign(rateMessage(KEY, 1, 5, d.ts));
      const r = await s.call('/doc-form/rate', d, 'POST', ENV);
      assert.ok(!('paid' in r.j) && !('settled' in r.j) && !JSON.stringify(r.j).includes('reward'));
    }
    assert.equal(s.mints.length, 1);
  });
  it('env DOC_FORM_REWARD_KRW 가 0·없음·문자 → 지급하지 않는다', async () => {
    for (const env of [{}, { DOC_FORM_REWARD_KRW: '0' }, { DOC_FORM_REWARD_KRW: 'abc' }, { DOC_FORM_REWARD_KRW: '-5' }]) {
      const s = await setup(); await qualifiedScenario(s);
      assert.deepEqual(await s.h.settle(await s.forms.get(KEY, 1), env), { skipped: 'disabled' });
      assert.equal(s.mints.length, 0);
    }
  });
  it('저장 72시간 전에는 지급하지 않는다(쿨링)', async () => {
    const s = await setup(); await s.user('owner'); s.addForm();
    for (let i = 0; i < 5; i++) await s.user('u' + i);
    s.clock.t += 1 * DAY;
    for (let i = 0; i < 5; i++) await s.rate('u' + i, 5);
    assert.deepEqual(await s.h.settle(await s.forms.get(KEY, 1), ENV), { skipped: 'cooling' });
    s.clock.t += 3 * DAY;
    assert.equal((await s.h.settle(await s.forms.get(KEY, 1), ENV)).paid.length, 1);
  });
  it('처음 올린 이가 아니면(개정본 v2) 지급하지 않는다', async () => {
    const s = await setup(); await qualifiedScenario(s);
    s.addForm({ version: 2, contributor: (await s.user('second')).pub, body_hash: 'c'.repeat(64) });
    for (let i = 0; i < 5; i++) await s.rate('u' + i, 5, {}, KEY, 2);
    assert.deepEqual(await s.h.settle(await s.forms.get(KEY, 2), ENV), { skipped: 'not_first' });
    assert.equal(s.mints.length, 0);
  });
  it('AI가 구성한 서식(ai_composed)은 제외', async () => {
    const s = await setup(); await s.user('owner'); s.addForm({ source: 'ai_composed' });
    for (let i = 0; i < 5; i++) await s.user('u' + i);
    s.clock.t += 4 * DAY; for (let i = 0; i < 5; i++) await s.rate('u' + i, 5);
    assert.deepEqual(await s.h.settle(await s.forms.get(KEY, 1), ENV), { skipped: 'source' });
  });
  it('운영자(DOC_FORM_ADMINS)가 올린 서식은 제외 — guid·공개키 모두', async () => {
    for (const admins of ['owner', null]) {
      const s = await setup(); await qualifiedScenario(s);
      const env = { ...ENV, DOC_FORM_ADMINS: admins ?? s.wallets.owner.pub };
      assert.deepEqual(await s.h.settle(await s.forms.get(KEY, 1), env), { skipped: 'admin' });
    }
  });
  it('같은 본문이 먼저 다른 서식으로 있으면 제외', async () => {
    const s = await setup(); await s.user('owner'); await s.user('other');
    s.addForm({ key_hash: 'd'.repeat(64), contributor: s.wallets.other.pub, ts: T0 - DAY });
    s.addForm();     // body_hash 동일(b…)
    for (let i = 0; i < 5; i++) await s.user('u' + i);
    s.clock.t += 4 * DAY; for (let i = 0; i < 5; i++) await s.rate('u' + i, 5);
    assert.deepEqual(await s.h.settle(await s.forms.get(KEY, 1), ENV), { skipped: 'duplicate_body' });
  });
  it('본인 외 평가 5명 미만이면 지급하지 않는다(가입 7일 미만 계정은 세지 않음)', async () => {
    const s = await setup(); await s.user('owner'); s.addForm();
    for (let i = 0; i < 4; i++) await s.user('u' + i);
    await s.user('fresh', 1);
    s.clock.t += 4 * DAY;     // fresh 는 평가 시점(4일 뒤)에도 5일 계정 → 7일 미만
    for (let i = 0; i < 4; i++) await s.rate('u' + i, 5);
    await s.rate('fresh', 5);
    assert.deepEqual(await s.h.settle(await s.forms.get(KEY, 1), ENV), { skipped: 'not_qualified' });
  });
  it('상호 평가(기여자도 그 평가자의 서식을 평가함)는 세지 않는다', async () => {
    const s = await setup(); await s.user('owner'); s.addForm();
    for (let i = 0; i < 5; i++) await s.user('u' + i);
    // owner 가 u0·u1 의 서식을 평가해 준 기록
    for (const g of ['u0', 'u1']) {
      const k = g.padEnd(64, '0').replace(/[^0-9a-f]/g, 'e'); s.addForm({ key_hash: k, contributor: s.wallets[g].pub, body_hash: g.padEnd(64, '1').replace(/[^0-9a-f]/g, 'e') });
      await s.rate('owner', 5, {}, k);
    }
    s.clock.t += 4 * DAY;
    for (let i = 0; i < 5; i++) await s.rate('u' + i, 5);
    assert.deepEqual(await s.h.settle(await s.forms.get(KEY, 1), ENV), { skipped: 'not_qualified' }, '5명 중 2명이 상호 평가 → 3명만 인정');
    await s.user('u5'); await s.user('u6'); await s.rate('u5', 5); await s.rate('u6', 5);
    assert.equal((await s.h.settle(await s.forms.get(KEY, 1), ENV)).paid.length, 1, '독립 평가자 5명이 되면 지급');
  });
  it('우수(excellent)는 20명 이상에서 한 번 더, 이후 반복 지급 없음', async () => {
    const s = await setup(); await qualifiedScenario(s, { n: 20 });
    const f = await s.forms.get(KEY, 1);
    const r = await s.h.settle(f, ENV);
    assert.deepEqual(r.paid.map(p => p.kind), ['qualified', 'excellent']);
    await s.h.settle(f, ENV);
    assert.equal(s.mints.length, 2);
  });
  it('기여자당 30일 10건 한도', async () => {
    const s = await setup(); await s.user('owner');
    for (let i = 0; i < 6; i++) await s.user('u' + i);
    for (let i = 0; i < 12; i++) {
      s.rewards.rows.push({ id: 'x' + i, key_hash: i.toString(16).padStart(64, '0'), version: 1, kind: 'qualified', contributor: s.wallets.owner.pub, status: 'paid', ts: T0 });
    }
    s.addForm(); s.clock.t += 4 * DAY;
    for (let i = 0; i < 5; i++) await s.rate('u' + i, 5);
    assert.equal((await s.h.settle(await s.forms.get(KEY, 1), ENV)).paid.length, 0);
    assert.equal(s.mints.length, 0);
  });
});

describe('지급 실패·복구', () => {
  it('L1이 명시적으로 거절 → failed, 5분 뒤 자동 재시도로 성공', async () => {
    let calls = 0;
    const s = await setup({ mintImpl: async (e, a, mints) => { calls++; if (calls === 1) return { ok: false, error: 'L1_DOWN' }; mints.push(a); return { ok: true, gdc: a.krw, contentHash: 'h' }; } });
    await qualifiedScenario(s);
    const f = await s.forms.get(KEY, 1);
    assert.equal((await s.h.settle(f, ENV)).paid[0].status, 'failed');
    assert.equal((await s.h.settle(f, ENV)).paid.length, 0, '5분 이내 재시도 안 함');
    s.clock.t += 6 * 60 * 1000;
    assert.equal((await s.h.settle(f, ENV)).paid[0].status, 'paid');
    assert.equal(s.mints.length, 1);
  });
  it('3회 실패하면 자동 재시도를 멈춘다', async () => {
    const s = await setup({ mintImpl: async () => ({ ok: false, error: 'X' }) });
    await qualifiedScenario(s);
    const f = await s.forms.get(KEY, 1);
    for (let i = 0; i < 6; i++) { await s.h.settle(f, ENV); s.clock.t += 6 * 60 * 1000; }
    assert.equal(s.rewards.rows[0].attempts, 3); assert.equal(s.rewards.rows[0].status, 'failed');
  });
  it('mint 응답을 못 받으면 unknown — 이중 지급을 막기 위해 자동 재시도하지 않는다', async () => {
    const s = await setup({ mintImpl: async () => { throw new Error('network reset'); } });
    await qualifiedScenario(s);
    const f = await s.forms.get(KEY, 1);
    assert.equal((await s.h.settle(f, ENV)).paid[0].status, 'unknown');
    s.clock.t += 60 * 60 * 1000;
    assert.equal((await s.h.settle(f, ENV)).paid.length, 0);
    assert.equal(s.rewards.rows[0].status, 'unknown');
  });
  it('동시에 두 점검이 돌아도 보상 기록은 하나(CONFLICT 흡수)', async () => {
    const s = await setup(); await qualifiedScenario(s);
    const f = await s.forms.get(KEY, 1);
    await Promise.all([s.h.settle(f, ENV), s.h.settle(f, ENV)]);
    assert.equal(s.rewards.rows.length, 1);
  });
});

describe('내 현황 /doc-form/mine · 운영자 /doc-form/reward-admin', () => {
  it('본인 서명으로만 열리고 타인 서식은 보이지 않는다', async () => {
    const s = await setup(); await qualifiedScenario(s); await s.user('stranger');
    const mk = async g => { const ts = s.clock.t; return s.call('/doc-form/mine', { guid: g, ts, sig: await s.wallets[g].sign(mineMessage(g, ts)) }, 'POST', ENV); };
    const mine = await mk('owner');
    assert.equal(mine.status, 200); assert.equal(mine.j.rewardsEnabled, true);
    assert.equal(mine.j.items.length, 1); assert.equal(mine.j.items[0].rewards[0].status, 'paid'); assert.equal(mine.j.items[0].stats.count, 5);
    assert.equal((await mk('stranger')).j.items.length, 0);
    const bad = await s.call('/doc-form/mine', { guid: 'owner', ts: s.clock.t, sig: await s.wallets.stranger.sign(mineMessage('owner', s.clock.t)) }, 'POST', ENV);
    assert.equal(bad.status, 401);
  });
  it('운영자 void → 이후 지급 안 됨 / 일반 이용자는 403 / 지급 완료(paid)는 변경 불가', async () => {
    const s = await setup({ mintImpl: async () => ({ ok: false, error: 'X' }) });
    await qualifiedScenario(s); await s.user('admin'); await s.user('plain');
    await s.h.settle(await s.forms.get(KEY, 1), ENV);                         // failed 기록 생성
    const adm = async (g, action) => { const ts = s.clock.t; return s.call('/doc-form/reward-admin', { action, key_hash: KEY, version: 1, kind: 'qualified', guid: g, ts, sig: await s.wallets[g].sign(adminRewardMessage(action, KEY, 1, 'qualified', ts)) }, 'POST', { ...ENV, DOC_FORM_ADMINS: 'admin' }); };
    assert.equal((await adm('plain', 'void')).status, 403);
    assert.equal((await adm('admin', 'void')).j.status, 'void');
    s.clock.t += 10 * 60 * 1000;
    assert.equal((await s.h.settle(await s.forms.get(KEY, 1), ENV)).paid.length, 0);
    s.rewards.rows[0].status = 'paid';
    assert.equal((await adm('admin', 'void')).status, 409);
  });
  it('운영자 retry: unknown 건을 확인 후 재시도', async () => {
    let n = 0;
    const s = await setup({ mintImpl: async (e, a, mints) => { if (n++ === 0) throw new Error('timeout'); mints.push(a); return { ok: true, gdc: a.krw, contentHash: 'h' }; } });
    await qualifiedScenario(s); await s.user('admin');
    await s.h.settle(await s.forms.get(KEY, 1), ENV);
    assert.equal(s.rewards.rows[0].status, 'unknown');
    const ts = s.clock.t;
    const r = await s.call('/doc-form/reward-admin', { action: 'retry', key_hash: KEY, version: 1, kind: 'qualified', guid: 'admin', ts, sig: await s.wallets.admin.sign(adminRewardMessage('retry', KEY, 1, 'qualified', ts)) }, 'POST', { ...ENV, DOC_FORM_ADMINS: 'admin' });
    assert.equal(r.status, 200); assert.equal(s.rewards.rows[0].status, 'paid'); assert.equal(s.mints.length, 1);
  });
});

describe('규칙 상수', () => {
  it('정책 문서와 같은 값(변경 시 docs/DOC_FORM_REWARD_정책_20261017.md 도 함께 고칠 것)', () => {
    assert.equal(REWARD_RULES.MIN_RATERS, 5); assert.equal(REWARD_RULES.MIN_BAYES, 4.0); assert.equal(REWARD_RULES.MIN_POSITIVE_SHARE, 0.7);
    assert.equal(REWARD_RULES.EXCELLENT_RATERS, 20); assert.equal(REWARD_RULES.COOLING_MS, 3 * DAY); assert.equal(REWARD_RULES.RATER_MIN_AGE_MS, 7 * DAY);
    assert.equal(REWARD_RULES.CONTRIBUTOR_MONTH_MAX, 10); assert.equal(REWARD_RULES.RATER_DAILY_LIMIT, 30);
    assert.deepEqual([...REWARD_RULES.REWARD_SOURCES], ['user_attached']);
  });
});
