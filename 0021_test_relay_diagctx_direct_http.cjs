/**
 * 시나리오 #9/#10 — klaw/kplan/business/gov relay diagCtx 라이브 검증 (v3, 직접 HTTP)
 * 2026-09-17
 *
 * tests/live_smoketest/klaw_billing_live_smoketest.py와 동일한 패턴 —
 * 브라우저 없이 worker.js(hondi-proxy) 엔드포인트를 직접 HTTP POST로
 * 호출한다. Origin 헤더만 각 서비스 도메인에 맞게 세팅(worker.js
 * ALLOWED_ORIGINS 검증 통과용).
 *
 * 인증 요구사항이 서비스마다 달라(worker.js 직접 대조 확인):
 *   - gov, business: guid는 클라이언트 자칭 문자열이 그대로 통과함
 *     (access_cert 없이도 일반 대화는 정상 동작) — 토큰 불필요
 *   - klaw, kplan: phone_verify_token이 없으면 즉시 차단(스트리밍/
 *     diagCtx 경로까지 못 감) — 실제 로그인해서 얻은 토큰 필요
 *
 * klaw/kplan용 토큰 얻는 법: 브라우저에서 로그인 후 devtools Network
 * 탭에서 /klaw/relay 또는 k-service-auth 관련 요청의 body를 보면
 * phone_verify_token 필드가 있음. 없으면 해당 서비스는 자동으로
 * SKIPPED 처리된다(klaw_billing_live_smoketest.py의 --funded-guid
 * 미지정 시 동작과 동일한 원칙).
 *
 * 실행:
 *   node 0021_test_relay_diagctx_direct_http.cjs \
 *     [--klaw-token <phone_verify_token>] [--kplan-token <phone_verify_token>]
 *
 * 토큰이 klaw/kplan 둘 다 같은 계정이면 --token 하나로 둘 다 채워도 됨:
 *   node 0021_test_relay_diagctx_direct_http.cjs --token <phone_verify_token>
 */
const WORKER_BASE = 'https://hondi-proxy.tensor-city.workers.dev';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      out[key] = args[i + 1];
      i++;
    }
  }
  return out;
}

async function callRelay({ label, path, origin, body, requestTag }) {
  console.log();
  console.log('='.repeat(70));
  console.log(`${label} — POST ${WORKER_BASE}${path}`);
  console.log('='.repeat(70));
  const t0 = Date.now();
  try {
    const res = await fetch(`${WORKER_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': origin },
      body: JSON.stringify(body),
    });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    // stream 응답이므로 본문은 SSE 청크 — 상태코드/헤더만 확인하고
    // 본문은 앞부분만 살짝 읽어서 에러 여부만 판단한다(diagCtx 로그
    // 확인은 wrangler tail 몫).
    const text = await res.text();
    console.log(`[HTTP ${res.status}] ${elapsed}s`);
    if (res.status !== 200) {
      console.log(`본문(앞부분): ${text.slice(0, 300)}`);
      console.log('[FAIL] 200이 아님 — diagCtx 경로(스트리밍)까지 못 갔을 가능성 높음. 위 본문에서 에러 코드 확인.');
    } else {
      console.log(`본문 길이: ${text.length}자 (스트리밍 SSE 청크)`);
      console.log(`[PASS] 200 응답 — wrangler tail에서 확인: "tag":"${requestTag}" 그리고 "tag":"AI_EMPTY_COMPLETION_DIAG"`);
    }
  } catch (e) {
    console.log(`[FAIL] 요청 자체 실패: ${e.message}`);
  }
}

(async () => {
  const args = parseArgs();
  const klawToken = args['klaw-token'] || args['token'] || null;
  const kplanToken = args['kplan-token'] || args['token'] || null;

  console.log('사전 확인: 다른 터미널에서 `npx wrangler tail hondi-proxy` 실행 중이어야 합니다.');
  console.log(`klaw 토큰: ${klawToken ? '제공됨' : '없음 — SKIP 예정'}`);
  console.log(`kplan 토큰: ${kplanToken ? '제공됨' : '없음 — SKIP 예정'}`);

  // ── GOV — 인증 불필요 ──────────────────────────────────────────
  await callRelay({
    label: '① GOV',
    path: '/gov/relay',
    origin: 'https://hondi.net',
    requestTag: 'GOV_RELAY_CALL',
    body: {
      guid: `smoketest-gov-${Date.now()}`,
      agency: 'public',
      messages: [
        { role: 'system', content: 'You are a test harness call. Reply with exactly one short sentence.' },
        { role: 'user', content: '이 요청은 diagCtx 라이브 스모크테스트입니다. 짧게 한 문장으로만 답하세요.' },
      ],
      max_tokens: 40,
      stream: true,
    },
  });

  // ── BUSINESS — 인증 불필요 ─────────────────────────────────────
  await callRelay({
    label: '② BUSINESS',
    path: '/business/relay',
    origin: 'https://market.hondi.net',
    requestTag: 'BUSINESS_RELAY_CALL',
    body: {
      guid: `smoketest-biz-${Date.now()}`,
      messages: [
        { role: 'system', content: 'You are a test harness call. Reply with exactly one short sentence.' },
        { role: 'user', content: '이 요청은 diagCtx 라이브 스모크테스트입니다. 짧게 한 문장으로만 답하세요.' },
      ],
      max_tokens: 40,
      stream: true,
    },
  });

  // ── KLAW — phone_verify_token 필요 ─────────────────────────────
  if (klawToken) {
    await callRelay({
      label: '③ KLAW',
      path: '/klaw/relay',
      origin: 'https://klaw.hondi.net',
      requestTag: 'KLAW_RELAY_CALL',
      body: {
        phone_verify_token: klawToken,
        tier: 'klaw-flash',
        messages: [
          { role: 'system', content: 'You are a test harness call. Reply with exactly one short sentence.' },
          { role: 'user', content: '이 요청은 diagCtx 라이브 스모크테스트입니다. 짧게 한 문장으로만 답하세요.' },
        ],
        max_tokens: 40,
        stream: true,
      },
    });
  } else {
    console.log();
    console.log('[SKIPPED] ③ KLAW — --klaw-token 또는 --token 미지정');
  }

  // ── KPLAN — phone_verify_token 필요 ────────────────────────────
  if (kplanToken) {
    await callRelay({
      label: '④ KPLAN',
      path: '/kplan/relay',
      origin: 'https://hondi.net',
      requestTag: 'KPLAN_RELAY_CALL',
      body: {
        phone_verify_token: kplanToken,
        tier: 'kplan-flash',
        messages: [
          { role: 'system', content: 'You are a test harness call. Reply with exactly one short sentence.' },
          { role: 'user', content: '이 요청은 diagCtx 라이브 스모크테스트입니다. 짧게 한 문장으로만 답하세요.' },
        ],
        max_tokens: 40,
        stream: true,
      },
    });
  } else {
    console.log();
    console.log('[SKIPPED] ④ KPLAN — --kplan-token 또는 --token 미지정');
  }

  console.log();
  console.log('='.repeat(70));
  console.log('완료 — wrangler tail 터미널에서 각 서비스별 AI_EMPTY_COMPLETION_DIAG 확인');
  console.log('='.repeat(70));
})();
