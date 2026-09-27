// ═════════════════════════════════════════════════
// "합의매각" API — K-Estate에 통합된 채권자·채무자 합의 기반 부동산 매물 (2026-09-27 신설)
//
// 배경: 대법원 경매 사이트를 참고하되, 법원 개시결정에 의한 절차가 아니라 순수
// 당사자 합의 절차이므로 "경매"라는 말은 쓰지 않는다(주피터님 지시). 등록은
// 채권자·채무자 두 계정이 각자 지갑으로 서명해야만 확정된다(혼디 숫자 코드와
// 같은 Ed25519 서명 원리 재사용 — hondi-consent-sale.js).
//
// 엔드포인트
//   POST /consent-sale/draft        { my_guid, role, counterparty_guid, region,
//                                      property_type, price, description }
//                                    → 서버가 양측 guid→pubkey를 해석해 payload를
//                                    확정하고 돌려준다(서명은 그다음 단계).
//   POST /consent-sale/sign         { id, guid, sig }  제안자·상대방이 각자 서명
//                                    제출 — 둘 다 모이면 status가 active로 바뀐다.
//   GET  /consent-sale/search       ?region=&property_type=&min_price=&max_price=
//                                    active 매물만 공개 검색(신원 정보 노출 안 함).
//   POST /consent-sale/search-nl    { query } — 자연어 문장을 조건으로 해석해 검색.
//   POST /consent-sale/appraise     { id, guid } — 당사자만, AI 참고 감정가 생성
//                                    (법적 효력 없는 참고치 — SP_appraiser와 동일 원칙).
//   GET  /consent-sale/mine         ?guid= — 내가 채권자·채무자인 매물 전체(서명
//                                    대기 포함) — K-Estate 대시보드용.
//
// l1 인터페이스(consent-sale-store.js가 구현):
//   create(row) / getById(id) / update(id, patch) / search(filter) / findMine(pubkey)
//
// chatText 인터페이스(자연어 파싱·참고 감정가용, 기본은 deepseek-client.js의
// deepseekChatText — 테스트에서는 목(mock)으로 주입):
//   chatText({ env, model, messages, max_tokens, timeoutMs, fallbackText }) → string
// ═════════════════════════════════════════════════
import {
  SALE_VERSION, SALE_NS, ROLES, PROPERTY_TYPES,
  canonical, payloadHash, verifySig, sha256Hex, validateFields,
} from '../gopang/ai/hondi-consent-sale.js';
import { deepseekChatText as defaultChatText } from '../gopang/core/deepseek-client.js';

function json(obj, status = 200, cors = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors } });
}
function err(status, code, message, cors) { return json({ ok: false, code, message }, status, cors); }

function toPayload(rec) {
  return {
    v: SALE_VERSION, ns: SALE_NS, region: rec.region, property_type: rec.property_type,
    price: rec.price, description_hash: rec.description_hash,
    creditor_pubkey: rec.creditor_pubkey, debtor_pubkey: rec.debtor_pubkey, ts: rec.ts,
  };
}

function publicListing(rec) {
  return {
    id: rec.id, region: rec.region, property_type: rec.property_type, price: rec.price,
    description: rec.description || '', status: rec.status,
    appraisal_value: rec.appraisal_value ?? null, appraisal_note: rec.appraisal_note || '',
    appraised_at: rec.appraised_at ?? null, ts: rec.ts,
  };
}

function parseJsonLoose(text) {
  if (!text) return null;
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(cleaned); } catch { return null; }
}

export function makeConsentSaleHandler({ l1, getPinnedPubKey, chatText = defaultChatText }) {
  if (!l1?.create || !l1?.getById || !l1?.update || !l1?.search || !l1?.findMine) {
    throw new Error('makeConsentSaleHandler: l1.{create,getById,update,search,findMine} 필요');
  }
  if (typeof getPinnedPubKey !== 'function') throw new Error('makeConsentSaleHandler: getPinnedPubKey 필요');

  async function handleDraft(request, env, cors) {
    let body; try { body = await request.json(); } catch { return err(400, 'MALFORMED', '요청 본문이 JSON이 아닙니다.', cors); }
    const { my_guid, role, counterparty_guid, region, property_type, price, description } = body || {};
    if (!my_guid || !counterparty_guid) return err(400, 'MISSING', 'my_guid/counterparty_guid가 필요합니다.', cors);
    if (!ROLES.includes(role)) return err(400, 'ROLE', `role은 ${ROLES.join('|')} 중 하나여야 합니다.`, cors);
    const badField = validateFields({ region, property_type, price: Number(price), description });
    if (badField) return err(400, 'FIELD', badField, cors);

    const myPubkey = await getPinnedPubKey(env, my_guid);
    if (!myPubkey) return err(404, 'NO_ACCOUNT', '내 계정을 찾을 수 없습니다.', cors);
    const cpPubkey = await getPinnedPubKey(env, counterparty_guid);
    if (!cpPubkey) return err(404, 'COUNTERPARTY_NOT_FOUND', '상대방 계정을 찾을 수 없습니다.', cors);
    if (myPubkey === cpPubkey) return err(400, 'SELF_DEAL', '채권자와 채무자는 서로 다른 계정이어야 합니다.', cors);

    const creditor_pubkey = role === 'creditor' ? myPubkey : cpPubkey;
    const debtor_pubkey = role === 'creditor' ? cpPubkey : myPubkey;
    const creditor_guid = role === 'creditor' ? my_guid : counterparty_guid;
    const debtor_guid = role === 'creditor' ? counterparty_guid : my_guid;

    const description_hash = await sha256Hex(description || '');
    const ts = Date.now();
    const payload = { v: SALE_VERSION, ns: SALE_NS, region, property_type, price: Number(price), description_hash, creditor_pubkey, debtor_pubkey, ts };
    const hash = await payloadHash(payload);

    let rec;
    try {
      rec = await l1.create({
        region, property_type, price: Number(price), description: description || '', description_hash,
        creditor_pubkey, debtor_pubkey, creditor_guid, debtor_guid, creditor_sig: '', debtor_sig: '',
        ts, payload_hash: hash, status: 'draft_unsigned', proposer_role: role,
      });
    } catch (e) { return err(502, 'L1_ERROR', e.message, cors); }

    return json({ ok: true, id: rec.id, payload }, 200, cors);
  }

  async function handleSign(request, env, cors) {
    let body; try { body = await request.json(); } catch { return err(400, 'MALFORMED', '요청 본문이 JSON이 아닙니다.', cors); }
    const { id, guid, sig } = body || {};
    if (!id || !guid || !sig) return err(400, 'MISSING', 'id/guid/sig가 필요합니다.', cors);

    let rec; try { rec = await l1.getById(id); } catch (e) { return err(502, 'L1_ERROR', e.message, cors); }
    if (!rec) return err(404, 'NOT_FOUND', '매물을 찾을 수 없습니다.', cors);
    if (rec.status === 'active') return err(409, 'ALREADY_ACTIVE', '이미 양측 서명이 완료된 매물입니다.', cors);
    if (rec.status === 'cancelled' || rec.status === 'sold') return err(409, 'CLOSED', '이미 종료된 매물입니다.', cors);

    const pinned = await getPinnedPubKey(env, guid);
    if (!pinned) return err(404, 'NO_ACCOUNT', '계정을 찾을 수 없습니다.', cors);

    let role;
    if (pinned === rec.creditor_pubkey) role = 'creditor';
    else if (pinned === rec.debtor_pubkey) role = 'debtor';
    else return err(403, 'NOT_PARTY', '이 매물의 채권자·채무자 계정이 아닙니다.', cors);

    if (rec[`${role}_sig`]) return err(409, 'ALREADY_SIGNED', '이미 서명을 제출했습니다.', cors);

    const payload = toPayload(rec);
    if (!(await verifySig(pinned, canonical(payload), sig))) return err(403, 'BAD_SIG', '서명이 유효하지 않습니다.', cors);

    const otherRole = role === 'creditor' ? 'debtor' : 'creditor';
    const bothSigned = !!rec[`${otherRole}_sig`];
    const patch = { [`${role}_sig`]: sig, status: bothSigned ? 'active' : 'pending_countersign' };

    let updated; try { updated = await l1.update(id, patch); } catch (e) { return err(502, 'L1_ERROR', e.message, cors); }
    return json({ ok: true, status: updated.status, listing: publicListing(updated) }, 200, cors);
  }

  async function handleSearch(url, cors) {
    const region = url.searchParams.get('region') || undefined;
    const property_type = url.searchParams.get('property_type') || undefined;
    const min_price = url.searchParams.has('min_price') ? Number(url.searchParams.get('min_price')) : undefined;
    const max_price = url.searchParams.has('max_price') ? Number(url.searchParams.get('max_price')) : undefined;
    let rows; try { rows = await l1.search({ status: 'active', region, property_type, min_price, max_price }); }
    catch (e) { return err(502, 'L1_ERROR', e.message, cors); }
    return json({ ok: true, listings: rows.map(publicListing) }, 200, cors);
  }

  // 자연어 조건 파싱 — 실패/무결과를 정직하게 알린다(K-Estate SP Rule 7과 같은 원칙:
  // 지어내지 않는다). 파싱 자체가 안 되면 parsed:null과 함께 그 사실을 note로 알린다.
  async function handleSearchNl(request, env, cors) {
    let body; try { body = await request.json(); } catch { return err(400, 'MALFORMED', '요청 본문이 JSON이 아닙니다.', cors); }
    const query = (body?.query || '').trim();
    if (!query || query.length > 300) return err(400, 'QUERY', '질의는 1~300자여야 합니다.', cors);

    const sys = `당신은 부동산 합의매각 검색 조건 추출기입니다. 사용자 문장에서 지역(region)·` +
      `유형(property_type, ${PROPERTY_TYPES.join('/')} 중 하나 또는 null)·최고가(max_price, 원 단위 정수 ` +
      `또는 null)·최저가(min_price, 원 단위 정수 또는 null)를 추출해 오직 JSON 객체 하나만 출력하세요. ` +
      `설명·코드블록 없이 {"region":"","property_type":null,"max_price":null,"min_price":null} 형식만 출력합니다. ` +
      `찾을 수 없는 값은 null로 둡니다.`;
    const text = await chatText({
      env, model: 'deepseek-v4-flash', max_tokens: 200, timeoutMs: 12000, fallbackText: '',
      messages: [{ role: 'system', content: sys }, { role: 'user', content: query }],
    });
    const parsed = parseJsonLoose(text);
    const hasAny = parsed && (parsed.region || parsed.property_type || parsed.max_price || parsed.min_price);
    if (!hasAny) return json({ ok: true, parsed: null, listings: [], note: '질의에서 검색 조건을 찾지 못했습니다.' }, 200, cors);

    let rows; try {
      rows = await l1.search({
        status: 'active', region: parsed.region || undefined, property_type: parsed.property_type || undefined,
        min_price: Number.isFinite(parsed.min_price) ? parsed.min_price : undefined,
        max_price: Number.isFinite(parsed.max_price) ? parsed.max_price : undefined,
      });
    } catch (e) { return err(502, 'L1_ERROR', e.message, cors); }
    return json({ ok: true, parsed, listings: rows.map(publicListing) }, 200, cors);
  }

  // AI 참고 감정가 — SP_appraiser와 동일한 원칙: 법정 감정평가서가 아니라 참고치일
  // 뿐이며, 당사자(채권자·채무자)만 요청할 수 있다(비용·오남용 통제).
  async function handleAppraise(request, env, cors) {
    let body; try { body = await request.json(); } catch { return err(400, 'MALFORMED', '요청 본문이 JSON이 아닙니다.', cors); }
    const { id, guid } = body || {};
    if (!id || !guid) return err(400, 'MISSING', 'id/guid가 필요합니다.', cors);

    let rec; try { rec = await l1.getById(id); } catch (e) { return err(502, 'L1_ERROR', e.message, cors); }
    if (!rec) return err(404, 'NOT_FOUND', '매물을 찾을 수 없습니다.', cors);
    if (rec.status !== 'active') return err(409, 'NOT_ACTIVE', '양측 서명이 완료된 매물만 참고 감정가를 생성할 수 있습니다.', cors);

    const pinned = await getPinnedPubKey(env, guid);
    if (!pinned) return err(404, 'NO_ACCOUNT', '계정을 찾을 수 없습니다.', cors);
    if (pinned !== rec.creditor_pubkey && pinned !== rec.debtor_pubkey) return err(403, 'NOT_PARTY', '이 매물의 채권자·채무자 계정이 아닙니다.', cors);

    const sys = '당신은 부동산 참고 감정가를 추정하는 보조자입니다. 이것은 법정 감정평가서가 아니라 ' +
      '법적 효력이 없는 참고치임을 항상 전제합니다. 주어진 지역·유형·희망가·설명만으로 대략적인 ' +
      '참고 감정가(원 단위 정수)와 한 줄 근거를 오직 JSON {"value":0,"note":""} 형식으로만 출력하세요.';
    const user = `지역: ${rec.region}\n유형: ${rec.property_type}\n희망 매각가: ${rec.price}원\n설명: ${rec.description || '(없음)'}`;
    const text = await chatText({
      env, model: 'deepseek-v4-flash', max_tokens: 300, timeoutMs: 15000, fallbackText: '',
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
    });
    const parsed = parseJsonLoose(text);
    const value = Number(parsed?.value);
    if (!Number.isFinite(value) || value <= 0 || value > 1_000_000_000_000) {
      return err(502, 'APPRAISAL_FAILED', '참고 감정가를 생성하지 못했습니다.', cors);
    }
    const note = typeof parsed.note === 'string' ? parsed.note.slice(0, 1000) : '';
    const appraised_at = Date.now();

    let updated; try { updated = await l1.update(id, { appraisal_value: value, appraisal_note: note, appraised_at }); }
    catch (e) { return err(502, 'L1_ERROR', e.message, cors); }
    return json({ ok: true, appraisal_value: updated.appraisal_value, appraisal_note: updated.appraisal_note, appraised_at: updated.appraised_at }, 200, cors);
  }

  async function handleMine(url, env, cors) {
    const guid = url.searchParams.get('guid') || '';
    if (!guid) return err(400, 'MISSING', 'guid가 필요합니다.', cors);
    const pinned = await getPinnedPubKey(env, guid);
    if (!pinned) return err(404, 'NO_ACCOUNT', '계정을 찾을 수 없습니다.', cors);
    let rows; try { rows = await l1.findMine(pinned); } catch (e) { return err(502, 'L1_ERROR', e.message, cors); }
    const listings = rows.map(r => ({
      id: r.id, region: r.region, property_type: r.property_type, price: r.price, description: r.description || '',
      status: r.status, my_role: r.creditor_pubkey === pinned ? 'creditor' : 'debtor',
      creditor_signed: !!r.creditor_sig, debtor_signed: !!r.debtor_sig,
      appraisal_value: r.appraisal_value ?? null, ts: r.ts,
      // 서명(또는 상대 서명 대기) 화면에서 canonical(payload)를 그대로 재구성해 서명할 수
      // 있도록, 이 매물의 두 당사자 본인에게는 payload 원본 필드를 전부 돌려준다 — 이미
      // draft 단계에서 서로의 pubkey를 알고 시작하는 사이라 새로운 노출이 아니다.
      description_hash: r.description_hash, creditor_pubkey: r.creditor_pubkey, debtor_pubkey: r.debtor_pubkey,
    }));
    return json({ ok: true, listings }, 200, cors);
  }

  async function handle(request, url, env, cors = {}) {
    const path = url.pathname;
    try {
      if (request.method === 'POST' && path === '/consent-sale/draft') return await handleDraft(request, env, cors);
      if (request.method === 'POST' && path === '/consent-sale/sign') return await handleSign(request, env, cors);
      if (request.method === 'GET' && path === '/consent-sale/search') return await handleSearch(url, cors);
      if (request.method === 'POST' && path === '/consent-sale/search-nl') return await handleSearchNl(request, env, cors);
      if (request.method === 'POST' && path === '/consent-sale/appraise') return await handleAppraise(request, env, cors);
      if (request.method === 'GET' && path === '/consent-sale/mine') return await handleMine(url, env, cors);
      return err(404, 'NOT_FOUND', '알 수 없는 경로입니다.', cors);
    } catch (e) {
      return err(500, 'INTERNAL', e.message, cors);
    }
  }

  return { handle };
}
