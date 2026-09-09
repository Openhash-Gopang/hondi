#!/usr/bin/env node
/**
 * devicelink_notification_race_smoketest.mjs
 *
 * 목적: "크롬 요청을 폰이 승인한 뒤, Edge가 보낸 두 번째 device-link
 * 요청의 알림을 열어도 device-link-approve.html이 아니라 이미 열려있던
 * webapp.html이 보인다"는 증상을 재현하기 위한 스크립트.
 *
 * 이 스크립트가 자동화하는 부분: PC에서 실제로 Chrome·Edge 두 브라우저를
 * 열어 로그인 화면에서 전화번호를 입력하는 대신, 실제 라이브 Worker의
 * /auth/device-link/init을 순서대로 두 번 직접 호출해 정확히 같은 두 개의
 * 실제 웹푸시를 발생시킨다. worker.js가 각 호출마다 새 sessionId·새 알림
 * tag(gopang-device-link-{sessionId})·새 url(device-link-approve.html)을
 * 만드는 걸 앞서 코드로 확인했으므로, 이 스크립트로 만든 요청도 실제
 * 브라우저로 만든 요청과 동일한 모양의 푸시가 나간다.
 *
 * 이 스크립트가 자동화하지 못하는 부분(사람이 직접 해야 함): 폰에서 알림을
 * 실제로 탭하는 것, chrome://inspect로 원격 DevTools 콘솔을 열어 sw.js의
 * 진단 로그(0001-diag-device-link-openWindow.patch 적용분)를 눈으로
 * 확인하는 것. 이건 실제 안드로이드 알림 트레이·PWA 창 상태·원격 디버깅
 * 콘솔 출력이 필요한 물리적 관찰이라 로컬 스크립트로 대신할 수 없다
 * (tests/live_smoketest의 기존 스크립트들은 전부 텍스트 요청→AI 응답
 * 태그 대조라 서버 왕복만으로 채점 가능했지만, 이 버그는 클라이언트
 * 쪽 UI/알림 상태 자체가 검증 대상이라 성격이 다르다).
 *
 * 사용법:
 *   node devicelink_notification_race_smoketest.mjs --e164=+8210XXXXXXXX
 *
 * 옵션:
 *   --e164=...        필수. 폰에 등록된 전화번호(국제형식, E.164)
 *   --label1=...       기본값 'Chrome(테스트)'
 *   --label2=...       기본값 'Edge(테스트)'
 *   --purpose=...       기본값 'key_transfer' (다른 값: sign_request — 이 경우 --sigMsg 필요)
 *   --sigMsg=...       purpose=sign_request일 때만 사용
 *
 * 종료 코드: 요청 두 건 모두 pushSentToMobile:true면 0, 아니면 1
 * (사람이 직접 관찰해야 하는 판정 자체는 이 스크립트가 대신 채점하지
 * 않는다 — 위 README.md의 REVIEW 관례와 동일하게, 최종 PASS/FAIL은
 * 콘솔 로그를 본 사람이 판단한다).
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

function pause(promptText) {
  return new Promise((resolve) => {
    process.stdout.write('\n' + promptText + ' (Enter 키를 누르면 계속) ');
    process.stdin.resume();
    process.stdin.once('data', () => { process.stdin.pause(); resolve(); });
  });
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
    console.error('사용법: node devicelink_notification_race_smoketest.mjs --e164=+8210XXXXXXXX');
    process.exit(2);
  }
  const purpose = args.purpose || 'key_transfer';
  const label1 = args.label1 || 'Chrome(테스트)';
  const label2 = args.label2 || 'Edge(테스트)';

  console.log('══════════════════════════════════════════════════════');
  console.log(' device-link 알림 경합 재현 스모크테스트');
  console.log('══════════════════════════════════════════════════════');
  console.log('사전 준비 체크리스트:');
  console.log('  [ ] 폰을 PC에 USB로 연결하고 chrome://inspect에서 혼디 PWA의');
  console.log('      Service Worker 콘솔을 열어둔 상태인가?');
  console.log('  [ ] 0001-diag-device-link-openWindow.patch가 이미 배포됐고,');
  console.log('      폰에서 새 sw.js로 갱신됐는지 확인했는가?');
  console.log('  [ ] --e164에 넣은 번호가 실제로 이 폰에 등록된 계정인가?');
  await pause('준비되셨으면');

  console.log(`\n[1/2] "${label1}" 요청 발송 중...`);
  const r1 = await initDeviceLink({ e164: args.e164, pcLabel: label1, purpose, sigMsg: args.sigMsg });
  if (r1.status !== 200 || !r1.data?.ok) {
    console.error('요청 실패:', r1.status, r1.data);
    process.exit(1);
  }
  console.log('  sessionId:', r1.data.sessionId);
  console.log('  pushSentToMobile:', r1.data.pushSentToMobile);
  console.log('  approveUrl (참고용, 알림 대신 직접 열어볼 때):');
  console.log('   https://hondi.net/auth/device-link-approve.html?sessionId=' + r1.data.sessionId);

  await pause(`\n지금 폰에 온 "${label1}" 알림을 탭해서 정상적으로 승인(지문 확인까지)을 완료하세요.`);

  console.log(`\n[2/2] "${label2}" 요청 발송 중...`);
  const r2 = await initDeviceLink({ e164: args.e164, pcLabel: label2, purpose, sigMsg: args.sigMsg });
  if (r2.status !== 200 || !r2.data?.ok) {
    console.error('요청 실패:', r2.status, r2.data);
    process.exit(1);
  }
  console.log('  sessionId:', r2.data.sessionId);
  console.log('  pushSentToMobile:', r2.data.pushSentToMobile);
  console.log('  approveUrl (참고용):');
  console.log('   https://hondi.net/auth/device-link-approve.html?sessionId=' + r2.data.sessionId);

  console.log('\n──────────────────────────────────────────────────────');
  console.log(`이제 폰에 온 "${label2}" 알림을 "탭"해서 여세요(앱 아이콘을 직접`);
  console.log('누르지 마세요 — start_url로 열려 변수가 섞입니다).');
  console.log('chrome://inspect 콘솔에 찍히는 다음 로그를 그대로 기록해 두세요:');
  console.log('  - [DeviceLink diag] 요청 url: ...');
  console.log('  - [DeviceLink diag] 클릭 시점 기존 열린 창: [...]');
  console.log('  - [DeviceLink diag] openWindow 결과 url: ...');
  console.log('  - ⚠ 경고 줄이 떴는지 여부');
  console.log('──────────────────────────────────────────────────────');

  if (!r1.data.pushSentToMobile || !r2.data.pushSentToMobile) {
    console.warn('\n⚠ 둘 중 하나 이상 pushSentToMobile:false — 애초에 폰에 알림이');
    console.warn('  안 갔을 수 있습니다(구독 만료 등). 재현 시도 전에 먼저 확인하세요.');
    process.exit(1);
  }
  console.log('\n두 요청 모두 폰으로 정상 발송됨. 관찰 결과는 사람이 직접 판정합니다.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
