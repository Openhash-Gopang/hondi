// 혼디 AI 웹사이트 — 기관별 설정 (2026-10-08 신설)
//
// 혼디 숫자 코드를 읽으면 새 탭이 열리고, 대화창에 기관 AI의 고정 인사말만
// 표시된다. 기존 웹사이트처럼 정보를 게시하지 않고, 방문자에게 용건을 묻고
// 그에 맞게 응대한다. 인사말·기관 고정(directCode)은 URL이 아니라 이 표에서만
// 읽는다 — 링크로 임의 문구를 주입(사칭)할 수 없게 하기 위함.
//
// govCode: gov-router.js assembleGovSystemPrompt의 directCode 형식("tier:CODE").
//   null이면 기관을 고정하지 않고 locationHint로 지역만 고정한 뒤 용건에 따라
//   부서로 라우팅한다(도청처럼 여러 부서를 아우르는 기관).
// digitCodes: 이 사이트에 연결된 혼디 숫자 코드. 실제 코드는 아직 배정 전이라
//   비어 있다 — 배정되면 여기에 문자열로 추가한다(첫 자리 1~9).

export const ORG_SITES = {
  'jeju-do': {
    name: '제주도청',
    greeting: '안녕하세요. 저는 제주도청 AI입니다. 무엇을 도와드릴까요?',
    govCode: null,
    locationHint: '제주특별자치도 제주시',
    digitCodes: ['9000000001'], // 테스트용 임의 번호(실서비스 배정 전)
  },
  'jtp': {
    name: '제주테크노파크',
    greeting: '안녕하세요. 저는 제주테크노파크 AI입니다. 무엇을 도와드릴까요?',
    govCode: 'org:SP-ORG-JTP',
    locationHint: '제주특별자치도 제주시',
    digitCodes: ['9000000002'], // 테스트용 임의 번호(실서비스 배정 전)
  },
};

export function findSiteByDigitCode(code) {
  const c = String(code || '').replace(/\D/g, '');
  if (!c) return null;
  for (const [id, s] of Object.entries(ORG_SITES)) {
    if (s.digitCodes.includes(c)) return id;
  }
  return null;
}
