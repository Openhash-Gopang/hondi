/**
 * ai/expert-registry-professor.js — 교수(professor) 세부분야 전용 레지스트리
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

export const PROFESSOR_REGISTRY = {
  professor: {
    label: '교수(1:1 맞춤교육)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor', needsMedicalSafety: false,
    // '과외 선생님'을 의도적으로 제외했던 teacher 항목과 달리, professor는
    // 바로 그 1:1 개인 맞춤 교육 역할을 정식으로 담당한다 — teacher(학교
    // 정교사, 생활지도 관점)와는 범위가 다르다.
    triggers: ['1:1 교습', '개인 교사', '맞춤 교육', 'AI 교수', '과외'],
  },
  'professor-semiconductor': {
    label: '교수(반도체공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-semiconductor', needsMedicalSafety: false,
    // 2026-08-08 배치5: professor 직속 → 재료(18) 중계열로 재소속
    // (배치1 시점부터 예고했던 마이그레이션 — 정부 표준분류체계상
    // 반도체공학(093)은 D-18 재료 소속. economics의 경영·경제
    // 중계열 재소속(배치2)과 동일 패턴으로 이번에 정리 완료)
    parentKey: 'professor-materials-series',
    triggers: ['반도체공학 지도', '반도체 교수'],
  },
  // ── 중계열(2단, professor의 자식이자 소계열의 부모) — 2026-08-08
  // 신설(표준분류체계 3단 계층화 배치1, N단 재귀 조립 §6-4 개정 첫
  // 실사용). 공공데이터포털 「한국대학교육협의회_대학 학과 정보」API
  // 원문(2025년) 기준 대계열/중계열/소계열 코드를 그대로 따른다.
  'professor-language-literature': {
    label: '교수(언어·문학 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-language-literature', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [], // 중계열 자체는 직접 호출 대상 아님 — 소계열이 리프
  },
  'professor-humanities': {
    label: '교수(인문학 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-humanities', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-socialscience': {
    label: '교수(사회과학 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-socialscience', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-chembio': {
    label: '교수(화학·생명과학·환경 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-chembio', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-mathphys': {
    label: '교수(수학·물리·천문·지구 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-mathphys', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  // ── 경영·경제(03)/법학(04) 중계열은 배치1 범위 밖이라 아직 신설
  // 안 함 — 그래서 law/economics는 잠정적으로 professor 직속 유지
  // (배치에서 경영·경제/법학 중계열을 만들 때 재소속 예정).
  'professor-law': {
    label: '교수(법학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-law', needsMedicalSafety: false,
    parentKey: 'professor-law-series', // 2026-08-10 Tier1 확장 재소속(구 부모: professor), // 법학(04) 중계열 아직 미신설 — professor 직속 유지(배치2 범위 밖)
    triggers: ['법학 지도', '법학 교수', '로스쿨 지도'],
  },
  // ── 중계열(2단) 배치2 신설 4개 ─────────────────────────────
  'professor-business-economics': {
    label: '교수(경영·경제 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-business-economics', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-electrical-computer': {
    label: '교수(전기·전자·컴퓨터 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-electrical-computer', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-mechanical': {
    label: '교수(기계 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-mechanical', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-construction': {
    label: '교수(건설 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-construction', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-economics': {
    label: '교수(경제학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-economics', needsMedicalSafety: false,
    // 2026-08-08 배치2: professor 직속 → 경영·경제(03) 중계열로 재소속
    // (배치1 커밋 메시지에서 예고했던 마이그레이션, 이번에 처리)
    parentKey: 'professor-economics-series', // 2026-08-10 Tier1 확장 재소속(구 부모: professor-business-economics),
    triggers: ['경제학 지도', '경제학 교수'],
  },
  // ── 소계열(3단, 리프) — 배치1: 수능 5개 교과(국어/수학/영어/한국사/
  // 탐구) 대응 핵심 13개. 표준분류체계 코드는 각 SP 파일 헤더 참고.
  'professor-korean': {
    label: '교수(국어·국문학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-korean', needsMedicalSafety: false,
    parentKey: 'professor-language-literature',
    triggers: ['국어 지도', '국문학 지도', '국어 교수'],
  },
  'professor-english': {
    label: '교수(영어·영문학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-english', needsMedicalSafety: false,
    parentKey: 'professor-language-literature',
    triggers: ['영어 지도', '영문학 지도', '영어 교수', '토플 지도', '아이엘츠 지도'],
  },
  'professor-history': {
    label: '교수(역사·고고학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-history', needsMedicalSafety: false,
    parentKey: 'professor-history-series', // 2026-08-10 Tier1 확장 재소속(구 부모: professor-humanities),
    triggers: ['한국사 지도', '세계사 지도', '역사 교수', '고고학 지도'],
  },
  'professor-ethics': {
    label: '교수(철학·윤리학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-ethics', needsMedicalSafety: false,
    parentKey: 'professor-ethics-series', // 2026-08-10 Tier1 확장 재소속(구 부모: professor-humanities),
    triggers: ['철학 지도', '윤리 지도', '생활과 윤리 지도', '윤리와 사상 지도'],
  },
  'professor-politics': {
    label: '교수(정치외교학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-politics', needsMedicalSafety: false,
    parentKey: 'professor-politics-series', // 2026-08-10 Tier1 확장 재소속(구 부모: professor-socialscience),
    triggers: ['정치와 법 지도', '정치외교학 지도', '국제관계 지도'],
  },
  'professor-sociology': {
    label: '교수(사회학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-sociology', needsMedicalSafety: false,
    parentKey: 'professor-sociology-series', // 2026-08-10 Tier1 확장 재소속(구 부모: professor-socialscience),
    triggers: ['사회문화 지도', '사회학 지도'],
  },
  'professor-geography': {
    label: '교수(도시·지역·지리학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-geography', needsMedicalSafety: false,
    parentKey: 'professor-geography-series', // 2026-08-10 Tier2/§4 확장 재소속(구 부모: professor-socialscience),
    triggers: ['한국지리 지도', '세계지리 지도', '지리학 지도', '도시지리 지도'],
  },
  'professor-physics': {
    label: '교수(물리학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-physics', needsMedicalSafety: false,
    parentKey: 'professor-physics-series', // 2026-08-10 Tier1 확장 재소속(구 부모: professor-mathphys),
    triggers: ['물리학 지도', '물리 교수'],
  },
  'professor-chemistry': {
    label: '교수(화학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-chemistry', needsMedicalSafety: false,
    parentKey: 'professor-chemistry-series', // 2026-08-10 Tier1 확장 재소속(구 부모: professor-chembio),
    triggers: ['화학 지도', '화학 교수'],
  },
  'professor-biology': {
    label: '교수(생명과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-biology', needsMedicalSafety: false,
    parentKey: 'professor-biology-series', // 2026-08-10 Tier1 확장 재소속(구 부모: professor-chembio),
    triggers: ['생명과학 지도', '생물 교수'],
  },
  'professor-earthscience': {
    label: '교수(지구·지질학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-earthscience', needsMedicalSafety: false,
    parentKey: 'professor-mathphys',
    triggers: ['지구과학 지도', '지질학 지도'],
  },
  'professor-math': {
    label: '교수(수학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-math', needsMedicalSafety: false,
    parentKey: 'professor-math-series', // 2026-08-10 Tier1 확장 재소속(구 부모: professor-mathphys),
    triggers: ['수학 지도', '수학 교수'],
  },
  'professor-statistics': {
    label: '교수(통계학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-statistics', needsMedicalSafety: false,
    parentKey: 'professor-statistics-series', // 2026-08-10 Tier2/§4 확장 재소속(구 부모: professor-mathphys),
    triggers: ['통계학 지도', '확률과 통계 지도'],
  },
  // ── 소계열(3단, 리프) 배치2: 인기 전공 12개 ──────────────────
  'professor-business': {
    label: '교수(경영학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-business', needsMedicalSafety: false,
    parentKey: 'professor-business-series', // 2026-08-10 Tier1 확장 재소속(구 부모: professor-business-economics),
    triggers: ['경영학 지도', '경영학 교수', 'MBA 지도'],
  },
  'professor-mis': {
    label: '교수(경영정보학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-mis', needsMedicalSafety: false,
    parentKey: 'professor-business-economics',
    triggers: ['경영정보학 지도', 'MIS 지도'],
  },
  'professor-accounting': {
    label: '교수(회계·세무학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-accounting', needsMedicalSafety: false,
    parentKey: 'professor-business-economics',
    triggers: ['회계학 지도', '세무학 지도', '회계사 시험 지도'],
  },
  'professor-psychology': {
    label: '교수(심리학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-psychology', needsMedicalSafety: false,
    parentKey: 'professor-psychology-series', // 2026-08-10 Tier1 확장 재소속(구 부모: professor-socialscience),
    triggers: ['심리학 지도', '심리학 교수'],
  },
  'professor-international': {
    label: '교수(국제학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-international', needsMedicalSafety: false,
    parentKey: 'professor-socialscience',
    triggers: ['국제학 지도', '국제기구 지도', '지역학 지도'],
  },
  'professor-computerscience': {
    label: '교수(전산학·컴퓨터공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-computerscience', needsMedicalSafety: false,
    parentKey: 'professor-computerscience-series', // 2026-08-10 Tier1 확장 재소속(구 부모: professor-electrical-computer),
    triggers: ['컴퓨터공학 지도', '전산학 지도', '알고리즘 지도', '코딩테스트 지도'],
  },
  'professor-software': {
    label: '교수(응용소프트웨어공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-software', needsMedicalSafety: false,
    parentKey: 'professor-electrical-computer',
    triggers: ['소프트웨어공학 지도', '소프트웨어 아키텍처 지도'],
  },
  'professor-ai-engineering': {
    label: '교수(인공지능공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-ai-engineering', needsMedicalSafety: false,
    parentKey: 'professor-electrical-computer',
    triggers: ['인공지능공학 지도', '머신러닝 지도', '딥러닝 지도'],
  },
  'professor-electrical': {
    label: '교수(전기공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-electrical', needsMedicalSafety: false,
    parentKey: 'professor-electrical-series', // 2026-08-10 Tier1 확장 재소속(구 부모: professor-electrical-computer),
    triggers: ['전기공학 지도', '전기기사 시험 지도'],
  },
  'professor-electronics': {
    label: '교수(전자공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-electronics', needsMedicalSafety: false,
    parentKey: 'professor-electrical-computer',
    triggers: ['전자공학 지도', '전자회로 지도'],
  },
  'professor-mechanical-eng': {
    label: '교수(기계공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-mechanical-eng', needsMedicalSafety: false,
    parentKey: 'professor-mechanicaleng-series', // 2026-08-10 Tier1 확장 재소속(구 부모: professor-mechanical),
    triggers: ['기계공학 지도', '기계기사 시험 지도'],
  },
  'professor-architecture': {
    label: '교수(건축학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-architecture', needsMedicalSafety: false,
    parentKey: 'professor-construction',
    triggers: ['건축학 지도', '건축설계 지도', '건축사 시험 지도'],
  },
  // ── 중계열(2단) 배치3 신설 5개 (의료·보건계열) ──────────────
  'professor-nursing-series': {
    label: '교수(간호 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-nursing-series', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-publichealth-series': {
    label: '교수(보건 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-publichealth-series', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-pharmacy-series': {
    label: '교수(약학 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-pharmacy-series', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-medicine-series': {
    label: '교수(의료 중계열, 수의학 포함)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-medicine-series', needsMedicalSafety: false,
    // 2026-09-14 추가 — "의료"라는 라벨만으론 사람 의학으로만 읽혀,
    // "수의사가 되려고 수의학과 진학을 준비 중인데..." 발화가 최상위
    // 단계에서 아무 후보와도 안 맞아 "해당없음"으로 즉시 떨어지는 게
    // subject_gate_live_smoketest.py 재작성 후 재현에서 확인됨(원래
    // professor-veterinary가 이 중계열 아래 있는데도 라벨에 그 힌트가
    // 전혀 없었다).
    parentKey: 'professor',
    triggers: [],
  },
  'professor-premedical-series': {
    label: '교수(의료예과 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-premedical-series', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  // ── 소계열(3단, 리프) 배치3: 의료·보건계열 17개 ──────────────
  'professor-nursing': {
    label: '교수(간호학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-nursing', needsMedicalSafety: false,
    parentKey: 'professor-nursing-series',
    triggers: ['간호학 지도', '간호사 국가고시 지도'],
  },
  'professor-publichealth': {
    label: '교수(보건학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-publichealth', needsMedicalSafety: false,
    parentKey: 'professor-publichealth-series',
    triggers: ['보건학 지도', '역학 지도'],
  },
  'professor-rehabilitation': {
    label: '교수(재활치료)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-rehabilitation', needsMedicalSafety: false,
    parentKey: 'professor-publichealth-series',
    triggers: ['물리치료학 지도', '작업치료학 지도'],
  },
  'professor-clinicalhealth': {
    label: '교수(임상보건)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-clinicalhealth', needsMedicalSafety: false,
    parentKey: 'professor-publichealth-series',
    triggers: ['임상병리학 지도', '방사선학 지도'],
  },
  'professor-healthmgmt': {
    label: '교수(보건관리)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-healthmgmt', needsMedicalSafety: false,
    parentKey: 'professor-publichealth-series',
    triggers: ['병원경영학 지도', '보건행정 지도'],
  },
  'professor-skincare': {
    label: '교수(피부미용)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-skincare', needsMedicalSafety: false,
    parentKey: 'professor-publichealth-series',
    triggers: ['피부미용학 지도', '화장품학 지도'],
  },
  'professor-animalhealth': {
    label: '교수(동물보건)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-animalhealth', needsMedicalSafety: false,
    parentKey: 'professor-publichealth-series',
    triggers: ['동물보건사 지도', '동물간호학 지도'],
  },
  'professor-pharmacy': {
    label: '교수(약학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-pharmacy', needsMedicalSafety: false,
    parentKey: 'professor-pharmacy-series',
    triggers: ['약학 지도', '약사 국가고시 지도'],
  },
  'professor-herbalpharmacy': {
    label: '교수(한약학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-herbalpharmacy', needsMedicalSafety: false,
    parentKey: 'professor-pharmacy-series',
    triggers: ['한약학 지도', '본초학 지도'],
  },
  'professor-veterinary': {
    label: '교수(수의학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-veterinary', needsMedicalSafety: false,
    parentKey: 'professor-medicine-series',
    triggers: ['수의학 지도', '수의사 국가고시 지도'],
  },
  'professor-medicine': {
    label: '교수(의학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-medicine', needsMedicalSafety: false,
    parentKey: 'professor-medicine-specialty-series', // 2026-08-10 Tier2/§4 확장 재소속(구 부모: professor-medicine-series),
    triggers: ['의학 본과 지도', '의사 국가고시 지도'],
  },
  'professor-dentistry-academic': {
    label: '교수(치의학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-dentistry-academic', needsMedicalSafety: false,
    parentKey: 'professor-dentistry-specialty-series', // 2026-08-10 Tier2/§4 확장 재소속(구 부모: professor-medicine-series),
    triggers: ['치의학 본과 지도', '치과의사 국가고시 지도'],
  },
  'professor-koreanmedicine': {
    label: '교수(한의학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-koreanmedicine', needsMedicalSafety: false,
    parentKey: 'professor-koreanmedicine-specialty-series', // 2026-08-10 Tier2/§4 확장 재소속(구 부모: professor-medicine-series),
    triggers: ['한의학 본과 지도', '한의사 국가고시 지도'],
  },
  'professor-premed': {
    label: '교수(의예과)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-premed', needsMedicalSafety: false,
    parentKey: 'professor-premedical-series',
    triggers: ['의예과 지도', '의대 편입 지도'],
  },
  'professor-predental': {
    label: '교수(치의예과)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-predental', needsMedicalSafety: false,
    parentKey: 'professor-premedical-series',
    triggers: ['치의예과 지도', '치의학전문대학원 편입 지도'],
  },
  'professor-prekoreanmed': {
    label: '교수(한의예과)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-prekoreanmed', needsMedicalSafety: false,
    parentKey: 'professor-premedical-series',
    triggers: ['한의예과 지도', '한의학전문대학원 편입 지도'],
  },
  'professor-prevet': {
    label: '교수(수의예과)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-prevet', needsMedicalSafety: false,
    parentKey: 'professor-premedical-series',
    triggers: ['수의예과 지도', '수의학과 편입 지도'],
  },
  // ── 중계열(2단) 배치4 신설 5개 (예체능계열) ─────────────────
  'professor-dance-pe-series': {
    label: '교수(무용·체육 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-dance-pe-series', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-theater-film-series': {
    label: '교수(연극·영화 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-theater-film-series', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-appliedarts-series': {
    label: '교수(응용예술 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-appliedarts-series', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-finearts-series': {
    label: '교수(미술 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-finearts-series', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-music-series': {
    label: '교수(음악 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-music-series', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  // ── 소계열(3단, 리프) 배치4: 예체능계열 22개 ─────────────────
  'professor-dance': {
    label: '교수(무용)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-dance', needsMedicalSafety: false,
    parentKey: 'professor-dance-pe-series',
    triggers: ['무용 지도', '무용과 입시 지도'],
  },
  'professor-physicaleducation': {
    label: '교수(체육)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-physicaleducation', needsMedicalSafety: false,
    parentKey: 'professor-dance-pe-series',
    triggers: ['체육학 지도', '스포츠지도사 지도'],
  },
  'professor-theater': {
    label: '교수(연극)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-theater', needsMedicalSafety: false,
    parentKey: 'professor-theater-film-series',
    triggers: ['연극 지도', '연극영화과 지도'],
  },
  'professor-film': {
    label: '교수(영화)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-film', needsMedicalSafety: false,
    parentKey: 'professor-theater-film-series',
    triggers: ['영화 지도', '시나리오 작법 지도'],
  },
  'professor-broadcasting-entertainment': {
    label: '교수(방송연예)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-broadcasting-entertainment', needsMedicalSafety: false,
    parentKey: 'professor-theater-film-series',
    triggers: ['방송연예과 지도', '엔터테인먼트 산업 지도'],
  },
  'professor-photography': {
    label: '교수(사진)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-photography', needsMedicalSafety: false,
    parentKey: 'professor-appliedarts-series',
    triggers: ['사진학 지도', '사진 구도 이론 지도'],
  },
  'professor-comics': {
    label: '교수(만화)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-comics', needsMedicalSafety: false,
    parentKey: 'professor-appliedarts-series',
    triggers: ['만화 지도', '웹툰 창작 지도'],
  },
  'professor-animation': {
    label: '교수(애니메이션)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-animation', needsMedicalSafety: false,
    parentKey: 'professor-appliedarts-series',
    triggers: ['애니메이션 지도', '애니메이션 12원칙 지도'],
  },
  'professor-game': {
    label: '교수(게임)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-game', needsMedicalSafety: false,
    parentKey: 'professor-appliedarts-series',
    triggers: ['게임학 지도', '게임 기획 지도'],
  },
  'professor-videoart': {
    label: '교수(영상예술)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-videoart', needsMedicalSafety: false,
    parentKey: 'professor-appliedarts-series',
    triggers: ['영상예술 지도', '미디어아트 지도'],
  },
  'professor-sound': {
    label: '교수(음향)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-sound', needsMedicalSafety: false,
    parentKey: 'professor-appliedarts-series',
    triggers: ['음향학 지도', '믹싱·마스터링 지도'],
  },
  'professor-craft': {
    label: '교수(공예)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-craft', needsMedicalSafety: false,
    parentKey: 'professor-finearts-series',
    triggers: ['공예 지도', '도자·금속공예 지도'],
  },
  'professor-design': {
    label: '교수(디자인)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-design', needsMedicalSafety: false,
    parentKey: 'professor-finearts-series',
    triggers: ['디자인 지도', 'UX/UI 디자인 지도'],
  },
  'professor-finearts': {
    label: '교수(순수미술)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-finearts', needsMedicalSafety: false,
    parentKey: 'professor-finearts-series',
    triggers: ['회화·조소 지도', '미대 입시 실기이론 지도'],
  },
  'professor-appliedfinearts': {
    label: '교수(응용미술)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-appliedfinearts', needsMedicalSafety: false,
    parentKey: 'professor-finearts-series',
    triggers: ['응용미술 지도', '일러스트레이션 지도'],
  },
  'professor-arthistory': {
    label: '교수(미술학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-arthistory', needsMedicalSafety: false,
    parentKey: 'professor-finearts-series',
    triggers: ['미술사 지도', '미술비평 지도'],
  },
  'professor-composition': {
    label: '교수(작곡)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-composition', needsMedicalSafety: false,
    parentKey: 'professor-music-series',
    triggers: ['작곡 지도', '화성학 지도'],
  },
  'professor-vocal': {
    label: '교수(성악)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-vocal', needsMedicalSafety: false,
    parentKey: 'professor-music-series',
    triggers: ['성악 지도', '발성 이론 지도'],
  },
  'professor-instrumental': {
    label: '교수(기악)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-instrumental', needsMedicalSafety: false,
    parentKey: 'professor-music-series',
    triggers: ['기악 지도', '피아노·현악·관악 지도'],
  },
  'professor-koreanmusic': {
    label: '교수(국악)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-koreanmusic', needsMedicalSafety: false,
    parentKey: 'professor-music-series',
    triggers: ['국악 지도', '판소리·장단 지도'],
  },
  'professor-contemporarymusic': {
    label: '교수(실용음악)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-contemporarymusic', needsMedicalSafety: false,
    parentKey: 'professor-music-series',
    triggers: ['실용음악 지도', '보컬·프로듀싱 지도'],
  },
  'professor-musicology': {
    label: '교수(음악학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-musicology', needsMedicalSafety: false,
    parentKey: 'professor-music-series',
    triggers: ['음악사 지도', '음악학 지도'],
  },
  // 2026-08-10 신설 — K-12 교과-전공 매칭 갭 대응(§K12-SUBJECT-PROFESSOR-
  // MAJOR-MAPPING). 초중고 정규 "음악" 교과가 성악·기악·국악·작곡·
  // 실용음악·음악학 어느 소계열에도 정확히 안 맞아 subject-gate 실사
  // 검증에서 3차례 억지 매칭(주로 국악)됐던 걸 리프 신설로 해결.
  'professor-generalmusic': {
    label: '교수(교양음악)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-generalmusic', needsMedicalSafety: false,
    parentKey: 'professor-music-series',
    triggers: ['교양음악 지도', '음악 개론 지도'],
  },
  // ── 중계열(2단) 배치5 신설 3개 (공학 확장) ───────────────────
  'professor-industrial-safety-series': {
    label: '교수(산업·안전 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-industrial-safety-series', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-materials-series': {
    label: '교수(재료 중계열, 반도체·신소재·금속·세라믹 포함)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-materials-series', needsMedicalSafety: false,
    // 2026-09-14 추가 — 라벨에 "반도체" 힌트가 전혀 없어 "반도체공학
    // 전공"류 발화가 이 중계열을 못 찾고 professor-electrical-computer
    // (전기·전자·컴퓨터)로 새는 게 subject_gate_live_smoketest.py
    // 재작성 후 재현에서 확인됨(정부 표준분류상 반도체공학은 재료
    // 소속이지만, 이 사실은 라벨만 봐선 전혀 알 수 없었다).
    parentKey: 'professor',
    triggers: [],
  },
  'professor-chemeng-energy-series': {
    label: '교수(화공·고분자·에너지 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-chemeng-energy-series', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  // ── 소계열(3단, 리프) 배치5: 공학 확장 26개 ──────────────────
  'professor-controlengineering': {
    label: '교수(제어계측공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-controlengineering', needsMedicalSafety: false,
    parentKey: 'professor-electrical-computer',
    triggers: ['제어공학 지도', 'PID 제어 지도'],
  },
  'professor-optics': {
    label: '교수(광학공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-optics', needsMedicalSafety: false,
    parentKey: 'professor-electrical-computer',
    triggers: ['광학공학 지도', '레이저공학 지도'],
  },
  'professor-biomedengineering': {
    label: '교수(의공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-biomedengineering', needsMedicalSafety: false,
    parentKey: 'professor-electrical-computer',
    triggers: ['의공학 지도', '의료영상 원리 지도'],
  },
  'professor-telecommunications': {
    label: '교수(정보·통신공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-telecommunications', needsMedicalSafety: false,
    parentKey: 'professor-electrical-computer',
    triggers: ['통신공학 지도', '네트워크 프로토콜 지도'],
  },
  'professor-architecturalengineering': {
    label: '교수(건축공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-architecturalengineering', needsMedicalSafety: false,
    parentKey: 'professor-construction',
    triggers: ['건축구조 지도', '건축시공학 지도'],
  },
  'professor-landscapearchitecture': {
    label: '교수(조경학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-landscapearchitecture', needsMedicalSafety: false,
    parentKey: 'professor-construction',
    triggers: ['조경학 지도', '조경설계 지도'],
  },
  'professor-civilengineering': {
    label: '교수(토목공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-civilengineering', needsMedicalSafety: false,
    parentKey: 'professor-construction',
    triggers: ['토목공학 지도', '토질역학 지도'],
  },
  'professor-urbanengineering': {
    label: '교수(도시공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-urbanengineering', needsMedicalSafety: false,
    parentKey: 'professor-construction',
    triggers: ['도시공학 지도', '도시계획 이론 지도'],
  },
  'professor-environmentalengineering': {
    label: '교수(환경공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-environmentalengineering', needsMedicalSafety: false,
    parentKey: 'professor-construction',
    triggers: ['환경공학 지도', '수처리 공정 지도'],
  },
  'professor-industrialengineering': {
    label: '교수(산업공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-industrialengineering', needsMedicalSafety: false,
    parentKey: 'professor-industrial-safety-series',
    triggers: ['산업공학 지도', '품질관리 지도'],
  },
  'professor-safetyengineering': {
    label: '교수(안전공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-safetyengineering', needsMedicalSafety: false,
    parentKey: 'professor-industrial-safety-series',
    triggers: ['안전공학 지도', '산업안전기사 지도'],
  },
  'professor-disasterprevention': {
    label: '교수(방재공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-disasterprevention', needsMedicalSafety: false,
    parentKey: 'professor-industrial-safety-series',
    triggers: ['방재공학 지도', '화재공학 지도'],
  },
  'professor-metallurgy': {
    label: '교수(금속공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-metallurgy', needsMedicalSafety: false,
    parentKey: 'professor-materials-series',
    triggers: ['금속공학 지도', '금속조직학 지도'],
  },
  'professor-newmaterials': {
    label: '교수(신소재공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-newmaterials', needsMedicalSafety: false,
    parentKey: 'professor-materials-series',
    triggers: ['신소재공학 지도', '나노소재 지도'],
  },
  'professor-ceramics': {
    label: '교수(세라믹공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-ceramics', needsMedicalSafety: false,
    parentKey: 'professor-materials-series',
    triggers: ['세라믹공학 지도', '소결 이론 지도'],
  },
  'professor-materials': {
    label: '교수(재료공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-materials', needsMedicalSafety: false,
    parentKey: 'professor-materials-series',
    triggers: ['재료공학 지도', '재료물성 지도'],
  },
  'professor-mechatronics': {
    label: '교수(메카트로닉스공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-mechatronics', needsMedicalSafety: false,
    parentKey: 'professor-mechanical',
    triggers: ['메카트로닉스 지도', '로봇공학 지도'],
  },
  'professor-navalengineering': {
    label: '교수(조선·해양공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-navalengineering', needsMedicalSafety: false,
    parentKey: 'professor-mechanical',
    triggers: ['조선해양공학 지도', '선박유체역학 지도'],
  },
  'professor-aerospace': {
    label: '교수(항공·우주공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-aerospace', needsMedicalSafety: false,
    parentKey: 'professor-mechanical',
    triggers: ['항공우주공학 지도', '항공역학 지도'],
  },
  'professor-railwayengineering': {
    label: '교수(철도공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-railwayengineering', needsMedicalSafety: false,
    parentKey: 'professor-mechanical',
    triggers: ['철도공학 지도', '철도차량 공학 지도'],
  },
  'professor-automotive': {
    label: '교수(자동차공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-automotive', needsMedicalSafety: false,
    parentKey: 'professor-mechanical',
    triggers: ['자동차공학 지도', '엔진공학 지도'],
  },
  'professor-chemicalengineering': {
    label: '교수(화학공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-chemicalengineering', needsMedicalSafety: false,
    parentKey: 'professor-chemeng-energy-series',
    triggers: ['화학공학 지도', '반응공학 지도'],
  },
  'professor-energyengineering': {
    label: '교수(에너지공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-energyengineering', needsMedicalSafety: false,
    parentKey: 'professor-chemeng-energy-series',
    triggers: ['에너지공학 지도', '신재생에너지 지도'],
  },
  'professor-polymerengineering': {
    label: '교수(고분자공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-polymerengineering', needsMedicalSafety: false,
    parentKey: 'professor-chemeng-energy-series',
    triggers: ['고분자공학 지도', '고분자화학 지도'],
  },
  'professor-bioengineering': {
    label: '교수(생명공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-bioengineering', needsMedicalSafety: false,
    parentKey: 'professor-chemeng-energy-series',
    triggers: ['생명공학 지도', '발효공학 지도'],
  },
  'professor-textileengineering': {
    label: '교수(섬유공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-textileengineering', needsMedicalSafety: false,
    parentKey: 'professor-chemeng-energy-series',
    triggers: ['섬유공학 지도', '섬유 소재 지도'],
  },
  // ── 중계열(2단) 배치6 신설 1개 (교육) ────────────────────────
  'professor-education-series': {
    label: '교수(교육 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-education-series', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  // ── 소계열(3단, 리프) 배치6: 사회·인문 확장(13) + 교육(11) 24개 ──
  'professor-religiousstudies': {
    label: '교수(종교학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-religiousstudies', needsMedicalSafety: false,
    parentKey: 'professor-humanities',
    triggers: ['종교학 지도', '비교종교학 지도'],
  },
  'professor-culturalstudies': {
    label: '교수(문화·민속·미술사학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-culturalstudies', needsMedicalSafety: false,
    parentKey: 'professor-humanities',
    triggers: ['민속학 지도', '문화사 지도'],
  },
  'professor-areastudies': {
    label: '교수(국제지역학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-areastudies', needsMedicalSafety: false,
    parentKey: 'professor-humanities',
    triggers: ['지역학 지도', '중국학·일본학 지도'],
  },
  'professor-generalhumanities': {
    label: '교수(교양인문학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-generalhumanities', needsMedicalSafety: false,
    parentKey: 'professor-humanities',
    triggers: ['교양인문학 지도', '인문학 개론 지도'],
  },
  'professor-childfamilystudies': {
    label: '교수(아동·가족학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-childfamilystudies', needsMedicalSafety: false,
    parentKey: 'professor-socialscience',
    triggers: ['아동가족학 지도', '아동발달 이론 지도'],
  },
  'professor-socialwelfare': {
    label: '교수(사회복지학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-socialwelfare', needsMedicalSafety: false,
    parentKey: 'professor-socialscience',
    triggers: ['사회복지학 지도', '사회복지사 국가고시 지도'],
  },
  'professor-consumerscience': {
    label: '교수(소비자·가정자원)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-consumerscience', needsMedicalSafety: false,
    parentKey: 'professor-socialscience',
    triggers: ['소비자학 지도', '가정경제관리 지도'],
  },
  'professor-mediastudies': {
    label: '교수(언론·방송·매체학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-mediastudies', needsMedicalSafety: false,
    parentKey: 'professor-socialscience',
    triggers: ['언론학 지도', '저널리즘 이론 지도'],
  },
  'professor-publicadministration': {
    label: '교수(행정학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-publicadministration', needsMedicalSafety: false,
    parentKey: 'professor-socialscience',
    triggers: ['행정학 지도', '공무원 시험(행정학) 지도'],
  },
  'professor-anthropology': {
    label: '교수(인류학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-anthropology', needsMedicalSafety: false,
    parentKey: 'professor-anthropology-series', // 2026-08-10 Tier2/§4 확장 재소속(구 부모: professor-socialscience),
    triggers: ['인류학 지도', '문화상대주의 지도'],
  },
  'professor-libraryscience': {
    label: '교수(문헌정보학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-libraryscience', needsMedicalSafety: false,
    parentKey: 'professor-socialscience',
    triggers: ['문헌정보학 지도', '사서직 시험 지도'],
  },
  'professor-generalsocialscience': {
    label: '교수(교양사회과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-generalsocialscience', needsMedicalSafety: false,
    parentKey: 'professor-socialscience',
    triggers: ['교양사회과학 지도', '사회과학 개론 지도'],
  },
  'professor-militaryscience': {
    label: '교수(군사·국방·안보)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-militaryscience', needsMedicalSafety: false,
    parentKey: 'professor-socialscience',
    triggers: ['군사학 지도', '안보전략 이론 지도'],
  },
  'professor-education': {
    label: '교수(교육학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-education', needsMedicalSafety: false,
    parentKey: 'professor-education-series',
    triggers: ['교육학 지도', '임용고시(교육학) 지도'],
  },
  'professor-languageeducation': {
    label: '교수(언어교육)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-languageeducation', needsMedicalSafety: false,
    parentKey: 'professor-education-series',
    triggers: ['언어교수법 지도', '임용고시(언어교육) 지도'],
  },
  'professor-elementaryeducation': {
    label: '교수(초등교육)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-elementaryeducation', needsMedicalSafety: false,
    parentKey: 'professor-education-series',
    triggers: ['초등교육 지도', '초등 임용고시 지도'],
  },
  'professor-socialstudieseducation': {
    label: '교수(사회과교육)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-socialstudieseducation', needsMedicalSafety: false,
    parentKey: 'professor-education-series',
    triggers: ['사회과교육 지도', '임용고시(사회) 지도'],
  },
  'professor-earlychildhoodeducation': {
    label: '교수(유아교육)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-earlychildhoodeducation', needsMedicalSafety: false,
    parentKey: 'professor-education-series',
    triggers: ['유아교육 지도', '누리과정 지도'],
  },
  'professor-specialeducation': {
    label: '교수(특수교육)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-specialeducation', needsMedicalSafety: false,
    parentKey: 'professor-education-series',
    triggers: ['특수교육 지도', '개별화교육계획 지도'],
  },
  'professor-scienceeducation': {
    label: '교수(자연과학교육)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-scienceeducation', needsMedicalSafety: false,
    parentKey: 'professor-education-series',
    triggers: ['과학교육 지도', '임용고시(과학) 지도'],
  },
  'professor-healtheducation': {
    label: '교수(간호·보건 교육)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-healtheducation', needsMedicalSafety: false,
    parentKey: 'professor-education-series',
    triggers: ['보건교육 지도', '보건교사 임용고시 지도'],
  },
  'professor-artspeeducation': {
    label: '교수(예술·체육교육)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-artspeeducation', needsMedicalSafety: false,
    parentKey: 'professor-education-series',
    triggers: ['예체능교육 지도', '임용고시(예체능) 지도'],
  },
  'professor-engineeringeducation': {
    label: '교수(공학교육)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-engineeringeducation', needsMedicalSafety: false,
    parentKey: 'professor-education-series',
    triggers: ['공업교육 지도', '임용고시(공업) 지도'],
  },
  'professor-generalengineering': {
    label: '교수(교양공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-generalengineering', needsMedicalSafety: false,
    parentKey: 'professor-education-series',
    triggers: ['교양공학 지도', '공학적 사고 입문 지도'],
  },
  // ── 중계열(2단) 배치7 신설 4개 (마지막 배치) ──────────────────
  'professor-agriculture-fishery-series': {
    label: '교수(농림·수산 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-agriculture-fishery-series', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-homeeconomics-series': {
    label: '교수(생활과학 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-homeeconomics-series', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-transportation-series': {
    label: '교수(교통·수송 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-transportation-series', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-misc-series': {
    label: '교수(기타 N.C.E 중계열, 교양자연과학·진로교육·기술가정 등 포함)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-misc-series', needsMedicalSafety: false,
    // 2026-09-14 추가 — "기타"라는 라벨만으론 실제로 뭐가 들어있는지
    // 전혀 짐작이 안 돼, "자연과학 전반을 교양 수준으로 폭넓게 배우고
    // 싶다"(→ professor-generalscience가 바로 여기 있음)처럼 명확한
    // 요청도 후보 중 아무 데도 안 맞는다고 판단해 최상위에서
    // "해당없음"으로 떨어지는 게 subject_gate_live_smoketest.py
    // 재작성 후 gapfill 재현(professor-gap-27)에서 확인됨.
    parentKey: 'professor',
    triggers: [],
  },
  // ── 소계열(3단, 리프) 배치7: 마지막 배치 40개 ─────────────────
  'professor-linguistics': {
    label: '교수(언어학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-linguistics', needsMedicalSafety: false,
    parentKey: 'professor-language-literature',
    triggers: ['언어학 지도', '통사론 지도'],
  },
  'professor-german': {
    label: '교수(독일어·문학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-german', needsMedicalSafety: false,
    parentKey: 'professor-language-literature',
    triggers: ['독일어 지도', '독어독문학 지도'],
  },
  'professor-russian': {
    label: '교수(러시아어·문학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-russian', needsMedicalSafety: false,
    parentKey: 'professor-language-literature',
    triggers: ['러시아어 지도', '노어노문학 지도'],
  },
  'professor-spanish': {
    label: '교수(스페인어·문학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-spanish', needsMedicalSafety: false,
    parentKey: 'professor-language-literature',
    triggers: ['스페인어 지도', '서어서문학 지도'],
  },
  'professor-japanese': {
    label: '교수(일본어·문학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-japanese', needsMedicalSafety: false,
    parentKey: 'professor-language-literature',
    triggers: ['일본어 지도', 'JLPT 지도'],
  },
  'professor-chinese': {
    label: '교수(중국어·문학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-chinese', needsMedicalSafety: false,
    parentKey: 'professor-language-literature',
    triggers: ['중국어 지도', 'HSK 지도'],
  },
  // 2026-08-10 신설 — K-12 교과-전공 매칭 갭 대응. 초중고 정규 "한문"
  // 교과를 담당할 리프가 아예 없어 subject-gate 실사 검증에서 3차례
  // professor-chinese(현대 중국어)로 억지 매칭됐던 걸 리프 신설로 해결
  // — SP_professor-classicalchinese_v1_0.md에 현대 중국어와의 경계를
  // 명시했다.
  'professor-classicalchinese': {
    label: '교수(한문학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-classicalchinese', needsMedicalSafety: false,
    parentKey: 'professor-language-literature',
    triggers: ['한문 지도', '한자 교육 지도'],
  },
  'professor-french': {
    label: '교수(프랑스어·문학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-french', needsMedicalSafety: false,
    parentKey: 'professor-language-literature',
    triggers: ['프랑스어 지도', '불어불문학 지도'],
  },
  'professor-otherasianlanguages': {
    label: '교수(기타아시아어·문학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-otherasianlanguages', needsMedicalSafety: false,
    parentKey: 'professor-language-literature',
    triggers: ['베트남어 지도', '아랍어 지도', '태국어 지도'],
  },
  'professor-othereuropeanlanguages': {
    label: '교수(기타유럽어·문학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-othereuropeanlanguages', needsMedicalSafety: false,
    parentKey: 'professor-language-literature',
    triggers: ['이탈리아어 지도', '포르투갈어 지도'],
  },
  'professor-generallanguage': {
    label: '교수(교양어·문학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-generallanguage', needsMedicalSafety: false,
    parentKey: 'professor-language-literature',
    triggers: ['교양외국어 지도', '여행회화 지도'],
  },
  'professor-creativewriting': {
    label: '교수(문예창작학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-creativewriting', needsMedicalSafety: false,
    parentKey: 'professor-language-literature',
    triggers: ['문예창작 지도', '소설·시 창작 지도'],
  },
  'professor-tradedistribution': {
    label: '교수(무역·유통학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-tradedistribution', needsMedicalSafety: false,
    parentKey: 'professor-business-economics',
    triggers: ['무역학 지도', '유통관리론 지도'],
  },
  'professor-advertising': {
    label: '교수(광고·홍보학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-advertising', needsMedicalSafety: false,
    parentKey: 'professor-business-economics',
    triggers: ['광고학 지도', 'PR전략 지도'],
  },
  'professor-tourism': {
    label: '교수(관광학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-tourism', needsMedicalSafety: false,
    parentKey: 'professor-business-economics',
    triggers: ['관광경영학 지도', '호스피탈리티 지도'],
  },
  'professor-realestate': {
    label: '교수(부동산)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-realestate', needsMedicalSafety: false,
    parentKey: 'professor-business-economics',
    triggers: ['부동산학 지도', '공인중개사 시험 지도'],
  },
  'professor-financeinsurance': {
    label: '교수(금융·보험학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-financeinsurance', needsMedicalSafety: false,
    parentKey: 'professor-business-economics',
    triggers: ['금융보험학 지도', '보험계리사 시험 지도'],
  },
  'professor-cropscience': {
    label: '교수(작물·원예학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-cropscience', needsMedicalSafety: false,
    parentKey: 'professor-agriculture-fishery-series',
    triggers: ['원예학 지도', '작물육종 지도'],
  },
  'professor-forestry': {
    label: '교수(산림학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-forestry', needsMedicalSafety: false,
    parentKey: 'professor-agriculture-fishery-series',
    triggers: ['산림학 지도', '산림생태학 지도'],
  },
  'professor-animalscience': {
    label: '교수(축산학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-animalscience', needsMedicalSafety: false,
    parentKey: 'professor-agriculture-fishery-series',
    triggers: ['축산학 지도', '사양학 지도'],
  },
  'professor-fisheries': {
    label: '교수(수산학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-fisheries', needsMedicalSafety: false,
    parentKey: 'professor-agriculture-fishery-series',
    triggers: ['수산학 지도', '양식학 지도'],
  },
  'professor-agroecology': {
    label: '교수(농림수산환경생태학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-agroecology', needsMedicalSafety: false,
    parentKey: 'professor-agriculture-fishery-series',
    triggers: ['농생태학 지도', '지속가능농업 지도'],
  },
  'professor-agrobiosystems': {
    label: '교수(농림수산바이오시스템공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-agrobiosystems', needsMedicalSafety: false,
    parentKey: 'professor-agriculture-fishery-series',
    triggers: ['생물시스템공학 지도', '스마트팜 지도'],
  },
  'professor-foodengineering': {
    label: '교수(식품공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-foodengineering', needsMedicalSafety: false,
    parentKey: 'professor-agriculture-fishery-series',
    triggers: ['식품공학 지도', '식품가공 지도'],
  },
  'professor-environmentalscience': {
    label: '교수(환경학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-environmentalscience', needsMedicalSafety: false,
    parentKey: 'professor-chembio',
    triggers: ['환경학 지도', '생태학 지도'],
  },
  'professor-biotechnology': {
    label: '교수(바이오테크놀로지학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-biotechnology', needsMedicalSafety: false,
    parentKey: 'professor-chembio',
    triggers: ['바이오테크놀로지 지도', '생명정보학 지도'],
  },
  'professor-nutrition': {
    label: '교수(식품영양학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-nutrition', needsMedicalSafety: false,
    parentKey: 'professor-homeeconomics-series',
    triggers: ['영양학 지도', '영양사 국가고시 지도'],
  },
  'professor-culinaryscience': {
    label: '교수(조리과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-culinaryscience', needsMedicalSafety: false,
    parentKey: 'professor-homeeconomics-series',
    triggers: ['조리과학 지도', '조리기능사 지도'],
  },
  'professor-clothing': {
    label: '교수(의류·의상학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-clothing', needsMedicalSafety: false,
    parentKey: 'professor-homeeconomics-series',
    triggers: ['의류학 지도', '의복구성학 지도'],
  },
  'professor-housingstudies': {
    label: '교수(주거학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-housingstudies', needsMedicalSafety: false,
    parentKey: 'professor-homeeconomics-series',
    triggers: ['주거학 지도', '주거환경심리 지도'],
  },
  'professor-astronomy': {
    label: '교수(천문·대기과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-astronomy', needsMedicalSafety: false,
    parentKey: 'professor-mathphys',
    triggers: ['천문학 지도', '대기과학 지도'],
  },
  'professor-oceanography': {
    label: '교수(해양학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-oceanography', needsMedicalSafety: false,
    parentKey: 'professor-mathphys',
    triggers: ['해양학 지도', '물리해양학 지도'],
  },
  'professor-trafficsystems': {
    label: '교수(교통시스템공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-trafficsystems', needsMedicalSafety: false,
    parentKey: 'professor-transportation-series',
    triggers: ['교통공학 지도', '교통신호체계 지도'],
  },
  'professor-railwaycontrol': {
    label: '교수(철도운전제어학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-railwaycontrol', needsMedicalSafety: false,
    parentKey: 'professor-transportation-series',
    triggers: ['철도운전학 지도', '열차운전이론 지도'],
  },
  'professor-shipnavigation': {
    label: '교수(선박운항학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-shipnavigation', needsMedicalSafety: false,
    parentKey: 'professor-transportation-series',
    triggers: ['항해학 지도', '항해사 시험 지도'],
  },
  'professor-aviation': {
    label: '교수(항공운항학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-aviation', needsMedicalSafety: false,
    parentKey: 'professor-transportation-series',
    triggers: ['항공운항학 지도', '조종사 학과시험 지도'],
  },
  'professor-uav': {
    label: '교수(무인항공기(운항)학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-uav', needsMedicalSafety: false,
    parentKey: 'professor-transportation-series',
    triggers: ['드론학 지도', '초경량비행장치 자격시험 지도'],
  },
  'professor-secretarial': {
    label: '교수(비서)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-secretarial', needsMedicalSafety: false,
    parentKey: 'professor-misc-series',
    triggers: ['비서학 지도', '비서 자격시험 지도'],
  },
  'professor-generalscience': {
    label: '교수(교양자연과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-generalscience', needsMedicalSafety: false,
    parentKey: 'professor-misc-series',
    triggers: ['교양자연과학 지도', '과학 개론 지도'],
  },
  'professor-medicalscience': {
    label: '교수(의과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-medicalscience', needsMedicalSafety: false,
    parentKey: 'professor-misc-series',
    triggers: ['의과학 지도', '중개연구방법론 지도'],
  },
  'professor-beautyart': {
    label: '교수(뷰티아트)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-beautyart', needsMedicalSafety: false,
    parentKey: 'professor-misc-series',
    triggers: ['뷰티아트 지도', '메이크업 색채이론 지도'],
  },
  // 2026-08-10 신설 2건 — K-12 교과-전공 매칭 갭 대응. 둘 다 subject-gate
  // 실사 검증에서 3차례 억지 매칭됐던 완전공백 과목을 리프 신설로 해결.
  'professor-generalpractical': {
    label: '교수(교양 기술·가정)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-generalpractical', needsMedicalSafety: false,
    // 초중고 "기술·가정" 교과가 소비자·가정자원/아동·가족학/공예/
    // 주생활학으로 파편화돼 있어 매번 professor-culinaryscience(조리과학,
    // 정식 소계열도 아닌 인접 리프)로 억지 매칭됐음.
    parentKey: 'professor-misc-series',
    triggers: ['기술가정 지도', '실과 지도'],
  },
  'professor-careereducation': {
    label: '교수(진로교육)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-careereducation', needsMedicalSafety: false,
    // 초중고 "진로와 직업" 교과를 담당할 리프가 아예 없어 매번
    // professor-psychology(적성 "검사"라는 표면적 연상만으로)로 억지
    // 매칭됐음. SP_professor-careereducation_v1_0.md §세부분야 경계에서
    // 정서·심리 상담과는 명확히 구분(임상적 개입 없음).
    parentKey: 'professor-misc-series',
    triggers: ['진로와 직업 지도', '진로교육 지도', '적성검사 해석'],
  },
  // ── 중계열(2단) 배치8 신설 15개 + 소계열(3단) 배치8: Tier 1 세부분야 확장
  // (2026-08-10, 주피터님 지시 — 법학·경제학 등 '표준적으로 알려진 하위분야가
  // 있는 대분야'를 세분화. 기존 flat 리프(예: professor-law)를 중계열로
  // 승격하고, 그 아래 표준 하위분야를 소계열로 신설 — 기존 배치2(경영·경제)와
  // 동일한 '커지면 한 단계 더 쪼갠다' 패턴. 원래 리프는 그대로 남아 중계열
  // 안에서 '일반/개론' 성격의 소계열로 재소속된다(id 불변, parentKey만 변경).
  // 게이트가 flat(254개 후보)로 폭증하지 않도록 subject-gate.js를 먼저
  // 계층형으로 리팩터한 뒤 신설(각 단계 후보 수는 대부분 4~14개로 억제됨).
  'professor-law-series': {
    label: '교수(법학 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-law-series', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [], // 중계열 자체는 직접 호출 대상 아님 — 소계열이 리프
  },
  'professor-constitutionallaw': {
    label: '교수(헌법)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-constitutionallaw', needsMedicalSafety: false,
    parentKey: 'professor-law-series',
    triggers: ['헌법 지도', '기본권 이론 지도'],
  },
  'professor-civillaw': {
    label: '교수(민법)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-civillaw', needsMedicalSafety: false,
    parentKey: 'professor-law-series',
    triggers: ['민법 지도', '채권법 지도'],
  },
  'professor-criminallaw': {
    label: '교수(형법)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-criminallaw', needsMedicalSafety: false,
    parentKey: 'professor-law-series',
    triggers: ['형법 지도', '형법각론 지도'],
  },
  'professor-commerciallaw': {
    label: '교수(상법)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-commerciallaw', needsMedicalSafety: false,
    parentKey: 'professor-law-series',
    triggers: ['상법 지도', '회사법 지도'],
  },
  'professor-administrativelaw': {
    label: '교수(행정법)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-administrativelaw', needsMedicalSafety: false,
    parentKey: 'professor-law-series',
    triggers: ['행정법 지도', '행정구제법 지도'],
  },
  'professor-civilprocedure': {
    label: '교수(민사소송법)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-civilprocedure', needsMedicalSafety: false,
    parentKey: 'professor-law-series',
    triggers: ['민사소송법 지도', '민사집행법 지도'],
  },
  'professor-criminalprocedure': {
    label: '교수(형사소송법)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-criminalprocedure', needsMedicalSafety: false,
    parentKey: 'professor-law-series',
    triggers: ['형사소송법 지도', '수사절차 지도'],
  },
  'professor-internationallaw': {
    label: '교수(국제법)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-internationallaw', needsMedicalSafety: false,
    parentKey: 'professor-law-series',
    triggers: ['국제법 지도', '국제거래법 지도'],
  },
  'professor-laborlaw': {
    label: '교수(노동법)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-laborlaw', needsMedicalSafety: false,
    parentKey: 'professor-law-series',
    triggers: ['노동법 지도', '근로기준법 지도'],
  },
  'professor-taxlaw': {
    label: '교수(조세법)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-taxlaw', needsMedicalSafety: false,
    parentKey: 'professor-law-series',
    triggers: ['조세법 지도', '세법 지도'],
  },
  'professor-iplaw': {
    label: '교수(지식재산권법)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-iplaw', needsMedicalSafety: false,
    parentKey: 'professor-law-series',
    triggers: ['지식재산권법 지도', '특허법 지도'],
  },
  'professor-competitionlaw': {
    label: '교수(경제법)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-competitionlaw', needsMedicalSafety: false,
    parentKey: 'professor-law-series',
    triggers: ['경제법 지도', '공정거래법 지도'],
  },
  'professor-environmentallaw': {
    label: '교수(환경법)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-environmentallaw', needsMedicalSafety: false,
    parentKey: 'professor-law-series',
    triggers: ['환경법 지도', '환경정책 법제 지도'],
  },
  'professor-economics-series': {
    label: '교수(경제학 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-economics-series', needsMedicalSafety: false,
    parentKey: 'professor-business-economics',
    triggers: [], // 중계열 자체는 직접 호출 대상 아님 — 소계열이 리프
  },
  'professor-microeconomics': {
    label: '교수(미시경제학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-microeconomics', needsMedicalSafety: false,
    parentKey: 'professor-economics-series',
    triggers: ['미시경제학 지도', '소비자이론 지도'],
  },
  'professor-macroeconomics': {
    label: '교수(거시경제학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-macroeconomics', needsMedicalSafety: false,
    parentKey: 'professor-economics-series',
    triggers: ['거시경제학 지도', '국민소득 지도'],
  },
  'professor-econometrics': {
    label: '교수(계량경제학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-econometrics', needsMedicalSafety: false,
    parentKey: 'professor-economics-series',
    triggers: ['계량경제학 지도', '회귀분석 지도'],
  },
  'professor-internationaleconomics': {
    label: '교수(국제경제학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-internationaleconomics', needsMedicalSafety: false,
    parentKey: 'professor-economics-series',
    triggers: ['국제경제학 지도', '국제무역이론 지도'],
  },
  'professor-monetaryeconomics': {
    label: '교수(화폐금융론)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-monetaryeconomics', needsMedicalSafety: false,
    parentKey: 'professor-economics-series',
    triggers: ['화폐금융론 지도', '통화정책 지도'],
  },
  'professor-laboreconomics': {
    label: '교수(노동경제학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-laboreconomics', needsMedicalSafety: false,
    parentKey: 'professor-economics-series',
    triggers: ['노동경제학 지도', '고용이론 지도'],
  },
  'professor-publicfinance': {
    label: '교수(재정학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-publicfinance', needsMedicalSafety: false,
    parentKey: 'professor-economics-series',
    triggers: ['재정학 지도', '조세정책 지도'],
  },
  'professor-industrialorganization': {
    label: '교수(산업조직론)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-industrialorganization', needsMedicalSafety: false,
    parentKey: 'professor-economics-series',
    triggers: ['산업조직론 지도', '과점이론 지도'],
  },
  'professor-economichistory': {
    label: '교수(경제사)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-economichistory', needsMedicalSafety: false,
    parentKey: 'professor-economics-series',
    triggers: ['경제사 지도', '산업혁명사 지도'],
  },
  'professor-physics-series': {
    label: '교수(물리학 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-physics-series', needsMedicalSafety: false,
    parentKey: 'professor-mathphys',
    triggers: [], // 중계열 자체는 직접 호출 대상 아님 — 소계열이 리프
  },
  'professor-mechanicsphysics': {
    label: '교수(역학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-mechanicsphysics', needsMedicalSafety: false,
    parentKey: 'professor-physics-series',
    triggers: ['고전역학 지도', '뉴턴역학 지도'],
  },
  'professor-electromagnetism': {
    label: '교수(전자기학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-electromagnetism', needsMedicalSafety: false,
    parentKey: 'professor-physics-series',
    triggers: ['전자기학 지도', '맥스웰방정식 지도'],
  },
  'professor-thermalstatphysics': {
    label: '교수(열및통계역학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-thermalstatphysics', needsMedicalSafety: false,
    parentKey: 'professor-physics-series',
    triggers: ['열역학 지도', '통계역학 지도'],
  },
  'professor-quantummechanics': {
    label: '교수(양자역학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-quantummechanics', needsMedicalSafety: false,
    parentKey: 'professor-physics-series',
    triggers: ['양자역학 지도', '슈뢰딩거방정식 지도'],
  },
  'professor-condensedmatter': {
    label: '교수(고체물리학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-condensedmatter', needsMedicalSafety: false,
    parentKey: 'professor-physics-series',
    triggers: ['고체물리학 지도', '응집물질물리 지도'],
  },
  'professor-particlephysics': {
    label: '교수(입자물리학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-particlephysics', needsMedicalSafety: false,
    parentKey: 'professor-physics-series',
    triggers: ['입자물리학 지도', '표준모형 지도'],
  },
  'professor-opticsphysics': {
    label: '교수(광학(물리))', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-opticsphysics', needsMedicalSafety: false,
    parentKey: 'professor-physics-series',
    triggers: ['파동광학 지도', '간섭·회절 지도'],
  },
  'professor-math-series': {
    label: '교수(수학 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-math-series', needsMedicalSafety: false,
    parentKey: 'professor-mathphys',
    triggers: [], // 중계열 자체는 직접 호출 대상 아님 — 소계열이 리프
  },
  'professor-algebra': {
    label: '교수(대수학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-algebra', needsMedicalSafety: false,
    parentKey: 'professor-math-series',
    triggers: ['대수학 지도', '군환체 지도'],
  },
  'professor-analysis': {
    label: '교수(해석학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-analysis', needsMedicalSafety: false,
    parentKey: 'professor-math-series',
    triggers: ['해석학 지도', '실해석학 지도'],
  },
  'professor-geometrytopology': {
    label: '교수(기하·위상수학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-geometrytopology', needsMedicalSafety: false,
    parentKey: 'professor-math-series',
    triggers: ['위상수학 지도', '미분기하학 지도'],
  },
  'professor-discretemath': {
    label: '교수(이산수학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-discretemath', needsMedicalSafety: false,
    parentKey: 'professor-math-series',
    triggers: ['이산수학 지도', '조합론 지도'],
  },
  'professor-diffeq': {
    label: '교수(미분방정식)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-diffeq', needsMedicalSafety: false,
    parentKey: 'professor-math-series',
    triggers: ['미분방정식 지도', '상미분방정식 지도'],
  },
  'professor-probabilitytheory': {
    label: '교수(확률론)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-probabilitytheory', needsMedicalSafety: false,
    parentKey: 'professor-math-series',
    triggers: ['확률론 지도', '확률과정 지도'],
  },
  'professor-chemistry-series': {
    label: '교수(화학 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-chemistry-series', needsMedicalSafety: false,
    parentKey: 'professor-chembio',
    triggers: [], // 중계열 자체는 직접 호출 대상 아님 — 소계열이 리프
  },
  'professor-organicchemistry': {
    label: '교수(유기화학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-organicchemistry', needsMedicalSafety: false,
    parentKey: 'professor-chemistry-series',
    triggers: ['유기화학 지도', '반응기구 지도'],
  },
  'professor-inorganicchemistry': {
    label: '교수(무기화학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-inorganicchemistry', needsMedicalSafety: false,
    parentKey: 'professor-chemistry-series',
    triggers: ['무기화학 지도', '배위화학 지도'],
  },
  'professor-physicalchemistry': {
    label: '교수(물리화학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-physicalchemistry', needsMedicalSafety: false,
    parentKey: 'professor-chemistry-series',
    triggers: ['물리화학 지도', '화학열역학 지도'],
  },
  'professor-analyticalchemistry': {
    label: '교수(분석화학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-analyticalchemistry', needsMedicalSafety: false,
    parentKey: 'professor-chemistry-series',
    triggers: ['분석화학 지도', '정량분석 지도'],
  },
  'professor-biochemistry': {
    label: '교수(생화학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-biochemistry', needsMedicalSafety: false,
    parentKey: 'professor-chemistry-series',
    triggers: ['생화학 지도', '효소반응 지도'],
  },
  'professor-biology-series': {
    label: '교수(생명과학 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-biology-series', needsMedicalSafety: false,
    parentKey: 'professor-chembio',
    triggers: [], // 중계열 자체는 직접 호출 대상 아님 — 소계열이 리프
  },
  'professor-molecularbiology': {
    label: '교수(분자생물학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-molecularbiology', needsMedicalSafety: false,
    parentKey: 'professor-biology-series',
    triggers: ['분자생물학 지도', 'DNA복제 지도'],
  },
  'professor-cellbiology': {
    label: '교수(세포생물학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-cellbiology', needsMedicalSafety: false,
    parentKey: 'professor-biology-series',
    triggers: ['세포생물학 지도', '세포소기관 지도'],
  },
  'professor-genetics': {
    label: '교수(유전학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-genetics', needsMedicalSafety: false,
    parentKey: 'professor-biology-series',
    triggers: ['유전학 지도', '멘델법칙 지도'],
  },
  'professor-ecology': {
    label: '교수(생태학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-ecology', needsMedicalSafety: false,
    parentKey: 'professor-biology-series',
    triggers: ['생태학 지도', '생태계 지도'],
  },
  'professor-microbiology': {
    label: '교수(미생물학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-microbiology', needsMedicalSafety: false,
    parentKey: 'professor-biology-series',
    triggers: ['미생물학 지도', '세균학 지도'],
  },
  'professor-physiologybio': {
    label: '교수(생리학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-physiologybio', needsMedicalSafety: false,
    parentKey: 'professor-biology-series',
    triggers: ['생리학 지도', '항상성 지도'],
  },
  'professor-developmentalbiology': {
    label: '교수(발생생물학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-developmentalbiology', needsMedicalSafety: false,
    parentKey: 'professor-biology-series',
    triggers: ['발생생물학 지도', '배아발생 지도'],
  },
  'professor-psychology-series': {
    label: '교수(심리학 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-psychology-series', needsMedicalSafety: false,
    parentKey: 'professor-socialscience',
    triggers: [], // 중계열 자체는 직접 호출 대상 아님 — 소계열이 리프
  },
  'professor-clinicalpsychology': {
    label: '교수(임상심리학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-clinicalpsychology', needsMedicalSafety: false,
    parentKey: 'professor-psychology-series',
    triggers: ['임상심리학 지도', '이상심리학 지도'],
  },
  'professor-counselingpsychology': {
    label: '교수(상담심리학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-counselingpsychology', needsMedicalSafety: false,
    parentKey: 'professor-psychology-series',
    triggers: ['상담심리학 지도', '상담이론 지도'],
  },
  'professor-developmentalpsychology': {
    label: '교수(발달심리학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-developmentalpsychology', needsMedicalSafety: false,
    parentKey: 'professor-psychology-series',
    triggers: ['발달심리학 지도', '인지발달이론 지도'],
  },
  'professor-cognitivepsychology': {
    label: '교수(인지심리학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-cognitivepsychology', needsMedicalSafety: false,
    parentKey: 'professor-psychology-series',
    triggers: ['인지심리학 지도', '기억이론 지도'],
  },
  'professor-socialpsychology': {
    label: '교수(사회심리학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-socialpsychology', needsMedicalSafety: false,
    parentKey: 'professor-psychology-series',
    triggers: ['사회심리학 지도', '집단역학 지도'],
  },
  'professor-iopsychology': {
    label: '교수(산업및조직심리학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-iopsychology', needsMedicalSafety: false,
    parentKey: 'professor-psychology-series',
    triggers: ['산업심리학 지도', '조직행동론 지도'],
  },
  'professor-biopsychology': {
    label: '교수(생물심리학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-biopsychology', needsMedicalSafety: false,
    parentKey: 'professor-psychology-series',
    triggers: ['생물심리학 지도', '신경심리학 지도'],
  },
  'professor-sociology-series': {
    label: '교수(사회학 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-sociology-series', needsMedicalSafety: false,
    parentKey: 'professor-socialscience',
    triggers: [], // 중계열 자체는 직접 호출 대상 아님 — 소계열이 리프
  },
  'professor-theoreticalsociology': {
    label: '교수(이론사회학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-theoreticalsociology', needsMedicalSafety: false,
    parentKey: 'professor-sociology-series',
    triggers: ['사회학이론 지도', '고전사회학이론 지도'],
  },
  'professor-stratification': {
    label: '교수(계층및계급론)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-stratification', needsMedicalSafety: false,
    parentKey: 'professor-sociology-series',
    triggers: ['사회계층론 지도', '불평등이론 지도'],
  },
  'professor-familysociology': {
    label: '교수(가족사회학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-familysociology', needsMedicalSafety: false,
    parentKey: 'professor-sociology-series',
    triggers: ['가족사회학 지도', '가족구조변화 지도'],
  },
  'professor-urbansociology': {
    label: '교수(도시및지역사회학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-urbansociology', needsMedicalSafety: false,
    parentKey: 'professor-sociology-series',
    triggers: ['도시사회학 지도', '지역공동체 지도'],
  },
  'professor-culturalsociology': {
    label: '교수(문화사회학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-culturalsociology', needsMedicalSafety: false,
    parentKey: 'professor-sociology-series',
    triggers: ['문화사회학 지도', '대중문화이론 지도'],
  },
  'professor-politics-series': {
    label: '교수(정치외교학 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-politics-series', needsMedicalSafety: false,
    parentKey: 'professor-socialscience',
    triggers: [], // 중계열 자체는 직접 호출 대상 아님 — 소계열이 리프
  },
  'professor-politicaltheory': {
    label: '교수(정치사상)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-politicaltheory', needsMedicalSafety: false,
    parentKey: 'professor-politics-series',
    triggers: ['정치사상 지도', '정치철학 지도'],
  },
  'professor-comparativepolitics': {
    label: '교수(비교정치론)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-comparativepolitics', needsMedicalSafety: false,
    parentKey: 'professor-politics-series',
    triggers: ['비교정치론 지도', '정치체제비교 지도'],
  },
  'professor-internationalpolitics': {
    label: '교수(국제정치론)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-internationalpolitics', needsMedicalSafety: false,
    parentKey: 'professor-politics-series',
    triggers: ['국제정치론 지도', '국제관계이론 지도'],
  },
  'professor-koreanpolitics': {
    label: '교수(한국정치론)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-koreanpolitics', needsMedicalSafety: false,
    parentKey: 'professor-politics-series',
    triggers: ['한국정치론 지도', '한국정당정치 지도'],
  },
  'professor-policystudies': {
    label: '교수(정책학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-policystudies', needsMedicalSafety: false,
    parentKey: 'professor-politics-series',
    triggers: ['정책학 지도', '정책결정이론 지도'],
  },
  'professor-computerscience-series': {
    label: '교수(전산학·컴퓨터공학 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-computerscience-series', needsMedicalSafety: false,
    parentKey: 'professor-electrical-computer',
    triggers: [], // 중계열 자체는 직접 호출 대상 아님 — 소계열이 리프
  },
  'professor-datastructures': {
    label: '교수(자료구조·알고리즘)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-datastructures', needsMedicalSafety: false,
    parentKey: 'professor-computerscience-series',
    triggers: ['자료구조 지도', '알고리즘 지도'],
  },
  'professor-database': {
    label: '교수(데이터베이스)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-database', needsMedicalSafety: false,
    parentKey: 'professor-computerscience-series',
    triggers: ['데이터베이스 지도', 'SQL 지도'],
  },
  'professor-operatingsystems': {
    label: '교수(운영체제)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-operatingsystems', needsMedicalSafety: false,
    parentKey: 'professor-computerscience-series',
    triggers: ['운영체제 지도', '프로세스관리 지도'],
  },
  'professor-computernetworks': {
    label: '교수(컴퓨터네트워크)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-computernetworks', needsMedicalSafety: false,
    parentKey: 'professor-computerscience-series',
    triggers: ['컴퓨터네트워크 지도', 'TCP/IP 지도'],
  },
  'professor-computerarchitecture': {
    label: '교수(컴퓨터구조)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-computerarchitecture', needsMedicalSafety: false,
    parentKey: 'professor-computerscience-series',
    triggers: ['컴퓨터구조 지도', 'CPU설계 지도'],
  },
  'professor-theoryofcomputation': {
    label: '교수(계산이론)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-theoryofcomputation', needsMedicalSafety: false,
    parentKey: 'professor-computerscience-series',
    triggers: ['계산이론 지도', '오토마타이론 지도'],
  },
  'professor-electrical-series': {
    label: '교수(전기공학 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-electrical-series', needsMedicalSafety: false,
    parentKey: 'professor-electrical-computer',
    triggers: [], // 중계열 자체는 직접 호출 대상 아님 — 소계열이 리프
  },
  'professor-circuittheory': {
    label: '교수(회로이론)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-circuittheory', needsMedicalSafety: false,
    parentKey: 'professor-electrical-series',
    triggers: ['회로이론 지도', '키르히호프법칙 지도'],
  },
  'professor-powerengineering': {
    label: '교수(전력공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-powerengineering', needsMedicalSafety: false,
    parentKey: 'professor-electrical-series',
    triggers: ['전력공학 지도', '송배전 지도'],
  },
  'professor-electricalmachinery': {
    label: '교수(전기기기학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-electricalmachinery', needsMedicalSafety: false,
    parentKey: 'professor-electrical-series',
    triggers: ['전기기기학 지도', '모터·발전기 지도'],
  },
  'professor-mechanicaleng-series': {
    label: '교수(기계공학 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-mechanicaleng-series', needsMedicalSafety: false,
    parentKey: 'professor-mechanical',
    triggers: [], // 중계열 자체는 직접 호출 대상 아님 — 소계열이 리프
  },
  'professor-thermodynamics': {
    label: '교수(열역학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-thermodynamics', needsMedicalSafety: false,
    parentKey: 'professor-mechanicaleng-series',
    triggers: ['열역학 지도', '열기관 지도'],
  },
  'professor-fluidmechanics': {
    label: '교수(유체역학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-fluidmechanics', needsMedicalSafety: false,
    parentKey: 'professor-mechanicaleng-series',
    triggers: ['유체역학 지도', '베르누이방정식 지도'],
  },
  'professor-solidmechanics': {
    label: '교수(고체역학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-solidmechanics', needsMedicalSafety: false,
    parentKey: 'professor-mechanicaleng-series',
    triggers: ['고체역학 지도', '재료역학 지도'],
  },
  'professor-dynamics': {
    label: '교수(동역학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-dynamics', needsMedicalSafety: false,
    parentKey: 'professor-mechanicaleng-series',
    triggers: ['동역학 지도', '운동방정식 지도'],
  },
  'professor-machinedesign': {
    label: '교수(기계설계)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-machinedesign', needsMedicalSafety: false,
    parentKey: 'professor-mechanicaleng-series',
    triggers: ['기계설계 지도', '기계요소설계 지도'],
  },
  'professor-history-series': {
    label: '교수(역사·고고학 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-history-series', needsMedicalSafety: false,
    parentKey: 'professor-humanities',
    triggers: [], // 중계열 자체는 직접 호출 대상 아님 — 소계열이 리프
  },
  'professor-koreanhistory': {
    label: '교수(한국사)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-koreanhistory', needsMedicalSafety: false,
    parentKey: 'professor-history-series',
    triggers: ['한국사 지도', '한국사 시대구분 지도'],
  },
  'professor-easternhistory': {
    label: '교수(동양사)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-easternhistory', needsMedicalSafety: false,
    parentKey: 'professor-history-series',
    triggers: ['동양사 지도', '중국사 지도'],
  },
  'professor-westernhistory': {
    label: '교수(서양사)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-westernhistory', needsMedicalSafety: false,
    parentKey: 'professor-history-series',
    triggers: ['서양사 지도', '유럽사 지도'],
  },
  'professor-archaeology': {
    label: '교수(고고학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-archaeology', needsMedicalSafety: false,
    parentKey: 'professor-history-series',
    triggers: ['고고학 지도', '발굴조사 지도'],
  },
  'professor-ethics-series': {
    label: '교수(철학·윤리학 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-ethics-series', needsMedicalSafety: false,
    parentKey: 'professor-humanities',
    triggers: [], // 중계열 자체는 직접 호출 대상 아님 — 소계열이 리프
  },
  'professor-metaphysics': {
    label: '교수(형이상학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-metaphysics', needsMedicalSafety: false,
    parentKey: 'professor-ethics-series',
    triggers: ['형이상학 지도', '존재론 지도'],
  },
  'professor-epistemology': {
    label: '교수(인식론)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-epistemology', needsMedicalSafety: false,
    parentKey: 'professor-ethics-series',
    triggers: ['인식론 지도', '지식론 지도'],
  },
  'professor-ethicstheory': {
    label: '교수(윤리학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-ethicstheory', needsMedicalSafety: false,
    parentKey: 'professor-ethics-series',
    triggers: ['윤리학이론 지도', '규범윤리학 지도'],
  },
  'professor-logic': {
    label: '교수(논리학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-logic', needsMedicalSafety: false,
    parentKey: 'professor-ethics-series',
    triggers: ['논리학 지도', '명제논리 지도'],
  },
  'professor-easternphilosophy': {
    label: '교수(동양철학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-easternphilosophy', needsMedicalSafety: false,
    parentKey: 'professor-ethics-series',
    triggers: ['동양철학 지도', '유교철학 지도'],
  },
  'professor-westernphilosophy': {
    label: '교수(서양철학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-westernphilosophy', needsMedicalSafety: false,
    parentKey: 'professor-ethics-series',
    triggers: ['서양철학 지도', '서양철학사 지도'],
  },
  'professor-business-series': {
    label: '교수(경영학 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-business-series', needsMedicalSafety: false,
    parentKey: 'professor-business-economics',
    triggers: [], // 중계열 자체는 직접 호출 대상 아님 — 소계열이 리프
  },
  'professor-hrorganization': {
    label: '교수(인사조직론)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-hrorganization', needsMedicalSafety: false,
    parentKey: 'professor-business-series',
    triggers: ['인사조직론 지도', '조직행동론 지도'],
  },
  'professor-marketing': {
    label: '교수(마케팅론)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-marketing', needsMedicalSafety: false,
    parentKey: 'professor-business-series',
    triggers: ['마케팅론 지도', '소비자행동론 지도'],
  },
  'professor-operationsmgmt': {
    label: '교수(생산운영관리)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-operationsmgmt', needsMedicalSafety: false,
    parentKey: 'professor-business-series',
    triggers: ['생산운영관리 지도', '품질관리 지도'],
  },
  'professor-strategy': {
    label: '교수(경영전략론)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-strategy', needsMedicalSafety: false,
    parentKey: 'professor-business-series',
    triggers: ['경영전략론 지도', 'SWOT분석 지도'],
  },
  'professor-internationalbusiness': {
    label: '교수(국제경영론)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-internationalbusiness', needsMedicalSafety: false,
    parentKey: 'professor-business-series',
    triggers: ['국제경영론 지도', '해외진출전략 지도'],
  },
  // ── 중계열(2단) 배치9 신설 6개 + 소계열(3단) 배치9: Tier 2(3개) + §4
  // 의료 전문과목(3개, 2026-08-10, 주피터님 지시). 의학·치의학·한의학은
  // 「전문의의 수련 및 자격 인정 등에 관한 규정」 제3조의 법정 전문과목
  // 수(26/10/8)를 그대로 따름 — 수의학은 한국에 법정 전문수의사 제도가
  // 아직 확립되지 않아(2026년 기준 도입 논의 단계) 이번 배치에서 제외.
  'professor-anthropology-series': {
    label: '교수(인류학 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-anthropology-series', needsMedicalSafety: false,
    parentKey: 'professor-socialscience',
    triggers: [], // 중계열 자체는 직접 호출 대상 아님 — 소계열이 리프
  },
  'professor-culturalanthropology': {
    label: '교수(문화인류학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-culturalanthropology', needsMedicalSafety: false,
    parentKey: 'professor-anthropology-series',
    triggers: ['문화인류학 지도', '민족지 지도'],
  },
  'professor-archaeologicalanthropology': {
    label: '교수(고고인류학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-archaeologicalanthropology', needsMedicalSafety: false,
    parentKey: 'professor-anthropology-series',
    triggers: ['고고인류학 지도', '선사시대 지도'],
  },
  'professor-linguisticanthropology': {
    label: '교수(언어인류학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-linguisticanthropology', needsMedicalSafety: false,
    parentKey: 'professor-anthropology-series',
    triggers: ['언어인류학 지도', '언어와문화 지도'],
  },
  'professor-geography-series': {
    label: '교수(지리학 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-geography-series', needsMedicalSafety: false,
    parentKey: 'professor-socialscience',
    triggers: [], // 중계열 자체는 직접 호출 대상 아님 — 소계열이 리프
  },
  'professor-physicalgeography': {
    label: '교수(자연지리학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-physicalgeography', needsMedicalSafety: false,
    parentKey: 'professor-geography-series',
    triggers: ['자연지리학 지도', '지형학 지도'],
  },
  'professor-humangeography': {
    label: '교수(인문지리학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-humangeography', needsMedicalSafety: false,
    parentKey: 'professor-geography-series',
    triggers: ['인문지리학 지도', '경제지리학 지도'],
  },
  'professor-gis': {
    label: '교수(지리정보시스템(GIS))', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-gis', needsMedicalSafety: false,
    parentKey: 'professor-geography-series',
    triggers: ['GIS 지도', '공간정보 지도'],
  },
  'professor-statistics-series': {
    label: '교수(통계학 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-statistics-series', needsMedicalSafety: false,
    parentKey: 'professor-mathphys',
    triggers: [], // 중계열 자체는 직접 호출 대상 아님 — 소계열이 리프
  },
  'professor-mathematicalstatistics': {
    label: '교수(수리통계학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-mathematicalstatistics', needsMedicalSafety: false,
    parentKey: 'professor-statistics-series',
    triggers: ['수리통계학 지도', '확률분포이론 지도'],
  },
  'professor-appliedstatistics': {
    label: '교수(응용통계학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-appliedstatistics', needsMedicalSafety: false,
    parentKey: 'professor-statistics-series',
    triggers: ['응용통계학 지도', '실험계획법 지도'],
  },
  'professor-biostatistics': {
    label: '교수(생물통계학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-biostatistics', needsMedicalSafety: false,
    parentKey: 'professor-statistics-series',
    triggers: ['생물통계학 지도', '임상시험통계 지도'],
  },
  'professor-medicine-specialty-series': {
    label: '교수(의학 전문과목 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-medicine-specialty-series', needsMedicalSafety: false,
    parentKey: 'professor-medicine-series',
    triggers: [], // 중계열 자체는 직접 호출 대상 아님 — 소계열이 리프
  },
  'professor-med-internalmedicine': {
    label: '교수(내과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-med-internalmedicine', needsMedicalSafety: false,
    parentKey: 'professor-medicine-specialty-series',
    triggers: ['내과학 지도', '내과 국시 지도'],
  },
  'professor-med-neurology': {
    label: '교수(신경과학(임상))', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-med-neurology', needsMedicalSafety: false,
    parentKey: 'professor-medicine-specialty-series',
    triggers: ['신경과 지도'],
  },
  'professor-med-psychiatry': {
    label: '교수(정신건강의학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-med-psychiatry', needsMedicalSafety: false,
    parentKey: 'professor-medicine-specialty-series',
    triggers: ['정신건강의학과 지도'],
  },
  'professor-med-generalsurgery': {
    label: '교수(외과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-med-generalsurgery', needsMedicalSafety: false,
    parentKey: 'professor-medicine-specialty-series',
    triggers: ['외과학 지도'],
  },
  'professor-med-orthopedics': {
    label: '교수(정형외과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-med-orthopedics', needsMedicalSafety: false,
    parentKey: 'professor-medicine-specialty-series',
    triggers: ['정형외과 지도'],
  },
  'professor-med-neurosurgery': {
    label: '교수(신경외과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-med-neurosurgery', needsMedicalSafety: false,
    parentKey: 'professor-medicine-specialty-series',
    triggers: ['신경외과 지도'],
  },
  'professor-med-thoracicsurgery': {
    label: '교수(심장혈관흉부외과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-med-thoracicsurgery', needsMedicalSafety: false,
    parentKey: 'professor-medicine-specialty-series',
    triggers: ['흉부외과 지도'],
  },
  'professor-med-plasticsurgery': {
    label: '교수(성형외과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-med-plasticsurgery', needsMedicalSafety: false,
    parentKey: 'professor-medicine-specialty-series',
    triggers: ['성형외과 지도'],
  },
  'professor-med-anesthesiology': {
    label: '교수(마취통증의학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-med-anesthesiology', needsMedicalSafety: false,
    parentKey: 'professor-medicine-specialty-series',
    triggers: ['마취통증의학과 지도'],
  },
  'professor-med-obgyn': {
    label: '교수(산부인과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-med-obgyn', needsMedicalSafety: false,
    parentKey: 'professor-medicine-specialty-series',
    triggers: ['산부인과 지도'],
  },
  'professor-med-pediatrics': {
    label: '교수(소아청소년과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-med-pediatrics', needsMedicalSafety: false,
    parentKey: 'professor-medicine-specialty-series',
    triggers: ['소아청소년과 지도'],
  },
  'professor-med-ophthalmology': {
    label: '교수(안과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-med-ophthalmology', needsMedicalSafety: false,
    parentKey: 'professor-medicine-specialty-series',
    triggers: ['안과 지도'],
  },
  'professor-med-otolaryngology': {
    label: '교수(이비인후과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-med-otolaryngology', needsMedicalSafety: false,
    parentKey: 'professor-medicine-specialty-series',
    triggers: ['이비인후과 지도'],
  },
  'professor-med-dermatology': {
    label: '교수(피부과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-med-dermatology', needsMedicalSafety: false,
    parentKey: 'professor-medicine-specialty-series',
    triggers: ['피부과 지도'],
  },
  'professor-med-urology': {
    label: '교수(비뇨의학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-med-urology', needsMedicalSafety: false,
    parentKey: 'professor-medicine-specialty-series',
    triggers: ['비뇨의학과 지도'],
  },
  'professor-med-radiology': {
    label: '교수(영상의학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-med-radiology', needsMedicalSafety: false,
    parentKey: 'professor-medicine-specialty-series',
    triggers: ['영상의학과 지도'],
  },
  'professor-med-radiationoncology': {
    label: '교수(방사선종양학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-med-radiationoncology', needsMedicalSafety: false,
    parentKey: 'professor-medicine-specialty-series',
    triggers: ['방사선종양학과 지도'],
  },
  'professor-med-pathology': {
    label: '교수(병리학(임상))', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-med-pathology', needsMedicalSafety: false,
    parentKey: 'professor-medicine-specialty-series',
    triggers: ['병리과 지도'],
  },
  'professor-med-labmedicine': {
    label: '교수(진단검사의학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-med-labmedicine', needsMedicalSafety: false,
    parentKey: 'professor-medicine-specialty-series',
    triggers: ['진단검사의학과 지도'],
  },
  'professor-med-tuberculosis': {
    label: '교수(결핵과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-med-tuberculosis', needsMedicalSafety: false,
    parentKey: 'professor-medicine-specialty-series',
    triggers: ['결핵과 지도'],
  },
  'professor-med-rehabmedicine': {
    label: '교수(재활의학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-med-rehabmedicine', needsMedicalSafety: false,
    parentKey: 'professor-medicine-specialty-series',
    triggers: ['재활의학과 지도'],
  },
  'professor-med-preventivemedicine': {
    label: '교수(예방의학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-med-preventivemedicine', needsMedicalSafety: false,
    parentKey: 'professor-medicine-specialty-series',
    triggers: ['예방의학과 지도'],
  },
  'professor-med-familymedicine': {
    label: '교수(가정의학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-med-familymedicine', needsMedicalSafety: false,
    parentKey: 'professor-medicine-specialty-series',
    triggers: ['가정의학과 지도'],
  },
  'professor-med-emergencymedicine': {
    label: '교수(응급의학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-med-emergencymedicine', needsMedicalSafety: false,
    parentKey: 'professor-medicine-specialty-series',
    triggers: ['응급의학과 지도'],
  },
  'professor-med-nuclearmedicine': {
    label: '교수(핵의학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-med-nuclearmedicine', needsMedicalSafety: false,
    parentKey: 'professor-medicine-specialty-series',
    triggers: ['핵의학과 지도'],
  },
  'professor-med-occupationalmedicine': {
    label: '교수(직업환경의학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-med-occupationalmedicine', needsMedicalSafety: false,
    parentKey: 'professor-medicine-specialty-series',
    triggers: ['직업환경의학과 지도'],
  },
  'professor-dentistry-specialty-series': {
    label: '교수(치의학 전문과목 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-dentistry-specialty-series', needsMedicalSafety: false,
    parentKey: 'professor-medicine-series',
    triggers: [], // 중계열 자체는 직접 호출 대상 아님 — 소계열이 리프
  },
  'professor-dent-omfs': {
    label: '교수(구강악안면외과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-dent-omfs', needsMedicalSafety: false,
    parentKey: 'professor-dentistry-specialty-series',
    triggers: ['구강악안면외과 지도'],
  },
  'professor-dent-prosthodontics': {
    label: '교수(치과보철학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-dent-prosthodontics', needsMedicalSafety: false,
    parentKey: 'professor-dentistry-specialty-series',
    triggers: ['치과보철학 지도'],
  },
  'professor-dent-orthodontics': {
    label: '교수(치과교정학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-dent-orthodontics', needsMedicalSafety: false,
    parentKey: 'professor-dentistry-specialty-series',
    triggers: ['치과교정학 지도'],
  },
  'professor-dent-pediatricdentistry': {
    label: '교수(소아치과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-dent-pediatricdentistry', needsMedicalSafety: false,
    parentKey: 'professor-dentistry-specialty-series',
    triggers: ['소아치과학 지도'],
  },
  'professor-dent-periodontics': {
    label: '교수(치주과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-dent-periodontics', needsMedicalSafety: false,
    parentKey: 'professor-dentistry-specialty-series',
    triggers: ['치주과학 지도'],
  },
  'professor-dent-conservative': {
    label: '교수(치과보존학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-dent-conservative', needsMedicalSafety: false,
    parentKey: 'professor-dentistry-specialty-series',
    triggers: ['치과보존학 지도'],
  },
  'professor-dent-oralmedicine': {
    label: '교수(구강내과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-dent-oralmedicine', needsMedicalSafety: false,
    parentKey: 'professor-dentistry-specialty-series',
    triggers: ['구강내과학 지도'],
  },
  'professor-dent-oralradiology': {
    label: '교수(구강악안면방사선학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-dent-oralradiology', needsMedicalSafety: false,
    parentKey: 'professor-dentistry-specialty-series',
    triggers: ['구강악안면방사선학 지도'],
  },
  'professor-dent-oralpathology': {
    label: '교수(구강병리학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-dent-oralpathology', needsMedicalSafety: false,
    parentKey: 'professor-dentistry-specialty-series',
    triggers: ['구강병리학 지도'],
  },
  'professor-dent-preventivedentistry': {
    label: '교수(예방치과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-dent-preventivedentistry', needsMedicalSafety: false,
    parentKey: 'professor-dentistry-specialty-series',
    triggers: ['예방치과학 지도'],
  },
  'professor-koreanmedicine-specialty-series': {
    label: '교수(한의학 전문과목 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-koreanmedicine-specialty-series', needsMedicalSafety: false,
    parentKey: 'professor-medicine-series',
    triggers: [], // 중계열 자체는 직접 호출 대상 아님 — 소계열이 리프
  },
  'professor-kmed-internalmedicine': {
    label: '교수(한방내과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-kmed-internalmedicine', needsMedicalSafety: false,
    parentKey: 'professor-koreanmedicine-specialty-series',
    triggers: ['한방내과학 지도'],
  },
  'professor-kmed-obgyn': {
    label: '교수(한방부인과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-kmed-obgyn', needsMedicalSafety: false,
    parentKey: 'professor-koreanmedicine-specialty-series',
    triggers: ['한방부인과학 지도'],
  },
  'professor-kmed-pediatrics': {
    label: '교수(한방소아과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-kmed-pediatrics', needsMedicalSafety: false,
    parentKey: 'professor-koreanmedicine-specialty-series',
    triggers: ['한방소아과학 지도'],
  },
  'professor-kmed-neuropsychiatry': {
    label: '교수(한방신경정신과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-kmed-neuropsychiatry', needsMedicalSafety: false,
    parentKey: 'professor-koreanmedicine-specialty-series',
    triggers: ['한방신경정신과학 지도'],
  },
  'professor-kmed-acupuncture': {
    label: '교수(침구학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-kmed-acupuncture', needsMedicalSafety: false,
    parentKey: 'professor-koreanmedicine-specialty-series',
    triggers: ['침구학 지도'],
  },
  'professor-kmed-eentderm': {
    label: '교수(한방안이비인후피부과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-kmed-eentderm', needsMedicalSafety: false,
    parentKey: 'professor-koreanmedicine-specialty-series',
    triggers: ['한방안이비인후피부과학 지도'],
  },
  'professor-kmed-rehab': {
    label: '교수(한방재활의학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-kmed-rehab', needsMedicalSafety: false,
    parentKey: 'professor-koreanmedicine-specialty-series',
    triggers: ['한방재활의학 지도'],
  },
  'professor-kmed-sasang': {
    label: '교수(사상체질과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-kmed-sasang', needsMedicalSafety: false,
    parentKey: 'professor-koreanmedicine-specialty-series',
    triggers: ['사상체질의학 지도'],
  },
};
