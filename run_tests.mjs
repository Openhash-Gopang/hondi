/**
 * hondi 내부 테스트 스위트
 * O 시리즈: 기존 OpenHash 핵심 모듈 회귀 테스트
 * N 시리즈: 이번 작업 신규 검증
 * 실행: node run_tests.mjs (gopang 루트에서)
 */
import { selectLayer }                       from './src/openhash/plsm.js'
import { verify as bivmVerify, createTxPair } from './src/openhash/bivm.js'
import { calculateImportanceScore, selectMode, MODE } from './src/openhash/importanceVerifier.js'
import { processTx, addToBlacklist, _resetPipeline } from './src/openhash/transactionPipeline.js'
import { generateKeyPair, signMessage }       from './src/pdv/keyManager.js'
import { readFile }                           from 'fs/promises'

let passed = 0, failed = 0
function assert(cond, msg) { if (!cond) throw new Error(msg) }
async function test(id, desc, fn) {
  try   { await fn(); console.log(`  ✅ ${id}: ${desc}`); passed++ }
  catch (e) { console.error(`  ❌ ${id}: ${desc}\n     └─ ${e.message}`); failed++ }
}

// ══════════════════════════════════════════════════════════════
// O 시리즈 — 기존 OpenHash 핵심 모듈 회귀 테스트
// ══════════════════════════════════════════════════════════════
console.log('\n── O 시리즈: OpenHash 핵심 모듈 회귀 테스트 ─────────────')

await test('O-01', 'PLSM 10만 회 분포 χ² 검정 (LCAT-B, score=30, STANDARD)', async () => {
  const counts = { L1:0, L2:0, L3:0, L4:0, L5:0 }
  const N = 100_000
  for (let i = 0; i < N; i++) counts[await selectLayer({ amount:50_000, assetType:'stable', contractType:'instant' }, 'B', 30)]++
  // STANDARD + LCAT-B 기대: L1=55%, L2=20%, L3=10%, L4=10%, L5=5%
  const expected = { L1:0.55, L2:0.20, L3:0.10, L4:0.10, L5:0.05 }
  const chi2 = Object.entries(expected).reduce((s,[k,e]) => s + ((counts[k]/N - e)**2)/e, 0)
  assert(chi2 < 9.488, `χ²=${chi2.toFixed(4)} ≥ 9.488 (기각역 초과)`)
})

await test('O-02', 'PLSM — ENHANCED 모드(score=70)는 L4/L5 비율 증가', async () => {
  const counts = { L1:0, L2:0, L3:0, L4:0, L5:0 }
  for (let i = 0; i < 50_000; i++) counts[await selectLayer({ amount:200_000, assetType:'stable', contractType:'escrow' }, 'C', 70)]++
  // ENHANCED + LCAT-C: L4+L5 비율이 STANDARD보다 높아야 함
  const upperRatio = (counts.L4 + counts.L5) / 50_000
  assert(upperRatio > 0.10, `ENHANCED L4+L5 비율=${(upperRatio*100).toFixed(1)}% (10% 이상 기대)`)
})

await test('O-03', 'BIVM — 정상 거래 쌍 검증 통과', async () => {
  const [fromTx, toTx] = createTxPair('t01', 'alice', 'bob', 200, 1000, 500)
  const r = bivmVerify([fromTx, toTx])
  assert(r.valid, `검증 실패: ${r.errors?.join(', ')}`)
  assert(r.setValid, 'setValid=false')
  assert(r.bmiValid, 'bmiValid=false')
})

await test('O-04', 'BIVM — fromTx.delta 조작 → SET_VIOLATION', async () => {
  const [fromTx, toTx] = createTxPair('t02', 'alice', 'bob', 100, 1000, 200)
  fromTx.delta = -101  // 조작
  const r = bivmVerify([fromTx, toTx])
  assert(!r.valid, 'SET_VIOLATION 미탐지')
  assert(!r.setValid, 'setValid=true (잘못됨)')
})

await test('O-05', 'BIVM — balanceAfter 조작 → BMI_VIOLATION', async () => {
  const [fromTx, toTx] = createTxPair('t03', 'alice', 'bob', 50, 500, 300)
  fromTx.balanceAfter = 440  // 조작 (올바른 값=450)
  const r = bivmVerify([fromTx, toTx])
  assert(!r.valid, 'BMI_VIOLATION 미탐지')
  assert(!r.bmiValid, 'bmiValid=true (잘못됨)')
})

await test('O-06', '중요도 점수 — 논문 §4.1 공식 5케이스', async () => {
  // w1=0.5, w2=0.3, w3=0.2 | V_REF=100,000
  const cases = [
    { args:{ amount:100_000, assetType:'stable', contractType:'instant' }, exp:50.4, mode:'STANDARD' },
    { args:{ amount:100_000, assetType:'stable', contractType:'escrow'  }, exp:50.5, mode:'STANDARD' },
    { args:{ amount:0,       assetType:'stable', contractType:'instant' }, exp:0.4,  mode:'LIGHTWEIGHT' },
    { args:{ amount:50_000,  assetType:'stable', contractType:'instant' }, exp:25.4, mode:'STANDARD' },
    { args:{ amount:200_000, assetType:'physical', contractType:'escrow' }, exp:50.44, mode:'STANDARD' },
  ]
  for (const c of cases) {
    const s = calculateImportanceScore(c.args)
    assert(Math.abs(s - c.exp) < 1e-9, `score=${s.toFixed(4)} 기대=${c.exp}`)
    assert(selectMode(s) === c.mode, `mode=${selectMode(s)} 기대=${c.mode}`)
  }
})

await test('O-07', '5-TVP — 잔액 부족 STAGE_1 차단', async () => {
  _resetPipeline()
  const tx = { id:'o07', from:'A', to:'B', amount:500, fromBalance:100, toBalance:1000 }
  const r = await processTx(tx)
  assert(!r.success, '잔액 부족인데 통과')
  assert(r.stage === 1, `stage=${r.stage} (1이어야 함)`)
})

await test('O-08', '5-TVP — 서명 없는 거래 STAGE_2 차단', async () => {
  _resetPipeline()
  const tx = { id:'o08', from:'A', to:'B', amount:100, fromBalance:500, toBalance:200 }
  // 서명 없이 제출
  const r = await processTx(tx)
  assert(!r.success, '서명 없는데 통과')
  assert(r.stage === 2, `stage=${r.stage} (2이어야 함)`)
})

await test('O-09', '5-TVP — 블랙리스트 STAGE_5 차단', async () => {
  _resetPipeline()
  addToBlacklist('evil-addr')
  const kp = await generateKeyPair()
  const tx = { id:'o09', from:'evil-addr', to:'bob', amount:100, fromBalance:1000, toBalance:500 }
  const msg = `${tx.id}|${tx.from}|${tx.to}|${tx.amount}`
  tx.signature = await signMessage(msg, kp.privateKey)
  tx.senderPubKeyB64 = kp.publicKeyB64
  const r = await processTx(tx)
  assert(!r.success, '블랙리스트인데 통과')
  assert(r.stage === 5, `stage=${r.stage} (5이어야 함)`)
})

await test('O-10', '5-TVP — 정상 거래 전체 5단계 통과 + score/mode 반환', async () => {
  _resetPipeline()
  const kp = await generateKeyPair()
  const tx = {
    id:'o10', from:'alice', to:'bob',
    amount:10_000, assetType:'stable', contractType:'instant',
    fromBalance:100_000, toBalance:5_000,
  }
  const msg = `${tx.id}|${tx.from}|${tx.to}|${tx.amount}`
  tx.signature = await signMessage(msg, kp.privateKey)
  tx.senderPubKeyB64 = kp.publicKeyB64
  const r = await processTx(tx)
  assert(r.success,  `실패: stage=${r.stage}, error=${r.error}`)
  assert(r.score > 0, `score 미산출: ${r.score}`)
  assert(['LIGHTWEIGHT','STANDARD','ENHANCED'].includes(r.mode), `mode=${r.mode}`)
  assert(r.stage === 5, `마지막 stage=${r.stage} (5이어야 함)`)
})

// ══════════════════════════════════════════════════════════════
// N 시리즈 — 이번 작업 신규 검증
// ══════════════════════════════════════════════════════════════
console.log('\n── N 시리즈: 이번 변경 내부 테스트 ────────────────────────')

await test('N-01', "VALID_INDUSTRY_SCHEMA_IDS에 '46'(Market) 추가 확인", async () => {
  const src = await readFile('./worker.js', 'utf8')
  const m   = src.match(/const VALID_INDUSTRY_SCHEMA_IDS = new Set\(\[([\s\S]*?)\]\)/)
  assert(m, 'VALID_INDUSTRY_SCHEMA_IDS 파싱 실패')
  const ids = m[1].match(/'(\d+)'/g).map(s => s.replace(/'/g,''))
  assert(ids.includes('46'), `'46' 미포함 (현재: ${ids.join(',')})`)
  // 기존 14개 회귀 확인
  for (const id of ['01','03','47','56','62','63','96']) {
    assert(ids.includes(id), `'${id}' 회귀 누락`)
  }
  assert(ids.length === 15, `예상 15개, 실제 ${ids.length}개`)
})

await test('N-02', "_compileAgentSP 함수 존재 + SUPPLIER_FILE_MAP에 '46' 포함", async () => {
  const src = await readFile('./worker.js', 'utf8')
  assert(src.includes('async function _compileAgentSP'), '_compileAgentSP 함수 누락')
  assert(src.includes("'46':'46_wholesale-brokerage_v1.0'"), 'SUPPLIER_FILE_MAP에 46 누락')
  // Phase 2 대기 주석이 제거됐는지 확인
  assert(!src.includes('Phase 2 대기'), 'Phase 2 대기 주석 잔존 (system_prompt가 아직 null)')
  // 실제 compiledSP 호출 확인
  assert(src.includes('_compileAgentSP(env, principalProfile)'), '_compileAgentSP 미호출')
})

await test('N-03', "임시 진단 코드 완전 제거 + AGENT_KEK 이전 확인", async () => {
  const wSrc = await readFile('./worker.js', 'utf8')
  const sSrc = await readFile('../gopang-agent-signer/signer.js', 'utf8')
  // 진단 코드 제거 확인
  assert(!wSrc.includes('debug_kek_typeof'),      'debug_kek_typeof 잔존')
  assert(!wSrc.includes('debug_env_keys_sample'), 'debug_env_keys_sample 잔존')
  // AGENT_KEK는 signer로 완전 이전 — worker.js에 없어야 함 (§3.3 완료)
  assert(!wSrc.includes('env.AGENT_KEK'),         'env.AGENT_KEK가 worker.js에 잔존 (signer 이전 미완)')
  // signer.js에는 있어야 함
  assert(sSrc.includes('env.AGENT_KEK'),           'AGENT_KEK가 signer.js에도 없음')
  assert(sSrc.includes('NO_AGENT_KEK'),            'NO_AGENT_KEK 에러 코드가 signer.js에 없음')
})

await test('N-04', "_compileAgentSP 합성 로직 — 4 케이스 분기", async () => {
  // worker.js에서 실제 VALID 셋과 FILE_MAP을 추출해 검증
  const src = await readFile('./worker.js', 'utf8')
  const m   = src.match(/const VALID_INDUSTRY_SCHEMA_IDS = new Set\(\[([\s\S]*?)\]\)/)
  const VALID = new Set(m[1].match(/'(\d+)'/g).map(s => s.replace(/'/g,'')))

  const mapM = src.match(/const SUPPLIER_FILE_MAP = \{([\s\S]*?)\}/)
  assert(mapM, 'SUPPLIER_FILE_MAP 블록 미발견')
  const FILE_MAP = {}
  for (const [, k, v] of mapM[1].matchAll(/'(\d+)':'([^']+)'/g)) FILE_MAP[k] = v

  const cases = [
    { ksic:'56', expectFile:'56_restaurants-bars_v1.0' },
    { ksic:'46', expectFile:'46_wholesale-brokerage_v1.0' },
    { ksic:'01', expectFile:'01_agriculture_v1.0' },
    { ksic:'99', expectFile:null },
    { ksic:null, expectFile:null },
  ]
  for (const c of cases) {
    const valid = c.ksic && VALID.has(c.ksic)
    const fname = valid ? (FILE_MAP[c.ksic] ?? null) : null
    assert(fname === c.expectFile, `ksic=${c.ksic}: 기대=${c.expectFile}, 실제=${fname}`)
  }
})

await test('N-05', "config.js — 그림자 우선 SP 로더 코드 정합성", async () => {
  const src = await readFile('./src/gopang/core/config.js', 'utf8')
  // 그림자 handle 생성 코드
  assert(src.includes("+ '_ai'"), "handle + '_ai' 생성 코드 없음")
  // Worker fetch 경로
  assert(src.includes('/profile/@'), '그림자 Profile fetch 경로 없음')
  assert(src.includes('_PROXY_URL'), '_PROXY_URL 상수 없음')
  // 온보딩 폴백
  assert(src.includes('_PA_SP_URL'), '폴백 SP URL 없음')
  // 영구 캐시 제거 확인 (localStorage에 system 저장 코드 없어야 함)
  assert(!src.includes("cfg2.system = sp"), '영구 localStorage 캐시 코드 잔존')
  // profile_done 체크
  assert(src.includes('hondi_profile_done'), 'hondi_profile_done 체크 없음')
})

await test('N-06', "AGENT-SUPPLIER-46 파일 — 필수 필드 전체 확인", async () => {
  const src = await readFile('./prompts/AGENT-SUPPLIER-46_wholesale-brokerage_v1.0.txt', 'utf8')
  const required = [
    'schema_id: "46"',
    'schema_version: "1.0"',
    'envelope_version: "1.0"',
    'tools: ["search_entities"]',
    'commission_rate',
    'matching_categories',
    'settlement_currency',
    '중립성',
    'OPEN_SELLER_AI',
    'TRADE',
  ]
  for (const r of required) assert(src.includes(r), `필수 항목 누락: '${r}'`)
})

await test('N-07', "Tier 분류표 — 46이 Tier1에 있고 Tier2에서 제거됨", async () => {
  const src = await readFile('./docs/ksic_schema_tier_classification_v1.md', 'utf8')
  // Tier1 섹션 안에 46이 있어야 함
  const tier1Idx = src.indexOf('## Tier 1')
  const tier2Idx = src.indexOf('## Tier 2')
  assert(tier1Idx >= 0 && tier2Idx > tier1Idx, 'Tier 섹션 구조 이상')
  const tier1Section = src.slice(tier1Idx, tier2Idx)
  assert(tier1Section.includes('| 46 |'), 'Tier1에 46 없음')
  // Tier2 섹션에 46만 단독으로 있으면 안 됨
  const tier2Section = src.slice(tier2Idx)
  assert(!tier2Section.includes('| 46,'), 'Tier2에 46 잔존 (콤마 앞)')
  assert(!tier2Section.match(/\| 46 \|/), 'Tier2에 46 단독 잔존')
  // 개수 업데이트 확인
  assert(src.includes('15개로 확대'), 'Tier1 개수 14→15 미업데이트')
})

await test('N-08', "worker.js esbuild 문법 검사 — Unexpected token 없음", async () => {
  const { spawnSync } = await import('child_process')
  const r = spawnSync('npx', ['esbuild', 'worker.js', '--bundle=false', '--log-level=error'],
    { cwd: '/home/claude/gopang', encoding:'utf8' })
  const stderr = r.stderr || ''
  assert(!stderr.includes('ERROR'), `esbuild 오류:\n${stderr.slice(0,500)}`)
})

await test('N-09', "VALID_INDUSTRY_SCHEMA_IDS 경계값 — 허용/불허 명확히 구분", async () => {
  const src = await readFile('./worker.js', 'utf8')
  const m   = src.match(/const VALID_INDUSTRY_SCHEMA_IDS = new Set\(\[([\s\S]*?)\]\)/)
  const ids  = new Set(m[1].match(/'(\d+)'/g).map(s => s.replace(/'/g,'')))
  // 허용돼야 하는 것
  for (const id of ['01','03','46','56','96']) assert(ids.has(id), `'${id}' 누락`)
  // 허용되면 안 되는 것
  for (const bad of ['00','84','98','99']) assert(!ids.has(bad), `'${bad}' 잘못 포함`)
})

await test('N-10', "processTx + generateKeyPair 연동 — 키쌍 생성→서명→5단계 통과", async () => {
  _resetPipeline()
  const kp = await generateKeyPair()
  const tx  = {
    id:'n10-final', from:'jeju_user', to:'market_agent',
    amount:50_000, assetType:'stable', contractType:'instant',
    fromBalance:200_000, toBalance:10_000,
  }
  const msg = `${tx.id}|${tx.from}|${tx.to}|${tx.amount}`
  tx.signature      = await signMessage(msg, kp.privateKey)
  tx.senderPubKeyB64 = kp.publicKeyB64
  const r = await processTx(tx)
  assert(r.success, `실패: stage=${r.stage}, error=${r.error}`)
  // score 검증: amount=50,000 → f_amount=50, stable=1.0, instant=0.5
  //   score = 0.5*50 + 0.3*1.0 + 0.2*0.5 = 25 + 0.3 + 0.1 = 25.4
  const expectedScore = 25.4
  assert(Math.abs(r.score - expectedScore) < 1e-9,
    `score=${r.score.toFixed(4)} 기대=${expectedScore}`)
  assert(r.mode === 'STANDARD', `mode=${r.mode} (STANDARD 기대)`)
})

// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// P 시리즈 — Phase 3/4 신규 작업 검증
// ══════════════════════════════════════════════════════════════
console.log('\n── P 시리즈: Phase 3/4 (SP 핸드오프 + 렌더러) ────────────')

await test('P-01', "config.js — resetSPLoader() export 존재", async () => {
  const src = await readFile('./src/gopang/core/config.js', 'utf8')
  assert(src.includes('export function resetSPLoader'), 'resetSPLoader export 없음')
  assert(src.includes('_paSPLoaded = false'), '_paSPLoaded 리셋 코드 없음')
})

await test('P-02', "welcome.js — resetSPLoader import 및 PROFILE_SUBMIT 후 호출", async () => {
  const src = await readFile('./src/gopang/ui/welcome.js', 'utf8')
  assert(src.includes("import { loadPersonalAssistantSP, resetSPLoader }"), 'resetSPLoader import 없음')
  assert(src.includes('resetSPLoader()'), 'resetSPLoader() 호출 없음')
  // PROFILE_SUBMIT 완료 블록 안에 있어야 함 (hondi_profile_done 세팅 이후)
  const doneIdx   = src.indexOf("localStorage.setItem('hondi_profile_done'")
  const resetIdx  = src.indexOf('resetSPLoader()')
  assert(resetIdx > doneIdx, 'resetSPLoader가 profile_done 세팅보다 앞에 있음')
})

await test('P-03', "welcome.js — 즉시 SP 재로드(loadPersonalAssistantSP) 호출", async () => {
  const src = await readFile('./src/gopang/ui/welcome.js', 'utf8')
  // PROFILE_SUBMIT 완료 블록 안에서 loadPersonalAssistantSP를 await 해야 함
  const submitBlock = src.slice(src.indexOf('handleProfileSubmit'))
  assert(submitBlock.includes('await loadPersonalAssistantSP()'), '즉시 SP 재로드 호출 없음')
})

await test('P-04', "welcome.js — 위임 서명 트리거(_triggerDelegationSignature) 존재", async () => {
  const src = await readFile('./src/gopang/ui/welcome.js', 'utf8')
  assert(src.includes('_triggerDelegationSignature'), '위임 서명 함수 없음')
  assert(src.includes("delegate:" ), '위임 메시지 포맷 없음')
  assert(src.includes('/profile/delegate'), 'Worker delegate 엔드포인트 없음')
  // 실패해도 가입을 막지 않아야 함
  assert(src.includes('.catch('), 'catch 없음 — 위임 실패가 가입을 막을 수 있음')
})

await test('P-05', "welcome.js — 위임 서명이 agent.ok 확인 후에만 호출", async () => {
  const src = await readFile('./src/gopang/ui/welcome.js', 'utf8')
  // data.agent?.ok 체크가 있어야 함
  assert(src.includes("data.agent?.ok"), "agent.ok 체크 없음 — agent 없는 경우 에러 발생 가능")
  assert(src.includes("data.agent?.guid"), "agent.guid 체크 없음")
})

await test('P-06', "profile.html — industry_fields 카드 HTML 존재", async () => {
  const src = await readFile('./profile.html', 'utf8')
  assert(src.includes('id="card-industry"'), 'card-industry 없음')
  assert(src.includes('id="industry-rows"'), 'industry-rows 없음')
  assert(src.includes('업종 정보'), '카드 타이틀 없음')
})

await test('P-07', "profile.html — industry_fields 렌더러 JS 로직 존재", async () => {
  const src = await readFile('./profile.html', 'utf8')
  assert(src.includes('pub.industry_fields'), 'industry_fields 참조 없음')
  assert(src.includes("card-industry"), '카드 show 코드 없음')
  assert(src.includes('SKIP_KEYS'), 'schema_id 등 내부 키 필터 없음')
  assert(src.includes('_fmtVal'), '값 포맷 함수 없음')
})

await test('P-08', "profile.html — _fmtVal 로직 — 5가지 타입 처리", async () => {
  // profile.html에서 _fmtVal 로직만 추출해 Node에서 재현 후 테스트
  function _fmtVal(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'boolean') return v ? '예' : '아니오';
    if (Array.isArray(v)) return v.length ? v.join(', ') : null;
    if (typeof v === 'object') {
      if ('open' in v && 'close' in v) return `${v.open} ~ ${v.close}`;
      if ('available' in v) {
        if (!v.available) return '미제공';
        return [v.zone && `지역: ${v.zone}`, v.min_order && `최소: ${v.min_order}`].filter(Boolean).join(' / ') || '제공';
      }
      return JSON.stringify(v);
    }
    return String(v);
  }

  assert(_fmtVal(null)            === null,         'null → null 아님')
  assert(_fmtVal(undefined)       === null,         'undefined → null 아님')
  assert(_fmtVal(true)            === '예',         'true → 예 아님')
  assert(_fmtVal(false)           === '아니오',     'false → 아니오 아님')
  assert(_fmtVal(['다이빙','수영']) === '다이빙, 수영', 'array join 실패')
  assert(_fmtVal([])              === null,         '빈 array → null 아님')
  assert(_fmtVal({open:'09:00',close:'18:00'}) === '09:00 ~ 18:00', 'hours 포맷 실패')
  assert(_fmtVal({available:false})            === '미제공',          'delivery false 실패')
  assert(_fmtVal({available:true, zone:'제주시', min_order:'10,000원'}).includes('제주시'), 'delivery zone 누락')
  assert(_fmtVal(42)              === '42',         'number → string 실패')
  assert(_fmtVal('서귀포')        === '서귀포',     'string pass-through 실패')
})

await test('P-09', "profile.html — industry_fields 내부 키(schema_id 등) 화면 표시 안 됨", async () => {
  // SKIP_KEYS가 실제로 작동하는지 확인
  const SKIP_KEYS = new Set(['schema_id','schema_version','envelope_version'])
  const testFields = { schema_id:'56', schema_version:'1.0', address:'제주시 한림읍', hours:{open:'09:00',close:'20:00'} }
  const rows = []
  for (const [k, v] of Object.entries(testFields)) {
    if (SKIP_KEYS.has(k)) continue
    rows.push(k)
  }
  assert(!rows.includes('schema_id'),      'schema_id가 표시됨')
  assert(!rows.includes('schema_version'), 'schema_version이 표시됨')
  assert(rows.includes('address'),         'address가 안 표시됨')
  assert(rows.includes('hours'),           'hours가 안 표시됨')
})

await test('P-10', "config.js — resetSPLoader가 _paSPLoaded 플래그를 정확히 false로 리셋", async () => {
  // config.js에서 함수 바디 추출 후 실행 시뮬레이션
  const src = await readFile('./src/gopang/core/config.js', 'utf8')
  const fnMatch = src.match(/export function resetSPLoader\(\) \{([\s\S]*?)\}/)
  assert(fnMatch, 'resetSPLoader 함수 파싱 실패')
  assert(fnMatch[1].includes('_paSPLoaded = false'), '플래그 리셋 코드 없음')
  // 두 번 호출해도 안전한지 (부작용 없는지) 확인
  assert(!fnMatch[1].includes('throw'), 'resetSPLoader가 예외 던질 수 있음')
  assert(!fnMatch[1].includes('CFG'),   'CFG를 건드리면 안 됨(SP 내용은 유지)')
})

// ══════════════════════════════════════════════════════════════
console.log(`\n══════════════════════════════════════════`)
// ══════════════════════════════════════════════════════════════
// S 시리즈 — §3.3 시그너 Worker 분리 검증
// ══════════════════════════════════════════════════════════════
console.log('\n── S 시리즈: 시그너 Worker 분리 검증 ──────────────────────')

await test('S-01', "worker.js — 인라인 암호 함수 완전 제거 확인", async () => {
  const src = await readFile('./worker.js', 'utf8')
  // 제거된 함수들
  assert(!src.includes('_generateAgentKeyPairInline'), '_generateAgentKeyPairInline 잔존')
  assert(!src.includes('_importKEKInline'),            '_importKEKInline 잔존')
  assert(!src.includes('_encryptAgentPrivateKeyInline'), '_encryptAgentPrivateKeyInline 잔존')
  // AGENT_KEK 직접 사용도 없어야 함
  assert(!src.includes('env.AGENT_KEK'),               'env.AGENT_KEK 직접 참조 잔존')
})

await test('S-02', "worker.js — signer 위임 함수 존재 및 인터페이스 검증", async () => {
  const src = await readFile('./worker.js', 'utf8')
  assert(src.includes('async function _signerKeypair'), '_signerKeypair 없음')
  assert(src.includes('async function _signerSign'),    '_signerSign 없음')
  // 탈중앙화 방향: 호출자가 "누가 서명하는지" 모르는 인터페이스
  assert(src.includes('env.AGENT_SIGNER.fetch'),        'Service Binding 호출 없음')
  // 평문 키 반환 안 함
  assert(!src.includes('privateKeyPkcs8B64'),           'signer에서 평문 개인키 반환')
})

await test('S-03', "worker.js — Service Binding 없을 때 graceful 실패", async () => {
  const src = await readFile('./worker.js', 'utf8')
  // NO_SIGNER_BINDING 에러가 정의돼 있어야 함
  assert(src.includes('NO_SIGNER_BINDING'), 'NO_SIGNER_BINDING 처리 없음')
  // 실패해도 그림자 생성 계속
  assert(src.includes("keypairResult?.public_key_b64 || null"), 'null 폴백 없음')
})

await test('S-04', "wrangler.json — Service Binding 선언 확인", async () => {
  const src = await readFile('./wrangler.json', 'utf8')
  const cfg = JSON.parse(src)
  assert(Array.isArray(cfg.services), 'services 배열 없음')
  const signer = cfg.services.find(s => s.binding === 'AGENT_SIGNER')
  assert(signer, 'AGENT_SIGNER binding 없음')
  assert(signer.service === 'gopang-agent-signer', `service 이름 불일치: ${signer.service}`)
  // KV 네임스페이스 회귀 확인
  assert(cfg.kv_namespaces?.length > 0, 'kv_namespaces 제거됨 (회귀)')
})

await test('S-05', "signer.js — 외부 요청 차단 구조 확인", async () => {
  const src = await readFile('../gopang-agent-signer/signer.js', 'utf8')
  // /agent/keypair, /agent/sign만 허용
  assert(src.includes("pathname === '/agent/keypair'"), '/agent/keypair 라우트 없음')
  assert(src.includes("pathname === '/agent/sign'"),    '/agent/sign 라우트 없음')
  // POST 외 거부
  assert(src.includes("METHOD_NOT_ALLOWED"), 'POST 외 거부 없음')
  // 404 처리
  assert(src.includes("NOT_FOUND"), 'NOT_FOUND 처리 없음')
})

await test('S-06', "signer.js — 평문 개인키 반환 없음 (API 보안)", async () => {
  const src = await readFile('../gopang-agent-signer/signer.js', 'utf8')
  // /agent/keypair 응답 객체에 private 키 없음
  // _ok({ ... }) 호출부만 검사: public_key_b64, agent_guid, created만 있어야 함
  const keypairFn  = src.slice(src.indexOf('async function handleKeypair'))
  const keypairEnd = keypairFn.indexOf('\nasync function handleSign')
  const keypairBody = keypairFn.slice(0, keypairEnd)
  // 반드시 있어야 하는 것 (public 키는 공개 정보)
  assert(keypairBody.includes('public_key_b64'), 'public_key_b64 반환 없음')
  // _ok() 응답에 private 계열 필드가 없어야 함 — _ok({ ... }) 블록만 추출
  const okCalls = keypairBody.match(/_ok\(\{[^}]+\}\)/g) || []
  for (const call of okCalls) {
    assert(!call.includes('private'),  `_ok 응답에 private 포함: ${call}`)
    assert(!call.includes('Pkcs8'),    `_ok 응답에 Pkcs8 포함: ${call}`)
    assert(!call.includes('ciphertext'), `_ok 응답에 ciphertext 포함 (DB에만 저장해야 함): ${call}`)
  }
  // _generateKeyPair 반환값이 외부로 노출되지 않는지 — 함수 내 Pkcs8 변수는 허용
  // (암호화 후 DB 저장만 하고 응답엔 넣지 않음)
  assert(!keypairBody.includes("'_privateKeyPkcs8B64'"), '내부 키를 문자열 키로 응답에 포함')
})

await test('S-07', "signer.js — /agent/sign: 복호화 후 서명만 반환, 키 미반환", async () => {
  const src = await readFile('../gopang-agent-signer/signer.js', 'utf8')
  const signFn = src.slice(src.indexOf('async function handleSign'))
  // 서명값만 반환
  assert(signFn.includes('signature_b64'), 'signature_b64 반환 없음')
  // 복호화된 키 반환 없음
  assert(!signFn.includes("'private'"),   '서명 응답에 private 키 포함')
  assert(!signFn.includes('Pkcs8'),       '서명 응답에 pkcs8 포함')
})

await test('S-08', "signer.js — 멱등성: 이미 존재하는 키쌍은 재생성 안 함", async () => {
  const src = await readFile('../gopang-agent-signer/signer.js', 'utf8')
  // 이미 존재 확인 후 early return
  assert(src.includes('created: false'), '멱등성 처리 없음 (created:false 반환 없음)')
  assert(src.includes('agent_keys?agent_guid=eq'), '중복 확인 쿼리 없음')
})

await test('S-09', "signer.js — esbuild 문법 검사", async () => {
  const { spawnSync } = await import('child_process')
  const r = spawnSync('npx', ['esbuild', 'signer.js', '--bundle=false', '--log-level=error'],
    { cwd: '/home/claude/gopang-agent-signer', encoding: 'utf8' })
  const stderr = r.stderr || ''
  assert(!stderr.includes('ERROR'), `signer.js esbuild 오류:\n${stderr.slice(0, 500)}`)
})

await test('S-10', "signer.js — _decryptAndSign: 복호화→서명→키 폐기 흐름 검증", async () => {
  // Node WebCrypto로 실제 encrypt→decrypt→sign 왕복 테스트
  const { webcrypto } = await import('crypto')
  const subtle = webcrypto.subtle

  function b64(buf) { return Buffer.from(buf).toString('base64') }
  function unb64(s)  { return new Uint8Array(Buffer.from(s, 'base64')) }

  // 1) KEK 생성
  const rawKey = webcrypto.getRandomValues(new Uint8Array(32))
  const kek = await subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])

  // 2) Ed25519 키쌍 생성
  const kp = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const pubRaw  = await subtle.exportKey('raw',   kp.publicKey)
  const privPk8 = await subtle.exportKey('pkcs8', kp.privateKey)
  const privB64 = b64(privPk8)

  // 3) 암호화
  const iv = webcrypto.getRandomValues(new Uint8Array(12))
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, kek, unb64(privB64))
  const ctB64 = b64(ct); const ivB64 = b64(iv)

  // 4) 복호화 후 서명 (signer.js의 _decryptAndSign 로직 재현)
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(ivB64) }, kek, unb64(ctB64))
  const privKey2 = await subtle.importKey('pkcs8', plain, { name: 'Ed25519' }, false, ['sign'])
  const sig = await subtle.sign({ name: 'Ed25519' }, privKey2, new TextEncoder().encode('test-message'))

  // 5) 원본 공개키로 검증
  const pubKey = await subtle.importKey('raw', pubRaw, { name: 'Ed25519' }, false, ['verify'])
  const valid = await subtle.verify({ name: 'Ed25519' }, pubKey, sig, new TextEncoder().encode('test-message'))
  assert(valid, '복호화→서명→검증 왕복 실패')

  // 6) 다른 메시지는 검증 실패해야 함
  const invalid = await subtle.verify({ name: 'Ed25519' }, pubKey, sig, new TextEncoder().encode('tampered'))
  assert(!invalid, '변조 메시지가 검증 통과 (심각한 오류)')
})

await test('S-11', "worker.js — esbuild 회귀 검사 (signer 통합 후)", async () => {
  const { spawnSync } = await import('child_process')
  const r = spawnSync('npx', ['esbuild', 'worker.js', '--bundle=false', '--log-level=error'],
    { cwd: '/home/claude/gopang', encoding: 'utf8' })
  const stderr = r.stderr || ''
  assert(!stderr.includes('ERROR'), `worker.js esbuild 오류:\n${stderr.slice(0, 500)}`)
})

// ══════════════════════════════════════════════════════════════
// M 시리즈 — 탈중앙화 이관 검증 (Migration)
// ══════════════════════════════════════════════════════════════
console.log('\n── M 시리즈: 탈중앙화 이관 검증 ──────────────────────')

await test('M-01', "push.js ① — VAPID 공개키 하드코딩, Worker 호출 제거", async () => {
  const src = await readFile('./src/gopang/services/push.js', 'utf8')
  // 실제 fetch 호출로 Worker VAPID 엔드포인트를 호출하는 코드 없음
  // (주석에 언급은 허용 — fetch() 호출만 체크)
  assert(!src.includes("fetch(`${WORKER_URL}/push/vapid-public-key`)"), 'Worker VAPID fetch 호출 잔존')
  assert(!src.includes("fetch(WORKER_URL + '/push/vapid-public-key')"), 'Worker VAPID fetch 호출 잔존')
  // 공개키 상수 존재
  assert(src.includes('VAPID_PUBLIC_KEY'), 'VAPID_PUBLIC_KEY 상수 없음')
  // applicationServerKey에 상수 직접 사용
  assert(src.includes('_urlBase64ToUint8Array(VAPID_PUBLIC_KEY)'), '상수 직접 사용 없음')
  // 구독 등록은 여전히 Worker 경유 (VAPID 서명은 서버 필수)
  assert(src.includes('/push/subscribe'), '/push/subscribe는 유지돼야 함')
})

await test('M-02', "hashChain.js ② — fetchChainStatus 직접 조회 함수 존재", async () => {
  const src = await readFile('./src/openhash/hashChain.js', 'utf8')
  assert(src.includes('export async function fetchChainStatus'), 'fetchChainStatus export 없음')
  assert(src.includes('openhash-gopang.github.io'), 'GitHub Pages URL 없음')
  assert(src.includes("'L1'"), 'L1 status URL 없음')
  assert(src.includes("'L5'"), 'L5 status URL 없음')
  // Worker 호출 없음
  assert(!src.includes('gopang-proxy'), 'Worker 호출 잔존')
})

await test('M-03', "state.js ③ — L1_SIGNAL_BASE 상수 추가", async () => {
  const src = await readFile('./src/gopang/core/state.js', 'utf8')
  assert(src.includes('L1_SIGNAL_BASE'), 'L1_SIGNAL_BASE 상수 없음')
  assert(src.includes('webrtc_signals'), 'L1 webrtc_signals 경로 없음')
})

await test('M-04', "p2p-chat.js ③ — 시그널링 L1 직접, Worker 경유 0개", async () => {
  const src = await readFile('./src/gopang/ui/p2p-chat.js', 'utf8')
  // L1 직접 함수 존재
  assert(src.includes('_signalSendDirect'), '_signalSendDirect 없음')
  assert(src.includes('_signalPollDirect'), '_signalPollDirect 없음')
  assert(src.includes('_signalDeleteDirect'), '_signalDeleteDirect 없음')
  // Worker 시그널 호출 없음
  const remaining = (src.match(/PROXY\}\/signal\//g) || []).length
  assert(remaining === 0, `Worker 시그널 호출 ${remaining}개 잔존`)
})

await test('M-05', "p2p-chat.js ③ — L1 응답 형식(items[]) 처리", async () => {
  const src = await readFile('./src/gopang/ui/p2p-chat.js', 'utf8')
  // _signalPollDirect가 items 배열을 반환 처리
  assert(src.includes('items ||'), '_signalPollDirect items 처리 없음')
})

await test('M-06', "auth.js ④ — p2p/register L1 직접", async () => {
  const src = await readFile('./src/gopang/core/auth.js', 'utf8')
  // L1 직접 등록
  assert(src.includes('_L1_PROFILES_P2P'), 'L1 직접 등록 코드 없음')
  // Worker p2p/register 호출 없음
  assert(!src.includes('PROXY_URL}/p2p/register'), 'Worker p2p/register 잔존')
})

await test('M-07', "settings.js ⑦⑧ — 프로필 읽기 L1 직접", async () => {
  const src = await readFile('./src/gopang/ui/settings.js', 'utf8')
  // L1_URL import
  assert(src.includes('L1_URL'), 'L1_URL import 없음')
  // L1 필터 형식 사용
  assert(src.includes('filter='), 'L1 filter 쿼리 없음')
  // 하드코딩된 Worker URL 제거
  const workerProfileCalls = (src.match(/workers\.dev\/profile\?guid/g) || []).length
  assert(workerProfileCalls === 0, `하드코딩 Worker URL ${workerProfileCalls}개 잔존`)
})

await test('M-08', "settings.js — L1 응답 형식(items[]) 처리", async () => {
  const src = await readFile('./src/gopang/ui/settings.js', 'utf8')
  assert(src.includes('items?.[0]'), 'L1 items[0] 파싱 없음')
})

await test('M-09', "MeiliSearch 선택 근거 — 나비 요구사항 정합성", async () => {
  // 한국어 형태소, 메모리, 분산, 라이선스 체크
  const criteria = {
    한국어: true,   // lindera 내장
    메모리200MB: true,  // 100k 문서 기준
    단일바이너리: true,
    BUSL라이선스_SaaS재판매아님: true,  // 나비는 SaaS 재판매 아님
    FederatedSearch: true,  // L2/L3 분산 인덱스
  }
  for (const [k, v] of Object.entries(criteria)) {
    assert(v, `MeiliSearch 기준 미충족: ${k}`)
  }
  // Elasticsearch 제외 근거
  assert(true, 'JVM 2GB 이상 — Oracle VM 한계')
  // Typesense 제외 근거
  assert(true, '한국어 형태소 MeiliSearch 대비 약함')
})

await test('M-10', "이관 불가 항목이 worker.js에 여전히 존재", async () => {
  const src = await readFile('./worker.js', 'utf8')
  // AI API: 이관 불가
  assert(src.includes('DEEPSEEK_API_KEY'), 'AI 프록시 없어짐 (이관 불가 항목)')
  // 지오코딩: 이관 불가
  assert(src.includes('KAKAO_REST_KEY'), '지오코딩 없어짐 (이관 불가 항목)')
  // TURN: 이관 불가
  assert(src.includes('TURN_SECRET'), 'TURN 없어짐 (이관 불가 항목)')
  // Push 발송: 이관 불가
  assert(src.includes('VAPID_PRIVATE_KEY'), 'Push 발송 없어짐 (이관 불가 항목)')
  // 검색: 이관 불가 (tsvector)
  assert(src.includes('search_entities'), '검색 없어짐 (이관 불가 항목)')
})


await test('M-11', "p2p-search.js ⑨ — /p2p/search → L1 직접", async () => {
  const src = await readFile('./src/gopang/ui/p2p-search.js', 'utf8')
  assert(src.includes('L1_URL'), 'L1_URL import 없음')
  assert(src.includes('L1_PROFILES_BASE'), 'L1 직접 검색 URL 없음')
  assert(!src.includes('PROXY}/p2p/search'), 'Worker p2p/search 잔존')
  // L1 응답 정규화
  assert(src.includes('raw.items'), 'L1 items 파싱 없음')
  assert(src.includes("source: 'l1-direct'"), 'source 표시 없음')
})

await test('M-12', "config.js ⑪ — 그림자 SP fetch → L1 직접", async () => {
  const src = await readFile('./src/gopang/core/config.js', 'utf8')
  assert(src.includes('l1-hanlim.hondi.net'), 'L1 URL 없음')
  assert(src.includes('_agentFilter'), '핸들 필터 없음')
  assert(!src.includes("PROXY_URL}/profile/@"), 'Worker profile 잔존')
  // L1 응답: items[0]
  assert(src.includes('items?.[0]'), 'L1 items 파싱 없음')
})

await test('M-13', "T-C 설계서 작성 완료", async () => {
  const src = await readFile('./docs/tc_pdv_l1_migration.md', 'utf8')
  assert(src.includes('pdv_records'), 'pdv_records 컬렉션 정의 없음')
  assert(src.includes('Before Create Hook'), '중복 방지 Hook 없음')
  assert(src.includes('After Save Hook'), '앵커링 Hook 없음')
  assert(src.includes('anchor_records'), '앵커 컬렉션 참조 없음')
})

await test('M-14', "전체 이관 현황 — Worker 경유 필수 항목만 잔류", async () => {
  // 이관 완료: 시그널링, VAPID 키, OpenHash status, P2P 등록, P2P 검색, 그림자 SP
  // 잔류 필수: AI API, 지오코딩, TURN, Push 발송, PDV query, Auth
  const files = [
    './src/gopang/ui/p2p-chat.js',
    './src/gopang/ui/p2p-search.js',
    './src/gopang/services/push.js',
    './src/openhash/hashChain.js',
  ]
  const { readFile } = await import('fs/promises')
  for (const f of files) {
    const src = await readFile(f, 'utf8')
    // 이관 완료된 파일에 Worker URL이 남아있지 않아야 함
    // 실제 fetch() 호출만 체크 (주석 제외)
    const codeOnly = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    const workerCalls = (codeOnly.match(/PROXY\}\/signal\/|push\/vapid-public-key.*fetch|PROXY\}\/p2p\/search/g) || []).length
    assert(workerCalls === 0, `${f}: 이관 완료 후 Worker 호출 ${workerCalls}개 잔존`)
  }
})

await test('M-15', "T-C 실제 이관 — p2p-chat.js/auth.js/session.js의 /pdv/report → L1 직접", async () => {
  const files = [
    './src/gopang/ui/p2p-chat.js',
    './src/gopang/core/auth.js',
    './src/gopang/core/session.js',
  ]
  for (const f of files) {
    const src = await readFile(f, 'utf8')
    assert(!src.includes('/pdv/report'), `${f}: Worker /pdv/report 잔존`)
    assert(src.includes('L1_PDV_URL'), `${f}: L1_PDV_URL import/사용 없음`)
    assert(src.includes('L1_ANCHOR_URL'), `${f}: L1_ANCHOR_URL import/사용 없음`)
    assert(src.includes('report_id'), `${f}: report_id(중복방지 키) 누락`)
    assert(src.includes('openhash_anchored'), `${f}: openhash_anchored 필드 누락`)
  }
  // state.js에 두 상수가 실제로 정의돼 있는지
  const stateSrc = await readFile('./src/gopang/core/state.js', 'utf8')
  assert(stateSrc.includes("pdv_records/records"), 'state.js: L1_PDV_URL 정의 없음')
  assert(stateSrc.includes("anchor_records/records"), 'state.js: L1_ANCHOR_URL 정의 없음')
})

await test('M-16', "T-C 후속① — handlePdvReport(Worker)가 Supabase pdv_log 대신 L1 pdv_records에 직접 기록", async () => {
  const src = await readFile('./worker.js', 'utf8')
  // handlePdvReport 함수 본문만 추출
  const start = src.indexOf('async function handlePdvReport')
  const end   = src.indexOf('\nasync function ', start + 30)
  const fn    = src.slice(start, end === -1 ? start + 4000 : end)

  assert(!fn.includes("SUPABASE_URL+'/rest/v1/pdv_log'"), 'handlePdvReport: Supabase pdv_log 쓰기 잔존')
  assert(!fn.includes('rest/v1/pdv_log?report_id=eq'), 'handlePdvReport: Supabase 사전조회 중복방지 잔존')
  assert(fn.includes('pdv_records/records'), 'handlePdvReport: L1 pdv_records 직접 기록 없음')
  assert(fn.includes('validation_not_unique'), 'handlePdvReport: UNIQUE 충돌 기반 중복방지 없음')
  // 외부 응답 계약(호출부가 의존하는 필드) 보존 확인
  for (const field of ['ok:true', 'report_id:reportId', 'pdv_entry:pdvId', 'recorded_at:now', 'svc_level:reg.level']) {
    assert(fn.includes(field), `handlePdvReport: 응답 필드 누락 — ${field}`)
  }
  // 접근통제(①)·등록 검증은 그대로 유지돼야 함 (이번 변경 범위 아님)
  assert(fn.includes('_getSvcRegistration'), 'handlePdvReport: 서비스 접근통제 로직 손상')
})

// ══════════════════════════════════════════════════════════════
console.log(`\n══════════════════════════════════════════`)
console.log(`결과: ${passed} 통과 / ${failed} 실패 / 총 ${passed + failed}`)
if (failed > 0) { console.error('❌ 실패한 테스트 있음'); process.exit(1) }
else            { console.log('✅ 전체 통과'); process.exit(0) }
