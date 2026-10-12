/**
 * subsystem-auth.js  v1.2
 * 나비 하위 시스템 공용 인증 모듈
 *
 * 배포 위치: https://hondi.net/auth/subsystem-auth.js
 *
 * 사용법 (각 하위 시스템 HTML에 단 한 줄):
 *   <script type="module"
 *     src="https://hondi.net/auth/subsystem-auth.js">
 *   </script>
 *
 * 또는 함수를 직접 import할 때:
 *   import { initAuth, requireLevel }
 *     from 'https://hondi.net/auth/subsystem-auth.js';
 *
 * 백서 §12: 하위 서비스 독자 인증 구현 금지
 *
 * v1.1 변경사항:
 *   - 인증 완료 후 K-Security 에이전트 자동 로드 (방안 2)
 *   - data-security="false" 로 개별 시스템에서 비활성화 가능
 *
 * v1.2 변경사항:
 *   - _detectServiceId() 함수 추가 (gopang-sso.js 의존 제거)
 *   - ReferenceError: _detectServiceId is not defined 수정
 */

// ── gopang-sso.js 로드 ────────────────────────────────────
let _gopangAuth = null;
let _user       = null;

async function _loadSSO() {
  if (_gopangAuth) return;
  try {
    const mod  = await import('./gopang-sso.js');
    _gopangAuth = mod.gopangAuth;
  } catch(e) {
    console.warn('[SubsystemAuth] gopang-sso.js 로드 실패, 로컬 폴백:', e.message);
    _gopangAuth = _localFallback();
  }
}

// ── 공개 API ─────────────────────────────────────────────

/**
 * initAuth()
 * 하위 시스템 초기화 시 호출. L0 인증 수행.
 * 이 스크립트를 불러온 <script> 태그에 data-required="false"가 있으면
 * 인증에 실패해도 hondi.net으로 리다이렉트하지 않고, 그냥 비로그인
 * 상태(_user=null)로 페이지 렌더링을 계속한다 — 로그인 없이 봐도 되는
 * 공개 페이지(랜딩, 벤치마크 결과 등)에 씀. 기본값은 지금까지와 동일하게
 * 필수(true)라서, 이 속성을 안 붙인 기존 페이지들의 동작은 안 바뀐다.
 * 반환: { ipv6, level, exp } | null
 */
export async function initAuth() {
  await _loadSSO();
  const scriptEl = document.querySelector('script[src*="subsystem-auth.js"]');
  const required = scriptEl?.dataset?.required !== 'false';
  _user = await _gopangAuth.require('L0', { optional: !required });
  if (!_user) {
    _autoHideLoading(); // 필수 모드면 require()가 이미 리다이렉트 중; 선택 모드면 그냥 비로그인으로 계속
    return null;
  }
  _renderAuthBadge();
  _autoHideLoading();
  // 페이지 인라인 스크립트에 인증 결과 전달
  if (typeof window._onGopangAuth === 'function') {
    window._onGopangAuth(_user);
  }
  // ── K-Security 에이전트 자동 로드 (v1.1) ─────────────────
  // 인증 완료 후 security-agent.js를 동적으로 삽입.
  // 비활성화: <script ... data-security="false">
  _loadSecurityAgent();
  return _user;
}

// ── 서비스 ID 추출 (hostname에서 자동) ──────────────────
// gopang-sso.js의 동일 함수와 동기화 유지
function _detectServiceId() {
  const host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return 'dev';
  if (host === 'hondi.net') return 'gopang';
  const sub = host.replace(/\.hondi\.net$/, '');
  return sub !== host ? sub : 'unknown';
}

// ── K-Security 에이전트 동적 로드 ────────────────────────
function _loadSecurityAgent() {
  // 이미 로드된 경우 중복 방지
  if (document.getElementById('ksec-agent')) return;

  // 현재 스크립트 태그에서 data-security 속성 확인
  // <script type="module" src="...subsystem-auth.js" data-security="false">
  // → 위처럼 명시한 경우에만 비활성화
  const scriptEl = document.querySelector(
    'script[src*="subsystem-auth.js"]'
  );
  if (scriptEl?.dataset?.security === 'false') return;

  // 서비스 ID: data-svc 속성 → hostname 자동 감지 순
  const svcId  = scriptEl?.dataset?.svc || _detectServiceId();
  const svcUrl = location.hostname;

  const agent     = document.createElement('script');
  agent.id        = 'ksec-agent';
  agent.src       = 'https://security.hondi.net/security-agent.js';
  agent.dataset.svc = svcId;
  agent.dataset.url = svcUrl;
  // 인증된 사용자 정보를 에이전트에 전달 (진단 정확도 향상)
  agent.dataset.authLevel = _user?.level || 'L0';
  document.head.appendChild(agent);

  console.info('[SubsystemAuth] K-Security 에이전트 로드:', svcId);
}

/**
 * requireLevel(level)
 * 중요 기능 호출 전 레벨 상향 요청.
 * 예) const ok = await requireLevel('L1');
 */
export async function requireLevel(level) {
  await _loadSSO();
  const result = await _gopangAuth.require(level);
  if (result) { _user = result; _renderAuthBadge(); }
  return result;
}

/**
 * getUser()
 * 현재 인증된 사용자 객체 반환 (인증 시도 없음).
 */
export function getUser() { return _user; }

/**
 * logout()
 */
export function logout() { _gopangAuth?.logout?.(); }

// ── 내부 유틸 ────────────────────────────────────────────

/** auth-badge 엘리먼트 업데이트 */
function _renderAuthBadge() {
  const el = document.getElementById('auth-badge');
  if (!el || !_user) return;
  const cfg = {
    L0: { label:'L0', color:'var(--txt3, #9ca3af)' },
    L1: { label:'L1', color:'#00bcd4'              },
    L2: { label:'L2', color:'var(--green, #3ecf8e)' },
    L3: { label:'L3', color:'#ff9800'              },
  };
  const c = cfg[_user.level] || cfg.L0;
  el.style.color = c.color;
  el.textContent = c.label;
  el.title       = _user.ipv6 || '';
  el.onclick     = showAuthPanel;
}

/** auth-loading 엘리먼트 자동 숨김 */
function _autoHideLoading() {
  const el = document.getElementById('auth-loading');
  if (el) el.style.display = 'none';
}

/** 인증 정보 패널 표시 */
export function showAuthPanel() {
  const modal   = document.getElementById('auth-modal');
  const content = document.getElementById('auth-modal-content');
  if (!modal || !content) return;

  // 서비스명: hostname에서 자동 추출 (police.hondi.net → K-Police)
  const sub = location.hostname.replace(/\.hondi\.net$/, '');
  const svcLabel = sub !== location.hostname
    ? 'K-' + sub.charAt(0).toUpperCase() + sub.slice(1)
    : '나비 서비스';

  content.innerHTML = `
    <div style="text-align:center;padding:8px 0 20px">
      <div style="font-size:28px;margin-bottom:10px">🔑</div>
      <div style="font-size:16px;font-weight:700;margin-bottom:12px">나비 인증</div>
      <div style="font-size:12px;color:#6b7280;line-height:1.8;margin-bottom:16px">
        ${svcLabel}은 나비(hondi.net) 인증을 사용합니다.<br>
        현재 레벨:
        <strong style="color:#3ecf8e">${_user?.level || 'L0'}</strong>
        &nbsp;|&nbsp;
        IPv6: <code style="font-size:10px;color:#9ca3af">
          ${(_user?.ipv6 || '').slice(0, 24)}…
        </code>
      </div>
      <a href="https://hondi.net" target="_blank"
        style="display:flex;align-items:center;justify-content:center;
               width:100%;padding:12px;border-radius:8px;
               background:#3ecf8e;color:#fff;
               font-size:14px;font-weight:600;
               text-decoration:none;margin-bottom:8px">
        나비 앱 열기
      </a>
      <button onclick="document.getElementById('auth-modal').classList.remove('open')"
        style="width:100%;padding:10px;border-radius:8px;
               border:1px solid #e5e7eb;background:transparent;
               color:#6b7280;font-size:13px;cursor:pointer">
        닫기
      </button>
    </div>`;
  modal.classList.add('open');
}

/** 로그인 안내 모달 표시 */
export function showLoginPrompt(level) {
  const modal   = document.getElementById('auth-modal');
  const content = document.getElementById('auth-modal-content');
  if (!modal || !content) {
    // 모달 없는 환경 → silent-auth.html 리다이렉트
    const svc = location.hostname.replace(/\.hondi\.net$/, '') || 'dev';
    location.replace(
      `https://hondi.net/auth/silent-auth.html`
      + `?return=${encodeURIComponent(location.href)}&svc=${svc}&level=${level || 'L0'}`
    );
    return;
  }
  content.innerHTML = `
    <div style="text-align:center;padding:8px 0 20px">
      <div style="font-size:28px;margin-bottom:10px">🔒</div>
      <div style="font-size:16px;font-weight:700;margin-bottom:12px">나비 인증 필요</div>
      <div style="font-size:12px;color:#6b7280;line-height:1.8;margin-bottom:16px">
        나비(hondi.net) 계정으로 로그인하면<br>
        모든 하위 서비스를 이용할 수 있습니다.
        ${level ? `<br><strong>${level}</strong> 인증이 필요합니다.` : ''}
      </div>
      <a href="https://hondi.net" target="_blank"
        style="display:flex;align-items:center;justify-content:center;
               width:100%;padding:12px;border-radius:8px;
               background:#3ecf8e;color:#fff;
               font-size:14px;font-weight:600;
               text-decoration:none;margin-bottom:8px">
        hondi.net 열기
      </a>
      <button onclick="location.reload()"
        style="width:100%;padding:10px;border-radius:8px;
               border:1px solid #e5e7eb;background:transparent;
               color:#374151;font-size:13px;cursor:pointer;margin-bottom:8px">
        인증 후 새로고침
      </button>
      <button onclick="document.getElementById('auth-modal').classList.remove('open')"
        style="width:100%;padding:10px;border-radius:8px;
               border:1px solid #e5e7eb;background:transparent;
               color:#9ca3af;font-size:13px;cursor:pointer">
        닫기
      </button>
    </div>`;
  modal.classList.add('open');
}

// ── 로컬 폴백 (gopang-sso.js 로드 실패 시) ───────────────
// v6.0: 이전에는 gopang_user_v4를 서명 검증 없이 그대로 믿고 토큰을 만들어줬다
// (지문 대조조차 없었음 — gopang-sso.js의 옛 _tryLocalStore보다도 약한 경로).
// gopang-sso.js(따라서 Worker /auth/issue 서명+TOFU 검증)를 로드할 수 없는
// 상황에서는 "검증 안 됨"을 인정하고 로그인 안내로 보내는 쪽이 안전하다 —
// 네트워크 장애 상황에서까지 무검증 신뢰를 허용할 이유가 없다.
function _localFallback() {
  const SESSION = 'gopang_sso_token';
  const LVL     = { L0:0, L1:1, L2:2, L3:3 };

  return {
    async require(level, opts = {}) {
      // 세션 캐시(이전에 gopang-sso.js가 정상적으로 서버 검증해 발급한 토큰)만 신뢰
      try {
        const s = JSON.parse(sessionStorage.getItem(SESSION) || 'null');
        if (s?.exp && Date.now() / 1000 < s.exp && LVL[s.level] >= LVL[level])
          return { ...s, via: 'session' };
      } catch {}
      // 검증 모듈을 로드할 수 없으므로 로컬 데이터를 무검증으로 신뢰하지 않는다
      if (!opts?.optional) showLoginPrompt(level);
      return null;
    },
    async verify(level) { return this.require(level); },
    session() {
      try { return JSON.parse(sessionStorage.getItem(SESSION) || 'null'); }
      catch { return null; }
    },
    logout() { sessionStorage.removeItem(SESSION); },
  };
}

// ── 자동 실행: <script src="..."> 방식으로 삽입 시 ───────
// type="module" 스크립트는 import 없이 삽입해도 initAuth()가
// DOMContentLoaded 이후 자동 실행되도록 처리
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => initAuth());
} else {
  initAuth();
}
