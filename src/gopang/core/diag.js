/**
 * core/diag.js — 사용자 간 대화(P2P) 간헐 오류 진단 기록기 (2026-11-19, 주피터 지시, 임시).
 *
 * 목적: "될 때도 있고 안 될 때도 있는" 두 증상의 원인을 성공·실패 양쪽 기록으로 비교한다.
 *   ① 호출 알림이 상대에게 가기도 하고 안 가기도 함  ② 수락 후 대화창이 열리기도 하고 AI 비서가 답하기도 함
 * 폰에는 콘솔이 없으므로 기록을 localStorage 에 남기고, 입력창에 "진단" 이라고 치면 환경 요약+기록 전체를 보여 주고 복사한다.
 * 서비스워커의 푸시 수신·알림 클릭 기록(Cache 'navi-diag')도 함께 합쳐 보인다.
 * 원인이 확정되면 이 파일과 호출부를 제거한다. 동작은 바꾸지 않고 기록만 한다(모든 호출은 try/catch).
 */
import { RTC_CONFIG, _USER, USER_GUID } from './state.js';
import { diagVerdict } from './diag-verdict.js';

export const DIAG_REV = '20261119-3';   // 이 기기가 실제로 실행 중인 코드 판 — 낡은 캐시 코드를 구별한다
const KEY = 'navi_diag_v1', MAX = 400;
let _buf = null;

// 같은 기기에서 창(PWA·브라우저 탭)이 둘 이상 열려 있거나 앱이 새로고침되면 각 창이 자기 메모리 사본으로 저장소를 덮어써 기록이 사라진다.
// 그래서 쓸 때마다 저장소에서 다시 읽어 합친다.
function _load(fresh) {
  if (_buf && !fresh) return _buf;
  try { _buf = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { _buf = []; }
  if (!Array.isArray(_buf)) _buf = [];
  return _buf;
}

/** 기록 한 줄. tag 는 사건 이름, data 는 짧은 값(객체 가능). */
export function diag(tag, data) {
  try {
    const b = _load(true);
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
    // 2026-11-19 — 검사 요청에 응답이 아예 없는지(막힘) 응답은 오는데 실패인지 가르기 위한 합계와, 쌍을 유형별로 센 표(상위 6개).
    let reqS = 0, resR = 0, bytesS = 0, bytesR = 0; const kinds = {};
    pairs.forEach(p => {
      reqS += p.requestsSent || 0; resR += p.responsesReceived || 0; bytesS += p.bytesSent || 0; bytesR += p.bytesReceived || 0;
      const l = byId[p.localCandidateId] || {}, r = byId[p.remoteCandidateId] || {};
      const k = `${l.candidateType || '?'}/${l.protocol || '?'}→${r.candidateType || '?'}/${r.protocol || '?'}:${p.state}`;
      kinds[k] = (kinds[k] || 0) + 1;
    });
    const top = Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => k + '×' + n);
    const s = { 사유: why, 내후보: loc, 상대후보: rem, 선택경로: sel, 쌍상태: tally, 검사: { 보냄: reqS, 응답: resR, 바이트송신: bytesS, 바이트수신: bytesR }, 쌍유형: top, conn: conn.connectionState, ice: conn.iceConnectionState };
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

/** 서버 쪽 알림 등록 상태 점검(/signal/diag). test 이면 등록 기기마다 시험 알림도 보낸다. 실패해도 던지지 않는다. */
async function _serverCheck(test) {
  try {
    const { signalPost } = await import('../p2p/signal-auth.js');
    const guid = (_USER && _USER.ipv6) || USER_GUID || null;
    if (!guid) return { server: null, err: '로그인 정보 없음' };
    const r = await Promise.race([signalPost('/signal/diag', guid, test ? { test: true } : {}), new Promise(res => setTimeout(() => res({ ok: false, status: 0, code: '시간초과(10초)' }), 10000))]);
    if (!r.ok) return { server: null, err: `HTTP ${r.status}${r.code ? ' ' + r.code : ''}` };
    return { server: r.data, err: '' };
  } catch (e) { return { server: null, err: (e && e.message) || '오류' }; }
}

const _ICON = { 원인: '🔴', 주의: '🟡', 정상: '🟢' };

/** 입력창에 "진단"을 쳤을 때: 원인 판정 + 환경·서버·기록을 대화창에 보이고 클립보드에도 복사한다. 처리했으면 true.
 *  "진단 시험" 은 내 계정의 등록 기기마다 시험 알림을 보내 결과를 함께 판정한다. "진단 지우기" 는 기록을 지운다. */
export async function diagHandleCommand(text, appendBubble) {
  const t = String(text || '').trim();
  if (!['진단', '/진단', '진단 시험', '진단 지우기'].includes(t)) return false;
  if (t === '진단 지우기') {
    try { localStorage.removeItem(KEY); _buf = []; const c = await caches.open('navi-diag'); await c.delete('/__diag_sw'); } catch {}
    appendBubble('system', '진단 기록을 지웠습니다.');
    return true;
  }
  const test = t === '진단 시험';
  appendBubble('system', test ? '진단 중입니다… 등록된 기기에 시험 알림을 보냅니다.' : '진단 중입니다…');

  let localDeviceId = '', hasFcmToken = false;
  try { const ps = await import('../services/push.js'); localDeviceId = ps.getOrCreateDeviceId(); hasFcmToken = !!ps.getAppFcmToken(); } catch {}
  const env = await diagEnv();
  const { server, err } = await _serverCheck(test);
  const entries = _load(true).concat(await _swEntries()).sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  const verdict = diagVerdict({ env, server, serverErr: err, entries, localDeviceId, hasFcmToken });
  try { diag('진단:판정', { 원인: verdict.filter(v => v.lv === '원인').length, 서버: server ? { l1: server.l1, 기기: (server.devices || []).length, vapid: server.vapid, fcm: server.fcm } : ('실패:' + err) }); } catch {}

  const vText = '■ 원인 판정\n' + verdict.map(v => `${_ICON[v.lv]} [${v.lv}] ${v.msg}`).join('\n');
  const srvText = server
    ? '\n\n■ 서버(내 계정)\n' + [`계정 저장소: ${server.l1}`, `웹 푸시 키: ${server.vapid ? '있음' : '없음'}`, `앱 푸시 계정: ${server.fcm ? '있음' : '없음'}`]
        .concat((server.devices || []).map(d => `기기 ${d.id}: ${d.kind === 'fcm' ? '앱' : '웹'}/${d.type}${d.host ? '/' + d.host : ''} 등록 ${d.updatedAt ? new Date(d.updatedAt + 9 * 3600e3).toISOString().slice(5, 16).replace('T', ' ') : '?'}${d.test ? ' / 시험 ' + (d.test.ok ? '성공' : '실패(' + (d.test.status || '무응답') + ')') : ''}`)).join('\n')
    : `\n\n■ 서버(내 계정)\n점검 실패: ${err}`;
  const rep = vText + srvText + '\n\n' + (await diagReport());
  // 화면 표시를 먼저 한다 — 클립보드 복사는 권한 확인·포커스 때문에 끝나지 않을 수 있어 기다리지 않는다.
  appendBubble('system', `<div style="white-space:pre-wrap;font-size:12.5px;line-height:1.5;text-align:left">${_esc(rep)}</div>`, true);
  let copied = false;
  try { await Promise.race([navigator.clipboard.writeText(rep).then(() => { copied = true; }), new Promise(r => setTimeout(r, 2500))]); } catch {}
  appendBubble('system', (copied ? '📋 진단 내용을 클립보드에 복사했습니다. ' : '복사하지 못했습니다 — 위 내용을 화면 캡처해 주세요. ') + (test ? '' : '"진단 시험"이라고 입력하면 내 등록 기기마다 시험 알림을 보냅니다.'));
  return true;
}

// 페이지 생명주기 — 기록이 중간에 끊길 때 "앱이 새로고침됐는지·화면이 백그라운드로 갔는지·서비스워커가 교체됐는지"를 가린다.
try {
  if (!window.__naviDiagLife) {
    window.__naviDiagLife = true;
    const nav = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || {};
    const mode = matchMedia('(display-mode: standalone)').matches ? 'PWA' : '브라우저탭';
    diag('페이지:시작', { rev: DIAG_REV, mode, 이동: nav.type || '?', vis: document.visibilityState });
    document.addEventListener('visibilitychange', () => diag('페이지:가시성', { mode, vis: document.visibilityState }));
    window.addEventListener('pagehide', e => diag('페이지:pagehide', { mode, persisted: !!e.persisted }));
    document.addEventListener('freeze', () => diag('페이지:freeze(동결)', { mode }));
    document.addEventListener('resume', () => diag('페이지:resume', { mode }));
    if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('controllerchange', () => diag('SW:교체(controllerchange)', { mode }));
  }
} catch {}

try { window.naviDiag = { diag, diagEnv, diagConn, diagReport, DIAG_REV }; } catch {}
