/**
 * regional-gov.html [EXPERT:] 태그 배선(패치 0008) — 헤드리스 브라우저
 * 라이브 스모크테스트
 * 2026-09-17
 *
 * ⚠️ 중요한 한계 (실행 전에 꼭 읽어주세요)
 * routing_ABmention_live_smoketest.py와 동일한 이유로, 순수 API 텍스트
 * 비교 테스트로는 "새 탭이 실제로 열리는가"를 검증할 수 없습니다. 이
 * 스크립트는 live_smoketest_ai_fallback_headless_20260912.cjs와 같은
 * 패턴(실제 배포된 hondi.net 오리진에서 모듈을 직접 동적 import해 부작용을
 * 관찰)을 씁니다 — 다만 이번엔 관찰 대상이 에러 문구가 아니라
 * window.open() 호출 자체입니다.
 *
 * 검증하는 것 정확히 두 가지:
 *  (A) handleExpertTag(fullReply, userText, null)을 [EXPERT: judicial-scrivener]
 *      태그가 포함된 fullReply로 호출했을 때 window.open이 호출되는가
 *      (패치 0008 배선이 실제로 동작하는가)
 *  (B) 그 호출이 about:blank로 먼저 열고 나중에 location을 바꾸는 것이
 *      아니라 곧바로 최종 URL로 열리는가 (0008 커밋에 적어둔 "알려진
 *      한계 (1) 팝업 차단 위험"의 근거 확인 — _preTab이 null이라
 *      window.open(url, '_blank') 형태로 즉시 호출되면 클릭 이벤트와
 *      시간차가 생겨 실제 브라우저에서는 팝업 차단 가능성이 있습니다.
 *      이 헤드리스 테스트 자체는 팝업 차단 여부를 검증하지 않습니다 —
 *      Playwright의 chromium은 기본적으로 팝업을 차단하지 않기 때문입니다.
 *      팝업 차단 여부는 반드시 실제 크롬 브라우저로 hondi.net에서
 *      수동 재현해야 합니다(패치 0008 커밋 메모 참고).
 *
 * 실행 전 준비 (실제 인터넷이 되는 사용자 PC에서):
 *   npm install playwright
 *   npx playwright install chromium
 *
 * 실행:
 *   node 0009_test_expert_regional_gov_live_smoketest.cjs
 */
const { chromium } = require('playwright');

const STATIC_BASE = 'https://hondi.net';
// regional-gov.html 자신을 오리진으로 쓴다 — 이 페이지의 상대경로 import가
// 실제로 이 페이지 기준으로 풀리는지까지 같이 확인하기 위함(다른 정적
// 페이지를 오리진으로 쓰면 상대경로 문제를 놓칠 수 있음).
const TARGET_PAGE = `${STATIC_BASE}/pages/regional-gov.html`;

// 리프 페르소나 하나를 고정으로 쓴다 — subject-gate.js의 refineToLeaf가
// 상위(professor/physician/lawyer) ID에서는 추가 LLM 호출로 리프를
// 정밀화하려 들어 이 헤드리스 환경(로그인/지갑 미부트스트랩)에서 실패할
// 가능성이 높다. judicial-scrivener는 expert-registry-core.js에 등록된
// 리프 ID라 정밀화 단계 자체가 없다.
const TEST_PERSONA_ID = 'judicial-scrivener';
const FAKE_REPLY = `안내를 도와드리겠습니다. [EXPERT: ${TEST_PERSONA_ID}]`;
const FAKE_USER_TEXT = '등기 서류 작성 관련해서 법무사 AI 연결해줘';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const consoleLines = [];
  page.on('console', msg => consoleLines.push(`[browser:${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => consoleLines.push(`[pageerror] ${err.message}`));

  console.log('='.repeat(60));
  console.log('① 오리진 확보 — regional-gov.html 자체로 이동');
  console.log('='.repeat(60));
  try {
    await page.goto(TARGET_PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    console.log(`[PASS] 페이지 로드 성공: ${TARGET_PAGE}`);
  } catch (e) {
    console.log(`[FAIL] 페이지 로드 실패: ${e.message}`);
    console.log('네트워크 연결이나 도메인 자체를 먼저 확인해 주세요.');
    await browser.close();
    process.exit(1);
  }

  console.log();
  console.log('='.repeat(60));
  console.log('② window.open 감시용 스텁 설치');
  console.log('='.repeat(60));
  // 실제 팝업을 띄우지 않고 호출 여부·인자만 기록한다. 원본은 백업해
  // 뒀다가 끝에 복원(다른 검증에 영향 없도록).
  await page.evaluate(() => {
    window.__openCalls = [];
    window.__originalOpen = window.open;
    window.open = (url, target, features) => {
      window.__openCalls.push({ url: String(url), target: String(target || '') });
      // 실제 탭을 열지 않고, _gwpLaunch가 이후 .closed/.location 접근 시
      // 죽지 않도록 최소한의 가짜 핸들만 돌려준다.
      return { closed: false, location: { href: '' }, close() { this.closed = true; } };
    };
  });
  console.log('[PASS] window.open 스텁 설치 완료');

  console.log();
  console.log('='.repeat(60));
  console.log('③ expert-session.js를 동적 import 후 handleExpertTag 직접 호출');
  console.log('='.repeat(60));

  const result = await page.evaluate(async ({ fakeReply, fakeUserText }) => {
    try {
      const mod = await import('/src/gopang/ai/expert-session.js');
      if (typeof mod.handleExpertTag !== 'function') {
        return { ok: false, phase: 'import', error: 'handleExpertTag가 export되어 있지 않음' };
      }
      const handled = await mod.handleExpertTag(fakeReply, fakeUserText, null);
      return {
        ok: true,
        handled,
        openCalls: window.__openCalls,
      };
    } catch (e) {
      return { ok: false, phase: 'call', error: e.message, stack: (e.stack || '').slice(0, 800) };
    }
  }, { fakeReply: FAKE_REPLY, fakeUserText: FAKE_USER_TEXT });

  console.log();
  console.log('='.repeat(60));
  console.log('④ 결과 판정');
  console.log('='.repeat(60));

  if (!result.ok) {
    console.log(`[FAIL] handleExpertTag 호출 중 예외 (phase=${result.phase}): ${result.error}`);
    if (result.stack) console.log(result.stack);
    console.log();
    console.log('브라우저 콘솔 로그:');
    consoleLines.forEach(l => console.log('  ' + l));
    await browser.close();
    process.exit(1);
  }

  console.log(`handleExpertTag 반환값: ${result.handled}`);
  console.log(`window.open 호출 횟수: ${result.openCalls.length}`);
  result.openCalls.forEach((c, i) => console.log(`  [${i}] url=${c.url} target=${c.target}`));

  let pass = true;
  if (result.handled !== true) {
    console.log('[FAIL] handleExpertTag가 true를 반환하지 않음 — 태그 인식/라우팅 실패');
    pass = false;
  }
  if (result.openCalls.length !== 1) {
    console.log(`[FAIL] window.open이 정확히 1회 호출되어야 하는데 ${result.openCalls.length}회 호출됨`);
    pass = false;
  } else if (!/expert-chat\.html/.test(result.openCalls[0].url)) {
    console.log(`[FAIL] 열린 URL이 expert-chat.html이 아님: ${result.openCalls[0].url}`);
    pass = false;
  } else if (!result.openCalls[0].url.includes(TEST_PERSONA_ID)) {
    console.log(`[FAIL] 열린 URL에 persona 식별자(${TEST_PERSONA_ID})가 없음: ${result.openCalls[0].url}`);
    pass = false;
  }

  console.log();
  if (pass) {
    console.log('[PASS] 패치 0008 배선 확인 — [EXPERT:] 태그 → handleExpertTag → window.open(expert-chat.html) 정상 호출');
  } else {
    console.log('[FAIL] 위 항목 확인 필요 — 콘솔 로그:');
    consoleLines.forEach(l => console.log('  ' + l));
  }

  await browser.close();
  process.exit(pass ? 0 : 1);
})();
