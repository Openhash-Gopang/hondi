/**
 * hondi-consent-sale.js — "합의매각"(consent-based sale) 서명 프로토콜 (2026-09-27 신설)
 *
 * 배경: K-Estate에 "채권자·채무자 합의로만 등록되는 부동산 매물" 기능을 통합한다
 * (주피터님 지시). 대법원 경매 사이트를 참고하되, 법원의 개시결정에 의한 경매가
 * 아니라 순수 당사자 합의 절차이므로 "경매"라는 말은 쓰지 않는다 — 명칭은
 * "합의매각".
 *
 * 서명 방식은 혼디 숫자 코드(hondi-digit-claim.js)와 같은 원리(Ed25519,
 * gopangWallet 호환 {sign, publicKeyB64u} 서명자, 정규화 문자열에 서명)를
 * 그대로 재사용하되, 숫자 코드처럼 "한 사람이 서명하는 레코드 체인"이 아니라
 * "같은 한 장의 제안서(payload)에 채권자·채무자 두 사람이 각각 서명 — 둘 다
 * 모여야 등록 확정"이라는 다른 요구사항이라 별도 모듈로 둔다(주피터님 확인:
 * 2026-09-27, "채권자·채무자 두 계정이 각각 지갑으로 서명 → 두 서명이 다
 * 모여야 등록 확정").
 *
 * 흐름:
 *   1) draft  — 제안자가 매물 정보 + 상대방 guid를 서버(consent-sale-handler.js)에
 *      보내면, 서버가 양측 guid→pubkey를 해석해 payload를 확정하고 payload_hash를
 *      돌려준다(서버가 확정해야 두 서명자가 정확히 같은 문자열에 서명할 수 있다 —
 *      클라이언트가 각자 상대 pubkey를 안다고 가정할 수 없기 때문).
 *   2) sign   — 제안자·상대방이 각각 이 모듈의 canonical(payload)에 자기 지갑으로
 *      서명해 서버에 제출한다. 두 서명이 다 모이면 서버가 상태를 active로 바꾼다.
 *
 * WebCrypto(Ed25519)만 쓰므로 브라우저·Cloudflare Worker·Node 22에서 그대로 동작한다.
 */

export const SALE_VERSION = 1;
export const SALE_NS = 'hondi.net/consent-sale';   // 도메인 분리 — 다른 용도의 서명과 섞이지 않게
export const ROLES = ['creditor', 'debtor'];
export const PROPERTY_TYPES = ['단독주택', '아파트', '연립다세대', '상가', '토지', '기타'];

// ── 바이트/인코딩 (hondi-digit-claim.js와 동일 구현 — 의존 안 하고 그대로 복제해
//    두 모듈이 서로 다른 용도로 독립적으로 진화해도 안전하게 함) ──────────────
const enc = new TextEncoder();
function b64uToBytes(s) {
  const b = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export async function sha256Hex(str) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(str)));
  return [...h].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** region/property_type/price/description(해시로만 커밋)/양측 pubkey/ts — 서명 대상 정규화 문자열.
 *  description은 통째로 서명 문자열에 넣지 않고 해시만 넣는다(길이 제한 없이 자유롭게 써도
 *  서명 문자열은 고정 길이 — hondi-digit-claim.js의 canonical() 설계 원칙과 동일). */
export function canonical(p) {
  return [
    `v=${p.v}`, `ns=${p.ns}`, `region=${p.region}`, `property_type=${p.property_type}`,
    `price=${p.price}`, `description_hash=${p.description_hash}`,
    `creditor_pubkey=${p.creditor_pubkey}`, `debtor_pubkey=${p.debtor_pubkey}`, `ts=${p.ts}`,
  ].join('\n');
}
export async function payloadHash(p) { return sha256Hex(canonical(p)); }

// ── 서명/검증 ─────────────────────────────────────────────────
async function importPub(pubB64u) {
  return crypto.subtle.importKey('raw', b64uToBytes(pubB64u), { name: 'Ed25519' }, false, ['verify']);
}
export async function verifySig(pubB64u, message, sigB64u) {
  try {
    return await crypto.subtle.verify('Ed25519', await importPub(pubB64u), b64uToBytes(sigB64u), enc.encode(message));
  } catch { return false; }
}

/** 두 서명이 각자의 역할 pubkey로 이 payload에 유효한지 확인 — 하나라도 비어있거나 틀리면 false. */
export async function verifyBothSigned(p, creditorSig, debtorSig) {
  if (!creditorSig || !debtorSig) return false;
  const msg = canonical(p);
  return (await verifySig(p.creditor_pubkey, msg, creditorSig)) && (await verifySig(p.debtor_pubkey, msg, debtorSig));
}

/** 값 검증 — 등록 단계에서 명백히 잘못된 입력을 조기에 걸러낸다. */
export function validateFields({ region, property_type, price, description }) {
  if (typeof region !== 'string' || region.trim().length < 2 || region.length > 60) return '지역을 2~60자로 입력해 주세요.';
  if (!PROPERTY_TYPES.includes(property_type)) return `유형은 ${PROPERTY_TYPES.join('/')} 중 하나여야 합니다.`;
  if (!Number.isFinite(price) || price <= 0 || price > 1_000_000_000_000) return '가격이 올바르지 않습니다.';
  if (description != null && (typeof description !== 'string' || description.length > 2000)) return '설명은 2000자 이내여야 합니다.';
  return null;
}
