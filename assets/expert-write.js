/* 서류 작성하기 — 보건의료 계열 공통 단계 화면 (2026-10-21)
 * pages/expert-write.html?persona=dentist | pharmacist | nurse | … (19개 직역, 아래 PERSONAS)
 * 대화는 /pages/expert-chat.html?embed=1 (iframe) 이 맡고, 이 파일은 진행 표시·단계별 버튼·제출 결과 기록을 맡는다.
 * 규약: 부모→자식 {type:'expert-embed-send', text}, 자식→부모 {type:'expert-embed-reply', text} / {type:'expert-embed-ready'}.
 * 상태 줄: [치과의사 보조 AI | 서류 작성 트랙 | 현재: W-n | 서류: … | 서식: … | 게이트: …]  (SP STEP W-0 8)
 */
(function () {
  'use strict';
  var PERSONAS = {
    'professional-engineer': {
      role: '기술사', tool: '기술사 보조 AI', back: '/pages/professional-engineer.html', judge: '기술 검토·안전성 판단',
      docHint: '예: 기술 검토서', toHint: '예: 의뢰인'
    },
    'naval-architect': {
      role: '조선사', tool: '조선사 보조 AI', back: '/pages/naval-architect.html', judge: '설계·적합성 판단',
      docHint: '예: 설계 검토서', toHint: '예: 의뢰인'
    },
    'navigation-officer': {
      role: '항해사', tool: '항해사 보조 AI', back: '/pages/navigation-officer.html', judge: '항해·운항 판단',
      docHint: '예: 항해 기록 정리', toHint: '예: 선사·관련 기관'
    },
    'marine-engineer': {
      role: '기관사(선박)', tool: '기관사(선박) 보조 AI', back: '/pages/marine-engineer.html', judge: '기관 상태·운전 판단',
      docHint: '예: 기관 기록 정리', toHint: '예: 선사·관련 기관'
    },
    'weather-forecaster': {
      role: '기상예보사', tool: '기상예보사 보조 AI', back: '/pages/weather-forecaster.html', judge: '기상 현상 판단·예보',
      docHint: '예: 기상 참고자료', toHint: '예: 내부 검토'
    },
    'dentist': {
      role: '치과의사', tool: '치과의사 보조 AI', back: '/pages/dentist.html',
      docHint: '예: 진단서', toHint: '예: 환자'
    },
    'traditional-medicine-doctor': {
      role: '한의사', tool: '한의사 보조 AI', back: '/pages/traditional-medicine-doctor.html',
      docHint: '예: 진단서', toHint: '예: 환자'
    },
    'pharmacist': {
      role: '약사', tool: '약사 보조 AI', back: '/pages/pharmacist.html',
      docHint: '예: 조제·복약지도 기록', toHint: '예: 환자'
    },
    'veterinarian': {
      role: '수의사', tool: '수의사 보조 AI', back: '/pages/veterinarian.html',
      docHint: '예: 진단서', toHint: '예: 보호자'
    },
    'nurse': {
      role: '간호사', tool: '간호사 보조 AI', back: '/pages/nurse.html',
      docHint: '예: 간호기록', toHint: '예: 병동'
    },
    'physical-therapist': {
      role: '물리치료사', tool: '물리치료사 보조 AI', back: '/pages/physical-therapist.html',
      docHint: '예: 평가·치료 기록', toHint: '예: 의사'
    },
    'medical-lab-technologist': {
      role: '임상병리사', tool: '임상병리사 보조 AI', back: '/pages/medical-lab-technologist.html',
      docHint: '예: 검사 수행 기록', toHint: '예: 의뢰 부서'
    },
    'radiologic-technologist': {
      role: '방사선사', tool: '방사선사 보조 AI', back: '/pages/radiologic-technologist.html',
      docHint: '예: 촬영 수행 기록', toHint: '예: 의뢰 부서'
    },
    'dental-hygienist': {
      role: '치과위생사', tool: '치과위생사 보조 AI', back: '/pages/dental-hygienist.html',
      docHint: '예: 치과위생 처치 기록', toHint: '예: 치과의사'
    },
    'occupational-therapist': {
      role: '작업치료사', tool: '작업치료사 보조 AI', back: '/pages/occupational-therapist.html',
      docHint: '예: 평가·중재 기록', toHint: '예: 의사'
    },
    'dental-technician': {
      role: '치과기공사', tool: '치과기공사 보조 AI', back: '/pages/dental-technician.html',
      docHint: '예: 기공물 제작 기록', toHint: '예: 의뢰 치과'
    },
    'advanced-practice-nurse': {
      role: '전문간호사', tool: '전문간호사 보조 AI', back: '/pages/advanced-practice-nurse.html',
      docHint: '예: 전문 간호 평가·중재 기록', toHint: '예: 협력 의사'
    },
    'dietitian': {
      role: '영양사', tool: '영양사 보조 AI', back: '/pages/dietitian.html',
      docHint: '예: 식단표', toHint: '예: 급식 대상'
    },
    'paramedic': {
      role: '응급구조사', tool: '응급구조사 보조 AI', back: '/pages/paramedic.html',
      docHint: '예: 출동·처치 기록', toHint: '예: 이송 병원'
    },
    'midwife': {
      role: '조산사', tool: '조산사 보조 AI', back: '/pages/midwife.html',
      docHint: '예: 산전·분만·산후 기록', toHint: '예: 산모'
    },
    'speech-language-pathologist': {
      role: '언어재활사', tool: '언어재활사 보조 AI', back: '/pages/speech-language-pathologist.html',
      docHint: '예: 평가·치료 기록', toHint: '예: 보호자'
    },
    'optician': {
      role: '안경사', tool: '안경사 보조 AI', back: '/pages/optician.html',
      docHint: '예: 안경 조제 기록', toHint: '예: 고객'
    },
    'sanitarian': {
      role: '위생사', tool: '위생사 보조 AI', back: '/pages/sanitarian.html',
      docHint: '예: 위생 점검 기록', toHint: '예: 관할 기관'
    },
    'financial-planner': {
      role: '재무설계사', tool: '재무설계사 보조 AI', back: '/pages/financial-planner.html', judge: '재무 진단·상품 선택·투자 판단',
      docHint: '예: 재무설계서', toHint: '예: 고객'
    },
    'health-educator': {
      role: '보건교육사', tool: '보건교육사 보조 AI', back: '/pages/health-educator.html',
      docHint: '예: 교육 기획안', toHint: '예: 대상 기관'
    }
  };
  var STEPS = [
    { k: 'W-1', t: '기록 유형 결정', s: '대화로 기록·서류의 종류와 상대방을 정하고, 직접 수행한 건인지 확인합니다.',
      l: ['기록 종류 · 교부(신고)처 확인', '직접 수행한 건인지 확인 — 아니면 중단', '법정 서식 / 관행 서류 구분'],
      acts: [['후보 서식 제안 요청', 'W-1 후보 서식을 제안해 주세요.']] },
    { k: 'W-2', t: '서식 승인', s: '결정한 서식의 항목·첨부·기한 요약을 이용자(전문가)가 승인합니다.',
      l: ['항목 · 첨부 · 기한 · 항목별 채우는 주체 한 장 요약', '항목 추가·삭제·순서 변경 반영', '승인 전에는 본문을 작성하지 않음'], g: '이용자 승인 필요',
      acts: [['이 서식으로 승인', 'W-2 요약된 서식을 승인합니다. W-3으로 진행해 주세요.', true], ['수정 요청', 'W-2 서식을 수정하고 싶습니다. 어떤 항목을 바꿀지 물어봐 주세요.']] },
    { k: 'W-3', t: '서식 DB 확인·저장', s: '서식 DB에서 찾고, 없으면 새로 구성해 빈 서식만 저장하도록 제안합니다.',
      l: ['서식 DB 조회 (기관·서식명)', '없으면 첨부 요청 → 신규 구성', '개인·사안 값을 지운 빈 서식만 저장 제안 — 동의는 이용자가 결정'],
      acts: [['서식 DB 조회 진행', 'W-3 승인된 서식을 서식 DB에서 조회해 주세요.']] },
    { k: 'W-4', t: '지시 내용 입력', s: '전문 판단 항목은 전문가가 불러 준 값만 받습니다. 비어 있으면 비워 둡니다.',
      l: ['항목 표 (채우는 주체 · 상태)', '수치·일시·단위는 지시한 값 그대로', '식별정보는 자리표시자로 둠'],
      acts: [['항목 정리 요청', 'W-4 서식의 빈 항목을 정리하고, 제가 불러 드려야 할 내용을 알려 주세요.']] },
    { k: 'W-5', t: '기록 작성', s: '승인된 서식대로 초안을 작성합니다. 서명·날인란은 비워 둡니다.',
      l: ['승인된 항목·순서 그대로', '지시하지 않은 항목은 [전문가 기재] 로 비움', '전송 전 검증 결과와 남은 항목 수'],
      acts: [['기록 작성 시작', 'W-5 서류 초안을 작성해 주세요.']] },
    { k: 'W-6', t: '검증·승인', s: '형식 점검 결과를 보고 이용자(전문가)가 다음 단계로 넘어갈지 승인합니다.',
      l: ['빠진 칸 · 단위·일시 불일치 · 항목 간 모순 표', '검토 체크리스트는 전문가가 확인', '승인은 저장·교부 준비로 넘어가는 확인'], g: '이용자 승인 필요',
      acts: [['초안 승인 — 저장·교부 준비로', 'W-6 작성된 서류를 검증했고 저장·교부 준비를 진행하겠습니다. 승인합니다.', true], ['수정 요청', 'W-6 서류를 수정하고 싶습니다. 어떤 부분을 바꿀지 물어봐 주세요.']] },
    { k: 'W-7', t: '저장·교부·신고 준비 (dpaper)', s: '대상·방식·첨부·기한·보존기간을 담은 처리 패키지를 정리합니다. dpaper는 미연동입니다.',
      l: ['교부(신고)처 · 방식 · 기한 · 보존기간', '서류 목록과 처리 전 점검', '저장·교부·신고는 전문가가 직접 — 연동 후에도 본인 인증으로만'], g: '교부·신고 대기',
      acts: [['처리 패키지 정리 요청', 'W-7 저장·교부·신고 패키지를 정리해 주세요.'], ['처리를 마쳤습니다', 'W-7 저장·교부·신고를 직접 마쳤습니다. W-8로 진행해 주세요.', true]], dpaper: true },
    { k: 'W-8', t: '청구·비용 준비 (해당 시)', s: '청구서·수수료 등 필요한 항목을 조회해 정리합니다. 청구·납부는 직접 합니다.',
      l: ['항목·금액은 조회로 확인한 것만', '청구·납부 방법과 기한 안내', '이 도구는 결제 정보를 받지 않음'], g: '청구 대기',
      acts: [['항목 조회 요청', 'W-8 필요한 청구·비용 항목과 방법을 조회해 정리해 주세요(해당 없으면 없다고 알려 주세요).'], ['마쳤습니다(또는 해당 없음)', 'W-8 청구·납부를 직접 마쳤습니다(또는 해당 없습니다). W-9로 진행해 주세요.', true]] },
    { k: 'W-9', t: '처리 결과 기록', s: '교부·신고·청구 결과를 이용자가 알려 준 대로 기록합니다.',
      l: ['이용자 보고 기준으로만 기록', '모르는 칸은 미확인', '대상자 식별정보는 기록하지 않음 · 보정·반려 시 W-5로'], record: true }
  ];

  var qs = new URLSearchParams(location.search);
  var PID = qs.get('persona') || '';
  var P = PERSONAS[PID] || null;
  var KEY = 'expertwrite_v1_' + PID;
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
      '<h3>처리 결과 입력 (이용자 보고 — 모르는 칸은 비워 두세요)</h3>' +
      '<div class="row"><label>교부·신고처<input id="rOrg" maxlength="80"></label><label>처리 일시<input id="rAt" placeholder="예: 2026-10-21 14:30"></label><label>확인(접수)번호<input id="rNo" maxlength="60"></label></div>' +
      '<div class="row" style="margin-top:8px"><label>청구·비용 항목·금액<input id="rPay" placeholder="예: 발급 수수료 ○○원 (없으면 비움)" maxlength="120"></label>' +
      '<label>결과<select id="rRes"><option>접수</option><option>처리 중</option><option>보정 요구</option><option>반려</option><option>완료</option></select></label></div>' +
      '<div class="row" style="margin-top:8px"><label style="flex-basis:100%">후속 기한·할 일<input id="rNext" maxlength="160"></label></div>' +
      '<div class="acts"><button class="btn" id="btnRec">기록하기</button><button class="btn sec" id="btnDl">기록 내려받기(.md)</button></div>' +
      '<div id="recList"></div></div>';
  }
  function renderRecords() {
    var box = $('recList'); if (!box) return;
    if (!st.records.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<table class="rec-table"><thead><tr><th>서류</th><th>교부·신고처</th><th>일시</th><th>확인번호</th><th>청구·비용</th><th>결과</th></tr></thead><tbody>' +
      st.records.map(function (r) { return '<tr><td>' + esc(r.doc) + '</td><td>' + esc(r.org) + '</td><td>' + esc(r.at) + '</td><td>' + esc(r.no) + '</td><td>' + esc(r.pay) + '</td><td>' + esc(r.res) + '</td></tr>'; }).join('') + '</tbody></table>';
  }
  function val(id) { var e = $(id); return e ? e.value.trim() : ''; }
  function addRecord() {
    var r = { doc: st.doc || val('fDoc') || '[미확인]', org: val('rOrg') || '[미확인]', at: val('rAt') || '[미확인]', no: val('rNo') || '[미확인]', pay: val('rPay') || '[미확인]', res: val('rRes'), next: val('rNext') || '[미확인]', saved: new Date().toISOString() };
    st.records.push(r); st.done[8] = true; save(); renderRecords();
    send('W-9 처리 결과를 기록해 주세요(이용자 보고 기준). 서류: ' + r.doc + ' / 교부·신고처: ' + r.org + ' / 처리 일시: ' + r.at + ' / 확인번호: ' + r.no + ' / 청구·비용: ' + r.pay + ' / 결과: ' + r.res + ' / 후속: ' + r.next + '. 모르는 칸은 [미확인]으로 두고, 보정·반려가 있으면 W-5로 돌아갈지 알려 주세요.');
  }
  function downloadRecords() {
    if (!st.records.length) { toast('기록된 내용이 없습니다.'); return; }
    var md = '# 처리 결과 기록 (이용자 보고 기준)\n\n> ' + (P ? P.tool : '보조 AI') + ' 서류 작성 트랙 W-9. 사무 기록 초안이며 진료기록부 등 법정 기록의 대체가 아닙니다. 대상자 식별정보는 적지 않습니다. 모르는 칸은 [미확인].\n\n' +
      st.records.map(function (r, i) {
        return '## ' + (i + 1) + '. ' + r.doc + '\n\n- 교부·신고처: ' + r.org + '\n- 처리 일시: ' + r.at + '\n- 확인번호: ' + r.no + '\n- 청구·비용: ' + r.pay + '\n- 결과: ' + r.res + '\n- 후속 기한·할 일: ' + r.next + '\n- 기록 시각: ' + r.saved + '\n';
      }).join('\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
    a.download = '처리결과기록_' + new Date().toISOString().slice(0, 10) + '.md';
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
      if (s.dpaper) acts += '<button class="btn sec" disabled title="dpaper API가 아직 연동되지 않았습니다. 저장·교부·신고는 기관이 정한 방법으로 직접 하세요.">dpaper로 처리 (미연동)</button>';
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
    send('서류 작성 트랙(STEP W)을 시작합니다. 이용자: ' + who + ' / 작성할 서류: ' + (doc || '(미정)') + ' / 교부·신고처: ' + (to || '(미정)') + ' / 요약: ' + (cs || '(미입력)') + '. W-1부터 진행해 주시고, 직접 수행한 건인지와 부족한 항목을 3개 이내로 먼저 물어봐 주세요.');
  }

  function init() {
    if (!P) { $('chooser').hidden = false; return; }
    $('app').hidden = false;
    document.title = '서류 작성하기 — ' + P.tool;
    $('brand').textContent = 'Hondi · ' + P.tool; $('brand').href = P.back;
    $('crumb').innerHTML = '홈 › <a href="' + P.back + '">' + esc(P.role) + '</a> › 서류 작성하기';
    $('navList').href = P.back;
    $('h1').textContent = P.role + ' 서류 작성하기 9단계';
    $('sub').textContent = '기록 유형 결정 → 서식 승인 → 서식 DB → 지시 내용 입력 → 작성 → 검증·승인 → 저장·교부·신고 준비 → 청구·비용 → 결과 기록 순서로 진행합니다.';
    $('fDoc').placeholder = P.docHint; $('fTo').placeholder = P.toHint; $('optPro').textContent = P.role;
    Array.prototype.forEach.call(document.querySelectorAll('.judge'), function (e) { e.textContent = P.judge || '진단·평가·처치·처방'; });
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
  window.ExpertWrite = { parse: parse };
})();
