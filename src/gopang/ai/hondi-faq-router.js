/**
 * ai/hondi-faq-router.js — 혼디 생태계 지식 FAQ 라우터 v1.0
 *
 * 왜 필요한가
 * ───────────
 * AGENT-COMMON(시스템 프롬프트)에 혼디 생태계 지식을 전부 넣으면 문서가
 * 계속 커져서 lost-in-the-middle(긴 문서 중간 부분을 모델이 소홀히 다루는
 * 현상) 위험이 커진다. 대신 이 파일은 src/gopang/onboarding/industry-router.js
 * (KSIC 77개 업종을 키워드로 매칭해 필요한 SP만 불러오는 방식)와 완전히
 * 같은 패턴을, "업종 지식"이 아니라 "혼디 시스템 자체에 대한 지식"에
 * 적용한다.
 *
 * 동작 방식
 * ─────────
 * 1) 사용자 발화에서 키워드가 매칭되면 해당 주제의 상세 설명 파일(.txt)을
 *    prompts/HONDI-FAQ/에서 불러온다.
 * 2) 이 내용은 시스템 프롬프트(system 메시지)가 아니라 그 턴의 user
 *    메시지에만 병합된다(call-ai.js의 _buildEnhancedUserContent 참조) —
 *    system prefix를 건드리지 않아 DeepSeek Auto Prompt Caching 적중률을
 *    그대로 유지한다.
 * 3) 매칭이 없으면 아무것도 주입하지 않는다 — AGENT-COMMON 자체 지식만으로
 *    답하게 두고, 불필요한 토큰을 쓰지 않는다.
 * 4) 한 턴에 너무 많은 주제가 한꺼번에 매칭되면(사용자가 여러 개념을 한
 *    문장에 섞어 물은 경우) 토큰 낭비를 막기 위해 최대 2개까지만 주입한다.
 *
 * industry-router.js와의 차이
 * ────────────────────────────
 * - industry-router는 "정확히 1개로 확정"이 목표(가입 시 업종 하나를
 *   정해야 함)라 후보가 여러 개면 LLM에 재확인을 위임한다.
 * - 이 라우터는 확정이 목적이 아니라 "참고 자료 주입"이 목적이라, 여러 개
 *   매칭돼도 상한선(MAX_INJECT)까지는 전부 주입하고, 매칭이 없으면 그냥
 *   조용히 넘어간다(LLM 폴백 호출 없음 — 매 턴 발생하는 일반 대화에서
 *   폴백 LLM 호출까지 추가하면 오히려 비용·지연이 늘어나기 때문).
 */

const _SP_BASE = '/prompts/HONDI-FAQ/';

/** @type {{id:string,label:string,file:string,triggers:string[]}[]} */
export const HONDI_FAQ_REGISTRY = [
  {
    id: 'pdv', label: 'PDV(개인 데이터 금고)', file: 'pdv.txt',
    triggers: ['PDV', 'pdv', '기록 금고', '나의 기록', '내 데이터 어디',
               '데이터 어디 저장', '어디에 저장', '어디 저장', '대화 저장', '대화 어디',
               '삭제하고 싶어', 'Private Data Vault', '개인정보 어디', '유출',
               '서버에 남', '서버에 저장', '내 번호 저장', '번호 저장되는'],
  },
  {
    id: 'openhash', label: 'OpenHash(위변조 불가 원장)', file: 'openhash.txt',
    triggers: ['OpenHash', 'openhash', '오픈해시', '위변조', '블록체인',
               '해시체인', '해시 체인', '앵커링'],
  },
  {
    id: 'gdc', label: 'GDC(화폐·결제)', file: 'gdc.txt',
    triggers: ['GDC', 'gdc', '수수료', '잔액', '충전', '결제 어떻게',
               '환전', '디지털 통화'],
  },
  {
    id: 'auth', label: '인증 레벨(L0~L3)', file: 'auth.txt',
    triggers: ['인증', '로그인', 'L0', 'L1', 'L2', 'L3', '지문', '얼굴 인증',
               'Face ID', '4단어', '시드'],
  },
  {
    id: 'governance', label: '오픈소스·비영리·거버넌스', file: 'governance.txt',
    triggers: ['오픈소스', '비영리', '주주', '투자자', '거버넌스', 'DAWN',
               '투표', '회사냐', '회사야', '회사인가', '기업이야', '누가 운영',
               '누가 만들', '만든 사람', '딴데 파는', '데이터 파는', '데이터 판매',
               '정보 파는', '광고에 활용'],
  },
  {
    id: 'hondi-code', label: '혼디코드', file: 'hondi-code.txt',
    triggers: ['혼디코드', '숫자 코드', '숫자코드', '색상 코드', '컬러 코드', 'QR', '내 코드'],
  },
  {
    id: 'gwp-vs-expert', label: '기관 AI vs 전문가 AI', file: 'gwp-vs-expert.txt',
    triggers: ['GWP', 'EXPERT', '전문가 AI', '기관 AI', '변호사 AI',
               '자문료', 'K-Law가 뭐', 'K-Tax가 뭐'],
  },
  {
    id: 'quota', label: '무료 사용량(1,000원 한도)', file: 'quota.txt',
    triggers: ['1000원', '1,000원', '무료 한도', '사용량', '얼마나 썼',
               '전기료', '한도 다 썼', 'FREE_QUOTA', '돈 내야', '돈 내나요',
               '유료예요', '무료예요', '공짜예요', '요금 나가'],
  },
  {
    id: 'search-vs-menu', label: '검색과 오른쪽 메뉴 차이', file: 'search-vs-menu.txt',
    triggers: ['검색이랑', '검색해도 안', '검색 결과 없', '검색했는데 결과',
               '검색했는데 안', '검색해봤는데', '검색해도 결과', '검색해도 아무',
               '오른쪽 메뉴랑', '찾기 버튼'],
  },
  {
    id: 'tutorial-redo', label: '사용법 다시 안내', file: 'tutorial-redo.txt',
    triggers: ['튜토리얼 다시', '처음부터 다시', '사용법 다시', '설명 다시',
               '다시 알려줘'],
  },
  {
    id: 'shadow-ai', label: '그림자 AI(나만의 AI 비서)', file: 'shadow-ai.txt',
    triggers: ['그림자 AI', '그림자AI', '나만의 AI', '왜 그림자', '그림자란',
               'shadow ai'],
  },
  {
    id: 'k-market', label: 'K-Market 거래 검증', file: 'k-market.txt',
    triggers: ['K-Market', 'k-market', '케이마켓', '거래 검증', '가격 위조',
               '주문 검증'],
  },
  {
    id: 'seom', label: 'SEOM 보상', file: 'seom.txt',
    triggers: ['SEOM', 'seom', '노드 운영', '노드 보상', '인프라 보상'],
  },
  {
    id: 'k-law-safety', label: 'K-Law 감시·K-Police·K-119', file: 'k-law-safety.txt',
    triggers: ['K-Law', 'k-law', '케이로', 'K-Police', 'K-119', '판결 예측',
               '법률 자문 받고 싶', '신고하고 싶어', '증거 보존'],
  },
  {
    id: 'institution-account', label: '기관·사업자 계정', file: 'institution-account.txt',
    triggers: ['사업자 계정', '기관 계정', '운영자 모드', '가게 계정',
               '사장님 계정', '내 가게 AI'],
  },
  {
    id: 'backup-key', label: '백업 키·계정 복구', file: 'backup-key.txt',
    triggers: ['백업 키', '백업키', '계정 복구', '휴대폰 바꾸면', '핸드폰 바꾸면',
               '기기 바꾸면', '휴대폰 잃어버렸', '핸드폰 잃어버렸', '폰 잃어버렸',
               '폰 바꾸면'],
  },
  {
    // 2026-09-14 신설 — 사고실험 중 발견: K-Compose 등 개별 SP의
    // [정체성] 섹션은 "너는 K-Compose다" 식으로 자기 자신만 정의할 뿐,
    // "혼디"가 이 플랫폼/AI 비서 자신의 이름이라는 사실 자체가 어디에도
    // 없었다. 그 결과 사용자가 "혼디"라는 단어를 언급(특히 음성인식이
    // "혼디"를 "언니" 등으로 잘못 옮긴 뒤 사용자가 텍스트로 정정할 때)
    // 하면, RULE-01류 "지어내지 않는다" 원칙 때문에 모델이 이를 미지의
    // 제3자로 취급해 "제 소관 밖"이라며 발을 빼는 오작동이 실사로
    // 확인됐다. 이 항목은 그 발화 자체를 폭넓게 잡아(바로 아래 '혼디'
    // 단독 트리거 포함) overview.txt를 주입, 자기 이름으로 정확히
    // 인식하게 한다. 'overview' 항목과 파일을 공유하되 트리거를 분리한
    // 이유: 기존 overview 트리거는 "이 앱이 뭐 하는 곳인지" 질문용이고,
    // 이 항목은 "혼디"라는 단어 자체에 대한 정체성 질문용이라 트리거
    // 성격이 달라 한 항목에 섞으면 유지보수가 어려워진다.
    id: 'hondi-name', label: '"혼디"라는 이름 자체(정체성)', file: 'overview.txt',
    triggers: ['혼디', '혼디가 뭐', '혼디란', '혼디는 뭐', '혼디 뜻', '혼디 의미',
               '혼디가 무슨 뜻', '왜 혼디', '혼디 이름', '너 이름', '당신 이름',
               'AI 이름', '비서 이름', '이름이 뭐'],
  },
  {
    id: 'overview', label: '혼디가 뭐하는 앱인가요', file: 'overview.txt',
    triggers: ['뭐하는 앱', '뭐 하는 앱', '무슨 앱', '뭐하는 서비스', '카톡이랑',
               '카카오톡이랑', '어떤 앱이', '처음이라'],
  },
  {
    id: 'signup', label: '회원가입 방법', file: 'signup.txt',
    triggers: ['회원가입', '가입 어떻게', '가입은 어떻게', '가입 방법',
               '어떻게 가입', '어떻게 시작'],
  },
  {
    id: 'withdrawal', label: '탈퇴·계정 삭제', file: 'withdrawal.txt',
    triggers: ['탈퇴', '계정 삭제', '계정 지우고', '계정 지울', '회원 탈퇴',
               '가입 취소'],
  },
];

const MAX_INJECT = 2; // 한 턴에 최대 몇 개 주제까지 주입할지

// 파일 내용 캐시 — 같은 세션에서 같은 주제를 반복 조회해도 재요청하지 않음
const _fileCache = new Map();

async function _loadFaqFile(entry) {
  if (_fileCache.has(entry.id)) return _fileCache.get(entry.id);
  try {
    const res = await fetch(_SP_BASE + entry.file, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HONDI-FAQ 로드 실패: ${res.status} (${entry.file})`);
    const text = await res.text();
    _fileCache.set(entry.id, text);
    return text;
  } catch (e) {
    console.warn('[HondiFaqRouter] 로드 실패(무시):', entry.id, e.message);
    return null; // 실패해도 대화 자체는 계속돼야 하므로 조용히 무시
  }
}

/**
 * 사용자 발화에서 매칭되는 FAQ 항목을 찾는다(키워드 포함 여부, 대소문자 무시).
 * @param {string} text
 * @returns {{id:string,label:string,file:string,triggers:string[]}[]}
 */
function _matchFaqEntries(text) {
  if (!text || typeof text !== 'string') return [];
  // BUG-FIX(2026-07-01, 사고실험 중 발견): _tutorialSignal 등 클라이언트가
  // 내부적으로 보내는 신호는 "[TUTORIAL_ACTION: pdv_opened — 사용자가 PDV를
  // 열었습니다...]"처럼 텍스트 안에 "PDV" 같은 트리거 단어를 그대로 포함한다.
  // 이건 실제 사용자가 타이핑한 질문이 아니라 클라이언트가 만든 내부
  // 메시지이므로, FAQ를 매칭하면 안 되는 대상이다(엉뚱한 시점에 불필요한
  // FAQ 블록이 끼어들어 튜토리얼 스크립트와 뒤섞일 수 있음). 실제 사용자가
  // 타이핑한 메시지는 거의 항상 "["로 시작하지 않으므로, 이 패턴만으로
  // 안전하게 내부 신호를 걸러낼 수 있다.
  if (text.trim().startsWith('[')) return [];
  const t = text.toLowerCase();
  // BUG-FIX(2026-07-01, 신규 사용자 질문 사고실험 중 발견): 'PDV'·'GDC'·
  // 'SEOM' 같은 짧은 영문 약어를 단순 부분 문자열로 매칭하면, "PDVD플레이어"
  // (PDV를 포함) 나 "GDCC 코인"(GDC를 포함) 처럼 전혀 무관한 단어 안에
  // 우연히 그 글자들이 들어있어도 매칭돼 버린다. 순수 영숫자·하이픈으로만
  // 이루어진 트리거(예: PDV, GDC, K-Law)는 단어 경계(\b)를 확인해 "그
  // 단어 자체"로 쓰였을 때만 매칭하고, 한글 구문 트리거(예: '기록 금고')는
  // 이런 부분 문자열 오탐 위험이 훨씬 낮으므로 기존처럼 단순 포함 검사를
  // 유지한다.
  const _ALNUM_ONLY = /^[a-z0-9-]+$/i;
  function _hit(kw) {
    const kwLower = kw.toLowerCase();
    if (_ALNUM_ONLY.test(kw)) {
      return new RegExp(`(?:^|[^a-z0-9])${kwLower.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(?:[^a-z0-9]|$)`, 'i').test(t);
    }
    return t.includes(kwLower);
  }
  return HONDI_FAQ_REGISTRY.filter(entry =>
    entry.triggers.some(_hit)
  );
}

/**
 * 공개 API — 사용자 발화를 받아, 매칭된 FAQ 내용을 하나의 문자열 블록으로
 * 합쳐 반환한다. 매칭이 없으면 빈 문자열을 반환한다(호출부에서 그대로
 * 무시하면 됨).
 *
 * @param {string} userText
 * @returns {Promise<string>} 예: "[HONDI-FAQ: PDV — ...]\n...\n\n[HONDI-FAQ: GDC — ...]\n..."
 */
export async function buildHondiFaqContext(userText) {
  const matched = _matchFaqEntries(userText).slice(0, MAX_INJECT);
  if (!matched.length) return '';

  const blocks = await Promise.all(matched.map(_loadFaqFile));
  const valid  = blocks.filter(Boolean);
  if (!valid.length) return '';

  console.info('[HondiFaqRouter] 주입:', matched.map(e => e.id).join(', '));

  // 전체를 단일 대괄호 블록으로 감싼다(내부에 각 FAQ 파일 자체의
  // [HONDI-FAQ: ...] 헤더가 중첩돼 있어도 대괄호 깊이가 짝을 맞추므로
  // 문제 없음). 이렇게 감싸두면 webapp.html 패널의 _stripLeadingInternalTag
  // (대괄호 깊이 계산으로 내부 지시문을 통째로 벗겨내는 함수)가 이 블록
  // 전체를 하나의 내부 지시문으로 인식해, 히스토리 복원 시 화면에 그대로
  // 노출되지 않는다. 동시에 "참고자료일 뿐 대본이 아니다"를 여기서 다시
  // 한번 명시해 §0-1-P 원칙과 일관성을 유지한다.
  return (
    `[HONDI-FAQ 참고자료 — 아래는 이번 질문과 관련된 혼디 시스템 상세 설명입니다.` +
    ` 참고해서 자연스럽게 답변에 녹여내되, 그대로 베끼지 말고 표현을 바꿔서 전달하십시오.\n` +
    valid.join('\n\n') +
    `]\n\n`
  );
}
