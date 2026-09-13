/**
 * tests/live_smoketest/ac-intent-router.test.mjs
 * ------------------------------------------------------------------
 * ac-intent-router.js를 네트워크 호출 없이 순수 함수 단위로 검증한다.
 * 정답 데이터는 2026-09-13 세션에서 2,000개 질문을 분류한 결과
 * (data/coverage-audit-2000-questions/ 옆에 함께 둔 routed_2000_final.json)를
 * 그대로 재사용한다 — 이 파일은 사람이 여러 차례 교정을 거쳐 최종 수렴시킨
 * 결과라, 분류기의 "high confidence 판정이 실제로 정답과 얼마나 일치하는가"를
 * 재현 가능하게 측정할 수 있는 유일한 대량 정답 세트다.
 *
 * 이 테스트는 100% 일치를 요구하지 않는다 — 분류기는 의도적으로 애매한
 * 케이스를 confidence='low'로 두고 LLM 폴백에 넘기도록 설계됐기 때문이다.
 * 대신 confidence='high'로 판정한 것만 골라 정답과 대조해, "자신 있게
 * 확정한 것은 실제로 믿을 만한가"를 검증한다.
 *
 * Usage: node tests/live_smoketest/ac-intent-router.test.mjs
 */
import { readFileSync } from "fs";
import { classifyIntent, ROUTE_TYPES } from "../../src/gopang/ai/ac-intent-router.js";

const registry = JSON.parse(
  readFileSync(new URL("../../data/ac-routing-registry.json", import.meta.url))
);

// route_v2(사람이 최종 확정한 정답) → 이 분류기의 ROUTE_TYPES 매핑.
// SERVICE_SP는 정답 쪽엔 internal/federated 구분이 없으므로(레이블만
// "SERVICE_SP") 둘 다 정답으로 인정한다.
function isMatch(expected, actual) {
  if (expected === "SERVICE_SP") {
    return actual === ROUTE_TYPES.SERVICE_SP_INTERNAL || actual === ROUTE_TYPES.SERVICE_SP_FEDERATED;
  }
  return expected === actual;
}

function loadGroundTruth() {
  // 이 파일은 채팅에서 생성해 로컬에만 있던 산출물이라 저장소에는 없다 —
  // CI에서 이 테스트를 상시 실행하려면 routed_2000_final.json을
  // data/coverage-audit-2000-questions/ 옆에 커밋해둬야 한다. 없으면
  // 스킵하고 안내만 출력한다(하드 실패시키지 않음 — 정답 파일 부재는
  // 코드 결함이 아니라 데이터 준비 문제이므로).
  try {
    return JSON.parse(readFileSync(new URL("../../data/coverage-audit-2000-questions/routed_2000_final.json", import.meta.url)));
  } catch (e) {
    return null;
  }
}

function main() {
  const groundTruth = loadGroundTruth();
  if (!groundTruth) {
    console.log("routed_2000_final.json이 없어 대량 검증은 스킵합니다 — 아래 고정 케이스만 실행합니다.");
  }

  // ── 고정 케이스 — 항상 실행, 저장소에 정답 파일이 없어도 회귀를 잡는다.
  const fixedCases = [
    { q: "K-Mail로 예약 발송도 되나요?", expectType: ROUTE_TYPES.SERVICE_SP_INTERNAL, expectHigh: true },
    { q: "K-Law한테 법률 상담을 받으면 실제 변호사 상담이랑 같은 효력이 있나요?", expectType: ROUTE_TYPES.SERVICE_SP_FEDERATED, expectHigh: true },
    { q: "K-JIT은 왜 아직 sp-catalog.json에 등록되지 않았나요?", expectType: ROUTE_TYPES.NOT_YET_BUILT, expectHigh: true },
    { q: "GDC 지갑 충전 한도가 얼마인가요?", expectType: ROUTE_TYPES.AC_CORE, expectHigh: true },
    { q: "K-Mail이랑 K-Job 중에 어느 쪽이 먼저 나왔나요?", expectType: ROUTE_TYPES.UNKNOWN, expectHigh: false },
    // 2026-09-13 추가 — K-Plan/K-Insurance/K-Health 키워드 정정 회귀 테스트
    // (SP 답변능력 평가에서 발견: 세 서비스의 옛 키워드가 실제 SP 범위보다
    // 넓은 일반 실세계 서비스를 암시해 무관 질문까지 끌어들이고 있었음).
    // 이름이 명시되면 여전히 high-confidence로 잡혀야 한다(정정이 이름
    // 매칭까지 망가뜨리지 않았는지 확인).
    { q: "K-Plan으로 부산 출장 계획 짜줘", expectType: ROUTE_TYPES.SERVICE_SP_INTERNAL, expectHigh: true },
    { q: "GDC 미소보험 가입하고 싶어요", expectType: ROUTE_TYPES.SERVICE_SP_INTERNAL, expectHigh: true },
    { q: "증상 분석 좀 해줘요, 열이 나요", expectType: ROUTE_TYPES.SERVICE_SP_INTERNAL, expectHigh: true },
    // 제거된 옛 키워드(일정 등록/캘린더, 보험료, 병원 예약)만으로는 더 이상
    // 높은 확신으로 걸리면 안 된다 — 걸렸다면 정정이 무효화된 것.
    { q: "일정 등록하고 싶어요", expectType: ROUTE_TYPES.UNKNOWN, expectHigh: false },
    { q: "제 자동차보험료가 왜 이렇게 올랐어요", expectType: ROUTE_TYPES.UNKNOWN, expectHigh: false },
    { q: "병원 예약하고 싶어요", expectType: ROUTE_TYPES.UNKNOWN, expectHigh: false },
    // 2026-09-13 2차 추가 — dev-0798(K-Const) 회귀 테스트 + K-JIT
    // 19건(dev-0751~0764) 재발 방지를 위한 DEV_DESIGN_QUESTION_RE 확장.
    // scope 없이는 기존 동작(NOT_YET_BUILT) 그대로여야 과잉교정이 아니다.
    { q: "K-Const가 실제 헌재 결정과 다른 결론을 낼 경우 오해를 부를 위험을 어떻게 관리하나요?", expectType: ROUTE_TYPES.NOT_YET_BUILT, expectHigh: true },
    { q: "K-Const가 실제 헌재 결정과 다른 결론을 낼 경우 오해를 부를 위험을 어떻게 관리하나요?", expectType: ROUTE_TYPES.DEV_DOCS, expectHigh: true, scope: "dev" },
    { q: "K-Const 지금 쓸 수 있나요?", expectType: ROUTE_TYPES.NOT_YET_BUILT, expectHigh: true, scope: "dev" },
    // K-JIT 19건 표본 — scope='dev'일 때만 DEV_DOCS로 넘어가야 한다.
    { q: "K-JIT의 목적함수가 개별 비용최소화가 아니라 사회 총효용인 이유는 뭔가요?", expectType: ROUTE_TYPES.DEV_DOCS, expectHigh: true, scope: "dev" },
    { q: "K-JIT은 왜 아직 sp-catalog.json에 등록되지 않았나요?", expectType: ROUTE_TYPES.DEV_DOCS, expectHigh: true, scope: "dev" },
    { q: "K-JIT의 v0.1 이후 다음 마일스톤은 뭔가요?", expectType: ROUTE_TYPES.DEV_DOCS, expectHigh: true, scope: "dev" },
    { q: "K-JIT의 프로토타입이 실제 데이터로 테스트된 적 있나요?", expectType: ROUTE_TYPES.DEV_DOCS, expectHigh: true, scope: "dev" },
    { q: "K-JIT 저장소의 커밋 활동이 최근에도 활발한가요, 방치돼 있나요?", expectType: ROUTE_TYPES.DEV_DOCS, expectHigh: false },
    { q: "K-JIT과 시중 SCM(공급망관리) 솔루션의 차별점이 뭔가요?", expectType: ROUTE_TYPES.DEV_DOCS, expectHigh: true, scope: "dev" },
    // scope='dev'라도 단순 이름 뜻 확인(사용자도 물을 법한 질문)은
    // 의도적으로 DEV_DESIGN_QUESTION_RE 밖에 둔다 — 여전히 NOT_YET_BUILT.
    { q: "K-JIT이라는 이름의 'JIT'이 적시조달(Just-In-Time)을 뜻하는 게 맞나요?", expectType: ROUTE_TYPES.NOT_YET_BUILT, expectHigh: true, scope: "dev" },
  ];

  let fixedPass = 0;
  for (const c of fixedCases) {
    const r = classifyIntent(c.q, registry, c.scope);
    const typeOk = r.type === c.expectType;
    const confOk = (r.confidence === "high") === c.expectHigh;
    const ok = typeOk && confOk;
    if (ok) fixedPass++;
    console.log(`${ok ? "PASS" : "FAIL"} [고정] "${c.q}" -> type=${r.type}(기대 ${c.expectType}) confidence=${r.confidence}`);
  }
  console.log(`\n고정 케이스: ${fixedPass}/${fixedCases.length} 통과\n`);

  if (!groundTruth) {
    process.exit(fixedPass === fixedCases.length ? 0 : 1);
  }

  // ── 대량 검증 — confidence='high' 판정만 정답과 대조
  // 2026-09-13 2차 추가 — scope를 item.audience(user/dev, 원본 실험
  // 설계에 이미 있던 필드)로 넘긴다. 실제 배선 시나리오를 그대로
  // 반영한 것이다 — 호출부가 hondi-search의 scope=dev 토글처럼 발화
  // 맥락 자체를 이미 알고 있을 때만 넘기는 상황을 재현한다(이 필드가
  // 없던 v1에는 scope 없이 호출했었다 — 그때는 K-JIT 19건이 전부
  // high-confidence 오답으로 잡혔었다).
  let highTotal = 0;
  let highCorrect = 0;
  let lowTotal = 0;
  const highMistakes = [];

  for (const item of groundTruth) {
    const r = classifyIntent(item.question, registry, item.audience);
    if (r.confidence === "high") {
      highTotal++;
      if (isMatch(item.route_v2, r.type)) {
        highCorrect++;
      } else {
        highMistakes.push({ id: item.id, q: item.question, expected: item.route_v2, got: r.type });
      }
    } else {
      lowTotal++;
    }
  }

  const precision = highTotal ? (highCorrect / highTotal) * 100 : 0;
  console.log("=== 2,000개 대량 검증 ===");
  console.log(`high-confidence 판정: ${highTotal}건 (전체의 ${(highTotal / groundTruth.length * 100).toFixed(1)}%)`);
  console.log(`  그중 정답 일치: ${highCorrect}건 (정밀도 ${precision.toFixed(1)}%)`);
  console.log(`low-confidence(LLM 폴백 필요): ${lowTotal}건 (전체의 ${(lowTotal / groundTruth.length * 100).toFixed(1)}%)`);

  if (highMistakes.length) {
    console.log(`\nhigh-confidence인데 틀린 ${highMistakes.length}건 (규칙 보강 후보):`);
    highMistakes.slice(0, 20).forEach((m) =>
      console.log(`  ${m.id} "${m.q}" — 기대 ${m.expected}, 실제 ${m.got}`)
    );
  }

  // high-confidence 판정의 정밀도가 95% 미만이면 실패 처리 — 이 분류기의
  // 핵심 가치는 "자신 있게 확정한 것은 거의 항상 맞다"이므로, 이 기준이
  // 무너지면 LLM 호출을 생략하는 최적화 자체가 위험해진다.
  const exitCode = precision >= 95 || highTotal === 0 ? 0 : 1;
  process.exit(fixedPass === fixedCases.length ? exitCode : 1);
}

main();
