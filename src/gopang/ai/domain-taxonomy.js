/**
 * ai/domain-taxonomy.js — GWP·EXPERT 통합 상위 도메인 (2026-08-08 신설)
 *
 * 배경(주피터 지시): GWP_REGISTRY(14개 category 코드: EMG/JUS/MED/EDU/
 * ECO/MKT/TRN/GOV/UTL/TOOL/ONB/BIZ/ENV/LEG)와 EXPERT_REGISTRY(13개
 * category 코드: HEALTH/EDU/ENG/LAW/FIN/BEAUTY/CULINARY/IT/REAL_ESTATE/
 * SPORTS/TOURISM/TRANSLATION)가 서로 다른 이름의 독립된 분류 체계를
 * 쓰고 있어("의료"가 GWP에선 MED, EXPERT에선 HEALTH), 이름 하나로 두
 * 레지스트리를 동시에 좁히는 게 불가능했다. 이 파일이 그 둘을 잇는
 * 통합 상위 도메인이다 — deepseek flash가 1단계에서 "이 발화는 어느
 * 도메인인가"만 판단하면(domain-classifier.js), 그 도메인에 속한
 * GWP+EXPERT 후보만 다음 단계(축소된 AC-PRO-CORE)로 넘어간다.
 *
 * 도메인 경계는 완전히 깔끔하지 않다 — 예: JUS(klaw/kpolice/ksecurity)는
 * 엄밀히는 "법률"뿐 아니라 "치안"·"사이버보안"도 포함하는데, EXPERT의
 * LAW(7개)·IT(1개, security-engineer)를 같이 묶어 "법률·치안·보안"
 * 하나의 도메인으로 뒀다 — 지나치게 잘게 쪼개면 flash가 판단할 도메인
 * 수가 다시 늘어나 원래 목적(선택지 축소)에 반하기 때문에, 실제
 * 사용자 위임의도가 몰리는 경계(예: "해킹당한 것 같아요"는 법률
 * 상담이 아니라 ksecurity/security-engineer)를 기준으로 실용적으로
 * 묶었다.
 *
 * 매 카테고리 코드는 정확히 하나의 도메인에만 속한다(중복 없음) —
 * validateTaxonomyCoverage()가 이걸 실제 레지스트리 데이터로 검증한다.
 */

export const UNIFIED_DOMAINS = [
  {
    id: 'emergency',
    label: '응급·재난',
    gwpCategories: ['EMG'],
    expertCategories: [],
    note: '★ 특수 — kemergency는 이미 §SAFETY(R0 최우선)에서 도메인 분류 전에 처리된다. 이 도메인은 taxonomy 완전성 검증용으로만 존재하고, domain-classifier.js의 실제 분류 후보 목록에는 노출하지 않는다(분류 대상이 아니라 이미 그 앞단에서 걸러짐).',
  },
  {
    id: 'education',
    label: '교육·학습·상담',
    gwpCategories: ['EDU'],
    expertCategories: ['EDU'],
    examples: ['과목 지도·과외·1:1 학습', '진로·시험·자격증 상담', '학교 상담·심리 상담·사회복지 상담', '보육·평생교육'],
  },
  {
    id: 'health',
    label: '의료·건강',
    gwpCategories: ['MED'],
    expertCategories: ['HEALTH'],
    examples: ['증상·진료·처방', '병원·의료기관 안내', '각 의료 전문직(의사·간호사·약사 등)에게 직접 상담'],
  },
  {
    id: 'legal_security',
    label: '법률·치안·보안',
    gwpCategories: ['JUS'],
    expertCategories: ['LAW', 'IT'],
    examples: ['소송·계약·형사·민사', '범죄·신고·수사', '개인정보 침해·해킹·사이버 보안', '변호사·법무사·변리사 등 자격직 위임'],
  },
  {
    id: 'finance_realestate',
    label: '금융·세무·부동산',
    gwpCategories: ['ECO'],
    expertCategories: ['FIN', 'REAL_ESTATE'],
    examples: ['결제·송금·예적금·대출·투자', '세금·보험', '부동산 매물·시세·중개', '세무사·회계사·재무설계사 위임'],
  },
  {
    id: 'commerce',
    label: '상거래·쇼핑·사업',
    gwpCategories: ['MKT', 'BIZ'],
    expertCategories: [],
    examples: ['상품 검색·비교·구매', '판매자 등록', '사업자 지원'],
  },
  {
    id: 'transport_engineering',
    label: '교통·물류·공학',
    gwpCategories: ['TRN'],
    expertCategories: ['ENG'],
    examples: ['대중교통·배송·물류', '건축·기술사·해양·기상·안전 전문직 위임'],
  },
  {
    id: 'government',
    label: '행정·시민참여',
    gwpCategories: ['GOV', 'LEG'],
    expertCategories: [],
    examples: ['민원·행정 절차', '지방행정', '시민참여·청원'],
  },
  {
    id: 'lifestyle',
    label: '생활서비스',
    gwpCategories: ['ENV'],
    expertCategories: ['BEAUTY', 'CULINARY', 'SPORTS', 'TOURISM', 'TRANSLATION'],
    examples: ['미용·요리·스포츠 지도·관광 안내·통번역', '청소·환경'],
  },
  {
    id: 'utility',
    label: '통신·검색·도구',
    gwpCategories: ['UTL', 'TOOL'],
    expertCategories: [],
    examples: ['통신·인터넷', '웹 검색', '계산기 등 범용 도구'],
  },
  {
    id: 'onboarding',
    label: '나비 자체 안내',
    gwpCategories: ['ONB'],
    expertCategories: ['PLATFORM'],
    note: '나비 튜토리얼·프로필 — 도메인 분류 후보에는 넣지 않는다(다른 도메인과 경합할 성격이 아님, 별도 온보딩 흐름에서만 호출됨). 2026-08-31 — 나비 SP(PLATFORM)도 같은 이유로 여기 속한다: 리터럴 트리거("나비가 뭐예요" 등)로 직접 호출되며 패러프레이즈 도메인 분류 경쟁에는 넣지 않는다.',
  },
];

/**
 * domain-classifier.js가 실제로 flash에게 보여줄 후보 도메인만 반환한다
 * (emergency·onboarding처럼 분류 대상이 아닌 것 제외).
 */
export function getClassifiableDomains() {
  return UNIFIED_DOMAINS.filter(d => d.id !== 'emergency' && d.id !== 'onboarding');
}

/**
 * 도메인 id로 그 도메인에 속한 GWP category 코드·EXPERT category
 * 코드를 찾는다.
 */
export function getDomainById(domainId) {
  return UNIFIED_DOMAINS.find(d => d.id === domainId) || null;
}

/**
 * 통합 도메인 id 목록(예: classifyDomain()의 결과)을 받아, candidates
 * (candidate-prefilter.js의 buildCandidateList() 출력 — {id, kind,
 * category, ...} 배열) 중 그 도메인들에 속하는 것만 골라 id 배열로
 * 반환한다. 여러 도메인이 주어지면 합집합.
 *
 * @param {string[]} domainIds
 * @param {Array} candidates - {id, kind:'gwp'|'expert', category, ...}
 * @returns {string[]} 해당 도메인에 속하는 candidate id 목록
 */
export function getCandidateIdsForDomains(domainIds, candidates) {
  if (!domainIds || !domainIds.length) return [];
  const domains = domainIds.map(getDomainById).filter(Boolean);
  const gwpCats = new Set(domains.flatMap(d => d.gwpCategories));
  const expertCats = new Set(domains.flatMap(d => d.expertCategories));

  return (candidates || [])
    .filter(c => (c.kind === 'gwp' && gwpCats.has(c.category)) || (c.kind === 'expert' && expertCats.has(c.category)))
    .map(c => c.id);
}

/**
 * 실제 GWP_REGISTRY·EXPERT_REGISTRY 데이터로 taxonomy 커버리지를
 * 검증한다 — 두 레지스트리에 실제로 존재하는 모든 category 코드가
 * 정확히 하나의 도메인에만 속하는지 확인한다(빠짐·중복 방지).
 *
 * @param {string[]} gwpCategoriesInUse - GWP_REGISTRY에서 실제 쓰이는 category 코드 목록
 * @param {string[]} expertCategoriesInUse - EXPERT_REGISTRY 루트에서 실제 쓰이는 category 코드 목록
 * @returns {{ok: boolean, missingGwp: string[], missingExpert: string[], duplicates: string[]}}
 */
export function validateTaxonomyCoverage(gwpCategoriesInUse, expertCategoriesInUse) {
  const seenGwp = new Map();
  const seenExpert = new Map();
  const duplicates = [];

  for (const d of UNIFIED_DOMAINS) {
    for (const c of d.gwpCategories) {
      if (seenGwp.has(c)) duplicates.push(`gwp:${c} (${seenGwp.get(c)} vs ${d.id})`);
      seenGwp.set(c, d.id);
    }
    for (const c of d.expertCategories) {
      if (seenExpert.has(c)) duplicates.push(`expert:${c} (${seenExpert.get(c)} vs ${d.id})`);
      seenExpert.set(c, d.id);
    }
  }

  const missingGwp = gwpCategoriesInUse.filter(c => !seenGwp.has(c));
  const missingExpert = expertCategoriesInUse.filter(c => !seenExpert.has(c));

  return {
    ok: duplicates.length === 0 && missingGwp.length === 0 && missingExpert.length === 0,
    missingGwp,
    missingExpert,
    duplicates,
  };
}
