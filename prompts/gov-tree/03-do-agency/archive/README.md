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

