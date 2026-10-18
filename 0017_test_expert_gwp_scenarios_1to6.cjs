/**
 * regional-gov.html — EXPERT/GWP 태그 배선 통합 검증 (시나리오 #1,2,3,4,5,6)
 * 2026-09-17
 *
 * 0012의 계측 패턴(window.open 원본 동작 유지 + 반환값 기록,
 * page.on('popup')으로 생성 순서대로 추적)을 그대로 재사용해 6개 시나리오를
 * 한 번의 페이지 로드 안에서 순서대로 실행한다. #7/#8(실제 팝업 차단
 * 여부)과 #9/#10(worker.js diagCtx 로그)은 이 스크립트 범위 밖 — 각각
 * 실제 브라우저 수동 확인, wrangler tail 확인이 필요하다.
 *
 * 실행:
 *   node 0017_test_expert_gwp_scenarios_1to6.cjs
 */
const { chromium } = require('playwright');

const STATIC_BASE = 'https://hondi.net';
const TARGET_PAGE = `${STATIC_BASE}/pages/regional-gov.html`;

const results = []; // { id, name, pass, detail }

function record(id, name, pass, detail) {
  results.push({ id, name, pass, detail });
  console.log(`[${pass === true ? 'PASS' : pass === false ? 'FAIL' : 'INFO'}] #${id} ${name}`);
  console.log('       ' + detail);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const mainConsole = [];
  page.on('console', msg => mainConsole.push(`[${msg.type()}] ${msg.text()}`));

  const popupQueue = [];
  page.on('popup', popup => popupQueue.push(popup));

  try {
    await page.goto(TARGET_PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });

    // window.open 감시 설치 — 0012와 동일 패턴(원본 동작은 그대로 실행됨).
    await page.evaluate(() => {
      window.__openLog = [];
      const _orig = window.open.bind(window);
      window.open = (url, target, features) => {
        const result = _orig(url, target, features);
        window.__openLog.push({ url: String(url || ''), blocked: result === null });
        return result;
      };
    });

    const getOpenLog = () => page.evaluate(() => window.__openLog);
    const clearOpenLog = () => page.evaluate(() => { window.__openLog = []; });

    // ── #1: EXPERT 태그 — 정상 리프(judicial-scrivener) ──────────
    await clearOpenLog();
    const r1 = await page.evaluate(async () => {
      try {
        const mod = await import('/src/gopang/ai/expert-session.js');
        const handled = await mod.handleExpertTag(
          '안내를 도와드리겠습니다. [EXPERT: judicial-scrivener]',
          '등기 서류 작성 관련해서 법무사 AI 연결해줘', null
        );
        return { ok: true, handled };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    await page.waitForTimeout(500);
    const log1 = await getOpenLog();
    const popup1 = popupQueue[popupQueue.length - 1];
    let url1 = null;
    if (popup1) { try { await popup1.waitForURL(/expert-chat\.html/, { timeout: 4000 }); url1 = popup1.url(); await popup1.close(); } catch { url1 = popup1.url(); } }
    const pass1 = r1.ok && r1.handled === true && log1.length === 1 && !log1[0].blocked &&
      !!url1 && /expert-chat\.html\?persona=judicial-scrivener/.test(url1);
    record(1, 'EXPERT 태그 — 정상 리프', pass1, `handled=${r1.handled}, openLog=${JSON.stringify(log1)}, finalUrl=${url1}`);

    // ── #2: EXPERT 태그 — 미등록 ID ───────────────────────────────
    await clearOpenLog();
    const popupCountBefore2 = popupQueue.length;
    const r2 = await page.evaluate(async () => {
      try {
        const mod = await import('/src/gopang/ai/expert-session.js');
        const handled = await mod.handleExpertTag(
          '연결하겠습니다. [EXPERT: made-up-persona-xyz]',
          '테스트', null
        );
        return { ok: true, handled };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    await page.waitForTimeout(300);
    const log2 = await getOpenLog();
    const pass2 = r2.ok && r2.handled === false && log2.length === 0 && popupQueue.length === popupCountBefore2;
    record(2, 'EXPERT 태그 — 미등록 ID', pass2, `handled=${r2.handled}, openLog=${JSON.stringify(log2)}, 새 팝업=${popupQueue.length - popupCountBefore2}건`);

    // ── #3: EXPERT 태그 — 상위(비-리프) ID (참고용, 결정론적 단정 안 함) ──
    await clearOpenLog();
    const popupCountBefore3 = popupQueue.length;
    const r3 = await page.evaluate(async () => {
      try {
        const mod = await import('/src/gopang/ai/expert-session.js');
        const handled = await mod.handleExpertTag(
          '연결하겠습니다. [EXPERT: lawyer]',
          '계약서 검토해줘', null
        );
        return { ok: true, handled };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    await page.waitForTimeout(1500);
    const log3 = await getOpenLog();
    let url3 = null;
    if (popupQueue.length > popupCountBefore3) {
      const p3 = popupQueue[popupQueue.length - 1];
      try { await p3.waitForURL(/expert-chat\.html/, { timeout: 4000 }); } catch {}
      url3 = p3.url();
      await p3.close().catch(() => {});
    }
    record(3, 'EXPERT 태그 — 상위(비-리프) ID', null,
      `handled=${r3.handled}, openLog=${JSON.stringify(log3)}, finalUrl=${url3} — 게이트 성공(리프로 정밀화)/실패(폴백) 둘 다 허용, 참고용`);

    // ── #4: GWP 태그 — 정상 서비스(klaw) ─────────────────────────
    await clearOpenLog();
    const r4 = await page.evaluate(async ({ userText }) => {
      try {
        const mod = await import('/src/gopang/ai/call-ai.js');
        mod._parseAgentTags('상담을 시작하겠습니다. [GWP: klaw]', null, userText, null);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    }, { userText: '이혼 소송 판결문 뽑아줘' });
    await page.waitForTimeout(500);
    const log4 = await getOpenLog();
    const popup4 = popupQueue[popupQueue.length - 1];
    let url4 = null;
    if (popup4) { try { await popup4.waitForURL(/klaw\.hondi\.net/, { timeout: 4000 }); url4 = popup4.url(); await popup4.close(); } catch { url4 = popup4.url(); } }
    const pass4 = r4.ok && log4.length === 1 && !log4[0].blocked && !!url4 && /klaw\.hondi\.net\/webapp\.html/.test(url4);
    record(4, 'GWP 태그 — 정상 서비스(klaw)', pass4, `openLog=${JSON.stringify(log4)}, finalUrl=${url4} (0016 패치 없으면 반드시 FAIL해야 함)`);

    // ── #5: GWP 태그 — 미등록 서비스 ──────────────────────────────
    await clearOpenLog();
    const popupCountBefore5 = popupQueue.length;
    const r5 = await page.evaluate(async ({ userText }) => {
      try {
        const mod = await import('/src/gopang/ai/call-ai.js');
        mod._parseAgentTags('연결하겠습니다. [GWP: made-up-service-xyz]', null, userText, null);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    }, { userText: '테스트' });
    await page.waitForTimeout(300);
    const log5 = await getOpenLog();
    const pass5 = r5.ok && log5.length === 0 && popupQueue.length === popupCountBefore5;
    record(5, 'GWP 태그 — 미등록 서비스', pass5, `openLog=${JSON.stringify(log5)}, 새 팝업=${popupQueue.length - popupCountBefore5}건`);

    // ── #6: GOV_TASK + EXPERT + GWP 동시 등장 ────────────────────
    await clearOpenLog();
    const combinedReply = '민원을 접수하겠습니다. [GOV_TASK_SCHEMA_LOOKUP: task=test] ' +
      '전문가를 연결하겠습니다. [EXPERT: judicial-scrivener] ' +
      '관련 서비스도 안내합니다. [GWP: klaw]';
    const r6 = await page.evaluate(async ({ reply, userText }) => {
      const out = { govTask: null, expert: null, gwp: null };
      try {
        const callAiMod = await import('/src/gopang/ai/call-ai.js');
        const expertMod = await import('/src/gopang/ai/expert-session.js');
        // _handleGovTaskTags는 sendFn 콜백을 요구하므로 no-op으로 넘긴다
        // (여기서 실제 재귀 전송까지 검증하려는 게 아니라, 3개 핸들러가
        // 서로 예외 없이 공존하는지가 이 시나리오의 목적).
        try {
          await callAiMod._handleGovTaskTags(reply, null, async () => {}, userText, []);
          out.govTask = 'no-throw';
        } catch (e) { out.govTask = 'threw:' + e.message; }
        try {
          out.expert = await expertMod.handleExpertTag(reply, userText, null);
        } catch (e) { out.expert = 'threw:' + e.message; }
        try {
          callAiMod._parseAgentTags(reply, null, userText, null);
          out.gwp = 'no-throw';
        } catch (e) { out.gwp = 'threw:' + e.message; }
      } catch (e) { out.setupError = e.message; }
      return out;
    }, { reply: combinedReply, userText: '테스트 통합 시나리오' });
    await page.waitForTimeout(1000);
    const log6 = await getOpenLog();
    const pass6 = r6.govTask === 'no-throw' && r6.expert === true && r6.gwp === 'no-throw' && log6.length === 2;
    record(6, 'GOV_TASK+EXPERT+GWP 동시 등장', pass6, `결과=${JSON.stringify(r6)}, openLog건수=${log6.length}(기대 2 — EXPERT 1 + GWP 1)`);
    // 이번엔 두 개 팝업이 새로 열렸을 것 — 정리.
    while (popupQueue.length && !popupQueue[popupQueue.length - 1].isClosed?.()) {
      const p = popupQueue.pop();
      await p.close().catch(() => {});
    }

    console.log();
    console.log('='.repeat(60));
    console.log('요약');
    console.log('='.repeat(60));
    const definite = results.filter(r => r.pass !== null);
    const passed = definite.filter(r => r.pass).length;
    console.log(`${passed}/${definite.length} 통과 (참고용 #3 제외)`);
    definite.filter(r => !r.pass).forEach(r => console.log(`  실패: #${r.id} ${r.name}`));

    console.log();
    console.log('메인 페이지 콘솔(마지막 20줄):');
    mainConsole.slice(-20).forEach(l => console.log('  ' + l));

  } catch (e) {
    console.log(`[FAIL] 스크립트 실행 중 예상치 못한 예외: ${e.message}`);
    console.log(e.stack);
  } finally {
    await browser.close();
  }
})();
