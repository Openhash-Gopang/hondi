/**
 * ui/favorites.js — 즐겨찾기: 한 번 호출한 전문가·기관·K-서비스를 이 기기에 저장해 두었다가,
 * 다음에는 이름만 말해도 검색·LLM 없이 즉시 새 탭으로 연다(2026-11-16, 주피터 지시).
 * 사람은 기존 frequent-users.js 가 같은 역할을 한다(찾거나 연결하면 자동 저장 → 이름만 말하면 즉시 연결).
 * 저장은 이 기기 localStorage 뿐이며 서버로 보내지 않는다.
 */
const KEY_PREFIX = 'hondi_favorites_v1:';
export const MAX_FAVORITES = 60;
export const storageKey = (guid) => KEY_PREFIX + (guid || 'anon');
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, '');

export function loadFavorites(storage, guid) {
  try { const a = JSON.parse(storage.getItem(storageKey(guid)) || '[]'); return Array.isArray(a) ? a.filter(f => f && f.id && f.name) : []; }
  catch { return []; }
}

/** 호출한 상대를 저장(같은 id면 갱신·횟수 증가). kind: 'expert' | 'service'. */
export function addFavorite(storage, guid, svc, now = Date.now()) {
  if (!svc || !svc.id || !svc.name) return loadFavorites(storage, guid);
  const list = loadFavorites(storage, guid);
  const i = list.findIndex(f => f.id === svc.id);
  const base = i >= 0 ? list[i] : { count: 0 };
  const kind = svc.kind || (/expert-chat/.test(String(svc.url || '')) ? 'expert' : 'service');
  const merged = { ...base, id: svc.id, kind, name: svc.name, icon: svc.icon || base.icon || '', url: svc.url || base.url || '', count: (base.count || 0) + 1, last_used: now };
  if (i >= 0) list[i] = merged; else list.push(merged);
  list.sort((a, b) => (b.last_used || 0) - (a.last_used || 0));
  const out = list.slice(0, MAX_FAVORITES);
  try { storage.setItem(storageKey(guid), JSON.stringify(out)); } catch {}
  return out;
}

export function removeFavorite(storage, guid, id) {
  const out = loadFavorites(storage, guid).filter(f => f.id !== id);
  try { storage.setItem(storageKey(guid), JSON.stringify(out)); } catch {}
  return out;
}

const ACTION = /(연결|불러|호출|열어|켜|시작|상담|문의|대화|이동|가줘|가자)/;
const SUFFIX = /(을|를|으로|로|에게|한테|좀|해줘|해 줘|해주세요|해 주세요|줘|주세요)+$/;

/**
 * 말한 문장이 저장된 즐겨찾기 하나를 가리키면 {fav}, 같은 이름이 둘 이상이면 {many}, 아니면 null.
 * 짧은 문장(40자 이하)에 즐겨찾기 이름이 있고 '연결/불러/열어…' 동사가 있거나, 문장이 이름 자체일 때만 해당한다.
 * 질문·긴 글은 null → 기존 흐름.
 */
export function matchFavorite(text, list) {
  if (!text || typeof text !== 'string' || !Array.isArray(list) || !list.length) return null;
  const t = text.trim();
  if (!t || t.length > 40 || t.startsWith('[') || /[?？]$/.test(t)) return null;
  const compact = norm(t.replace(/[.!~]+$/g, ''));
  const bare = compact.replace(SUFFIX, '');
  const withAction = ACTION.test(compact);
  const names = [...new Set(list.map(f => norm(f.name)))].sort((a, b) => b.length - a.length);
  for (const n of names) {
    if (!n) continue;
    if (bare === n || compact === n || (withAction && compact.includes(n))) {
      const hit = list.filter(f => norm(f.name) === n);
      return hit.length === 1 ? { fav: hit[0] } : { many: hit };
    }
  }
  return null;
}
