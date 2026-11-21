// src/worker/kaddr-history.js — K-Address 대화 기록 정리 (2026-11-21)
//
// 오류로 끝난 요청은 화면 쪽 대화 기록에 사용자 메시지만 남을 수 있다(답변 없음). 그대로 AI 에 주면
// 다음 요청 때 밀린 요청까지 함께 실행한다(실사고: 앞서 실패한 "연습-가·연습-나 삭제"가 "practice1 삭제"에 딸려 함께 실행됨).
// 답변 없이 이어진 사용자 메시지는 마지막 하나만 남긴다.
export function dropUnansweredUserTurns(messages) {
  const out = [];
  for (const m of messages || []) {
    if (m && m.role === 'user' && out.length && out[out.length - 1].role === 'user') out[out.length - 1] = m;
    else out.push(m);
  }
  return out;
}
