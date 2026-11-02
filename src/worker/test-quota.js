// src/worker/test-quota.js — 테스트 계정 사용 한도(DeepSeek API 실비 기준 원) · 차단 판정
//
// 정책(2026-11-02, 주피터 지시 — 2026-10-27 정책을 바꿈):
//   · 테스트 계정은 DeepSeek API 실비(apiCostKRW) 합계가 TEST_QUOTA_KRW(기본 500원)가 될 때까지 무료로 쓴다.
//     (예전에는 실비에 배수를 곱한 청구액 기준이었다. 호출하는 쪽에서 실비를 넘겨 준다.)
//   · 한도가 차면 곧바로 차단하고 화면에서 유료 회원 전환 안내창을 띄운다. 유예 기간은 기본 0시간이다.
//     (TEST_GRACE_HOURS 환경 변수에 0보다 큰 값을 주면 예전처럼 그 시간 동안 유예할 수 있다.)
//   · 차단돼도 정식 아이디로 전환(데이터 이동)과 한도 조회는 계속 허용한다.
//
// KV만 주입받는 순수 모듈이다(worker.js 밖에서도 단위 시험 가능).
//   키: hondi:test_quota:<guid> → { spent_krw, exceeded_at(ms|null) }
//   ⚠ KV는 원자적이지 않다 — 동시에 여러 호출이 겹치면 합계가 조금 덜 쌓일 수 있고(한도가 약간
//     늦게 걸리는 쪽으로만 틀린다), 같은 키에 초당 1회를 넘는 쓰기는 거부될 수 있어 쓰기 실패는 무시한다.

export const TEST_QUOTA_DEFAULT_KRW = 500;
export const TEST_GRACE_DEFAULT_HOURS = 0;

const keyOf = (guid) => `hondi:test_quota:${guid}`;

export function quotaConfig(env) {
  const lim = Number(env && env.TEST_QUOTA_KRW);
  const raw = env && env.TEST_GRACE_HOURS;
  const gh = (raw !== undefined && raw !== null && raw !== '' && Number(raw) >= 0) ? Number(raw) : TEST_GRACE_DEFAULT_HOURS;
  return { limitKrw: lim > 0 ? lim : TEST_QUOTA_DEFAULT_KRW, graceHours: gh, graceMs: gh * 3600 * 1000 };
}

// 저장된 상태 → 판정(순수 함수)
export function evaluate(state, now, cfg) {
  const spent = Math.max(0, Number(state && state.spent_krw) || 0);
  const exceededAt = (state && Number(state.exceeded_at)) || null;
  const base = {
    spent_krw: Math.round(spent * 100) / 100,
    limit_krw: cfg.limitKrw,
    remaining_krw: Math.max(0, Math.round((cfg.limitKrw - spent) * 100) / 100),
    grace_hours: cfg.graceHours,
    exceeded_at: null,
    grace_ends_at: null,
  };
  if (spent < cfg.limitKrw) return { status: 'active', ...base };
  const startedAt = exceededAt || now;               // 저장된 시각이 없으면 지금부터(getStatus가 곧 저장한다)
  const endsAt = startedAt + cfg.graceMs;
  return {
    status: now < endsAt ? 'grace' : 'blocked',
    ...base,
    exceeded_at: new Date(startedAt).toISOString(),
    grace_ends_at: new Date(endsAt).toISOString(),
  };
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

// 현재 상태 조회. 한도를 이미 넘었는데 시작 시각이 없으면(한도값을 나중에 낮춘 경우 등) 지금을 시작 시각으로 기록한다.
export async function getStatus(kv, guid, now, cfg) {
  const st = (await readRaw(kv, guid)) || { spent_krw: 0, exceeded_at: null };
  if (Number(st.spent_krw) >= cfg.limitKrw && !st.exceeded_at) {
    st.exceeded_at = now;
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
  const grace = Number(ev && ev.grace_hours) > 0 ? ` ${ev.grace_hours}시간의 유예 기간도 끝났습니다.` : '';
  return `무료 한도(AI 사용 비용 ${ev.limit_krw}원)를 모두 사용했습니다.${grace} ` +
    `유료 회원으로 전환하려면 먼저 정식 아이디로 로그인하거나 새로 만든 뒤, 테스트 데이터를 옮겨 계속 이용해 주세요.`;
}
