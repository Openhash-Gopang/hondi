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
 * 통합 지점 제안 (아직 실제로 배선하지 않음 — 팀 리뷰 필요):
 *   call-ai.js의 callAI() 진입부, LLM 호출 직전에
 *     const preRoute = classifyIntent(userText, registry);
 *     if (preRoute.confidence === 'high') { ... SP 하나만 로드하거나 바로 navigate ... }
 *   식으로 넣는 걸 제안한다. call-ai.js가 12,000줄 이상이라 이번 세션에서
 *   직접 수정하지 않고, 독립 모듈 + 유닛테스트로만 제공한다.
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
 * classifyIntent(userText, registry) -> { type, target, confidence, reason }
 *
 * confidence: 'high' | 'low'
 *   - 'high': 이 결과를 그대로 신뢰해 LLM 카탈로그 판단을 생략해도 된다고
 *             본 세션의 2,000개 분류 실험이 뒷받침하는 케이스.
 *   - 'low' : 규칙이 애매하게 걸렸거나 UNKNOWN인 경우 — 호출부는 반드시
 *             기존 LLM 판단으로 폴백해야 한다.
 *
 * 이 함수는 순수 함수다(외부 상태 없음) — 유닛테스트하기 쉽게 설계했다.
 */
// 2026-09-13 추가 — "job 레포", "telecom 레포"처럼 소문자 저장소명 뒤에
// "레포"/"저장소"가 붙는 건 실제 사용자는 쓰지 않는 개발자 특유의 표현이다
// (사용자는 "K-Job"이라고 하지 "job 레포"라고 하지 않는다). 이 패턴이 있으면
// K-서비스 키워드가 우연히 겹쳐도(예: "채용공고"가 K-Job 키워드) 개발자
// 질문으로 우선 판정해야 한다 — 그렇지 않으면 "job 레포가 채용공고 사기를
// 거르나요?" 같은 레포 구현 질문이 K-Job 사용법 질문으로 잘못 넘어간다.
const DEV_REPO_MENTION_RE = /\b(hondi|gopang|klaw|mail|plan|job|biz|watch|telecom|search|democracy|market|tax|health|security|school|stock|public|police|911|insurance|traffic|logistics|qna|gdc|users)\s*(레포|저장소)/i;

function classifyIntent(userText, registry) {
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
