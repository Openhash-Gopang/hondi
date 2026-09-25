# 03-do-agency division 정리 (2026-09-22, 별표 8·9 원문 반영)

시행규칙 별표 8(직속기관별 분장사무)·별표 9(사업소별 분장사무) 원문을 확보해 대조한 결과,
농업기술원(SP-AGY-AGRITECH)·보건환경연구원(SP-AGY-BOHWAN)·축산생명연구원(SP-AGY-CHUKSAN)
산하 division의 이름·구성이 실제 조직과 전혀 달랐다(예: 농업기술원은 "행정운영과·기술보급과·
연구개발과" 3개였으나 실제로는 "총무과·농산물원종장·농업디지털센터·미래농업육성과·친환경연구과·
과수연구과·원예작물과·기술지원조정과·농업기술센터" 9개다).

이 세 기관은 division 파일 어디에도 실제 서비스에 연결된 task_key(GOV_TASK 접수 파이프라인)가
없는 것을 먼저 확인했다(2026-09-22) — 그래서 안전하게 archive로 옮기고 새로 만들 수 있었다.
(다른 6개 기관 — 도립미술관·민속자연사박물관·세계유산본부·한라도서관·자치경찰단·상하수도본부 —
은 일부 division에 실제 배선이 있어 같은 방식을 그대로 적용할 수 없다. §11-3의 다음 배치 참고.)

- `SP-AGYDIV-AGRITECH-ADMIN/EXTENSION/RESEARCH_v1.0.md` → 새 division 9개
  (`prompts/gov-tree/kfoi-digest/org-baseline-agency.json` §농업기술원 참고)로 대체
- `SP-AGYDIV-BOHWAN-ENVIRONMENT/HEALTH_v1.0.md` → 새 division 9개로 대체
- `SP-AGYDIV-CHUKSAN-RESEARCH_v1.0.md` → 새 division 2개로 대체(기관·과 이름 자체가
  2024.7.9. 축산진흥원→축산생명연구원, 축산진흥과→축산생명과로 개명된 것도 함께 확인)

새 division들은 §2(완결 처리 업무)에 별표 8·9(2024.01.22. 개정본)의 실제 사무를 담았다.
그 뒤 개편 여부는 각 파일이 정직하게 "확인하지 못함"으로 밝히고 있다.

# 2026-09-22 — 한라도서관(SP-AGY-LIBRARY) division 2개 정리

- `SP-AGYDIV-LIBRARY-INFOSERVICE_v1.1.md`(정보서비스팀), `SP-AGYDIV-LIBRARY-POLICY_v1.0.md`(정책협력팀) →
  둘 다 스스로 "(추정)"이라고 밝힌 잠정 명칭이었다(일반 도서관 조직 관행 기준 추정, 위키백과 근거).
  GOV-TASK-904-GAP 판정(2026-08-21)에서 "GOV_TASK 대상이 아니다"로 결론 났을 뿐 실제 서비스 배선
  (task_key)은 없었다 — 확인 후 안전하게 archive로 옮겼다.
- 새 division 2개(운영과·문헌정보과, 시행규칙 제52·53조·별표9 확인)로 대체했다.

# 2026-09-22 — 자치경찰단(SP-AGY-POLICE) division 정리(부분)

- `SP-AGYDIV-POLICE-SAFETY_v1.1.md`(생활안전과, 배선 없음), `SP-AGYDIV-POLICE-WOMENYOUTH_v1.0.md`
  (여성청소년과, 배선 없음·시행규칙 원문에 없는 과) → 별표8(2024.01.22. 개정본) 확인 결과 실제
  6개 division(경찰정책관·수사과·교통생활안전과·관광경찰과·서귀포지역경찰대·교통정보센터)으로
  교체하며 archive로 이동.
- `SP-AGYDIV-POLICE-TRAFFIC_v1.1.md`(교통과)는 **그대로 두었다** — 주차위반 과태료 이의신청
  task_key에 실제로 배선돼 있다. 새로 만든 "교통생활안전과"·"교통정보센터"와 업무가 겹칠 수
  있으나, 배선을 끊지 않기 위해 이번 배치에서는 정리하지 않고 각 division의 §3에 상호 참고만
  남겼다 — 다음 배치에서 실제 최신 별표로 재검증 후 통합 여부 결정.

# 2026-09-22 — 민속자연사박물관(SP-AGY-FOLKMUSEUM) division 정리(부분)

- `SP-AGYDIV-FOLKMUSEUM-ARCHAEOFOLK/MARINE/MINERALBOTANY/ZOOLOGY_v1.0.md`(고고민속과·해양생물과·
  광식물과·동물과, 전부 배선 없음) → 별표9(2024.01.22. 개정본) 확인 결과 실제 2개 division
  (운영과·민속자연사연구과)으로 교체하며 archive로 이동.
- `SP-AGYDIV-FOLKMUSEUM-ADMIN_v1.1.md`(관리실)는 **그대로 두었다** — 시설 대관 신청 task_key에
  실제로 배선돼 있다. 새로 만든 "운영과"(시설·예산·관람객 지원 포함)와 업무가 겹칠 수 있으나,
  배선을 끊지 않기 위해 이번 배치에서는 정리하지 않고 각 division의 §3에 상호 참고만 남겼다.

# 2026-09-23 — 도립미술관·상하수도본부·세계유산본부(SP-AGY-ARTMUSEUM/WATER/HERITAGE) division 일괄 정리

나머지 3개 기관을 한 배치로 정리했다(사용자 요청 — "나머지 셋은 한꺼번에 일괄 제출").

- **도립미술관**(3개 → 4개 실명): 별표9 실명이 이미 `운영과·학예연구과·제주현대미술관·김창열미술관`
  4개로 확인됐다. 제주현대미술관(`SP-AGYDIV-ARTMUSEUM-JHYUN_v1.1.md`, 대관 신청 task_key 배선)은
  이름이 이미 일치해 그대로 두었다. 김창열미술관(`SP-AGYDIV-ARTMUSEUM-KIMTSCHANGYEUL_v1.0.md`)도
  이름은 일치했지만 배선이 없어 §2를 별표9 실제 사무로 다시 썼다 — **파일명·버전은 v1.0 그대로
  유지했다**(division-tables.js가 `_v1.0.md` 경로를 참조하고 있어, 버전을 올리며 파일명을 바꾸면
  라우팅이 깨진다). 새 division 2개(운영과·학예연구과)를 신설했다. 본관(`SP-AGYDIV-ARTMUSEUM-MAIN_v1.1.md`)은
  **그대로 두었다** — 대관 신청 task_key에 배선돼 있으나 별표9 실명 4개에는 없는 이름이다. 새로 만든
  운영과와 업무(전시·대관·교육프로그램)가 겹칠 수 있어 다음 배치에서 재정리 필요.
- **상하수도본부**(3개 → 9개 실명): 경영지원과·하수도과(둘 다 배선 없음)는 별표9 실제 9개 division
  (경영관리과·상수도정책시설과·상수도생산관리과·누수방지과·하수계획과·하수시설과·제주하수운영과·
  서귀포하수운영과·총괄과)으로 교체하며 archive로 이동. 상수도과(`SP-AGYDIV-WATER-WATERSUPPLY_v1.1.md`)는
  **그대로 두었다** — 급수공사 신청 task_key에 배선돼 있으나 별표9 실명 9개에는 없는 이름이다. 새로
  만든 상수도정책시설과 등과 업무가 겹칠 수 있어 다음 배치에서 재정리 필요.
- **세계유산본부**(2개 → 10개 실명, §10-2 해결): 한라산연구과(배선 없음)는 archive로 이동. 유산관리과
  (`SP-AGYDIV-HERITAGE-MANAGEMENT_v1.1.md`)는 **그대로 두었다** — 문화재 현상변경허가 task_key에
  배선돼 있으나 별표9 실명 10개에는 없는 이름이다. 새 division 10개를 신설했는데, 그중 한라산연구부
  4개(수목원운영과·생물권지질공원연구과·생물자원연구과·산림환경연구과)·한라산국립공원관리소 2개
  (관리운영과·공원보호과)는 별표9 이름이 org-baseline-agency.json(2026-08-25 시행 제938호 확인)과
  그대로 일치해 confidence high다. 나머지 유산정책부 4개(유산정책과·문화유산과·자연유산과·세계유산과)는
  이름 자체는 조례 본문(제38~39조)·org-baseline-agency.json으로 확인했지만(§10-2 — 본문·별표9의
  부서명이 다르던 문제 해결), 별표9(2024.01.22)의 옛 이름(세계유산정책과·역사문화재과·자연문화재과·
  문화유적관리과) 사무를 2024.5.17. 국가유산기본법 체계 개편(문화재→국가유산·문화유산·자연유산 재편)에
  따른 명칭 대응으로 옮겨 실은 것이라 **개별 사무 배정은 confidence medium** — 각 division이 §2·§4에서
  스스로 "§10-2 미해결 흔적"으로 플래그한다. 원문(별표9 최신 개정본) 재확보 전까지는 추정으로 취급할 것.
- 이번 배치로 org-baseline-agency.json의 9개 기관 전부가 `status: "match"`가 됐다(structure_differs 0).
- `division-tables.js`·`pages/jeju-gov-automation.html`(페이지 인벤토리) 양쪽의 라우팅 항목도 함께
  갱신했다 — archive로 옮긴 파일을 가리키던 죽은 참조 3건을 없애고 새 division 21개를 추가했다.
  `pages/k-government.html`은 이전 배치들도 갱신하지 않은 별도 govCode 메뉴 데이터라(이미 BOHWAN·
  CHUKSAN 등 예전 이름이 남아 있음) 이번에도 손대지 않았다 — 범위 밖으로 남겨둔다.

# 2026-09-23 — 3쌍(배선된 division ↔ 새 division) §3 경계 정리

바로 위 배치에서 "다음 배치에서 재정리 필요"로 남긴 3건을 정리했다. 배선(task_key)은 어느 쪽도
끊지 않았다 — 실제로 겹치는 두 SP의 역할을 문서에 명시적으로 나눠, LLM이 두 division 중 어느
쪽이 실제 신청 접수를 처리하는지 헷갈리지 않게 했다.

- **본관(MAIN, `artmuseum_main_facility_rental`) ↔ 운영과(ADMIN)**: 본관 전시실 대관 신청의 접수·
  심사는 본관이 계속 맡고, 운영과는 미술관 전체 예산·인사·홍보·업무협력 총괄행정만 답한다.
- **상수도과(WATERSUPPLY, `water_connection_application`) ↔ 상수도정책시설과(POLICYFACILITY)**:
  개별 급수공사신청의 접수·심사는 상수도과가 계속 맡고, 상수도정책시설과는 광역화·원인자부담금·
  수도정비기본계획 등 정책·제도 문의만 답한다.
- **유산관리과(MANAGEMENT, `heritage_alteration_permit`) ↔ 문화유산과(CULTURALHERITAGE)·자연유산과
  (NATURALHERITAGE)**: 문화유산·자연유산 어느 쪽이든 현상변경허가 신청의 접수·심사는 유산관리과가
  하나로 맡고, 문화유산과·자연유산과는 각 분야의 지정·조사·시설 운영 등 사무만 답한다.

테스트 2건(작업 #11)을 추가해 6개 division 전부에 경계 문구가 있는지, 그리고 이 정리 과정에서
배선된 3개 division의 task_key가 실수로 바뀌거나 사라지지 않았는지 회귀 검증했다.

# 2026-09-23 — 공공정책연수원·보훈청(SP-AGY-PUBLICPOLICY/VETERANS) 기관·division 신설(작업 #12)

지금까지는 기존 SP를 고치는 배치였지만, 이번은 **인벤토리에 SP 자체가 아예 없던** 기관 2개를
처음부터 신설했다 — org-baseline-agency.json의 `missing_in_inventory`(SP가 없어 대조조차 못 한
법정 기관 15개) 중 "공공정책연수원"(1개 division)·"보훈청"(3개 division)을 확인해 만들었다.

- **공공정책연수원**(`SP-AGY-PUBLICPOLICY`, 교육운영과 1개): 시행규칙 제25~26조·별표8(2024.01.22.
  개정본)로 기관 SP와 하위 `SP-AGYDIV-PUBLICPOLICY-EDUCATION`을 함께 신설했다. 별표8 원문에서
  25번 항목이 "공무원사이버외국어교육과정 운영 26 자치경찰 직무교육 등 운영 27 공공기관(공기업,
  출자출연기관) 직무교육 등 운영"처럼 줄바꿈이 소실된 채 한 줄에 뭉쳐 있었다 — 3개 항목(25·26·27)으로
  풀어 다시 번호를 매기고, 이어지는 "그 밖에…" 항목은 26번이 아니라 28번으로 정정했다(division 파일
  버전 이력·§2에 정직하게 밝힘). 산하 division이 1개뿐이라 기관 SP와 division SP의 §2가 실질적으로
  거의 겹치는데, 이는 조직 설계상 사실이지 작성 결함이 아니다(기관 SP §6에 명시).
- **보훈청**(`SP-AGY-VETERANS`, 보훈과·보상과·항일기념관 3개): 시행규칙 제31~32조·별표8(2024.01.22.
  개정본)로 기관 SP와 하위 division 3개를 함께 신설했다. 항일기념관 division은 별표8 원문상 사무가
  2건뿐인데, 이는 §2의 누락이 아니라 원문 자체가 그렇다(정직하게 밝힘). 보훈과(예우·기념사업 중심)와
  보상과(등록·보상금 지급 등 처분성 사무 중심)는 사무가 겹치지 않도록 각 division §3에 상호 참고를
  남겼다.
- **명칭 중복 미해결**: `src/gopang/gov/gov-router.js`의 `JEJU_NATIONAL_TABLE`에는 이미
  `SP-NAT-VETERANS`("제주보훈청(국가보훈부)")가 "보훈청" 등의 키워드로 등록돼 있다. 이번에 신설한
  `SP-AGY-VETERANS`는 org-baseline-agency.json이 도 "직속기관"(제31~32조)으로 분류한 기관이라 —
  현실에서 보훈 행정이 통상 국가보훈부 소속 지방보훈(지)청 체계로 운영되는 점과 이 저장소의 조례·
  시행규칙 데이터가 어떻게 정합되는지는 이번 조사에서 확정하지 못했다. `division-tables.js`의 `kw`도
  이 명칭 중복을 피해 "보훈청" 단독 키워드는 넣지 않고 기관명 전체·division 고유 사무명 위주로만
  구성했다 — gov-router.js 쪽 실제 라우팅 연결 여부는 다음 배치에서 재검증할 것(SP-AGY-VETERANS_v1.0.md
  §6에 상세 기록).
- **연락처 확인 못 함**: 두 기관 모두 jeju.go.kr 공식 홈페이지 접속을 시도했으나(robots.txt·타임아웃)
  실패해 대표전화·소재지는 "확인하지 못함"으로 명시했다(TBD가 아니라 명시적 미확인 표기).
- 이 6개 SP(기관 2·division 4) 어디에도 실제 서비스에 연결된 task_key가 없는 것을 먼저 확인했다
  (2026-09-23) — 그래서 archive 이동 없이 바로 신설만으로 끝났다(기존 batch10/11처럼 배선된 division과의
  경계 정리는 필요 없었다).
- `division-tables.js`·`pages/jeju-gov-automation.html`·`org-baseline-agency.json`(missing_in_inventory→
  mapping 이동) 세 곳 모두 갱신했고, `src/tests/kfoi-duties-raw.test.mjs`에 작업 #12 테스트 5건을,
  `src/tests/kfoi-digest.test.mjs`의 기존 org_counts/missing_in_inventory 검증을 9→11·15→13으로 갱신했다.
  `tools/check_stale_refs.py`(668건 전부 정상)·clean-clone 재검증도 통과했다.

# 2026-09-23 — 문화예술진흥원 등 7개 기관·division 17개 신설(작업 #13)

작업 #12에 이어, org-baseline-agency.json의 `missing_in_inventory`(SP 자체가 없어 대조조차 못 한 법정
기관) 중 confidence high로 확인된 나머지 7개를 처음부터 신설했다 — 문화예술진흥원(2개 division)·
해양수산연구원(5개)·동물위생시험소(2개)·설문대여성문화센터(1개)·돌문화공원관리소(2개)·고용센터(4개)·
중앙협력본부(1개), 총 기관 7개·division 17개. 소방서(4개서)·제주안전체험관·제주환경자원순환센터·
감사위원회·지방노동위원회·자치경찰위원회는 이번 배치 범위 밖으로 남겨뒀다(각각 별도 유형 분류·
합의제행정기관 등 이유가 있어 단순 신설로 처리하기 어렵다).

- **문화예술진흥원**(`SP-AGY-CULTUREARTS`, 운영과·공연기획과): 시행규칙 제42~43조·별표9(2024.01.22.
  개정본)로 신설. 별표9 원문과 org-baseline-agency.json의 division 구성이 정확히 일치해 별다른 문제
  없이 신설했다.
- **해양수산연구원**(`SP-AGY-MARINEFISHERIES`, 해양수산자원과·해양환경연구과·수산종자연구과·
  수산물안전과·광어연구센터 5개): 시행규칙 제48~49조·별표9로 신설. 5개 division 모두 별표9 원문과
  이름이 정확히 일치했다.
- **동물위생시험소**(`SP-AGY-ANIMALHYGIENE`, 축산물안전과·방역진단과): 시행규칙 제50~51조·별표9로
  신설. **기능 중복 가능성 발견**: 기존 SP-AGY-CHUKSAN(축산생명연구원)의 division-tables.js kw에 이미
  "가축전염병 방역"·"축산 관련 연구"가 등록돼 있는데, 이 기관의 방역진단과도 가축전염병 예찰·검역·
  병성감정을 다룬다 — 두 사업소가 실제로 어떻게 업무를 나누는지는 확정하지 못해 SP §6·§3에 상호 참고를
  남겼고, division-tables.js의 kw도 SP-AGY-CHUKSAN 기존 키워드와 겹치지 않게 구성했다.
- **설문대여성문화센터**(`SP-AGY-SEOLMUNDAE`, 운영과 1개): 시행규칙 제56~57조로 신설. **정직하게 밝힘**:
  별표9(2024.01.22.) 원문에는 이 기관이 "교육운영과"·"문화기획과" 2개 과였으나, org-baseline-agency.json
  (2026-08-25 시행 제938호, 더 최신 근거)은 "운영과" 1개로 적고 있다 — org-baseline을 따라 division 1개로
  신설하고, 옛 2개 과의 사무 15건을 하나로 합쳐 실었다(division SP §2에 정직하게 밝힘). 실제 통합 여부는
  재검증 필요.
- **돌문화공원관리소**(`SP-AGY-STONEPARK`, 공원운영과·돌문화연구과): 시행규칙 제58~59조로 신설.
  **정직하게 밝힘**: 별표9 원문에는 "공원운영과"의 사무만 있고 "돌문화연구과"의 사무 항목 자체가 없다 —
  돌문화연구과 §2는 별표9 원문이 아니라 기관·과 명칭에서 추정한 최소한의 범위이며 confidence low로
  명시했다. 공원운영과 §2("자료 수집·조사연구 및 각종 전시물 전시 관리")와 업무가 겹칠 수 있어 양쪽
  §3에 상호 참고를 남겼다.
- **고용센터**(`SP-AGY-EMPLOYMENT`, 취업지원총괄과·고용지원과·실업급여과·서귀포지소 4개): 시행규칙
  제59조의4~5로 신설. **정직하게 밝힘**: 별표9에는 이 기관의 사업소 단위 사무 분장이 없고, 대신 별표7
  (본청, 동일 개정일)에 옛 조직상 "고용센터"라는 이름으로 사무 22건이 division 구분 없이 한 덩어리로
  실려 있었다(duties-raw-2024-01-22.json의 do_tier_classification.stale_dept_names에도 "고용센터"가
  옛 부서명으로 표시돼 있음). 이 배치는 그 22건을 운영·총괄(11건)·직업훈련·정보(9건)·실업급여(1건)·
  서귀포지소(1건) 4개 division으로 주제별 재배치했다 — 이 재배치는 원문이 아니라 이번 작성자의 판단임을
  기관 SP·4개 division SP 전부에서 밝힌다. **명칭·키워드 중복 미해결**: division-tables.js의
  `DO_DEPT_DIVISION_TABLE`에 이미 `SP-DIV-ECON-EMPLOYCENTER`("경제활력국 고용센터")가 bare 키워드
  ["고용", "고용센터"]로 등록돼 있다 — 도 부서 산하 division과 이번에 신설한 사업소가 같은 실체를
  가리키는지는 확정하지 못했다(VETERANS 명칭 중복과 동일 클래스). kw는 bare "고용"·"고용센터"를 피해
  구성했다.
- **중앙협력본부**(`SP-AGY-CENTRALCOOP`, 국회대외협력부 1개): 시행규칙 제40~41조로 신설. **division
  구조에 대해 정직하게 밝힘**: org-baseline-agency.json은 "국회대외협력부(행정총괄과ㆍ국회대외과ㆍ
  정부협력과)"라는 표기로 1개 division(3개 팀 포함)을 적었지만, 별표9 원문에는 "대외행정지원과"·
  "국회협력과"·"정부협력과" 3개의 독립된 과가 각각 있었다(이름도 org-baseline과 정확히 일치하지 않음 —
  대외행정지원과≈행정총괄과, 국회협력과≈국회대외과로 추정). org-baseline(더 최신 근거)의 구조를 따라
  division 1개로 합치고 3개 과의 사무 24건을 번호 1~24로 다시 매겼다. **명칭·키워드 중복 미해결(중요)**:
  gov-router.js의 `JEJU_DO_TABLE`에 이미 `SP-DO-LIAISON`("중앙협력본부", 02-do-dept 최상위 도 부서,
  2026-07-09 작성 일반 지식 기반 초안)이 정확히 같은 이름·bare 키워드 '중앙협력본부'로 등록돼 있다 —
  도 부서(02-do-dept)와 사업소(03-do-agency)로 같은 이름의 조직이 이중 등록된 것인지, 실제로는 서로
  다른 조직인지 이번 조사에서 확정하지 못했다. kw는 bare '중앙협력본부'를 피해 division 고유 사무명
  위주로 구성했다 — VETERANS/SP-NAT-VETERANS 사례와 동일 클래스의 미해결 문제로, 다음 배치에서 반드시
  재검증할 것.
- **연락처 확인 못 함**: 7개 기관 모두 jeju.go.kr 공식 홈페이지 접속을 시도했으나(robots.txt·타임아웃)
  실패해 대표전화·소재지는 "확인하지 못함"으로 명시했다.
- 이 24개 SP(기관 7·division 17) 어디에도 실제 서비스에 연결된 task_key가 없는 것을 먼저 확인했다
  (2026-09-23) — 그래서 archive 이동 없이 바로 신설만으로 끝났다.
- `division-tables.js`·`pages/jeju-gov-automation.html`·`org-baseline-agency.json`(missing_in_inventory→
  mapping 이동, 13→6) 세 곳 모두 갱신했고, `src/tests/kfoi-duties-raw.test.mjs`에 작업 #13 테스트를,
  `src/tests/kfoi-digest.test.mjs`의 기존 org_counts/missing_in_inventory 검증을 11→18·13→6으로 갱신했다.
  `tools/check_stale_refs.py`·clean-clone 재검증도 통과했다.

# 2026-09-23 — 제주환경자원순환센터·제주안전체험관 기관·division 신설(작업 #14, 원문 없이 명칭 추정)

작업 #12·#13에 이어 org-baseline-agency.json의 `missing_in_inventory` 중 남은 기관 2개를 신설했다 —
제주환경자원순환센터(2개 division)·제주안전체험관(3개 division), 총 기관 2개·division 5개.
소방서(4개서)·감사위원회·지방노동위원회·자치경찰위원회는 이번 배치 범위 밖으로 남겨뒀다(각각 별도
유형 분류·합의제행정기관 등 이유가 있어 단순 신설로 처리하기 어렵다).

**이번 배치는 이전 12건과 근본적으로 다르다.** 작업 #6~#13에서 신설·재정리한 모든 division은 별표
8·9(2024.01.22. 개정본)에 실제 사무 원문이 있었다(가끔 이름 불일치·개명 문제는 있었지만, 최소한
"이 division의 사무 목록" 자체는 존재했다). 이 두 기관은 **그렇지 않다** — 작업 시작 전
duties-raw-2024-01-22.json(별표7 본청·별표8 직속기관·별표9 사업소·별표10 합의제행정기관·별표11
하부행정기관 전체)을 "제주환경자원순환센터"·"환경자원순환센터"·"제주안전체험관"·"안전체험관"과
5개 division 이름(자원순환시설관리과·음식물자원화과·체험지원과·체험기획과·체험운영과) 전부로
파이썬으로 전수 검색했으나, 별표8·별표9 어디에도 이 두 기관의 division별 분장사무가 **전혀 없다**는
것을 확인했다.

- 유일하게 나온 관련 텍스트는 별표7(본청) "자원순환과" 항목의 "환경자원순환센터(매립·소각) 운영에
  관한 사항"이라는 1줄뿐이었다 — 이는 도 본청 기후환경국 자원순환과가 이 시설의 운영을 지원·지도한다는
  뜻이지, 센터 자체의 division별 사무 분장이 아니다. 마찬가지로 "도민 119안전체험교육에 관한 사항",
  "안전체험교육 운영 계획 수립·시행에 관한 사항" 등도 별표7 본청의 다른 조직(소방 계통) 사무로
  실려 있을 뿐, 제주안전체험관 자체의 division별 분장사무는 아니었다.
- **원문이 없다는 것을 확인한 뒤에도 신설을 포기하지 않고, 정직한 최소-공시 방식으로 진행했다** —
  각 division의 §2는 별표 원문 인용이 아니라 **기관명·과 이름에서 합리적으로 추정 가능한 최소한의
  범위**(3~5개 항목, 돌문화연구과(SP-AGYDIV-STONEPARK-RESEARCH, 작업 #13) 선례와 동일한 방식)만
  담았고, 각 division·기관 SP §2·§6에 "정직하게 밝힘" 블록으로 원문이 없다는 사실과 confidence:
  low를 명시했다. 부풀리지 않기 위해 항목 수도 일부러 modest하게(과당 3~5건) 유지했다.
- **org-baseline-agency.json의 confidence를 "low"로 표기했다** — 작업 #12·#13에서 신설한 9개 기관은
  전부 confidence: high(별표 원문·조직 기준표가 이름·사무 모두 실제로 대조·확인됨)였던 것과 달리,
  이 2개 기관은 기관명·division 이름 자체는 org-baseline-agency.json(고신뢰 조직 기준표)으로 확인했지만
  **사무 내용은 확인된 적이 없다**는 것을 mapping의 note에도 명시적으로 적었다.
- **명칭 충돌 발견(제주환경자원순환센터)**: division-tables.js·gov-router.js 전수 확인 결과, "자원순환"
  이라는 낱말이 이미 기후환경국 자원순환과(SP-DIV-CLIMATE-RECYCLING, kw에 bare "자원순환"·"자원순환과"
  포함)와 gov-router.js의 JEJU_DO_TABLE 여러 항목(기후환경국·청정환경국·녹색환경정책실 등, kw에 bare
  "자원순환" 포함)에 등록돼 있다 — 신설 기관의 kw에는 bare "자원순환"을 넣지 않고 기관명 전체("제주환경
  자원순환센터", "환경자원순환센터")·division 고유 사무명 위주로만 구성했다. 실제 라우팅 우선순위·중복
  해소는 재검증하지 않았다(VETERANS/EMPLOYMENT/CENTRALCOOP 명칭 중복과 동일 클래스의 미해결 문제).
- **명칭 충돌 없음(제주안전체험관)**: "안전체험관"·"체험지원과"·"체험기획과"·"체험운영과" 낱말은
  division-tables.js·gov-router.js 어디에도 등록돼 있지 않아 명칭 충돌은 발견되지 않았다. 다만
  소방안전본부(SP-AGY-FIRE)가 "재난 예방" 등 인접 재난안전 키워드를 이미 쓰고 있어, 일반적인 재난안전
  문의가 두 기관 사이에서 혼동될 수 있다는 점을 기관 SP §3에 연계 표로 남겼다.
- **연락처 확인 못 함**: 두 기관 모두 jeju.go.kr 공식 홈페이지 접속을 시도했으나(robots.txt·타임아웃)
  실패해 대표전화·소재지는 "확인하지 못함"으로 명시했다.
- 이 7개 SP(기관 2·division 5) 어디에도 실제 서비스에 연결된 task_key가 없는 것을 먼저 확인했다
  (2026-09-23) — 그래서 archive 이동 없이 바로 신설만으로 끝났다.
- `division-tables.js`·`pages/jeju-gov-automation.html`·`org-baseline-agency.json`(missing_in_inventory→
  mapping 이동, 6→4) 세 곳 모두 갱신했고, `src/tests/kfoi-duties-raw.test.mjs`에 작업 #14 테스트 5건을
  (신설 확인·정직 공시 문구 검증·baseline confidence: low 검증·라우팅 회귀·"자원순환" bare 키워드 충돌
  안전장치), `src/tests/kfoi-digest.test.mjs`의 기존 org_counts/missing_in_inventory 검증을 18→20·
  6→4로 갱신했다(신설 두 기관의 confidence: low 어서션도 추가). `tools/check_stale_refs.py`·clean-clone
  재검증도 통과했다. **이번 배치 이후에도 이 2개 기관·5개 division은 draft·confidence: low 상태로
  남는다** — 실제 서비스 라우팅(task_key)을 연결하기 전에는 반드시 별표8·9 최신 개정본이나 실제
  조직 자료로 §2를 재검증해야 한다.

# 2026-09-24 — 소방서 4개(제주·서귀포·서부·동부) 기관·division·현장단위 신설(작업 #15, 사용자 지시)

**이번 배치는 사용자(피터/주피터, 프로젝트 총괄)의 명시적 지시로 시작됐다**: "1항은 현장 단위까지 수십
개 SP를 작성하십시오. 우리가 만든 SP가 있어야 사람 소방서 직원들이 오류를 수정 갱신할 수 있습니다." —
정확도가 완벽하지 않아도 좋으니, 정직하게 초안/미검증으로 표시하면서 현장 단위(119안전센터·구조대·
지역대)까지 전부 뼈대 SP를 만들라는 지시다. org-baseline-agency.json의 missing_in_inventory에 남아 있던
"제주소방서·서귀포소방서·서부소방서·동부소방서" 항목(직속기관 제6절, confidence: high — 시행규칙에
근거는 확인됐으나 SP 파일 자체가 없던 유일한 confidence: high 미반영 항목)을 대상으로 했다.

**신설 규모: 기관 4개·division(과) 13개·현장 단위 SP 31개, 총 48개 파일.**

## 1) 조직 관계 정직 공시

소방서 4개는 지방자치법 제126조상 SP-AGY-FIRE(소방안전본부)의 **하급 직속기관**이다. 소방안전본부
자체는 2026-09-22(작업 #12 이전 세션)에 실제로는 도청 15실·국·본부 중 하나(do-dept 유형, 시행규칙
제21조의4)로 재분류됐지만, 그 산하 4개 소방서는 여전히 별표8(2024.01.22. 개정본) 제6절·제33~35조상
별도의 "직속기관"(agency 유형)이다 — 두 계층이 법적으로 분리돼 있다. 새 4개 기관 SP의 §0은 반드시
`SP-AGY-FIRE(소방안전본부) → SP-AGY-FIRE{서}` 순서로 상속 체인을 명시해 이 관계를 정확히 반영했다.

## 2) 과(division) 13개 — 별표8 원문, confidence: high (작업 #6~#13과 같은 신뢰도)

duties-raw-2024-01-22.json 별표8_직속기관에서 4개 소방서 항목을 전수 확인한 결과, **개별 소방서 단위의
분장사무 원문이 실제로 존재했다**(작업 #14의 두 기관과 달리) — 제주환경자원순환센터·제주안전체험관과는
다른 신뢰도 등급이다. 다만 4개 서의 과 구성이 서로 다르다는 것도 원문으로 확인했다:

- **제주소방서**: 4개 과(소방행정과·예방안전과·119재난대응과·현장대응단) — 예방과 대응이 분리돼 있다.
- **서귀포소방서·서부소방서·동부소방서**: 3개 과(소방행정과·예방구조과·현장대응단) — "예방구조과" 1개가
  제주소방서의 예방안전과(14개 사무)+119재난대응과(16개 사무)를 합친 30개 사무를 그대로 담당한다(원문
  대조 결과 정확히 동일한 30개 항목). 3개 서의 예방구조과·소방행정과·현장대응단 사무는 각 서마다
  글자 하나까지 동일하다(원문 자체가 공통 서술이다) — division 13개 중 실질적으로 서로 다른 내용은
  2가지 패턴(제주형 4과 / 나머지형 3과)뿐이다.

기관·division kw는 "{소방서명} {과명}" 복합어로만 구성했다 — 기존 SP-AGYDIV-FIRE-ADMIN/PREVENTION/
RESPONSE(소방안전본부 자체의 province-level 가칭 division, 2026-07-13 작성, bare "소방행정과"·
"예방안전과"·"현장대응과" kw)와 겹치지 않게 하기 위해서다. 이 3개 division 중 예방안전과는 실제
`task_key: 'hazardous_material_facility_permit'`(agency: 'jejufire') 배선이 있어 **절대 건드리지
않았다** — 새로 만든 SP-AGYDIV-FIRE{서}-* 13개 어디에도 task_key를 넣지 않은 것을 테스트로 확인했다.

## 3) 현장 단위(119안전센터·구조대·지역대) 31개 — 이번 배치의 핵심, state: draft

**이 부분이 사용자 지시의 본질이다.** 별표8은 "119센터 및119지역대"·"119구조대" 항목으로 **4개 서
전체에 공통 적용되는 사무**(각 7개 항목)만 제공한다 — 특정 센터 하나만을 위한 개별 사무는 원문에
없다(당연하다). 그래서 각 현장 단위 SP는:

- §2에 별표8의 공통 사무(confidence: high, 단 "이 유형 전체"에 대한 서술이지 "이 센터만의" 서술이
  아니라는 점을 명시)를 담고,
- 관할·명칭은 나무위키·언론 보도 등 **2차 출처**(정부 공식 원문이 아님)로 채우며,
- 파일 헤더·§6에 "state: draft"·"정직하게 밝힘"을 강하게 명시해 실제 소방서 직원의 검증·수정을
  요청한다.

**Python 생성 스크립트**(`make_divisions.py` 계열 패턴, 이번 배치 전용 `gen_fire.py`)로 공통 템플릿에
소방서명·단위명·유형(안전센터/구조대/지역대)만 바꿔 넣어 31개를 일괄 생성했다 — 하나하나 손으로 쓰지
않았다. 내역: 제주소방서 119안전센터 9개(이도·삼도·오라·연동·노형·외도·항만·화북·아라)+구조대 1개=10개,
서귀포소방서 119안전센터 4개(대신·동홍·중문·효돈)+구조대 1개=5개, 서부소방서 119안전센터 6개(한림·
애월·한경·대정·안덕·영어교육도시)+구조대 1개=7개, 동부소방서 119안전센터 5개(성산·구좌·조천·남원·
표선)+구조대 1개+119지역대 3개(우도·김녕·성읍)=9개. 파일은 `03-do-agency/divisions/field-units/`라는
새 서브디렉토리에 3단계 코드(`SP-AGYDIV-FIRE{서}-CENTER-{단위}`/`-RESCUE`/`-REGIONAL-{단위}`)로 뒀다 —
기존 `SP-AGYDIV-*`(과) 레벨과 한눈에 구분되고, 파일명만 보고도 서·유형·단위를 알 수 있게 하기 위해서다.

## 4) 119지역대 중복 의심 발견 및 교차검증 — 원 작업 지시서 정정(정직하게 밝힘, 중요)

원 작업 지시서에는 119지역대(구좌읍 김녕지역·우도면·표선면 성읍리) 3개가 **제주소방서·서귀포소방서·
동부소방서 3곳 모두**에 동일하게 나열돼 있었다 — 나무위키 표 추출 과정의 중복 오류로 의심됐다. 웹
검색으로 교차검증을 시도한 결과:

- **우도119지역대**: 헤드라인제주 보도("제주 동부소방서 우도119지역대(대장 이동헌)")로 **동부소방서
  소속임을 명확히 확인**했다(confidence: high).
- **김녕119지역대·성읍119지역대**: 명칭·소속을 뒷받침하는 1차 출처(뉴스·공식 조직도)를 찾지 못했다.
  구좌읍(김녕리 포함)·표선면(성읍리 포함)이 동부소방서 관할 구역(각각 구좌·표선 119안전센터 관할)이라는
  정황만으로 동부소방서 소속으로 추정했다(confidence: low, 억지로 확정하지 않고 각 SP §JURISDICTION-
  NOTE에 "교차검증 실패"를 명시).
- 제주소방서(namu.wiki 관할센터 목록 재확인: "화북·이도·삼도·오라·연동·노형·항만·외도·아라·구조대" —
  지역대 언급 없음) · 서귀포소방서(namu.wiki: "동홍·중문·대신/대륜(표기 불일치 발견, 뉴스 검색으로
  "대신"이 맞음을 재확인)·효돈·구조대" — 역시 지역대 언급 없음) 어느 쪽에도 지역대 존재를 뒷받침하는
  근거를 찾지 못했다.
- **결론**: 이 3개 지역대는 **동부소방서 산하로만** 신설했다 — 제주소방서·서귀포소방서에는 만들지
  않았다. 원 작업 지시서의 "3곳 모두에 있다"는 부분은 확인되지 않았고, 위키 표 추출 중복 오류일
  가능성이 높다고 판단해 반영하지 않았다. 이 판단 자체도 최종 확정이 아니며, 실제 동부소방서 직원만이
  정확한 소속·관할·존재 여부를 확정할 수 있다 — §JURISDICTION-NOTE에 그대로 남겼다.

## 5) 라우팅 설계 결정 — 현장 단위는 라우팅 대상에서 제외

기관 4개·division 13개(과 레벨)만 `division-tables.js`(JEJU_AGENCY_TABLE·JEJU_AGENCY_DIVISION_TABLE)·
`pages/jeju-gov-automation.html`(DO_AGENCIES)에 등록했다. **현장 단위 31개는 등록하지 않았다** — 안전
센터·구조대·지역대 단위까지 키워드 라우팅을 걸면 짧은 지명 키워드("이도"·"화북"·"성산" 등)가 다른
기관·부서(예: 이도동 주민센터, 성산읍사무소 등 04-city/emd 계열)와 오탐 충돌할 위험이 매우 크고, 실제
서비스 사용자가 "OO안전센터"를 직접 지목해 문의하는 경우는 드물다고 판단했기 때문이다 — 실제 LLM
라우팅 대상은 과(division) 레벨까지가 합리적이라는 결론이다. 현장 단위 SP는 상위 기관 SP(SP-AGY-FIRE
{서})가 참고 자료로 대조하는 문서로만 존재한다(각 SP §0에 명시).

`tools/build_kfoi_digest.mjs`는 `pages/jeju-gov-automation.html`의 `DO_AGENCIES` 배열만 읽어 다이제스트를
구성한다(디렉터리를 직접 스캔하지 않는다) — 현장 단위를 등록하지 않아도 다이제스트에서 "빠지는" 것이지
"고아 파일 경고"가 뜨는 구조가 아니다. `tools/check_stale_refs.py`도 JS/HTML의 파일 참조만 검사하고
"참조되지 않는 파일" 경고 자체가 없다(스크립트 원문 확인) — 그래서 이번 배치는 두 도구 모두 원문 수정
없이 그대로 통과했다.

## 6) 안전장치·검증

- 이번에 신설한 17개 SP(기관 4·division 13) 어디에도 실제 서비스에 연결된 task_key가 없는 것을 먼저
  확인했다(2026-09-24) — 그래서 archive 이동 없이 신설만으로 끝났다. 기존 SP-AGYDIV-FIRE-PREVENTION의
  실제 task_key(`hazardous_material_facility_permit`) 배선은 손대지 않았고 회귀 테스트로 확인했다.
- `division-tables.js`·`pages/jeju-gov-automation.html`·`org-baseline-agency.json`(missing_in_inventory
  4→3, 소방서 4곳을 confidence: high로 mapping 이동) 세 곳 모두 갱신했다.
- `src/tests/kfoi-duties-raw.test.mjs`에 작업 #15 테스트 6건(신설 확인·task_key 회귀 안전장치·
  org-baseline 확인·라우팅 회귀·kw 충돌 안전장치·현장단위 31개+지역대 중복 미배정 확인),
  `src/tests/kfoi-digest.test.mjs`의 기존 org_counts/missing_in_inventory 검증을 20→24·4→3으로
  갱신했다(신설 4개 기관의 confidence: high 어서션도 추가).
- `node tools/build_kfoi_digest.mjs --check`·`python3 tools/check_stale_refs.py`(716건 정상)·전체
  테스트 스위트(사전 존재하던 8건 실패와 동일하게 유지, git stash 비교로 확인) 모두 통과했다.
- **이번 배치 이후에도 이 4개 기관·13개 division·31개 현장단위 SP는 draft 상태로 남는다** — 특히
  현장 단위 31개(및 김녕·성읍 지역대의 소속 추정)는 실제 소방서 직원의 검증·수정 전까지 확정된 사실로
  취급하면 안 된다. 이것이 이번 배치의 존재 이유이기도 하다.

# 2026-09-24 — 합의제행정기관(감사위원회·지방노동위원회·자치경찰위원회)은 이 tier가 아니라 새 tier로 신설(작업 #16)

이 파일의 open_questions에 남아 있던 "합의제행정기관 3개를 K-FOI의 어느 유형에 넣을지 — 기존 6개
유형에 없는 새 범주다"를 프로젝트 총괄 지시에 따라 완전히 새 tier(`collegial`)를 신설하는 방향으로
해소했다 — 이 tier(agency, 도지사 직속 집행조직)와 조직법적 성격이 다르기 때문이다(도지사 소속 집행조직
vs 지방자치법 제130조의 독립적 의사결정 합의체). 새 디렉토리 `prompts/gov-tree/03b-collegial-agency/`·
새 org-baseline 파일 `org-baseline-collegial.json`·새 SP 코드 접두어(`SP-COMM-*`/`SP-COMMDIV-*`)로
분리했다. org-baseline-agency.json의 missing_in_inventory에서는 이 3건을 완전히 뺐다(4→1, 소방서만
남음). 상세 설계 배경·명칭 충돌 발견은 `prompts/gov-tree/03b-collegial-agency/archive/README.md` 참고.

# 2026-09-24 — 명칭 충돌 3건 정리(고용센터·중앙협력본부 일원화, 자치경찰 상하관계 문서화, 작업 #17)

작업 #12·#13·#14·#16에서 새로 신설한 SP와 기존 SP 사이에 이름이 겹치는 사례를 여러 건 발견해
"명칭 중복 미해결" 플래그만 남겨뒀었다. 이번 배치는 그 중 프로젝트 총괄(피터/주피터)에게 직접
확인하고 웹 조사까지 거쳐 결론이 난 3건을 실제로 정리했다(지방노동위원회 1건은 "확실하지 않음,
다음 배치에서 더 조사"라는 답변에 따라 이번에도 그대로 미해결로 남겨뒀다 — 아래 §3 참고).

## 1) 고용센터: 옛 SP archive, 새 SP로 일원화

`prompts/gov-tree/02-do-dept/divisions/SP-DIV-ECON-EMPLOYCENTER_v1.0.md`(경제활력국 산하 division으로
등록돼 있던 "고용센터")를 archive로 옮겼다 — 조례 개별 검증 없이 "경제활력국 산하 부서"로 잘못
모델링된 것으로 확인됐다(위키백과 확인 결과 실제로는 제주특별법 제44조 근거 도 직속 사업소). archive
전에 `grep -n "task_key"`로 배선이 없음을 재확인했다(실제로 없었다 — 안전하게 이동). 정본은
`SP-AGY-EMPLOYMENT`(03-do-agency, 및 하위 division 4개, 작업 #13에서 이미 신설됨)이다.
`src/gopang/gov/division-tables.js`의 `DO_DEPT_DIVISION_TABLE`에서 해당 항목을 제거하고,
`SP-AGY-EMPLOYMENT`·`SP-AGYDIV-EMPLOYMENT-*` 주석의 "명칭 중복 유의(미해결)" 문구를 "정리 완료"로
갱신했다. `pages/jeju-gov-automation.html`의 경제활력국 divisions 배열에서도 해당 항목을 제거했다.

## 2) 중앙협력본부: 옛 SP archive, 새 SP로 일원화

`prompts/gov-tree/02-do-dept/SP-DO-LIAISON_v1.0.md`(02-do-dept 최상위 도 부서로 등록돼 있던
"중앙협력본부")를 archive로 옮겼다 — 이 문서 자체가 "일반 지식 기반 초안이며, jeju.go.kr 재검증
필요"라고 스스로 밝히고 있었고, 실제 조례상 계층(제40~41조, 실·국이 아니라 사업소)부터 달랐다.
archive 전에 `grep -n "task_key"`로 배선이 없음을 재확인했다(없었다). 정본은 `SP-AGY-CENTRALCOOP`
(03-do-agency, 및 하위 division, 작업 #13에서 이미 신설됨)이다. 이 SP가 상속하던 클래스 템플릿
`prompts/gov-tree/02-do-dept/templates/SP-DEPT-LIAISON-TEMPLATE_v1.0.md`도 `grep -rln`으로 확인한
결과 이 SP 외에는 상속하는 인스턴스가 없어 함께 archive로 옮겼다. `src/gopang/gov/gov-router.js`의
`JEJU_DO_TABLE`에서 해당 항목을 제거하고, `division-tables.js`의 `SP-AGY-CENTRALCOOP`·
`SP-AGYDIV-CENTRALCOOP-ASSEMBLY` 주석과 `org-baseline-agency.json`·`org-baseline-do.json`의
"명칭 중복 유의(미해결)" 문구를 "정리 완료"로 갱신했다(`org-baseline-do.json`은 이 SP 자체가 사라져
`official_units.offices`에서도 "중앙협력본부"를 뺐다, 10→9개). `pages/jeju-gov-automation.html`의
"중앙협력본부" 도 부서 항목도 제거했다.

## 3) 자치경찰위원회 ↔ 자치경찰단: 상하관계 문서화(둘 다 유지, 삭제 없음)

이 둘은 애초에 다른 법인격의 별개 기관(작업 #16에서 이미 명시)이라 어느 쪽도 삭제하지 않았다.
이번 배치는 그 관계의 **방향**을 문서에 명시했다 — 자치경찰위원회(`SP-COMM-POLICE`, 위원회)가
자치경찰단(`SP-AGY-POLICE`, 집행조직)에 대해 실질적인 지휘·감독 권한을 행사하는 상급 컨트롤타워라는
사실을 jeju.go.kr 공식 설명·삼다일보 보도로 확인했다(웹 조사로 확인, 2026-09-24 — 정확한 기사 URL은
이번 세션에서 재접속이 되지 않아 별도로 기록하지 못했다, 다음 배치에서 원문 링크 보강 필요). 양쪽 SP
(`SP-COMM-POLICE_v1.0.md` §LEGAL-BASIS, `SP-AGY-POLICE_v1.0.md` §0)에 상호 참조 문구를 추가했고,
`division-tables.js`의 `SP-COMM-POLICE` 주석도 "확인됨 — 상하관계, 문서화 완료"로 갱신했다.
`org-baseline-collegial.json`의 open_questions에 있던 "명칭이 비슷해 충돌 위험" 항목은 이제 해소됐으므로
corrections로 옮겼다.

## 4) 지방노동위원회는 이번에 건드리지 않았다

프로젝트 총괄이 "확실하지 않음, 다음 배치에서 더 조사"라고 답한 유일한 항목이다 — `SP-COMM-LABOR`와
`org-baseline-collegial.json`의 `SP-NAT-LABORREL` 관련 open_question은 그대로 남겨뒀다.

## 5) 안전장치·검증

- archive한 두 SP(`SP-DIV-ECON-EMPLOYCENTER`·`SP-DO-LIAISON`) 어디에도 실제 서비스에 연결된
  task_key가 없었다는 것을 먼저 확인했다(2026-09-24) — 그래서 안전하게 archive할 수 있었다.
- `division-tables.js`·`gov-router.js`·`pages/jeju-gov-automation.html` 전수 확인 결과 archive된
  두 코드를 가리키는 죽은 참조는 남아 있지 않다.
- `src/tests/kfoi-duties-raw.test.mjs`에 작업 #17 테스트 5건(archive 위치 확인·task_key 재확인·라우팅
  죽은 링크 확인·자치경찰 상호 참조 확인·기존 배선 회귀 방지)을 추가했고, `src/tests/kfoi-digest.test.mjs`의
  기존 도청(do) bureau 개수 어서션을 24→23(SP-DO-LIAISON 제거 반영)으로 갱신했다.
- `node tools/build_kfoi_digest.mjs --check`·`python3 tools/check_stale_refs.py`(714건 정상)·전체
  테스트 스위트(사전 존재하던 8개 파일 실패와 동일하게 유지, git stash 비교로 확인)·clean-clone
  재검증 모두 통과했다.


# 2026-09-24 — batch13~17 신설 SP 18개 대상 라이브 스모크테스트 준비(작업 #18, 사용자 지시)

프로젝트 총괄(피터/주피터) 명시적 요청 — "새로 추가된 SP들을 대상으로, 사용자 발화 라우팅을 테스트하기
위한, 라이브 스모크테스트를 준비하십시오." 가장 가까운 선례(`gov_router_2026_08_21_department_live_
smoketest.mjs`·`live-smoketest-gov-router-2026-08-21-departments.yml`)를 그대로 복제해 새로 만들었다 —
설계를 새로 하지 않고 기존 패턴(`assembleGovSystemPrompt`/`resolveGovAgency` 실제 import, pages/
regional-gov.html의 `_govClassifyFn`을 토씨 하나 안 틀리고 복제한 `realClassifyFn`, 체크1(라우팅 도달)·
체크3(SP 응답 품질) 동일 패턴)을 그대로 따랐다.

## 만든 파일

- `tests/live_smoketest/gov_router_2026_09_24_new_agencies_live_smoketest.mjs`
- `.github/workflows/live-smoketest-gov-router-2026-09-24-new-agencies.yml`

## 대상과 시나리오 구성(총 22건)

batch13(작업 #13)·batch14(작업 #14)·batch15(작업 #15, 소방서 4개)·batch16(작업 #16, 합의제행정기관
신설 tier)·batch17(작업 #17, 명칭충돌 정리)에서 새로 생긴 기관 18개(사용자가 준 목록은 17개 항목으로
정리돼 있었으나, 실제 코드 기준으로 SP-AGY-POLICE/SP-COMM-POLICE를 별도로 세면 18개 코드) 전부를
커버했다:

- 사업소·직속기관 11개: 각 1~2개 시나리오(문화예술진흥원·해양수산연구원은 2개씩 — division 커버리지
  확대).
- 소방서 4개 중 3개(제주·동부·서부, "최소 2곳" 요구를 초과 충족) — 과 레벨만(현장단위 31개는 원래
  라우팅 테이블에 없어 대상 아님).
- 합의제행정기관 3개(감사위원회·지방노동위원회·자치경찰위원회) 각 1개.
- 명칭충돌 3건 검증(이번 스모크테스트의 핵심 포인트): 고용센터 일원화 2건(취업지원총괄과 사무·채용
  박람회), 중앙협력본부 일원화 1건(세종시권 중앙부처 협력), 자치경찰위원회 vs 자치경찰단 쌍 2건
  (위원회의 정책 심의 vs 집행조직의 관광경찰 신고 — 양쪽이 실제로 갈라지는지 확인).

각 시나리오 발화는 `src/gopang/gov/division-tables.js`의 institution/division kw(§2 완결처리업무)에서
실제 등재된 사무를 그대로 가져와 자연스러운 사용자 말투로 바꾼 것이다 — 꾸며낸 사무 없음.

## 이 세션에서 실제로 검증한 것 (정직한 범위 표시)

⚠️ 이 환경엔 실제 `DEEPSEEK_API_KEY`가 없어 `realClassifyFn`(LLM 폴백 분류)까지 포함한 완전한 라이브
실행은 이 세션에서 하지 못했다. 대신 다음 두 가지를 실행했다:

1. **문법 검증**: `node --check`로 새 `.mjs` 파일이 문법 오류 없이 로드됨을 확인. `.github/workflows/
   live-smoketest-gov-router-2026-09-24-new-agencies.yml`도 `python3 -c "import yaml; yaml.safe_load(...)"`
   로 YAML 문법이 유효함을 확인했다.
2. **오프라인 키워드 매칭 시뮬레이션**(스크래치 전용 스크립트, 커밋 대상 아님) — `assembleGovSystemPrompt`를
   `classifyFn` 없이(LLM 폴백 없이) 호출해 순수 kw 매칭만으로 22건 중 몇 건이 이미 올바른 SP에
   도달하는지 확인했다. 결과: **13/22건 키워드만으로 성공**, 나머지 9건(veterans-registration·
   marinefisheries-seed·animalhygiene-quarantine·envcirculation-foodwaste·employment-jobfair·
   centralcoop-sejong·police-committee-deliberation·comm-audit-report·comm-labor-remedy)은 kw
   미매칭 또는 다른 SP로 오매칭돼 실제 배포 환경에서는 K-Intent LLM 폴백(`realClassifyFn`)이 필요하다
   — 이건 실패가 아니라 설계상 예상된 동작이다(kw는 1차 필터, LLM이 2차 폴백).
   - 이 시뮬레이션 과정에서 실제 kw 명칭충돌 2건을 추가로 발견해 시나리오 문구를 조정했다: (a) "화재"
     라는 단어 자체가 응급 감지 게이트(`SP-EXP-EMERGENCY`, "애매하면 응급으로" 원칙)에 최우선으로
     가로채져 원래 의도한 소방서 행정 문의 라우팅을 검증할 수 없었다 — 순수 행정 문구("소방시설 점검
     신청")로 바꿨다. (b) "관광지" 단어가 SP-DO-TOURISM(bare "관광" kw)와 매칭 점수에서 동점/우위가
     되어 "관광경찰" 시나리오가 SP-AGY-POLICE로 못 갔다 — "관광지" 없이 "관광경찰"만 남겼다. 이 둘은
     라우팅 버그가 아니라 (a)는 의도된 안전 설계, (b)는 알려진 kw 매칭 한계(최고 점수 방식, 최장
     일치 방식 아님)이며, 다음 배치에서 별도로 재검토할 가치가 있는 관찰 사항으로만 기록해둔다(이번
     배치 범위 밖 — 실제 SP kw 정의 자체는 건드리지 않았다).
   - 별개로, veterans-registration(→ SP-NAT-VETERANS)·marinefisheries-seed(→ SP-AGY-CHUKSAN)·
     envcirculation-foodwaste(→ SP-DO-CLIMATE)는 순수 kw 단계에서 다른 기존 SP로 오매칭됐다 — LLM
     폴백이 실제로 이 오매칭을 바로잡는지는 `DEEPSEEK_API_KEY` 있는 환경에서 라이브 실행해야 확인
     가능하다(이 세션에서 검증 못함, 정직하게 명시).
3. 기존 회귀 스윕 재실행: `node tools/build_kfoi_digest.mjs --check`(477건 정상)·`python3 tools/
   check_stale_refs.py`(714건 정상, 변동 없음)·전체 테스트 스위트(`src/tests/*.test.mjs`, 사전 존재하던
   8개 파일 실패와 동일하게 유지 — 새 파일 추가로 인한 신규 회귀 없음).

## 완전한 검증을 위해 남은 일

GitHub Actions에서 `workflow_dispatch`로 `live-smoketest-gov-router-2026-09-24-new-agencies.yml`을
`DEEPSEEK_API_KEY` secret과 함께 수동 실행해야 `realClassifyFn`(LLM 폴백)까지 포함한 완전한 라이브
검증 결과를 얻는다. 결과는 `results/gov_router_2026_09_24_new_agencies_smoketest/results.json`과
`results/live-smoketest-gov-router-2026-09-24-new-agencies` 브랜치에 남는다.

---

# 작업 #19 (2026-09-24) — 라이브 스모크테스트 실패 2건 수정 + 더 폭넓은 라우팅 스모크테스트 신설

작업 #18의 라이브 스모크테스트(22건)를 GitHub Actions에서 실제로 `DEEPSEEK_API_KEY`와 함께 돌린
결과, 22건 중 2건이 실패했다(`results/live-smoketest-gov-router-2026-09-24-new-agencies` 브랜치의
`results/gov_router_2026_09_24_new_agencies_smoketest/results.json`에서 확인). 프로젝트 총괄(피터/
주피터)의 지시: "수정하십시오. 그리고, 더욱 폭넓은 사용자 발화로 라이브 테스트를 한 번 더 진행하십시오."

## 버그 1 — 보훈청 명칭 충돌("국가유공자" bare 키워드)

**실패 시나리오**: `veterans-registration`("국가유공자 등록을 하고 싶은데 어디로 가야 하나요") →
실제: `SP-NAT-VETERANS`, 기대: `SP-AGY-VETERANS`.

**원인(코드 추적으로 확정, 추측 아님)**: `gov-router.js`의 `assembleGovSystemPrompt`는 "0) 국가기관
매칭"(`_matchNational`)을 "0.6) 직속기관(03-do-agency) 매칭"보다 먼저 실행한다. `JEJU_NATIONAL_TABLE`의
`SP-NAT-VETERANS`가 bare `'국가유공자'` 키워드를 갖고 있어, "국가유공자 등록"이라는 발화가 국가기관
단계에서 즉시 매칭·확정돼버린다 — 도 직속기관(`SP-AGY-VETERANS`)이 이미 더 구체적인 키워드
`'국가유공자 등록'`을 갖고 있었는데도(division-tables.js) 그 단계까지 도달하지 못했다.

이 국가기관↔지방행정 충돌을 막는 안전망(`_localGovCollisionCandidate`)이 이미 있었지만, 예전엔
시청 국(`_cityDeptTable`)·도청 실·국(`_l2Table`) 두 계층만 검사했고 **03-do-agency(직속기관) 계층은
검사 대상에서 아예 빠져 있었다** — 이게 진짜 원인이다.

**관할 재확인(추측 금지 원칙에 따라 원문 확인)**: `SP-AGYDIV-VETERANS-COMPENSATION_v1.0.md` §2를
직접 읽어, 「제주특별자치도 행정기구 설치 및 정원 조례 시행규칙」 별표8(직속기관별 분장사무)에 이
과의 사무로 "1. 각종 등록에 관한 사항"이 실제로 명시돼 있음을 확인했다. `SP-AGY-VETERANS_v1.0.md`
§5(예시 시나리오)도 "국가유공자 등록은 어디서 신청하나요" → 도 직속기관 체인으로 이미 명시하고 있었다.
즉 "국가유공자 등록"(신규 등록 신청)은 도 직속기관(보훈청)에 위임된 사무로 문서상 확인되며,
`SP-NAT-VETERANS`(국가보훈부 소관, 연금·의료 등 중앙 사무)와는 별개다 — 라우팅을 도 직속기관 쪽으로
고치는 것이 맞다.

**수정**: `_localGovCollisionCandidate()`에 `_agencyTable()` 검사를 추가했다(cityDept → agency → l2
순으로 확인). 이제 국가기관 매칭이 즉시 확정되기 전에, 같은 발화가 도 직속기관 키워드에도 걸리는지
함께 확인하고, 걸리면(그리고 classifyFn이 있으면) LLM에게 두 후보(`SP-NAT-VETERANS` vs
`SP-AGY-VETERANS`)를 함께 주고 고르게 한다.

**시도했다가 되돌린 접근**: 처음엔 `classifyFn`이 없어도(오프라인) 이 충돌 검사 자체를 항상 실행하도록
바꿔봤으나, `national-agency-100-scenarios.test.mjs`에서 8건의 새 회귀(coastguard·weather·
laborimprove·nhis·humanquarantine·env·forestcoop 등 — 순수 국가기관 소관 도메인인데 L2 원형
키워드('해양'→ocean, '환경'→climate 등)와 어휘가 겹쳐 "classifyFn 없으면 지방행정 우선"이라는
결정론적 기본값이 잘못 지방으로 튕겨나감)를 일으켰다. `natMatch && classifyFn` 가드는 의도적 설계
(LLM 없는 호출에서는 국가기관 즉시확정이 안전 기본값)임을 재확인하고 원복했다 — `_localGovCollision
Candidate` 자체에 agency 계층을 추가하는 것만 유지했다(실제 프로덕션 호출은 항상 `classifyFn`을
주입하므로 이 가드는 실질적으로 영향이 없다).

## 버그 2 — 자치경찰위원회/자치경찰단 명칭 충돌(합의제행정기관)

**실패 시나리오**: `police-committee-deliberation`("자치경찰사무에 대한 정책을 심의·의결하는 절차가
궁금한데 어디에 문의해야 하나요") → 실제: `SP-AGY-POLICE`, 기대: `SP-COMM-POLICE`.

**원래 가설(작업 지시서에 적혀 있던 것)**: "전역 LLM 안전망"(`_buildCandidatesText()`, step 5)이
agency/org/collegial 계층을 후보에 안 넣어서 그런 것 아닌가 — 이 가설은 **틀렸다**. 오프라인 mock
`classifyFn`으로 실제 후보 목록을 직접 로그로 찍어 확인한 결과(스크래치 디버그 스크립트, 커밋 대상
아님), 이 시나리오는 `_buildCandidatesText()`(step 5)에 도달조차 하지 않았다 — "0.6) 직속기관/
출자출연기관 매칭" 단계에서 `_resolveInstitutionMatch(text, _agencyTable(), ...)`가 이미 확정하고
`return`해버리기 때문이다.

**진짜 원인(로그로 확정)**: 이 발화는 `_agencyTable()`·`_collegialTable()` 어느 쪽 키워드와도 정확히
겹치지 않아(topScore===0) `_resolveInstitutionMatch`의 "zero-score LLM 폴백" 경로를 탄다. 이 폴백은
`table`(agency 하나) + L2 1등 후보만 후보로 구성했다 — **org/collegial 계층은 애초에 이 후보 목록에
없었다.** 그 결과 LLM(또는 mock)은 `SP-COMM-POLICE`(정답, 합의제 위원회)를 볼 기회조차 없이 후보
agency 목록 중 "그나마 비슷한" `SP-AGY-POLICE`(집행조직)를 골랐다. 실측 로그에서 `classifyCallCount:
1`이었고, 그 1번의 호출에 전달된 후보 목록 전체(agency 27개)에 `SP-COMM-POLICE` 문자열이 전혀
없었음을 직접 확인했다 — 짐작이 아니라 실측이다.

**수정**: `_resolveInstitutionMatch(text, table, pdvLocationHint, classifyFn, siblingTables=[])`에
5번째 인자 `siblingTables`를 추가했다. zero-score 폴백·약한 매칭(topScore===1)·강한 매칭
(topScore>=2)의 LLM 후보 목록 구성부에 모두 `siblingTables`를 병합하도록 고쳤다(직접 키워드 완전매칭
고속경로는 `table` 하나만 스코어링하므로 영향받지 않는다 — 회귀 없음). 호출부(0.6단계)에서:
- agency 매칭 호출에 `[_orgTable(), _collegialTable()]`을 형제 테이블로 전달
- org 매칭 호출에 `[_collegialTable()]`을 형제 테이블로 전달

이제 agency 테이블 매칭이 LLM에게 물어볼 때 org·collegial 후보까지 함께 보여준다. 다만 이러면
`agyMatch`로 반환되는 객체가 실제로는 org/collegial 코드일 수 있으므로, division 조회 함수도 코드
접두어(`SP-ORG-`/`SP-COMM-`/그 외)로 실제 출신 테이블을 판별해 올바른 division 테이블을 조회하는
디스패처(`_resolveInstitutionDivision`)를 새로 추가했다.

## 수정 후 검증

1. **오프라인 키워드/후보 시뮬레이션**(DEEPSEEK_API_KEY 없어 실제 LLM 응답까지는 검증 못함, 정직하게
   명시) — mock `classifyFn`으로 두 버그 각각 재현:
   - 버그1: classifyFn 없음(순수 키워드) → 여전히 `SP-NAT-VETERANS`로 감(예상된 동작, 정직하게
     확인). classifyFn 목(후보에 `SP-AGY-VETERANS`가 있으면 그걸 고르는 목) → 후보 목록에
     `SP-AGY-VETERANS`가 실제로 포함됨을 확인했고, 그걸 고르면 trace가
     `SP-DO-000 > SP-AGY-VETERANS > SP-AGYDIV-VETERANS-COMPENSATION(과 특정)`으로 정확히 감.
   - 버그2: classifyFn 목(후보에 `SP-COMM-POLICE`가 있으면 그걸 고르는 목) → 수정 전엔 후보 목록에
     `SP-COMM-POLICE`가 전혀 없었고(agency 27개만), 수정 후엔 agency+org+collegial 전부(62개 후보)가
     포함되고 `SP-COMM-POLICE`를 고르면 trace가 `SP-DO-000 > SP-COMM-POLICE`로 정확히 감.
2. **기존 회귀 스윕**: `node tools/build_kfoi_digest.mjs --check`(476건 정상)·`python3 tools/
   check_stale_refs.py`(711건 정상)·`src/tests/*.test.mjs` 전체(27개 파일) — 수정 전후 `git stash`로
   대조한 결과 **정확히 동일한 8개 파일이 실패**(사전 존재 실패, 이번 작업과 무관 — `c50-next-step-
   marker`·`conversational-style-guard`·`do-dept-completion`·`gov-router-2026-08-21-session-
   smoketest`·`kplan-kwatch-kjob-dispatch`·`national-agency-100-scenarios`·`sp-intercall`·
   `sp-tag-dispatch`)했고 **새 회귀는 0건**이었다. `national-agency-100-scenarios.test.mjs`의 기존
   2건 실패도 diff로 내용까지 대조해 수정 전과 완전히 동일함을 확인했다(타이밍 값만 다름).
   `grep -rln "SP-NAT-VETERANS\|SP-AGY-POLICE" src/tests/`로 찾은 `kfoi-duties-raw.test.mjs`·
   `kfoi-digest.test.mjs`도 통과 유지.
3. `_buildCandidatesText()`는 이번 두 버그 어느 쪽의 원인도 아니었으므로(원래 가설이 틀렸음을 확인)
   건드리지 않았다 — 08-21 부서 라우팅 스모크테스트(`gov_router_2026_08_21_department_live_smoketest.mjs`)
   영향 없음.

## 더 폭넓은 라이브 스모크테스트 신설

프로젝트 총괄의 "더욱 폭넓은 사용자 발화로 라이브 테스트를 한 번 더 진행하십시오" 지시에 따라
`tests/live_smoketest/gov_router_2026_09_24_new_agencies_broad_live_smoketest.mjs`(총 42개 시나리오)를
신설했다(기존 22건 파일·워크플로는 그대로 보존 — 계속 재실행 가능).

- 신설 SP 17개(agency 11 + 소방서 4 + collegial 3, 단 소방서는 4곳 전부·집계상 AGY-POLICE 포함) 각
  최소 2건, 격식체/반말/간접 표현/복합 질문 등으로 표현을 다양화.
- 보훈청(`SP-AGY-VETERANS`) 4건·자치경찰위원회(`SP-COMM-POLICE`) 4건 + 대응쌍 자치경찰단
  (`SP-AGY-POLICE`) 2건 — 이번에 고친 두 버그의 회귀 재발을 다른 표현으로 재검증.
- 애매한 경계 케이스 4건을 `info: true`(관찰 전용, pass/fail 강제 안 함)로 포함: 자치경찰/국가경찰
  비교형 질문, 소방서 위치 불특정 질문, "국가유공자"만 언급한 매우 일반적인 질문, "자치경찰"만
  언급해 집행조직/위원회 구분이 안 되는 질문.
- 오프라인 검증(mock classifyFn, DEEPSEEK_API_KEY 없어 실제 LLM 검증은 못함 — 정직하게 명시): 판정
  대상 38건 전부 통과, 관찰용 4건은 trace를 기록만 함. `node --check`로 문법 검증 통과.
- 대응 워크플로 `.github/workflows/live-smoketest-gov-router-2026-09-24-new-agencies-broad.yml`을
  기존 패턴(`workflow_dispatch`, `DEEPSEEK_API_KEY` secret, results 브랜치 push, 아티팩트 업로드)
  그대로 신설했다(`python3 -c "import yaml; yaml.safe_load(...)"`로 YAML 문법 확인).

## 완전한 검증을 위해 남은 일 (작업 #19)

이 세션엔 `DEEPSEEK_API_KEY`가 없어 `realClassifyFn`(실제 LLM 분류)까지 포함한 완전한 라이브 실행은
GitHub Actions에서 `workflow_dispatch`로 두 워크플로(`live-smoketest-gov-router-2026-09-24-new-
agencies.yml` 재실행 — 이번엔 22건 모두 통과해야 정상, `live-smoketest-gov-router-2026-09-24-new-
agencies-broad.yml` 신규 실행)를 `DEEPSEEK_API_KEY` secret과 함께 수동 실행해야 한다.

## 작업 #21 (2026-09-26) — 보훈청 라우팅 실증 조사·문화사랑회 버그 수정·명칭 충돌 3건 추가 조사

프로젝트 총괄 지시: "A, B, C 순서로 진행"(A=보훈청/지방노동위원회 라우팅 미해결 건, B=자치경찰
협력과 명칭·감사위원회 division 재검증, C=confidence:low SP 인력 검증 체크리스트). A1(보훈청)·
B4(지방노동위원회)는 AskUserQuestion으로 다시 여쭤봤으나 둘 다 "직접 조사 요청"으로 답변 —
아래는 그 조사 결과다.

### A1. 보훈청 라우팅 — 위키백과로 실증 확인, 대부분 해소

작업 #19까지는 "국가유공자 등록" 발화가 실제 라이브 테스트에서 `SP-NAT-VETERANS`(국가기관)로
판정되는 게 맞는지 확정하지 못한 채 남겨뒀다. 이번에 위키백과 "제주특별자치도보훈청" 문서를
확인한 결과, 결정적 사실을 찾았다:

> 제주특별자치도보훈청은 **제주특별자치도 소속**의 보훈 전문기관이다. **2006년 6월 30일**
> 「제주특별자치도 설치 및 국제자유도시 조성을 위한 특별법」에 따라 국가보훈처 산하
> **제주보훈지청에서 제주특별자치도로 이관**됐다.

즉 org-baseline-agency.json·시행규칙(제31~32조, 도 직속기관 편성)이 애초에 정확했다 — 제주는
전국 다른 도와 달리 보훈 행정(등록·보상금 지급, 보훈과·보상과 실무)이 실제로 도로 이관돼 있다.
반대로 `gov-router.js`의 `ROUTE_DESCRIPTIONS['SP-NAT-VETERANS']`("제주보훈청(국가보훈부)")가
사실과 다른 오기였다 — 이 오기가 LLM 경합 판단(`_classifyDivisionFallback`)에 잘못된 전제를
주입해, 라이브 테스트에서 국가기관으로 판정되게 만든 원인으로 보인다(desc가 그대로 LLM 프롬프트
후보 설명에 들어간다 — `_buildDivisionCandidatesText` 참고).

**수정**:
- `gov-router.js`의 `ROUTE_DESCRIPTIONS['SP-NAT-VETERANS']` 설명을 정정 — "국가보훈부 직접 소관
  보훈 정책·서훈 등 국가 사무"로, 도 이관 사실과 함께 명시.
- `JEJU_NATIONAL_TABLE`의 SP-NAT-VETERANS 항목에서 바레 키워드 `'보훈급여'` 제거 — 보훈급여금
  지급 자체가 도 소관 실무이므로, 이 키워드가 있으면 0단계 국가기관 즉시확정(경합 감지 이전)이
  도 기관으로 갈 발화까지 새게 만들 수 있었다. `'보훈청'`·`'국가유공자'`는 유지(명칭이 실제로
  겹치므로 경합 판단 안전망에 맡김).
- `SP-AGY-VETERANS_v1.0.md` §6, `org-baseline-agency.json`의 note, `division-tables.js` 주석을
  모두 이번 재검증 결과로 갱신.

**완전히 해소된 것은 아니다** — 정직하게 남기는 잔여 불확실성:
1. 2006년 이관 범위 전체를 제주특별법 원문 조항으로 직접 확인하지 못했다(위키백과 서술에 의존,
   law.go.kr 원문은 robots.txt로 접속 실패).
2. namu.wiki에는 "제주특별법 개정안이 통과되면 보훈과·보상과 업무가 다시 국가보훈부로 환원될
   예정"이라는 서술도 있다 — 이 개정안의 실제 통과·시행 여부는 확인 못했다. 통과되면 이 판단
   자체가 다시 뒤집힌다 — 정기 재검증 대상.
3. '취업지원 대상자' 키워드가 가리키는 사무가 이관 대상인지도 미확인.

### B4. 지방노동위원회 — 무게추가 "국가기관"으로 기움, 여전히 미해결(유보 계속)

노동위원회법 제2조 제2항이 "중앙노동위원회와 지방노동위원회는 고용노동부장관 소속으로 둔다"고
전국 공통으로 명시함을 확인했다(namu.wiki 발췌). 제주특별법에 이 예외를 두는 특례 조문은 이번
조사에서 찾지 못했다(law.go.kr 원문 직접 대조는 실패). 즉 "위원회 자체"는 보훈청과 달리 전국과
마찬가지로 국가기관(고용노동부 소속)일 가능성이 높다는 쪽으로 무게가 실린다 — 다만
org-baseline-collegial.json이 근거로 삼은 시행규칙 제938호 제62~63조가 "위원회 자체"가 아니라
이를 지원하는 "사무국"만 도 소속으로 별도 편성한 것일 가능성도 배제 못한다. 프로젝트 총괄 지시로
이번에도 라우팅 코드(SP-NAT-LABORREL 유지)는 건드리지 않았다 — 다음 배치에서 원문 조항 직접
대조 계속 필요.

### B5. 자치경찰협력과 명칭 변경 — 정황만 확인, 미확정

"자치경찰정책과"(2024.01.22 별표10)→"자치경찰협력과"(2026.8.25 시행 조례) 개명 배경으로 짐작할
만한 정황을 하나 찾았다: 정부가 2026년 하반기 목표로 국가경찰·자치경찰의 인력·조직을 완전
분리(이원화)하는 방안을 검토 중이라는 보도(한국경제, 2026-08-26)가 있다 — 이원화되면 자치경찰·
국가경찰 간 "협력 체계" 구축이 새 과제로 부상한다는 내용이라 개연성은 있으나, 이 기사는 전국
단위 정책 방향 보도일 뿐 제주 자치경찰위원회의 구체적 조직개편 근거 조문을 확인해준 것은 아니다.
jeju.go.kr 자치경찰위원회 조직 페이지 직접 접속은 robots.txt/방화벽으로 실패해 원문 대조는 이번에도
못했다 — 단순 개명인지 사무 범위 변경인지 여전히 미확정.

### B6. 감사위원회 division 구성 — 위키백과 일부만 확인, 여전히 별표 미확보

위키백과 "제주특별자치도감사위원회" 문서에서 감사과(감사1~4담당)·조사과(조사1~2담당) 존재는
확인했으나, org-baseline-collegial.json이 등재한 심의과·부패방지지원센터는 그 문서에 언급이
없었다(위키백과가 구버전이라 누락됐을 수도, 실제로 현재 조직에 없을 수도 있음 — 미확정).
audit.jeju.go.kr 공식 조직 페이지는 방화벽 차단으로 접속 실패했다. 4개 division 분장사무 별표
자체는 여전히 확보하지 못했다.

### A2. "문화사랑회" 라우팅 버그 — 근본원인 그대로 확인, 수정 완료

작업 #19 라이브 테스트(broad, 42건)에서 발견된 미수정 버그를 이번에 고쳤다. 근본원인(재확인):
`SP-AGY-CULTUREARTS`(제주특별자치도 문화예술진흥원) 기관 레벨 kw 목록에 "문화사랑회"가 없고,
산하 division(`SP-AGYDIV-CULTUREARTS-ADMIN`)의 kw에만 있었다. 0.6단계 직속기관 매칭이
`_agencyTable()` 전체(기관 레벨 kw만)를 스코어링하므로, "문화사랑회"만 언급된 발화는 기관
계층에서 topScore=0(zero-score LLM 폴백 경로)으로 떨어진다 — 이 폴백은 agency 테이블 전체를
후보로 LLM에게 주지만(작업 #19에서 이미 siblingTables까지 포함하도록 고쳐둔 상태), desc에도
"문화사랑회"라는 단서가 전혀 없어 LLM이 이 발화를 CULTUREARTS와 연결 짓지 못하고 결국 상위
`SP-DO-CULTURE`(도청 문화 관련 실·국, L2)로 새는 것으로 보인다(오프라인 mock 기준 추론 — 실제
DeepSeek 호출 로그로 재확인은 못함, 정직하게 명시).

**수정**: `division-tables.js`의 `SP-AGY-CULTUREARTS` 기관 kw에 `"문화사랑회"`를 추가했다 —
이제 이 발화는 기관 계층에서 곧바로 topScore=1로 확정돼(단독 최고점) 애매한 LLM 폴백을 거치지
않는다. 기존 division kw는 그대로 유지(회귀 없음).

### A3. 17개 신설 기관 전수 감사 — "동일 kw 격차" 구조 확인, 범위 판단 후 1건만 선제 보강

"기관 kw 어딘가에 산하 division의 kw 중 최소 하나가 substring으로라도 포함되는가"를 전체
AGENCY/COLLEGIAL 테이블에 스크립트로 감사했다. 결과: **이 패턴 자체는 신설 17개 기관에 국한된
문제가 아니라 시스템 전반에 구조적으로 존재한다**(183건 발견, 기존 기관 포함) — "총무과"·
"운영과"처럼 여러 기관이 공유하는 범용 부서명은 원래 기관 레벨에서 확정하면 안 되고 zero-score
LLM 폴백(전체 후보 중 문맥으로 판단)에 맡기는 게 설계 의도이므로, 전부 기관 kw에 추가하는 건
오히려 기관 간 새로운 오매칭을 유발할 수 있어 하지 않았다.

"문화사랑회"와 같은 클래스(범용 부서명이 아니라 시민이 기관명 언급 없이 그 이름만으로 물어볼
가능성이 큰 고유명사·시설명)로 좁혀 다시 살펴본 결과, 신설 17개 기관 범위 안에서는
`SP-AGY-EMPLOYMENT`(제주특별자치도 고용센터) 산하 `SP-AGYDIV-EMPLOYMENT-SEOGWIPO`의
"서귀포고용센터"가 유일하게 해당돼 기관 kw에 선제 보강했다(아직 실측 실패 사례는 아니고,
감사로 미리 발견한 잠재 위험).

**범위 밖(신설 기관 아님)이라 이번엔 손대지 않았지만 새로 발견한 위험**: `SP-AGY-ARTMUSEUM`의
"제주현대미술관"·"김창열미술관"(둘 다 실제로 유명한 개별 미술관 브랜드명), `SP-AGY-HERITAGE`의
"한라수목원"·**"한라산국립공원"**(제주에서 가장 검색량이 많을 주제 중 하나로 추정)이 모두 같은
클래스의 잠재 위험이다. 이 기관들은 이번 세션에서 신설한 게 아니라 기존에 운영 중이던 SP라
회귀 위험을 고려해 이번 배치 범위에 포함하지 않았다 — **별도 배치로 전수 재검토 필요**.

## 완전한 검증을 위해 남은 일 (작업 #21)

- 위 A1·A2 수정은 오프라인 회귀 스윕(`node tools/build_kfoi_digest.mjs --check`·`python3
  tools/check_stale_refs.py`·`src/tests/*.test.mjs`)으로만 확인했다 — `DEEPSEEK_API_KEY`가 이
  세션에 없어 실제 LLM 라이브 재검증은 못했다. 병합 후 `live-smoketest-gov-router-2026-09-24-
  new-agencies-broad.yml`을 재실행하면 이번에 고친 두 버그(보훈청·문화사랑회)가 실측으로도
  해소됐는지 확인할 수 있다.
- B4·B5·B6은 원문(제주특별법·자치경찰위원회 조직 규정·감사위원회 별표) 직접 대조가 여전히
  필요하다 — jeju.go.kr 계열 사이트는 robots.txt/방화벽으로 이번에도 직접 접속하지 못했다.
- `SP-AGY-ARTMUSEUM`·`SP-AGY-HERITAGE`의 "고유명사 division" 라우팅 위험은 별도 배치로
  재검토 필요(위 A3 참고).
