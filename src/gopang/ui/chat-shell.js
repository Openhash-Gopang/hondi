/**
 * src/gopang/ui/chat-shell.js — 공용 GWP 채팅 탭 UI 유틸
 * (2026-07-22 신설, 2026-07-22 입력창을 webapp.html 실제 메인 입력창
 * 구조로 개편)
 *
 * pages/regional-gov.html, pages/expert-chat.html, pages/profile-assistant.html
 * 3곳이 각자 escHtml/appendBubble/appendTyping/마이크/입력창을 거의
 * 동일하게(때론 완전히 동일하게) 복사해 갖고 있던 걸 통합했다.
 *
 * ★ 입력창 동작은 webapp.html의 `.input-dock`(현재 화면엔 #ai-panel-
 * input-row에 가려 안 보이지만 "별도 탭 대화창에서 재사용" 용도로
 * 요소·JS가 보존돼 있던 컴포넌트, webapp.html 2131행대 syncState()
 * 참고)을 그대로 옮겼다: 입력창에 글자가 있으면(hasText) 좌측 아이콘
 * 그룹(#input-aux-btns)이 접히며 입력창이 넓어진다.
 *
 * 설계 원칙: 이 모듈은 "화면을 어떻게 그리고 사용자 입력을 어떻게
 * 받을지"만 책임진다. AI를 실제로 어떻게 부르는지(스트리밍, 태그 파싱,
 * GWP_DONE 보고, PDV 요청 등 페이지마다 완전히 다른 로직)는 절대
 * 이 모듈이 알지 못한다 — 전부 페이지가 onSubmit 콜백 안에서 직접
 * 처리한다. 이미 복잡하고 검증된 페이지별 로직(특히 expert-chat.html의
 * 오케스트레이션 태그 처리, profile-assistant.html의 튜토리얼/PDV 흐름)을
 * 다시 쓰지 않고 그대로 보존하기 위한 의도적 경계다.
 *
 * 필요한 HTML 구조(id 고정, 필요한 만큼만 있어도 됨 — 없는 요소는
 * 조용히 건너뜀):
 *
 * <div id="top-bar">
 *   <div id="tb-icon">🏛</div>
 *   <div id="tb-sub">로딩 중…</div>
 *   <div id="trace-badge"></div>              (선택)
 *   <button id="tb-back">나비로</button>
 * </div>
 * <div id="err-banner"></div>
 * <div id="chat-thread"></div>
 * <div id="bottom-dock">
 *   <div id="attach-preview">
 *     <img id="attach-thumb" alt="">
 *     <span id="attach-name"></span>
 *     <button id="attach-remove" type="button">✕</button>
 *   </div>
 *   <input type="file" id="file-input" accept="image/*" style="display:none">
 *   <input type="file" id="camera-input" accept="image/*" capture="environment" style="display:none">
 *   <div id="input-bar">
 *     <div id="input-aux-btns">
 *       <button class="ia-btn" id="attach-btn" type="button">...</button>
 *       <button class="ia-btn" id="camera-btn" type="button">...</button>
 *       <button class="ia-btn" id="mic-btn" type="button">...</button>
 *     </div>
 *     <div id="input-wrap">
 *       <textarea id="chat-input" rows="1"></textarea>
 *       <button id="send-btn" disabled>
 *         <svg class="icon-send" viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
 *         <svg class="icon-waveform" viewBox="0 0 24 24"><line x1="5" y1="9" x2="5" y2="15"/>...</svg>
 *       </button>
 *     </div>
 *   </div>
 * </div>
 *
 * CSS는 /assets/chat-shell.css를 <link>하면 된다(색상 3개만 페이지별
 * :root 오버라이드).
 */

export function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function appendBubble(role, html) {
  const thread = document.getElementById('chat-thread');
  const div = document.createElement('div');
  div.className = 'bubble ' + (role === 'ai' ? 'bubble-ai' : 'bubble-user');
  div.innerHTML = html;
  thread.appendChild(div);
  thread.scrollTop = thread.scrollHeight;
  return div;
}

export function appendTyping(label) {
  const thread = document.getElementById('chat-thread');
  const div = document.createElement('div');
  div.className = 'bubble-typing';
  div.innerHTML = `<div class="spinner"></div><span>${escHtml(label || '답변을 준비하고 있습니다')}…</span>`;
  thread.appendChild(div);
  thread.scrollTop = thread.scrollHeight;
  return div;
}

// ── 상단바 뒤로가기 — 전 페이지 공통 관례(닫기 시도 → 실패 시 이동) ──
export function wireBackButton({ returnUrl, onBack } = {}) {
  const btn = document.getElementById('tb-back');
  if (!btn) return;
  btn.addEventListener('click', onBack || (() => {
    window.close();
    setTimeout(() => { if (!window.closed) location.href = returnUrl || '/webapp.html'; }, 150);
  }));
}

export function setSubText(text) {
  const el = document.getElementById('tb-sub');
  if (el) el.textContent = text;
}
export function setTraceBadge(text) {
  const el = document.getElementById('trace-badge');
  if (el) el.textContent = text;
}
export function setTopBarIcon(icon) {
  const el = document.getElementById('tb-icon');
  if (el) el.textContent = icon;
}

function _fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result);
    r.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
    r.readAsDataURL(file);
  });
}

// ── 입력창 — webapp.html .input-dock의 syncState()를 그대로 이식.
// 글자가 있으면(hasText) #input-aux-btns를 접고, 자동 리사이즈하고,
// 전송 버튼 활성/비활성을 갱신한다. 첨부 파일이 있을 때도 전송 버튼을
// 켜야 하므로, hasAttachment()로 그 상태를 나중에 물어볼 수 있게
// setHasAttachmentCheck를 함께 반환한다(wireAttachAndCamera가 사용). ──
export function wireInputBar() {
  const inp = document.getElementById('chat-input');
  const aux = document.getElementById('input-aux-btns');
  const sendBtn = document.getElementById('send-btn');
  if (!inp) return { syncState() {}, setHasAttachmentCheck() {}, setMicActiveCheck() {} };

  let _hasAttachment = () => false;
  let _micActive = () => false;

  function autoResize() {
    inp.style.height = 'auto';
    inp.style.height = Math.min(inp.scrollHeight, 160) + 'px';
  }

  function syncState() {
    const hasText = inp.value.length > 0;
    // ★ 2026-07-22 — 마이크로 받아쓰는 중에는 글자가 채워져도 아이콘
    // 그룹을 숨기지 않는다. 안 그러면 받아쓴 텍스트가 입력창에 나타나는
    // 순간 마이크 버튼 자신이 숨겨져 정지할 방법이 없어지는 막다른
    // 상황이 생긴다(실사로 재현 확인).
    if (aux) aux.classList.toggle('hidden', hasText && !_micActive());
    if (sendBtn) sendBtn.disabled = !hasText && !_hasAttachment();
    autoResize();
  }

  inp.addEventListener('input', syncState);
  syncState();

  return {
    syncState,
    setHasAttachmentCheck: (fn) => { _hasAttachment = fn; },
    setMicActiveCheck: (fn) => { _micActive = fn; },
  };
}

// ── 첨부/카메라 — 미리보기 표시까지만 공용으로 처리. 이미지를 실제
// 메시지에 어떻게 실어 보낼지는 initChatShell()의 onSubmit이 결정한다.
// onFileSelected(file)은 선택적 후킹(페이지별 추가 처리용).
// inputBar를 넘기면(wireInputBar()의 반환값) 첨부 상태 변화 시
// 전송 버튼 활성/비활성이 함께 갱신된다.
export function wireAttachAndCamera({ onFileSelected, inputBar } = {}) {
  const fileInput   = document.getElementById('file-input');
  const cameraInput = document.getElementById('camera-input');
  const attachBtn   = document.getElementById('attach-btn');
  const cameraBtn   = document.getElementById('camera-btn');
  const removeBtn   = document.getElementById('attach-remove');
  const preview     = document.getElementById('attach-preview');
  const nameEl      = document.getElementById('attach-name');
  const thumb       = document.getElementById('attach-thumb');

  let _attachedFile = null;

  function setAttachedFile(file) {
    _attachedFile = file || null;
    if (preview) {
      if (_attachedFile) {
        if (nameEl) nameEl.textContent = _attachedFile.name;
        if (thumb)  thumb.src = URL.createObjectURL(_attachedFile);
        preview.style.display = 'flex';
      } else {
        preview.style.display = 'none';
        if (nameEl) nameEl.textContent = '';
        if (thumb)  thumb.src = '';
      }
    }
    inputBar?.syncState();
  }

  inputBar?.setHasAttachmentCheck(() => !!_attachedFile);

  attachBtn?.addEventListener('click', () => fileInput?.click());
  cameraBtn?.addEventListener('click', () => cameraInput?.click());
  fileInput?.addEventListener('change', () => {
    if (fileInput.files?.[0]) { setAttachedFile(fileInput.files[0]); onFileSelected?.(fileInput.files[0]); }
    fileInput.value = '';
  });
  cameraInput?.addEventListener('change', () => {
    if (cameraInput.files?.[0]) { setAttachedFile(cameraInput.files[0]); onFileSelected?.(cameraInput.files[0]); }
    cameraInput.value = '';
  });
  removeBtn?.addEventListener('click', () => setAttachedFile(null));

  return {
    getAttachedFile: () => _attachedFile,
    setAttachedFile,
    fileToDataUrl: _fileToDataUrl,
  };
}

// ── 마이크(실시간 받아쓰기) — 무음 자동정지 없이, 클릭으로 시작/정지
// 토글만 하는 단순화 버전(메인 앱 ai-panel의 정교한 버전보다 가볍다).
export function wireMic(inputId = 'chat-input', micBtnId = 'mic-btn', inputBar = null) {
  const inp = document.getElementById(inputId);
  const micBtn = document.getElementById(micBtnId);
  if (!inp || !micBtn) return { start() {}, stop() {}, isActive: () => false };

  let _recognition = null;
  let _micActive = false;

  inputBar?.setMicActiveCheck(() => _micActive);

  function _ctor() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; }

  function start() {
    const SR = _ctor();
    if (!SR) { appendBubble('ai', '이 브라우저는 음성 입력을 지원하지 않습니다.'); return; }
    let baseText = inp.value;
    const r = new SR();
    r.lang = 'ko-KR';
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let finalT = '', interimT = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalT += res[0].transcript;
        else interimT += res[0].transcript;
      }
      if (finalT) baseText = (baseText ? baseText + ' ' : '') + finalT;
      inp.value = baseText + (interimT ? ' ' + interimT : '');
      inp.dispatchEvent(new Event('input'));
    };
    r.onerror = () => stop();
    r.onend   = () => { if (_micActive) { try { r.start(); } catch (e) { stop(); } } };
    try { r.start(); } catch (e) { return; }
    _recognition = r;
    _micActive = true;
    micBtn.classList.add('mic-active');
    inputBar?.syncState();
  }

  function stop() {
    _micActive = false;
    micBtn.classList.remove('mic-active');
    try { _recognition?.stop(); } catch (e) { /* 무시 */ }
    inputBar?.syncState();
  }

  micBtn.addEventListener('click', () => { _micActive ? stop() : start(); });
  return { start, stop, isActive: () => _micActive };
}

// ── 종합 초기화 — 뒤로가기·입력창(자동리사이즈+아이콘 접힘)·마이크·
// 첨부/카메라·전송을 한 번에 배선한다. onSubmit(text, imageDataUrl)은
// 필수 — 그 안에서 AI 호출/스트리밍/태그 파싱을 페이지가 전부 직접
// 처리한다. 이미 자기만의 첨부 로직이 있는 페이지(예: expert-chat.html)
// 는 이 종합 함수 대신 위 개별 export들만 골라 쓰면 된다.
export function initChatShell({ onBack, onSubmit, returnUrl, onFileSelected } = {}) {
  wireBackButton({ returnUrl, onBack });
  const inputBar = wireInputBar();
  wireMic('chat-input', 'mic-btn', inputBar);
  const attach = wireAttachAndCamera({ onFileSelected, inputBar });

  async function _submit() {
    const inp = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    const text = inp.value.trim();
    const file = attach.getAttachedFile();
    if (!text && !file) return;
    inp.value = '';
    inputBar.syncState();
    if (sendBtn) sendBtn.disabled = true;

    let imageDataUrl = null;
    if (file) {
      try {
        imageDataUrl = await attach.fileToDataUrl(file);
      } catch (e) {
        if (sendBtn) sendBtn.disabled = false;
        appendBubble('ai', `⚠️ 이미지를 읽지 못했습니다: ${escHtml(e.message)}`);
        return;
      }
      attach.setAttachedFile(null);
    }

    try {
      await onSubmit(text, imageDataUrl);
    } finally {
      if (sendBtn) sendBtn.disabled = false;
      inp.focus();
    }
  }

  document.getElementById('send-btn')?.addEventListener('click', _submit);
  document.getElementById('chat-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _submit(); }
  });

  return {
    appendBubble, appendTyping, escHtml,
    setSubText, setTraceBadge, setTopBarIcon,
    getAttachedFile: attach.getAttachedFile,
    setAttachedFile: attach.setAttachedFile,
  };
}
