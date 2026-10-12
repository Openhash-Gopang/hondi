/**
 * pdv/share-inbox.js — Web Share Target으로 받은 문서 관리
 *
 * 2026-07-09 신설 — "정부24 앱과 나비를 앱 대 앱으로 연동하자"는 제안의
 * 구현. 정부 API 서버 연동(자격증명 없어 불가) 대신, 정부24가 이미
 * 지원하는 표준 OS 공유 기능("공유하기")으로 발급받은 문서(PDF)를
 * 사용자가 나비에 직접 보내는 방식 — 표준 웹기술(Web Share Target
 * API)만으로 가능하고 정부 협조가 필요 없다.
 *
 * sw.js의 _handleShareTarget이 받은 파일을 'hondi-share-inbox'라는
 * 별도 Cache Storage에 저장해두면, webapp.html이 로드될 때 URL의
 * ?shared=<id> 파라미터를 보고 이 모듈로 꺼내 쓴다. 원본은 끝까지
 * 클라이언트에만 있다 — 서버로 업로드하지 않는다(PDV 원칙과 동일).
 */

const SHARE_CACHE_NAME = 'hondi-share-inbox';

/**
 * ?shared=<id> 쿼리 파라미터에서 id를 뽑는다.
 * @param {string} search - location.search 형태의 문자열(예: "?shared=abc")
 * @returns {string|null}
 */
export function parseSharedIdFromQuery(search) {
  if (!search) return null;
  const params = new URLSearchParams(search);
  return params.get('shared');
}

/**
 * 공유 인박스에서 특정 id의 문서를 읽어온다.
 * @param {string} id
 * @param {{cacheStore?: CacheStorage}} opts - 테스트용 주입 지점(기본값: 전역 caches)
 * @returns {Promise<{blob: Blob, filename: string, title: string, text: string, mimeType: string, ts: number} | null>}
 */
export async function getSharedDocument(id, opts = {}) {
  if (!id) return null;
  const cacheStore = opts.cacheStore || (typeof caches !== 'undefined' ? caches : null);
  if (!cacheStore) return null;

  const cache = await cacheStore.open(SHARE_CACHE_NAME);
  const res = await cache.match(`/_share-inbox/${id}`);
  if (!res) return null;

  const blob = await res.blob();
  return {
    blob,
    mimeType: res.headers.get('Content-Type') || 'application/octet-stream',
    filename: decodeURIComponent(res.headers.get('X-Share-Filename') || ''),
    title: decodeURIComponent(res.headers.get('X-Share-Title') || ''),
    text: decodeURIComponent(res.headers.get('X-Share-Text') || ''),
    ts: Number(res.headers.get('X-Share-Ts')) || null,
  };
}

/**
 * 사용자가 확인/처리를 마친 뒤 인박스에서 제거한다 — 계속 쌓아두지
 * 않도록(용량·프라이버시) 명시적으로 정리하는 게 관례다.
 */
export async function clearSharedDocument(id, opts = {}) {
  if (!id) return false;
  const cacheStore = opts.cacheStore || (typeof caches !== 'undefined' ? caches : null);
  if (!cacheStore) return false;
  const cache = await cacheStore.open(SHARE_CACHE_NAME);
  return cache.delete(`/_share-inbox/${id}`);
}

/**
 * 사용자에게 보여줄 확인 문구 — "이 문서를 어떤 절차에 쓸지" 사람이
 * 직접 확인하게 만든다(PDV extract.js의 formatFieldsForConfirmation과
 * 동일 원칙 — AI가 임의로 문서 용도를 단정하지 않음).
 */
export function formatShareConfirmation(doc, candidateProcedures = []) {
  const name = doc.filename || doc.title || '공유받은 문서';
  if (!candidateProcedures.length) {
    return `"${name}"을(를) 받았습니다. 어떤 절차에 사용할 문서인지 알려주세요.`;
  }
  const list = candidateProcedures.map((p, i) => `${i + 1}) ${p}`).join(', ');
  return `"${name}"을(를) 받았습니다. 다음 중 어느 절차에 쓸 문서인가요? ${list}`;
}

// ── 정부24 앱 실행 도움 (2026-07-09 신설) ──────────────────────
// ★ 검색으로 실사 확인한 값(2026-07-09) — Android 패키지명
// kr.go.minwon.m(Google Play URL: play.google.com/store/apps/
// details?id=kr.go.minwon.m), iOS App Store ID 586454505.
// ★ 정직하게 밝혀둘 한계 — 정부24는 "가족관계증명서 발급 화면"처럼
// 특정 화면으로 바로 들어가는 공식 딥링크 스킴을 문서화해두지 않은
// 것으로 보인다(검색 결과 어디에도 없었음). 그래서 여기서는 앱 자체를
// 여는 것까지만 하고, 어떤 문서를 찾아야 하는지는 안내 문구로 유도한다
// — 특정 화면 진입을 보장한다고 과장하지 않는다.
const GOV24_ANDROID_PACKAGE = 'kr.go.minwon.m';
const GOV24_IOS_APP_STORE_ID = '586454505';

/**
 * @param {'android'|'ios'|'unknown'} platform
 * @param {string} docName - 사용자에게 안내할 문서명(예: "가족관계증명서")
 * @returns {{launchUrl: string, fallbackUrl: string, guidance: string}}
 */
export function buildGov24LaunchInfo(platform, docName) {
  const guidance = docName
    ? `정부24 앱에서 "${docName}"을(를) 검색해 발급받은 뒤, 발급 완료 화면에서 "공유하기"를 눌러 나비로 보내주세요.`
    : '정부24 앱에서 필요한 서류를 발급받은 뒤, 발급 완료 화면에서 "공유하기"를 눌러 나비로 보내주세요.';

  if (platform === 'android') {
    return {
      launchUrl: `intent://#Intent;package=${GOV24_ANDROID_PACKAGE};end`,
      fallbackUrl: `https://play.google.com/store/apps/details?id=${GOV24_ANDROID_PACKAGE}`,
      guidance,
    };
  }
  if (platform === 'ios') {
    return {
      launchUrl: `https://apps.apple.com/kr/app/id${GOV24_IOS_APP_STORE_ID}`,
      fallbackUrl: `https://apps.apple.com/kr/app/id${GOV24_IOS_APP_STORE_ID}`,
      guidance,
    };
  }
  // 플랫폼 불명 — 정부24 공식 안내 페이지로 안전하게 폴백
  return {
    launchUrl: 'https://www.gov.kr/',
    fallbackUrl: 'https://www.gov.kr/',
    guidance,
  };
}

// ── 국민연금공단 앱 실행 도움 (2026-07-09 신설, 은행/보험 사례 조사 중 추가) ──
// ★ 검색으로 실사 확인한 값 — Android 패키지명 kr.or.nps.smart(Google Play
// URL: play.google.com/store/apps/details?id=kr.or.nps.smart), 공식 앱명
// "내 곁에 국민연금". ★ iOS App Store ID는 검색으로 확인 못 했다 —
// 지어내지 않고 iOS는 모바일 웹(minwon.nps.or.kr)으로 안전하게 폴백한다.
const NPS_ANDROID_PACKAGE = 'kr.or.nps.smart';
const NPS_WEB_FALLBACK = 'https://minwon.nps.or.kr/';

export function buildNpsLaunchInfo(platform, docName) {
  const guidance = docName
    ? `국민연금공단 앱("내 곁에 국민연금")에서 "${docName}"을(를) 발급받은 뒤 "공유하기"로 나비로 보내주세요. 정부24 앱에서도 발급 가능합니다.`
    : '국민연금공단 앱("내 곁에 국민연금")에서 필요한 증명서를 발급받은 뒤 "공유하기"로 나비로 보내주세요.';

  if (platform === 'android') {
    return {
      launchUrl: `intent://#Intent;package=${NPS_ANDROID_PACKAGE};end`,
      fallbackUrl: `https://play.google.com/store/apps/details?id=${NPS_ANDROID_PACKAGE}`,
      guidance,
    };
  }
  // iOS/불명 — App Store ID를 실사로 확인 못 해 지어내지 않고 모바일
  // 웹으로 폴백한다(정부24와 달리 이쪽은 모바일 웹 이용이 가능해 보임 —
  // NPS 자체 안내 페이지 기준, 정부24만큼 강하게 앱 전용을 요구하지
  // 않는 것으로 보였다).
  return { launchUrl: NPS_WEB_FALLBACK, fallbackUrl: NPS_WEB_FALLBACK, guidance };
}

/**
 * 문서 출처(procedure-docs.js의 DOCUMENT_SOURCES.source 값)에 따라
 * 적절한 실행 정보를 돌려주는 디스패처. 'bank'/'insurance-assoc'처럼
 * 특정 앱을 안내할 수 없는 출처는 launchUrl 없이 안내문만 준다 —
 * procedure-docs.js의 buildDocumentGuidance가 이미 만든 안내문을 그대로
 * 전달한다(중복 문구 생성 안 함).
 * @param {string} source - 'gov24' | 'gov24-or-nps' | 'bank' | 'insurance-assoc' | 기타
 * @param {'android'|'ios'|'unknown'} platform
 * @param {string} docName
 * @param {string} [fallbackGuidance] - source가 앱 실행형이 아닐 때 쓸 안내문(보통 DOCUMENT_SOURCES의 guidance)
 */
export function buildAppLaunchInfo(source, platform, docName, fallbackGuidance) {
  if (source === 'gov24') return buildGov24LaunchInfo(platform, docName);
  if (source === 'gov24-or-nps') {
    // 정부24를 우선 제시 — 국민연금 전용 앱보다 이미 안내한 정부24 쪽이
    // 사용자 입장에서 한 앱으로 여러 서류를 처리할 수 있어 더 편함.
    return buildGov24LaunchInfo(platform, docName);
  }
  if (source === 'nps') return buildNpsLaunchInfo(platform, docName);
  // 'bank', 'insurance-assoc', 'unknown' 등 — 앱을 특정할 수 없는 출처.
  // 잘못된 링크(예: 민간 마케팅 앱)를 주는 것보다 안내문만 주는 게 안전.
  return { launchUrl: null, fallbackUrl: null, guidance: fallbackGuidance || '' };
}
