// ═════════════════════════════════════════════════
// device-link 승인 화면의 "다음 위치 근처" — 요청한 기기의 현재 위치를 주소로 (2026-09-25, 주피터 지시)
//
// 우선순위
//   1) 요청한 기기가 브라우저 위치 권한으로 보내 준 좌표(body.geo = {lat,lng}) → 카카오 REST(coord2address) → 주소   [src='gps']
//   2) 좌표가 없거나 카카오가 실패하면 Cloudflare가 요청 IP로 추정한 좌표(request.cf.latitude/longitude) → 카카오 → 주소  [src='ip']
//   3) 그것도 안 되면 Cloudflare의 시·도·시 이름을 한글로 바꾼 문자열                                                    [src='ip']
//   모두 실패하면 { address: null, src: null } — 승인 화면은 "확인할 수 없음"으로 표시한다.
//
// 개인정보: 좌표는 이 함수 안에서 주소로 바꾸는 데만 쓰고 저장·로그·응답에 남기지 않는다. 남는 것은 주소 문자열뿐이다.
// 표시 정밀도: 기본은 시·도 시·군·구 읍·면·동(ADDR_DEPTH=3). 도로명·지번까지 보이게 하려면 depth를 4로 올린다.
// 카카오 키는 Worker 비밀값 KAKAO_REST_KEY (이미 등록되어 있음). 없으면 카카오 단계를 건너뛴다.
// ═════════════════════════════════════════════════

export const ADDR_DEPTH = 3;
const KAKAO_COORD2ADDR = 'https://dapi.kakao.com/v2/local/geo/coord2address.json';

const KR_REGION = { 'Seoul': '서울특별시', 'Busan': '부산광역시', 'Incheon': '인천광역시', 'Daegu': '대구광역시', 'Daejeon': '대전광역시', 'Gwangju': '광주광역시', 'Ulsan': '울산광역시', 'Sejong': '세종특별자치시', 'Gyeonggi-do': '경기도', 'Gangwon-do': '강원특별자치도', 'North Chungcheong': '충청북도', 'South Chungcheong': '충청남도', 'North Jeolla': '전북특별자치도', 'South Jeolla': '전라남도', 'North Gyeongsang': '경상북도', 'South Gyeongsang': '경상남도', 'Jeju': '제주특별자치도' };
const KR_CITY = { 'Seoul': '서울', 'Busan': '부산', 'Incheon': '인천', 'Daegu': '대구', 'Daejeon': '대전', 'Gwangju': '광주', 'Ulsan': '울산', 'Jeju City': '제주시', 'Seogwipo': '서귀포시', 'Suwon': '수원시', 'Seongnam': '성남시', 'Goyang': '고양시', 'Yongin': '용인시', 'Cheongju': '청주시', 'Jeonju': '전주시', 'Changwon': '창원시' };

/** 대한민국 범위(제주·독도 포함) 안의 유한한 좌표인가 — 카카오 coord2address는 국내만 응답한다. */
export function validKoreaCoord(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= 32.5 && lat <= 39.0 && lng >= 124.0 && lng <= 132.2;
}

/** 카카오 좌표→주소. 성공하면 "시·도 시·군·구 읍·면·동…" 문자열, 실패·국외면 null. */
export async function kakaoAddress(env, lat, lng, { fetchImpl = fetch, timeoutMs = 2500, depth = ADDR_DEPTH } = {}) {
  if (!env?.KAKAO_REST_KEY || !validKoreaCoord(lat, lng)) return null;
  try {
    const res = await fetchImpl(`${KAKAO_COORD2ADDR}?x=${encodeURIComponent(lng)}&y=${encodeURIComponent(lat)}&input_coord=WGS84`, {
      headers: { 'Authorization': `KakaoAK ${env.KAKAO_REST_KEY}` }, signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const d = await res.json();
    const a = d?.documents?.[0]?.address;
    if (!a) return null;
    const parts = [a.region_1depth_name, a.region_2depth_name, a.region_3depth_name, a.main_address_no ? `${a.main_address_no}${a.sub_address_no ? '-' + a.sub_address_no : ''}` : ''];
    const out = parts.slice(0, Math.max(1, depth)).filter(Boolean).join(' ');
    return out || null;
  } catch { return null; }
}

function ipCoords(request) {
  const cf = request?.cf || {};
  const lat = parseFloat(cf.latitude), lng = parseFloat(cf.longitude);
  return validKoreaCoord(lat, lng) ? { lat, lng } : null;
}
function ipLabel(request) {
  const cf = request?.cf || {};
  if (!cf.country) return null;
  if (cf.country === 'KR') return ['대한민국', KR_REGION[cf.region] || cf.region, KR_CITY[cf.city] || cf.city].filter(Boolean).join(' ');
  return [cf.country, cf.region, cf.city].filter(Boolean).join(' ') || null;
}

/** @returns {Promise<{address: string|null, src: 'gps'|'ip'|null}>} */
export async function resolveDeviceGeo(env, request, body, opts = {}) {
  try {
    const g = body?.geo;
    if (g && validKoreaCoord(Number(g.lat), Number(g.lng))) {
      const a = await kakaoAddress(env, Number(g.lat), Number(g.lng), opts);
      if (a) return { address: a, src: 'gps' };
    }
    const ip = ipCoords(request);
    if (ip) {
      const a = await kakaoAddress(env, ip.lat, ip.lng, opts);
      if (a) return { address: a, src: 'ip' };
    }
    const label = ipLabel(request);
    return label ? { address: label, src: 'ip' } : { address: null, src: null };
  } catch { return { address: null, src: null }; }
}
