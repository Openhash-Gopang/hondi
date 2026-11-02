// src/worker/charge-plans.js — 필드 테스트 기간의 정액 입금 → 지급 GDC (순수 함수)
//
// 정책(2026-11-02, 주피터 지시):
//   · 필드 테스트 기간(2026년 12월 말까지)에는 아래 두 금액을 정확히 입금하면 정해진 GDC를 지급한다.
//       월  10,000원 입금 → GDC 100,000 지급
//       연 100,000원 입금 → GDC 120,000 지급
//   · 그 밖의 금액과 기간이 끝난 뒤에는 기존 구간별 보너스 배율(worker.js _computeChargeBonusGdc)을 따른다.
//   · "월/연"은 화면에 붙이는 이름일 뿐이다 — 지급된 GDC는 만료·기간 제한 없이 일반 잔액과 같이 쓴다(A안 유지).
//   · 금액은 1회 입금 건별로 정확히 일치할 때만 적용한다(분할 입금·초과 입금은 합산하지 않는다).

export const FIELD_TEST_END_MS = Date.parse('2027-01-01T00:00:00+09:00');   // 2026-12-31 24:00 KST 직전까지

export const FIELD_TEST_PLANS = [
  { krw: 10000,  gdc: 100000, label: '월' },
  { krw: 100000, gdc: 120000, label: '연' },
];

// 해당 입금액이 필드 테스트 정액이면 지급 GDC, 아니면 null.
export function fieldTestPlanGdc(confirmedKrw, now = Date.now()) {
  if (!(Number(now) < FIELD_TEST_END_MS)) return null;
  const krw = Number(confirmedKrw);
  const plan = FIELD_TEST_PLANS.find(p => p.krw === krw);
  return plan ? plan.gdc : null;
}
