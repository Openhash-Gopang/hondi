/* ═════════════════════════════════════════════════════════════════════
   equity-bid-model.js — 지분 입찰 테스트: 직역별 잠재 가입자·매출·점유율 시나리오 계산 모델 (2026-10-18)

   ※ 시스템 테스트 전용 · 모든 숫자는 가정이며 확정값·예측·이익 약속이 아닙니다.
   ※ 2026-10-18 개정: 연구개발비·지원 인건비·마케팅비·관리비와 LLM 서버 비용(나비웹 로열티)을 반영했다.
        관리자 문서의 원안(서버 원가 + 고정비만 반영)은 프리셋 "문서 원안"으로 남겨 재현·비교에 쓴다.
   ※ 출처: 관리자 「나비웹을 모회사로 한 자회사 10개 설립과 이사진 구성」(admin/naviweb-group-formation-plan-final.html)
        2.1 시장 규모, 2.4 직역별 참고 가격, 2.6 법인 경제성(로열티 없음), 4.3 보수적 접근.
        그 문서의 값을 그대로 재현할 수 있어야 하며(src/tests/equity_bid_model.test.js), 추가한 가정은
        "검토용 추가 가정"으로 따로 표시한다(기타 운영비, 점유율별 고정비 등).

   브라우저(window.EquityBidModel)와 Node(module.exports) 양쪽에서 쓴다.
   ═════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  // ── 직역(10개 법인). market=시장 규모(명, 근사치), target5pctMan=5% 매각 목표(만 원) — 관리자 문서 2.1·2.4 ──
  var PROFESSIONS = [
    { id: 'judicial-scrivener', name: '법무사·사무원', market: 15756, target5pctMan: 1999,
      basis: '법무사 약 7,878명 + 사무원 약 7,878명. 내부 추정치이며 직접 확인하지 못했습니다.',
      trend: '', staffIncluded: true,
      newPerYear: null, firstIssue: '양쪽 위임 금지, 소송·쟁의사건 관여 금지, 법무사가 아닌 자의 명칭 사용 금지' },
    { id: 'administrative-scrivener', name: '행정사', market: 10750, target5pctMan: 1364,
      basis: '개업 행정사 10,500~11,000명 추정의 중간값입니다. 공식 통계가 아닙니다.',
      trend: '', staffIncluded: false,
      newPerYear: null, firstIssue: '보수 외 금품 수수 금지, 과장광고 금지, 사무직원 감독' },
    { id: 'lawyer', name: '변호사', market: 32100, target5pctMan: 4073,
      basis: '개업 변호사(등록 약 38,200명의 84.1%). 제공받은 통계 기준의 근사치입니다.',
      trend: '연 신규 약 1,714명, 개업 변호사의 약 76%가 서울에 집중', staffIncluded: false,
      newPerYear: 1714, firstIssue: '알선 등 제한(변호사법 제34조) 본문과 변호사 아닌 자가 지배하는 법인의 주식 취득·배당' },
    { id: 'tax-accounting', name: '회계사·세무사', market: 35000, target5pctMan: 4441,
      basis: '세무사 약 18,000명 + 공인회계사 약 17,000명(블로그 추정 합산). 확인이 필요합니다.',
      trend: '', staffIncluded: false,
      newPerYear: null, firstIssue: '세무대리 오인 광고 금지, 명의대여 금지, 외부감사 독립성' },
    { id: 'patent-attorney', name: '변리사', market: 4800, target5pctMan: 609,
      basis: '개업 변리사(등록 약 11,300명의 43.0%). 제공받은 통계 기준의 근사치입니다.',
      trend: '연 신규 최소 약 200명. 시장이 작아 고정비 비중이 큽니다', staffIncluded: false,
      newPerYear: 200, firstIssue: '비변리사와의 제휴 금지(제7조의2, 내용 미확인), 소개·알선 대가 금지(제7조의3), 제출·수수료 납부의 자동 실행' },
    { id: 'appraiser', name: '감정평가사', market: 5000, target5pctMan: 634,
      basis: '2025년 4월 보도의 "전국 감정평가사 5,000명" 근사치입니다. 개업·법인 소속 구분은 확인하지 못했습니다.',
      trend: '연 신규 최소 약 180명. 시장이 작아 고정비 비중이 큽니다', staffIncluded: false,
      newPerYear: 180, firstIssue: '"감정평가" 명칭 사용 제한, 명의 대여 금지, 소속 제한' },
    { id: 'physician', name: '의사', market: 118000, target5pctMan: 14974,
      basis: '2023년 활동 의사 약 118,000명(면허자 128,000명의 92.1%) 보도 기준입니다.',
      trend: '', staffIncluded: false,
      newPerYear: null, firstIssue: '환자 정보 처리, 소프트웨어 의료기기 해당 여부, 환자 유인·알선 금지, 의료광고' },
    { id: 'real-estate-agent', name: '공인중개사', market: 109616, target5pctMan: 13910,
      basis: '개업공인중개사 약 109,616명(2025년 11월 말 보도).',
      trend: '폐업이 개업을 웃도는 흐름이 2023년 2월 이후 이어져 시장이 줄고 있습니다', staffIncluded: false,
      shrinking: true, newPerYear: null, firstIssue: '중개보수 한도와 금지 행위, 시장 위축' },
    { id: 'pharmacist', name: '약사', market: 41000, target5pctMan: 5203,
      basis: '요양기관 근무 약사 약 41,000명(2023년 보도). 약국 포함 여부와 비근무 면허자는 확인하지 못했습니다.',
      trend: '', staffIncluded: false,
      newPerYear: null, firstIssue: '환자 정보 처리, 소프트웨어 의료기기 해당 여부, 약국 개설·의약품 광고' },
    { id: 'traditional-medicine-doctor', name: '한의사', market: 22000, target5pctMan: 2792,
      basis: '요양기관 근무 한의사 약 22,000명(2023년 보도). 전체 면허자와 비근무 인원은 확인하지 못했습니다.',
      trend: '', staffIncluded: false,
      newPerYear: null, firstIssue: '환자 정보 처리, 소프트웨어 의료기기 해당 여부, 환자 유인·알선 금지, 의료광고' }
  ];

  var SHARES = [0.10, 0.30, 0.50, 0.70, 0.90];   // 요청된 시장 점유율 시나리오
  var BASE_SHARE = 0.10;                          // 기준 가입자 수 = 시장 규모의 10% (제안서 8장)
  var TARGET_SHARE = 0.30;                        // 관리자 문서 2.6의 "목표 회원"(시장의 약 30%)
  var STAKE = 0.05;                               // 입찰로 파는 지분
  var SHARES_FOR_SALE = 5000;                     // 5,000주

  // ── 기본 가정 ──
  // 매출 쪽은 관리자 문서 2.6, 비용 쪽(로열티·R&D·지원·마케팅·관리)은 검토용 추가 가정이다.
  var DEFAULTS = {
    annualFeeGross: 99000,        // 연회비(부가세 포함)
    vatRate: 0.10,
    serverCostPerMember: 22667,   // 연 3.4억 원 ÷ 15,000명 (검증 안 됨). 로열티가 이 값 아래로 내려가지 않게 하는 하한으로도 쓴다
    meterMultiple: 0,             // 종량제 수입 = 서버 원가 × 배수 (문서 가정 10배, 근거가 가장 약함)

    // ── 비용(매출 대비 비율 + 소규모일 때의 연 최소 비용) ──
    royaltyRate: 0.30,            // LLM 서버·모델 사용 대가로 나비웹에 내는 로열티(이전 문서의 "매출의 30%" 가정). 서버 원가 아래로는 내려가지 않는다
    rdRate: 0.15,                 // 연구개발비(직역 특화 기능·검증). 모델 개발 자체는 나비웹이 로열티로 맡는다고 보아 벤치마크(23~34%)의 낮은 쪽
    rdMin: 100000000,             // 연 1억 원
    supportRate: 0.10,            // 고객 지원·운영 인건비(영업·R&D 인건비는 각 항목에 포함). 벤치마크 약 11%
    supportMin: 210000000,        // 연 2.1억 원(3명 × 7,000만 원)
    mktRate: 0.20,                // 마케팅·영업비. 벤치마크(33~47%)의 낮은 쪽: 직역 단체·교육 중심이고 소개 대가가 금지됨
    mktMin: 50000000,             // 연 5,000만 원
    adminRate: 0.10,              // 일반관리비(벤치마크 12~19%의 아래쪽)

    fixedMaint: 15000000,         // 유지비 연 1,500만 원 (문서 2.6)
    execPay: 36000000,            // 임원 보수 연 3,600만 원, 점유율 10% 이상일 때 (문서 2.6)
    execPayThreshold: 0.10,
    payoutRatio: 1                // 세후 이익 전액 배당(상한을 보기 위한 가정, 배당 정책은 미정)
  };
  var COST_ZERO = { royaltyRate: 0, rdRate: 0, rdMin: 0, supportRate: 0, supportMin: 0, mktRate: 0, mktMin: 0, adminRate: 0 };

  // 프리셋. 기본 화면은 '하한'(문서 4.3: "가정이 틀렸을 때를 기준으로 판단").
  var PRESETS = [
    { id: 'floor', label: '하한', params: { meterMultiple: 0 },
      desc: '종량제 수입 0(기본료 연 99,000원만) + 비용 전부 반영. 문서 4.3의 "종량제를 0으로 둔 하한"에 현실적인 비용을 더한 값입니다.' },
    { id: 'conservative', label: '보수', params: { meterMultiple: 1 },
      desc: '종량제 수입 = 서버 원가의 1배 + 비용 전부 반영.' },
    { id: 'docrev', label: '문서 매출', params: { meterMultiple: 10 },
      desc: '관리자 문서의 매출 가정(종량제 10배)에 비용을 전부 반영한 값입니다. 종량제는 근거가 가장 약한 가정이라 낙관적인 쪽입니다.' },
    { id: 'docraw', label: '문서 원안(비용 미반영)', params: merge(COST_ZERO, { meterMultiple: 10 }), unrealistic: true,
      desc: '관리자 문서 2.6 그대로(서버 원가와 고정비만 반영, 연구개발·인건비·마케팅·관리비·로열티 없음). 영업이익률이 90% 안팎으로 나오는 비현실적인 값이며, 이전 계산과 비교하는 용도입니다.' }
  ];

  function merge(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; if (b) for (k in b) o[k] = b[k]; return o; }

  function feeSupply(A) { return A.annualFeeGross / (1 + A.vatRate); }          // 99,000 → 90,000
  function meterPerMember(A) { return A.serverCostPerMember * A.meterMultiple; }
  function revenuePerMember(A) { return feeSupply(A) + meterPerMember(A); }
  // 회원 1인이 실제로 내는 연 금액(부가세 포함): 연회비 + 종량제 공급가 × (1+VAT)
  function payPerMemberGross(A) { return A.annualFeeGross + meterPerMember(A) * (1 + A.vatRate); }

  // 법인세(원): 2억 이하 9%, 200억 이하 19%, 3,000억 이하 21%, 초과 24%. 지방소득세 제외(문서와 같음). 결손은 이월하지 않는다.
  function corporateTax(taxable) {
    if (taxable <= 0) return 0;
    var b1 = 200000000, b2 = 20000000000, b3 = 300000000000, t = 0;
    t += Math.min(taxable, b1) * 0.09;
    if (taxable > b1) t += (Math.min(taxable, b2) - b1) * 0.19;
    if (taxable > b2) t += (Math.min(taxable, b3) - b2) * 0.21;
    if (taxable > b3) t += (taxable - b3) * 0.24;
    return t;
  }

  // 회원 수로 직접 계산(관리자 문서의 표를 재현하는 데 쓴다). execPayOn: 임원 보수 포함 여부.
  //   로열티 = max(매출 × 로열티율, 서버 원가 × 회원) — 서버 원가 아래로는 내려가지 않는다(원안은 로열티율 0이라 서버 원가만 남는다)
  //   R&D·지원·마케팅 = max(매출 × 비율, 연 최소 비용) — 소규모에서도 최소한의 팀과 비용은 든다
  function computeByMembers(members, A, execPayOn) {
    var rev = members * revenuePerMember(A);
    var serverFloor = members * A.serverCostPerMember;
    var royalty = Math.max(rev * A.royaltyRate, serverFloor);
    var rd = Math.max(rev * A.rdRate, A.rdMin);
    var support = Math.max(rev * A.supportRate, A.supportMin);
    var mkt = Math.max(rev * A.mktRate, A.mktMin);
    var admin = rev * A.adminRate;
    var fixed = A.fixedMaint + (execPayOn ? A.execPay : 0);
    var costTotal = royalty + rd + support + mkt + admin + fixed;
    var op = rev - costTotal;
    var tax = corporateTax(op);
    return { members: members, revenue: rev, serverCost: serverFloor, royalty: royalty, rd: rd, support: support, mkt: mkt, admin: admin,
             fixed: fixed, costTotal: costTotal, operatingProfit: op, margin: rev > 0 ? op / rev : 0, tax: tax, netIncome: op - tax };
  }

  // 직역·점유율 → 결과. 5% 지분의 배당과 취득가 대비 수익률까지 계산한다.
  function compute(prof, share, assumptions) {
    var A = merge(DEFAULTS, assumptions);
    var members = Math.round(prof.market * share);
    var r = computeByMembers(members, A, share >= A.execPayThreshold);
    var cost = prof.target5pctMan * 10000;                 // 5% 취득가(원) = 5,000주 × 주당 가격
    r.share = share;
    r.stakeCost = cost;
    r.stakeDividend = Math.max(0, r.netIncome) * A.payoutRatio * STAKE;
    r.yieldPct = cost > 0 ? r.stakeDividend / cost : 0;    // 연 배당수익률
    r.paybackYears = r.stakeDividend > 0 ? cost / r.stakeDividend : null;
    return r;
  }

  var SUM_KEYS = ['members', 'revenue', 'serverCost', 'royalty', 'rd', 'support', 'mkt', 'admin', 'fixed', 'costTotal', 'operatingProfit', 'tax', 'netIncome', 'stakeCost', 'stakeDividend'];
  // 전 직역 합계(점유율 동일 적용)
  function computeAll(share, assumptions) {
    var sum = {};
    SUM_KEYS.forEach(function (k) { sum[k] = 0; });
    PROFESSIONS.forEach(function (p) {
      var r = compute(p, share, assumptions);
      SUM_KEYS.forEach(function (k) { sum[k] += r[k]; });
    });
    sum.share = share;
    sum.margin = sum.revenue > 0 ? sum.operatingProfit / sum.revenue : 0;
    sum.yieldPct = sum.stakeCost > 0 ? sum.stakeDividend / sum.stakeCost : 0;
    sum.paybackYears = sum.stakeDividend > 0 ? sum.stakeCost / sum.stakeDividend : null;
    return sum;
  }

  // 손익분기 회원 수: 영업이익이 0 이상이 되는 최소 회원 수(이분 탐색). 끝내 흑자가 안 되면 null.
  function breakEvenMembers(A0, withExecPay) {
    var A = merge(DEFAULTS, A0), lo = 0, hi = 20000000;
    if (computeByMembers(hi, A, withExecPay).operatingProfit < 0) return null;
    for (var i = 0; i < 80; i++) {
      var mid = (lo + hi) / 2;
      if (computeByMembers(mid, A, withExecPay).operatingProfit >= 0) hi = mid; else lo = mid;
    }
    return hi;
  }

  function findProfession(id) {
    for (var i = 0; i < PROFESSIONS.length; i++) if (PROFESSIONS[i].id === id) return PROFESSIONS[i];
    return null;
  }

  // ── 표시용 서식 ──
  function fmtInt(n) { return Math.round(n).toLocaleString('ko-KR'); }
  // 원 단위 금액을 읽기 쉬운 단위로(억/만 원)
  function fmtWon(n) {
    var a = Math.abs(n), s = n < 0 ? '-' : '';
    if (a >= 1e8) {
      var v = a / 1e8, str = v.toFixed(v >= 100 ? 0 : (v >= 10 ? 1 : 2));
      if (str.indexOf('.') >= 0) str = str.replace(/0+$/, '').replace(/\.$/, '');
      return s + Number(str).toLocaleString('ko-KR', { maximumFractionDigits: 2 }) + '억 원';
    }
    if (a >= 1e4) return s + fmtInt(a / 1e4) + '만 원';
    return s + fmtInt(a) + '원';
  }
  function fmtPct(x, d) { return (x * 100).toFixed(d == null ? 1 : d) + '%'; }

  var api = {
    PROFESSIONS: PROFESSIONS, SHARES: SHARES, BASE_SHARE: BASE_SHARE, TARGET_SHARE: TARGET_SHARE,
    STAKE: STAKE, SHARES_FOR_SALE: SHARES_FOR_SALE, DEFAULTS: DEFAULTS, PRESETS: PRESETS,
    feeSupply: feeSupply, meterPerMember: meterPerMember, revenuePerMember: revenuePerMember,
    payPerMemberGross: payPerMemberGross, corporateTax: corporateTax,
    computeByMembers: computeByMembers, compute: compute, computeAll: computeAll,
    breakEvenMembers: breakEvenMembers, findProfession: findProfession, COST_ZERO: COST_ZERO,
    fmtInt: fmtInt, fmtWon: fmtWon, fmtPct: fmtPct, merge: merge
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EquityBidModel = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {}));
