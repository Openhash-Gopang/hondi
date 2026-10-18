/**
 * "현관문 하나" 통합 게이트 라이브 검증
 * 2026-09-17
 *
 * 0021과의 차이: gov도 이제 MANDATORY_AUTH_PATHS에 들어가서
 * phone_verify_token이 필수가 됐다(더 이상 --guid만으론 안 통과).
 * 메인 채팅(chat/completions)도 같은 이유로 새로 추가.
 *
 * klaw/kplan/gov/메인채팅 4곳은 전부 같은 사용자면 같은 토큰 하나로
 * 다 통과해야 한다 — 이게 "현관문 하나"의 핵심 검증 포인트다(과거엔
 * 서비스마다 다른 인증이 필요했는데, 이제는 로그인 한 번으로 전부
 * 통과되는지가 관건). business는 아직 게이트 밖이라 별도(--guid만).
 *
 * 실행:
 *   node hondi_front_door_live_test_20260917.cjs --token <phone_verify_token> [--guid <business용 guid>] [--only gov|klaw|kplan|chat|business]
 */
const WORKER_BASE = 'https://hondi-proxy.tensor-city.workers.dev';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) { out[args[i].slice(2)] = args[i + 1]; i++; }
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
    const text = await res.text();
    console.log(`[HTTP ${res.status}] ${elapsed}s`);
    if (res.status === 200) {
      console.log(`본문 길이: ${text.length}자`);
      console.log(`[PASS] wrangler tail에서 확인: "tag":"${requestTag}" 그리고 "tag":"AI_EMPTY_COMPLETION_DIAG"`);
    } else {
      console.log(`본문: ${text.slice(0, 300)}`);
      console.log('[FAIL] 200 아님');
    }
  } catch (e) {
    console.log(`[FAIL] 요청 자체 실패: ${e.message}`);
  }
}

(async () => {
  const args = parseArgs();
  const token = args['token'] || null;
  const guid = args['guid'] || null;
  const only = args['only'] || null;

  console.log('사전 확인: `npx wrangler tail hondi-proxy` 실행 중이어야 합니다.');
  console.log(`공용 토큰(klaw/kplan/gov/메인채팅용): ${token ? '제공됨' : '없음 — 이 4개는 전부 401로 막혀야 정상'}`);
  console.log(`business용 guid: ${guid || '없음 — 임의 guid 사용'}`);
  if (only) console.log(`--only=${only}`);

  const testMessages = [
    { role: 'system', content: 'You are a test harness call. Reply with exactly one short sentence.' },
    { role: 'user', content: '이 요청은 현관문 하나 게이트 라이브 스모크테스트입니다. 짧게 한 문장으로만 답하세요.' },
  ];

  if (!only || only === 'gov') {
    await callRelay({
      label: '① GOV', path: '/gov/relay', origin: 'https://hondi.net', requestTag: 'GOV_RELAY_CALL',
      body: { phone_verify_token: token, agency: 'public', messages: testMessages, max_tokens: 40, stream: true },
    });
  }

  if (!only || only === 'klaw') {
    await callRelay({
      label: '② KLAW', path: '/klaw/relay', origin: 'https://klaw.hondi.net', requestTag: 'KLAW_RELAY_CALL',
      body: { phone_verify_token: token, tier: 'klaw-flash', messages: testMessages, max_tokens: 40, stream: true },
    });
  }

  if (!only || only === 'kplan') {
    await callRelay({
      label: '③ KPLAN', path: '/kplan/relay', origin: 'https://hondi.net', requestTag: 'KPLAN_RELAY_CALL',
      body: { phone_verify_token: token, tier: 'kplan-flash', messages: testMessages, max_tokens: 40, stream: true },
    });
  }

  if (!only || only === 'chat') {
    await callRelay({
      label: '④ 메인채팅(chat/completions)', path: '/chat/completions', origin: 'https://hondi.net', requestTag: '(메인채팅 — 별도 요청태그 없음)',
      body: { phone_verify_token: token, messages: testMessages, max_tokens: 40, stream: true },
    });
  }

  if (!only || only === 'business') {
    await callRelay({
      label: '⑤ BUSINESS(아직 게이트 밖, --guid만)', path: '/business/relay', origin: 'https://market.hondi.net', requestTag: 'BUSINESS_RELAY_CALL',
      body: { guid: guid || `smoketest-biz-${Date.now()}`, messages: testMessages, max_tokens: 40, stream: true },
    });
  }

  console.log();
  console.log('완료.');
})();
