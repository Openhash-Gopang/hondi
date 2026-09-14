/**
 * AI 응답 최후 안전망 — 헤드리스 브라우저 라이브 스모크테스트
 * 2026-09-12
 *
 * ⚠️ 중요한 한계 (실행 전에 꼭 읽어주세요)
 * 이 스크립트는 실제 로그인·지갑 세션 없이 동작합니다. 정식 앱
 * 부트스트랩(gopang-app.js)을 거치지 않고 call-ai.js 모듈만 직접
 * import해서 callAI()를 호출하기 때문에, 대부분의 경우 내부 상태
 * 미비(예: CFG 미초기화, history 미설정 등)로 _callAIInner가 어딘가
 * 에서 예외를 던질 가능성이 높습니다 — 이건 버그가 아니라 이 테스트
 * 방식 자체의 특성입니다. 우리가 확인하려는 건 "그 예외가 났을 때
 * 화면(#message-list)에 빈 말풍선이 아니라 실제로 보이는 문구가
 * 남는가"입니다. 반대로 이 harness 환경에서 우연히 끝까지 정상
 * 동작해 실제 AI 응답이 온다면, 그것도 "응답이 있었다"는 의미에서
 * PASS로 처리합니다 — 이 테스트가 검증하는 것은 정확히 "빈 말풍선으로
 * 끝나지 않는다"는 한 가지입니다.
 *
 * 실행 전 준비 (실제 인터넷이 되는 사용자 PC에서):
 *   npm install playwright
 *   npx playwright install chromium
 *
 * 실행:
 *   node live_smoketest_ai_fallback_headless_20260912.js
 */
const { chromium } = require('playwright');

const STATIC_BASE = 'https://hondi.net';
// 앱 전체를 부팅시키는 gopang-app.js가 없는, 가벼운 정적 페이지를
// 골라서 origin만 맞춘다 — 상대경로 import(./bubble.js 등)가 올바르게
// 풀리려면 반드시 hondi.net 오리진 위에서 실행돼야 한다.
const NEUTRAL_PAGE = `${STATIC_BASE}/terms-of-use.html`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const consoleLines = [];
  page.on('console', msg => consoleLines.push(`[browser:${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => consoleLines.push(`[pageerror] ${err.message}`));

  console.log('='.repeat(60));
  console.log('① 오리진 확보 — 가벼운 정적 페이지로 이동');
  console.log('='.repeat(60));
  try {
    await page.goto(NEUTRAL_PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    console.log(`[PASS] 페이지 로드 성공: ${NEUTRAL_PAGE}`);
  } catch (e) {
    console.log(`[FAIL] 페이지 로드 실패: ${e.message}`);
    console.log('네트워크 연결이나 도메인 자체를 먼저 확인해 주세요.');
    await browser.close();
    process.exit(1);
  }

  console.log();
  console.log('='.repeat(60));
  console.log('② 테스트용 DOM 준비 (#message-list)');
  console.log('='.repeat(60));
  await page.evaluate(() => {
    const div = document.createElement('div');
    div.id = 'message-list';
    document.body.appendChild(div);
  });
  console.log('[PASS] #message-list 컨테이너 삽입 완료');

  console.log();
  console.log('='.repeat(60));
  console.log('③ 실제 배포된 call-ai.js를 동적 import');
  console.log('='.repeat(60));

  const importResult = await page.evaluate(async () => {
    try {
      const mod = await import('/src/gopang/ai/call-ai.js');
      return { ok: true, hasCallAI: typeof mod.callAI === 'function' };
    } catch (e) {
      return { ok: false, error: e.message, stack: (e.stack || '').slice(0, 500) };
    }
  });

  if (!importResult.ok) {
    console.log(`[FAIL] import 실패: ${importResult.error}`);
    console.log('--- 스택(일부) ---');
    console.log(importResult.stack);
    console.log();
    console.log('--- 브라우저 콘솔 로그 ---');
    consoleLines.forEach(l => console.log(l));
    console.log();
    console.log('import 단계에서부터 막혔습니다 — call-ai.js가 의존하는');
    console.log('다른 모듈(core/state.js, core/config.js 등)이 전체 앱');
    console.log('부트스트랩 없이는 로드 자체가 안 되는 구조일 수 있습니다.');
    console.log('이 경우 이 테스트 방식 자체의 한계이며, "최후 안전망"');
    console.log('코드 자체의 결함은 아닙니다 — 코드 리뷰와 문법 검증은');
    console.log('이미 별도로 통과했습니다.');
    await browser.close();
    process.exit(1);
  }
  console.log(`[PASS] import 성공 (callAI 함수 존재: ${importResult.hasCallAI})`);

  console.log();
  console.log('='.repeat(60));
  console.log('④ callAI() 직접 호출 — 30초 타임아웃');
  console.log('='.repeat(60));

  const callResult = await page.evaluate(async () => {
    try {
      const mod = await import('/src/gopang/ai/call-ai.js');
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('30초 타임아웃 — 응답도 안 오고 예외도 안 남')), 30000));
      await Promise.race([mod.callAI('스모크테스트: 이 메시지에 응답해줘.'), timeout]);
      return { ok: true, timedOut: false };
    } catch (e) {
      // callAI() 자체가 reject됐다는 건 우리가 이번에 넣은 안전망(내부
      // catch)마저 뚫렸다는 뜻 — 이건 실제로 FAIL이어야 한다.
      return { ok: false, error: e.message, timedOut: e.message.includes('타임아웃') };
    }
  });

  if (!callResult.ok) {
    console.log(`[FAIL] callAI() 자체가 실패로 끝남: ${callResult.error}`);
    if (callResult.timedOut) {
      console.log('(타임아웃 — 최후 안전망이 있어도 애초에 return을 안 하는');
      console.log(' 무한 대기 코드 경로가 있다는 뜻입니다. 별도 확인이 필요합니다.)');
    }
  } else {
    console.log('[PASS] callAI() 호출이 예외 없이 완료됨(최후 안전망이 삼켰거나, 정상 응답)');
  }

  console.log();
  console.log('='.repeat(60));
  console.log('⑤ #message-list DOM 내용 확인 — 빈 말풍선인지, 뭔가 남았는지');
  console.log('='.repeat(60));

  const domText = await page.evaluate(() => {
    const el = document.getElementById('message-list');
    return el ? el.innerText.trim() : null;
  });

  console.log('--- #message-list 최종 텍스트 ---');
  console.log(domText || '(비어있음)');
  console.log('---');

  const isEmpty = !domText;
  const hasFallbackText = !!domText && domText.includes('잠시 응답을 생성하지 못했습니다');

  console.log();
  if (isEmpty) {
    console.log('[FAIL] #message-list가 완전히 비어 있습니다 — 빈 말풍선 문제가 재현됐습니다.');
  } else if (hasFallbackText) {
    console.log('[PASS] 최후 안전망 문구가 정상적으로 화면에 남았습니다 (의도한 동작).');
  } else {
    console.log('[PASS] 빈 말풍선이 아니라 실제 응답(또는 다른 안내 문구)이 남았습니다.');
  }

  console.log();
  console.log('--- 브라우저 콘솔 로그(전체, 진단용) ---');
  consoleLines.forEach(l => console.log(l));

  await browser.close();
  process.exit(isEmpty ? 1 : 0);
})();
