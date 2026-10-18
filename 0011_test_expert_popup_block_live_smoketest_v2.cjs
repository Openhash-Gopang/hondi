/**
 * regional-gov.html [EXPERT:] 배선(0008) — 실제 팝업 차단 여부 라이브 검증 v2
 * 2026-09-17
 *
 * v1(0010)의 문제 2가지를 고쳤다:
 *  1) 대조군(A)이 #ksa-overlay에 클릭이 막혀 onclick 자체가 실행됐는지
 *     확인 안 하고 "팝업 안 뜸=FAIL"로 오판할 수 있었다 — 이제 오버레이를
 *     먼저 제거하고, onclick이 실행됐는지 자체를 별도로 기록한다.
 *  2) window.open의 반환값(차단되면 브라우저가 null을 돌려준다 — 이게
 *     팝업 차단의 1차 신호)을 안 보고 있었다 — 이제 window.open을
 *     감시(원본 동작은 그대로, 호출 인자·반환값만 기록)해서 직접 본다.
 *  3) (B)에서 about:blank로 열린 뒤 실제로 expert-chat.html로
 *     리다이렉트되는지까지 확인한다(_gwpLaunch가 about:blank를 먼저 열고
 *     나중에 location.href를 바꾸는 구조라, 뜬 직후 URL만 보면
 *     about:blank가 정상이라 그것만으로는 성공 여부를 알 수 없다).
 *
 * 실행:
 *   node 0011_test_expert_popup_block_live_smoketest_v2.cjs
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

  try {
    console.log('='.repeat(60));
    console.log('① 오리진 확보 + window.open 감시(원본 동작은 그대로) 설치');
    console.log('='.repeat(60));
    await page.goto(TARGET_PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    console.log(`[PASS] 페이지 로드: ${TARGET_PAGE}`);

    await page.evaluate(() => {
      window.__openLog = [];
      const _origOpen = window.open.bind(window);
      window.open = (url, target, features) => {
        const result = _origOpen(url, target, features);
        // result가 null이면 브라우저가 팝업을 차단했다는 뜻(문서화된 표준 동작).
        window.__openLog.push({ url: String(url || ''), blocked: result === null });
        return result;
      };
    });
    console.log('[PASS] window.open 감시 설치 완료(원본 호출은 그대로 실행됨)');

    console.log();
    console.log('='.repeat(60));
    console.log('② 대조군(A) 준비 — #ksa-overlay 제거 후 클릭 가능한 버튼 부착');
    console.log('='.repeat(60));
    const overlayInfo = await page.evaluate(() => {
      const overlay = document.getElementById('ksa-overlay');
      const existed = !!overlay;
      if (overlay) overlay.remove();
      window.__gestureClicked = false;
      const btn = document.createElement('button');
      btn.id = '__test_gesture_btn';
      btn.textContent = 'test';
      btn.style.position = 'fixed';
      btn.style.top = '0';
      btn.style.left = '0';
      btn.style.zIndex = '999999';
      btn.onclick = () => {
        window.__gestureClicked = true;
        window.open('about:blank', '_blank');
      };
      document.body.appendChild(btn);
      return { existed };
    });
    console.log(`[INFO] #ksa-overlay 존재 여부: ${overlayInfo.existed} (제거함)`);

    await page.click('#__test_gesture_btn', { timeout: 10000 });
    const gestureState = await page.evaluate(() => ({
      clicked: window.__gestureClicked,
      openLog: window.__openLog,
    }));

    console.log(`onclick 실행 여부: ${gestureState.clicked}`);
    console.log(`이 시점까지의 window.open 기록: ${JSON.stringify(gestureState.openLog)}`);

    if (!gestureState.clicked) {
      console.log('[FAIL] onclick 자체가 실행 안 됨 — 클릭이 버튼에 도달하지 못함(테스트 환경 문제, 팝업 차단과 무관).');
    } else if (gestureState.openLog.length === 0) {
      console.log('[FAIL] onclick은 실행됐는데 window.open 감시 로그에 안 잡힘(계측 자체 오류) — 스크립트 버그일 가능성.');
    } else if (gestureState.openLog[0].blocked) {
      console.log('[결과A] 클릭 제스처 안에서도 window.open이 null(차단됨)을 반환 — 이 환경 자체가 팝업을 전면 차단 중. 아래 (B) 결과는 참고용으로만 볼 것.');
    } else {
      console.log('[PASS A] 클릭 제스처 안에서 window.open 정상 허용(null 아님) — 팝업 메커니즘 자체는 정상.');
    }

    console.log();
    console.log('='.repeat(60));
    console.log('③ 실제 경로(B) — 제스처 없이 handleExpertTag 직접 호출');
    console.log('='.repeat(60));

    // 이 시점부터의 open 로그만 보게, 기준 인덱스를 기억해둔다.
    const beforeLen = gestureState.openLog.length;

    const callResult = await page.evaluate(async ({ fakeReply, fakeUserText }) => {
      try {
        const mod = await import('/src/gopang/ai/expert-session.js');
        const handled = await mod.handleExpertTag(fakeReply, fakeUserText, null);
        return { ok: true, handled };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }, { fakeReply: FAKE_REPLY, fakeUserText: FAKE_USER_TEXT });

    console.log(`handleExpertTag 호출 결과: ${JSON.stringify(callResult)}`);

    const openLogAfter = await page.evaluate(() => window.__openLog);
    const newEntries = openLogAfter.slice(beforeLen);
    console.log(`(B) 단계에서 새로 기록된 window.open 호출: ${JSON.stringify(newEntries)}`);

    console.log();
    console.log('='.repeat(60));
    console.log('④ 최종 판정');
    console.log('='.repeat(60));

    if (!callResult.ok || !callResult.handled) {
      console.log('[FAIL] handleExpertTag 자체가 실패 — 팝업 여부와 별개 문제.');
    } else if (newEntries.length === 0) {
      console.log('[FAIL] handleExpertTag는 성공(handled:true)했는데 window.open이 전혀 호출 안 됨 — 배선 자체를 다시 봐야 함.');
    } else if (newEntries[0].blocked) {
      console.log('[결과] 팝업 차단됨 — (B) 경로(제스처 없음)에서 window.open이 null을 반환했습니다.');
      console.log('       0008 커밋에 적은 알려진 한계(1)이 실제로 재현된 것 — _preTab 사전 오픈(webapp.html 방식) 도입이 필요합니다.');
    } else {
      console.log('[결과] window.open 자체는 차단 안 되고 허용됨. 이제 실제로 expert-chat.html로 리다이렉트되는지 확인합니다.');
      // popup 이벤트로 실제 페이지 핸들을 얻어 리다이렉트를 기다린다.
      // 이미 열려서 지나갔을 수 있으니 타임아웃은 짧게, 실패해도 치명적이지 않음.
      const pages = browser.contexts()[0].pages();
      const popupPage = pages.find(p => p !== page);
      if (popupPage) {
        try {
          await popupPage.waitForURL(/expert-chat\.html/, { timeout: 5000 });
          console.log(`[PASS 최종] 실제로 expert-chat.html로 리다이렉트 확인됨: ${popupPage.url()}`);
        } catch (e) {
          console.log(`[WARN] window.open은 허용됐지만 expert-chat.html 리다이렉트를 5초 안에 확인 못함(현재 URL: ${popupPage.url()}). 네트워크 지연일 수도, _gwpLaunch 내부 로직 문제일 수도 있음 — 별도 확인 필요.`);
        }
        await popupPage.close();
      } else {
        console.log('[WARN] window.open은 허용됐다고 기록됐는데 실제 팝업 페이지 핸들을 못 찾음 — 계측 로직 재검토 필요.');
      }
    }
  } catch (e) {
    console.log(`[FAIL] 스크립트 실행 중 예상치 못한 예외: ${e.message}`);
  } finally {
    await browser.close();
  }
})();
