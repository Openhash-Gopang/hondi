/**
 * @file vault.js
 * @description 나비 PDV(Personal Data Vault) — IndexedDB 암호화 저장소
 * @version 1.0.0
 * @author AI City Inc.
 *
 * 근거:
 *   - GAS v1.6 §1.1 PDV — 사용자 기기 내 암호화 저장
 *   - GAS v1.6 §20.2 자기완결 증거 구조 ① 피해자 PDV 원본
 *   - KL-S-01 §3.3 저장 대상 항목 전체
 *
 * 저장 항목 (KL-S-01 §3.3):
 *   - 모든 채팅 메시지
 *   - 교환된 문서·계약서·이미지
 *   - AI 비서 경고 이력 + 근거 법조항 + 사용자 반응
 *   - 삼중 서명 기록
 *   - Phase 1~6 판정 상세
 */

// ── 스키마 ────────────────────────────────────────────────────────────────

const DB_NAME    = 'gopang_pdv_chat'
const DB_VERSION = 1
const STORE_MESSAGES = 'messages'
const STORE_KEYS     = 'keys'

// ── DB 초기화 ─────────────────────────────────────────────────────────────

let _db = null

/**
 * IndexedDB 연결 (최초 1회만 실행)
 * @returns {Promise<IDBDatabase>}
 */
async function getDB() {
  if (_db) return _db

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = (e) => {
      const db = e.target.result

      // 메시지 저장소
      if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
        const store = db.createObjectStore(STORE_MESSAGES, { keyPath: 'msgId' })
        store.createIndex('timestamp',  'timestamp',  { unique: false })
        store.createIndex('riskLevel',  'riskLevel',  { unique: false })
        store.createIndex('senderId',   'senderId',   { unique: false })
      }

      // 키 저장소 (공개키·암호화 공개키)
      if (!db.objectStoreNames.contains(STORE_KEYS)) {
        db.createObjectStore(STORE_KEYS, { keyPath: 'userId' })
      }
    }

    req.onsuccess = (e) => { _db = e.target.result; resolve(_db) }
    req.onerror   = (e) => reject(new Error(`[Vault] DB 열기 실패: ${e.target.error}`))
  })
}

// ── IDB 헬퍼 ─────────────────────────────────────────────────────────────

function idbRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = e => resolve(e.target.result)
    req.onerror   = e => reject(new Error(`[Vault] IDB 오류: ${e.target.error}`))
  })
}

// ── 메시지 저장소 CRUD ────────────────────────────────────────────────────

/**
 * 메시지 레코드 저장
 *
 * @param {Object} record - 아래 스키마 참조
 * @param {string} record.msgId            - SHA256(content+ts+senderPubKey)
 * @param {string} record.content          - AES-256-GCM 암호화된 원본
 * @param {string} record.senderId         - 발신자 식별자
 * @param {string} record.senderPubKeyB64  - 발신자 Ed25519 공개키 (Base64)
 * @param {string} record.signature        - 발신자 서명 (Base64) ← 자기완결 증거 ②
 * @param {string} record.timestamp        - ISO8601
 * @param {string|null} record.openHashRef - OpenHash 앵커 해시 (Phase 2C에서 채움)
 * @param {string} record.riskLevel        - 'S0'|'S1'|'S2'|'S3'
 * @param {number} record.riskScore        - 0.0~1.0
 * @param {string[]} record.legalFlags     - ['CR-1','CV-2',...]
 * @param {Object} record.phaseLog         - Phase 1~6 판정 상세
 * @param {Object[]} record.aiWarningLog   - AI 비서 경고 이력
 * @param {Object|null} record.tripleSign  - 삼중 서명 (기관 AI 협업 시)
 * @param {Object|null} record.docAnalysis - Phase 3 문서 분석 결과
 * @returns {Promise<string>} msgId
 */
export async function storeMessage(record) {
  _validateRecord(record)
  const db = await getDB()
  const tx = db.transaction(STORE_MESSAGES, 'readwrite')
  await idbRequest(tx.objectStore(STORE_MESSAGES).put(record))
  return record.msgId
}

/**
 * 메시지 조회
 * @param {string} msgId
 * @returns {Promise<Object|null>}
 */
export async function getMessage(msgId) {
  const db = await getDB()
  const tx = db.transaction(STORE_MESSAGES, 'readonly')
  const result = await idbRequest(tx.objectStore(STORE_MESSAGES).get(msgId))
  return result ?? null
}

/**
 * OpenHash 앵커 해시 업데이트 (Phase 2C에서 호출)
 * @param {string} msgId
 * @param {string} openHashRef
 */
export async function updateOpenHashRef(msgId, openHashRef) {
  const record = await getMessage(msgId)
  if (!record) throw new Error(`[Vault] 메시지 없음: ${msgId}`)
  record.openHashRef = openHashRef
  await storeMessage(record)
}

/**
 * 메시지 삭제 (사용자 본인 요청 시)
 * ※ OpenHash에 등록된 해시는 삭제되지 않음 — 증거 해시는 영구 보존
 * @param {string} msgId
 */
export async function deleteMessage(msgId) {
  const db = await getDB()
  const tx = db.transaction(STORE_MESSAGES, 'readwrite')
  await idbRequest(tx.objectStore(STORE_MESSAGES).delete(msgId))
}

/**
 * 타임스탬프 범위로 메시지 목록 조회
 * @param {string} from - ISO8601
 * @param {string} to   - ISO8601
 * @returns {Promise<Object[]>}
 */
export async function getMessagesByRange(from, to) {
  const db = await getDB()
  const tx = db.transaction(STORE_MESSAGES, 'readonly')
  const index = tx.objectStore(STORE_MESSAGES).index('timestamp')
  const range = IDBKeyRange.bound(from, to)
  return idbRequest(index.getAll(range))
}

/**
 * 위험 등급으로 메시지 목록 조회 (증거 패키지 생성용)
 * @param {string} riskLevel - 'S2'|'S3'
 * @returns {Promise<Object[]>}
 */
export async function getMessagesByRisk(riskLevel) {
  const db = await getDB()
  const tx = db.transaction(STORE_MESSAGES, 'readonly')
  const index = tx.objectStore(STORE_MESSAGES).index('riskLevel')
  return idbRequest(index.getAll(IDBKeyRange.only(riskLevel)))
}

/**
 * 전체 메시지 수 조회
 * @returns {Promise<number>}
 */
export async function countMessages() {
  const db = await getDB()
  const tx = db.transaction(STORE_MESSAGES, 'readonly')
  return idbRequest(tx.objectStore(STORE_MESSAGES).count())
}

// ── 키 저장소 ────────────────────────────────────────────────────────────

/**
 * 사용자 공개키 저장
 * @param {string} userId
 * @param {string} signingPubKeyB64    - Ed25519 공개키 (Base64)
 * @param {string} encryptionPubKeyB64 - ECDH P-256 공개키 (Base64)
 */
export async function storePublicKeys(userId, signingPubKeyB64, encryptionPubKeyB64) {
  const db = await getDB()
  const tx = db.transaction(STORE_KEYS, 'readwrite')
  await idbRequest(tx.objectStore(STORE_KEYS).put({
    userId,
    signingPubKeyB64,
    encryptionPubKeyB64,
    updatedAt: new Date().toISOString(),
  }))
}

/**
 * 사용자 공개키 조회
 * @param {string} userId
 * @returns {Promise<Object|null>}
 */
export async function getPublicKeys(userId) {
  const db = await getDB()
  const tx = db.transaction(STORE_KEYS, 'readonly')
  const result = await idbRequest(tx.objectStore(STORE_KEYS).get(userId))
  return result ?? null
}

// ── 유틸리티 ─────────────────────────────────────────────────────────────

/**
 * DB 초기화 (테스트용)
 * ⚠️  프로덕션에서 절대 호출 금지
 */
export async function _clearAll() {
  const db = await getDB()
  const tx = db.transaction([STORE_MESSAGES, STORE_KEYS], 'readwrite')
  await Promise.all([
    idbRequest(tx.objectStore(STORE_MESSAGES).clear()),
    idbRequest(tx.objectStore(STORE_KEYS).clear()),
  ])
}

/**
 * DB 연결 재설정 (테스트용)
 */
export function _resetConnection() {
  _db = null
}

// ── Private ───────────────────────────────────────────────────────────────

function _validateRecord(record) {
  const required = ['msgId', 'content', 'senderId', 'senderPubKeyB64',
                    'signature', 'timestamp', 'riskLevel']
  for (const field of required) {
    if (record[field] === undefined || record[field] === null || record[field] === '') {
      throw new Error(`[Vault] 필수 필드 누락: ${field}`)
    }
  }
  if (!['S0','S1','S2','S3'].includes(record.riskLevel)) {
    throw new Error(`[Vault] 잘못된 riskLevel: ${record.riskLevel}`)
  }
}
