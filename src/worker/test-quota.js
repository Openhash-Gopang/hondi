// src/worker/test-quota.js — 무료 이용 기간(전화번호 본인 인증 후) 판정
//
// 정책(2026-11-06, 주피터 지시 — 이전의 "테스트 계정 500원" 정책을 바꿈):
//   · 모든 사용자(유료·무료 불문)는 전화번호 본인 인증을 마친 시점부터 무료 이용이 시작된다.
//   · 무료 이용은 AI 사용 비용(DeepSeek API 실비) 100원을 다 쓰거나 인증 후 24시간이 지나는 것 중 먼저 오는 때 끝난다.
//   · 끝난 뒤: 테스트 계정은 사용이 중단되고(유료 회원 전환 안내), 정식 계정은 GDC 잔액으로 계속 쓴다(워커가 판단).
//   · [무료 플랜] 무료 기간이 끝난 뒤 "무료 플랜"을 고른 정식 계정은 내부적으로 10원(REFILL_KRW)을 쓰면 5시간(REFILL_HOURS) 쉬었다가
//     10원이 다시 채워진다. 이 금액·시간은 사용자에게 숫자로 보이지 않는다(화면에는 "잠시 후 다시 사용" 정도만).
//   · [유료 플랜·종량제] 유료 플랜(p10/p100/p200)은 한 달(30일) 기간마다 플랜별 포함 사용량(AI 사용 비용, 원)까지 GDC 차감 없이 쓴다.
//     포함 사용량을 다 쓰면 사용자가 "추가 사용량"을 켜 둔 경우에 한해, 직접 정한 월 한도까지 GDC 잔액에서 사용분만큼 차감해 이어 쓴다
//     (Claude의 추가 사용량 구매와 같은 방식). 꺼져 있거나 월 한도에 닿으면 다음 기간까지 멈춘다.
//     포함 사용량은 env PLAN_INCLUDED_KRW(JSON, 예 {"p10":5000,"p100":50000,"p200":100000})로 바꾼다.
//   · 차단돼도 정식 아이디로 전환(데이터 이동)과 한도 조회는 계속 허용한다.
//   · 한도·시간은 환경 변수 FREE_TRIAL_KRW(기본 100)·FREE_TRIAL_HOURS(기본 24)로 바꿀 수 있다.
//     (옛 변수 TEST_QUOTA_KRW·TEST_GRACE_HOURS는 더 이상 읽지 않는다 — 클라우드플레어에 남아 있어도 무시된다.)
//
// KV만 주입받는 순수 모듈이다(worker.js 밖에서도 단위 시험 가능).
//   키: hondi:test_quota:<guid> → { spent_krw, started_at(ms), exceeded_at(ms|null), recent[] }
//   ⚠ KV는 원자적이지 않다 — 동시에 여러 호출이 겹치면 합계가 조금 덜 쌓일 수 있고(한도가 약간
//     늦게 걸리는 쪽으로만 틀린다), 같은 키에 초당 1회를 넘는 쓰기는 거부될 수 있어 쓰기 실패는 무시한다.

export const FREE_TRIAL_DEFAULT_KRW = 100;
export const FREE_TRIAL_DEFAULT_HOURS = 24;
export const FREE_PLAN_DEFAULT_REFILL_KRW = 10;
export const FREE_PLAN_DEFAULT_REFILL_HOURS = 5;
export const PLAN_DEFAULT_INCLUDED_KRW = { p10: 5000, p100: 50000, p200: 100000 };
export const PLAN_PERIOD_DAYS = 30;
export const TEST_QUOTA_DEFAULT_KRW = FREE_TRIAL_DEFAULT_KRW;   // 옛 이름(호환)

const keyOf = (guid) => `hondi:test_quota:${guid}`;

export function quotaConfig(env) {
  const lim = Number(env && env.FREE_TRIAL_KRW);
  const hrs = Number(env && env.FREE_TRIAL_HOURS);
  const h = hrs > 0 ? hrs : FREE_TRIAL_DEFAULT_HOURS;
  const rk = Number(env && env.FREE_PLAN_REFILL_KRW), rh = Number(env && env.FREE_PLAN_REFILL_HOURS);
  const refillHours = rh > 0 ? rh : FREE_PLAN_DEFAULT_REFILL_HOURS;
  let inc = PLAN_DEFAULT_INCLUDED_KRW;
  try { const j = env && env.PLAN_INCLUDED_KRW ? JSON.parse(env.PLAN_INCLUDED_KRW) : null; if (j && typeof j === 'object') inc = { ...inc, ...j }; } catch (e) { /* 잘못된 JSON이면 기본값 */ }
  return { included: inc, periodMs: PLAN_PERIOD_DAYS * 86400000, limitKrw: lim > 0 ? lim : FREE_TRIAL_DEFAULT_KRW, freeHours: h, freeMs: h * 3600 * 1000, graceHours: 0, graceMs: 0,
    refillKrw: rk > 0 ? rk : FREE_PLAN_DEFAULT_REFILL_KRW, refillHours, refillMs: refillHours * 3600 * 1000 };
}

// 무료 플랜의 10원 통: 다 썼고 5시간이 아직 안 지났으면 waiting, 지났으면 다시 가득(사용분 0)
function fpBucket(state, now, cfg) {
  const ex = Number(state && state.fp_exhausted_at) || 0;
  if (ex && now >= ex + cfg.refillMs) return { spent: 0, waiting: false, refillAt: 0 };
  const spent = Math.max(0, Number(state && state.fp_spent) || 0);
  if (spent >= cfg.refillKrw) return { spent, waiting: true, refillAt: (ex || now) + cfg.refillMs };
  return { spent, waiting: false, refillAt: 0 };
}

// 유료 플랜의 현재 기간(30일 단위로 굴러간다): 기간이 바뀌면 포함·추가 사용분이 0으로 돌아간다
function paidPeriod(state, now, cfg) {
  const ps = Number(state.period_start) || now;
  const n = Math.max(0, Math.floor((now - ps) / cfg.periodMs));
  const start = ps + n * cfg.periodMs;
  const same = n === 0;
  return { start, ends: start + cfg.periodMs, inc_used: same ? (Number(state.inc_used) || 0) : 0, extra_used: same ? (Number(state.extra_used) || 0) : 0 };
}
export function paidActive(state, now) { return !!(state && state.tier && Number(state.paid_until) > now); }

// 저장된 상태 → 판정(순수 함수). 시작 시각이 없으면 지금부터 센다(getStatus·startFree가 곧 저장한다).
export function evaluate(state, now, cfg) {
  const spent = Math.max(0, Number(state && state.spent_krw) || 0);
  const startedAt = (state && Number(state.started_at)) || now;
  const endsAt = startedAt + cfg.freeMs;
  if (paidActive(state, now)) {                               // 유료 플랜(종량제 포함)
    const pp = paidPeriod(state, now, cfg), inc = Number(cfg.included[state.tier]) || 0;
    const lim = Math.max(0, Number(state.extra_limit_krw) || 0), on = !!state.extra_on;
    let status = 'active', phase = 'paid';
    if (pp.inc_used >= inc) {
      if (on && pp.extra_used < lim) phase = 'extra'; else status = 'exhausted';
    }
    return { status, phase, plan: state.tier, tier: state.tier, paid_until: new Date(Number(state.paid_until)).toISOString(),
      period_ends_at: new Date(pp.ends).toISOString(), included_krw: inc, used_krw: Math.round(pp.inc_used * 100) / 100,
      extra_on: on, extra_limit_krw: lim, extra_used_krw: Math.round(pp.extra_used * 100) / 100, ended_reason: null };
  }
  const spentOut = spent >= cfg.limitKrw;
  const timeOut = now >= endsAt;
  const base = {
    spent_krw: Math.round(spent * 100) / 100,
    limit_krw: cfg.limitKrw,
    remaining_krw: Math.max(0, Math.round((cfg.limitKrw - spent) * 100) / 100),
    free_hours: cfg.freeHours,
    started_at: new Date(startedAt).toISOString(),
    free_ends_at: new Date(endsAt).toISOString(),
    grace_hours: 0,
    exceeded_at: null,
    grace_ends_at: null,
  };
  if (!spentOut && !timeOut) return { status: 'active', phase: 'trial', plan: (state && state.plan) || null, ended_reason: null, ...base };
  if (state && state.plan === 'free') {                      // 무료 플랜: 10원을 다 쓰면 5시간 쉰 뒤 다시 채워진다(내부 값)
    const fp = fpBucket(state, now, cfg);
    return { status: fp.waiting ? 'waiting' : 'active', phase: 'free', plan: 'free', ended_reason: spentOut ? 'spent' : 'time',
      wait_until: fp.waiting ? new Date(fp.refillAt).toISOString() : null, ...base };
  }
  // 먼저 온 쪽이 끝난 이유다. 둘 다 이미 지났으면 시간이 먼저인지 비용이 먼저인지 알 수 없으므로 저장된 exceeded_at으로 가른다.
  const exceededAt = (state && Number(state.exceeded_at)) || null;
  const reason = spentOut && (!timeOut || (exceededAt && exceededAt <= endsAt)) ? 'spent' : 'time';
  return { status: 'blocked', ended_reason: reason, ...base, exceeded_at: exceededAt ? new Date(exceededAt).toISOString() : null };
}

async function readRaw(kv, guid) {
  if (!kv) return null;
  try {
    const t = await kv.get(keyOf(guid));
    return t ? JSON.parse(t) : null;
  } catch (e) { return null; }
}
async function writeRaw(kv, guid, state) {
  if (!kv) return;
  try { await kv.put(keyOf(guid), JSON.stringify(state)); } catch (e) { /* 쓰기 한도·일시 오류는 무시 — 위 주석 */ }
}

// 무료 이용 시작(전화번호 본인 인증 직후). 이미 시작했으면 아무것도 바꾸지 않는다(다시 인증해도 24시간이 새로 시작되지 않는다).
export async function startFree(kv, guid, now) {
  if (!kv || !guid) return null;
  const st = await readRaw(kv, guid);
  if (st && Number(st.started_at)) return st;
  const next = st || { spent_krw: 0, exceeded_at: null };
  next.started_at = now;
  await writeRaw(kv, guid, next);
  return next;
}

// 무료 이용 기간 다시 시작(관리자): 사용액·플랜·유료·추가 사용량 기록을 지우고 지금부터 새로 센다.
export async function resetFree(kv, guid, now) {
  if (!kv || !guid) return null;
  const next = { spent_krw: 0, exceeded_at: null, started_at: now };
  await writeRaw(kv, guid, next);
  return next;
}

// 플랜 선택('free'|null). 선택 시점에 시작 기록이 없으면 함께 기록한다.
export async function setPlan(kv, guid, plan, now) {
  if (!kv || !guid) return null;
  const st = (await readRaw(kv, guid)) || { spent_krw: 0, exceeded_at: null };
  if (!Number(st.started_at)) st.started_at = now;
  if (plan === 'free') { st.plan = 'free'; st.fp_spent = Number(st.fp_spent) || 0; } else delete st.plan;
  await writeRaw(kv, guid, st);
  return st;
}

// 유료 플랜 지정(입금 확인 뒤 관리자가 호출). tier가 null이면 해제. 같은 등급을 갱신하면 기간 시작은 유지, 등급이 바뀌거나 처음이면 지금부터.
export async function setPaid(kv, guid, tier, paidUntil, now) {
  if (!kv || !guid) return null;
  const st = (await readRaw(kv, guid)) || { spent_krw: 0, exceeded_at: null };
  if (!Number(st.started_at)) st.started_at = now;
  if (!tier) { delete st.tier; delete st.paid_until; }
  else {
    if (st.tier !== tier || !Number(st.period_start)) { st.period_start = now; st.inc_used = 0; st.extra_used = 0; }
    st.tier = tier; st.paid_until = paidUntil;
  }
  await writeRaw(kv, guid, st);
  return st;
}

// 추가 사용량(종량제) 설정: 켜기/끄기와 월 한도(원). 한도는 0 이상의 정수로 정리한다.
export async function setExtra(kv, guid, on, limitKrw, now) {
  if (!kv || !guid) return null;
  const st = (await readRaw(kv, guid)) || { spent_krw: 0, exceeded_at: null };
  if (!Number(st.started_at)) st.started_at = now;
  st.extra_on = !!on;
  if (limitKrw !== undefined && limitKrw !== null) st.extra_limit_krw = Math.max(0, Math.min(10_000_000, Math.floor(Number(limitKrw) || 0)));
  await writeRaw(kv, guid, st);
  return st;
}

// 추가 사용량 누적(GDC에서 실제 차감한 뒤 호출). 유료 플랜의 추가 사용 단계가 아니면 아무것도 하지 않는다.
export async function addExtraSpend(kv, guid, krw, now, cfg) {
  const add = Number(krw);
  if (!kv || !(add > 0)) return null;
  const st = await readRaw(kv, guid);
  if (!st || !paidActive(st, now)) return null;
  const pp = paidPeriod(st, now, cfg);
  st.period_start = pp.start; st.inc_used = pp.inc_used; st.extra_used = pp.extra_used + add;
  await writeRaw(kv, guid, st);
  return evaluate(st, now, cfg);
}

// 현재 상태 조회. 시작 시각이 없으면(이 정책 이전부터 쓰던 계정 등) 지금을 시작 시각으로 기록한다.
export async function getStatus(kv, guid, now, cfg) {
  const st = (await readRaw(kv, guid)) || { spent_krw: 0, exceeded_at: null };
  if (!Number(st.started_at)) {
    st.started_at = now;
    if (Number(st.spent_krw) >= cfg.limitKrw && !st.exceeded_at) st.exceeded_at = now;
    await writeRaw(kv, guid, st);
  }
  return evaluate(st, now, cfg);
}

// 사용분 누적. krw ≤ 0 이거나 KV가 없으면 아무것도 하지 않는다(차단하지 않는 쪽으로 실패).
// dedupKey(정산 키)를 주면, 같은 키는 한 번만 센다 — 최근 키 30개를 같은 KV 항목에 같이 저장해
// KV 호출을 늘리지 않는다(무료 플랜은 요청당 하위 요청이 50개까지라 호출 수가 중요하다).
export async function addSpend(kv, guid, krw, now, cfg, dedupKey = null) {
  const add = Number(krw);
  if (!kv || !(add > 0)) return null;
  const st = (await readRaw(kv, guid)) || { spent_krw: 0, exceeded_at: null };
  if (!Number(st.started_at)) st.started_at = now;
  if (dedupKey) {
    const recent = Array.isArray(st.recent) ? st.recent : [];
    if (recent.includes(dedupKey)) return evaluate(st, now, cfg);   // 이미 센 건 — 쓰기도 하지 않는다
    recent.push(dedupKey);
    st.recent = recent.slice(-30);
  }
  if (paidActive(st, now) && evaluate(st, now, cfg).phase === 'paid') {      // 유료 플랜: 포함 사용량에 쌓는다
    const pp = paidPeriod(st, now, cfg);
    st.period_start = pp.start; st.extra_used = pp.extra_used;
    st.inc_used = pp.inc_used + add;
    await writeRaw(kv, guid, st);
    return evaluate(st, now, cfg);
  }
  if (st.plan === 'free' && evaluate(st, now, cfg).phase === 'free') {   // 무료 기간 뒤 무료 플랜: 10원 통에 쌓는다
    const ex = Number(st.fp_exhausted_at) || 0;
    if (ex && now >= ex + cfg.refillMs) { st.fp_spent = 0; st.fp_exhausted_at = null; }   // 5시간이 지나 다시 채워졌다
    st.fp_spent = (Number(st.fp_spent) || 0) + add;
    if (st.fp_spent >= cfg.refillKrw && !st.fp_exhausted_at) st.fp_exhausted_at = now;
    await writeRaw(kv, guid, st);
    return evaluate(st, now, cfg);
  }
  st.spent_krw = (Number(st.spent_krw) || 0) + add;
  if (st.spent_krw >= cfg.limitKrw && !st.exceeded_at) st.exceeded_at = now;
  await writeRaw(kv, guid, st);
  return evaluate(st, now, cfg);
}

export function waitMessage(ev, now = Date.now()) {
  let at = '';
  try { at = new Date(ev.wait_until).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }); } catch (e) { /* 시각 표기 실패는 문구만 줄인다 */ }
  return `무료 플랜은 잠시 쉬었다가 다시 쓸 수 있습니다.${at ? ` ${at} 이후에 다시 이용해 주세요.` : ''} 바로 이어서 쓰려면 플랜을 업그레이드해 주세요.`;
}

export function exhaustedMessage(ev) {
  let at = '';
  try { at = new Date(ev.period_ends_at).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric' }); } catch (e) { /* 날짜 표기 실패는 문구만 줄인다 */ }
  const why = ev && ev.extra_on ? '추가 사용량 한도까지 모두 사용했습니다.' : '이번 기간의 플랜 사용량을 모두 사용했습니다.';
  return `${why}${at ? ` ${at}에 사용량이 다시 채워집니다.` : ''} 지금 이어서 쓰려면 플랜 화면에서 추가 사용량 구매를 켜거나(월 한도는 직접 정합니다) 상위 플랜으로 올려 주세요.`;
}

export function blockedMessage(ev) {
  const why = ev && ev.ended_reason === 'time' ? `무료 이용 기간(${ev.free_hours}시간)이 끝났습니다.` : `무료 한도(AI 사용 비용 ${ev.limit_krw}원)를 모두 사용했습니다.`;
  return `${why} 유료 회원으로 전환하려면 먼저 정식 아이디로 로그인하거나 새로 만든 뒤, 테스트 데이터를 옮겨 계속 이용해 주세요.`;
}
