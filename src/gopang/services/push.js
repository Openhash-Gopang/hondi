/**
 * services/push.js — Web Push(VAPID) 구독 공통 로직
 *
 * 가입 완료 시점에 푸시 알림 권한을 요청하기 위한 공용 모듈.
 * 설정 화면의 토글에서도 동일한 로직을 재사용한다.
 *
 * - 이미 구독돼 있으면 재요청 없이 그대로 서버에만 재등록(guid 갱신)
 * - 이미 거부된 상태(Notification.permission === 'denied')면 조용히 종료
 *   (브라우저가 다이얼로그를 다시 띄우지 않으므로 콘솔 노이즈만 남기지 않게)
 * - 실패해도 호출부의 다른 흐름(가입 등)을 막지 않도록
 *   항상 { ok, reason } 형태로만 반환하고 throw하지 않는다.
 */
const WORKER_URL = 'https://hondi-proxy.tensor-city.workers.dev';

// ── 탈중앙화 이관 ①: VAPID 공개키 하드코딩 (2026-06-23) ─────────────────
// 이전: Worker GET /push/vapid-public-key → env.VAPID_PUBLIC_KEY 반환
// 이후: 공개키는 공개 정보이므로 단말에 직접 내장. Worker 엔드포인트 호출 불필요.
// 공개키가 교체될 경우 이 상수와 함께 Worker secret도 같이 교체해야 함.
//
// ★ 2026-07-20 교체 — 예전 VAPID 개인키를 분실해(어디에도 백업이 없었음)
// 서버가 새 키 쌍(VAPID_PRIVATE_KEY/VAPID_PUBLIC_KEY, wrangler secret으로
// 등록 완료)으로 서명하는데 기존 공개키로 구독한 클라이언트와 안 맞아
// FCM이 403으로 거부하는 문제가 실사로 확인됐다(device-link 웹푸시가
// 조용히 도착 안 하던 근본 원인). 새 공개키로 교체 — 이 시점 이전에
// 구독한 사용자는 전부 재구독이 필요하다(applicationServerKey가 바뀌면
// 브라우저가 기존 구독을 그대로 못 씀 — pushManager.subscribe()가 새
// 구독을 만든다).
const VAPID_PUBLIC_KEY = 'BKgtXbSP0ng9P5fb7Jl6byOZDO7O9gNp1fZ9EC_ClPhKjwA5I-9lNUezY10AFGHTT4UHZfmW_Wyt7LfEp0wAz7I';

function _urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// ★ 2026-07-23 신설 — push_subscription을 계정당 단일 필드에서 기기별
// 배열로 바꾼 근본 수정(docs/PUSH_SUBSCRIPTION_HIJACK_2026_07_21.md §4)의
// 클라이언트 쪽 절반. 이 브라우저(기기)를 구분할 안정적인 ID를 한 번만
// 생성해 localStorage에 보존한다 — 로그아웃/재로그인해도 유지되므로,
// 같은 물리 기기가 계속 자신의 구독만 갱신하고 다른 기기 것을 건드리지
// 않는다.
const DEVICE_ID_KEY = 'gopang_device_id';
export function getOrCreateDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = (typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

// ★ 2026-07-22 버그 수정 — 실사로 재현된 410(FCM "unsubscribed or
// expired") 근본 원인. requestPushSubscription()을 부르는 경로가
// 두 곳이다: ① auth.js가 가입 완료 직후 fire-and-forget으로 호출,
// ② gopang-app.js의 자가치유 IIFE가 페이지 로드마다(신규 계정은
// 쿨다운도 없음) 호출. 가입 완료 시점에 이 둘이 사실상 동시에 실행돼
// pushManager.subscribe()/unsubscribe()가 겹쳐 돌면서, 서로 다른
// 타이밍에 만든 두 엔드포인트 중 이미 무효화된 쪽이 서버에 마지막으로
// 저장되는 경쟁이 실제로 발생했다(재가입 직후 저장된 구독이 곧바로
// 410로 죽어있던 사고). in-flight 락으로 동시 호출을 하나의 실행으로
// 합친다 — 먼저 온 호출이 실제로 진행하고, 뒤이어 온 호출은 새로
// subscribe/unsubscribe를 또 트리거하지 않고 같은 결과를 기다린다.
let _inFlight = null;

// ── 2026-09-07 신설 — /push/subscribe 인증 부재 수정 ────────────────
// 지금까지 guid만 body에 넣으면 누구나 임의의 기기를 그 계정의
// "신뢰 기기" 목록에 몰래 추가할 수 있었다(사고실험 발견 — worker.js
// handlePushSubscribe 주석 참고). 이 배열은 device-link 승인·재가입
// 판별의 "다른 신뢰 기기" 신호로 쓰이므로, 구멍이 막히지 않으면 그
// 전제 자체가 무너진다. 이 계정 지갑(GopangWallet, window 전역)의
// Ed25519 서명을 매 요청에 실어 보낸다 — 지갑이 없거나 잠겨있으면
// 조용히 { ok:false, reason:'wallet_not_ready' }를 반환하고 서버
// 호출 자체를 시도하지 않는다(호출해봐야 403이므로).
// 모든 /push/subscribe 호출부(이 파일, webapp.html 설정 화면)가
// 반드시 이 함수를 통해서만 호출하도록 한다 — 직접 fetch 금지.
export async function postPushSubscribe(payload) {
  if (!payload?.guid) return { ok: false, reason: 'guid_missing' };
  let wallet = null;
  try { wallet = await window.GopangWallet?.load?.(); } catch (_) { wallet = null; }
  if (!wallet || !wallet.publicKeyB64u) {
    return { ok: false, reason: 'wallet_not_ready' };
  }
  const deviceId = payload.deviceId || 'legacy';
  const ts = Date.now();
  const sigMsg = `push-subscribe:${payload.guid}:${deviceId}:${payload.unsubscribe ? 'unsub' : 'sub'}:${ts}`;
  let signature;
  try { signature = await wallet.signPayload(sigMsg); }
  catch (e) { return { ok: false, reason: '서명 실패: ' + e.message }; }

  try {
    const res  = await fetch(`${WORKER_URL}/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, deviceId, pubkey: wallet.publicKeyB64u, signature, ts }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return { ok: false, reason: data.detail || 'server_error' };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

export function requestPushSubscription(guid) {
  if (_inFlight) return _inFlight;
  _inFlight = _requestPushSubscriptionImpl(guid).finally(() => { _inFlight = null; });
  return _inFlight;
}

async function _requestPushSubscriptionImpl(guid) {
  if (!guid) return { ok: false, reason: 'guid_missing' };
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, reason: 'unsupported' };
  }
  if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
    return { ok: false, reason: 'permission_denied' };
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();

    // ★ 2026-07-22 버그 수정: "device-link 웹푸시가 조용히 도착 안 함"이
    // 07-20 VAPID 키 교체로 한 번 고쳤다고 기록됐는데 재발함. 원인은
    // 여기 — getSubscription()이 반환한 기존 구독을 "있으니 그냥 쓴다"만
    // 하고, 그 구독이 지금 VAPID_PUBLIC_KEY로 만들어진 게 맞는지 검증한
    // 적이 없었다. 07-20 키 교체 이전에 이미 구독해둔 기기는 옛 키로
    // 만들어진 죽은 구독을 계속 서버에 재등록하게 되고, FCM이 키
    // 불일치로 조용히 거부한다(에러가 클라이언트로 안 올라옴 — 그래서
    // "조용히" 안 옴). applicationServerKey를 바이트 단위로 비교해서
    // 안 맞으면 구독을 버리고 새로 만든다.
    if (sub) {
      const currentKey = _urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      const subKeyBuf  = sub.options?.applicationServerKey || null;
      const subKey     = subKeyBuf ? new Uint8Array(subKeyBuf) : null;
      const matches = !!subKey
        && subKey.length === currentKey.length
        && subKey.every((b, i) => b === currentKey[i]);
      if (!matches) {
        try { await sub.unsubscribe(); } catch (e) { /* 무시 — 아래서 어차피 새로 구독 */ }
        sub = null;
      }
    }

    if (!sub) {
      // 이전: Worker API 호출 → 이후: 내장 상수 직접 사용
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const sound = localStorage.getItem('gopang_push_sound') || 'ping';
    // 2026-07-28 신설 — deviceType을 같이 보낸다. device-link 흐름에서
    // "누군가 하나라도 받았다"가 아니라 "실제로 폰이 받았다"를 서버가
    // 구분할 수 있어야 하는데, 지금까지는 이 정보 자체가 없어서 PC
    // 자신의 구독이 성공으로 잡혀도 폰이 못 받은 걸 알 방법이 없었다.
    const deviceType = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '')
      ? 'mobile' : 'desktop';
    return await postPushSubscribe({
      guid, subscription: sub.toJSON(), sound, deviceId: getOrCreateDeviceId(), deviceType,
    });
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}
