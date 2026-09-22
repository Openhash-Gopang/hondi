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

