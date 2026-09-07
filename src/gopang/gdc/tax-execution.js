/**
 * gdc/tax-execution.js — 대시보드 "세무" 탭 실행 계층 (2026-09-07 신설)
 *
 * SP_tax-accountant_v2_4(prompts/SP_tax-accountant_v2_4.md) STEP C-2의
 * 백엔드 짝. 대시보드 "재무제표" 탭(financial-statements.js)이 만든
 * 손익계산서 데이터를 입력으로 받아:
 *   ① 경정청구 후보를 휴리스틱으로 스캔(1차 스크리닝)
 *   ② 세무사 AI(SP_tax-accountant) 상담 세션을 그 데이터가 미리 주입된
 *      채로 연다 — expert-chat.html?persona=tax-accountant&ctx=...
 *   ③ (위임 켜짐 + 확신도 🟢 + 제척기간 내 + 실행 인프라 확보 시) 홈택스
 *      조회·경정청구를 실제로 실행한다
 *
 * 정직성 원칙: 국세청 경정청구 제출용 공식 오픈 API는 아직 없다(RPA
 * 연동 필요). 그 인프라가 서버에 없으면 worker.js가 `pending_credential`
 * 로 응답하고, 이 모듈은 그 상태를 그대로 호출자에게 전달한다 — 실행된
 * 것처럼 꾸미지 않는다.
 */
const WORKER_URL = 'https://hondi-proxy.tensor-city.workers.dev';

async function _sign(wallet, prefix, extra = '') {
  const ts = Date.now().toString();
  const sigMsg = `${prefix}:${wallet.guid}:${wallet.publicKeyB64u}:${ts}${extra}`;
  const signature = await wallet.signPayload(sigMsg);
  return { ts, signature };
}

/** G8-TAX(세무 자동 집행 위임) 현재 상태 조회 — 서명 불필요(공개 조회). */
export async function fetchTaxDelegation(wallet) {
  if (!wallet?.guid) throw new Error('[tax] wallet.guid 없음 — 로그인 필요');
  const res = await fetch(`${WORKER_URL}/tax/delegation?guid=${encodeURIComponent(wallet.guid)}`);
  if (!res.ok) throw new Error(`[tax] 위임 상태 조회 실패: HTTP ${res.status}`);
  const data = await res.json();
  return !!data.enabled;
}

/** G8-TAX 위임 on/off 설정. */
export async function setTaxDelegation(wallet, enabled) {
  if (!wallet?.guid || !wallet?.publicKeyB64u) throw new Error('[tax] wallet 정보 없음 — 로그인 필요');
  const { ts, signature } = await _sign(wallet, 'tax-delegation-set', `:${enabled}`);
  const res = await fetch(`${WORKER_URL}/tax/delegation`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guid: wallet.guid, enabled, pubkey: wallet.publicKeyB64u, signature, ts }),
  });
  if (!res.ok) throw new Error(`[tax] 위임 설정 실패: HTTP ${res.status}`);
  return res.json();
}

/** 재무제표 기반 경정청구 후보 1차 스크리닝(휴리스틱 — 최종 판단 아님). */
export async function fetchCorrectionOpportunities(wallet) {
  if (!wallet?.guid || !wallet?.publicKeyB64u) throw new Error('[tax] wallet 정보 없음 — 로그인 필요');
  const { ts, signature } = await _sign(wallet, 'correction-opportunities');
  const qs = new URLSearchParams({ guid: wallet.guid, pubkey: wallet.publicKeyB64u, signature, ts });
  const res = await fetch(`${WORKER_URL}/tax/correction-opportunities?${qs.toString()}`);
  if (!res.ok) throw new Error(`[tax] 경정청구 후보 조회 실패: HTTP ${res.status}`);
  const data = await res.json();
  return data.items || [];
}

/** 홈택스/공공데이터 조회(사업자등록 상태 등). 자격 미확보 시 pending_credential. */
export async function queryHometax(wallet, bizNo) {
  if (!wallet?.guid || !wallet?.publicKeyB64u) throw new Error('[tax] wallet 정보 없음 — 로그인 필요');
  const { ts, signature } = await _sign(wallet, 'hometax-query');
  const qs = new URLSearchParams({
    guid: wallet.guid, pubkey: wallet.publicKeyB64u, signature, ts, biz_no: bizNo || '',
  });
  const res = await fetch(`${WORKER_URL}/tax/hometax/query?${qs.toString()}`);
  if (!res.ok) throw new Error(`[tax] 홈택스 조회 실패: HTTP ${res.status}`);
  return res.json(); // { ok, status: 'live'|'pending_credential', data? }
}

/**
 * 경정청구 실행. STEP C-2 4조건은 서버가 다시 검증하므로, 여기서 보내는
 * confidence·statute_ok는 참고값일 뿐 클라이언트가 게이트를 우회할 수는
 * 없다(위임 플래그는 서버가 profile.extra에서 직접 재확인).
 *
 * @param {Object} wallet
 * @param {Object} params
 * @param {string} params.opportunityId - fetchCorrectionOpportunities()의 item.id
 * @param {'red'|'yellow'|'green'} params.confidence - SP STEP B 종합확신도
 * @param {boolean} params.statuteOk - 제척기간 내 여부(SP STEP R R-4)
 * @param {Object} params.claimDraft - SP가 작성한 경정청구서 초안(사람이 읽을 형태)
 */
export async function fileCorrectionClaim(wallet, { opportunityId, confidence, statuteOk, claimDraft }) {
  if (!wallet?.guid || !wallet?.publicKeyB64u) throw new Error('[tax] wallet 정보 없음 — 로그인 필요');
  const { ts, signature } = await _sign(wallet, 'correction-claim-file', `:${opportunityId}`);
  const res = await fetch(`${WORKER_URL}/tax/hometax/correction-claim`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      guid: wallet.guid, pubkey: wallet.publicKeyB64u, signature, ts,
      opportunity_id: opportunityId, confidence, statute_ok: statuteOk, claim_draft: claimDraft,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`[tax] 경정청구 실행 실패: ${data.message || res.status}`);
  return data; // { ok, status: 'submitted'|'pending_credential'|'blocked_no_delegation'|'blocked_low_confidence', ... }
}

/**
 * 대시보드 "세무" 탭에서 "세무사 AI와 상담" 버튼이 여는 URL을 만든다.
 * 재무제표 요약을 ctx(base64)로 실어 SP_tax-accountant STEP 0-4가 재입력
 * 없이 바로 STEP A로 넘어갈 수 있게 한다.
 */
export function buildTaxAdvisorChatUrl({ pl, bs, cf }, returnUrl) {
  const dashboard_fs = {
    pl: pl ? { 'pl-revenue': pl.revenue, 'pl-cogs': pl.cogs, 'pl-purchase': pl.purchases, 'pl-net-income': pl.net_income } : {},
    bs: bs ? { 'bs-cash': bs.assets?.cash } : {},
    cf: cf ? { operating: cf.operating, financing: cf.financing } : {},
  };
  const ctxPayload = JSON.stringify({ dashboard_fs, source: 'dashboard-tax-tab' });
  const ctxB64 = btoa(unescape(encodeURIComponent(ctxPayload)));
  const qs = new URLSearchParams({
    persona: 'tax-accountant', ctx: ctxB64, ctx_enc: 'b64', return: returnUrl || location.href,
  });
  return '/pages/expert-chat.html?' + qs.toString();
}
