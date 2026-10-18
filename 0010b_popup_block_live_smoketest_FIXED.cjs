/**
 * regional-gov.html [EXPERT:] 배선(0008) — 실제 팝업 차단 여부 라이브 검증
 * 2026-09-17
 *
 * 0009와의 차이: 0009는 window.open을 스텁으로 가로채 "호출되는가"만
 * 봤다(배선 자체 검증용). 이 스크립트는 window.open을 건드리지 않고
 * page.waitForEvent('popup')로 "실제로 창이 열리는가"를 관찰한다 —
 * 브라우저가 팝업을 차단하면 이 이벤트 자체가 안 뜬다.
 *
 * 대조군(A)이 반드시 같이 있어야 하는 이유: (B) 결과 하나만 보고
 * "차단됐다/안 됐다"를 판단하면, 네트워크 문제·페이지 로드 실패 같은
 * 다른 원인과 실제 팝업 차단을 구분할 수 없다. (A)가 정상적으로 열리는
 * 걸 먼저 확인해야 "이 브라우저 환경에서 팝업 메커니즘 자체는 정상
 * 동작한다"는 기준선이 생기고, 그 위에서 (B)의 결과가 의미를 가진다.
 *
 *   (A) 대조군 — 실제 클릭 제스처 안에서 동기적으로 window.open() 호출.
 *       정상적인 사용자 클릭과 동일한 조건이라 차단되면 안 된다.
 *   (B) 실제 경로 — handleExpertTag를 프로덕션과 동일한 방식으로 호출:
 *       클릭 이벤트가 아니라 await 여러 번(네트워크 왕복)을 지난 뒤,
 *       page.evaluate 안에서 "그냥 호출"한다. regional-gov.html의
 *       _callAI()가 실제로 handleExpertTag를 부르는 시점과 제스처
 *       측면에서 동일한 조건 — 이게 바로 0008 커밋에 적어둔 팝업 차단
 *       위험의 실체다.
 *
 * ⚠️ 한계: headless 모드에서는 Chromium의 팝업 차단 정책이 headful(실제
 * 창이 보이는) 모드와 미묘하게 다를 수 있습니다. 아래는 기본 headless로
 * 실행하되, (B) 결과가 "차단 안 됨"으로 나오면 headed 모드
 * (headless: false)로 한 번 더 돌려서 교차 확인하는 걸 권장합니다 —
 * 스크립트 맨 위 HEADLESS 상수만 false로 바꾸면 됩니다.
 *
 * 실행:
 *   node 0010_test_expert_popup_block_live_smoketest.cjs
 */
const { chromium } = require('playwright');

const HEADLESS = true; // (B)가 "안 막힘"으로 나오면 false로 바꿔 재확인

const STATIC_BASE = 'https://hondi.net';
const TARGET_PAGE = `${STATIC_BASE}/pages/regional-gov.html`;
const TEST_PERSONA_ID = 'judicial-scrivener';
const FAKE_REPLY = `안내를 도와드리겠습니다. [EXPERT: ${TEST_PERSONA_ID}]`;
const FAKE_USER_TEXT = '등기 서류 작성 관련해서 법무사 AI 연결해줘';

async function waitPopupOrNull(page, timeoutMs) {
  try {
    const popup = await page.waitForEvent('popup', { timeout: timeoutMs });
    return popup;
  } catch (e) {
    return null; // 타임아웃 = 팝업 이벤트 없음(차단됐거나 아예 안 열림)
  }
}

(async () => {
  const browser = await chromium.launch({ headless: HEADLESS });
  const page = await browser.newPage();
  try {

  console.log('='.repeat(60));
  console.log('① 오리진 확보');
  console.log('='.repeat(60));
  try {
    await page.goto(TARGET_PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    console.log(`[PASS] 페이지 로드: ${TARGET_PAGE}`);
  } catch (e) {
    console.log(`[FAIL] 페이지 로드 실패: ${e.message}`);
    await browser.close();
    process.exit(1);
  }

  // ── (A) 대조군: 실제 클릭 제스처 안에서 동기 window.open ──────────
  console.log();
  console.log('='.repeat(60));
  console.log('② 대조군(A) — 클릭 제스처 안에서 window.open("about:blank")');
  console.log('='.repeat(60));

  await page.evaluate(() => {
    const btn = document.createElement('button');
    btn.id = '__test_gesture_btn';
    btn.textContent = 'test';
    btn.onclick = () => { window.open('about:blank', '_blank'); };
    document.body.appendChild(btn);
  });

  const popupA_promise = waitPopupOrNull(page, 5000);
  let popupA = null;
  try {
    // force: true — #ksa-overlay(인증/지갑 설정 오버레이) 같은 화면
    // 위 레이어가 "실제 클릭 가능한 상태인지" 안전검사에 걸리는 것만
    // 건너뛴다. CDP로 실제 트러스트된 클릭 이벤트를 보내는 건 동일하므로
    // 브라우저의 팝업 차단(사용자 제스처 판별) 관점에서는 변함없이
    // "진짜 클릭"이다 — 대조군의 의미가 훼손되지 않는다.
    await page.click('#__test_gesture_btn', { force: true, timeout: 10000 });
    popupA = await popupA_promise;
  } catch (e) {
    console.log(`[WARN] 대조군(A) 클릭 자체가 실패: ${e.message.split('\n')[0]}`);
  }

  if (popupA) {
    console.log('[PASS] 대조군(A) — 팝업 정상 열림. 이 브라우저 환경에서 팝업 메커니즘 자체는 정상 동작 확인됨.');
    await popupA.close();
  } else {
    console.log('[FAIL] 대조군(A)마저 안 열림 — 이 환경 자체가 모든 팝업을 차단하고 있거나 클릭이 실제로 전달 안 됐을 가능성. 아래 (B) 결과는 참고용으로만 보되, (A)도 실패했다는 점을 같이 감안해서 판단해야 함.');
  }

  // ── (B) 실제 경로: handleExpertTag를 제스처 없이(비동기 컨텍스트) 호출 ──
  console.log();
  console.log('='.repeat(60));
  console.log('③ 실제 경로(B) — 제스처 없이 handleExpertTag → _gwpLaunch → window.open');
  console.log('='.repeat(60));

  const popupB_promise = waitPopupOrNull(page, 8000);

  const callResult = await page.evaluate(async ({ fakeReply, fakeUserText }) => {
    try {
      const mod = await import('/src/gopang/ai/expert-session.js');
      const handled = await mod.handleExpertTag(fakeReply, fakeUserText, null);
      return { ok: true, handled };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, { fakeReply: FAKE_REPLY, fakeUserText: FAKE_USER_TEXT });

  const popupB = await popupB_promise;

  console.log(`handleExpertTag 호출 결과: ${JSON.stringify(callResult)}`);

  console.log();
  console.log('='.repeat(60));
  console.log('④ 최종 판정');
  console.log('='.repeat(60));

  if (!callResult.ok) {
    console.log(`[FAIL] handleExpertTag 호출 자체가 예외로 실패: ${callResult.error}`);
  } else if (!callResult.handled) {
    console.log('[FAIL] handleExpertTag가 태그를 인식하지 못함(라우팅 실패) — 팝업 여부와 별개 문제');
  } else if (popupB) {
    console.log(`[결과] 팝업 차단 안 됨 — 새 탭이 실제로 열렸습니다. URL: ${popupB.url()}`);
    console.log('       (이 헤드리스 환경 기준. 실제 사용자 크롬에서는 확장프로그램·설정에 따라 다를 수 있어 최종 확인은 여전히 권장)');
    await popupB.close();
  } else {
    console.log('[결과] 팝업 차단됨(또는 열리지 않음) — 대조군(A)은 정상 열렸으므로, 이건 "제스처 없는 호출"이라는 조건 자체가 원인일 가능성이 높습니다.');
    console.log('       0008 커밋에 적은 알려진 한계(1)이 실제로 재현된 것 — _preTab 사전 오픈 메커니즘 도입이 필요합니다.');
  }
  } catch (e) {
    console.log(`[FAIL] 스크립트 실행 중 예상치 못한 예외: ${e.message}`);
  } finally {
    await browser.close();
  }
})();
