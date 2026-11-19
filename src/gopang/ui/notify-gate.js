// (재배포 트리거 2026-11-19)
// notify-gate.js — 알림 허용 유도 (2026-11-16, 주피터 지시: "가입자는 디폴트로 알림 허용으로 유도. 알림을 허용하지 않으면 나비웹을 이용할 이유가 없다")
// 브라우저 알림 권한은 코드로 강제할 수 없다 — 대신 로그인한 상태에서 알림이 허용되지 않았거나 푸시 구독이 없으면, 허용할 때까지
// 앱을 열 때마다 전체 화면 안내를 띄운다. 허용 창이 막힌 '차단' 상태에서는 풀어야 하는 방법을 단계별로 보여 주고 다시 확인할 수 있게 한다.
const OVERLAY_ID = 'notify-gate';
const SKIP_KEY = 'navi_notify_gate_skip_until';
const SKIP_MS = 10 * 60 * 1000;   // '나중에' — 이번 접속 동안만 잠깐(10분). 다음에 열면 다시 뜬다.

const _supported = () => typeof Notification !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
const _me = () => { try { return JSON.parse(localStorage.getItem('gopang_user_v4') || 'null')?.ipv6 || null; } catch { return null; } };
const _loginOpen = () => !!document.getElementById('ksa-overlay');

async function _subscribe(guid) {
  const { requestPushSubscription } = await import('../services/push.js');
  return requestPushSubscription(guid);
}
async function _hasSub() {
  try { const reg = await navigator.serviceWorker.ready; return !!(await reg.pushManager.getSubscription()); } catch { return false; }
}

function _remove() { document.getElementById(OVERLAY_ID)?.remove(); }

// ── 배터리 보호 해제 묻기 (2026-11-19, 주피터 지시: 긴 설명 대신 "네/아니오" 팝업. 폰·안드로이드 버전마다 메뉴가 달라 사용자가 따라 하기 어렵다) ──
// 웹 페이지는 배터리 설정을 직접 바꿀 수 없다(브라우저 제한). 안드로이드 앱(kr.naviweb.app)은 앱 안에서 직접 요청하므로 이 팝업이 필요 없다.
// 그래서 브라우저에서는 "네"를 누르면 가능한 만큼(설정 화면 열기)만 하고, 안 열리면 한 줄 안내로 끝낸다.
const SOUND_KEY = 'navi_notify_sound_guided';
const _isAndroid = () => /Android/i.test(navigator.userAgent || '');
const _inNativeApp = () => /; wv\)|NaviApp/i.test(navigator.userAgent || '') || !!window.NaviAndroid;
function _soundGuideDone() { try { return localStorage.getItem(SOUND_KEY) === '1'; } catch { return true; } }
function _markSoundGuide() { try { localStorage.setItem(SOUND_KEY, '1'); } catch {} }
const _CARD = 'max-width:420px;width:100%;max-height:calc(100vh - 40px);overflow-y:auto;background:#fff;border-radius:16px;padding:24px 22px;box-shadow:0 10px 40px rgba(0,0,0,.35)';
const _OVER = 'position:fixed;inset:0;z-index:2147483001;background:rgba(15,23,42,.72);display:flex;align-items:center;justify-content:center;padding:20px;font-family:inherit';
const _BTN_YES = 'flex:1;padding:14px;border:0;border-radius:12px;background:#1A73E8;color:#fff;font-size:16px;font-weight:700;cursor:pointer';
const _BTN_NO = 'flex:1;padding:14px;border:0;border-radius:12px;background:#e2e8f0;color:#334155;font-size:16px;font-weight:700;cursor:pointer';
function _renderSoundGuide() {
  if (!_isAndroid() || _inNativeApp() || _soundGuideDone() || document.getElementById('notify-sound-guide')) return;
  const el = document.createElement('div');
  el.id = 'notify-sound-guide';
  el.setAttribute('role', 'dialog');
  el.style.cssText = _OVER;
  el.innerHTML = `
    <div style="${_CARD}">
      <div style="font-size:19px;font-weight:700;color:#0f172a;line-height:1.5">🔋 배터리 보호를 해제하여, 폰이 꺼진 상태에서도 대화 초청 등의 알림을 받겠습니까?</div>
      <div style="display:flex;gap:10px;margin-top:20px"><button id="nsg-no" style="${_BTN_NO}">아니오</button><button id="nsg-yes" style="${_BTN_YES}">네</button></div>
      <div id="nsg-msg" style="margin-top:12px;font-size:14px;line-height:1.6;color:#334155"></div>
    </div>`;
  document.body.appendChild(el);
  const close = () => { _markSoundGuide(); el.remove(); };
  el.querySelector('#nsg-no').onclick = close;
  el.querySelector('#nsg-yes').onclick = () => {
    const msg = el.querySelector('#nsg-msg');
    const yes = el.querySelector('#nsg-yes'), no = el.querySelector('#nsg-no');
    let left = false;
    const onHide = () => { if (document.visibilityState === 'hidden') left = true; };
    document.addEventListener('visibilitychange', onHide);
    try { location.href = 'intent:#Intent;action=android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS;end'; } catch {}
    setTimeout(() => {
      document.removeEventListener('visibilitychange', onHide);
      if (left) { close(); return; }                       // 설정 화면이 열렸다 — 돌아오면 끝
      msg.innerHTML = '이 브라우저에서는 웹이 설정을 직접 바꿀 수 없습니다.<br>폰 <b>설정 → 앱 → Chrome(또는 나비) → 배터리 → 제한 없음</b>으로 바꿔 주세요.';
      yes.textContent = '확인'; yes.onclick = close; no.style.display = 'none';
    }, 1500);
  };
}

function _render(state) {
  let el = document.getElementById(OVERLAY_ID);
  if (el && el.dataset.state === state) return;   // 같은 안내를 다시 그려 입력·문구를 지우지 않는다
  if (!el) {
    el = document.createElement('div');
    el.id = OVERLAY_ID;
    el.setAttribute('role', 'dialog');
    el.style.cssText = _OVER.replace('2147483001', '2147483000');
    document.body.appendChild(el);
  }
  el.dataset.state = state;
  const denied = state === 'denied';
  el.innerHTML = `
    <div style="${_CARD}">
      <div style="font-size:19px;font-weight:700;color:#0f172a;line-height:1.5">🔔 나비웹과 대화 초대 등의 알림을 받겠습니까?</div>
      ${denied ? '<p style="margin:12px 0 0;font-size:14px;line-height:1.6;color:#b91c1c">크롬에서 나비웹 알림이 차단돼 있습니다. 주소창 왼쪽 아이콘 → <b>권한</b> → <b>알림 허용</b>으로 바꾼 뒤 <b>네</b>를 눌러 주세요.</p>' : ''}
      <div style="display:flex;gap:10px;margin-top:20px"><button id="notify-gate-later" style="${_BTN_NO}">아니오</button><button id="notify-gate-go" style="${_BTN_YES}">네</button></div>
      <div id="notify-gate-msg" style="margin-top:10px;font-size:13px;color:#b45309;min-height:16px"></div>
    </div>`;
  const msg = el.querySelector('#notify-gate-msg');
  el.querySelector('#notify-gate-go').onclick = async () => {
    const guid = _me();
    try {
      if (Notification.permission === 'default') await Notification.requestPermission().catch(() => {});
      if (Notification.permission === 'denied') { el.dataset.state = ''; _render('denied'); return; }
      if (Notification.permission === 'granted') {
        msg.textContent = '알림을 켜는 중…';
        const r = guid ? await _subscribe(guid) : { ok: false, reason: 'login_required' };
        if (r.ok || (await _hasSub())) { _remove(); _renderSoundGuide(); return; }
        msg.textContent = '알림 등록에 실패했습니다(' + (r.reason || '오류') + '). 잠시 후 다시 눌러 주세요.';
      }
    } catch (e) { msg.textContent = '오류: ' + (e.message || e); }
  };
  el.querySelector('#notify-gate-later').onclick = () => {
    try { sessionStorage.setItem(SKIP_KEY, String(Date.now() + SKIP_MS)); } catch {}
    _remove();
  };
}

export async function checkNotifyGate() {
  try {
    if (!_supported() || !_me() || _loginOpen()) return;
    let skip = 0; try { skip = Number(sessionStorage.getItem(SKIP_KEY)) || 0; } catch {}
    if (Date.now() < skip) return;
    if (Notification.permission === 'granted') {
      if (await _hasSub()) { _remove(); _renderSoundGuide(); return; }
      const r = await _subscribe(_me());           // 허용돼 있는데 구독만 없는 경우 — 조용히 맞춘다
      if (r.ok || (await _hasSub())) { _remove(); return; }
      _render('default'); return;                    // 맞추지 못하면 안내를 띄워 다시 시도하게 한다
    }
    _render(Notification.permission === 'denied' ? 'denied' : 'default');
  } catch { /* 안내 실패가 앱을 막지 않는다 */ }
}

export function startNotifyGate() {
  const run = () => setTimeout(checkNotifyGate, 1200);
  if (document.readyState === 'complete') run(); else window.addEventListener('load', run, { once: true });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkNotifyGate(); });
  setInterval(checkNotifyGate, 5 * 1000);            // 가입·로그인 직후에도 바로 안내가 뜨도록(이미 허용이면 비용 없음)
}
