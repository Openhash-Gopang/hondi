/**
 * hondi-code.js — 나비웹 시각 코드 인코더 / 디코더
 *
 * 9가지 색상으로 short_id를 인코딩합니다.
 *
 * 색상 팔레트 (인덱스 0~8):
 *   0 = 무색(흰색)  RGB(255,255,255)
 *   1 = 빨강        RGB(220,  0,  0)
 *   2 = 주황        RGB(255,140,  0)
 *   3 = 노랑        RGB(255,220,  0)
 *   4 = 초록        RGB(  0,180,  0)
 *   5 = 파랑        RGB(  0,  0,220)
 *   6 = 남색        RGB(  0,  0,128)
 *   7 = 보라        RGB(128,  0,128)
 *   8 = 흑색        RGB(  0,  0,  0)
 *
 * 버전:
 *   v1 — 10칸 단열  (9^10 ≈ 34억)
 *   v2 — 20칸 복열  (9^20 ≈ 1.2×10^19)
 *
 * 버전 판별:
 *   "ㄷ" 단색 흑색         → v1
 *   "ㄷ" 흑색+회색 복합색  → v2
 */

// ── 색상 팔레트 ────────────────────────────────────────────────
// v2(2026-07) 6색 체계 — R/G/B 채널 on/off 조합만 사용.
// 흑·백 계열은 글자(ㅗ·ㄴ·ㄷ)·배경·구분선과 겹쳐 전부 제외했다.
// 색상각이 서로 60도씩 균등 분리되어 있어(CMYK 6각형과 동일 원리)
// 화이트밸런스 오차에 가장 강하다 — 자세한 근거는 대화 로그 참고.
export const PALETTE = [
  { idx: 0, name: '빨강', r: 220, g:   0, b:   0 },
  { idx: 1, name: '초록', r:   0, g: 185, b:   0 },
  { idx: 2, name: '파랑', r:   0, g:   0, b: 220 },
  { idx: 3, name: '노랑', r: 220, g: 220, b:   0 },
  { idx: 4, name: '자홍', r: 220, g:   0, b: 220 },
  { idx: 5, name: '시안', r:   0, g: 185, b: 185 },
];

// ── 캘리브레이션 기준색 ────────────────────────────────────────
// v7.0: 별도 앵커·캘리브레이션 패치를 두지 않는다. 로고 "나비웹" 글자
// 안에 이미 고정색으로 박혀 있는 빨강·파랑 사각형과 검정 획, 그리고
// 배경 흰색 — 이 네 가지를 그대로 캘리브레이션 기준점으로 재사용한다.
// 이 좌표들은 BASE_IMG_URL 래스터(551×335) 안에서 실측한 고정 위치다. 파란 "ㅎ"(원형 스트로크 좌측 두꺼운 부분)과 빨간 원(점) 내부, ㄷ의 세로획을 각각 파랑/빨강/검정 기준으로 삼는다.
export const CALIB_REF = {
  red:   { r: 255, g:   0, b:   0 },
  blue:  { r:   0, g:   0, b: 255 },
  black: { r:   0, g:   0, b:   0 },
  white: { r: 255, g: 255, b: 255 },
};

// 베이스 이미지(551×335) 안에서 각 기준색을 안전하게 샘플할 수 있는
// 고정 ROI. 가장자리 안티에일리어싱을 피해 안쪽으로 여유를 뒀다.
export const CALIB_RED_ROI   = { x: 108, y: 192, w: 24, h: 20 };
export const CALIB_BLUE_ROI  = { x:  76, y: 110, w: 16, h: 30 };
export const CALIB_BLACK_ROI = { x: 298, y:  70, w: 14, h: 75 };
export const CALIB_WHITE_ROI = { x: 210, y:  90, w: 20, h: 20 };

// ── 색상 보정 (캘리브레이션 적용) ────────────────────────────
// measured: { red, blue, black, white } — 위 ROI들에서 실측한 RGB
export function buildCalibMatrix(measured) {
  return {
    rScale: CALIB_REF.red.r     / Math.max(1, measured.red.r),
    bScale: CALIB_REF.blue.b    / Math.max(1, measured.blue.b),
    gScale: CALIB_REF.white.g   / Math.max(1, measured.white.g),
    darkOffset: (measured.black.r + measured.black.g + measured.black.b) / 3,
  };
}

export function applyCalib(pixel, matrix) {
  const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
  return {
    r: clamp((pixel.r - matrix.darkOffset) * matrix.rScale),
    g: clamp((pixel.g - matrix.darkOffset) * matrix.gScale),
    b: clamp((pixel.b - matrix.darkOffset) * matrix.bScale),
  };
}

// ── 버전 판별 ─────────────────────────────────────────────────
// ㄷ 영역에서 샘플링한 색상 배열로 v1/v2 판별
// v1: 모든 샘플이 거의 흑색 (단색)
// v2: 흑색과 회색이 섞임 (복합색)
export function detectVersion(dSamples) {
  // dSamples: [{r,g,b}, ...] — ㄷ 영역 샘플 픽셀들
  const GRAY_THRESHOLD = 80;   // 이 밝기 이상이면 "회색"으로 판단
  const GRAY_RATIO = 0.15;     // 15% 이상이 회색이면 v2

  const grayCount = dSamples.filter(p => {
    const brightness = (p.r + p.g + p.b) / 3;
    // 채도가 낮고(회색계열) 밝기가 중간인 픽셀
    const maxC = Math.max(p.r, p.g, p.b);
    const minC = Math.min(p.r, p.g, p.b);
    const saturation = maxC === 0 ? 0 : (maxC - minC) / maxC;
    return saturation < 0.2 && brightness > GRAY_THRESHOLD && brightness < 200;
  }).length;

  const ratio = grayCount / dSamples.length;
  return ratio >= GRAY_RATIO ? 'v2' : 'v1';
}

// ── 색상 → 팔레트 인덱스 ─────────────────────────────────────
// 보정된 픽셀과 팔레트 9색 중 유클리드 거리 최소 항목 선택
export function rgbToIndex(pixel) {
  let minDist = Infinity, best = 0;
  for (const c of PALETTE) {
    const dr = pixel.r - c.r;
    const dg = pixel.g - c.g;
    const db = pixel.b - c.b;
    const dist = dr*dr + dg*dg + db*db;
    if (dist < minDist) { minDist = dist; best = c.idx; }
  }
  return best;
}

// ── 인덱스 배열 → short_id (BigInt) ──────────────────────────
// indices: [0~8, ...] 길이 10(v1) 또는 20(v2)
export function indicesToId(indices) {
  let id = 0n;
  for (const idx of indices) {
    id = id * 6n + BigInt(idx);
  }
  return id;
}

// ── short_id (BigInt) → 인덱스 배열 ──────────────────────────
export function idToIndices(id, version = 'v1') {
  // v1(기관/사업체) = 6칸, v2(개인/부서/직책) = 10칸 — 둘 다 단열.
  const len = version === 'v2' ? 10 : 6;
  const result = new Array(len).fill(0);
  let n = BigInt(id);
  for (let i = len - 1; i >= 0; i--) {
    result[i] = Number(n % 6n);
    n = n / 6n;
  }
  return result;
}

// ── 인덱스 → RGB ──────────────────────────────────────────────
export function indexToRgb(idx) {
  const c = PALETTE[idx];
  return { r: c.r, g: c.g, b: c.b };
}

// ── 정보량 상수 ───────────────────────────────────────────────
export const MAX_V1 = 6n ** 6n;    // 46,656 (기관/사업체 — 6칸)
export const MAX_V2 = 6n ** 10n;   // 60,466,176 (개인/부서/직책 — 10칸)

// ── 유틸: short_id ↔ 표시용 문자열 ──────────────────────────
// 9진법 문자열로 표현 (디버그·인쇄용)
export function idToBase6String(id, version = 'v1') {
  const indices = idToIndices(id, version);
  return indices.join('');
}

export function base6StringToId(str) {
  let id = 0n;
  for (const ch of str) {
    id = id * 6n + BigInt(parseInt(ch, 10));
  }
  return id;
}

// ── GUID → short_id (가입 시점 색상 코드 생성용) ──────────────
// guid: "2601:db80:xxxx:xxxx:..." 형태의 IPv6 문자열(콜론 포함).
// 결정적(deterministic) 변환 — 같은 guid는 항상 같은 short_id를 만들어내므로
// 서버에 별도 저장 없이도 클라이언트가 언제든 동일한 코드를 재생성할 수 있다.
export function guidToShortId(guid, version = 'v1') {
  const hex = guid.replace(/:/g, '');
  const big = BigInt('0x' + hex);
  const max = version === 'v2' ? MAX_V2 : MAX_V1;
  return big % max;
}

// ── 캔버스 기반 "나비웹" 코드 이미지 생성기 ─────────────────────
// v7.0: 별도 앵커·캘리브레이션 패치를 없앴다. "혼ㄷ" 부분은 공용
// 베이스 이미지(파란 "ㅎ" + 빨간 원 + 검정 ㄴㄷㅣ, 551×335, 투명배경)를 그대로
// 불러와 고정 위치에 그린다 — 이 이미지 안에 이미 고정색 빨강·파랑
// 사각형과 검정 획이 박혀 있고, 이것들을 그대로 캘리브레이션 기준점으로
// 쓴다(CALIB_RED_ROI/CALIB_BLUE_ROI/CALIB_BLACK_ROI/CALIB_WHITE_ROI).
// 실제 데이터(색상 코드)는 로고 바로 아래 정사각형 셀 그리드로 그린다 —
// v1(6칸)은 1행 6열, v2(10칸)은 2행 5열로 배치해 항상 로고 가까이,
// 카메라 프레임 안에 들어오기 쉬운 위치에 둔다.
//
export const BASE_IMG_URL = 'data:image/png;base64,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';
export const BASE_IMG_W = 551, BASE_IMG_H = 335;

// ── 데이터 코드 그리드 ─────────────────────────────────────────
export const CODE_CELL = 90;   // 셀 한 칸의 가로·세로 크기(px)
export const CODE_GAP  = 10;   // 그리드-베이스이미지 사이, 행간 여백(px)
export const CODE_MAX_COLS = 6; // 한 행에 들어가는 최대 칸 수

// indices.length(6 또는 10)에 대해 (cols, rows) 그리드를 계산한다.
// 필요한 최소 행 수부터 구하고, 그 행 수로 나눈 몫을 열 수로 삼아
// "빈 칸 없이" 정확히 n칸을 채우는 직사각형을 만든다.
// (6 → 1행×6열, 10 → 2행×5열. min(n,MAX_COLS)로 열을 먼저 고정하면
// 10칸이 6열×2행=12칸으로 계산돼 빈 칸 2개가 남는 버그가 있었다.)
function _gridShape(n) {
  const rows = Math.ceil(n / CODE_MAX_COLS);
  const cols = Math.ceil(n / rows);
  return { cols, rows };
}

let _baseImgPromise = null;
function _loadBaseImage() {
  if (_baseImgPromise) return _baseImgPromise;
  _baseImgPromise = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error('혼ㄷ 베이스 이미지 로드 실패: ' + BASE_IMG_URL));
    img.src = BASE_IMG_URL;
  });
  return _baseImgPromise;
}

// ── 코너 브래킷(그리드 위치 탐지용) ───────────────────────────
// 팔레트에 검정이 없으므로(6색: 빨강·초록·파랑·노랑·자홍·시안) 검정은
// 데이터와 충돌하지 않는 유일한 "위치 표시 전용" 색이다. 그리드 네
// 모서리에 작은 L자 브래킷을 그려두면, 채도 기반 행 투영이 잡음 때문에
// 실패했을 때(예: 코드와 같은 높이에 다른 색색 물체가 겹칠 때) 스캐너가
// 이 브래킷 4개의 기하학적 배치만으로 그리드 위치를 직접 찾을 수 있다.
export const BRACKET_LEN    = 22;  // L자 한 획의 길이(px)
export const BRACKET_W      = 5;   // L자 획 두께(px)
export const BRACKET_MARGIN = 8;   // 브래킷 코너점과 그리드 가장자리 사이 간격(px)

function _drawBracket(ctx, cornerX, cornerY, towardGridX, towardGridY) {
  // towardGridX/Y: +1이면 그리드가 오른쪽/아래, -1이면 왼쪽/위에 있다는 뜻.
  // L자는 항상 그리드 쪽을 향해 열린 모양으로 그린다.
  ctx.fillStyle = '#000000';
  const hx = towardGridX > 0 ? cornerX : cornerX - BRACKET_LEN;
  ctx.fillRect(hx, cornerY - BRACKET_W/2, BRACKET_LEN, BRACKET_W);
  const vy = towardGridY > 0 ? cornerY : cornerY - BRACKET_LEN;
  ctx.fillRect(cornerX - BRACKET_W/2, vy, BRACKET_W, BRACKET_LEN);
}

export async function generateHondiCodeCanvas(shortId, version = 'v1') {
  const baseImg = await _loadBaseImage();

  const indices = idToIndices(BigInt(shortId), version);
  const { cols, rows } = _gridShape(indices.length);

  const gridW = cols * CODE_CELL;
  const gridH = rows * CODE_CELL + (rows - 1) * CODE_GAP;
  // 가로 중앙 정렬하되, 브래킷이 캔버스 밖으로 나가지 않도록 최소 여백을
  // 보장한다(v1의 6칸 그리드 540px는 로고 폭 551px과 거의 같아서 단순
  // 중앙정렬만 하면 여백이 브래킷 마진보다 작아질 수 있다).
  const gridStartX = Math.max(BRACKET_MARGIN + 2, Math.round((BASE_IMG_W - gridW) / 2));
  const gridStartY = BASE_IMG_H + CODE_GAP * 2;

  const CANVAS_W = Math.max(BASE_IMG_W, gridW + gridStartX + BRACKET_MARGIN + 15);
  const CANVAS_H = gridStartY + gridH + BRACKET_MARGIN + 15;

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W; canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');

  // 배경 흰색 + "혼ㄷ" 베이스 이미지를 (0,0)에 고정 배치
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.drawImage(baseImg, 0, 0, BASE_IMG_W, BASE_IMG_H);

  // 데이터 코드 그리드 — 칸 순서는 idToIndices와 동일: 배열 첫 원소가
  // 맨 위-왼쪽 칸부터 좌→우, 위→아래 순으로 채워진다.
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';  // 흰색 경계선 — 셀 색상 충돌 방지
  ctx.lineWidth = 1.5;
  indices.forEach((idx, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const c = PALETTE[idx];
    const x = gridStartX + col * CODE_CELL;
    const y = gridStartY + row * (CODE_CELL + CODE_GAP);
    ctx.fillStyle = `rgb(${c.r},${c.g},${c.b})`;
    ctx.fillRect(x, y, CODE_CELL, CODE_CELL);
    ctx.strokeRect(x, y, CODE_CELL, CODE_CELL);
  });

  // 네 모서리 브래킷 — 그리드 바깥쪽으로 BRACKET_MARGIN만큼 띄워서 그린다
  // (셀 색상과 안티에일리어싱으로 섞이지 않게 여백을 둔다).
  const gx1 = gridStartX - BRACKET_MARGIN, gy1 = gridStartY - BRACKET_MARGIN;
  const gx2 = gridStartX + gridW + BRACKET_MARGIN, gy2 = gridStartY + gridH + BRACKET_MARGIN;
  _drawBracket(ctx, gx1, gy1, +1, +1);  // 좌상단
  _drawBracket(ctx, gx2, gy1, -1, +1);  // 우상단
  _drawBracket(ctx, gx1, gy2, +1, -1);  // 좌하단
  _drawBracket(ctx, gx2, gy2, -1, -1);  // 우하단

  return canvas;
}

// 가입·설정 화면에서 바로 쓰는 편의 함수 — data URL(PNG) 반환 (비동기!)
export async function generateHondiCodeDataURL(shortId, version = 'v1') {
  const canvas = await generateHondiCodeCanvas(shortId, version);
  return canvas.toDataURL('image/png');
}
