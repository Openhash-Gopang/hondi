import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makePocketBaseRatingStore, makePocketBaseRewardStore } from '../worker/doc-form-reward-store.js';
import { makePocketBaseDocFormStore } from '../worker/doc-form-store.js';
import { rateForm, fetchStats, fetchMine, statsLine, SHARE_NOTICE, REWARD_NOTICE } from '../gopang/ai/doc-form-client.js';
import { rateMessage, mineMessage, REWARD_RULES } from '../worker/doc-form-reward.js';

const read = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const K = 'a'.repeat(64);

// 요청을 기록하고 순서대로 응답을 돌려주는 가짜 PocketBase
function fake(responses) {
  const calls = [];
  const fetchImpl = async (url, opt = {}) => {
    calls.push({ url: decodeURIComponent(url), method: opt.method || 'GET', body: opt.body ? JSON.parse(opt.body) : null });
    const r = responses.shift() ?? { status: 200, body: { items: [], totalItems: 0, totalPages: 1 } };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body, text: async () => JSON.stringify(r.body) };
  };
  return { calls, cfg: { base: 'https://pb', getToken: async () => 't', fetchImpl } };
}
const page = (items, extra = {}) => ({ status: 200, body: { items, totalItems: items.length, totalPages: 1, ...extra } });

describe('평가 저장소 어댑터', () => {
  it('upsert: 이전 평가가 없으면 POST, 있으면 그 id 로 PATCH', async () => {
    let f = fake([page([]), { status: 200, body: { id: 'n1' } }]);
    await makePocketBaseRatingStore(f.cfg).upsert({ key_hash: K, version: 1, rater: 'r', rating: 5 });
    assert.equal(f.calls[1].method, 'POST');
    f = fake([page([{ id: 'old1' }]), { status: 200, body: { id: 'old1' } }]);
    await makePocketBaseRatingStore(f.cfg).upsert({ key_hash: K, version: 1, rater: 'r', rating: 3 });
    assert.equal(f.calls[1].method, 'PATCH'); assert.match(f.calls[1].url, /\/records\/old1$/);
  });
  it('listFor: 끝까지 페이지를 읽는다(보상 판정에서 잘림 없음)', async () => {
    const f = fake([page([{ rating: 5 }], { totalPages: 3 }), page([{ rating: 4 }], { totalPages: 3 }), page([{ rating: 3 }], { totalPages: 3 })]);
    const rows = await makePocketBaseRatingStore(f.cfg).listFor(K, 1);
    assert.equal(rows.length, 3); assert.equal(f.calls.length, 3);
    assert.match(f.calls[2].url, /page=3/);
  });
  it('필터의 작은따옴표·역슬래시는 이스케이프된다(인젝션 방지)', async () => {
    const f = fake([page([])]);
    await makePocketBaseRatingStore(f.cfg).hasRatedContributor("a'b\\c", 'x');
    assert.match(f.calls[0].url, /rater='a\\'b\\\\c'/);
  });
});

describe('보상 저장소 어댑터', () => {
  it('create: 400 + 이미 있음 → CONFLICT, 400 + 없음(검증 실패) → 삼키지 않고 오류', async () => {
    let f = fake([{ status: 400, body: { message: 'dup' } }, page([{ id: 'x' }])]);
    await assert.rejects(makePocketBaseRewardStore(f.cfg).create({ key_hash: K, version: 1, kind: 'qualified' }), /CONFLICT/);
    f = fake([{ status: 400, body: { message: 'bad field' } }, page([])]);
    await assert.rejects(makePocketBaseRewardStore(f.cfg).create({ key_hash: K, version: 1, kind: 'qualified' }), e => e.message !== 'CONFLICT' && /400/.test(e.message));
  });
  it('countSince: 취소·실패 건은 월 한도에 세지 않는다', async () => {
    const f = fake([page([], { totalItems: 4 })]);
    assert.equal(await makePocketBaseRewardStore(f.cfg).countSince('c', 1), 4);
    assert.match(f.calls[0].url, /status!='void' && status!='failed'/);
  });
});

describe('서식 저장소 추가 메서드', () => {
  it('earlierSameBody: 다른 key 의 먼저 저장된 같은 본문을 찾는다', async () => {
    const f = fake([page([{ id: 'z' }])]);
    assert.equal(await makePocketBaseDocFormStore(f.cfg).earlierSameBody('b'.repeat(64), 5000, K), true);
    assert.match(f.calls[0].url, /body_hash='b+' && key_hash!='a+' && ts<5000/);
  });
});

describe('클라이언트 평가·집계', () => {
  const wallet = { signed: [], async signPayload(m) { this.signed.push(m); return 'SIG'; } };
  it('rateForm: 서명 메시지 = rateMessage, used:true 로 전송', async () => {
    const f = fake([{ status: 200, body: { ok: true, counted: true, stats: { count: 1, avg: 5 } } }]);
    const r = await rateForm('https://w', wallet, 'g1', { keyHash: K, version: 2, rating: 4 }, { now: () => 777, fetchImpl: f.cfg.fetchImpl });
    assert.equal(r.ok, true); assert.equal(wallet.signed.at(-1), rateMessage(K, 2, 4, 777));
    assert.deepEqual(f.calls[0].body, { key_hash: K, version: 2, rating: 4, used: true, guid: 'g1', ts: 777, sig: 'SIG' });
  });
  it('rateForm: 서버 거절 코드를 돌려준다', async () => {
    const f = fake([{ status: 403, body: { ok: false, code: 'SELF_RATING', message: '본인이 올린 서식은 평가할 수 없습니다.' } }]);
    const r = await rateForm('https://w', wallet, 'g1', { keyHash: K, version: 1, rating: 5 }, { fetchImpl: f.cfg.fetchImpl });
    assert.deepEqual([r.ok, r.code], [false, 'SELF_RATING']);
  });
  it('fetchStats: 20개까지만 보내고 실패하면 빈 객체', async () => {
    const f = fake([{ status: 200, body: { ok: true, stats: { [K + ':1']: { count: 2, avg: 4.5 } } } }]);
    const pairs = Array.from({ length: 30 }, (_, i) => ({ keyHash: K, version: i + 1 }));
    assert.equal(Object.keys(await fetchStats('https://w', pairs, f.cfg.fetchImpl)).length, 1);
    assert.equal(f.calls[0].url.split('keys=')[1].split(',').length, 20);
    assert.deepEqual(await fetchStats('https://w', pairs, async () => { throw new Error('x'); }), {});
  });
  it('fetchMine: 서명 메시지 = mineMessage', async () => {
    const f = fake([{ status: 200, body: { ok: true, rewardsEnabled: false, items: [] } }]);
    const r = await fetchMine('https://w', wallet, 'g1', { now: () => 9, fetchImpl: f.cfg.fetchImpl });
    assert.equal(r.ok, true); assert.equal(wallet.signed.at(-1), mineMessage('g1', 9));
  });
  it('고지문: 숫자는 서버 규칙에서 가져오고, AI 구성 서식은 보상 대상 아님을 밝힌다', () => {
    assert.match(REWARD_NOTICE('user_attached'), new RegExp(REWARD_RULES.MIN_RATERS + '명'));
    assert.match(REWARD_NOTICE('user_attached'), /보장되지 않/);
    assert.match(REWARD_NOTICE('ai_composed'), /보상 대상이 아닙니다/);
    assert.match(SHARE_NOTICE('도선사'), /다른 이용자가 이 서식을 활용할 수 있습니다/);
    assert.equal(statsLine(null), '평가 모으는 중'); assert.equal(statsLine({ count: 12, avg: 4.6 }), '★4.6 · 12명 평가');
  });
});

describe('화면 배선(정적)', () => {
  const chat = read('pages/expert-chat.html');
  it('저장 카드에 게시·보상 고지가 있고, 서식 DB에서 찾은 경우 평가 카드가 뜬다', () => {
    assert.match(chat, /SHARE_NOTICE\(def\.label\)/); assert.match(chat, /REWARD_NOTICE\(p\.source\)/);
    assert.match(chat, /if \(foundForm && _meGuid\(\)\) _renderRatingCard\(foundForm\)/);
    assert.match(chat, /function _renderRatingCard/); assert.match(chat, /function _showMyForms/);
  });
  it('전문가 페이지 목록: 평가 열 · 새 서식 표시 · 보상 안내가 있고, 안내는 보장 아님을 밝힌다', () => {
    const js = read('assets/expert-shared-forms.js');
    assert.match(js, /명 평가/); assert.match(js, /평가 모으는 중/); assert.match(js, /새 서식/);
    assert.match(js, new RegExp('다른 이용자 ' + REWARD_RULES.MIN_RATERS + '명 이상'), '화면의 인원수 = 서버 규칙'); assert.match(js, /\/doc-form\/stats\?keys=/);
    assert.match(js, /GDC 보상이 지급될 수 있습니다/); assert.match(js, /AI가 구성한 서식은 대상이 아닙니다/);
  });
  it('SP_DOC_FORM v1.3: 카탈로그가 가리키고, 보상 문구는 단정하지 않는다', () => {
    const cat = JSON.parse(read('prompts/sp-catalog.json'));
    assert.equal(cat.SP_DOC_FORM, 'SP_DOC_FORM_v1_3.md');
    const sp = read('prompts/SP_DOC_FORM_v1_3.md');
    assert.match(sp.split('\n')[0], /v1\.3/); assert.match(sp, /### 8-5\./); assert.match(sp, /### 8-6\./);
    assert.match(sp, /보장되지 않습니다/); assert.match(sp, /받게 됩니다.가 아니라/);
    assert.ok(!/GDC를 받으려면|보상을 받으려면 저장/.test(sp), '보상을 저장의 이유로 내세우지 않는다');
  });
  it('worker.js 가 평가·보상 핸들러를 배선하고 지급 경로는 /api/mint 이다', () => {
    const w = read('worker.js');
    assert.match(w, /makeDocFormRewardHandler/); assert.match(w, /async function _mintFormReward/);
    assert.match(w, /\$\{L1_DEFAULT\}\/api\/mint[\s\S]{0,400}memo/);
  });
  it('정책 문서의 수치가 코드 규칙과 같다', () => {
    const doc = read('docs/DOC_FORM_REWARD_정책_20261017.md');
    assert.match(doc, new RegExp('인정 평가자 ' + REWARD_RULES.MIN_RATERS + '명 이상'));
    assert.match(doc, new RegExp('인정 평가자 ' + REWARD_RULES.EXCELLENT_RATERS + '명 이상'));
    assert.match(doc, /저장 후 72시간/); assert.match(doc, /가입 7일 이상/);
    assert.match(doc, new RegExp('평가자 하루 ' + REWARD_RULES.RATER_DAILY_LIMIT + '건 · 기여자 30일 ' + REWARD_RULES.CONTRIBUTOR_MONTH_MAX + '건'));
  });
  it('마이그레이션 2개: 유일 인덱스(평가자·서식당 1표 / 서식·종류당 1회 보상)', () => {
    assert.match(read('pb_migrations/1794900001_created_doc_form_ratings.js'), /UNIQUE INDEX[^"]*\(key_hash, version, rater\)/);
    assert.match(read('pb_migrations/1794900002_created_doc_form_rewards.js'), /UNIQUE INDEX[^"]*\(key_hash, version, kind\)/);
  });
});
