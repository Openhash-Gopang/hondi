// src/worker/mail-id.js — 메일 아이디(mail_id) 규칙: 형식 검사·예약어, 읽기 쉬운 기본값, 변경 횟수 정책.
// 순수 함수만 담는다(KV만 주입) — worker.js 밖에서 단위 시험이 가능하다.
//
// 정책(2026-10-27, 주피터 결정):
//   · 상용 개시 전이라 옛 주소가 없다 → 옛 아이디 보존·전달은 하지 않는다(바꾸면 즉시 반납).
//     ⚠ 상용 개시 전에 다시 정할 것: 옛 아이디를 일정 기간 예약해 두지 않으면, 바꾼 직후 남이 옛 아이디를 가져가
//       옛 주소로 오던 메일을 받을 수 있다.
//   · 변경 횟수는 30일에 3번(MAIL_ID_CHANGE_LIMIT, MAIL_ID_CHANGE_WINDOW_DAYS). 가입 직후의 첫 선택은 횟수에 세지 않는다.
//   · 가입 직후 선택 화면에서는 "건너뛰기"를 허용하고, 그때는 기본 아이디를 그대로 쓴다.

// ── 읽기 쉬운 기본 아이디: <형용사>-<명사>-<세 자리 숫자> (예: swift-heron-482) ─────────────
// pb_hooks/main.pb.js의 가입 훅이 같은 목록·같은 알고리즘을 그대로 쓴다(tests/mail-id.test.mjs가 둘의 일치를 확인한다).
export const ADJECTIVES = ['swift','calm','bright','brave','clever','gentle','happy','kind','lucky','merry','noble','proud','quick','quiet','rapid','sharp','shiny','silent','smart','solid','steady','sunny','tidy','vivid','warm','wise','witty','young','bold','crisp','eager','fair','fresh','grand','honest','jolly','keen','lively','mighty','neat','polite','ready','sincere','snug','sound','stable','sturdy','super','true','upbeat','vast','zesty','amber','azure','coral','golden','ivory','jade','olive','pearl','ruby','silver','teal'];
export const NOUNS = ['heron','falcon','maple','river','cedar','harbor','meadow','pebble','lantern','compass','anchor','beacon','bridge','canyon','comet','dolphin','ember','forest','glacier','island','jasmine','kestrel','lagoon','lotus','marble','nebula','orchid','otter','panda','pine','quartz','raven','sparrow','summit','tulip','valley','willow','zephyr','aster','birch','breeze','clover','dune','eagle','fern','garden','hazel','iris','juniper','koala','lily','mango','nectar','oasis','plum','quail','reef','sage','thistle','tiger','violet','whale','yarrow'];

// HMAC-SHA256 16진수(64자) → 기본 아이디. 앞 4자리·다음 4자리·그다음 4자리를 각각 형용사·명사·숫자(100~999)에 쓴다.
export function defaultMailIdFromHash(hex) {
  const h = String(hex || '');
  const a = parseInt(h.slice(0, 4), 16) % ADJECTIVES.length;
  const n = parseInt(h.slice(4, 8), 16) % NOUNS.length;
  const d = (parseInt(h.slice(8, 12), 16) % 900) + 100;
  return `${ADJECTIVES[a]}-${NOUNS[n]}-${d}`;
}

// ── 형식·예약어 ─────────────────────────────────────────────────────────────
export const MAIL_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/;          // 3~30자, 영숫자로 시작·끝 (2026-10-27: 1글자가 통과하던 결함 수정 — 끝 묶음을 선택으로 둬서 'a'가 맞았다)
// 사칭·시스템 주소로 오해될 이름. 끝의 숫자·-·_ 를 떼고도 비교한다(admin01, support-2 …).
export const RESERVED_EXACT = new Set([
  'admin', 'administrator', 'root', 'postmaster', 'webmaster', 'hostmaster', 'abuse', 'security', 'support', 'help', 'info', 'contact',
  'no-reply', 'noreply', 'donotreply', 'mail', 'mailer', 'daemon', 'system', 'sysadmin', 'service', 'official', 'staff', 'team', 'billing', 'payment',
  'gov', 'government', 'police', 'court', 'prosecutor', 'bank', 'customer', 'master', 'owner', 'manager', 'operator', 'moderator',
  'test', 'tester', 'null', 'undefined', 'anonymous', 'unknown', 'guest', 'user', 'me', 'you', 'all', 'everyone',
  'kmail', 'k-mail', 'hondi', 'navi', 'naviweb', 'gopang', 'gdc',
]);
export const RESERVED_BRAND_PREFIX = ['hondi', 'kmail', 'k-mail', 'gopang'];     // 이 이름으로 시작하는 것은 모두 예약

export const normalizeMailId = (raw) => String(raw || '').trim().toLowerCase();

export const MAIL_ID_MESSAGES = {
  format: '메일 아이디는 3~30자의 영문 소문자·숫자·하이픈(-)·밑줄(_)만 쓸 수 있고, 영문 또는 숫자로 시작하고 끝나야 합니다.',
  numeric: '숫자만으로는 아이디를 만들 수 없습니다. 영문자를 섞어 주세요.',
  reserved: '이 이름은 시스템·기관 사칭을 막기 위해 쓸 수 없습니다. 다른 이름을 골라 주세요.',
};

// → { ok, normalized, reason?, message? }  reason: 'format' | 'numeric' | 'reserved'
export function checkMailId(raw) {
  const normalized = normalizeMailId(raw);
  if (!MAIL_ID_PATTERN.test(normalized)) return { ok: false, normalized, reason: 'format', message: MAIL_ID_MESSAGES.format };
  if (!/[a-z]/.test(normalized)) return { ok: false, normalized, reason: 'numeric', message: MAIL_ID_MESSAGES.numeric };
  const core = normalized.replace(/[0-9_-]+$/, '');
  if (RESERVED_EXACT.has(normalized) || (core && RESERVED_EXACT.has(core)) || RESERVED_BRAND_PREFIX.some(p => normalized.startsWith(p))) {
    return { ok: false, normalized, reason: 'reserved', message: MAIL_ID_MESSAGES.reserved };
  }
  return { ok: true, normalized };
}

// ── 변경 횟수 정책 ──────────────────────────────────────────────────────────
export const DAY_MS = 24 * 3600 * 1000;
export function changePolicyConfig(env) {
  const lim = Math.floor(Number(env && env.MAIL_ID_CHANGE_LIMIT));
  const win = Number(env && env.MAIL_ID_CHANGE_WINDOW_DAYS);
  return { limit: lim > 0 ? lim : 3, windowDays: win > 0 ? win : 30 };
}

// state = { confirmed: null|'chosen'|'accepted'|'skipped', changes: [ms…], autoN: 자동 추천을 몇 번 받았는지 }
const emptyState = () => ({ confirmed: null, changes: [], autoN: 0 });
export function normalizeState(st) {
  const s = st && typeof st === 'object' ? st : {};
  return { confirmed: s.confirmed || null, changes: Array.isArray(s.changes) ? s.changes.map(Number).filter(Number.isFinite) : [], autoN: Math.max(0, Math.floor(Number(s.autoN) || 0)) };
}

// 지금 아이디를 바꿀 수 있는가. 현재 아이디가 없거나(첫 배정), 아직 선택 화면을 거치지 않은 첫 변경은 횟수에 세지 않는다.
export function evaluateChange(state, now, cfg, { hasCurrent = true } = {}) {
  const st = normalizeState(state);
  const windowMs = cfg.windowDays * DAY_MS;
  const recent = st.changes.filter(t => now - t < windowMs).sort((a, b) => a - b);
  const exempt = !hasCurrent || (st.confirmed === null && st.changes.length === 0);
  const used = recent.length;
  const left = Math.max(0, cfg.limit - used);
  const allowed = exempt || left > 0;
  const nextAt = (!allowed && recent.length) ? recent[0] + windowMs : null;     // 가장 오래된 변경이 창 밖으로 나가는 시각
  return { allowed, exempt, used, left, limit: cfg.limit, windowDays: cfg.windowDays, nextChangeAt: nextAt ? new Date(nextAt).toISOString() : null };
}
export function recordChange(state, now, { exempt = false } = {}) {
  const st = normalizeState(state);
  if (!exempt) st.changes = [...st.changes, now].slice(-10);
  st.confirmed = 'chosen';
  return st;
}
export function recordConfirm(state, action) {
  const st = normalizeState(state);
  if (action === 'accept') st.confirmed = 'accepted';
  else if (action === 'skip') st.confirmed = 'skipped';
  else throw new Error('action은 accept 또는 skip이어야 합니다');
  return st;
}
export function limitMessage(ev) {
  const when = ev.nextChangeAt ? new Date(ev.nextChangeAt) : null;
  const kst = when ? new Date(when.getTime() + 9 * 3600 * 1000) : null;
  const dateText = kst ? `${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일 ${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}` : '';
  return `메일 아이디는 ${ev.windowDays}일 동안 ${ev.limit}번까지 바꿀 수 있습니다.` + (dateText ? ` ${dateText}(한국 시간) 이후에 다시 바꿀 수 있습니다.` : '');
}

// ── 상태 저장(KV) ───────────────────────────────────────────────────────────
const keyOf = (guid) => `hondi:mail_id_state:${guid}`;
export async function readState(kv, guid) {
  if (!kv) return emptyState();
  try { const t = await kv.get(keyOf(guid)); return t ? normalizeState(JSON.parse(t)) : emptyState(); } catch (e) { return emptyState(); }
}
export async function writeState(kv, guid, state) {
  if (!kv) return;
  try { await kv.put(keyOf(guid), JSON.stringify(normalizeState(state))); } catch (e) { /* 쓰기 실패는 무시 — 다음 변경에서 다시 기록된다 */ }
}
