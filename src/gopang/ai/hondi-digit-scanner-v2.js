/**
 * hondi-digit-scanner-v2.js — 혼디 숫자 코드 스캐너 v2 (가변 자릿수 1~10, 로고 기준)
 * 분석 로직은 전부 hondi-digit-core.js(브라우저/Node 공용, 시뮬레이션 테스트 대상). 여기는 카메라·확정·UI 연결만 한다.
 * 기존 hondi-digit-scanner.js(고정 10칸, 전화번호 방식)는 건드리지 않는다 — link-scan.html 등이 아직 사용 중.
 */
import { analyzeGray } from './hondi-digit-core.js';

const SCAN_MS = Math.round(1000 / 15);
export const LOCK_FRAMES = 3;

const REASON_HINT = {
  'no-ink': '코드를 화면에 비춰주세요.',
  'no-logo': '"hondi.net" 로고와 숫자가 함께 보이도록 비춰주세요.',
  'row-clipped': '숫자열이 화면 끝에 걸렸어요. 조금 더 멀리서 비춰주세요.',
  'not-left-aligned': '숫자열이 잘렸을 수 있어요. 로고와 숫자를 모두 화면 안에 넣어주세요.',
  'too-wide': '숫자열이 로고보다 넓어요. 코드 전체가 보이게 다시 비춰주세요.',
  'logo-scale-mismatch': '코드가 아닌 것 같아요. 숫자 코드를 정면에서 비춰주세요.',
  'low-certainty': '조금 흐려요. 초점을 맞추고 잠시 멈춰주세요.',
  'bad-pattern': '숫자가 또렷하지 않아요. 조명을 확인해 주세요.',
  'no-boxes': '숫자 칸을 찾지 못했어요. 더 가까이 비춰주세요.',
  'box-aspect': '비스듬해요. 정면에서 비춰주세요.',
  'box-width-inconsistent': '일부가 가려졌거나 잘렸어요.',
  'pitch-inconsistent': '칸 간격이 고르지 않아요. 정면에서 비춰주세요.',
  'boxes-merged': '너무 멀거나 흐려요. 더 가까이 비춰주세요.',
};

let _stream = null, _rafId = null, _lastTime = 0, _lockCount = 0, _lastKey = null, _locked = false;
let _hint = null, _frameNo = 0;      // 직전에 성공한 회전/원근 보정값(추적) · 프레임 번호
let _onResult = null, _onStatus = null, _onFrame = null, _overlay = null;

export async function startScanner(video, canvas, overlayCanvas, onResult, onStatus, onFrame) {
  _onResult = onResult; _onStatus = onStatus; _onFrame = onFrame; _overlay = overlayCanvas;
  _lockCount = 0; _lastKey = null; _locked = false; _hint = null; _frameNo = 0;
  try {
    _stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
    });
    video.srcObject = _stream; await video.play();
    _onStatus?.('"hondi.net" 로고와 숫자열이 함께 보이게 비춰주세요.');
    _schedule(video, canvas);
  } catch (e) {
    const msg = e.name === 'NotAllowedError' ? '카메라 권한이 거부됐습니다. 설정에서 허용해 주세요.'
      : e.name === 'NotFoundError' ? '카메라를 찾을 수 없습니다.'
      : e.name === 'NotReadableError' ? '카메라가 다른 앱에서 사용 중입니다.' : `카메라 오류: ${e.message}`;
    _onStatus?.(msg); throw e;
  }
}
export function stopScanner() {
  if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
  if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
}
function _schedule(video, canvas) {
  _rafId = requestAnimationFrame(ts => {
    if (_locked) return;
    if (ts - _lastTime >= SCAN_MS) { _lastTime = ts; _frame(video, canvas); }
    _schedule(video, canvas);
  });
}

function toGray(imageData) {
  const d = imageData.data, n = imageData.width * imageData.height, g = new Uint8Array(n);
  for (let i = 0; i < n; i++) g[i] = Math.round((d[i*4] + d[i*4+1] + d[i*4+2]) / 3);   // 기존 스캐너와 동일 공식
  return g;
}
function analyzeImageData(imageData, opts = {}) {
  const t0 = performance.now();
  const r = analyzeGray(toGray(imageData), imageData.width, imageData.height, opts);
  r.ms = performance.now() - t0;
  return r;
}

function _frame(video, canvas) {
  if (video.readyState < 2) return;
  const W = video.videoWidth, H = video.videoHeight;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0);
  // 회전·원근 보정 탐색은 비싸다(수백 ms) → 매 6번째 프레임에서만 시도하고, 성공하면 그 보정값을 다음 프레임에 재사용한다.
  _frameNo++;
  const r = analyzeImageData(ctx.getImageData(0, 0, W, H), { transformHint: _hint, noRescue: _frameNo % 6 !== 0 });
  if (r.ok) _hint = r.transform || null;
  _drawOverlay(r, W, H);
  _onFrame?.(r);                                    // 테스트 페이지용: 프레임마다 결과/사유 전달
  if (!r.ok) { _lockCount = 0; _lastKey = null; _onStatus?.(REASON_HINT[r.reason] || `인식 중… (${r.reason})`); return; }
  const key = `${r.n}:${r.serial}`;                 // 자릿수까지 같아야 같은 결과로 친다
  if (key === _lastKey) _lockCount++; else { _lockCount = 1; _lastKey = key; }
  _onStatus?.(`인식 중… ${Math.round(_lockCount / LOCK_FRAMES * 100)}%  (${r.n}자리)`);
  if (_lockCount >= LOCK_FRAMES) {
    _locked = true; stopScanner();
    if (navigator.vibrate) navigator.vibrate([60, 30, 60]);
    _beep();
    _onResult?.(r.serial, r);
  }
}

function _drawOverlay(r, W, H) {
  if (!_overlay) return;
  _overlay.width = W; _overlay.height = H;
  const oc = _overlay.getContext('2d'); oc.clearRect(0, 0, W, H);
  const row = r?.row; if (!row || r.transform) return;      // 보정된 좌표계의 상자는 원본 화면에 그리지 않는다
  oc.lineWidth = 2;
  if (row.logoInk && row.logoRow) { oc.strokeStyle = 'rgba(80,160,255,.9)'; oc.strokeRect(row.logoInk.min, row.logoRow.p1, row.logoInk.max - row.logoInk.min, row.logoRow.p2 - row.logoRow.p1); }
  oc.strokeStyle = r.ok ? 'rgba(60,220,90,.95)' : 'rgba(255,220,0,.9)';
  for (const b of row.boxes) oc.strokeRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1);
}
function _beep() {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)(), o = ac.createOscillator(), g = ac.createGain();
    o.connect(g); g.connect(ac.destination); o.frequency.value = 1320;
    g.gain.setValueAtTime(0.18, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.12);
    o.start(); o.stop(ac.currentTime + 0.12);
  } catch {}
}

/** 정지 사진 1장 분석(파일 선택/스크린샷) */
export function analyzePhoto(imageData, onResult, onStatus) {
  const r = analyzeImageData(imageData);
  if (r.ok) onResult?.(r.serial, r);
  else onStatus?.(REASON_HINT[r.reason] || `인식 실패 (${r.reason})`);
  return r;
}

/** 번호 → 상태/소유자 조회 (서버: GET /digit/status) */
export async function lookupSerial(serial, base = '') {
  const res = await fetch(`${base}/digit/status?serial=${encodeURIComponent(serial)}`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`조회 실패: ${res.status}`);
  return res.json();
}
