/**
 * ai/expert-registry-lawyer.js — 변호사(lawyer) 세부분야 전용 레지스트리
 *
 * 2026-08-08 신설(expert-registry.js 도메인 분리 리팩터링). 배경: 의사·
 * 변호사·교수 세부분야가 여러 세션에서 동시에 빠르게 확장되면서, 이
 * 세 도메인이 단일 expert-registry.js 파일을 공유해 병합 충돌(한 세션이
 * 다른 세션의 등록분을 알지 못한 채 덮어쓰는 사고)이 반복 발생했다 —
 * 이 파일 분리로 서로 다른 도메인을 다루는 세션끼리는 애초에 같은
 * 파일을 건드리지 않게 된다.
 *
 * 이 파일은 EXPERT_REGISTRY의 일부만 담당하는 partial이며, 최종
 * EXPERT_REGISTRY는 expert-registry.js가 이 파일들을 병합해서 만든다.
 * 이 파일 자체를 직접 import해서 쓰지 않는다 — 항상 expert-registry.js의
 * EXPERT_REGISTRY를 통해 접근한다(getExpertDef 등 헬퍼 함수도 동일).
 */

export const LAWYER_REGISTRY = {
  lawyer: {
    // 2026-07-09: v3.2 → v4.1 갱신. v4.0(STEP R 오케스트레이션)·v4.1(C41
    // scope=orchestration_subtask 대응)이 이 줄이 안 바뀌어서 한 번도
    // 실제로 로드된 적이 없었다(실사로 확인).
    label: '변호사', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 정책 반영(2026-07-25) — 'GWP 기본값, EXPERT는 위임의도 명시 시만
    // 우선' 원칙. 예전엔 klaw와 완전 동일한 '변호사·소송·고소·고발'을 그대로 썼는데, 이건 klaw(가상판결 시뮬레이션)와
    // lawyer(실제 변호사 자문) 둘 다에 해당하는 일반어라 어느 쪽이 이길지 불확정이었다. '소송·고소·고발'은 klaw가
    // 담당하는 게 맞으므로 빼고, 위임 의도가 명확한 구(phrase)만 남겨 klaw의 단일어 트리거보다 항상 더 길게(=매칭 로직상
    // 우선) 만든다.
    // 2026-08-01 추가 정정 — scenarios_regression_R1_20260801.json 재검증에서
    // '억울한 일'이 과잉발동의 주범으로 지목됐다("회사에서 갑자기 나가라고
    // 하는데 이거 정당한 건지 판단 좀 받고 싶어"처럼 '변호사'라는 단어가
    // 전혀 없는 klaw 사안에도 이 트리거가 의미적으로 걸려 lawyer가 klaw를
    // 이겨버림 — 이 문구가 사실상 "법적으로 불만족스러운 모든 상황"과
    // 동의어라 트리거로서 너무 넓었다). 제거한다. judicial-scrivener처럼
    // "경매"가 리터럴로 있어도 lawyer로 새는 사례도 관찰됐는데, 그건
    // 트리거 목록 문제가 아니라 "법률=변호사"라는 모델의 기본 연상
    // 편향이라 트리거 축소만으론 못 잡는다 — AC-PRO-CORE §CATALOG-EXPERT
    // 위에 별도 경고 문구로 대응한다(gwp-registry.js/AC-PRO-CORE 참고).
    triggers: ['변호사 선임', '변호사에게 맡기고 싶어', '변호사 상담', '법적 조치'],
  },
  'lawyer-criminal': {
    label: '변호사(형사법)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-criminal', needsMedicalSafety: false,
    parentKey: 'lawyer', // 2026-08-07 신설(SP_EXPERT_BASE §5 세부분야 + §5-1 동적 자문 호출)
    triggers: ['형사법 상담', '형사 전문 변호사'],
  },
  'lawyer-civil': {
    label: '변호사(민사법)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-civil', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['민사법 상담', '민사 전문 변호사'],
  },
  'lawyer-corporate': {
    label: '변호사(기업법무)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-corporate', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['기업법무 상담', '기업 전문 변호사', 'M&A 법률 자문'],
  },
  'lawyer-family': {
    label: '변호사(가사법)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-family', needsMedicalSafety: false,
    parentKey: 'lawyer', // 2026-08-07 신설(의사·변호사 세부분야 대폭확장 배치1)
    triggers: ['가사법 상담', '이혼 전문 변호사', '양육권 상담'],
  },
  'lawyer-inheritance': {
    label: '변호사(상속)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-inheritance', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['상속 전문 변호사', '유류분 상담', '상속포기 상담'],
  },
  'lawyer-realestate': {
    label: '변호사(부동산)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-realestate', needsMedicalSafety: false,
    parentKey: 'lawyer',
    // 2026-09-17 추가 — candidate-prefilter.js가 순수 부분문자열 매칭이라
    // "부동산 변호사"(구어체, '전문' 생략)는 이 세부분야 트리거에 안 걸리고
    // klaw의 짧은 트리거 '변호사'만 걸려, 0단계 후보 목록에서 이 리프
    // 자체가 아예 빠지는 사고 확인(실사 재현: routing_ABmention_live_
    // smoketest.py 결과). '전문' 없는 구어체 변형을 추가.
    triggers: ['부동산 전문 변호사', '부동산 변호사', '임대차 분쟁 상담'],
  },
  'lawyer-traffic': {
    label: '변호사(교통사고)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-traffic', needsMedicalSafety: false,
    parentKey: 'lawyer',
    // 2026-09-17 추가 — 위 lawyer-realestate와 동일 사유(구어체 '전문'
    // 생략형 미매칭 → klaw로 새는 사고, 실사 재현 확인).
    triggers: ['교통사고 전문 변호사', '교통사고 변호사'],
  },
  'lawyer-damages': {
    label: '변호사(손해배상)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-damages', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['손해배상 전문 변호사', '의료소송 상담'],
  },
  'lawyer-auction': {
    label: '변호사(등기·경매)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-auction', needsMedicalSafety: false,
    parentKey: 'lawyer',
    // 2026-09-17 추가 — 동일 사유(구어체 '전문' 생략형 미매칭).
    triggers: ['경매 전문 변호사', '경매 변호사', '등기 변호사', '명도소송 상담'],
  },
  'lawyer-commercial': {
    label: '변호사(상사법)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-commercial', needsMedicalSafety: false,
    parentKey: 'lawyer', // 2026-08-07 신설(의사·변호사 세부분야 대폭확장 배치2)
    triggers: ['상사법 상담', '어음수표 소송'],
  },
  'lawyer-execution': {
    label: '변호사(민사집행)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-execution', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['민사집행 상담', '채권압류 상담'],
  },
  'lawyer-collection': {
    label: '변호사(채권추심)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-collection', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['채권추심 전문 변호사', '지급명령 상담'],
  },
  'lawyer-insolvency': {
    label: '변호사(도산)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-insolvency', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['법인회생 상담', '법인파산 상담', '기업회생 전문 변호사'],
  },
  'lawyer-securities': {
    label: '변호사(증권)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-securities', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['증권 전문 변호사', '불공정거래 대응'],
  },
  'lawyer-finance': {
    label: '변호사(금융)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-finance', needsMedicalSafety: false,
    parentKey: 'lawyer',
    // 2026-09-17 추가 — 동일 사유(구어체 '전문' 생략형 미매칭).
    triggers: ['금융 전문 변호사', '금융 변호사', '대출 약관 분쟁'],
  },
  'lawyer-insurance': {
    label: '변호사(보험)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-insurance', needsMedicalSafety: false,
    parentKey: 'lawyer',
    // 2026-09-17 추가 — 동일 사유. 실사 재현 사례: "보험 변호사 AI 불러줘"
    // → klaw도 아니고 kinsurance로 새어 "변호사" 요청 자체가 무시됨(가장
    // 심각한 오탐 사례).
    triggers: ['보험 전문 변호사', '보험 변호사', '보험금 지급거절 상담'],
  },
  'lawyer-government-contract': {
    label: '변호사(국가계약)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-government-contract', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['국가계약 상담', '입찰 무효 상담', '부정당업자 제재'],
  },
  'lawyer-antitrust': {
    label: '변호사(공정거래)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-antitrust', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['공정거래 전문 변호사', '가맹사업 분쟁'],
  },
  'lawyer-military': {
    label: '변호사(군형법)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-military', needsMedicalSafety: false,
    parentKey: 'lawyer', // 2026-08-07 신설(의사·변호사 세부분야 대폭확장 배치3)
    triggers: ['군형법 상담', '군사법원 변호사'],
  },
  'lawyer-juvenile': {
    label: '변호사(소년법)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-juvenile', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['소년법 상담', '소년보호사건 변호사'],
  },
  'lawyer-administrative': {
    label: '변호사(행정법)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-administrative', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['행정법 상담', '행정소송 전문 변호사', '영업정지 이의'],
  },
  'lawyer-constitutional': {
    label: '변호사(헌법재판)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-constitutional', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['헌법소원 상담', '헌법재판 전문 변호사'],
  },
  'lawyer-environmental': {
    label: '변호사(환경)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-environmental', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['환경 전문 변호사', '환경오염 손해배상'],
  },
  'lawyer-expropriation': {
    label: '변호사(수용 및 보상)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-expropriation', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['토지수용 상담', '보상금 소송 변호사'],
  },
  'lawyer-foodpharma': {
    label: '변호사(식품·의약)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-foodpharma', needsMedicalSafety: false,
    parentKey: 'lawyer',
    // 2026-09-17 추가 — 동일 사유.
    triggers: ['식품 의약 전문 변호사', '식품의약 변호사', '제조물책임 소송'],
  },
  'lawyer-maritime': {
    label: '변호사(해상)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-maritime', needsMedicalSafety: false,
    parentKey: 'lawyer', // 2026-08-07 신설(의사·변호사 세부분야 대폭확장 배치8, 변호사 배치4)
    // 2026-09-17 추가 — 기존 triggers에 '변호사' 단어 자체가 아예 없어서,
    // "해상 변호사 불러줘"류 명시적 위임 발화조차 이 리프를 후보로 못
    // 올렸다(실사 재현: [GWP_REGISTRY_SEARCH]로 새어 아예 존재하지 않는
    // 검색 태그를 지어낸 사고까지 확인됨 — 별도 조치 필요할 수 있음).
    triggers: ['해상사고 상담', '해상 변호사', '선박 관련 계약분쟁'],
  },
  'lawyer-trade': {
    label: '변호사(무역)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-trade', needsMedicalSafety: false,
    parentKey: 'lawyer', // 2026-08-07 신설(의사·변호사 세부분야 대폭확장 배치8, 변호사 배치4)
    // 2026-09-17 추가 — 동일 사유(기존 triggers에 '변호사' 단어 없음).
    triggers: ['무역계약 분쟁', '무역 변호사', '수출입 대금 미지급'],
  },
  'lawyer-shipbuilding': {
    label: '변호사(조선)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-shipbuilding', needsMedicalSafety: false,
    parentKey: 'lawyer', // 2026-08-07 신설(의사·변호사 세부분야 대폭확장 배치8, 변호사 배치4)
    triggers: ['선박건조계약 분쟁', '인도지연 대응'],
  },
  'lawyer-arbitration': {
    label: '변호사(중재)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-arbitration', needsMedicalSafety: false,
    parentKey: 'lawyer', // 2026-08-07 신설(의사·변호사 세부분야 대폭확장 배치8, 변호사 배치4)
    triggers: ['상사중재 신청', '중재조항 해석'],
  },
  'lawyer-it': {
    label: '변호사(IT)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-it', needsMedicalSafety: false,
    parentKey: 'lawyer', // 2026-08-07 신설(의사·변호사 세부분야 대폭확장 배치8, 변호사 배치4)
    triggers: ['IT 개발계약 분쟁', '서비스 이용약관 검토'],
  },
  'lawyer-broadcasting': {
    label: '변호사(방송통신)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-broadcasting', needsMedicalSafety: false,
    parentKey: 'lawyer', // 2026-08-07 신설(의사·변호사 세부분야 대폭확장 배치8, 변호사 배치4)
    triggers: ['방송통신 인허가', '방송통신 제재처분'],
  },
  'lawyer-energy': {
    label: '변호사(에너지)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-energy', needsMedicalSafety: false,
    parentKey: 'lawyer', // 2026-08-07 신설(의사·변호사 세부분야 대폭확장 배치8, 변호사 배치4)
    triggers: ['에너지 사업 인허가', 'PPA 계약 분쟁'],
  },
  'lawyer-international-relations': {
    label: '변호사(국제관계법)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-international-relations', needsMedicalSafety: false,
    parentKey: 'lawyer', // 2026-08-07 신설(의사·변호사 세부분야 대폭확장 배치8, 변호사 배치4)
    triggers: ['국제법 자문', '조약 해석'],
  },
  'lawyer-international-transactions': {
    label: '변호사(국제거래)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-international-transactions', needsMedicalSafety: false,
    parentKey: 'lawyer', // 2026-08-07 신설(의사·변호사 세부분야 대폭확장 배치8, 변호사 배치4)
    triggers: ['국제거래계약 검토', '크로스보더 계약 분쟁'],
  },
  'lawyer-international-arbitration': {
    label: '변호사(국제중재)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-international-arbitration', needsMedicalSafety: false,
    parentKey: 'lawyer', // 2026-08-07 신설(의사·변호사 세부분야 대폭확장 배치8, 변호사 배치4)
    triggers: ['국제중재 신청', '외국 중재판정 집행'],
  },
  'lawyer-immigration': {
    label: '변호사(이주 및 비자)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-immigration', needsMedicalSafety: false,
    parentKey: 'lawyer', // 2026-08-07 신설(의사·변호사 세부분야 대폭확장 배치8, 변호사 배치4)
    triggers: ['체류자격 신청', '강제퇴거 대응', '비자 상담'],
  },
  'lawyer-overseas-investment': {
    label: '변호사(해외투자)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-overseas-investment', needsMedicalSafety: false,
    parentKey: 'lawyer', // 2026-08-07 신설(의사·변호사 세부분야 대폭확장 배치8, 변호사 배치4)
    // 2026-09-17 추가 — 동일 사유.
    triggers: ['해외투자 구조 설계', '해외투자 변호사', '해외 M&A 자문'],
  },
  'lawyer-sports': {
    label: '변호사(스포츠)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-sports', needsMedicalSafety: false,
    parentKey: 'lawyer', // 2026-08-07 신설(의사·변호사 세부분야 대폭확장 배치8, 변호사 배치4)
    triggers: ['선수계약 검토', '스포츠 징계 불복'],
  },
  'lawyer-religious': {
    label: '변호사(종교)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-religious', needsMedicalSafety: false,
    parentKey: 'lawyer', // 2026-08-07 신설(의사·변호사 세부분야 대폭확장 배치8, 변호사 배치4)
    // 2026-09-17 추가 — 동일 사유.
    triggers: ['종교단체 재산분쟁', '종교 전문 변호사', '종교단체 내부 징계'],
  },
  'lawyer-guardianship': {
    label: '변호사(성년후견)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-guardianship', needsMedicalSafety: false,
    parentKey: 'lawyer', // 2026-08-07 신설(의사·변호사 세부분야 대폭확장 배치8, 변호사 배치4)
    // 2026-09-17 추가 — 동일 사유.
    triggers: ['성년후견 개시 심판', '성년후견 변호사', '후견인 선임 상담'],
  },
  'lawyer-startup': {
    label: '변호사(스타트업)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-startup', needsMedicalSafety: false,
    parentKey: 'lawyer', // 2026-08-07 신설(의사·변호사 세부분야 대폭확장 배치8, 변호사 배치4)
    triggers: ['투자계약 검토', '스타트업 지분구조 설계'],
  },
  'lawyer-school-violence': {
    label: '변호사(학교폭력)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-school-violence', needsMedicalSafety: false,
    parentKey: 'lawyer', // 2026-08-07 신설(의사·변호사 세부분야 대폭확장 배치8, 변호사 배치4)
    triggers: ['학교폭력 심의 대응', '학폭 처분 불복'],
  },
  'lawyer-legislation': {
    label: '변호사(입법)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-legislation', needsMedicalSafety: false,
    parentKey: 'lawyer', // 2026-08-07 신설(의사·변호사 세부분야 대폭확장 배치8, 변호사 배치4)
    triggers: ['법안 검토 자문', '입법영향평가'],
  },
  'lawyer-entertainment': {
    label: '변호사(엔터테인먼트)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-entertainment', needsMedicalSafety: false,
    parentKey: 'lawyer', // 2026-08-07 신설(의사·변호사 세부분야 대폭확장 배치8, 변호사 배치4)
    // 2026-09-17 추가 — 동일 사유.
    triggers: ['전속계약 검토', '엔터테인먼트 변호사', '연예인 수익배분 분쟁'],
  },
  'lawyer-construction': {
    label: '변호사(건설)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-construction', needsMedicalSafety: false,
    parentKey: 'lawyer', // 2026-08-07 신설(의사·변호사 세부분야 대폭확장 배치8, 변호사 배치4)
    triggers: ['건설공사계약 분쟁', '하자보수 청구', '지체상금 청구'],
  },
  'lawyer-redevelopment': {
    label: '변호사(재개발·재건축)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-redevelopment', needsMedicalSafety: false,
    parentKey: 'lawyer', // 2026-08-07 신설(의사·변호사 세부분야 대폭확장 배치8, 변호사 배치4)
    // 2026-09-17 추가 — 동일 사유.
    triggers: ['재개발 조합 분쟁', '재개발 변호사', '재건축 변호사', '관리처분계획 불복'],
  },
  // 2026-07-06 신설(전문가 페르소나 누락 감사 결과) — 변호사와 다른 자격.
  // 업무범위(등기·경매·소액사건 등) 초과 시 lawyer로 안내하도록 SP 본문에 명시.
};
