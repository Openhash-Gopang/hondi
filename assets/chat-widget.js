/* ══════════════════════════════════════════════════════════════════
   chat-widget.js — 단독 페이지용 "채팅 아이콘" 공용 모듈 (v1.0, 2026-09-08)

   배경: desktop.html은 자체 SPA 오버레이(openStandalone) 안에서 열리는
   페이지(k-government/expert-personas/k-services 등)에는 이미 하단
   채팅 아이콘(#ask-bubble)과 채팅 패널(#chat-panel)을 제공한다. 하지만
   pages/*.html을 SPA 밖에서 "단독 페이지"로 직접 열었을 때는(공유
   링크, 새 탭 등) 그 아이콘이 없다 — 이 모듈은 그 간극을 메운다.

   대상: pages/k-government.html · pages/expert-personas.html ·
   pages/k-services.html (그 외 페이지도 아래 "사용법"만 따르면 동일하게
   붙일 수 있다 — 페이지마다 손으로 마크업을 복붙할 필요가 없다).

   중복 방지: desktop.html의 SPA 오버레이 안에서 이 페이지의 <body>가
   주입되는 경우(#ask-bubble/#chat-panel이 이미 존재) 이 모듈은 아무
   것도 하지 않는다 — 데스크톱 셸이 이미 동일한 기능을 제공하므로
   아이콘이 중복되지 않게 한다.

   인증: /auth/k-service-auth-client.js(window.KAuth, v2.0)가 먼저
   로드돼 있으면, 채팅 아이콘을 누른 시점에 KAuth.ensureLogin()을
   호출한다. .hondi.net 쿠키 기반 SSO이므로 다른 K-서비스 페이지에서
   이미 인증했다면 오버레이 없이 즉시 통과한다(요구사항: "어느 한
   페이지에서 인증했으면 다른 페이지에서는 인증 과정을 생략"). KAuth가
   로드돼 있지 않은 페이지에서는 인증 없이 바로 채팅을 연다.

   SP 로딩: desktop.html의 chat-panel과 동일한 방식으로
   /prompts/sp-catalog.json → /prompts/{파일명}을 fetch한다(정본은
   prompts/ 파일 하나뿐이라는 원칙 유지). 페이지별 화면 컨텍스트는
   desktop.html의 HONDI_PAGE_CONTEXT와 동일한 문구를 사용해 SP 뒤에
   덧붙인다(#2-1 패턴 재사용).

   과금: KAuth.fetchWithAuth()로 /ai/chat을 호출해 phone_verify_token을
   함께 보낸다 — 방문자용 익명 채팅(desktop.html 하단 벌룬)과 달리 이
   위젯은 로그인 사용자 대상이므로, 백엔드가 이 토큰으로 GDC 과금·사용량
   추적을 연결할 수 있게 했다. /ai/chat 쪽에서 이 필드를 실제로 사용해
   과금하려면 서버 측 확인이 필요하다(TODO 표시, 아래 참고).

   사용법 — 페이지 <body> 시작 부분(예: ph-header.js include 옆)에:

     <script>
       window.HONDI_CHAT_WIDGET_CONFIG = {
         sp: 'HONDI_VISITOR_SP',       // prompts/sp-catalog.json의 키
         context: '사용자는 지금 ... 섹션에 있습니다.',  // 선택
         label: 'K-정부에 물어보기',    // FAB 라벨 문구(선택)
         greeting: '안녕하세요! ...',   // 채팅창 첫 인사(선택)
         serviceLabel: 'K-정부',        // KAuth 로그인 UI 표시명(선택)
         requireAuth: true              // 기본값 true
       };
     </script>
     <script src="/assets/chat-widget.js"></script>

   K-서비스 SSO를 함께 쓰려면 이 스크립트보다 앞서
   k-service-auth-client.js를 포함해야 한다(window.KAuth 존재 여부로
   자동 감지하므로 순서만 지키면 별도 설정 불필요):

     <script>window.K_AUTH_CONFIG = { serviceLabel: 'K-정부' };</script>
     <script src="https://hondi.net/auth/k-service-auth-client.js"></script>
   ══════════════════════════════════════════════════════════════════ */

(function () {
  // ── 중복/충돌 방지 ─────────────────────────────────────────────
  // desktop.html SPA 오버레이 안에 주입된 경우 데스크톱 셸이 이미 동일
  // 기능(#ask-bubble/#chat-panel)을 제공하므로 아무 것도 하지 않는다.
  if (document.getElementById('ask-bubble') || document.getElementById('chat-panel')) return;
  // 이 스크립트 자신의 중복 include 방지.
  if (document.getElementById('hcw-fab')) return;

  var WORKER_URL = 'https://hondi-proxy.tensor-city.workers.dev';
  var CFG = Object.assign({
    sp: 'HONDI_VISITOR_SP',
    context: '',
    label: '무엇이든 요청하세요.',
    greeting: '안녕하세요! 혼디 플랫폼 이용과 관련해 무엇이든 요청하거나 지시해주세요. 😊',
    serviceLabel: document.title || 'K-서비스',
    requireAuth: true,
  }, window.HONDI_CHAT_WIDGET_CONFIG || {});

  // ── 스타일 (desktop.html #ask-bubble / #chat-panel 디자인을 hcw- 접두로 재사용) ──
  var style = document.createElement('style');
  style.id = 'hcw-style';
  style.textContent =
    '#hcw-fab{position:fixed;bottom:28px;right:28px;z-index:9000;display:flex;flex-direction:row;align-items:center;gap:10px;pointer-events:none}' +
    '#hcw-fab-label{pointer-events:auto;background:#fff;color:#0f172a;font-family:Pretendard,sans-serif;font-size:14px;font-weight:500;padding:10px 16px;border-radius:20px 20px 20px 4px;box-shadow:0 4px 20px rgba(0,0,0,.13);cursor:pointer;border:1px solid #e2e8f0;white-space:nowrap;opacity:0;transform:translateX(8px);transition:opacity .2s ease,transform .2s ease}' +
    '#hcw-fab:hover #hcw-fab-label{opacity:1;transform:translateX(0)}' +
    '#hcw-fab-btn{pointer-events:auto;width:56px;height:56px;flex-shrink:0;border-radius:50%;background:#2563eb;border:none;cursor:pointer;box-shadow:0 4px 20px rgba(22,163,74,.35);display:flex;align-items:center;justify-content:center;transition:transform .15s,box-shadow .15s;animation:hcw-bubble-in .4s cubic-bezier(.34,1.56,.64,1) both}' +
    '#hcw-fab:hover #hcw-fab-btn{transform:scale(1.06);box-shadow:0 8px 28px rgba(22,163,74,.45)}' +
    '#hcw-fab-btn svg{width:26px;height:26px}' +
    '@keyframes hcw-bubble-in{from{opacity:0;transform:scale(.7) translateY(16px)}to{opacity:1;transform:scale(1) translateY(0)}}' +
    '#hcw-overlay{display:none;position:fixed;inset:0;z-index:8900;background:transparent}' +
    '#hcw-overlay.open{display:block}' +
    '#hcw-panel{position:fixed;bottom:96px;right:28px;z-index:8950;width:380px;max-height:560px;background:rgba(255,255,255,.72);backdrop-filter:blur(20px) saturate(1.6);-webkit-backdrop-filter:blur(20px) saturate(1.6);border-radius:20px;box-shadow:0 8px 40px rgba(0,0,0,.13),0 2px 8px rgba(0,0,0,.06);display:flex;flex-direction:column;overflow:hidden;opacity:0;transform:translateY(16px) scale(.97);pointer-events:none;transition:opacity .22s cubic-bezier(.4,0,.2,1),transform .22s cubic-bezier(.34,1.3,.64,1)}' +
    '#hcw-panel.open{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}' +
    '#hcw-panel-header{display:flex;align-items:center;justify-content:space-between;padding:16px 18px 12px;flex-shrink:0}' +
    '#hcw-panel-title{display:flex;align-items:center;gap:8px;font-family:Pretendard,sans-serif;font-size:14px;font-weight:600;color:#0f172a}' +
    '#hcw-panel-title .hcw-dot{width:8px;height:8px;border-radius:50%;background:#3b82f6;animation:hcw-blink 2s infinite}' +
    '@keyframes hcw-blink{0%,100%{opacity:1}50%{opacity:.35}}' +
    '#hcw-panel-close{width:28px;height:28px;border-radius:50%;border:none;background:#f1f3f5;color:#374151;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s;flex-shrink:0}' +
    '#hcw-panel-close:hover{background:#e5e7eb}' +
    '#hcw-messages{flex:1;overflow-y:auto;padding:8px 16px 4px;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth}' +
    '#hcw-messages::-webkit-scrollbar{width:4px}#hcw-messages::-webkit-scrollbar-thumb{background:#e5e7eb;border-radius:2px}' +
    '.hcw-msg{display:flex;flex-direction:column;max-width:82%;animation:hcw-msg-in .2s ease both}' +
    '@keyframes hcw-msg-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}' +
    '.hcw-msg.user{align-self:flex-end;align-items:flex-end}.hcw-msg.ai{align-self:flex-start;align-items:flex-start}' +
    '.hcw-bubble{padding:10px 14px;border-radius:16px;font-family:Pretendard,sans-serif;font-size:13.5px;line-height:1.65;word-break:break-word}' +
    '.hcw-msg.user .hcw-bubble{background:rgba(62,207,142,.88);color:#fff;border-bottom-right-radius:4px;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}' +
    '.hcw-msg.ai .hcw-bubble{background:rgba(241,243,245,.82);color:#0f172a;border-bottom-left-radius:4px;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}' +
    '.hcw-msg.ai .hcw-bubble p{margin:0 0 8px;line-height:1.7}.hcw-msg.ai .hcw-bubble p:last-child{margin-bottom:0}' +
    '.hcw-msg.ai .hcw-bubble h3,.hcw-msg.ai .hcw-bubble h4{font-size:13.5px;font-weight:700;color:#0f172a;margin:10px 0 4px;letter-spacing:-.2px}' +
    '.hcw-msg.ai .hcw-bubble h3:first-child,.hcw-msg.ai .hcw-bubble h4:first-child{margin-top:0}' +
    '.hcw-msg.ai .hcw-bubble strong{font-weight:700;color:#0f172a}.hcw-msg.ai .hcw-bubble em{font-style:italic}' +
    '.hcw-msg.ai .hcw-bubble ul,.hcw-msg.ai .hcw-bubble ol{margin:6px 0 8px 16px;padding:0;display:flex;flex-direction:column;gap:3px}' +
    '.hcw-msg.ai .hcw-bubble ul{list-style:disc}.hcw-msg.ai .hcw-bubble ol{list-style:decimal}.hcw-msg.ai .hcw-bubble li{line-height:1.65}' +
    '.hcw-msg.ai .hcw-bubble code{font-family:Menlo,Consolas,monospace;font-size:12px;background:rgba(0,0,0,.07);border-radius:4px;padding:1px 5px}' +
    '.hcw-msg.ai .hcw-bubble a{color:#1d4ed8;text-decoration:underline;text-underline-offset:2px}' +
    '.hcw-msg.ai .hcw-bubble hr{border:none;border-top:1px solid #e5e7eb;margin:10px 0}' +
    '.hcw-typing{display:flex;gap:4px;align-items:center;padding:12px 14px}' +
    '.hcw-typing span{width:6px;height:6px;border-radius:50%;background:#6b7280;animation:hcw-dot 1.2s ease-in-out infinite}' +
    '.hcw-typing span:nth-child(2){animation-delay:.2s}.hcw-typing span:nth-child(3){animation-delay:.4s}' +
    '@keyframes hcw-dot{0%,80%,100%{opacity:.3;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}' +
    '#hcw-divider{height:1px;background:#e5e7eb;flex-shrink:0;margin:0 16px}' +
    '#hcw-input-row{display:flex;align-items:flex-end;gap:8px;padding:10px 14px 14px;flex-shrink:0}' +
    '#hcw-input{flex:1;resize:none;border:none;outline:none;background:rgba(241,243,245,.75);border-radius:12px;padding:10px 14px;font-family:Pretendard,sans-serif;font-size:13.5px;color:#0f172a;line-height:1.5;max-height:120px;min-height:40px;overflow-y:auto}' +
    '#hcw-input::placeholder{color:#6b7280}' +
    '#hcw-send{width:38px;height:38px;border-radius:50%;border:none;background:#3b82f6;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .15s,transform .12s}' +
    '#hcw-send:hover{background:#1d4ed8;transform:scale(1.06)}#hcw-send:disabled{background:#e5e7eb;cursor:not-allowed;transform:none}' +
    '@media (max-width:600px){#hcw-fab{bottom:18px;right:16px}#hcw-fab-btn{width:50px;height:50px}#hcw-panel{right:12px;left:12px;width:auto;bottom:82px}}';
  document.head.appendChild(style);

  var wrap = document.createElement('div');
  wrap.innerHTML =
    '<div id="hcw-fab">' +
      '<div id="hcw-fab-label"></div>' +
      '<button id="hcw-fab-btn" title="">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' +
        '</svg>' +
      '</button>' +
    '</div>' +
    '<div id="hcw-overlay"></div>' +
    '<div id="hcw-panel" role="dialog" aria-label="AI 채팅">' +
      '<div id="hcw-panel-header">' +
        '<div id="hcw-panel-title"><span class="hcw-dot"></span>혼디 AI에게 요청하세요</div>' +
        '<button id="hcw-panel-close" title="닫기 (ESC)">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button>' +
      '</div>' +
      '<div id="hcw-messages"></div>' +
      '<div id="hcw-divider"></div>' +
      '<div id="hcw-input-row">' +
        '<textarea id="hcw-input" placeholder="메시지를 입력하세요…" rows="1"></textarea>' +
        '<button id="hcw-send" title="전송">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>';
  while (wrap.firstChild) document.body.appendChild(wrap.firstChild);

  var fabLabel = document.getElementById('hcw-fab-label');
  var fabBtn   = document.getElementById('hcw-fab-btn');
  var panel    = document.getElementById('hcw-panel');
  var overlay  = document.getElementById('hcw-overlay');
  var msgsEl   = document.getElementById('hcw-messages');
  var input    = document.getElementById('hcw-input');
  var sendBtn  = document.getElementById('hcw-send');
  var closeBtn = document.getElementById('hcw-panel-close');

  fabLabel.textContent = CFG.label;
  fabBtn.title = CFG.label;

  var history = [];
  var busy = false;
  var opened = false; // 최초 오픈 시에만 인사말/포커스 처리

  // ── SP 로딩 (desktop.html _loadVisitorSP과 동일 패턴, 임의 SP 키로 일반화) ──
  var _spCache = null;
  async function loadSP() {
    if (_spCache) return _spCache;
    try {
      var manifestRes = await fetch('/prompts/sp-catalog.json', { cache: 'no-cache' });
      if (!manifestRes.ok) throw new Error('manifest fetch 실패: ' + manifestRes.status);
      var manifest = await manifestRes.json();
      var fname = manifest[CFG.sp];
      if (!fname) throw new Error('manifest에 ' + CFG.sp + ' 키 없음');
      var res = await fetch('/prompts/' + fname, { cache: 'no-cache' });
      if (!res.ok) throw new Error('SP fetch 실패: ' + res.status);
      var sp = await res.text();
      if (!sp || sp.length < 50) throw new Error('SP 내용이 비정상적으로 짧음');
      _spCache = sp;
      return sp;
    } catch (e) {
      console.error('[chat-widget] SP(' + CFG.sp + ') 원격 로드 실패, 최소 폴백 사용:', e.message);
      return '당신은 혼디(Hondi) 공식 안내 AI입니다. 한국어로 간결히 답하세요. ' +
             '모르는 내용은 지어내지 말고 hondi.net에서 검색 후 안내한다고 말하세요.';
    }
  }

  function cpMarkdown(text) {
    var s = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    s = s.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    s = s.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    s = s.replace(/^# (.+)$/gm, '<h3>$1</h3>');
    s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__(.+?)__/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/^[-*_]{3,}\s*$/gm, '<hr>');
    s = s.replace(/^(\d+)\. (.+)$/gm, '<li data-n="$1">$2</li>');
    s = s.replace(/(<li data-n="\d+">.+<\/li>\n?)+/g, function (m) { return '<ol>' + m + '</ol>'; });
    s = s.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');
    s = s.replace(/(<li>.+<\/li>\n?)+/g, function (m) { return '<ul>' + m + '</ul>'; });
    s = s.replace(/<ul>(<li data-n)/g, '$1');
    s = s.replace(/<\/li>\n?<\/ul>(<\/ol>)/g, '</li>$1');
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    var blocks = s.split(/\n{2,}/);
    s = blocks.map(function (block) {
      block = block.trim();
      if (!block) return '';
      if (/^<(h[1-6]|ul|ol|hr|blockquote|pre|code)/.test(block)) return block;
      block = block.replace(/\n/g, '<br>');
      return '<p>' + block + '</p>';
    }).join('\n');
    return s;
  }

  function appendMsg(role, text) {
    var w = document.createElement('div');
    w.className = 'hcw-msg ' + role;
    var b = document.createElement('div');
    b.className = 'hcw-bubble';
    if (role === 'ai') b.innerHTML = cpMarkdown(text); else b.textContent = text;
    w.appendChild(b);
    msgsEl.appendChild(w);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    return b;
  }
  function appendTyping() {
    var w = document.createElement('div');
    w.className = 'hcw-msg ai';
    w.id = 'hcw-typing-wrap';
    w.innerHTML = '<div class="hcw-bubble hcw-typing"><span></span><span></span><span></span></div>';
    msgsEl.appendChild(w);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }
  function removeTyping() {
    var el = document.getElementById('hcw-typing-wrap');
    if (el) el.remove();
  }

  function autoResize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  }
  input.addEventListener('input', autoResize);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  async function send() {
    var text = input.value.trim();
    if (!text || busy) return;
    busy = true;
    sendBtn.disabled = true;
    input.value = '';
    input.style.height = 'auto';

    appendMsg('user', text);
    history.push({ role: 'user', content: text });
    appendTyping();

    try {
      var basePrompt = await loadSP();
      var composedSP = CFG.context ? basePrompt + '\n\n---\n[현재 화면 컨텍스트]\n' + CFG.context : basePrompt;

      var body = JSON.stringify({
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        system: composedSP,
        messages: history,
        max_tokens: 1000,
      });

      var res;
      // 로그인된 사용자는 KAuth.fetchWithAuth로 phone_verify_token을 함께
      // 보낸다 — 서버가 이 토큰을 GDC 과금/사용량 추적에 실제로 연결하려면
      // /ai/chat 쪽 확인이 필요하다(TODO, 이 파일 상단 "과금" 설명 참고).
      if (window.KAuth && CFG.requireAuth !== false) {
        res = await window.KAuth.fetchWithAuth(WORKER_URL + '/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
        });
      } else {
        res = await fetch(WORKER_URL + '/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
        });
      }
      if (!res.ok) throw new Error('Worker ' + res.status);
      var data = await res.json();
      var reply = data.content || '죄송합니다, 답변을 가져오지 못했습니다.';
      history.push({ role: 'assistant', content: reply });
      removeTyping();
      appendMsg('ai', reply);
    } catch (err) {
      removeTyping();
      appendMsg('ai', '네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
      console.error('[chat-widget]', err);
    }

    busy = false;
    sendBtn.disabled = false;
    input.focus();
  }
  sendBtn.addEventListener('click', send);

  function openPanel() {
    if (!opened) {
      appendMsg('ai', CFG.greeting);
      opened = true;
    }
    panel.classList.add('open');
    overlay.classList.add('open');
    input.focus();
  }
  function closePanel() {
    panel.classList.remove('open');
    overlay.classList.remove('open');
  }
  closeBtn.addEventListener('click', closePanel);
  overlay.addEventListener('click', function (e) { if (!panel.contains(e.target)) closePanel(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && panel.classList.contains('open')) closePanel();
  });

  // ── FAB 클릭 → (필요 시) 인증 → 패널 오픈 ─────────────────────
  // KAuth는 .hondi.net 쿠키 기반 SSO이므로, 다른 K-서비스 페이지에서
  // 이미 인증한 사용자는 ensureLogin()이 오버레이 없이 즉시 통과한다.
  async function onFabClick() {
    if (window.KAuth && CFG.requireAuth !== false) {
      fabBtn.disabled = true;
      try {
        await window.KAuth.ensureLogin();
      } finally {
        fabBtn.disabled = false;
      }
      if (!window.KAuth.hasValidLogin()) return; // 사용자가 인증 창을 닫은 경우
    }
    openPanel();
  }
  fabBtn.addEventListener('click', onFabClick);
  fabLabel.addEventListener('click', onFabClick);
})();
