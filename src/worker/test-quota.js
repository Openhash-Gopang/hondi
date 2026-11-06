// src/worker/test-quota.js — 무료 이용 기간(전화번호 본인 인증 후) 판정
//
// 정책(2026-11-06, 주피터 지시 — 이전의 "테스트 계정 500원" 정책을 바꿈):
//   · 모든 사용자(유료·무료 불문)는 전화번호 본인 인증을 마친 시점부터 무료 이용이 시작된다.
//   · 무료 이용은 AI 사용 비용(DeepSeek API 실비) 100원을 다 쓰거나 인증 후 24시간이 지나는 것 중 먼저 오는 때 끝난다.
//   · 끝난 뒤: 테스트 계정은 사용이 중단되고(유료 회원 전환 안내), 정식 계정은 GDC 잔액으로 계속 쓴다(워커가 판단).
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
export const TEST_QUOTA_DEFAULT_KRW = FREE_TRIAL_DEFAULT_KRW;   // 옛 이름(호환)

const keyOf = (guid) => `hondi:test_quota:${guid}`;

export function quotaConfig(env) {
  const lim = Number(env && env.FREE_TRIAL_KRW);
  const hrs = Number(env && env.FREE_TRIAL_HOURS);
  const h = hrs > 0 ? hrs : FREE_TRIAL_DEFAULT_HOURS;
  return { limitKrw: lim > 0 ? lim : FREE_TRIAL_DEFAULT_KRW, freeHours: h, freeMs: h * 3600 * 1000, graceHours: 0, graceMs: 0 };
}

// 저장된 상태 → 판정(순수 함수). 시작 시각이 없으면 지금부터 센다(getStatus·startFree가 곧 저장한다).
export function evaluate(state, now, cfg) {
  const spent = Math.max(0, Number(state && state.spent_krw) || 0);
  const startedAt = (state && Number(state.started_at)) || now;
  const endsAt = startedAt + cfg.freeMs;
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
  if (!spentOut && !timeOut) return { status: 'active', ended_reason: null, ...base };
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
  st.spent_krw = (Number(st.spent_krw) || 0) + add;
  if (st.spent_krw >= cfg.limitKrw && !st.exceeded_at) st.exceeded_at = now;
  await writeRaw(kv, guid, st);
  return evaluate(st, now, cfg);
}

export function blockedMessage(ev) {
  const why = ev && ev.ended_reason === 'time' ? `무료 이용 기간(${ev.free_hours}시간)이 끝났습니다.` : `무료 한도(AI 사용 비용 ${ev.limit_krw}원)를 모두 사용했습니다.`;
  return `${why} 유료 회원으로 전환하려면 먼저 정식 아이디로 로그인하거나 새로 만든 뒤, 테스트 데이터를 옮겨 계속 이용해 주세요.`;
}
