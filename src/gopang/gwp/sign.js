/**
 * gwp/sign.js — GWP 결제 서명 처리
 */
import { appendBubble } from '../ui/bubble.js';
import { _USER } from '../core/state.js';
import { GWP_ALLOWED_ORIGINS } from './allowed-origins.js';

// 하위 호환: 기존에 './sign.js'에서 GWP_ALLOWED_ORIGINS를 import하던 코드가
// 있을 수 있으므로 re-export. 실제 정의는 allowed-origins.js (의존성 없는
// 순수 모듈, silent-sign.html 같은 독립 페이지에서도 재사용 가능).
export { GWP_ALLOWED_ORIGINS };

// ── GWP_SIGN_REQUEST 핸들러 (STEP 22) ────────────────────────
// 흐름: market 탭 → GWP_SIGN_REQUEST → 나비 서명 확인 UI
//       → [서명하여 결제] 클릭 → gopang-wallet.js Ed25519 서명
//       → GWP_SIGN_RESPONSE → market 탭 → Worker /biz/order POST
//
// msg 구조:
//   msg.tx        — UTXO tx 객체 (seller_guid, outputs, items, total 포함)
//   msg.session_id — 중복 방지용 세션 ID
//   msg.seller_name — 판매자 상호명 (UI 표시용)
export async function _handleGwpSignRequest(msg, sourceWin, sourceOrigin) {
  const tx         = msg.tx;
  const sessionId  = msg.session_id || crypto.randomUUID();
  const sellerName = msg.seller_name || tx?.seller_name || '판매자';

  if (!tx || !tx.outputs || !tx.input) {
    console.warn('[GWP_SIGN] tx 객체 불완전:', msg);
    sourceWin?.postMessage({
      type:       'GWP_SIGN_RESPONSE',
      success:    false,
      error:      'INVALID_TX',
      session_id: sessionId,
    }, sourceOrigin);
    return;
  }

  // 구매자 수신 금액 및 판매자 순수입 계산 (UI 표시용)
  const totalAmount    = tx.input?.balance_claimed
                        || tx.outputs.reduce((s, o) => s + (o.amount || 0), 0);
  const sellerOut      = tx.outputs.find(o => o.recipient_guid !== 'gopang-platform');
  const platformOut    = tx.outputs.find(o => o.recipient_guid === 'gopang-platform');
  const sellerNet      = sellerOut?.amount   || 0;
  const platformFee    = platformOut?.amount || 0;

  // 현재 잔액 조회 (gopang-wallet.js 또는 localStorage fallback)
  let currentBalance = 0;
  try {
    if (window.gopangWallet?.getBalance) {
      currentBalance = await window.gopangWallet.getBalance();
    } else {
      const user = JSON.parse(localStorage.getItem('gopang_user_v4') || '{}');
      currentBalance = parseFloat(user?.fs?.['bs-cash'] ?? '0') || 0;
    }
  } catch(_) {}
  const balanceAfter = currentBalance - totalAmount;

  // ── 서명 확인 UI 인라인 렌더링 ──────────────────────────────
  const confirmId = '_sign-confirm-' + sessionId.slice(0, 8);
  const list = document.getElementById('message-list');
  if (!list) return;

  const itemsHtml = (tx.items || []).map(item =>
    `<div style="display:flex;justify-content:space-between;padding:4px 0;
                 border-bottom:1px solid var(--sep);font-size:13px;">
       <span style="color:var(--label);">${item.name || ''} × ${item.quantity || 1}</span>
       <span style="color:var(--label);font-weight:600;">
         ₮${((item.price || 0) * (item.quantity || 1)).toLocaleString()}
       </span>
     </div>`
  ).join('');

  const row = document.createElement('div');
  row.className = 'msg-row ai';
  row.id = confirmId;
  row.innerHTML = `
    <div style="background:var(--bg-subtle);border-radius:14px;
                padding:16px;width:100%;max-width:360px;
                border:1.5px solid var(--tint);">
      <div style="font-size:13px;font-weight:700;color:var(--tint);margin-bottom:12px;">
        🔏 결제 서명 확인
      </div>
      <div style="font-size:12px;color:var(--label-3);margin-bottom:8px;">
        ${sellerName}
      </div>
      ${itemsHtml}
      <div style="margin-top:10px;padding-top:8px;border-top:2px solid var(--sep-strong);">
        <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;">
          <span>합계</span>
          <span style="color:var(--tint);">₮${totalAmount.toLocaleString()}</span>
        </div>
        ${platformFee > 0 ? `
        <div style="display:flex;justify-content:space-between;font-size:11px;
                    color:var(--label-3);margin-top:4px;">
          <span>판매자 수취</span>
          <span>₮${sellerNet.toLocaleString()}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11px;
                    color:var(--label-3);margin-top:2px;">
          <span>플랫폼 수수료</span>
          <span>₮${platformFee.toLocaleString()}</span>
        </div>` : ''}
        <div style="display:flex;justify-content:space-between;font-size:12px;
                    color:var(--label-2);margin-top:8px;">
          <span>현재 잔액</span>
          <span>₮${currentBalance.toLocaleString()}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12px;
                    color:${balanceAfter >= 0 ? 'var(--label-2)' : '#ff3b30'};margin-top:2px;">
          <span>결제 후 잔액</span>
          <span>${balanceAfter >= 0
            ? '₮' + balanceAfter.toLocaleString()
            : '⚠️ 잔액 부족'}</span>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:14px;">
        <button
          onclick="_gwpSignExecute('${confirmId}','${sessionId}','${sourceOrigin}')"
          ${balanceAfter < 0 ? 'disabled' : ''}
          style="flex:1;background:${balanceAfter >= 0 ? 'var(--tint)' : 'var(--sep-strong)'};
                 color:#fff;border:none;border-radius:10px;
                 padding:12px;font-size:14px;font-weight:700;cursor:pointer;">
          🔏 서명하여 결제
        </button>
        <button
          onclick="_gwpSignCancel('${confirmId}','${sessionId}','${sourceOrigin}')"
          style="flex:0 0 72px;background:var(--bg-subtle);color:var(--label-2);
                 border:1px solid var(--sep);border-radius:10px;
                 padding:12px;font-size:13px;cursor:pointer;">
          취소
        </button>
      </div>
      ${balanceAfter < 0 ? `
      <p style="font-size:11px;color:#ff3b30;margin:8px 0 0;text-align:center;">
        GDC 잔액이 부족합니다. GDC를 충전 후 다시 시도하세요.
      </p>` : ''}
    </div>`;
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;

  // tx와 sourceWin을 임시 저장 (서명 실행 시 참조)
  window._gwpSignPending = window._gwpSignPending || {};
  window._gwpSignPending[sessionId] = { tx, sourceWin, sourceOrigin };

  console.info('[GWP_SIGN] 서명 확인 UI 표시 | session_id:', sessionId,
               '| seller:', sellerName, '| total: ₮' + totalAmount.toLocaleString());
}

// ── 서명 실행 (사용자가 [서명하여 결제] 클릭) ────────────────
window._gwpSignExecute = async function(confirmId, sessionId, sourceOrigin) {
  const pending = window._gwpSignPending?.[sessionId];
  if (!pending) {
    console.warn('[GWP_SIGN] pending 세션 없음:', sessionId);
    return;
  }
  const { tx, sourceWin } = pending;

  // UI 비활성화 (중복 클릭 방지)
  const row = document.getElementById(confirmId);
  if (row) {
    const btns = row.querySelectorAll('button');
    btns.forEach(b => { b.disabled = true; b.style.opacity = '0.5'; });
  }

  appendBubble('ai', '🔏 서명 중…', false);

  try {
    // gopang-wallet.js가 로드된 경우 → Ed25519 서명 수행
    // STEP 23 완료 후 window.gopangWallet.sign()이 활성화됨
    let signedTx;
    if (window.gopangWallet?.sign) {
      signedTx = await window.gopangWallet.sign(tx);
    } else {
      // STEP 23 완료 전 폴백: tx를 그대로 전달 (서명 없이)
      // Worker/L1에서 Phase 1 형식 검증만 수행
      console.warn('[GWP_SIGN] gopang-wallet.js 미로드 — 서명 없이 전달 (Phase 1 폴백)');
      signedTx = { ...tx, buyer_sig: null, _phase1_fallback: true };
    }

    // GWP_SIGN_RESPONSE → market 탭 전송
    sourceWin?.postMessage({
      type:       'GWP_SIGN_RESPONSE',
      success:    true,
      signedTx,
      session_id: sessionId,
    }, sourceOrigin);

    // UI 제거 + 완료 메시지
    row?.remove();
    appendBubble('ai',
      '✅ 서명 완료! 결제가 진행됩니다.<br>' +
      '<span style="font-size:12px;color:var(--label-3);">market 탭에서 결제 결과를 확인하세요.</span>',
      true
    );

    console.info('[GWP_SIGN] 서명 완료 → market 탭 전송 | session_id:', sessionId);
  } catch(err) {
    console.error('[GWP_SIGN] 서명 실패:', err.message);
    sourceWin?.postMessage({
      type:       'GWP_SIGN_RESPONSE',
      success:    false,
      error:      err.message || 'SIGN_FAILED',
      session_id: sessionId,
    }, sourceOrigin);
    row?.remove();
    appendBubble('ai', '⚠️ 서명 중 오류가 발생했습니다: ' + err.message, false);
  } finally {
    delete window._gwpSignPending?.[sessionId];
  }
};

// ── 서명 취소 (사용자가 [취소] 클릭) ─────────────────────────
window._gwpSignCancel = function(confirmId, sessionId, sourceOrigin) {
  const pending = window._gwpSignPending?.[sessionId];
  const sourceWin = pending?.sourceWin;

  sourceWin?.postMessage({
    type:       'GWP_SIGN_RESPONSE',
    success:    false,
    error:      'USER_CANCELLED',
    session_id: sessionId,
  }, sourceOrigin);

  document.getElementById(confirmId)?.remove();
  delete window._gwpSignPending?.[sessionId];

  appendBubble('ai', '결제를 취소했습니다.', false);
  console.info('[GWP_SIGN] 사용자 취소 | session_id:', sessionId);
};

// ── recordPDV — 하위 시스템 공통 PDV 표준 함수 (STEP 20) ────────
// 설계 원칙 P2: 모든 하위 시스템 PDV는 Worker /pdv/report 경유 필수
// 하위 시스템(market, gdc 등)이 window.recordPDV()를 호출하면
// Worker가 수신 → Supabase pdv_log INSERT + OpenHash 앵커링 처리
//
