/**
 * ai/clarify-guard.js — "되묻기 턴에는 라우팅 태그를 실행하지 않는다"
 * 코드 레벨 강제 (2026-09-17 신설)
 *
 * 배경(라이브 스모크테스트 재현, tests/live_smoketest/scenarios_full_
 * routing_20260917_expert-leaf.json): AC-PRO-CORE_v1_16.txt에 "되묻는
 * 턴에는 [GWP:]/[EXPERT:] 태그를 함께 내지 않는다"는 프롬프트 규칙을
 * 명시했는데도, v1.17 재검증(lawyer-13 재현, 26건)에서 lawyer-auction
 * 케이스가 다시 재발했다:
 *
 *   [GWP: klaw]
 *   등기·경매 관련 문의시군요. 다만 등기·경매는 변호사가 아니라
 *   법무사의 전속 업무입니다 ... 어느 쪽이신가요?
 *
 * 즉 "애매하면 되묻는다"는 판단은 정확히 했으면서도, 같은 응답 안에서
 * 태그를 이미 확정해 실행 가능한 상태로 냈다. 프롬프트 지시만으로는
 * 준수율이 100%가 안 되는 클래스의 문제라(lawyer/klaw 트리거 중첩 같은
 * "지식 격차"와 달리 "습관/실행" 문제), 결정적(deterministic) 코드
 * 레벨 방어로 이 불변식을 강제한다 — 모델이 실수로 태그를 같이 내도
 * 실제 서비스 동작(탭 오픈 등)에는 영향이 없어야 한다.
 *
 * ★ 알려진 한계 (정직하게 기록) ★
 * 1) 정규식 휴리스틱이라 완벽하지 않다 — 되묻기가 아닌데 우연히
 *    물음표로 끝나는 문장("확인 도와드릴까요?"처럼 사실상 안내 멘트)을
 *    오탐할 수 있다. 오탐의 대가는 "정상 라우팅이 한 턴 늦어짐"(사용자가
 *    한 번 더 확인해야 함) 정도로, 반대 방향 실패(오배정된 서비스로
 *    바로 열림)보다 비용이 작다고 판단해 보수적으로(넓게) 잡았다.
 * 2) "됨/입니다"로 끝나는 확정 문장 안에 있는 물음표(예시 인용 등)는
 *    본문 전체가 아니라 마지막 1~2줄만 검사해 오탐을 줄인다
 *    (tests/live_smoketest/reanalyze_needs_clarify_20260917.py와 동일
 *    설계).
 * 3) 이 가드가 걸리면 태그 자체를 실행하지 않을 뿐 응답 텍스트는
 *    그대로 사용자에게 보여준다 — 되묻는 문장 자체는 유효한 응답이므로
 *    지우거나 바꾸지 않는다.
 */

const CLARIFY_PATTERNS = [
  /[?？]\s*$/,                                    // 물음표로 끝남
  /(이신가요|이신지요|일까요|이실까요)[.?]?\s*$/,
  /(어느\s*(쪽|분야|과)|어떤\s*(쪽|분야|과))/,
  /말씀해\s*주(시겠어요|세요)/,
  /맞으신가요|맞을까요/,
  /원하시는\s*게|원하시나요/,
];
const CLARIFY_RE = new RegExp(CLARIFY_PATTERNS.map(r => r.source).join('|'));

/**
 * 응답 텍스트가 "되묻는 턴"으로 보이는지 판단한다. 전체가 아니라 마지막
 * 1~2개 비어있지 않은 줄만 검사한다(중간에 예시로 물음표가 섞인 경우
 * 오탐 방지).
 * @param {string} fullReply
 * @returns {boolean}
 */
export function looksLikeClarifyingResponse(fullReply) {
  if (!fullReply || typeof fullReply !== 'string') return false;
  const lines = fullReply.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return false;
  const tail = lines.slice(-2).join(' ');
  return CLARIFY_RE.test(tail);
}

/**
 * 되묻는 턴이면 태그 실행용 id를 무효화(null)한다 — 호출부는 이 함수를
 * 거친 값으로만 실제 라우팅(탭 오픈 등)을 실행해야 한다. id 자체는
 * 로깅용으로 두 번째 인자에 그대로 보존해 반환하므로, "원래 뭘 내려다가
 * 막았는지" 콘솔에서 계속 추적 가능하다.
 * @param {string|null} id - 파싱된 GWP/EXPERT id (없으면 null)
 * @param {string} fullReply - 태그 판단에 쓸 전체 응답 원문
 * @param {string} tagLabel - 로그용 태그 이름("GWP"|"EXPERT")
 * @returns {string|null} - 되묻기로 판단되면 null, 아니면 원래 id 그대로
 */
export function suppressTagIfClarifying(id, fullReply, tagLabel) {
  if (!id) return id;
  if (looksLikeClarifyingResponse(fullReply)) {
    console.info(
      `[ClarifyGuard] 되묻는 턴으로 판단돼 [${tagLabel}: ${id}] 실행을 막음 ` +
      `— 응답 텍스트는 그대로 표시하고 라우팅만 보류합니다.`
    );
    return null;
  }
  return id;
}
