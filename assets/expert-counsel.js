/* 단계별 상담 — 교육·복지 상담형 10개 직역 공통 화면 (2026-10-21)
 * pages/expert-counsel.html?persona=teacher | school-counselor | clinical-psychologist | … (10개 직역, 아래 PERSONAS)
 * 대화는 /pages/expert-chat.html?embed=1 (iframe, 일반인용 상담 SP) 이 맡고, 이 파일은 진행 표시와 단계별 버튼을 맡는다.
 * 규약: 부모→자식 {type:'expert-embed-send', text}, 자식→부모 {type:'expert-embed-reply', text} / {type:'expert-embed-ready'}.
 * 상태 줄: [교사 AI | 상담 진행 트랙 | 현재: K-n | 주제: … | 안전: 이상 없음 | 게이트: …]  (SP STEP K-0 1)
 */
(function () {
  'use strict';
  var PERSONAS = {
    'teacher': { role: '교사(정교사)', tool: '교사 AI', topic: '예: 학생 지도, 학부모 상담' },
    'school-counselor': { role: '전문상담교사', tool: '전문상담교사 AI', topic: '예: 학생 학교생활 상담' },
    'clinical-psychologist': { role: '임상심리사', tool: '임상심리사 AI', topic: '예: 마음이 힘들 때 대처' },
    'mental-health-professional': { role: '정신건강전문요원', tool: '정신건강전문요원 AI', topic: '예: 정신건강 서비스 연결' },
    'social-worker': { role: '사회복지사', tool: '사회복지사 AI', topic: '예: 이용할 수 있는 복지 서비스' },
    'curator': { role: '학예사', tool: '학예사 AI', topic: '예: 전시 기획, 자료 보존' },
    'librarian': { role: '사서', tool: '사서 AI', topic: '예: 자료 찾기, 이용 방법' },
    'youth-counselor': { role: '청소년상담사', tool: '청소년상담사 AI', topic: '예: 청소년 자녀와의 대화' },
    'childcare-teacher': { role: '보육교사', tool: '보육교사 AI', topic: '예: 영유아 보육, 학부모 소통' },
    'lifelong-educator': { role: '평생교육사', tool: '평생교육사 AI', topic: '예: 평생학습 프로그램 선택' }
  };
  var STEPS = [
    { k: 'K-1', t: '안전 확인', s: '위기 신호가 있으면 단계를 멈추고 안전 안내를 먼저 합니다.',
      l: ['자살·자해, 학대·폭력, 급박한 위해, 응급 신호 확인', '신호가 있으면 안전 안내만 — 진행은 멈춤', '신호가 없으면 바로 다음 단계'],
      acts: [['안전 확인 시작', 'K-1 안전 확인부터 진행해 주세요.']] },
    { k: 'K-2', t: '상담 목적 파악', s: '오늘 얻고 싶은 것과 시급도를 정합니다.',
      l: ['정보 · 정리 · 결정 도움 · 기관 연결 중 무엇인지', '주제를 한 줄로 확인'],
      acts: [['다음으로 (K-2)', 'K-2 상담 목적을 파악해 주세요.', true]] },
    { k: 'K-3', t: '상황 정리', s: '사실·느낌·제약을 나누어 정리하고 맞는지 확인합니다.',
      l: ['사실과 해석 구분', '빠진 정보 목록 확인'], g: '이용자 확인 필요',
      acts: [['다음으로 (K-3)', 'K-3 상황을 정리해 주세요.', true], ['정리 수정', 'K-3 정리한 내용 중 고치고 싶은 부분이 있습니다. 어디를 바꿀지 물어봐 주세요.']] },
    { k: 'K-4', t: '선택지 정리', s: '선택지의 장점·부담·준비물을 비교합니다. 고르는 것은 이용자입니다.',
      l: ['선택지 2~4개 나란히 비교', '확신도 표시', '한쪽으로 몰아가지 않음'], g: '선택지 확인',
      acts: [['다음으로 (K-4)', 'K-4 선택지를 정리해 주세요.', true]] },
    { k: 'K-5', t: '자원 안내', s: '조회로 확인한 기관·제도만 안내합니다.',
      l: ['확인 못 한 항목은 [미확인] + 확인처', '사람 전문가 연결이 필요하면 안내'],
      acts: [['다음으로 (K-5)', 'K-5 이용할 수 있는 기관과 제도를 확인해서 안내해 주세요.', true]] },
    { k: 'K-6', t: '정리본', s: '상황·선택지·다음 행동을 한 장으로 정리합니다.',
      l: ['상황 요약 · 선택지 · 고른 방향 · 다음 행동 · 확인처', '문서 초안이 필요하면 초안 표시와 함께', '서명·제출·발송은 이용자가 직접'], g: '정리본 확인',
      acts: [['정리본 작성', 'K-6 정리본을 작성해 주세요.', true], ['문서 초안 요청', 'K-6 정리본에 맞는 문서 초안도 작성해 주세요.']] },
    { k: 'K-7', t: '마무리', s: '후속 확인 시점을 정하고 끝냅니다. 별도 기록은 만들지 않습니다.',
      l: ['후속 확인 시점 제안', '더 필요한 도움 확인', '정리본은 직접 복사·내려받기'],
      acts: [['마무리 (K-7)', 'K-7 마무리해 주세요.', true]] }
  ];

  var qs = new URLSearchParams(location.search);
  var PID = qs.get('persona') || '';
  var P = PERSONAS[PID] || null;
  var KEY = 'expertcounsel_v1_' + PID;
  var st = { cur: 0, done: {}, topic: '', safe: '', gate: '', started: false, stopped: false };
  var lastSummary = '';

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function toast(m) { var t = $('toast'); t.textContent = m; t.classList.add('on'); setTimeout(function () { t.classList.remove('on'); }, 2400); }
  function load() { try { var v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v && typeof v.cur === 'number') { st = Object.assign(st, v); } } catch (e) { /* 저장소 없음 */ } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* 저장소 없음 */ } }

  /* ── 대화 iframe ── */
  var frame, ready = false, queue = [], busy = false, busyTimer = null;
  function post(text) { frame.contentWindow.postMessage({ type: 'expert-embed-send', text: text }, location.origin); }
  function setBusy(v) { busy = v; clearTimeout(busyTimer); if (v) busyTimer = setTimeout(function () { busy = false; }, 150000); }
  function send(text) {
    if (busy) { toast('AI가 응답 중입니다. 잠시 후 다시 눌러 주세요.'); return false; }
    setBusy(true);
    if (ready) post(text); else { queue.push(text); toast('대화창을 불러오는 중입니다. 곧 전송됩니다.'); }
    return true;
  }
  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || !frame || e.source !== frame.contentWindow || !e.data) return;
    if (e.data.type === 'expert-embed-ready') {
      ready = true;
      while (queue.length) post(queue.shift());
    } else if (e.data.type === 'expert-embed-reply') {
      setBusy(false);
      try { parse(String(e.data.text || '')); } catch (x) { console.error(x); }
    }
  });

  /* ── 상태 줄 읽기 ── */
  function parse(reply) {
    var m = /\[[^\]|]*AI\s*\|\s*상담 진행 트랙\s*\|\s*현재:\s*K-([1-7])([^\]]*)\]/.exec(reply || '');
    if (!m) return;
    var n = parseInt(m[1], 10) - 1;
    for (var i = 0; i < n; i++) st.done[i] = true;
    for (var j = n; j < STEPS.length; j++) delete st.done[j];
    st.cur = n; st.started = true;
    var rest = m[2] || '';
    var d = /주제:\s*([^|\]]+)/.exec(rest); if (d) st.topic = d[1].trim();
    var s = /안전:\s*([^|\]]+)/.exec(rest); if (s) { st.safe = s[1].trim(); st.stopped = /중단/.test(st.safe); }
    var g = /게이트:\s*([^|\]]+)/.exec(rest); if (g) st.gate = g[1].trim();
    if (n === 5 || n === 6) lastSummary = reply.replace(/\[[^\]|]*AI\s*\|\s*상담 진행 트랙[^\]]*\]/, '').trim();
    save(); render();
  }

  function downloadSummary() {
    if (!lastSummary) { toast('내려받을 정리본이 아직 없습니다(K-6 이후).'); return; }
    var md = '# 상담 정리본\n\n> ' + (P ? P.tool : '상담 AI') + ' 단계별 상담 K-6. 참고용 정리이며 전문가의 진단·판단을 대신하지 않습니다. 식별정보는 포함하지 마세요.\n\n' + lastSummary + '\n';
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
    a.download = '상담정리본_' + new Date().toISOString().slice(0, 10) + '.md';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /* ── 화면 ── */
  function render() {
    var sm = $('summary');
    sm.innerHTML = (st.started ? '<span class="chip2 ok">진행 중: ' + STEPS[st.cur].k + ' ' + esc(STEPS[st.cur].t) + '</span>' : '<span class="chip2">아직 시작 전</span>') +
      (st.topic && st.topic !== '미정' ? '<span class="chip2">주제: ' + esc(st.topic) + '</span>' : '') +
      (st.stopped ? '<span class="chip2 warn">안전 확인으로 진행 중단</span>' : (st.safe ? '<span class="chip2">안전: ' + esc(st.safe) + '</span>' : '')) +
      (st.gate && st.gate !== '없음' ? '<span class="chip2 warn">게이트: ' + esc(st.gate) + '</span>' : '');
    var pg = $('progress'), box = $('steps'); pg.innerHTML = ''; box.innerHTML = '';
    STEPS.forEach(function (s, i) {
      var done = !!st.done[i], cur = st.started && i === st.cur;
      var p = document.createElement('div'); p.className = 'pg' + (done ? ' done' : '') + (cur ? ' cur' : '') + (cur && st.stopped && i === 0 ? ' stop' : ''); p.innerHTML = '<b>' + s.k + '</b>' + esc(s.t); pg.appendChild(p);
      var d = document.createElement('div'); d.className = 'verdict-step' + (done ? ' done' : '') + (cur ? ' cur open' : '');
      var blocked = st.stopped && i > 0;
      var acts = (s.acts || []).map(function (a, ai) { return '<button class="btn' + (a[2] ? '' : ' sec') + '" data-s="' + i + '" data-a="' + ai + '"' + (cur && !blocked ? '' : ' disabled') + '>' + esc(a[0]) + '</button>'; }).join('');
      d.innerHTML = '<div class="step-head"><span class="step-tag">' + s.k + '</span><span class="step-title">' + esc(s.t) + '</span><span class="step-state">' + (done ? '완료' : cur ? '진행 중' : '대기') + '</span></div>' +
        '<div class="step-body"><p>' + esc(s.s) + '</p><ul>' + s.l.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
        (s.g ? '<span class="gate">' + esc(s.g) + '</span>' : '') +
        (acts ? '<div class="acts">' + acts + '</div>' : '') +
        '<div class="step-complete">✓ 이 단계가 완료된 것으로 표시되었습니다.</div></div>';
      d.querySelector('.step-head').onclick = function () { d.classList.toggle('open'); };
      box.appendChild(d);
    });
    Array.prototype.forEach.call(box.querySelectorAll('button[data-s]'), function (b) {
      b.onclick = function () { var a = STEPS[+b.getAttribute('data-s')].acts[+b.getAttribute('data-a')]; send(a[1]); };
    });
  }

  function startMsg() {
    var topic = $('fTopic').value.trim(), cs = $('fCase').value.trim();
    st.started = true; st.cur = 0; st.stopped = false; if (topic) st.topic = topic; save(); render();
    send('상담 진행 트랙(STEP K)으로 시작합니다. 주제: ' + (topic || '(미정)') + ' / 상황: ' + (cs || '(미입력)') + '. K-1 안전 확인부터 진행해 주세요. 응답 끝에 상태 줄을 붙여 주세요.');
  }

  function init() {
    if (!P) { $('chooser').hidden = false; return; }
    $('app').hidden = false;
    document.title = '단계별 상담 — ' + P.tool;
    var back = '/pages/expert-chat.html?persona=' + encodeURIComponent(PID);
    $('brand').textContent = 'Hondi · ' + P.tool; $('brand').href = back;
    $('crumb').innerHTML = '홈 › <a href="' + back + '">' + esc(P.role) + '</a> › 단계별 상담';
    $('navChat').href = back;
    $('h1').textContent = P.role + ' 단계별 상담 7단계';
    $('sub').textContent = '안전 확인 → 목적 파악 → 상황 정리 → 선택지 정리 → 자원 안내 → 정리본 → 마무리 순서로 진행합니다.';
    $('fTopic').placeholder = P.topic;
    frame = $('chatFrame');
    frame.src = '/pages/expert-chat.html?persona=' + encodeURIComponent(PID) + '&embed=1';
    $('btnStart').onclick = startMsg;
    $('btnSave').onclick = downloadSummary;
    $('btnReset').onclick = function () { st = { cur: 0, done: {}, topic: '', safe: '', gate: '', started: false, stopped: false }; lastSummary = ''; save(); render(); toast('진행 표시를 초기화했습니다.'); };
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.onclick = function () {
        Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (x) { x.classList.toggle('active', x === b); });
        $('p-run').classList.toggle('active', b.dataset.tab === 'run');
        $('p-guide').classList.toggle('active', b.dataset.tab === 'guide');
      };
    });
    load(); render();
  }
  setInterval(function () { var c = $('clock'); if (c) c.textContent = new Date().toLocaleTimeString('ko-KR', { hour12: false, timeZone: 'Asia/Seoul' }); }, 1000);
  init();
  window.ExpertCounsel = { parse: parse };
})();
