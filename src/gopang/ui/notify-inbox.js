/**
 * ui/notify-inbox.js — 앱을 열었을 때 "받았지만 아직 못 본 알림"을 대화창에 보여 준다 (2026-11-18, 주피터 지시).
 * 바탕화면 아이콘에 알림 배지(1)가 떠도 앱을 열면 인사말뿐이라 내용을 확인할 방법이 없었다.
 * 서비스 워커가 띄워 둔 알림(registration.getNotifications)을 읽어 카드로 보이고, 확인하면 알림·배지를 지운다.
 * 한계: 안드로이드 APK(FCM 네이티브) 알림은 서비스 워커가 읽을 수 없다.
 */
const _seen = new Set();

function _card(n) {
  const row = document.createElement('div');
  row.className = 'msg-row system';
  const b = document.createElement('div');
  b.className = 'bubble bubble-system';
  const t = document.createElement('div');
  t.style.fontWeight = '700';
  t.textContent = '🔔 ' + (n.title || '알림');
  const body = document.createElement('div');
  body.textContent = n.body || '';
  const when = document.createElement('div');
  when.style.cssText = 'font-size:.75em;opacity:.7;margin-top:2px';
  try { when.textContent = new Date(n.timestamp || Date.now()).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch {}
  b.append(t, body, when);
  row.appendChild(b);
  return row;
}

export async function showPendingNotifications() {
  try {
    if (!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.ready;
    const list = await reg.getNotifications();
    const pm = document.getElementById('ai-panel-messages');
    if (!pm || !list.length) return;
    // 알림 종류별 사용자 안내 — 초대·전화 알림은 상대가 보낸 시간이 지나면 연결할 수 없으니 다시 요청하라고 알린다.
    for (const n of list) {
      const key = (n.tag || '') + '|' + (n.timestamp || '');
      if (_seen.has(key)) { n.close(); continue; }
      _seen.add(key);
      // 기술용 알림(버전·설정 동기화)은 사용자에게 보일 내용이 없다
      if (!n.title && !n.body) { n.close(); continue; }
      pm.appendChild(_card(n));
      n.close();   // 읽었으니 알림 센터에서 지운다 → 아이콘 배지도 줄어든다
    }
    pm.scrollTop = pm.scrollHeight;
    try { if (navigator.clearAppBadge) navigator.clearAppBadge(); } catch {}
  } catch (e) { console.warn('[notify-inbox]', e && e.message); }
}

export function initNotifyInbox() {
  setTimeout(showPendingNotifications, 1500);   // 첫 인사말이 나온 뒤에
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') showPendingNotifications(); });
}
