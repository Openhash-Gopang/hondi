// 전문가용 AI 구독 계산 (2026-10-21, 계획 W5) — 순수 함수. 구독 장부(pro_subscriptions)와 인증 장부(pro_verifications)를 받아 "지금 쓸 수 있는가"를 계산한다.
//   · 접근권 = 구독이 덮는 기간 또는 무료 체험 기간. 체험은 "이 계정이 처음 승인받은 시각 + 체험 일수"(재신청으로 늘릴 수 없다).
//   · 구독은 연장(갱신) 시 만료 직후부터 이어 붙는다 → 덮는 구간을 이어서 계산(coveredUntil).
//   · 사용량 과금(GDC 종량)과는 별개다: 구독은 접근권, GDC 는 사용분.
export const DAY_MS = 24 * 60 * 60 * 1000;
export const SUB_YEAR_MS = 365 * DAY_MS;
export const DEFAULT_PRICE = 99000;
export const DEFAULT_TRIAL_DAYS = 7;
export const NOTICE_DAYS = [30, 7];

// 지금(now)부터 끊김 없이 이어지는 구독의 끝 시각. 지금 덮이지 않으면 0.
export function coveredUntil(rows, now = Date.now()) {
  const act = (rows || []).filter(r => r.status === 'active' && r.expires_ts > r.start_ts);
  let cur = now, moved = true, covered = false;
  while (moved) {
    moved = false;
    for (const r of act) if (r.start_ts <= cur && r.expires_ts > cur) { cur = r.expires_ts; moved = true; covered = true; }
  }
  return covered ? cur : 0;
}

// 이 계정이 처음 승인받은 시각 + 체험 일수. 승인 이력이 없으면 0(체험 시작 전).
export function trialUntil(verRows, trialDays = DEFAULT_TRIAL_DAYS) {
  const t = (verRows || []).filter(r => r.expires_ts && r.reviewed_ts && (r.status === 'approved' || r.status === 'revoked')).map(r => r.reviewed_ts);
  return t.length ? Math.min(...t) + trialDays * DAY_MS : 0;
}

// 세션 토큰에 실을 접근 가능 시각(= 구독 덮는 끝과 체험 끝 중 늦은 쪽, 이미 지났으면 0)과 상태 요약.
export function accessState(subRows, verRows, now = Date.now(), trialDays = DEFAULT_TRIAL_DAYS) {
  const subEnd = coveredUntil(subRows, now);
  const trialEnd = trialUntil(verRows, trialDays);
  const until = Math.max(subEnd, trialEnd > now ? trialEnd : 0);
  const everSubscribed = (subRows || []).some(r => r.status === 'active' || r.status === 'refunded');
  const daysLeft = until > now ? Math.ceil((until - now) / DAY_MS) : 0;
  let notice = null;
  if (until <= now) notice = 'expired';
  else if (subEnd <= now) notice = daysLeft <= 2 ? 'trial_ending' : 'trial';   // 체험 중
  else notice = daysLeft <= NOTICE_DAYS[1] ? 'expiring_7' : daysLeft <= NOTICE_DAYS[0] ? 'expiring_30' : null;
  return { until, sub_until: subEnd, trial_until: trialEnd > now ? trialEnd : 0, days_left: daysLeft, in_trial: subEnd <= now && trialEnd > now, ever_subscribed: everSubscribed, notice };
}

// 환불 제안액(초안 정책 — 약관 제9조 [검토]): 결제 후 7일 이내면 전액, 아니면 잔여 기간 비례. 최종 금액은 운영자가 정한다.
export function refundQuote(row, now = Date.now()) {
  const total = Math.max(1, row.expires_ts - row.start_ts), left = Math.max(0, row.expires_ts - Math.max(now, row.start_ts));
  const withinWindow = now - row.ts <= 7 * DAY_MS;
  const prorata = Math.floor(row.amount * left / total);
  return { paid: row.amount, days_total: Math.round(total / DAY_MS), days_left: Math.ceil(left / DAY_MS), prorata_amount: prorata, within_7d: withinWindow, suggested_amount: withinWindow ? row.amount : prorata, policy: 'draft' };
}
