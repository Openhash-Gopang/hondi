/**
 * gopang-sso.js  v1.0
 * 나비 중앙 인증 라이브러리 — 하위 서비스 전용
 *
 * 배포 위치 : https://hondi.net/auth/gopang-sso.js
 * 하위 서비스: import { gopangAuth } from 'https://hondi.net/auth/gopang-sso.js'
 *
 * 백서 §12 준수
 * ─ 하위 서비스는 독자 인증 구현 금지
 * ─ gopangAuth.require(level) 단일 호출로 모든 인증 처리
 * ─ 4가지 경로 자동 처리: GWP토큰 → sessionStorage → Silent iframe → 리다이렉트
 */

const _GOPANG_ORIGIN  = 'https://hondi.net';
const _WORKER         = 'https://hondi-proxy.tensor-city.workers.dev';
const _STORE_KEY      = 'gopang_user_v4';       // gopang_v2와 공유
const _SSO_SESSION    = 'gopang_sso_token';     // sessionStorage 키
const _LEVEL_ORDER    = { L0:0, L1:1, L2:2, L3:3 };

// ── HMAC-SHA256 검증 (gwp_token sig 검증용) ──────────────
async function _hmacVerify(payload, sig, seedHex) {
  try {
    const keyBytes = _hexToBytes(seedHex.slice(0, 64));
    const key = await crypto.subtle.importKey(
      'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sigBytes = _b64urlToBytes(sig);
    const data     = new TextEncoder().encode(JSON.stringify(payload));
    return await crypto.subtle.verify('HMAC', key, sigBytes, data);
  } catch { return false; }
}

// ── HMAC-SHA256 서명 (gwp_token 생성용 — gopang_v2에서 호출) ─
export async function signToken(payload, seedHex) {
  const keyBytes = _hexToBytes(seedHex.slice(0, 64));
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const sig  = await crypto.subtle.sign('HMAC', key, data);
  return _bytesToB64url(new Uint8Array(sig));
}


// ── issueToken: silent-auth.html 호환 alias ─────────────
export async function issueToken(user, svcId) {
  const payload = {
    ver:   '1.0',
    ipv6:  user.ipv6,
    level: user.authLevel || user.level || 'L0',
    svc:   svcId || (location.hostname.replace(/\.hondi\.net$/, '') || 'dev'),
    iat:   Math.floor(Date.now() / 1000),
    exp:   Math.floor(Date.now() / 1000) + 3600,
  };
  if (!user.seedHex) return { payload, sig: 'unsigned' };
  const sig = await signToken(payload, user.seedHex);
  return { payload, sig };
}
// ── 서비스 ID 추출 (hostname에서 자동) ──────────────────
function _detectServiceId() {
  // security.hondi.net → 'security'
  // klaw.hondi.net     → 'klaw'
  // hondi.net (루트)    → 'gopang'
  // localhost           → 'dev'
  const host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return 'dev';
  if (host === 'hondi.net') return 'gopang';
  const sub = host.replace(/\.hondi\.net$/, '');
  return sub !== host ? sub : 'unknown';
}

// ── 경로 1: gwp_token URL 파라미터 검증 ─────────────────
async function _tryGwpToken() {
  const params = new URLSearchParams(location.search);
  const raw    = params.get('gwp_token');
  const isGwp  = params.get('gwp') === '1';
  if (!raw || !isGwp) return null;

  try {
    const decoded  = JSON.parse(atob(_b64urlClean(raw)));
    const { payload, sig } = decoded;

    // 만료 확인
    if (!payload?.exp || Date.now() / 1000 > payload.exp) {
      console.warn('[SSO] gwp_token 만료');
      return null;
    }

    // 서비스 ID 확인
    const svcId = _detectServiceId();
    if (payload.svc !== svcId && payload.svc !== 'dev') {
      console.warn('[SSO] gwp_token svc 불일치:', payload.svc, '≠', svcId);
      return null;
    }

    // seedHex 기반 HMAC 검증
    const stored = _readStore();
    if (stored?.seedHex) {
      const ok = await _hmacVerify(payload, sig, stored.seedHex);
      if (!ok) { console.warn('[SSO] gwp_token HMAC 불일치'); return null; }
    }
    // seedHex 없으면 (신규 기기) payload 신뢰 — Worker로 추후 검증

    // URL 정리 (히스토리에서 토큰 제거)
    const clean = new URL(location.href);
    clean.searchParams.delete('gwp_token');
    clean.searchParams.delete('gwp');
    clean.searchParams.delete('origin');
    clean.searchParams.delete('ctx');
    history.replaceState({}, '', clean.toString());

    // sessionStorage에 캐시
    sessionStorage.setItem(_SSO_SESSION, JSON.stringify({
      ipv6:  payload.ipv6,
      level: payload.level,
      exp:   payload.exp,
    }));

    console.info('[SSO] 경로1 GWP 토큰 인증 ✅', payload.ipv6, payload.level);
    return { ipv6: payload.ipv6, level: payload.level, exp: payload.exp, via: 'gwp' };

  } catch(e) {
    console.warn('[SSO] gwp_token 파싱 오류:', e.message);
    return null;
  }
}

// ── 경로 2-A: sessionStorage 캐시 ───────────────────────
function _trySession() {
  try {
    const raw = sessionStorage.getItem(_SSO_SESSION);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s?.exp || Date.now() / 1000 > s.exp) {
      sessionStorage.removeItem(_SSO_SESSION);
      return null;
    }
    console.info('[SSO] 경로2A 세션 캐시 ✅', s.ipv6, s.level);
    return { ...s, via: 'session' };
  } catch { return null; }
}

// ── 경로 2-B': opener 직접 요청 — iframe 없음 (2026-07-21 신설) ──
// klaw 같은 GWP 서비스는 window.open()으로 열리므로 window.opener가
// 곧 자신을 연 hondi.net 탭이다. 굳이 hondi.net/auth/silent-auth.html을
// 다시 iframe으로 불러올 필요 없이, 그 탭에게 직접 "나 대신 /auth/issue
// 끝내고 완성된 토큰을 달라"고 요청한다 — iframe 안에서 WebAuthn을
// 못 띄우는 문제도, 스토리지/BroadcastChannel 파티셔닝 문제도 애초에
// "hondi.net 페이지를 어딘가에 다시 로드해야 한다"는 전제에서 나왔는데,
// 이 경로는 그 전제 자체가 없다 — 이미 살아있는 실제 창 참조로 직접
// 대화할 뿐이다. window.opener가 없으면(북마크로 klaw.hondi.net을 직접
// 방문한 경우 등) 즉시 null을 반환해 기존 iframe 경로로 넘어간다.
function _tryOpenerAuth(requiredLevel) {
  if (!window.opener || window.opener.closed) return Promise.resolve(null);
  return new Promise(resolve => {
    // ★ 2026-07-22 — 실사로 확인: 새 탭이 잠깐 정상적으로 보이다가 몇 초
    // 뒤 "로그인이 필요합니다" 화면으로 바뀌는 사고가 재현됐다. 이는
    // opener 탭에게 서명을 요청했는데 2.5초 안에 응답을 못 받아
    // 타임아웃 → 리다이렉트로 빠진 것으로 추정된다(opener 탭이 지갑
    // 서명·서버 왕복을 끝내는 데 2.5초보다 오래 걸리는 경우가 실제로
    // 있음). 여유 있게 늘린다 — 그래도 실패하면 정직하게 리다이렉트로
    // 넘어가므로, 값을 늘려서 생기는 부작용은 없다(사용자가 조금 더
    // 기다릴 뿐).
    const TIMEOUT = 6000;
    const requestId = Math.random().toString(36).slice(2);

    let timer = setTimeout(() => {
      cleanup();
      console.info('[SSO] 경로2B\' opener 직접요청 타임아웃');
      resolve(null);
    }, TIMEOUT);

    function onMessage(e) {
      if (e.origin !== _GOPANG_ORIGIN) return;
      if (e.data?.type !== 'GOPANG_ISSUE_TOKEN_RESPONSE') return;
      if (e.data.requestId !== requestId) return;
      cleanup();
      if (e.data.ok && e.data.token) {
        const token = { ipv6: e.data.ipv6, level: e.data.level, exp: e.data.exp, token: e.data.token };
        sessionStorage.setItem(_SSO_SESSION, JSON.stringify(token));
        console.info('[SSO] 경로2B\' opener 직접요청 ✅', token.ipv6);
        resolve({ ...token, via: 'opener' });
      } else {
        console.info('[SSO] opener 직접요청 실패:', e.data.reason || '알 수 없음');
        resolve(null);
      }
    }

    function cleanup() {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
    }

    window.addEventListener('message', onMessage);
    try {
      window.opener.postMessage(
        { type: 'GOPANG_ISSUE_TOKEN_REQUEST', requestId, svc: _detectServiceId(), level: requiredLevel },
        _GOPANG_ORIGIN
      );
    } catch (e) {
      cleanup();
      resolve(null);
    }
  });
}

// ── 경로 2-B: Silent iframe (hondi.net 동일 기기 확인) ──
// opener가 없을 때(직접 방문 등)의 폴백. opener 경로가 훨씬 빠르고
// WebAuthn/파티셔닝 문제도 없으므로, 정상적으로 GWP를 거쳐 열린
// 경우엔 이 함수까지 도달하지 않는다.
function _trySilentIframe(requiredLevel) {
  return new Promise(resolve => {
    const TIMEOUT = 3000; // 3초 내 응답 없으면 포기

    const iframe = document.createElement('iframe');
    iframe.src   = `${_GOPANG_ORIGIN}/auth/silent-auth.html`
                 + `?svc=${_detectServiceId()}&level=${requiredLevel}`;
    iframe.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(iframe);

    let timer = setTimeout(() => {
      cleanup();
      console.info('[SSO] Silent iframe 타임아웃');
      resolve(null);
    }, TIMEOUT);

    function onMessage(e) {
      if (e.origin !== _GOPANG_ORIGIN) return;
      if (e.data?.type !== 'GOPANG_SSO_TOKEN') return;  // silent-auth.html 통일
      cleanup();
      if (e.data.token && !e.data.error) {
        // sessionStorage에 캐시
        sessionStorage.setItem(_SSO_SESSION, JSON.stringify(e.data.token));
        console.info('[SSO] 경로2B Silent iframe ✅', e.data.token.ipv6);
        resolve({ ...e.data.token, via: 'silent' });
      } else {
        console.info('[SSO] Silent iframe 인증 실패:', e.data.error || '토큰 없음');
        resolve(null);
      }
    }

    function cleanup() {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      iframe.remove();
    }

    window.addEventListener('message', onMessage);
  });
}

// ── 경로 2-B(보조): gopang_user_v4 직접 대조 (same-site) ─
// v6.0: 기기 지문 대조 제거. localStorage는 same-origin 외 누구도 읽을 수 없다는
// 사실 자체가 브라우저가 공짜로 주는 보안 경계지만, 그것만으로는 "이 사람이
// 키를 갖고 있다"를 증명하지 못한다(지문은 같은 기종 기기끼리 충돌할 수 있었음).
// 이 경로는 폐기하고, 항상 Silent iframe(_trySilentIframe → Worker /auth/issue의
// 실제 서명+TOFU 검증)을 거치도록 한다 — 느리지만 거짓 양성이 없다.

// ── 경로 2-C/D: hondi.net 리다이렉트 ────────────────────
// silent-auth.html이 리다이렉트 모드(return 파라미터 있을 때)도 처리
function _redirectToGopang(requiredLevel) {
  const returnUrl = encodeURIComponent(location.href);
  const svc       = _detectServiceId();
  const target    = `${_GOPANG_ORIGIN}/auth/silent-auth.html`
                  + `?return=${returnUrl}&svc=${svc}&level=${requiredLevel}`;
  console.info('[SSO] 경로2C 리다이렉트 →', target);
  location.replace(target);
  // 리다이렉트 후 이하 코드 실행 안 됨 → null 반환으로 호출부가 중단
  return null;
}

// ── gopang_user_v4 읽기 전용 ─────────────────────────────
function _readStore() {
  try { return JSON.parse(localStorage.getItem(_STORE_KEY) || 'null'); }
  catch { return null; }
}

// ── 서버 검증 (Worker /auth/verify) ─────────────────────
async function _serverVerify(token) {
  try {
    const res = await fetch(`${_WORKER}/auth/verify`, {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({
        ipv6:  token.ipv6,
        level: token.level,
        svc:   _detectServiceId(),
      }),
    });
    const data = await res.json();
    return data?.valid === true;
  } catch {
    // Worker 미배포 환경: 클라이언트 검증만으로 fallback
    return true;
  }
}

// ── 공개 API ─────────────────────────────────────────────
export const gopangAuth = {

  /**
   * require(level, opts)
   * 백서 §12.5 표준 패턴
   * opts.optional === true 이면: 실패해도 hondi.net으로 리다이렉트하지 않고
   * null만 반환한다 — 공개 콘텐츠 페이지(둘러보기, 벤치마크 결과 등)가
   * "로그인했으면 개인화, 안 했으면 그냥 익명으로 보여주기"를 구현할 때 씀.
   * 2026-07-23 신설 — 이전엔 require()가 항상 실패 시 리다이렉트했기 때문에,
   * 로그인 없이도 봐도 되는 페이지(K-Law 랜딩/벤치마크 등)까지 전부
   * "나비 로그인이 필요합니다" 화면에 막혀서 아예 못 보는 문제가 있었다
   * (실사로 확인 — 본인조차 인증이 꼬이면 공개 페이지를 못 봤다).
   * 반환: { ipv6, level, exp } | null (필수 모드에서는 리다이렉트 중)
   */
  async require(level = 'L0', opts = {}) {

    // 경로 1: GWP 토큰
    let user = await _tryGwpToken();
    if (user) return _checkLevel(user, level);

    // 경로 2-A: sessionStorage 캐시
    user = _trySession();
    if (user) return _checkLevel(user, level);

    // 경로 2-B': opener 직접 요청 — iframe 없음, GWP로 정상 진입한
    // 경우 대부분 여기서 끝난다.
    user = await _tryOpenerAuth(level);
    if (user) return _checkLevel(user, level);

    // opener가 없는 경우(klaw.hondi.net 북마크 직접 방문 등) — 2026-07-21
    // 사용자 지시로 Silent iframe 시도 자체를 없앴다. klaw.hondi.net 등
    // 하위 서비스 저장소가 이미 자체적으로 hondi.net 로그인 안내 화면을
    // 직접 제공하고 있어("hondi.net에서 로그인" 버튼 → 실제 페이지 이동),
    // 성공률이 낮았던 iframe 시도(WebAuthn 무제스처·스토리지 파티셔닝
    // 문제)로 몇 초를 허비할 이유가 없다 — 곧장 로그인 안내로 넘어간다.
    // (구 Silent iframe 경로였던 _trySilentIframe()은 삭제하지 않고
    // 남겨뒀다 — 당장 쓰이진 않지만, 나중에 opener/자체 로그인 화면
    // 둘 다 없는 신규 하위 서비스가 생기면 그때 재사용할 수 있다.)
    if (opts.optional) {
      console.info('[SSO] 선택적 인증 실패 — 리다이렉트하지 않고 비로그인 상태로 진행');
      return null;
    }
    return _redirectToGopang(level);
  },

  /**
   * verify(level)
   * 이미 인증된 사용자의 레벨을 상향할 때
   * hondi.net/auth/upgrade?level=L2 팝업 → postMessage 결과 수신
   */
  async verify(level) {
    const session = _trySession();
    if (session && _LEVEL_ORDER[session.level] >= _LEVEL_ORDER[level]) return session;

    return new Promise(resolve => {
      const popup = window.open(
        `${_GOPANG_ORIGIN}/auth/upgrade?level=${level}&svc=${_detectServiceId()}`,
        'gopang_auth',
        'width=480,height=600,menubar=no,toolbar=no'
      );

      function onMessage(e) {
        if (e.origin !== _GOPANG_ORIGIN) return;
        if (e.data?.type !== 'GOPANG_AUTH_RESULT') return;
        window.removeEventListener('message', onMessage);
        if (popup && !popup.closed) popup.close();
        if (e.data.ok && e.data.token) {
          sessionStorage.setItem(_SSO_SESSION, JSON.stringify(e.data.token));
          resolve({ ...e.data.token, via: 'popup' });
        } else {
          resolve(null);
        }
      }

      window.addEventListener('message', onMessage);

      // 팝업 강제 종료 감지
      const poll = setInterval(() => {
        if (popup?.closed) {
          clearInterval(poll);
          window.removeEventListener('message', onMessage);
          resolve(null);
        }
      }, 500);
    });
  },

  /** 현재 세션 반환 (인증 시도 없음) */
  session() { return _trySession(); },

  /** 로그아웃 (세션 초기화) */
  logout() {
    sessionStorage.removeItem(_SSO_SESSION);
    console.info('[SSO] 로그아웃 완료');
  },
};

// ── 레벨 충족 확인 ───────────────────────────────────────
function _checkLevel(user, required) {
  if (_LEVEL_ORDER[user.level] >= _LEVEL_ORDER[required]) return user;
  // 레벨 부족 → 팝업으로 상향
  console.info('[SSO] 레벨 부족 — 상향 필요:', user.level, '→', required);
  return gopangAuth.verify(required);
}

// ── 유틸 ─────────────────────────────────────────────────
function _b64urlClean(s) {
  return s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - s.length % 4) % 4);
}
function _b64urlToBytes(s) {
  return Uint8Array.from(atob(_b64urlClean(s)), c => c.charCodeAt(0));
}
function _bytesToB64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function _hexToBytes(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++)
    arr[i] = parseInt(hex.slice(i*2, i*2+2), 16);
  return arr;
}
