/**
 * ai/return-default-intent.js — "나만의 AI 비서로 돌아가기" 요청을 AI 없이 판별한다(2026-11-15).
 * 나만의 AI 비서(AC-PRO-CORE, 그림자 AI)가 기본 SP이고, K-Compose·전문가 등은 비서가 호출한 SP다.
 * 이용자는 언제든 기본 SP로 돌아갈 수 있어야 한다. 보수적으로 매칭: 20자 이하의 짧은 명령만.
 */
const _EXACT = /^(처음으로|기본으로|원래대로|원래\s*(상태|화면)로|비서(로)?|나비(로)?|나만의\s*(ai\s*)?비서(로)?)\s*(가|가줘|가자|돌아가|돌아가줘|돌아가자|돌려줘|돌려\s*줘|복귀|복귀해|복귀해줘)?[.!요\s]*$/i;
const _VERB  = /(돌아가|돌아와|돌아갈|돌려|되돌|복귀|나가|나갈|종료|끝내|그만)/;
const _TARGET = /(나만의\s*(ai\s*)?비서|그림자\s*(ai)?|내\s*비서|기본\s*(비서|ai|sp)?|처음|원래|나비|비서)/i;
const _EXCLUDE = /(방법|어떻게|왜\s|뭐|무엇|알려|설명|기록|내용|요약|번역|삭제|가입|탈퇴)/;
export function matchReturnToDefaultIntent(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  if (!t || t.length > 20 || _EXCLUDE.test(t)) return false;
  if (_EXACT.test(t)) return true;
  return _VERB.test(t) && _TARGET.test(t);
}
