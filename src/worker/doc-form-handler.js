// ═════════════════════════════════════════════════
// 나비 서식 DB API (2026-10-14 신설) — SP_DOC_FORM §4의 코드 쪽 구현
//
//   GET  /doc-form/find?agency=&name=&form_no=   같은 서식의 최신 버전(본문 포함). 없으면 {found:false}
//   GET  /doc-form/list?agency=&q=               서식 목록(본문 제외, 서식별 최신 버전)
//   POST /doc-form/save                          { agency,name,form_no?,form_class,body,fields?,version_date?,source,source_note?,persona?,consent,guid,ts,sig }
//   POST /doc-form/review                        { keyHash,version,status,official_url?,guid,ts,sig }  (운영자 전용)
//
// 원칙
//   · 빈 서식만 저장한다. 주민등록번호·전화·이메일·카드번호처럼 보이는 값이 있으면 422로 거절한다(안전망 — 1차 제거는 SP가 한다).
//   · 저장은 consent:true(공용 저장 동의)가 있어야 한다. 새 저장의 status는 항상 user_provided.
//   · 같은 서식의 본문이 최신과 같으면 새 버전을 만들지 않고 기존 것을 돌려준다(duplicate:true).
//   · 공개 응답에는 기여자(contributor)·서명을 싣지 않는다.
//   · reviewed / official_verified 는 env.DOC_FORM_ADMINS(guid 또는 공개키, 쉼표 구분)의 서명으로만. official_verified 는 .go.kr 공식 URL 필요.
//   · 서명: 핀된 지갑 키. 저장 메시지 "hondi-doc-form\n{agency}\n{name}\n{form_no}\n{ts}\n{bodyHash}" (문자열은 보낸 그대로, body는 정규화 후 해시)
//   · dpaper.kr API 호환은 보류(2026-10-14 결정).
// ═════════════════════════════════════════════════
import { verifySig } from '../gopang/ai/hondi-digit-claim.js';

const json = (body, status, cors = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors } });
const err = (status, code, message, cors, extra = {}) => json({ ok: false, code, message, ...extra }, status, cors);

export const MAX_BODY = 60000;
export const DAILY_LIMIT = 20;
export const DAY_MS = 24 * 60 * 60 * 1000;
const STATUSES = ['user_provided', 'reviewed', 'official_verified'];
const NOTICE = {
  user_provided: '다른 이용자가 제공한 서식이며 공식 확인 전입니다. 제출 전 해당 기관 양식과 대조하세요.',
  reviewed: '운영자가 검토한 서식입니다. 제출 전 해당 기관의 최신 양식과 대조하세요.',
  official_verified: '공식 출처로 확인된 서식입니다.',
};

export async function sha256Hex(s) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...h].map(b => b.toString(16).padStart(2, '0')).join('');
}
const normKey = s => String(s ?? '').normalize('NFC').toLowerCase().replace(/[\s·ㆍ\-_.()\[\]]/g, '');
export const normBody = s => String(s ?? '').replace(/\r\n?/g, '\n').trim();
export const keyHashOf = (agency, name, formNo) => sha256Hex(`${normKey(agency)}|${normKey(name)}|${normKey(formNo)}`);
export const saveMessage = (agency, name, formNo, ts, bodyHash) => `hondi-doc-form\n${agency}\n${name}\n${formNo}\n${ts}\n${bodyHash}`;
export const reviewMessage = (keyHash, version, status, ts) => `hondi-doc-form-review\n${keyHash}\n${version}\n${status}\n${ts}`;

// 개인정보로 보이는 값 — 빈 서식에는 있을 수 없다. (서식 안내문의 "예) 000-0000-0000" 같은 자리표시는 통과)
const PII = [
  ['주민·외국인등록번호', /(?<!\d)\d{6}\s?-\s?[1-8]\d{6}(?!\d)/],
  ['휴대전화번호', /(?<!\d)01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}(?!\d)/],
  ['이메일', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/],
  ['카드번호', /(?<!\d)\d{4}[-\s]\d{4}[-\s]\d{4}[-\s]\d{4}(?!\d)/],
];
export function findPii(text) {
  const hit = [];
  for (const [label, re] of PII) if (re.test(text)) hit.push(label);
  return hit;
}

const pub = (r, withBody) => ({
  keyHash: r.key_hash, version: r.version, agency: r.agency, name: r.name, formNo: r.form_no || '',
  formClass: r.form_class, status: r.status, versionDate: r.version_date || '', source: r.source,
  officialUrl: r.official_url || '', ts: r.ts, notice: NOTICE[r.status] || '',
  ...(withBody ? { body: r.body, fields: r.fields ?? null, sourceNote: r.source_note || '' } : {}),
});

export function makeDocFormHandler({ store, getPinnedPubKey, now = () => Date.now(), maxSkewMs = 10 * 60 * 1000 }) {
  if (!store?.latest || !store?.append) throw new Error('makeDocFormHandler: store 필요');
  if (typeof getPinnedPubKey !== 'function') throw new Error('makeDocFormHandler: getPinnedPubKey 필요');

  const str = (v, max) => typeof v === 'string' && v.trim() && v.length <= max ? v : null;

  async function handle(request, url, env, cors = {}) {
    try {
      const path = url.pathname;
      const nocache = { 'Cache-Control': 'no-store', ...cors };

      if (request.method === 'GET' && path === '/doc-form/find') {
        const agency = str(url.searchParams.get('agency'), 60), name = str(url.searchParams.get('name'), 100);
        const formNo = url.searchParams.get('form_no') || '';
        if (!agency || !name || formNo.length > 60) return err(400, 'MISSING', 'agency, name이 필요합니다.', cors);
        const rec = await store.latest(await keyHashOf(agency, name, formNo));
        return json(rec ? { ok: true, found: true, form: pub(rec, true) } : { ok: true, found: false }, 200, nocache);
      }

      if (request.method === 'GET' && path === '/doc-form/list') {
        const agency = (url.searchParams.get('agency') || '').slice(0, 60), kw = (url.searchParams.get('q') || '').slice(0, 60);
        const items = await store.search({ agency, q: kw, limit: 50 });
        return json({ ok: true, forms: items.map(r => pub(r, false)) }, 200, nocache);
      }

      if (request.method === 'POST' && path === '/doc-form/save') {
        const b = await request.json().catch(() => null) || {};
        const { agency, name, form_class, source, guid, sig } = b;
        const formNo = b.form_no ?? '';
        if (b.consent !== true) return err(400, 'NO_CONSENT', '공용 서식 저장 동의가 필요합니다.', cors);
        if (!str(agency, 60) || !str(name, 100) || typeof formNo !== 'string' || formNo.length > 60) return err(400, 'MISSING', '기관·서식명 형식이 올바르지 않습니다.', cors);
        if (!['A', 'B'].includes(form_class) || !['user_attached', 'ai_composed'].includes(source)) return err(400, 'MISSING', 'form_class(A/B), source(user_attached/ai_composed)가 필요합니다.', cors);
        if (typeof b.body !== 'string' || !normBody(b.body)) return err(400, 'MISSING', '서식 본문이 비어 있습니다.', cors);
        if (b.body.length > MAX_BODY) return err(413, 'TOO_LARGE', `서식 본문은 ${MAX_BODY}자 이하여야 합니다.`, cors);
        if (!guid || !sig || !Number.isInteger(b.ts)) return err(400, 'MISSING', '요청 형식이 올바르지 않습니다.', cors);
        if (Math.abs(now() - b.ts) > maxSkewMs) return err(400, 'STALE_TS', '시각 차이가 너무 큽니다. 기기 시계를 확인해 주세요.', cors);
        const fields = b.fields ?? null;
        if (fields !== null && (!Array.isArray(fields) || fields.length > 300)) return err(400, 'FIELDS', 'fields는 300개 이하 배열이어야 합니다.', cors);

        const body = normBody(b.body);
        const pii = findPii(body + '\n' + JSON.stringify(fields ?? ''));
        if (pii.length) return err(422, 'PII', `개인정보로 보이는 값(${pii.join(', ')})이 있어 저장하지 않았습니다. 기재된 값을 모두 지운 빈 서식만 저장할 수 있습니다.`, cors, { found: pii });

        const pinned = await getPinnedPubKey(env, guid);
        if (!pinned) return err(404, 'NO_ACCOUNT', '계정을 찾을 수 없습니다.', cors);
        const bodyHash = await sha256Hex(body);
        if (!(await verifySig(pinned, saveMessage(agency, name, formNo, b.ts, bodyHash), sig))) return err(401, 'BAD_SIG', '서명이 유효하지 않습니다.', cors);

        const keyHash = await keyHashOf(agency, name, formNo);
        const cur = await store.latest(keyHash);
        if (cur && cur.body_hash === bodyHash) return json({ ok: true, duplicate: true, form: pub(cur, false) }, 200, cors);

        if (typeof store.countSince === 'function' && (await store.countSince(pinned, now() - DAY_MS)) >= DAILY_LIMIT) return err(429, 'RATE', `하루 ${DAILY_LIMIT}건까지 저장할 수 있습니다.`, cors);

        const rec = {
          key_hash: keyHash, version: (cur ? cur.version : 0) + 1, agency: agency.trim(), name: name.trim(), form_no: formNo.trim(),
          form_class, status: 'user_provided', version_date: String(b.version_date || '').slice(0, 20), fields, body, body_hash: bodyHash,
          source, source_note: String(b.source_note || '').slice(0, 300), persona: String(b.persona || '').slice(0, 60),
          contributor: pinned, ts: b.ts, sig,
        };
        try { await store.append(rec); }
        catch (e) { if (e.message === 'CONFLICT') return err(409, 'STALE', '동시에 다른 저장이 있었습니다. 다시 시도해 주세요.', cors); throw e; }
        return json({ ok: true, duplicate: false, form: pub(rec, false) }, 200, cors);
      }

      if (request.method === 'POST' && path === '/doc-form/review') {
        const admins = String(env?.DOC_FORM_ADMINS || '').split(',').map(s => s.trim()).filter(Boolean);
        if (!admins.length) return err(503, 'NO_ADMIN', '운영자가 설정되지 않았습니다(DOC_FORM_ADMINS).', cors);
        const b = await request.json().catch(() => null) || {};
        const { keyHash, version, status, guid, sig } = b;
        if (!/^[0-9a-f]{64}$/.test(keyHash || '') || !Number.isInteger(version) || version < 1 || !STATUSES.includes(status) || !guid || !sig || !Number.isInteger(b.ts)) return err(400, 'MISSING', '요청 형식이 올바르지 않습니다.', cors);
        if (Math.abs(now() - b.ts) > maxSkewMs) return err(400, 'STALE_TS', '시각 차이가 너무 큽니다.', cors);
        const pinned = await getPinnedPubKey(env, guid);
        if (!pinned) return err(404, 'NO_ACCOUNT', '계정을 찾을 수 없습니다.', cors);
        if (!admins.includes(guid) && !admins.includes(pinned)) return err(403, 'NOT_ADMIN', '검토 권한이 없습니다.', cors);
        if (!(await verifySig(pinned, reviewMessage(keyHash, version, status, b.ts), sig))) return err(401, 'BAD_SIG', '서명이 유효하지 않습니다.', cors);
        let officialUrl = '';
        if (status === 'official_verified') {
          let u; try { u = new URL(b.official_url); } catch { u = null; }
          if (!u || u.protocol !== 'https:' || !/(^|\.)go\.kr$/i.test(u.hostname)) return err(422, 'OFFICIAL_URL', 'official_verified 는 .go.kr 공식 https 주소가 필요합니다.', cors);
          officialUrl = u.href.slice(0, 300);
        }
        const ok = await store.setStatus(keyHash, version, { status, official_url: officialUrl, reviewer: pinned, reviewed_ts: b.ts });
        return ok ? json({ ok: true, status }, 200, cors) : err(404, 'NO_FORM', '그 서식 버전이 없습니다.', cors);
      }

      return err(404, 'NOT_FOUND', '알 수 없는 경로입니다.', cors);
    } catch (e) {
      console.error('[DocFormHandler]', e.message);
      return err(500, 'INTERNAL', '서버 오류가 발생했습니다.', cors);
    }
  }
  return { handle };
}
