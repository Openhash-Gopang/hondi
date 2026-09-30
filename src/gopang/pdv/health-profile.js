/**
 * health-profile.js — PDV 건강 기록(병력·가족력·생활습관 등) 저장소와 요청 응답 (2026-10-01)
 *
 * 주체: "나만의 AI 비서"(hondi.net, AC)가 생성·갱신·관리한다. 다른 서비스(K-Doctor 등)는 이 저장소를 직접 읽지 못하고,
 * GWP_PDV_REQUEST로 요청 → 사용자 승인 → GWP_PDV_RESPONSE로 받는다(prompts/gov-tree/00-common/GOV-TREE-PROTOCOL_v1.0.md §13).
 *
 * 원칙
 *  - 기본 거부: 요청할 수 있는 서비스는 HEALTH_DATA_REQUESTERS에 명시된 것뿐이다(서비스 id + origin).
 *  - 최소 수집: 그룹(병력/가족력/생활습관/상태) 단위로 사용자가 승인한다. 승인하지 않은 그룹은 withheld.
 *  - 지어내지 않는다: 없는 항목은 not_in_pdv. "기록 없음"은 "해당 없음"이 아니다.
 *  - 출처·기준일: 모든 항목에 source와 asof를 붙이고, 오래된 항목은 stale 표시로 넘겨 요청자가 다시 확인하게 한다.
 *  - 접근 기록: 누가 언제 무엇을 가져갔는지 access log에 남긴다(사용자가 볼 수 있어야 한다).
 *
 * 이 파일은 저장소 어댑터를 주입받는 순수 모듈이다. 기본 어댑터(localStorage)는 AC 쪽에서만 만든다.
 */

export const HEALTH_GROUPS = Object.freeze({
  history: { label: '병력·수술·복용약·알레르기·예방접종' },
  family: { label: '가족력' },
  lifestyle: { label: '생활습관·직업·환경 노출' },
  status: { label: '임신·수유, 키·몸무게' },
});

export const HEALTH_FIELDS = Object.freeze([
  { id: 'health.conditions', group: 'history', label: '기저질환·진단받은 병력', type: 'list', stale_days: 730 },
  { id: 'health.surgeries', group: 'history', label: '수술·입원 이력', type: 'list', stale_days: 1825 },
  { id: 'health.medications', group: 'history', label: '복용 중인 약·건강기능식품', type: 'list', stale_days: 90 },
  { id: 'health.allergies', group: 'history', label: '약물·음식 알레르기와 반응', type: 'list', stale_days: 1825 },
  { id: 'health.vaccinations', group: 'history', label: '예방접종', type: 'list', stale_days: 1825 },
  { id: 'health.family_history', group: 'family', label: '가족력(혈연 가족의 질환)', type: 'list', stale_days: 1825 },
  { id: 'health.smoking', group: 'lifestyle', label: '흡연', type: 'text', stale_days: 365 },
  { id: 'health.alcohol', group: 'lifestyle', label: '음주', type: 'text', stale_days: 365 },
  { id: 'health.exercise', group: 'lifestyle', label: '운동', type: 'text', stale_days: 365 },
  { id: 'health.sleep', group: 'lifestyle', label: '수면', type: 'text', stale_days: 180 },
  { id: 'health.diet', group: 'lifestyle', label: '식습관', type: 'text', stale_days: 365 },
  { id: 'health.occupation_exposure', group: 'lifestyle', label: '직업·환경 노출', type: 'text', stale_days: 730 },
  { id: 'health.pregnancy', group: 'status', label: '임신·수유 여부', type: 'text', stale_days: 30 },
  { id: 'health.height_cm', group: 'status', label: '키(cm)', type: 'number', min: 30, max: 250, stale_days: 730 },
  { id: 'health.weight_kg', group: 'status', label: '몸무게(kg)', type: 'number', min: 1, max: 400, stale_days: 90 },
]);

export const HEALTH_FIELD_IDS = Object.freeze(HEALTH_FIELDS.map((f) => f.id));
export const SOURCES = Object.freeze(['user_stated', 'ac_conversation', 'document', 'service_proposal_approved']);

/** 건강 기록을 요청할 수 있는 서비스(기본 거부). 서비스 id는 gwp-registry.js의 id, origin은 그 서비스의 오리진이다. */
export const HEALTH_DATA_REQUESTERS = Object.freeze({
  kdoctor: Object.freeze({ origin: 'https://doctor.hondi.net', purposes: Object.freeze(['diagnosis_support']) }),
});

const LIST_MAX_ITEMS = 50;
const LIST_ITEM_MAX = 120;
const TEXT_MAX = 500;
const DAY = 86400000;

export const isHealthField = (id) => HEALTH_FIELD_IDS.includes(id);
export const fieldDef = (id) => HEALTH_FIELDS.find((f) => f.id === id) ?? null;
export const fieldsOfGroup = (group) => HEALTH_FIELDS.filter((f) => f.group === group).map((f) => f.id);

/** 서비스가 건강 기록을 요청할 자격이 있는가. */
export function isPermittedRequester(serviceId, origin, purpose = 'diagnosis_support') {
  const r = HEALTH_DATA_REQUESTERS[serviceId];
  return !!r && r.origin === origin && r.purposes.includes(purpose);
}

const today = (nowMs) => new Date(nowMs).toISOString().slice(0, 10);

/** 값 검증·정규화. list는 문자열 배열(쉼표·줄바꿈 문자열도 받음), text는 문자열, number는 범위 내 숫자. */
export function validateValue(def, raw) {
  if (!def) return { ok: false, error: 'unknown_field' };
  if (def.type === 'list') {
    let arr = Array.isArray(raw) ? raw : String(raw ?? '').split(/[,\n;，]/);
    arr = arr.map((x) => String(x ?? '').trim()).filter(Boolean);
    const seen = new Set();
    arr = arr.filter((x) => { const k = x.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    if (!arr.length) return { ok: false, error: 'empty' };
    if (arr.length > LIST_MAX_ITEMS) return { ok: false, error: 'too_many_items' };
    if (arr.some((x) => x.length > LIST_ITEM_MAX)) return { ok: false, error: 'item_too_long' };
    return { ok: true, value: arr };
  }
  if (def.type === 'number') {
    const n = Number(String(raw ?? '').replace(/[^\d.+-]/g, ''));
    if (!Number.isFinite(n) || String(raw ?? '').trim() === '') return { ok: false, error: 'not_a_number' };
    if (n < def.min || n > def.max) return { ok: false, error: 'out_of_range' };
    return { ok: true, value: Math.round(n * 10) / 10 };
  }
  const s = String(raw ?? '').trim();
  if (!s) return { ok: false, error: 'empty' };
  if (s.length > TEXT_MAX) return { ok: false, error: 'too_long' };
  return { ok: true, value: s };
}

// ─────────────────────────── 저장소 ───────────────────────────

export function memoryAdapter(initial = {}) {
  let data = JSON.parse(JSON.stringify(initial));
  return { load: () => JSON.parse(JSON.stringify(data)), save: (d) => { data = JSON.parse(JSON.stringify(d)); } };
}

/** localStorage 어댑터(브라우저 전용). 읽기·쓰기 실패는 빈 저장소/무시로 처리한다. */
export function localStorageAdapter(key, storage = globalThis.localStorage) {
  return {
    load() { try { return JSON.parse(storage.getItem(key) || '{}') || {}; } catch { return {}; } },
    save(d) { try { storage.setItem(key, JSON.stringify(d)); } catch { /* 저장 실패는 호출부가 set()의 반환으로 알 수 있다 */ } },
  };
}

/**
 * @param {{records:{load,save}, access:{load,save}, now?:()=>number}} o
 *   records: { [fieldId]: { value, source, asof, updated_at } }   access: [ {ts, service, provided, withheld, missing, reason} ]
 */
export function createHealthStore({ records, access, now = () => Date.now() }) {
  const ACCESS_MAX = 100;
  return {
    get(id) { const e = records.load()[id]; return e ? { ...e } : null; },
    snapshot() { return records.load(); },
    set(id, raw, { source = 'user_stated', asof } = {}) {
      const def = fieldDef(id);
      if (!def) return { ok: false, error: 'unknown_field' };
      if (!SOURCES.includes(source)) return { ok: false, error: 'invalid_source' };
      const v = validateValue(def, raw);
      if (!v.ok) return v;
      const t = now();
      const day = /^\d{4}-\d{2}-\d{2}$/.test(asof ?? '') ? asof : today(t);
      const all = records.load();
      all[id] = { value: v.value, source, asof: day, updated_at: new Date(t).toISOString() };
      records.save(all);
      return { ok: true, entry: { ...all[id] } };
    },
    /** 목록형은 합치고(중복 제외), 나머지는 교체한다. */
    merge(id, raw, meta) {
      const def = fieldDef(id);
      const cur = this.get(id);
      if (def?.type === 'list' && cur) {
        const v = validateValue(def, raw);
        if (!v.ok) return v;
        return this.set(id, [...cur.value, ...v.value], meta);
      }
      return this.set(id, raw, meta);
    },
    remove(id) { const all = records.load(); const had = id in all; delete all[id]; records.save(all); return had; },
    log() { return access.load() || []; },
    appendLog(entry) {
      const arr = Array.isArray(access.load()) ? access.load() : [];
      arr.push({ ts: new Date(now()).toISOString(), ...entry });
      access.save(arr.slice(-ACCESS_MAX));
    },
    now,
  };
}

export function isStale(def, entry, nowMs) {
  if (!entry || !def) return false;
  const t = Date.parse(entry.asof);
  return Number.isFinite(t) && nowMs - t > def.stale_days * DAY;
}

/**
 * 요청에 대한 응답 값을 만든다.
 * @param store
 * @param {string[]} fields  요청된 필드(알 수 없는 id는 무시)
 * @param {string[]} approvedGroups  사용자가 승인한 그룹
 * @returns {{values:Object, provided:string[], withheld:string[], missing:string[]}}
 */
export function answerHealthRequest(store, fields, approvedGroups) {
  const values = {}; const provided = []; const withheld = []; const missing = [];
  const nowMs = store.now();
  for (const id of [...new Set(fields)].filter(isHealthField)) {
    const def = fieldDef(id);
    if (!approvedGroups.includes(def.group)) { values[id] = { withheld: true }; withheld.push(id); continue; }
    const e = store.get(id);
    if (!e) { values[id] = { not_in_pdv: true }; missing.push(id); continue; }
    values[id] = { value: e.value, asof: e.asof, source: e.source, stale: isStale(def, e, nowMs) };
    provided.push(id);
  }
  return { values, provided, withheld, missing };
}

// ─────────────────────────── 서비스가 제안한 갱신 ───────────────────────────

export const MAX_PROPOSALS = 5;

/**
 * 서비스(K-Doctor)가 "이 내용을 건강 기록에 저장해 달라"고 제안한 항목을 검증한다. 저장은 사용자가 승인한 것만(applyProposals).
 * 진단 참고·추정 진단은 제안할 수 없다: 필드는 HEALTH_FIELDS뿐이고, 값은 사용자가 말한 사실이어야 한다(evidence 필수).
 */
export function normalizeProposals(raw) {
  const out = [];
  for (const p of Array.isArray(raw) ? raw.slice(0, MAX_PROPOSALS) : []) {
    const def = fieldDef(p?.field);
    if (!def) continue;
    const v = validateValue(def, p.value);
    if (!v.ok) continue;
    const evidence = String(p.evidence ?? '').trim().slice(0, 200);
    if (!evidence) continue;
    out.push({ field: def.id, label: def.label, group: def.group, value: v.value, evidence });
  }
  return out;
}

export function applyProposals(store, proposals, approvedFields) {
  const applied = []; const rejected = [];
  for (const p of proposals) {
    if (!approvedFields.includes(p.field)) { rejected.push(p.field); continue; }
    const r = store.merge(p.field, p.value, { source: 'service_proposal_approved' });
    (r.ok ? applied : rejected).push(p.field);
  }
  return { applied, rejected };
}
