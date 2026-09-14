// gopang-pwa.js — PWA 설치·업데이트·배너
// ══════════════════════════════════════════════════════════
// PWA — Service Worker 등록 + 설치 프롬프트
// ══════════════════════════════════════════════════════════

let _deferredInstallPrompt = null;   // beforeinstallprompt 이벤트 보관
const _INSTALL_DISMISSED_KEY = 'gopang_install_dismissed';
const _INSTALL_DONE_KEY      = 'gopang_installed';

// ── 홈 화면 아이콘 삭제 감지(최선 노력) ───────────────────────
// 아이콘을 지우는 순간을 웹앱이 감지할 방법은 없다(그 시점엔 코드가
// 실행되지 않으므로) — 대신 "다음에 이 사이트를 열었을 때" 확인한다.
// gopang_installed 플래그가 있는데 지금 standalone 모드가 아니라면,
// 브라우저 탭으로 열렸다는 뜻이라 홈 화면 아이콘이 삭제됐을 가능성이
// 매우 높다. 이 경우 플래그를 즉시 지워, 재설치 시도 시 설치 배너가
// "이미 설치됨"으로 오판해 막지 않게 한다.
// (2026-07-23 — 삭제 직후 재설치가 며칠씩 안 되던 문제의 재발 방지)
if (localStorage.getItem(_INSTALL_DONE_KEY) && !_isInStandaloneMode()) {
  console.log('[PWA] standalone 아님 + 설치 플래그 존재 → 홈 화면 삭제로 추정, 플래그 초기화');
  localStorage.removeItem(_INSTALL_DONE_KEY);
}

// ── Service Worker 등록 + 자동 갱신 ──────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      console.log('[PWA] SW 등록 완료:', reg.scope);

      // 서버 push 즉시 반응 — 배포 시 push로 받는 CHECK_FOR_UPDATE를 처리한다.
      // (PLAY_SOUND는 gopang-app.js에서 처리한다 — 예전에는 이 파일에도
      //  동일 리스너가 있어 사운드가 두 번 겹쳐 재생되는 버그가 있었음)
      navigator.serviceWorker.addEventListener('message', (event) => {
        const msgType = event.data?.type;
        if (msgType === 'CHECK_FOR_UPDATE') {
          console.log('[PWA] 배포 push 수신 — 즉시 업데이트 체크');
          reg.update().then(() => {
            if (reg.waiting && navigator.serviceWorker.controller) _autoApplyUpdate(reg);
          }).catch(() => {});
        }
      });

      // ★ _AUTO_UPDATE_PATCH_APPLIED_
      // ══════════════════════════════════════════════════
      // 이중 자동 업데이트 강제 적용
      //
      // 경로 ①: 새 SW 설치 완료 → 5초 후 자동 skipWaiting + 새로고침
      //          (사용자 입력 불필요, 배너는 카운트다운용으로만 표시)
      // 경로 ②: 30분마다 주기적 update() 체크
      //          (탭을 장시간 열어두는 사용자 대응)
      // ══════════════════════════════════════════════════

      // 자동 적용 타이머 ID (중복 방지)
      let _autoApplyTimer = null;

      function _autoApplyUpdate(reg) {
        if (_autoApplyTimer) return;  // 이미 예약됨

        // ★ 무한 재시작 루프 방지 회로차단기 ★
        // CDN 전파 지연 등으로 sw.js가 edge마다 다르게 응답되면 새로고침
        // 직후에도 또 "새 버전"으로 오인될 수 있다. 최근 20초 내에 이미
        // 자동 재시작했다면 이번엔 건너뛰고 수동 배너만 표시한다.
        // sessionStorage는 reload에도 유지되므로 루프를 끝까지 추적해 막는다.
        const LOOP_KEY = 'gopang_last_auto_reload';
        const lastReload = Number(sessionStorage.getItem(LOOP_KEY) || 0);
        if (Date.now() - lastReload < 20000) {
          console.warn('[PWA] 최근 20초 내 자동 재시작 이력 감지 — 반복 루프 의심, 자동 적용 중단(수동 배너만 표시)');
          _showUpdateBanner(0);
          return;
        }

        console.log('[PWA] 새 버전 감지 — 5초 후 자동 적용');
        _showUpdateBanner(5);         // 카운트다운 배너 표시
        _autoApplyTimer = setTimeout(() => {
          sessionStorage.setItem(LOOP_KEY, String(Date.now()));
          const sw = reg.waiting;
          if (sw) {
            sw.postMessage({ type: 'SKIP_WAITING' });
          } else {
            window.location.reload();
          }
        }, 5000);
      }

      // 경로 ①: 새 SW 설치 완료 → 자동 적용
      reg.addEventListener('updatefound', () => {
        const newSW = reg.installing;
        if (!newSW) return;
        newSW.addEventListener('statechange', () => {
          if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
            _autoApplyUpdate(reg);
          }
        });
      });

      // SW 교체 완료(controllerchange) → 즉시 새로고침
      // (forceUpdateApp이 수동 갱신 중이면 자체적으로 새로고침을 처리하므로 건너뜀)
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (window._manualUpdateInProgress) return;
        console.log('[PWA] 새 버전 적용 — 자동 새로고침');
        window.location.reload();
      });

      // 앱 시작 시 이미 waiting 중인 SW → 즉시 자동 적용
      if (reg.waiting && navigator.serviceWorker.controller) {
        console.log('[PWA] 시작 시 대기 중 버전 감지 → 자동 적용');
        _autoApplyUpdate(reg);
      }

      // 포그라운드 복귀 시 즉시 업데이트 체크
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          reg.update().then(() => {
            console.log('[PWA] 포그라운드 복귀 — SW 업데이트 체크');
            if (reg.waiting && navigator.serviceWorker.controller) {
              _autoApplyUpdate(reg);
            }
          }).catch(() => {});
        }
      });

      // 경로 ②: 30분마다 주기적 업데이트 체크
      setInterval(() => {
        reg.update().then(() => {
          console.log('[PWA] 주기 체크(30분) — SW 업데이트 확인');
          if (reg.waiting && navigator.serviceWorker.controller) {
            _autoApplyUpdate(reg);
          }
        }).catch(() => {});
      }, 30 * 60 * 1000);

    } catch (err) {
      console.warn('[PWA] SW 등록 실패:', err);
    }
  });
}

// ── 앱 갱신 알림 배너 (카운트다운 자동 적용) ───────────────────
function _showUpdateBanner(seconds = 0) {
  if (document.getElementById('update-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'update-banner';
  banner.style.cssText = `
    position: fixed; bottom: 90px; left: 50%; transform: translateX(-50%);
    background: #1C1C1E; border: 1px solid #3A3A3C;
    border-radius: 14px; padding: 12px 20px;
    display: flex; align-items: center; gap: 12px;
    font-size: 14px; color: #F2F2F7;
    box-shadow: 0 8px 32px rgba(0,0,0,.6);
    z-index: 9999; white-space: nowrap;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  `;

  const countdownLabel = seconds > 0
    ? `<span id="update-countdown" style="color:#8E8E93;font-size:12px">${seconds}초 후 자동 적용</span>`
    // 2026-07-19 수정 — seconds=0(루프 방지 회로차단기로 자동적용을 건너뛴
    // 경우)일 때 지금까지 아무 문구도 안 붙어서, 사용자에게는 "새 버전이
    // 있습니다"만 뜨고 그 뒤로 아무 일도 안 일어나는 것처럼 보였다(실사
    // 신고 계기). 자동 적용을 안 한다는 것과 수동으로 눌러야 한다는 걸
    // 명시적으로 알려준다.
    : `<span style="color:#8E8E93;font-size:12px">아래 버튼을 눌러 적용하세요</span>`;

  banner.innerHTML = `
    <span>🆕 새 버전이 있습니다</span>
    ${countdownLabel}
    <button id="update-apply-btn" onclick="_applyUpdate()" style="
      background:#0057A8; color:#fff; border:none;
      border-radius:8px; padding:6px 14px;
      font-size:13px; font-weight:600; cursor:pointer;">
      지금 적용
    </button>
  `;
  document.body.appendChild(banner);

  // 카운트다운 표시
  if (seconds > 0) {
    let remain = seconds;
    const cd = setInterval(() => {
      remain--;
      const el = document.getElementById('update-countdown');
      if (el) el.textContent = `${remain}초 후 자동 적용`;
      if (remain <= 0) clearInterval(cd);
    }, 1000);
  }
}

// ── 업데이트 적용 (skipWaiting 메시지 전송) ──────────────────
// 2026-07-19 수정 — 클릭해도 아무 반응이 없어 "실제로 진행되는지 알 수
// 없다"는 실사용자 신고 계기. forceUpdateApp()(설정 패널 버튼)은 이미
// "갱신 중…" → "✅ 갱신 완료" 피드백이 있었는데, 배너 쪽 버튼에는 그게
// 없었다 — 같은 원칙을 여기도 적용. controllerchange가 예상보다 안 오는
// 경우(SW 상태 이상 등)를 위한 안전장치도 추가: 6초 안에 반응이 없으면
// 강제 새로고침으로 대체(무한정 "적용 중…"에 멈춰있지 않도록).
function _applyUpdate() {
  const btn = document.getElementById('update-apply-btn');
  if (btn) {
    btn.textContent = '적용 중…';
    btn.style.pointerEvents = 'none';
    btn.style.opacity = '0.7';
  }
  // 주의: _manualUpdateInProgress를 여기서 세우지 않는다 — 그 플래그는
  // 상단의 전역 controllerchange 리스너(실제 새로고침 담당)를 억제하는
  // 용도라, 여기서 세우면 "적용 중…"만 뜨고 아무도 새로고침을 안 하는
  // 상태로 6초를 그냥 흘려보내게 된다(직접 만들 뻔한 버그). 배너 쪽은
  // 전역 리스너가 그대로 새로고침을 처리하게 두고, 여기서는 그 신호를
  // 기다려 안전장치 타이머만 해제한다.
  const fallback = setTimeout(() => {
    console.warn('[PWA] 배너 수동 적용 — 6초 내 응답 없음, 강제 새로고침으로 대체');
    window.location.reload();
  }, 6000);

  navigator.serviceWorker.ready.then((reg) => {
    if (reg.waiting) {
      // 실제 새로고침은 상단의 전역 controllerchange 리스너가 처리한다 —
      // 여기서는 그게 왔다는 신호로 안전장치 타이머만 끈다.
      navigator.serviceWorker.addEventListener('controllerchange', () => clearTimeout(fallback), { once: true });
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    } else {
      clearTimeout(fallback);
      window.location.reload();
    }
  }).catch((err) => {
    console.warn('[PWA] 배너 수동 적용 실패 — 강제 새로고침으로 대체:', err.message);
    clearTimeout(fallback);
    window.location.reload();
  });
}
// ★ 진짜 원인(2026-07-19) ★ — 이 함수는 window.addEventListener('load', ...)
// 클로저 안에 선언돼 있어 전역이 아니다. 배너의 onclick="_applyUpdate()"는
// 전역 스코프에서 이름을 찾으므로 지금까지 "_applyUpdate is not defined"로
// 조용히 실패해왔다(콘솔에만 찍히고 화면엔 무반응) — forceUpdateApp()은
// 아래 window.forceUpdateApp = forceUpdateApp;가 있어서 정상 작동했던 것과
// 대조된다. 오늘 추가한 진행상태 피드백 로직 자체는 문제가 없었다 —애초에
// 실행될 수 없었을 뿐이다.
window._applyUpdate = _applyUpdate;

// ── 버전 확인 헬퍼 ───────────────────────────────────────────
// /version.json은 .github/workflows/bump-app-version.yml이 main에
// 머지될 때마다 sw.js의 CACHE_NAME과 동일한 값으로 갱신해 커밋한다.
// no-store로 요청해 브라우저/CDN 캐시를 우회한다(그렇지 않으면 "새
// 버전 있는지" 확인 자체가 캐시된 옛 버전 정보를 다시 읽는 모순에 빠짐).
const _VERSION_VERIFY_KEY = 'hondi_update_verify_pending';

async function _fetchCurrentVersion() {
  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.version || null;
  } catch (e) {
    return null;
  }
}

// ── 갱신 결과 토스트 (성공/무변경/실패를 있는 그대로 표시) ─────
function _showVersionToast(message, tone = 'ok') {
  const existing = document.getElementById('version-verify-toast');
  if (existing) existing.remove();

  const colors = {
    ok:   { bg: '#0057A8', fg: '#fff' },
    info: { bg: '#1C1C1E', fg: '#F2F2F7' },
    warn: { bg: '#8A5A00', fg: '#fff' },
  };
  const c = colors[tone] || colors.info;

  const toast = document.createElement('div');
  toast.id = 'version-verify-toast';
  toast.style.cssText = `
    position: fixed; bottom: 90px; left: 50%; transform: translateX(-50%);
    background: ${c.bg}; color: ${c.fg};
    border-radius: 14px; padding: 12px 18px;
    font-size: 13px; font-weight: 500; text-align: center;
    box-shadow: 0 8px 32px rgba(0,0,0,.5);
    z-index: 9999; max-width: 86vw;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// 새로고침 이전에 시작한 "최신 버전으로 갱신"의 결과를, 새로고침 이후
// 실제 배포된 version.json과 비교해 검증한다 — reload 한 번으로 JS
// 상태가 사라지므로 sessionStorage로 beforeVersion을 넘겨받는다.
async function _verifyPendingUpdate() {
  const raw = sessionStorage.getItem(_VERSION_VERIFY_KEY);
  if (!raw) return;
  sessionStorage.removeItem(_VERSION_VERIFY_KEY);

  let before;
  try { before = JSON.parse(raw); } catch { return; }

  const after = await _fetchCurrentVersion();

  if (!after || !before.beforeVersion) {
    _showVersionToast('⚠️ 버전 확인에 실패했습니다 — 네트워크 상태를 확인해주세요', 'warn');
  } else if (after !== before.beforeVersion) {
    _showVersionToast(`✅ 최신 버전으로 갱신되었습니다 (${after})`, 'ok');
  } else {
    _showVersionToast('ℹ️ 이미 최신 버전입니다 (새 배포 없음)', 'info');
  }
}
window.addEventListener('DOMContentLoaded', _verifyPendingUpdate);

// ── 설정 패널의 "최신 버전으로 갱신" 버튼 — 수동 강제 갱신 ──────
// 자동 감지(_autoApplyUpdate)와 달리 사용자가 언제든 직접 누를 수 있다.
// 1) 갱신 전 /version.json을 읽어 beforeVersion을 sessionStorage에 보관
//    (새로고침 후에도 살아남아야 실제 갱신 여부를 비교할 수 있다)
// 2) 모든 Cache Storage 항목 삭제 (sw.js가 들고 있던 캐시 전부 무효화)
// 3) SW 갱신 체크 → 새 버전 있으면 즉시 skipWaiting 지시
// 4) 새로고침 뒤 _verifyPendingUpdate()가 /version.json을 다시 읽어
//    beforeVersion과 실제로 달라졌는지 비교하고, 그 결과를 있는 그대로
//    토스트로 보여준다 — "눌렀으니 성공"이 아니라 "실제로 바뀌었는지"를
//    검증한다. (2026-09-14 수정 — 예전엔 새 버전 유무와 무관하게 항상
//    "✅ 갱신 완료"만 보여줘서, 실제로 갱신됐는지 사용자가 알 수 없다는
//    신고가 있었음)
async function forceUpdateApp(btn) {
  const label = document.getElementById('btn-force-update-label');
  if (btn) btn.style.pointerEvents = 'none';
  if (label) label.textContent = '확인 중…';
  window._manualUpdateInProgress = true; // controllerchange 자동 새로고침 억제

  const beforeVersion = await _fetchCurrentVersion();

  let hadWaitingSW = false;
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      console.log('[PWA] 강제 갱신 — 캐시 전체 삭제 완료:', keys);
    }

    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.update();
        if (reg.waiting) {
          hadWaitingSW = true;
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      }
    }
  } catch (err) {
    console.warn('[PWA] 강제 갱신 실패 — 일반 새로고침으로 대체:', err);
  }

  sessionStorage.setItem(_VERSION_VERIFY_KEY, JSON.stringify({
    beforeVersion, ts: Date.now(),
  }));

  if (label) label.textContent = hadWaitingSW ? '적용 중…' : '확인됨 — 새로고침 중…';
  setTimeout(() => window.location.reload(), hadWaitingSW ? 1100 : 500);
}
window.forceUpdateApp = forceUpdateApp;

// ── Android/Chrome — beforeinstallprompt 이벤트 ─────────
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _deferredInstallPrompt = e;

  // 설치 버튼 상단에 표시
  const installBtn = document.getElementById('btn-install');
  if (installBtn) installBtn.style.display = 'flex';

  // 이미 설치됐거나 사용자가 7일 이내 거절한 경우 표시 안 함
  if (_shouldShowInstallBanner()) {
    // 첫 방문 또는 재방문 시 2초 후 배너 표시
    setTimeout(() => _showInstallBanner('android'), 2000);
  }
});

// ── 앱이 이미 설치된 상태로 실행 시 ────────────────────────
window.addEventListener('appinstalled', () => {
  console.log('[PWA] 앱 설치 완료');
  localStorage.setItem(_INSTALL_DONE_KEY, Date.now());
  _hideInstallBanner();
  // 설치 버튼 숨김
  const btn = document.getElementById('btn-install');
  if (btn) btn.style.display = 'none';
});

// ── iOS Safari 감지 ──────────────────────────────────────
function _isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
function _isInStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches ||
         window.navigator.standalone === true;
}

// ── 배너 표시 여부 판단 ───────────────────────────────────
function _shouldShowInstallBanner() {
  if (localStorage.getItem(_INSTALL_DONE_KEY))    return false;  // 이미 설치
  if (_isInStandaloneMode())                       return false;  // 이미 독립 실행 중
  const dismissed = localStorage.getItem(_INSTALL_DISMISSED_KEY);
  if (dismissed && Date.now() - dismissed < 7 * 24 * 60 * 60 * 1000) return false; // 7일 이내 거절
  return true;
}

// ── 배너 표시 ────────────────────────────────────────────
function _showInstallBanner(type) {
  _installBannerVisible = true;   // 배너 활성 → GPS 요청 대기
  if (type === 'ios') {
    document.getElementById('ios-install-banner')?.classList.add('show');
  } else {
    document.getElementById('install-banner')?.classList.add('show');
  }
}
function _hideInstallBanner() {
  _installBannerVisible = false;  // 배너 해소 → GPS 요청 허용
  document.getElementById('install-banner')?.classList.remove('show');
  document.getElementById('ios-install-banner')?.classList.remove('show');
  // manual-install-banner는 .show 클래스가 아니라 인라인 display:flex로 보여지므로
  // (beforeinstallprompt 미지원 브라우저 안내용) 따로 꺼줘야 한다 — 이게 빠져있어서
  // "확인"을 눌러도 배너가 화면에서 안 사라지는 버그가 있었다.
  const manual = document.getElementById('manual-install-banner');
  if (manual) manual.style.display = 'none';
}

// ── 설치 버튼 클릭 ────────────────────────────────────────
async function installPWA() {
  if (!_deferredInstallPrompt) return;
  _hideInstallBanner();
  _deferredInstallPrompt.prompt();
  const { outcome } = await _deferredInstallPrompt.userChoice;
  console.log('[PWA] 설치 선택:', outcome);
  if (outcome === 'accepted') {
    localStorage.setItem(_INSTALL_DONE_KEY, Date.now());
  }
  _deferredInstallPrompt = null;
  window.dispatchEvent(new CustomEvent('gopang:pwa-install-done'));
}

// 설치 + 권한 요청 통합
async function installPWAWithPermission() {
  // 1. PWA 설치
  if (_deferredInstallPrompt) {
    await installPWA();
  } else {
    // beforeinstallprompt 없음 → 수동 안내
    _hideInstallBanner();
    const manual = document.getElementById('manual-install-banner');
    if (manual) manual.style.display = 'flex';
    localStorage.setItem(_INSTALL_DISMISSED_KEY, Date.now());
  }
  // 2. 권한 요청
  await _requestPWAPermissions().catch(() => {});
}
window.installPWAWithPermission = installPWAWithPermission;

// ── 나중에 버튼 ──────────────────────────────────────────
function dismissInstall() {
  _hideInstallBanner();
  localStorage.setItem(_INSTALL_DISMISSED_KEY, Date.now());
  window.dispatchEvent(new CustomEvent('gopang:pwa-install-done'));
}
function dismissIOSInstall() {
  _hideInstallBanner();
  localStorage.setItem(_INSTALL_DISMISSED_KEY, Date.now());
  window.dispatchEvent(new CustomEvent('gopang:pwa-install-done'));
}

// ── 사용자가 직접 설치 요청 (홈 화면 추가 버튼 등) ─────────
function requestInstall() {
  if (_isInStandaloneMode()) {
    appendBubble?.('ai', '✅ 혼디는 이미 홈 화면에 설치되어 있습니다.');
    return;
  }
  if (_deferredInstallPrompt) {
    installPWA();
  } else if (_isIOS()) {
    _showInstallBanner('ios');
  } else {
    appendBubble?.('ai',
      '📱 설치 방법:\n' +
      '• Chrome: 주소창 우측 설치 아이콘(⊕) 탭\n' +
      '• Safari: 공유 버튼 → 홈 화면에 추가\n' +
      '• Samsung Internet: 메뉴 → 홈 화면에 추가');
  }
}

// ── iOS 첫 방문 시 안내 ──────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  if (_isIOS() && !_isInStandaloneMode() && _shouldShowInstallBanner()) {
    setTimeout(() => _showInstallBanner('ios'), 3000);
  }

  // 이미 설치된 상태(독립 실행)면 설치 버튼 숨김
  if (_isInStandaloneMode() || localStorage.getItem(_INSTALL_DONE_KEY)) {
    const btn = document.getElementById('btn-install');
    if (btn) btn.style.display = 'none';
  } else if (!_isIOS() && _shouldShowInstallBanner()) {
    // Android — beforeinstallprompt 없으면 2초 후 수동 배너 표시
    setTimeout(() => {
      if (!_deferredInstallPrompt && !_isInStandaloneMode()) {
        const manual = document.getElementById('manual-install-banner');
        if (manual) manual.style.display = 'flex';
      }
    }, 2000);
  }

  // URL 파라미터 ?ai=1 — AI 비서 자동 활성화 (manifest shortcuts)
  if (new URLSearchParams(location.search).get('ai') === '1') {
    setTimeout(() => activateAI?.(false), 1000);
  }
});

// ── 상단 설치 버튼 (선택적 노출) ────────────────────────────
// AI 비서가 "홈에 설치해줘" 지시 받을 때도 호출됨
window._requestInstall = requestInstall;
// ══════════════════════════════════════════════════════════
// 고팡 사용자 신원 시스템 v2.0
// IPv6 형식 정체성 + 4단어 시드 + MediaPipe 얼굴 인식
// 다단계 인증 L0(기기) ~ L3(기기+얼굴+지문+4단어)
// private key 저장 없음 — 생체+시드로 매번 재생성
// ══════════════════════════════════════════════════════════

// ── MediaPipe 지연 로드 ──────────────────────────────────
let _mpFaceLandmarker = null;
let _mpLoading        = false;

// ── PWA 설치 후 권한 자동 요청 ─────────────────────────────
// ?pwa=1 파라미터로 진입하거나 standalone 모드일 때 즉시 요청
async function _requestPWAPermissions() {
  const results = {};
  // 카메라
  try {
    const cam = await navigator.permissions.query({ name: 'camera' });
    if (cam.state === 'prompt') {
      const s = await navigator.mediaDevices.getUserMedia({ video: true });
      s.getTracks().forEach(t => t.stop());
      results.camera = 'granted';
    } else { results.camera = cam.state; }
  } catch(e) { results.camera = 'denied'; }

  // 마이크
  try {
    const mic = await navigator.permissions.query({ name: 'microphone' });
    if (mic.state === 'prompt') {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach(t => t.stop());
      results.microphone = 'granted';
    } else { results.microphone = mic.state; }
  } catch(e) { results.microphone = 'denied'; }

  // 위치
  try {
    const geo = await navigator.permissions.query({ name: 'geolocation' });
    if (geo.state === 'prompt') {
      await new Promise((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 })
      );
      results.geolocation = 'granted';
    } else { results.geolocation = geo.state; }
  } catch(e) { results.geolocation = 'denied/timeout'; }

  console.info('[PWA] 권한 요청 결과:', results);
  localStorage.setItem('hondi_perm_requested', '1');
  return results;
}

// 진입 시 자동 실행
window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(location.search);
  const isPWA  = _isInStandaloneMode() || params.get('pwa') === '1';
  const alreadyAsked = localStorage.getItem('hondi_perm_requested');

  if (isPWA && !alreadyAsked) {
    // 약간의 지연 후 요청 (UI 완전 로드 후)
    setTimeout(_requestPWAPermissions, 1500);
  }

  // ?scan=1 — 스캐너 바로 열기
  if (params.get('scan') === '1') {
    setTimeout(() => window.openHondiScanner?.(), 2000);
  }

  // ── ?shared=<id> — Web Share Target으로 받은 문서(2026-07-09 신설) ──
  // 정부24 등에서 "공유하기"로 보낸 문서를 감지해, call-ai.js의
  // _buildShareInboxContext()가 다음 AI 턴에 자연스럽게 물어보도록
  // sessionStorage에 "확인 대기" 플래그만 남긴다 — 여기서 직접 자동
  // 확정하지 않는다(_buildFirstContactContext와 동일한 1회성 주입
  // 패턴, PDV 문서용도 확인 원칙 그대로).
  const sharedId = params.get('shared');
  if (sharedId) {
    (async () => {
      try {
        const { getSharedDocument } = await import('/src/gopang/pdv/share-inbox.js');
        const { guessDocumentMatch, BANKRUPTCY_REQUIRED_DOCS, BANKRUPTCY_EVIDENCE_DOCS } = await import('/src/gopang/pdv/procedure-docs.js');
        const doc = await getSharedDocument(sharedId);
        if (!doc) return; // 이미 처리됐거나 만료됨 — 조용히 무시
        const guesses = guessDocumentMatch(doc, [...BANKRUPTCY_REQUIRED_DOCS, ...BANKRUPTCY_EVIDENCE_DOCS]);
        sessionStorage.setItem('hondi_share_pending', JSON.stringify({
          id: sharedId,
          filename: doc.filename,
          title: doc.title,
          guesses,
          procedureId: 'court-filing',
        }));
        console.info('[Share] 공유 문서 대기 등록:', doc.filename, '추정:', guesses);
      } catch (e) {
        console.warn('[Share] 공유 문서 처리 실패:', e.message);
      }
    })();
  }
});
