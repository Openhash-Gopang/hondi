/**
 * ui/legal-review-ui.js — "법률 검토" 버튼·면책 배너 공용 UI (2026-10-17 신설)
 *
 * 화면 층의 면책: 배너(다시 보지 않기 가능). 응답 층의 면책은 SP_LEGAL_REVIEW_BASE §1이
 * 첫 응답 첫 줄에 항상 출력하므로, 배너를 닫아도 면책이 사라지지 않는다.
 * 배너 숨김은 브라우저 localStorage 한 곳에만 저장하며(저장소 접근이 막혀도 페이지는 정상 동작),
 * 서버에는 아무것도 보내지 않는다.
 */
export const LEGAL_REVIEW_BANNER_KEY = 'hondi_legal_review_banner_hidden_v1';
export const LEGAL_REVIEW_BANNER_TEXT =
  'AI 법률 검토는 인간 변호사를 대신하지 않습니다. 변호사에게 자문을 구하기 전에 쟁점과 준비사항을 정리하는 참고용이며 법적 효력이 없습니다.';

let _memHidden = false; // 저장소 접근이 막힌 환경(시크릿 창 등)에서는 이번 탭에서만 유지

export function isLegalReviewBannerHidden() {
  try { return localStorage.getItem(LEGAL_REVIEW_BANNER_KEY) === '1' || _memHidden; }
  catch (e) { return _memHidden; }
}
export function setLegalReviewBannerHidden(hidden) {
  _memHidden = !!hidden;
  try {
    if (hidden) localStorage.setItem(LEGAL_REVIEW_BANNER_KEY, '1');
    else localStorage.removeItem(LEGAL_REVIEW_BANNER_KEY);
  } catch (e) { /* 저장 불가 — 메모리 값으로만 유지 */ }
}

/** 배너를 container에 그린다. 숨김 상태이거나 reviewOn이 false면 비운다. */
export function renderLegalReviewBanner(container, reviewOn, onDismiss) {
  if (!container) return;
  if (!reviewOn || isLegalReviewBannerHidden()) { container.hidden = true; container.textContent = ''; return; }
  container.hidden = false;
  container.textContent = '';
  const span = document.createElement('span');
  span.className = 'lr-banner-text';
  span.textContent = '⚖ ' + LEGAL_REVIEW_BANNER_TEXT;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'lr-banner-close';
  btn.setAttribute('aria-label', '이 안내 다시 보지 않기');
  btn.title = '다시 보지 않기';
  btn.textContent = '다시 보지 않기 ✕';
  btn.addEventListener('click', () => {
    setLegalReviewBannerHidden(true);
    container.hidden = true; container.textContent = '';
    if (onDismiss) onDismiss();
  });
  container.append(span, btn);
}

/** 법률 검토 모드로 여는 전문가 채팅 URL. */
export function legalReviewUrl(personaId, base = '/pages/expert-chat.html') {
  return `${base}?persona=${encodeURIComponent(personaId)}&mode=review`;
}
