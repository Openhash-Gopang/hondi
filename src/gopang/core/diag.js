/**
 * core/diag.js — 사용자 간 대화(P2P) 간헐 오류 진단 기록기 (2026-11-19, 주피터 지시, 임시).
 *
 * 목적: "될 때도 있고 안 될 때도 있는" 두 증상의 원인을 성공·실패 양쪽 기록으로 비교한다.
 *   ① 호출 알림이 상대에게 가기도 하고 안 가기도 함  ② 수락 후 대화창이 열리기도 하고 AI 비서가 답하기도 함
 * 폰에는 콘솔이 없으므로 기록을 localStorage 에 남기고, 입력창에 "진단" 이라고 치면 환경 요약+기록 전체를 보여 주고 복사한다.
 * 서비스워커의 푸시 수신·알림 클릭 기록(Cache 'navi-diag')도 함께 합쳐 보인다.
 * 원인이 확정되면 이 파일과 호출부를 제거한다. 동작은 바꾸지 않고 기록만 한다(모든 호출은 try/catch).
 */
import { RTC_CONFIG } from './state.js';

export const DIAG_REV = '20261119-1';   // 이 기기가 실제로 실행 중인 코드 판 — 낡은 캐시 코드를 구별한다
const KEY = 'navi_diag_v1', MAX = 400;
let _buf = null;

function _load() {
  if (_buf) return _buf;
  try { _buf = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { _buf = []; }
  if (!Array.isArray(_buf)) _buf = [];
  return _buf;
}

/** 기록 한 줄. tag 는 사건 이름, data 는 짧은 값(객체 가능). */
export function diag(tag, data) {
  try {
    const b = _load();
    b.push({ t: new Date().toISOString(), tag, d: data === undefined ? '' : data });
    if (b.length > MAX) b.splice(0, b.length - MAX);
    try { localStorage.setItem(KEY, JSON.stringify(b)); } catch {}
    console.info('[DIAG]', tag, data === undefined ? '' : data);
  } catch {}
}

/** 이 기기·환경의 현재 상태(알림 권한, 설치 형태, 푸시 구독, 통신망, 코드 판 등). */
export async function diagEnv() {
  const o = { rev: DIAG_REV };
  try { o.mode = matchMedia('(display-mode: standalone)').matches ? 'PWA(설치형)' : (String(document.referrer).startsWith('android-app://') ? 'APK/TWA' : '브라우저 탭'); } catch {}
  try { o.알림권한 = (typeof Notification !== 'undefined') ? Notification.permission : '미지원'; } catch {}
  try { o.화면 = document.visibilityState + (document.hasFocus() ? '/포커스' : '/비포커스'); } catch {}
  try { o.online = navigator.onLine; } catch {}
  try { const c = navigator.connection; o.통신 = c ? [c.type, c.effectiveType, 'rtt' + c.rtt, c.saveData ? 'saveData' : ''].filter(Boolean).join('/') : 'n/a'; } catch {}
  try { o.TURN = (RTC_CONFIG.iceServers || []).some(s => [].concat(s.urls).some(u => /^turns?:/.test(u))) ? '있음' : '없음(STUN만)'; } catch {}
  try { const ks = await caches.keys(); o.SW빌드 = ks.find(k => k.startsWith('gopang-')) || '?'; } catch {}
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    o.SW = reg ? [reg.active ? 'active' : '', reg.waiting ? 'waiting(새 판 대기)' : '', reg.installing ? 'installing' : ''].filter(Boolean).join('+') : '없음';
    o.SW제어 = navigator.serviceWorker.controller ? '제어중' : '제어안됨';
    const sub = reg && reg.pushManager ? await reg.pushManager.getSubscription() : null;
    o.푸시구독 = sub ? new URL(sub.endpoint).host : '없음';
  } catch (e) { o.푸시구독 = '확인실패:' + (e && e.message); }
  try { o.브라우저 = (navigator.userAgent.match(/(Chrome|Edg|SamsungBrowser|Firefox)\/[\d.]+/) || [''])[0]; } catch {}
  return o;
}

/** RTCPeerConnection 의 후보 종류와 선택된 경로를 요약한다(연결이 열렸을 때·실패했을 때 호출). */
export async function diagConn(conn, why) {
  try {
    const st = await conn.getStats();
    const loc = {}, rem = {}, byId = {}, pairs = [];
    st.forEach(r => {
      byId[r.id] = r;
      if (r.type === 'local-candidate') loc[r.candidateType] = (loc[r.candidateType] || 0) + 1;
      if (r.type === 'remote-candidate') rem[r.candidateType] = (rem[r.candidateType] || 0) + 1;
      if (r.type === 'candidate-pair') pairs.push(r);
    });
    const ok = pairs.find(p => p.nominated && p.state === 'succeeded') || pairs.find(p => p.state === 'succeeded');
    const tally = pairs.reduce((a, p) => { a[p.state] = (a[p.state] || 0) + 1; return a; }, {});
    const sel = ok ? `${(byId[ok.localCandidateId] || {}).candidateType}↔${(byId[ok.remoteCandidateId] || {}).candidateType}/${(byId[ok.localCandidateId] || {}).protocol || ''}` : '없음';
    const s = { 사유: why, 내후보: loc, 상대후보: rem, 선택경로: sel, 쌍상태: tally, conn: conn.connectionState, ice: conn.iceConnectionState };
    diag('conn:요약', s);
    return s;
  } catch (e) { diag('conn:요약실패', e && e.message); return null; }
}

function _esc(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function _fmt(v) { try { return typeof v === 'string' ? v : JSON.stringify(v); } catch { return String(v); } }

/** 서비스워커가 남긴 기록(Cache 'navi-diag')을 읽는다. */
async function _swEntries() {
  try {
    const c = await caches.open('navi-diag');
    const r = await c.match('/__diag_sw');
    const a = r ? await r.json() : [];
    return Array.isArray(a) ? a.map(e => ({ ...e, tag: 'SW:' + e.tag })) : [];
  } catch { return []; }
}

/** 화면·복사용 전체 보고서 텍스트. */
export async function diagReport(maxLines = 120) {
  const env = await diagEnv();
  const all = _load().concat(await _swEntries()).sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0)).slice(-maxLines);
  const head = '■ 환경\n' + Object.entries(env).map(([k, v]) => `${k}: ${_fmt(v)}`).join('\n');
  const body = '\n\n■ 기록(KST 시각)\n' + all.map(e => {
    const kst = new Date(new Date(e.t).getTime() + 9 * 3600e3).toISOString().slice(5, 23).replace('T', ' ');
    return `${kst} ${e.tag} ${e.d === '' ? '' : _fmt(e.d)}`;
  }).join('\n');
  return head + body;
}

/** 입력창에 "진단"을 쳤을 때: 보고서를 대화창에 보이고 클립보드에도 복사한다. 처리했으면 true. */
export async function diagHandleCommand(text, appendBubble) {
  const t = String(text || '').trim();
  if (t !== '진단' && t !== '/진단' && t !== '진단 지우기') return false;
  if (t === '진단 지우기') {
    try { localStorage.removeItem(KEY); _buf = []; const c = await caches.open('navi-diag'); await c.delete('/__diag_sw'); } catch {}
    appendBubble('system', '진단 기록을 지웠습니다.');
    return true;
  }
  const rep = await diagReport();
  let copied = false;
  try { await navigator.clipboard.writeText(rep); copied = true; } catch {}
  appendBubble('system', `<div style="white-space:pre-wrap;font-size:12px;line-height:1.45;text-align:left">${_esc(rep)}</div><div style="margin-top:6px;font-size:12px">${copied ? '📋 클립보드에 복사했습니다.' : '복사하지 못했습니다 — 화면을 캡처해 주세요.'}</div>`, true);
  return true;
}

try { window.naviDiag = { diag, diagEnv, diagConn, diagReport, DIAG_REV }; } catch {}
