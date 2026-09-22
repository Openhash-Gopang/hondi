#!/usr/bin/env node
/**
 * pricing_unification_live_smoketest_20260923.mjs
 *
 * 목적: fix/unify-usage-based-pricing PR(#424, main 머지 완료)이 실제
 * 배포(wrangler deploy)에 반영됐는지 확인. 세 가지를 검증한다.
 *   ① 폐지된 요금제 엔드포인트 4개가 더 이상 응답하지 않는지(404)
 *   ② 남겨둔 무제한 스텁(professor-usage)이 여전히 정상 동작하는지
 *   ③ 저잔고 알림 문턱값이 1,000T로 실제 반영됐는지, --guid로 넘긴
 *      계정(예: 주피터 본인)의 잔액이 "부족"으로 오판되지 않는지
 *
 * 이 스크립트가 자동화하는 부분: 위 세 가지 전부 — 순수 HTTP 호출이라
 * 로그인 세션이나 서명이 필요 없다(단, ③은 --guid 없이는 건너뜀).
 *
 * 이 스크립트가 자동화하지 "못하는" 부분(사람이 직접 확인해야 함):
 *   - POST /user/gdc-balance(전화번호 조회)의 응답에서 subscribed/tier/
 *     tier_name/renews_at 필드가 사라졌는지 — phone_verify_token 서명이
 *     필요해 이 스크립트가 대신 만들 수 없다. 앱에서 실제 로그인 후
 *     개발자 도구 Network 탭으로 확인해 주세요.
 *   - expert-chat.html을 실제로 열었을 때 결제 안내 없이 바로 대화가
 *     시작되는지(특히 전에 정지 알림을 받았던 physician 페르소나로).
 *   - 새 계정 가입 시 100T가 실제로 지급되는지(SIGNUP_BONUS_KRW는 이번
 *     변경 대상이 아니었지만, 배포 전체가 깨지지 않았는지 겸사겸사 확인
 *     권장).
 *
 * ⚠️ 먼저 배포부터: wrangler deploy(또는 CI)로 main의 worker.js가 실제
 * hondi-proxy에 올라가 있어야 ①②③이 전부 통과합니다. 배포 전이면
 * ①②는 여전히 옛 동작(200)이 나오고 ③은 문턱값이 20으로 남아있을 수
 * 있습니다 — 그것도 "배포 안 됐다"는 유의미한 신호이니 그대로 읽으세요.
 *
 * 사용법:
 *   node pricing_unification_live_smoketest_20260923.mjs --guid=<본인 guid>
 *   node pricing_unification_live_smoketest_20260923.mjs   (guid 없이 ①②만)
 *
 * 옵션:
 *   --guid=...     선택. 있으면 ③(저잔고 알림 문턱값 + 잔액 오판 여부)도 실행.
 *   --worker=...   기본값 https://hondi-proxy.tensor-city.workers.dev
 */

'use strict';

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || true];
  })
);

const WORKER = args.worker || 'https://hondi-proxy.tensor-city.workers.dev';
const GUID = args.guid || null;

let pass = 0;
let fail = 0;
let skip = 0;

function ok(label, detail = '') {
  pass++;
  console.log(`  [PASS] ${label}${detail ? ' — ' + detail : ''}`);
}
function bad(label, detail = '') {
  fail++;
  console.log(`  [FAIL] ${label}${detail ? ' — ' + detail : ''}`);
}
function skipped(label, reason) {
  skip++;
  console.log(`  [SKIP] ${label} — ${reason}`);
}
function section(title) {
  console.log();
  console.log('='.repeat(60));
  console.log(title);
  console.log('='.repeat(60));
}

async function req(path, opts = {}) {
  const res = await fetch(`${WORKER}${path}`, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* 본문이 JSON이 아닐 수 있음(404 HTML 등) */ }
  return { status: res.status, data };
}

async function main() {
  console.log(`대상 Worker: ${WORKER}`);
  console.log(`테스트 계정 guid: ${GUID || '(미지정 — ③ 건너뜀)'}`);

  // ── ① 폐지된 요금제 엔드포인트가 실제로 사라졌는지 ──────────────
  section('① 폐지된 라우트 4개 — 404(또는 최소한 200이 아님) 확인');

  {
    const { status } = await req('/subscription/status?guid=smoketest-dummy');
    if (status === 200) bad('GET /subscription/status', `아직 200 응답 — 배포 안 됐거나 라우트가 남아있음`);
    else ok('GET /subscription/status', `status=${status} (제거 확인)`);
  }
  {
    const { status } = await req('/subscription/subscribe', { method: 'POST', body: { guid: 'smoketest-dummy', tier: 'citizen' } });
    if (status === 200) bad('POST /subscription/subscribe', `아직 200 응답`);
    else ok('POST /subscription/subscribe', `status=${status} (제거 확인)`);
  }
  {
    const { status } = await req('/expert-persona/access?guid=smoketest-dummy&personaId=physician');
    if (status === 200) bad('GET /expert-persona/access', `아직 200 응답 — physician 등 리프 구독 게이트가 살아있음`);
    else ok('GET /expert-persona/access', `status=${status} (제거 확인)`);
  }
  {
    const { status } = await req('/expert-persona/resubscribe', { method: 'POST', body: { guid: 'smoketest-dummy', personaId: 'physician' } });
    if (status === 200) bad('POST /expert-persona/resubscribe', `아직 200 응답`);
    else ok('POST /expert-persona/resubscribe', `status=${status} (제거 확인)`);
  }

  // ── ② 남겨둔 무제한 스텁이 여전히 정상인지 ─────────────────────
  section('② professor-usage 스텁 — 여전히 unlimited:true 반환하는지');

  {
    const { status, data } = await req('/subscription/professor-usage?guid=smoketest-dummy');
    if (status === 200 && data?.unlimited === true && data?.allowed === true) {
      ok('GET /subscription/professor-usage', 'unlimited:true, allowed:true');
    } else {
      bad('GET /subscription/professor-usage', `status=${status}, body=${JSON.stringify(data)}`);
    }
  }

  // ── ③ 저잔고 알림 문턱값 1,000T + 잔액 오판 여부 (guid 필요) ────
  section('③ 저잔고 알림 문턱값(1,000T) 및 잔액 상태');

  if (!GUID) {
    skipped('GET /biz/balance-status', '--guid=... 를 지정하지 않아 건너뜀');
  } else {
    const { status, data } = await req(`/biz/balance-status?guid=${encodeURIComponent(GUID)}`);
    if (status !== 200 || !data) {
      bad('GET /biz/balance-status', `status=${status}, body=${JSON.stringify(data)}`);
    } else {
      if (data.low_balance_threshold_krw === 1000) {
        ok('저잔고 문턱값', `low_balance_threshold_krw=${data.low_balance_threshold_krw}`);
      } else {
        bad('저잔고 문턱값', `기대값 1000, 실제 ${data.low_balance_threshold_krw} — 배포 반영 안 됐을 가능성`);
      }
      console.log(`         잔액: ${data.balance_gdc} GDC (${data.balance_krw}원 상당), is_low_balance=${data.is_low_balance}`);
      if (data.balance_gdc >= 1000 && data.is_low_balance === true) {
        bad('잔액 오판 여부', `잔액이 1,000T 이상인데 is_low_balance=true로 나옴 — 이번 알림 오류의 재발 가능성`);
      } else if (data.balance_gdc >= 1000) {
        ok('잔액 오판 여부', '잔액 충분 & is_low_balance=false — 정상');
      } else {
        console.log('         (잔액이 1,000T 미만이라 is_low_balance 판정은 정상 케이스와 무관)');
      }
    }
  }

  // ── 결과 요약 ────────────────────────────────────────────────
  section('결과 요약');
  console.log(`  PASS ${pass} / FAIL ${fail} / SKIP ${skip}`);
  if (fail > 0) {
    console.log('\n  하나 이상 실패 — 배포가 아직 반영 안 됐을 가능성이 가장 큽니다.');
    console.log('  wrangler deploy(또는 배포 파이프라인) 실행 여부부터 확인해 주세요.');
    process.exit(1);
  } else {
    console.log('\n  자동화된 항목은 전부 통과했습니다.');
    console.log('  위 "이 스크립트가 자동화하지 못하는 부분" 세 가지는 직접 확인해 주세요.');
  }
}

main().catch(e => {
  console.error('\n[FATAL]', e.message);
  process.exit(1);
});
