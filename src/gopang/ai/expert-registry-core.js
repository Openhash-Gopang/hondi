/**
 * ai/expert-registry-core.js — 나머지 전문가 AI(그 외 EDU/HEALTH/LAW 및 ENG/FIN/기타 카테고리) 레지스트리
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

export const CORE_REGISTRY = {
  'judicial-scrivener': {
    label: '법무사', icon: '📜', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_judicial-scrivener', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 인접쌍(변호사↔법무사) 구분 키워드 그대로 사용 — GWP와 겹치는 게 없어 정책 조정
    // 불필요
    triggers: ['법무사', '등기', '경매', '소액사건'],
  },

  // ── 재무·세무 (SP-FIN-01, 2026-07-04 신설) ────────────
  'tax-accountant': {
    label: '세무사', icon: '🧾', category: 'FIN', ownerAgency: 'ktax',
    key: 'SP_tax-accountant', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 정책 반영 — 예전 '절세' 단독은 kfinance(K-Stock)와 동일 문자열이라
    // 삭제하고 '세무사에게 상담'류 위임의도 구로 교체. 일반적인 절세 문의는 kfinance/ktax가 담당.
    triggers: ['세무사에게 상담', '세무사 자문', '개인 절세 전략',
      // 2026-09-14 추가 — 상황 표현 보강(2026-08-31과 동일 배경).
      // routing_ABmention_live_smoketest.py 실사(암시형)에서 "개인사업자인데
      // 종합소득세를 어떻게 절세할 수 있는지 상담받고 싶어요"가 기존 3개
      // 트리거 어디와도 문자열이 안 겹쳐 ktax로 샌 게 확인됨.
      '절세 방법을 상담', '세금 신고를 도와줄 사람'],
  },
  // 2026-07-06 신설 — 세무사와 다른 자격(회계감사·재무제표 중심). 사고실험
  // #40에서 세무사로 오매핑될 위험이 확인된 항목.
  accountant: {
    // ownerAgency override: FIN 기본값(ktax)이 아니라 kfinance(K-Stock) —
    // 세무사(ktax)와 달리 회계감사·재무제표·기업가치평가·M&A 실사가
    // 중심이라 K-Tax보다 K-Finance 업무 범위에 더 가깝다(2026-07-20).
    label: '공인회계사', icon: '📊', category: 'FIN', ownerAgency: 'kfinance',
    key: 'SP_accountant', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 정책 반영 — 예전 '재무제표'는 kbusiness와 동일 문자열이라 삭제.
    // '회계감사를 의뢰하고 싶어'는 위임의도가 명확해 유지, 뒤에 '검토' 단독 대신 '의뢰'로 구체화
    triggers: ['공인회계사에게 의뢰', '공인회계사 상담', '회계감사를 의뢰',
      // 2026-09-14 추가 — 상황 표현 보강. description이 이미 명시하는
      // "M&A 실사"가 트리거엔 하나도 없어 "회사 인수 전에 상대 회사
      // 재무 상태를 꼼꼼히 실사해줄 사람이 필요해요"가 kbusiness로 샌 게
      // routing_ABmention_live_smoketest.py batch2 재현에서 확인됨.
      '기업 실사를 맡기고', '인수 전 재무 실사'],
  },
  'accountant-audit': {
    label: '공인회계사(외부감사)', icon: '📊', category: 'FIN', ownerAgency: 'kfinance',
    key: 'SP_accountant-audit', needsMedicalSafety: false,
    parentKey: 'accountant', // 2026-08-07 신설(변리사·회계사 세부분야 신설 배치9)
    triggers: ['외부감사 절차 상담', '회계감사 문의'],
  },
  'accountant-valuation': {
    label: '공인회계사(기업가치평가)', icon: '📊', category: 'FIN', ownerAgency: 'kfinance',
    key: 'SP_accountant-valuation', needsMedicalSafety: false,
    parentKey: 'accountant', // 2026-08-07 신설(변리사·회계사 세부분야 신설 배치9)
    triggers: ['기업가치평가 상담', '스톡옵션 행사가 산정'],
  },
  'accountant-internal-control': {
    label: '공인회계사(내부통제·컴플라이언스)', icon: '📊', category: 'FIN', ownerAgency: 'kfinance',
    key: 'SP_accountant-internal-control', needsMedicalSafety: false,
    parentKey: 'accountant', // 2026-08-07 신설(변리사·회계사 세부분야 신설 배치9)
    triggers: ['내부통제 설계 상담', '내부회계관리제도'],
  },
  'accountant-ifrs': {
    label: '공인회계사(IFRS·연결재무제표)', icon: '📊', category: 'FIN', ownerAgency: 'kfinance',
    key: 'SP_accountant-ifrs', needsMedicalSafety: false,
    parentKey: 'accountant', // 2026-08-07 신설(변리사·회계사 세부분야 신설 배치9)
    triggers: ['IFRS 적용 상담', '연결재무제표 작성'],
  },
  'accountant-due-diligence': {
    label: '공인회계사(M&A 실사)', icon: '📊', category: 'FIN', ownerAgency: 'kfinance',
    key: 'SP_accountant-due-diligence', needsMedicalSafety: false,
    parentKey: 'accountant', // 2026-08-07 신설(변리사·회계사 세부분야 신설 배치9)
    triggers: ['M&A 재무실사 상담', 'Due Diligence'],
  },
  'accountant-ipo': {
    label: '공인회계사(IPO·상장자문)', icon: '📊', category: 'FIN', ownerAgency: 'kfinance',
    key: 'SP_accountant-ipo', needsMedicalSafety: false,
    parentKey: 'accountant', // 2026-08-07 신설(변리사·회계사 세부분야 신설 배치9)
    triggers: ['IPO 준비 상담', '상장 재무자문'],
  },
  'accountant-restructuring': {
    label: '공인회계사(구조조정·회생 회계자문)', icon: '📊', category: 'FIN', ownerAgency: 'kfinance',
    key: 'SP_accountant-restructuring', needsMedicalSafety: false,
    parentKey: 'accountant', // 2026-08-07 신설(변리사·회계사 세부분야 신설 배치9)
    triggers: ['구조조정 회계자문', '회생 재무구조 진단'],
  },
  'accountant-forensic': {
    label: '공인회계사(포렌식회계)', icon: '📊', category: 'FIN', ownerAgency: 'kfinance',
    key: 'SP_accountant-forensic', needsMedicalSafety: false,
    parentKey: 'accountant', // 2026-08-07 신설(변리사·회계사 세부분야 신설 배치9)
    triggers: ['포렌식회계 상담', '회계부정 조사'],
  },
  'accountant-nonprofit-public': {
    label: '공인회계사(비영리·공공기관회계)', icon: '📊', category: 'FIN', ownerAgency: 'kfinance',
    key: 'SP_accountant-nonprofit-public', needsMedicalSafety: false,
    parentKey: 'accountant', // 2026-08-07 신설(변리사·회계사 세부분야 신설 배치9)
    triggers: ['비영리법인 회계 상담', '공익법인 결산'],
  },
  // 2026-07-17 신설(전문가 페르소나 누락 감사 후속) — 개별 금융상품 추천은
  // 하지 않음(자본시장법). kbank/kfinance/kinsurance와 격치는 실행
  // 영역은 해당 GWP로 안내.
  'financial-planner': {
    // ownerAgency override: FIN 기본값(ktax)이 아니라 kbank —
    // 개인 자산관리·금융상품 상담이 중심이라 개인 뱅킹 서비스(K-Bank)
    // 소관이 세무(K-Tax)보다 적합하다(2026-07-20).
    label: '재무설계사', icon: '📈', category: 'FIN', ownerAgency: 'kbank',
    key: 'SP_financial-planner', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 99건 사고실험에서 실패 확인된 '내 재무 계획을 수립해 줘'(주피터 원 예시) 직접
    // 커버. GWP와 충돌 없음
    triggers: ['재무설계사', '재무 계획', '은퇴 설계', '노후 준비 계획', '자산관리',
      // 2026-09-14 추가 — 상황 표현 보강. "월급을 어떻게 나눠서 저축하고
      // 투자해야 은퇴 후에도 안정적일지"가 기존 트리거와 안 겹쳐 태그
      // 자체가 안 나온 게 routing_ABmention_live_smoketest.py batch3
      // 재현에서 확인됨(가장 나쁜 결과 — 라우팅 실패가 아니라 완전
      // 무응답).
      '월급을 어떻게 나눠서', '저축과 투자 계획'],
  },

  // ── 법률 (2026-07-17 추가분) ──────────────────────
  // 사고실험 #44/#48/#42에서 확인된 공백. kinsurance·real-estate-agent·lawyer와
  // 각각 자격이 다름 — SP 본문 상단 주석 참조.
  appraiser: {
    label: '감정평가사', icon: '🏷️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_appraiser', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명
    triggers: ['감정평가사', '감정평가', '부동산 가치평가', '자산 가치평가',
      // 2026-09-14 추가 — 상황 표현 보강. "상속받은 땅이 얼마짜리인지
      // 공식적으로 평가받고 싶어요"가 기존 트리거와 안 겹쳐 klaw로 샌 게
      // routing_ABmention_live_smoketest.py 실사에서 확인됨.
      '얼마짜리인지 공식적으로 평가', '가치를 평가받고 싶어'],
  },
  'loss-adjuster': {
    label: '손해사정사', icon: '📋', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_loss-adjuster', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명
    triggers: ['손해사정사', '보험금 산정', '손해사정'],
  },
  'labor-attorney': {
    label: '공인노무사', icon: '👷', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_labor-attorney', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 정책 반영 — 예전 '부당해고·임금체불'은 klaw와 동일 문자열이라 삭제하고
    // '노무사에게 상담'류 위임의도 구로 교체. 일반적인 '부당해고를 당했다'는 계속 klaw(가상판결 시뮬레이션)로 가는 게 맞다.
    triggers: ['공인노무사', '노무사에게 상담', '노무사 자문', '노무 상담'],
  },
  'patent-attorney': {
    label: '변리사', icon: '💡', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_patent-attorney', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명. GWP와 충돌 없음
    triggers: ['변리사', '특허 출원', '상표 등록', '특허출원'],
  },
  'patent-attorney-mechanical-electrical': {
    label: '변리사(기계·전기전자)', icon: '💡', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_patent-attorney-mechanical-electrical', needsMedicalSafety: false,
    parentKey: 'patent-attorney', // 2026-08-07 신설(변리사·회계사 세부분야 신설 배치9)
    triggers: ['기계 전기전자 특허 상담', '회로 발명 출원'],
  },
  'patent-attorney-chemistry-materials': {
    label: '변리사(화학·소재)', icon: '💡', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_patent-attorney-chemistry-materials', needsMedicalSafety: false,
    parentKey: 'patent-attorney', // 2026-08-07 신설(변리사·회계사 세부분야 신설 배치9)
    triggers: ['화학 소재 특허 상담', '조성물 발명 출원'],
  },
  'patent-attorney-bio-pharma': {
    label: '변리사(바이오·제약)', icon: '💡', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_patent-attorney-bio-pharma', needsMedicalSafety: false,
    parentKey: 'patent-attorney', // 2026-08-07 신설(변리사·회계사 세부분야 신설 배치9)
    triggers: ['바이오 제약 특허 상담', '물질특허 출원', '용도발명 출원'],
  },
  'patent-attorney-it-software': {
    label: '변리사(IT·소프트웨어)', icon: '💡', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_patent-attorney-it-software', needsMedicalSafety: false,
    parentKey: 'patent-attorney', // 2026-08-07 신설(변리사·회계사 세부분야 신설 배치9)
    triggers: ['소프트웨어 특허 상담', 'BM특허 출원'],
  },
  'patent-attorney-trademark': {
    label: '변리사(상표)', icon: '💡', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_patent-attorney-trademark', needsMedicalSafety: false,
    parentKey: 'patent-attorney', // 2026-08-07 신설(변리사·회계사 세부분야 신설 배치9)
    triggers: ['상표 출원 상담', '상표 유사조사'],
  },
  'patent-attorney-design': {
    label: '변리사(디자인)', icon: '💡', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_patent-attorney-design', needsMedicalSafety: false,
    parentKey: 'patent-attorney', // 2026-08-07 신설(변리사·회계사 세부분야 신설 배치9)
    triggers: ['디자인 출원 상담', '디자인 유사조사'],
  },
  'patent-attorney-trial-litigation': {
    label: '변리사(심판·심결취소소송)', icon: '💡', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_patent-attorney-trial-litigation', needsMedicalSafety: false,
    parentKey: 'patent-attorney', // 2026-08-07 신설(변리사·회계사 세부분야 신설 배치9)
    triggers: ['특허 무효심판', '거절결정불복심판', '심결취소소송'],
  },
  'patent-attorney-pct-international': {
    label: '변리사(PCT·해외출원)', icon: '💡', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_patent-attorney-pct-international', needsMedicalSafety: false,
    parentKey: 'patent-attorney', // 2026-08-07 신설(변리사·회계사 세부분야 신설 배치9)
    triggers: ['PCT 국제출원 상담', '해외 특허출원 전략'],
  },
  'patent-attorney-ip-strategy': {
    label: '변리사(IP전략·특허맵)', icon: '💡', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_patent-attorney-ip-strategy', needsMedicalSafety: false,
    parentKey: 'patent-attorney', // 2026-08-07 신설(변리사·회계사 세부분야 신설 배치9)
    triggers: ['특허맵 분석', 'FTO 조사', 'IP전략 자문'],
  },
  'patent-attorney-licensing': {
    label: '변리사(라이선싱·기술이전계약)', icon: '💡', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_patent-attorney-licensing', needsMedicalSafety: false,
    parentKey: 'patent-attorney', // 2026-08-07 신설(변리사·회계사 세부분야 신설 배치9)
    triggers: ['특허 라이선싱 상담', '기술이전계약 검토'],
  },
  'customs-broker': {
    label: '관세사', icon: '🛃', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_customs-broker', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명
    triggers: ['관세사', '수입 통관', '수출 통관', '관세사에게',
      // 2026-08-31 추가 — 직업명 없는 상황 표현 보강(SP 전수 커버리지
      // 테스트에서 0단계 로컬 매칭이 이 항목을 아예 못 찾는 게 확인됨,
      // candidate-prefilter.js 참고)
      '통관 절차를 대신', '관세 신고를 대행', '통관 절차',
      // 2026-09-14 추가 — 같은 배경. "관세 신고를 어떻게 해야 할지
      // 도와줄 사람이 필요해요"가 기존 문구들과 문자열이 안 겹쳐 klaw로
      // 샌 게 routing_ABmention_live_smoketest.py 실사에서 확인됨.
      '관세 신고를 어떻게', '수입하려는데 관세'],
  },

  // ── 의료·보건 (SP-HEALTH-06~15) ──────────────────────
  // 2026-07-06 신설(SP-HEALTH-16~19) — 의사·치과의사·한의사·약사. 다른 10개
  // 의료직이 전부 "확진·처방은 의사 영역"이라고 선을 긋는 구조라, 그 반대편을
  // 정의하는 이 4개는 특히 신중한 검토가 필요함(SP 본문 상단 주석 참조).
  dentist: {
    label: '치과의사', icon: '🦷', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_dentist', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명. GWP와 충돌 없음
    triggers: ['치과의사', '치과 진료', '충치', '임플란트'],
  },
  'traditional-medicine-doctor': {
    label: '한의사', icon: '🌿', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_traditional-medicine-doctor', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명
    triggers: ['한의사', '한방 진료', '침 치료', '한약'],
  },
  pharmacist: {
    label: '약사', icon: '💊', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_pharmacist', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명. khealth의 '처방'과 일부 겹치나 '조제'는 약사 고유 업무라
    // 유지
    triggers: ['약사', '약 조제', '처방약 문의'],
  },
  veterinarian: {
    label: '수의사', icon: '🐾', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_veterinarian', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명
    triggers: ['수의사', '반려동물 진료', '동물병원'],
  },
  nurse: {
    label: '간호사', icon: '👩‍⚕️', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_nurse', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 인접쌍(전문간호사↔간호사) — 일반 업무 범위만
    triggers: ['간호사', '간호 상담',
      // 2026-08-31 추가 — 상황 표현 보강(위와 동일 배경)
      '상처 소독', '수술 후 관리 안내'],
  },
  'physical-therapist': {
    label: '물리치료사', icon: '💪', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_physical-therapist', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 인접쌍(물리치료사↔작업치료사) 구분 키워드 — '운동' 중심
    triggers: ['물리치료사', '물리치료', '운동 재활'],
  },
  'medical-lab-technologist': {
    label: '임상병리사', icon: '🔬', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_medical-lab-technologist', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 인접쌍(방사선사↔임상병리사) 구분 — 검체·혈액 중심
    triggers: ['임상병리사', '혈액검사', '검체검사'],
  },
  'radiologic-technologist': {
    label: '방사선사', icon: '📡', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_radiologic-technologist', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 인접쌍 구분 — 영상촬영 중심
    triggers: ['방사선사', '엑스레이', 'CT 촬영', '방사선 촬영'],
  },
  'dental-hygienist': {
    label: '치과위생사', icon: '🦷', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_dental-hygienist', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 인접쌍(치과기공사↔치과위생사) 구분 키워드 그대로 — '잇몸·스케일링'
    triggers: ['치과위생사', '스케일링', '잇몸 관리'],
  },
  'occupational-therapist': {
    label: '작업치료사', icon: '🧠', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_occupational-therapist', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 인접쌍 구분 키워드 — '일상생활 동작'
    triggers: ['작업치료사', '일상생활 동작 훈련', '작업치료'],
  },
  'dental-technician': {
    label: '치과기공사', icon: '🦷', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_dental-technician', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 인접쌍 구분 키워드 그대로 — '보철·틀니'
    triggers: ['치과기공사', '보철 제작', '틀니 제작'],
  },
  'advanced-practice-nurse': {
    label: '전문간호사', icon: '💉', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_advanced-practice-nurse', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 인접쌍 — 일반 간호사와 구분되는 '전문' 명시적 언급이 있을 때만
    triggers: ['전문간호사', '전문 간호'],
  },
  dietitian: {
    label: '영양사', icon: '🥗', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_dietitian', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 99건 사고실험 D범주('한달 간 식단을 작성해 줘', 주피터 원 예시) 직접 커버
    triggers: ['영양사', '식단 상담', '식단 작성', '영양 상담'],
  },
  // 2026-07-17 신설(사고실험 #50) — kemergency(GWP, 실제 R0 신고·출동 연계)와
  // 이름이 격치므로 SP 본문 상단에 역할 분리를 명시. 이 페르소나는 평시
  // 교육용이며, 실제 응급 신호 감지 시 R0이 최우선 적용되어 이 페르소나
  // 세션 여부와 무관하게 kemergency 트리거로 전환된다.
  paramedic: {
    label: '응급구조사', icon: '🚑', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_paramedic', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명. 실제 응급상황은 kemergency(119)가 우선 — 이
    // 페르소나는 사전 상담용으로 한정
    triggers: ['응급구조사', '응급처치',
      // 2026-08-31 추가 — 상황 표현 보강(위와 동일 배경)
      '행사장 응급 대응 인력', '현장 응급상황 대비', '현장 대응 인력'],
  },
  midwife: {
    label: '조산사', icon: '🤱', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_midwife', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명
    triggers: ['조산사', '출산 조력', '분만 지원'],
  },
  'speech-language-pathologist': {
    label: '언어재활사', icon: '🗣️', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_speech-language-pathologist', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명
    triggers: ['언어재활사', '언어재활', '발음 교정'],
  },
  optician: {
    label: '안경사', icon: '👓', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_optician', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 99건 사고실험 I범주('안경을 맞추고 싶어') 직접 커버
    triggers: ['안경사', '안경을 맞추고 싶어', '시력 측정'],
  },
  sanitarian: {
    label: '위생사', icon: '🧼', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_sanitarian', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명
    // 2026-08-11 추가 — 실행형("관할 보건소 찾아줘") 트리거 보강. §STEP R 신설과
    // 짝(market kmarket_admin_dashboard.html 위생점검 탭 안내).
    triggers: ['위생사', '위생 점검', '식품위생', '위생점검 일정', '위생점검 신청', '관할 보건소'],
  },
  'health-educator': {
    label: '보건교육사', icon: '📢', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_health-educator', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 직업명 위주 — 실사용 빈도 낮을 것으로 예상, 최소 트리거
    triggers: ['보건교육사', '보건교육'],
  },

  // ── 교육·상담·문화 (SP-EDU-01~06) ────────────────────
  teacher: {
    label: '교사(정교사)', icon: '👩‍🏫', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_teacher', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — '과외 선생님'은 안 넣음 — teacher는 학교 정교사이지 사교육 과외교사가
    // 아니다(99건 사고실험에서 확인된 진짜 공백, 트리거로 못 메움)
    triggers: ['정교사', '학교 선생님', '담임'],
  },
  // ── professor 정식 등록 (2026-07-26 결정) ──────────────────
  // 배경: 옛 school 저장소(K-School 브랜드) desktop.html의 "유치원부터
  // 대학원까지 전 과목을 가르치는 나만의 전담 AI 교수" 컨셉을, 60개
  // 페르소나 전부가 따르는 "실제 자격 기반 자문·지도" 원칙에 맞춰 이
  // registry에 정식 등록한다(위 TODO에서 논의된 두 방향 중 (1) 선택).
  // K-Doctor(health/prompts/doctor.md)의 구조를 참고해 SP_professor를
  // 작성했다 — 단, K-Doctor와 달리 학습자와 직접 대화하는 서비스로
  // 설계했다(2026-07-26 확정). 세션 데이터는 동의 하에 K-School의 이중
  // PDV 소스 중 두 번째 소스(교수 페르소나 실제 평가)로 집계에 쓰일 수
  // 있다 — school/docs/K_SCHOOL_PUBLIC_EDUCATION_DATA_SYSTEM_v1_0.md §2.2 참고.
  // ── civil(K-Civil) 폐기 (2026-08-05) ──────────────────────────
  // G18(STAFF_REVIEW_GATE) 스키마 원안이 이미 "summary는 기관 SP가
  // 채운다"고 정해뒀던 것과 SP_civil의 별도 EXPERT 페르소나 구조가
  // 어긋난다는 것을 재확인 — SP-10_kpublic(kgov) STEP D 상세(v3.14,
  // "예비 의견 형성")로 흡수하고 이 엔트리는 제거했다. 상세 경위는
  // prompts/DEPRECATED_SP_civil.txt 참조.
  // ── advisor 정식 등록 (2026-07-26 결정) ─────────────────────
  // K-Professor와 같은 구조(법령상 최종승인 강제 없음 — PROFESSIONAL-
  // common_v2_0.md Q2 기준) — 구매자와 직접 대화하며 가격공정성·구매
  // 필요성을 평가해 직접 조언한다. K-Market(SP-KMARKET, 라이브 —
  // 검색·비교·중개만 담당)이 안 하는 평가 기능을 새로 맡는다.
  // ⚠️ 가격비교용 실제 시장데이터 파이프라인 미구현 — prompts/
  // SP_advisor_v1_0.md §5 정직 고지 참고.
  advisor: {
    label: '구매자문(K-Advisor)', icon: '🔍', category: 'FIN', ownerAgency: 'kcommerce',
    key: 'SP_advisor', needsMedicalSafety: false,
    triggers: ['가격 적정성', '이거 사도 될까', '가격 비교 평가', 'K-Advisor'],
  },
  'clinical-psychologist': {
    label: '임상심리사', icon: '🧑‍⚕️', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_clinical-psychologist', needsMedicalSafety: true, // 2026-07-04: 위기개입(M5) 상속 위해 true로 수정
    // 2026-07-25 신설(주피터 지시) — 인접쌍(임상심리사↔전문상담교사↔정신건강전문요원) — '심리검사'는 임상심리사 고유 업무.
    // '심리상담사'(통칭, 정식 자격명 아님)는 세 페르소나 모두에 동일하게 추가한다(2026-07-25 재검토) —
    // 어느 한쪽에만 넣으면 그쪽이 부당하게 우선권을 갖게 되고, 원래 이 통칭은 셋 중 무엇을 뜻하는지
    // 불분명해서 AGENT-COMMON의 기존 원칙("인접 쌍이 안 갈리면 확신도 게이트가 '아니오' — 되묻는다")이
    // 작동해야 하는 사례다. 세 곳 다 넣으면 셋 다 후보로 뜨면서 그 되묻기가 자연히 발동한다.
    triggers: ['임상심리사', '심리검사', '심리상담사'],
  },
  'school-counselor': {
    label: '전문상담교사', icon: '🛋️', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_school-counselor', needsMedicalSafety: true, // 2026-07-04: 상동
    // 2026-07-25 신설(주피터 지시) — 인접쌍 구분 — '학교' 맥락. 99건 사고실험 I범주('학교폭력 상담') 커버.
    // '심리상담사'는 clinical-psychologist와 동일 이유로 추가(위 주석 참고).
    triggers: ['전문상담교사', '학교 상담', '학교폭력 상담', '심리상담사'],
  },
  'mental-health-professional': {
    label: '정신건강전문요원', icon: '💬', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_mental-health-professional', needsMedicalSafety: true, // 2026-07-04: 상동
    // 2026-07-25 신설(주피터 지시) — 인접쌍(정신건강전문요원↔사회복지사) 구분 키워드 그대로 — '정신건강 재활'.
    // '심리상담사'는 clinical-psychologist와 동일 이유로 추가(위 주석 참고).
    triggers: ['정신건강전문요원', '정신건강 재활', '심리상담사',
      // 2026-09-14 추가 — 상황 표현 보강. "가족이 정신질환으로 치료를
      // 받고 있는데 지역사회에서 어떤 지원을 받을 수 있는지"가 기존
      // 트리거와 안 겹쳐 khealth로 샌 게 routing_ABmention_live_
      // smoketest.py batch2 재현에서 확인됨(social-worker의 2026-08-31
      // "형편이 어려워졌는데"와 동일 계열 보강).
      '가족이 정신질환', '지역사회에서 받을 수 있는 지원'],
  },
  // 2026-07-06 신설(SP-EDU-04) — 상담직 3개와 마찬가지로 위기개입 프로토콜(M5)
  // 상속 위해 needsMedicalSafety:true. category는 EDU 유지(복지 상담이 의료
  // 행위는 아니지만, 위기 신호 대응 원칙은 동일하게 필요).
  'social-worker': {
    label: '사회복지사', icon: '🤝', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_social-worker', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 인접쌍 구분 키워드 그대로 — '복지제도·자원연계'. 지역행정 welfare 도메인과는
    // 별개(사회복지사는 개인 상담 전문가)
    triggers: ['사회복지사', '복지제도 상담', '자원연계',
      // 2026-08-31 추가 — 상황 표현 보강(위와 동일 배경)
      '복지 제도를 연계', '형편이 어려워졌는데',
      // 2026-09-14 추가 — 같은 배경. "혼자 사시는 부모님이 받을 수 있는
      // 복지 혜택이 있는지 알아보고 싶어요"가 기존 문구들과 문자열이
      // 안 겹쳐 kgov로 샌 게 routing_ABmention_live_smoketest.py 실사에서
      // 확인됨.
      '받을 수 있는 복지 혜택', '복지 혜택이 있는지'],
  },
  curator: {
    label: '학예사(큐레이터)', icon: '🎨', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_curator', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 99건 사고실험 I범주('박물관 학예사 상담') 커버
    triggers: ['학예사', '큐레이터', '전시 상담',
      // 2026-08-31 추가 — 상황 표현 보강(위와 동일 배경)
      '전시회 작품 설명', '작품 해설', '전시회 작품'],
  },
  librarian: {
    label: '사서', icon: '📖', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_librarian', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 직업명 위주
    triggers: ['사서', '도서관 상담', '장서 문의'],
  },
  'youth-counselor': {
    label: '청소년상담사', icon: '🧑‍🤝‍🧑', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_youth-counselor', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명
    triggers: ['청소년상담사', '청소년 상담'],
  },
  'childcare-teacher': {
    label: '보육교사', icon: '🧸', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_childcare-teacher', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 직업명 위주
    triggers: ['보육교사', '보육 상담',
      // 2026-08-31 추가 — 상황 표현 보강(위와 동일 배경)
      '어린이집 담당 선생님', '아이 발달 상담'],
  },
  'lifelong-educator': {
    label: '평생교육사', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_lifelong-educator', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명
    triggers: ['평생교육사', '평생교육', '평생학습'],
  },

  // ── 공학·건설·해사 (SP-ENG-01~09) ────────────────────
  architect: {
    label: '건축사', icon: '🏗️', category: 'ENG', ownerAgency: 'gopang',
    key: 'SP_architect', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 인접쌍(건축사↔기술사) 구분 키워드 그대로 — '신축·설계'
    triggers: ['건축사', '건축 설계', '신축 설계'],
  },
  'professional-engineer': {
    label: '기술사', icon: '📐', category: 'ENG', ownerAgency: 'gopang',
    key: 'SP_professional-engineer', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 인접쌍 구분 키워드 그대로 — '안전점검·안전진단'(기존 구조물)
    triggers: ['기술사', '안전점검', '구조 안전진단'],
  },
  'marine-pilot': {
    label: '도선사', icon: '⚓', category: 'ENG', ownerAgency: 'gopang',
    key: 'SP_marine-pilot', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 인접쌍(항해사↔도선사) — '도선' 고유 업무만
    triggers: ['도선사', '도선'],
  },
  'naval-architect': {
    label: '조선사', icon: '🚢', category: 'ENG', ownerAgency: 'gopang',
    key: 'SP_naval-architect', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 인접쌍(기관사↔조선사) 구분 키워드 그대로 — '건조·설계 단계'
    triggers: ['조선사', '선박 설계', '선박 건조'],
  },
  'navigation-officer': {
    label: '항해사', icon: '🧭', category: 'ENG', ownerAgency: 'gopang',
    key: 'SP_navigation-officer', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 인접쌍(항해사↔도선사) — '운항' 고유 업무만
    triggers: ['항해사', '항해', '선박 운항',
      // 2026-09-14 추가 — 상황 표현 보강. "제주에서 일본까지 배로 가는
      // 항로를 실제로 짜줄 사람이 필요해요"가 기존 트리거와 안 겹쳐
      // klogistics로 샌 게 routing_ABmention_live_smoketest.py batch3
      // 재현에서 확인됨.
      '항로를 짜', '뱃길을 안내'],
  },
  'marine-engineer': {
    label: '기관사(선박)', icon: '⚙️', category: 'ENG', ownerAgency: 'gopang',
    key: 'SP_marine-engineer', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 인접쌍(기관사↔조선사) 구분 키워드 그대로 — '운항 중 고장'
    triggers: ['기관사', '선박 고장', '선박 엔진'],
  },
  'industrial-safety-consultant': {
    label: '산업안전·보건지도사', icon: '🦺', category: 'ENG', ownerAgency: 'gopang',
    key: 'SP_industrial-safety-consultant', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명
    triggers: ['산업안전·보건지도사', '산업안전 컨설팅', '공장 안전점검'],
  },
  'weather-forecaster': {
    label: '기상예보사', icon: '🌤️', category: 'ENG', ownerAgency: 'gopang',
    key: 'SP_weather-forecaster', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — khealth GWP의 '기상청' 도메인과는 별개(민간 자문 페르소나) — 실사용 빈도
    // 낮을 것
    triggers: ['기상예보사', '기상 예보 상담',
      // 2026-09-14 추가 — 상황 표현 보강. "주말에 배를 띄워도 될 만큼
      // 바다 날씨가 괜찮을지 판단해줄 사람이 필요해요"가 기존 트리거와
      // 안 겹쳐 marine-pilot으로 샌 게 routing_ABmention_live_
      // smoketest.py batch3 재현에서 확인됨.
      '바다 날씨가 괜찮을지', '출항 가능한 날씨인지'],
  },
  'fire-safety-manager': {
    label: '소방시설관리사', icon: '🧯', category: 'ENG', ownerAgency: 'gopang',
    key: 'SP_fire-safety-manager', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명
    triggers: ['소방시설관리사', '소방 점검', '소방시설 점검'],
  },
  'landscape-engineer': {
    label: '조경기술사', icon: '🌳', category: 'ENG', ownerAgency: 'gopang',
    key: 'SP_landscape-engineer', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 99건 사고실험 A범주('조경 설계를 의뢰') 직접 커버
    triggers: ['조경기술사', '조경 설계', '정원 설계',
      // 2026-09-14 추가 — 상황 표현 보강. "마당에 어떤 나무랑 식물을
      // 배치하면 좋을지 설계해줄 사람이 필요해요"가 기존 트리거와 안
      // 겹쳐 kcommerce로 샌 게 routing_ABmention_live_smoketest.py
      // batch4 재현에서 확인됨.
      '마당에 나무를 심', '식물을 배치'],
  },
  'surveying-engineer': {
    label: '측량 및 지형공간정보기술사', icon: '📐', category: 'ENG', ownerAgency: 'gopang',
    key: 'SP_surveying-engineer', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명
    triggers: ['측량 및 지형공간정보기술사', '측량', '지적측량',
      // 2026-09-14 추가 — 상황 표현 보강. "옆집이랑 땅 경계가 애매한데
      // 정확한 경계선을 재줄 사람이 필요해요"가 기존 트리거와 안 겹쳐
      // kregionalgov로 샌 게 routing_ABmention_live_smoketest.py
      // batch4 재현에서 확인됨.
      '땅 경계선을 재', '경계가 애매한데'],
  },
  'electrical-safety-engineer': {
    label: '전기안전기술사', icon: '⚡', category: 'ENG', ownerAgency: 'gopang',
    key: 'SP_electrical-safety-engineer', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명
    triggers: ['전기안전기술사', '전기안전 점검'],
  },
  'gas-safety-engineer': {
    label: '가스기술사', icon: '🔥', category: 'ENG', ownerAgency: 'gopang',
    key: 'SP_gas-safety-engineer', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명
    triggers: ['가스기술사', '가스안전 점검',
      // 2026-08-31 추가 — 상황 표현 보강(위와 동일 배경)
      '주방 가스 설비 점검', '가스 설비 안전',
      // 2026-09-14 추가 — 같은 배경. "가스 배관에서 냄새가 나는 것
      // 같은데 점검해줄 사람이 필요해요"가 기존 문구들과 정확히 안
      // 겹쳐(느낌은 같지만 문자열이 다름) kcommerce로 샌 게
      // routing_ABmention_live_smoketest.py batch3 재현에서 확인됨.
      '가스 배관에서 냄새', '가스 냄새가 나는데'],
  },

  // ── 부동산 (SP-RE-01, 2026-07-06 신설) ────────────────
  // 2026-07-06 이전엔 이 카테고리 자체가 없었음 — 전문가 페르소나 누락
  // 감사에서 확인된 가장 큰 신규 카테고리 공백.
  'real-estate-agent': {
    label: '공인중개사', icon: '🏠', category: 'REAL_ESTATE', ownerAgency: 'kestate',
    key: 'SP_real-estate-agent', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 정책 반영 — 예전 '공인중개사·매매 매물'은 kestate와 동일 문자열이라 삭제.
    // kestate가 '탐색·등록·중개연결'을 이미 폭넓게 담당하므로, 이 페르소나는 '중개 계약 체결 자체를 이 사람에게 직접
    // 맡기겠다'는 명확한 위임의도 구만 남긴다.
    triggers: ['공인중개사에게 직접 의뢰', '중개 계약 체결', '임대차 중개',
      // 2026-09-14 추가 — 상황 표현 보강(2026-08-31 customs-broker/
      // social-worker와 동일 배경). "전세 계약을 하려는데 이 매물이
      // 안전한지 봐줄 사람이 필요해요"가 기존 위임의도 구와 안 겹쳐
      // kestate로 샌 게 routing_ABmention_live_smoketest.py 실사에서
      // 확인됨.
      '매물이 안전한지', '계약 전에 확인해 줄 사람'],
  },

  'security-engineer': {
    label: '정보보안전문가', icon: '🔒', category: 'IT', ownerAgency: 'ksecurity',
    key: 'SP_security-engineer', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — ksecurity GWP(내부 운영자용으로 추정)와 역할이 다를 수 있음 — 이
    // 페르소나는 일반 사용자 상담용, 트리거 충돌 없음
    triggers: ['정보보안전문가', '개인정보 침해', '해킹 피해'],
  },
  'translator-interpreter': {
    label: '통역사·번역사', icon: '🌐', category: 'TRANSLATION', ownerAgency: 'gopang',
    key: 'SP_translator-interpreter', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 99건 사고실험 I범주('여행 통역사를 구해줘') 커버
    triggers: ['통역사', '번역사', '여행 통역사', '번역 의뢰'],
  },
  'tour-guide': {
    label: '관광통역안내사', icon: '🗺️', category: 'TOURISM', ownerAgency: 'gopang',
    key: 'SP_tour-guide', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명
    triggers: ['관광통역안내사', '여행 가이드', '관광 안내',
      // 2026-08-31 추가 — 상황 표현 보강(위와 동일 배경)
      '외국인 친구 관광 안내', '서울 구경을 안내'],
  },
  'sports-instructor': {
    label: '생활스포츠지도사', icon: '🏃', category: 'SPORTS', ownerAgency: 'gopang',
    key: 'SP_sports-instructor', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 99건 사고실험 I범주('스포츠 지도사와 상담') 커버
    triggers: ['생활스포츠지도사', '스포츠 지도', '운동 코칭'],
  },
  hairdresser: {
    label: '미용사', icon: '💇', category: 'BEAUTY', ownerAgency: 'gopang',
    key: 'SP_hairdresser', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — kcommerce GWP의 '미용실 예약'과는 역할이 다름(예약=kcommerce,
    // 전문 상담=이 페르소나)
    triggers: ['미용사', '헤어 상담'],
  },
  chef: {
    label: '조리사', icon: '👨‍🍳', category: 'CULINARY', ownerAgency: 'gopang',
    key: 'SP_chef', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명. kcommerce의 '음식 주문'과는 무관(조리사 자문 전용)
    triggers: ['조리사', '요리 상담', '메뉴 개발'],
  },
  'hondi-guide': {
    label: '혼디 SP', icon: '📘', category: 'PLATFORM', ownerAgency: 'gopang',
    key: 'SP_hondi-guide', needsMedicalSafety: false,
    // 2026-08-31 신설(주피터 지시) — 혼디 자체(철학·K-서비스·GDC·PDV·Openhash·
    // 요금·이용법)를 다루는 안내 전문가. domain-taxonomy.js의 'onboarding'
    // 도메인(PLATFORM 카테고리)에 속해 패러프레이즈 도메인 분류 후보에는
    // 안 들어간다 — 아래 리터럴 트리거로만 직접 호출된다(prompts/
    // SP_hondi-guide_v1_0.md 참조).
    // 2026-08-31 수정 — 라이브 스모크테스트(#3)에서 'GDC 충전 방법'
    // 트리거가 실제 GDC 충전 실행 GWP(kgdc)와 겹쳐 [GWP: kgdc]로
    // 정상 이탈하는 걸 확인. 실행 요청이 아니라 개념 설명으로 트리거
    // 재정의('GDC가 뭐예요') — kgdc와의 경계를 명확히 함.
    triggers: ['혼디가 뭐예요', '혼디는 뭐하는 서비스', '혼디 사용법', '혼디 이용 방법',
      'K-서비스가 몇 개', '혼디 요금 체계', 'GDC가 뭐예요', 'PDV가 뭐예요',
      'Openhash가 뭐예요', '혼디 SP', '혼디 버그 신고', '혼디 기능 제안', '혼디 개발 참여',
      '혼디 개발자가 누구', '혼디 만든 사람'],
  },
};
