// gov_fee_calc.mjs
//
// 순수 계산 함수 모음. formula_json에 저장된 구간표(tiers)를 입력받아
// 실제 정부 납부 기준액(참조값)을 계산한다. 하드코딩된 세율표를 이 파일에
// 절대 넣지 않는다 — tiers는 항상 PocketBase gov_fee_schedule.formula_json에서
// 읽어온 값을 그대로 사용해야, 요율 개정 시 코드 배포 없이 데이터만 갱신하면 된다.
//
// formula_json 구조 예 (인지세 - 부동산형):
// {
//   "calc": "tiered_threshold",
//   "tiers": [
//     { "max": 10000000,  "rate": 0,      "base": 0 },
//     { "max": 30000000,  "rate": 0,      "base": 20000 },
//     { "max": 50000000,  "rate": 0,      "base": 40000 },
//     { "max": 100000000, "rate": 0,      "base": 70000 },
//     { "max": 1000000000,"rate": 0,      "base": 150000 },
//     { "max": null,      "rate": 0,      "base": 350000 }
//   ]
// }
// (인지세는 구간별 "정액"이라 rate=0, base=구간 금액. 법원 인지대는 rate>0인
//  누진 구조라 아래 tiered_rate_plus_base 타입을 쓴다.)
//
// formula_json 구조 예 (법원 인지대):
// {
//   "calc": "tiered_rate_plus_base",
//   "roundDown": 100,
//   "tiers": [
//     { "max": 10000000,  "rate": 0.005,  "base": 0 },
//     { "max": 100000000, "rate": 0.0045, "base": 5000 },
//     { "max": 1000000000,"rate": 0.004,  "base": 55000 },
//     { "max": null,      "rate": 0.0035, "base": 555000 }
//   ],
//   "efileDiscount": 0.1
// }

/**
 * 구간표에서 amount에 해당하는 tier를 찾는다. tiers는 max 오름차순, 마지막 tier의
 * max는 null(무제한)이어야 한다.
 */
function findTier(tiers, amount) {
  for (const t of tiers) {
    if (t.max === null || amount <= t.max) return t;
  }
  return tiers[tiers.length - 1];
}

/** 정액 구간형 (인지세: 구간마다 고정 금액) */
export function calcTieredThreshold(formula, amount) {
  const tier = findTier(formula.tiers, amount);
  return tier.base;
}

/** 누진율+기본액형 (법원 인지대: 소가 × rate + base, 100원 미만 절사) */
export function calcTieredRatePlusBase(formula, amount, { isEfile = false } = {}) {
  const tier = findTier(formula.tiers, amount);
  let fee = amount * tier.rate + tier.base;
  if (isEfile && formula.efileDiscount) {
    fee = fee * (1 - formula.efileDiscount);
  }
  const roundDown = formula.roundDown || 1;
  return Math.floor(fee / roundDown) * roundDown;
}

/** 송달료: 단가 × 회수 × 당사자수 */
export function calcServiceMail(formula, { parties, count }) {
  return formula.unitFee * parties * count;
}

/**
 * gov_fee_schedule 레코드 하나와 입력값을 받아 "정부 납부 기준액(참조값)"을 계산한다.
 * 이 값은 실제로 GDC에서 차감되는 금액이 아니라 참고용 기준액이다 — 실제 정부 납부는
 * 사용자가 공식 채널로 직접 한다 (2026-08-15 결정: GDC는 나비 서비스 수수료 전용).
 */
export function calcGovReference(record, inputs = {}) {
  switch (record.fee_type) {
    case 'free':
      return 0;
    case 'flat':
      return record.gov_reference_fee_min ?? record.gov_reference_fee_max ?? null;
    case 'tiered':
    case 'formula': {
      const f = record.formula_json;
      if (!f) return null;
      if (f.calc === 'tiered_threshold') {
        return calcTieredThreshold(f, inputs.amount);
      }
      if (f.calc === 'tiered_rate_plus_base') {
        return calcTieredRatePlusBase(f, inputs.amount, { isEfile: inputs.isEfile });
      }
      if (f.calc === 'service_mail') {
        return calcServiceMail(f, { parties: inputs.parties, count: inputs.count });
      }
      return null;
    }
    case 'ordinance_ref':
    case 'unknown':
    default:
      return null; // 사람 확인 필요 (NEEDS_REVIEW)
  }
}

/**
 * 나비 서비스 수수료(GDC 청구액) = 정부 납부 기준액 × gdc_multiplier.
 * fee_type이 free/ordinance_ref/unknown이라 참조값을 못 구하면 null을 반환하고
 * 상위 로직에서 "확인 필요" 처리를 하도록 한다 (자동으로 0원 청구하지 않는다).
 */
export function calcHondiServiceFee(record, inputs = {}) {
  const reference = calcGovReference(record, inputs);
  if (reference === null || reference === undefined) return null;
  return Math.round(reference * (record.gdc_multiplier ?? 2));
}
