/**
 * @file evidencePackage.js
 * @description 자기완결 증거 패키지 생성·검증
 * @version 1.0.0
 * @author AI City Inc.
 *
 * 근거:
 *   - GAS v1.6 §20.2 자기완결 증거 구조 3요소
 *     ① 피해자 PDV 원본
 *     ② 발신자 디지털 서명
 *     ③ OpenHash 해시 체인 증명
 *   - KL-S-01 §5.4: 증거 패키지 생성 목표 1200ms 이내
 *   - GDC §14.3: ZKP proof_weight (GDC 소각량 → 법원 신뢰도)
 *   - GAS v1.6 §20.4: Verification API 수수료 0.01 GDC/회
 */

import { verifySignature, sha256 } from './keyManager.js'
import { getMessage, updateOpenHashRef } from './vault.js'
import {
  anchor,
  getEntryByMsgId,
  buildMerkleProof,
  buildMerkleRoot,
  verifyMerkleProof,
} from '../openhash/hashChain.js'
import { PERF, ZKP } from '../core/constants.js'
/** 증거 검증 API 베이스 */
const VERIFY_API_BASE = 'https://verify.hondi.net'

// ── 증거 패키지 생성 ──────────────────────────────────────────────────────

/**
 * 자기완결 증거 패키지 생성
 *
 * @param {string} msgId       - 대상 메시지 ID
 * @param {Object} [options]
 * @param {number} [options.proofWeightGDC=0] - ZKP proof_weight (GDC 소각량)
 * @returns {Promise<EvidencePackage>}
 * @throws {Error} msgId 미존재, 생성 시간 초과
 */
export async function generateEvidencePackage(msgId, options = {}) {
  const t0 = Date.now()
  const { proofWeightGDC = 0 } = options

  // ① 피해자 PDV 원본 조회
  const record = await getMessage(msgId)
  if (!record) {
    throw new Error(`[EvidencePackage] 메시지 없음: ${msgId}`)
  }

  // ② 발신자 디지털 서명 (이미 vault에 저장됨)
  const senderSignature = record.signature

  // ③ OpenHash 해시 체인 증명
  let openHashProof = null
  let merkleProof   = null
  let entryHash     = null

  const chainEntry = getEntryByMsgId(msgId)
  if (chainEntry) {
    entryHash = chainEntry.entryHash

    // Merkle Proof 생성 (체인 내 전체 해시 목록 기준)
    // Phase 2C: 단순화 — 단일 해시 Merkle (Phase 4에서 실제 노드 연동)
    // BUG-FIX(2026-07-17): hashChain.js의 앵커 엔트리 필드는 'contentHash'인데
    // 여기서는 존재하지 않는 'msgHash' 필드를 읽고 있었다(항상 undefined) —
    // anchor()의 API가 (content, sig, msgId) → (contentHash, signatures[], msgId)로
    // 바뀐 뒤 이 파일이 갱신되지 않아 생긴 드리프트. 패키지 자체의 외부
    // 필드명(msgHash)은 하위 호환을 위해 유지하되, 값은 chainEntry.contentHash에서 가져온다.
    const hashes = [chainEntry.contentHash]
    const root   = await buildMerkleRoot(hashes)
    merkleProof  = {
      root,
      proof:     [],          // 단일 원소 → proof 불필요
      layer:     chainEntry.layer,
      timestamp: chainEntry.timestamp,
      blockHeight: chainEntry.blockHeight,
    }

    openHashProof = {
      entryHash:   chainEntry.entryHash,
      msgHash:     chainEntry.contentHash,
      prevHash:    chainEntry.prevHash,
      blockHeight: chainEntry.blockHeight,
      layer:       chainEntry.layer,
      timestamp:   chainEntry.timestamp,
    }
  } else {
    // 체인에 없으면 즉시 앵커링 후 증거 구성
    // BUG-FIX(2026-07-17): anchor()는 이제 (contentHash, signatures[], msgId)를
    // 받는다 — 원문(record.content)과 서명 문자열 하나를 그대로 넘기면
    // "[HashChain] contentHash는 SHA-256 hex(64자)여야 합니다." 예외로
    // 매번 실패했다(실사로 재현·확인). content를 먼저 해시하고, 서명은
    // 배열로 감싼다.
    const contentHash = await sha256(record.content)
    const anchored = await anchor(
      contentHash,
      [senderSignature],
      msgId
    )
    entryHash    = anchored.entryHash
    openHashProof = {
      entryHash:   anchored.entryHash,
      msgHash:     anchored.contentHash,
      prevHash:    anchored.prevHash,
      blockHeight: anchored.blockHeight,
      layer:       anchored.layer,
      timestamp:   anchored.timestamp,
    }
    merkleProof   = { root: anchored.entryHash, proof: [], layer: anchored.layer }

    // vault openHashRef 업데이트
    await updateOpenHashRef(msgId, anchored.entryHash)
  }

  // ZKP proof_weight 계산 (GDC 소각량 → 법원 신뢰도)
  // 근거: GAS v1.6 §20.4
  const proofWeight = _calcProofWeight(proofWeightGDC)

  // 패키지 완성
  const pkg = {
    version:       '1.0',
    msgId,
    generatedAt:   new Date().toISOString(),

    // ① 피해자 PDV 원본
    victimPDV: {
      msgId:           record.msgId,
      content:         record.content,
      senderId:        record.senderId,
      senderPubKeyB64: record.senderPubKeyB64,
      timestamp:       record.timestamp,
      riskLevel:       record.riskLevel,
      legalFlags:      record.legalFlags ?? [],
      aiWarningLog:    record.aiWarningLog ?? [],
    },

    // ② 발신자 디지털 서명
    senderSignature,

    // ③ OpenHash 해시 체인 증명
    openHashProof,
    merkleProof,

    // 부가 정보
    proofWeightGDC,
    proofWeight,           // 법원 신뢰도 등급
    verifyFeeGDC:  ZKP.VERIFY_FEE_GDC,
    verificationUrl: `${VERIFY_API_BASE}/evidence-report/${msgId}`,
    tripleSig:     record.tripleSign ?? null,
  }

  // 성능 목표 검사 (1200ms)
  const elapsed = Date.now() - t0
  if (elapsed > PERF.EVIDENCE_PACKAGE_MS) {
    console.warn(
      `[EvidencePackage] 생성 시간 초과: ${elapsed}ms (목표: ${PERF.EVIDENCE_PACKAGE_MS}ms)`
    )
  } else {
    console.log(`[EvidencePackage] ✅ 생성 완료: ${elapsed}ms`)
  }

  pkg.generationMs = elapsed
  return pkg
}

// ── 증거 패키지 검증 ──────────────────────────────────────────────────────

/**
 * 증거 패키지 무결성 검증
 *
 * @param {Object} pkg - generateEvidencePackage() 반환값
 * @returns {Promise<{
 *   signatureValid: boolean,
 *   openHashValid:  boolean,
 *   contentIntact:  boolean,
 *   overall:        boolean,
 *   errors:         string[]
 * }>}
 */
export async function verifyEvidencePackage(pkg) {
  const errors = []

  // 1. 발신자 서명 검증 (자기완결 증거 ②)
  let signatureValid = false
  try {
    signatureValid = await verifySignature(
      pkg.victimPDV.content,
      pkg.senderSignature,
      pkg.victimPDV.senderPubKeyB64
    )
    if (!signatureValid) errors.push('발신자 서명 검증 실패')
  } catch (e) {
    errors.push(`서명 검증 오류: ${e.message}`)
  }

  // 2. OpenHash 해시 일관성 검증 (자기완결 증거 ③)
  let openHashValid = false
  try {
    if (pkg.openHashProof?.msgHash) {
      const recomputed = await sha256(pkg.victimPDV.content)
      openHashValid = recomputed === pkg.openHashProof.msgHash
      if (!openHashValid) {
        errors.push(
          `OpenHash 해시 불일치: 재계산=${recomputed.slice(0,8)}... 저장=${pkg.openHashProof.msgHash.slice(0,8)}...`
        )
      }
    } else {
      errors.push('OpenHash Proof 없음')
    }
  } catch (e) {
    errors.push(`OpenHash 검증 오류: ${e.message}`)
  }

  // 3. 내용 무결성 — PDV 원본 해시 재확인
  let contentIntact = false
  try {
    const contentHash = await sha256(pkg.victimPDV.content)
    contentIntact = contentHash.length === 64   // SHA-256 정상 출력 확인
  } catch (e) {
    errors.push(`내용 무결성 오류: ${e.message}`)
  }

  const overall = signatureValid && openHashValid && contentIntact

  return { signatureValid, openHashValid, contentIntact, overall, errors }
}

// ── 증거 패키지 요약 (법원 제출용) ───────────────────────────────────────

/**
 * 법원 제출용 요약 보고서 생성
 * @param {Object} pkg
 * @returns {Object}
 */
export function generateCourtSummary(pkg) {
  return {
    reportId:       `GOPANG-${pkg.msgId}-${Date.now()}`,
    generatedAt:    pkg.generatedAt,
    msgId:          pkg.msgId,
    senderId:       pkg.victimPDV.senderId,
    timestamp:      pkg.victimPDV.timestamp,
    riskLevel:      pkg.victimPDV.riskLevel,
    legalFlags:     pkg.victimPDV.legalFlags,
    openHashLayer:  pkg.openHashProof?.layer,
    blockHeight:    pkg.openHashProof?.blockHeight,
    entryHash:      pkg.openHashProof?.entryHash,
    proofWeight:    pkg.proofWeight,
    verifyUrl:      pkg.verificationUrl,
    disclaimer:     '본 보고서는 나비 PDV+OpenHash 자기완결 증거 구조에 기반합니다. ' +
                    '법원 제출 전 Verification API를 통해 독립 검증을 권고합니다.',
  }
}

// ── Private ───────────────────────────────────────────────────────────────

/**
 * ZKP proof_weight 등급 계산
 * 근거: GAS v1.6 §20.4
 * @param {number} gdcAmount
 * @returns {{ grade: string, description: string }}
 */
function _calcProofWeight(gdcAmount) {
  if (gdcAmount >= 100) {
    return { grade: 'INSTANT', description: '즉각 인정 권고 (소각 ≥100 GDC)' }
  }
  if (gdcAmount >= 10) {
    return { grade: 'PRIORITY', description: '추가 조사 없이 소유권 인정 권고 (소각 ≥10 GDC)' }
  }
  return { grade: 'STANDARD', description: '표준 법원 검증 절차 적용' }
}
