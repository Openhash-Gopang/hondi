#!/usr/bin/env node
/**
 * pdv_bidirectional_order_live_smoketest.cjs
 *
 * "두 사용자가 거래하면(판매자·구매자) 6하원칙 거래명세서를 작성하고,
 *  AC는 PDV를, 재무제표 SP는 재무제표를 갱신한다" — 이 요구를 실제
 *  hondi-proxy에 대고 검증한다.
 *
 * gdc_loan_credit_live_test.cjs와 동일한 원칙(register-key → 실거래 →
 * 부수효과 검증)을 따르되, 대상은 대출이 아니라 P2P 매매다:
 *
 *   1) 구매자·판매자 계정을 각각 새로 만든다(register-key + POST /profile).
 *   2) 가입 축하금(초기 잔액)을 확인한다.
 *   3) 구매자 → 판매자로 /wallet/gdc-transfer(purpose='purchase', memo=
 *      품목명)를 실행한다 — 이 엔드포인트는 내부적으로 handleBizOrder를
 *      그대로 태우므로, worker.js를 직접 고치지 않고도 실제 주문 경로를
 *      검증한다.
 *   4) 잔액이 금액만큼 정확히 이동했는지 확인한다(P2P는 플랫폼 수수료 0%).
 *   5) PocketBase pdv_records를 guid+block_hash로 직접 조회해, 구매자·
 *      판매자 양쪽 모두에 type='tx_2party' 6하원칙 레코드가 생겼는지
 *      확인한다(2026-09-08 _recordOrderPdv 양방향화 패치의 회귀 가드).
 *      who/what/why가 구매/판매 관점으로 정확히 갈렸는지도 검사한다.
 *   6) pending_claims를 tx_hash+claimant로 조회해 buyer_claim(pl-purchase)/
 *      seller_claim(pl-revenue)이 둘 다 적재됐는지 확인한다.
 *   7) 양쪽 계정으로 /biz/settle-ledger를 호출해(서명 필요) 재무제표에
 *      실제로 반영되는지 확인한다 — 구매자는 pl-purchase == amount,
 *      판매자는 pl-revenue == amount(카탈로그 없는 거래라 pl-cogs는 0).
 *
 * 사용법:
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node pdv_bidirectional_order_live_smoketest.cjs
 *
 * 환경변수:
 *   WORKER_URL      — 기본값 https://hondi-proxy.tensor-city.workers.dev
 *   PB_BASE         — 기본값 https://l1-hanlim.hondi.net (L1 PocketBase)
 *   PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD
 *                   — L1 PocketBase 슈퍼관리자 자격(worker.js의
 *                     L1_ADMIN_EMAIL/L1_ADMIN_PASSWORD와 같은 값이어야 함 —
 *                     별개의 GitHub Secret으로 등록 필요, HONDI_ADMIN_EMAIL과는
 *                     다른 자격증명이다. gdc_loan_credit_live_test.cjs가 쓰는
 *                     /admin/login(prompt_admins)과 혼동하지 말 것).
 *   ORDER_AMOUNT    — 기본값 30 (거래 금액, ₮)
 */

'use strict';

const { webcrypto } = require('crypto');
const crypto = webcrypto;

const WORKER_URL      = process.env.WORKER_URL || 'https://hondi-proxy.tensor-city.workers.dev';
const PB_BASE         = process.env.PB_BASE || 'https://l1-hanlim.hondi.net';
const PB_ADMIN_EMAIL  = process.env.PB_ADMIN_EMAIL;
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD;
const ORDER_AMOUNT    = Number(process.env.ORDER_AMOUNT || 30);

if (!PB_ADMIN_EMAIL || !PB_ADMIN_PASSWORD) {
  console.error('[FATAL] PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD 환경변수가 필요합니다.');
  console.error('  (L1 PocketBase 슈퍼관리자 자격 — worker.js L1_ADMIN_EMAIL/PASSWORD와 동일 값)');
  process.exit(1);
}

function log(...args) { console.log('[TEST]', ...args); }
function fail(msg) { console.error('\n[FAIL]', msg); process.exit(1); }

// ── gopang-wallet.js sortedStringify 원본 포팅 ──────────────────────
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

function bufToB64u(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function bufToHex(buf) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
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
async function signText(privateKey, text) {
  const sigBuf = await crypto.subtle.sign('Ed25519', privateKey, new TextEncoder().encode(text));
  return bufToB64u(sigBuf);
}
function randomTestGuid() {
  const groups = Array.from({ length: 7 }, () =>
    crypto.getRandomValues(new Uint32Array(1))[0].toString(16).padStart(4, '0').slice(0, 4));
  return 'fd00:' + groups.join(':');
}

async function registerAccount(label) {
  const { publicKey, privateKey } = await generateKeyPair();
  const pubkeyB64u = await exportPubKeyB64u(publicKey);
  const guid = randomTestGuid();

  {
    const ts = Date.now().toString();
    const sigMsg = `register-key:${guid}:${ts}`;
    const signature = await signText(privateKey, sigMsg);
    const res = await fetch(`${WORKER_URL}/gwp/register-key`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guid, public_key: pubkeyB64u, signature, ts }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) fail(`[${label}] register-key 실패 (HTTP ${res.status}): ${JSON.stringify(data)}`);
  }
  {
    const ts = Date.now().toString();
    const sigMsg = `${guid}:${pubkeyB64u}:${ts}`;
    const signature = await signText(privateKey, sigMsg);
    const res = await fetch(`${WORKER_URL}/profile`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guid, pubkey: pubkeyB64u, signature, ts,
        entity_type: 'person', name: `PDV 양방향 스모크테스트(${label})`,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) fail(`[${label}] POST /profile 실패 (HTTP ${res.status}): ${JSON.stringify(data)}`);
  }
  log(`[PASS] [${label}] 계정 준비 완료 guid=${guid}`);
  return { label, guid, publicKey, privateKey, pubkeyB64u };
}

async function fetchBalance(guid) {
  const res = await fetch(`${WORKER_URL}/biz/balance?guid=${encodeURIComponent(guid)}`);
  const data = await res.json().catch(() => ({}));
  return Number(data.balance) || 0;
}

async function pbAdminLogin() {
  const res = await fetch(`${PB_BASE}/api/admins/auth-with-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: PB_ADMIN_EMAIL, password: PB_ADMIN_PASSWORD }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.token) fail(`PocketBase admin 로그인 실패: ${JSON.stringify(data)}`);
  return data.token;
}

async function pbFind(token, collection, filter) {
  const res = await fetch(
    `${PB_BASE}/api/collections/${collection}/records?filter=${encodeURIComponent(filter)}&perPage=20`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  const data = await res.json().catch(() => ({ items: [] }));
  return data.items || [];
}

async function main() {
  log('WORKER_URL =', WORKER_URL, ' PB_BASE =', PB_BASE, ' ORDER_AMOUNT =', ORDER_AMOUNT);

  // ── 1) 구매자·판매자 계정 준비 ─────────────────────────────────────
  const buyer  = await registerAccount('buyer');
  const seller = await registerAccount('seller');

  // ── 2) 초기 잔액 ───────────────────────────────────────────────────
  const buyerBalanceBefore  = await fetchBalance(buyer.guid);
  const sellerBalanceBefore = await fetchBalance(seller.guid);
  log(`[PASS] 초기 잔액 — buyer=${buyerBalanceBefore} seller=${sellerBalanceBefore}`);
  if (buyerBalanceBefore < ORDER_AMOUNT) {
    fail(`구매자 초기 잔액(${buyerBalanceBefore})이 거래액(${ORDER_AMOUNT})보다 적습니다 — 가입 축하금 정책이 바뀌었을 수 있음`);
  }

  // ── 3) P2P 매매(/wallet/gdc-transfer, purpose='purchase') ──────────
  const ITEM_MEMO = '당근마켓식 중고 물품 스모크테스트';
  let tx_hash, block_hash, orderResp;
  {
    const nonce = bufToHex(crypto.getRandomValues(new Uint8Array(8)));
    const timestamp = Math.floor(Date.now() / 1000);
    const tx = {
      version: 1,
      input:   { owner_guid: buyer.guid, prev_settle_hash: null, balance_claimed: buyerBalanceBefore },
      outputs: [{ recipient_guid: seller.guid, amount: ORDER_AMOUNT }],
      items: [], nonce, timestamp,
    };
    tx_hash = bufToHex(await sha256(sortedStringify(tx)));
    const sender_sig = await signText(buyer.privateKey, tx_hash);

    const res = await fetch(`${WORKER_URL}/wallet/gdc-transfer`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tx, tx_hash, sender_sig, sender_public_key: buyer.pubkeyB64u,
        from_guid: buyer.guid, to_guid: seller.guid, amount: ORDER_AMOUNT,
        memo: ITEM_MEMO, purpose: 'purchase',
        prev_settle_hash: null, balance_claimed: buyerBalanceBefore,
      }),
    });
    orderResp = await res.json().catch(() => ({}));
    if (!res.ok || !orderResp.ok) fail(`/wallet/gdc-transfer 실패 (HTTP ${res.status}): ${JSON.stringify(orderResp)}`);
    block_hash = orderResp.block_hash;
    log('[PASS] P2P 매매 성공 — tx_hash =', tx_hash, ' block_hash =', block_hash);
    if (!orderResp.buyer_claim)  log('[WARN] 응답에 buyer_claim 없음 — 재무제표 반영이 안 될 수 있음');
    if (!orderResp.seller_claim) log('[WARN] 응답에 seller_claim 없음 — 재무제표 반영이 안 될 수 있음');
  }

  // ── 4) 잔액 이동 확인 ────────────────────────────────────────────
  {
    const buyerBalanceAfter  = await fetchBalance(buyer.guid);
    const sellerBalanceAfter = await fetchBalance(seller.guid);
    const expectedBuyer  = buyerBalanceBefore - ORDER_AMOUNT;
    const expectedSeller = sellerBalanceBefore + ORDER_AMOUNT; // P2P 수수료 0%
    if (buyerBalanceAfter !== expectedBuyer)
      fail(`구매자 잔액 불일치 — 기대 ${expectedBuyer}, 실제 ${buyerBalanceAfter}`);
    if (sellerBalanceAfter !== expectedSeller)
      fail(`판매자 잔액 불일치 — 기대 ${expectedSeller}, 실제 ${sellerBalanceAfter}`);
    log(`[PASS] 잔액 이동 확인 — buyer ${buyerBalanceBefore}→${buyerBalanceAfter}, seller ${sellerBalanceBefore}→${sellerBalanceAfter}`);
  }

  // ── 5) PDV 양방향 거래명세서 확인 (이번 패치의 핵심 회귀 가드) ─────
  const pbToken = await pbAdminLogin();
  {
    const buyerRecs = await pbFind(pbToken, 'pdv_records', `guid='${buyer.guid}' && block_hash='${block_hash}'`);
    log('[DEBUG] 구매자 pdv_records 원본:', JSON.stringify(buyerRecs));
    if (buyerRecs.length !== 1) fail(`구매자 pdv_records 레코드 개수 이상 — 기대 1, 실제 ${buyerRecs.length}`);
    const buyerRec = buyerRecs[0];
    if (buyerRec.type !== 'tx_2party') fail(`구매자 pdv_records.type 불일치: ${buyerRec.type}`);
    let buyerSixw = {};
    try { buyerSixw = JSON.parse(buyerRec.summary_6w || '{}'); } catch {}
    if (!/^buyer\(/.test(buyerSixw.who || '')) fail(`구매자 who 필드 불일치: ${JSON.stringify(buyerSixw.who)}`);
    if (!/^구매:/.test(buyerSixw.what || ''))   fail(`구매자 what 필드 불일치: ${JSON.stringify(buyerSixw.what)}`);
    if (buyerSixw.why !== '상품 구매 거래')      fail(`구매자 why 필드 불일치: ${JSON.stringify(buyerSixw.why)}`);
    log('[PASS] 구매자 PDV 거래명세서 확인 —', JSON.stringify({ who: buyerSixw.who, what: buyerSixw.what, why: buyerSixw.why }));

    const sellerRecs = await pbFind(pbToken, 'pdv_records', `guid='${seller.guid}' && block_hash='${block_hash}'`);
    log('[DEBUG] 판매자 pdv_records 원본:', JSON.stringify(sellerRecs));
    if (sellerRecs.length !== 1) fail(`판매자 pdv_records 레코드 개수 이상(양방향화 회귀!) — 기대 1, 실제 ${sellerRecs.length}`);
    const sellerRec = sellerRecs[0];
    if (sellerRec.type !== 'tx_2party') fail(`판매자 pdv_records.type 불일치: ${sellerRec.type}`);
    let sellerSixw = {};
    try { sellerSixw = JSON.parse(sellerRec.summary_6w || '{}'); } catch {}
    if (!/^seller\(/.test(sellerSixw.who || '')) fail(`판매자 who 필드 불일치: ${JSON.stringify(sellerSixw.who)}`);
    if (!/^판매:/.test(sellerSixw.what || ''))    fail(`판매자 what 필드 불일치: ${JSON.stringify(sellerSixw.what)}`);
    if (sellerSixw.why !== '상품 판매 거래')       fail(`판매자 why 필드 불일치: ${JSON.stringify(sellerSixw.why)}`);
    log('[PASS] 판매자 PDV 거래명세서 확인 —', JSON.stringify({ who: sellerSixw.who, what: sellerSixw.what, why: sellerSixw.why }));

    // when/where/how 공유 필드가 양쪽에서 실제로 같은 값인지(같은 거래의
    // 두 관점이어야 함 — 서로 다른 시각을 각자 만든 게 아니라).
    if (buyerSixw.where !== sellerSixw.where) fail('where 필드가 구매자/판매자 간 불일치');
    if (buyerSixw.raw_hash !== sellerSixw.raw_hash) fail('raw_hash(tx_hash) 필드가 구매자/판매자 간 불일치');
  }

  // ── 6) pending_claims 양방향 적재 확인 ─────────────────────────────
  {
    const buyerClaims = await pbFind(pbToken, 'pending_claims', `claimant='${buyer.guid}' && tx_hash='${tx_hash}'`);
    if (buyerClaims.length < 1) fail('구매자 pending_claims 레코드 없음(buyer_claim 미적재)');
    const hasPurchase = buyerClaims.some(r => (r.claim_data || []).some(c => c.fs_account === 'pl-purchase'));
    if (!hasPurchase) fail('구매자 pending_claims에 pl-purchase 항목 없음');
    log('[PASS] 구매자 pending_claims(pl-purchase) 적재 확인');

    const sellerClaims = await pbFind(pbToken, 'pending_claims', `claimant='${seller.guid}' && tx_hash='${tx_hash}'`);
    if (sellerClaims.length < 1) fail('판매자 pending_claims 레코드 없음(seller_claim 미적재)');
    const hasRevenue = sellerClaims.some(r => (r.claim_data || []).some(c => c.fs_account === 'pl-revenue'));
    if (!hasRevenue) fail('판매자 pending_claims에 pl-revenue 항목 없음');
    log('[PASS] 판매자 pending_claims(pl-revenue) 적재 확인');
  }

  // ── 7) /biz/settle-ledger — 실제 재무제표 반영 확인 ────────────────
  async function settleAndFetch(account) {
    const ts = Date.now().toString();
    const sigMsg = `settle:${account.guid}:${account.pubkeyB64u}:${ts}`;
    const signature = await signText(account.privateKey, sigMsg);
    const res = await fetch(`${WORKER_URL}/biz/settle-ledger`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guid: account.guid, pubkey: account.pubkeyB64u, signature, ts }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) fail(`[${account.label}] /biz/settle-ledger 실패 (HTTP ${res.status}): ${JSON.stringify(data)}`);
    return data;
  }

  {
    const buyerFs = await settleAndFetch(buyer);
    if (!(Number(buyerFs.purchases) >= ORDER_AMOUNT))
      fail(`구매자 재무제표 pl-purchase 미반영 — 기대 >= ${ORDER_AMOUNT}, 실제 ${buyerFs.purchases}`);
    log(`[PASS] 구매자 재무제표 반영 확인 — purchases=${buyerFs.purchases}`);

    const sellerFs = await settleAndFetch(seller);
    if (!(Number(sellerFs.revenue) >= ORDER_AMOUNT))
      fail(`판매자 재무제표 pl-revenue 미반영 — 기대 >= ${ORDER_AMOUNT}, 실제 ${sellerFs.revenue}`);
    log(`[PASS] 판매자 재무제표 반영 확인 — revenue=${sellerFs.revenue}`);
  }

  log('\n=== 전 구간 [PASS] — 계정 준비 → P2P 매매 → 잔액이동 → PDV 양방향 6하원칙 기록 → pending_claims 양방향 적재 → 재무제표 반영 전부 정상 확인 ===');
  log(`buyer=${buyer.guid} seller=${seller.guid} tx_hash=${tx_hash}`);
}

main().catch(e => fail(e.stack || e.message));
