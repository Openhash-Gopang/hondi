/**
 * ai/goal-path-router.js — 다기관 목표 경로 라우터 v1.0 (2026-09-15 신설)
 *
 * 왜 필요한가
 * ───────────
 * "기관/부서/직책 간 업무 흐름의 최적 경로를 수시로 갱신할 방안"(2026-09-14
 * ~15 설계 논의)의 소비(consumption) 쪽. K-Compose가 다기관 목표(예:
 * 개인회생·개인파산, 10여 개 기관 관여)를 매 세션 처음부터 추론
 * (STEP0-DISCOVER)하는 대신, 과거 실행 이력에서 검증·승인된 "권장 경로"
 * (goal_path_current, worker.js)가 있으면 그걸 강한 사전정보로 먼저 준다.
 *
 * hondi-faq-router.js와 완전히 같은 주입 패턴(키워드 매칭 → user 메시지에만
 * 병합 → system prefix 불변 → DeepSeek 캐시 적중률 영향 없음)을 그대로
 * 쓰되, 차이는 하나다 — hondi-faq-router는 정적 파일(prompts/HONDI-FAQ/*.txt)
 * 을 불러오지만, 이 라우터는 백엔드의 살아있는 데이터(goal_path_current)를
 * 매번 fetch한다. 매칭이 없거나 아직 승인된 경로가 없으면(신규 목표) 아무것도
 * 주입하지 않는다 — 이 경우 K-Compose는 기존처럼 STEP0-DISCOVER로 처음부터
 * 추론하고, 그 세션의 실행 이력이 goal_path_traces에 쌓여 미래의 후보 경로
 * 재료가 된다(순환 고리, worker.js의 스윕·검증·승인 파이프라인 참고).
 *
 * ★ 안전 원칙 재확인 — 여기서 주입하는 recommended_sequence는 반드시
 * goal_path_current를 거친 것이고, 그 테이블은 인간 관리자 승인 없이는
 * 절대 채워지지 않는다(worker.js handleGoalPathApprove만 쓴다). 즉 이
 * 라우터가 K-Compose에 흘려보내는 건 전부 "사람이 이미 한 번 검토한"
 * 정보다.
 */
import { PROXY } from '../core/state.js';

const MAX_INJECT = 1; // 다기관 목표는 한 턴에 보통 하나뿐 — HONDI-FAQ의 2개 상한과 다름

/** @type {{goal_id:string,triggers:string[]}[]} */
export const GOAL_PATH_REGISTRY = [
  {
    goal_id: 'personal-bankruptcy-rehab',
    triggers: ['개인회생', '개인파산', '신용회복위원회', '채무조정', '새출발기금',
               '빚 갚기 어려', '빚이 너무 많', '파산 신청', '회생 신청', '면책'],
  },
  // 새 다기관 목표가 발견되면 여기 항목을 추가한다 — 이 목록 자체는
  // hondi-faq-router.js의 HONDI_FAQ_REGISTRY와 동일하게 사람이 직접
  // 관리한다(자동 생성 아님). goal_path_traces에 쌓인 goal_id가 이
  // 목록에 없으면 그 목표는 애초에 이 라우터로 감지되지 않으므로,
  // 새 목표를 다룰 때는 여기부터 등록해야 한다.
];

function _matchGoalEntries(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  if (text.trim().startsWith('[')) return []; // hondi-faq-router.js와 동일 원칙 — 클라이언트 내부 신호 제외
  const t = text.toLowerCase();
  return GOAL_PATH_REGISTRY.filter(entry =>
    entry.triggers.some(kw => t.includes(kw.toLowerCase()))
  );
}

async function _fetchCurrentPath(goalId) {
  try {
    const res = await fetch(`${PROXY}/goal-path/lookup?goal_id=${encodeURIComponent(goalId)}`, { cache: 'no-cache' });
    if (!res.ok) return null; // 404 = 아직 승인된 경로 없음(정상 케이스, 에러 아님)
    return await res.json();
  } catch (e) {
    console.warn('[GoalPathRouter] 조회 실패(무시 — K-Compose는 기존 발견 로직으로 폴백):', e.message);
    return null;
  }
}

/**
 * 공개 API — 사용자 발화를 받아, 매칭된 목표의 현재 권장 경로를 하나의
 * 문자열 블록으로 반환한다. 매칭이 없거나 아직 승인된 경로가 없으면 빈
 * 문자열을 반환한다(호출부에서 그대로 무시하면 됨) — hondi-faq-router.js
 * buildHondiFaqContext와 동일한 계약.
 *
 * @param {string} userText
 * @returns {Promise<string>}
 */
export async function buildGoalPathContext(userText) {
  const matched = _matchGoalEntries(userText).slice(0, MAX_INJECT);
  if (!matched.length) return '';

  const results = await Promise.all(matched.map(e => _fetchCurrentPath(e.goal_id)));
  const valid = results.filter(Boolean);
  if (!valid.length) return '';

  console.info('[GoalPathRouter] 주입:', matched.map(e => e.goal_id).join(', '));

  const blocks = valid.map(r =>
    `[GOAL-PATH: ${r.goal_id} — 과거 실행 이력을 바탕으로 인간 관리자가 검토·승인한 ` +
    `권장 기관 순서입니다(표본 ${r.sample_size ?? '?'}건, 확신도 점수 ${r.confidence_score ?? '?'}).\n` +
    `${r.recommended_sequence}]`
  );

  // hondi-faq-router.js와 동일한 대괄호 감싸기 — webapp.html의
  // _stripLeadingInternalTag가 내부 지시문으로 인식해 화면에 원문 노출 안 됨.
  return (
    `[GOAL-PATH 참고자료 — 아래는 이번 목표와 관련해 사람이 검토·승인한 권장 경로입니다.` +
    ` 강한 출발점으로 삼되, 이번 사용자의 구체적 상황(이미 보유한 서류, 방문 가능 시간 등)에` +
    ` 맞게 유연하게 재배열해도 됩니다 — 강제 순서가 아닙니다.\n` +
    blocks.join('\n\n') +
    `]\n\n`
  );
}
