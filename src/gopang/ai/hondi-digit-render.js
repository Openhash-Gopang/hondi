/**
 * hondi-digit-render.js — 숫자 코드 v2 이미지 생성 (가변 자릿수 1~10, 브라우저용)
 * 레이아웃은 hondi-digit-core.js가 전부 정한다(테스트가 쓰는 것과 동일).
 *   · 'navi'(기본, 2026-10~): 왼쪽 노란 바탕 "나비" 로고 칸 + 오른쪽 숫자열(최대 10칸, 짧은 코드는 뒤쪽 칸을 비워 둠) — layoutDigitCodeV3()
 *   · 'hondi'(옛 배치): 위 "hondi.net" 로고 + 아래 왼쪽 정렬 숫자열 — layoutDigitCode(). 이미 발급·인쇄된 코드를 다시 그릴 때만 쓴다.
 * 스캐너(hondi-digit-scanner-v2.js)는 두 배치를 모두 읽는다.
 */
import { layoutDigitCode, layoutDigitCodeV3, BOX_W, LOGO, V3 } from './hondi-digit-core.js';

export const LOGO_URL = '/assets/hondi-net-logo.png';          // 옛 배치
export const NAVI_LOGO_URL = '/assets/navi-code-logo.png';     // 새 배치(노란 바탕 블록, 120×98 단위의 4배 해상도)
const _logos = {};
function loadImage(url) {
  if (_logos[url]) return _logos[url];
  _logos[url] = new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => { delete _logos[url]; rej(new Error('로고 이미지 로드 실패: ' + url)); };
    i.src = url;
  });
  return _logos[url];
}

/** @param {string} serial 1~10자리 일련번호  @param {number} scale 출력 배율(인쇄용은 3 이상 권장)  @param {'navi'|'hondi'} layout */
export async function generateDigitCodeCanvas(serial, scale = 2, layout = 'navi') {
  const navi = layout !== 'hondi';
  const lay = navi ? layoutDigitCodeV3(serial) : layoutDigitCode(serial);
  const logo = await loadImage(navi ? NAVI_LOGO_URL : LOGO_URL);
  const boxW = navi ? V3.boxW : BOX_W;
  const c = document.createElement('canvas');
  c.width = Math.round(lay.width * scale); c.height = Math.round(lay.height * scale);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.scale(scale, scale);
  if (navi) ctx.drawImage(logo, V3.block.x, V3.block.y, V3.block.w, V3.block.h);
  else ctx.drawImage(logo, 0, 0, LOGO.w, LOGO.h);
  ctx.strokeStyle = '#000'; ctx.fillStyle = '#000';
  ctx.lineWidth = Math.max(1, Math.round(boxW * 0.03));
  for (const b of lay.boxes) {
    const hw = ctx.lineWidth / 2;
    ctx.strokeRect(b.x + hw, b.y + hw, b.w - ctx.lineWidth, b.h - ctx.lineWidth);   // 테두리가 박스 바깥으로 번지지 않게
    for (const s of b.segs) ctx.fillRect(s.x, s.y, s.w, s.h);
  }
  return c;
}
export async function generateDigitCodeDataURL(serial, scale = 2, layout = 'navi') {
  return (await generateDigitCodeCanvas(serial, scale, layout)).toDataURL('image/png');
}
