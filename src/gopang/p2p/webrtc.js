/**
 * p2p/webrtc.js — P2P WebRTC DataChannel + 시그널링 + PDV 채팅 저장
 */
import {
  _peer, _rtcConn, _rtcChannel, _signalPoll, _pdvChatDB,
  setPeerState, setRtcConn, setRtcChannel, setSignalPoll, setPdvChatDB,
  PROXY, RTC_CONFIG, USER_GUID, fetchRtcConfig,
} from '../core/state.js';
import { _isRegistered } from '../core/auth.js';
import { signalPost } from './signal-auth.js';
import { appendBubble } from '../ui/bubble.js';
import { _showRegisterFlowThenPeer } from '../ui/register-flow.js';

// ── 대화 상대 설정 — p2p-chat.js startP2PCall()로 위임 ──
// 발신/수신 모두 p2p-chat.js 단일 경로로 통일
// payload 구조: { sdp, from_handle } — 양쪽 동일
export async function setPeer(peer) {
  if (!_isRegistered()) {
    _showRegisterFlowThenPeer(peer);
    return;
  }

  // TURN credential 취득 (55분 캐시, 실패 시 STUN 자동 폴백)
  await fetchRtcConfig(USER_GUID).catch(() => {});

  // p2p-chat.js의 startP2PCall()로 위임
  // → UI(오버레이), PDV 저장, OpenHash 앵커링 모두 p2p-chat.js가 담당
  try {
    const { startP2PCall } = await import('../ui/p2p-chat.js');
    await startP2PCall({
      guid:     peer.guid,
      handle:   peer.handle || peer.name || '',
      nickname: peer.name   || peer.handle || '상대방',
      avatar_emoji: peer.avatar_emoji || '🙂',
    });
  } catch(e) {
    console.error('[WebRTC] startP2PCall 실패:', e.message);
    appendBubble('system', '⚠️ P2P 연결을 시작할 수 없습니다.');
  }
}

// ── 대화 상대 해제 ───────────────────────────────────────
export function _clearPeer() {
  _closeRTC();
  setPeerState(null);
  const bar = document.getElementById('peer-bar');
  if (bar) bar.style.display = 'none';
  const inp = document.getElementById('msg-input');
  if (inp) inp.placeholder = '메시지를 입력하세요…';
  appendBubble('system', '🤖 AI 비서와 대화합니다.');
}

// ── WebRTC Offer 생성 (발신자) ────────────────────────────
async function _createOffer() {
  const conn = new RTCPeerConnection(RTC_CONFIG);
  setRtcConn(conn);
  _setupRTCEvents(conn);
  const ch = conn.createDataChannel('gopang-p2p', { ordered: true });
  setRtcChannel(ch);
  _setupChannelEvents(ch);

  const offer = await conn.createOffer();
  await conn.setLocalDescription(offer);
  await _waitICE(conn);
  await _sendSignal('offer', conn.localDescription);
}

// ── WebRTC Answer 생성 (수신자) ───────────────────────────
async function _handleOffer(sig) {
  const conn = new RTCPeerConnection(RTC_CONFIG);
  setRtcConn(conn);
  _setupRTCEvents(conn);
  conn.ondatachannel = (e) => {
    setRtcChannel(e.channel);
    _setupChannelEvents(e.channel);
  };
  await conn.setRemoteDescription(new RTCSessionDescription(JSON.parse(sig.payload)));
  const answer = await conn.createAnswer();
  await conn.setLocalDescription(answer);
  await _waitICE(conn);
  await _sendSignal('answer', conn.localDescription, sig.from_guid);
  appendBubble('system', `📞 ${_peer?.name || sig.from_guid?.slice(-6) || '상대방'}에게서 연결 요청`);
}

// ── ICE 후보 수집 완료 대기 ──────────────────────────────
function _waitICE(conn) {
  return new Promise(resolve => {
    if (conn.iceGatheringState === 'complete') { resolve(); return; }
    const t = setTimeout(resolve, 3000);
    conn.onicegatheringstatechange = () => {
      if (conn.iceGatheringState === 'complete') { clearTimeout(t); resolve(); }
    };
  });
}

// ── RTCPeerConnection 이벤트 ─────────────────────────────
function _setupRTCEvents(conn) {
  conn.onicecandidate = async (e) => {
    if (e.candidate) await _sendSignal('ice', e.candidate);
  };
  conn.onconnectionstatechange = () => {
    const s = conn.connectionState;
    console.info('[WebRTC] 연결 상태:', s);
    if (s === 'connected') {
      appendBubble('system', '✅ P2P 연결 완료 — 메시지는 기기 간 직접 전달됩니다.');
      _deleteMySignals();
    }
    if (s === 'disconnected' || s === 'failed') {
      appendBubble('system', '⚠️ 연결이 끊어졌습니다.');
    }
  };
}

// ── DataChannel 이벤트 ───────────────────────────────────
function _setupChannelEvents(ch) {
  // ★ onopen: 연결 완료 시 입력창 활성화
  ch.onopen = () => {
    console.info('[WebRTC] DataChannel open — 입력창 활성화');
    appendBubble('system', '✅ P2P 연결 완료 — 메시지를 입력하세요.');
    // p2p-chat.js 오버레이 입력창 활성화
    const p2pInput = document.getElementById('_p2p-input');
    if (p2pInput) p2pInput.disabled = false;
    // gopang 메인 입력창도 활성화 (peer 모드)
    const mainInput = document.getElementById('msg-input');
    if (mainInput) mainInput.placeholder = `${_peer?.name || '상대방'}에게 메시지…`;
  };

  ch.onmessage = async (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'bye') {
        appendBubble('system', '🔴 상대방이 대화를 종료했습니다.');
        return;
      }
      // p2p-chat.js 오버레이가 열려있으면 거기에, 아니면 메인 채팅창에
      const p2pMsgs = document.getElementById('_p2p-messages');
      if (p2pMsgs) {
        const time = new Date(msg.ts || Date.now())
          .toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit' });
        const esc = s => String(s)
          .replace(/&/g,'&amp;').replace(/</g,'&lt;')
          .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        p2pMsgs.innerHTML += `
          <div style="display:flex;justify-content:flex-start;align-items:flex-end;gap:6px">
            <div style="background:#fff;color:#111827;padding:8px 12px;
                        border:1px solid #e5e7eb;
                        border-radius:16px 16px 16px 4px;max-width:70%;
                        font-size:14px;line-height:1.4;word-break:break-word">
              ${esc(msg.text)}
            </div>
            <span style="font-size:10px;color:#9ca3af">${time}</span>
          </div>`;
        p2pMsgs.scrollTop = p2pMsgs.scrollHeight;
      } else {
        appendBubble('peer', msg.text, false, _peer?.name || '상대방');
      }
      await _saveMsgPDV({ dir:'in', from: _peer?.guid, text: msg.text, ts: msg.ts });
    } catch(err) { console.warn('[WebRTC] 메시지 파싱 오류:', err); }
  };

  ch.onclose = () => {
    console.info('[WebRTC] DataChannel closed');
    const p2pInput = document.getElementById('_p2p-input');
    if (p2pInput) p2pInput.disabled = true;
  };

  ch.onerror = (e) => console.error('[WebRTC] DataChannel 오류:', e);
}

// ── P2P 메시지 전송 ──────────────────────────────────────
export async function _sendP2P(text) {
  if (!_rtcChannel || _rtcChannel.readyState !== 'open') {
    appendBubble('system', '⏳ 연결 수립 중입니다. 잠시 후 다시 시도하세요.');
    return;
  }
  const msg = { text, ts: new Date().toISOString() };
  _rtcChannel.send(JSON.stringify(msg));
  await _saveMsgPDV({ dir:'out', to: _peer?.guid, text, ts: msg.ts });
  // p2p-chat.js가 세션 종료 시 통째로 저장/OpenHash 앵커링하는 원문
  // 누적 배열에도 기록 (2026-07-02 — 메인 채팅 통합 리팩터링의 일부)
  try {
    const { _recordOutgoingP2PMsg } = await import('../ui/p2p-chat.js');
    _recordOutgoingP2PMsg(text, msg.ts);
  } catch (e) { console.warn('[WebRTC] P2P 세션 기록 실패(무시):', e.message); }
}

// ── RTC 연결 종료 ────────────────────────────────────────
export function _closeRTC() {
  if (_signalPoll) { clearInterval(_signalPoll); setSignalPoll(null); }
  if (_rtcChannel) { try { _rtcChannel.close(); } catch {} setRtcChannel(null); }
  if (_rtcConn)    { try { _rtcConn.close(); }    catch {} setRtcConn(null); }
}

// ── 시그널 전송 ──────────────────────────────────────────
async function _sendSignal(type, payload, toGuid = null) {
  const to = toGuid || _peer?.guid;
  if (!to || !USER_GUID) return;
  try {
    const r = await signalPost('/signal/send', USER_GUID, { from_guid: USER_GUID, to_guid: to, type, payload: JSON.stringify(payload) });
    if (!r.ok) console.warn('[Signal] 전송 거부:', r.status, r.code);
  } catch(e) { console.warn('[Signal] 전송 실패:', e.message); }
}

// ── 시그널 폴링 (1.5초) ──────────────────────────────────
export function _startSignalPoll() {
  // (Realtime은 p2p-chat.js startIncomingWatch에서 처리)

  if (_signalPoll) clearInterval(_signalPoll);
  const id = setInterval(async () => {
    if (!USER_GUID) return;
    try {
      const pr   = await signalPost('/signal/poll', USER_GUID, {});
      const data = pr.data || {};
      if (!data.ok || !data.signals?.length) return;
      for (const sig of data.signals) await _handleSignal(sig);
    } catch {}
  }, 1500);
  setSignalPoll(id);
}

// ── 시그널 처리 ──────────────────────────────────────────
async function _handleSignal(sig) {
  console.info('[Signal] 수신:', sig.type, 'from:', sig.from_guid?.slice(-6));

  if (false && sig.type === 'offer' && !_peer) { // p2p-chat.js로 이전
    try {
      // ── 이관 ⑩: profile GET → L1 직접 (2026-06-23) ─────────────────
      const _L1_PROF = L1_URL + '?filter=' + encodeURIComponent(`guid='${sig.from_guid}'`) + '&perPage=1';
      const res  = await fetch(_L1_PROF);
      const _raw = await res.json();
      const _p   = _raw.items?.[0] || null;
      const data = { ok: res.ok && !!_p, profile: _p };
      if (data.ok && data.profile) {
        setPeerState(data.profile);
        const bar = document.getElementById('peer-bar');
        const nm  = document.getElementById('peer-name');
        if (bar && nm) { nm.textContent = data.profile.name; bar.style.display = 'flex'; }
      }
    } catch {}
  }

  if (sig.type === 'offer')  await _handleOffer(sig);
  if (sig.type === 'answer') {
    if (_rtcConn) await _rtcConn.setRemoteDescription(new RTCSessionDescription(JSON.parse(sig.payload)));
  }
  if (sig.type === 'ice') {
    if (_rtcConn) {
      try { await _rtcConn.addIceCandidate(new RTCIceCandidate(JSON.parse(sig.payload))); } catch {}
    }
  }
  _deleteSignal(sig.id);
}

async function _deleteSignal(id) {
  try { await signalPost('/signal/delete', USER_GUID, { id }); } catch {}
}
async function _deleteMySignals() {
  try { await signalPost('/signal/delete', USER_GUID, { mine: true }); } catch {}
}

// ── PDV 채팅 저장 (IndexedDB) ────────────────────────────
async function _openPDVDB() {
  if (_pdvChatDB) return _pdvChatDB;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('gopang_pdv_chat', 1);
    req.onupgradeneeded = (e) => {
      const store = e.target.result.createObjectStore('messages', { keyPath:'id', autoIncrement:true });
      store.createIndex('peer_ts', ['peer_guid','ts']);
    };
    req.onsuccess = (e) => { setPdvChatDB(e.target.result); resolve(e.target.result); };
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function _saveMsgPDV(msg) {
  try {
    const db = await _openPDVDB();
    const tx = db.transaction('messages', 'readwrite');
    tx.objectStore('messages').add({
      peer_guid: msg.dir === 'out' ? msg.to : msg.from,
      dir: msg.dir, text: msg.text, ts: msg.ts,
    });
  } catch(e) { console.warn('[PDV] 메시지 저장 실패:', e); }
}

async function _loadChatHistory(peerGuid) {
  try {
    const db    = await _openPDVDB();
    const tx    = db.transaction('messages', 'readonly');
    const idx   = tx.objectStore('messages').index('peer_ts');
    const range = IDBKeyRange.bound([peerGuid,''], [peerGuid,'\uffff']);
    const msgs  = await new Promise((resolve, reject) => {
      const req = idx.getAll(range);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
    if (msgs.length) {
      appendBubble('system', `— 이전 대화 ${msgs.length}건 —`);
      msgs.forEach(m => appendBubble(
        m.dir === 'out' ? 'user' : 'peer', m.text, false,
        m.dir === 'in' ? (_peer?.name || '상대방') : undefined
      ));
    }
  } catch(e) { console.warn('[PDV] 이력 로드 실패:', e); }
}

