/**
 * assets/hondi-skin.js — 나비 스킨(강조색) 공유 팔레트
 *
 * 이전에는 left-menu.html / right-menu.html이 같은 SKIN_COLORS 객체를
 * 각자 파일 안에 복사해 두고 있었다(문서가 분리된 iframe이라 변수를
 * 직접 공유할 수 없기 때문). 이 파일을 "정의가 있는 단 하나의 곳"으로
 * 두고, 각 문서는 이 파일을 import해서 자기 :root 변수에 적용만 한다.
 *
 * 값을 저장/전달하는 통로는 기존과 동일하게 localStorage + 'storage'
 * 이벤트를 사용한다 — 서로 다른 문서(iframe) 간에는 이 방법이 사실상
 * 유일한 실시간 전달 수단이기 때문 (BroadcastChannel도 대안이지만
 * 기존 코드와의 호환을 위해 그대로 유지).
 */

export const SKIN_COLOR_KEY = 'hondi_menu_color';

export const SKIN_COLORS = {
  blue:   { label: '블루',     accent: '#2563eb', lt: '#dbeafe', dk: '#1d4ed8', bd: '#93c5fd' },
  teal:   { label: '틸',       accent: '#0d9488', lt: '#ccfbf1', dk: '#0f766e', bd: '#5eead4' },
  amber:  { label: '앰버',     accent: '#d97706', lt: '#fef3c7', dk: '#b45309', bd: '#fcd34d' },
  violet: { label: '바이올렛', accent: '#7c3aed', lt: '#ede9fe', dk: '#6d28d9', bd: '#c4b5fd' },
  slate:  { label: '슬레이트', accent: '#475569', lt: '#f1f5f9', dk: '#334155', bd: '#cbd5e1' },
  green:  { label: '초록색',   accent: '#16a34a', lt: '#dcfce7', dk: '#15803d', bd: '#86efac' },
  lime:   { label: '연두색',   accent: '#65a30d', lt: '#ecfccb', dk: '#4d7c0f', bd: '#bef264' },
};

/**
 * 현재 저장된 스킨을 varMap에 정의된 CSS 변수에 적용한다.
 * varMap 예: { '--green-lt': 'lt', '--green-dk': 'dk' }
 * (문서마다 실제 변수 이름이 달라서, 적용할 변수 이름은 호출하는
 *  쪽에서 지정한다 — 이 파일은 팔레트 값만 갖고 있다.)
 */
export function applyHondiSkin(varMap) {
  const key = localStorage.getItem(SKIN_COLOR_KEY);
  const c = SKIN_COLORS[key];
  if (!c) return; // 선택 안 함 = 각 문서의 기본(클래식) 색 그대로 둠
  const root = document.documentElement.style;
  for (const [cssVar, field] of Object.entries(varMap)) {
    if (c[field] != null) root.setProperty(cssVar, c[field]);
  }
}

/** 최초 적용 + 다른 문서(iframe)에서 바뀔 때 실시간 반영 */
export function watchHondiSkin(varMap) {
  applyHondiSkin(varMap);
  window.addEventListener('storage', (e) => {
    if (e.key === SKIN_COLOR_KEY) applyHondiSkin(varMap);
  });
}

/** 설정 패널에서 스킨을 고를 때 호출 (기존 applySkinColor와 동일한 역할) */
export function setHondiSkin(key) {
  if (!SKIN_COLORS[key]) return;
  localStorage.setItem(SKIN_COLOR_KEY, key);
  document.querySelectorAll('.skin-swatch').forEach(el => {
    el.classList.toggle('is-selected', el.dataset.skin === key);
  });
}
