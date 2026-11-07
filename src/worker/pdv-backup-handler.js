// PDV 클라우드 백업(방식 C) 서버 측 — 기본 저장소 L1 PocketBase `pdv_backups` (2026-11-08 신설)
//
// 서버는 암호문(base64)만 보관한다. 복호화 키(DEK)는 사용자의 복구 문구로만 열린다.
// 인증: 본인만 자기 guid 의 객체를 읽고 쓴다(지갑 서명 또는 phone_verify_token — K-서비스 공용 게이트).
//
//   store.get(guid,name) → {data,ts,size}|null    store.put(guid,name,{data,size,ts})
//   store.list(guid,prefix) → string[]            store.remove(guid,name)    store.count(guid) → number
//   auth(body) → {ok:true,guid}|{ok:false,status,code,message}   (sigMsg 는 호출부가 op 별로 만든다)

export const NAME_RE = /^pdv\/[A-Za-z0-9._-]{1,100}$/;
export const GUID_RE = /^[A-Za-z0-9._-]{3,100}$/;
export const MAX_OBJECT_B64 = 8_000_000; // base64 문자 수 (원본 약 6MB)
export const MAX_OBJECTS = 300;          // 사용자당 객체 수 (헤더·인덱스·스냅샷 포함)

const err = (status, code, message) => ({ status, json: { ok: false, code, message } });
const ok = (extra) => ({ status: 200, json: { ok: true, ...extra } });

export function makePdvBackupServer({ auth, store, now = () => Date.now() }) {
  if (typeof auth !== 'function' || !store) throw new Error('makePdvBackupServer: auth, store 필요');

  async function gate(body, needName) {
    if (!body || typeof body !== 'object') return { e: err(400, 'INVALID_JSON', 'JSON body 필수') };
    const a = await auth(body);
    if (!a.ok) return { e: err(a.status || 401, a.code || 'AUTH_REQUIRED', a.message || '본인 인증이 필요합니다') };
    if (!GUID_RE.test(String(a.guid))) return { e: err(400, 'BAD_GUID', 'guid 형식 오류') };
    if (needName && !NAME_RE.test(String(body.name || ''))) return { e: err(400, 'BAD_NAME', '객체 이름 형식 오류') };
    return { guid: String(a.guid) };
  }

  return {
    async put(body) {
      const g = await gate(body, true); if (g.e) return g.e;
      const data = body.data;
      if (typeof data !== 'string' || !data || !/^[A-Za-z0-9+/=]+$/.test(data)) return err(400, 'BAD_DATA', 'data 는 base64 문자열이어야 합니다');
      if (data.length > MAX_OBJECT_B64) return err(413, 'TOO_LARGE', '백업 1건이 너무 큽니다');
      const existing = await store.get(g.guid, body.name);
      if (!existing && (await store.count(g.guid)) >= MAX_OBJECTS) return err(409, 'QUOTA', '백업 객체 수 한도를 넘었습니다');
      await store.put(g.guid, body.name, { data, size: data.length, ts: now() });
      return ok({ name: body.name, size: data.length });
    },
    async get(body) {
      const g = await gate(body, true); if (g.e) return g.e;
      const row = await store.get(g.guid, body.name);
      if (!row) return err(404, 'NOT_FOUND', '백업이 없습니다');
      return ok({ name: body.name, data: row.data, ts: row.ts });
    },
    async list(body) {
      const g = await gate(body, false); if (g.e) return g.e;
      const prefix = String(body.prefix || '');
      if (prefix && !/^pdv\/[A-Za-z0-9._-]{0,100}$/.test(prefix)) return err(400, 'BAD_NAME', 'prefix 형식 오류');
      return ok({ names: (await store.list(g.guid, prefix)).sort() });
    },
    async remove(body) {
      const g = await gate(body, true); if (g.e) return g.e;
      await store.remove(g.guid, body.name);
      return ok({});
    },
  };
}

// ── L1 PocketBase 저장소 ──
const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
export function makePocketBasePdvBackupStore({ base, getToken, fetchImpl = fetch }) {
  if (!base || typeof getToken !== 'function') throw new Error('makePocketBasePdvBackupStore: base, getToken 필요');
  const url = (p) => `${base}/api/collections/pdv_backups/records${p}`;
  const hdr = async () => ({ 'Authorization': `Bearer ${await getToken()}`, 'Content-Type': 'application/json' });
  async function find(guid, name, fields) {
    const f = `guid='${q(guid)}' && name='${q(name)}'`;
    const r = await fetchImpl(url(`?filter=${encodeURIComponent(f)}&perPage=1${fields ? '&fields=' + fields : ''}`), { headers: await hdr() });
    if (!r.ok) throw new Error(`L1 조회 실패 (HTTP ${r.status})`);
    return ((await r.json()).items || [])[0] || null;
  }
  return {
    async get(guid, name) { return find(guid, name); },
    async put(guid, name, { data, size, ts }) {
      const row = await find(guid, name, 'id');
      const body = JSON.stringify({ guid, name, data, size, ts });
      const r = row
        ? await fetchImpl(url(`/${row.id}`), { method: 'PATCH', headers: await hdr(), body })
        : await fetchImpl(url(''), { method: 'POST', headers: await hdr(), body });
      if (!r.ok) throw new Error(`L1 저장 실패 (HTTP ${r.status})`);
    },
    async list(guid, prefix = '') {
      const names = [];
      for (let page = 1; page <= 10; page++) {
        const f = `guid='${q(guid)}'` + (prefix ? ` && name~'${q(prefix)}'` : '');
        const r = await fetchImpl(url(`?filter=${encodeURIComponent(f)}&fields=name&perPage=200&page=${page}`), { headers: await hdr() });
        if (!r.ok) throw new Error(`L1 조회 실패 (HTTP ${r.status})`);
        const d = await r.json();
        for (const it of d.items || []) if (!prefix || it.name.startsWith(prefix)) names.push(it.name);
        if (page >= (d.totalPages || 1)) break;
      }
      return names;
    },
    async remove(guid, name) {
      const row = await find(guid, name, 'id');
      if (!row) return;
      const r = await fetchImpl(url(`/${row.id}`), { method: 'DELETE', headers: await hdr() });
      if (!r.ok && r.status !== 404) throw new Error(`L1 삭제 실패 (HTTP ${r.status})`);
    },
    async count(guid) {
      const f = `guid='${q(guid)}'`;
      const r = await fetchImpl(url(`?filter=${encodeURIComponent(f)}&fields=id&perPage=1`), { headers: await hdr() });
      if (!r.ok) throw new Error(`L1 조회 실패 (HTTP ${r.status})`);
      return (await r.json()).totalItems || 0;
    },
  };
}
