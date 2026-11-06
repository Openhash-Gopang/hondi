// src/worker/plan-pay.js — 유료 플랜 입금 확인(은행 입금 알림) 순수 함수 (2026-11-06, 주피터 지시: B안)
//
// 흐름
//   1) 사용자가 플랜 화면에서 등급을 고르면 서버가 "입금 요청"을 만든다(정확한 입금액·전화번호 뒤 8자리 매칭키 포함, 48시간 유효).
//   2) 사용자가 입금자명에 매칭키를 적어 입금하면, 관리자 폰의 은행 알림 → /biz/charge-confirm-notification 이 서버로 전달한다.
//   3) 서버는 알림의 매칭키로 입금 요청을 찾아 금액이 정확히 같으면 플랜을 지정(기간 30일, 같은 등급 연장은 만료일 뒤로 이어 붙임)한다.
//      → 플랜 요금은 GDC로 충전하지 않는다(B안). 금액이 다르면 자동 처리하지 않고 관리자에게 보이게 남긴다.
//   · 베타 테스트 기간(2026년 12월 말까지): 어느 등급을 고르든 $200 플랜을 90% 할인한 $20, 지정되는 등급은 p200.
import { FIELD_TEST_END_MS } from './charge-plans.js';

export const PLAN_LIST_USD = { p10: 10, p100: 100, p200: 200 };
export const PLAN_BETA_USD = 20;
export const PLAN_DAYS = 30;
export const PLAN_REQ_TTL_MS = 48 * 3600 * 1000;
export const DEFAULT_KRW_PER_USD = 1400;           // 환율을 못 가져올 때의 대체값(env PLAN_KRW_PER_USD로 바꿀 수 있다)

export const isBeta = (now = Date.now()) => Number(now) < FIELD_TEST_END_MS;
export const validTier = (t) => Object.prototype.hasOwnProperty.call(PLAN_LIST_USD, t);
export const planPriceUsd = (tier, now = Date.now()) => (isBeta(now) ? PLAN_BETA_USD : PLAN_LIST_USD[tier]);
export const grantedTier = (tier, now = Date.now()) => (isBeta(now) ? 'p200' : tier);
export const planKrw = (usd, krwPerUsd) => Math.ceil(Number(usd) * Number(krwPerUsd));

// 전화번호(E.164)에서 매칭키(뒤 8자리)
export const matchKeyOf = (e164) => { const d = String(e164 || '').replace(/\D/g, ''); return d.length >= 8 ? d.slice(-8) : null; };

export function makePlanRequest({ guid, e164, tier, krwPerUsd, now = Date.now() }) {
  if (!validTier(tier)) return null;
  const code = matchKeyOf(e164);
  if (!guid || !code) return null;
  const usd = planPriceUsd(tier, now);
  return { guid, code, tier, grant: grantedTier(tier, now), usd, krw: planKrw(usd, krwPerUsd), rate: Number(krwPerUsd), created: now, expires: now + PLAN_REQ_TTL_MS };
}

// 입금 알림 금액 ↔ 입금 요청 비교. 정확히 같아야 한다(분할·초과 입금은 자동 처리하지 않는다).
export function judgeDeposit(req, amountKrw, now = Date.now()) {
  if (!req) return { ok: false, reason: 'NO_PLAN_REQUEST' };
  if (now > Number(req.expires)) return { ok: false, reason: 'PLAN_REQUEST_EXPIRED' };
  if (Number(amountKrw) !== Number(req.krw)) return { ok: false, reason: 'PLAN_AMOUNT_MISMATCH' };
  return { ok: true, reason: 'OK' };
}

// 새 만료일: 같은 등급이 아직 유효하면 만료일 뒤로 이어 붙이고, 아니면 지금부터.
export function nextPaidUntil(current, grant, now = Date.now()) {
  const keep = current && current.tier === grant && Number(current.paid_until) > now;
  return (keep ? Number(current.paid_until) : now) + PLAN_DAYS * 86400000;
}
