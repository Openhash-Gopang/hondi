/**
 * ui/bubble.js — 메시지 버블 렌더링
 */

// [2026-08-06 신설 — 메인 채팅/패널 통합 1단계] 이 모듈의 모든 함수가
// 'message-list'를 하드코딩하고 있었다 — call-ai.js가 오케스트레이션
// 결과를 항상 화면에 안 보이는 #message-list(2026-07-07부터 display:none)
// 에만 쓰고, 실제로 사용자가 보는 #ai-panel-messages(패널)에는 절대
// 못 쓰는 구조적 원인이었다. 이걸 15개 소비자 모두의 하위호환을 깨지
// 않으면서 고치기 위해, 모듈 전역 "현재 타겟 컨테이너" 상태를 둔다:
//   - 아무도 setBubbleTarget을 안 부르면 → 기본값 'message-list' 그대로
//     (기존 15개 파일 전부 동작 무변화).
//   - call-ai.js의 최상위 진입점(callAI)만 명시적으로 이 값을 바꿀 수
//     있고, 재귀 호출(sendFn 체인)은 아무것도 안 넘기면 이 상태를 그대로
//     "상속"한다 — 매 호출마다 컨테이너 인자를 47곳 넘게 스레딩할
//     필요가 없다. 자세한 설계 근거는 call-ai.js의 callAI 주석 참고.
let _activeContainerId = 'message-list';

export function setBubbleTarget(containerId) {
  _activeContainerId = containerId || 'message-list';
}

export function getBubbleTarget() {
  return _activeContainerId;
}

/**
 * 채팅창에 버블 추가
 * @param {'ai'|'user'|'peer'|'system'} role
 * @param {string} text
 * @param {boolean} isHTML
 * @param {string|null} senderName  peer 메시지의 발신자 이름
 */
export function appendBubble(role, text, isHTML = false, senderName = null) {
  const list = document.getElementById(_activeContainerId);
  if (!list) return;

  const row  = document.createElement('div');
  row.className = `msg-row ${role}`;

  // peer 메시지 발신자 이름
  if (senderName && role === 'peer') {
    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'font-size:11px;font-weight:600;color:var(--txt3);margin-bottom:2px;padding-left:2px';
    nameEl.textContent = senderName;
    row.appendChild(nameEl);
  }

  const bubble = document.createElement('div');
  bubble.className = `bubble bubble-${role}`;
  if (isHTML) bubble.innerHTML = text;
  else        bubble.textContent = text;

  row.appendChild(bubble);
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;
  return bubble;
}

// ── 타이핑 인디케이터 ────────────────────────────────────
let typingEl = null;

export function showTyping() {
  const list = document.getElementById(_activeContainerId);
  if (!list) return;
  typingEl = document.createElement('div');
  typingEl.className = 'msg-row ai';
  typingEl.id = 'typing-row';
  typingEl.innerHTML = `<div class="typing-indicator">
    <span></span><span></span><span></span>
  </div>`;
  list.appendChild(typingEl);
  list.scrollTop = list.scrollHeight;
}

export function hideTyping() {
  document.getElementById('typing-row')?.remove();
  typingEl = null;
}

// ── 스트리밍 버블 ────────────────────────────────────────
export function _createStreamBubble() {
  const list   = document.getElementById(_activeContainerId);
  if (!list) return null;
  const row    = document.createElement('div');
  row.className = 'msg-row ai';
  const bubble = document.createElement('div');
  bubble.className = 'bubble bubble-ai streaming';
  row.appendChild(bubble);
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;
  return bubble;
}

export function _updateStreamBubble(bubble, text) {
  if (!bubble) return;
  bubble.innerHTML = text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\n/g,'<br>')
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>');
  const list = document.getElementById(_activeContainerId);
  if (list) list.scrollTop = list.scrollHeight;
}

// ── BUG-FIX(2026-09-14) — "5초 이상 걸리는 작업은 반드시 진행상황을
// 알린다" 원칙 전용 유틸. 지금까지 실제 콘텐츠(delta)가 오기 전까지는
// 화면이 그냥 "…"나 이전 필러 문장에 멈춰 있어서, LLM reasoning이나
// 오케스트레이션 서버 호출(예: CALL_GOVTREE의 /orchestration/
// execute-govtree-step)이 몇 초 이상 걸리면 사용자 입장에선 "멈춘
// 것"과 구분이 안 됐다(이번 세션에서 다룬 finish_reason=length 버그와
// 증상이 겹쳐 보이지만 원인은 다름 — 이건 "느림"이지 "끊김"이 아니다).
// call-ai.js와 webapp.html(_callPanelAI) 양쪽에서 재사용한다 — 이번엔
// 처음부터 공용 모듈(이 파일)에 두어 두 곳에 또 복사본이 생기는 걸
// 피한다.
//
// @param {HTMLElement} bubble - 진행상황을 표시할 말풍선(없으면 무동작)
// @param {string} [label] - 상황에 맞는 한국어 문구(예: '읍면동 사무소 확인 중')
// @returns {() => void} stop 함수 — 실제 콘텐츠가 도착하거나 작업이
//   끝나면(성공/실패 무관) 반드시 호출해서 타이머를 정리해야 한다.
export function _startWaitTicker(bubble, label = '생각하는 중입니다') {
  if (!bubble) return () => {};
  let seconds = 0;
  const id = setInterval(() => {
    seconds += 5;
    _updateStreamBubble(bubble, `${label}… (${seconds}초 경과)`);
  }, 5000);
  return function _stopWaitTicker() {
    clearInterval(id);
  };
}

// ── 리스크 칩 ────────────────────────────────────────────
export function riskChip(level, flags = []) {
  const map = { S0:'✅ 안전', S1:'⚠️ 주의', S2:'🚨 경고', S3:'🛑 차단' };
  const label   = map[level] ?? '—';
  const flagStr = flags.length ? ` · ${flags.slice(0,3).join(' ')}` : '';
  return `<span class="risk-chip ${level.toLowerCase()}">${label}${flagStr}</span>`;
}
