/**
 * ui/counterpart-index.js — 기관·전문가 등 대화 상대 이름 색인(2026-11-16, 주피터 지시: "1만 개 가운데 하나를 1초 안에").
 * 서버(/counterparts/index)가 공개된 이름·guid·종류만 한 번에 내려 주고, 기기(IndexedDB)에 24시간 보관한다.
 * 찾기는 전부 메모리 안에서 하므로 네트워크를 기다리지 않는다(1만 건 기준 수 ms). 색인을 못 받으면 호출부가 이 단계를 건너뛴다.
 */
export const INDEX_TTL_MS = 24 * 3600 * 1000;
export const normName = (s) => String(s || '').toLowerCase().replace(/[\s()（）·・,._\-]+/g, '');

/** items: [[name, guid, entityType], …] → 정확일치 Map + 전체 목록 */
export function buildIndex(items) {
  const exact = new Map(); const list = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!Array.isArray(it) || !it[0] || !it[1]) continue;
    const n = normName(it[0]); if (!n) continue;
    const e = { name: String(it[0]), guid: String(it[1]), type: String(it[2] || ''), n };
    list.push(e);
    const g = exact.get(n); if (g) g.push(e); else exact.set(n, [e]);
  }
  return { exact, list, size: list.length };
}

/** 이름으로 찾기: 정확일치 → (fuzzy 허용 시) 앞부분 일치 → 포함. 최대 limit 건. */
export function lookupCounterpart(index, target, { fuzzy = false, limit = 8 } = {}) {
  const n = normName(target);
  if (!index || !n) return [];
  const ex = index.exact.get(n);
  if (ex && ex.length) return ex.slice(0, limit);
  if (!fuzzy || n.length < 3) return [];
  const starts = [], inc = [];
  for (const e of index.list) {
    if (e.n.startsWith(n)) starts.push(e);
    else if (e.n.includes(n)) inc.push(e);
    if (starts.length >= limit) break;
  }
  return starts.concat(inc).slice(0, limit);
}

/** 보관소 + 서버에서 색인을 준비한다. 신선하면 보관본, 오래됐으면 새로 받고(실패 시 오래된 보관본), 보관본이 없으면 새로 받는다. */
export async function loadCounterpartIndex({ store, fetchIndex, now = Date.now() } = {}) {
  let cached = null;
  try { cached = store ? await store.get() : null; } catch {}
  const fresh = cached && cached.ts && (now - cached.ts) < INDEX_TTL_MS && Array.isArray(cached.items);
  if (fresh) return buildIndex(cached.items);
  try {
    const d = await fetchIndex();
    if (d && Array.isArray(d.items)) {
      try { if (store) await store.set({ ts: now, items: d.items }); } catch {}
      return buildIndex(d.items);
    }
  } catch {}
  return cached && Array.isArray(cached.items) ? buildIndex(cached.items) : null;
}

/** 브라우저 IndexedDB 보관소(없으면 null). */
export function idbStore(name = 'hondi_counterparts') {
  if (typeof indexedDB === 'undefined') return null;
  const open = () => new Promise((res, rej) => { const r = indexedDB.open(name, 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return {
    async get() { const db = await open(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get('index'); q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error); }); },
    async set(v) { const db = await open(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, 'index'); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); },
  };
}
