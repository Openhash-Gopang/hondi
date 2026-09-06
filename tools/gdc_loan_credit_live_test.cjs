#!/usr/bin/env node
/**
 * gdc_loan_credit_live_test.cjs
 *
 * GDC 대출·신용평가 목업 라이브 스모크 테스트.
 * register-key(신규 테스트 계정) → 관리자 재무제표 시나리오 등록 →
 * applyLoan → repayLoan(부분 상환, 원금/이자 분리 확인) 순서로 실행한다.
 *
 * 서명 방식(sortedStringify/tx_hash/buyer_sig)은 gopang-wallet.js의
 * buildTxWithPrevHash/signTx 원본 로직을 그대로 포팅했다 — 브라우저
 * 전용 IndexedDB 초기화 부작용 때문에 그 파일을 직접 require()하면
 * 정적 유틸(sortedStringify 등)이 시점에 따라 아직 안 붙어있을 수
 * 있어(비동기 초기화가 module.exports보다 늦게 끝남), 필요한 함수만
 * 순수 로직으로 재작성했다 — 오늘 겪은 "실사용 조건 최초 도달 시
 * 발각되는 버그"를 여기서 또 만들지 않기 위해, 각 서명 단계마다
 * 서버 응답을 즉시 확인하고 실패 시 그 자리에서 멈춘다.
 *
 * 사용법:
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... node gdc_loan_credit_live_test.cjs
 *
 * 환경변수:
 *   ADMIN_EMAIL / ADMIN_PASSWORD  — prompt_admins 로그인 자격(/admin/login).
 *                                    이 스크립트는 어디에도 저장하지 않는다.
 *   WORKER_URL                    — 기본값 https://hondi-proxy.tensor-city.workers.dev
 *   LOAN_PRINCIPAL                — 기본값 50 (대출 신청 원금, ₮)
 *   REPAY_AMOUNT                  — 기본값 20 (1차 상환액, ₮)
 */

'use strict';

const { webcrypto } = require('crypto');
const crypto = webcrypto;

const WORKER_URL = process.env.WORKER_URL || 'https://hondi-proxy.tensor-city.workers.dev';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const LOAN_PRINCIPAL = Number(process.env.LOAN_PRINCIPAL || 50);
const REPAY_AMOUNT = Number(process.env.REPAY_AMOUNT || 20);

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('[FATAL] ADMIN_EMAIL / ADMIN_PASSWORD 환경변수가 필요합니다.');
  console.error('  예) $env:ADMIN_EMAIL="..."; $env:ADMIN_PASSWORD="..."; node gdc_loan_credit_live_test.cjs');
  process.exit(1);
}

function log(...args) { console.log('[TEST]', ...args); }
function fail(msg) { console.error('\n[FAIL]', msg); process.exit(1); }

// ── gopang-wallet.js sortedStringify 원본 포팅 (결정적 직렬화) ──────
function sortedStringify(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return JSON.stringify(obj);
  }
  const sorted = {};
  Object.keys(obj).sort().forEach(k => { sorted[k] = obj[k]; });
  return '{' + Object.keys(sorted).map(k =>
    JSON.stringify(k) + ':' + sortedStringify(sorted[k])
  ).join(',') + '}';
}

function bufToHex(buf) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function bufToB64u(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256(text) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
}

async function generateKeyPair() {
  return crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
}
async function exportPubKeyB64u(publicKey) {
  const raw = await crypto.subtle.exportKey('raw', publicKey);
  return bufToB64u(raw);
}
// _verifyEd25519Simple(서버)와 동일 — UTF-8 원문을 그대로 서명한다(해시 X).
async function signText(privateKey, text) {
  const sigBuf = await crypto.subtle.sign('Ed25519', privateKey, new TextEncoder().encode(text));
  return bufToB64u(sigBuf);
}

// 랜덤 IPv6 형태 테스트 guid (실사용 계정과 겹치지 않도록 fd00: ULA 프리픽스 사용)
function randomTestGuid() {
  const groups = Array.from({ length: 7 }, () =>
    crypto.getRandomValues(new Uint32Array(1))[0].toString(16).padStart(4, '0').slice(0, 4));
  return 'fd00:' + groups.join(':');
}

async function main() {
  log('WORKER_URL =', WORKER_URL);
  log('LOAN_PRINCIPAL =', LOAN_PRINCIPAL, ' REPAY_AMOUNT =', REPAY_AMOUNT);

  // ── 0) 테스트 계정 키페어 + guid ──────────────────────────────────
  const { publicKey, privateKey } = await generateKeyPair();
  const pubkeyB64u = await exportPubKeyB64u(publicKey);
  const guid = randomTestGuid();
  log('테스트 guid:', guid);
  log('테스트 pubkey:', pubkeyB64u.slice(0, 24) + '...');

  // ── 1) register-key ───────────────────────────────────────────────
  {
    const ts = Date.now().toString();
    const sigMsg = `register-key:${guid}:${ts}`;
    const signature = await signText(privateKey, sigMsg);
    const res = await fetch(`${WORKER_URL}/gwp/register-key`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guid, public_key: pubkeyB64u, signature, ts }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) fail(`register-key 실패 (HTTP ${res.status}): ${JSON.stringify(data)}`);
    log('[PASS] register-key 성공:', JSON.stringify(data));
  }

  // ── 1-1) POST /profile — profiles.pubkey_ed25519 TOFU 바인딩 ───────
  // register-key는 gdc_keys 컬렉션에만 기록한다(P2P 이체 서명 검증용).
  // applyLoan/repayLoan이 재사용하는 _verifyClaimsRequester는 별도로
  // profiles.pubkey_ed25519를 확인하므로, 이 단계 없이는 계정이 있어도
  // "본인 서명 인증이 필요합니다"(403 AUTH_REQUIRED)로 막힌다 — 오늘
  // 처음 실행해서 발견한 부분(gdc_keys와 profiles가 별도 TOFU 지점).
  {
    const ts = Date.now().toString();
    const sigMsg = `${guid}:${pubkeyB64u}:${ts}`;
    const signature = await signText(privateKey, sigMsg);
    const res = await fetch(`${WORKER_URL}/profile`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guid, pubkey: pubkeyB64u, signature, ts,
        entity_type: 'person', name: 'GDC 필드테스트 계정',
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) fail(`POST /profile 실패 (HTTP ${res.status}): ${JSON.stringify(data)}`);
    log('[PASS] 프로필 등록(pubkey_ed25519 TOFU 바인딩) 성공');
  }

  // ── 2) 가입 축하 잔액 확인 (신용평가의 bs-cash 입력이 될 값) ───────
  let balanceBefore;
  {
    const res = await fetch(`${WORKER_URL}/biz/balance?guid=${encodeURIComponent(guid)}`);
    const data = await res.json().catch(() => ({}));
    balanceBefore = Number(data.balance) || 0;
    log('[PASS] 가입 직후 잔액(bs-cash):', balanceBefore);
    if (balanceBefore <= 0) log('[WARN] 가입 축하금이 0입니다 — mint 실패 가능성. 계속 진행은 하되 이후 실패하면 이게 원인일 수 있음.');
  }

  // ── 3) 관리자 로그인 ────────────────────────────────────────────────
  let adminToken;
  {
    const res = await fetch(`${WORKER_URL}/admin/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) fail(`관리자 로그인 실패 (HTTP ${res.status}): ${JSON.stringify(data)}`);
    adminToken = data.token;
    log('[PASS] 관리자 로그인 성공 (', data.admin, ')');
  }

  // ── 4) 테스터 재무제표 시나리오 등록 ────────────────────────────────
  // 의도적으로 "중간 등급"이 나오도록 값을 골랐다 — 유동비율 준수, 부채비율
  // 보통, 영업이익률 낮음, 현금흐름 보통. 등급 임계값 검증 목적.
  const scenario = {
    user_guid: guid,
    tester_org: 'live-smoke-test',
    note: `gdc_loan_credit_live_test.cjs 자동 생성 (${new Date().toISOString()})`,
    bs_ar: 200, bs_ap: 150, bs_debt: 300, bs_equity: 400,
    bs_inventory: 0, pl_revenue: 1000, pl_cogs: 700, pl_opex: 250, cf_op: 80,
  };
  {
    const res = await fetch(`${WORKER_URL}/biz/gdc-test-financial-statement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify(scenario),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) fail(`재무제표 시나리오 등록 실패 (HTTP ${res.status}): ${JSON.stringify(data)}`);
    log('[PASS] 재무제표 시나리오 등록:', JSON.stringify(data));
  }

  // ── 4-1) 일반 GET(비인증)으로도 조회되는지 확인 — TESTER_ONLY 게이트가
  //         "레코드 존재"만으로 통과하는지 검증(과인증 방지 확인).
  {
    const res = await fetch(`${WORKER_URL}/biz/gdc-test-financial-statement?user_guid=${encodeURIComponent(guid)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) fail(`재무제표 재조회 실패 (HTTP ${res.status}): ${JSON.stringify(data)}`);
    log('[PASS] 재무제표 재조회(비인증 GET) 성공 — TESTER_ONLY 게이트 통과 확인');
  }

  // ── 5) applyLoan ──────────────────────────────────────────────────
  let loanId, grade, annualRate;
  {
    const ts = Date.now().toString();
    const sigMsg = `gdc-test-loan-apply:${guid}:${LOAN_PRINCIPAL}:${pubkeyB64u}:${ts}`;
    const signature = await signText(privateKey, sigMsg);
    const res = await fetch(`${WORKER_URL}/biz/gdc-test-loan-apply`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_guid: guid, principal: LOAN_PRINCIPAL, pubkey: pubkeyB64u, signature, ts }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) fail(`applyLoan 실패 (HTTP ${res.status}): ${JSON.stringify(data)}`);
    loanId = data.loan_id; grade = data.grade; annualRate = data.annual_rate;
    log(`[PASS] applyLoan 성공 — loan_id=${loanId} grade=${grade} annual_rate=${annualRate}`);
    log('  credit_snapshot:', JSON.stringify(data.credit_snapshot));
  }

  // ── 6) 대출금 지급 후 잔액 확인 (balanceBefore + LOAN_PRINCIPAL 기대) ──
  let balanceAfterLoan;
  {
    const res = await fetch(`${WORKER_URL}/biz/balance?guid=${encodeURIComponent(guid)}`);
    const data = await res.json().catch(() => ({}));
    balanceAfterLoan = Number(data.balance) || 0;
    const expected = balanceBefore + LOAN_PRINCIPAL;
    if (balanceAfterLoan !== expected) {
      fail(`대출 지급 후 잔액 불일치 — 기대 ${expected}, 실제 ${balanceAfterLoan}`);
    }
    log(`[PASS] 대출 지급 후 잔액 확인: ${balanceBefore} → ${balanceAfterLoan} (+${LOAN_PRINCIPAL})`);
  }

  // ── 7) repayLoan — /wallet/gdc-transfer로 실이체 먼저, 그다음 원금/이자
  //      분리 기록 요청. gopang-wallet.js buildTxWithPrevHash/signTx와
  //      동일한 tx 구조·서명 방식.
  {
    const nonce = bufToHex(crypto.getRandomValues(new Uint8Array(8)));
    const timestamp = Math.floor(Date.now() / 1000);
    const tx = {
      version: 1,
      input: { owner_guid: guid, prev_settle_hash: null, balance_claimed: balanceAfterLoan },
      outputs: [{ recipient_guid: 'gdc-loan-vault', amount: REPAY_AMOUNT }],
      items: [], nonce, timestamp,
    };
    const tx_hash = bufToHex(await sha256(sortedStringify(tx)));
    const sender_sig = await signText(privateKey, tx_hash);

    const transferRes = await fetch(`${WORKER_URL}/wallet/gdc-transfer`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tx, tx_hash, sender_sig, sender_public_key: pubkeyB64u,
        from_guid: guid, to_guid: 'gdc-loan-vault', amount: REPAY_AMOUNT,
        memo: `대출 상환(목업) #${loanId}`, purpose: 'transfer',
        prev_settle_hash: null, balance_claimed: balanceAfterLoan,
      }),
    });
    const transferData = await transferRes.json().catch(() => ({}));
    if (!transferRes.ok || !transferData.ok) {
      fail(`상환 실이체(/wallet/gdc-transfer) 실패 (HTTP ${transferRes.status}): ${JSON.stringify(transferData)}`);
    }
    log('[PASS] 상환 실이체 성공, tx_hash =', tx_hash);

    const repayRes = await fetch(`${WORKER_URL}/biz/gdc-test-loan-repay`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_guid: guid, loan_id: loanId, amount: REPAY_AMOUNT, vault_tx_hash: tx_hash }),
    });
    const repayData = await repayRes.json().catch(() => ({}));
    if (!repayRes.ok || !repayData.ok) {
      fail(`repayLoan(/biz/gdc-test-loan-repay) 실패 (HTTP ${repayRes.status}): ${JSON.stringify(repayData)}`);
    }
    log('[PASS] repayLoan 성공:', JSON.stringify(repayData));

    // 최초 상환이므로 대출 실행 직후 = 경과일 거의 0 → 이자는 거의 0에 수렴,
    // 원금 상환분이 REPAY_AMOUNT에 근접해야 정상(음수/NaN이면 이상).
    if (!(repayData.principal_portion >= 0) || !(repayData.interest_portion >= 0)) {
      fail(`원금/이자 분리값이 비정상입니다: ${JSON.stringify(repayData)}`);
    }
  }

  // ── 8) 최종 잔액 확인 ────────────────────────────────────────────
  {
    const res = await fetch(`${WORKER_URL}/biz/balance?guid=${encodeURIComponent(guid)}`);
    const data = await res.json().catch(() => ({}));
    const finalBalance = Number(data.balance) || 0;
    const expected = balanceAfterLoan - REPAY_AMOUNT;
    if (finalBalance !== expected) {
      fail(`최종 잔액 불일치 — 기대 ${expected}, 실제 ${finalBalance}`);
    }
    log(`[PASS] 최종 잔액 확인: ${balanceAfterLoan} → ${finalBalance} (-${REPAY_AMOUNT})`);
  }

  log('\n=== 전 구간 [PASS] — register-key → financial-statement 등록 → applyLoan → repayLoan 정상 동작 확인 ===');
  log(`테스트 guid: ${guid} (등급 ${grade}, 연 ${(annualRate * 100).toFixed(1)}%) — 필요 없으면 gdc_test_* 컬렉션에서 정리하세요.`);
}

main().catch(e => fail(e.stack || e.message));
