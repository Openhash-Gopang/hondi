/**
 * ai/assist-hint.js — 나만의 AI 비서 점검 신호를 [ctx] parts 에 얹는 통합 지점 (2026-11-01 신설)
 *
 * routing-hint.js 와 같은 패턴: 판정은 코드(assistant-runtime.js 등, 결정론)가 하고, AC-PRO-CORE §ASSIST 는 줄을 소비만 한다.
 * 이 모듈은 window.AssistantHost(앱이 설정한 공급자)에서 이번 턴 신호 줄을 받아 그대로 돌려준다.
 *   window.AssistantHost = { async lines(plainText) → string[] }   // 앱 부팅 시 assistant-runtime 과 연결
 * 공급자가 없거나 실패하면 빈 배열 — 비서가 꺼져 있어도 대화는 그대로 동작한다.
 * 안전: 줄은 "접두사:내용" 형식만 허용하고, 대괄호·줄바꿈·길이를 다시 한 번 걸러 AC 태그([GWP:…] 등) 위조를 막는다.
 */
const ALLOWED = /^(점검|점검사유|기한|제안|확인요청):/;

export function sanitizeLine(s) {
  const t = String(s == null ? '' : s).replace(/[\[\]<>{}\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return ALLOWED.test(t) ? t : '';
}

export async function buildAssistHintParts(plainText, host) {
  try {
    const h = host || (typeof window !== 'undefined' ? window.AssistantHost : null);
    if (!h || typeof h.lines !== 'function') return [];
    const raw = await h.lines(plainText);
    return (Array.isArray(raw) ? raw : []).map(sanitizeLine).filter(Boolean).slice(0, 5);
  } catch (e) {
    return [];
  }
}
