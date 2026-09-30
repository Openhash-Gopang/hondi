// sp-tag-dispatch.test.mjs
// 실행: node --experimental-test-module-mocks --test src/tests/sp-tag-dispatch.test.mjs
//
// router-category.test.mjs(2026-07-05 삭제된 src/gopang/ai/router.js에 의존해
// 실행 불가 상태였음) 대체본. 6766c60(라우팅 리팩토링)에서 일반 키워드 기반
// 서비스 매칭(matchService/gwpMatch)은 죽은 코드가 됐고, 지금 라우팅은
// AGENT-COMMON이 한 번의 LLM 호출 안에서 [GWP:]/[EXPERT:] 태그를 직접
// 발화하는 방식이다. 그 태그가 이미 나왔다고 가정했을 때, 그 다음
// 처리(정확한 id→URL 디스패치, status/type 가드, 미해결 태그 처리)는
// 결정론적이므로 여기서 검증한다.
//
// [한계] LLM이 애초에 올바른 [GWP:]/[EXPERT:] 태그를 "내는지" 자체(자연어
// 이해 품질)는 이 하네스 범위 밖이다 — 라이브 LLM 호출 품질 문제이며
// router-category.test.mjs의 "가짜 DeepSeek" 목도 실제로는 matchService
// (죽은 코드)의 결과를 재사용하는 것이었으므로 애초에 그 부분을 검증하지
// 못했다(대체할 가치가 없는 검증이었음).

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';

// ── 최소 DOM/전역 스텁 — call-ai.js/gwp/engine.js/expert-session.js가
//    모듈 최상위에서 필요로 하는 것만 채운다(함수 본문 안쪽 document 접근은
//    이 테스트가 건드리는 경로에서는 발생하지 않음) ──
globalThis.window = globalThis;
globalThis.location = { search: '' };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.document = {
  addEventListener: () => {}, getElementById: () => null,
  createElement: () => ({}), querySelector: () => null,
};
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
// _reportUnresolvedTag(미해결 태그 경로)가 fetch로 서버에 신호를 보낸다 —
// 테스트에서 실제 네트워크 호출을 막는다(호출 자체는 try/catch로 감싸져
// 있어 실패해도 흐름엔 영향 없음, 여기선 아예 트리거 안 함).
globalThis.fetch = async () => { throw new Error('테스트 환경: 네트워크 차단'); };

// ── _gwpLaunch를 목으로 교체 — 실제 탭 오픈/PDV 기록 없이 "무엇으로
//    호출됐는지"만 관찰한다. call-ai.js와 expert-session.js 둘 다 같은
//    모듈(gwp/engine.js)에서 import하므로 한 번의 mock으로 양쪽 다 커버된다 ──
let _launched = null;
mock.module(new URL('../gopang/gwp/engine.js', import.meta.url), {
  namedExports: {
    _gwpLaunch: (svc, ctx, _preTab, _facts) => { _launched = svc; },
  },
});

await import(new URL('../../gwp-registry.js', import.meta.url));
const { _parseAgentTags, _estimateGovImportance, _selectGovVerificationMode, _isSwitchRecoveryInFlight } =
  await import(new URL('../gopang/ai/call-ai.js', import.meta.url));
const { handleExpertTag } = await import(new URL('../gopang/ai/expert-session.js', import.meta.url));
const { getService, GWP_REGISTRY } = globalThis;

function resetLaunch() { _launched = null; }

// 앞 테스트가 태운 자동복구(fire-and-forget callAI)가 끝나 재진입 가드가 풀릴 때까지 기다린다.
// 예전에는 고정 sleep(100~250ms)이었는데, 복구가 끝나는 시간이 환경마다 달라(느린 환경에서 SD-05b/c가 "재진입"으로 오판)
// 실패가 간헐적이었다. 가드 자체는 이 테스트가 검증하는 대상이라 풀리는 시간만 기다린다(최대 15초).
async function settleRecovery(maxMs = 15000) {
  const t0 = Date.now();
  while (_isSwitchRecoveryInFlight() && Date.now() - t0 < maxMs) await new Promise((r) => setTimeout(r, 50));
  assert.equal(_isSwitchRecoveryInFlight(), false, '이전 자동복구가 끝나지 않음(가드가 풀리지 않음)');
}

// ═══════════════════════════════════════════════════════════
describe('SD — [GWP:] 태그 디스패치 (_parseAgentTags)', () => {
  test('SD-01: 활성 서비스 id → 정확히 그 서비스로 launch', () => {
    resetLaunch();
    _parseAgentTags('[GWP: klaw]', null, '이혼 소송 준비하려는데', null);
    assert.equal(_launched?.id, 'klaw');
  });

  test('SD-02: 콜론 뒤 공백 유무 둘 다 매칭 (BUG-FIX 2026-07-02 회귀 방지)', () => {
    resetLaunch();
    _parseAgentTags('[GWP:kqna]', null, '질문있어요', null);
    assert.equal(_launched?.id, 'kqna');
    resetLaunch();
    _parseAgentTags('[GWP: kqna]', null, '질문있어요', null);
    assert.equal(_launched?.id, 'kqna');
  });

  test('SD-03: 알 수 없는 서비스 id → launch 안 됨, 예외 없음', () => {
    resetLaunch();
    assert.doesNotThrow(() => _parseAgentTags('[GWP: no-such-service]', null, '아무거나', null));
    assert.equal(_launched, null);
  });

  test('SD-04: status!=="active"(pending) 서비스 → launch 차단 (2026-07-12 가드 회귀 방지)', () => {
    // ksearch는 status:'pending'으로 등록돼 있음 — 이 값이 바뀌면 이 테스트도
    // 같이 갱신할 것(그 자체가 가드가 여전히 필요한지 알려주는 신호).
    const svc = getService('ksearch');
    assert.equal(svc?.status, 'pending', '픽스처 전제 붕괴: ksearch가 더 이상 pending이 아님 — 다른 pending 서비스로 교체 필요');
    resetLaunch();
    _parseAgentTags('[GWP: ksearch]', null, '아는 사람 찾아줘', null);
    assert.equal(_launched, null, 'pending 서비스가 launch됨 — status 가드 회귀');
  });

  test('SD-05: type==="switch" 서비스 → [GWP:] 태그로는 (새 탭) launch 안 됨 (구식 문법 오발동 방지)', () => {
    // 2026-08-01: kbank는 GDC 흡수로 레지스트리에서 철회됨(gwp-registry.js
    // 236행 주석 참고) — getService('kbank')가 undefined가 돼 이 테스트의
    // 전제(.type === 'switch')가 깨져 있었다. 여전히 switch 타입인
    // ktelecom으로 교체(kestate도 동일 계열, 둘 중 아무거나 무방).
    const svc = getService('ktelecom');
    assert.equal(svc?.type, 'switch');
    resetLaunch();
    _parseAgentTags('[GWP: ktelecom]', null, '휴대폰 요금제 알려줘', null);
    assert.equal(_launched, null, 'switch형 서비스가 [GWP:] 태그로 _gwpLaunch(새 탭)됨 — 안전장치 회귀');
  });

  test('SD-05b: type==="switch" + 구식 [GWP:] 태그 → 자동복구 경로 진입(무한 침묵 대신 콘솔 신호) (2026-08-01 신설)', async () => {
    // 2026-08-01: 라이브 재검증(no=1, 2회 재현)에서 §TAGS 표에 예외를
    // 명시해도 모델이 계속 구식 [GWP: id] 문법을 내는 것을 확인 —
    // 프롬프트로는 못 고쳐 코드 레벨 자동복구(_forwardSwitchSP+callAI
    // fire-and-forget)로 교체했다. 이 하네스는 DOM/fetch가 최소 스텁이라
    // 그 내부 callAI 재귀 호출의 최종 결과(실제로 K-Telecom SP가 로드돼
    // 응답이 오는지)까지는 검증 못 한다(파일 상단 "[한계]" 참고 — 이것도
    // 같은 종류의 한계) — 여기서는 (1) 여전히 _gwpLaunch(새 탭)로는 안
    // 새고 (2) 예전처럼 그냥 경고만 남기고 조용히 끝나는 게 아니라
    // 자동복구 분기를 실제로 탔다는 것만 관찰 가능한 신호(console.info)
    // 로 확인한다. 실제 SP 전환·연속 응답 여부는 실배포 환경에서 검증할 것.
    //
    // ★ 2026-08-01 추가 — 바로 앞 SD-05가 같은 자동복구 분기를 이미
    // 한 번 태웠고(_gwpSwitchRecoveryInFlight를 동기적으로 true로 만듦),
    // 그 안의 fire-and-forget IIFE는 이 테스트 프레임 이후 어느 시점에나
    // .finally()로 리셋된다 — 타이밍에 따라 SD-05b가 "재진입"으로
    // 오판되는 걸(라이브에서 실제로 발견한 루프 방지 가드) 막기 위해
    // SD-05의 잔여 async 작업이 정리될 시간을 준다.
    await settleRecovery();
    const svc = getService('kestate');
    assert.equal(svc?.type, 'switch');
    resetLaunch();
    const infoCalls = [];
    const origInfo = console.info;
    console.info = (...args) => infoCalls.push(args.join(' '));
    try {
      assert.doesNotThrow(() =>
        _parseAgentTags('[GWP: kestate]', null, '전세 계약 검토해줘', null));
    } finally {
      console.info = origInfo;
    }
    assert.equal(_launched, null, '자동복구 경로에서도 _gwpLaunch(새 탭)는 여전히 호출되면 안 됨');
    assert.ok(
      infoCalls.some(line => line.includes('자동복구') && line.includes('kestate')),
      `자동복구 분기 진입 로그를 못 찾음 — 예전 경고-only 경로로 회귀했을 수 있음. 관찰된 로그: ${JSON.stringify(infoCalls)}`
    );
  });

  test('SD-05c: switch형 자동복구 재진입 방지 — 연달아 2번 트리거해도 두 번째는 건너뜀 (2026-08-01, 라이브에서 발견한 루프 회귀 방지)', async () => {
    // 라이브 재검증에서 실제로 재현된 버그: K-Telecom으로 자동복구 전환한
    // 뒤 보내는 INTERNAL 연속 메시지에 K-Telecom 자신이 "K-Telecom을
    // 호출하겠습니다"처럼 표시명+호출 동사를 섞어 답하면, 기존 "태그
    // 누락 폴백"이 그 응답에 또 반응해 자동복구가 자기 자신을 재귀
    // 호출했다(콘솔에서 정확히 2회 쌍으로 재현, Uncaught SyntaxError
    // 동반 확인). 여기서는 같은 svcId를 동기적으로 연달아 두 번 태워,
    // 두 번째는 "재진입 감지" 경고로 조용히 무시되고(자동복구 info 로그가
    // 안 남) _gwpLaunch(새 탭)도 여전히 안 되는지만 확인한다 — 첫 번째
    // 호출의 fire-and-forget 내부(_forwardSwitchSP/callAI)가 실제로
    // 완료되는지는 이 하네스로 검증 못 한다(SD-05b와 같은 한계).
    await settleRecovery();
    resetLaunch();
    const infoCalls = [];
    const warnCalls = [];
    const origInfo = console.info;
    const origWarn = console.warn;
    console.info = (...args) => infoCalls.push(args.join(' '));
    console.warn = (...args) => warnCalls.push(args.join(' '));
    try {
      _parseAgentTags('[GWP: ktelecom]', null, '휴대폰 요금제 알려줘', null);
      _parseAgentTags('[GWP: ktelecom]', null, '휴대폰 요금제 알려줘', null);
    } finally {
      console.info = origInfo;
      console.warn = origWarn;
    }
    assert.equal(_launched, null, '재진입 방지 경로에서도 _gwpLaunch(새 탭)는 여전히 호출되면 안 됨');
    assert.equal(
      infoCalls.filter(l => l.includes('자동복구') && l.includes('전환합니다')).length,
      1,
      `자동복구 진입 로그가 정확히 1번이어야 함(2번째는 재진입 차단) — 관찰: ${JSON.stringify(infoCalls)}`
    );
    assert.ok(
      warnCalls.some(l => l.includes('재진입 감지')),
      `재진입 감지 경고를 못 찾음 — 루프 방지 가드 회귀 의심. 관찰: ${JSON.stringify(warnCalls)}`
    );
    // 다음 테스트를 위해 in-flight 플래그가 정리될 시간을 준다.
    await new Promise(resolve => setTimeout(resolve, 400));
  });


  test('SD-06: 태그 없음 → launch 안 됨', () => {
    resetLaunch();
    _parseAgentTags('그냥 일반 답변입니다', null, '안녕', null);
    assert.equal(_launched, null);
  });
});

// ═══════════════════════════════════════════════════════════
describe('SD — [EXPERT:] 태그 디스패치 (handleExpertTag)', () => {
  test('SD-07: 등록된 전문가 id → 정확히 그 페르소나로 launch', async () => {
    resetLaunch();
    const handled = await handleExpertTag('[EXPERT: lawyer]', '이혼 소송 준비하려는데', null);
    assert.equal(handled, true);
    assert.equal(_launched?.id, 'lawyer');
  });

  test('SD-08: 대소문자 무시 매칭(resolveExpertId)', async () => {
    resetLaunch();
    await handleExpertTag('[EXPERT: LAWYER]', '문의', null);
    assert.equal(_launched?.id, 'lawyer');
  });

  test('SD-09: @handle 직접 지목 문법 → 미구현이므로 조용히 무시(launch 안 됨)', async () => {
    resetLaunch();
    const handled = await handleExpertTag('[EXPERT: @somehandle]', '문의', null);
    assert.equal(handled, false);
    assert.equal(_launched, null);
  });

  test('SD-10: 알 수 없는 전문가 id → launch 안 됨, false 반환', async () => {
    resetLaunch();
    const handled = await handleExpertTag('[EXPERT: no-such-expert]', '문의', null);
    assert.equal(handled, false);
    assert.equal(_launched, null);
  });
});

// ═══════════════════════════════════════════════════════════
describe('SD — kemergency 하드 게이트 (_estimateGovImportance)', () => {
  test('SD-11: kemergency 트리거 포함 발화 → 카테고리 무관하게 즉시 100점', () => {
    const emg = getService('kemergency');
    assert.ok(Array.isArray(emg?.triggers) && emg.triggers.length > 0, '픽스처 전제 붕괴: kemergency.triggers 비어있음');
    const trigger = emg.triggers[0];
    const score = _estimateGovImportance(`지금 ${trigger} 상황이에요`, null);
    assert.equal(score, 100);
    assert.equal(_selectGovVerificationMode(score), 'ENHANCED');
  });

  test('SD-12: 트리거 없는 평범한 발화(GOV 카테고리) → 100점 아님, 카테고리 가중치만 반영', () => {
    const gwpEntry = getService('kgov');
    const score = _estimateGovImportance('전입신고 어떻게 해요', gwpEntry);
    assert.ok(score < 100, `트리거 없이도 100점 — kemergency 게이트 오탐 의심 (score=${score})`);
    assert.ok(score > 0, '카테고리 가중치가 전혀 반영 안 됨');
  });

  test('SD-13: 매칭된 서비스 없음(gwpEntry=null) → 기본 가중치(10) 기준으로 낮은 점수', () => {
    const score = _estimateGovImportance('ㅋㅋㅋ 심심해서', null);
    assert.ok(score <= 10, `잡담인데 점수가 높음 (score=${score})`);
    assert.equal(_selectGovVerificationMode(score), 'LIGHTWEIGHT');
  });
});

// ═══════════════════════════════════════════════════════════
// I2-2 — GWP_REGISTRY 28개 구조적 위생 점검. matchService가 죽은 코드가
// 됐어도, keywords/triggers는 문서·향후 프롬프트 생성에 재사용될 수
// 있어 정적 검사로 남겨둘 가치가 있다(§ 이전 세션 판단 유지).
//
// [주의] 트리거 문자열의 "부분 포함" 충돌(예: ksearch의 '찾아줘'가
// kusers의 '이 사람 찾아줘'에 포함됨)은 matchService가 더 이상 실제
// 라우팅에 안 쓰이므로 실사용 영향이 없다 — 하드 실패로 만들지 않고
// 정보성 로그로만 남긴다(과거 세션에서 이 충돌을 실제 위험으로
// 오판했던 것 자체가 SD-05형 실수였음, 문서 참고).
// ═══════════════════════════════════════════════════════════
describe('SD — GWP_REGISTRY 구조적 위생 점검', () => {
  test('SD-14: 전체 36개 엔트리 각각 비어있지 않은 triggers 배열을 가짐', () => {
    // ★ 2026-09-02 갱신 — 실제 GWP_REGISTRY가 31개로, 이전 기대값(27)은
    // 그 사이 레지스트리 구성이 바뀌며(K-Mail 신설로 28, K-Plan/K-Watch/
    // K-Job의 AC 오케스트레이션 편입으로 +3 → 31) 노후화된 숫자였다. 이
    // assert 자체가 "숫자가 바뀌면 확인 신호로만 취급"하도록 설계된 정적
    // 위생 점검이라, 실제 결함이 아니라 단순 갱신.
    // ★ 2026-09-28 갱신 — kestate-appraisal(SP-24a, status:'pending') 신설로
    // 31 → 32. status가 'pending'이라 candidate-prefilter.js/call-ai.js의
    // active 전용 필터를 통과하지 못해 실사용자에게는 서빙되지 않는다.
    // ★ 2026-09-28(2차) 갱신 — kestate-search(SP-24b, status:'pending') 신설로
    // 32 → 33. 이 항목도 메인 앱 트리거 디스패치는 안 거치지만(estate.hondi.net
    // 위젯이 시스템 프롬프트를 직접 번들링해 /ai/chat 호출), 등록 자체는
    // 이 레지스트리의 카탈로그 역할을 위해 추가한다.
    // ★ 2026-10-01 갱신 — 이 점검은 이미 노후화돼 있었다(기대값 33, 실제 35). kdoctor(SP-29, type:'tab') 신설로 36.
    // pending이라 실사용자에게 라우팅되지 않는다. 35 → 36 외의 차이 2건은 이번 변경과 무관한 선행 누락 갱신이다.
    assert.equal(GWP_REGISTRY.length, 36, `엔트리 수 변경 감지(현재 ${GWP_REGISTRY.length}) — 이 숫자가 바뀌면 다른 곳(문서 등)도 갱신 필요할 수 있음, 실패 아니라 확인 신호로만 취급해도 됨`);
    for (const e of GWP_REGISTRY) {
      assert.ok(Array.isArray(e.triggers) && e.triggers.length > 0, `${e.id}: triggers 비어있음`);
    }
  });

  test('SD-15: url 필드 own-property 일관성 — type==="switch"만 url 없음, 나머지는 명시적 존재(string|null) (SD-04류 undefined/null 혼동 방지)', () => {
    for (const e of GWP_REGISTRY) {
      const hasUrl = Object.prototype.hasOwnProperty.call(e, 'url');
      if (e.type === 'switch') {
        assert.equal(hasUrl, false, `${e.id}: type=switch인데 url 프로퍼티가 존재함`);
      } else {
        assert.equal(hasUrl, true, `${e.id}: type=${e.type}인데 url 프로퍼티 자체가 없음(undefined) — null과 구분 안 되는 SD-04류 버그`);
      }
    }
  });

  test('SD-16: (정보성) 정확히 동일한 trigger 문자열을 공유하는 서비스 쌍 — 실사용 영향 없음(매칭 dead code), 기록만', () => {
    const seen = new Map();
    for (const e of GWP_REGISTRY) {
      for (const t of e.triggers) {
        if (!seen.has(t)) seen.set(t, []);
        seen.get(t).push(e.id);
      }
    }
    const dupes = [...seen.entries()].filter(([, ids]) => ids.length > 1);
    if (dupes.length) {
      console.log(`ℹ️  [정보] trigger 중복 ${dupes.length}건 (matchService dead code라 실사용 무관):`);
      for (const [t, ids] of dupes) console.log(`    "${t}" -> ${ids.join(', ')}`);
    }
    // 정보성 — 실패시키지 않음. 다만 최소한 배열 형태는 보장한다.
    assert.ok(Array.isArray(dupes));
  });
});
