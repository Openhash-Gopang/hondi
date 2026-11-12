/**
 * ui/frequent-users.js — 자주 찾는 사용자(2026-11-12 신설, 주피터 지시)
 * 한 번 검색해 찾았거나 연결한 사용자를 이 기기에 저장해 두고, 다음부터는 이름(닉네임)이나 아이디만 말해도
 * 검색 없이 바로 채팅으로 연결한다. 순수 함수(저장소·시계를 인자로 받음)라 테스트하기 쉽다.
 * 저장 위치는 이 기기의 localStorage 이며 계정(guid)별로 나눠 둔다. 서버로 보내지 않는다.
 */
const KEY_PREFIX = 'hondi_frequent_users_v1:';
const MAX_USERS = 50;

export function storageKey(guid) { return KEY_PREFIX + (guid || 'anon'); }

const norm = (s) => String(s || '').trim().replace(/^@/, '').replace(/^tid-/, '').toLowerCase();

export function loadFrequent(storage, guid) {
  try {
    const arr = JSON.parse(storage.getItem(storageKey(guid)) || '[]');
    return Array.isArray(arr) ? arr.filter(u => u && u.handle) : [];
  } catch { return []; }
}

/** 찾았거나 연결한 사용자를 저장한다(같은 아이디면 갱신). 목록이 넘치면 오래 안 쓴 사람부터 지운다. */
export function rememberUser(storage, guid, user, now = Date.now(), connected = false) {
  if (!user || !user.handle) return loadFrequent(storage, guid);
  const list = loadFrequent(storage, guid);
  const h = norm(user.handle);
  const i = list.findIndex(u => norm(u.handle) === h);
  const base = i >= 0 ? list[i] : { count: 0 };
  const merged = {
    ...base, handle: user.handle, nickname: user.nickname || base.nickname || '', country_code: user.country_code || base.country_code || '',
    region: user.region || base.region || '', guid: user.guid || base.guid || undefined,
    count: (base.count || 0) + (connected ? 1 : 0), last_used: now,
  };
  if (i >= 0) list[i] = merged; else list.push(merged);
  list.sort((a, b) => (b.last_used || 0) - (a.last_used || 0));
  const out = list.slice(0, MAX_USERS);
  try { storage.setItem(storageKey(guid), JSON.stringify(out)); } catch {}
  return out;
}

export function forgetUser(storage, guid, handle) {
  const h = norm(handle);
  const out = loadFrequent(storage, guid).filter(u => norm(u.handle) !== h);
  try { storage.setItem(storageKey(guid), JSON.stringify(out)); } catch {}
  return out;
}

const SUFFIX = /(님|씨|에게|한테|랑|와|과)$/;
const ACTION = /(연결|채팅|대화|톡|메시지|메세지|불러|보내|말 ?걸|이야기|통화)/;

/**
 * 말한 문장에서 자주 찾는 사용자를 고른다.
 *  - 문장 전체가 아이디(@xxxx) 또는 이름(+님/씨)이면 바로 연결 대상.
 *  - 짧은 문장(40자 이하)에 이름이 있고 '연결/채팅/대화…' 같은 동사가 있으면 연결 대상.
 *  - 이름이 같은 사람이 둘 이상이면 {many} 로 돌려 아이디로 다시 말하게 한다.
 * 그 밖의 문장(질문·긴 글)은 null → 기존 대화 흐름.
 */
export function matchFrequent(text, list) {
  if (!text || typeof text !== 'string' || !Array.isArray(list) || !list.length) return null;
  const t = text.trim();
  if (!t || t.length > 40 || t.startsWith('[')) return null;
  const compact = t.replace(/[.!?~\s]+$/g, '');
  const pick = (users) => users.length === 1 ? { user: users[0] } : { many: users };
  // 1) 아이디
  const idm = compact.match(/^@?([A-Za-z0-9._-]{4,})(?:\s*(?:님|에게|한테))?$/);
  if (idm) {
    const hit = list.filter(u => norm(u.handle) === norm(idm[1]));
    if (hit.length) return pick(hit);
  }
  const withAction = ACTION.test(compact);
  // 2) 이름 — 긴 이름부터 비교해 '김동'이 '김동민'을 가로채지 않게 한다
  const names = [...new Set(list.map(u => (u.nickname || '').trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  for (const name of names) {
    const bare = compact.replace(SUFFIX, '').trim();
    const exact = bare === name || compact === name;
    if (exact || (withAction && compact.includes(name))) {
      const hit = list.filter(u => (u.nickname || '').trim() === name);
      return pick(hit);
    }
  }
  // 3) 아이디가 문장 안에 있고 연결 동사가 있을 때
  if (withAction) {
    const m = compact.match(/@([A-Za-z0-9._-]{4,})/);
    if (m) { const hit = list.filter(u => norm(u.handle) === norm(m[1])); if (hit.length) return pick(hit); }
  }
  return null;
}
