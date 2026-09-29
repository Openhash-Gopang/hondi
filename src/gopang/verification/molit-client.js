/**
 * verification/molit-client.js — 국토교통부 실거래가 오픈API 클라이언트
 *
 * ★ 2026-09-29 신설. 목적: SP-24a(K-Estate 3단계 가치평가)가 산출한
 * 추정가(fair_value)를 같은 지역·시기의 실제 거래가와 대조하는
 * "오프라인 표본 밖 점검"을 위한 데이터 수집 계층
 * (docs/kestate/verification-protocol.md §"실거래가 즉시 대조 점검" 참조).
 *
 * ★ 이 모듈은 SP-24a 실시간 대화 흐름에 배선되지 않는다. SP-24a
 * 프롬프트(STEP: NATIONAL, R2)는 여전히 웹검색/웹열람 방식을 기본으로
 * 한다 — 실시간 도구 호출 체계(call-ai.js의 SWITCH_SP_LOADERS 등)에
 * 이 API를 배선하려면 별도의, 더 큰 설계가 필요하기 때문이다(가치평가
 * 대화 중 LLM이 임의 REST API를 직접 호출하는 경로 자체가 아직 없음).
 * 이 모듈은 분석자가 배치로 돌리는 검증 스크립트(scripts/kestate/
 * molit-check.mjs) 전용이다.
 *
 * ★ 서비스키는 절대 코드에 하드코딩하지 않는다 — 호출부에서
 * process.env.MOLIT_SERVICE_KEY 등으로 주입한다. 공공데이터포털
 * 개발계정 인증키는 공개 저장소에 노출되면 안 되는 비밀값이다.
 *
 * ★ ENDPOINTS 중 'apt_trade'(아파트 매매)만 2026-09-29 실제 활용신청
 * 상세페이지("서비스 정보" 탭, End Point 필드)에서 확인된 값이다.
 * 나머지 6개(오피스텔 매매/전월세, 상업업무용, 토지, 공장및창고,
 * 아파트 전월세)는 RTMSDataSvc 명명 규칙상 유사할 것으로 추정되지만
 * 이 세션에서 확인하지 못했으므로 url/operation을 null로 남겨둔다.
 * 확인되지 않은 값을 사실처럼 코드에 넣지 않는다는 이 프로젝트의 원칙
 * (hondi-staged-valuation.js의 "출처 없는 σ 상수를 넣지 않는다"와 동일한
 * 원칙을 엔드포인트 문자열에도 적용)을 따른 것이다. 각 데이터셋의 실제
 * End Point는 공공데이터포털 "마이페이지 > 데이터 활용 > Open API >
 * 활용신청 현황 > 해당 데이터셋 클릭 > 서비스 정보"에서 확인해
 * ENDPOINTS의 해당 항목에 채워 넣으면 된다.
 */

export const ENDPOINTS = {
  apt_trade: {
    url: 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade',
    operation: 'getRTMSDataSvcAptTrade',
    label: '아파트 매매',
    verified: '2026-09-29',
  },
  offi_trade: { url: null, operation: null, label: '오피스텔 매매', verified: null },
  nrg_trade: { url: null, operation: null, label: '상업업무용 부동산 매매', verified: null },
  land_trade: { url: null, operation: null, label: '토지 매매', verified: null },
  ind_trade: { url: null, operation: null, label: '공장 및 창고 등 부동산 매매', verified: null },
  apt_rent: { url: null, operation: null, label: '아파트 전월세', verified: null },
  offi_rent: { url: null, operation: null, label: '오피스텔 전월세', verified: null },
};

export class MolitEndpointNotConfiguredError extends Error {
  constructor(datasetKey) {
    super(
      `[MOLIT] '${datasetKey}' 데이터셋의 End Point가 아직 확인되지 않았습니다. ` +
        `공공데이터포털 마이페이지 > 활용신청 현황에서 실제 End Point를 확인해 ` +
        `molit-client.js의 ENDPOINTS.${datasetKey}에 채워 넣으세요(추정값을 넣지 않습니다).`
    );
    this.name = 'MolitEndpointNotConfiguredError';
  }
}

// 공공데이터포털 공통 오류 규격의 성공 코드('00')와, RTMS 서비스 자체가
// 실제로 쓰는 성공 코드('000', 2026-09-29 실 호출로 확인)를 모두 인정한다.
const SUCCESS_RESULT_CODES = new Set(['00', '000']);

export class MolitApiError extends Error {
  constructor(resultCode, resultMsg) {
    super(`[MOLIT] API 오류 (resultCode=${resultCode}): ${resultMsg}`);
    this.name = 'MolitApiError';
    this.resultCode = resultCode;
  }
}

/**
 * 중첩 없는 <item><태그>값</태그>...</item> 반복 구조 전용의 최소 XML 파서.
 * MOLIT RTMS API 응답이 이 평면 구조이므로 별도 xml 라이브러리를
 * 추가하지 않는다. 중첩 구조가 있는 응답에는 쓸 수 없다.
 */
export function parseFlatItems(xmlText) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xmlText))) {
    const body = m[1];
    // 태그명에 한글이 포함되므로 \w(ASCII 전용)가 아닌 '<, >, /, 공백'을
    // 제외한 문자 클래스로 매칭한다.
    const fieldRe = /<([^\s<>/]+)>([\s\S]*?)<\/\1>/g;
    const rec = {};
    let f;
    while ((f = fieldRe.exec(body))) {
      rec[f[1]] = f[2]
        .trim()
        .replace(/<!\[CDATA\[|\]\]>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
    }
    items.push(rec);
  }
  return items;
}

export function extractHeader(xmlText) {
  const code = /<resultCode>([\s\S]*?)<\/resultCode>/.exec(xmlText)?.[1]?.trim() ?? null;
  const msg = /<resultMsg>([\s\S]*?)<\/resultMsg>/.exec(xmlText)?.[1]?.trim() ?? null;
  const totalCountRaw = /<totalCount>([\s\S]*?)<\/totalCount>/.exec(xmlText)?.[1]?.trim();
  return {
    resultCode: code,
    resultMsg: msg,
    totalCount: totalCountRaw != null && totalCountRaw !== '' ? Number(totalCountRaw) : null,
  };
}

/**
 * fetchTrades — 실거래가 조회.
 * @param {string} datasetKey - ENDPOINTS의 키(예: 'apt_trade')
 * @param {object} params
 * @param {string} params.lawdCd - 법정동코드 5자리(예: '11680')
 * @param {string} params.dealYmd - 계약년월 6자리(예: '202609')
 * @param {string} params.serviceKey - 공공데이터포털 인증키(디코딩된 값)
 * @param {number} [params.numOfRows=100]
 * @param {number} [params.pageNo=1]
 * @param {typeof fetch} [params.fetchImpl] - 테스트용 fetch 대체 구현
 */
export async function fetchTrades(datasetKey, params) {
  const ep = ENDPOINTS[datasetKey];
  if (!ep) throw new Error(`[MOLIT] 알 수 없는 데이터셋 키: ${datasetKey}`);
  if (!ep.url || !ep.operation) throw new MolitEndpointNotConfiguredError(datasetKey);

  const { lawdCd, dealYmd, serviceKey, numOfRows = 100, pageNo = 1, fetchImpl = fetch } = params || {};
  if (!lawdCd) throw new Error('[MOLIT] lawdCd(법정동코드 5자리)가 필요합니다.');
  if (!dealYmd) throw new Error('[MOLIT] dealYmd(계약년월 6자리)가 필요합니다.');
  if (!serviceKey) throw new Error('[MOLIT] serviceKey가 필요합니다(환경변수 MOLIT_SERVICE_KEY 등으로 주입).');

  const qs = new URLSearchParams({
    serviceKey,
    LAWD_CD: lawdCd,
    DEAL_YMD: dealYmd,
    numOfRows: String(numOfRows),
    pageNo: String(pageNo),
  });
  const url = `${ep.url}/${ep.operation}?${qs.toString()}`;

  const res = await fetchImpl(url, { signal: AbortSignal.timeout(10000) });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`[MOLIT] HTTP ${res.status} — ${text.slice(0, 300)}`);
  }
  const header = extractHeader(text);
  // ★ 2026-09-29 실제 API 호출로 확인 — 공공데이터포털 공통 오류 규격은
  // 성공 코드가 '00'이지만, 이 RTMS 서비스 자체는 성공 시 '000'/'OK'를
  // 반환한다(실 호출 결과 resultCode=000, resultMsg=OK로 확인됨). 두
  // 규격이 섞여 있어 '00'만 성공으로 보면 정상 응답을 오류로 오판한다.
  // resultCode가 존재하고 SUCCESS_RESULT_CODES에 없으면만 오류로 처리
  // (스키마상 header 자체가 없는 정상 응답도 있어 "없으면 정상"으로 취급).
  if (header.resultCode && !SUCCESS_RESULT_CODES.has(header.resultCode)) {
    throw new MolitApiError(header.resultCode, header.resultMsg);
  }
  const items = parseFlatItems(text);
  return { label: ep.label, datasetKey, lawdCd, dealYmd, totalCount: header.totalCount, items };
}
