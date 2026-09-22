/// <reference path="../pb_data/types.d.ts" />
// gwp_registry 시딩 — gwp-registry.js(core tier)의 기존 21개 서비스를
// 그대로 옮겨 심는다. GWP-REGISTRY-SCALING_v1_0.md의 "core도 결국 이
// 테이블에서 조회 가능하게" 방향의 첫 단추 — 지금 당장 gwp-registry.js를
// 대체하지는 않지만(client 코드가 여전히 그 파일을 직접 import),
// 검색·장기 통합 대상으로 동일 데이터를 이 테이블에도 존재하게 한다.
migrate((db) => {
  const dao = new Dao(db);
  const col = dao.findCollectionByNameOrId("gwp_registry");

  {
    const rec = new Record(col);
    rec.set("gwp_id", "kemergency");
    rec.set("name", "K-Emergency");
    rec.set("tier", "core");
    rec.set("category", "EMG");
    rec.set("keywords", "긴급 응급 119 112 살려줘 화재 불났어 구조 사고 쓰러졌어 다쳤어 심정지 익사 지진 홍수 가스 누출 위험해");
    rec.set("jurisdiction", "national");
    rec.set("file_ref", "kemergency");
    rec.set("status", "active");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(col);
    rec.set("gwp_id", "klaw");
    rec.set("name", "K-Law");
    rec.set("tier", "core");
    rec.set("category", "JUS");
    rec.set("keywords", "소송 고소 고발 판결 재판 법원 계약서 손해배상 위법 불법 형사 민사 이혼 상속 부당해고 명예훼손 저작권 사기 횡령 배임 변호사 법률 판례 헌법소원 임금체불 산재 내용증명 고소장 형량 처벌");
    rec.set("jurisdiction", "national");
    rec.set("file_ref", "klaw");
    rec.set("status", "active");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(col);
    rec.set("gwp_id", "kpolice");
    rec.set("name", "K-Police");
    rec.set("tier", "core");
    rec.set("category", "JUS");
    rec.set("keywords", "경찰 112 신고 범죄 절도 폭행 성범죄 스토킹 강도 운동 강도 필라테스 강도 협박 납치 강도 가정폭력 수사 증거");
    rec.set("jurisdiction", "national");
    rec.set("file_ref", "kpolice");
    rec.set("status", "active");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(col);
    rec.set("gwp_id", "ksecurity");
    rec.set("name", "K-Security");
    rec.set("tier", "core");
    rec.set("category", "JUS");
    rec.set("keywords", "해킹 피싱 스미싱 보이스피싱 계정 탈취 랜섬웨어 악성코드 개인정보 유출 사이버 범죄 비밀번호 유출");
    rec.set("jurisdiction", "national");
    rec.set("file_ref", "ksecurity");
    rec.set("status", "active");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(col);
    rec.set("gwp_id", "khealth");
    rec.set("name", "K-Health");
    rec.set("tier", "core");
    rec.set("category", "MED");
    rec.set("keywords", "아파요 병원 증상 처방 진단 의사 수술 약 건강 검진 통증 열이 나 기침 두통 복통 혈압 당뇨 암 응급실 입원 처방전 예방접종 우울증 불면증");
    rec.set("jurisdiction", "national");
    rec.set("file_ref", "khealth");
    rec.set("status", "active");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(col);
    rec.set("gwp_id", "kedu");
    rec.set("name", "K-School");
    rec.set("tier", "core");
    rec.set("category", "EDU");
    rec.set("keywords", "공부 학습 교육 과목 진로 시험 강의 자격증 논문 입학 졸업 취업 숙제 과제 수능 학점");
    rec.set("jurisdiction", "national");
    rec.set("file_ref", "kedu");
    rec.set("status", "active");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(col);
    rec.set("gwp_id", "kgdc");
    rec.set("name", "GDC");
    rec.set("tier", "core");
    rec.set("category", "ECO");
    rec.set("keywords", "GDC 결제 송금 환전 이체 잔고 대출 고팡 화폐 디지털 화폐 GDC 충전 글로벌 결제");
    rec.set("jurisdiction", "national");
    rec.set("file_ref", "kgdc");
    rec.set("status", "active");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(col);
    rec.set("gwp_id", "kfinance");
    rec.set("name", "K-Stock");
    rec.set("tier", "core");
    rec.set("category", "ECO");
    rec.set("keywords", "주식 투자 포트폴리오 ETF 자산 펀드 채권 암호화폐 비트코인 환율 리밸런싱 절세 IRP ISA 배당주 공모주 수익률 재테크");
    rec.set("jurisdiction", "national");
    rec.set("file_ref", "kfinance");
    rec.set("status", "active");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(col);
    rec.set("gwp_id", "kinsurance");
    rec.set("name", "K-Insurance");
    rec.set("tier", "core");
    rec.set("category", "ECO");
    rec.set("keywords", "보험 보장 청구 보험료 실손 자동차보험 보험금 생명보험 화재보험 보험 가입 보험 해지");
    rec.set("jurisdiction", "national");
    rec.set("file_ref", "kinsurance");
    rec.set("status", "active");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(col);
    rec.set("gwp_id", "ktax");
    rec.set("name", "K-Tax");
    rec.set("tier", "core");
    rec.set("category", "ECO");
    rec.set("keywords", "세금 부가세 종합소득세 세무 납부 연말정산 환급 세무조사 관세 재산세 증여세 상속세 국세청 홈택스 전자세금계산서");
    rec.set("jurisdiction", "national");
    rec.set("file_ref", "ktax");
    rec.set("status", "active");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(col);
    rec.set("gwp_id", "kcommerce");
    rec.set("name", "K-Market");
    rec.set("tier", "core");
    rec.set("category", "MKT");
    rec.set("keywords", "주문 배달 음식 쇼핑 구매 상점 시장 시켜 맛집 식당 상품 가격 예약 반품 교환 거래 마켓");
    rec.set("jurisdiction", "national");
    rec.set("file_ref", "kcommerce");
    rec.set("status", "active");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(col);
    rec.set("gwp_id", "ktransport");
    rec.set("name", "K-Traffic");
    rec.set("tier", "core");
    rec.set("category", "TRN");
    rec.set("keywords", "택시 교통 차량 배차 길찾기 막히다 정체 우회 도로 내비게이션 버스 지하철 주차");
    rec.set("jurisdiction", "national");
    rec.set("file_ref", "ktransport");
    rec.set("status", "active");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(col);
    rec.set("gwp_id", "klogistics");
    rec.set("name", "K-Logistics");
    rec.set("tier", "core");
    rec.set("category", "TRN");
    rec.set("keywords", "배송 물류 택배 운송 창고 재고 통관 반품 배송 추적 배송 지연 국제 배송 관세");
    rec.set("jurisdiction", "national");
    rec.set("file_ref", "klogistics");
    rec.set("status", "active");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(col);
    rec.set("gwp_id", "jeju");
    rec.set("name", "제주도청 AI");
    rec.set("tier", "core");
    rec.set("category", "GOV");
    rec.set("keywords", "제주도청 제주특별자치도청 제주시청 서귀포시청 제주특별자치도 제주 행정 도지사 제주콜센터 애월읍 조천읍 구좌읍 한경면 추자면 우도면 대정읍 남원읍 성산읍 안덕면 표선면 일도1동 일도2동 이도1동 이도2동 삼도1동 삼도2동 용담1동 용담2동 건입동 화북동 삼양동 봉개동 아라동 오라동 연동 노형동 외도동 이호동 도두동 송산동 정방동 중앙동 천지동 효돈동 영천동 동홍동 서홍동 대륜동 대천동 중문동 예래동 한림읍");
    rec.set("jurisdiction", "national");
    rec.set("file_ref", "jeju");
    rec.set("status", "active");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(col);
    rec.set("gwp_id", "kgov");
    rec.set("name", "K-Public");
    rec.set("tier", "core");
    rec.set("category", "GOV");
    rec.set("keywords", "민원 등본 주민등록 복지 행정 공공 허가 시청 도청 구청 발급 증명서 전입신고 사업자 등록 운전면허 여권 국민연금 고용보험");
    rec.set("jurisdiction", "national");
    rec.set("file_ref", "kgov");
    rec.set("status", "active");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(col);
    rec.set("gwp_id", "kdemocracy");
    rec.set("name", "K-Democracy");
    rec.set("tier", "core");
    rec.set("category", "LEG");
    rec.set("keywords", "투표 안건 민주주의 정책 DAWN 의결 안건 제안 고팡 운영 배심원 찬성 반대 발의");
    rec.set("jurisdiction", "national");
    rec.set("file_ref", "kdemocracy");
    rec.set("status", "active");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(col);
    rec.set("gwp_id", "kbusiness");
    rec.set("name", "K-Business");
    rec.set("tier", "core");
    rec.set("category", "BIZ");
    rec.set("keywords", "재무제표 손익계산서 대차대조표 사업자 세금 부가세 신고 사업자 세무 법인세 4대보험 급여 계산 직원 급여 고용보험 신고 인건비 경영 분석 매출 분석 사업 자금 노란우산공제 사업자 회계 원천세 판매자 정산");
    rec.set("jurisdiction", "national");
    rec.set("file_ref", "kbusiness");
    rec.set("status", "active");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(col);
    rec.set("gwp_id", "fiil-kcleaner");
    rec.set("name", "K-Clean");
    rec.set("tier", "core");
    rec.set("category", "ENV");
    rec.set("keywords", "쓰레기 환경 해안 분리수거 청소 오염 폐기물 불법 투기 해변 해양 오염 폐수 불법 배출");
    rec.set("jurisdiction", "national");
    rec.set("file_ref", "fiil-kcleaner");
    rec.set("status", "active");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(col);
    rec.set("gwp_id", "ksearch");
    rec.set("name", "K-Search");
    rec.set("tier", "core");
    rec.set("category", "UTL");
    rec.set("keywords", "찾아줘 연결해줘 불러줘 아는 사람 그분 그 사람 누구였지 아이디 찾 핸들 찾 프로필 찾");
    rec.set("jurisdiction", "national");
    rec.set("file_ref", "ksearch");
    rec.set("status", "active");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(col);
    rec.set("gwp_id", "tool-web-search");
    rec.set("name", "웹 검색");
    rec.set("tier", "core");
    rec.set("category", "TOOL");
    rec.set("keywords", "검색해줘 찾아줘 최신 뉴스 오늘 지금 실시간 날씨 환율 주가 시세 최근");
    rec.set("jurisdiction", "national");
    rec.set("file_ref", "tool-web-search");
    rec.set("status", "active");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(col);
    rec.set("gwp_id", "tool-calculator");
    rec.set("name", "계산기");
    rec.set("tier", "core");
    rec.set("category", "TOOL");
    rec.set("keywords", "계산 얼마 합계 퍼센트 % 환산");
    rec.set("jurisdiction", "national");
    rec.set("file_ref", "tool-calculator");
    rec.set("status", "active");
    dao.saveRecord(rec);
  }
}, (db) => {
  const dao = new Dao(db);
  const records = dao.findRecordsByFilter("gwp_registry", "tier = 'core'", "", 100, 0);
  for (const r of records) {
    dao.deleteRecord(r);
  }
})
