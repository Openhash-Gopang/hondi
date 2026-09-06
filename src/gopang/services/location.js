import { setUserLocation, setLocationReady, setLocationPending, _userLocation, _locationReady, _locationPending, _installBannerVisible, PROXY } from '../core/state.js';
import { CFG } from '../core/config.js';

export function _scheduleLocation() {
  const start = Date.now();
  function tryInit() {
    if (!_installBannerVisible || Date.now() - start > 6000) _initLocation();
    else setTimeout(tryInit, 500);
  }
  setTimeout(tryInit, 1000);
}

export function _initLocation() {
  if (_locationPending || _locationReady) return;
  setLocationPending(true);
  _resolveLocation();

  // ── 고착 방지 워치독 (2026-09-06 신설 — 사고실험으로 발견) ─────────
  // navigator.geolocation.watchPosition()은 네이티브 권한 다이얼로그를
  // 사용자가 방치(응답 안 함)하면 성공·실패 콜백 어느 쪽도 영원히 호출
  // 하지 않는다(PositionOptions.timeout은 권한 허용 "이후" 좌표 획득에만
  // 적용되는 값이라 여기 소용없음). 이 경우 _locationPending이 true로
  // 영구 고착되고, 새로 배선한 _waitForLocationReady()(호출부: call-ai.js)가
  // 그 세션의 모든 후속 턴마다 4초씩 낭비하게 된다 — _resolveLocation()과
  // 무관하게, 10초 뒤에도 여전히 pending이면 강제로 IP 폴백/UNKNOWN으로
  // 정착시켜 이 고착을 원천 차단한다. _resolveLocation()이 먼저 정상
  // 완료됐으면(_locationPending이 이미 false) 아무 것도 하지 않는다.
  setTimeout(async () => {
    if (!_locationPending) return;
    const ipLoc = await _tryIpFallback();
    if (!_locationPending) return; // 대기 중 다른 경로가 먼저 끝났으면 덮어쓰지 않음
    setUserLocation(ipLoc || { source: 'UNKNOWN', address: null, lat: null, lng: null });
    _updateLocationInPrompt();
    setLocationPending(false); setLocationReady(true);
  }, 10000);
}

// ── 위치 확보 순서 재설계 (2026-07-23 — 실사로 발견한 문제 수정) ──────────
// 기존 코드는 "GPS 실패 시 → localStorage의 gopang_profile_address 조회"
// 순서였는데, 그 localStorage 키는 저장소 전체에서 읽히기만 하고 어디서도
// 쓰인 적이 없는 죽은 경로였다 — 그래서 GPS가 거부되면 곧바로 UNKNOWN으로
// 떨어져 SP가 사용자에게 주소를 직접 물어보는 문제가 실사로 확인됐다.
//
// 새 순서(주피터 지시): ① 사용자 프로필에 저장된 주소가 있으면 최우선으로
// 그걸 쓴다(서버 profiles.address — register-flow.js가 가입 시 이미
// 채워둔 바로 그 필드). ② 프로필에 없으면(아직 프로필 작성 전) GPS
// 좌표를 얻어 Kakao 역지오코딩(coord2address, 이미 존재하는 /geocode
// 엔드포인트 — register-flow.js가 가입 화면에서 쓰는 것과 동일)으로
// 행정주소를 도출한다. 기존 코드는 GPS 성공 시에도 좌표만 쓰고 이
// Kakao 변환을 아예 하지 않았다.
// ── IP 기반 최종 폴백 (2026-09-06 신설) ────────────────────────────
// 실사 리포트: "위치를 모르면 즉시 카카오맵 API를 호출해야 하는데 안
// 한다" — 기존 코드는 GPS가 거부/불가능하면 곧장 UNKNOWN으로 떨어지고
// 끝이었다(카카오 역지오코딩은 GPS 좌표가 있을 때만 호출됐음). 이제
// worker.js의 /geo-ip-fallback(Cloudflare 엣지의 request.cf, 키 불필요)로
// 도시 단위 좌표를 얻은 뒤, 좌표가 있으면 기존 카카오 역지오코딩에 그대로
// 태워 행정주소까지 도출한다. GPS보다 정확도가 낮으므로 source로 구분한다.
async function _tryIpFallback() {
  try {
    const res = await fetch(`${PROXY}/geo-ip-fallback`, { cache: 'no-cache' });
    if (!res.ok) return null;
    const geo = await res.json().catch(() => null);
    if (!geo) return null;
    if (geo.lat != null && geo.lng != null) {
      const addr = await _reverseGeocodeViaKakao(geo.lat, geo.lng);
      return {
        source: 'IP+KAKAO',
        address: addr || [geo.city, geo.region].filter(Boolean).join(' ') || null,
        lat: geo.lat, lng: geo.lng,
      };
    }
    const coarse = [geo.city, geo.region, geo.country].filter(Boolean).join(' ');
    return coarse ? { source: 'IP', address: coarse, lat: null, lng: null } : null;
  } catch (e) {
    console.warn('[Location] IP 폴백 실패(무시):', e.message);
    return null;
  }
}

async function _resolveLocation() {
  const profileAddr = await _loadProfileAddressFromServer();
  if (profileAddr) {
    setUserLocation({ source: 'PROFILE', address: profileAddr, lat: null, lng: null });
    _updateLocationInPrompt();
    setLocationPending(false); setLocationReady(true);
    return;
  }

  if (!navigator.geolocation) {
    const ipLoc = await _tryIpFallback();
    setUserLocation(ipLoc || { source: 'UNKNOWN', address: null, lat: null, lng: null });
    _updateLocationInPrompt();
    setLocationPending(false); setLocationReady(true);
    return;
  }
  let watchId = null, gotFirst = false;
  function startWatch(hi) {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = navigator.geolocation.watchPosition(
      async (pos) => {
        const lat = pos.coords.latitude, lng = pos.coords.longitude, acc = pos.coords.accuracy;
        // 먼저 좌표만으로 즉시 반영(응답성 우선) — Kakao 변환은 비동기로 뒤이어 덮어씀
        setUserLocation({ lat, lng, accuracy: acc, source: 'GPS', address: _userLocation ? _userLocation.address : null, region: _userLocation ? _userLocation.region : null });
        _updateLocationInPrompt();
        if (!gotFirst) { gotFirst = true; setLocationPending(false); setLocationReady(true); if (!hi) startWatch(true); }
        const addr = await _reverseGeocodeViaKakao(lat, lng);
        if (addr) {
          setUserLocation({ lat, lng, accuracy: acc, source: 'GPS+KAKAO', address: addr, region: _userLocation ? _userLocation.region : null });
          _updateLocationInPrompt();
        }
      },
      (err) => {
        navigator.geolocation.clearWatch(watchId); watchId = null;
        if (!hi && err.code !== err.PERMISSION_DENIED) startWatch(true);
        else {
          (async () => {
            const ipLoc = await _tryIpFallback();
            setLocationPending(false);
            setUserLocation(ipLoc || { source: 'UNKNOWN', address: null, lat: null, lng: null });
            _updateLocationInPrompt();
            setLocationReady(true);
          })();
        }
      },
      { enableHighAccuracy: hi, timeout: hi ? 8000 : 5000, maximumAge: 0 }
    );
  }
  startWatch(false);
}

// 로그인한 본인의 프로필 주소를 서버에서 조회 — profile.html의
// _buildViewerAuthQuery()와 동일한 지갑 서명 패턴(본인 확인 후에만
// 서버가 address 필드를 돌려줌, handleProfileGet 참고).
async function _loadProfileAddressFromServer() {
  try {
    const stored = JSON.parse(localStorage.getItem('gopang_user_v4') || 'null');
    const guid = stored?.ipv6 || stored?.guid;
    const wallet = window.gopangWallet;
    if (!guid || !wallet?.signPayload) return null;
    const pubkey = wallet.publicKeyB64u || wallet.publicKeyB64 || '';
    if (!pubkey) return null;
    const ts = Date.now().toString();
    const sig = await wallet.signPayload(`view:${guid}:${pubkey}:${ts}`);
    const q = `viewer_guid=${encodeURIComponent(guid)}&viewer_pubkey=${encodeURIComponent(pubkey)}` +
              `&viewer_sig=${encodeURIComponent(sig)}&viewer_ts=${encodeURIComponent(ts)}`;
    const res = await fetch(`${PROXY}/profile?guid=${encodeURIComponent(guid)}&${q}`, { cache: 'no-cache' });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data?.profile?.address || null;
  } catch (e) {
    console.warn('[Location] 프로필 주소 조회 실패(무시, GPS로 폴백):', e.message);
    return null;
  }
}

// GPS 좌표 → 행정주소. register-flow.js _autoRegion()과 동일한 응답 파싱
// (road_address 우선, 없으면 지번주소) — 기존 /geocode(Kakao coord2address)
// 엔드포인트를 그대로 재사용한다(새 서버 작업 불필요).
async function _reverseGeocodeViaKakao(lat, lng) {
  try {
    const res = await fetch(`${PROXY}/geocode?lat=${lat}&lng=${lng}`, { cache: 'no-cache' });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const doc = data?.documents?.[0];
    return doc?.road_address?.address_name || doc?.address?.address_name || null;
  } catch (e) {
    console.warn('[Location] Kakao 역지오코딩 실패(무시):', e.message);
    return null;
  }
}

// ── 첫 턴 레이스컨디션 해소 (2026-08-22 신설, 사용자 지시) ──────────
// _scheduleLocation()은 setTimeout(1000ms) + 비동기 프로필/GPS 조회라
// 최소 1초 이상 걸린다. 지금까지는 "매 턴 재확인"만 해뒀지 첫 턴이
// 그 사이에 도착하면 pdvLocationHint가 null인 채로 라우팅이 진행되는
// 문제가 실측(2026-08-22 스모크테스트: 09-national/05-emd 계층 시나리오
// 대부분이 위치정보 없이 라우팅됨)으로 확인됐다. 사용자 지적 —
// "사용자의 AI 비서는 항상 사용자의 현재 위치와 주소를 알고 있어야
// 한다"는 원칙을 지키려면 라우팅 직전에 위치 확보를 기다려야 한다.
// 무한정 기다리면 위치 권한을 거부한 사용자가 영원히 응답을 못 받으니
// 상한(기본 4초)을 둔다 — 그 안에 준비 안 되면 그냥 진행(기존 동작과
// 동일, 회귀 없음)한다.
export function _waitForLocationReady(timeoutMs = 4000) {
  if (_locationReady) return Promise.resolve();
  return new Promise((resolve) => {
    const start = Date.now();
    const iv = setInterval(() => {
      if (_locationReady || Date.now() - start > timeoutMs) {
        clearInterval(iv);
        resolve();
      }
    }, 150);
  });
}

export function _updateLocationInPrompt() {
  if (!_userLocation) return;
  CFG.locationStr = _userLocation.address || (_userLocation.lat ? _userLocation.lat.toFixed(4) + ',' + _userLocation.lng.toFixed(4) : '위치없음');
}

export function _buildLocNote() {
  if (!_userLocation || !_userLocation.source) return '';
  const loc = _userLocation;
  const detail = loc.lat ? 'GPS: ' + loc.lat.toFixed(5) + ', ' + loc.lng.toFixed(5) + (loc.address ? ' (' + loc.address + ')' : '') : (loc.address || '위치정보없음');
  return `\n\n[현재 위치]\n` + detail;
}

// ── _buildRoutingFacts (2026-07-05 신설) ─────────────────────────
// GWP로 서브시스템(jeju 등) 새 탭을 열 때, 그쪽 라우터가 GPS 재감지·
// 키워드 매칭만으로 위치·의도를 다시 추론하지 않도록 메인 AI 비서가
// 이미 확보한 정보를 구조화해 미리 건네주는 용도.
//
// 중요(설계 원칙): 이 객체는 _gwpLaunch()를 통해 URL 쿼리 파라미터로
// 새 탭에 전달된다 — 즉 대상 서버 접근 로그·브라우저 히스토리에
// 그대로 남는 채널이다. PDV(사용자의 모든 것을 기록한 private data
// vault)의 민감한 이력(나이 등 사용자가 과거 언급한 개인정보)은
// 절대 여기 담지 않는다. 그런 데이터가 실제로 필요하면 서브시스템이
// 착지 후 기존 PDV_HISTORY_REQUEST/consent.html 동의 흐름으로 직접
// 요청해야 한다 — 이 함수는 그 요청조차 필요 없는, 이미 공개된 수준의
// 정보(현재 위치, 이번 발화)만 담는다.
//
// 주의: 사용자 발화 원문은 이미 _gwpLaunch()의 context 인자(→ URL의 ctx
// 파라미터)가 그대로 전달하므로 이 함수는 중복해서 담지 않는다. facts는
// ctx만으로는 알 수 없는, "메인 비서가 이미 확보한 부가 정보"만 최소한으로
// 싣는 확장 가능한 객체다. 현재는 currentLocation 하나뿐이지만, 이후 항목이
// 추가되더라도 위 민감도 원칙(비 민감 정보만)은 그대로 유지해야 한다.
//
// @returns {object|null} — 실을 정보가 전혀 없으면 null
// ★ 2026-07-31 수정 — 지금까지 이 함수는 _userLocation(GPS·프로필주소를
// location.js가 조합한 상태) 하나만 봤다. 그런데 call-ai.js의
// _loadOwnJobContext()가 이미 인증된 GET /profile 조회로
// window.__hondiOwnProfileCache.address를 별도로 채우고 있었는데(PDV
// 주소 자동제공 기능, 2026-07-30 신설), 이 함수는 그 값을 전혀 보지
// 않고 있었다 — 두 경로가 서로 몰랐던 것. GPS가 거부됐거나 느려도
// 이미 인증된 프로필 조회가 먼저 끝나 있으면 그걸로 대체할 수 있도록
// 폴백을 추가한다(주피터 지시 — PDV·Profile 양쪽 다 확인 가능해야 함).
export function _buildRoutingFacts() {
  const loc = _userLocation;
  const currentLocation =
    (loc && (loc.address || (loc.lat != null ? loc.lat.toFixed(5) + ',' + loc.lng.toFixed(5) : null))) ||
    (typeof window !== 'undefined' ? window.__hondiOwnProfileCache?.address : null) ||
    null;

  if (!currentLocation) return null;

  return { currentLocation };
}
