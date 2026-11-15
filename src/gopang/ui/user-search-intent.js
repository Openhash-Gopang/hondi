/**
 * ui/user-search-intent.js — 채팅창 글이 "사용자 찾기·호출" 요청인지 AI 없이 판별한다(call-ai.js 에서 분리, 2026-11-15).
 */
// 2026-11-12 신설 — "사용자 검색", "나비 웹 사용자 검색", "친구 찾기" 같은 짧고 분명한 명령은
// LLM을 거치지 않고(약 100KB SP를 매번 싣는 호출을 생략) 즉시 검색창을 연다. 기다림 없이 바로 응답하는 것이 목적.
// 보수적으로 매칭: 25자 이하이고 '사용자/이용자/대화 상대/친구' + '검색/찾기' 조합일 때만.
export const _USER_SEARCH_NOUN   = /(사용자|이용자|대화\s*상대|상대방?|친구|채팅|대화)/;
export const _SEARCH_VERBS = '검색|찾아|찾기|찾고|찾을|찾는|연결|불러|부르|호출|연락|통화|전화|대화|채팅|말\\s*걸|메시지|메세지|문자|톡|초대|만나|접속|콜';
export const _USER_SEARCH_ACTION = new RegExp('(' + _SEARCH_VERBS + ')');
export const _NOT_A_NAME = /^(오늘|내일|모레|어제|지금|나중|아까|이따|병원|의원|은행|식당|회사|학교|시청|구청|도청|경찰|소방|택시|배달|고객센터|관공서|우체국|약국|호텔|공항|누구|아무|다시|바로|계속)/;
export const _USER_NAME_VERB = new RegExp('^([가-힣]{2,5}?)\\s*(님|씨)?\\s*(을|를|께|과|와|랑|하고|한테|에게|이랑)?\\s*(' + _SEARCH_VERBS + ')');
export const _USER_SEARCH_EXCLUDE = /(방법|어떻게|왜\s|뭐|무엇|알려|기록|내용|요약|번역|설명|내\s*(번호|전화|아이디)|저장|등록|가입|삭제)/;   // 질문·다른 용무로 보이면 LLM 으로
export function _matchUserSearchIntent(text) {
  if (!text || typeof text !== 'string') return null;
  const t = text.trim();
  if (!t || t.length > 40 || t.startsWith('[')) return null;
  // 번호나 @아이디만 입력한 경우(예: '@98807170', '010-9880-7170')는 말없이 바로 검색한다.
  const _bare = t.replace(/[\s.]+$/, '');
  if (/^@[A-Za-z0-9._-]{3,}$/.test(_bare) || /^\+?[0-9][0-9\s-]{7,16}[0-9]$/.test(_bare)) return { query: _bare };
  const num = t.match(/@?[0-9][0-9-]{6,14}[0-9]|@[A-Za-z0-9._-]{3,}/);   // 번호·아이디가 함께 있으면 그대로 채워 연다
  // '@98807170을 연결해줘'처럼 아이디·번호와 연결/찾기 동사가 함께 있으면 '사용자' 같은 명사가 없어도 바로 검색한다.
  if (num && _USER_SEARCH_ACTION.test(t) && !_USER_SEARCH_EXCLUDE.test(t)) return { query: num[0] };
  // 'gildong 호출', 'gildong님께 연결'처럼 영문 아이디 + 연결 동사(카카오톡처럼 아이디는 정확히 입력하는 값이라 AI 없이 바로 검색)
  const _idv = t.match(new RegExp('^@?([a-z][a-z0-9_-]{2,29})\\s*(님|씨)?\\s*(을|를|께|과|와|랑|하고|한테|에게|이랑)?\\s*(' + _SEARCH_VERBS + ')', 'i'));
  if (_idv && !_USER_SEARCH_EXCLUDE.test(t)) return { query: _idv[1] };
  // '김동 님 호출', '김동 연결해줘'처럼 이름 + 연결 동사만 있는 경우(저장된 자주 찾는 사용자가 아닐 때): LLM 이 한 일처럼 꾸며 답하지 못하게 바로 안내하고 검색창을 연다.
  const _nv = t.match(_USER_NAME_VERB);
  if (_nv && !/^(사용자|이용자|상대|상대방|친구|대화|채팅|사람)$/.test(_nv[1]) && !_USER_SEARCH_EXCLUDE.test(t) && !/번호|예약|상담|신청|민원/.test(t) && !_NOT_A_NAME.test(t)) return { query: _nv[1] };   // 이름을 그대로 검색창에 채워 바로 검색(상대가 이름 찾기를 허용한 경우)
  if (!_USER_SEARCH_NOUN.test(t) || !_USER_SEARCH_ACTION.test(t) || _USER_SEARCH_EXCLUDE.test(t)) return null;
  return { query: num ? num[0] : '' };
}
