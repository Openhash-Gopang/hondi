/**
 * ai/domain-classifier.js — 1단계 도메인 분류 (2026-08-08 신설)
 *
 * 배경: candidate-prefilter.js(0단계, 순수 문자열 매칭)는 리터럴
 * trigger가 없는 패러프레이즈를 못 좁힌다(문서화된 한계). 이 모듈은
 * 그 한계를 메우는 실제 LLM 기반 1단계다 — deepseek flash에게 93개
 * 개별 후보가 아니라 domain-taxonomy.js의 통합 상위 도메인 9개
 * (getClassifiableDomains() — emergency·onboarding 제외)만 보여주고
 * "이 발화는 어느 도메인인가"를 묻는다. subject-gate.js(리프 정밀화)와
 * 완전히 같은 패턴 — 후보를 줄인 좁은 분류 질문 하나를 저지연·
 * 저비용 모델에 던지고, 실패 시 안전하게 폴백한다.
 *
 * 0단계(candidate-prefilter)와의 관계: 이 모듈은 0단계를 대체하지
 * 않는다 — 0단계가 리터럴 매칭으로 이미 강한 신호를 찾았으면 그걸
 * 우선하고, 이 모듈은 0단계가 실패했을 때(약한/패러프레이즈 발화)
 * 보완적으로 쓰는 게 합리적이다(둘 다 호출해 합집합을 취하는 조합은
 * 통합 지점에서 결정 — 이 모듈 자체는 순수하게 "도메인 분류" 하나만
 * 책임진다).
 *
 * 안전 설계(subject-gate.js와 동일 원칙):
 * - 실패(네트워크 오류·파싱 실패)하면 **좁히지 않는다** — 빈 배열이
 *   아니라 null을 반환해 "이 단계는 판단 불가, 전체 후보로 진행"을
 *   호출부에 명시적으로 알린다. 잘못 좁혀서 정답 도메인을 배제하는
 *   것이, 안 좁히고 전체를 넘기는 것보다 훨씬 나쁘다 — 이 원칙은
 *   subject-gate.js의 폴백 설계(원래 personaId로 복귀)와 동일한
 *   "실패 시 더 넓은 상태로 안전하게 되돌아간다"는 철학이다.
 * - 화이트리스트 검증 — 모델이 taxonomy에 없는 도메인 id를 지어내면
 *   버린다.
 * - 발화 하나가 여러 도메인에 걸칠 수 있다("변호사한테 세무 상담도
 *   같이 받고 싶어요") — 그래서 단일 id가 아니라 배열을 반환하게
 *   설계했다(최대 2개).
 */
import { CFG } from '../core/config.js';
import { getClassifiableDomains } from './domain-taxonomy.js';

function buildSystemPrompt() {
  const domains = getClassifiableDomains();
  const menu = domains
    .map(d => {
      const ex = d.examples ? ` (예: ${d.examples.join(' / ')})` : '';
      return `- ${d.id}: ${d.label}${ex}`;
    })
    .join('\n');
  return (
    '사용자 발화가 아래 도메인 목록 중 어디에 해당하는지 판단하세요. ' +
    '최대 2개까지 고를 수 있습니다(발화가 두 도메인에 걸치는 경우만). ' +
    '어느 도메인에도 명확히 안 속하면(잡담·일반 지식·장소 추천 등) ' +
    '빈 배열을 반환하세요 — 억지로 하나를 고르지 않습니다. ' +
    '반드시 JSON으로만 응답하세요: {"domains": ["<id>", ...]} 또는 {"domains": []}.\n\n' +
    '도메인 목록:\n' + menu
  );
}

/**
 * @param {string} userText - 사용자 발화 원문
 * @returns {Promise<string[] | null>}
 *   매칭된 도메인 id 배열(0~2개), 또는 실패 시 null(=좁히지 말고
 *   전체 후보로 진행하라는 신호 — 빈 배열과 의미가 다르다: 빈 배열은
 *   "판단했고 해당 도메인 없음"이고 null은 "판단 자체에 실패").
 */
export async function classifyDomain(userText) {
  // 메인 답변 앞에서 직렬로 도는 추가 LLM 호출이라 오래 걸리면 응답 전체가 늦어진다 — 1.5초 안에 못 끝내면 포기하고(null) 힌트 없이 진행한다.
  const _ac = new AbortController();
  const _to = setTimeout(() => _ac.abort(), 1500);
  try {
    const res = await fetch(CFG.endpoint + '/chat/completions', {
      signal: _ac.signal,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:       'deepseek-v4-flash',
        // 2026-08-09 수정(60→1000) — subject-gate.js와 동일 결함(deepseek-v4-flash가
        // reasoning_content에 토큰을 먼저 쓰고 content가 빈 문자열로 오는 케이스,
        // subject_gate_live_smoketest.py 실사로 확인). 이 파일도 같은 모델·같은
        // 60 상한을 쓰고 있어 같은 방식으로 실패했을 가능성이 높아 함께 올린다.
        max_tokens:  1000,
        temperature: 0.0,
        stream:      false,
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user',   content: (userText || '').slice(0, 2000) },
        ],
      }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const raw  = data.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    const chosen = Array.isArray(parsed?.domains) ? parsed.domains : null;
    if (chosen === null) return null;

    const validIds = new Set(getClassifiableDomains().map(d => d.id));
    const filtered = chosen.filter(id => validIds.has(id)).slice(0, 2);
    clearTimeout(_to);
    return filtered;
  } catch (e) {
    clearTimeout(_to);
    console.warn('[DomainClassifier] 도메인 분류 실패(무시 — 전체 후보로 진행):', e.message);
    return null;
  }
}
