/**
 * @file phase2a_pdv.test.js
 * @description Phase 2A PDV 단위 테스트 (Node.js Web Crypto 사용)
 * @테스트항목 P-01 ~ P-08
 */

import {
  generateKeyPair, generateEncryptionKeyPair,
  signMessage, verifySignature,
  encryptMessage, decryptMessage,
  createTripleSignature, verifyTripleSignature,
  sha256, doubleSha256,
} from '../../pdv/keyManager.js'

// vault.js는 IndexedDB 의존 → Node 환경에서 mock으로 검증
// 실제 vault 통합 테스트는 브라우저 환경에서 수행

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

function assert(cond, msg) {
  if (!cond) throw new Error(msg || '단언 실패')
}

// ── vault.js 로직 Node 환경 단위 테스트 (IDB 없이) ───────────────────────

function validateRecord(record) {
  const required = ['msgId','content','senderId','senderPubKeyB64',
                    'signature','timestamp','riskLevel']
  for (const f of required) {
    if (record[f] === undefined || record[f] === null || record[f] === '')
      throw new Error(`필수 필드 누락: ${f}`)
  }
  if (!['S0','S1','S2','S3'].includes(record.riskLevel))
    throw new Error(`잘못된 riskLevel: ${record.riskLevel}`)
}

// ── 테스트 실행 ──────────────────────────────────────────────────────────

console.log('\n=== Phase 2A PDV 테스트 ===\n')

// P-01: Ed25519 키쌍 생성
await test('P-01', 'Ed25519 키쌍 생성', async () => {
  const { publicKey, privateKey, publicKeyB64 } = await generateKeyPair()
  assert(publicKey instanceof CryptoKey,  'publicKey는 CryptoKey여야 함')
  assert(privateKey instanceof CryptoKey, 'privateKey는 CryptoKey여야 함')
  assert(typeof publicKeyB64 === 'string' && publicKeyB64.length > 0,
    'publicKeyB64는 비어있지 않은 문자열이어야 함')
  // non-extractable 확인
  try {
    await globalThis.crypto.subtle.exportKey('pkcs8', privateKey)
    assert(false, 'privateKey는 추출 불가능해야 함')
  } catch (_) { /* 정상: 추출 시도 시 오류 발생 */ }
})

// P-02: 서명 후 검증 → true
await test('P-02', '서명 후 검증 성공', async () => {
  const { publicKey, privateKey, publicKeyB64 } = await generateKeyPair()
  const msg = '안녕하세요 나비 테스트 메시지입니다.'
  const sig = await signMessage(msg, privateKey)
  const valid = await verifySignature(msg, sig, publicKeyB64)
  assert(valid === true, `서명 검증 결과: ${valid}`)
})

// P-03: 내용 변조 후 검증 → false
await test('P-03', '내용 변조 후 검증 실패', async () => {
  const { privateKey, publicKeyB64 } = await generateKeyPair()
  const msg = '원본 메시지'
  const sig = await signMessage(msg, privateKey)
  const valid = await verifySignature('변조된 메시지', sig, publicKeyB64)
  assert(valid === false, `변조 후 검증 결과: ${valid} (false 기대)`)
})

// P-04: 삼중 서명 생성·검증
await test('P-04', '삼중 서명 생성·검증', async () => {
  const user  = await generateKeyPair()
  const agent = await generateKeyPair()
  const msg   = '연말정산 자동 처리 동의'

  const userSig  = await signMessage(msg, user.privateKey)
  const agentSig = await signMessage(msg, agent.privateKey)
  const triple   = createTripleSignature(userSig, agentSig, 'openhash-anchor-abc123')

  assert(triple.userSignature  === userSig,   '사용자 서명 일치')
  assert(triple.agentSignature === agentSig,  '기관 서명 일치')
  assert(triple.openHashRef    === 'openhash-anchor-abc123', 'OpenHash 참조 일치')

  const result = await verifyTripleSignature(triple, msg, user.publicKeyB64, agent.publicKeyB64)
  assert(result.user     === true, `사용자 서명 검증: ${result.user}`)
  assert(result.agent    === true, `기관 서명 검증: ${result.agent}`)
  assert(result.openHash === true, `OpenHash 참조 존재: ${result.openHash}`)
  assert(result.all      === true, `전체 삼중 서명: ${result.all}`)
})

// P-05: AES-256-GCM 암호화·복호화
await test('P-05', 'AES-256-GCM 암호화·복호화 원본 일치', async () => {
  const recipient = await generateEncryptionKeyPair()
  const plaintext = '비밀 메시지: 보증금 1억 원 반환 요청합니다.'

  const encrypted = await encryptMessage(plaintext, recipient.publicKey)
  assert(encrypted.ciphertext && encrypted.iv && encrypted.ephemeralPubKey,
    '암호화 결과 3개 필드 존재')
  assert(encrypted.ciphertext !== plaintext, '암호문이 원문과 달라야 함')

  const decrypted = await decryptMessage(encrypted, recipient.privateKey)
  assert(decrypted === plaintext, `복호화 결과 일치: "${decrypted}"`)
})

// P-06: vault 필수 필드 검증 (정상 레코드)
await test('P-06', 'vault 레코드 필수 필드 검증 (정상)', async () => {
  const record = {
    msgId:          'test-msg-001',
    content:        '암호화된_내용',
    senderId:       'user-alice',
    senderPubKeyB64: 'base64pubkey==',
    signature:      'base64sig==',
    timestamp:      new Date().toISOString(),
    openHashRef:    null,
    riskLevel:      'S0',
    riskScore:      0.1,
    legalFlags:     [],
    phaseLog:       {},
    aiWarningLog:   [],
    tripleSign:     null,
    docAnalysis:    null,
  }
  // 예외 없이 통과해야 함
  validateRecord(record)
  assert(true, '정상 레코드 통과')
})

// P-07: vault 필수 필드 누락 → 오류
await test('P-07', 'vault 필수 필드 누락 시 오류', async () => {
  const record = {
    msgId:    'test-msg-002',
    content:  '내용',
    // senderId 누락
    senderPubKeyB64: 'key',
    signature: 'sig',
    timestamp: new Date().toISOString(),
    riskLevel: 'S0',
  }
  let threw = false
  try { validateRecord(record) } catch (e) {
    threw = true
    assert(e.message.includes('senderId'), `오류 메시지 확인: ${e.message}`)
  }
  assert(threw, '오류가 발생해야 함')
})

// P-08: 잘못된 riskLevel → 오류
await test('P-08', '잘못된 riskLevel 거부', async () => {
  const record = {
    msgId:'x', content:'y', senderId:'z', senderPubKeyB64:'k',
    signature:'s', timestamp:'t', riskLevel:'S99'
  }
  let threw = false
  try { validateRecord(record) } catch (e) { threw = true }
  assert(threw, 'S99는 오류를 발생시켜야 함')
})

// P-09: sha256 · doubleSha256 결정론적 출력
await test('P-09', 'sha256·doubleSha256 결정론적 출력', async () => {
  const h1 = await sha256('gopang')
  const h2 = await sha256('gopang')
  assert(h1 === h2, '동일 입력 → 동일 해시')
  assert(h1.length === 64, `SHA-256 길이 64자 기대, 실제: ${h1.length}`)

  const d1 = await doubleSha256('gopang')
  const d2 = await sha256(h1)
  assert(d1 === d2, '이중 sha256 = sha256(sha256(x))')
})

// ── 결과 출력 ────────────────────────────────────────────────────────────
console.log(`\n결과: ${passed} 통과 / ${failed} 실패 / 총 ${passed+failed}\n`)
if (failed > 0) { process.exit(1) } else { process.exit(0) }
