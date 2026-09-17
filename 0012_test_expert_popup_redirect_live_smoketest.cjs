/**
 * regional-gov.html [EXPERT:] 배선(0008) — 실제 팝업 차단 여부 라이브 검증 v3
 * 2026-09-17
 *
 * v2(0011)의 버그: (A) 대조군이 연 about:blank 탭을 안 닫고 남겨둬서,
 * (B) 단계에서 "메인 페이지가 아닌 탭"을 찾을 때 A가 남긴 탭을 잘못
 * 집었을 가능성이 있다 — B가 실제로 연 탭을 본 게 아닐 수 있다.
 * page.on('popup')으로 생성 순서대로 정확히 추적하고, A는 확인 즉시
 * 닫는다. 콘솔/페이지 에러도 이제 전부 캡처한다(v2는 이게 없어서
 * 리다이렉트 실패 원인을 알 수 없었다).
 *
 * 실행:
 *   node 0012_test_expert_popup_block_live_smoketest_v3.cjs
 */
const { chromium } = require('playwright');

const HEADLESS = true;
const STATIC_BASE = 'https://hondi.net';
const TARGET_PAGE = `${STATIC_BASE}/pages/regional-gov.html`;
const TEST_PERSONA_ID = 'judicial-scrivener';
const FAKE_REPLY = `안내를 도와드리겠습니다. [EXPERT: ${TEST_PERSONA_ID}]`;
const FAKE_USER_TEXT = '등기 서류 작성 관련해서 법무사 AI 연결해줘';

(async () => {
  const browser = await chromium.launch({ headless: HEADLESS });
  const page = await browser.newPage();

  const mainConsole = [];
  page.on('console', msg => mainConsole.push(`[main:${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => mainConsole.push(`[main:pageerror] ${err.message}`));

  // 생성 순서대로 팝업 핸들을 정확히 기록 — A/B 혼동을 원천적으로 방지.
  const popupQueue = [];
  page.on('popup', popup => {
    const entry = { popup, console: [] };
    popup.on('console', msg => entry.console.push(`[popup:${msg.type()}] ${msg.text()}`));
    popup.on('pageerror', err => entry.console.push(`[popup:pageerror] ${err.message}`));
    popupQueue.push(entry);
  });

  try {
    console.log('='.repeat(60));
    console.log('① 오리진 확보 + window.open 감시 설치');
    console.log('='.repeat(60));
    await page.goto(TARGET_PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    console.log(`[PASS] 페이지 로드: ${TARGET_PAGE}`);

    await page.evaluate(() => {
      window.__openLog = [];
      const _origOpen = window.open.bind(window);
      window.open = (url, target, features) => {
        const result = _origOpen(url, target, features);
        window.__openLog.push({ url: String(url || ''), blocked: result === null });
        return result;
      };
    });

    console.log();
    console.log('='.repeat(60));
    console.log('② 대조군(A) — 클릭 제스처 안에서 window.open, 확인 즉시 닫음');
    console.log('='.repeat(60));
    await page.evaluate(() => {
      document.getElementById('ksa-overlay')?.remove();
      window.__gestureClicked = false;
      const btn = document.createElement('button');
      btn.id = '__test_gesture_btn';
      btn.textContent = 'test';
      btn.style.position = 'fixed';
      btn.style.top = '0';
      btn.style.left = '0';
      btn.style.zIndex = '999999';
      btn.onclick = () => { window.__gestureClicked = true; window.open('about:blank', '_blank'); };
      document.body.appendChild(btn);
    });

    const popupCountBeforeA = popupQueue.length;
    await page.click('#__test_gesture_btn', { timeout: 10000 });
    await page.waitForTimeout(500); // popup 이벤트가 큐에 들어올 시간
    const gestureState = await page.evaluate(() => ({ clicked: window.__gestureClicked, openLog: window.__openLog }));
    console.log(`onclick 실행 여부: ${gestureState.clicked}`);
    console.log(`window.open 기록(A까지): ${JSON.stringify(gestureState.openLog)}`);

    if (popupQueue.length > popupCountBeforeA) {
      const aPopup = popupQueue[popupQueue.length - 1].popup;
      console.log(`[INFO] (A) 팝업 생성 확인, URL=${aPopup.url()} — 확인 끝났으니 바로 닫음`);
      await aPopup.close();
    } else {
      console.log('[INFO] (A) 팝업 이벤트 자체가 안 잡힘(window.open 로그의 blocked 값으로 판단)');
    }

    if (!gestureState.clicked) {
      console.log('[FAIL] onclick 자체가 실행 안 됨 — 클릭 미도달, 팝업 차단과 무관한 테스트 환경 문제.');
    } else if (gestureState.openLog[0]?.blocked) {
      console.log('[결과A] 클릭 제스처 안에서도 차단됨 — 이 환경 전체가 팝업을 막고 있음.');
    } else {
      console.log('[PASS A] 클릭 제스처 안에서 정상 허용.');
    }

    console.log();
    console.log('='.repeat(60));
    console.log('③ 실제 경로(B) — 제스처 없이 handleExpertTag 직접 호출');
    console.log('='.repeat(60));
    const openLogBeforeB = (await page.evaluate(() => window.__openLog)).length;
    const popupCountBeforeB = popupQueue.length;

    const callResult = await page.evaluate(async ({ fakeReply, fakeUserText }) => {
      try {
        const mod = await import('/src/gopang/ai/expert-session.js');
        const handled = await mod.handleExpertTag(fakeReply, fakeUserText, null);
        return { ok: true, handled };
      } catch (e) {
        return { ok: false, error: e.message, stack: (e.stack || '').slice(0, 500) };
      }
    }, { fakeReply: FAKE_REPLY, fakeUserText: FAKE_USER_TEXT });

    console.log(`handleExpertTag 호출 결과: ${JSON.stringify(callResult)}`);

    // location.href 리다이렉트가 완료될 시간을 약간 더 준다.
    await page.waitForTimeout(1000);

    const openLogAfterB = await page.evaluate(() => window.__openLog);
    const newOpenEntries = openLogAfterB.slice(openLogBeforeB);
    console.log(`(B) 단계 window.open 신규 기록: ${JSON.stringify(newOpenEntries)}`);

    console.log();
    console.log('='.repeat(60));
    console.log('④ 최종 판정');
    console.log('='.repeat(60));

    if (!callResult.ok) {
      console.log(`[FAIL] handleExpertTag 예외: ${callResult.error}`);
      if (callResult.stack) console.log(callResult.stack);
    } else if (!callResult.handled) {
      console.log('[FAIL] handleExpertTag가 태그 인식 실패');
    } else if (newOpenEntries.length === 0) {
      console.log('[FAIL] handleExpertTag 성공했는데 window.open 호출 자체가 없음 — 배선 문제.');
    } else if (newOpenEntries[0].blocked) {
      console.log('[결과] 팝업 차단됨 — _preTab 사전 오픈 도입 필요(0008 알려진 한계(1) 재현).');
    } else if (popupQueue.length <= popupCountBeforeB) {
      console.log('[FAIL] window.open은 허용(blocked:false)됐는데 popup 이벤트로 잡힌 새 탭이 없음 — 계측 불일치, 재확인 필요.');
    } else {
      const bEntry = popupQueue[popupQueue.length - 1];
      const bPopup = bEntry.popup;
      console.log(`[INFO] (B) 팝업 발견, 현재 URL: ${bPopup.url()}`);
      try {
        await bPopup.waitForURL(/expert-chat\.html/, { timeout: 6000 });
        console.log(`[PASS 최종] expert-chat.html로 리다이렉트 확인: ${bPopup.url()}`);
      } catch (e) {
        console.log(`[FAIL] 6초 안에 expert-chat.html로 리다이렉트 안 됨. 현재 URL: ${bPopup.url()}`);
        console.log('팝업 콘솔/에러 로그:');
        bEntry.console.forEach(l => console.log('  ' + l));
      }
      await bPopup.close().catch(() => {});
    }

    console.log();
    console.log('메인 페이지 콘솔/에러 로그:');
    mainConsole.forEach(l => console.log('  ' + l));

  } catch (e) {
    console.log(`[FAIL] 스크립트 실행 중 예상치 못한 예외: ${e.message}`);
  } finally {
    await browser.close();
  }
})();
