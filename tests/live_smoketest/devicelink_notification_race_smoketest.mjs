#!/usr/bin/env node
/**
 * devicelink_notification_race_smoketest.mjs
 *
 * 목적: "크롬 요청을 폰이 승인한 뒤, Edge가 보낸 두 번째 device-link
 * 요청의 알림을 열어도 device-link-approve.html이 아니라 이미 열려있던
 * webapp.html이 보인다"는 증상을 재현하기 위한 스크립트.
 *
 * 이 스크립트가 자동화하는 부분: 실제 라이브 Worker의 /auth/device-link/init을
 * 10초 간격으로 두 번 자동 호출해, 실제 브라우저 두 개를 여는 것과 동일한
 * 모양의 진짜 웹푸시 두 건을 발생시킨다. worker.js가 각 호출마다 새
 * sessionId·새 알림 tag(gopang-device-link-{sessionId})·새 url
 * (device-link-approve.html)을 만드는 걸 코드로 확인했으므로, 이렇게 만든
 * 요청도 실제 브라우저로 만든 요청과 동일한 모양의 푸시가 나간다.
 *
 * 판정 기준(사람이 직접 관찰): 두 알림을 각각 탭했을 때 "매번 새로
 * 본인 확인 팝업(device-link-approve.html)이 뜨면" 성공 — 두 번째 알림을
 * 탭했는데 이미 열려있던 화면만 보이고 새 팝업이 안 뜨면 버그 재현.
 *
 * 이 스크립트가 자동화하지 못하는 부분(사람이 직접 해야 함): 폰에서 알림을
 * 실제로 탭하는 것, 화면에 팝업이 새로 떴는지 눈으로 확인하는 것.
 * 필요하면 chrome://inspect로 원격 DevTools 콘솔을 열어 sw.js의 진단 로그
 * (0001-diag-device-link-openWindow.patch 적용분)도 함께 확인할 수 있다.
 *
 * 사용법:
 *   node devicelink_notification_race_smoketest.mjs --e164=01096627170
 *   (국내 휴대폰 뒷 8자리만 줘도 된다: --e164=96627170)
 *
 * 옵션:
 *   --e164=...        필수. 폰에 등록된 전화번호(뒷 8자리만 줘도 됨)
 *   --label1=...       기본값 'Chrome(테스트)'
 *   --label2=...       기본값 'Edge(테스트)'
 *   --interval=...     두 요청 사이 대기 시간(초). 기본값 10
 *   --purpose=...       기본값 'key_transfer' (다른 값: sign_request — 이 경우 --sigMsg 필요)
 *   --sigMsg=...       purpose=sign_request일 때만 사용
 *
 * 종료 코드: 요청 두 건 모두 pushSentToMobile:true면 0, 아니면 1.
 * (알림을 탭했을 때 팝업이 새로 떴는지 자체는 사람이 눈으로 판정 —
 * 서버 응답만으로는 클라이언트 화면 상태를 알 수 없다.)
 *
 * ★ 이전 버전과의 차이: stdin으로 "Enter를 눌러 계속"을 기다리던 방식을
 * 없앴다 — Windows에서 process.stdin.resume()/pause() 이후 process.exit()를
 * 호출하면 libuv 어설션 실패("UV_HANDLE_CLOSING")로 터미널이 죽는 문제가
 * 실사로 재현됐다. 대신 고정된 --interval초 자동 대기로 바꿔 stdin을 아예
 * 건드리지 않는다.
 */

const PROXY = 'https://hondi-proxy.tensor-city.workers.dev';

function parseArgs() {
  const out = {};
  for (const a of process.argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function initDeviceLink({ e164, pcLabel, purpose, sigMsg }) {
  const body = { e164, pcLabel, purpose };
  if (purpose === 'sign_request') body.sigMsg = sigMsg;
  const res = await fetch(`${PROXY}/auth/device-link/init`, {
    method: 'POST',
    // 브라우저에서 온 요청인 척해야 worker.js의 Origin 검사를 통과한다
    // (live-gov-router-smoketest.mjs와 동일한 이유 — 이건 우회가 아니라
    // 실제 프로덕션 화면과 같은 조건을 만들기 위한 진단용 헤더).
    headers: { 'Content-Type': 'application/json', 'Origin': 'https://hondi.net' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function main() {
  const args = parseArgs();
  if (!args.e164) {
    console.error('사용법: node devicelink_notification_race_smoketest.mjs --e164=01096627170 (또는 뒷 8자리만: --e164=96627170)');
    process.exitCode = 2;
    return;
  }
  const purpose = args.purpose || 'key_transfer';
  const label1 = args.label1 || 'Chrome(테스트)';
  const label2 = args.label2 || 'Edge(테스트)';
  const intervalSec = Number(args.interval || 10);

  console.log('══════════════════════════════════════════════════════');
  console.log(' device-link 알림 경합 재현 스모크테스트');
  console.log('══════════════════════════════════════════════════════');
  console.log('사전 준비: 폰을 손에 들고 알림을 바로 탭할 준비를 하세요.');
  console.log(`요청 1건 발송 → ${intervalSec}초 대기 → 요청 2건째 발송 순으로 자동 진행됩니다.`);
  console.log('(chrome://inspect로 원격 콘솔을 열어두면 진단 로그도 함께 볼 수 있습니다.)\n');

  console.log(`[1/2] "${label1}" 요청 발송 중...`);
  const r1 = await initDeviceLink({ e164: args.e164, pcLabel: label1, purpose, sigMsg: args.sigMsg });
  if (r1.status !== 200 || !r1.data?.ok) {
    console.error('요청 실패:', r1.status, r1.data);
    process.exitCode = 1;
    return;
  }
  console.log('  sessionId:', r1.data.sessionId, '| pushSentToMobile:', r1.data.pushSentToMobile);
  console.log('  → 지금 폰에 온 알림을 탭해서 팝업이 뜨는지 확인하세요.');

  console.log(`\n${intervalSec}초 대기 중...`);
  await sleep(intervalSec * 1000);

  console.log(`\n[2/2] "${label2}" 요청 발송 중...`);
  const r2 = await initDeviceLink({ e164: args.e164, pcLabel: label2, purpose, sigMsg: args.sigMsg });
  if (r2.status !== 200 || !r2.data?.ok) {
    console.error('요청 실패:', r2.status, r2.data);
    process.exitCode = 1;
    return;
  }
  console.log('  sessionId:', r2.data.sessionId, '| pushSentToMobile:', r2.data.pushSentToMobile);

  console.log('\n──────────────────────────────────────────────────────');
  console.log(`지금 폰에 온 "${label2}" 알림을 "탭"해서 여세요(앱 아이콘을 직접`);
  console.log('누르지 마세요 — start_url로 열려 변수가 섞입니다).');
  console.log('판정 기준:');
  console.log(`  ✅ 성공 — "본인이 맞습니다" 확인 팝업이 이번에도 새로 떴다`);
  console.log(`  ❌ 버그 재현 — 새 팝업 없이 이전 화면(또는 webapp.html)만 보인다`);
  console.log('──────────────────────────────────────────────────────');

  if (!r1.data.pushSentToMobile || !r2.data.pushSentToMobile) {
    console.warn('\n⚠ 둘 중 하나 이상 pushSentToMobile:false — 애초에 폰에 알림이');
    console.warn('  안 갔을 수 있습니다(구독 만료 등). 재현 시도 전에 먼저 확인하세요.');
    process.exitCode = 1;
    return;
  }
  console.log('\n두 요청 모두 폰으로 정상 발송됨. 팝업이 떴는지 여부는 직접 판정해 알려주세요.');
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
