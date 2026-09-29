import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENDPOINTS,
  parseFlatItems,
  extractHeader,
  fetchTrades,
  MolitEndpointNotConfiguredError,
  MolitApiError,
} from '../../src/gopang/verification/molit-client.js';
import { parseDealAmount, compareToComps } from '../../src/gopang/verification/molit-compare.js';

// ★ 2026-09-29 — 아래 픽스처의 필드명(dealAmount, aptNm, umdNm, excluUseAr,
// sggCd, floor, dealYear/dealMonth/dealDay 등)은 실제 apt_trade API 호출
// 결과(제주시 50110, 202608)로 확인된 진짜 스키마다. "국토부 API는 한글
// 필드명을 쓴다"는 통념과 달리 이 엔드포인트는 영문 camelCase를 쓴다 —
// 최초 구현 때는 이를 확인하지 못해 '거래금액' 등 한글 필드명으로
// 잘못 가정했었다(molit-compare.js 파일 머리 주석 참조).
const FIXTURE_OK = `<?xml version="1.0" encoding="UTF-8"?>
<response>
  <header>
    <resultCode>00</resultCode>
    <resultMsg>NORMAL SERVICE.</resultMsg>
  </header>
  <body>
    <items>
      <item>
        <dealAmount>   85,000</dealAmount>
        <buildYear>2005</buildYear>
        <dealYear>2026</dealYear>
        <umdNm> 역삼동</umdNm>
        <aptNm>역삼래미안</aptNm>
        <dealMonth>8</dealMonth>
        <dealDay>15</dealDay>
        <excluUseAr>84.97</excluUseAr>
        <jibun>123</jibun>
        <sggCd>11680</sggCd>
        <floor>10</floor>
      </item>
      <item>
        <dealAmount>   82,500</dealAmount>
        <buildYear>2005</buildYear>
        <dealYear>2026</dealYear>
        <umdNm> 역삼동</umdNm>
        <aptNm>역삼래미안</aptNm>
        <dealMonth>8</dealMonth>
        <dealDay>22</dealDay>
        <excluUseAr>84.97</excluUseAr>
        <jibun>123</jibun>
        <sggCd>11680</sggCd>
        <floor>3</floor>
      </item>
    </items>
    <numOfRows>10</numOfRows>
    <pageNo>1</pageNo>
    <totalCount>2</totalCount>
  </body>
</response>`;

const FIXTURE_ERROR = `<?xml version="1.0" encoding="UTF-8"?>
<response>
  <header>
    <resultCode>30</resultCode>
    <resultMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</resultMsg>
  </header>
</response>`;

// ★ 2026-09-29 — 실제 API 호출로 확인된 실제 성공 응답 형태(resultCode=000,
// resultMsg=OK, 영문 필드명). RTMS 서비스는 공공데이터포털 공통 규격
// ('00')이 아니라 이 규격을 쓴다. 이 픽스처가 회귀 테스트다 — 이전
// 버전은 이 응답을 MolitApiError로 오판했다.
const FIXTURE_OK_000 = `<?xml version="1.0" encoding="UTF-8"?>
<response>
  <header>
    <resultCode>000</resultCode>
    <resultMsg>OK</resultMsg>
  </header>
  <body>
    <items>
      <item>
        <dealAmount>   40,300</dealAmount>
        <dealYear>2026</dealYear>
        <umdNm>오라이동</umdNm>
        <aptNm>오라동벽강하이본타워4차</aptNm>
        <dealMonth>8</dealMonth>
        <dealDay>18</dealDay>
        <excluUseAr>84.729</excluUseAr>
        <sggCd>50110</sggCd>
        <floor>3</floor>
      </item>
    </items>
    <numOfRows>10</numOfRows>
    <pageNo>1</pageNo>
    <totalCount>1</totalCount>
  </body>
</response>`;

const FIXTURE_EMPTY = `<?xml version="1.0" encoding="UTF-8"?>
<response>
  <header>
    <resultCode>00</resultCode>
    <resultMsg>NORMAL SERVICE.</resultMsg>
  </header>
  <body>
    <items></items>
    <numOfRows>10</numOfRows>
    <pageNo>1</pageNo>
    <totalCount>0</totalCount>
  </body>
</response>`;

// ───────────────────────────── parseFlatItems / extractHeader ─────────────────────────────

test('parseFlatItems — item 여러 건을 평면 필드로 추출', () => {
  const items = parseFlatItems(FIXTURE_OK);
  assert.equal(items.length, 2);
  assert.equal(items[0]['dealAmount'].replace(/\s/g, ''), '85,000');
  assert.equal(items[0]['aptNm'], '역삼래미안');
  assert.equal(items[1]['floor'], '3');
});

test('parseFlatItems — item이 없으면 빈 배열', () => {
  assert.deepEqual(parseFlatItems(FIXTURE_EMPTY), []);
});

test('extractHeader — resultCode/resultMsg/totalCount 추출', () => {
  const h = extractHeader(FIXTURE_OK);
  assert.equal(h.resultCode, '00');
  assert.equal(h.resultMsg, 'NORMAL SERVICE.');
  assert.equal(h.totalCount, 2);
});

// ───────────────────────────── fetchTrades ─────────────────────────────

test('fetchTrades — 엔드포인트 미확인 데이터셋은 MolitEndpointNotConfiguredError', async () => {
  await assert.rejects(
    () => fetchTrades('offi_trade', { lawdCd: '11680', dealYmd: '202608', serviceKey: 'x' }),
    MolitEndpointNotConfiguredError
  );
});

test('fetchTrades — 알 수 없는 데이터셋 키는 즉시 에러', async () => {
  await assert.rejects(() =>
    fetchTrades('does_not_exist', { lawdCd: '11680', dealYmd: '202608', serviceKey: 'x' })
  );
});

test('fetchTrades — 필수 파라미터 누락 시 명시적 에러(추측하지 않음)', async () => {
  await assert.rejects(() => fetchTrades('apt_trade', { dealYmd: '202608', serviceKey: 'x' }));
  await assert.rejects(() => fetchTrades('apt_trade', { lawdCd: '11680', serviceKey: 'x' }));
  await assert.rejects(() => fetchTrades('apt_trade', { lawdCd: '11680', dealYmd: '202608' }));
});

test('fetchTrades — 정상 응답을 파싱해 items를 반환(fetch는 모킹)', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, text: async () => FIXTURE_OK };
  };
  const result = await fetchTrades('apt_trade', {
    lawdCd: '11680',
    dealYmd: '202608',
    serviceKey: 'DUMMY_KEY',
    fetchImpl,
  });
  assert.equal(result.items.length, 2);
  assert.equal(result.totalCount, 2);
  assert.equal(result.label, '아파트 매매');
  assert.ok(calls[0].includes(ENDPOINTS.apt_trade.url));
  assert.ok(calls[0].includes('serviceKey=DUMMY_KEY'));
  assert.ok(calls[0].includes('LAWD_CD=11680'));
  assert.ok(calls[0].includes('DEAL_YMD=202608'));
});

test('fetchTrades — resultCode=000/OK(RTMS 서비스 자체 성공 규격)도 정상 처리(회귀 테스트)', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => FIXTURE_OK_000 });
  const result = await fetchTrades('apt_trade', {
    lawdCd: '50110',
    dealYmd: '202608',
    serviceKey: 'DUMMY_KEY',
    fetchImpl,
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.totalCount, 1);
  assert.equal(result.items[0].dealAmount.replace(/\s/g, ''), '40,300');
});

test('fetchTrades — resultCode가 00도 000도 아니면 MolitApiError', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => FIXTURE_ERROR });
  await assert.rejects(
    () => fetchTrades('apt_trade', { lawdCd: '11680', dealYmd: '202608', serviceKey: 'bad', fetchImpl }),
    MolitApiError
  );
});

test('fetchTrades — HTTP 오류 상태는 그대로 에러로 전파', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, text: async () => 'Internal Server Error' });
  await assert.rejects(() =>
    fetchTrades('apt_trade', { lawdCd: '11680', dealYmd: '202608', serviceKey: 'x', fetchImpl })
  );
});

// ───────────────────────────── parseDealAmount / compareToComps ─────────────────────────────

test('parseDealAmount — 쉼표·공백 포함 만원 단위 문자열을 원 단위로 변환', () => {
  assert.equal(parseDealAmount('   85,000'), 850000000);
  assert.equal(parseDealAmount('1,234'), 12340000);
  assert.equal(parseDealAmount(null), null);
  assert.equal(parseDealAmount('abc'), null);
});

test('compareToComps — comps 없으면 matched:false', () => {
  const r = compareToComps({ fairValue: 800000000, items: [] });
  assert.equal(r.matched, false);
  assert.equal(r.comp_count, 0);
});

test('compareToComps — fairValue가 숫자가 아니면 에러', () => {
  assert.throws(() => compareToComps({ fairValue: 'x', items: [] }));
});

test('compareToComps — dealAmount 필드가 없는 아이템은 무시하고 나머지로 계산(회귀 테스트)', () => {
  // 실제 API가 한글 필드명을 쓴다고 잘못 가정했던 시절의 버그 재발 방지:
  // 필드명이 안 맞으면 amounts가 전부 걸러져 매치 0건이 되어야 한다(조용히
  // 잘못된 값을 채우면 안 됨).
  const items = [{ 거래금액: '85,000' }]; // 옛 필드명 — 지금은 안 맞아야 정상
  const r = compareToComps({ fairValue: 850000000, items });
  assert.equal(r.matched, false);
  assert.equal(r.comp_count, 0);
});

test('compareToComps — 중위값·편차·허용범위(sigma_total 기준) 계산', () => {
  const items = [{ dealAmount: '85,000' }, { dealAmount: '82,500' }];
  // median = (850000000+825000000)/2 = 837500000, fairValue를 그 근처로 설정
  const r = compareToComps({ fairValue: 840000000, sigmaTotal: 0.08, items });
  assert.equal(r.matched, true);
  assert.equal(r.comp_count, 2);
  assert.equal(r.comp_median, 837500000);
  assert.equal(r.tolerance_basis, 'sigma_total');
  assert.equal(r.within_tolerance, true);
});

test('compareToComps — 편차가 sigma_total 허용범위 밖이면 within_tolerance:false', () => {
  const items = [{ dealAmount: '85,000' }, { dealAmount: '82,500' }];
  // median = 837500000, sigma_total 0.01 → 허용폭이 매우 좁음
  const r = compareToComps({ fairValue: 950000000, sigmaTotal: 0.01, items });
  assert.equal(r.within_tolerance, false);
});

test('compareToComps — sigma_total 없으면 comp_stdev를 기준으로 사용', () => {
  const items = [{ dealAmount: '85,000' }, { dealAmount: '82,500' }];
  const r = compareToComps({ fairValue: 837500000, items });
  assert.equal(r.tolerance_basis, 'comp_stdev');
  assert.notEqual(r.within_tolerance, null);
});

test('compareToComps — 기준을 계산할 근거가 전혀 없으면(comp 1건, sigma 없음) 판정하지 않음', () => {
  const items = [{ dealAmount: '85,000' }];
  const r = compareToComps({ fairValue: 850000000, items });
  // comp 1건이면 stdev=0 → toleranceBasis 0 → within_tolerance는 null(판정 보류), false 아님
  assert.equal(r.within_tolerance, null);
});
