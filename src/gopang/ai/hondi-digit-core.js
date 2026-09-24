/**
 * hondi-digit-core.js — 혼디 숫자 코드 v2 (가변 자릿수) 순수 로직
 *
 * DOM/캔버스에 의존하지 않는다 → 브라우저(hondi-digit-scanner.js)와
 * Node(테스트)가 똑같은 코드를 쓴다.
 *
 * [코드 규격 v2]
 *   · 일련번호(문자열) 1~10자리, 첫 자리는 1~9 (앞에 0 없음)
 *   · 위: "hondi.net" 로고 (숫자 코드임을 알리는 표식 + 스케일 기준)
 *   · 아래: 로고 왼쪽 잉크 끝에 맞춘 왼쪽 정렬 숫자열, 한 칸 = 검정 테두리 박스 + 7세그먼트
 *   · 칸 피치 = 로고 잉크 폭 / 10  (10자리가 로고 폭과 딱 맞는다)
 *
 * [스캐너가 자릿수를 세는 방법]
 *   1) 세로 투영으로 "로고 덩어리(위)"와 "숫자열 덩어리(맨 아래)"를 찾는다.
 *   2) 숫자열의 가로 투영에서 박스(검정 테두리)마다 하나씩 덩어리가 생긴다.
 *      → 덩어리 개수 = 자릿수. (박스 테두리가 있어서 "1"처럼 획이 적은 숫자도 끊기지 않는다)
 *   3) 교차 검증: 박스 폭/피치(로고폭/10) 비율, 박스 가로세로비, 칸 간격 균일성,
 *      숫자열 왼쪽 끝이 로고 왼쪽 끝과 정렬되는지(잘린 프레임 방어).
 *      하나라도 어긋나면 그 프레임은 버린다 — 다른 번호로 잘못 읽는 것보다 낫다.
 */

// ── 7세그먼트 (기존 hondi-digit-code.js와 동일 정의) ─────────────
export const SEGMENT_PATTERNS = {
  0:'abcdef', 1:'bc', 2:'abged', 3:'abgcd', 4:'fgbc',
  5:'afgcd', 6:'afgecd', 7:'abc', 8:'abcdefg', 9:'abcdfg',
};
export const SEG_ORDER = ['a','b','c','d','e','f','g'];
export const SEG_BOXES = {
  a: { x1:0.20, x2:0.80, y1:0.00, y2:0.10 },
  g: { x1:0.20, x2:0.80, y1:0.45, y2:0.55 },
  d: { x1:0.20, x2:0.80, y1:0.90, y2:1.00 },
  f: { x1:0.00, x2:0.22, y1:0.08, y2:0.44 },
  b: { x1:0.78, x2:1.00, y1:0.08, y2:0.44 },
  e: { x1:0.00, x2:0.22, y1:0.56, y2:0.92 },
  c: { x1:0.78, x2:1.00, y1:0.56, y2:0.92 },
};
const DIGIT_BITS = {};
for (const [d, segs] of Object.entries(SEGMENT_PATTERNS)) {
  DIGIT_BITS[d] = SEG_ORDER.map(s => segs.includes(s) ? 1 : 0);
}

// ── 번호 규칙 ────────────────────────────────────────────────
export const MIN_DIGITS = 1;
export const MAX_DIGITS = 10;   // 세계 인구 80억 < 10^10
export const SERIAL_RE  = /^[1-9][0-9]{0,9}$/;

export function isValidSerial(s) { return SERIAL_RE.test(String(s)); }
export function normalizeSerial(s) {
  const t = String(s).trim();
  if (!isValidSerial(t)) {
    throw new Error(`혼디 숫자 코드는 1~${MAX_DIGITS}자리, 첫 자리는 1~9여야 합니다: "${t}"`);
  }
  return t;
}
export function serialToDigits(s) { return normalizeSerial(s).split('').map(Number); }

// 박스 테두리 안쪽(세그먼트 영역). 인코더는 이 영역 안에 세그먼트를 그리고, 스캐너는 이 영역만 읽는다.
export const INNER = { x1: 0.058, x2: 0.942, y1: 0.071, y2: 0.929 };

// ── 레이아웃 (인코더가 그릴 때와 테스트가 렌더링할 때 공통) ───────
// 로고 이미지(assets/hondi-net-logo.png, 517×90)의 실측 잉크 범위
export const LOGO = { w: 517, h: 90, inkX1: 51, inkX2: 469, inkY1: 19, inkY2: 73 };
export const LOGO_INK_W = LOGO.inkX2 - LOGO.inkX1;      // 418
export const PITCH      = LOGO_INK_W / MAX_DIGITS;      // 41.8 — 칸 피치
export const GAP_RATIO  = 0.14;                         // 피치 대비 박스 사이 간격
export const BOX_W      = PITCH * (1 - GAP_RATIO);
export const BOX_ASPECT = 1.7;                          // 박스 세로/가로
export const BOX_H      = BOX_W * BOX_ASPECT;
export const LOGO_TO_ROW_GAP = 34;                      // 로고 잉크 아래~숫자열 위

/** 번호 → 사각형 목록(로고 이미지 좌표계 기준, 로고 왼쪽 위 = 0,0). */
export function layoutDigitCode(serial) {
  const digits = serialToDigits(serial);
  const top = LOGO.inkY2 + LOGO_TO_ROW_GAP;
  const boxes = digits.map((d, i) => {
    const bx = LOGO.inkX1 + i * PITCH;   // 첫 박스의 왼쪽 끝 = 로고 왼쪽 잉크 끝
    const ix = bx + INNER.x1 * BOX_W, iy = top + INNER.y1 * BOX_H;
    const iw = (INNER.x2 - INNER.x1) * BOX_W, ih = (INNER.y2 - INNER.y1) * BOX_H;
    const segs = [];
    for (const s of SEGMENT_PATTERNS[d]) {          // 세그먼트는 테두리 안쪽 영역 기준
      const b = SEG_BOXES[s];
      segs.push({ x: ix + b.x1 * iw, y: iy + b.y1 * ih, w: (b.x2 - b.x1) * iw, h: (b.y2 - b.y1) * ih });
    }
    return { digit: d, x: bx, y: top, w: BOX_W, h: BOX_H, segs };
  });
  return { digits, boxes, logo: LOGO,
           width: LOGO.w, height: Math.ceil(top + BOX_H + 16) };
}

// ── 이진화 ───────────────────────────────────────────────────
export function otsuThreshold(gray, lo = 0, hi = 255) {
  const hist = new Array(256).fill(0);
  let total = 0;
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i];
    if (v >= lo && v <= hi) { hist[v]++; total++; }
  }
  if (!total) return 127;
  let sum = 0;
  for (let t = lo; t <= hi; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, varMax = -1, threshold = (lo + hi) >> 1;
  for (let t = lo; t <= hi; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > varMax) { varMax = between; threshold = t; }
  }
  return threshold;
}

// ── 1차원 투영 덩어리 탐지 ────────────────────────────────────
function runs(profile, minDark, minLen) {
  const out = [];
  let i = 0;
  while (i < profile.length) {
    if (profile[i] >= minDark) {
      let j = i;
      while (j < profile.length && profile[j] >= minDark) j++;
      if (j - i >= minLen) out.push({ p1: i, p2: j });
      i = j;
    } else i++;
  }
  return out;
}

function rowProfile(gray, w, h, thr, x1 = 0, x2 = w) {
  const p = new Uint32Array(h);
  for (let y = 0; y < h; y++) {
    let c = 0; const row = y * w;
    for (let x = x1; x < x2; x++) if (gray[row + x] <= thr) c++;
    p[y] = c;
  }
  return p;
}
function colProfile(gray, w, h, thr, y1, y2) {
  const p = new Uint32Array(w);
  for (let y = y1; y < y2; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) if (gray[row + x] <= thr) p[x]++;
  }
  return p;
}
function inkExtentX(gray, w, thr, y1, y2) {
  let min = Infinity, max = -1;
  for (let y = y1; y < y2; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) if (gray[row + x] <= thr) { if (x < min) min = x; if (x > max) max = x; }
  }
  return max < 0 ? null : { min, max: max + 1 };
}


// ── 한 칸 읽기 (박스 바운딩박스 → 100×100 영역평균 리샘플 → 7세그먼트) ──
// 세그먼트 판정: 깨끗한 코드에서 켜진 획은 영역의 ~100%, 꺼진 획은 ~0%.
//   ON  = 60% 이상 / OFF = 20% 이하 / 그 사이 = 애매(부분 가림·흐림) → 그 칸을 신뢰하지 않는다.
// [이유] 획 하나가 반쯤 가려지면 다른 유효한 숫자(8→0, 9→3 …)로 읽혀 남의 번호가 열릴 수 있다.
const SEG_MID = 0.40, SEG_ON_MIN = 0.60, SEG_OFF_MAX = 0.20;
// 어느 숫자에서도 항상 비어 있어야 하는 안쪽 두 구역(가운데 세로줄 위/아래)
const HOLLOWS = [
  { x1: 0.28, x2: 0.72, y1: 0.14, y2: 0.40 },
  { x1: 0.28, x2: 0.72, y1: 0.60, y2: 0.86 },
];
const HOLLOW_MAX = 0.12;
const MIN_CERTAINTY = 0;   // 켜짐≥60% / 꺼짐≤20% 밖(애매)이면 음수 → 거절

function resample(gray, W, H, box, N = 100) {
  const out = new Uint8Array(N * N);
  const bw = box.x2 - box.x1, bh = box.y2 - box.y1;
  for (let j = 0; j < N; j++) {
    const ya = box.y1 + bh * j / N, yb = box.y1 + bh * (j + 1) / N;
    const y0 = Math.max(0, Math.floor(ya)), y1 = Math.min(H, Math.max(y0 + 1, Math.ceil(yb)));
    for (let i = 0; i < N; i++) {
      const xa = box.x1 + bw * i / N, xb = box.x1 + bw * (i + 1) / N;
      const x0 = Math.max(0, Math.floor(xa)), x1 = Math.min(W, Math.max(x0 + 1, Math.ceil(xb)));
      let s = 0, c = 0;
      for (let y = y0; y < y1; y++) { const r = y * W; for (let x = x0; x < x1; x++) { s += gray[r + x]; c++; } }
      out[j * N + i] = c ? Math.round(s / c) : 255;
    }
  }
  return out;
}

function regionDark(g, thr, r) {
  const x1 = Math.round(r.x1 * 100), x2 = Math.round(r.x2 * 100), y1 = Math.round(r.y1 * 100), y2 = Math.round(r.y2 * 100);
  let dark = 0, n = 0;
  for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) { n++; if (g[y * 100 + x] <= thr) dark++; }
  return n ? dark / n : 0;
}

export function readCell(gray, W, H, blob) {
  const bw = blob.x2 - blob.x1, bh = blob.y2 - blob.y1;
  const inner = {
    x1: blob.x1 + INNER.x1 * bw, x2: blob.x1 + INNER.x2 * bw,
    y1: blob.y1 + INNER.y1 * bh, y2: blob.y1 + INNER.y2 * bh,
  };
  const g = resample(gray, W, H, inner, 100);
  const thr = otsuThreshold(g);
  const bits = [], ratios = [];
  let certainty = Infinity;
  for (const s of SEG_ORDER) {
    const ratio = regionDark(g, thr, SEG_BOXES[s]);
    ratios.push(ratio);
    const on = ratio >= SEG_MID;
    bits.push(on ? 1 : 0);
    certainty = Math.min(certainty, on ? ratio - SEG_ON_MIN : SEG_OFF_MAX - ratio);   // 음수 = 애매
  }
  const stray = Math.max(...HOLLOWS.map(h => regionDark(g, thr, h)));
  const scores = Object.entries(DIGIT_BITS).map(([d, p]) => {
    let diff = 0; for (let i = 0; i < 7; i++) if (bits[i] !== p[i]) diff++;
    return { digit: d, diff };
  }).sort((a, b) => a.diff - b.diff);
  // solid: 켜진 획은 꽉 차 있고(≥60%) 꺼진 획은 깨끗하며(≤20%) 안쪽 구멍에 잉크가 없다
  const solid = certainty >= MIN_CERTAINTY && stray <= HOLLOW_MAX;
  return { digit: scores[0].digit, margin: scores[1].diff - scores[0].diff, bestDiff: scores[0].diff, bits, ratios, certainty, stray, solid };
}

// ── 메인 분석 ────────────────────────────────────────────────
// [중요] 기존 hondi-digit-scanner.js의 MIN_AVG_MARGIN=3은 달성 불가능한 값이다:
//   7세그먼트에서 0·1·3·5·6·7·8·9는 다른 숫자와 획 1개만 달라 (2위-1위 차이)가 1이라
//   평균 마진의 이론상 최댓값이 2.0(2·4만으로 된 번호)이다. → 실시간 스캔이 절대 확정되지 않는다.
// 그래서 마진 대신 "모든 칸이 표준 패턴과 정확히 일치 + 켜진 획은 꽉 차고 꺼진 자리는 깨끗함"을 쓴다(readCell).

function median(a) { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2; }
function percentile(arr, q) {
  const s = Array.from(arr).sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
}
function mergeRuns(rs, gap) {           // 간격이 gap 이하인 인접 구간을 합친다(안티에일리어싱·가는 획으로 인한 끊김 봉합)
  const out = [];
  for (const r of rs) {
    const last = out[out.length - 1];
    if (last && r.p1 - last.p2 <= gap) last.p2 = r.p2; else out.push({ ...r });
  }
  return out;
}
function sampleLevel(gray, q) {          // 밝기 분위수(종이 밝기 추정) — 7픽셀 간격 표본
  const s = []; for (let i = 0; i < gray.length; i += 7) s.push(gray[i]);
  return percentile(s, q);
}

// 기하 왜곡(회전·원근)이 원인일 수 있는 실패 사유 — 이때만 비싼 보정을 시도한다
const GEOM_REASONS = new Set(['box-aspect', 'no-boxes', 'box-width-inconsistent', 'pitch-inconsistent',
  'no-logo', 'not-left-aligned', 'boxes-merged', 'too-wide', 'logo-scale-mismatch', 'row-clipped', 'no-ink',
  'bad-pattern', 'low-certainty', 'trailing-ink', 'logo-mismatch']);

/**
 * @param {Uint8Array|Uint8ClampedArray} gray  W*H 회색조
 * @param {{requireLogo?:boolean, transformHint?:object}} opts
 * @returns {{ok:true, serial:string, n:number, certainty:number, cells:object[], row:object, transform?:object, crop?:object}
 *          |{ok:false, reason:string}}
 */
export function analyzeGray(gray, W, H, opts = {}) {
  const requireLogo = opts.requireLogo !== false;

  // 이전 프레임에서 찾은 보정값이 있으면 먼저 그것으로(실시간 추적) — 실패하면 처음부터
  if (opts.transformHint) {
    const w = warpGray(gray, W, H, opts.transformHint);
    const r = _tryBase(w, W, H, requireLogo);
    if (r.ok) return { ...r, transform: opts.transformHint };
  }
  const r0 = _tryBase(gray, W, H, requireLogo);
  if (r0.ok || !GEOM_REASONS.has(r0.reason) || opts.noRescue) return r0;

  // 회전/원근 보정 후보를 점수 순으로 시도
  // 추정은 국소 배경 보정을 거친 영상에서 한다 — 어두운 벽/그림자가 잉크 점으로 섞이면 각도 추정이 무너진다
  const src = flatField(gray, W, H);
  const cands = estimateTransforms(src, W, H);
  for (const tf of cands) {
    const r = _tryBase(warpGray(src, W, H, tf), W, H, requireLogo);
    if (r.ok) return { ...r, transform: tf };
  }
  return r0;
}

// 여러 이진화 전략: ① 전체 Otsu ② 종이만 잘라 Otsu(밝은 종이가 어두운 벽 위에 있을 때) ③ 어두운 쪽만 다시 Otsu
function _tryBase(gray, W, H, requireLogo) {
  const t1 = otsuThreshold(gray);
  const first = _analyzeAt(gray, W, H, t1, requireLogo);
  if (first.ok) return { ...first, threshold: t1 };

  // ② 국소 배경 보정 후 Otsu — 어두운 벽/그림자 위의 종이에 가장 강하다
  const ff = flatField(gray, W, H);
  const tf = otsuThreshold(ff);
  const rf = _analyzeAt(ff, W, H, tf, requireLogo);
  if (rf.ok) return { ...rf, threshold: tf, flat: true };

  const pb = paperBox(gray, W, H, t1);
  if (pb) {
    const cw = pb.x2 - pb.x1, ch = pb.y2 - pb.y1, crop = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) crop.set(gray.subarray((pb.y1 + y) * W + pb.x1, (pb.y1 + y) * W + pb.x2), y * cw);
    const r = _analyzeAt(crop, cw, ch, otsuThreshold(crop), requireLogo);
    if (r.ok) {
      const bx = r.row.boxes.map(b => ({ x1: b.x1 + pb.x1, x2: b.x2 + pb.x1, y1: b.y1 + pb.y1, y2: b.y2 + pb.y1 }));
      const lr = r.row.logoRow ? { p1: r.row.logoRow.p1 + pb.y1, p2: r.row.logoRow.p2 + pb.y1 } : null;
      const li = r.row.logoInk ? { min: r.row.logoInk.min + pb.x1, max: r.row.logoInk.max + pb.x1 } : null;
      return { ...r, crop: pb, row: { ...r.row, boxes: bx, logoRow: lr, logoInk: li } };
    }
  }
  const t2 = otsuThreshold(gray, 0, t1);
  if (t2 < t1 - 8) { const r = _analyzeAt(gray, W, H, t2, requireLogo); if (r.ok) return { ...r, threshold: t2 }; }
  return first;
}

// 국소 배경 보정: 각 픽셀을 "주변에서 가장 밝은 값(종이/벽)"으로 나눠 정규화한다.
// 어두운 벽·그림자·조명 얼룩 위의 종이도 "배경=흰색, 잉크=검정" 두 값으로 정리된다.
export function flatField(gray, W, H) {
  const B = 4, gw = Math.ceil(W / B), gh = Math.ceil(H / B);
  const blk = new Float32Array(gw * gh);
  for (let by = 0; by < gh; by++) for (let bx = 0; bx < gw; bx++) {
    let sum = 0, n = 0;
    for (let y = by * B; y < Math.min(H, by * B + B); y++) { const r = y * W; for (let x = bx * B; x < Math.min(W, bx * B + B); x++) { sum += gray[r + x]; n++; } }
    blk[by * gw + bx] = sum / n;
  }
  const R = Math.max(5, Math.round(W * 0.02 / B) * 2 + 4);              // 가장 굵은 획보다 넓은 반경(블록 단위)
  const tmp = new Float32Array(gw * gh), bg = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {          // 가로 최대값 필터
    let m = 0; for (let k = Math.max(0, x - R); k <= Math.min(gw - 1, x + R); k++) { const v = blk[y * gw + k]; if (v > m) m = v; }
    tmp[y * gw + x] = m;
  }
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {          // 세로 최대값 필터
    let m = 0; for (let k = Math.max(0, y - R); k <= Math.min(gh - 1, y + R); k++) { const v = tmp[k * gw + x]; if (v > m) m = v; }
    bg[y * gw + x] = m;
  }
  // 닫힘(closing) = 최대값 필터 뒤 최소값 필터: 가는 획은 메우고, 넓은 어두운 영역(벽)은 그대로 둔다.
  // (최대값 필터만 쓰면 종이 가장자리 주변의 벽이 "종이 밝기 기준"으로 눌려 어두운 테두리 띠가 생긴다)
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    let m = 255; for (let k = Math.max(0, x - R); k <= Math.min(gw - 1, x + R); k++) { const v = bg[y * gw + k]; if (v < m) m = v; }
    tmp[y * gw + x] = m;
  }
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    let m = 255; for (let k = Math.max(0, y - R); k <= Math.min(gh - 1, y + R); k++) { const v = tmp[k * gw + x]; if (v < m) m = v; }
    bg[y * gw + x] = m;
  }
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const gy = Math.min(gh - 1, (y / B) | 0);
    for (let x = 0; x < W; x++) {
      const b = Math.max(40, bg[gy * gw + Math.min(gw - 1, (x / B) | 0)]);
      const v = gray[y * W + x] * 255 / b;
      out[y * W + x] = v > 255 ? 255 : v;
    }
  }
  return out;
}

function paperBox(gray, W, H, t1) {
  const rowB = new Uint32Array(H), colB = new Uint32Array(W);
  for (let y = 0; y < H; y++) { const r = y * W; for (let x = 0; x < W; x++) if (gray[r + x] > t1) { rowB[y]++; colB[x]++; } }
  const mr = Math.max(...rowB), mc = Math.max(...colB);
  if (!mr || !mc) return null;
  let y1 = 0, y2 = H, x1 = 0, x2 = W;
  while (y1 < H && rowB[y1] < mr * 0.25) y1++;
  while (y2 > y1 && rowB[y2 - 1] < mr * 0.25) y2--;
  while (x1 < W && colB[x1] < mc * 0.25) x1++;
  while (x2 > x1 && colB[x2 - 1] < mc * 0.25) x2--;
  x1 += 3; y1 += 3; x2 -= 3; y2 -= 3;
  const area = (x2 - x1) * (y2 - y1);
  if (area < W * H * 0.05 || area > W * H * 0.9) return null;      // 종이가 프레임 전체면 자를 필요 없음
  return { x1, y1, x2, y2 };
}

// ── 회전·원근 추정/보정 ───────────────────────────────────────
// 모델: 점을 중심 기준으로 θ만큼 회전 → 세로 위치에 비례해 가로 배율(a, 키스톤)과 밀림(b, 전단)을 준다.
//   x1 = x·cosθ + y·sinθ,  y1 = −x·sinθ + y·cosθ,  x3 = x1·(1 − a·y1/H) + b·y1
// θ는 "가로줄이 가장 또렷해지는 각"(행 투영 제곱합 최대)으로, (a,b)는 "세로선이 가장 또렷해지는 값"(열 투영)으로 찾는다.
export function estimateTransforms(gray, W, H, maxCands = 3) {
  const f = Math.max(1, Math.round(W / 400));
  const w2 = Math.floor(W / f), h2 = Math.floor(H / f);
  const t = otsuThreshold(gray);
  const pts = [];
  for (let by = 0; by < h2; by++) for (let bx = 0; bx < w2; bx++) {
    let mn = 255;
    for (let y = by * f; y < by * f + f; y++) { const r = y * W; for (let x = bx * f; x < bx * f + f; x++) { const v = gray[r + x]; if (v < mn) mn = v; } }
    if (mn <= t) pts.push(bx - w2 / 2, by - h2 / 2);
  }
  const n = pts.length / 2;
  if (n < 50) return [];
  const step = n > 40000 ? Math.ceil(n / 40000) : 1;
  const P = []; for (let i = 0; i < n; i += step) P.push(pts[2*i], pts[2*i+1]);
  const m = P.length / 2;
  const span = Math.ceil(Math.hypot(w2, h2)) + 4, off = span / 2;

  const rowScore = deg => {
    const c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180);
    const hist = new Uint32Array(span);
    for (let i = 0; i < m; i++) { const y1 = -P[2*i] * s + P[2*i+1] * c; hist[Math.max(0, Math.min(span - 1, Math.round(y1 + off)))]++; }
    let sc = 0; for (let i = 0; i < span; i++) sc += hist[i] * hist[i];
    return sc;
  };
  let best = { deg: 0, sc: -1 };
  for (let d = -30; d <= 30; d += 1) { const sc = rowScore(d); if (sc > best.sc) best = { deg: d, sc }; }
  for (let d = best.deg - 0.75; d <= best.deg + 0.75; d += 0.25) { const sc = rowScore(d); if (sc > best.sc) best = { deg: d, sc }; }

  const th = best.deg * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
  const X1 = new Float32Array(m), Y1 = new Float32Array(m);
  for (let i = 0; i < m; i++) { X1[i] = P[2*i] * c + P[2*i+1] * s; Y1[i] = -P[2*i] * s + P[2*i+1] * c; }
  const colSpan = span * 2, coff = colSpan / 2;
  const scored = [];
  const AB = []; for (let k = -7; k <= 7; k++) AB.push(k * 0.05);
  for (const a of AB) for (const b of AB) {
    const hist = new Uint32Array(colSpan);
    for (let i = 0; i < m; i++) {
      const x3 = X1[i] * (1 - a * Y1[i] / h2) + b * Y1[i];
      hist[Math.max(0, Math.min(colSpan - 1, Math.round(x3 + coff)))]++;
    }
    let sc = 0; for (let i = 0; i < colSpan; i++) sc += hist[i] * hist[i];
    scored.push({ a, b, sc });
  }
  scored.sort((p, q) => q.sc - p.sc);
  const out = [], seen = [];
  const zero = scored.find(e => e.a === 0 && e.b === 0);
  for (const e of [zero, ...scored]) {
    if (!e || seen.some(q => Math.abs(q.a - e.a) < 0.09 && Math.abs(q.b - e.b) < 0.09)) continue;
    seen.push(e); out.push({ deg: best.deg, a: e.a, b: e.b });
    if (out.length >= maxCands) break;
  }
  return out;
}

export function warpGray(gray, W, H, tf) {
  const th = tf.deg * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
  const cx = W / 2, cy = H / 2;
  const out = new Uint8Array(W * H);
  const fill = sampleLevel(gray, 0.9);
  for (let Y = 0; Y < H; Y++) {
    const y1 = Y - cy, k = 1 - tf.a * y1 / H;
    for (let X = 0; X < W; X++) {
      const x2 = (X - cx) - tf.b * y1;
      const x1 = x2 / k;
      const sx = x1 * c - y1 * s + cx, sy = x1 * s + y1 * c + cy;
      if (sx < 0 || sy < 0 || sx >= W - 1 || sy >= H - 1) { out[Y * W + X] = fill; continue; }
      const ix = sx | 0, iy = sy | 0, fx = sx - ix, fy = sy - iy, i0 = iy * W + ix;
      out[Y * W + X] = (gray[i0] * (1 - fx) + gray[i0 + 1] * fx) * (1 - fy) + (gray[i0 + W] * (1 - fx) + gray[i0 + W + 1] * fx) * fy;
    }
  }
  return out;
}

// 로고의 좌우 끝: 세로 줄(종이 가장자리·벽 모서리)이 로고 행에 걸쳐 잡혀도 넓어지지 않도록,
// 글자 간격보다 크게 떨어진 덩어리는 다른 물체로 보고 잉크가 가장 많은 덩어리만 로고로 삼는다.
function logoExtentX(gray, W, thr, y1, y2) {
  const rowH = y2 - y1, colDark = new Uint32Array(W);
  for (let y = y1; y < y2; y++) { const r = y * W; for (let x = 0; x < W; x++) if (gray[r + x] <= thr) colDark[x]++; }
  const minC = Math.max(1, Math.round(rowH * 0.06)), gap = Math.max(3, Math.round(rowH * 0.5));
  const groups = []; let cur = null, lastX = -1e9;
  for (let x = 0; x < W; x++) {
    if (colDark[x] < minC) continue;
    if (!cur || x - lastX > gap) { cur = { min: x, max: x + 1, ink: 0 }; groups.push(cur); }
    cur.max = x + 1; cur.ink += colDark[x]; lastX = x;
  }
  if (!groups.length) return null;
  groups.sort((a, b) => b.ink - a.ink);
  return { min: groups[0].min, max: groups[0].max };
}

// ── 로고 검증 ("hondi.net"이 맞는지) ─────────────────────────────
// 로고 잉크 영역을 48×8 격자로 나눠 칸별 어두운 정도를 구하고, 저장해 둔 원본 로고와 정규화 상관(NCC)을 낸다.
// 크기·블러·밝기가 달라도 글자가 만드는 굴곡 모양은 유지되므로 견딘다. 검은 막대·블록·다른 글자는 걸러진다.
export const LOGO_GX = 48, LOGO_GY = 8;
export const LOGO_TEMPLATE = [0.66,0.66,0.38,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.15,0.7,0.7,0.34,0,0.76,0.91,0.08,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.44,0.52,0,1,1,0.58,0.03,0.03,0,0,0,0.03,0.06,0,0,0,0,0,0,0.08,0,0,0,0,0.2,0.99,1,0.49,0,0.7,0.85,0.08,0,0,0,0,0,0,0.06,0.04,0,0,0,0.05,0.07,0,0,0.04,0.83,0.75,0,0.67,1,0.77,0.87,0.87,0.23,0.01,0.47,0.88,0.93,0.74,0.19,0.38,0.77,0.65,0.66,0.96,0.7,0.05,0.25,0.77,0.78,0.87,1,0.49,0.31,0.8,0.81,0.3,0,0,0.1,0.77,0.77,0.54,0.92,0.86,0.21,0.02,0.54,0.92,0.94,0.63,0.12,0.77,1,0.94,0.72,0.51,1,0.99,0.98,1,0.57,0.26,0.99,0.89,0.67,1,0.73,0.5,1,0.98,0.99,1,1,0.26,0.75,1,0.85,0.92,1,0.49,0.41,1,1,0.39,0,0,0.13,1,1,0.96,0.99,1,0.56,0.3,1,0.85,0.64,1,0.52,1,1,1,0.94,0.51,1,0.62,0.5,1,0.62,0.51,1,0.65,0.25,1,0.96,0.12,0.92,1,0.32,0.91,1,0.33,0.92,1,0.34,0.63,1,0.49,0.05,0.87,1,0.39,0,0,0.01,0.62,1,0.61,0.55,1,0.61,0.52,1,0.87,0.74,1,0.65,0.45,1,0.76,0.16,0.63,1,0.68,0.53,1,0.7,0.54,1,0.66,0.26,1,0.94,0.19,0.94,1,0.4,0.89,1,0.44,0.91,1,0.35,0.66,1,0.63,0.13,0.89,1,0.52,0.23,0.52,0.08,0.68,1,0.69,0.58,1,0.71,0.56,1,0.78,0.36,0.66,0.46,0.41,1,0.75,0.48,1,1,1,0.75,1,1,0.43,0.97,0.91,0.74,1,0.68,0.49,1,1,0.77,0.89,1,0.79,0.74,1,0.86,0.93,1,1,0.54,1,1,0.87,0.67,1,0.43,1,1,1,0.74,1,1,0.48,0.99,0.9,0.54,0.96,0.4,0.34,1,0.94,0.76,0.71,0.71,0.71,0.54,0.71,0.71,0.16,0.37,0.83,0.89,0.68,0.13,0.35,0.71,0.71,0.55,0.64,0.71,0.57,0.25,0.81,0.77,0.53,0.71,0.71,0.38,0.71,0.71,0.62,0.44,0.84,0.22,0.71,0.71,0.71,0.53,0.71,0.71,0.17,0.44,0.87,0.9,0.62,0.04,0.08,0.77,0.93,0.44];   // tests/digit-v2/make-logo-template.mjs 로 생성
// 실측(합성 3,300장 중 정상 코드 209장 표본): 진짜 로고 NCC 최소 0.75(작고 흐린 경우) · 대부분 0.99,
// 가짜(검은 막대·블록·점·줄무늬·다른 글자·굵은 활자체) 최대 0.43 → 사이인 0.6으로 정한다.
export const LOGO_MIN_NCC = 0.6;

export function logoDescriptor(gray, W, H, ink, row, paper, inkLevel) {
  const x1 = ink.min, x2 = ink.max, y1 = row.p1, y2 = row.p2;
  const out = new Float32Array(LOGO_GX * LOGO_GY);
  const span = Math.max(1, paper - inkLevel);
  for (let gy = 0; gy < LOGO_GY; gy++) {
    const ya = y1 + (y2 - y1) * gy / LOGO_GY, yb = y1 + (y2 - y1) * (gy + 1) / LOGO_GY;
    const ys = Math.max(0, Math.floor(ya)), ye = Math.min(H, Math.max(ys + 1, Math.ceil(yb)));
    for (let gx = 0; gx < LOGO_GX; gx++) {
      const xa = x1 + (x2 - x1) * gx / LOGO_GX, xb = x1 + (x2 - x1) * (gx + 1) / LOGO_GX;
      const xs = Math.max(0, Math.floor(xa)), xe = Math.min(W, Math.max(xs + 1, Math.ceil(xb)));
      let sum = 0, n = 0;
      for (let y = ys; y < ye; y++) { const r = y * W; for (let x = xs; x < xe; x++) {
        const d = (paper - gray[r + x]) / span * 1.5;          // 파란/빨간 글자(회색조 85)도 "잉크"로 포화
        sum += d < 0 ? 0 : d > 1 ? 1 : d; n++;
      } }
      out[gy * LOGO_GX + gx] = n ? sum / n : 0;
    }
  }
  return out;
}

export function ncc(a, b) {
  const n = a.length; let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; sab += da * db; saa += da * da; sbb += db * db; }
  if (saa < 1e-6 || sbb < 1e-6) return 0;                       // 무늬 없는 덩어리(검은 막대 등)
  return sab / Math.sqrt(saa * sbb);
}

export function _analyzeAt(gray, W, H, thr, requireLogo) {
  const paper = Math.max(thr + 30, sampleLevel(gray, 0.95));       // 종이(밝은 쪽) 밝기 추정
  const thrRow = thr + 0.25 * (paper - thr);                      // 블러로 옅어진 가는 선까지 잡는 문턱
  const lineThr = Math.min(255, thr + 0.4 * (paper - thr));

  // 1) 세로 투영 → 내용 덩어리(로고, 숫자열).  배경 잡음 수준을 재서 문턱을 정한다.
  const rp = rowProfile(gray, W, H, thrRow);
  const base = percentile(rp, 0.3);
  const minDark = Math.max(3, Math.round(base * 3 + W * 0.003));
  const minLen  = Math.max(3, Math.round(H * 0.02));
  const rowBlobs = mergeRuns(runs(rp, minDark, 1), Math.max(2, Math.round(H * 0.01))).filter(r => r.p2 - r.p1 >= minLen);
  if (!rowBlobs.length) return { ok: false, reason: 'no-ink' };

  const digitRow = rowBlobs[rowBlobs.length - 1];
  const logoRow  = rowBlobs.length >= 2 ? rowBlobs[rowBlobs.length - 2] : null;
  if (requireLogo && !logoRow) return { ok: false, reason: 'no-logo' };
  if (digitRow.p2 >= H - 1 || digitRow.p1 <= 0) return { ok: false, reason: 'row-clipped' };
  const rowH = digitRow.p2 - digitRow.p1;

  // 2) 숫자열 박스 덩어리: 박스마다 "위 테두리선 + 아래 테두리선"이 있다 — 윗띠·아랫띠 둘 다 어두운 열만 박스 안.
  const band = Math.max(2, Math.round(rowH * 0.1));
  const inBox = new Uint8Array(W);
  for (let x = 0; x < W; x++) {
    let top = false, bot = false;
    for (let y = digitRow.p1; y < digitRow.p1 + band; y++) if (gray[y * W + x] <= lineThr) { top = true; break; }
    for (let y = digitRow.p2 - band; y < digitRow.p2; y++) if (gray[y * W + x] <= lineThr) { bot = true; break; }
    inBox[x] = top && bot ? 1 : 0;
  }
  const boxRuns = mergeRuns(runs(inBox, 1, 1), 1).filter(r => r.p2 - r.p1 >= Math.max(3, rowH * 0.15));
  if (!boxRuns.length) return { ok: false, reason: 'no-boxes' };
  if (boxRuns[0].p1 <= 0 || boxRuns[boxRuns.length - 1].p2 >= W) return { ok: false, reason: 'row-clipped' };
  const boxes = boxRuns.map(b => ({ x1: b.p1, x2: b.p2, y1: digitRow.p1, y2: digitRow.p2 }));

  // 3) 교차 검증
  const bw = median(boxes.map(b => b.x2 - b.x1));
  if (boxes.some(b => Math.abs((b.x2 - b.x1) - bw) > bw * 0.25)) return { ok: false, reason: 'box-width-inconsistent' };
  const aspect = rowH / bw;
  if (aspect < 1.35 || aspect > 2.2) return { ok: false, reason: 'box-aspect' };
  if (boxes.length > 1) {
    const step = [];
    for (let i = 1; i < boxes.length; i++) step.push(boxes[i].x1 - boxes[i-1].x1);
    const ms = median(step);
    if (step.some(v => Math.abs(v - ms) > ms * 0.2)) return { ok: false, reason: 'pitch-inconsistent' };
    if (ms < bw * 1.03) return { ok: false, reason: 'boxes-merged' };
  }
  let logoInk = null, logoScore = null;
  if (logoRow) {
    logoInk = logoExtentX(gray, W, thrRow, logoRow.p1, logoRow.p2);
    if (!logoInk) return { ok: false, reason: 'no-logo' };
    const pitchLogo = (logoInk.max - logoInk.min) / MAX_DIGITS;
    const ratio = bw / pitchLogo;                                  // 설계값 0.86
    if (ratio < 0.65 || ratio > 1.05) return { ok: false, reason: 'logo-scale-mismatch' };
    if (LOGO_TEMPLATE.length === LOGO_GX * LOGO_GY) {
      logoScore = ncc(logoDescriptor(gray, W, H, logoInk, logoRow, paper, sampleLevel(gray, 0.02)), LOGO_TEMPLATE);
      if (LOGO_MIN_NCC > 0 && logoScore < LOGO_MIN_NCC) return { ok: false, reason: 'logo-mismatch', logoScore };
    }
    if (Math.abs(boxes[0].x1 - logoInk.min) > pitchLogo * 0.6) return { ok: false, reason: 'not-left-aligned' };
    if (boxes[boxes.length - 1].x2 - logoInk.max > pitchLogo * 0.6) return { ok: false, reason: 'too-wide' };
  }
  if (boxes.length > MAX_DIGITS) return { ok: false, reason: 'too-many-digits' };

  // 마지막 박스 바로 오른쪽 한 칸 폭에 잉크가 있으면 박스를 놓친 것 → 자릿수를 덜 읽은 것이므로 버린다
  {
    const st = [];
    for (let i = 1; i < boxes.length; i++) st.push(boxes[i].x1 - boxes[i-1].x1);
    const pitchEst = boxes.length > 1 ? median(st) : bw / (1 - GAP_RATIO);
    const x0 = boxes[boxes.length - 1].x2 + 1, x1 = Math.min(W, Math.round(x0 + pitchEst * 0.95));
    let dark = 0, n = 0;
    for (let y = digitRow.p1; y < digitRow.p2; y++) { const r = y * W; for (let x = x0; x < x1; x++) { n++; if (gray[r + x] <= thr) dark++; } }
    if (n > 0 && dark / n > 0.04) return { ok: false, reason: 'trailing-ink' };
  }

  // 4) 칸 읽기 — 표준 패턴과 정확히 일치 + 켜진 획은 꽉 참 + 꺼진 자리/구멍은 깨끗함
  const cells = boxes.map(b => readCell(gray, W, H, b));
  if (cells.some(c => c.bestDiff !== 0)) return { ok: false, reason: 'bad-pattern' };
  if (cells.some(c => !c.solid)) return { ok: false, reason: 'low-certainty' };
  const certainty = Math.min(...cells.map(c => c.certainty));
  const serial = cells.map(c => c.digit).join('');
  if (!isValidSerial(serial)) return { ok: false, reason: 'invalid-serial' };      // 앞자리 0 등
  return { ok: true, serial, n: cells.length, certainty, logoScore, cells, row: { digitRow, logoRow, boxes, logoInk } };
}
