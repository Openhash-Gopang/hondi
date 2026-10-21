// ═════════════════════════════════════════════════
// 전문가용 AI 구독 API (2026-10-21 신설) — 계획 W5: 전문가·직원 각각 연 99,000원, 초기에는 수동 입금 확인 후 관리자 부여.
//
//   GET  /pro-sub/status?guid=   → 내 구독·체험·잔여일·안내(notice: expiring_30|expiring_7|expired|trial|trial_ending|null)
//   POST /pro-sub/grant   (운영자) { target_guid, kind, pay_ref, amount?, months?, note? }  입금 확인 후 구독 부여·연장
//   POST /pro-sub/quote   (운영자) { id }                 환불 제안액(7일 이내 전액, 아니면 잔여 기간 비례 — 초안 정책)
//   POST /pro-sub/refund  (운영자) { id, amount, note }   환불 처리(구독 종료). 실제 송금은 운영자가 따로 한다.
//   POST /pro-sub/list    (운영자) { within_days? }        만료 임박·최근 부여·유효 구독 수(관리자 집계)
//
// 원칙
//   · 구독은 접근권이고, 사용량은 GDC 종량으로 따로 과금한다(둘은 독립).
//   · pay_ref(입금자명·입금 참조)는 필수이며 중복 부여를 막는다. 카드번호·계좌번호는 받지도 저장하지도 않는다.
//   · 연장은 현재 구독 만료 직후부터 이어 붙는다. 환불 시 해당 구간만 사라진다(coveredUntil 로 이어진 구간 재계산).
//   · 게이트는 세션 토큰의 sub 시각만 본다(pro-session.js) — 부여·환불은 토큰 수명(4시간) 안에 반영된다.
//   · 운영자 인증은 pro-verify 와 같다: 관리자 페이지 Bearer 또는 PRO_VERIFY_ADMINS 지갑 서명.
// ═════════════════════════════════════════════════
import { verifySig } from '../gopang/ai/hondi-digit-claim.js';
import { accessState, coveredUntil, refundQuote, SUB_YEAR_MS, DAY_MS, DEFAULT_PRICE, DEFAULT_TRIAL_DAYS } from './pro-sub-core.js';

const json = (body, status, cors = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors } });
const err = (status, code, message, cors) => json({ ok: false, code, message }, status, cors);
const KINDS = ['professional', 'staff'];

export const grantMessage = (targetGuid, kind, payRef, ts) => `hondi-pro-sub\ngrant\n${targetGuid}\n${kind}\n${payRef}\n${ts}`;
export const quoteMessage = (id, ts) => `hondi-pro-sub\nquote\n${id}\n${ts}`;
export const refundMessage = (id, ts) => `hondi-pro-sub\nrefund\n${id}\n${ts}`;
export const listMessage = ts => `hondi-pro-sub\nlist\n${ts}`;

const pub = r => ({ id: r.id, kind: r.kind, status: r.status, start_ts: r.start_ts, expires_ts: r.expires_ts, amount: r.amount, refund_amount: r.refund_amount || 0, refund_ts: r.refund_ts || null });

export function makeProSubHandler({ store, verStore, getPinnedPubKey, bearerAdmin = null, now = () => Date.now(), maxSkewMs = 5 * 60 * 1000 }) {
  if (!store || !verStore || typeof getPinnedPubKey !== 'function') throw new Error('makeProSubHandler: store, verStore, getPinnedPubKey 필요');
  const trialDays = env => { const n = Number(env?.PRO_TRIAL_DAYS); return Number.isFinite(n) && n >= 0 && n <= 90 ? n : DEFAULT_TRIAL_DAYS; };

  async function requireAdmin(env, b, message, cors, request) {
    const auth = request?.headers?.get?.('Authorization') || '';
    if (bearerAdmin && /^Bearer\s+\S+/i.test(auth)) {
      const who = await bearerAdmin(request, env);
      return who ? { pinned: 'admin:' + String(who).slice(0, 60) } : { res: err(401, 'UNAUTHORIZED', '관리자 인증이 필요합니다.', cors) };
    }
    const admins = String(env?.PRO_VERIFY_ADMINS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!admins.length) return { res: err(503, 'NO_ADMIN', '운영자가 설정되지 않았습니다(PRO_VERIFY_ADMINS).', cors) };
    if (!b.guid || !b.sig || !Number.isInteger(b.ts)) return { res: err(400, 'MISSING', '요청 형식이 올바르지 않습니다.', cors) };
    if (Math.abs(now() - b.ts) > maxSkewMs) return { res: err(400, 'STALE_TS', '시각 차이가 너무 큽니다.', cors) };
    const pinned = await getPinnedPubKey(env, b.guid);
    if (!pinned) return { res: err(404, 'NO_ACCOUNT', '계정을 찾을 수 없습니다.', cors) };
    if (!admins.includes(b.guid) && !admins.includes(pinned)) return { res: err(403, 'NOT_ADMIN', '운영 권한이 없습니다.', cors) };
    if (!(await verifySig(pinned, message, b.sig))) return { res: err(401, 'BAD_SIG', '서명이 유효하지 않습니다.', cors) };
    return { pinned };
  }

  return {
    async handle(request, url, env, cors = {}) {
      const path = url.pathname;
      if (!path.startsWith('/pro-sub/')) return null;
      try {
        if (request.method === 'GET' && path === '/pro-sub/status') {
          const guid = (url.searchParams.get('guid') || '').trim();
          if (!guid) return err(400, 'MISSING_GUID', 'guid 필수', cors);
          const pinned = await getPinnedPubKey(env, guid);
          if (!pinned) return err(404, 'NO_ACCOUNT', '계정을 찾을 수 없습니다.', cors);
          const [subs, vers] = await Promise.all([store.listByPubkey(pinned), verStore.listByPubkey(pinned)]);
          const st = accessState(subs, vers, now(), trialDays(env));
          return json({ ok: true, price: DEFAULT_PRICE, ...st, items: subs.map(pub) }, 200, cors);
        }

        if (request.method === 'POST' && path === '/pro-sub/grant') {
          const b = await request.json().catch(() => null) || {};
          const payRef = String(b.pay_ref || '').trim();
          if (!b.target_guid || !KINDS.includes(b.kind) || payRef.length < 2 || payRef.length > 60) return err(400, 'MISSING', 'target_guid, kind(professional|staff), pay_ref(2~60자)가 필요합니다.', cors);
          const a = await requireAdmin(env, b, grantMessage(b.target_guid, b.kind, payRef, b.ts), cors, request); if (a.res) return a.res;
          const months = b.months === undefined ? 12 : Number(b.months);
          if (!Number.isInteger(months) || months < 1 || months > 24) return err(400, 'MONTHS', 'months 는 1~24 의 정수여야 합니다.', cors);
          const amount = b.amount === undefined ? Math.round(DEFAULT_PRICE * months / 12) : Number(b.amount);
          if (!Number.isInteger(amount) || amount < 0 || amount > 10_000_000) return err(400, 'AMOUNT', 'amount 가 올바르지 않습니다.', cors);
          const target = await getPinnedPubKey(env, b.target_guid);
          if (!target) return err(404, 'NO_ACCOUNT', '대상 계정을 찾을 수 없습니다.', cors);
          if (await store.findByPayRef(payRef)) return err(409, 'DUP_PAY_REF', '이미 처리된 입금 참조입니다(중복 부여 방지).', cors);
          const t = now();
          const mine = await store.listByPubkey(target);
          const base = Math.max(t, coveredUntil(mine, t) || t);       // 지금 덮이고 있으면 그 끝부터 이어 붙인다
          const span = months === 12 ? SUB_YEAR_MS : Math.round(SUB_YEAR_MS * months / 12);
          const rec = { subscriber_pubkey: target, kind: b.kind, status: 'active', start_ts: base, expires_ts: base + span, amount, pay_ref: payRef, granted_by: a.pinned, note: String(b.note || '').slice(0, 300), ts: t };
          const saved = await store.create(rec);
          const after = await store.listByPubkey(target);
          return json({ ok: true, subscription: pub({ ...rec, id: saved?.id }), covered_until: coveredUntil(after.some(r => r.id === saved?.id) ? after : [...after, rec], t) }, 200, cors);
        }

        if (request.method === 'POST' && (path === '/pro-sub/quote' || path === '/pro-sub/refund')) {
          const b = await request.json().catch(() => null) || {};
          if (!/^[a-z0-9]{15}$/.test(b.id || '')) return err(400, 'MISSING', 'id가 필요합니다.', cors);
          const isRefund = path === '/pro-sub/refund';
          const a = await requireAdmin(env, b, (isRefund ? refundMessage : quoteMessage)(b.id, b.ts), cors, request); if (a.res) return a.res;
          const rec = await store.get(b.id);
          if (!rec) return err(404, 'NO_RECORD', '구독을 찾을 수 없습니다.', cors);
          if (rec.status !== 'active') return err(409, 'INVALID_STATE', `활성 구독만 처리할 수 있습니다(현재: ${rec.status}).`, cors);
          const t = now(), quote = refundQuote(rec, t);
          if (!isRefund) return json({ ok: true, quote }, 200, cors);
          const amount = Number(b.amount), note = String(b.note || '').slice(0, 300);
          if (!Number.isInteger(amount) || amount < 0 || amount > rec.amount) return err(400, 'AMOUNT', `환불액은 0~${rec.amount} 의 정수여야 합니다.`, cors);
          if (!note) return err(400, 'NOTE', '환불 사유(note)가 필요합니다.', cors);
          await store.update(b.id, { status: 'refunded', refund_ts: t, refund_amount: amount, refund_note: note });
          const rest = (await store.listByPubkey(rec.subscriber_pubkey)).map(r => r.id === b.id ? { ...r, status: 'refunded' } : r);
          return json({ ok: true, status: 'refunded', refund_amount: amount, covered_until: coveredUntil(rest, t), note: '실제 송금은 운영자가 따로 처리해야 합니다.' }, 200, cors);
        }

        if (request.method === 'POST' && path === '/pro-sub/list') {
          const b = await request.json().catch(() => null) || {};
          const a = await requireAdmin(env, b, listMessage(b.ts), cors, request); if (a.res) return a.res;
          const t = now(), within = Math.min(Math.max(Number(b.within_days) | 0 || 30, 1), 365);
          const [exp, recent, active] = await Promise.all([store.listExpiring(t, t + within * DAY_MS), store.listRecent(30), store.countActive(t)]);
          const row = r => ({ ...pub(r), subscriber: String(r.subscriber_pubkey).slice(0, 12), pay_ref: r.pay_ref, days_left: Math.ceil((r.expires_ts - t) / DAY_MS) });
          return json({ ok: true, active_count: active, expiring: exp.map(row), recent: recent.map(row) }, 200, cors);
        }

        return err(404, 'NOT_FOUND', '알 수 없는 경로입니다.', cors);
      } catch (e) {
        return err(502, 'PRO_SUB_FAILED', String(e?.message || e).slice(0, 200), cors);
      }
    },
  };
}
