/* ══════════════════════════════════════════════════════════════════
   estate-search-widget.js — estate.hondi.net 상단 매물 검색 채팅창 (v1.0, 2026-09-28)

   assets/chat-widget.js(단독 페이지용 채팅 FAB)와 같은 발상이지만 세 가지가
   다르다:
     1. 떠 있는 FAB가 아니라 지정된 컨테이너(#estate-search-chat)에 상시
        노출되는 인라인 패널이다 — "페이지 상단에 채팅창" 요구사항.
     2. estate.hondi.net은 hondi 저장소와 다른 출처(GitHub Pages 별도
        저장소)라 /prompts/sp-catalog.json을 상대경로로 fetch할 수 없다.
        그래서 SP 본문(prompts/SP-24b_kestate_search_v0_1.txt와 내용이
        같아야 함 — 정본은 그 파일, 이 상수는 그 사본)을 이 파일에 직접
        문자열로 담는다. **그 파일을 고치면 이 상수도 함께 고칠 것.**
     3. KAuth(로그인) 없이 익명으로 호출한다 — estate는 별도 로그인 체계가
        없고, 이 SP 자체도 read-only 검색 도우미라 로그인이 필요 없다고
        판단했다(SP-24b_kestate_search_v0_1.txt [핵심 원칙] ③ 참조).

   호출 경로: POST https://hondi-proxy.tensor-city.workers.dev/ai/chat
   이 경로는 CORS(Origin 헤더 화이트리스트, worker.js ALLOWED_ORIGINS에
   'https://estate.hondi.net' 등록 필요)만 검사하고 로그인·과금 게이트가
   없는 기존 그대로의 엔드포인트다 — 이 위젯이 새로 만든 노출이 아니라
   기존 30여 개 hondi.net 서브도메인과 같은 수준의 노출이다. 별도
   rate-limit은 없으니, 남용이 관측되면 worker.js 쪽에 추가 게이트를
   고려할 것(이 파일 단독으로는 처리할 수 없음).

   사용법 — estate 페이지 <body> 안에 컨테이너를 두고 이 스크립트를 뒤에 포함:
     <div id="estate-search-chat"></div>
     <script src="https://hondi.net/assets/estate-search-widget.js"></script>
   ══════════════════════════════════════════════════════════════════ */

(function () {
  var CONTAINER_ID = 'estate-search-chat';
  var container = document.getElementById(CONTAINER_ID);
  if (!container) return; // 컨테이너 없는 페이지에서는 아무 것도 하지 않음
  if (container.dataset.esInit) return; // 중복 include 방지
  container.dataset.esInit = '1';

  var WORKER_URL = 'https://hondi-proxy.tensor-city.workers.dev';

  // ── SP-24b 본문 사본 — 정본은 hondi 저장소의
  //    prompts/SP-24b_kestate_search_v0_1.txt. 내용을 고치면 반드시 그
  //    파일도 함께 고칠 것(두 파일이 동기화 장치 없이 사본 관계).
  var SYSTEM_PROMPT = [
    '당신은 K-Estate 매물 검색 도우미입니다. 사용자와 대화해 원하는 매물',
    '조건(지역·건물 형태·가격대)을 파악하고, 실제 웹 검색으로 찾은 매물만',
    '목록으로 제시합니다.',
    '',
    '핵심 원칙(반드시 지킬 것):',
    '1. 매물 정보를 지어내지 않습니다. 실제 검색 결과가 없으면',
    '   "현재 조건에 맞는 매물을 찾지 못했습니다"라고 정직하게 답합니다.',
    '2. 가격을 평가·추천하지 않습니다("저평가됐다", "제일 좋은 매물이다"',
    '   같은 판단 금지). 찾은 매물을 출처·조회일과 함께 나열만 합니다.',
    '   정확한 시세 평가가 필요하면 등록 감정평가사·공인중개사 상담을',
    '   권합니다(이 위젯은 그 역할을 대신하지 않습니다).',
    '3. 로그인·결제·계약·매물 등록을 하지 않는 순수 조회 도우미입니다.',
    '   전화번호·주민등록번호·계좌 등 개인정보를 요구하거나 저장하지',
    '   않습니다.',
    '',
    '조건 수집: 최소 지역·건물 형태(아파트/오피스텔/빌라·다세대/단독주택/',
    '상가 등)·가격대(전세/월세/매매 구분 포함) 세 가지를 한 턴에 하나씩',
    '물어 확인합니다. 이미 말한 조건은 다시 묻지 않습니다. 사용자가',
    '자발적으로 더 주는 조건(평수·방 개수·준공연도·역세권 여부 등)은',
    '그대로 받아 쓰되, 먼저 목록을 들이밀며 다 채우라고 요구하지',
    '않습니다. 필수 세 가지가 채워지고 사용자가 검색을 원하면 그',
    '시점의 조건으로 바로 검색합니다.',
    '',
    '검색: 국토교통부 실거래가(rt.molit.go.kr), 네이버 부동산',
    '(land.naver.com), 직방(zigbang.com), 다방(dabangapp.com),',
    '호갱노노(hogangnono.com) 등에서 조건에 맞는 매물/시세를 찾습니다.',
    '검색 결과에 없는 세부사항(평수·준공연도 등)은 추측해 채우지',
    '않습니다.',
    '',
    '출력 형식(마크다운, 검색 결과가 있을 때):',
    '목록 앞에 "직접 검색한 결과이며 실시간 매물 상태(거래 완료 여부 등)는',
    '다시 확인이 필요합니다"라고 먼저 안내합니다. 그 다음 각 매물을',
    '"**[매물명/단지명]** — [사이트명]" 제목 아래 가격(검색 결과에 나온',
    '대로, 없으면 "확인 안 됨")·확인된 사실 1~2줄·실제 링크·조회일',
    '(오늘 날짜)을 나열합니다. 목록 뒤에는 "정확한 시세 평가나 계약',
    '진행은 공인중개사·등록 감정평가사 상담을 권합니다"라고 안내합니다.',
    '결과가 없으면 목록 없이 "현재 조건에 맞는 매물을 찾지 못했습니다.',
    '조건을 넓혀 다시 찾아볼까요?"라고만 답합니다.',
    '',
    '한 턴에 정확히 하나의 질문만 하고, 완벽주의에 빠지지 않습니다',
    '(보통 3~5회 질문이면 충분합니다).',
  ].join('\n');

  // ── 스타일 (estate/index.html의 CSS 토큰 :root 변수를 그대로 재사용) ──
  var style = document.createElement('style');
  style.id = 'es-style';
  style.textContent =
    '#' + CONTAINER_ID + '{border:1px solid var(--border,#e5e7eb);border-radius:var(--radius-lg,10px);background:var(--surface,#fff);overflow:hidden;box-shadow:var(--shadow,0 1px 3px rgba(0,0,0,.08));}' +
    '.es-head{display:flex;align-items:center;gap:8px;padding:14px 18px;border-bottom:1px solid var(--border,#e5e7eb);font-family:Pretendard,sans-serif;font-size:13.5px;font-weight:600;color:var(--text,#0f172a);}' +
    '.es-head .es-dot{width:7px;height:7px;border-radius:50%;background:var(--brand,#3ecf8e);animation:es-blink 2s infinite;flex-shrink:0;}' +
    '@keyframes es-blink{0%,100%{opacity:1}50%{opacity:.35}}' +
    '.es-messages{max-height:360px;min-height:120px;overflow-y:auto;padding:14px 18px;display:flex;flex-direction:column;gap:10px;}' +
    '.es-msg{display:flex;max-width:88%;}' +
    '.es-msg.user{align-self:flex-end;}.es-msg.ai{align-self:flex-start;}' +
    '.es-bubble{padding:9px 13px;border-radius:14px;font-family:Pretendard,sans-serif;font-size:13px;line-height:1.65;word-break:break-word;}' +
    '.es-msg.user .es-bubble{background:var(--brand,#3ecf8e);color:#fff;border-bottom-right-radius:4px;}' +
    '.es-msg.ai .es-bubble{background:var(--bg-subtle,#f1f3f5);color:var(--text,#0f172a);border-bottom-left-radius:4px;}' +
    '.es-msg.ai .es-bubble p{margin:0 0 8px;}.es-msg.ai .es-bubble p:last-child{margin-bottom:0;}' +
    '.es-msg.ai .es-bubble strong{font-weight:700;}' +
    '.es-msg.ai .es-bubble a{color:var(--brand-dk,#1a9e6a);text-decoration:underline;text-underline-offset:2px;}' +
    '.es-msg.ai .es-bubble ul,.es-msg.ai .es-bubble ol{margin:6px 0 8px 16px;padding:0;display:flex;flex-direction:column;gap:5px;}' +
    '.es-typing{display:flex;gap:4px;align-items:center;padding:9px 13px;}' +
    '.es-typing span{width:5px;height:5px;border-radius:50%;background:var(--text4,#6b7280);animation:es-dot 1.2s ease-in-out infinite;}' +
    '.es-typing span:nth-child(2){animation-delay:.2s}.es-typing span:nth-child(3){animation-delay:.4s}' +
    '@keyframes es-dot{0%,80%,100%{opacity:.3;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}' +
    '.es-inputrow{display:flex;gap:8px;padding:12px 14px;border-top:1px solid var(--border,#e5e7eb);}' +
    '.es-input{flex:1;resize:none;border:1px solid var(--border,#e5e7eb);outline:none;background:var(--bg-subtle,#f1f3f5);border-radius:10px;padding:9px 12px;font-family:Pretendard,sans-serif;font-size:13px;color:var(--text,#0f172a);line-height:1.5;max-height:100px;min-height:38px;}' +
    '.es-send{border:none;background:var(--text,#0f172a);color:#fff;font-family:Pretendard,sans-serif;font-size:13px;font-weight:600;padding:0 16px;border-radius:10px;cursor:pointer;flex-shrink:0;transition:background .15s;}' +
    '.es-send:hover{background:#1e293b;}.es-send:disabled{background:var(--border2,#d1d5db);cursor:not-allowed;}' +
    '.es-note{padding:8px 18px 12px;font-size:11px;color:var(--text4,#6b7280);border-top:1px solid var(--border,#e5e7eb);font-family:Pretendard,sans-serif;}';
  document.head.appendChild(style);

  container.innerHTML =
    '<div class="es-head"><span class="es-dot"></span>K-Estate 매물 검색 — 지역·건물유형·가격대를 알려주세요</div>' +
    '<div class="es-messages" id="es-messages"></div>' +
    '<div class="es-inputrow">' +
      '<textarea class="es-input" id="es-input" rows="1" placeholder="예) 제주시 한림읍 아파트 전세 1억 이하 찾아줘"></textarea>' +
      '<button class="es-send" id="es-send">전송</button>' +
    '</div>' +
    '<div class="es-note">AI가 직접 웹 검색으로 찾은 결과만 보여주며, 가격 평가나 추천은 하지 않습니다. 정확한 시세·계약은 공인중개사·등록 감정평가사 상담을 권합니다.</div>';

  var msgsEl  = document.getElementById('es-messages');
  var input   = document.getElementById('es-input');
  var sendBtn = document.getElementById('es-send');

  var history = [];
  var busy = false;
  var GREETED = '안녕하세요! 원하시는 지역, 건물 형태(아파트·오피스텔·빌라 등), 가격대를 말씀해 주시면 실제 매물을 찾아드릴게요. 먼저 어느 지역을 찾고 계신가요?';

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  // SP 출력은 간단한 마크다운(굵게·링크·목록)만 쓰므로 최소 변환만 한다.
  function renderMarkdown(text) {
    var s = escapeHtml(text);
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');
    s = s.replace(/(<li>.+<\/li>\n?)+/g, function (m) { return '<ul>' + m + '</ul>'; });
    var blocks = s.split(/\n{2,}/);
    return blocks.map(function (b) {
      b = b.trim();
      if (!b) return '';
      if (/^<(ul|ol)/.test(b)) return b;
      return '<p>' + b.replace(/\n/g, '<br>') + '</p>';
    }).join('\n');
  }

  function appendMsg(role, text) {
    var w = document.createElement('div');
    w.className = 'es-msg ' + role;
    var b = document.createElement('div');
    b.className = 'es-bubble';
    if (role === 'ai') b.innerHTML = renderMarkdown(text); else b.textContent = text;
    w.appendChild(b);
    msgsEl.appendChild(w);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }
  function appendTyping() {
    var w = document.createElement('div');
    w.className = 'es-msg ai';
    w.id = 'es-typing';
    w.innerHTML = '<div class="es-bubble es-typing"><span></span><span></span><span></span></div>';
    msgsEl.appendChild(w);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }
  function removeTyping() {
    var el = document.getElementById('es-typing');
    if (el) el.remove();
  }

  appendMsg('ai', GREETED);

  function autoResize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
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
    // 대화가 지나치게 길어지지 않도록 최근 20턴만 유지(비용·지연 방지).
    if (history.length > 20) history = history.slice(-20);
    appendTyping();

    try {
      var res = await fetch(WORKER_URL + '/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'deepseek',
          model: 'deepseek-v4-flash',
          system: SYSTEM_PROMPT,
          messages: history,
          max_tokens: 900,
        }),
      });
      if (!res.ok) throw new Error('Worker ' + res.status);
      var data = await res.json();
      var reply = data.content || '죄송합니다, 답변을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.';
      history.push({ role: 'assistant', content: reply });
      removeTyping();
      appendMsg('ai', reply);
    } catch (err) {
      removeTyping();
      appendMsg('ai', '검색 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      console.error('[estate-search-widget]', err);
    }

    busy = false;
    sendBtn.disabled = false;
    input.focus();
  }
  sendBtn.addEventListener('click', send);
})();
