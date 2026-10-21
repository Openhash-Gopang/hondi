/* 단계별 구매 자문 — K-Advisor 전용 화면 (2026-10-21)
 * pages/advisor-steps.html
 * 대화는 /pages/expert-chat.html?persona=advisor&embed=1 (iframe, 구매자 본인용 자문 SP) 이 맡고, 이 파일은 진행 표시와 단계별 버튼을 맡는다.
 * 규약: 부모→자식 {type:'expert-embed-send', text}, 자식→부모 {type:'expert-embed-reply', text} / {type:'expert-embed-ready'}.
 * 상태 줄: [K-Advisor | 구매 자문 트랙 | 현재: K-n | 상품: … | 주의: 이상 없음 | 게이트: …]  (SP §3-9 K-0 1)
 */
(function () {
  'use strict';
  var PID = 'advisor';
  var P = { role: '구매자문(K-Advisor)', tool: 'K-Advisor', topic: '예: 노트북 ○○ 모델, 헬스장 12개월 이용권' };
  var STEPS = [
    { k: 'K-1', t: '사기 징후·이해관계 확인', s: '사기 징후가 있으면 멈추고 구매 보류를 권고합니다. 판매자 대가가 없음을 밝히고 광고·수수료 링크 여부를 확인합니다.',
      l: ['터무니없는 할인·고액 선입금·상품권 선결제 등 확인', '이 도구는 판매자·플랫폼 대가를 받지 않음', '가져온 추천·리뷰가 광고·협찬·제휴 수수료인지 확인'],
      acts: [['사기 징후·이해관계 확인 시작', 'K-1 사기 징후와 이해관계 확인부터 진행해 주세요.']] },
    { k: 'K-2', t: '구매 목적·예산·보유 대안', s: '사용 목적, 예산 상한, 이미 가진 대안을 확인합니다.',
      l: ['무엇에 쓰는지', '예산 상한과 구매 시점', '이미 가진 대안'],
      acts: [['다음으로 (K-2)', 'K-2 구매 목적과 예산을 확인해 주세요.', true]] },
    { k: 'K-3', t: '상품·조건 정리', s: '표시 가격과 실제 청구 조건을 표로 정리하고 맞는지 확인합니다.',
      l: ['배송비·숨은 수수료·자동갱신·위약금', '첨부 자료는 먼저 1차 스캔'], g: '조건 확인',
      acts: [['다음으로 (K-3)', 'K-3 상품과 조건을 정리해 주세요.', true], ['정리 수정', 'K-3 정리한 조건 중 고치고 싶은 부분이 있습니다. 어디를 바꿀지 물어봐 주세요.']] },
    { k: 'K-4', t: '가격 공정성 평가', s: '동종 상품군 안에서의 위치를 근거와 함께 평가합니다.',
      l: ['비교 표본·조회 시점 표시', '비교 데이터가 부족하면 평가하지 않는다고 밝힘', '확신도 표시'],
      acts: [['다음으로 (K-4)', 'K-4 가격 공정성을 평가해 주세요. 비교 근거와 한계를 함께 알려 주세요.', true]] },
    { k: 'K-5', t: '필요성·대안', s: '목적에 맞는지, 더 나은 대안이 있는지 봅니다.',
      l: ['더 저렴한 동종 상품·이미 가진 것으로 충분한지', '사지 않는 것이 맞다면 그렇게 말함'],
      acts: [['다음으로 (K-5)', 'K-5 구매 필요성과 대안을 평가해 주세요.', true]] },
    { k: 'K-6', t: '결론', s: '가격 공정성과 필요성을 합친 결론을 확신도와 한계와 함께 냅니다.',
      l: ['결론 한 문단', '확신도와 표본·시점 한계', '다음 행동 질문'], g: '결론 확인',
      acts: [['결론 보기', 'K-6 결론을 정리해 주세요.', true]] },
    { k: 'K-7', t: '정리본', s: '평가·근거·대안·다음 행동을 한 장으로 정리합니다. 구매 여부는 이용자가 정합니다.',
      l: ['상품·조건 · 평가와 근거 · 대안 · 이용자의 결정 · 다음 행동', '정리본은 직접 복사·내려받기'],
      acts: [['정리본 작성', 'K-7 정리본을 작성해 주세요.', true]] }
  ];

  var qs = new URLSearchParams(location.search);
  var KEY = 'advisorsteps_v1';
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
    var m = /\[K-Advisor\s*\|\s*구매 자문 트랙\s*\|\s*현재:\s*K-([1-7])([^\]]*)\]/.exec(reply || '');
    if (!m) return;
    var n = parseInt(m[1], 10) - 1;
    for (var i = 0; i < n; i++) st.done[i] = true;
    for (var j = n; j < STEPS.length; j++) delete st.done[j];
    st.cur = n; st.started = true;
    var rest = m[2] || '';
    var d = /상품:\s*([^|\]]+)/.exec(rest); if (d) st.topic = d[1].trim();
    var s = /주의:\s*([^|\]]+)/.exec(rest); if (s) { st.safe = s[1].trim(); st.stopped = /사기 징후/.test(st.safe); }
    var g = /게이트:\s*([^|\]]+)/.exec(rest); if (g) st.gate = g[1].trim();
    if (n === 6) lastSummary = reply.replace(/\[K-Advisor\s*\|\s*구매 자문 트랙[^\]]*\]/, '').trim();
    save(); render();
  }

  function downloadSummary() {
    if (!lastSummary) { toast('내려받을 정리본이 아직 없습니다(K-7 이후).'); return; }
    var md = '# 구매 자문 정리본\n\n> K-Advisor 단계별 구매 자문 K-7. 구매 판단 참고용 정리이며 가격 적정성 확인서나 보증이 아닙니다. 결제·인증 정보는 포함하지 마세요.\n\n' + lastSummary + '\n';
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
    a.download = '구매자문정리본_' + new Date().toISOString().slice(0, 10) + '.md';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /* ── 화면 ── */
  function render() {
    var sm = $('summary');
    sm.innerHTML = (st.started ? '<span class="chip2 ok">진행 중: ' + STEPS[st.cur].k + ' ' + esc(STEPS[st.cur].t) + '</span>' : '<span class="chip2">아직 시작 전</span>') +
      (st.topic && st.topic !== '미정' ? '<span class="chip2">주제: ' + esc(st.topic) + '</span>' : '') +
      (st.stopped ? '<span class="chip2 warn">사기 징후로 진행 중단</span>' : (st.safe ? '<span class="chip2">주의: ' + esc(st.safe) + '</span>' : '')) +
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
    send('구매 자문 트랙(STEP K)으로 시작합니다. 상품·서비스: ' + (topic || '(미정)') + ' / 상황: ' + (cs || '(미입력)') + '. K-1 사기 징후·이해관계 확인부터 진행해 주세요. 응답 끝에 상태 줄을 붙여 주세요.');
  }

  function init() {
    document.title = '단계별 구매 자문 — ' + P.tool;
    var back = '/pages/advisor.html';
    $('brand').textContent = 'Hondi · ' + P.tool; $('brand').href = back;
    $('crumb').innerHTML = '홈 › <a href="' + back + '">' + esc(P.role) + '</a> › 단계별 구매 자문';
    $('navChat').href = back;
    $('h1').textContent = P.role + ' 단계별 구매 자문 7단계';
    $('sub').textContent = '사기 징후·이해관계 확인 → 목적·예산 → 조건 정리 → 가격 공정성 → 필요성·대안 → 결론 → 정리본 순서로 진행합니다.';
    $('fTopic').placeholder = P.topic;
    frame = $('chatFrame');
    frame.src = '/pages/expert-chat.html?persona=advisor&embed=1';
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
  window.AdvisorSteps = { parse: parse };
})();
