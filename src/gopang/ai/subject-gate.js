/**
 * ai/subject-gate.js — EXPERT 2단계 과목 게이트 (2026-08-08 신설)
 *
 * 배경(사고실험 사전 코드추적으로 확인된 구조적 결함): §CATALOG-EXPERT
 * 표는 라우팅 후보를 절약하려고 professor/physician/lawyer를 각각 한
 * 줄로만 올린다(예: professor | 교수(1:1 맞춤교육)). 세부 리프(교수
 * 158개+, 의사 26개, 변호사 47개)는 이 표에 없으므로, 1단계 라우팅 LLM은
 * "[EXPERT: professor]"까지만 낼 수 있고 "[EXPERT: professor-math]"처럼
 * 구체적인 리프 ID는 스스로 지어낼 근거가 없다(오히려 표에 없는 ID를
 * 지어내지 않도록 설계돼 있어, 만들어내지도 않는다).
 *
 * 이 모듈은 handleExpertTag가 1단계에서 professor/physician/lawyer 같은
 * "리프 아닌" personaId를 받았을 때, getConsultableChildren()으로 그
 * 직계 자식 후보만 모아 저지연 경량 모델(deepseek-v4-flash,
 * report-utils.js summarizeHandoffContext6W와 동일 패턴)로 사용자 발화를
 * 그 후보 중 하나에 재분류하고, 선택된 자식이 또 자식을 가지면(=아직
 * 리프가 아니면) 같은 방식으로 한 단계 더 내려간다(refineToLeaf, 2026-08-10
 * flat→계층형 리팩터 — 사유는 아래 refineToLeaf 주석 참고). 실패(네트워크
 * 오류, 파싱 실패, 후보 0개)하면 그 단계의 personaId로 안전하게 폴백한다 —
 * 사용자 흐름을 절대 막지 않는다.
 */
import { CFG } from '../core/config.js';
import { EXPERT_REGISTRY, getConsultableChildren } from './expert-registry.js';

// 2026-08-10 개정 — "확신이 없으면 null" 지시(2026-08-09에 반례 4건까지
// 구체적으로 추가했던 버전)를 실사로 재검증한 결과, 완전공백 4과목
// (음악/기술가정/한문/진로) 전부 반례를 그대로 명시했는데도 매번 똑같이
// 억지 매칭을 반복했다(raw_response가 {"id": null}이 아니라 확신도 높은
// JSON 정답 그대로) — 프롬프트 문구를 아무리 강하게 써도 "목록에서 하나
// 고르기"라는 과제 프레이밍 자체를 못 이겼다는 뜻으로 판단.
// 그래서 접근을 바꾼다: "예외적으로 null을 내라"는 별도 지시 대신,
// "해당 없음"을 후보 목록 안의 정식 항목으로 넣는다(_buildGateCandidates).
// 모델 입장에서는 여전히 "목록에서 하나 고르기"라는 같은 과제이고, 그
// 항목을 고르면 코드는 그걸 원래 personaId로 안전 폴백시킨다 — null
// 특수 케이스를 하나 더 얹는 게 아니라, 이미 있는 "목록에서 고르기"
// 메커니즘 자체를 안전한 결과로 이어지게 만드는 구조적 수정이다.
const GATE_SYS_PROMPT_HEAD =
  '사용자 발화를 아래 후보 목록 중 정확히 하나로 분류하세요. 후보 목록 ' +
  '맨 마지막 항목은 그 어떤 전공도 실제로 맞지 않을 때 고르는 "해당 ' +
  '없음" 항목입니다 — 발화 소재와 이름이 비슷하거나 어렴풋이 연상되는 ' +
  '전공이 있어도, 그 전공이 실제로 다루는 정규 교과·분야가 아니면 ' +
  '억지로 고르지 말고 이 "해당 없음" 항목을 고르십시오. 반드시 후보 ' +
  '목록의 id 값 중 하나만, 다른 텍스트 없이 JSON으로만 응답하세요: ' +
  '{"id": "<후보 id>"}.\n\n후보 목록:\n';

// ── 2026-08-08 신설(초중고 학년대 어휘 보강) ────────────────────────
// 배경(주피터 지시): 초등 산수와 대학 수학을 별도 페르소나로 안 쪼갠다
// — SP_professor_v1_5.md §3-1(학습자 프로파일 확정)이 이미 학습자
// 수준에 맞춰 교수법을 조정하도록 설계돼 있어, professor-math 하나가
// 초등학생부터 대학원생까지 다 받는다(persona 정체성은 그대로,
// 교수법만 상대에 맞춤). 다만 이 게이트의 후보 메뉴는 EXPERT_REGISTRY의
// label(예: "교수(수학)")을 그대로 보여주는데, 이 라벨은 학과 명칭
// 위주라 "산수"·"구구단"처럼 초등 수준 발화에 쓰이는 실제 어휘와
// 문자열이 안 겹칠 수 있다 — 그러면 분류 LLM이 후보 중 뚜렷이 맞는
// 게 없다고 보고 null을 낼 위험이 있다. EXPERT_REGISTRY.label 자체는
// 건드리지 않는다(그 필드는 새 탭 제목 등 다른 곳에도 쓰임) — 이 게이트
// 전용으로 리프 id별 저학년 동의어를 별도로 매핑해 메뉴에만 덧붙인다.
// 커버 범위는 초중고 정규 교과 중 대응되는 대학 학과가 명확한 것만
// (국어/수학/영어/과학/사회/체육/미술) — 음악처럼 리프가 세부장르별로만
// 쪼개져 있어 마땅한 초등 catch-all 리프가 없는 과목은 일단 제외했다
// (필요해지면 그때 재검토).
// 2026-08-09 export 추가(행동 변화 없음) — tests/live_smoketest/dump_leaves.mjs가
// 이 파일을 재구현하지 않고 그대로 import해서 실사 검증 메뉴를 만들 수 있게
// 한다. subject_gate_live_smoketest.py가 dump_leaves.mjs를 거쳐 재구성하던
// 메뉴에 이 동의어 보강이 빠져 있었음(§professor-ct 라이브 검증 세션에서
// 발견) — production과 하네스가 다른 메뉴로 채점하면 K-12 어휘 케이스에서
// 특히 결과가 왜곡된다.
export const LEAF_SYNONYMS = {
  'professor-korean':             ['국어', '받아쓰기', '맞춤법', '한글', '초등 국어', '글쓰기 기초'],
  // 2026-09-14 추가 — "미적분"이 없어서 "미적분학 개념이 헷갈려서
  // 수학을 배우고 싶다"류의 흔한 일상 표현이 옆 리프 professor-analysis
  // (해석학, 더 formal한 수학 전공용 과목)로 새는 게
  // subject_gate_live_smoketest.py 재작성 후 재현에서 확인됨 — 일상
  // 언어로 "미적분"은 거의 항상 이 범용 수학 지도를 뜻한다.
  'professor-math':               ['수학', '산수', '구구단', '덧셈', '뺄셈', '곱셈', '나눗셈', '초등 수학', '미적분', '미적분학'],
  'professor-english':            ['영어', '알파벳', '파닉스', '영어 기초', '초등 영어'],
  'professor-generalscience':     ['과학', '초등 과학', '과학 실험'],
  'professor-generalsocialscience': ['사회', '초등 사회'],
  'professor-physicaleducation':  ['체육', '초등 체육'],
  'professor-finearts':           ['미술', '초등 미술', '그리기'],
  // 2026-08-10 추가 — K-12 교과-전공 매칭 갭 대응으로 신설한 4개 리프.
  // 위 7개와 같은 이유(교과서 어휘 ≠ 대학 학과명 라벨)로 동의어 보강.
  'professor-generalmusic':       ['음악', '초등 음악', '리코더', '단소', '가창'],
  'professor-classicalchinese':   ['한문', '한자', '사자성어'],
  'professor-generalpractical':   ['기술가정', '기술·가정', '실과', '가정 실습', '요리실습', '바느질', '목공', '발명'],
  'professor-careereducation':    ['진로와 직업', '진로', '적성검사'],
};

export function _leafMenuLine(leaf) {
  const syn = LEAF_SYNONYMS[leaf.id];
  return syn ? `- ${leaf.id}: ${leaf.label} (${syn.join('·')} 포함)` : `- ${leaf.id}: ${leaf.label}`;
}

// 2026-08-10 신설 — 실제 리프 후보 목록 끝에 "해당 없음" 항목을 하나
// 덧붙인다. 이 항목의 id는 일부러 personaId(예: 'professor') 그대로
// 쓴다 — EXPERT_REGISTRY에 이미 등록돼 있는 유효한 id라 refineToLeaf의
// 화이트리스트 검증을 그대로 통과하고, 반환값도 정확히 "게이트를 안
// 탄 것과 동일한" personaId가 된다. 즉 null을 위한 별도 분기를 늘리는
// 게 아니라, 이미 있는 "화이트리스트에 있는 id면 그대로 채택" 경로를
// 안전한 폴백으로 재사용하는 것 — export하는 이유는 dump_leaves.mjs가
// 실사 검증에서 production과 동일한 후보 목록(개수·순서·라벨 전부)을
// 그대로 재현해야 하기 때문이다(재구현 금지 원칙, 이전 세션과 동일).
export function _buildGateCandidates(personaId, leaves) {
  const parentDef = EXPERT_REGISTRY[personaId];
  const noneLabel = parentDef
    ? `${parentDef.label} — 해당하는 세부 전공이 후보에 없음(일반 1:1 지도로 진행)`
    : '해당하는 세부 전공이 후보에 없음(일반 지도로 진행)';
  return [...leaves, { id: personaId, label: noneLabel }];
}

// 2026-08-10 리팩터(flat → 계층형) — 배경: professor 트리가 161개
// 리프로 커지면서(§1-1 K-12 갭 대응 4개 리프 신설 이후), 곧이어 법학·
// 경제학 등 "표준적으로 알려진 하위분야가 있는 대분야"의 세부 분할
// (주피터 지시, 90여개 리프 추가 예정)까지 반영하면 flat 게이트가
// 254개+ 후보를 한 프롬프트에 다 욱여넣게 된다 — 이미 162개 시점에서
// max_tokens 1000→1500 재상향이 있었던 걸 감안하면 토큰 소진·혼동성
// 저하가 사실상 확정적이다. 재구조화: 한 번의 호출로 전체 리프
// 후보를 다 보여주는 대신, EXPERT_REGISTRY의 parentKey 트리를 한
// 단계씩(직계 자식만) 내려가며 여러 번 작은 게이트를 돈다 — 각 단계의
// 후보 수는 그 노드의 직계 자식 수(현재 대부분 4~14개, 최악 케이스도
// 30개 미만)로 억제된다. §CATALOG-EXPERT professor 대분야를 여러
// 중계열/소계열로 나눈 기존 설계(§2-4~§2-7)와 동일한 "커지면 한 단계
// 더 쪼갠다" 원칙을 라우팅 로직에도 그대로 적용한 것.
function _gateOneLevel(personaId, candidates, userText) {
  return (async () => {
    try {
      const menu = candidates.map(_leafMenuLine).join('\n');
      const res = await fetch(CFG.endpoint + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:       'deepseek-v4-flash',
          // 2026-08-09 수정(60→1000), 2026-08-10 재상향(1000→1500) — flat
          // 162후보 시절 실사로 굳어진 값. 계층형 전환으로 단계당 후보 수가
          // 크게 줄었으니(대부분 4~14개) 이론상 더 낮춰도 되지만, 실사
          // 재검증 전까지는 보수적으로 유지한다 — 낮췄다가 또 빈 응답이
          // 재발하는 걸 이전 세션에서 이미 3차례 겪었다(§1-1).
          max_tokens:  1500,
          temperature: 0.0,
          stream:      false,
          messages: [
            { role: 'system', content: GATE_SYS_PROMPT_HEAD + menu },
            { role: 'user',   content: (userText || '').slice(0, 2000) },
          ],
        }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const raw  = data.choices?.[0]?.message?.content || '{}';
      const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
      const chosenId = parsed?.id;

      // 화이트리스트 검증 — 이 단계 후보 목록(직계 자식 + "해당 없음")에
      // 실제로 있는 id만 채택. "해당 없음"을 고르면 chosenId===personaId.
      if (chosenId && candidates.some(c => c.id === chosenId) && EXPERT_REGISTRY[chosenId]) {
        return chosenId;
      }
      return personaId;
    } catch (e) {
      console.warn('[SubjectGate] 과목 게이트 실패(무시 — 이 단계 personaId로 폴백):', e.message);
      return personaId;
    }
  })();
}

/**
 * personaId부터 시작해 EXPERT_REGISTRY의 parentKey 트리를 한 단계씩
 * (직계 자식만) 내려가며 사용자 발화를 재분류한다 — 각 단계마다 별도
 * 게이트 호출(직계 자식이 2개 이상일 때만; 1개면 호출 없이 그냥
 * 내려가고, 0개면 이미 리프이므로 그 자리에서 멈춘다). 어느 단계에서든
 * "해당 없음"이 선택되거나 게이트가 실패하면 그 단계의 personaId에서
 * 멈추고 더 내려가지 않는다 — 항상 안전한 상위 노드로 폴백한다는
 * 원칙은 flat 버전과 동일, 다만 이제 그 "상위 노드"가 트리 중간
 * 어디든(예: professor-law-series) 될 수 있다.
 *
 * @param {string} personaId - 1단계 라우팅이 낸 EXPERT_REGISTRY 키
 * @param {string} userText  - 이 태그를 유발한 사용자 발화 원문
 * @returns {Promise<string>} 정밀화된(또는 변경 없는) personaId
 */
export async function refineToLeaf(personaId, userText) {
  let currentId = personaId;
  const MAX_DEPTH = 6; // parentKey 순환/오설정에 대비한 안전 상한 — 현재 트리는 최대 4단계

  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const children = getConsultableChildren(currentId);

    if (children.length === 0) return currentId; // currentId 자신이 리프
    if (children.length === 1) { currentId = children[0].id; continue; } // 게이트 호출 없이 통과

    const candidates = _buildGateCandidates(currentId, children);
    const chosenId = await _gateOneLevel(currentId, candidates, userText);

    if (chosenId === currentId) return currentId; // "해당 없음" 또는 실패 폴백 — 더 안 내려감
    if (chosenId !== currentId) {
      console.info('[SubjectGate] 리프 정밀화:', currentId, '→', chosenId);
    }
    currentId = chosenId;
  }
  return currentId;
}
