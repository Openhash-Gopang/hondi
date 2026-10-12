/* ─────────────────────────────────────────────────────────────────────
   idv-store.js — 나비 ID볼트 (Identity/Document Vault)
   Openhash-Gopang/passport, Phase 0.2

   ⚠️ gopang_pdv_store(pdv-store.js)와 이름이 다르고 목적도 다르다.
   - pdv_store  = "무슨 일이 있었는지"의 6하원칙 상호작용 로그
   - idv_store  = "무엇을 증명할 수 있는지"의 서명된 credential 원본 보관함
   두 저장소는 서로 참조하지 않는다. 혼동 방지를 위해 이 파일은
   gopang_pdv_store와 다른 IndexedDB 데이터베이스(gopang_idv_vault)를 쓴다.

   서명 검증은 src/pdv/keyManager.js의 verifySignature()를 그대로 재사용한다
   (Ed25519, non-extractable 키 정책 승계 — 이 파일 자체는 키를 생성하지 않음,
   발급기관 서명 검증과 credential 조회/삭제만 담당).

   ⚠️ 2026-08-13 gopang 이식(SSOT 사본, 원본은 Openhash-Gopang/passport
   client/idv/idv-store.js) — import 경로만 gopang 실제 폴더 구조
   (src/pdv/keyManager.js, 이 파일 기준 ../../pdv/keyManager.js)에 맞게
   수정, 나머지 로직은 원본 그대로. keyManager.js/pdv-history-client.js를
   klaw/gdc/security에 SSOT 사본으로 배포했던 기존 관례(2026-07-17)와
   동일한 방식.
   ───────────────────────────────────────────────────────────────────── */
import { verifySignature, sha256 } from '../../pdv/keyManager.js';

const DB_NAME = 'gopang_idv_vault';
const DB_VERSION = 1;
const STORE = 'credentials';

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        // keyPath: credential.id (VC의 최상위 id 필드, urn 형식)
        const os = db.createObjectStore(STORE, { keyPath: 'id' });
        os.createIndex('type', 'type', { unique: false, multiEntry: true });
        os.createIndex('issuerId', 'issuer.id', { unique: false });
        os.createIndex('status', '_status', { unique: false }); // 'active' | 'revoked'
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

/**
 * 발급기관 서명을 검증한 뒤에만 저장한다 — 미검증 credential은 저장 자체를 거부.
 * @param {Object} credential - credential-schema.json 형식의 VC 객체
 * @param {string} issuerPubKeyB64 - 발급기관 공개키 (issuer DID Document에서 조회한 값)
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function storeCredential(credential, issuerPubKeyB64) {
  if (!credential?.id || !credential?.proof?.proofValue) {
    return { ok: false, reason: 'credential 구조 불완전 (id/proof 누락)' };
  }

  // 서명 대상 재구성: proof를 제외한 나머지 전체를 정규화해 서명했다고 가정
  // (실제 서명 생성부와 반드시 동일한 정규화 규칙을 써야 함 — Phase 0.3에서 확정)
  const { proof, ...unsigned } = credential;
  const canonical = JSON.stringify(unsigned);

  const valid = await verifySignature(canonical, proof.proofValue, issuerPubKeyB64);
  if (!valid) {
    console.warn('[idv-store] 서명 검증 실패 — 저장 거부:', credential.id);
    return { ok: false, reason: 'signature_invalid' };
  }

  const db = await openDB();
  const record = {
    ...credential,
    _status: 'active',
    _storedAt: new Date().toISOString(),
    _contentHash: await sha256(canonical), // Phase 2 오픈해시 감사 로그 대조용
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve({ ok: true });
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * (2026-08-13 신설) 사용자가 정부24 등에서 이미 발급받아 온 파일을 직접
 * 업로드해 저장하는 경량 경로. `storeCredential()`은 발급기관의 Ed25519
 * VC 서명(`proof.proofValue`)을 검증할 수 있어야 하는데, 실제 정부24/
 * dpaper.kr 발급 문서는 그 형식이 아니라(GPKI 등 별도 체계) 지금 당장은
 * 검증할 방법이 없다 — dpaper.kr API 연동(Phase 0 로드맵)이 되기 전까지는
 * 이 함수로 "검증되지 않음" 등급으로만 저장한다.
 *
 * ⚠ 오해 방지: 이 함수로 저장한 문서는 정부 서명이 검증된 것이 아니라
 * "사용자 본인이 업로드했다"는 사실만 기록된다. 다만 현재 시점에서
 * kgov의 GOV_TASK_SUBMIT_REQUEST 경로 자체도 사용자가 새로 첨부하는
 * 파일에 대해 정부 서명을 암호학적으로 검증하지 않는다(sha256 형식
 * 검증뿐, 접수기관의 인간 검토에 의존) — 따라서 이 경로로 저장된
 * 문서를 나중에 꺼내 쓰는 것은 신뢰 수준상 "그때그때 새로 첨부하는 것과
 * 동일"하며, 더 낮아지지 않는다. 나중에 dpaper.kr API 연동이 되면
 * 이 함수 대신 `storeCredential()`(정식 서명 검증)로 이관해야 한다.
 *
 * @param {Object} p
 * @param {string} p.idvType - REQUIRED_DOCUMENTS_REGISTRY 문서 항목의 idv_type과 동일한 값
 * @param {string} p.issuanceDate - 사용자가 입력한 발급일(ISO date-time)
 * @param {string} p.name - 원본 파일명(표시용)
 * @param {string} p.sha256 - chat-input.js에서 이미 계산된 해시(재계산 안 함)
 * @param {string|null} [p.extractedText] - 본문 추출 결과(있으면 참고용으로 함께 저장)
 * @param {string|null} [p.issuerNameGuess] - 발급기관 추정명(사용자 입력, 검증되지 않음)
 * @returns {Promise<{ok:boolean, id?:string, reason?:string}>}
 */
export async function storeRawDocument({ idvType, issuanceDate, name, sha256: fileSha256, extractedText = null, issuerNameGuess = null }) {
  if (!idvType || !issuanceDate || !fileSha256) {
    return { ok: false, reason: '필수값 누락(idvType/issuanceDate/sha256)' };
  }
  const id = `urn:hondi:idv:raw:${fileSha256}`;
  const db = await openDB();
  const record = {
    id,
    type: ['VerifiableCredential', idvType],
    issuer: { id: null, name: issuerNameGuess, agencyType: null },
    issuanceDate,
    credentialSubject: { holderDid: null, sourceFileName: name, extractedTextPreview: extractedText ? extractedText.slice(0, 500) : null },
    _status: 'active',
    _storedAt: new Date().toISOString(),
    _contentHash: fileSha256,
    _verificationTier: 'user_uploaded_unverified', // storeCredential()의 검증된 credential과 구분
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve({ ok: true, id });
    tx.onerror = () => reject(tx.error);
  });
}

/** id로 단건 조회 (서명 재검증 없이 로컬 원본 그대로 반환) */
export async function getCredential(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/** 타입별 목록 조회 — 예: listByType('idv.identity.drivers_license') */
export async function listByType(type) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).index('type').getAll(type);
    req.onsuccess = () => resolve((req.result || []).filter(r => r._status === 'active'));
    req.onerror = () => reject(req.error);
  });
}

/** 전체 목록 (제시 UI — 지갑 카드 리스트용) */
export async function listAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * 로컬 폐기 마킹. 실제 폐기 권한은 발급기관에 있으므로, 이 함수는
 * "발급기관이 이미 폐기 처리했음을 사용자 기기에 반영"하는 용도다.
 * Phase 2에서 오픈해시 감사 로그 조회 결과로 자동 호출될 예정.
 */
export async function markRevoked(id) {
  const record = await getCredential(id);
  if (!record) return { ok: false, reason: 'not_found' };
  record._status = 'revoked';
  record._revokedAt = new Date().toISOString();
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve({ ok: true });
    tx.onerror = () => reject(tx.error);
  });
}

/** 사용자 본인 요청에 의한 완전 삭제 (증거 보존 의무가 없는 일반 신분증/증명서용) */
export async function deleteCredential(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * kgov 연동용(2026-08-13 신설) — 특정 idv_type의 credential 중
 * max_age_days 기준을 만족하는 가장 최근 것 하나를 반환한다.
 * REQUIRED_DOCUMENTS_REGISTRY의 idv_type/max_age_days 필드와 짝을 이룬다
 * (worker.js, SP-10_kpublic §IDV-자동첨부 참고). 신선도 계산 기준일은
 * credential.issuanceDate(정부 발급일)이지 IDV 저장일(_storedAt)이 아니다
 * — "얼마나 최근에 저장했는지"가 아니라 "얼마나 최근에 발급됐는지"가
 * 제출받는 기관의 관심사이기 때문.
 * @param {string} idvType
 * @param {number|null} maxAgeDays - null이면 신선도 검사를 건너뛰고 issuanceDate만 확인
 * @returns {Promise<Object|null>} - 없으면 null
 */
export async function findFreshCredential(idvType, maxAgeDays) {
  const candidates = await listByType(idvType);
  if (!candidates.length) return null;

  const withDate = candidates
    .filter(c => c.issuanceDate)
    .sort((a, b) => new Date(b.issuanceDate) - new Date(a.issuanceDate));
  if (!withDate.length) return null;

  const newest = withDate[0];
  if (maxAgeDays == null) return newest; // 신선도 기준 미확정 — issuanceDate 존재만 확인

  const ageMs = Date.now() - new Date(newest.issuanceDate).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return ageDays <= maxAgeDays ? newest : null;
}

// gopang의 다른 src/*/이.js 모듈(keyManager.js 등)과 동일하게 순수 ESM named
// export만 사용 — window 전역 부착은 하지 않는다(passport 원본은 웹앱
// 프로토타입이라 window.GopangIDV를 썼으나, gopang은 이미 import 기반이라
// 불필요한 전역 노출).
