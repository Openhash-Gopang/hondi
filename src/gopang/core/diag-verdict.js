/**
 * core/diag-verdict.js — "진단" 입력 시 환경·서버·기록을 종합해 오류 원인을 판정한다 (2026-11-19).
 * 순수 함수라 브라우저 없이 시험할 수 있다. 판정은 세 가지 등급으로 돌려준다.
 *   원인: 알림·호출이 안 되는 직접 원인으로 볼 수 있는 것
 *   주의: 원인일 수 있으나 이것만으로는 확정할 수 없는 것
 *   정상: 확인했고 문제 없는 것
 * 입력은 diag.js 가 모은 값이다 — 이 파일은 화면·저장소를 건드리지 않는다.
 */

const last = (entries, tag) => { for (let i = entries.length - 1; i >= 0; i--) if (entries[i].tag === tag) return { e: entries[i], i }; return null; };
const val = (x, k) => (x && typeof x === 'object' ? x[k] : undefined);

// 서버가 호출 알림 발송 결과로 돌려주는 값(worker.js handleSignalSend 의 push)
const PUSH_RESULT = {
  sent:            ['정상', '서버가 상대에게 호출 알림을 보냈습니다. 상대 폰에 도착하지 않았다면 상대 폰의 알림 설정·배터리 제한을 봐야 합니다.'],
  timeout:         ['주의', '서버가 호출 알림 결과를 4초 안에 받지 못했습니다(발송은 계속됩니다). 알림이 늦게 가거나 가지 않을 수 있습니다.'],
  no_subscription: ['원인', '상대 계정에 알림을 받을 기기가 등록되어 있지 않아 호출 알림을 보내지 못했습니다. 상대가 나비웹을 열어 알림을 허용해야 합니다.'],
  config:          ['원인', '서버의 알림 설정(웹 푸시 키 또는 앱 푸시 계정)이 없거나, 상대 기기에 맞는 설정이 없어 보내지 못했습니다.'],
  failed:          ['원인', '상대 계정의 모든 기기로 호출 알림 발송이 실패했습니다. 등록된 구독이 만료됐을 가능성이 큽니다. 상대가 알림을 껐다 켜서 다시 등록해야 합니다.'],
  error:           ['원인', '서버가 호출 알림을 보내다 오류가 났습니다.'],
};

/**
 * @param {object} p
 * @param {object} p.env        diagEnv() 결과
 * @param {object|null} p.server /signal/diag 응답(조회에 실패하면 null), p.serverErr 는 실패 사유
 * @param {Array}  p.entries    diag 기록(시각순)
 * @param {string} p.localDeviceId 이 기기의 deviceId
 * @param {boolean} p.hasFcmToken 앱(FCM) 토큰을 받았는지
 */
export function diagVerdict({ env = {}, server = null, serverErr = '', entries = [], localDeviceId = '', hasFcmToken = false } = {}) {
  const out = [];
  const add = (lv, msg) => out.push({ lv, msg });
  const isApp = /APK|TWA/.test(String(env.mode || ''));

  // ── 이 기기 ──
  if (env.online === false) add('원인', '이 기기가 인터넷에 연결되어 있지 않습니다.');
  if (env.알림권한 === 'denied') add('원인', '이 기기에서 나비웹 알림이 "차단" 상태입니다. 브라우저(또는 앱) 알림 설정에서 허용으로 바꿔야 호출·메시지 알림이 옵니다.');
  else if (env.알림권한 === 'default') add('원인', '이 기기에서 알림을 아직 허용하지 않았습니다. 알림 허용 안내가 뜨면 허용해 주세요.');
  else if (env.알림권한 === '미지원') add('주의', '이 브라우저는 알림을 지원하지 않습니다.');
  else if (env.알림권한 === 'granted') add('정상', '이 기기의 알림 권한은 허용 상태입니다.');

  if (isApp && !hasFcmToken) add('원인', '앱인데 푸시 토큰(FCM)을 받지 못했습니다. 앱을 완전히 종료했다가 다시 열어 보세요. 그래도 같으면 앱을 지우고 새로 설치해야 합니다.');
  if (!isApp && env.푸시구독 === '없음' && env.알림권한 === 'granted') add('원인', '알림은 허용되어 있지만 이 기기의 푸시 구독이 없습니다. 설정에서 알림을 껐다 다시 켜 주세요.');
  if (/waiting/.test(String(env.SW || ''))) add('주의', '새 버전이 내려받아졌지만 아직 적용되지 않았습니다(낡은 코드가 실행 중일 수 있음). 앱을 완전히 닫았다 다시 여세요.');
  if (env.SW === '없음') add('주의', '서비스 워커가 없습니다. 알림 수신이 안 될 수 있습니다.');

  // ── 서버 ──
  if (!server) {
    add('주의', '서버 점검에 실패했습니다' + (serverErr ? `(${serverErr})` : '') + '. 로그인 상태나 인터넷을 확인해 주세요.');
  } else {
    if (server.l1 === 'error') add('원인', '서버가 계정 저장소에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
    else if (server.l1 === 'no_profile') add('원인', '서버에서 이 계정을 찾지 못했습니다. 가입이 끝나지 않았거나 계정이 다른 기기의 것일 수 있습니다.');
    const devs = Array.isArray(server.devices) ? server.devices : [];
    if (server.l1 === 'ok') {
      if (!devs.length) add('원인', '서버에 이 계정으로 등록된 알림 기기가 하나도 없습니다. 그래서 어떤 알림도 갈 곳이 없습니다. 알림을 허용하고 나비웹을 다시 열어 등록해 주세요.');
      else {
        add('정상', `서버에 등록된 알림 기기: ${devs.length}대(${devs.map(d => d.kind === 'fcm' ? '앱' : '웹').join('·')}).`);
        if (localDeviceId && !devs.some(d => d.id && localDeviceId.startsWith(d.id))) add('원인', '이 기기가 서버의 알림 기기 목록에 없습니다. 이 기기로는 알림이 오지 않습니다. 알림을 껐다 다시 켜서 등록해 주세요.');
      }
      if (devs.some(d => d.kind === 'webpush') && !server.vapid) add('원인', '서버에 웹 푸시 키가 설정되어 있지 않아 웹(브라우저) 기기에는 알림을 보낼 수 없습니다.');
      if (devs.some(d => d.kind === 'fcm') && !server.fcm) add('원인', '서버에 앱 푸시 계정이 설정되어 있지 않아 앱 기기에는 알림을 보낼 수 없습니다.');
      if (server.test_limited) add('주의', '시험 알림은 시간당 6번까지입니다. 잠시 뒤 다시 해 주세요.');
      for (const d of devs) {
        if (!d.test) continue;
        const who = `${d.kind === 'fcm' ? '앱' : '웹'} 기기(${d.id})`;
        if (d.test.ok) add('정상', `${who}로 시험 알림 발송 성공 — 폰에 알림이 떴는지 확인해 주세요. 발송은 성공했는데 안 보이면 폰의 알림·배터리 설정 문제입니다.`);
        else if (d.test.status === 404 || d.test.status === 410) add('원인', `${who}의 구독이 만료되었습니다(${d.test.status}). 그 기기에서 알림을 껐다 다시 켜 등록해야 합니다.`);
        else add('원인', `${who}로 시험 알림 발송이 실패했습니다(상태 ${d.test.status || '응답 없음'}).`);
      }
    }
  }

  // ── 최근 기록 ──
  const ring = last(entries, '호출:알림결과');
  if (ring) {
    const pr = String(val(ring.e.d, 'push') || '');
    const m = PUSH_RESULT[pr];
    if (m) add(m[0], `최근 호출(보낸 쪽): ${m[1]}`);
    else if (pr) add('주의', `최근 호출의 알림 결과가 알 수 없는 값입니다: ${pr}`);
  }
  const start = last(entries, '호출:시작(발신)');
  const giveUp = last(entries, '호출:무응답 포기');
  const answered = last(entries, '응답(answer) 수신');
  if (start && giveUp && giveUp.i > start.i && !(answered && answered.i > start.i)) add('주의', '최근 호출은 상대가 응답하지 않아 끝났습니다. 상대가 알림을 받지 못했거나 보고도 열지 않은 경우입니다.');

  const conn = last(entries, 'conn:요약');
  if (conn && String(val(conn.e.d, '선택경로')) === '없음') {
    add('원인', '최근 연결에서 두 기기 사이의 통신 경로를 찾지 못했습니다' + (env.TURN === '없음(STUN만)' ? '(중계 서버 없음 — 서로 다른 망에서는 연결이 안 될 수 있습니다).' : '.'));
  }

  const decide = last(entries, '수락 결정');
  const after = last(entries, '수락 후 대화창 전환');
  if (decide && after && after.i > decide.i && val(after.e.d, '상대설정됨') === false && val(decide.e.d, 'accepted')) {
    add('원인', '호출을 수락했는데 상대와의 대화창으로 바뀌지 않았습니다(상대 설정이 비어 있음). 그래서 입력이 AI 비서로 갑니다.');
  }

  if (!out.some(x => x.lv === '원인')) add('정상', '이 점검에서는 확정할 만한 원인을 찾지 못했습니다. 아래 기록과 함께 문제가 생긴 시각을 알려 주세요.');
  // 원인 → 주의 → 정상 순서
  const rank = { 원인: 0, 주의: 1, 정상: 2 };
  return out.sort((a, b) => rank[a.lv] - rank[b.lv]);
}
