/* gov-agency-content/index.js — 조사가 끝난 기관·도메인·유형의 내용 파일 색인 (2026-10-19 신설)
   키: 기관 코드('city-dept:jejusi:SP-CITYDIV-…') 또는 도메인 키('do-dept:*:SP-DO-AGRI', 시·도 무관) 또는 유형('emd').
   값: 이 폴더의 파일명. 파일은 window.GOV_AGENCY_OVERRIDES[키] = { catalog, laws, lawsUnverified, limits, sources, … } 로 등록한다(형식: ../gov-agency-overrides.js).
   조사 절차와 출처 기록: docs/gov-agency-research/. 항목을 더하면 같은 PR 에서 해당 조사 노트도 함께 올린다. */
window.GOV_CONTENT_INDEX = {
  'city-dept:jejusi:SP-CITYDIV-JEJUSI-JACHI-TAX': 'jejusi-tax.js'
};

/* 도메인 키: 시·도 부서(do-dept)·직속기관(do-agency)·국가기관 지역사무소(nat-agency)는 시·도마다 같은 템플릿 SP 를 쓰므로 시·도를 뺀 키를 쓴다. */
window.GOV_DOMAIN_KEY = function (code) {
  var p = String(code || '').split(':');
  return (p.length === 3 && (p[0] === 'do-dept' || p[0] === 'nat-agency' || p[0] === 'do-agency')) ? p[0] + ':*:' + p[2] : '';
};

/* 현재 페이지의 기관에 해당하는 내용 파일만 불러온다. document.write 로 넣은 스크립트는 이 스크립트가 끝난 직후, 뒤따르는 gov-agency.js 보다 먼저 실행된다. */
(function () {
  if (typeof location === 'undefined' || typeof document === 'undefined') return;   // 브라우저가 아닌 곳(테스트)에서는 로드하지 않는다
  var code = (new URLSearchParams(location.search).get('gov_code') || '').trim();
  if (!code) return;
  var idx = window.GOV_CONTENT_INDEX, d = window.GOV_DOMAIN_KEY(code);
  var file = idx[code] || (d && idx[d]) || idx[code.split(':')[0]] || '';
  if (file && /^[A-Za-z0-9._-]+\.js$/.test(file)) document.write('<script src="/assets/gov-agency-content/' + file + '"><\/script>');
})();
