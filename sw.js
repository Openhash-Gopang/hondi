// ═══════════════════════════════════════════════════════════
// sw.js — 고팡 Service Worker v1.0
// PWA 오프라인 지원 + 캐시 전략
// ═══════════════════════════════════════════════════════════

const CACHE_NAME    = 'gopang-20260720-1500';
const CACHE_TIMEOUT = 5000; // 네트워크 타임아웃 5초
// 2026-07-15 신설 — PERSONAL-AC-CALL-PROTOCOL §5 수신확인 3단계 전송용.
const WORKER_PROXY  = 'https://hondi-proxy.tensor-city.workers.dev';

// 설치 시 사전 캐시할 핵심 파일
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/desktop.html',
  '/webapp.html',
  '/left-menu.html',
  '/right-menu.html',
  '/user-manual.html',
  '/terms-of-use.html',
  '/manifest.json',
  '/favicon.ico',

  // ── 디자인 시스템
  '/gopang-style.css',

  // ── GWP 레지스트리
  '/gwp-registry.js',

  // ── 고팡 JS 모듈
  '/src/pwa/gopang-pwa.js',
  // src/auth/gopang-auth.js: 2026-07-01(20e267b) 죽은 중복 인증파일로 삭제됨.
  // 이 목록에 남아있어도 Promise.allSettled+개별 catch 덕에 설치는 안 깨지지만
  // (콘솔에 "사전 캐시 실패" 경고만 남음), 실제 없는 파일이라 정리한다.
  // gopang-app.js: 자주 변경되므로 PRECACHE 제외 — Network First로 항상 최신 로드

  // ── 인증
  '/auth/gopang-sso.js',
  '/auth/subsystem-auth.js',

  // ── 아이콘
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ── 설치 ───────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] 설치 중...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // addAll() 대신 파일별 개별 캐시 — 한 파일 실패가 전체에 영향 없음
      let ok = 0, fail = 0;
      await Promise.allSettled(
        PRECACHE_URLS.map(url =>
          cache.add(url)
            .then(() => { ok++; })
            .catch(err => {
              fail++;
              console.warn('[SW] 사전 캐시 실패 (무시):', url, '—', err.message);
            })
        )
      );
      console.log(`[SW] 사전 캐시 완료 — 성공: ${ok}, 실패: ${fail}`);
    }).then(() => {
      console.log('[SW] 설치 완료 — skipWaiting');
      return self.skipWaiting();
    })
  );
});

// ── 활성화 ─────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] 활성화 — 이전 캐시 정리');
  // ★ 2026-07-09 — 'hondi-share-inbox'는 CACHE_NAME(버전 캐시)과 별개로
  // 계속 살아있어야 한다. 공유받은 문서를 사용자가 아직 안 열어봤는데
  // SW가 업데이트되면서 통째로 지워지면 안 됨 — 원래 필터가 CACHE_NAME
  // 외 전부를 지우던 걸 여기서 명시적으로 예외처리했다.
  const KEEP_CACHES = new Set([CACHE_NAME, 'hondi-share-inbox']);
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => !KEEP_CACHES.has(key))
          .map((key) => {
            console.log('[SW] 삭제:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch 전략: Network First + Cache Fallback ─────────────
self.addEventListener('fetch', (event) => {
  // ★ http/https 이외 스킴 제외 (chrome-extension://, data: 등)
  // Cache API는 http/https 스킴만 허용하므로 그 외는 즉시 반환
  if (!event.request.url.startsWith('http')) return;

  // 미디어 파일 캐시 안 함 (206 Partial Content 오류 방지)
  if (new URL(event.request.url).pathname.match(/\.(mp3|ogg|wav|mp4|webm)$/)) return;

  const url = new URL(event.request.url);

  // ── 외부 API 요청은 캐시 안 함 ──────────────────────────
  if (
    url.hostname.includes('supabase.co')     ||
    url.hostname.includes('workers.dev')     ||
    url.hostname.includes('deepseek.com')    ||
    url.hostname.includes('openai.com')      ||
    url.hostname.includes('kakao.com')       ||
    url.hostname.includes('googleapis.com')  ||
    url.hostname.includes('raw.githubusercontent.com')
  ) {
    return; // 기본 fetch 사용
  }

  // ── Web Share Target (2026-07-09 신설) ──────────────────
  // 정부24 등 다른 앱에서 "공유하기"로 보낸 문서(PDF/이미지)를 받는다.
  // PDV 원칙(원본은 클라이언트에만, 서버 전송 없음)과 동일하게, 받은
  // 파일은 Cache Storage에만 저장하고 어디로도 업로드하지 않는다 —
  // _parseShareTargetForm은 순수 함수로 분리해 별도 테스트한다
  // (phase17_share_target.test.mjs).
  if (url.pathname === '/share-receive.html' && event.request.method === 'POST') {
    event.respondWith(_handleShareTarget(event.request));
    return;
  }

  // ── 고팡 자체 리소스: Network First ─────────────────────
  if (event.request.method !== 'GET') return;

  event.respondWith(
    (async () => {
      try {
        // 네트워크 우선 시도 (타임아웃 포함)
        // cache:'no-store' — 브라우저 HTTP 디스크 캐시까지 완전히 우회해야
        // GitHub Pages의 Cache-Control(max-age)에 의해 "네트워크 우선"이
        // 사실상 무력화되는 문제(구버전 파일이 계속 보이는 버그)를 막을 수 있다.
        const networkRes = await Promise.race([
          fetch(event.request.clone(), { cache: 'no-store' }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), CACHE_TIMEOUT)
          ),
        ]);

        // 성공 시 캐시 업데이트
        if (networkRes.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, networkRes.clone());
        }
        return networkRes;

      } catch (err) {
        // 네트워크 실패 → 캐시 폴백
        const cached = await caches.match(event.request);
        if (cached) {
          console.log('[SW] 캐시 폴백:', url.pathname);
          return cached;
        }

        // 캐시도 없으면 오프라인 페이지
        if (event.request.mode === 'navigate') {
          const offlineCache = await caches.match('/index.html');
          if (offlineCache) return offlineCache;
        }

        return new Response('오프라인 상태입니다.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
    })()
  );
});

// ── 메시지 수신 (skipWaiting 명령) ────────────────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    console.log('[SW] SKIP_WAITING 수신 → 즉시 활성화');
    self.skipWaiting();
  }
});

// ── 수신확인(PERSONAL-AC-CALL-PROTOCOL §5) — 도달(delivered) 보고 ──────
// tag가 'personal-ac-call-{request_id}' 형태일 때만 request_id를 추출해
// 보고한다. 실패해도(오프라인 등) 알림 표시 자체는 막지 않는다 — 기존
// worker.js _recordConsentEvent와 동일한 "가용성 우선" 원칙.
function _reportConsentReceipt(tag, event) {
  const m = /^personal-ac-call-(.+)$/.exec(tag || '');
  if (!m) return Promise.resolve();
  return fetch(`${WORKER_PROXY}/pdv/consent-receipt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: m[1], event }),
  }).catch(e => console.warn('[SW] 수신확인 발송 실패:', e.message));
}

// ── Push 알림 수신 ─────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { data = { title: '고팡', body: event.data?.text() || '새 메시지' }; }

  const title   = data.title || '고팡';
  const body    = data.body  || '새 메시지가 도착했습니다.';
  const sound   = data.sound || 'ping';
  const tag     = data.tag   || 'gopang-msg';
  const url     = data.url   || '/webapp.html';

  // PC가 AI 비서 Key를 전송한 경우(tag가 gopang-ai-setup-로 시작) — 열려있는
  // 모든 탭에 즉시 동기화 신호를 보낸다. 앱이 켜져 있으면 화면을 보고 있지
  // 않아도(채팅창이든 다른 화면이든) 즉시 PC 설정이 자동 적용된다.
  const isAiSetupSync   = tag.startsWith('gopang-ai-setup-');
  const isVersionUpdate = tag === 'gopang-version-update';
  // 2026-08-28 신설(주피터 지시: "GDC wallet은 언제나 최신 정보를
  // 반영해야 합니다") — GDC 충전 확정 푸시(worker.js
  // _mintAndRecordCharge, tag: 'gdc-charge-confirmed')가 오면 열려있는
  // 모든 탭에 즉시 잔액 재대사 신호를 보낸다. 위 AI 설정 동기화와
  // 완전히 동일한 패턴 — 알림을 클릭하기 전이라도, 지갑 시트를 열어둔
  // 채 다른 화면을 보고 있어도 잔액 숫자가 그 즉시 최신으로 갱신된다.
  const isGdcChargeConfirmed = tag === 'gdc-charge-confirmed';

  // ── TEST: push 도착 즉시(클릭 대기 없이) 열려있는 모든 탭에 강제
  // 사운드 신호를 브로드캐스트한다 — 클릭 시점까지 기다리지 않고 도착
  // 시점에 바로 소리가 나는지 확인하기 위한 단순화된 테스트 경로.
  const _broadcastSound = clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    console.info('[TEST-SOUND] push 도착 — 열린 탭', list.length, '개에 브로드캐스트');
    for (const client of list) {
      client.postMessage({ type: 'PLAY_SOUND', sound: 'ping' });
    }
  });

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body,
        icon:  '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag,
        data:  { url, sound },
        vibrate: [200, 100, 200],
      }),
      _broadcastSound,
      _reportConsentReceipt(tag, 'delivered'),
      (isAiSetupSync || isVersionUpdate)
        ? clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
            for (const client of list) {
              client.postMessage({ type: isVersionUpdate ? 'CHECK_FOR_UPDATE' : 'SYNC_AI_SETTING' });
            }
          })
        : Promise.resolve(),
      // 2026-08-28 신설 — GDC 충전 확정 브로드캐스트(위 주석 참조).
      isGdcChargeConfirmed
        ? clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
            for (const client of list) {
              client.postMessage({ type: 'REFRESH_GDC_BALANCE' });
            }
          })
        : Promise.resolve(),
    ])
  );
});

// ── 알림 클릭 → 앱 열기 + 소리 재생 ──────────────────────
// 버그: 탭이 닫혀 있어 새 창을 열어야 하는 경우, clients.openWindow()가
// resolve된 직후 postMessage를 보내면 새 페이지의 JS(gopang-app.js)가
// 아직 로드·리스너 등록 전이라 메시지가 받는 사람 없이 사라진다(경쟁 상태).
// → 새 창 케이스는 URL 쿼리 파라미터로 사운드 정보를 실어 보내, 페이지가
//    로드되자마자(리스너 등록을 기다릴 필요 없이) 직접 읽어 재생하게 한다.
// 이미 열려있는 창(focus만 하면 되는 경우)은 리스너가 이미 살아있으므로
// 기존 postMessage 방식 그대로 둔다.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url   = event.notification.data?.url   || '/webapp.html';
  const sound = event.notification.data?.sound || 'ping';
  const tag   = event.notification.tag || '';

  // ★ 2026-07-20 발견·수정 — device-link(기기 간 지갑 이전 승인) 알림은
  // 사용자가 명시적으로 특정 화면(코드 확인·승인 화면)으로 가려고 누른
  // 것인데, 앱이 이미 열려있으면 아래 로직이 "포커스만 하고 postMessage엔
  // url을 아예 안 담아" 보내서 기존 창이 원래 있던 화면(보통 채팅창)에
  // 그대로 머물렀다 — 실사로 확인(알림을 눌러도 혼디 앱은 열리는데
  // 코드 화면이 안 뜨던 원인).
  //
  // ★ 2026-07-20 2차 수정 — 위 1차 수정에서 client.navigate()를 썼더니
  // 이 기기(Motorola Edge70, Android Chrome)에서 알림을 눌러도 아예
  // 아무 반응이 없어졌다(앱조차 안 열림, 홈 화면 그대로) — navigate()가
  // 이 환경 조합에서 원인 불명으로 막히는 것으로 추정된다. 원인을 더
  // 파기보다, device-link 알림에 한해서는 기존 창 재사용 시도 자체를
  // 하지 않고 항상 openWindow()로 새로 여는 쪽으로 단순화한다 —
  // openWindow는 이미 다른 알림 종류에서 검증된 경로다. PWA 특성상
  // 이미 앱이 열려있어도 openWindow가 그 창을 새 탭으로 열거나 브라우저가
  // 알아서 기존 창으로 포커스를 넘기는 경우가 많아, 채팅 중이던 화면을
  // 잃는 부작용도 이 방식이 client.navigate보다 오히려 적다.
  const isDeviceLink = tag.startsWith('gopang-device-link-');

  if (isDeviceLink) {
    // ★ 2026-09-10 임시 진단 로그 — Edge/Chrome 등 서로 다른 브라우저에서
    // 순차적으로 device-link 요청을 보낼 때, 두 번째 요청의 알림을 열어도
    // device-link-approve.html이 아니라 이미 열려있던 webapp.html이 그대로
    // 보이는 증상 원인 확인용. PWA가 단일 창만 허용해 openWindow()가 새
    // 페이지를 못 열고 기존 창을 재사용하는지 여기서 확인한다. 원인이
    // 확정되면 이 로그 블록은 제거한다.
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(before => {
        console.info('[DeviceLink diag] 요청 url:', url, '| 클릭 시점 기존 열린 창:', before.map(c => c.url));
        return Promise.all([
          _reportConsentReceipt(tag, 'acknowledged'),
          clients.openWindow(url + (url.includes('?') ? '&' : '?') + 'playSound=' + encodeURIComponent(sound))
            .then(win => {
              console.info('[DeviceLink diag] openWindow 결과 url:', win ? win.url : null);
              if (win && !win.url.includes('device-link-approve.html')) {
                console.warn('[DeviceLink diag] ⚠ 단일 창 재사용 의심 — 요청한 승인 화면이 아니라 기존 창이 열렸습니다.');
              }
            }),
        ]);
      })
    );
    return;
  }

  event.waitUntil(
    Promise.all([
      _reportConsentReceipt(tag, 'acknowledged'),
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (list) => {
        // 이미 열린 창이 있으면 포커스 + postMessage (리스너가 이미 살아있음)
        for (const client of list) {
          if (client.url.startsWith(self.location.origin) && 'focus' in client) {
            client.postMessage({ type: 'PLAY_SOUND', sound });
            return client.focus();
          }
        }
        // 없으면 새 창 — postMessage 대신 URL 파라미터로 전달(경쟁 상태 회피)
        const sep = url.includes('?') ? '&' : '?';
        return clients.openWindow(url + sep + 'playSound=' + encodeURIComponent(sound));
      }),
    ])
  );
});

// ── Web Share Target 처리 (2026-07-09 신설) ───────────────────
// manifest.json의 share_target 설정과 짝을 이룬다. 정부24 등이 공유한
// 파일을 받아 "hondi-share-inbox"라는 별도 Cache Storage 이름공간에만
// 저장한다(일반 PWA 리소스 캐시와 섞이지 않게 분리) — 서버로는 절대
// 전송하지 않는다(PDV 원칙과 동일).

/**
 * FormData에서 공유된 파일과 메타데이터를 뽑아내는 순수(에 가까운) 함수.
 * Cache Storage에는 안 건드리므로 Node 환경(FormData/File은 Node 18+
 * 전역 제공)에서도 그대로 테스트 가능하다.
 * @param {FormData} formData
 * @returns {{file: File, title: string, text: string} | null}
 */
function _parseShareTargetForm(formData) {
  const file = formData.get('govdoc');
  if (!file || typeof file.arrayBuffer !== 'function') return null; // 파일 없이 텍스트만 공유된 경우
  const title = formData.get('title') || '';
  const text = formData.get('text') || '';
  return { file, title, text };
}

async function _handleShareTarget(request) {
  const origin = new URL(request.url).origin;
  try {
    const formData = await request.formData();
    const parsed = _parseShareTargetForm(formData);
    if (!parsed) return Response.redirect(`${origin}/webapp.html`, 303);

    const { file, title, text } = parsed;
    const id = `share-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const cache = await caches.open('hondi-share-inbox');
    await cache.put(`/_share-inbox/${id}`, new Response(file, {
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Share-Filename': encodeURIComponent(file.name || ''),
        'X-Share-Title': encodeURIComponent(title),
        'X-Share-Text': encodeURIComponent(text),
        'X-Share-Ts': String(Date.now()),
      },
    }));
    return Response.redirect(`${origin}/webapp.html?shared=${id}`, 303);
  } catch (e) {
    console.warn('[SW] Share Target 처리 실패:', e.message);
    return Response.redirect(`${origin}/webapp.html`, 303);
  }
}

// ── Push 구독 변경 감지 ────────────────────────────────────
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.registration.pushManager.subscribe({ userVisibleOnly: true })
      .then(sub => {
        // 새 구독을 서버에 재등록
        return fetch('https://hondi-proxy.tensor-city.workers.dev/push/subscribe', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ subscription: sub }),
        });
      })
  );
});
