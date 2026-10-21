/* 서류 작성하기 — 법무사·행정사 공통 단계 화면 (2026-10-21)
 * pages/scrivener-write.html?persona=judicial-scrivener | administrative-scrivener | loss-adjuster | labor-attorney | customs-broker
 * 대화는 /pages/expert-chat.html?embed=1 (iframe) 이 맡고, 이 파일은 진행 표시·단계별 버튼·제출 결과 기록을 맡는다.
 * 규약: 부모→자식 {type:'expert-embed-send', text}, 자식→부모 {type:'expert-embed-reply', text} / {type:'expert-embed-ready'}.
 * 상태 줄: [법무사 보조 AI | 서류 작성 트랙 | 현재: W-n | 서류: … | 서식: … | 게이트: …]  (SP STEP W-0 7)
 */
(function () {
  'use strict';
  var PERSONAS = {
    'architect': {
      role: '건축사', tool: '건축사 보조 AI', back: '/pages/architect.html',
      docHint: '예: 건축허가 신청 서류', toHint: '예: 허가권자'
    },
    'industrial-safety-consultant': {
      role: '산업안전·보건지도사', tool: '산업안전·보건지도사 보조 AI', back: '/pages/industrial-safety-consultant.html',
      docHint: '예: 위험성평가 보고서', toHint: '예: 의뢰 사업장'
    },
    'fire-safety-manager': {
      role: '소방시설관리사', tool: '소방시설관리사 보조 AI', back: '/pages/fire-safety-manager.html',
      docHint: '예: 자체점검 결과 보고서', toHint: '예: 관할 소방 관련 기관'
    },
    'landscape-engineer': {
      role: '조경기술사', tool: '조경기술사 보조 AI', back: '/pages/landscape-engineer.html',
      docHint: '예: 조경 설계 검토서', toHint: '예: 관할 지방자치단체'
    },
    'surveying-engineer': {
      role: '측량 및 지형공간정보기술사', tool: '측량 및 지형공간정보기술사 보조 AI', back: '/pages/surveying-engineer.html',
      docHint: '예: 측량 성과 검토서', toHint: '예: 관할 기관'
    },
    'electrical-safety-engineer': {
      role: '전기안전기술사', tool: '전기안전기술사 보조 AI', back: '/pages/electrical-safety-engineer.html',
      docHint: '예: 점검 결과 보고서', toHint: '예: 설비 소유자'
    },
    'gas-safety-engineer': {
      role: '가스기술사', tool: '가스기술사 보조 AI', back: '/pages/gas-safety-engineer.html',
      docHint: '예: 안전성 평가 서류', toHint: '예: 사업자'
    },
    'judicial-scrivener': {
      role: '법무사', tool: '법무사 보조 AI', back: '/pages/judicial-scrivener.html',
      docHint: '예: 소유권이전등기신청서', toHint: '예: 관할 등기소, 지방법원'
    },
    'administrative-scrivener': {
      role: '행정사', tool: '행정사 보조 AI', back: '/pages/administrative-scrivener.html',
      docHint: '예: 이의신청서, 영업신고서', toHint: '예: ○○시청 민원과'
    },
    'loss-adjuster': {
      role: '손해사정사', tool: '손해사정사 보조 AI', back: '/pages/loss-adjuster.html',
      docHint: '예: 손해사정서', toHint: '예: 보험회사'
    },
    'labor-attorney': {
      role: '노무사', tool: '노무사 보조 AI', back: '/pages/labor-attorney.html',
      docHint: '예: 진정서, 구제신청서', toHint: '예: 관할 지방고용노동관서, 노동위원회'
    },
    'customs-broker': {
      role: '관세사', tool: '관세사 보조 AI', back: '/pages/customs-broker.html',
      docHint: '예: 수입신고 관련 서류', toHint: '예: 관할 세관'
    }
  };
  var STEPS = [
    { k: 'W-1', t: '서식 결정', s: '대화로 서류의 목적과 제출처를 정하고 후보 서식을 고릅니다.',
      l: ['서류 목적·제출처 확인', '후보 서식 1~3개와 근거', '법정 서식 / 관행 서류 구분'],
      acts: [['후보 서식 제안 요청', 'W-1 후보 서식을 제안해 주세요.']] },
    { k: 'W-2', t: '서식 승인', s: '결정한 서식의 항목·첨부·기한 요약을 이용자가 승인합니다.',
      l: ['항목 · 첨부서류 · 기한 한 장 요약', '항목 추가·삭제·순서 변경 반영', '승인 전에는 본문을 작성하지 않음'], g: '이용자 승인 필요',
      acts: [['이 서식으로 승인', 'W-2 요약된 서식을 승인합니다. W-3으로 진행해 주세요.', true], ['수정 요청', 'W-2 서식을 수정하고 싶습니다. 어떤 항목을 바꿀지 물어봐 주세요.']] },
    { k: 'W-3', t: '서식 DB 확인·저장', s: '서식 DB에서 찾고, 없으면 새로 구성해 빈 서식만 저장하도록 제안합니다.',
      l: ['서식 DB 조회 (기관·서식명)', '없으면 첨부 요청 → 신규 구성', '개인·사안 값을 지운 빈 서식만 저장 제안 — 동의는 이용자가 결정'],
      acts: [['서식 DB 조회 진행', 'W-3 승인된 서식을 서식 DB에서 조회해 주세요.']] },
    { k: 'W-4', t: '추가 자료 획득', s: '서식의 빈 항목에 필요한 자료를 이용자에게서 받습니다.',
      l: ['누락 항목 표 (이유 · 제공/조회/자격자 기재)', '3개 이내로 되묻기', '법령·기한은 조회로 확인'],
      acts: [['누락 항목 정리 요청', 'W-4 서식의 빈 항목을 정리하고 필요한 자료를 알려 주세요.']] },
    { k: 'W-5', t: '서류 작성', s: '승인된 서식대로 초안을 작성합니다. 기명날인란은 비워 둡니다.',
      l: ['승인된 항목·순서 그대로', '전송 전 검증 결과 표시', '남은 확인 필요 항목 수'],
      acts: [['서류 작성 시작', 'W-5 서류 초안을 작성해 주세요.']] },
    { k: 'W-6', t: '서류 검증·승인', s: '이용자가 초안을 검증하고 제출 준비로 넘어갈지 승인합니다.',
      l: ['수정 반영 (바뀐 곳 목록)', '검토 체크리스트는 이용자가 확인', '승인은 제출 준비로 넘어가는 확인'], g: '이용자 승인 필요',
      acts: [['초안 승인 — 제출 준비로', 'W-6 작성된 서류를 검증했고 제출 준비를 진행하겠습니다. 승인합니다.', true], ['수정 요청', 'W-6 서류를 수정하고 싶습니다. 어떤 부분을 바꿀지 물어봐 주세요.']] },
    { k: 'W-7', t: '제출 준비 (dpaper)', s: '제출처·접수 방식·첨부·기한을 담은 제출 패키지를 정리합니다. dpaper는 미연동입니다.',
      l: ['제출처(기관·부서)·접수 방식·기한', '제출 서류 목록과 제출 전 점검', '제출은 자격자 또는 본인이 직접 — 연동 후에도 본인 인증으로만'], g: '자격자 제출 대기',
      acts: [['제출 패키지 정리 요청', 'W-7 제출 패키지를 정리해 주세요.'], ['제출을 마쳤습니다', 'W-7 제출을 직접 마쳤습니다. W-8로 진행해 주세요.', true]], dpaper: true },
    { k: 'W-8', t: '수수료 납부 준비', s: '필요한 수수료 항목과 납부 방법을 조회해 정리합니다. 납부는 직접 합니다.',
      l: ['수수료 항목·금액은 조회로 확인한 것만', '납부 방법·기한 안내', '이 도구는 결제 정보를 받지 않음'], g: '납부 대기',
      acts: [['수수료 항목 조회 요청', 'W-8 필요한 수수료 항목과 납부 방법을 조회해 정리해 주세요.'], ['납부를 마쳤습니다(또는 해당 없음)', 'W-8 수수료 납부를 직접 마쳤습니다(또는 납부 대상이 없습니다). W-9로 진행해 주세요.', true]] },
    { k: 'W-9', t: '제출 결과 기록', s: '접수번호·일시·납부·결과를 이용자가 알려 준 대로 기록합니다.',
      l: ['이용자 보고 기준으로만 기록', '모르는 칸은 미확인', '보정·반려 시 W-5로 되돌아감'], record: true }
  ];

  var qs = new URLSearchParams(location.search);
  var PID = qs.get('persona') || '';
  var P = PERSONAS[PID] || null;
  var KEY = 'scrivwrite_v1_' + PID;
  var st = { cur: 0, done: {}, doc: '', form: '', gate: '', started: false, records: [] };

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
    var m = /\[[^\]|]*보조 AI\s*\|\s*서류 작성 트랙\s*\|\s*현재:\s*W-([1-9])([^\]]*)\]/.exec(reply || '');
    if (!m) return;
    var n = parseInt(m[1], 10) - 1;
    for (var i = 0; i < n; i++) st.done[i] = true;
    for (var j = n; j < STEPS.length; j++) delete st.done[j];
    st.cur = n; st.started = true;
    var rest = m[2] || '';
    var d = /서류:\s*([^|\]]+)/.exec(rest); if (d) st.doc = d[1].trim();
    var f = /서식:\s*([^|\]]+)/.exec(rest); if (f) st.form = f[1].trim();
    var g = /게이트:\s*([^|\]]+)/.exec(rest); if (g) st.gate = g[1].trim();
    save(); render();
  }

  /* ── 제출 결과 기록 (W-9, 이용자 보고 기준) ── */
  function recordForm() {
    return '<div class="conf-block" style="margin:10px 0 0">' +
      '<h3>제출 결과 입력 (이용자 보고 — 모르는 칸은 비워 두세요)</h3>' +
      '<div class="row"><label>제출처(기관·부서)<input id="rOrg" maxlength="80"></label><label>제출 일시<input id="rAt" placeholder="예: 2026-10-21 14:30"></label><label>접수번호<input id="rNo" maxlength="60"></label></div>' +
      '<div class="row" style="margin-top:8px"><label>납부 항목·금액<input id="rPay" placeholder="예: 인지대 ○○원, 송달료 ○○원" maxlength="120"></label>' +
      '<label>결과<select id="rRes"><option>접수</option><option>처리 중</option><option>보정 요구</option><option>반려</option><option>완료</option></select></label></div>' +
      '<div class="row" style="margin-top:8px"><label style="flex-basis:100%">후속 기한·할 일<input id="rNext" maxlength="160"></label></div>' +
      '<div class="acts"><button class="btn" id="btnRec">기록하기</button><button class="btn sec" id="btnDl">기록 내려받기(.md)</button></div>' +
      '<div id="recList"></div></div>';
  }
  function renderRecords() {
    var box = $('recList'); if (!box) return;
    if (!st.records.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<table class="rec-table"><thead><tr><th>서류</th><th>제출처</th><th>일시</th><th>접수번호</th><th>납부</th><th>결과</th></tr></thead><tbody>' +
      st.records.map(function (r) { return '<tr><td>' + esc(r.doc) + '</td><td>' + esc(r.org) + '</td><td>' + esc(r.at) + '</td><td>' + esc(r.no) + '</td><td>' + esc(r.pay) + '</td><td>' + esc(r.res) + '</td></tr>'; }).join('') + '</tbody></table>';
  }
  function val(id) { var e = $(id); return e ? e.value.trim() : ''; }
  function addRecord() {
    var r = { doc: st.doc || val('fDoc') || '[미확인]', org: val('rOrg') || '[미확인]', at: val('rAt') || '[미확인]', no: val('rNo') || '[미확인]', pay: val('rPay') || '[미확인]', res: val('rRes'), next: val('rNext') || '[미확인]', saved: new Date().toISOString() };
    st.records.push(r); st.done[8] = true; save(); renderRecords();
    send('W-9 제출 결과를 기록해 주세요(이용자 보고 기준). 서류: ' + r.doc + ' / 제출처: ' + r.org + ' / 제출 일시: ' + r.at + ' / 접수번호: ' + r.no + ' / 납부: ' + r.pay + ' / 결과: ' + r.res + ' / 후속: ' + r.next + '. 모르는 칸은 [미확인]으로 두고, 보정·반려가 있으면 W-5로 돌아갈지 알려 주세요.');
  }
  function downloadRecords() {
    if (!st.records.length) { toast('기록된 내용이 없습니다.'); return; }
    var md = '# 제출 결과 기록 (이용자 보고 기준)\n\n> ' + (P ? P.tool : '보조 AI') + ' 서류 작성 트랙 W-9. 사무 기록 초안이며 법정 장부의 대체가 아닙니다. 모르는 칸은 [미확인].\n\n' +
      st.records.map(function (r, i) {
        return '## ' + (i + 1) + '. ' + r.doc + '\n\n- 제출처: ' + r.org + '\n- 제출 일시: ' + r.at + '\n- 접수번호: ' + r.no + '\n- 납부: ' + r.pay + '\n- 결과: ' + r.res + '\n- 후속 기한·할 일: ' + r.next + '\n- 기록 시각: ' + r.saved + '\n';
      }).join('\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
    a.download = '제출결과기록_' + new Date().toISOString().slice(0, 10) + '.md';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /* ── 화면 ── */
  function render() {
    var sm = $('summary');
    sm.innerHTML = (st.started ? '<span class="chip2 ok">진행 중: ' + STEPS[st.cur].k + ' ' + esc(STEPS[st.cur].t) + '</span>' : '<span class="chip2">아직 시작 전</span>') +
      (st.doc ? '<span class="chip2">서류: ' + esc(st.doc) + '</span>' : '') +
      (st.form ? '<span class="chip2">서식: ' + esc(st.form) + '</span>' : '') +
      (st.gate && st.gate !== '없음' ? '<span class="chip2 warn">게이트: ' + esc(st.gate) + '</span>' : '') +
      '<span class="chip2 warn">dpaper 연동: 미연동</span>';
    var pg = $('progress'), box = $('steps'); pg.innerHTML = ''; box.innerHTML = '';
    STEPS.forEach(function (s, i) {
      var done = !!st.done[i], cur = st.started && i === st.cur;
      var p = document.createElement('div'); p.className = 'pg' + (done ? ' done' : '') + (cur ? ' cur' : ''); p.innerHTML = '<b>' + s.k + '</b>' + esc(s.t); pg.appendChild(p);
      var d = document.createElement('div'); d.className = 'verdict-step' + (done ? ' done' : '') + (cur ? ' cur open' : '');
      var acts = (s.acts || []).map(function (a, ai) { return '<button class="btn' + (a[2] ? '' : ' sec') + '" data-s="' + i + '" data-a="' + ai + '"' + (cur ? '' : ' disabled') + '>' + esc(a[0]) + '</button>'; }).join('');
      if (s.dpaper) acts += '<button class="btn sec" disabled title="dpaper API가 아직 연동되지 않았습니다. 제출은 기관이 정한 방법으로 직접 하세요.">dpaper로 제출 (미연동)</button>';
      d.innerHTML = '<div class="step-head"><span class="step-tag">' + s.k + '</span><span class="step-title">' + esc(s.t) + '</span><span class="step-state">' + (done ? '완료' : cur ? '진행 중' : '대기') + '</span></div>' +
        '<div class="step-body"><p>' + esc(s.s) + '</p><ul>' + s.l.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
        (s.g ? '<span class="gate">' + esc(s.g) + '</span>' : '') +
        (acts ? '<div class="acts">' + acts + '</div>' : '') + (s.record ? recordForm() : '') +
        '<div class="step-complete">✓ 이 단계가 완료된 것으로 표시되었습니다.</div></div>';
      d.querySelector('.step-head').onclick = function () { d.classList.toggle('open'); };
      box.appendChild(d);
    });
    Array.prototype.forEach.call(box.querySelectorAll('button[data-s]'), function (b) {
      b.onclick = function () { var a = STEPS[+b.getAttribute('data-s')].acts[+b.getAttribute('data-a')]; send(a[1]); };
    });
    var br = $('btnRec'); if (br) br.onclick = addRecord;
    var bd = $('btnDl'); if (bd) bd.onclick = downloadRecords;
    renderRecords();
  }

  function startMsg() {
    var doc = val('fDoc'), to = val('fTo'), cs = val('fCase');
    var sel = $('fRole'), who = sel.options[sel.selectedIndex].text;
    st.started = true; st.cur = 0; if (doc) st.doc = doc; save(); render();
    send('서류 작성 트랙(STEP W)을 시작합니다. 이용자: ' + who + ' / 작성할 서류: ' + (doc || '(미정)') + ' / 제출처: ' + (to || '(미정)') + ' / 사안 요약: ' + (cs || '(미입력)') + '. W-1부터 진행해 주시고, 부족한 항목은 3개 이내로 먼저 물어봐 주세요.');
  }

  function init() {
    if (!P) { $('chooser').hidden = false; return; }
    $('app').hidden = false;
    document.title = '서류 작성하기 — ' + P.tool;
    $('brand').textContent = 'Hondi · ' + P.tool; $('brand').href = P.back;
    $('crumb').innerHTML = '홈 › <a href="' + P.back + '">' + esc(P.role) + '</a> › 서류 작성하기';
    $('navList').href = P.back;
    $('h1').textContent = P.role + ' 서류 작성하기 9단계';
    $('sub').textContent = '서식 결정 → 서식 승인 → 서식 DB → 추가 자료 → 작성 → 검증·승인 → 제출 준비 → 수수료 → 결과 기록 순서로 진행합니다.';
    $('fDoc').placeholder = P.docHint; $('fTo').placeholder = P.toHint; $('optPro').textContent = P.role;
    frame = $('chatFrame');
    frame.src = '/pages/expert-chat.html?persona=' + encodeURIComponent(PID) + '&embed=1';
    $('btnStart').onclick = startMsg;
    $('btnReset').onclick = function () { st = { cur: 0, done: {}, doc: '', form: '', gate: '', started: false, records: st.records }; save(); render(); toast('진행 표시를 초기화했습니다. 제출 결과 기록은 남겨 두었습니다.'); };
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.onclick = function () {
        Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (x) { x.classList.toggle('active', x === b); });
        $('p-run').classList.toggle('active', b.dataset.tab === 'run');
        $('p-guide').classList.toggle('active', b.dataset.tab === 'guide');
      };
    });
    var pre = qs.get('doc'); if (pre) $('fDoc').value = pre.slice(0, 80);
    load(); render();
  }
  setInterval(function () { var c = $('clock'); if (c) c.textContent = new Date().toLocaleTimeString('ko-KR', { hour12: false, timeZone: 'Asia/Seoul' }); }, 1000);
  init();
  window.ScrivenerWrite = { parse: parse };
})();
