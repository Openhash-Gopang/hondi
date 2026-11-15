/**
 * ai/brevity-note.js — 모든 SP의 답변을 짧게 유지한다(2026-11-15, 주피터 지시: "모든 답변은 꼭 필요한 문장 한두 개").
 * system(캐시 prefix)은 건드리지 않고, 이번 턴 user 메시지 끝에만 한 줄을 덧붙여 전송한다(history에는 남기지 않는다).
 */
export const BREVITY_NOTE =
  '[답변 길이: 꼭 필요한 한두 문장만. 인사·되풀이·"~하겠습니다" 예고·자기소개·목록을 쓰지 않는다. ' +
  '서류 초안처럼 사용자가 명시적으로 길게 요청한 산출물만 예외.]';
export function withBrevityNote(content) {
  if (typeof content !== 'string' || !content || content.includes(BREVITY_NOTE)) return content;
  return content + '\n\n' + BREVITY_NOTE;
}
