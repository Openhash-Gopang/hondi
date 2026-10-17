// ═════════════════════════════════════════════════
// 서식 평가·보상 (2026-10-17 신설) — 서식 DB(doc-form-handler.js) 위에 얹는 층
//
//   POST /doc-form/rate          { key_hash, version, rating(1~5), used:true, guid, ts, sig }   서식을 써 본 이용자의 평가(지갑 서명)
//   GET  /doc-form/stats?keys=<key_hash>:<version>,…                                              공개 집계(평가 수·평균). 신원 없음
//   POST /doc-form/mine          { guid, ts, sig }                                                 내가 올린 서식의 집계와 보상 상태(본인 서명)
//   POST /doc-form/reward-admin  { action:'void'|'retry', key_hash, version, kind, guid, ts, sig } 운영자 전용
//
// 보상 규칙 (모든 수치는 REWARD_RULES — 코드가 정본, docs/DOC_FORM_REWARD_정책_20261017.md 참조)
//   · 대상: 어떤 서식(key_hash)을 **처음** 저장한 이용자(그 key의 version 1 기여자)만. 개정본(version ≥ 2) 기여자는 받지 않는다.
//   · 조건: 본인 외 서로 다른 이용자 5명 이상이 "써 봤다"고 서명해 평가했고, 보정 평균 ≥ 4.0, 4~5점 비율 ≥ 70%.
//           우수(excellent)는 20명 이상·보정 평균 ≥ 4.5·4~5점 비율 ≥ 85% — 기본 보상과 같은 액수를 한 번 더.
//   · 인정되는 평가: 가입 7일 이상 계정 · 본인 서식 아님 · 서로 평가해 주기(상호 평가) 아님 · 같은 이용자는 서식당 1표(고쳐 쓰면 덮어씀)
//   · 저장 후 72시간이 지나야 지급(담합·오남용 점검 시간). 같은 본문이 이미 다른 서식으로 있으면 제외.
//   · 보상 대상 출처는 user_attached(이용자가 실제 서식을 가져온 경우)만. AI가 지어낸 서식(ai_composed)은 제외.
//   · 기여자당 30일 최대 10건. 운영자(DOC_FORM_ADMINS)가 올린 서식은 제외.
//   · 지급 = L1 /api/mint (가입 축하 충전과 같은 경로, memo "form_reward:…"). env.DOC_FORM_REWARD_KRW(원 상당, 1:1)가 0이거나 없으면 **지급하지 않는다**(평가·집계만 한다).
//   · 멱등: (key_hash, version, kind) 유일. mint가 명시적으로 실패하면 failed(최대 3회·5분 간격 자동 재시도), 응답을 못 받았으면 unknown(운영자 확인 전 재시도하지 않음).
//
// 공개 응답에는 기여자·평가자 식별자를 싣지 않는다.
// ═════════════════════════════════════════════════
import { verifySig } from '../gopang/ai/hondi-digit-claim.js';

const DAY = 24 * 60 * 60 * 1000;
export const REWARD_RULES = Object.freeze({
  MIN_RATERS: 5, MIN_BAYES: 4.0, MIN_POSITIVE_SHARE: 0.7,
  EXCELLENT_RATERS: 20, EXCELLENT_BAYES: 4.5, EXCELLENT_POSITIVE_SHARE: 0.85,
  PRIOR_MEAN: 3, PRIOR_N: 2,
  COOLING_MS: 3 * DAY, RATER_MIN_AGE_MS: 7 * DAY,
  RATER_DAILY_LIMIT: 30, CONTRIBUTOR_MONTH_MAX: 10, MONTH_MS: 30 * DAY,
  RETRY_MAX: 3, RETRY_GAP_MS: 5 * 60 * 1000,
  REWARD_SOURCES: Object.freeze(['user_attached']),
});

const json = (body, status, cors = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors } });
const err = (status, code, message, cors, extra = {}) => json({ ok: false, code, message, ...extra }, status, cors);
const HEX64 = /^[0-9a-f]{64}$/;

export const rateMessage = (keyHash, version, rating, ts) => `hondi-doc-form-rate\n${keyHash}\n${version}\n${rating}\n${ts}`;
export const mineMessage = (guid, ts) => `hondi-doc-form-mine\n${guid}\n${ts}`;
export const adminRewardMessage = (action, keyHash, version, kind, ts) => `hondi-doc-form-reward-admin\n${action}\n${keyHash}\n${version}\n${kind}\n${ts}`;

// ── 순수 계산 ─────────────────────────────────────────
// ratings: [{rating:1~5}] (이미 인정 평가만 걸러진 것). 평점이 적을 때 요동치지 않도록 중립(3점) 가상 2표를 섞어 보정한다.
export function scoreRatings(ratings, rules = REWARD_RULES) {
  const n = ratings.length;
  const sum = ratings.reduce((a, r) => a + r.rating, 0);
  const pos = ratings.filter(r => r.rating >= 4).length;
  return {
    count: n,
    avg: n ? sum / n : 0,
    bayes: (sum + rules.PRIOR_MEAN * rules.PRIOR_N) / (n + rules.PRIOR_N),
    positiveShare: n ? pos / n : 0,
  };
}
export const qualifies = (s, r = REWARD_RULES) => s.count >= r.MIN_RATERS && s.bayes >= r.MIN_BAYES && s.positiveShare >= r.MIN_POSITIVE_SHARE;
export const isExcellent = (s, r = REWARD_RULES) => qualifies(s, r) && s.count >= r.EXCELLENT_RATERS && s.bayes >= r.EXCELLENT_BAYES && s.positiveShare >= r.EXCELLENT_POSITIVE_SHARE;

const publicStats = (s) => ({ count: s.count, avg: Math.round(s.avg * 10) / 10 });

export function makeDocFormRewardHandler({
  formStore,       // latest/get/earlierSameBody (doc-form-store.js)
  ratingStore,     // upsert/find/listFor/countSince/hasRatedContributor
  rewardStore,     // get/create/update/countSince/listByContributor
  getPinnedPubKey, // (env, guid) → pubkey | null
  getAccount,      // (env, guid) → { createdTs } | null     (평가자 계정 나이)
  mint,            // (env, { pubkey, krw, memo }) → { ok, gdc?, contentHash?, error? }   throw = 응답 불명
  now = () => Date.now(), maxSkewMs = 10 * 60 * 1000, rules = REWARD_RULES,
}) {
  if (!formStore?.get || !ratingStore?.upsert || !rewardStore?.create) throw new Error('makeDocFormRewardHandler: 저장소 필요');
  if (typeof getPinnedPubKey !== 'function') throw new Error('makeDocFormRewardHandler: getPinnedPubKey 필요');

  const baseKrw = (env) => { const v = Number(env?.DOC_FORM_REWARD_KRW); return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0; };

  async function isAdminPub(env, pub) {
    const admins = String(env?.DOC_FORM_ADMINS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (admins.includes(pub)) return true;
    for (const a of admins) { try { if ((await getPinnedPubKey(env, a)) === pub) return true; } catch { /* 해석 실패는 운영자 아님으로 */ } }
    return false;
  }

  // 인정 평가: 계정 나이 통과(eligible) · 본인 아님 · 상호 평가 아님.
  async function countedRatings(form, rows, { checkRing }) {
    const base = rows.filter(r => r.eligible && r.rater !== form.contributor);
    if (!checkRing) return base;
    const out = [];
    for (const r of base) if (!(await ratingStore.hasRatedContributor(form.contributor, r.rater))) out.push(r);
    return out;
  }

  async function statsOf(form) {
    const rows = await ratingStore.listFor(form.key_hash, form.version);
    return scoreRatings(await countedRatings(form, rows, { checkRing: false }));
  }

  // 지급 점검 — 평가가 들어올 때와 기여자가 자기 현황을 볼 때 부른다. 조건이 안 되면 아무것도 하지 않는다.
  async function settle(form, env) {
    const krw = baseKrw(env);
    if (!krw) return { skipped: 'disabled' };
    if (form.version !== 1) return { skipped: 'not_first' };
    if (!rules.REWARD_SOURCES.includes(form.source)) return { skipped: 'source' };
    if (now() - form.ts < rules.COOLING_MS) return { skipped: 'cooling' };
    if (await isAdminPub(env, form.contributor)) return { skipped: 'admin' };
    if (typeof formStore.earlierSameBody === 'function' && await formStore.earlierSameBody(form.body_hash, form.ts, form.key_hash)) return { skipped: 'duplicate_body' };

    const rows = await ratingStore.listFor(form.key_hash, form.version);
    // 싼 검사(상호 평가 조회 없음)로 먼저 걸러 PocketBase 조회를 아낀다.
    if (!qualifies(scoreRatings(await countedRatings(form, rows, { checkRing: false })), rules)) return { skipped: 'not_qualified' };
    const stats = scoreRatings(await countedRatings(form, rows, { checkRing: true }), rules);
    if (!qualifies(stats, rules)) return { skipped: 'not_qualified' };

    const due = ['qualified'];
    if (isExcellent(stats, rules)) due.push('excellent');
    const paid = [];
    for (const kind of due) {
      const r = await payKind(form, kind, krw, stats, env);
      if (r) paid.push(r);
    }
    return { paid };
  }

  async function payKind(form, kind, krw, stats, env) {
    let row = await rewardStore.get(form.key_hash, form.version, kind);
    if (row) {
      // 이미 시도된 건: 명시적 실패만 자동 재시도. paid·minting·unknown·void 는 건드리지 않는다.
      if (row.status !== 'failed' || (row.attempts || 0) >= rules.RETRY_MAX || now() - (row.attempt_ts || 0) < rules.RETRY_GAP_MS) return null;
    } else {
      const since = now() - rules.MONTH_MS;
      if ((await rewardStore.countSince(form.contributor, since)) >= rules.CONTRIBUTOR_MONTH_MAX) return null;
      try {
        row = await rewardStore.create({
          key_hash: form.key_hash, version: form.version, kind, contributor: form.contributor, amount_krw: krw,
          status: 'minting', attempts: 0, attempt_ts: now(), ts: now(),
          stats: { count: stats.count, avg: Math.round(stats.avg * 100) / 100, bayes: Math.round(stats.bayes * 100) / 100, positive: Math.round(stats.positiveShare * 100) / 100 },
        });
      } catch (e) { if (e.message === 'CONFLICT') return null; throw e; }   // 다른 요청이 먼저 만들었다
    }
    await rewardStore.update(row.id, { status: 'minting', attempts: (row.attempts || 0) + 1, attempt_ts: now() });
    const memo = `form_reward:${kind}:${form.key_hash.slice(0, 12)}:v${form.version}`;
    let res;
    try { res = await mint(env, { pubkey: form.contributor, krw, memo }); }
    catch (e) {
      // 요청을 보냈는데 결과를 모른다 — 이미 지급됐을 수 있으므로 자동 재시도하지 않는다.
      await rewardStore.update(row.id, { status: 'unknown', error: String(e.message || e).slice(0, 200) });
      console.error('[DocFormReward] mint 응답 불명', kind, form.key_hash.slice(0, 12), e.message);
      return { kind, status: 'unknown' };
    }
    if (!res?.ok) {
      await rewardStore.update(row.id, { status: 'failed', error: String(res?.error || 'MINT_FAILED').slice(0, 200) });
      return { kind, status: 'failed' };
    }
    await rewardStore.update(row.id, { status: 'paid', gdc: Number(res.gdc) || krw, mint_hash: String(res.contentHash || '').slice(0, 100), paid_ts: now(), error: '' });
    console.log(JSON.stringify({ tag: 'DOC_FORM_REWARD_PAID', kind, key: form.key_hash.slice(0, 12), krw, ts: new Date(now()).toISOString() }));
    return { kind, status: 'paid' };
  }

  async function handle(request, url, env, cors = {}) {
    const path = url.pathname;
    const nocache = { 'Cache-Control': 'no-store', ...cors };
    const mine = ['/doc-form/rate', '/doc-form/stats', '/doc-form/mine', '/doc-form/reward-admin'];
    if (!mine.includes(path)) return null;
    try {
      // ── 공개 집계 ──
      if (request.method === 'GET' && path === '/doc-form/stats') {
        const keys = String(url.searchParams.get('keys') || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 20);
        const out = {};
        for (const k of keys) {
          const [kh, v] = k.split(':'); const ver = Number(v);
          if (!HEX64.test(kh || '') || !Number.isInteger(ver) || ver < 1) continue;
          const form = await formStore.get(kh, ver);
          if (form) out[k] = publicStats(await statsOf(form));
        }
        return json({ ok: true, stats: out }, 200, { 'Cache-Control': 'public, max-age=60', ...cors });
      }

      // ── 평가 ──
      if (request.method === 'POST' && path === '/doc-form/rate') {
        const b = await request.json().catch(() => null) || {};
        const { key_hash: kh, version, rating, guid, sig } = b;
        if (!HEX64.test(kh || '') || !Number.isInteger(version) || version < 1 || !Number.isInteger(rating) || rating < 1 || rating > 5 || !guid || !sig || !Number.isInteger(b.ts)) return err(400, 'MISSING', '평가 형식이 올바르지 않습니다.', cors);
        if (b.used !== true) return err(400, 'NOT_USED', '써 본 서식만 평가할 수 있습니다.', cors);
        if (Math.abs(now() - b.ts) > maxSkewMs) return err(400, 'STALE_TS', '시각 차이가 너무 큽니다. 기기 시계를 확인해 주세요.', cors);
        const pinned = await getPinnedPubKey(env, guid);
        if (!pinned) return err(404, 'NO_ACCOUNT', '계정을 찾을 수 없습니다.', cors);
        if (!(await verifySig(pinned, rateMessage(kh, version, rating, b.ts), sig))) return err(401, 'BAD_SIG', '서명이 유효하지 않습니다.', cors);
        const form = await formStore.get(kh, version);
        if (!form) return err(404, 'NO_FORM', '그 서식 버전이 없습니다.', cors);
        if (form.contributor === pinned) return err(403, 'SELF_RATING', '본인이 올린 서식은 평가할 수 없습니다.', cors);

        const prev = await ratingStore.find(kh, version, pinned);
        if (!prev && (await ratingStore.countSince(pinned, now() - DAY)) >= rules.RATER_DAILY_LIMIT) return err(429, 'RATE', `하루 ${rules.RATER_DAILY_LIMIT}건까지 평가할 수 있습니다.`, cors);
        let created = null;
        try { created = (await getAccount(env, guid))?.createdTs ?? null; } catch { created = null; }
        const eligible = created != null && now() - created >= rules.RATER_MIN_AGE_MS;
        await ratingStore.upsert({ key_hash: kh, version, rater: pinned, rating, eligible, form_contributor: form.contributor, ts: now(), sig });

        try { await settle(form, env); } catch (e) { console.error('[DocFormReward] settle 실패', e.message); }   // 평가자에게는 지급 여부를 알리지 않는다
        return json({ ok: true, counted: eligible, stats: publicStats(await statsOf(form)) }, 200, nocache);
      }

      // ── 내 현황(본인 서명) ──
      if (request.method === 'POST' && path === '/doc-form/mine') {
        const b = await request.json().catch(() => null) || {};
        const { guid, sig } = b;
        if (!guid || !sig || !Number.isInteger(b.ts)) return err(400, 'MISSING', '요청 형식이 올바르지 않습니다.', cors);
        if (Math.abs(now() - b.ts) > maxSkewMs) return err(400, 'STALE_TS', '시각 차이가 너무 큽니다.', cors);
        const pinned = await getPinnedPubKey(env, guid);
        if (!pinned) return err(404, 'NO_ACCOUNT', '계정을 찾을 수 없습니다.', cors);
        if (!(await verifySig(pinned, mineMessage(guid, b.ts), sig))) return err(401, 'BAD_SIG', '서명이 유효하지 않습니다.', cors);
        const forms = await formStore.listByContributor(pinned, 50);
        const items = [];
        for (const f of forms) {
          if (f.version === 1) { try { await settle(f, env); } catch (e) { console.error('[DocFormReward] settle 실패', e.message); } }
          const rewards = f.version === 1 ? await rewardStore.listForForm(f.key_hash, f.version) : [];
          items.push({
            keyHash: f.key_hash, version: f.version, agency: f.agency, name: f.name, savedTs: f.ts,
            rewardEligible: f.version === 1 && rules.REWARD_SOURCES.includes(f.source),
            stats: publicStats(await statsOf(f)),
            rewards: rewards.map(r => ({ kind: r.kind, status: r.status, amountKrw: r.amount_krw, paidTs: r.paid_ts || null })),
          });
        }
        return json({ ok: true, rewardsEnabled: baseKrw(env) > 0, items }, 200, nocache);
      }

      // ── 운영자: 무효·재시도 ──
      if (request.method === 'POST' && path === '/doc-form/reward-admin') {
        const b = await request.json().catch(() => null) || {};
        const { action, key_hash: kh, version, kind, guid, sig } = b;
        if (!['void', 'retry'].includes(action) || !HEX64.test(kh || '') || !Number.isInteger(version) || !['qualified', 'excellent'].includes(kind) || !guid || !sig || !Number.isInteger(b.ts)) return err(400, 'MISSING', '요청 형식이 올바르지 않습니다.', cors);
        if (Math.abs(now() - b.ts) > maxSkewMs) return err(400, 'STALE_TS', '시각 차이가 너무 큽니다.', cors);
        const pinned = await getPinnedPubKey(env, guid);
        if (!pinned) return err(404, 'NO_ACCOUNT', '계정을 찾을 수 없습니다.', cors);
        if (!(await isAdminPub(env, pinned))) return err(403, 'NOT_ADMIN', '운영 권한이 없습니다.', cors);
        if (!(await verifySig(pinned, adminRewardMessage(action, kh, version, kind, b.ts), sig))) return err(401, 'BAD_SIG', '서명이 유효하지 않습니다.', cors);
        const row = await rewardStore.get(kh, version, kind);
        if (!row) return err(404, 'NO_REWARD', '그 보상 기록이 없습니다.', cors);
        if (row.status === 'paid' || row.status === 'minting') return err(409, 'ALREADY', `상태가 ${row.status}인 보상은 바꿀 수 없습니다.`, cors);
        if (action === 'void') { await rewardStore.update(row.id, { status: 'void', error: 'admin_void' }); return json({ ok: true, status: 'void' }, 200, cors); }
        // retry: 운영자가 L1 원장에서 실제로 지급되지 않았음을 확인한 failed/unknown 만. 재시도 횟수를 비운다.
        await rewardStore.update(row.id, { status: 'failed', attempts: 0, attempt_ts: 0, error: 'admin_retry' });
        const form = await formStore.get(kh, version);
        const r = form ? await settle(form, env) : { skipped: 'no_form' };
        return json({ ok: true, result: r }, 200, cors);
      }

      return err(404, 'NOT_FOUND', '알 수 없는 경로입니다.', cors);
    } catch (e) {
      console.error('[DocFormReward]', e.message);
      return err(500, 'INTERNAL', '서버 오류가 발생했습니다.', cors);
    }
  }

  return { handle, settle, statsOf };
}
