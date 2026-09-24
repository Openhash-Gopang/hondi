/**
 * hondi-digit-render.js — 숫자 코드 v2 이미지 생성 (가변 자릿수, 브라우저용)
 * 레이아웃은 hondi-digit-core.js의 layoutDigitCode()가 전부 정한다(테스트가 쓰는 것과 동일).
 * 로고는 /assets/hondi-net-logo.png ("hondi.net"). 숫자열은 로고 왼쪽 잉크 끝에 맞춘 왼쪽 정렬.
 */
import { layoutDigitCode, BOX_W, LOGO } from './hondi-digit-core.js';

export const LOGO_URL = '/assets/hondi-net-logo.png';
let _logo = null;
function loadLogo() {
  if (_logo) return _logo;
  _logo = new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('로고 이미지 로드 실패: ' + LOGO_URL));
    i.src = LOGO_URL;
  });
  return _logo;
}

/** @param {string} serial 1~10자리 일련번호  @param {number} scale 출력 배율(인쇄용은 3 이상 권장) */
export async function generateDigitCodeCanvas(serial, scale = 2) {
  const lay = layoutDigitCode(serial);
  const logo = await loadLogo();
  const c = document.createElement('canvas');
  c.width = Math.round(lay.width * scale); c.height = Math.round(lay.height * scale);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.scale(scale, scale);
  ctx.drawImage(logo, 0, 0, LOGO.w, LOGO.h);
  ctx.strokeStyle = '#000'; ctx.fillStyle = '#000';
  ctx.lineWidth = Math.max(1, Math.round(BOX_W * 0.03));
  for (const b of lay.boxes) {
    const hw = ctx.lineWidth / 2;
    ctx.strokeRect(b.x + hw, b.y + hw, b.w - ctx.lineWidth, b.h - ctx.lineWidth);   // 테두리가 박스 바깥으로 번지지 않게
    for (const s of b.segs) ctx.fillRect(s.x, s.y, s.w, s.h);
  }
  return c;
}
export async function generateDigitCodeDataURL(serial, scale = 2) {
  return (await generateDigitCodeCanvas(serial, scale)).toDataURL('image/png');
}
