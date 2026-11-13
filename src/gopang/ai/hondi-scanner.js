/**
 * hondi-scanner.js — 혼디 시각 코드 스캐너 v7.0
 *
 * ══════════════════════════════════════════════════════════════
 * v7.0 핵심 변경: 로고 글자 자체를 캘리브레이션 기준점으로 재사용
 * ══════════════════════════════════════════════════════════════
 * v6.0까지는 색상 막대(데이터) + 별도 캘리브레이션 패치(고정 6색)
 * 두 구역을 그렸다. 그런데 패치는 캔버스 오른쪽 멀리 있는 막대 아래에
 * 위치해서, 카메라 프레임에 막대만 잡히고 패치가 잘리는 실패 사례가
 * 실측으로 확인됐다.
 *
 * v7.0은 두 구역의 역할을 맞바꿨다:
 *   - "혼디" 로고 안에 이미 고정색으로 박혀 있는 빨강·파랑 사각형과
 *     검정 획, 배경 흰색 — 이 네 가지를 그대로 캘리브레이션 기준점으로
 *     재사용한다(hondi-code.js의 CALIB_*_ROI). 별도 앵커나 패치를
 *     그리지 않는다.
 *   - 로고 바로 아래, 가까운 위치에 정사각형 셀 그리드(6칸 또는 10칸)를
 *     그려 실제 데이터(색상 코드)를 담는다. 로고에 붙어 있으므로 로고가
 *     프레임에 잡히면 데이터도 함께 잡힐 가능성이 훨씬 높다.
 *
 * [파이프라인]
 *   1. 고채도 정사각형 그리드 탐지 → 데이터 코드의 위치·크기(scale) 확정
 *   2. 그리드 크기 대비 배율(scale)로 로고 위 캘리브레이션 ROI 위치를
 *      역산 → 빨강·파랑·검정·흰색 실측
 *   3. 실측값이 기대 색상과 대략 맞는지 검증(존재 확인 게이트)
 *   4. 캘리브레이션 적용 후 각 셀 색상을 팔레트에 매칭
 *
 * [장점]
 *   - 데이터와 캘리브레이션이 모두 로고 근처 한 덩어리에 모여 있어
 *     프레임 아웃 위험이 크게 줄어든다.
 *   - 캘리브레이션 전용 앵커/패치를 그릴 필요가 없어 로고가 단순해진다.
 */

import {
  PALETTE, rgbToIndex, indicesToId,
  buildCalibMatrix, applyCalib,
  BASE_IMG_W, BASE_IMG_H, CODE_CELL, CODE_GAP, CODE_MAX_COLS,
  CALIB_RED_ROI, CALIB_BLUE_ROI, CALIB_BLACK_ROI, CALIB_WHITE_ROI,
  BRACKET_LEN, BRACKET_W, BRACKET_MARGIN,
} from './hondi-code.js';
import { L1_URL } from '../core/state.js';

// ── 상수 ──────────────────────────────────────────────────────
const SCAN_FPS      = 15;
const SCAN_MS       = Math.round(1000 / SCAN_FPS);
const LOCK_FRAMES   = 3;

// 데이터 그리드 탐지 파라미터
const SAT_THRESHOLD   = 60;   // 고채도 판정 (완화: 모니터 카메라 환경)
const ROW_MIN_PIXELS  = 12;   // 한 행을 "고채도 행"으로 볼 최소 픽셀 수
const BAND_MERGE_GAP  = 2.0;  // 밴드 사이 간격이 밴드 높이의 이 배수 이내면 병합(2행 그리드)
const CELL_SAMPLE     = 0.6;  // 셀 내부 샘플 비율(경계선 제외)

// 디자인 좌표계(hondi-code.js와 동일 기준: 베이스 이미지 원점 (0,0))에서
// 그리드 시작 X좌표를 계산 — generateHondiCodeCanvas와 동일한 공식.
function _designGridStartX(cols) {
  const gridW = cols * CODE_CELL;
  return Math.max(BRACKET_MARGIN + 2, Math.round((BASE_IMG_W - gridW) / 2));
}
const DESIGN_GRID_Y = BASE_IMG_H + CODE_GAP * 2;

// 캘리브레이션 실측값이 "그럴듯한지" 최소한으로 검증하는 게이트.
// (로고가 아니라 엉뚱한 색색 물체를 그리드로 오인했을 때 걸러낸다.)
function _plausible(measured) {
  const { red, blue, black } = measured;
  const redOk   = red.r  - Math.max(red.g,  red.b)  > 20;
  const blueOk  = blue.b - Math.max(blue.r, blue.g) > 20;
  const darkest = Math.max(black.r, black.g, black.b);
  const blackOk = darkest < 150;
  return redOk && blueOk && blackOk;
}

// ── 상태 ──────────────────────────────────────────────────────
let _stream        = null;
let _rafId         = null;
let _lastTime      = 0;
let _lockCount     = 0;
let _lastId        = null;
let _locked        = false;
let _onResult      = null;
let _onStatus      = null;
let _overlayCanvas = null;

// ── 공개 API ──────────────────────────────────────────────────
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
    _status('혼디 코드를 화면에 맞춰주세요.');
    _scheduleFrame(video, canvas);
  } catch(e) {
    const msg =
      e.name==='NotAllowedError'  ? '카메라 권한이 거부됐습니다. 설정에서 허용해 주세요.' :
      e.name==='NotFoundError'    ? '카메라를 찾을 수 없습니다.' :
      e.name==='NotReadableError' ? '카메라가 다른 앱에서 사용 중입니다.' :
                                    `카메라 오류: ${e.message}`;
    _status(msg); throw e;
  }
}

export function stopScanner() {
  if (_rafId)  { cancelAnimationFrame(_rafId); _rafId = null; }
  if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
}

export function analyzePhoto(imageData, onResult, onStatus) {
  _onResult = onResult; _onStatus = onStatus;
  const c = document.createElement('canvas');
  c.width = imageData.width; c.height = imageData.height;
  const ctx = c.getContext('2d', { willReadFrequently:true });
  ctx.putImageData(imageData, 0, 0);
  const result = _analyzeFrame(ctx, c.width, c.height);
  if (result) _onResult?.(result.shortId, result.version);
  else _onStatus?.('인식 실패. 로고와 색상 코드가 모두 보이게 더 가까이 대주세요.');
}

// ── rAF 루프 ──────────────────────────────────────────────────
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
  const ctx = canvas.getContext('2d', { willReadFrequently:true });
  ctx.drawImage(video, 0, 0);
  const result = _analyzeFrame(ctx, W, H);
  _drawOverlay(result, W, H);
  if (!result) { _lockCount = 0; _lastId = null; return; }

  const idStr = result.shortId.toString();
  if (idStr === _lastId) _lockCount++; else { _lockCount=1; _lastId=idStr; }
  _status(`인식 중... ${Math.round(_lockCount/LOCK_FRAMES*100)}%`);

  if (_lockCount >= LOCK_FRAMES) {
    _locked = true;
    stopScanner();
    if (navigator.vibrate) navigator.vibrate([60,30,60]);
    _playBeep();
    _onResult?.(result.shortId, result.version);
  }
}

// ── 프레임 분석 ───────────────────────────────────────────────
// 1차: 채도 투영 기반 탐지(빠름, 대부분의 경우 충분).
// 2차: 실패 시에만 브래킷 기반 탐지(느리지만, 코드와 같은 높이에
//      다른 색색 물체가 겹치는 등 1차가 원천적으로 못 가르는 상황에 강함).
function _analyzeFrame(ctx, W, H) {
  for (const grid of _detectCodeGrid(ctx, W, H)) {
    const result = _decode(ctx, grid);
    if (result) return result;
  }
  for (const grid of _detectCodeGridByBrackets(ctx, W, H)) {
    const result = _decode(ctx, grid);
    if (result) return result;
  }
  return null;
}

// ── 1단계: 데이터 그리드(정사각형 셀들) 탐지 ─────────────────
// 고채도 픽셀이 많은 "행"들을 찾아 밴드로 묶고, 밴드들의 바운딩 박스를
// 그리드 후보로 본다. 세로로 가까운 밴드 2개는 v2(10칸, 2행) 후보로 병합.
//
// 실사용 사진에는 진짜 코드보다 더 큰 색색 물체(옷, 포스터 등)가 같이
// 잡힐 수 있다. 그런 잡음이 면적이 더 크다고 그것만 검사하고 포기하면
// 안 되므로, 후보 전부를 면적 내림차순으로 모아 하나씩 검증한다.
function _detectCodeGrid(ctx, W, H) {
  const data = ctx.getImageData(0, 0, W, H).data;

  const rowVivid = new Int32Array(H);
  for (let y = 0; y < H; y++) {
    let cnt = 0;
    for (let x = 0; x < W; x++) {
      const i = (y*W+x)*4;
      const r=data[i], g=data[i+1], b=data[i+2], a=data[i+3];
      if (a < 128) continue;
      const mx=Math.max(r,g,b), mn=Math.min(r,g,b);
      if (mx-mn > SAT_THRESHOLD) cnt++;
    }
    rowVivid[y] = cnt;
  }

  // 연속으로 고채도인 행 구간(밴드) 추출
  const bands = [];
  let start = -1;
  for (let y = 0; y <= H; y++) {
    if (y < H && rowVivid[y] > ROW_MIN_PIXELS) {
      if (start < 0) start = y;
    } else {
      if (start >= 0) { bands.push({ y1: start, y2: y-1 }); start = -1; }
    }
  }
  if (!bands.length) return [];

  // 각 밴드의 X 범위(그 밴드 내 고채도 픽셀의 최소/최대 x) 계산
  for (const band of bands) {
    let x1 = W, x2 = -1;
    for (let y = band.y1; y <= band.y2; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y*W+x)*4;
        const r=data[i], g=data[i+1], b=data[i+2], a=data[i+3];
        if (a < 128) continue;
        const mx=Math.max(r,g,b), mn=Math.min(r,g,b);
        if (mx-mn > SAT_THRESHOLD) { if (x<x1) x1=x; if (x>x2) x2=x; }
      }
    }
    band.x1 = x1; band.x2 = x2;
  }

  // 세로로 가까이 붙어있고 x범위가 비슷한 밴드들을 하나의 그룹(그리드 후보)으로 병합
  const sorted = bands.filter(b => b.x2 >= b.x1).sort((a,b) => a.y1-b.y1);
  const groups = [];
  let cur = null;
  for (const band of sorted) {
    if (!cur) { cur = { bands:[band] }; groups.push(cur); continue; }
    const last = cur.bands[cur.bands.length-1];
    const lastH = last.y2 - last.y1 + 1;
    const gap = band.y1 - last.y2;
    const widthClose = Math.abs(band.x1-last.x1) < lastH*1.5 && Math.abs(band.x2-last.x2) < lastH*1.5;
    if (gap >= 0 && gap < lastH*BAND_MERGE_GAP && widthClose) {
      cur.bands.push(band);
    } else {
      cur = { bands:[band] }; groups.push(cur);
    }
  }
  if (!groups.length) return [];

  // 후보를 면적 내림차순으로 정렬 — 가장 큰 것부터 검증해서 순서대로 시도한다.
  const candidates = groups.map(g => {
    const x1 = Math.min(...g.bands.map(b=>b.x1));
    const x2 = Math.max(...g.bands.map(b=>b.x2));
    const y1 = g.bands[0].y1, y2 = g.bands[g.bands.length-1].y2;
    return { x1, y1, x2, y2, rows: g.bands.length, area: (x2-x1)*(y2-y1) };
  }).sort((a,b) => b.area - a.area);

  const validGrids = [];

  for (const cand of candidates) {
    const grid = _validateGrid(ctx, cand);
    if (grid) validGrids.push(grid);
  }
  return validGrids;
}

// ── 2차 탐지: 코너 브래킷 기반(느리지만 잡음에 강함) ─────────
// 1차(채도 투영)가 실패했을 때만 호출된다. 검정 L자 브래킷 4개를
// 연결요소로 찾아 그 기하학적 배치(사각형)로 그리드 위치를 직접
// 역산한다 — 코드와 같은 높이에 다른 색색 물체가 겹쳐서 채도 투영이
// 행을 못 가르는 상황에도 브래킷은 "검정 + L자 모양"이라는 별개
// 특징으로 찾아낼 수 있다.
const BR_THUMB_SCALE = 0.35;   // 성능을 위해 축소본에서 탐색(느린 경로이므로 허용)
const BR_MIN_PX      = 6;      // 축소본 기준 브래킷 연결요소 최소 픽셀 수
const BR_MAX_PX      = 400;    // 축소본 기준 최대 픽셀 수(로고 획 등 큰 덩어리 배제)

const _isBracketBlack = (r,g,b) => r<70 && g<70 && b<70;

function _findBlackComponents(data, W, H) {
  const visited = new Uint8Array(W*H);
  const comps = [];
  for (let y=0; y<H; y++) {
    for (let x=0; x<W; x++) {
      const idx = y*W+x;
      if (visited[idx]) continue;
      const i4 = idx*4;
      if (!_isBracketBlack(data[i4],data[i4+1],data[i4+2])) { visited[idx]=1; continue; }

      const queue=[idx]; visited[idx]=1;
      let qi=0, n=0, sx=0, sy=0, minX=x, maxX=x, minY=y, maxY=y;
      while (qi < queue.length) {
        const cur = queue[qi++];
        const cx = cur % W, cy = (cur / W) | 0;
        n++; sx+=cx; sy+=cy;
        if (cx<minX) minX=cx; if (cx>maxX) maxX=cx;
        if (cy<minY) minY=cy; if (cy>maxY) maxY=cy;
        const neigh = [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]];
        for (const [nx,ny] of neigh) {
          if (nx<0||nx>=W||ny<0||ny>=H) continue;
          const nidx = ny*W+nx;
          if (visited[nidx]) continue;
          const ni4 = nidx*4;
          if (_isBracketBlack(data[ni4],data[ni4+1],data[ni4+2])) { visited[nidx]=1; queue.push(nidx); }
          else visited[nidx] = 1;
        }
      }
      if (n < BR_MIN_PX || n > BR_MAX_PX) continue;

      // L자는 꽉 찬 사각형보다 성기다(대략 30~65% 채움) — 로고 획처럼
      // 꽉 찬 검정 덩어리(ㄴ·ㄷ·ㅣ, 캘리브레이션 검정 ROI 등)는 fillRatio가
      // 훨씬 높아서 자동으로 걸러진다.
      const bboxW = maxX-minX+1, bboxH = maxY-minY+1;
      const fillRatio = n / (bboxW*bboxH);
      const squareness = Math.max(bboxW,bboxH) / Math.min(bboxW,bboxH);
      if (fillRatio > 0.15 && fillRatio < 0.75 && squareness < 2.2) {
        comps.push({ cx: sx/n, cy: sy/n, n });
      }
    }
  }
  return comps;
}

// 4점 조합이 (근사) 직사각형(TL/TR/BL/BR)을 이루는지 검사한다.
function _tryRect(pts) {
  const byY = [...pts].sort((a,b) => a.cy-b.cy);
  const top = [byY[0], byY[1]].sort((a,b) => a.cx-b.cx);
  const bot = [byY[2], byY[3]].sort((a,b) => a.cx-b.cx);
  const [tl,tr] = top, [bl,br] = bot;

  const w1 = tr.cx-tl.cx, w2 = br.cx-bl.cx;
  const h1 = bl.cy-tl.cy, h2 = br.cy-tr.cy;
  if (w1 < 20 || h1 < 20) return null;

  const TOL = 0.10;
  const wOk    = Math.abs(w1-w2) < Math.max(w1,w2)*TOL;
  const hOk    = Math.abs(h1-h2) < Math.max(h1,h2)*TOL;
  const topOk  = Math.abs(tl.cy-tr.cy) < h1*0.15;
  const botOk  = Math.abs(bl.cy-br.cy) < h1*0.15;
  const leftOk = Math.abs(tl.cx-bl.cx) < w1*0.15;
  const rightOk= Math.abs(tr.cx-br.cx) < w1*0.15;
  if (!(wOk && hOk && topOk && botOk && leftOk && rightOk)) return null;

  return {
    x1: (tl.cx+bl.cx)/2, y1: (tl.cy+tr.cy)/2,
    x2: (tr.cx+br.cx)/2, y2: (bl.cy+br.cy)/2,
  };
}

// 브래킷 후보들 중 사각형을 이루는 4개 조합을 찾는다(면적이 가장 큰 것 우선).
function _findBracketRect(comps) {
  const MAX_CANDIDATES = 24;  // 조합 폭발 방지
  const list = comps.slice(0, MAX_CANDIDATES);
  let best = null, bestArea = 0;
  for (let i=0; i<list.length; i++)
    for (let j=i+1; j<list.length; j++)
      for (let k=j+1; k<list.length; k++)
        for (let l=k+1; l<list.length; l++) {
          const rect = _tryRect([list[i],list[j],list[k],list[l]]);
          if (!rect) continue;
          const area = (rect.x2-rect.x1) * (rect.y2-rect.y1);
          if (area > bestArea) { bestArea = area; best = rect; }
        }
  return best;
}

function _detectCodeGridByBrackets(ctx, W, H) {
  const tW = Math.max(1, Math.round(W*BR_THUMB_SCALE));
  const tH = Math.max(1, Math.round(H*BR_THUMB_SCALE));
  const off = new OffscreenCanvas(tW, tH);
  const octx = off.getContext('2d', { willReadFrequently:true });
  octx.drawImage(ctx.canvas, 0, 0, W, H, 0, 0, tW, tH);
  const data = octx.getImageData(0, 0, tW, tH).data;

  const comps = _findBlackComponents(data, tW, tH);
  if (comps.length < 4) return [];

  const rect = _findBracketRect(comps);
  if (!rect) return [];

  const scale = 1 / BR_THUMB_SCALE;
  let x1 = rect.x1*scale, y1 = rect.y1*scale, x2 = rect.x2*scale, y2 = rect.y2*scale;

  // 브래킷 코너점은 그리드 가장자리에서 BRACKET_MARGIN만큼 바깥에 있으므로
  // 안쪽으로 살짝 당긴다(정밀한 스케일을 몰라도 되는 근사치 — MARGIN이
  // 그리드 전체 크기에 비해 작아서 오차 영향이 미미하다).
  const shrinkX = (x2-x1) * 0.02, shrinkY = (y2-y1) * 0.02;
  x1 += shrinkX; x2 -= shrinkX; y1 += shrinkY; y2 -= shrinkY;

  // 브래킷만으로는 1행(v1)인지 2행(v2)인지 알 수 없으므로 둘 다 시도한다.
  const results = [];
  for (const rows of [1, 2]) {
    const grid = _validateGrid(ctx, { x1, y1, x2, y2, rows });
    if (grid) results.push(grid);
  }
  return results;
}


// (cols,rows) 조합이 설계된 형태(6→1×6, 10→2×5)와 정확히 일치해야 한다 —
// 단순히 "총 칸 수가 6 또는 10"이라는 조건만으로는, 예컨대 우연히
// "10열×1행"처럼 실제로 만들어지지 않는 형태가 나와도 통과시켜 버리고,
// 그 형태를 전제로 계산하는 캘리브레이션 ROI 위치 역산이 전부 틀어진다.
function _validateGrid(ctx, cand) {
  const { x1, y1, x2, y2, rows } = cand;
  const w = x2 - x1, h = y2 - y1;
  if (w <= 0 || h <= 0) return null;

  const firstBandH = h / rows;
  const yc = Math.round(y1 + firstBandH/2);
  const cols = _countRunsHoriz(ctx, x1, x2, yc);
  if (cols < 2) return null;

  const validShape = (cols === 6 && rows === 1) || (cols === 5 && rows === 2);
  if (!validShape) return null;

  const cellW = w / cols;
  const cellH = h / rows;
  const squareness = Math.max(cellW, cellH) / Math.min(cellW, cellH);
  if (squareness > 1.6) return null;

  return { x1, y1, x2, y2, w, h, cols, rows, cellW, cellH };
}

// 가로선 위에서 흰색 경계선으로 구분되는 색상 구간 개수를 센다.
function _countRunsHoriz(ctx, x1, x2, y) {
  const W = ctx.canvas.width;
  const xs = Math.max(0, Math.round(x1));
  const xe = Math.min(W-1, Math.round(x2));
  if (xe <= xs) return 0;
  const row = ctx.getImageData(xs, Math.max(0,Math.round(y)), xe-xs+1, 1).data;
  let runs = 0, inRun = false;
  for (let i = 0; i < row.length; i += 4) {
    const r=row[i], g=row[i+1], b=row[i+2];
    const isWhite = r>220 && g>220 && b>220;
    if (!isWhite) { if (!inRun) { runs++; inRun=true; } } else { inRun = false; }
  }
  return runs;
}

// ── 2·3단계: 로고 캘리브레이션 ROI 역산 + 실측 ───────────────
// 그리드의 실측 스케일(cellW / 디자인 CODE_CELL)로부터 로고 원점을
// 역산하고, hondi-code.js가 내보내는 고정 ROI 좌표를 그대로 스케일해
// 실측한다. 별도 색상 검색 없이 "위치 계산 → 그 자리 평균색"만 한다 —
// 데이터 팔레트와 로고 색이 같아도 서로 다른 자리를 보므로 충돌이 없다.
function _sampleCalibRegions(ctx, grid) {
  const scale = grid.cellW / CODE_CELL;
  const gridStartXDesign = _designGridStartX(grid.cols);
  const originX = grid.x1 - gridStartXDesign * scale;
  const originY = grid.y1 - DESIGN_GRID_Y * scale;

  const toFrame = (roi) => ({
    x: originX + roi.x * scale,
    y: originY + roi.y * scale,
    w: roi.w * scale,
    h: roi.h * scale,
  });

  return {
    red:   _avgColor(ctx, toFrame(CALIB_RED_ROI)),
    blue:  _avgColor(ctx, toFrame(CALIB_BLUE_ROI)),
    black: _avgColor(ctx, toFrame(CALIB_BLACK_ROI)),
    white: _avgColor(ctx, toFrame(CALIB_WHITE_ROI)),
  };
}

// ── 4단계: 셀 색상 읽기 ────────────────────────────────────────
function _decode(ctx, grid) {
  const measured = _sampleCalibRegions(ctx, grid);
  if (!_plausible(measured)) return null;   // 존재 확인 게이트

  const matrix = buildCalibMatrix(measured);

  const { x1, y1, cols, rows, cellW, cellH } = grid;
  const indices = [];
  for (let i = 0; i < cols*rows; i++) {
    const row = Math.floor(i / cols), col = i % cols;
    const roi = {
      x: x1 + col*cellW + cellW*(1-CELL_SAMPLE)/2,
      y: y1 + row*cellH + cellH*(1-CELL_SAMPLE)/2,
      w: cellW*CELL_SAMPLE,
      h: cellH*CELL_SAMPLE,
    };
    const raw = _avgColor(ctx, roi);
    indices.push(rgbToIndex(applyCalib(raw, matrix)));
  }

  const version = rows*cols === 10 ? 'v2' : 'v1';
  const shortId = indicesToId(indices);
  return { shortId, version, grid };
}

// ── 오버레이 ──────────────────────────────────────────────────
function _drawOverlay(result, W, H) {
  if (!_overlayCanvas) return;
  _overlayCanvas.width=W; _overlayCanvas.height=H;
  const oc = _overlayCanvas.getContext('2d');
  oc.clearRect(0,0,W,H);
  if (!result) return;

  const { grid } = result;
  oc.strokeStyle='rgba(255,220,0,0.9)';
  oc.lineWidth=2;
  oc.strokeRect(grid.x1, grid.y1, grid.w, grid.h);

  oc.strokeStyle='rgba(255,255,255,0.5)';
  oc.lineWidth=1;
  for (let c=1; c<grid.cols; c++) {
    const x = grid.x1 + grid.cellW*c;
    oc.beginPath(); oc.moveTo(x, grid.y1); oc.lineTo(x, grid.y2); oc.stroke();
  }
  for (let r=1; r<grid.rows; r++) {
    const y = grid.y1 + grid.cellH*r;
    oc.beginPath(); oc.moveTo(grid.x1, y); oc.lineTo(grid.x2, y); oc.stroke();
  }
}

// ── 유틸 ──────────────────────────────────────────────────────
function _avgColor(ctx, {x,y,w,h}) {
  const cw=ctx.canvas.width, ch=ctx.canvas.height;
  const ix=Math.max(0,Math.min(cw-1,Math.round(x)));
  const iy=Math.max(0,Math.min(ch-1,Math.round(y)));
  const iw=Math.max(1,Math.min(cw-ix,Math.round(w)));
  const ih=Math.max(1,Math.min(ch-iy,Math.round(h)));
  const d=ctx.getImageData(ix,iy,iw,ih).data;
  let r=0,g=0,b=0,n=0;
  for(let i=0;i<d.length;i+=4){r+=d[i];g+=d[i+1];b+=d[i+2];n++;}
  return n?{r:r/n,g:g/n,b:b/n}:{r:128,g:128,b:128};
}

function _playBeep() {
  try {
    const ac=new(window.AudioContext||window.webkitAudioContext)();
    const osc=ac.createOscillator(),gain=ac.createGain();
    osc.connect(gain);gain.connect(ac.destination);
    osc.frequency.value=1320;
    gain.gain.setValueAtTime(0.18,ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.12);
    osc.start();osc.stop(ac.currentTime+0.12);
  }catch{}
}

function _showDebugDump(data) {
  try {
    let el=document.getElementById('hs-debug-dump');
    if(!el){el=document.createElement('div');el.id='hs-debug-dump';
      el.style.cssText='position:fixed;left:10px;right:10px;bottom:10px;z-index:999999;background:#111;color:#7CFC8A;font:11px/1.45 monospace;padding:12px;border-radius:12px;max-height:42vh;overflow:auto';
      document.body.appendChild(el);}
    el.innerHTML='';
    const text=JSON.stringify(data,(k,v)=>typeof v==='bigint'?v.toString():v,2);
    const title=document.createElement('div');title.textContent='🩺 스캐너 v7.0 진단';
    title.style.cssText='color:#fff;font-weight:bold;margin-bottom:8px';
    const pre=document.createElement('pre');pre.style.cssText='margin:0 0 10px;white-space:pre-wrap;word-break:break-all';pre.textContent=text;
    const row=document.createElement('div');row.style.display='flex';
    const copyBtn=document.createElement('button');
    copyBtn.textContent='📋 복사';copyBtn.style.cssText='flex:1;padding:8px;border-radius:8px;border:none;background:#7CFC8A;color:#102010;font-weight:bold;margin-right:8px';
    copyBtn.onclick=async()=>{try{await navigator.clipboard.writeText(text);copyBtn.textContent='✅';}catch(e){copyBtn.textContent='❌';}};
    const closeBtn=document.createElement('button');closeBtn.textContent='닫기';
    closeBtn.style.cssText='padding:8px 16px;border-radius:8px;border:none;background:#333;color:#fff';
    closeBtn.onclick=()=>el.remove();
    row.appendChild(copyBtn);row.appendChild(closeBtn);
    el.appendChild(title);el.appendChild(pre);el.appendChild(row);
  }catch(e){console.error(e);}
}

function _status(msg){_onStatus?.(msg);}

// ── L1 프로필 조회 ───────────────────────────────────────────
export async function lookupProfile(shortId, version) {
  const sid=shortId.toString();
  const LOCAL={
    '2577410713':{guid:'hondi-ai',handle:'hondi',name:'혼디',url:'/profiles/5zvxrthQVkz.html'},
    '2537012854':{guid:'hondi-ai',handle:'hondi',name:'혼디',url:'/profiles/2537012854.html'},
  };
  if(LOCAL[sid]) return LOCAL[sid];
  try{
    const base=L1_URL.replace('/api/collections/profiles/records','');
    let res=await fetch(`${base}/api/collections/profiles/records?filter=(hondi_code_id='${sid}')&perPage=1`,{signal:AbortSignal.timeout(5000)});
    if(res.status===400) res=await fetch(`${base}/api/collections/profiles/records?filter=(handle='${sid}')&perPage=1`,{signal:AbortSignal.timeout(5000)});
    if(!res.ok) throw new Error(`L1 오류: ${res.status}`);
    const data=await res.json();
    if(!data.items?.length) throw new Error(`등록되지 않은 코드 (${sid})`);
    const p=data.items[0];
    return{guid:p.ipv6||p.id,handle:p.handle,name:p.name||p.nickname||p.handle,
           url:p.hondi_code_id?`/profiles/${p.hondi_code_id}.html`:`https://app.naviweb.kr/profile?id=${p.id}`};
  }catch(e){throw new Error(`프로필 조회 실패: ${e.message}`);}
}
