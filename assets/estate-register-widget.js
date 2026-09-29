/* ══════════════════════════════════════════════════════════════════
   estate-register-widget.js — estate.hondi.net "물건 등록" 채팅창 + 실시간
   필드 패널 (v0.1, 2026-09-30)

   estate-search-widget.js(SP-24b)와 같은 발상·같은 제약을 그대로 따른다:
     - estate.hondi.net은 hondi 저장소와 다른 출처(GitHub Pages 별도
       저장소)라 /prompts/sp-catalog.json을 상대경로로 fetch할 수 없다.
       그래서 SP 본문(prompts/SP-24d_kestate_register_v0_1.txt와 내용이
       같아야 함 — 정본은 그 파일, 이 상수는 그 사본)을 이 파일에 직접
       문자열로 담는다. **그 파일을 고치면 이 상수도 함께 고칠 것.**
     - KAuth(로그인) 없이 익명으로 호출한다.
     - 호출 경로: POST https://hondi-proxy.tensor-city.workers.dev/ai/chat
       (estate-search-widget.js와 동일 엔드포인트, 동일 CORS 전제)

   검색 위젯과 다른 점 — 이 위젯 고유의 것:
     1. SP가 매 턴 답변 끝에 내는 `<<<LISTING_FIELDS>>>{...}<<<END>>>`
        마커를 파싱해 화면에는 안내 문장만 보여주고, 마커 내용은
        옆(또는 아래)의 실시간 필드 패널(#estate-register-fields)에
        표로 반영한다.
     2. deepseek-v4-flash는 추론형 모델이라 매 턴 마커 JSON까지 함께
        내야 하는 이 위젯은 검색 위젯(max_tokens:900)보다 추론량이
        많을 수 있다(SP-24a 실행 검증에서 실제로 재현된 문제 —
        docs/kestate/verification-protocol.md 참조). 그래서 이 위젯은
        max_tokens를 더 넉넉히(1600) 잡고, 그래도 답변이 비면 1회
        더 큰 값(3000)으로 재시도한다.
     3. **실제 매물 게시 DB가 없다.** 이 위젯은 대화 내용을 필드
        패널에 정리해 보여주고 "복사하기" 버튼으로 텍스트를 클립보드에
        담아줄 뿐, 실제로 어딘가에 "게시"하지 않는다 — SP-24d 프롬프트
        자신도 대화 끝에 이 사실을 이용자에게 고지한다(R9).

   사용법 — estate 페이지 <body> 안에 두 컨테이너를 두고 이 스크립트를
   뒤에 포함:
     <div id="estate-register-chat"></div>
     <div id="estate-register-fields"></div>
     <script src="https://hondi.net/assets/estate-register-widget.js"></script>
   ══════════════════════════════════════════════════════════════════ */

(function () {
  var CHAT_ID = 'estate-register-chat';
  var FIELDS_ID = 'estate-register-fields';
  var chatEl = document.getElementById(CHAT_ID);
  if (!chatEl) return; // 컨테이너 없는 페이지에서는 아무 것도 하지 않음
  if (chatEl.dataset.erInit) return; // 중복 include 방지
  chatEl.dataset.erInit = '1';
  var fieldsEl = document.getElementById(FIELDS_ID); // 없어도 채팅은 동작(패널만 생략)

  var WORKER_URL = 'https://hondi-proxy.tensor-city.workers.dev';
  var INITIAL_MAX_TOKENS = 1600;
  var RETRY_MAX_TOKENS = 3000;

  // ── SP-24d 본문 사본 — 정본은 hondi 저장소의
  //    prompts/SP-24d_kestate_register_v0_1.txt. 내용을 고치면 반드시
  //    그 파일도 함께 고칠 것(두 파일이 동기화 장치 없이 사본 관계).
  var SYSTEM_PROMPT = [
    '당신은 K-Estate 물건 등록 도우미입니다. 매도인·집주인과 대화해',
    '매물 정보를 구조화된 필드로 채워나갑니다. 한 턴에 정확히 하나의',
    '질문만 합니다.',
    '',
    '핵심 원칙(반드시 지킬 것):',
    '1. 가격을 평가·추천하지 않습니다 — 매도인이 부르는 희망가를',
    '   그대로 기록할 뿐입니다.',
    '2. 확인 안 되는 항목은 빈 값으로 둡니다 — 추측해서 채우지',
    '   않습니다.',
    '3. **실제로 매물을 게시(공개)하지 않습니다.** 이 대화 결과는',
    '   화면 필드 패널에 정리되어 보일 뿐, 실제 매물 등록 데이터베이스에',
    '   저장되지 않습니다. 대화가 끝나갈 때(ready 판단 시점) 이 사실을',
    '   반드시 이용자에게 그대로 알립니다: "여기까지 정리했습니다.',
    '   다만 이 내용이 자동으로 매물로 게시되지는 않습니다 — 아래',
    '   요약을 저장해 두시거나 담당자에게 전달해 주세요."',
    '4. 이 위젯은 텍스트 전용입니다. 사진을 보내겠다고 하면 "이번',
    '   버전은 텍스트로만 받고 있어 사진은 나중에 별도로 첨부해',
    '   주셔야 합니다"라고 정직하게 안내합니다.',
    '',
    '수집 순서(이미 말한 항목은 다시 묻지 않음):',
    '1) 거래 유형(매매/전세/월세), 물건 유형, 주소(동·리 단위 이상)',
    '2) 전용면적/공급면적, 층/전체 층수, 방·욕실 개수, 사용승인일',
    '   (준공연도), 난방방식',
    '3) 주차 가능 대수, 엘리베이터 유무, 관리비(금액+포함 항목),',
    '   반려동물 가능 여부, 입주 가능일',
    '4) 희망 가격(매매가 또는 보증금·월세)과 가격 협의 가능 여부 —',
    '   적정성은 판단하지 않음',
    '5) "나중에 구매자·세입자가 알면 곤란해질 수 있는 사실(누수·소음·',
    '   분쟁·하자 이력 등)이 있는지"를 반드시 한 번 묻고, 답을 검증',
    '   없이 그대로 기록',
    '',
    '완벽주의에 빠지지 않습니다 — 이용자가 자발적으로 주는 정보는',
    '더 받되, 체크리스트처럼 다 채우라고 요구하지 않습니다.',
    '',
    '답변 본문을 먼저 쓰고, 맨 마지막 줄에 반드시 아래 형식의 상태',
    '마커를 한 줄로 덧붙입니다(마커 앞에는 항상 사람이 읽을 안내',
    '문장이 있어야 합니다 — 마커만 단독으로 내지 않습니다):',
    '',
    '<<<LISTING_FIELDS>>>{"deal_type":"","property_type":"","address":"","area_exclusive":"","floor":"","rooms":"","approval_year":"","heating":"","parking":"","elevator":"","management_fee":"","pets":"","move_in_date":"","price":"","negotiable":"","disclosures":"","ready":false}<<<END>>>',
    '',
    '값을 모르면 빈 문자열로 둡니다. 5번 항목까지 마치고 더 채울 필수',
    '항목이 없다고 판단되면 ready를 true로 바꿉니다.',
  ].join('\n');

  var FIELD_LABELS = {
    deal_type: '거래 유형', property_type: '물건 유형', address: '주소',
    area_exclusive: '전용면적', floor: '층', rooms: '방/욕실',
    approval_year: '준공연도', heating: '난방방식', parking: '주차',
    elevator: '엘리베이터', management_fee: '관리비', pets: '반려동물',
    move_in_date: '입주가능일', price: '희망가격', negotiable: '가격협의',
    disclosures: '고지사항',
  };
  var FIELD_ORDER = Object.keys(FIELD_LABELS);

  // ── 스타일 (estate/index.html의 CSS 토큰 :root 변수를 재사용,
  //    estate-search-widget.js의 es- 접두사와 겹치지 않게 er- 사용) ──
  var style = document.createElement('style');
  style.id = 'er-style';
  style.textContent =
    '#' + CHAT_ID + '{border:1px solid var(--border,#e5e7eb);border-radius:var(--radius-lg,10px);background:var(--surface,#fff);overflow:hidden;box-shadow:var(--shadow,0 1px 3px rgba(0,0,0,.08));}' +
    '.er-head{display:flex;align-items:center;gap:8px;padding:14px 18px;border-bottom:1px solid var(--border,#e5e7eb);font-family:Pretendard,sans-serif;font-size:13.5px;font-weight:600;color:var(--text,#0f172a);}' +
    '.er-head .er-dot{width:7px;height:7px;border-radius:50%;background:var(--brand,#3ecf8e);animation:er-blink 2s infinite;flex-shrink:0;}' +
    '@keyframes er-blink{0%,100%{opacity:1}50%{opacity:.35}}' +
    '.er-messages{max-height:360px;min-height:120px;overflow-y:auto;padding:14px 18px;display:flex;flex-direction:column;gap:10px;}' +
    '.er-msg{display:flex;max-width:88%;}' +
    '.er-msg.user{align-self:flex-end;}.er-msg.ai{align-self:flex-start;}' +
    '.er-bubble{padding:9px 13px;border-radius:14px;font-family:Pretendard,sans-serif;font-size:13px;line-height:1.65;word-break:break-word;white-space:pre-wrap;}' +
    '.er-msg.user .er-bubble{background:var(--brand,#3ecf8e);color:#fff;border-bottom-right-radius:4px;}' +
    '.er-msg.ai .er-bubble{background:var(--bg-subtle,#f1f3f5);color:var(--text,#0f172a);border-bottom-left-radius:4px;}' +
    '.er-typing{display:flex;gap:4px;align-items:center;padding:9px 13px;}' +
    '.er-typing span{width:5px;height:5px;border-radius:50%;background:var(--text4,#6b7280);animation:er-dot 1.2s ease-in-out infinite;}' +
    '.er-typing span:nth-child(2){animation-delay:.2s}.er-typing span:nth-child(3){animation-delay:.4s}' +
    '@keyframes er-dot{0%,80%,100%{opacity:.3;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}' +
    '.er-inputrow{display:flex;gap:8px;padding:12px 14px;border-top:1px solid var(--border,#e5e7eb);}' +
    '.er-input{flex:1;resize:none;border:1px solid var(--border,#e5e7eb);outline:none;background:var(--bg-subtle,#f1f3f5);border-radius:10px;padding:9px 12px;font-family:Pretendard,sans-serif;font-size:13px;color:var(--text,#0f172a);line-height:1.5;max-height:100px;min-height:38px;}' +
    '.er-send{border:none;background:var(--text,#0f172a);color:#fff;font-family:Pretendard,sans-serif;font-size:13px;font-weight:600;padding:0 16px;border-radius:10px;cursor:pointer;flex-shrink:0;transition:background .15s;}' +
    '.er-send:hover{background:#1e293b;}.er-send:disabled{background:var(--border2,#d1d5db);cursor:not-allowed;}' +
    '.er-note{padding:8px 18px 12px;font-size:11px;color:var(--text4,#6b7280);border-top:1px solid var(--border,#e5e7eb);font-family:Pretendard,sans-serif;}' +
    '#' + FIELDS_ID + '{border:1px solid var(--border,#e5e7eb);border-radius:var(--radius-lg,10px);background:var(--surface,#fff);overflow:hidden;box-shadow:var(--shadow,0 1px 3px rgba(0,0,0,.08));font-family:Pretendard,sans-serif;}' +
    '.er-fields-head{padding:14px 18px;border-bottom:1px solid var(--border,#e5e7eb);font-size:13.5px;font-weight:600;color:var(--text,#0f172a);}' +
    '.er-fields-list{padding:6px 18px;display:flex;flex-direction:column;}' +
    '.er-field-row{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px dashed var(--border,#e5e7eb);font-size:12.5px;}' +
    '.er-field-row:last-child{border-bottom:none;}' +
    '.er-field-label{color:var(--text4,#6b7280);flex-shrink:0;}' +
    '.er-field-value{color:var(--text,#0f172a);text-align:right;font-weight:500;}' +
    '.er-field-value.empty{color:var(--border2,#d1d5db);font-weight:400;}' +
    '.er-fields-ready{margin:10px 18px 14px;padding:10px 12px;border-radius:8px;background:rgba(62,207,142,.12);color:var(--brand-dk,#1a9e6a);font-size:12px;font-weight:600;display:none;}' +
    '.er-fields-ready.show{display:block;}' +
    '.er-copy-btn{margin:0 18px 16px;padding:8px 14px;border:1px solid var(--border,#e5e7eb);border-radius:8px;background:var(--bg-subtle,#f1f3f5);font-size:12px;font-weight:600;cursor:pointer;color:var(--text,#0f172a);}';
  document.head.appendChild(style);

  chatEl.innerHTML =
    '<div class="er-head"><span class="er-dot"></span>K-Estate 물건 등록 — 대화로 매물 정보를 채워드립니다</div>' +
    '<div class="er-messages" id="er-messages"></div>' +
    '<div class="er-inputrow">' +
      '<textarea class="er-input" id="er-input" rows="1" placeholder="예) 제주시 한림읍 아파트 84제곱미터 매매 내놓으려고 합니다"></textarea>' +
      '<button class="er-send" id="er-send">전송</button>' +
    '</div>' +
    '<div class="er-note">이 채팅은 매물 정보를 정리해 화면에 보여드릴 뿐이며, 가격을 평가하거나 매물을 자동으로 게시하지 않습니다.</div>';

  if (fieldsEl) {
    fieldsEl.innerHTML =
      '<div class="er-fields-head">지금까지 정리된 내용</div>' +
      '<div class="er-fields-list" id="er-fields-list"></div>' +
      '<div class="er-fields-ready" id="er-fields-ready">정리가 끝났습니다 — 자동으로 게시되지 않으니 아래 내용을 복사해 두거나 담당자에게 전달해 주세요.</div>' +
      '<button class="er-copy-btn" id="er-copy-btn">정리된 내용 복사하기</button>';
  }

  var msgsEl  = document.getElementById('er-messages');
  var input   = document.getElementById('er-input');
  var sendBtn = document.getElementById('er-send');
  var fieldsListEl = document.getElementById('er-fields-list');
  var fieldsReadyEl = document.getElementById('er-fields-ready');
  var copyBtn = document.getElementById('er-copy-btn');

  var history = [];
  var busy = false;
  var currentFields = {};
  var GREETED = '안녕하세요! 매물 등록을 도와드릴게요. 먼저 매매인지 전세·월세인지, 그리고 물건 유형(아파트·오피스텔·빌라 등)과 주소를 알려주시겠어요?';

  function appendMsg(role, text) {
    var w = document.createElement('div');
    w.className = 'er-msg ' + role;
    var b = document.createElement('div');
    b.className = 'er-bubble';
    b.textContent = text;
    w.appendChild(b);
    msgsEl.appendChild(w);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }
  function appendTyping() {
    var w = document.createElement('div');
    w.className = 'er-msg ai';
    w.id = 'er-typing';
    w.innerHTML = '<div class="er-bubble er-typing"><span></span><span></span><span></span></div>';
    msgsEl.appendChild(w);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }
  function removeTyping() {
    var el = document.getElementById('er-typing');
    if (el) el.remove();
  }

  // <<<LISTING_FIELDS>>>{...}<<<END>>> 마커를 떼어내고, 파싱된 필드와
  // 화면에 보여줄 나머지 텍스트를 함께 반환한다. 마커가 없거나 JSON이
  // 깨졌으면 fields는 null(패널을 갱신하지 않는다 — 추측해서 채우지
  // 않는다는 원칙을 위젯 쪽에도 그대로 적용).
  function extractFields(text) {
    var m = text.match(/<<<LISTING_FIELDS>>>([\s\S]*?)<<<END>>>/);
    if (!m) return { display: text, fields: null };
    var display = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim();
    var fields = null;
    try { fields = JSON.parse(m[1]); } catch (e) { console.warn('[estate-register-widget] 필드 마커 JSON 파싱 실패', e); }
    return { display: display || text, fields: fields };
  }

  function renderFields(fields) {
    if (!fieldsListEl) return;
    currentFields = fields;
    fieldsListEl.innerHTML = '';
    FIELD_ORDER.forEach(function (key) {
      var val = fields[key];
      var row = document.createElement('div');
      row.className = 'er-field-row';
      var label = document.createElement('span');
      label.className = 'er-field-label';
      label.textContent = FIELD_LABELS[key];
      var value = document.createElement('span');
      value.className = 'er-field-value' + (val ? '' : ' empty');
      value.textContent = val ? String(val) : '아직 확인 안 됨';
      row.appendChild(label);
      row.appendChild(value);
      fieldsListEl.appendChild(row);
    });
    if (fieldsReadyEl) fieldsReadyEl.classList.toggle('show', !!fields.ready);
  }

  function fieldsAsText() {
    var lines = FIELD_ORDER.map(function (key) {
      return FIELD_LABELS[key] + ': ' + (currentFields[key] || '확인 안 됨');
    });
    return '[K-Estate 물건 등록 — 정리된 내용]\n' + lines.join('\n') +
      '\n\n※ 자동으로 게시되지 않습니다. 담당자에게 이 내용을 직접 전달해 주세요.';
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      var text = fieldsAsText();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          copyBtn.textContent = '복사됐습니다!';
          setTimeout(function () { copyBtn.textContent = '정리된 내용 복사하기'; }, 1800);
        }).catch(function () { window.prompt('아래 내용을 직접 복사해 주세요:', text); });
      } else {
        window.prompt('아래 내용을 직접 복사해 주세요:', text);
      }
    });
  }

  appendMsg('ai', GREETED);
  if (fieldsListEl) renderFields({});

  function autoResize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
  }
  input.addEventListener('input', autoResize);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  // ★ 2026-09-30 — SP-24a 실행 검증에서 재현된 것과 같은 문제(추론형
  // 모델이 reasoning_content에 max_tokens를 다 쓰고 content가 비는
  // 현상)를 이 위젯도 만날 수 있어 최소한의 1회 재시도를 둔다.
  async function callChatOnce(maxTokens) {
    var res = await fetch(WORKER_URL + '/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        system: SYSTEM_PROMPT,
        messages: history,
        max_tokens: maxTokens,
      }),
    });
    if (!res.ok) throw new Error('Worker ' + res.status);
    var data = await res.json();
    return data.content || '';
  }
  async function callChat() {
    var reply = await callChatOnce(INITIAL_MAX_TOKENS);
    if (!reply) {
      console.warn('[estate-register-widget] 빈 응답 — max_tokens를 올려 재시도합니다.');
      reply = await callChatOnce(RETRY_MAX_TOKENS);
    }
    return reply || '죄송합니다, 답변을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.';
  }

  async function send() {
    var text = input.value.trim();
    if (!text || busy) return;
    busy = true;
    sendBtn.disabled = true;
    input.value = '';
    input.style.height = 'auto';

    appendMsg('user', text);
    history.push({ role: 'user', content: text });
    if (history.length > 24) history = history.slice(-24);
    appendTyping();

    try {
      var reply = await callChat();
      history.push({ role: 'assistant', content: reply });
      removeTyping();
      var parsed = extractFields(reply);
      appendMsg('ai', parsed.display);
      if (parsed.fields) renderFields(parsed.fields);
    } catch (err) {
      removeTyping();
      appendMsg('ai', '등록 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      console.error('[estate-register-widget]', err);
    }

    busy = false;
    sendBtn.disabled = false;
    input.focus();
  }
  sendBtn.addEventListener('click', send);
})();
