/**
 * ai/reply-guard.js — LLM 답변 검문(2026-11-12).
 * 나비는 사용자가 보낼 때만 응답하고, 실제로 일어나는 일은 [TAG] 로 시스템이 실행한다.
 * 그런데 모델이 하지 않은 일을 했다고 말하거나 "나중에 알려 드리겠다"고 약속하는 일이 반복된다(프롬프트 금지만으로는 막히지 않음).
 * 그래서 화면에 나간 답변을 코드로 검사해, 실행 태그 없이 이런 표현이 있으면 고정 안내문으로 바꾼다. 모델과 무관하게 항상 적용된다.
 */
export const GUARD_MESSAGE =
  '방금 답은 실제로 하지 않은 일을 한 것처럼 말해 취소했습니다. 나비는 보내신 말에만 답하며 나중에 알려 드리지 못합니다. ' +
  '사람과 대화하려면 상대의 @아이디나 전화번호를 입력해 주세요.';

// 실행 태그: [SEARCH: …] [CALL_GOVTREE: …] 처럼 대문자·밑줄로 시작하는 대괄호 신호.
const ACTION_TAG = /\[[A-Z][A-Z0-9_]{2,}\b/;

// 거짓 실행 보고·나중에 알림 약속·재시도 보고.
const FAKE_ACTION = new RegExp([
  '알려\\s*드리겠', '알려\\s*드릴게', '알려\\s*드리도록', '연락\\s*드리겠', '전달\\s*드리겠', '보내\\s*드리겠',
  '결과가?\\s*(확인|나오)\\S*\\s*(대로|즉시|바로)',
  '요청을?\\s*(다시\\s*)?(넣었|보냈|접수했|전달했|드렸)',
  '(호출|초대|연결)\\s*(요청)?\\s*(을|를)?\\s*(다시\\s*)?(했습니다|하겠습니다|할게요|해\\s*두었|보냈|넣었)',
  '채팅(방)?(으로|에)\\s*초대하겠', '알림을?\\s*보냈', '(전달|연결|호출)했습니다', '다시\\s*(요청|시도)합니다',
].join('|'));

/** @returns {{blocked:boolean, text:string}} */
export function guardReply(text) {
  const t = String(text == null ? '' : text);
  if (!t || ACTION_TAG.test(t)) return { blocked: false, text: t };
  if (FAKE_ACTION.test(t)) return { blocked: true, text: GUARD_MESSAGE };
  return { blocked: false, text: t };
}
