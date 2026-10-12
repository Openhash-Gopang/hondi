/**
 * gov-fee-lookup.js — gov-router.js 매칭 결과 → gov_fee_schedule 요금 조회 "배선"
 *
 * 2026-08-15 신설. gov-router.js(_assembleGovSystemPromptRaw)가 이번 발화를
 * 어느 기관/부서로 매칭했는지는 이미 trace 배열로 알 수 있다(resolveProvinceCode,
 * resolveAgencyDisplayName, resolveHandlerCodeFromTrace 등 기존 export 재사용).
 * 이 파일은 그 결과를 받아 PocketBase의 gov_fee_schedule 컬렉션에서 요금을
 * 찾고, GDC 청구액(나비 서비스 수수료)을 계산해 반환하는 "능력"만 추가한다.
 *
 * ★ gov-router.js의 라우팅 로직 자체는 건드리지 않는다 — resolveAgencyDisplayName
 * 등 기존 함수들의 주석에 이미 명시된 이 파일의 설계 원칙을 그대로 따른다.
 *
 * ★ 지역 데이터 아키텍처(2026-08-15 재정리) — region_code 체계는 세 종류다:
 *   1) 실제 시코드(예: 'chungnam_cheonan') — 그 지역 고유 편람에서 나온 REAL 데이터.
 *      gov-router.js의 SP-CITY-{시코드} trace와 그대로 대응(CHUNGNAM_GU 테이블,
 *      _makeMetroCityTable 참조).
 *   2) 'baseline' — 지역 중립 기준점. 현재는 천안시 데이터를 그대로 복제해 채워뒀지만
 *      (전국에서 가장 먼저 확보한 편람이라는 이유일 뿐, "천안시가 기준"이라는 의미는
 *      아니다), region_code로는 'baseline'이라는 별도 태그를 쓴다 — 특정 지역명이
 *      아니라 "아직 그 지역 고유 데이터가 없을 때 쓰는 잠정치"라는 걸 코드에서도
 *      명확히 구분하기 위함.
 *   3) null(scope='national') — 인지세·법원 인지대처럼 지역 자체가 무의미한 전국공통.
 * 새 지역을 온보딩하려면: 관리자가 그 지역 민원사무편람을 구해
 * `node seed_gov_fee_schedule.mjs --file <그지역.xlsx> --region <실제시코드>`로 시드한다
 * (tools/gov-fee-seed/README.md 참조) — 그러면 그 지역은 자기 데이터가 있는 항목은
 * REAL을, 없는 항목은 자동으로 'baseline' 폴백(승인 필요)을 쓰게 된다.
 *
 * (과거 이슈 — 이미 해결됨: 초기 시드가 region_code='cheonan'을 썼다가 gov-router.js의
 * 실제 시코드 'chungnam_cheonan'과 어긋났던 문제. seed 스크립트 기본값을 고치고
 * 재시드해 해결했다.)
 *
 * 의존성: pocketbase(JS SDK), 같은 폴더의 gov_fee_calc.mjs 로직을 그대로
 * 재사용하기 위해 tools/gov-fee-seed/scripts/gov_fee_calc.mjs를 임포트한다.
 * (도구 스크립트를 프로덕션 경로가 import하는 형태가 어색하면, 이 계산
 * 함수들을 src/gopang/gov/gov-fee-calc.mjs로 옮기고 양쪽에서 재사용하는
 * 정리를 후속 PR로 진행할 것 — 지금은 로직 중복을 피하는 게 더 중요해서
 * 우선 그대로 import한다.)
 *
 * ★ 2026-08-15 갱신 — worker.js의 /gov-fee-semantic-search(bge-m3+Vectorize,
 * hondi-entity-registry와 같은 패턴, 전용 인덱스 hondi-gov-fee-schedule)를
 * 1순위 매칭기로 연결했다. resolveGovFee()에 { workerBaseUrl }을 넘기면
 * 이 의미검색을 먼저 쓰고, 넘기지 않거나 실패/무응답이면 기존 키워드
 * 매칭기(matchServiceName)로 그레이스풀 디그레이드한다 — 기존 호출부
 * (workerBaseUrl 없이 호출하는 코드)는 전혀 안 바뀌어도 계속 동작한다.
 */

import { resolveProvinceCode, resolveAgencyDisplayName } from './gov-router.js';
import { calcGovReference, calcHondiServiceFee } from '../../../tools/gov-fee-seed/scripts/gov_fee_calc.mjs';

// ── 시코드 정규화 ──────────────────────────────────────────────────
// trace에서 SP-CITY-{시코드} 형태를 뽑아 소문자로 되돌린다.
// (gov-router.js가 만드는 형식과 정확히 반대 연산 — SP-CITY-${시코드.toUpperCase()})
export function extractCityCodeFromTrace(trace) {
  const t = Array.isArray(trace) ? trace : [];
  for (const entry of t) {
    const m = /^SP-CITY-(.+)$/.exec(entry);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

// 초기 시드 데이터의 region_code 표기 불일치를 흡수하기 위한 후보 목록.
// (근본 수정 전까지 임시 — 위 파일 상단 "알려진 이슈" 참조)
function _regionCodeCandidates(cityCode) {
  if (!cityCode) return [];
  const candidates = new Set([cityCode]);
  const short = cityCode.includes('_') ? cityCode.split('_').slice(1).join('_') : null;
  if (short) candidates.add(short);
  return [...candidates];
}

// ── 서비스명 매칭 (키워드 스코어링 — 시맨틱 검색 실패 시 폴백용) ──────
// 2026-08-15 — 원래 v1 유일 매칭기였다가, 이제 semanticMatchServiceName()의
// 그레이스풀 디그레이드 대상으로 격하됐다(바인딩 없음/네트워크 실패/후보
// 없음일 때만 호출됨). 여전히 필요하다: 시맨틱 검색은 Worker·Vectorize
// 인프라가 살아있어야 하므로, 로컬 테스트·오프라인 환경·인프라 장애
// 상황의 안전망으로 이 경로를 지우지 않는다.
function _tokenize(text) {
  return String(text || '')
    .replace(/[()·・,./]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function matchServiceName(userText, records) {
  const queryTokens = new Set(_tokenize(userText));
  if (queryTokens.size === 0) return null;

  let best = null;
  let bestScore = 0;
  for (const record of records) {
    const nameTokens = _tokenize(record.service_name);
    let overlap = 0;
    for (const t of nameTokens) {
      if (queryTokens.has(t)) overlap++;
      else {
        // 부분 문자열 겹침도 약하게 인정 (형태소 분석기가 없는 v1 한계 보완)
        for (const q of queryTokens) {
          if (q.length >= 2 && (t.includes(q) || q.includes(t))) {
            overlap += 0.5;
            break;
          }
        }
      }
    }
    const score = overlap / Math.max(nameTokens.length, 1);
    if (score > bestScore) {
      bestScore = score;
      best = record;
    }
  }
  // 너무 약한 매칭은 버린다 — 잘못된 서비스에 잘못된 요금을 매칭하는 것보다
  // "못 찾음"이 훨씬 안전하다 (과금 오류는 신뢰 손상이 크다).
  return bestScore >= 0.34 ? best : null;
}

// ── 시맨틱 검색 (1순위 매칭기) ──────────────────────────────────────
// worker.js GET /gov-fee-semantic-search를 호출한다. 실패하는 모든 경우
// (fetch 자체 실패, non-2xx, 빈 후보, workerBaseUrl 미제공)에 예외를
// 던지지 않고 null을 반환한다 — 호출부(resolveGovFee)가 조용히 키워드
// 매칭기로 넘어가도록 하기 위함(그레이스풀 디그레이드).
//
// score 임계값 — 2026-08-15 l1-hanlim 서버에서 실제 bge-m3 파일럿으로 실측:
//   "건축신고 하려고요"                        → 건축신고             0.639 (정답)
//   "등본 떼줘"                                → 주민등록표등·초본교부 신청 0.603 (정답)
//   "부동산 계약서 세금"                       → 부동산등기용 등록증명서 발급신청 0.563 (근접)
//   "식당 영업 시작하려면 뭐부터 해야돼"        → 식품영업등록 신청 등    0.465 (근접, 쿼리가 모호할수록 낮아짐)
// 애초 잠정치 0.75는 이 도메인(정형화된 행정 용어, 동음이의 위험 큼)에서
// bge-m3 코사인 유사도가 실제로 도달하는 범위보다 훨씬 높게 잡혀 있어서,
// 정답까지 전부 걸러지고 있었다(=시맨틱 검색이 사실상 항상 키워드 폴백행).
// 실측 분포 기준 0.55로 낮춘다 — "부동산 계약서 세금"(0.563)까지는 통과,
// 더 모호한 자연어 질의(0.46대)는 여전히 걸러 안전 마진을 유지한다.
// 색인이 더 쌓이거나 쿼리 패턴이 다양해지면 재보정 필요.
const SEMANTIC_SCORE_THRESHOLD = 0.55;

// ── 1위·2위 점수차 안전장치 (2026-08-15, 44건 광역 파일럿으로 발견) ──────
// 파일럿 결과: Top-1 정확도 76.5%(26/34), 그런데 오탐(정답 아닌데 통과)은
// 전부 "1위가 절대점수 임계값은 넘었지만 2위와 근소한 차이"인 경우였다
// (예: "건설기계 등록증 재발급" 질의에서 오답 0.740 vs 정답 0.723 — 차이
// 0.017에 불과한데 오답이 그대로 채택됨). 절대 임계값만으로는 이런 "확신에
// 찬 오답"을 못 거른다.
//
// ★ 정직한 트레이드오프 ★ 이 도메인(정형화된 민원명, "OO변경신고"·"OO재발급"
// 류 유사 명칭이 많음)은 정답일 때도 1·2위 점수차가 자연스럽게 작은 경우가
// 흔하다(파일럿 데이터: 정답 26건 중 6건이 갭 0.03 미만). 즉 이 안전장치는
// 오답 8건 중 6건은 잡아내지만, 정답 26건 중 6건에도 불필요하게 승인을
// 요구하게 된다 — "느리더라도 확실한 것"과 "빠르지만 가끔 틀리는 것" 사이의
// 실측 기반 절충이다. 순수 계산(이미 받아온 top-3 후보 비교)이라 API 왕복이
// 추가되지 않아 응답 속도에는 영향이 없다.
const AMBIGUOUS_SCORE_GAP = 0.03;

export async function semanticMatchServiceName(workerBaseUrl, userText, { scope, regionCode } = {}) {
  if (!workerBaseUrl) return null;
  try {
    const url = new URL('/gov-fee-semantic-search', workerBaseUrl);
    url.searchParams.set('query', userText);
    if (scope) url.searchParams.set('scope', scope);
    if (regionCode) url.searchParams.set('region_code', regionCode);
    url.searchParams.set('limit', '3');

    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const candidates = data?.candidates;
    if (!Array.isArray(candidates) || candidates.length === 0) return null;

    const top = candidates[0];
    if (typeof top.score !== 'number' || top.score < SEMANTIC_SCORE_THRESHOLD) return null;

    const second = candidates[1];
    const gap = typeof second?.score === 'number' ? top.score - second.score : Infinity;
    const isAmbiguous = gap < AMBIGUOUS_SCORE_GAP;

    // 원본 레코드 필드는 그대로 유지하고, 내부용 플래그만 얹는다(호출부
    // resolveGovFee에서만 사용 — 이 값이 사용자에게 노출되는 API 응답
    // 필드에 섞이지 않도록 upsert 등 다른 경로에선 절대 참조하지 않는다).
    return { ...top, _semanticAmbiguous: isAmbiguous };
  } catch (e) {
    // 네트워크 오류·타임아웃 등 — 조용히 폴백 신호(null)만 반환한다.
    return null;
  }
}

// ── PocketBase 조회 ─────────────────────────────────────────────────
async function _fetchCandidates(pb, { regionCodes, includeNational = true }) {
  const filters = [];
  if (regionCodes.length) {
    filters.push(regionCodes.map((c) => `region_code = "${c}"`).join(' || '));
  }
  if (includeNational) {
    filters.push('scope = "national"');
  }
  if (!filters.length) return [];
  const filter = filters.map((f) => `(${f})`).join(' || ');
  return pb.collection('gov_fee_schedule').getFullList({ filter, batch: 500 });
}

/**
 * 메인 진입점. gov-router.js가 이미 계산해둔 trace를 넘겨받아 요금을 찾는다.
 *
 * @param {object} pb - PocketBase 클라이언트 인스턴스 (인증 완료된 상태)
 * @param {string} userText - 사용자 발화 원문 (서비스명 매칭용)
 * @param {string[]} trace - assembleGovSystemPrompt()가 반환한 trace 배열
 * @param {object} [calcInputs] - formula_type 레코드 계산에 필요한 입력값
 *   (예: { amount, isEfile, parties, count } — 인지세/인지대/송달료용)
 * @param {object} [options] - { workerBaseUrl } 제공 시 시맨틱 검색을 1순위로
 *   시도한다(worker.js GET /gov-fee-semantic-search). 생략하면 기존과 동일하게
 *   키워드 매칭만 쓴다 — 기존 호출부는 코드 변경 없이 계속 동작한다.
 * @returns {Promise<{
 *   status: 'OK'|'NEEDS_APPROVAL'|'NOT_FOUND',
 *   record: object|null,
 *   govReferenceFee: number|null,
 *   hondiServiceFee: number|null,
 *   isBaselineFallback: boolean,
 *   matchedBy: 'semantic'|'keyword'|null,
 *   message: string,
 * }>}
 */
export async function resolveGovFee(pb, userText, trace, calcInputs = {}, options = {}) {
  const { workerBaseUrl } = options;
  const cityCode = extractCityCodeFromTrace(trace);
  const regionCandidates = _regionCodeCandidates(cityCode);
  const primaryRegionCode = regionCandidates[0] || null;

  let isBaselineFallback = false;
  let matchedBy = null;
  let isAmbiguousMatch = false;

  // 1) 사용자 관할 지역 — 시맨틱 검색 우선, 실패 시 키워드 매칭.
  // Vectorize filter는 AND 방식이라 region_code와 scope=national을 한 번에
  // "OR"로 못 묶는다 — 두 번 호출해 점수가 더 높은 쪽을 쓴다.
  const [regionalHit, nationalHit] = await Promise.all([
    semanticMatchServiceName(workerBaseUrl, userText, { regionCode: primaryRegionCode }),
    semanticMatchServiceName(workerBaseUrl, userText, { scope: 'national' }),
  ]);
  let match = null;
  if (regionalHit && nationalHit) match = regionalHit.score >= nationalHit.score ? regionalHit : nationalHit;
  else match = regionalHit || nationalHit;

  if (match) {
    matchedBy = 'semantic';
    isAmbiguousMatch = !!match._semanticAmbiguous;
  } else {
    const candidates = await _fetchCandidates(pb, { regionCodes: regionCandidates, includeNational: true });
    match = matchServiceName(userText, candidates.filter((r) => r.status === 'REAL'));
    if (match) matchedBy = 'keyword';
  }

  // 2) 지역 매칭이 없으면 BASELINE(지역 중립 기준점)으로 폴백 — 반드시 승인 필요로 표시.
  // BASELINE은 천안시 민원사무편람에서 인출한 값이지만, region_code='baseline'으로
  // 별도 태그돼 있어 "천안시"라는 특정 지역이 아니라 "전국 잠정 기준값"으로 취급된다.
  // 각 지역은 관리자가 그 지역 고유 편람을 구해 --region <해당코드>로 시드하면 이
  // BASELINE보다 우선하는 REAL 데이터를 갖게 된다(README 참조) — 이 폴백은 아직
  // 그 지역 고유 데이터가 없을 때만 작동하는 안전망이다.
  if (!match) {
    match = await semanticMatchServiceName(workerBaseUrl, userText, { regionCode: 'baseline' });
    if (match) {
      matchedBy = 'semantic';
      isAmbiguousMatch = !!match._semanticAmbiguous;
    } else {
      const baseline = await _fetchCandidates(pb, {
        regionCodes: ['baseline'],
        includeNational: false,
      });
      match = matchServiceName(userText, baseline.filter((r) => r.status === 'REAL'));
      if (match) matchedBy = 'keyword';
    }
    if (match) isBaselineFallback = true;
  }

  // 내부용 플래그(_semanticAmbiguous)는 판단에만 쓰고, 반환하는 record에는
  // 남기지 않는다 — API 응답 필드를 깨끗하게 유지하기 위함.
  if (match && '_semanticAmbiguous' in match) {
    const { _semanticAmbiguous, ...rest } = match;
    match = rest;
  }

  if (!match) {
    return {
      status: 'NOT_FOUND',
      record: null,
      govReferenceFee: null,
      hondiServiceFee: null,
      isBaselineFallback: false,
      isAmbiguousMatch: false,
      matchedBy: null,
      message: '해당 서비스의 요금 정보를 찾지 못했습니다. 담당자 확인이 필요합니다.',
    };
  }

  if (match.status === 'NEEDS_REVIEW' || match.status === 'MISSING') {
    return {
      status: 'NEEDS_APPROVAL',
      record: match,
      govReferenceFee: null,
      hondiServiceFee: null,
      isBaselineFallback,
      isAmbiguousMatch,
      matchedBy,
      message: '이 서비스는 요금이 조례·별표 참조로만 되어 있어 자동 계산할 수 없습니다. 담당자 확인 후 진행해 주세요.',
    };
  }

  const govReferenceFee = calcGovReference(match, calcInputs);
  const hondiServiceFee = calcHondiServiceFee(match, calcInputs);

  if (isBaselineFallback) {
    return {
      status: 'NEEDS_APPROVAL',
      record: match,
      govReferenceFee,
      hondiServiceFee,
      isBaselineFallback: true,
      isAmbiguousMatch,
      matchedBy,
      message: `이 지역의 정확한 금액은 확인되지 않아 ${match.source} 기준 추정치(${hondiServiceFee ?? '확인 필요'}원)를 사용합니다. 진행 전 사용자 승인이 필요합니다.`,
    };
  }

  // 2026-08-15 신설 — 1위·2위 시맨틱 점수차가 근소해 확신할 수 없는 경우.
  // 레코드 자체는 REAL이고 지역도 정확히 맞았지만, "정말 이 서비스가 맞는지"
  // 자체가 불확실하므로 OK로 바로 확정하지 않고 승인을 한 번 더 받는다.
  if (isAmbiguousMatch) {
    return {
      status: 'NEEDS_APPROVAL',
      record: match,
      govReferenceFee,
      hondiServiceFee,
      isBaselineFallback: false,
      isAmbiguousMatch: true,
      matchedBy,
      message: `"${match.service_name}"으로 추정되지만 비슷한 이름의 다른 서비스와 점수 차이가 근소합니다(나비 서비스 수수료 ${hondiServiceFee}원). 맞는지 확인 부탁드립니다.`,
    };
  }

  return {
    status: 'OK',
    record: match,
    govReferenceFee,
    hondiServiceFee,
    isBaselineFallback: false,
    isAmbiguousMatch: false,
    matchedBy,
    message: `${match.service_name} — 나비 서비스 수수료 ${hondiServiceFee}원 (참고: 정부 납부 기준액 ${govReferenceFee}원, 실제 정부 납부는 사용자 직접 처리)`,
  };
}
