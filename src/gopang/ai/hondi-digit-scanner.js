/**
 * hondi-digit-scanner.js — 혼디 숫자 코드 스캐너
 *
 * hondi-digit-code.js가 생성한 숫자 코드(로고 "혼디" 아래에 가로 10칸
 * 숫자열)를 사진에서 읽어낸다.
 *
 * [파이프라인]
 *   1. 전체 사진을 그레이스케일 + Otsu 임계값으로 이진화
 *   2. 세로(Y) 방향으로 내용 블록을 찾는다 — 로고(위)와 숫자열(아래)은
 *      흰 여백으로 분리돼 있으므로, 맨 아래 블록이 항상 숫자열이다.
 *   3. 그 행 범위 안에서 실제 잉크의 좌우 시작~끝(숫자열 전체 폭)을 찾는다.
 *   4. 가로로 10등분(왼쪽→오른쪽 = 첫째자리~열째자리), 칸마다 7세그먼트
 *      on/off 판정.
 *
 * hondi-7seg-guide.html(실기기 검증된 원본)과 동일한 원리 — 로고까지
 * 함께 촬영돼도 숫자열만 정확히 분리해서 처리한다.
 */

import { SEGMENT_PATTERNS, SEG_ORDER, DIGIT_COUNT } from './hondi-digit-code.js';
import { L1_URL } from '../core/state.js';

// ── 상수 ──────────────────────────────────────────────────────
const SHRINK = { x1: 0.111, x2: 0.889, y1: 0.071, y2: 0.929 };
const MIN_BLOB_WIDTH_RATIO = 0.03;
const MIN_AXIS_DARK_RATIO  = 0.02;

const DIGIT_BITS = {};
for (const [d, segs] of Object.entries(SEGMENT_PATTERNS)) {
  DIGIT_BITS[d] = SEG_ORDER.map(s => segs.includes(s) ? 1 : 0);
}
const SEG_BOXES = {
  a: { x1:0.20, x2:0.80, y1:0.00, y2:0.10 },
  g: { x1:0.20, x2:0.80, y1:0.45, y2:0.55 },
  d: { x1:0.20, x2:0.80, y1:0.90, y2:1.00 },
  f: { x1:0.00, x2:0.22, y1:0.08, y2:0.44 },
  b: { x1:0.78, x2:1.00, y1:0.08, y2:0.44 },
  e: { x1:0.00, x2:0.22, y1:0.56, y2:0.92 },
  c: { x1:0.78, x2:1.00, y1:0.56, y2:0.92 },
};
const SEG_ON_RATIO = 0.35;

// ── 라이브 스캔 상수/상태 (색상 코드 스캐너 hondi-scanner.js와 동일 패턴) ──
const SCAN_FPS       = 15;
const SCAN_MS        = Math.round(1000 / SCAN_FPS);
const LOCK_FRAMES    = 3;
// avgMargin: 셀마다 1위·2위 후보 세그먼트 매칭 점수 차이의 평균. 실제
// 숫자 코드가 잘 보일 때는 이 값이 크고(뚜렷한 판별), 코드가 없는 화면을
// 비출 때(벽·바닥 등)는 findAxisBlobs가 우연히 얼룩을 잡아도 판별이
// 애매해 값이 낮다 — 이 값으로 "코드 없음" 프레임을 걸러낸다.
const MIN_AVG_MARGIN = 3;

let _stream        = null;
let _rafId         = null;
let _lastTime      = 0;
let _lockCount     = 0;
let _lastId        = null;
let _locked        = false;
let _onResult      = null;
let _onStatus      = null;
let _overlayCanvas = null;

// ── 기본 유틸 ──────────────────────────────────────────────────
function otsuThreshold(grayArray) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < grayArray.length; i++) hist[grayArray[i]]++;
  const total = grayArray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, varMax = -1, threshold = 127;
  for (let t = 0; t < 256; t++) {
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

// 축(x/y) 무관 1차원 투영 블록탐지
function findAxisBlobs(gray, w, h, axis, threshold) {
  const primaryLen = axis === 'x' ? w : h;
  const otherLen = axis === 'x' ? h : w;
  const darkCount = new Uint32Array(primaryLen);
  if (axis === 'x') {
    for (let y=0; y<h; y++) { const row=y*w; for (let x=0; x<w; x++) if (gray[row+x] <= threshold) darkCount[x]++; }
  } else {
    for (let y=0; y<h; y++) { const row=y*w; let c=0; for (let x=0; x<w; x++) if (gray[row+x] <= threshold) c++; darkCount[y]=c; }
  }
  const minDark = Math.max(1, Math.round(otherLen*MIN_AXIS_DARK_RATIO));
  const minSize = Math.max(1, Math.round(primaryLen*MIN_BLOB_WIDTH_RATIO));
  const blobs = [];
  let i = 0;
  while (i < primaryLen) {
    if (darkCount[i] >= minDark) {
      let j = i;
      while (j < primaryLen && darkCount[j] >= minDark) j++;
      if (j - i >= minSize) blobs.push({ p1: i, p2: j });
      i = j;
    } else { i++; }
  }
  return blobs;
}

function perpExtent(gray, w, h, axis, p1, p2, threshold) {
  let min = Infinity, max = -1;
  if (axis === 'x') {
    for (let y=0; y<h; y++) {
      const row=y*w; let dark=false;
      for (let x=p1; x<p2; x++) if (gray[row+x] <= threshold) { dark=true; break; }
      if (dark) { if (y<min) min=y; if (y>max) max=y; }
    }
  } else {
    for (let x=0; x<w; x++) {
      let dark=false;
      for (let y=p1; y<p2; y++) if (gray[y*w+x] <= threshold) { dark=true; break; }
      if (dark) { if (x<min) min=x; if (x>max) max=x; }
    }
  }
  if (max < 0) return null;
  return { min, max: max+1 };
}




function readSegments(ctx, bbox) {
  const w = bbox.x2 - bbox.x1, h = bbox.y2 - bbox.y1;
  const crop = document.createElement('canvas');
  crop.width = 100; crop.height = 100;
  const cctx = crop.getContext('2d', { willReadFrequently: true });
  cctx.drawImage(ctx.canvas, bbox.x1, bbox.y1, w, h, 0, 0, 100, 100);
  const data = cctx.getImageData(0, 0, 100, 100).data;
  const gray = new Uint8Array(100*100);
  for (let i=0;i<100*100;i++) gray[i] = Math.round((data[i*4]+data[i*4+1]+data[i*4+2])/3);
  const threshold = otsuThreshold(gray);

  const bits = [];
  for (const s of SEG_ORDER) {
    const box = SEG_BOXES[s];
    const x1 = Math.round(box.x1*100), x2 = Math.round(box.x2*100);
    const y1 = Math.round(box.y1*100), y2 = Math.round(box.y2*100);
    let dark=0, n=0;
    for (let y=y1; y<y2; y++) for (let x=x1; x<x2; x++) {
      n++; if (gray[y*100+x] <= threshold) dark++;
    }
    bits.push((n ? dark/n : 0) >= SEG_ON_RATIO ? 1 : 0);
  }
  return bits;
}

function matchDigit(bits) {
  const scores = Object.entries(DIGIT_BITS).map(([d, pattern]) => {
    let diff = 0;
    for (let i=0;i<7;i++) if (bits[i] !== pattern[i]) diff++;
    return { digit: d, diff };
  });
  scores.sort((a,b) => a.diff - b.diff);
  return scores;
}

// ── 공개 API — 라이브 카메라 스캔 ────────────────────────────
// 색상 코드 스캐너(hondi-scanner.js)의 startScanner/stopScanner와 동일한
// 시그니처·동작 방식(rAF 루프 + 연속 프레임 잠금)이되, 버전 개념이 없어
// onResult는 (digitString, result) 두 인자만 넘긴다.
export async function startScanner(video, canvas, overlayCanvas, onResult, onStatus) {
  _onResult = onResult; _onStatus = onStatus; _overlayCanvas = overlayCanvas;
  _lockCount = 0; _lastId = null; _locked = false;
  try {
    _stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode:{ideal:'environment'}, width:{ideal:1280}, height:{ideal:720} },
      audio: false,
    });
    video.srcObject = _stream;
    await video.play();
    _status('혼디 숫자 코드를 화면에 맞춰주세요.');
    _scheduleFrame(video, canvas);
  } catch (e) {
    const msg =
      e.name === 'NotAllowedError'  ? '카메라 권한이 거부됐습니다. 설정에서 허용해 주세요.' :
      e.name === 'NotFoundError'    ? '카메라를 찾을 수 없습니다.' :
      e.name === 'NotReadableError' ? '카메라가 다른 앱에서 사용 중입니다.' :
                                       `카메라 오류: ${e.message}`;
    _status(msg); throw e;
  }
}

export function stopScanner() {
  if (_rafId)  { cancelAnimationFrame(_rafId); _rafId = null; }
  if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
}

function _scheduleFrame(video, canvas) {
  _rafId = requestAnimationFrame(ts => {
    if (_locked) return;
    if (ts - _lastTime >= SCAN_MS) { _lastTime = ts; _processFrame(video, canvas); }
    _scheduleFrame(video, canvas);
  });
}

function _processFrame(video, canvas) {
  if (video.readyState < 2) return;
  const W = video.videoWidth, H = video.videoHeight;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0);
  const result = _analyze(canvas, ctx);
  _drawOverlay(result, W, H);

  if (!result || result.avgMargin < MIN_AVG_MARGIN) { _lockCount = 0; _lastId = null; return; }

  const idStr = result.digits.join('');
  if (idStr === _lastId) _lockCount++; else { _lockCount = 1; _lastId = idStr; }
  _status(`인식 중... ${Math.round(_lockCount / LOCK_FRAMES * 100)}%`);

  if (_lockCount >= LOCK_FRAMES) {
    _locked = true;
    stopScanner();
    if (navigator.vibrate) navigator.vibrate([60, 30, 60]);
    _playBeep();
    _onResult?.(idStr, result);
  }
}

// ── 오버레이 — 인식된 숫자열 잉크 범위와 칸 경계를 그린다 ────────
function _drawOverlay(result, W, H) {
  if (!_overlayCanvas) return;
  _overlayCanvas.width = W; _overlayCanvas.height = H;
  const oc = _overlayCanvas.getContext('2d');
  oc.clearRect(0, 0, W, H);
  if (!result) return;

  const { inkAbs } = result;
  oc.strokeStyle = 'rgba(255,220,0,0.9)';
  oc.lineWidth = 2;
  oc.strokeRect(inkAbs.x1, inkAbs.y1, inkAbs.x2 - inkAbs.x1, inkAbs.y2 - inkAbs.y1);

  oc.strokeStyle = 'rgba(255,255,255,0.5)';
  oc.lineWidth = 1;
  const cellW = (inkAbs.x2 - inkAbs.x1) / DIGIT_COUNT;
  for (let c = 1; c < DIGIT_COUNT; c++) {
    const x = inkAbs.x1 + cellW * c;
    oc.beginPath(); oc.moveTo(x, inkAbs.y1); oc.lineTo(x, inkAbs.y2); oc.stroke();
  }
}

function _status(msg) { _onStatus?.(msg); }

function _playBeep() {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ac.createOscillator(), gain = ac.createGain();
    osc.connect(gain); gain.connect(ac.destination);
    osc.frequency.value = 1320;
    gain.gain.setValueAtTime(0.18, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.12);
    osc.start(); osc.stop(ac.currentTime + 0.12);
  } catch {}
}

// 색상 코드 스캐너(hondi-scanner.js)의 analyzePhoto와 동일한 시그니처.
export function analyzePhoto(imageData, onResult, onStatus) {
  const c = document.createElement('canvas');
  c.width = imageData.width; c.height = imageData.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.putImageData(imageData, 0, 0);

  const result = _analyze(c, ctx);
  if (result) {
    onResult?.(result.digits.join(''), result);
  } else {
    onStatus?.('인식 실패. 로고("혼")와 "ㄷ" 기준점, 숫자열이 모두 한 프레임에 보이게 다시 찍어주세요.');
  }
}

function _analyze(canvas, ctx) {
  const W = canvas.width, H = canvas.height;
  const data = ctx.getImageData(0, 0, W, H).data;
  const gray = new Uint8Array(W*H);
  for (let i=0;i<W*H;i++) gray[i] = Math.round((data[i*4]+data[i*4+1]+data[i*4+2])/3);
  const threshold = otsuThreshold(gray);

  // 로고(위) + 숫자열(아래) — 이번 레이아웃은 세로(Y) 방향으로 분리된다.
  // 로고는 색상 코드와 동일한 큰 덩어리(파랑·빨강·검정)이고, 그 아래
  // 흰 여백을 사이에 두고 숫자열이 온다 — 맨 아래 블록이 항상 숫자열.
  const rowBlobs = findAxisBlobs(gray, W, H, 'y', threshold);
  if (rowBlobs.length === 0) return null;
  const digitRow = rowBlobs[rowBlobs.length-1];

  // 그 행 범위 안에서 실제 잉크의 좌우 시작~끝(숫자열 전체 폭)을 찾는다.
  const xExtent = perpExtent(gray, W, H, 'y', digitRow.p1, digitRow.p2, threshold);
  if (!xExtent) return null;

  const inkAbs = { x1: xExtent.min, x2: xExtent.max, y1: digitRow.p1, y2: digitRow.p2 };
  const totalW = inkAbs.x2-inkAbs.x1;
  const cellW = totalW/DIGIT_COUNT;
  const rowH = inkAbs.y2-inkAbs.y1;

  const cellResults = [];
  for (let i=0; i<DIGIT_COUNT; i++) {
    const cx1 = inkAbs.x1+i*cellW, cx2 = inkAbs.x1+(i+1)*cellW;
    const cw = cx2-cx1;
    const interior = {
      x1: cx1+SHRINK.x1*cw, x2: cx1+SHRINK.x2*cw,
      y1: inkAbs.y1+SHRINK.y1*rowH, y2: inkAbs.y1+SHRINK.y2*rowH,
    };
    const bits = readSegments(ctx, interior);
    const scores = matchDigit(bits);
    cellResults.push({ interior, best: scores[0], second: scores[1] });
  }

  const digits = cellResults.map(r => Number(r.best.digit));
  const avgMargin = cellResults.reduce((s,r)=>s+(r.second.diff-r.best.diff),0)/DIGIT_COUNT;

  return { digits, avgMargin, inkAbs, cellResults };
}

// ── L1 프로필 조회 ───────────────────────────────────────────
// 색상 코드(hondi-scanner.js)의 lookupProfile과 동일 구조이되,
// 색상 코드와 구분되는 전용 필드 digit_code_id로 조회한다.
export async function lookupDigitProfile(shortId) {
  const sid = shortId.toString();
  try {
    const base = L1_URL.replace('/api/collections/profiles/records', '');
    const res = await fetch(
      `${base}/api/collections/profiles/records?filter=(digit_code_id='${sid}')&perPage=1`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) throw new Error(`L1 오류: ${res.status}`);
    const data = await res.json();
    if (!data.items?.length) throw new Error(`등록되지 않은 코드 (${sid})`);
    const p = data.items[0];
    return {
      guid: p.ipv6 || p.id,
      handle: p.handle,
      name: p.name || p.nickname || p.handle,
      url: p.digit_code_id
        ? `/profiles/${p.digit_code_id}.html`
        : `https://app.naviweb.kr/profile?id=${p.id}`,
    };
  } catch (e) {
    throw new Error(`프로필 조회 실패: ${e.message}`);
  }
}
