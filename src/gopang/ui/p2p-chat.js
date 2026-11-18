/**
 * ui/p2p.js — WebRTC P2P 채팅 모듈 (GDUDA Phase 1)
 * - CF Worker /signal/* 경유 시그널링 (SDP/ICE 60초 TTL)
 * - 메시지 본문은 서버 저장 없음 — 순수 P2P
 * - from/to 모두 handle 기준 (전세계 유일)
 */
import { notifyInvite } from './friend-find-client.js';
import {
  PROXY, L1_SIGNAL_BASE, L1_PDV_URL, L1_ANCHOR_URL, L1_URL, L1_P2P_INVITES_URL, RTC_CONFIG, fetchRtcConfig, _USER,
  setUser, setRtcConn, setRtcChannel, setSignalPoll, setPeerState,
  _rtcConn, _rtcChannel, _signalPoll,
} from '../core/state.js';
import { appendBubble } from './bubble.js';
import { diag, diagEnv, diagConn } from '../core/diag.js';   // 2026-11-19 임시 진단(원인 확정 후 제거)
let _diagT0 = 0;   // 진단: 이번 통화 시작 시각(ms)
const _dt = () => (_diagT0 ? Date.now() - _diagT0 : -1);   // 통화 시작 후 경과 ms
// _clearPeer는 webrtc.js가 정의(peer-bar 숨기기·입력창 placeholder 복원·
// "AI 비서와 대화합니다" 안내까지 이미 다 되어있다 — 여기서 새로 안 만들고
// 재사용한다). webrtc.js→p2p-chat.js는 동적 import(순환 없음)이므로 반대
// 방향(정적 import)은 안전하다.
import { _clearPeer } from '../p2p/webrtc.js';
import { setPeerLabel } from './sp-label.js';
import { signalPost } from '../p2p/signal-auth.js';

// ── 탈중앙화 이관 ③: 시그널링 전송/수신/삭제를 L1 직접으로 ──────────────
// Worker가 이미 L1 webrtc_signals 컬렉션을 직접 쓰는 구조이므로,
// 단말도 같은 경로로 직접 접근. Worker 경유 불필요.
const _L1_SIGNAL = L1_SIGNAL_BASE;

// 2026-10-28: 신호 쓰기는 서버(/signal/send)를 거친다 — 서버가 로그인 증명을 확인해 from_guid 를 그 계정으로 강제하므로
// 남의 guid 로 offer/answer/ice 를 위조할 수 없다. (읽기·구독은 예전처럼 L1 직접)
async function _signalSendDirect(from_guid, to_guid, type, payload) {
  const r = await signalPost('/signal/send', from_guid, { from_guid, to_guid, type, payload });
  if (!r.ok) throw new Error(`signal send ${r.status}${r.code ? ' ' + r.code : ''}`);
  return r.data || {};
}

async function _signalPollDirect(guid) {
  const now    = new Date().toISOString();
  const filter = encodeURIComponent(`to_guid='${guid}' && expires_at>'${now}'`);
  const res    = await fetch(`${_L1_SIGNAL}?filter=${filter}&sort=created&perPage=50`);
  if (!res.ok) throw new Error(`L1 signal poll ${res.status}`);
  const data = await res.json();
  return (data.items || []).map(r => ({
    from_guid: r.from_guid,
    to_guid:   r.to_guid,
    type:      r.type,
    payload:   r.payload,
    id:        r.id,
  }));
}

async function _signalDeleteDirect(id) {
  if (!id) return;
  await signalPost('/signal/delete', _USER?.ipv6, { id }).catch(() => {});
}

// ── L1 PocketBase 자체 Realtime(SSE) 구독 — Supabase WS 대체 ──────────
// 2026-06-28: ERR_INCOMPLETE_CHUNKED_ENCODING 때문에 Supabase Realtime
// WebSocket으로 임시 우회했던 기록이 있었으나, 실제로 서버(nginx
// proxy_buffering off + PocketBase 자체)에서 curl로 직접 확인한 결과
// SSE가 정상 동작했다(PB_CONNECT까지 정상 수신). 즉 막혔던 원인은 이미
// 해결돼 있었고 클라이언트만 옛 방식(Supabase)에 남아있던 상태였다.
// 이걸로 교체하면 "쓰기는 L1, 구독은 제3자"인 반쪽 이관 상태가 끝나고,
// 오픈해시 탈중앙화 방향(Supabase 점진적 축소)과도 맞는다.
//
// PocketBase Realtime 프로토콜: SSE로 접속하면 먼저 PB_CONNECT 이벤트로
// clientId를 받고, 그 clientId로 POST /api/realtime { clientId, subscriptions }
// 해야 실제 구독이 시작된다. 이후 구독한 컬렉션명과 같은 이름의 이벤트로
// { action: 'create'|'update'|'delete', record } 가 들어온다.
// ※ PocketBase 구독은 Supabase의 postgres_changes filter처럼 서버에서
//   to_guid로 걸러주지 않는다 — 컬렉션 전체 변경을 받고 클라이언트에서
//   to_guid로 걸러야 한다(REST 폴링도 원래 그렇게 하고 있었으니 동일 신뢰모델).
// ★ 2026-07-22 버그 수정 — 구 브랜드 도메인 l1-hanlim.gopang.net(폐기됨,
// 주피터 확인)에서 hondi.net으로 통일. state.js와 동일한 이슈 참고.
const _L1_BASE = 'https://l1-hanlim.hondi.net';

function _watchL1Realtime(myGuid, onRow) {
  let es = null, retryTimer = null, closed = false;

  function _connect() {
    es = new EventSource(`${_L1_BASE}/api/realtime`);

    es.addEventListener('PB_CONNECT', async (e) => {
      try {
        const { clientId } = JSON.parse(e.data);
        await fetch(`${_L1_BASE}/api/realtime`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ clientId, subscriptions: ['webrtc_signals'] }),
        });
        console.info('[P2P L1Realtime] 구독 완료 (대기 중)');
      } catch (e) {
        console.warn('[P2P L1Realtime] 구독 요청 실패:', e.message);
      }
    });

    es.addEventListener('webrtc_signals', (e) => {
      let msg; try { msg = JSON.parse(e.data); } catch { return; }
      const row = msg?.record;
      if (!row || row.to_guid !== myGuid) return;
      onRow(row);
    });

    es.onerror = () => {
      if (closed) return;
      es.close();
      // 짧은 대기 후 재연결 — 폴백 폴링이 그동안 메워준다
      retryTimer = setTimeout(_connect, 3000);
    };
  }

  _connect();

  return function _stopL1Realtime() {
    closed = true;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (es) { es.close(); es = null; }
  };
}

let _peerInfo     = null;  // { guid, handle, nickname }
let _aiChatNodes  = null;  // 상대와 연결되기 직전 AI 패널 화면의 말풍선(노드 그대로) — 종료 때 되살린다
let _pollInterval = null;
let _p2pMessages  = [];    // P2P 대화 원문 누적 (PDV 저장용)
let _sessionStart = null;  // 세션 시작 시각
let _activeCallId = null;  // 현재 유효한 통화 시도 ID — 재연결 시 이전 watcher 자동 무력화
let _activeCallIdCallee = null;  // 수신측(폰) 연결 타임아웃용 — 최신 수락한 callId만 유효
const _calleeConnectTimers = new Map();  // callId → timer, onopen 시 정리
let _pendingModalCallId = null;  // 지금 수락/거절 모달이 떠 있는 offer의 callId
let _activeModalDismiss = null;  // 그 모달을 외부에서 강제로 닫는 함수 (취소 신호 수신용)
const _seenOfferIds = new Set();  // 처리한 offer callId — 중복 confirm() 방지

// ── 메인 채팅 통합 (2026-07-02 리팩터링) ──────────────────────────────
// 기존엔 이 파일이 #_p2p-overlay라는 완전히 별도의 풀스크린 UI를 직접
// 그려서 썼다 — AI 패널도, 메인 대화창(#message-list)도 아닌 제3의
// 화면이었다. 그런데 webrtc.js/send-message.js/state.js에는 이미
// "_peer 상태가 있으면 메인 입력창이 자동으로 P2P 전송으로 라우팅되고,
// peer-bar에 상대 정보가 뜨는" 통합 구조가 먼저 만들어져 있었다(webrtc.js
// setPeer()의 주석: "UI(오버레이)는 p2p-chat.js가 담당"이라며 위임했지만,
// 정작 p2p-chat.js는 그 통합 구조(_peer 공유state)를 쓰지 않고 자기 것을
// 새로 만들어서 — 결과적으로 메인 채팅 쪽 통합 코드가 통째로 고아가 됐다.
// 이번 리팩터링은 그 고아가 된 기존 통합 구조(_peer state · peer-bar ·
// appendBubble · _clearPeer)를 그대로 되살려 쓰는 것 — 새로 설계하지 않는다.

// "지금 뭘 보여줄지" 판단: AI 패널이 열려있으면 거기(사용자가 방금 그
// 맥락에서 호출을 시켰을 가능성이 높음), 아니면 메인 채팅에 시스템 메시지로.
function _notify(text) {
  if (typeof window._appendPanelSystemMsg === 'function' && window._isAIPanelOpen?.()) {
    window._appendPanelSystemMsg(text);
  } else {
    appendBubble('system', text);
  }
}

// 연결 실제 완료(datachannel open) 시점에만 호출 — peer-bar를 띄우고
// AI 패널을 닫아 메인 대화창으로 넘긴다. "전화 거는 중" 단계에서는
// 호출하지 않는다(사용자가 요청한 그대로 — 무응답이면 AI 패널이 계속
// 살아있어야 하므로).
function _activatePeerInMainChat(peer) {
  window.__p2pEnded = false;   // 새 연결 — 이전에 "종료됨"으로 남겨 둔 창이 있었다면 상태를 초기화한다
  try { const b = document.getElementById('peer-close-btn'); const t = b && b.querySelector('.lbl'); if (t) t.textContent = '종료'; } catch {}
  const _already = !!peer.__shown; peer.__shown = true;
  setPeerState({
    guid: peer.guid, handle: peer.handle,
    name: peer.nickname || peer.handle,
    avatar_emoji: peer.avatar_emoji || '🙂',
  });
  const bar  = document.getElementById('peer-bar');
  const av   = document.getElementById('peer-avatar');
  const nm   = document.getElementById('peer-name');
  const hd   = document.getElementById('peer-handle');
  if (av) av.textContent = peer.avatar_emoji || '🙂';
  if (nm) nm.textContent = peer.nickname || peer.handle || '상대방';
  // 아이디(닉네임)가 있으면 그것만 보인다 — 전화번호에서 나온 @아이디는 이름이 없을 때만 보조로 표시한다.
  if (hd) hd.textContent = (!peer.nickname || peer.nickname === peer.handle) && peer.handle ? '@' + peer.handle.replace(/^@/, '') : '';
  if (bar) bar.style.display = 'flex';
  const mainInput = document.getElementById('msg-input');
  if (mainInput) mainInput.placeholder = `${peer.nickname || peer.handle || '상대방'}에게 메시지…`;
  // 2026-11-18(주피터 지시) — 상대와 대화 중임이 대화창 자체에 보이게: 상단 머리글(노란색)과 입력창 안내를 상대 기준으로 바꾼다.
  try {
    setPeerLabel(`${peer.nickname || peer.handle || '상대방'}님과 대화`);
    const ci = document.querySelector('#ai-panel-input-slot .ci-input');
    if (ci) ci.placeholder = `${peer.nickname || peer.handle || '상대방'}님에게 메시지…`;
  } catch {}
  // 2026-11-18(주피터 지시) — closeAIPanel() 이 AI 패널 화면을 비우므로, 비우기 전에 말풍선 노드를 그대로 쥐고 있다가 대화가 끝나면 되살린다.
  // innerHTML 이 아니라 노드 참조를 쥐므로 단추 등에 붙은 이벤트도 그대로 살아 있다.
  if (!_already) {   // 비어 있으면(이미 비워진 뒤) 덮어쓰지 않는다 — 이전 세션이 정상 종료되지 않았어도 낡은 화면이 남지 않게 새로 쥔다
    try {
      const pm = document.getElementById('ai-panel-messages');
      if (pm && pm.childNodes.length) _aiChatNodes = Array.from(pm.childNodes);
    } catch {}
  }
  if (typeof window.closeAIPanel === 'function') window.closeAIPanel();
  appendBubble('system', _already ? `✅ ${peer.nickname || peer.handle}님과 연결됐습니다. 메시지를 입력하세요.` : `🔗 ${peer.nickname || peer.handle}님과 연결하는 중입니다…`);
}

// ── handle로 즉시 초대 (발신측) ──────────────────────────
// 그림자 AI가 [P2P_INVITE: handle=@xxx] 태그를 출력했을 때 호출됨.
// 모호한 이름(예: "김동")은 이 함수를 쓰지 않고 [SEARCH]로 먼저 후보를 보여준 뒤,
// 사용자가 정확한 handle을 확인한 경우에만 이 함수로 즉시 연결한다.
export async function inviteByHandle(handle) {
  const clean = String(handle || '').replace(/^@/, '').trim();
  if (!clean) throw new Error('handle 누락');
  const filter = encodeURIComponent(`handle='${clean}'`);
  const res = await fetch(`${L1_URL}?filter=${filter}&perPage=1`);
  if (!res.ok) throw new Error('프로필 조회 실패');
  const raw = await res.json();
  const u = raw.items?.[0];
  if (!u) throw new Error(`@${clean} 사용자를 찾을 수 없습니다`);
  const targetUser = {
    guid: u.guid, handle: u.handle, nickname: u.nickname,
    region: u.region, country_code: u.country_code, current_l1: u.current_l1,
  };
  await startP2PCall(targetUser);
  return targetUser;
}

// ── P2P 통화 시작 (발신측) ───────────────────────────────
export async function startP2PCall(targetUser) {
  // 2026-11-16 — 폰 패널에서 내 정보(_USER)가 아직 비어 있으면 이 기기에 저장된 계정으로 채운다. 그래도 없으면 알아보기 쉬운 안내로 멈춘다.
  if (!_USER?.ipv6) {
    try { const st = JSON.parse(localStorage.getItem('gopang_user_v4') || sessionStorage.getItem('gopang_user_v4') || 'null'); if (st && st.ipv6) setUser(st); } catch {}
    if (!_USER?.ipv6) throw new Error('내 계정 정보를 아직 불러오지 못했습니다. 앱을 새로고침한 뒤 다시 시도해 주세요');
  }
  // 이전 시도(재연결 등)가 정리되지 않고 남아있으면 먼저 로컬 정리.
  // (이전 watcher는 _activeCallId가 바뀌는 즉시 스스로 종료됨 — 아래 참고)
  // 재호출이면 이전 시도를 상대에게 취소 신호로 알린다 — 알리지 않으면 상대가 이미 죽은 이전 호출을 수락해 연결이 끊긴다(2026-11-18 실제 관찰).
  const _prevCallId = _activeCallId, _prevGuid = _peerInfo?.guid;
  const _prevOpen = !!(_rtcChannel && _rtcChannel.readyState === 'open');
  if (_prevCallId && _prevGuid && !_prevOpen) {
    _signalSendDirect(_USER.ipv6, _prevGuid, 'ice', { cancel: true, callId: _prevCallId }).catch(() => {});
  }
  if (_rtcConn || _rtcChannel) {
    try { _rtcChannel?.close(); } catch {}
    try { _rtcConn?.close(); } catch {}
    setRtcChannel(null);
    setRtcConn(null);
  }

  // 통화 시도마다 고유 ID — 재연결 시 이전/새 시도를 구분하는 핵심 키
  const callId = (crypto.randomUUID
    ? crypto.randomUUID()
    : `call-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  _activeCallId = callId;

  _peerInfo     = targetUser;
  try { _peerInfo.__since = Date.now(); } catch {}
  window.__naviCallBusy = true;
  _p2pMessages  = [];
  _sessionStart = new Date().toISOString();

  _diagT0 = Date.now();
  await fetchRtcConfig(_USER?.ipv6 || '').catch(() => {});
  diagEnv().then(e => diag('호출:시작(발신)', { callId: callId.slice(0, 8), to: String(targetUser.guid || '').slice(0, 8), ...e })).catch(() => {});
  const conn    = new RTCPeerConnection(RTC_CONFIG);
  const channel = conn.createDataChannel('chat', { ordered: true });
  setRtcConn(conn);
  setRtcChannel(channel);

  _setupChannel(channel);
  _setupConn(conn, targetUser, callId);

  // SDP offer 생성
  const offer = await conn.createOffer();
  await conn.setLocalDescription(offer);

  // ICE 수집 완료 대기 (최대 2초)
  await _waitForIce(conn);

  // offer 전송 (callId 포함 — 재연결 시 이전/이후 시도 구분용)
  await _signalSend({
    from_guid: _USER.ipv6,
    to_guid:   targetUser.guid,
    type:      'offer',
    payload:   { sdp: conn.localDescription, from_handle: _USER.handle, from_name: _USER.nickname || '', callId, sentAt: Date.now() },
  });

  // BUG-FIX(2026-07-02): 예전엔 여기서 _openChatUI()로 완전히 별도의
  // 풀스크린 오버레이를 띄웠다 — AI 패널도 메인 대화창도 아닌 제3의 화면.
  // "전화 거는 중"에는 아무 UI 전환도 하지 않는다 — AI 패널을 통해 통화를
  // 시작했다면 그 패널이 계속 살아있어야, 무응답일 때 거기에 안내를 띄울
  // 수 있다(사용자 요청 사양). 실제로 연결됐을 때만
  // _activatePeerInMainChat()이 메인 대화창으로 전환한다.
  _notify(`📞 ${targetUser.nickname || targetUser.handle}님께 연결 요청을 보냈습니다. 최대 2분까지 기다립니다...`);

  // answer/ICE 수신 — L1 PocketBase Realtime (폴링 폴백 포함)
  _watchAnswerRealtime(conn, targetUser, callId);
}

// ── answer/ICE 실시간 수신 (발신측) ─────────────────────
// BUG-FIX(2026-07-02): peerGuid만 받던 걸 targetUser 전체로 바꿨다 —
// 무응답 타임아웃 안내 메시지("OO님이 응답하지 않습니다")에 닉네임이
// 필요해서다.
function _watchAnswerRealtime(conn, targetUser, callId) {
  const peerGuid = targetUser.guid;
  const myGuid = _USER.ipv6;

  let done = false, stopRealtime = null;
  // realtime과 폴백 폴링이 거의 동시에 같은 신호를 집어올 수 있어서(특히
  // realtime이 막 켜진 순간), wsOk 같은 거친 on/off 플래그로는 둘 다 같은
  // answer/ICE를 따로 처리하는 경쟁이 생긴다(같은 answer를 두 번
  // setRemoteDescription하려다 두 번째가 "wrong state: stable"로 실패,
  // 같은 ICE가 순서 뒤바뀌어 처리되는 등 — 2026-06-28 실제로 관찰됨).
  // Supabase 시절엔 wsOk가 사실상 영원히 false였어서 이 경쟁이 드러난 적이
  // 없었을 뿐, 원래부터 있던 설계 결함이었다. 신호 id 단위로 한 번만
  // 처리되게 하여 어느 경로가 먼저 잡든 안전하게 만든다.
  const _seenSignalIds = new Set();

  // 더 새로운 통화 시도가 시작되면 이 watcher는 즉시 폐기
  function _stale() { return _activeCallId !== callId; }

  let smsTimer = null;
  function _close() {
    done = true;
    if (noAnswerTimer) { clearTimeout(noAnswerTimer); noAnswerTimer = null; }
    if (smsTimer) { clearTimeout(smsTimer); smsTimer = null; }
    if (stopRealtime) { stopRealtime(); stopRealtime = null; }
    _stopPoll();
  }

  // ── 무응답 타임아웃 (2026-07-02 신설) ─────────────────
  // offer를 보낸 지 2분 안에 answer가 안 오면 "무응답"으로 간주한다.
  // 서버 시그널 TTL(60초)보다 짧게 잡아, 상대가 아예 안 받는 상황을
  // TTL 만료까지 기다리지 않고 사용자에게 먼저 알린다.
  const NO_ANSWER_MS = 120000;   // 2026-11-16 — 25초→2분. 상대 폰 화면이 꺼져 있어도 알림을 보고 열 시간을 준다(서버의 호출 신호 보관 3분보다 짧게).
  // 2026-11-16(주피터 지시) — 30초 안에 수락·거절이 없으면, 상대 번호를 아는 경우 내 폰의 문자 앱으로 알릴 수 있게 한다.
  // 문자는 내 폰이 내 요금으로 보내며(서버 발송·GDC 차감 없음), 보내기 단추는 내가 직접 눌러야 한다.
  smsTimer = setTimeout(() => { if (!done && !_stale()) _offerSmsFallback(targetUser); }, 30000);
  let noAnswerTimer = setTimeout(() => {
    if (done || _stale()) return;
    _close();
    _handleNoAnswer(targetUser, callId);
  }, NO_ANSWER_MS);

  async function _handleSignalRow(row) {
    if (done) return;
    if (_stale()) { console.info('[P2P] 오래된 통화 시도 — watcher 종료'); _close(); return; }
    if (_seenSignalIds.has(row.id)) return;  // 이미 처리한 신호 — realtime/폴링 중복 방지
    _seenSignalIds.add(row.id);

    const _rowPayload = typeof row.payload === 'string'
      ? JSON.parse(row.payload) : (row.payload || {});

    // callId가 있는데 이 시도와 다르면 — 다른(이전/이후) 통화 시도의 시그널이므로 무시
    if (_rowPayload.callId && _rowPayload.callId !== callId) return;

    if (row.type === 'answer' && row.from_guid === peerGuid) {
      try {
        const answerSdp = _rowPayload.sdp || _rowPayload;
        diag('응답(answer) 수신', { callId: String(callId).slice(0, 8), ms: _dt() });
        await conn.setRemoteDescription(new RTCSessionDescription(answerSdp));
        if (noAnswerTimer) { clearTimeout(noAnswerTimer); noAnswerTimer = null; } // 응답 왔으니 무응답 타이머 해제
        if (smsTimer) { clearTimeout(smsTimer); smsTimer = null; }
        _notify('✅ 연결됐습니다. 채널이 열리면 메시지를 입력하세요.');
        console.info('[P2P] answer 수신 완료');
        // answer 수신 후 잠시 뒤 watcher 종료 (ICE는 ondatachannel onopen 후 불필요)
        setTimeout(_close, 60000);   // 연결이 열릴 때까지 늦게 오는 ICE 후보(중계 경로)를 계속 받는다 — 예전엔 10초 뒤 끊어 늦은 후보를 놓쳤다
      } catch(e) { console.warn('[P2P] answer setRemoteDescription 실패:', e.message); }
    }

    if (row.type === 'ice' && row.from_guid === peerGuid) {
      // BUG-FIX(2026-07-02): remoteDescription이 아직 없거나(answer를
      // 못 받았거나 무응답 타임아웃으로 이미 포기한 상태) connection이
      // 이미 닫혔으면 addIceCandidate 자체가 예외를 던진다("remote
      // description was null" 등) — 실제로 관찰된 콘솔 에러. 두 경우
      // 다 이 통화 시도가 이미 끝났다는 뜻이므로, 예외로 시끄럽게 떠들
      // 필요 없이 조용히 건너뛴다.
      if (!conn.remoteDescription || conn.signalingState === 'closed') {
        console.info('[P2P] ICE 후보 무시 — 이미 종료된 통화 시도');
      } else {
        try {
          const candidate = _rowPayload.candidate || _rowPayload;
          await conn.addIceCandidate(new RTCIceCandidate(candidate));
        } catch(e) { console.warn('[P2P] ICE 추가 실패:', e.message); }
      }
    }

    // 처리 후 시그널 삭제 — 중복 호출돼도(이미 지워졌으면) 404는 무해하므로 무시
    _signalDeleteDirect(row.id);
  }

  // L1 PocketBase Realtime(SSE)으로 answer/ICE 수신
  stopRealtime = _watchL1Realtime(myGuid, _handleSignalRow);

  // 폴백: realtime이 못 잡은 신호를 1.5초 폴링으로 보완(같은 핸들러 재사용 —
  // _seenSignalIds가 있어서 realtime이 이미 처리한 신호는 자동으로 건너뜀).
  // autoDelete:false — _handleSignalRow가 이미 자기 책임으로 지우므로,
  // _startPoll이 또 지우려다 404(이미 없음)가 나는 걸 막는다.
  _startPoll(myGuid, _handleSignalRow, { autoDelete: false });
}

// 호출한 사람이 상대 번호를 이미 아는 경우(번호로 찾았거나 연락처에서 골랐을 때)에만 문자로 알릴 수 있다. 번호는 검색 결과로 알려 주지 않으므로, 이름으로 찾은 상대에게는 나오지 않는다.
function _offerSmsFallback(targetUser) {
  try {
    const raw = JSON.parse(localStorage.getItem('navi_known_phone_' + targetUser.guid) || 'null');
    if (!raw || !raw.e164 || Date.now() - (raw.ts || 0) > 24 * 3600 * 1000) return;
    const me = _USER?.nickname || _USER?.handle || '나비웹 사용자';
    const text = `[나비웹] ${me}님이 대화를 요청했습니다. 나비웹(https://naviweb.kr)을 열어 주세요.`;
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
    const href = `sms:${raw.e164}${ios ? '&' : '?'}body=${encodeURIComponent(text)}`;
    const name = targetUser.nickname || targetUser.handle || '상대';
    appendBubble('system', `📱 ${name}님이 30초째 응답하지 않습니다. <a href="${href}" style="color:#1A73E8;font-weight:700;text-decoration:underline">문자로 알리기</a> (내 폰의 문자 앱이 열리며, 문자 요금은 내 통신 요금제로 부과됩니다. 보내기는 직접 눌러야 합니다.)`, true);
  } catch {}
}

// ── 무응답 처리 (2026-07-02 신설) ────────────────────────
// 사용자 요청 사양: 무응답이면 AI 대화창은 그대로 살아있고, 거기(또는
// 메인 대화창)에 "OO님이 응답하지 않습니다. OO님의 AI 비서에게 대화
// 초대 메시지를 남겼습니다"를 띄운다. "메시지를 남겼다"는 문구는 실제로
// 남기기가 성공했을 때만 붙인다 — 실패하면 그 사실은 숨기지 않는다.
async function _handleNoAnswer(targetUser, callId) {
  const name = targetUser.nickname || targetUser.handle || '상대방';
  diag('호출:무응답 포기', { callId: String(callId).slice(0, 8), ms: _dt() });
  try { if (_rtcConn) diagConn(_rtcConn, '무응답'); } catch {}

  // BUG-FIX(2026-07-02, 2차): 20초 수신측 자체 타임아웃(방어망)만으로는
  // 상대가 늦게 수락했을 때 최대 20초를 그냥 날린다. 여기서 포기하는
  // "바로 그 순간" 상대에게 취소 신호를 쏴서, 아직 수락 모달이 떠 있든
  // 막 수락해서 연결 시도 중이든 즉시 반응하게 한다(수신측 타임아웃은
  // 이 신호가 유실됐을 때 대비한 최후 방어망으로 계속 남겨둔다).
  _signalSendDirect(_USER.ipv6, targetUser.guid, 'ice', { cancel: true, callId }).catch(() => {});

  let left = false;
  try {
    await _leaveInviteForPeerAI(targetUser);
    left = true;
  } catch (e) {
    console.warn('[P2P] 초대 메시지 남기기 실패:', e.message);
  }
  _notify(`${name}님이 응답하지 않습니다.` +
    (left ? ` ${name}님의 AI 비서에게 대화 초대 메시지를 남겼습니다.`
          : ` (상대방 AI 비서에게 메시지를 남기지 못했습니다 — 잠시 후 다시 시도해 주세요.)`));

  // 실패한 통화 시도 정리 — 다음 시도에 깨끗한 상태로 시작하도록
  if (_rtcChannel) { try { _rtcChannel.close(); } catch {} setRtcChannel(null); }
  if (_rtcConn)    { try { _rtcConn.close(); }    catch {} setRtcConn(null); }
  _peerInfo = null;
}

// ── P2P 수신측 처리 ──────────────────────────────────────
// 2026-10-28 신설 — 걸려 온 대화의 "누구인지"는 상대가 신호에 적어 보낸 from_handle 을 믿지 않고,
// guid 로 서버(L1)의 프로필에서 읽은 아이디(handle)로 표시한다. 남의 아이디를 적어 보내 사칭하는 것을 막는다.
// 프로필을 못 찾으면 "확인되지 않은 사용자"로 표시한다(적힌 이름을 대신 쓰지 않는다).
async function _verifiedCallerHandle(fromGuid) {
  try {
    const filter = encodeURIComponent(`guid='${String(fromGuid).replace(/[\\']/g, '')}'`);
    const res = await fetch(`${L1_URL}?filter=${filter}&perPage=1`);
    if (res.ok) { const raw = await res.json(); const u = raw.items?.[0]; if (u?.handle) return String(u.handle).replace(/^tid-/, ''); }
  } catch { /* 아래에서 미확인 처리 */ }
  return null;
}
// 2026-11-16(주피터 지시) — 대화창 상단·알림에는 전화번호 형태의 아이디(@…)가 아니라 상대의 아이디(닉네임, 예: 주피터)를 보인다. 서버 프로필에서 읽은 값만 쓴다.
async function _verifiedCaller(fromGuid) {
  try {
    const filter = encodeURIComponent(`guid='${String(fromGuid).replace(/[\\']/g, '')}'`);
    const res = await fetch(`${L1_URL}?filter=${filter}&perPage=1`);
    if (res.ok) {
      const raw = await res.json(); const u = raw.items?.[0];
      if (u) return { handle: u.handle ? String(u.handle).replace(/^tid-/, '') : null, nickname: (u.nickname && String(u.nickname).trim() && u.nickname !== 'N/A') ? String(u.nickname).trim() : null };
    }
  } catch { /* 아래에서 미확인 처리 */ }
  return { handle: null, nickname: null };
}

// 2026-11-16 — 새 호출(offer)을 막는 조건을 '대화 중이거나 막 연결하는 중일 때'로만 좁힌다. 이전 연결이 끊긴 채 _peerInfo 만 남은 창(오래 켜 둔 탭 등)이
// 이후 모든 호출을 조용히 무시해 상대가 "응답 없음"을 보던 문제. 끊긴 흔적이면 정리하고 새 호출을 받는다.
function _busyWithPeer(fromGuid) {
  if (!_peerInfo) return false;
  if (_rtcChannel && _rtcChannel.readyState === 'open') return true;
  // 같은 상대가 다시 호출했고 아직 열리지 않은 연결이면, 그 이전 시도는 버리고 새 호출을 받는다.
  if (fromGuid && _peerInfo.guid === fromGuid) { try { _rtcChannel?.close(); } catch {} try { _rtcConn?.close(); } catch {} setRtcChannel(null); setRtcConn(null); _activeCallIdCallee = null; _peerInfo = null; window.__naviCallBusy = false; try { _clearPeer({ silent: true }); } catch {} return false; }
  const st = _rtcConn && _rtcConn.connectionState;
  const fresh = _peerInfo.__since && (Date.now() - _peerInfo.__since < 60000);
  if (fresh && (!_rtcConn || (st !== 'closed' && st !== 'failed' && st !== 'disconnected'))) return true;
  try { if (_rtcChannel) _rtcChannel.close(); } catch {}
  try { if (_rtcConn) _rtcConn.close(); } catch {}
  setRtcChannel(null); setRtcConn(null);
  _activeCallIdCallee = null; _peerInfo = null; window.__naviCallBusy = false;
  try { _clearPeer(); } catch {}
  return false;
}

// 2026-11-16 — 알림을 눌러 들어온 경우 수락 팝업을 다시 띄우지 않고 곧바로 수락으로 처리한다.
try {
  if (new URLSearchParams(location.search).get('callTap')) window.__naviAcceptUntil = Date.now() + 90000;
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type !== 'CALL_TAP') return;
    window.__naviAcceptUntil = Date.now() + 90000;
    const b = document.getElementById('_p2p-accept');   // 이미 수락 팝업이 떠 있으면 그것을 누른 것으로 본다
    if (b) b.click();
  });
} catch {}

export async function handleIncomingOffer(signal) {
  const fromGuid    = signal.from_guid;
  const _caller    = await _verifiedCaller(fromGuid);
  const fromHandle  = _caller.handle || '확인되지 않은 사용자';
  const fromName    = _caller.nickname || fromHandle;   // 화면에 보이는 이름: 아이디(닉네임) 우선

  // payload 방어적 파싱 (webrtc.js/p2p-chat.js 양쪽 호환) — callId 추출용으로 먼저 파싱
  const _offerPayload = typeof signal.payload === 'string'
    ? JSON.parse(signal.payload) : (signal.payload || {});
  const callId = _offerPayload.callId || null;
  // 2026-11-19 진단 — 호출이 이 기기에 도착한 시각·경로·화면 상태. 지연 = 도착 시각 - 발신 측이 offer 를 만든 시각(두 폰 시계 차이만큼 오차).
  diagEnv().then(e => diag('호출:수신(착신)', { callId: String(callId || '').slice(0, 8), 지연ms: _offerPayload.sentAt ? Date.now() - _offerPayload.sentAt : '발신측 구판(sentAt 없음)', 경로: signal.__via || '?', ...e })).catch(() => {});

  // 같은 callId의 offer가 중복 도착(재시도/레이스 컨디션)하면 두 번째부터는 무시
  if (callId) {
    if (_seenOfferIds.has(callId)) {
      console.info('[P2P] 중복 offer 무시 (callId 이미 처리됨):', callId);
      diag('호출:중복 무시', { callId: String(callId).slice(0, 8) });
      return;
    }
    _seenOfferIds.add(callId);
    if (_seenOfferIds.size > 50) {
      _seenOfferIds.delete(_seenOfferIds.values().next().value);
    }
  }

  // ── 활성 상태 알림음 — <audio> 자동재생 대신 시스템 알림 사용 ──────
  // <audio>.play()는 사용자 동작과 같은 호출 스택 안에서 일어나야만
  // 허용되는 것으로 확인됨(탭으로 미리 풀어둬도 효과 없음, 콘솔 로그로
  // 검증 — play() Promise가 사용자가 모달의 "확인"을 누르기 전까지
  // pending 상태로 멈춰있다가 그 순간에야 resolve됨). 페이지 오디오
  // 자동재생 정책이 아니라 알림 권한 체계를 타는 showNotification()을
  // 쓰면 이 제약을 받지 않는다 — 닫힌 상태(push)에서 쓰던 것과 동일한
  // 메커니즘을 활성 상태에서도 그대로 사용.
  console.info('[TEST-SOUND] handleIncomingOffer 진입 — 시스템 알림으로 재생 시도');
  try { if (navigator.vibrate) navigator.vibrate([300, 100, 300]); }
  catch (e) { console.warn('[TEST-SOUND] vibrate 실패:', e.message); }
  try {
    if (Notification.permission === 'granted' && 'serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification('나비', {
        body: `${fromName}님이 대화를 요청했습니다`,
        icon: '/icons/navi-icon-192.png',
        // 같은 tag 로 다시 띄우면 renotify 없이는 소리·진동 없이 조용히 교체된다(두 번째 호출부터 소리가 안 나던 원인) — 호출마다 새 tag + renotify.
        tag:  'gopang-incoming-call-' + (callId || Date.now()),
        renotify: true,
        vibrate: [400, 150, 400, 150, 400],
        silent: false,
      });
      console.info('[TEST-SOUND] showNotification 호출 성공');
      diag('앱내 알림 표시 성공', { 권한: Notification.permission });
    } else {
      console.warn('[TEST-SOUND] 알림 권한 없음(permission:', Notification.permission, ') — showNotification 건너뜀');
      diag('앱내 알림 건너뜀', { 권한: Notification.permission });
    }
  } catch (e) { console.warn('[TEST-SOUND] showNotification 실패:', e.message); diag('앱내 알림 실패', e && e.message); }

  // 수락 확인 — confirm()은 메인 스레드를 동기적으로 막기 때문에 막지
  // 않는 커스텀 모달을 사용한다.
  // BUG-FIX(2026-07-02): _pendingModalCallId를 세팅해둬야 그 사이 발신측이
  // 포기했을 때(_handleIncomingCancel) 이 모달을 정확히 찾아서 강제로
  // 닫을 수 있다.
  // 더 새 호출이 오면 아직 떠 있는 이전 호출 모달은 닫는다(이미 끝난 호출을 수락하지 않도록).
  if (_pendingModalCallId && _pendingModalCallId !== callId && _activeModalDismiss) _activeModalDismiss(null);
  _pendingModalCallId = callId;
  const _tapped = (window.__naviAcceptUntil || 0) > Date.now();
  const accepted = _tapped ? true : await _showIncomingCallModal(fromName);
  if (_tapped) window.__naviAcceptUntil = 0;
  _pendingModalCallId = null;
  diag('수락 결정', { 방식: _tapped ? '알림 탭(자동 수락)' : '팝업', accepted: !!accepted, ms: _dt() });
  if (!accepted) return;

  _peerInfo = { guid: fromGuid, handle: fromHandle, nickname: fromName, __incoming: true };
  _peerInfo.__since = Date.now();
  window.__naviCallBusy = true;
  // BUG-FIX(2026-07-02): 원래 이 아래 SDP 생성·전송 과정(await 여러 번)이
  // 끝난 뒤에야 _activeCallIdCallee를 세팅했는데, 그 사이(비동기 처리
  // 중)에 취소 신호가 도착하면 _handleIncomingCancel의 케이스 B 검사
  // (`_activeCallIdCallee === callId`)가 아직 불일치라 놓쳤다. _peerInfo와
  // 동시에 세팅해 그 레이스 윈도우를 없앤다.
  _activeCallIdCallee = callId;

  // 수락 즉시 상대와의 대화창으로 전환한다(AI 비서가 대신 답하지 않도록). 연결이 열리기 전에는 전송 시 안내만 보인다.
  _diagT0 = Date.now();
  _activatePeerInMainChat(_peerInfo);
  try {
    const _st = await import('../core/state.js');
    diag('수락 후 대화창 전환', { 상대설정됨: !!_st._peer, 머리글: (document.getElementById('ai-sp-label') || {}).textContent || '(없음)', 입력안내: ((document.querySelector('#ai-panel-input-slot .ci-input') || {}).placeholder || '').slice(0, 20) });
  } catch (e) { diag('수락 후 대화창 전환 확인실패', e && e.message); }
  // 서로 다른 통신망의 두 폰은 TURN 중계가 있어야 연결된다.
  await fetchRtcConfig(_USER?.ipv6 || '').catch(() => {});
  diag('수신:ICE설정', { TURN: (RTC_CONFIG.iceServers || []).some(s => [].concat(s.urls).some(u => /^turns?:/.test(u))) ? '있음' : '없음(STUN만)', ms: _dt() });
  const conn = new RTCPeerConnection(RTC_CONFIG);
  setRtcConn(conn);

  // DataChannel 수신
  conn.ondatachannel = e => {
    const channel = e.channel;
    setRtcChannel(channel);
    _setupChannel(channel);
  };

  _setupConn(conn, _peerInfo, callId);

  // SDP answer 생성
  const _offerSdp = _offerPayload.sdp || _offerPayload;
  await conn.setRemoteDescription(new RTCSessionDescription(_offerSdp));
  const answer = await conn.createAnswer();
  await conn.setLocalDescription(answer);
  await _waitForIce(conn);

  // answer 전송 (callId 포함 — 발신측이 어느 시도에 대한 answer인지 구분)
  await _signalSend({
    from_guid: _USER.ipv6,
    to_guid:   fromGuid,
    type:      'answer',
    payload:   { sdp: conn.localDescription, from_handle: _USER.handle, callId },
  });
  diag('수신:answer 전송', { ms: _dt() });

  // BUG-FIX(2026-07-02): 여기서도 발신측과 동일한 이유로 _openChatUI()를
  // 없앴다 — 실제 datachannel이 열릴 때(_setupChannel.onopen)만
  // _activatePeerInMainChat()이 메인 대화창으로 전환한다.

  // BUG-FIX(2026-07-02): 실제로 관찰된 버그 — 발신측(PC)이 25초 무응답
  // 타임아웃으로 이미 포기했는데 그 사실을 수신측(폰)에 전혀 알리지
  // 않았다. 폰이 그 뒤에 늦게 "수락"을 누르면 _peerInfo가 세팅된 채로
  // (발신측은 이미 안 듣고 있으니) 연결이 영원히 안 되고, _peerInfo를
  //되돌릴 타임아웃도 없어서 startIncomingWatch()의 `!_peerInfo` 가드가
  // 이후의 모든 새 offer(재통화 시도 포함)를 통째로 무시하게 됐다 —
  // "재차 연결 요청했는데 폰에 전달 안 됨" 증상의 정확한 원인.
  // answer를 보낸 뒤 20초 안에 datachannel이 안 열리면(=_setupChannel.onopen
  // 미발동) 강제로 정리해 다음 통화를 받을 수 있는 상태로 되돌린다.
  const _calleeCallId = callId;
  const calleeConnectTimer = setTimeout(() => {
    if (_rtcChannel && _rtcChannel.readyState === 'open') return; // 이미 정상 연결됨 — 아무 것도 안 함
    if (_activeCallIdCallee !== _calleeCallId) return; // 이미 다른 통화로 넘어갔음
    console.warn('[P2P] 수신측 연결 타임아웃 — 상태 초기화');
    diag('수신:연결 시간초과(45초)', { ms: _dt() });
    try { diagConn(conn, '시간초과'); } catch {}
    appendBubble('system', '⚠️ 연결이 시간 초과됐습니다. 상대방이 이미 통화를 종료했을 수 있어요.');
    if (_rtcChannel) { try { _rtcChannel.close(); } catch {} setRtcChannel(null); }
    if (_rtcConn)    { try { _rtcConn.close(); }    catch {} setRtcConn(null); }
    _peerInfo = null; window.__naviCallBusy = false;
    try { _clearPeer(); } catch {}
  }, 45000);
  _calleeConnectTimers.set(_calleeCallId, calleeConnectTimer);

  // ICE 폴링
  _startPoll(_USER.ipv6, async sig => {
    if (sig.type === 'ice' && sig.from_guid === fromGuid) {
      const _p = typeof sig.payload === 'string'
        ? JSON.parse(sig.payload) : (sig.payload || {});
      await conn.addIceCandidate(new RTCIceCandidate(_p.candidate || _p)).catch(() => {});
    }
  });
}

// ── RTCPeerConnection 공통 설정 ───────────────────────────
function _setupConn(conn, peer, callId) {
  // 2026-11-19 진단 — 연결이 어디서 막히는지(후보 수집·ICE 검사·TURN 오류)를 시각과 함께 남긴다.
  const _cid = String(callId || '').slice(0, 8), _cnt = {};
  try {
    conn.addEventListener('icecandidate', e => { if (e.candidate) { const m = /typ (\w+)/.exec(e.candidate.candidate || ''); const k = (m && m[1]) || '?'; _cnt[k] = (_cnt[k] || 0) + 1; } else diag('ICE:수집끝', { callId: _cid, 내후보: { ..._cnt }, ms: _dt() }); });
    conn.addEventListener('icecandidateerror', e => diag('ICE:서버오류', { callId: _cid, url: String(e.url || '').slice(0, 60), code: e.errorCode, text: String(e.errorText || '').slice(0, 60) }));
    conn.addEventListener('iceconnectionstatechange', () => diag('ICE:상태', { callId: _cid, ice: conn.iceConnectionState, ms: _dt() }));
    conn.addEventListener('icegatheringstatechange', () => diag('ICE:수집상태', { callId: _cid, g: conn.iceGatheringState, ms: _dt() }));
    conn.addEventListener('connectionstatechange', () => {
      diag('연결상태', { callId: _cid, state: conn.connectionState, ms: _dt() });
      if (['connected', 'failed', 'closed'].includes(conn.connectionState)) diagConn(conn, conn.connectionState);
    });
  } catch {}
  conn.onicecandidate = async e => {
    if (!e.candidate) return;
    await _signalSend({
      from_guid: _USER.ipv6,
      to_guid:   peer.guid,
      type:      'ice',
      payload:   { candidate: e.candidate, callId },
    });
  };

  conn.onconnectionstatechange = () => {
    const state = conn.connectionState;
    console.info('[P2P] 연결 상태:', state);
    if (state === 'connected') {
      _stopPoll();
      if (conn.__lost) _onLinkRecovered(conn, peer);
      // 실제 메인 대화창 전환은 datachannel이 열릴 때(_setupChannel.onopen)
      // 하지만, ICE 레벨에서도 이미 연결됐다는 저수준 신호를 남겨둔다.
      _notify('🔒 암호화 채널 개설됨.');
    }
    if (state === 'disconnected' || state === 'failed' || state === 'closed') {
      _stopPoll();
      // 같은 연결에서 상태가 연달아 바뀌어도 안내는 한 번만, 그리고 끊긴 상대가 대화창 상단에 남아 AI 비서가 대신 답하는 혼동이 없게 정리한다.
      // 한 번 열렸던 대화가 끊긴 경우: 사용자가 종료를 고르기 전에는 창을 닫지 않고 다시 연결을 시도한다.
      if (conn.__everOpen && _rtcConn === conn && !window.__p2pEnded) { _onLinkLost(conn, peer, callId); return; }
      if (conn.__lostNotified) return;
      const _drop = () => {
        if (conn.__lostNotified || conn.connectionState === 'connected') return;
        conn.__lostNotified = true;
        appendBubble('system', `🔴 ${peer.nickname || peer.handle || '상대'}님과 연결이 끊어졌습니다. 다시 대화하려면 "${peer.nickname || peer.handle || '상대'} 불러 줘"라고 말씀해 주세요.`);
        if (_rtcConn === conn) { _activeCallIdCallee = null; _peerInfo = null; window.__naviCallBusy = false; _clearPeer(); }
      };
      if (state === 'disconnected') setTimeout(_drop, 15000); else _drop();   // disconnected 는 잠깐 끊겼다 돌아올 수 있어 8초 기다린다
    }
  };
}


// ── 끊긴 연결 복구 (2026-11-18, 주피터 지시: 사용자가 종료를 고르기 전에는 연결이 유지되어야 한다) ──
// 한 번 열린 대화가 끊기면 창을 닫지 않고 상단에 상태를 보이며 다시 연결한다.
// 건 쪽(발신측)이 ICE 재시작 offer 를 보내고, 받는 쪽이 answer 로 답한다(둘 다 시그널 'ice' 로 주고받음). 3분 안에 안 되면 안내만 하고 창은 그대로 둔다.
function _peerHandleText(peer) {
  return (!peer.nickname || peer.nickname === peer.handle) && peer.handle ? '@' + String(peer.handle).replace(/^@/, '') : '';
}
function _setPeerBarStatus(text) { try { const hd = document.getElementById('peer-handle'); if (hd) hd.textContent = text; } catch {} }

async function _icerestartHandler(conn, peer, sig) {
  if (sig.type !== 'ice' || sig.from_guid !== peer.guid) return;
  const p = typeof sig.payload === 'string' ? JSON.parse(sig.payload) : (sig.payload || {});
  if (p.bye) { _endP2PSession({ byPeer: true }); return; }
  try {
    if (p.restartOffer && peer.__incoming) {
      await conn.setRemoteDescription(new RTCSessionDescription(p.restartOffer));
      const ans = await conn.createAnswer();
      await conn.setLocalDescription(ans);
      await _waitForIce(conn, 3000);
      await _signalSend({ from_guid: _USER.ipv6, to_guid: peer.guid, type: 'ice', payload: { restartAnswer: conn.localDescription, callId: p.callId } });
    } else if (p.restartAnswer && !peer.__incoming) {
      if (conn.signalingState === 'have-local-offer') await conn.setRemoteDescription(new RTCSessionDescription(p.restartAnswer));
    } else if (p.candidate && conn.remoteDescription) {
      await conn.addIceCandidate(new RTCIceCandidate(p.candidate)).catch(() => {});
    }
  } catch (e) { console.warn('[P2P] 재연결 신호 처리 실패:', e.message); }
}

function _onLinkLost(conn, peer, callId) {
  if (conn.__lost) return;
  conn.__lost = true;
  window.__p2pLinkLost = true;
  const t0 = Date.now();
  const name = peer.nickname || peer.handle || '상대';
  _setPeerBarStatus('연결 끊김 — 다시 연결하는 중…');
  appendBubble('system', `⚠️ ${name}님과 연결이 잠시 끊겼습니다. 자동으로 다시 연결합니다. 대화창은 그대로 둡니다.`);
  _startPoll(_USER.ipv6, sig => _icerestartHandler(conn, peer, sig));
  const tick = async () => {
    if (!conn.__lost || _rtcConn !== conn || window.__p2pEnded) return;
    if (Date.now() - t0 > 180000) {
      _setPeerBarStatus('연결 끊김');
      appendBubble('system', `⚠️ ${name}님과 다시 연결하지 못했습니다. 위쪽 "종료"를 누른 뒤 다시 호출해 주세요. (자동으로 닫지는 않습니다)`);
      return;
    }
    if (!peer.__incoming) {   // 건 쪽만 재시작 offer 를 보낸다(양쪽이 동시에 보내 충돌하는 것을 막는다)
      try {
        if (conn.restartIce) conn.restartIce();
        const off = await conn.createOffer({ iceRestart: true });
        await conn.setLocalDescription(off);
        await _waitForIce(conn, 3000);
        await _signalSend({ from_guid: _USER.ipv6, to_guid: peer.guid, type: 'ice', payload: { restartOffer: conn.localDescription, callId } });
      } catch (e) { console.warn('[P2P] ICE 재시작 실패:', e.message); }
    }
    conn.__lostTimer = setTimeout(tick, 10000);
  };
  tick();
}

function _onLinkRecovered(conn, peer) {
  conn.__lost = false;
  window.__p2pLinkLost = false;
  if (conn.__lostTimer) { clearTimeout(conn.__lostTimer); conn.__lostTimer = null; }
  _setPeerBarStatus(_peerHandleText(peer));
  appendBubble('system', `✅ ${peer.nickname || peer.handle || '상대'}님과 다시 연결됐습니다.`);
}

// ── DataChannel 공통 설정 ─────────────────────────────────
function _setupChannel(channel) {
  channel.onopen = () => {
    // BUG-FIX(2026-07-02): 데이터채널이 실제로 열리는 이 순간이 "진짜
    // 연결됨" — 여기서만 메인 대화창으로 전환하고 AI 패널을 닫는다
    // (사용자 요청 사양: 무응답/연결 중에는 AI 패널이 살아있어야 함).
    // 수신측 연결 타임아웃도 여기서 전부 해제 — 정상 연결됐으니 더 이상
    // 필요 없다.
    for (const t of _calleeConnectTimers.values()) clearTimeout(t);
    _calleeConnectTimers.clear();
    if (_rtcConn) _rtcConn.__everOpen = true;
    diag('채널:열림', { ms: _dt(), peerSet: !!_peerInfo });
    // 연결 유지 신호 — 통신망·공유기가 오래 조용한 연결을 끊지 않게 10초마다 보낸다.
    channel.__ka = setInterval(() => { if (channel.readyState === 'open') { try { channel.send('{"type":"ping"}'); } catch {} } }, 10000);
    if (_peerInfo) _activatePeerInMainChat(_peerInfo);
  };

  channel.onmessage = e => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'ping') return;   // 연결 유지 신호
      if (msg.type === 'bye') {
        channel.__ending = true;
        // 상대가 끝냈다 — 저장하고 "종료됨" 상태로 두되, 읽던 대화가 사라지지 않게 창은 사용자가 정할 때까지 남긴다.
        _endP2PSession({ byPeer: true });
        return;
      }
      const peerName = _peerInfo?.nickname || _peerInfo?.handle || '상대방';
      appendBubble('peer', msg.text, false, peerName);
      _p2pMessages.push({ role: 'peer', content: msg.text, ts: msg.ts || new Date().toISOString() });
    } catch {
      const peerName = _peerInfo?.nickname || _peerInfo?.handle || '상대방';
      appendBubble('peer', String(e.data), false, peerName);
      _p2pMessages.push({ role: 'peer', content: String(e.data), ts: new Date().toISOString() });
    }
  };

  channel.onclose = () => {
    diag('채널:닫힘', { ms: _dt(), ending: !!channel.__ending });
    if (channel.__ka) { clearInterval(channel.__ka); channel.__ka = null; }
    // 내가 끝냈거나 상대가 종료 신호를 보낸 정상 종료에는 따로 안내하므로(복귀 메시지) 여기서는 찍지 않는다. 네트워크 끊김처럼 예기치 않은 닫힘만 알린다.
    if (channel.__ending || !_peerInfo) return;
    appendBubble('system', '채널이 닫혔습니다.');
  };
}

// ── ICE 수집 완료 대기 ────────────────────────────────────
function _waitForIce(conn, timeout = 2000) {
  return new Promise(resolve => {
    if (conn.iceGatheringState === 'complete') { resolve(); return; }
    const done = () => { conn.removeEventListener('icegatheringstatechange', check); resolve(); };
    const check = () => { if (conn.iceGatheringState === 'complete') done(); };
    conn.addEventListener('icegatheringstatechange', check);
    setTimeout(done, timeout);
  });
}

// ── 시그널 전송 ③: L1 직접 (2026-06-23 이관) ──────────────
async function _signalSend(body) {
  // 이전: PROXY /signal/send → Worker → L1
  // 이후: L1 직접 (Worker 경유 없음)
  const _t0 = Date.now();
  const d = await _signalSendDirect(body.from_guid, body.to_guid, body.type, body.payload);
  // 2026-11-19(주피터 지시, 진단) — 알림이 가기도 하고 안 가기도 하는 원인을 가리기 위해 서버의 푸시 결과와 걸린 시간을 남긴다.
  // push 값: sent(발송 성공) / no_subscription(구독 없음) / failed(전 기기 실패) / error(상대 프로필 조회 실패) / config(서버 설정 없음) / timeout(4초 안에 못 끝남)
  if (body.type === 'offer') {
    const _pr = (d && d.push) || '(응답 없음)';
    diag('호출:알림결과', { push: _pr, 서버응답ms: Date.now() - _t0, to: String(body.to_guid || '').slice(0, 8) });
    try { appendBubble('system', `🔔 [진단] 상대 알림 발송 결과: ${_pr} (${Date.now() - _t0}ms) — 전체 기록은 "진단" 입력`); } catch {}
  }
  // 2026-11-16 — 상대 기기에 푸시 구독이 없으면 알림으로 깨울 수 없다. 앱이 열려 있을 때만 받는다는 것을 알린다.
  if (body.type === 'offer' && d && d.push === 'no_subscription') {
    try { _notify('ℹ️ 상대 기기에 알림이 켜져 있지 않아, 상대가 나비웹을 열어 둔 동안에만 호출이 전달됩니다. 상대에게 알림 허용을 부탁해 보세요.'); } catch {}
  }
}

// ── 시그널 폴링 ───────────────────────────────────────────
function _startPoll(myGuid, handler, { autoDelete = true } = {}) {
  _stopPoll();
  _pollInterval = setInterval(async () => {
    try {
      const signals = await _signalPollDirect(myGuid);
      for (const sig of signals) {
        await handler(sig);
        // 처리 후 삭제 — L1 직접 DELETE. autoDelete=false면 handler가
        // 이미 자기 책임으로 지웠다는 뜻(_handleSignalRow 등) — 중복 DELETE로
        // 404가 또 나는 걸 막기 위해 여기서는 건너뛴다.
        if (autoDelete) await _signalDeleteDirect(sig.id);
      }
    } catch(e) { console.warn('[P2P] 폴링 오류:', e.message); }
  }, 1500);
}

function _stopPoll() {
  if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
}

// ── 채팅 UI ───────────────────────────────────────────────
// 막지 않는(non-blocking) 연결 요청 확인 모달 — confirm()을 대체한다.
// confirm()은 메인 스레드를 동기적으로 막아 그 직전에 시작한 오디오
// 재생이 다이얼로그가 닫힐 때까지 들리지 않는 문제가 있었다(p2p-chat.js
// handleIncomingOffer 호출부 주석 참고).
function _showIncomingCallModal(fromHandle) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed;inset:0;z-index:9998',
      'background:rgba(0,0,0,0.4)',
      'display:flex;align-items:center;justify-content:center',
    ].join(';');

    overlay.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:24px;
                  width:min(320px,85vw);text-align:center;
                  box-shadow:0 10px 30px rgba(0,0,0,0.2)">
        <div style="font-size:calc(2rem*var(--hondi-fs,1));margin-bottom:8px">📞</div>
        <div style="font-size:calc(1rem*var(--hondi-fs,1));font-weight:600;color:#111827;margin-bottom:4px">
          ${fromHandle}님의 연결 요청
        </div>
        <div style="font-size:calc(0.8125rem*var(--hondi-fs,1));color:#6b7280;margin-bottom:20px">
          수락하시겠습니까?
        </div>
        <div style="display:flex;gap:8px">
          <button id="_p2p-decline"
            style="flex:1;padding:11px;border:none;border-radius:10px;
                   background:#f3f4f6;color:#374151;font-size:calc(0.875rem*var(--hondi-fs,1));
                   font-weight:600;cursor:pointer;font-family:inherit">거절</button>
          <button id="_p2p-accept"
            style="flex:1;padding:11px;border:none;border-radius:10px;
                   background:#1A73E8;color:#fff;font-size:calc(0.875rem*var(--hondi-fs,1));
                   font-weight:600;cursor:pointer;font-family:inherit">수락</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const cleanup = (result) => {
      if (_activeModalDismiss === dismiss) _activeModalDismiss = null;
      overlay.remove();
      resolve(result);
    };
    // 발신측이 통화를 취소했을 때(_handleIncomingCancel) 사용자가 버튼을
    // 누르지 않아도 이 모달을 강제로 닫기 위한 훅 (2026-07-02 신설)
    const dismiss = (reason) => {
      cleanup(false);
      if (reason) appendBubble('system', reason);
    };
    _activeModalDismiss = dismiss;

    overlay.querySelector('#_p2p-accept').onclick  = () => cleanup(true);
    overlay.querySelector('#_p2p-decline').onclick = () => cleanup(false);
  });
}

// BUG-FIX(2026-07-02): _openChatUI()(별도 풀스크린 오버레이 #_p2p-overlay
// 생성), _appendMsg(#_p2p-messages에 직접 innerHTML+= 렌더링), _esc()는
// 전부 그 별도 오버레이 전용이었다 — 메인 채팅 통합(appendBubble/peer-bar/
// _activatePeerInMainChat) 리팩터링으로 완전히 대체되어 삭제한다.

// ── 종료 후 나만의 AI 비서 화면 복귀 ─────────────────────
// 2026-11-18(주피터 지시): 상대와의 대화가 끝나면 AI 비서의 이전 대화를 되살리고, "○○님과의 대화창을 닫았으며 나만의 AI 비서로 복귀하였습니다"를
// 보여 준다. 지금 누구와 대화 중인지 헷갈리지 않게 하기 위해서다. 상대와의 대화 원문은 PDV 에 저장되므로 화면에서는 치운다.
function _restoreAIChat(peerName) {
  const nodes = _aiChatNodes; _aiChatNodes = null;
  const text = peerName
    ? `${peerName}님과 대화를 종료했습니다.`
    : '대화를 종료했습니다.';
  const pm = document.getElementById('ai-panel-messages');
  if (pm) {
    pm.replaceChildren(...(nodes || []));
    pm.querySelectorAll('.streaming').forEach(el => el.classList.remove('streaming'));
    // 안내를 패널을 열기 전에 먼저 넣는다 — 화면이 비어 있으면 openAIPanel() 이 첫 인사를 다시 시작한다.
    const row = document.createElement('div');
    row.className = 'msg-row system';
    const bubble = document.createElement('div');
    bubble.className = 'bubble bubble-system';
    bubble.textContent = text;
    row.appendChild(bubble);
    pm.appendChild(row);
    pm.scrollTop = pm.scrollHeight;
  }
  try { if (typeof window.openAIPanel === 'function') window.openAIPanel(); } catch {}
  // AI 패널이 화면에 없는 환경(PC 등)에서는 보이는 메인 대화 목록에도 안내를 남긴다.
  try {
    const r = pm && pm.getBoundingClientRect();
    const visible = pm && r.height > 0 && r.width > 0 && pm.offsetParent !== null;
    if (!visible) appendBubble('system', text);
  } catch { appendBubble('system', text); }
}

// ── P2P 종료 ─────────────────────────────────────────────
// 2026-11-18(주피터 지시) — 종료를 두 단계로 나눈다.
//  ① _endP2PSession : 연결을 끊고 대화 원문을 저장한다. 대화창은 그대로 둔다(읽을 수 있게). 이어서 "창을 닫을까요?" 팝업.
//  ② _leavePeerWindow : 창을 닫고 나만의 AI 비서의 이전 대화로 돌아간다. 팝업에서 "예"를 누르거나 상단 "대화창 닫기"를 누르면 실행.
function _confirmModal(message, yesLabel, noLabel) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:24px';
    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;color:#111;border-radius:14px;padding:20px 18px 14px;max-width:320px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.25)';
    const msg = document.createElement('div');
    msg.style.cssText = 'font-size:15px;line-height:1.5;margin-bottom:16px;white-space:pre-line';
    msg.textContent = message;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
    const mk = (label, primary, val) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'padding:8px 14px;border-radius:8px;font-size:14px;cursor:pointer;border:1px solid #d1d5db;' +
        (primary ? 'background:#2563eb;color:#fff;border-color:#2563eb' : 'background:#fff;color:#374151');
      b.onclick = () => { wrap.remove(); resolve(val); };
      return b;
    };
    row.append(mk(noLabel, false, false), mk(yesLabel, true, true));
    box.append(msg, row); wrap.appendChild(box); document.body.appendChild(wrap);
  });
}

function _peerDisplayName() { return _peerInfo ? (_peerInfo.nickname || _peerInfo.handle || '상대방') : ''; }

async function _endP2PSession({ byPeer = false } = {}) {
  if (!_peerInfo || window.__p2pEnded) return;
  window.__p2pEnded = true;
  const name = _peerDisplayName();
  _stopPoll();
  _activeCallId = null;
  _activeCallIdCallee = null;
  for (const t of _calleeConnectTimers.values()) clearTimeout(t);
  _calleeConnectTimers.clear();

  if (typeof window._tutorialSignal === 'function') window._tutorialSignal('search_flow_done');

  if (!byPeer && _USER?.ipv6) {
    // 상대방에게 종료 신호 전송 (DataChannel 우선, 실패 시 signal 경유)
    try {
      if (_rtcChannel && _rtcChannel.readyState === 'open') {
        _rtcChannel.send(JSON.stringify({ type: 'bye', ts: new Date().toISOString() }));
      }
    } catch(e) { console.warn('[P2P] bye DataChannel 전송 실패:', e.message); }
    _signalSendDirect(_USER.ipv6, _peerInfo.guid, 'ice', { bye: true }).catch(() => {});
  }

  if (_rtcChannel) { _rtcChannel.__ending = true; try { _rtcChannel.close(); } catch {} setRtcChannel(null); }
  if (_rtcConn)    { try { _rtcConn.close(); } catch {} setRtcConn(null); }

  // 대화 원문 PDV 저장 + OpenHash 앵커링 (한 번만)
  if (_p2pMessages.length > 0) {
    _saveP2PSession(_p2pMessages, _peerInfo, _sessionStart)
      .catch(e => console.warn('[P2P] PDV 저장 실패 (무시):', e.message));
    _p2pMessages = [];
  }
  window.__naviCallBusy = false;

  // 화면: 창은 남기고 "종료됨" 표시. 위쪽 단추는 "대화창 닫기"로 바뀐다.
  appendBubble('system', byPeer ? `🔴 ${name}님이 대화를 종료했습니다.` : `🔴 ${name}님과의 대화를 종료했습니다.`);
  _markPeerBarEnded(name);

  const yes = await _confirmModal(
    byPeer ? `${name}님이 대화를 종료했습니다.\n메인 채팅창(나만의 AI 비서)으로 돌아갈까요?`
           : `${name}님과의 대화창을 닫을까요?\n닫으면 나만의 AI 비서로 돌아갑니다.`,
    byPeer ? '돌아가기' : '닫기',
    '아니오(대화 읽기)'
  );
  if (yes) _leavePeerWindow();
  else appendBubble('system', '대화창을 그대로 두었습니다. 다 읽으신 뒤 위쪽 "대화창 닫기"를 누르면 나만의 AI 비서로 돌아갑니다.');
}

function _markPeerBarEnded(name) {
  try {
    const hd = document.getElementById('peer-handle');
    if (hd) hd.textContent = '대화 종료됨';
    setPeerLabel(`${name}님과 대화 (종료됨)`);
    const btn = document.getElementById('peer-close-btn');
    if (btn) { const t = btn.querySelector('.lbl'); if (t) t.textContent = '대화창 닫기'; }
    const inp = document.getElementById('msg-input');
    if (inp) inp.placeholder = '종료된 대화입니다 — 위쪽 "대화창 닫기"를 누르세요';
  } catch {}
}

function _leavePeerWindow() {
  const name = _peerDisplayName();
  window.__p2pEnded = false;
  _clearPeer({ silent: true });
  _peerInfo = null;
  _sessionStart = null;
  try { const b = document.getElementById('peer-close-btn'); const t = b && b.querySelector('.lbl'); if (t) t.textContent = '종료'; } catch {}
  // 나만의 AI 비서의 이전 대화를 되살리고 누구와의 대화가 끝났는지 알린다.
  _restoreAIChat(name);
}

// 위쪽 단추(peer-bar) — 진행 중이면 종료(+팝업), 이미 종료된 창이면 곧바로 닫고 복귀
function _closeP2P() {
  if (window.__p2pEnded) { _leavePeerWindow(); return; }
  _endP2PSession();
}

// ── P2P 세션 PDV 저장 + OpenHash 앵커링 ─────────────────
// 설계:
//   원본 = { sessionId, myGuid, peerGuid, peerHandle, startedAt, endedAt, messages[] }
//   vault.js → IndexedDB AES-256-GCM 저장 (원본 보관)
//   contentHash = SHA-256(원본)
//   userSig = gopangWallet.sign(contentHash)
//   hashChain.anchor(contentHash, [userSig], sessionId)
//   T-C: L1 pdv_records 직접 POST { block_hash: entryHash } (+ entryHash 있으면 anchor_records도 직접 POST)
async function _saveP2PSession(messages, peer, startedAt) {
  const { _USER } = await import('../core/state.js');
  if (!_USER?.ipv6) return;

  const now       = new Date().toISOString();
  // 6하원칙 — 누구와(who) 언제(when) 어디서(where) 무엇을(what) 어떻게(how) 왜(why)
  const _st = await import('../core/state.js');
  const _loc = _st._userLocation;
  const _myName = _USER.nickname || _USER.handle || '나';
  const _peerName = peer.nickname || peer.handle || '상대';
  const _first = (messages.find(m => m.role === 'peer') || messages[0] || {}).content || '';
  const sixW = {
    who:   { me: _myName, peer: _peerName, peerHandle: peer.handle || '' },
    when:  { start: startedAt || now, end: now },
    where: (_loc && (_loc.address || (_loc.lat ? `${Number(_loc.lat).toFixed(4)},${Number(_loc.lng).toFixed(4)}` : null)))
           || _USER.region || '위치 정보 없음(위치 허용 시 기록)',
    what:  `${_peerName}님과 ${messages.length}번 주고받음` + (_first ? ` — "${String(_first).slice(0, 40)}"` : ''),
    how:   '나비웹 1:1 대화(P2P 암호화 채널)',
    why:   peer.__incoming ? `${_peerName}님의 대화 요청을 수락해 시작` : `${_peerName}님에게 대화를 요청해 시작`,
  };
  const sessionId = `P2P-${_USER.ipv6.replace(/:/g,'').slice(0,12)}-${Date.now()}`;

  // ① 세션 원본 구성
  const sessionData = {
    sessionId,
    type:      'p2p_conversation',
    myGuid:    _USER.ipv6,
    myHandle:  _USER.handle,
    peerGuid:  peer.guid,
    peerHandle: peer.handle,
    peerNickname: peer.nickname || peer.handle,
    startedAt: startedAt || now,
    endedAt:   now,
    turns:     messages.length,
    sixW,
    messages,  // 대화 원문 전체
  };
  const sessionRaw = JSON.stringify(sessionData);

  // ② contentHash = SHA-256(sessionRaw)
  const buf         = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sessionRaw));
  const contentHash = Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');

  // ③ Ed25519 서명 (vault 저장 전에 먼저 생성)
  let userSig = _USER.ipv6;
  try {
    if (window.gopangWallet?.sign) {
      userSig = await window.gopangWallet.sign(contentHash);
    }
  } catch(e) {
    console.warn('[P2P] Ed25519 서명 실패, guid로 대체:', e.message);
  }

  // ④ 원본 저장 — 공용 PC 세션이면 로컬 vault 대신 폰으로 릴레이한다
  //    (2026-07-23 신설, 5단계 — B안: 폰이 오프라인이면 유실 감수).
  if (sessionStorage.getItem('gopang_pc_session_mode') === 'shared' && _USER?.ipv6) {
    try {
      await window.GopangWallet?.relayContentToPhone?.(_USER.ipv6, sessionRaw);
      console.info('[P2P] 공용 PC — 원문을 폰으로 릴레이함(이 기기엔 저장 안 함)');
    } catch (e) {
      console.warn('[P2P] 공용 PC 원문 릴레이 실패 (무시 — 이 PC엔 원문을 남기지 않음, B안):', e.message);
    }
  } else {
    try {
      const { storeMessage } = await import('../../pdv/vault.js');
      const pubKeyB64 = window.gopangWallet?.publicKeyB64u || '';
      await storeMessage({
        msgId:           sessionId,
        senderId:        _USER.ipv6,
        senderPubKeyB64: pubKeyB64,
        signature:       userSig || _USER.ipv6,
        role:            'p2p_session',
        content:         sessionRaw,
        timestamp:       now,
        riskLevel:       'S0',
        sessionId,
      });
      console.info('[P2P] vault 저장 완료 | sessionId:', sessionId);
    } catch(e) {
      console.warn('[P2P] vault 저장 실패 (무시):', e.message);
    }
  }

  // ⑤ OpenHash 앵커링
  let entryHash = null;
  let layer     = null;
  try {
    const { anchor } = await import('../../openhash/hashChain.js');
    const result = await anchor(contentHash, [userSig], sessionId);
    entryHash    = result.entryHash;
    layer        = result.layer;
    console.info('[P2P] OpenHash 앵커링 완료',
      '| contentHash:', contentHash.slice(0,16),
      '| entryHash:', entryHash.slice(0,16),
      '| layer:', layer);
  } catch(e) {
    console.warn('[P2P] OpenHash 앵커링 실패 (무시):', e.message);
  }

  // ⑥ localStorage 백업
  try {
    const today = now.slice(0,10);
    const key   = `gopang_history_${_USER.ipv6}_${today}`;
    const existing = JSON.parse(localStorage.getItem(key) || '[]');
    existing.push({
      ts:        now,
      domain:    'P2P',
      turns:     messages.length,
      sessionId,
      entryHash,
      peerHandle: peer.handle,
      peerNickname: peer.nickname || peer.handle,
      sixW,
      summary:   messages.slice(-4),
    });
    localStorage.setItem(key, JSON.stringify(existing));
  } catch(e) {
    console.warn('[P2P] localStorage 백업 실패:', e.message);
  }

  // ⑦ T-C: L1 pdv_records 직접 기록 (Worker pdv 리포트 대체)
  {
    const _what  = { summary: `P2P 대화 종료 — ${peer.handle}와 ${messages.length}턴` };
    await fetch(L1_PDV_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guid:         _USER.ipv6,
        report_id:    `${sessionId}:gopang-p2p`,
        reporter_svc: 'gopang-p2p',
        svc:          'gopang',
        type:         'p2p_conversation',
        summary:      _what.summary,
        summary_6w:   JSON.stringify({ who: sixW.who, when: sixW.when, where: sixW.where, what: sixW.what, how: sixW.how, why: sixW.why }),
        block_hash:   entryHash,
        risk_level:   'low',
        source:       'gopang',
        openhash_anchored: !!entryHash,
      }),
    }).catch(e => console.warn('[P2P] L1 pdv_records 전송 실패 (무시):', e.message));

    if (entryHash) {
      fetch(L1_ANCHOR_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry_hash:   entryHash,
          content_hash: contentHash,
          msg_id:       sessionId,
          source:       'pdv_records',
        }),
      }).catch(e => console.warn('[P2P] L1 anchor_records 전송 실패 (무시):', e.message));
    }
  }

  console.info('[P2P] PDV 저장 완료',
    '| sessionId:', sessionId,
    '| turns:', messages.length,
    '| contentHash:', contentHash.slice(0,16),
    '| entryHash:', entryHash?.slice(0,16) ?? 'none',
    '| layer:', layer ?? 'none');
}

// ── 발신측 취소 신호 처리 (2026-07-02 신설) ──────────────
// _handleNoAnswer()가 무응답으로 포기하는 즉시 보내는 신호를 받아서,
// 20초 수신측 자체 타임아웃(최후 방어망)까지 기다리지 않고 바로 반응한다.
// 두 케이스를 구분해야 한다:
//   케이스 A — 아직 "수락하시겠습니까?" 모달이 떠 있는 중
//   케이스 B — 이미 수락해서 연결 시도 중(_peerInfo 세팅됨, datachannel 미개통)
function _handleIncomingCancel(callId) {
  if (!callId) return;

  if (_pendingModalCallId === callId && _activeModalDismiss) {
    _pendingModalCallId = null;
    _activeModalDismiss('상대방이 연결 요청을 취소했습니다.');
    return;
  }

  if (_activeCallIdCallee === callId && _peerInfo) {
    // BUG-FIX(2026-07-02): 취소 신호가 지연 도착해서, 그 사이 실제로는
    // 연결이 이미 성공(datachannel open)했을 수도 있다 — 그 경우엔
    // 절대 끊으면 안 된다. onopen이 이미 타이머를 전부 지웠으므로
    // readyState로 직접 판별한다.
    if (_rtcChannel && _rtcChannel.readyState === 'open') {
      console.info('[P2P] 지연 취소 신호 무시 — 이미 정상 연결됨');
      return;
    }
    // 타이머가 아직 등록 전(_peerInfo 세팅 직후~SDP 처리 중 사이의 좁은
    // 레이스 윈도우)이어도 정리는 그대로 진행한다 — clearTimeout할
    // 대상만 없을 뿐, 나중에 그 타이머가 실제로 fire되더라도
    // `_activeCallIdCallee !== _calleeCallId`(아래서 null로 초기화됨)
    // 가드에 걸려 스스로 no-op된다.
    const t = _calleeConnectTimers.get(callId);
    if (t) { clearTimeout(t); _calleeConnectTimers.delete(callId); }
    console.info('[P2P] 발신측 취소 수신 — 즉시 정리 (callId:', callId, ')');
    appendBubble('system', '상대방이 연결을 취소했습니다.');
    if (_rtcChannel) { try { _rtcChannel.close(); } catch {} setRtcChannel(null); }
    if (_rtcConn)    { try { _rtcConn.close(); }    catch {} setRtcConn(null); }
    _peerInfo = null;
    _activeCallIdCallee = null;
  }
}

// ── 앱 시작 시 incoming offer 감시 ──────────────────────
// 2026-06-28: L1 PocketBase Realtime(SSE)으로 복귀 — 아래 _watchL1Realtime
// 정의부 주석 참고(ERR_INCOMPLETE_CHUNKED_ENCODING은 nginx 설정으로 이미 해결됨).
// 2026-11-19(주피터 지시) — 대화 요청은 오직 설치된 PWA 만 받아 연결한다. PWA 가 설치된 기기에서 브라우저 탭에도 나비웹이 열려 있으면 그 탭은 요청을 무시한다.
//  · 같은 기기의 탭과 PWA 가 같은 요청을 함께 처리하면 수락 팝업이 보이지 않는 탭에 떠 있거나 서로 다른 연결을 만들어 연결이 꼬인다.
//  · PWA 설치 여부는 PWA 창이 열릴 때마다 남기는 navi_pwa_last_standalone(gopang-pwa.js)으로 안다 — 브라우저와 PWA 는 같은 저장소를 쓴다.
//  · 예외: 알림을 눌러 이 탭이 열린 경우(callTap)는 사용자가 이 창을 고른 것이므로 처리한다. PWA 가 없거나 30일 넘게 안 열었으면 이 탭이 처리한다.
//  · 무시한 신호는 지우지 않는다(지우면 PWA 가 못 받는다).
function _leaveIncomingToPwa() {
  try {
    if (matchMedia('(display-mode: standalone)').matches || navigator.standalone === true) return false;   // 이 창이 PWA — 직접 처리
    const last = Number(localStorage.getItem('navi_pwa_last_standalone')) || 0;
    if (!(last > 0) || Date.now() - last > 30 * 86400000) return false;                                   // PWA 없음 — 이 탭이 처리
    if ((window.__naviAcceptUntil || 0) > Date.now()) return false;                                       // 알림을 눌러 연 탭
    return true;
  } catch (e) { return false; }   // 판단 실패 시 예전처럼 처리한다(호출을 놓치지 않는 쪽으로)
}
const _pwaIgnoredLogged = new Set();

export function startIncomingWatch(myGuid) {
  if (!myGuid) return;

  // realtime과 폴백 폴링이 같은 offer 레코드를 동시에 집어올 수 있어서
  // (_watchAnswerRealtime과 동일한 경쟁 — §주석 참고), 레코드 id 단위로
  // 한 번만 처리되게 한다. handleIncomingOffer 안에 callId 기준 중복 체크가
  // 이미 있지만, 그건 "같은 통화를 두 번 안 열기" 용도고 이건 "같은 레코드를
  // 두 번 안 만지기"(중복 DELETE로 404 나던 것 등) 용도라 별개로 둔다.
  const _seenSignalIds = new Set();

  // startIncomingWatch는 앱 시작 시 1회 호출돼 세션 내내 살아있다 — _seenOfferIds
  // (callId 기준, 캡 있음)와 달리 이 Set은 처음에 캡이 없어서, 받은 모든 신호
  // id(offer뿐 아니라 무시한 ice/answer까지)가 무한정 쌓일 뻔했다. 동일하게
  // 캡을 둔다(_watchAnswerRealtime 쪽은 통화 1건마다 새로 생기는 지역 변수라
  // 통화 종료 시 자동 회수되므로 캡이 필요 없음 — 그쪽과는 다른 사정).
  const _SEEN_SIGNAL_CAP = 100;
  async function _handleSignalRow(row) {
    if (_leaveIncomingToPwa()) {   // 브라우저 탭 — PWA 에 맡기고 건드리지 않는다
      if (!_pwaIgnoredLogged.has(row.id)) {
        _pwaIgnoredLogged.add(row.id); if (_pwaIgnoredLogged.size > 100) _pwaIgnoredLogged.delete(_pwaIgnoredLogged.values().next().value);
        diag('수신:브라우저 탭은 PWA 에 맡김(무시)', { type: row.type, via: row.__via || '?' });
      }
      return;
    }
    if (_seenSignalIds.has(row.id)) return;
    _seenSignalIds.add(row.id);
    if (_seenSignalIds.size > _SEEN_SIGNAL_CAP) {
      _seenSignalIds.delete(_seenSignalIds.values().next().value);
    }

    // ── 발신측 취소 신호 (2026-07-02 신설) ──────────────
    // _handleNoAnswer()가 무응답 포기 시점에 즉시 보내는 신호. 여기서
    // 처리해야 하는 이유: 이 시점엔 아직 handleIncomingOffer가 시작도
    // 안 됐을 수 있고(모달 표시 중), 이미 수락해서 연결 시도 중일 수도
    // 있다 — 두 경우 다 이 최상위 감시자에서만 한 곳에서 처리 가능하다.
    if (row.type === 'ice') {
      const _p = typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload || {});
      if (_p.cancel) {
        diag('발신측 취소 수신', { callId: String(_p.callId || '').slice(0, 8) });
        _handleIncomingCancel(_p.callId);
        _signalDeleteDirect(row.id);
        return;
      }
    }

    if (row.type === 'offer' && _busyWithPeer(row.from_guid)) diag('호출:무시(이미 연결 시도 중)', { via: row.__via || '?' });
    if (row.type === 'offer' && !_busyWithPeer(row.from_guid)) {
      await handleIncomingOffer(row);
      _signalDeleteDirect(row.id);
    }
  }

  // L1 PocketBase 자체 Realtime(SSE)으로 incoming offer 감시.
  // 이전엔 "PocketBase SSE가 ERR_INCOMPLETE_CHUNKED_ENCODING으로 실패"해서
  // Supabase Realtime WebSocket으로 교체했었지만, 서버(nginx proxy_buffering
  // off 적용됨)에서 curl로 직접 재확인한 결과 SSE가 정상 동작한다(2026-06-28).
  // 막혔던 이유는 이미 해결돼 있었다 — 그래서 L1 자체 realtime으로 되돌린다.
  _watchL1Realtime(myGuid, (row) => { try { row.__via = '실시간(SSE)'; } catch {} return _handleSignalRow(row); });

  // 폴백: realtime이 못 잡은 offer를 3초 폴링으로 보완(같은 핸들러 재사용 —
  // _seenSignalIds가 있어서 realtime이 이미 처리한 레코드는 자동으로 건너뜀)
  // BUG-FIX(2026-07-02): 기존엔 _peerInfo가 세팅돼 있으면(=막 수락해서
  // 연결 시도 중) 이 폴링 전체를 건너뛰었다 — 그런데 그 상태에서 발신측이
  // 보내는 취소 신호도 'ice' 타입 시그널이라, 하필 그걸 가장 받아야 할
  // 때 못 받는 모순이 있었다. 취소 신호는 _peerInfo 여부와 무관하게 항상
  // 처리하고, 새 offer 수락만 계속 막는다.
  setInterval(async () => {
    try {
      const signals = await _signalPollDirect(myGuid);
      for (const sig of signals) {
        if (sig.type === 'ice') {
          const _p = typeof sig.payload === 'string' ? JSON.parse(sig.payload) : (sig.payload || {});
          if (_p.cancel) { await _handleSignalRow(sig); continue; }
        }
        if (sig.type === 'offer' && !_busyWithPeer(sig.from_guid)) { try { sig.__via = '폴링(3초)'; } catch {} await _handleSignalRow(sig); break; }
      }
    } catch {}
  }, 3000);
}
// ── 발신 메시지 기록 (2026-07-02 신설) ───────────────────
// 메인 입력창(#msg-input)으로 보낸 메시지는 이제 send-message.js →
// webrtc.js _sendP2P()를 거친다 — 그 경로는 이 파일의 _p2pMessages(세션
// 종료 시 _saveP2PSession()이 PDV/OpenHash에 통째로 저장하는 원문 누적
// 배열)를 모른다. webrtc.js가 전송 성공 직후 이 함수를 호출해 채운다.
export function _recordOutgoingP2PMsg(text, ts) {
  _p2pMessages.push({ role: 'me', content: text, ts: ts || new Date().toISOString() });
}

window._closeP2P = _closeP2P;

// ── "상대방 AI 비서에게 메시지 남기기" (2026-07-02 신설, 3단계) ─────────
// L1(hanlim)에 새로 만든 p2p_pending_invites 컬렉션에 기록한다.
// pdv_records와 동일한 신뢰 모델(공개 create/list — 이 앱 전체가 그렇듯
// 실제 PocketBase 계정 인증이 아니라 guid 자체를 식별자로 쓰기 때문에,
// 다른 L1 컬렉션들과 다른 잣대를 적용할 이유가 없다)을 따른다.
async function _leaveInviteForPeerAI(targetUser) {
  const myName = _USER?.nickname || _USER?.handle || '누군가';
  const res = await fetch(L1_P2P_INVITES_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from_guid:     _USER.ipv6,
      from_handle:   _USER.handle || '',
      from_nickname: myName,
      to_guid:       targetUser.guid,
      message:       `${myName}님이 대화를 시도했습니다.`,
      status:        'pending',
    }),
  });
  if (!res.ok) throw new Error(`invite 저장 실패: HTTP ${res.status}`);
  // 상대가 앱을 닫아 둔 경우를 위해 웹푸시로 즉시 알린다(실패해도 초대 저장은 유효).
  notifyInvite(targetUser.guid).catch(() => {});
}

// ── 받은 초대 확인 (앱 시작 시 1회) ──────────────────────
// 무응답으로 남겨진 초대를 내가 다시 접속했을 때 알려준다. LLM(AGENT-COMMON)
// 프롬프트에 끼워 넣는 방식 대신, 신뢰성이 더 높은 결정적(deterministic)
// 방식 — 발견 즉시 메인 채팅에 시스템 메시지로 바로 띄우고 status를
// 'seen'으로 표시해 다음 접속 때 중복 표시되지 않게 한다.
export async function checkPendingInvites(myGuid) {
  if (!myGuid) return;
  try {
    const filter = encodeURIComponent(`to_guid='${myGuid}' && status='pending'`);
    const res = await fetch(`${L1_P2P_INVITES_URL}?filter=${filter}&sort=created&perPage=20`);
    if (!res.ok) return;
    const data = await res.json();
    const items = data.items || [];
    for (const inv of items) {
      appendBubble('system', `💬 ${inv.message || (inv.from_nickname + '님이 대화를 시도했습니다.')}`);
      // 다시 알리지 않도록 seen 처리 (실패해도 치명적이지 않음 — 다음
      // 접속 때 한 번 더 보이는 정도)
      fetch(`${L1_P2P_INVITES_URL}/${inv.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status: 'seen' }),
      }).catch(() => {});
    }
  } catch (e) {
    console.warn('[P2P] 받은 초대 확인 실패 (무시):', e.message);
  }
}
