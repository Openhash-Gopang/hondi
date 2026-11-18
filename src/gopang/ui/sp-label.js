/**
 * ui/sp-label.js — 지금 대화 중인 SP 이름을 헤더 상단 중앙에 표시한다(2026-11-16, 주피터 지시).
 * 같은 창에서 SP가 바뀌어도(요청 파악·절차 구성·조회…) 사용자가 누구와 말하는지 알 수 있어야 한다.
 * 기본 SP(나만의 AI 비서)일 때는 비운다. 새로고침 후에도 이어지도록 localStorage 에 둔다.
 */
const KEY = 'hondi_sp_label';
export const STAGE_NAMES = { 'K-Intent': '요청 파악', 'K-Compose': '절차 구성', 'K-Execute': '실행', 'K-Deliver': '결과 정리', 'K-Report': '통지·신고 처리', 'K-Search': '조회' };
export function spLabelText(label) {
  const l = String(label || '').trim();
  if (!l) return '';
  return STAGE_NAMES[l] ? `${l} · ${STAGE_NAMES[l]}` : l;
}
export function getSPLabel() { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } }
// 2026-11-18(주피터 지시) — 모든 대화창 상단에 "지금 누구와 대화 중인지"를 항상 보여 준다.
// 사람과 대화 중이면 그 사람 이름이 우선(저장하지 않음 — 새로고침하면 사라진다), 아니면 SP 이름, 둘 다 없으면 기본 "나만의 AI 비서".
export const DEFAULT_SP_NAME = '나만의 AI 비서';
let _peerLabel = '';
export function setPeerLabel(text) { _peerLabel = String(text || '').trim(); renderSPLabel(); }
export function renderSPLabel() {
  try {
    const el = document.getElementById('ai-sp-label'); if (!el) return;
    const t = _peerLabel || spLabelText(getSPLabel()) || DEFAULT_SP_NAME;
    el.textContent = t; el.hidden = false;
    el.classList.toggle('peer', !!_peerLabel);   // 사람과 대화 중이면 다른 색으로 — 한눈에 AI 비서와 구별된다
  } catch {}
}
export function setSPLabel(label) {
  try { if (label) localStorage.setItem(KEY, String(label)); else localStorage.removeItem(KEY); } catch {}
  renderSPLabel();
}
