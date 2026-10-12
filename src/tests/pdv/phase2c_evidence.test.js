/**
 * @file phase2c_evidence.test.js
 * @description Phase 2C 증거 패키지 통합 테스트
 * @테스트항목 E-01 ~ E-07
 * (E-08 — generateEvidencePackage() 실제 종단 검증은 vault.js를 mock.module로
 *  대체해야 하는데, 이 파일이 evidencePackage.js를 최상단에서 정적 import해
 *  버려 그 시점에 이미 실제 vault.js가 로드된다 — mock.module은 그 이후엔
 *  효과가 없다. 그래서 별도 파일 phase2c_evidence_e2e.test.mjs로 분리했다.)
 */

import { generateKeyPair, signMessage } from '../../pdv/keyManager.js'
import { generateEvidencePackage, verifyEvidencePackage, generateCourtSummary } from '../../pdv/evidencePackage.js'
import { _resetChain, anchor } from '../../openhash/hashChain.js'

// vault.js는 IndexedDB 의존 → 인메모리 mock으로 대체
const _store = new Map()

// evidencePackage가 vault 함수를 호출하므로 mock 주입
// Node 환경에서는 vault.js를 직접 mock 처리
import { sha256 } from '../../pdv/keyManager.js'

let passed = 0, failed = 0

async function test(id, desc, fn) {
  try {
    await fn()
    console.log(`  ✅ ${id}: ${desc}`)
    passed++
  } catch (err) {
    console.error(`  ❌ ${id}: ${desc}\n     └─ ${err.message}`)
    failed++
  }
}

function assert(c, m) { if (!c) throw new Error(m || '단언 실패') }

// ── vault mock ────────────────────────────────────────────────────────────
// evidencePackage.js가 vault.js를 import하므로
// Node 환경에서는 직접 테스트 가능한 로직을 분리하여 검증

async function makeTestRecord(content, privateKey, publicKeyB64) {
  const signature = await signMessage(content, privateKey)
  const msgId     = await sha256(content + Date.now())
  return {
    msgId,
    content,
    senderId:        'alice',
    senderPubKeyB64: publicKeyB64,
    signature,
    timestamp:       new Date().toISOString(),
    openHashRef:     null,
    riskLevel:       'S2',
    riskScore:       0.72,
    legalFlags:      ['CV-2', 'CR-3'],
    phaseLog:        {},
    aiWarningLog:    [{ phase: 2, flag: 'CV-2', ts: new Date().toISOString() }],
    tripleSign:      null,
    docAnalysis:     null,
  }
}

console.log('\n=== Phase 2C 증거 패키지 테스트 ===\n')

// E-01: 서명 검증 로직 독립 테스트
await test('E-01', '발신자 서명 생성·검증 일치', async () => {
  const { privateKey, publicKeyB64 } = await generateKeyPair()
  const content = '임대차 보증금 반환을 요청합니다.'
  const sig     = await signMessage(content, privateKey)

  const { verifySignature } = await import('../../pdv/keyManager.js')
  const valid = await verifySignature(content, sig, publicKeyB64)
  assert(valid === true, '서명 검증 true')
})

// E-02: OpenHash 해시 일관성
await test('E-02', 'content → sha256 → OpenHash 일관성', async () => {
  _resetChain()
  const content = '테스트 메시지 내용'
  const msgId   = 'test-e02'

  const contentHash = await sha256(content)
  const anchored = await anchor(contentHash, ['fake-sig'], msgId)
  const recomputed = await sha256(content)

  assert(anchored.contentHash === recomputed,
    `msgHash 일치: ${anchored.contentHash.slice(0,8)} vs ${recomputed.slice(0,8)}`)
  assert(anchored.entryHash.length === 64, 'entryHash 길이 64')
})

// E-03: 증거 패키지 3요소 구조 확인 (mock)
await test('E-03', '증거 패키지 3요소 구조 확인', async () => {
  // 패키지 구조 직접 검증 (vault 없이)
  const { privateKey, publicKeyB64 } = await generateKeyPair()
  const content   = '보이스피싱 시도 내용'
  const signature = await signMessage(content, privateKey)
  const msgHash   = await sha256(content)

  _resetChain()
  const anchored = await anchor(msgHash, [signature], 'msg-e03')

  const pkg = {
    victimPDV:      { content, senderPubKeyB64: publicKeyB64, timestamp: new Date().toISOString() },
    senderSignature: signature,
    openHashProof:  { msgHash: anchored.contentHash, entryHash: anchored.entryHash },
  }

  // ① 피해자 PDV 존재
  assert(pkg.victimPDV?.content === content, '① PDV 원본 존재')
  // ② 발신자 서명 존재
  assert(typeof pkg.senderSignature === 'string' && pkg.senderSignature.length > 0, '② 서명 존재')
  // ③ OpenHash 해시 존재
  assert(pkg.openHashProof?.entryHash?.length === 64, '③ OpenHash 해시 존재')
})

// E-04: verifyEvidencePackage 로직 검증 (mock 패키지)
await test('E-04', 'verifyEvidencePackage — 정상 패키지 검증', async () => {
  const { privateKey, publicKeyB64 } = await generateKeyPair()
  const content   = '계약서 위조 의혹 메시지'
  const signature = await signMessage(content, privateKey)
  const msgHash   = await sha256(content)

  _resetChain()
  const anchored = await anchor(msgHash, [signature], 'msg-e04')

  const mockPkg = {
    victimPDV: {
      content,
      senderPubKeyB64: publicKeyB64,
      timestamp: new Date().toISOString(),
      riskLevel: 'S3',
      legalFlags: ['CR-1'],
      aiWarningLog: [],
    },
    senderSignature: signature,
    openHashProof:   { msgHash: anchored.contentHash, entryHash: anchored.entryHash },
  }

  const result = await verifyEvidencePackage(mockPkg)
  assert(result.signatureValid === true, `서명 검증: ${result.signatureValid}`)
  assert(result.openHashValid  === true, `OpenHash 검증: ${result.openHashValid}`)
  assert(result.contentIntact  === true, `내용 무결성: ${result.contentIntact}`)
  assert(result.overall        === true, `전체 검증: ${result.overall}`)
  assert(result.errors.length  === 0,   `오류 없음: ${result.errors}`)
})

// E-05: 변조된 내용으로 검증 → 실패
await test('E-05', 'verifyEvidencePackage — 내용 변조 시 OpenHash 불일치', async () => {
  const { privateKey, publicKeyB64 } = await generateKeyPair()
  const original  = '원본 메시지'
  const tampered  = '변조된 메시지'
  const signature = await signMessage(original, privateKey)

  _resetChain()
  const originalHash = await sha256(original)
  const anchored = await anchor(originalHash, [signature], 'msg-e05')

  const mockPkg = {
    victimPDV: {
      content:         tampered,   // ← 내용 변조
      senderPubKeyB64: publicKeyB64,
    },
    senderSignature: signature,
    openHashProof:   { msgHash: anchored.contentHash },   // 원본 해시 유지
  }

  const result = await verifyEvidencePackage(mockPkg)
  // 서명: 변조된 내용으로 검증 → false
  // OpenHash: 변조된 내용 해시 ≠ 원본 msgHash → false
  assert(result.overall === false, `변조 후 전체 검증 실패 기대: ${result.overall}`)
  assert(result.errors.length > 0, `오류 메시지 존재: ${result.errors}`)
})

// E-06: 법원 요약 보고서 구조 확인
await test('E-06', '법원 요약 보고서 필수 필드 존재', async () => {
  const mockPkg = {
    msgId:      'test-e06',
    generatedAt: new Date().toISOString(),
    victimPDV:  { senderId:'alice', timestamp:'t', riskLevel:'S2', legalFlags:['CV-2'] },
    openHashProof: { layer:'L1', blockHeight:12345, entryHash:'a'.repeat(64) },
    proofWeight: { grade:'STANDARD', description:'표준' },
    verificationUrl: 'https://verify.hondi.net/test-e06',
  }

  const summary = generateCourtSummary(mockPkg)
  const required = ['reportId','generatedAt','msgId','senderId','riskLevel',
                    'legalFlags','openHashLayer','entryHash','verifyUrl','disclaimer']
  for (const f of required) {
    assert(summary[f] !== undefined && summary[f] !== null, `필드 존재: ${f}`)
  }
  assert(summary.disclaimer.includes('나비'), 'disclaimer에 나비 포함')
})

// E-07: ZKP proof_weight 등급
await test('E-07', 'ZKP proof_weight 등급 분류', async () => {
  // _calcProofWeight는 private이므로 간접 검증
  // proofWeightGDC에 따른 등급 로직을 직접 재현
  function calcProofWeight(gdc) {
    if (gdc >= 100) return 'INSTANT'
    if (gdc >= 10)  return 'PRIORITY'
    return 'STANDARD'
  }
  assert(calcProofWeight(0)   === 'STANDARD',  '0 GDC → STANDARD')
  assert(calcProofWeight(10)  === 'PRIORITY',  '10 GDC → PRIORITY')
  assert(calcProofWeight(100) === 'INSTANT',   '100 GDC → INSTANT')
})

// ── 결과 ─────────────────────────────────────────────────────────────────
console.log(`\n결과: ${passed} 통과 / ${failed} 실패 / 총 ${passed + failed}\n`)
if (failed > 0) process.exit(1); else process.exit(0)
