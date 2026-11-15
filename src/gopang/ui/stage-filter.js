/**
 * ui/stage-filter.js — K-Intent·K-Compose·K-Execute 등은 일시적인 처리 단계이지, 저장했다가 다시 부르는 SP가 아니다(2026-11-16, 주피터 지시).
 * 저장·복원되는 대화 기록에서 단계 SP가 자기소개한 턴(과 그 질문)을 지워, 다음 접속 첫 화면에 K-Intent 등이 나오지 않게 한다.
 */
const STAGE = 'K-(?:Intent|Compose|Execute|Deliver|Report|Search)';
const _SELF_INTRO = new RegExp(`(?:저는|이곳은|여기는)?\\s*${STAGE}\\s*(?:입니다|이에요|예요|입니다\\.)|${STAGE}입니다|${STAGE}\\(.{0,12}\\)(?:입니다|에게)`);
const _TRANSITION = new RegExp(`^\\s*🔄.*${STAGE}|단계로 이동 중`);
const _text = (m) => (typeof m?.content === 'string' ? m.content : Array.isArray(m?.content) ? m.content.map(c => c?.text || '').join(' ') : '');
export function isStageTurn(m) {
  if (!m || m.role === 'user' || m.role === 'system') return false;
  const t = _text(m);
  return _SELF_INTRO.test(t) || _TRANSITION.test(t);
}
/** 단계 SP가 말한 턴과 바로 앞의 사용자 질문을 제거한다. */
export function stripStageTurns(arr) {
  if (!Array.isArray(arr)) return [];
  const drop = new Set();
  arr.forEach((m, i) => { if (isStageTurn(m)) { drop.add(i); if (i > 0 && arr[i - 1]?.role === 'user') drop.add(i - 1); } });
  return arr.filter((_, i) => !drop.has(i));
}
