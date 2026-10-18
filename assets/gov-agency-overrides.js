/* gov-agency-overrides.js — 행정기관 공통 페이지(pages/gov-agency.html)의 기관별 customization 표 (2026-10-19 신설)

   공통 파일 하나(gov-agency.html + gov-agency.js)가 모든 기관 페이지를 그린다. 기관마다 HTML 을 만들지 않고, 달라지는 부분만 이 표에 적는다.
   우선순위: GOV_AGENCY_OVERRIDES[govCode]  >  GOV_TIER_OVERRIDES[govCode 의 첫 토큰(policy, do-dept, city-dept, emd …)]  >  gov-agency.js 의 기본값.
   모든 필드는 선택이며, 적은 필드만 기본값을 덮는다(catalog·laws 는 통째로 교체, 나머지는 문자열 교체).

   {
     h1:            '제목(<br> 허용)',                     // 기본: "{기관명} 민원을<br>대화로 작성해 제출합니다"
     sub:           '부제',
     disclaimer:    '면책 문구',
     placeholder:   '입력창 안내 예시',
     greetingHint:  (미사용 — 인사말은 엔진의 고정 안내를 쓴다. URL·표로 임의 문구를 주입해 기관을 사칭하는 길을 열지 않기 위함)
     intro:         '입력창 아래 「작성 방법」 콜아웃 대신 보일 안내(HTML 불가, 텍스트)',
     catalog: [ { id, tab, title, meta, lead, notes:[…], items:[{t, d}] } ],   // assets/pro-doc-page.js 와 같은 형식 — 이 기관이 받는 민원 서류
     laws:   [ { name, rel } ],                                                // 관계 법령 표
     lawsUnverified: '확인하지 못한 법령 안내',
     limits: ['이 기관 페이지의 한계·추후 작업', …],
     sources: [ { title, url, date('YYYY-MM-DD') } ],                         // 조사 출처(화면 하단에 링크로 표시)
     taskNotes: { 'jejusi:task_key': '서버 등록 정보와 다르게 확인된 사실' },  // 「접수 연동 민원」 탭의 해당 task 에 ※ 정정 안내로 덧붙임
     footer: '푸터 문구'
   }

   정본: 기관별 서류 목록과 관계 법령은 그 기관의 SP(prompts/gov-tree/… 의 §LEGAL-BASIS, 업무 목록)를 정본으로 삼아 적는다.
   SP 와 다른 내용을 이 표에만 적지 않는다 — SP 를 고칠 때 이 표도 함께 고친다. 확인하지 못한 항목은 지어내지 말고 비워 둔다. */
window.GOV_AGENCY_OVERRIDES = window.GOV_AGENCY_OVERRIDES || {};
window.GOV_TIER_OVERRIDES = window.GOV_TIER_OVERRIDES || {};
