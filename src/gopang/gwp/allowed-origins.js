/**
 * gwp/allowed-origins.js — GWP 서명 릴레이 공통 origin 화이트리스트
 *
 * 2026-07-05 실사: 이전에는 engine.js 안에 인라인으로 ALLOWED_ORIGINS가
 * 있었는데 구버전 gopang.net 도메인만 갖고 있어(브랜드 전환 이후 갱신
 * 안 됨), 실제 배포본(hondi.net 계열)에서는 서명 릴레이 전체가 막혀
 * 있었다. gwp-registry.js에 등록된 모든 서비스 도메인(하위 시스템이
 * GWP 탭으로 열리는 곳) + clean.hondi.net처럼 *.hondi.net 서브도메인이라도
 * 신규 추가 시 누락되기 쉬운 항목을 명시 나열한다.
 * (2026-09-21: fiil.kr → clean.hondi.net 이전에 맞춰 항목 교체)
 *
 * 이 파일은 의존성이 없는 순수 모듈이다 — sign.js(ui/bubble.js,
 * core/state.js에 의존)를 통째로 import하지 않고도 silent-sign.html
 * 같은 독립 페이지가 화이트리스트만 가져올 수 있도록 분리했다.
 * engine.js, sign.js, auth/silent-sign.html 세 곳 모두 여기서 import한다
 * — 도메인을 추가/제거할 때 이 파일 하나만 고치면 된다.
 */
export const GWP_ALLOWED_ORIGINS = [
  'https://hondi.net',
  'https://911.hondi.net',
  'https://democracy.hondi.net',
  'https://gdc.hondi.net',
  'https://health.hondi.net',
  'https://insurance.hondi.net',
  'https://jeju.hondi.net',
  'https://klaw.hondi.net',
  'https://logistics.hondi.net',
  'https://market.hondi.net',
  'https://police.hondi.net',
  'https://public.hondi.net',
  'https://school.hondi.net',
  'https://security.hondi.net',
  'https://stock.hondi.net',
  'https://tax.hondi.net',
  'https://traffic.hondi.net',
  'https://clean.hondi.net',
  'https://openhash-gopang.github.io',
  location.origin,  // 개발 환경 (localhost 등)
];
