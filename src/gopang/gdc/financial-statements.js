/**
 * gdc/financial-statements.js — 대시보드 재무제표 탭(손익계산서·대차대조표·
 * 현금흐름표) 데이터 조회 (2026-09-07 신설)
 *
 * 새 백엔드 엔드포인트를 만들지 않고, 이미 존재하는 GDC 재무 인프라를
 * 그대로 재사용한다:
 *   - GET  /biz/balance        — L1 원장 재생(computeBalance) 기반 현재 잔액(자산=현금)
 *   - POST /biz/settle-ledger  — pending_claims에서 매출/매출원가 재집계 → L1 저장
 *   - GET  /biz/financials     — 저장된 손익계산서(fs.pl) 조회
 *   - GET  /biz/tx-history     — 원장 거래내역(block_type별 방향/금액) → 현금흐름표 집계
 *
 * 알려진 한계(추측하지 않고 그대로 노출 — 화면에도 각주로 표시):
 *   - (2026-09-07 수정됨) 손익계산서는 한때 "판매자(매출)" 쪽만 서버에
 *     반영됐었다 — 구매자로서 쓴 돈(pl-purchase)이 handleBizOrder에서
 *     빠져 있었다. 이제 buyer_claim도 seller_claim과 대칭으로
 *     pending_claims에 적재되고, handleSettleLedger가 함께 집계한다.
 *     다만 pl-purchase(구매 시점 지출 전체)와 pl-cogs(판매 시점에 매칭된
 *     원가만)는 서로 다른 기준이라, 같은 재고를 사고 되팔면 두 계정에
 *     걸쳐 보일 수 있다 — 정식 재고자산(bs-inventory) 계정을 통한
 *     발생주의 매칭은 아직 없다(의도적 범위 제한, 후속 작업).
 *   - 대차대조표는 "현금" 계정 하나만 실제로 존재한다(부채·기타자산 계정
 *     없음). 자본(이익잉여금) = 자산(현금)으로 단순화해 표시한다.
 *   - 현금흐름표는 계정과목이 아니라 거래유형(block_type)으로 3분류한다:
 *     ai_usage_charge → 영업활동, deposit/withdrawal/loan_disbursement →
 *     재무활동. 투자활동에 해당하는 거래유형은 현재 없다(0으로 표시).
 */
const WORKER_URL = 'https://hondi-proxy.tensor-city.workers.dev';

async function _sign(wallet, prefix) {
  const ts = Date.now().toString();
  const sigMsg = `${prefix}:${wallet.guid}:${wallet.publicKeyB64u}:${ts}`;
  const signature = await wallet.signPayload(sigMsg);
  return { ts, signature };
}

/**
 * 대차대조표 — 자산(현금) 조회. /biz/balance는 서명 없이 guid만으로
 * 조회되는 공개 잔액 엔드포인트다(기존 설계 그대로).
 */
export async function fetchBalanceSheet(wallet) {
  if (!wallet?.guid) throw new Error('[fs] wallet.guid 없음 — 로그인 필요');
  const res = await fetch(`${WORKER_URL}/biz/balance?guid=${encodeURIComponent(wallet.guid)}`);
  if (!res.ok) throw new Error(`[fs] 잔액 조회 실패: HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || '[fs] 잔액 조회 실패');
  const cash = Number(data.balance ?? data.balance_gdc ?? 0);
  return {
    assets:       { cash },
    liabilities:  {}, // 아직 모델링된 부채 계정 없음
    equity:       { retained_earnings: cash },
    total_assets: cash,
    total_liabilities_and_equity: cash,
  };
}

/** 손익계산서 — 저장된 pl 스냅샷 조회(기본: 조회 전 서버 재집계 1회 트리거). */
export async function fetchIncomeStatement(wallet, { refresh = true } = {}) {
  if (!wallet?.guid || !wallet?.publicKeyB64u) throw new Error('[fs] wallet 정보 없음 — 로그인 필요');

  if (refresh) {
    const { ts, signature } = await _sign(wallet, 'settle');
    await fetch(`${WORKER_URL}/biz/settle-ledger`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guid: wallet.guid, pubkey: wallet.publicKeyB64u, signature, ts }),
    }).catch((e) => console.warn('[fs] settle-ledger 재집계 실패(무시, 이전 스냅샷 사용):', e.message));
  }

  const { ts, signature } = await _sign(wallet, 'financials');
  const qs = new URLSearchParams({ guid: wallet.guid, pubkey: wallet.publicKeyB64u, signature, ts });
  const res = await fetch(`${WORKER_URL}/biz/financials?${qs.toString()}`);
  if (!res.ok) throw new Error(`[fs] 손익계산서 조회 실패: HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.message || '[fs] 손익계산서 조회 실패');
  const pl = data.fs?.pl || {};
  return {
    revenue:      Number(pl['pl-revenue']      ?? 0),
    cogs:         Number(pl['pl-cogs']         ?? 0),
    purchases:    Number(pl['pl-purchase']     ?? 0), // 2026-09-07 — 구매자 매입, 이전엔 서버에 전혀 기록되지 않던 값
    gross_profit: Number(pl['pl-gross-profit'] ?? 0),
    opex:         Number(pl['pl-opex']         ?? 0),
    net_income:   Number(pl['pl-net-income']   ?? 0),
  };
}

const _CF_CATEGORY = {
  ai_usage_charge:   'operating',
  deposit:           'financing',
  withdrawal:        'financing',
  loan_disbursement: 'financing',
};

/** 현금흐름표 — /biz/tx-history를 block_type 기준으로 영업/투자/재무 3분류 집계. */
export async function fetchCashFlow(wallet, { limit = 500 } = {}) {
  if (!wallet?.guid || !wallet?.publicKeyB64u) throw new Error('[fs] wallet 정보 없음 — 로그인 필요');
  const { ts, signature } = await _sign(wallet, 'tx-history');
  const qs = new URLSearchParams({
    guid: wallet.guid, pubkey: wallet.publicKeyB64u, signature, ts, limit: String(limit),
  });
  const res = await fetch(`${WORKER_URL}/biz/tx-history?${qs.toString()}`);
  if (!res.ok) throw new Error(`[fs] 거래내역 조회 실패: HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error('[fs] 거래내역 조회 실패');

  const buckets = { operating: 0, investing: 0, financing: 0, other: 0 };
  for (const tx of (data.items || [])) {
    const cat = _CF_CATEGORY[tx.block_type] || 'other';
    const signed = tx.direction === 'credit' ? (tx.amount || 0) : -(tx.amount || 0);
    buckets[cat] += signed;
  }
  const net_change = buckets.operating + buckets.investing + buckets.financing + buckets.other;
  return {
    ...buckets, net_change,
    truncated: !!data.truncated,
    item_count: (data.items || []).length,
  };
}

/**
 * 재무제표 무결성 검증 — GET /fs/verify (2026-09-07 신설).
 * handleSettleLedger가 pl을 갱신할 때마다 남기는 fs_snapshots(git commit과
 * 동일 구조: content_hash + prev_hash → commit_hash)가 OpenHash에
 * 정확히 앵커링돼 있는지, 그리고 그 해시가 실제 저장된 데이터에서
 * 재계산돼 나오는지를 확인한다. 서명 불필요(guid만으로 조회 — /biz/balance
 * 와 동일한 공개 조회 원칙).
 *
 * @param {Object} wallet
 * @param {number} [seq] — 생략하면 최신 스냅샷을 검증한다.
 */
export async function verifyFinancialStatement(wallet, seq) {
  if (!wallet?.guid) throw new Error('[fs] wallet.guid 없음 — 로그인 필요');
  const qs = new URLSearchParams({ guid: wallet.guid });
  if (seq != null) qs.set('seq', String(seq));
  const res = await fetch(`${WORKER_URL}/fs/verify?${qs.toString()}`);
  if (!res.ok) throw new Error(`[fs] 검증 조회 실패: HTTP ${res.status}`);
  return res.json(); // { valid, self_consistent, anchor_valid, reason?, ... }
}

