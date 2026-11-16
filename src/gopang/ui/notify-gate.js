// (재배포 트리거 2026-11-16)
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

function _render(state) {
  let el = document.getElementById(OVERLAY_ID);
  if (el && el.dataset.state === state) return;   // 같은 안내를 다시 그려 입력·문구를 지우지 않는다
  if (!el) {
    el = document.createElement('div');
    el.id = OVERLAY_ID;
    el.setAttribute('role', 'dialog');
    el.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,42,.72);display:flex;align-items:center;justify-content:center;padding:20px;font-family:inherit';
    document.body.appendChild(el);
  }
  el.dataset.state = state;
  const denied = state === 'denied';
  const steps = denied
    ? `<ol style="margin:10px 0 0;padding-left:20px;font-size:14px;line-height:1.7;color:#334155">
         <li>크롬 오른쪽 위 <b>⋮</b> → <b>설정</b> → <b>사이트 설정</b> → <b>알림</b>을 엽니다.</li>
         <li>목록에서 <b>naviweb.kr</b>을 찾아 <b>허용</b>으로 바꿉니다. (보이지 않으면 사이트 정보의 <b>권한 재설정</b>을 누릅니다.)</li>
         <li>이 화면으로 돌아와 아래 <b>다시 확인</b>을 누릅니다.</li>
       </ol>`
    : `<p style="margin:12px 0 0;font-size:16px;line-height:1.7;color:#0f172a;font-weight:600">아래 버튼을 누르면 화면에 <b>알림 허용</b> 창이 뜹니다.<br>거기서 <b style="color:#1A73E8">허용</b>만 누르면 끝입니다.</p>`;
  el.innerHTML = `
    <div style="max-width:420px;width:100%;background:#fff;border-radius:16px;padding:24px 22px;box-shadow:0 10px 40px rgba(0,0,0,.35)">
      <div style="font-size:20px;font-weight:700;color:#0f172a">🔔 알림을 허용해 주세요</div>
      <p style="margin:12px 0 0;font-size:15px;line-height:1.65;color:#1e293b">나비웹은 알림으로 <b>대화 요청·호출·승인 요청</b>을 바로 전해 드립니다. 알림이 꺼져 있으면 앱을 열어 두지 않은 동안에는 상대의 호출이나 PC 로그인 승인을 받을 수 없습니다.</p>
      ${denied ? '<p style="margin:10px 0 0;font-size:14px;color:#b91c1c;font-weight:600">지금 이 브라우저에서 나비웹 알림이 차단돼 있습니다.</p>' : ''}
      ${steps}
      <button id="notify-gate-go" style="margin-top:18px;width:100%;padding:14px;border:0;border-radius:12px;background:#1A73E8;color:#fff;font-size:16px;font-weight:700;cursor:pointer">${denied ? '다시 확인' : '알림 허용하기'}</button>
      <div style="text-align:center;margin-top:12px"><a id="notify-gate-later" href="#" style="font-size:13px;color:#64748b">나중에 (10분 뒤 다시 안내)</a></div>
      <div id="notify-gate-msg" style="margin-top:8px;font-size:13px;color:#b45309;min-height:16px"></div>
    </div>`;
  const msg = el.querySelector('#notify-gate-msg');
  el.querySelector('#notify-gate-go').onclick = async () => {
    const guid = _me();
    try {
      if (Notification.permission === 'default') await Notification.requestPermission().catch(() => {});
      if (Notification.permission === 'denied') { _render('denied'); return; }
      if (Notification.permission === 'granted') {
        msg.textContent = '알림을 켜는 중…';
        const r = guid ? await _subscribe(guid) : { ok: false, reason: 'login_required' };
        if (r.ok || (await _hasSub())) { _remove(); return; }
        msg.textContent = '알림 등록에 실패했습니다(' + (r.reason || '오류') + '). 잠시 후 다시 눌러 주세요.';
      }
    } catch (e) { msg.textContent = '오류: ' + (e.message || e); }
  };
  el.querySelector('#notify-gate-later').onclick = (e) => {
    e.preventDefault();
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
      if (await _hasSub()) { _remove(); return; }
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
