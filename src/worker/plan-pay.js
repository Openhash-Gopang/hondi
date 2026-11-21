// src/worker/plan-pay.js — 유료 플랜 입금 확인(은행 입금 알림) 순수 함수 (2026-11-06, 주피터 지시: B안)
//
// 흐름
//   1) 사용자가 플랜 화면에서 등급을 고르면 서버가 "입금 요청"을 만든다(정확한 입금액·가입한 이름 포함, 48시간 유효).
//   2) 사용자가 가입한 이름으로 입금하면, 관리자 폰의 은행 알림 → /biz/charge-confirm-notification 이 서버로 전달한다.
//   3) 서버는 알림 문구에 이름이 있고 금액이 정확히 같은 입금 요청이 하나뿐이면 플랜을 지정(기간 30일, 같은 등급 연장은 만료일 뒤로 이어 붙임)한다.
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

// 입금자명 비교용 정리: 공백·점·가운데점·괄호·하이픈 등을 없애고 소문자로 맞춘다("홍 길동", "홍길동(주)" 같은 표기 차이 흡수).
export const normName = (s) => String(s == null ? '' : s).normalize('NFC').toLowerCase().replace(/[\s·.,\-_()（）\[\]{}'"]/g, '');
// 매칭에 쓸 이름 후보(가입한 이름·실명). 2자 미만은 오매칭 위험이 커서 쓰지 않는다.
export const nameCandidates = (...names) => [...new Set(names.map(normName).filter(n => n.length >= 2))];

// 입금 요청 만들기. 2026-11-21(주피터 지시): 전화번호 뒤 8자리 매칭키는 폐기했다 — 입금자 이름과 금액으로 맞춘다.
export function makePlanRequest({ guid, names, tier, krwPerUsd, now = Date.now() }) {
  if (!validTier(tier)) return null;
  const cands = nameCandidates(...(Array.isArray(names) ? names : [names]));
  if (!guid || !cands.length) return null;
  const usd = planPriceUsd(tier, now);
  return { guid, names: cands, tier, grant: grantedTier(tier, now), usd, krw: planKrw(usd, krwPerUsd), rate: Number(krwPerUsd), created: now, expires: now + PLAN_REQ_TTL_MS };
}

// 입금 알림 금액 ↔ 입금 요청 비교. 정확히 같아야 한다(분할·초과 입금은 자동 처리하지 않는다).
export function judgeDeposit(req, amountKrw, now = Date.now()) {
  if (!req) return { ok: false, reason: 'NO_PLAN_REQUEST' };
  if (now > Number(req.expires)) return { ok: false, reason: 'PLAN_REQUEST_EXPIRED' };
  if (Number(amountKrw) !== Number(req.krw)) return { ok: false, reason: 'PLAN_AMOUNT_MISMATCH' };
  return { ok: true, reason: 'OK' };
}

// 동명이인 구분(2026-11-21, 주피터 지시): 같은 이름의 다른 사용자가 같은 금액으로 이미 요청해 둔 상태라면, 나중에 요청한 사람의 입금액 끝자리를 1~9 중 무작위로 바꾼다.
//   · 원 단위를 10원 단위로 올린 뒤 1~9를 더하므로 정가보다 적게 받는 일은 없다(최대 +19원).
//   · 같은 이름의 다른 요청이 이미 쓰는 금액은 피한다. 겹치는 요청이 없으면 금액은 그대로다.
//   · others: 다른 사용자의 입금 요청들(만료되지 않은 것만 고려). rand: 0 이상 1 미만 난수 함수(시험용 주입).
export function distinctKrw(req, others, now = Date.now(), rand = Math.random) {
  const mine = new Set((req && req.names) || []);
  const peers = (others || []).filter(o => o && o.guid !== req.guid && Number(o.expires) >= now && Array.isArray(o.names) && o.names.some(n => mine.has(n)));
  const used = new Set(peers.map(o => Number(o.krw)));
  if (!used.has(Number(req.krw))) return req.krw;
  const base = Math.ceil(Number(req.krw) / 10) * 10;
  const free = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(d => !used.has(base + d));
  if (!free.length) return req.krw;            // 모두 쓰였으면(사실상 없음) 그대로 두고 이름·금액 중복은 관리자 확인으로 남긴다
  return base + free[Math.min(free.length - 1, Math.floor(rand() * free.length))];
}

// 알림 문구에 이름이 들어 있는 입금 요청만 고른다(만료·이름 없는 옛 요청은 제외).
export function requestsNamedIn(reqs, text, now = Date.now()) {
  const t = normName(text);
  if (!t) return [];
  return (reqs || []).filter(r => r && Number(r.expires) >= now && Array.isArray(r.names) && r.names.some(n => n && t.includes(n)));
}

// 이름과 금액으로 입금 요청 하나를 찾는다. 정확히 하나일 때만 자동 처리한다(동명이인·같은 금액 중복은 관리자 확인).
//   → { status: 'one', req } | { status: 'none' } | { status: 'ambiguous', reqs } | { status: 'mismatch', reqs }
export function matchPlanRequest(reqs, text, amountKrw, now = Date.now()) {
  const named = requestsNamedIn(reqs, text, now);
  if (!named.length) return { status: 'none' };
  const exact = named.filter(r => Number(r.krw) === Number(amountKrw));
  if (exact.length === 1) return { status: 'one', req: exact[0] };
  if (exact.length > 1) return { status: 'ambiguous', reqs: exact };
  return { status: 'mismatch', reqs: named };
}

// 새 만료일: 같은 등급이 아직 유효하면 만료일 뒤로 이어 붙이고, 아니면 지금부터.
export function nextPaidUntil(current, grant, now = Date.now()) {
  const keep = current && current.tier === grant && Number(current.paid_until) > now;
  return (keep ? Number(current.paid_until) : now) + PLAN_DAYS * 86400000;
}
