/**
 * src/gopang/ai/ac-intent-router.js
 * ------------------------------------------------------------------
 * AC(AGENT-COMMON)가 사용자 발화를 어디로 보낼지 결정하는 1차(빠른) 분류기.
 *
 * 배경 (2026-09-13):
 * 지금 AC는 사용자 발화 + sp-catalog.json 전체(650개 엔트리)를 매번 LLM에
 * 통째로 넘겨 판단하게 하는 구조다(call-ai.js의 _handle*Tag 계열 함수들이
 * LLM이 낸 태그를 사후 파싱하는 것으로 봐서, 사전 결정론적 분류기가 없다는
 * 뜻이다). 이 방식은 두 가지 비용을 낳는다:
 *   1. 매 요청마다 650개 엔트리를 프롬프트에 태우는 토큰 비용
 *   2. "K-Mail 예약 발송 되나요?"처럼 답이 뻔한 요청까지 매번 LLM 추론을 거침
 *
 * 이 모듈은 오늘 진행한 2,000개 질문 분류 실험(user/dev 각 1,000개, 최종
 * 공백 0%로 수렴)에서 나온 규칙을 코드화한 "빠른 사전 필터"다. 목적은
 * LLM을 완전히 대체하는 게 아니라 —
 *   - 확신도가 높은 케이스는 즉시 확정해 LLM 호출 자체를 건너뛰거나
 *     (SERVICE_SP 확정 시 해당 SP 하나만 로드),
 *   - 애매한 케이스는 그대로 기존 LLM 카탈로그 판단으로 넘긴다(폴백).
 *
 * 데이터 소스: data/ac-routing-registry.json (K-서비스 26개의 internal/
 * federated/not_yet_built 분류는 prompts/sp-catalog.json과 대조해 검증됨 —
 * 이 파일이 REGISTRY_PATH를 통해 갱신되면 이 모듈도 자동으로 반영된다).
 *
 * 통합 지점 (2026-09-13 실제 배선 완료 — call-ai.js _callAIInner 참고):
 *   call-ai.js의 _callAIInner() 진입부, AC-PRO-CORE 로드 이전에
 *     const preRoute = classifyIntent(userText, registry);
 *   를 호출해, confidence='high'인 아래 두 경우만 LLM 판단을 건너뛴다 —
 *   그 외(FEDERATED/NOT_YET_BUILT/QNA/DEV_DOCS/K_SEARCH/EXPERT_PERSONA/
 *   UNKNOWN)는 기존 LLM 카탈로그 판단으로 그대로 폴백한다(이번 배선의
 *   의도적 범위 제한 — navigate 대상 상태 체크·엔티티 해석 등 기존
 *   LLM 경로가 이미 갖춘 안전장치를 이번 패치에서 다시 만들지 않았다):
 *     - SERVICE_SP_INTERNAL + runtime_type='switch'(K-Job/K-Plan/K-Watch/
 *       K-Telecom, 4개) → 기존 _forwardSwitchSP(loader, label) 그대로 재사용,
 *       AC-PRO-CORE 추론 자체를 생략하고 곧장 그 SP로 전환.
 *     - SERVICE_SP_INTERNAL + runtime_type='gwp_launch'(나머지 8개,
 *       K-Search는 orchestration_subtask라 제외) → 기존 [GWP: id] LLM
 *       경로가 쓰는 _gwpLaunch()를 그대로 재사용해 새 탭을 연다(단, 이
 *       경로는 status==='active' 확인 후에만 탄다 — 그 외에는 폴백).
 *   AC_CORE는 이미 기본 경로이므로 별도 분기 없이 그대로 AC-PRO-CORE로
 *   이어진다.
 */

const ROUTE_TYPES = Object.freeze({
  SERVICE_SP_INTERNAL: "SERVICE_SP_INTERNAL", // AC가 카탈로그에서 SP를 직접 불러 그 자리에서 답함
  SERVICE_SP_FEDERATED: "SERVICE_SP_FEDERATED", // 별도 서브도메인으로 navigate 필요
  NOT_YET_BUILT: "NOT_YET_BUILT", // K-JIT/K-Const처럼 SP/사이트 자체가 없음 — 정직하게 고지
  AC_CORE: "AC_CORE", // AC 자신이 답함(계정/GDC/PDV/프로필 등)
  QNA: "QNA", // qna.hondi.net으로 위임
  DEV_DOCS: "DEV_DOCS", // hondi-search scope=dev로 위임
  EXPERT_PERSONA: "EXPERT_PERSONA", // 552명 페르소나 중 매칭
  K_SEARCH: "K_SEARCH", // 개인 데이터 검색 위임
  UNKNOWN: "UNKNOWN", // 확신 없음 — 기존 LLM 카탈로그 판단으로 폴백
});

function buildServiceMatchers(registry) {
  return Object.entries(registry.k_services).map(([name, info]) => ({
    name,
    info,
    // 서비스명 자체("K-Mail")와 등록된 키워드 전부를 매칭 후보로 삼는다.
    // 정규식은 매 호출 새로 만들지 않도록 여기서 미리 컴파일한다.
    pattern: new RegExp(
      info.keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
      "i"
    ),
  }));
}

function buildKeywordMatcher(keywords) {
  return new RegExp(keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"));
}

/**
 * classifyIntent(userText, registry, scope) -> { type, target, confidence, reason, ... }
 *
 * confidence: 'high' | 'low'
 *   - 'high': 이 결과를 그대로 신뢰해 LLM 카탈로그 판단을 생략해도 된다고
 *             본 세션의 2,000개 분류 실험이 뒷받침하는 케이스.
 *   - 'low' : 규칙이 애매하게 걸렸거나 UNKNOWN인 경우 — 호출부는 반드시
 *             기존 LLM 판단으로 폴백해야 한다.
 *
 * scope: 'user' | 'dev' | undefined (2026-09-13 추가)
 *   호출부가 "이 발화가 나온 맥락 자체가 이미 개발자용인지"를 알 때만
 *   넘긴다(예: hondi-search의 scope=dev 토글이 켜진 상태) — 모르면
 *   생략한다. 기존에 알려진 한계(dev-0798): K-JIT/K-Const 같은 초안
 *   서비스에 대해 "사용자가 쓸 수 있냐고 묻는 것"(NOT_YET_BUILT가 맞음)과
 *   "개발자가 설계 리스크·오판 시 대응을 묻는 것"(DEV_DOCS가 맞음)을
 *   구분하지 못하던 문제를 scope='dev'일 때만 좁게 해소한다 — scope가
 *   없으면 기존 동작(NOT_YET_BUILT) 그대로 유지한다(과잉교정 방지).
 *
 * SERVICE_SP_INTERNAL 결과에는 target(=sp-catalog.json 키) 외에
 * gwp_id·runtime_type도 함께 실어보낸다 — call-ai.js가 "이 서비스가
 * 시스템 프롬프트 교체(switch)로 같은 탭에서 답하는지, 아니면 별도
 * 서브도메인 웹앱을 새 탭으로 여는지(gwp_launch)"를 판단하는 데 쓴다
 * (2026-09-13 실측: internal 13개 중 4개만 switch, 나머지는 gwp_launch —
 * ac-routing-registry.json _comment 참고).
 *
 * 이 함수는 순수 함수다(외부 상태 없음) — 유닛테스트하기 쉽게 설계했다.
 */
// 2026-09-13 추가 — dev-0798 재현 사례("K-Const가 실제 헌재 결정과 다른
// 결론을 낼 경우 오해를 부를 위험을 어떻게 관리하나요?")처럼, 초안
// 서비스의 실존 여부가 아니라 설계·리스크·한계·대응 방식을 묻는 어휘.
const DEV_DESIGN_QUESTION_RE = /위험.*관리|오판|오해를\s*부를|한계.*(관리|대응)|설계.*(근거|의도)|아키텍처|리스크.*대응|오류\s*처리|장애\s*시나리오/;
// 2026-09-13 추가 — "job 레포", "telecom 레포"처럼 소문자 저장소명 뒤에
// "레포"/"저장소"가 붙는 건 실제 사용자는 쓰지 않는 개발자 특유의 표현이다
// (사용자는 "K-Job"이라고 하지 "job 레포"라고 하지 않는다). 이 패턴이 있으면
// K-서비스 키워드가 우연히 겹쳐도(예: "채용공고"가 K-Job 키워드) 개발자
// 질문으로 우선 판정해야 한다 — 그렇지 않으면 "job 레포가 채용공고 사기를
// 거르나요?" 같은 레포 구현 질문이 K-Job 사용법 질문으로 잘못 넘어간다.
const DEV_REPO_MENTION_RE = /\b(hondi|gopang|klaw|mail|plan|job|biz|watch|telecom|search|democracy|market|tax|health|security|school|stock|public|police|911|insurance|traffic|logistics|qna|gdc|users)\s*(레포|저장소)/i;

function classifyIntent(userText, registry, scope) {
  const q = (userText || "").trim();
  if (!q) return { type: ROUTE_TYPES.UNKNOWN, target: null, confidence: "low", reason: "빈 입력" };

  // 0순위: "OO 레포/저장소" 표현 — K-서비스 키워드와 겹쳐도 개발자 문의로 우선 처리
  if (DEV_REPO_MENTION_RE.test(q)) {
    return {
      type: ROUTE_TYPES.DEV_DOCS,
      target: "hondi-search(scope=dev)",
      confidence: "low", // 저장소별 문서 커버리지가 들쭉날쭉하므로 확정하지 않고 폴백 여지를 둠
      reason: "'OO 레포/저장소' 표현 — 실제 사용자는 안 쓰는 개발자 어휘, K-서비스 키워드보다 우선",
    };
  }

  const serviceMatchers = buildServiceMatchers(registry);

  // 1순위: 이름이 명시된 K-서비스. 여러 서비스가 동시에 매칭되면(예: 두 서비스
  // 비교 질문) 확신도를 낮춰 LLM 폴백으로 넘긴다 — 오늘 실험에서 이런 비교
  // 질문은 소수였지만 존재했다(예: "K-Job과 K-Biz 채용 연동은 어느 쪽?").
  const serviceHits = serviceMatchers.filter((m) => m.pattern.test(q));
  if (serviceHits.length === 1) {
    const { name, info } = serviceHits[0];
    if (info.type === "not_yet_built") {
      // scope='dev' + 설계/리스크 어휘가 함께 있을 때만 DEV_DOCS로 넘긴다
      // (dev-0798 재발 방지) — scope가 없으면 기존 동작 그대로 유지.
      if (scope === "dev" && DEV_DESIGN_QUESTION_RE.test(q)) {
        return {
          type: ROUTE_TYPES.DEV_DOCS,
          target: "hondi-search(scope=dev)",
          confidence: "high",
          reason: `${name}은 초안 서비스이지만 scope=dev + 설계/리스크 어휘 매칭 — "쓸 수 있냐"가 아니라 "어떻게 관리하냐"를 묻는 개발자 질문으로 판단(dev-0798 사례)`,
        };
      }
      return {
        type: ROUTE_TYPES.NOT_YET_BUILT,
        target: name,
        confidence: "high",
        reason: `${name}은 아직 SP/사이트가 없는 초안 서비스 — 있다고 지어내지 말고 정직하게 고지해야 함`,
      };
    }
    if (info.type === "federated") {
      return {
        type: ROUTE_TYPES.SERVICE_SP_FEDERATED,
        target: info.domain,
        confidence: "high",
        reason: `${name}은 별도 서브도메인(${info.domain})에 독립 백엔드를 가짐 — hondi-search로 navigate`,
      };
    }
    // internal
    return {
      type: ROUTE_TYPES.SERVICE_SP_INTERNAL,
      target: info.catalog_key,
      gwp_id: info.gwp_id || null,
      runtime_type: info.runtime_type || null,
      confidence: "high",
      reason: `${name}은 sp-catalog.json의 '${info.catalog_key}'(${info.catalog_file})를 직접 로드`,
    };
  }
  if (serviceHits.length > 1) {
    return {
      type: ROUTE_TYPES.UNKNOWN,
      target: serviceHits.map((h) => h.name),
      confidence: "low",
      reason: "복수 K-서비스가 동시에 매칭됨(비교 질문 등) — LLM 판단으로 폴백",
    };
  }

  // 2순위: QNA(플랫폼 전략/아키텍처/특허) — federated K-서비스와 달리 이건
  // hondi.net 자체가 아니라 qna.hondi.net이라는 완전히 별개 지식 시스템.
  const qnaMatcher = buildKeywordMatcher(registry.other_targets.QNA.keywords);
  if (qnaMatcher.test(q)) {
    return {
      type: ROUTE_TYPES.QNA,
      target: registry.other_targets.QNA.domain,
      confidence: "low", // 오늘 실측 결과 QNA 버킷의 63%가 qna 자체 도메인 라우터에도 안 걸렸으므로 과신 금지
      reason: "플랫폼 전략/아키텍처 키워드 매칭 — 단, qna.hondi.net 자체 도메인 라우팅 커버리지가 낮으니 확인 필요",
    };
  }

  // 3순위: 개발자 문서 스코프 — 오늘 만든 hondi-search dev scope의 실제
  // 매니페스트 키워드와 느슨하게 겹치는 패턴(내부 구현 질문 특유의 어휘).
  const devDocsMatcher = /AC-|SP-TREE|gov-tree|manifest-loader|control-tower|GWP|sp-catalog|저장소|레포\b|아키텍처|openhash-L\d/i;
  if (devDocsMatcher.test(q)) {
    return {
      type: ROUTE_TYPES.DEV_DOCS,
      target: "hondi-search(scope=dev)",
      confidence: "low", // 개발자 문서 커버리지 자체가 가변적이라 항상 폴백 확인 권장
      reason: "AC/SP 내부 동작·인프라 관련 어휘 — hondi-search 개발자 문서 범위로 위임 시도, 실패 시 LLM 폴백",
    };
  }

  // 4순위: AC 자신의 소관(계정/GDC/PDV/프로필 등)
  const acCoreMatcher = buildKeywordMatcher(registry.other_targets.AC_CORE.keywords);
  if (acCoreMatcher.test(q)) {
    return {
      type: ROUTE_TYPES.AC_CORE,
      target: null,
      confidence: "high",
      reason: "계정/GDC/PDV/프로필 등 AC 고유 소관 키워드 매칭",
    };
  }

  // 그 외 — 확신 없음. 반드시 기존 LLM 카탈로그 판단으로 폴백.
  return {
    type: ROUTE_TYPES.UNKNOWN,
    target: null,
    confidence: "low",
    reason: "규칙 미매칭 — 기존 LLM 카탈로그 판단 필요(전문가 페르소나·K-Search 포함)",
  };
}

export { classifyIntent, ROUTE_TYPES };
