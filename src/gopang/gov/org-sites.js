// 나비 AI 웹사이트 — 기관별 설정 (2026-10-08 신설)
//
// 나비 숫자 코드를 읽으면 새 탭이 열리고, 대화창에 기관 AI의 고정 인사말만
// 표시된다. 기존 웹사이트처럼 정보를 게시하지 않고, 방문자에게 용건을 묻고
// 그에 맞게 응대한다. 인사말·기관 고정(directCode)은 URL이 아니라 이 표에서만
// 읽는다 — 링크로 임의 문구를 주입(사칭)할 수 없게 하기 위함.
//
// govCode: gov-router.js assembleGovSystemPrompt의 directCode 형식("tier:CODE").
//   null이면 기관을 고정하지 않고 locationHint로 지역만 고정한 뒤 용건에 따라
//   부서로 라우팅한다(도청처럼 여러 부서를 아우르는 기관).
// digitCodes: 이 사이트에 연결된 나비 숫자 코드. 실제 코드는 아직 배정 전이라 테스트·샘플 번호만 있다
//   — 배정되면 여기에 문자열로 추가한다(첫 자리 1~9). 이 표가 프로필 조회보다 먼저 보므로, 실제로 판매·배정하는 번호와
//   겹치지 않게 한다(샘플 번호는 배정 대상에서 제외).
// govCode 'none': 행정기관이 아닌 곳(음식점·관광지). 행정 SP 라우팅을 건너뛰고 config(지침·지식·인사말)만 쓴다.
// config: govCode 'none'일 때 서버 라이브 설정이 없으면 이 값을 쓴다.

export const ORG_SITES = {
  'jeju-do': {
    name: '제주도청',
    greeting: '안녕하세요. 저는 제주도청 AI입니다. 무엇을 도와드릴까요?',
    govCode: null,
    locationHint: '제주특별자치도 제주시',
    // 9000000001: 테스트용 임의 번호(실서비스 배정 전). 73905: 보급 계획 문서(admin/jeju-nabi-code-plan.html)의 샘플 코드 — 시연용.
    digitCodes: ['9000000001', '73905'],
  },
  'jtp': {
    name: '제주테크노파크',
    greeting: '안녕하세요. 저는 제주테크노파크 AI입니다. 무엇을 도와드릴까요?',
    govCode: 'org:SP-ORG-JTP',
    locationHint: '제주특별자치도 제주시',
    digitCodes: ['9000000002', '4816203'], // 9000000002: 테스트용, 4816203: 보급 계획 문서 샘플(시연용)
  },
  'jeju-univ-hospital': {
    name: '제주대학교병원',
    greeting: '안녕하세요. 저는 제주대학교병원 AI입니다. 무엇을 도와드릴까요?',
    govCode: 'other:JEJUUH',
    locationHint: '제주특별자치도 제주시',
    digitCodes: ['25918'], // 보급 계획 문서 샘플(시연용)
  },
  'gwangju-court-jeju': {
    // 표시 이름은 샘플 문서와 같게 유지한다. 저장소의 법원 SP는 "제주지방법원"이다(실제 기관 명칭 확인 필요).
    name: '광주지방법원 제주지원',
    greeting: '안녕하세요. 저는 광주지방법원 제주지원 AI입니다. 무엇을 도와드릴까요?',
    govCode: 'nat-agency:court',
    locationHint: '제주특별자치도 제주시',
    digitCodes: ['6049172853'], // 보급 계획 문서 샘플(시연용)
  },
  'jeju-tax-office': {
    name: '국세청 제주세무서',
    greeting: '안녕하세요. 저는 제주세무서 AI입니다. 무엇을 도와드릴까요?',
    govCode: 'nat-agency:tax',
    locationHint: '제주특별자치도 제주시',
    digitCodes: ['380614'], // 보급 계획 문서 샘플(시연용)
  },
  // 아래 두 곳은 행정기관이 아니라 govCode 'none' — 행정 SP 라우팅을 건너뛰고 config의 지침·지식만으로 응대한다.
  // 시연용이며 해당 업소·장소의 공식 서비스가 아니다(demoNotice로 화면에 표시, 지어낸 사실 금지 지침 포함).
  'hongseongbang': {
    name: '중국음식점 홍성방',
    greeting: '안녕하세요. 저는 홍성방 AI입니다. (시연용 — 해당 업소의 공식 서비스가 아닙니다.) 무엇을 도와드릴까요?',
    govCode: 'none',
    locationHint: '제주특별자치도 제주시',
    digitCodes: ['91742650'], // 보급 계획 문서 샘플(시연용)
    config: {
      name: '중국음식점 홍성방',
      greeting: '안녕하세요. 저는 홍성방 AI입니다. (시연용 — 해당 업소의 공식 서비스가 아닙니다.) 무엇을 도와드릴까요?',
      demoNotice: '시연용 화면입니다. 해당 업소의 공식 서비스가 아닙니다',
      instructions: '손님의 용건(메뉴 문의, 예약, 단체 방문, 위치·영업시간)을 먼저 파악한다. 메뉴·가격·영업시간·전화번호 등 구체적인 사실은 아래 지식에 있는 것만 말하고, 없으면 지어내지 말고 업소에 직접 확인하도록 안내한다. 예약은 접수되지 않는 시연 단계임을 알린다.',
      knowledge: '이 AI는 나비 숫자 코드로 연결되는 음식점 AI 안내의 시연이다. 업소의 실제 메뉴·영업시간·연락처는 아직 입력되지 않았다.',
      blocks: [], programs: [], facilities: [], contacts: [],
    },
  },
  'saebyeol-oreum': {
    name: '새별오름',
    greeting: '안녕하세요. 저는 새별오름 AI입니다. (시연용 — 관리 기관의 공식 서비스가 아닙니다.) 무엇을 도와드릴까요?',
    govCode: 'none',
    locationHint: '제주특별자치도 제주시',
    digitCodes: ['2057'], // 보급 계획 문서 샘플(시연용)
    config: {
      name: '새별오름',
      greeting: '안녕하세요. 저는 새별오름 AI입니다. (시연용 — 관리 기관의 공식 서비스가 아닙니다.) 무엇을 도와드릴까요?',
      demoNotice: '시연용 화면입니다. 관리 기관의 공식 서비스가 아닙니다',
      instructions: '방문객의 용건(가는 법, 탐방 코스, 주차, 안전, 볼거리)을 먼저 파악한다. 구체적인 사실(소요 시간, 주차장, 행사 일정, 통제 여부)은 아래 지식에 있는 것만 말하고, 없으면 지어내지 말고 현장 안내나 관리 기관 공지를 확인하도록 안내한다.',
      knowledge: '새별오름은 제주시 애월읍에 있는 오름이다. 이 AI는 나비 숫자 코드로 연결되는 관광지 AI 안내의 시연이며, 실시간 정보(행사·통제·날씨)는 아직 연결되어 있지 않다.',
      blocks: [], programs: [], facilities: [], contacts: [],
    },
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
