#!/usr/bin/env node
/**
 * scripts/kestate/molit-check.mjs — 실거래가 즉시 대조 점검 CLI
 *
 * ★ 2026-09-29 신설. SP-24a가 낸 추정치(fair_value, sigma_total)를 같은
 * 법정동·계약년월의 국토부 실거래가와 대조한다. 상세는
 * src/gopang/verification/{molit-client,molit-compare}.js 및
 * docs/kestate/verification-protocol.md 참조.
 *
 * 사용법:
 *   MOLIT_SERVICE_KEY="디코딩된 인증키" \
 *     node scripts/kestate/molit-check.mjs \
 *       --dataset apt_trade --lawd 11680 --ymd 202608 \
 *       --fair-value 850000000 --sigma 0.08
 *
 * 인자:
 *   --dataset   ENDPOINTS 키(현재 apt_trade만 사용 가능, 그 외는
 *               molit-client.js의 ENDPOINTS를 먼저 채워야 함)
 *   --lawd      법정동코드 5자리
 *   --ymd       계약년월 6자리(YYYYMM)
 *   --fair-value hondi stagedValuation() 결과의 fair_value(원)
 *   --sigma     (선택) stagedValuation() 결과의 sigma_total(비율)
 */
import { fetchTrades } from '../../src/gopang/verification/molit-client.js';
import { compareToComps } from '../../src/gopang/verification/molit-compare.js';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1];
      out[key] = val;
      i += 1;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const datasetKey = args.dataset || 'apt_trade';
  const lawdCd = args.lawd;
  const dealYmd = args.ymd;
  const fairValue = args['fair-value'] != null ? Number(args['fair-value']) : null;
  const sigmaTotal = args.sigma != null ? Number(args.sigma) : null;
  const serviceKey = process.env.MOLIT_SERVICE_KEY;

  if (!lawdCd || !dealYmd || fairValue == null) {
    console.error(
      '사용법: MOLIT_SERVICE_KEY=... node scripts/kestate/molit-check.mjs --dataset apt_trade --lawd <5자리> --ymd <YYYYMM> --fair-value <원> [--sigma <비율>]'
    );
    process.exit(1);
  }
  if (!serviceKey) {
    console.error('환경변수 MOLIT_SERVICE_KEY가 설정되지 않았습니다.');
    process.exit(1);
  }

  const result = await fetchTrades(datasetKey, { lawdCd, dealYmd, serviceKey });
  console.log(`[${result.label}] ${lawdCd} / ${dealYmd} — 조회된 거래 ${result.items.length}건`);

  const cmp = compareToComps({ fairValue, sigmaTotal, items: result.items });
  if (!cmp.matched) {
    console.log(`대조 불가: ${cmp.reason}`);
    return;
  }
  console.log(
    [
      `comp 건수: ${cmp.comp_count}`,
      `comp 중위값: ${cmp.comp_median.toLocaleString()}원`,
      `comp 범위: ${cmp.comp_min.toLocaleString()} ~ ${cmp.comp_max.toLocaleString()}원`,
      `혼디 추정치: ${cmp.fair_value.toLocaleString()}원`,
      `편차: ${cmp.deviation_pct.toFixed(2)}%`,
      `허용범위 판정 기준: ${cmp.tolerance_basis}`,
      `허용범위 내: ${cmp.within_tolerance === null ? '판정 불가(기준 없음)' : cmp.within_tolerance ? '예' : '아니오 — 확인 필요'}`,
    ].join('\n')
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
