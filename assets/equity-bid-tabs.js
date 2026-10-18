/* equity-bid-tabs.js — 지분 입찰 테스트 5개 페이지가 공유하는 헤더 아래 탭(단일 소스, 2026-10-18)
   사용: PAGE_HEADER 앞에 이 스크립트를 넣고 subnav: window.equityBidSubnav('scenarios') 로 쓴다.
   탭을 늘리거나 이름을 바꾸려면 이 파일만 고치면 된다. */
(function (root) {
  'use strict';
  var TABS = [
    { key: 'test',        label: '입찰 테스트',     href: '/pages/equity-bid-test.html' },
    { key: 'subscribers', label: '잠재 가입자',     href: '/pages/equity-bid-subscribers.html' },
    { key: 'pricing',     label: '요금·매출',       href: '/pages/equity-bid-pricing.html' },
    { key: 'scenarios',   label: '점유율 시나리오', href: '/pages/equity-bid-scenarios.html' },
    { key: 'competition', label: '경쟁력 분석',     href: '/pages/equity-bid-competition.html' }
  ];
  root.equityBidSubnav = function (activeKey) {
    return TABS.map(function (t) { return { label: t.label, href: t.href, active: t.key === activeKey }; });
  };
})(window);
