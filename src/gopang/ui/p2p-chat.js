/**
 * ui/p2p.js — WebRTC P2P 채팅 모듈 (GDUDA Phase 1)
 * - CF Worker /signal/* 경유 시그널링 (SDP/ICE 60초 TTL)
 * - 메시지 본문은 서버 저장 없음 — 순수 P2P
 * - from/to 모두 handle 기준 (전세계 유일)
 */
import {
  PROXY, L1_SIGNAL_BASE, L1_PDV_URL, L1_ANCHOR_URL, L1_URL, L1_P2P_INVITES_URL, RTC_CONFIG, _USER,
  setRtcConn, setRtcChannel, setSignalPoll, setPeerState,
  _rtcConn, _rtcChannel, _signalPoll,
} from '../core/state.js';
import { appendBubble } from './bubble.js';
// _clearPeer는 webrtc.js가 정의(peer-bar 숨기기·입력창 placeholder 복원·
// "AI 비서와 대화합니다" 안내까지 이미 다 되어있다 — 여기서 새로 안 만들고
// 재사용한다). webrtc.js→p2p-chat.js는 동적 import(순환 없음)이므로 반대
// 방향(정적 import)은 안전하다.
import { _clearPeer } from '../p2p/webrtc.js';

// ── 탈중앙화 이관 ③: 시그널링 전송/수신/삭제를 L1 직접으로 ──────────────
// Worker가 이미 L1 webrtc_signals 컬렉션을 직접 쓰는 구조이므로,
// 단말도 같은 경로로 직접 접근. Worker 경유 불필요.
const _L1_SIGNAL = L1_SIGNAL_BASE;

async function _signalSendDirect(from_guid, to_guid, type, payload) {
  const expires_at = new Date(Date.now() + 60_000).toISOString();
  const res = await fetch(_L1_SIGNAL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ from_guid, to_guid, type, payload, expires_at }),
  });
  if (!res.ok) throw new Error(`L1 signal send ${res.status}`);
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
  await fetch(`${_L1_SIGNAL}/${id}`, { method: 'DELETE' }).catch(() => {});
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
  if (hd) hd.textContent = peer.handle ? '@' + peer.handle.replace(/^@/, '') : '';
  if (bar) bar.style.display = 'flex';
  const mainInput = document.getElementById('msg-input');
  if (mainInput) mainInput.placeholder = `${peer.nickname || peer.handle || '상대방'}에게 메시지…`;
  if (typeof window.closeAIPanel === 'function') window.closeAIPanel();
  appendBubble('system', `🔗 ${peer.nickname || peer.handle}님과 연결됐습니다.`);
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
  // 이전 시도(재연결 등)가 정리되지 않고 남아있으면 먼저 로컬 정리.
  // (이전 watcher는 _activeCallId가 바뀌는 즉시 스스로 종료됨 — 아래 참고)
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
  _p2pMessages  = [];
  _sessionStart = new Date().toISOString();

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
    payload:   { sdp: conn.localDescription, from_handle: _USER.handle, callId },
  });

  // BUG-FIX(2026-07-02): 예전엔 여기서 _openChatUI()로 완전히 별도의
  // 풀스크린 오버레이를 띄웠다 — AI 패널도 메인 대화창도 아닌 제3의 화면.
  // "전화 거는 중"에는 아무 UI 전환도 하지 않는다 — AI 패널을 통해 통화를
  // 시작했다면 그 패널이 계속 살아있어야, 무응답일 때 거기에 안내를 띄울
  // 수 있다(사용자 요청 사양). 실제로 연결됐을 때만
  // _activatePeerInMainChat()이 메인 대화창으로 전환한다.
  _notify(`📞 ${targetUser.nickname || targetUser.handle}님께 연결 요청을 보냈습니다...`);

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

  function _close() {
    done = true;
    if (noAnswerTimer) { clearTimeout(noAnswerTimer); noAnswerTimer = null; }
    if (stopRealtime) { stopRealtime(); stopRealtime = null; }
    _stopPoll();
  }

  // ── 무응답 타임아웃 (2026-07-02 신설) ─────────────────
  // offer를 보낸 지 25초 안에 answer가 안 오면 "무응답"으로 간주한다.
  // 서버 시그널 TTL(60초)보다 짧게 잡아, 상대가 아예 안 받는 상황을
  // TTL 만료까지 기다리지 않고 사용자에게 먼저 알린다.
  const NO_ANSWER_MS = 25000;
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
        await conn.setRemoteDescription(new RTCSessionDescription(answerSdp));
        if (noAnswerTimer) { clearTimeout(noAnswerTimer); noAnswerTimer = null; } // 응답 왔으니 무응답 타이머 해제
        _notify('✅ 연결됐습니다. 채널이 열리면 메시지를 입력하세요.');
        console.info('[P2P] answer 수신 완료');
        // answer 수신 후 잠시 뒤 watcher 종료 (ICE는 ondatachannel onopen 후 불필요)
        setTimeout(_close, 10000);
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

// ── 무응답 처리 (2026-07-02 신설) ────────────────────────
// 사용자 요청 사양: 무응답이면 AI 대화창은 그대로 살아있고, 거기(또는
// 메인 대화창)에 "OO님이 응답하지 않습니다. OO님의 AI 비서에게 대화
// 초대 메시지를 남겼습니다"를 띄운다. "메시지를 남겼다"는 문구는 실제로
// 남기기가 성공했을 때만 붙인다 — 실패하면 그 사실은 숨기지 않는다.
async function _handleNoAnswer(targetUser, callId) {
  const name = targetUser.nickname || targetUser.handle || '상대방';

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
export async function handleIncomingOffer(signal) {
  const fromHandle  = signal.payload?.from_handle || signal.from_guid;
  const fromGuid    = signal.from_guid;

  // payload 방어적 파싱 (webrtc.js/p2p-chat.js 양쪽 호환) — callId 추출용으로 먼저 파싱
  const _offerPayload = typeof signal.payload === 'string'
    ? JSON.parse(signal.payload) : (signal.payload || {});
  const callId = _offerPayload.callId || null;

  // 같은 callId의 offer가 중복 도착(재시도/레이스 컨디션)하면 두 번째부터는 무시
  if (callId) {
    if (_seenOfferIds.has(callId)) {
      console.info('[P2P] 중복 offer 무시 (callId 이미 처리됨):', callId);
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
        body: `${fromHandle}님이 대화를 요청했습니다`,
        icon: '/icons/navi-icon-192.png',
        tag:  'gopang-incoming-call',
        vibrate: [300, 100, 300],
        silent: false,
      });
      console.info('[TEST-SOUND] showNotification 호출 성공');
    } else {
      console.warn('[TEST-SOUND] 알림 권한 없음(permission:', Notification.permission, ') — showNotification 건너뜀');
    }
  } catch (e) { console.warn('[TEST-SOUND] showNotification 실패:', e.message); }

  // 수락 확인 — confirm()은 메인 스레드를 동기적으로 막기 때문에 막지
  // 않는 커스텀 모달을 사용한다.
  // BUG-FIX(2026-07-02): _pendingModalCallId를 세팅해둬야 그 사이 발신측이
  // 포기했을 때(_handleIncomingCancel) 이 모달을 정확히 찾아서 강제로
  // 닫을 수 있다.
  _pendingModalCallId = callId;
  const accepted = await _showIncomingCallModal(fromHandle);
  _pendingModalCallId = null;
  if (!accepted) return;

  _peerInfo = { guid: fromGuid, handle: fromHandle, nickname: fromHandle };
  // BUG-FIX(2026-07-02): 원래 이 아래 SDP 생성·전송 과정(await 여러 번)이
  // 끝난 뒤에야 _activeCallIdCallee를 세팅했는데, 그 사이(비동기 처리
  // 중)에 취소 신호가 도착하면 _handleIncomingCancel의 케이스 B 검사
  // (`_activeCallIdCallee === callId`)가 아직 불일치라 놓쳤다. _peerInfo와
  // 동시에 세팅해 그 레이스 윈도우를 없앤다.
  _activeCallIdCallee = callId;

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

  // BUG-FIX(2026-07-02): 여기서도 발신측과 동일한 이유로 _openChatUI()를
  // 없앴다 — 실제 datachannel이 열릴 때(_setupChannel.onopen)만
  // _activatePeerInMainChat()이 메인 대화창으로 전환한다.
  _notify(`✅ ${fromHandle}님과 연결됐습니다.`);

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
    appendBubble('system', '⚠️ 연결이 시간 초과됐습니다. 상대방이 이미 통화를 종료했을 수 있어요.');
    if (_rtcChannel) { try { _rtcChannel.close(); } catch {} setRtcChannel(null); }
    if (_rtcConn)    { try { _rtcConn.close(); }    catch {} setRtcConn(null); }
    _peerInfo = null;
  }, 20000);
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
      // 실제 메인 대화창 전환은 datachannel이 열릴 때(_setupChannel.onopen)
      // 하지만, ICE 레벨에서도 이미 연결됐다는 저수준 신호를 남겨둔다.
      _notify('🔒 암호화 채널 개설됨.');
    }
    if (state === 'disconnected' || state === 'failed' || state === 'closed') {
      appendBubble('system', '🔴 연결이 끊어졌습니다.');
      _stopPoll();
    }
  };
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
    if (_peerInfo) _activatePeerInMainChat(_peerInfo);
  };

  channel.onmessage = e => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'bye') {
        appendBubble('system', '🔴 상대방이 대화를 종료했습니다.');
        // James 쪽도 PDV 저장 후 종료
        if (_p2pMessages.length > 0 && _peerInfo) {
          _saveP2PSession(_p2pMessages, _peerInfo, _sessionStart)
            .catch(e => console.warn('[P2P] PDV 저장 실패:', e.message));
        }
        setTimeout(() => _closeP2P(), 1500);
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
  await _signalSendDirect(body.from_guid, body.to_guid, body.type, body.payload);
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
        <div style="font-size:32px;margin-bottom:8px">📞</div>
        <div style="font-size:16px;font-weight:600;color:#111827;margin-bottom:4px">
          ${fromHandle}님의 연결 요청
        </div>
        <div style="font-size:13px;color:#6b7280;margin-bottom:20px">
          수락하시겠습니까?
        </div>
        <div style="display:flex;gap:8px">
          <button id="_p2p-decline"
            style="flex:1;padding:11px;border:none;border-radius:10px;
                   background:#f3f4f6;color:#374151;font-size:14px;
                   font-weight:600;cursor:pointer;font-family:inherit">거절</button>
          <button id="_p2p-accept"
            style="flex:1;padding:11px;border:none;border-radius:10px;
                   background:#1A73E8;color:#fff;font-size:14px;
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

// ── P2P 종료 ─────────────────────────────────────────────
function _closeP2P() {
  _stopPoll();
  _activeCallId = null;
  _activeCallIdCallee = null;
  for (const t of _calleeConnectTimers.values()) clearTimeout(t);
  _calleeConnectTimers.clear();

  // BUG-FIX(2026-07-01): 튜토리얼 STEP 4 — 사용자가 검색 결과에서 실제로
  // 상대를 선택해 대화창을 열었다가 닫는 경우, p2p-search.js의
  // _closeSearch()보다 이 시점이 "사용자가 실제로 해본 것"에 더 가깝다.
  // 두 곳 모두 신호를 보내지만 _tutorialSignal 내부에서 이미 진행된
  // 단계는 무시하므로 중복 호출로 인한 부작용은 없다.
  if (typeof window._tutorialSignal === 'function') window._tutorialSignal('search_flow_done');

  // 상대방에게 종료 신호 전송 (DataChannel 우선, 실패 시 signal 경유)
  if (_peerInfo && _USER?.ipv6) {
    // ① DataChannel로 종료 메시지 전송
    try {
      if (_rtcChannel && _rtcChannel.readyState === 'open') {
        _rtcChannel.send(JSON.stringify({ type: 'bye', ts: new Date().toISOString() }));
      }
    } catch(e) { console.warn('[P2P] bye DataChannel 전송 실패:', e.message); }

    // ② signal 경유 종료 알림 (DataChannel 실패 대비) — L1 직접
    _signalSendDirect(_USER.ipv6, _peerInfo.guid, 'ice', { bye: true }).catch(() => {});
  }

  if (_rtcChannel) { _rtcChannel.close(); setRtcChannel(null); }
  if (_rtcConn)    { _rtcConn.close();    setRtcConn(null);    }

  // ── PDV 저장 + OpenHash 앵커링 ───────────────────────
  // P2P 세션 종료 시 대화 원문을 vault에 저장하고 OpenHash에 앵커링
  // (_clearPeer()보다 먼저 — _peerInfo가 아직 남아있어야 세션 메타에 쓸 수 있음)
  if (_p2pMessages.length > 0 && _peerInfo) {
    _saveP2PSession(_p2pMessages, _peerInfo, _sessionStart)
      .catch(e => console.warn('[P2P] PDV 저장 실패 (무시):', e.message));
  }

  // BUG-FIX(2026-07-02): 별도 오버레이 제거 대신, 메인 채팅 통합 리팩터링의
  // 일부로 webrtc.js의 _clearPeer()를 재사용 — peer-bar 숨기기, msg-input
  // placeholder 복원, "🤖 AI 비서와 대화합니다" 안내까지 한 번에 처리된다.
  _clearPeer();

  _peerInfo     = null;
  _p2pMessages  = [];
  _sessionStart = null;
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
      summary:   messages.slice(-4),
    });
    localStorage.setItem(key, JSON.stringify(existing));
  } catch(e) {
    console.warn('[P2P] localStorage 백업 실패:', e.message);
  }

  // ⑦ T-C: L1 pdv_records 직접 기록 (Worker pdv 리포트 대체)
  {
    const _who   = { ipv6: _USER.ipv6, handle: _USER.handle };
    const _when  = { period_start: startedAt || now, period_end: now };
    const _where = { svc_url: 'https://hondi.net' }; // 2026-07-28: gopang.net 브랜드 폐기, hondi.net으로 통일
    const _what  = { summary: `P2P 대화 종료 — ${peer.handle}와 ${messages.length}턴` };
    const _how   = { method: 'WebRTC P2P DataChannel' };
    const _why   = { goal: 'P2P 대화 PDV 기록' };

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
        summary_6w:   JSON.stringify({ who: _who, when: _when, where: _where, what: _what, how: _how, why: _why }),
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
        _handleIncomingCancel(_p.callId);
        _signalDeleteDirect(row.id);
        return;
      }
    }

    if (row.type === 'offer' && !_peerInfo) {
      await handleIncomingOffer(row);
      _signalDeleteDirect(row.id);
    }
  }

  // L1 PocketBase 자체 Realtime(SSE)으로 incoming offer 감시.
  // 이전엔 "PocketBase SSE가 ERR_INCOMPLETE_CHUNKED_ENCODING으로 실패"해서
  // Supabase Realtime WebSocket으로 교체했었지만, 서버(nginx proxy_buffering
  // off 적용됨)에서 curl로 직접 재확인한 결과 SSE가 정상 동작한다(2026-06-28).
  // 막혔던 이유는 이미 해결돼 있었다 — 그래서 L1 자체 realtime으로 되돌린다.
  _watchL1Realtime(myGuid, _handleSignalRow);

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
        if (sig.type === 'offer' && !_peerInfo) { await _handleSignalRow(sig); break; }
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
