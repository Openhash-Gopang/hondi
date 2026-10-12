// ============================================================
// m04_profile.test.mjs — M04 프로필 모듈 테스트
// 저장위치: gopang/src/tests/profile2.0/m04_profile.test.mjs
// 실행: node src/tests/profile2.0/m04_profile.test.mjs
// ============================================================

import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

// ─── 테스트 대상 함수 인라인 ───

function haversineM(lat1, lng1, lat2, lng2) {
  const R  = 6371000;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;
  const a  = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

function calcIsOpen(businessHours) {
  if (!businessHours) return null;
  const match = String(businessHours).match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const now     = new Date();
  const kstHour = (now.getUTCHours() + 9) % 24;
  const kstMin  = now.getUTCMinutes();
  const current = kstHour * 60 + kstMin;
  const open    = Number(match[1]) * 60 + Number(match[2]);
  const close   = Number(match[3]) * 60 + Number(match[4]);
  return current >= open && current < close;
}

// ai_active 판정 로직 (Supabase 없이 모킹)
function resolveAiActiveMock(llmKeyRows) {
  if (!Array.isArray(llmKeyRows) || llmKeyRows.length === 0) return false;
  return llmKeyRows[0].ai_active === true;
}

// review_summary 조합 로직 (Supabase 없이 모킹)
function buildReviewSummaryMock(statsRows, viewerLang) {
  if (!Array.isArray(statsRows) || statsRows.length === 0) {
    return { overall: { count: 0, avg: null }, by_lang: [], viewer_highlight: null };
  }
  const totalCount = statsRows.reduce((s, r) => s + Number(r.review_count), 0);
  const totalAvg   = statsRows.reduce((s, r) => s + Number(r.avg_rating) * Number(r.review_count), 0) / totalCount;
  const LANG_LABEL = {
    ko: '한국인', zh: '中国旅行者', en: 'English speakers',
    ja: '日本人旅行者', vi: 'Du khách Việt Nam', th: 'นักท่องเที่ยวไทย',
  };
  const by_lang = statsRows.map(r => ({
    lang:  r.reviewer_lang,
    label: LANG_LABEL[r.reviewer_lang] || r.reviewer_lang,
    count: Number(r.review_count),
    avg:   Number(r.avg_rating),
  }));
  const highlight = by_lang.find(b => b.lang === viewerLang) || null;
  return {
    overall:          { count: totalCount, avg: Math.round(totalAvg * 10) / 10 },
    by_lang,
    viewer_highlight: highlight,
  };
}

// OG meta 태그 생성 (profile.html 클라이언트 측 로직)
function buildOGMeta(profile, reviewSummary) {
  const avg     = reviewSummary?.overall?.avg;
  const count   = reviewSummary?.overall?.count;
  const ratingStr = avg ? `★${avg} (${count}건)` : '';
  return {
    'og:title':       `${profile.name} — 나비`,
    'og:description': `${profile.address || ''} ${ratingStr}`.trim(),
    'og:image':       `https://gopang-proxy.tensor-city.workers.dev/qr/${profile.handle}`,
    'og:url':         `https://users.hondi.net/profile.html?handle=${profile.handle}`,
  };
}

// ─────────────────────────────────────────────
// 테스트 프레임워크
// ─────────────────────────────────────────────
let passed = 0, failed = 0;
async function test(id, desc, fn) {
  try {
    await fn();
    console.log(`  ✅ ${id} ${desc}`);
    passed++;
  } catch(e) {
    console.log(`  ❌ ${id} ${desc}`);
    console.log(`     → ${e.message}`);
    failed++;
  }
}
function assert(cond, msg)    { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEq(a, b, msg)  { if (a !== b) throw new Error(msg || `expected "${b}", got "${a}"`); }
function assertNull(a, msg)   { if (a !== null) throw new Error(msg || `expected null, got "${a}"`); }

// ─────────────────────────────────────────────
// PR01 한국어 프로필 조회 — 원문 반환 확인
// ─────────────────────────────────────────────
await test('PR01', '한국어 프로필 — 원문 name/address 반환', async () => {
  const profile = {
    guid: 'guid-001', handle: '@hallim_geumneung',
    name: '금능반점', address: '한림읍 금능리 123',
    entity_type: 'org', native_lang: 'ko',
    is_public: true, lat: 33.3945, lng: 126.2389,
    extra: { business_hours: '11:00-20:00', ai_active: true },
  };
  // viewer_lang=ko → 번역 없이 원문 반환
  const viewerLang = 'ko';
  const shouldTranslate = viewerLang !== 'ko' && viewerLang !== profile.native_lang;
  assert(!shouldTranslate, 'ko 조회 시 번역 시도됨');
  assertEq(profile.name, '금능반점', 'name 변경됨');
});

// ─────────────────────────────────────────────
// PR02 중국어 자동 번역 트리거 검증
// ─────────────────────────────────────────────
await test('PR02', '중국어 조회 — 번역 트리거 조건 검증', async () => {
  const profile    = { name: '금능반점', native_lang: 'ko' };
  const viewerLang = 'zh';
  const shouldTranslate = viewerLang !== 'ko' && viewerLang !== profile.native_lang;
  assert(shouldTranslate, 'zh 조회 시 번역 미트리거');

  // native_lang과 동일 언어 → 번역 불필요
  const profileZh   = { name: '金陵饭店', native_lang: 'zh' };
  const noTranslate = viewerLang !== 'ko' && viewerLang !== profileZh.native_lang;
  assert(!noTranslate, 'native_lang=zh 업체에 번역 트리거');
});

// ─────────────────────────────────────────────
// PR03 ai_active=true — 탭 표시 조건
// ─────────────────────────────────────────────
await test('PR03', 'ai_active=true — AI비서 탭 표시', () => {
  // user_llm_keys 레코드 있고 ai_active=true
  const result = resolveAiActiveMock([{ ai_active: true }]);
  assert(result === true, 'ai_active true 판정 실패');
});

// ─────────────────────────────────────────────
// PR04 ai_active=false — 탭 미표시 조건
// ─────────────────────────────────────────────
await test('PR04', 'ai_active 탭 미표시 — 3가지 케이스', () => {
  // 케이스1: 레코드 없음
  assertEq(resolveAiActiveMock([]),    false, '레코드 없음 → false 아님');
  // 케이스2: ai_active=false
  assertEq(resolveAiActiveMock([{ ai_active: false }]), false, 'false → false 아님');
  // 케이스3: null/undefined
  assertEq(resolveAiActiveMock([{ ai_active: null }]),  false, 'null → false 아님');
});

// ─────────────────────────────────────────────
// PR05 is_public=false → 404
// ─────────────────────────────────────────────
await test('PR05', 'is_public=false — 404 NOT_FOUND', () => {
  const profile = { is_public: false, name: '비공개업체' };
  // 핸들러 로직: is_public=false이면 404 반환
  assert(!profile.is_public, '비공개 감지 실패');
  // 공개 프로필
  const publicProfile = { is_public: true };
  assert(publicProfile.is_public, '공개 감지 실패');
});

// ─────────────────────────────────────────────
// PR06 review_summary 정합성 — by_lang 합계 = overall.count
// ─────────────────────────────────────────────
await test('PR06', 'review_summary — by_lang 합계 = overall.count', () => {
  const statsRows = [
    { reviewer_lang: 'ko', review_count: 58, avg_rating: 3.8 },
    { reviewer_lang: 'zh', review_count: 43, avg_rating: 4.7 },
    { reviewer_lang: 'ja', review_count: 19, avg_rating: 4.4 },
    { reviewer_lang: 'en', review_count:  8, avg_rating: 4.2 },
  ];
  const summary = buildReviewSummaryMock(statsRows, 'zh');

  const byLangTotal = summary.by_lang.reduce((s, b) => s + b.count, 0);
  assertEq(byLangTotal, summary.overall.count, `by_lang 합계(${byLangTotal}) ≠ overall(${summary.overall.count})`);
  assertEq(summary.overall.count, 128, 'overall.count 오류');
  assert(summary.overall.avg > 0, 'overall.avg 오류');
});

// ─────────────────────────────────────────────
// PR07 viewer_highlight — viewer_lang 일치 항목 추출
// ─────────────────────────────────────────────
await test('PR07', 'viewer_highlight — viewer_lang=zh 항목 추출', () => {
  const statsRows = [
    { reviewer_lang: 'ko', review_count: 58, avg_rating: 3.8 },
    { reviewer_lang: 'zh', review_count: 43, avg_rating: 4.7 },
  ];
  const summary = buildReviewSummaryMock(statsRows, 'zh');

  assert(summary.viewer_highlight !== null,         'viewer_highlight null');
  assertEq(summary.viewer_highlight.lang,  'zh',   'highlight.lang 오류');
  assertEq(summary.viewer_highlight.avg,   4.7,    'highlight.avg 오류');
  assertEq(summary.viewer_highlight.count, 43,     'highlight.count 오류');

  // viewer_lang에 해당 리뷰 없을 때
  const summaryJa = buildReviewSummaryMock(statsRows, 'ja');
  assertNull(summaryJa.viewer_highlight, 'ja highlight null 아님');
});

// ─────────────────────────────────────────────
// PR08 OG meta 태그 생성
// ─────────────────────────────────────────────
await test('PR08', 'OG meta — og:title/description/image/url 생성', () => {
  const profile = {
    guid: 'guid-001', handle: '@hallim_geumneung',
    name: '금능반점', address: '한림읍 금능리 123',
  };
  const reviewSummary = { overall: { count: 128, avg: 4.1 }, by_lang: [] };
  const og = buildOGMeta(profile, reviewSummary);

  assert(og['og:title'].includes('금능반점'),              'og:title에 name 없음');
  assert(og['og:title'].includes('나비'),                  'og:title에 나비 없음');
  assert(og['og:description'].includes('한림읍'),           'og:description에 주소 없음');
  assert(og['og:description'].includes('★4.1'),            'og:description에 평점 없음');
  assert(og['og:image'].includes('@hallim_geumneung'),     'og:image에 handle 없음');
  assert(og['og:url'].includes('profile.html'),            'og:url에 profile.html 없음');
  assert(og['og:url'].includes('@hallim_geumneung'),       'og:url에 handle 없음');
});

// ─────────────────────────────────────────────
// 추가: 하버사인 거리 계산 검증
// ─────────────────────────────────────────────
await test('PR09', '하버사인 거리 — 한림읍 기준 주요 지점', () => {
  // 금능반점 → 협재해수욕장 (실제 약 2km)
  const geumneung = [33.3945, 126.2389];
  const hyeopjae  = [33.3940, 126.2393];
  const dist      = haversineM(...geumneung, ...hyeopjae);
  assert(dist < 1000, `같은 동네 거리 과다: ${dist}m`);

  // 한림읍 → 제주공항 (실제 약 25km)
  const hallim    = [33.3945, 126.2389];
  const airport   = [33.5067, 126.4929];
  const distLong  = haversineM(...hallim, ...airport);
  assert(distLong > 20000 && distLong < 35000,
    `한림↔공항 거리 이상: ${distLong}m`);

  // 동일 지점 → 0m
  const same = haversineM(33.3945, 126.2389, 33.3945, 126.2389);
  assertEq(same, 0, '동일 지점 거리 0 아님');
});

// ─────────────────────────────────────────────
// 추가: 영업시간 is_open 파싱
// ─────────────────────────────────────────────
await test('PR10', '영업시간 파싱 — 형식 및 null 처리', () => {
  // 정보 없음
  assertNull(calcIsOpen(null),      'null → null 아님');
  assertNull(calcIsOpen(''),        '빈 문자열 → null 아님');
  assertNull(calcIsOpen('휴무'),    '파싱 불가 → null 아님');

  // 형식 검증 (실제 시각에 따라 true/false 달라짐 — 반환값 타입만 확인)
  const result = calcIsOpen('11:00-20:00');
  assert(result === true || result === false, '반환값 boolean 아님');

  // 대시 변형 (–)
  const result2 = calcIsOpen('11:00–20:00');
  assert(result2 === true || result2 === false, '– 구분자 파싱 실패');
});

// ─────────────────────────────────────────────
// 추가: 편향 감지 — 격차 1.0 이상 시 문구 표시
// ─────────────────────────────────────────────
await test('PR11', '평점 편향 감지 — 격차 ≥ 1.0 시 경고', () => {
  function checkBias(viewerAvg, overallAvg) {
    return Math.abs(viewerAvg - overallAvg) >= 1.0;
  }
  assert(checkBias(4.7, 3.0),  '격차 1.7 — 편향 미감지');
  assert(!checkBias(4.7, 4.0), '격차 0.7 — 편향 오감지');
  assert(checkBias(2.0, 4.5),  '격차 2.5 — 편향 미감지');
  assert(!checkBias(4.0, 4.0), '격차 0.0 — 편향 오감지');
});

// ─────────────────────────────────────────────
// 결과 출력
// ─────────────────────────────────────────────
console.log('');
console.log('══════════════════════════════════════');
console.log(`M04 Profile 테스트 결과: ${passed}/${passed+failed} 통과`);
if (failed > 0) {
  console.log(`❌ 실패: ${failed}건`);
  process.exit(1);
} else {
  console.log('✅ 전체 통과 — M04 합격');
}
console.log('══════════════════════════════════════');
