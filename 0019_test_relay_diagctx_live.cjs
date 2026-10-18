/**
 * 시나리오 #9/#10 — klaw/kplan/business/gov relay diagCtx 라이브 검증
 * 2026-09-17
 *
 * 사전 조건: 이 스크립트를 돌리기 전에
 *   1) Cloudflare 대시보드에서 hondi-proxy Worker에 LOG_LEVEL=debug 설정 완료
 *   2) 별도 터미널에서 `npx wrangler tail hondi-proxy` 실행 중이어야 함
 *      (이 스크립트는 로그를 직접 읽지 않는다 — 브라우저 자동화만 담당,
 *      로그 확인은 wrangler tail 터미널을 눈으로 보는 것)
 *
 * 범위가 4개 서비스인데 각각 다른 저장소/페이지에 걸쳐 있다:
 *   - gov:      이 저장소 pages/regional-gov.html — 셀렉터 소스로 직접
 *               확인함(.ci-input / .ci-send-btn) → 완전 자동화
 *   - klaw:     klaw.hondi.net/webapp.html — 별도 저장소, DOM 미검증
 *               → 자동 이동만, 타이핑/전송은 수동
 *   - kplan:    type:'switch'라 새 탭이 아니라 webapp.html(메인 AI 비서)
 *               스레드 안에서 전환됨 — webapp.html 메인 입력창도 이 저장소
 *               안에서 mountChatInput() 호출을 못 찾아 셀렉터 미검증
 *               → 자동 이동만, 타이핑/전송은 수동
 *   - business: market.hondi.net/kmarket_admin_dashboard.html — 별도
 *               저장소, DOM 미검증 → 자동 이동만, 타이핑/전송은 수동
 *
 * 트리거 문구는 전부 gwp-registry.js의 실제 triggers 배열에서 그대로
 * 가져왔다 — 라우팅이 확실히 걸리도록.
 *
 * headless: false로 창을 띄운다(수동 조작 구간이 있어서 headless 불가).
 * 각 단계 사이에 터미널에서 Enter를 누르면 다음 단계로 진행한다.
 *
 * 실행:
 *   npm install readline (Node 내장이라 별도 설치 불필요)
 *   node 0019_test_relay_diagctx_live.cjs
 */
const { chromium } = require('playwright');
const readline = require('readline');

function waitEnter(msg) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(msg, () => { rl.close(); resolve(); });
  });
}

(async () => {
  const browser = await chromium.launch({ headless: false });

  console.log('='.repeat(70));
  console.log('사전 확인');
  console.log('='.repeat(70));
  await waitEnter(
    '① 다른 터미널에서 `npx wrangler tail hondi-proxy`가 실행 중인가요?\n' +
    '② Cloudflare 대시보드에 LOG_LEVEL=debug가 배포됐나요?\n' +
    '둘 다 준비됐으면 Enter를 눌러 시작하세요...\n'
  );

  // ── ① GOV — 완전 자동화 ──────────────────────────────────────
  {
    console.log();
    console.log('='.repeat(70));
    console.log('① GOV — pages/regional-gov.html (자동)');
    console.log('='.repeat(70));
    const page = await browser.newPage();
    await page.goto('https://hondi.net/pages/regional-gov.html', { waitUntil: 'domcontentloaded', timeout: 20000 });
    console.log('[INFO] 로그인/전화번호 인증 창이 뜨면 지금 직접 완료해 주세요.');
    await waitEnter('로그인(필요시) 완료했으면 Enter...\n');

    const msg = '쓰레기 배출 관련 문의드립니다';
    console.log(`[INFO] "${msg}" 를 입력하고 전송합니다.`);
    try {
      await page.fill('#chat-input-slot .ci-input', msg, { timeout: 10000 });
      await page.click('#chat-input-slot .ci-send-btn', { timeout: 5000 });
      console.log('[PASS] 전송 완료. wrangler tail 터미널에서 다음을 확인하세요:');
      console.log('       "tag":"GOV_RELAY_CALL"  그리고  "tag":"AI_EMPTY_COMPLETION_DIAG"');
    } catch (e) {
      console.log(`[WARN] 자동 전송 실패(${e.message}) — 화면에서 직접 "${msg}"를 입력·전송해 주세요.`);
    }
    await waitEnter('응답 도착·로그 확인 끝났으면 Enter (다음 단계로)...\n');
    await page.close();
  }

  // ── ② KLAW — 이동만 자동, 타이핑/전송은 수동 ─────────────────
  {
    console.log();
    console.log('='.repeat(70));
    console.log('② KLAW — klaw.hondi.net/webapp.html (수동 — DOM 미검증 저장소)');
    console.log('='.repeat(70));
    const page = await browser.newPage();
    await page.goto('https://klaw.hondi.net/webapp.html', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(e =>
      console.log(`[WARN] 페이지 이동 실패(${e.message}) — 브라우저에서 직접 열어주세요.`));
    console.log('[ACTION] 로그인(필요시) 후, 아래 문구를 그대로 입력·전송해 주세요(gwp-registry.js triggers에서 그대로 가져온 문구입니다):');
    console.log('         "이혼 소송 판결문 뽑아줘"');
    await waitEnter('전송하고 응답까지 받았으면 Enter...\n');
    console.log('[CHECK] wrangler tail 터미널에서 확인: "tag":"KLAW_RELAY_CALL" / "tag":"AI_EMPTY_COMPLETION_DIAG"');
    await waitEnter('로그 확인 끝났으면 Enter (다음 단계로)...\n');
    await page.close();
  }

  // ── ③ KPLAN — webapp.html 메인(같은 스레드 switch), 이동만 자동 ──
  {
    console.log();
    console.log('='.repeat(70));
    console.log('③ KPLAN — hondi.net/webapp.html 메인 AI 비서 (수동)');
    console.log('='.repeat(70));
    const page = await browser.newPage();
    await page.goto('https://hondi.net/webapp.html', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(e =>
      console.log(`[WARN] 페이지 이동 실패(${e.message}) — 브라우저에서 직접 열어주세요.`));
    console.log('[ACTION] 로그인(필요시) 후, 메인 채팅창(사이드 AI 패널 아님)에 아래 문구를 입력·전송해 주세요:');
    console.log('         "여행 일정 계획을 세워줘"');
    console.log('[주의] kplan은 type:"switch"라 새 탭이 아니라 같은 대화 안에서 시스템 프롬프트만 바뀝니다.');
    await waitEnter('전송하고 응답까지 받았으면 Enter...\n');
    console.log('[CHECK] wrangler tail 터미널에서 확인: "tag":"KPLAN_RELAY_CALL" / "tag":"AI_EMPTY_COMPLETION_DIAG"');
    await waitEnter('로그 확인 끝났으면 Enter (다음 단계로)...\n');
    await page.close();
  }

  // ── ④ BUSINESS — market.hondi.net, 이동만 자동 ──────────────
  {
    console.log();
    console.log('='.repeat(70));
    console.log('④ BUSINESS — market.hondi.net/kmarket_admin_dashboard.html (수동)');
    console.log('='.repeat(70));
    const page = await browser.newPage();
    await page.goto('https://market.hondi.net/kmarket_admin_dashboard.html', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(e =>
      console.log(`[WARN] 페이지 이동 실패(${e.message}) — 브라우저에서 직접 열어주세요.`));
    console.log('[ACTION] 로그인(필요시) 후, 아래 문구를 그대로 입력·전송해 주세요:');
    console.log('         "우리 가게 상권 분석해줘"');
    await waitEnter('전송하고 응답까지 받았으면 Enter...\n');
    console.log('[CHECK] wrangler tail 터미널에서 확인: "tag":"BUSINESS_RELAY_CALL" / "tag":"AI_EMPTY_COMPLETION_DIAG"');
    await waitEnter('로그 확인 끝났으면 Enter (전체 종료)...\n');
    await page.close();
  }

  console.log();
  console.log('='.repeat(70));
  console.log('전체 완료 — wrangler tail 터미널에 4개 서비스 각각');
  console.log('AI_EMPTY_COMPLETION_DIAG 로그가 다 찍혔는지 최종 확인해 주세요.');
  console.log('확인 끝나면 Cloudflare 대시보드에서 LOG_LEVEL 변수를 지우는 것을 권장합니다.');
  console.log('='.repeat(70));

  await browser.close();
})();
