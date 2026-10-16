/* biz-link-demo.js — 「사업자·세무사/회계사 연동 시연」 시뮬레이션 (2026-10-16 신설, 같은 날 회계사 모드 추가)

   세무사 보조 AI 페이지(pages/tax-accountant.html)와 회계사 보조 AI 페이지(pages/accountant.html)의 STEP L(사업자 연동)을
   화면에서 보여 주는 시연 모듈이다. 페이지가 window.BIZ_LINK_DEMO_CONFIG = { mode: 'cpa' } 를 먼저 두면 회계사 모드로 동작한다
   (기본은 세무사 모드). 회계사 모드는 SP_accountant-assistant_v1_1 STEP L의 ① 독립성 게이트(감사 수임 회사는 연동 불가)와
   ② 세무 신고는 세무대리업무 등록 회계사만(세무사법 제20조의2)을 화면에서 강제하고, 문구를 「회계사」·「회사」로 바꿔 보여 준다.
   거래 발생 → 잠정 장부·재무제표 갱신 → 세금 계산 → 인간 세무사 검토·확정 → 전자신고(시연) → 자동 납부(시연).

   ── 이 시연이 하는 일과 하지 않는 일 ─────────────────────────────────────────────
   · 모든 거래·장부·세액·신고·납부는 이 브라우저 안의 가상 데이터다. 국세청·홈택스·GDC 지갑·L1 원장·PocketBase 어디에도
     쓰기 요청을 보내지 않는다(실제 신고·납부 아님). 기존 재무제표 코드(worker.js /biz/order → /biz/settle-ledger →
     /biz/financials, src/gopang/gdc/financial-statements.js)는 지갑 서명이 필요해 이 페이지에서 호출하지 않고,
     계정 키(pl-revenue·pl-cogs·pl-opex·pl-gross-profit·pl-net-income)만 같은 이름으로 맞춰 보여 준다.
   · 밖으로 나가는 요청은 회원 확인용 공개 조회 GET /pay/code/resolve?short_id= 두 건뿐이다(나비 숫자 코드 → 회원 여부).
   · 회원 조건: ① 보는 사람이 나비 회원으로 로그인(KAuth) ② 사업자와 세무사·회계사 두 사람의 나비 숫자 코드가 모두 실제
     회원으로 조회됨 ③ 두 코드가 서로 다름. 이 시연은 보는 사람이 그 코드의 주인인지 서명으로 증명하지는 않는다
     (소유 증명은 /profile/verify-owner 서명 흐름이 필요하다). 세무사·회계사의 자격(L3) 인증 정보는 플랫폼에서 읽지
     못하므로 시연에서는 자격이 확인된 것으로 가정한다고 화면에 밝힌다.
   · 세율·기한·가산세율 등은 시연용 가정값이며 화면에 그렇게 표시한다(실제는 현행 법령 조회).
   · SP_tax-accountant-assistant_v1_1 / SP_accountant-assistant_v1_1 STEP L-0 원칙을 따른다: 잠정·미확정 표시, 세무사 승인 전 확정 불가, 신고는 세무사가
     한다(AI는 신고하지 않음), 연동되지 않은 것은 미연동으로 표시. */

(function (root) {
  'use strict';

  var PROXY = 'https://hondi-proxy.tensor-city.workers.dev';
  var CFG = (typeof root !== 'undefined' && root && root.BIZ_LINK_DEMO_CONFIG) || {};
  var MODE = CFG.mode === 'cpa' ? 'cpa' : 'tax';

  // ───────────────────────── 순수 로직 (node 테스트 대상) ─────────────────────────
  var ACCT = {
    cash: '현금및예금', vatIn: '부가세대급금', vatOut: '부가세예수금', capital: '자본금',
    revenue: '매출', cogs: '매출원가(원재료 매입)', rent: '임차료', entertain: '접대비(기업업무추진비)',
    supplies: '소모품비', salary: '급여'
  };
  var ASSET = ['cash', 'vatIn'], LIAB = ['vatOut'];
  var OPEX = ['rent', 'entertain', 'supplies', 'salary'];
  var OPENING_CASH = 20000000;
  var DEFAULT_RATE = 9; // 시연용 가정 세율(%) — 실제는 과세표준 구간별 현행 세율 조회
  var EVIDENCE_LABEL = { etax: '전자세금계산서', card: '신용·체크카드', simple: '간이영수증', none: '증빙 없음', payroll: '급여대장' };
  var CONF = { high: '🟢', mid: '🟡', low: '🔴' };

  var SAMPLES = [
    { id: 's1', label: '전자세금계산서 매출', kind: 'sale', evidence: 'etax', supply: 10000000, vat: 1000000, account: 'revenue', conf: 'high', flags: [] },
    { id: 's2', label: '카드 매출(부가세 포함 3,300,000원)', kind: 'sale', evidence: 'card', supply: 3000000, vat: 300000, account: 'revenue', conf: 'high', flags: [] },
    { id: 's3', label: '원재료 매입(전자세금계산서)', kind: 'purchase', evidence: 'etax', supply: 5000000, vat: 500000, account: 'cogs', conf: 'high', flags: [] },
    { id: 's4', label: '사무실 임차료(전자세금계산서)', kind: 'purchase', evidence: 'etax', supply: 1000000, vat: 100000, account: 'rent', conf: 'high', flags: [] },
    { id: 's5', label: '거래처 접대(법인카드 330,000원)', kind: 'purchase', evidence: 'card', supply: 330000, vat: 0, account: 'entertain', conf: 'mid',
      flags: ['접대 관련 매입세액은 공제되지 않습니다(전액 비용 처리, 한도는 현행 조회 필요)'] },
    { id: 's6', label: '소모품 구입(간이영수증 50,000원)', kind: 'purchase', evidence: 'simple', supply: 50000, vat: 0, account: 'supplies', conf: 'low',
      flags: ['건별 일정 금액을 넘는 비적격 증빙 지출은 증빙불비 가산세 위험이 있습니다(금액·율 조회 필요)'] },
    { id: 's7', label: '직원 급여 지급', kind: 'payroll', evidence: 'payroll', supply: 2500000, vat: 0, account: 'salary', conf: 'high',
      flags: ['시연에서는 원천징수·4대보험을 생략했습니다'] }
  ];

  function won(n) { return (Math.round(n) < 0 ? '-' : '') + Math.abs(Math.round(n)).toLocaleString('ko-KR') + '원'; }

  // 이벤트 → 분개 (차변 dr / 대변 cr)
  function buildEntries(ev) {
    var e = [], total = ev.supply + ev.vat;
    if (ev.kind === 'sale') {
      e.push({ a: 'cash', dr: total, cr: 0 });
      e.push({ a: 'revenue', dr: 0, cr: ev.supply });
      if (ev.vat) e.push({ a: 'vatOut', dr: 0, cr: ev.vat });
    } else {
      e.push({ a: ev.account, dr: ev.supply, cr: 0 });
      if (ev.vat) e.push({ a: 'vatIn', dr: ev.vat, cr: 0 });
      e.push({ a: 'cash', dr: 0, cr: total });
    }
    return e;
  }

  // 잠정(provisional): 승인 + 신뢰도 🔴가 아닌 승인대기 / 확정(confirmed): 승인분만. 반려는 어디에도 넣지 않는다.
  function included(ev, mode) {
    if (ev.status === 'rejected') return false;
    if (mode === 'confirmed') return ev.status === 'approved';
    if (ev.status === 'approved') return true;
    return ev.status === 'pending' && ev.conf !== 'low';
  }

  function trialBalance(events, journals, mode) {
    var tb = { cash: 0, vatIn: 0, vatOut: 0, capital: 0, revenue: 0, cogs: 0, rent: 0, entertain: 0, supplies: 0, salary: 0 };
    tb.cash += OPENING_CASH; tb.capital -= OPENING_CASH; // 자본금은 대변(음수로 보관: 잔액 = 차변 - 대변)
    events.forEach(function (ev) {
      if (!included(ev, mode)) return;
      buildEntries(ev).forEach(function (x) { tb[x.a] += x.dr - x.cr; });
    });
    (journals || []).forEach(function (j) {
      if (mode !== 'confirmed') return;
      j.entries.forEach(function (x) { tb[x.a] += x.dr - x.cr; });
    });
    return tb; // 잔액 = 차변 - 대변
  }

  function statements(tb) {
    var revenue = 0 - tb.revenue;
    var cogs = tb.cogs;
    var opex = OPEX.reduce(function (s, k) { return s + tb[k]; }, 0);
    var gross = revenue - cogs;
    var net = gross - opex;
    var assets = tb.cash + tb.vatIn;
    var liab = 0 - tb.vatOut;
    var capital = 0 - tb.capital;
    var equity = capital + net;
    return {
      pl: { 'pl-revenue': revenue, 'pl-cogs': cogs, 'pl-gross-profit': gross, 'pl-opex': opex, 'pl-net-income': net },
      bs: { cash: tb.cash, vatIn: tb.vatIn, assets: assets, vatOut: liab, liab: liab, capital: capital, net: net, equity: equity },
      balanced: assets === liab + equity
    };
  }

  function taxCalc(tb, events, mode, ratePct) {
    var st = statements(tb);
    var vatOut = 0 - tb.vatOut, vatIn = tb.vatIn;
    var vatPayable = vatOut - vatIn;
    // 증빙불비 가산세 추정: 포함된 비적격(간이영수증·증빙 없음) 지출의 2%(시연 가정)
    var penaltyBase = 0;
    events.forEach(function (ev) {
      if (included(ev, mode) && ev.kind === 'purchase' && (ev.evidence === 'simple' || ev.evidence === 'none')) penaltyBase += ev.supply + ev.vat;
    });
    var penalty = Math.floor(penaltyBase * 0.02);
    var taxable = st.pl['pl-net-income']; // 시연: 세무조정 없음(익금·손금 조정 항목은 세무사가 확정)
    var rate = Math.max(0, Math.min(40, Number(ratePct))) / 100;
    var corp = Math.floor(Math.max(0, taxable) * rate);
    return { vatOut: vatOut, vatIn: vatIn, vatPayable: vatPayable, penaltyBase: penaltyBase, penalty: penalty,
             taxable: taxable, rate: rate, corp: corp, net: st.pl['pl-net-income'] };
  }

  // 자동 납부 사전 조건 점검 — 막는 이유 목록(비어 있으면 실행 가능)
  function payBlockers(s, tax) {
    var r = [];
    if (!s.gate.ok) r.push('두 사람이 모두 나비 회원으로 확인되어야 합니다');
    if (!s.confirmed) r.push('세무사·회계사의 확정이 필요합니다');
    if (s.requireReg && !s.reg) r.push('세무대리업무에 등록한 회계사만 신고할 수 있습니다(세무사법 제20조의2)');
    if (!s.filed) r.push('세무사·회계사의 전자신고(시연)가 필요합니다');
    if (!s.consent) r.push('사업자 나비의 자동납부 동의가 필요합니다');
    if (s.confirmed && tax.vatPayable <= 0) r.push('납부할 부가가치세가 없습니다(환급·0원) — 납부 단계 없음');
    if (s.consent && tax.vatPayable > s.consentLimit) r.push('납부액이 자동납부 동의 한도를 넘습니다(확정 후 세액이 바뀌었다면 동의를 다시 해 주세요)');
    return r;
  }

  var core = { ACCT: ACCT, SAMPLES: SAMPLES, buildEntries: buildEntries, included: included, trialBalance: trialBalance,
               statements: statements, taxCalc: taxCalc, payBlockers: payBlockers, won: won, OPENING_CASH: OPENING_CASH, DEFAULT_RATE: DEFAULT_RATE };

  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  if (typeof document === 'undefined') return;

  // ───────────────────────── 화면 ─────────────────────────
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function $(id) { return document.getElementById(id); }

  // 회계사 모드 문구 치환 — 고정 문구에만 적용한다. 회원 이름은 토큰으로 두었다가 마지막에 넣어 바뀌지 않게 한다.
  var TK_B = '\uE000B\uE001', TK_P = '\uE000P\uE001';
  function T(str) {
    if (MODE !== 'cpa') return str;
    return str.replace(/세무사·회계사/g, '회계사').replace(/세무사(?!법)/g, '회계사').replace(/사업자/g, '회사');
  }
  function fin(html) {
    var g = S.gate;
    return T(html).split(TK_B).join(g.biz ? esc(g.biz.name) : '').split(TK_P).join(g.pro ? esc(g.pro.name) : '');
  }

  var S;
  function fresh() {
    return {
      view: 'biz', // biz | pro
      gate: { ok: false, login: false, biz: null, pro: null, bizCode: '', proCode: '', msg: '', busy: false, audit: '' },
      events: [], journals: [], seq: 0,
      confirmed: false, filed: false, filedNo: '', consent: false, consentLimit: 0, paidAmount: 0, reg: false, requireReg: MODE === 'cpa',
      due: false, paid: false, payStatus: '', lowBalance: false, rate: DEFAULT_RATE, log: []
    };
  }
  function log(who, msg) { S.log.push({ t: new Date().toLocaleTimeString('ko-KR'), who: T(who), msg: T(msg) }); }

  function recomputeGate() {
    var g = S.gate;
    g.login = !!(root.KAuth && root.KAuth.hasValidLogin && root.KAuth.hasValidLogin());
    g.ok = !!(g.login && g.biz && g.pro && g.biz.guid !== g.pro.guid && (MODE !== 'cpa' || g.audit === 'no'));
  }

  function resolveCode(role) {
    var g = S.gate, code = (role === 'biz' ? g.bizCode : g.proCode).trim();
    if (!/^[0-9]{10}$/.test(code)) { g.msg = '나비 숫자 코드는 숫자 10자리입니다.'; render(); return Promise.resolve(); }
    g.busy = true; g.msg = ''; render();
    return fetch(PROXY + '/pay/code/resolve?short_id=' + encodeURIComponent(code))
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (x) {
        if (x.status === 200 && x.j && x.j.ok) {
          g[role] = { guid: x.j.seller_guid, name: x.j.business_name || '(이름 미등록)', code: code };
          if (g.biz && g.pro && g.biz.guid === g.pro.guid) { g[role] = null; g.msg = '사업자와 세무사·회계사는 서로 다른 회원이어야 합니다.'; }
        } else if (x.status === 404) {
          g[role] = null; g.msg = '등록되지 않은 코드입니다. 나비 회원만 시연에 참여할 수 있습니다(나비에서 숫자 코드를 먼저 발급받으세요).';
        } else {
          g[role] = null; g.msg = '회원 확인에 실패했습니다(' + ((x.j && x.j.error && x.j.error.code) || x.status) + '). 잠시 후 다시 시도해 주세요.';
        }
      })
      .catch(function () { g[role] = null; g.msg = '회원 확인을 하지 못했습니다(네트워크). 잠시 후 다시 시도해 주세요.'; })
      .then(function () { g.busy = false; recomputeGate(); render(); });
  }

  function login() {
    if (!(root.KAuth && root.KAuth.ensureLogin)) { S.gate.msg = '로그인 모듈을 불러오지 못했습니다. 페이지를 새로 고쳐 주세요.'; render(); return; }
    root.KAuth.ensureLogin().then(function () { recomputeGate(); render(); }, function () { recomputeGate(); render(); });
  }

  function addEvent(id) {
    var t = SAMPLES.filter(function (x) { return x.id === id; })[0];
    if (!t || S.confirmed) return;
    var ev = JSON.parse(JSON.stringify(t));
    ev.uid = 'e' + (++S.seq); ev.status = 'pending'; ev.asked = false; ev.deductible = ev.vat > 0;
    S.events.push(ev);
    log('사업자 나비', '거래 이벤트 전달: ' + ev.label);
    log('이 도구(AI)', '분류 제안: ' + ACCT[ev.account] + ' / 신뢰도 ' + CONF[ev.conf] + (ev.conf === 'low' ? ' — 사업자 확인 전에는 잠정 장부에 반영하지 않음' : ' — 잠정 장부에 반영(미확정)'));
  }

  function answerEvidence(uid, ok) {
    var ev = find(uid); if (!ev || S.confirmed) return;
    ev.asked = true;
    if (ok) { ev.evidence = 'card'; ev.conf = 'mid'; ev.flags = ['사업자가 적격증빙(카드 매출전표) 수취를 확인했다고 답했습니다 — 세무사 확인 필요']; log('사업자 나비', '증빙 보완 답변: 적격증빙 수취 — ' + ev.label); }
    else { log('사업자 나비', '증빙 보완 불가 답변 — ' + ev.label); }
  }
  function find(uid) { return S.events.filter(function (x) { return x.uid === uid; })[0]; }

  function decide(uid, st) {
    var ev = find(uid); if (!ev || S.confirmed) return;
    ev.status = st;
    log('세무사·회계사', (st === 'approved' ? '승인' : '반려') + ': ' + ev.label);
  }
  function changeAccount(uid, a) {
    var ev = find(uid); if (!ev || S.confirmed || ev.kind !== 'purchase' || !ACCT[a]) return;
    ev.account = a; log('세무사·회계사', '계정과목 수정: ' + ev.label + ' → ' + ACCT[a]);
  }

  function pending() { return S.events.filter(function (e) { return e.status === 'pending'; }).length; }

  function confirmAll() {
    if (pending() > 0 || !S.events.some(function (e) { return e.status === 'approved'; })) return;
    S.confirmed = true; log('세무사·회계사', '장부·재무제표 확정(승인분만 반영)');
  }
  function file() {
    if (!S.confirmed || S.filed || (S.requireReg && !S.reg)) return;
    S.filed = true; S.filedNo = 'DEMO-' + String(1000 + S.seq * 7).slice(-4) + '-' + String(S.log.length).padStart(4, '0');
    log('세무사·회계사', '전자신고(시연) 완료 — 가상 접수번호 ' + S.filedNo + ' (실제 접수 아님)');
  }

  function currentTax() { return taxCalc(trialBalance(S.events, S.journals, S.confirmed ? 'confirmed' : 'provisional'), S.events, S.confirmed ? 'confirmed' : 'provisional', S.rate); }

  function tryAutoPay() {
    if (!S.due || S.paid) return;
    var tax = currentTax(), b = payBlockers(S, tax);
    if (b.length) { S.payStatus = 'blocked'; return; }
    var tb = trialBalance(S.events, S.journals, 'confirmed');
    var amount = tax.vatPayable;
    var avail = S.lowBalance ? Math.floor(amount / 2) : tb.cash;
    if (avail < amount) {
      S.payStatus = 'failed';
      log('자동납부(시연)', '납부 실패 — 가용 잔액 ' + won(avail) + ' < 납부액 ' + won(amount) + '. 사업자 나비에 알림(시연). 자동 재시도 없음');
      return;
    }
    S.journals.push({ label: '부가가치세 납부(시연)', entries: [
      { a: 'vatOut', dr: tax.vatOut, cr: 0 }, { a: 'vatIn', dr: 0, cr: tax.vatIn }, { a: 'cash', dr: 0, cr: amount } ] });
    S.paid = true; S.paidAmount = amount; S.payStatus = 'done';
    log('자동납부(시연)', '기한일 도래 — 세무사 확정·전자신고·사업자 동의 확인 후 가상 납부 ' + won(amount) + ' 실행. 확정 재무제표 자동 갱신(부가세 계정 정리·현금 감소)');
  }

  // ───────── 렌더 ─────────
  function chip(t, cls) { return '<span class="bld-chip ' + (cls || '') + '">' + esc(t) + '</span>'; }

  function renderGate() {
    var g = S.gate;
    function row(role, label) {
      var m = g[role], key = role === 'biz' ? 'bizCode' : 'proCode';
      return '<div class="bld-row"><label class="bld-lab">' + label + '</label>' +
        '<input class="bld-in" inputmode="numeric" maxlength="10" placeholder="나비 숫자 코드 10자리" value="' + esc(g[key]) + '" data-code="' + role + '"' + (g.busy ? ' disabled' : '') + '>' +
        '<button type="button" class="svc-link-btn" data-act="resolve" data-role="' + role + '"' + (g.busy ? ' disabled' : '') + '>회원 확인</button>' +
        (m ? chip('✓ 나비 회원 · ' + (role === 'biz' ? TK_B : TK_P), 'ok') : chip('미확인', 'no')) + '</div>';
    }
    return '<div class="bld-step"><div class="bld-h"><b>0. 참여 회원 확인</b>' + (g.ok ? chip('통과', 'ok') : chip('잠김', 'no')) + '</div>' +
      '<p class="bld-p">사업자와 세무사·회계사가 <b>모두 나비 회원</b>이어야 시연할 수 있습니다. 보는 분의 로그인과 두 사람의 나비 숫자 코드를 확인합니다.</p>' +
      '<div class="bld-row"><label class="bld-lab">보는 분 로그인</label>' +
      (g.login ? chip('✓ 나비 회원 로그인됨', 'ok') : '<button type="button" class="svc-link-btn solid" data-act="login">나비 로그인</button>' + chip('로그인 필요', 'no')) + '</div>' +
      row('biz', '사업자 코드') + row('pro', '세무사·회계사 코드') +
      (g.msg ? '<p class="bld-warn">' + esc(g.msg) + '</p>' : '') +
      renderAudit() +
      '<p class="bld-note">확인하는 정보는 숫자 코드로 조회한 회원 여부와 이름뿐이며, 코드 외의 어떤 데이터도 서버로 보내지 않습니다. 이 시연은 보는 분이 그 코드의 주인인지 서명으로 증명하지는 않습니다. 세무사·회계사의 자격(L3) 인증 정보는 이 화면에서 읽지 못해, 시연에서는 자격이 확인된 것으로 가정합니다.</p></div>';
  }

  // 회계사 모드 전용 — SP STEP L-0 2 독립성 게이트: 감사(증명 업무) 수임 회사는 기장·재무제표 작성 연동을 시작하지 않는다.
  function renderAudit() {
    var g = S.gate;
    if (MODE !== 'cpa' || !(g.login && g.biz && g.pro)) return '';
    return '<div class="bld-row" style="align-items:flex-start"><label class="bld-lab">독립성 확인</label><div>' +
      '<div class="bld-p" style="margin:0 0 6px">이 사업자에 대해 외부감사 등 증명 업무를 수행 중이거나 수행할 예정입니까? 같은 회사의 감사와 회계기록·재무제표 작성을 함께 하면 감사인의 독립성을 해칠 수 있어(공인회계사법·외부감사법 독립성 규정, 조문 확인 필요) 연동 시작 전에 확인합니다.</div>' +
      '<label class="bld-chk"><input type="radio" name="bld-audit" data-audit="1" value="no"' + (g.audit === 'no' ? ' checked' : '') + '> 아니오(해당 없음)</label> ' +
      '<label class="bld-chk"><input type="radio" name="bld-audit" data-audit="1" value="yes"' + (g.audit === 'yes' ? ' checked' : '') + '> 예(감사 수임 회사)</label>' +
      (g.audit === 'yes' ? '<p class="bld-warn">감사 수임 회사는 기장·재무제표 작성 연동 대상이 아닙니다. 연동을 시작하지 않고 회계사에게 보고합니다. 연동 데이터를 감사증거나 감사의견의 근거로 제시하는 것도 하지 않습니다.</p>' : '') +
      (g.audit === '' ? '<p class="bld-note">선택해야 시연을 시작할 수 있습니다.</p>' : '') +
      '</div></div>';
  }

  function renderEvents() {
    var mode = S.confirmed ? 'confirmed' : 'provisional';
    var rows = S.events.map(function (ev) {
      var st = ev.status === 'approved' ? chip('승인', 'ok') : ev.status === 'rejected' ? chip('반려', 'no') : chip('승인 대기', 'wait');
      var inc = included(ev, mode) ? '반영' : '미반영';
      return '<tr><td>' + esc(ev.label) + '<div class="bld-sub">' + esc(EVIDENCE_LABEL[ev.evidence]) + '</div></td><td class="r">' + won(ev.supply + ev.vat) + '</td>' +
        '<td>' + esc(ACCT[ev.account]) + '<div class="bld-sub">부가세 ' + (ev.vat ? '공제 ' + won(ev.vat) : '공제 없음') + '</div></td>' +
        '<td>' + CONF[ev.conf] + '</td><td>' + st + '<div class="bld-sub">' + (S.confirmed ? '확정 ' : '잠정 ') + inc + '</div></td></tr>';
    }).join('');
    return '<table class="svc-table bld-t"><thead><tr><th>거래</th><th>금액</th><th>AI 제안 계정</th><th>확신도</th><th>상태</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function renderStatements(tb, label) {
    var st = statements(tb);
    return '<div class="bld-cols"><div><div class="bld-sub2">손익계산서 ' + label + '</div><table class="svc-table bld-t"><tbody>' +
      '<tr><td>매출 <span class="bld-key">pl-revenue</span></td><td class="r">' + won(st.pl['pl-revenue']) + '</td></tr>' +
      '<tr><td>매출원가 <span class="bld-key">pl-cogs</span></td><td class="r">' + won(st.pl['pl-cogs']) + '</td></tr>' +
      '<tr><td>매출총이익 <span class="bld-key">pl-gross-profit</span></td><td class="r">' + won(st.pl['pl-gross-profit']) + '</td></tr>' +
      '<tr><td>판매관리비 <span class="bld-key">pl-opex</span></td><td class="r">' + won(st.pl['pl-opex']) + '</td></tr>' +
      '<tr><td><b>법인세 차감 전 순이익 <span class="bld-key">pl-net-income</span></b></td><td class="r"><b>' + won(st.pl['pl-net-income']) + '</b></td></tr></tbody></table></div>' +
      '<div><div class="bld-sub2">재무상태표 ' + label + '</div><table class="svc-table bld-t"><tbody>' +
      '<tr><td>현금및예금</td><td class="r">' + won(st.bs.cash) + '</td></tr>' +
      '<tr><td>부가세대급금</td><td class="r">' + won(st.bs.vatIn) + '</td></tr>' +
      '<tr><td><b>자산 합계</b></td><td class="r"><b>' + won(st.bs.assets) + '</b></td></tr>' +
      '<tr><td>부가세예수금</td><td class="r">' + won(st.bs.vatOut) + '</td></tr>' +
      '<tr><td>자본금 + 당기순이익</td><td class="r">' + won(st.bs.equity) + '</td></tr>' +
      '<tr><td><b>부채·자본 합계</b></td><td class="r"><b>' + won(st.bs.liab + st.bs.equity) + '</b></td></tr></tbody></table>' +
      '<div class="bld-sub">' + (st.balanced ? '✓ 차변·대변 일치' : '⚠ 차변·대변 불일치') + '</div></div></div>';
  }

  function renderTax() {
    var t = currentTax();
    var label = S.confirmed ? '(확정 기준)' : '(잠정 추정 — 세무사 확정 전)';
    var cand = [
      ['중소기업 특별세액감면(조세특례제한법 제7조)', '업종·규모·소득 요건 확인 필요', '업종, 중소기업 해당 여부, 소득금액'],
      ['통합고용세액공제(제29조의8)', '상시근로자 증가 여부 확인 필요', '전·당기 상시근로자 수, 고용 유지'],
      ['창업중소기업 세액감면(제6조)', '창업 시점·지역 요건 확인 필요 — 중소기업 특별세액감면과 같은 소득에 중복 적용 불가', '창업일, 업종, 사업장 지역']
    ].map(function (c) { return '<tr><td>' + esc(c[0]) + '</td><td>' + chip('확인 필요', 'wait') + '</td><td>' + esc(c[1]) + '<div class="bld-sub">필요 정보: ' + esc(c[2]) + '</div></td></tr>'; }).join('');
    return '<div class="bld-step"><div class="bld-h"><b>2. 세금 계산(시연)</b>' + chip(S.confirmed ? '확정 기준' : '잠정', S.confirmed ? 'ok' : 'wait') + '</div>' +
      '<table class="svc-table bld-t"><tbody>' +
      '<tr><td>매출세액(부가세예수금) ' + label + '</td><td class="r">' + won(t.vatOut) + '</td></tr>' +
      '<tr><td>공제 매입세액(부가세대급금)</td><td class="r">' + won(t.vatIn) + '</td></tr>' +
      '<tr><td><b>부가가치세 납부(환급) 세액</b></td><td class="r"><b>' + won(t.vatPayable) + '</b></td></tr>' +
      '<tr><td>법인세 추정 — 과세표준(시연: 세무조정 없음) ' + won(t.taxable) + ' × 가정 세율 <input class="bld-in bld-rate" type="number" min="0" max="40" step="1" value="' + esc(S.rate) + '" data-rate="1">%</td><td class="r">' + won(t.corp) + '</td></tr>' +
      (S.paid ? '<tr><td>납부 완료(가상) — 부가가치세</td><td class="r">' + won(S.paidAmount) + '</td></tr>' : '') +
      (t.penalty ? '<tr><td>증빙불비 가산세 추정(비적격 증빙 지출 ' + won(t.penaltyBase) + ' × 가정 2%)</td><td class="r">' + won(t.penalty) + '</td></tr>' : '') +
      '</tbody></table>' +
      '<p class="bld-note">세율·가산세율은 시연용 가정값입니다. 실제 신고에서는 현행 세법을 조회해 적용하며, 법인세는 사업연도 결산 후 별도로 신고합니다(여기서는 추정만 표시).</p>' +
      '<div class="bld-sub2">세법상 공제·감면 검토 후보 <span class="bld-sub">(채택 여부는 세무사가 판단합니다)</span></div>' +
      '<table class="svc-table bld-t"><thead><tr><th>제도</th><th>요건</th><th>설명</th></tr></thead><tbody>' + cand + '</tbody></table></div>';
  }

  function renderReview() {
    var pro = S.view === 'pro';
    var rows = S.events.map(function (ev) {
      var done = ev.status !== 'pending';
      var acct = ev.kind === 'purchase' ? '<select class="bld-in" data-acct="' + ev.uid + '"' + (S.confirmed ? ' disabled' : '') + '>' +
        ['cogs', 'rent', 'entertain', 'supplies'].map(function (k) { return '<option value="' + k + '"' + (ev.account === k ? ' selected' : '') + '>' + esc(ACCT[k]) + '</option>'; }).join('') + '</select>' : esc(ACCT[ev.account]);
      var flags = ev.flags.map(function (f) { return '<div class="bld-flag">⚠ ' + esc(f) + '</div>'; }).join('');
      var ask = (ev.conf === 'low' && !ev.asked && !S.confirmed && S.view === 'biz') ?
        '<div class="bld-ask">증빙을 보완하시겠어요? <button type="button" class="svc-link-btn" data-act="ev-ok" data-uid="' + ev.uid + '">적격증빙 수취함</button> <button type="button" class="svc-link-btn" data-act="ev-no" data-uid="' + ev.uid + '">보완 불가</button></div>' : '';
      var btn = pro ? ('<button type="button" class="svc-link-btn solid" data-act="approve" data-uid="' + ev.uid + '"' + (done || S.confirmed ? ' disabled' : '') + '>승인</button> ' +
        '<button type="button" class="svc-link-btn" data-act="reject" data-uid="' + ev.uid + '"' + (done || S.confirmed ? ' disabled' : '') + '>반려</button>') : '<span class="bld-sub">세무사·회계사 화면에서 처리</span>';
      return '<tr><td>' + esc(ev.label) + flags + ask + '</td><td>' + acct + '</td><td>' + CONF[ev.conf] + '</td><td>' +
        (ev.status === 'approved' ? chip('승인', 'ok') : ev.status === 'rejected' ? chip('반려', 'no') : chip('대기', 'wait')) + '</td><td>' + btn + '</td></tr>';
    }).join('');
    var canConfirm = pro && !S.confirmed && pending() === 0 && S.events.some(function (e) { return e.status === 'approved'; });
    return '<div class="bld-step"><div class="bld-h"><b>3. 인간 세무사·회계사 검토</b>' + (S.confirmed ? chip('확정됨', 'ok') : chip('검토 중', 'wait')) + '</div>' +
      '<p class="bld-p">AI는 분개를 <b>제안</b>만 합니다. 세무사·회계사가 건별로 승인·반려해야 확정 장부에 들어가고, 승인 대기 건이 남아 있으면 확정할 수 없습니다. 신뢰도 🔴 거래는 사업자 확인 전에는 잠정 장부에도 넣지 않습니다.</p>' +
      (S.events.length ? '<table class="svc-table bld-t"><thead><tr><th>거래·위험 표시</th><th>계정과목</th><th>확신도</th><th>상태</th><th>세무사·회계사</th></tr></thead><tbody>' + rows + '</tbody></table>' : '<p class="bld-note">1단계에서 거래를 먼저 발생시켜 주세요.</p>') +
      '<div class="bld-actions"><button type="button" class="svc-link-btn solid" data-act="confirm"' + (canConfirm ? '' : ' disabled') + '>장부·재무제표 확정</button>' +
      (pro ? '' : '<span class="bld-sub"> 확정은 세무사·회계사 화면에서만 할 수 있습니다.</span>') + '</div></div>';
  }

  function renderPay() {
    var t = currentTax(), b = payBlockers(S, t), pro = S.view === 'pro';
    var steps = [
      ['사업자 나비 자동납부 동의', S.consent ? 'done' : 'todo'],
      ['세무사·회계사 확정', S.confirmed ? 'done' : 'todo'],
      ['세무사·회계사 전자신고(시연)', S.filed ? 'done' : 'todo'],
      ['납부 기한일 도래(시연 날짜)', S.due ? 'done' : 'todo'],
      ['자동 납부 실행(가상)', S.paid ? 'done' : (S.payStatus === 'failed' ? 'fail' : 'todo')]
    ].map(function (s, i) { return '<li class="bld-li ' + s[1] + '"><span class="bld-n">' + (i + 1) + '</span>' + esc(s[0]) + ' ' + (s[1] === 'done' ? chip('완료', 'ok') : s[1] === 'fail' ? chip('실패', 'no') : chip('대기', 'wait')) + '</li>'; }).join('');
    var regBox = MODE === 'cpa' ? '<div><label class="bld-chk"><input type="checkbox" data-reg="1"' + (S.reg ? ' checked' : '') + (S.view !== 'pro' || S.filed ? ' disabled' : '') + '> 세무대리업무에 등록한 회계사입니다(시연 가정 — 회계사 화면에서만 변경)</label></div>' : '';
    var consentBox = '<label class="bld-chk"><input type="checkbox" data-consent="1"' + (S.consent ? ' checked' : '') + (S.view !== 'biz' || S.paid ? ' disabled' : '') + '> 자동납부 동의(사업자 나비 화면에서만 변경) — 한도: 확정된 납부세액 이하, 기한일 1회</label>';
    return '<div class="bld-step"><div class="bld-h"><b>4. 자동 납부 시연(시뮬레이션)</b>' + (S.paid ? chip('가상 납부 완료', 'ok') : chip('진행 전', 'wait')) + '</div>' +
      '<p class="bld-p">납부 자동화는 <b>사업자 본인의 사전 동의</b>가 있을 때만 작동하며, 신고는 AI가 아니라 <b>세무사·회계사가 확정·전자신고</b>한 뒤에만 이어집니다. 아래는 모두 가상입니다.</p>' +
      '<ol class="bld-ol">' + steps + '</ol>' + consentBox + regBox +
      '<div class="bld-actions">' +
      '<button type="button" class="svc-link-btn" data-act="file"' + (pro && S.confirmed && !S.filed && (!S.requireReg || S.reg) ? '' : ' disabled') + '>전자신고(시연) — 세무사·회계사 화면</button> ' +
      '<button type="button" class="svc-link-btn solid" data-act="due"' + (S.due ? ' disabled' : '') + '>시연 날짜를 납부 기한일(7월 25일)로 이동</button> ' +
      '<label class="bld-chk"><input type="checkbox" data-low="1"' + (S.lowBalance ? ' checked' : '') + (S.paid ? ' disabled' : '') + '> 잔액 부족 상황으로 시연</label>' +
      (S.payStatus === 'failed' && !S.paid ? ' <button type="button" class="svc-link-btn" data-act="retry">잔액 부족 해소 후 재시도(사업자 승인)</button>' : '') + '</div>' +
      (MODE === 'cpa' ? '<p class="bld-note">세무 신고·납부는 세무대리업무에 등록한 회계사만 할 수 있습니다(세무사법 제20조의2). 감사 수임 회사는 독립성 게이트에서 연동 대상에서 제외됩니다.</p>' : '') +
      (S.filedNo ? '<p class="bld-note">가상 접수번호 ' + esc(S.filedNo) + ' — 실제 접수가 아닙니다.</p>' : '') +
      (S.due && !S.paid && b.length ? '<p class="bld-warn">자동 납부가 실행되지 않은 이유: ' + b.map(esc).join(' / ') + '</p>' : '') +
      '<p class="bld-note">실제 서비스에는 이 시연에 없는 구성요소가 필요합니다 — 홈택스 전자신고 연계(저장소의 기존 세무 실행 코드도 국세청 공식 제출 API가 없어 연계 인프라 미확보 상태로 응답합니다), 국세 납부 수단 연결(저장소에서 국세 납부 연동 코드는 찾지 못했습니다), 세무사 자격 인증 연동, 승인 대기열의 서버 저장.</p></div>';
  }

  function render() {
    var el = $('bizLinkDemo'); if (!el) return;
    recomputeGate();
    var g = S.gate, h = '';
    h += '<div class="svc-detail"><h2>연동 시연 — 거래부터 자동 납부까지(시뮬레이션)</h2>' +
      '<p class="svc-lead">사업자의 나비와 세무사·회계사의 나비를 연동했을 때의 흐름을 가상 데이터로 보여 줍니다. <b>실제 신고·납부가 아니며</b> 국세청·홈택스·GDC 지갑·원장에 어떤 요청도 보내지 않습니다.</p>' +
      '<div class="svc-callout important">시연 데이터는 이 브라우저에만 있고 새로 고치면 사라집니다. 모든 수치는 세무사·회계사가 확정하기 전까지 「잠정·미확정」이며, 세율·가산세율·기한은 시연용 가정값입니다.</div>';
    h += renderGate();
    if (!g.ok) { el.innerHTML = fin(h + '</div>'); return; }

    h += '<div class="bld-bar"><span class="bld-sub2">현재 화면</span>' +
      '<button type="button" class="svc-link-btn' + (S.view === 'biz' ? ' solid' : '') + '" data-act="view" data-v="biz">사업자 나비 — ' + TK_B + '</button>' +
      '<button type="button" class="svc-link-btn' + (S.view === 'pro' ? ' solid' : '') + '" data-act="view" data-v="pro">세무사·회계사 나비 — ' + TK_P + '</button>' +
      '<button type="button" class="svc-link-btn" data-act="reset">처음부터 다시</button></div>';

    var sam = SAMPLES.map(function (x) {
      return '<button type="button" class="svc-link-btn" data-act="add" data-id="' + x.id + '"' + (S.view !== 'biz' || S.confirmed ? ' disabled' : '') + '>' + esc(x.label) + '</button>';
    }).join(' ');
    h += '<div class="bld-step"><div class="bld-h"><b>1. 거래 발생 → 잠정 장부·재무제표 자동 갱신</b>' + chip('연동 소스: 시연용 가상 거래 · 미연동: 홈택스·카드·계좌', 'wait') + '</div>' +
      '<p class="bld-p">사업자 나비 화면에서 거래를 발생시키면 AI가 증빙·계정과목·부가세 공제를 제안하고, 잠정 장부와 재무제표가 즉시 갱신됩니다.</p>' +
      '<div class="bld-actions">' + sam + '</div>' + (S.events.length ? renderEvents() : '<p class="bld-note">위 버튼으로 거래를 추가해 보세요(사업자 나비 화면).</p>') +
      renderStatements(trialBalance(S.events, S.journals, S.confirmed ? 'confirmed' : 'provisional'), S.confirmed ? '(확정)' : '(잠정·미확정)') + '</div>';
    h += renderTax() + renderReview() + renderPay();

    h += '<div class="bld-step"><div class="bld-h"><b>기록(감사 로그)</b></div><ul class="bld-log">' +
      (S.log.length ? S.log.slice().reverse().map(function (l) { return '<li><span class="bld-sub">' + esc(l.t) + '</span> <b>' + esc(l.who) + '</b> ' + esc(l.msg) + '</li>'; }).join('') : '<li class="bld-sub">아직 기록이 없습니다.</li>') + '</ul></div></div>';
    el.innerHTML = fin(h);
  }

  // ───────── 이벤트 ─────────
  function onClick(e) {
    var b = e.target.closest && e.target.closest('[data-act]'); if (!b || b.disabled) return;
    var a = b.getAttribute('data-act');
    if (a === 'login') return login();
    if (a === 'resolve') return resolveCode(b.getAttribute('data-role'));
    if (!S.gate.ok) return;
    if (a === 'view') S.view = b.getAttribute('data-v');
    else if (a === 'reset') { var g = S.gate; S = fresh(); S.gate = g; }
    else if (a === 'add' && S.view === 'biz') addEvent(b.getAttribute('data-id'));
    else if (a === 'ev-ok' && S.view === 'biz') answerEvidence(b.getAttribute('data-uid'), true);
    else if (a === 'ev-no' && S.view === 'biz') answerEvidence(b.getAttribute('data-uid'), false);
    else if (a === 'approve' && S.view === 'pro') decide(b.getAttribute('data-uid'), 'approved');
    else if (a === 'reject' && S.view === 'pro') decide(b.getAttribute('data-uid'), 'rejected');
    else if (a === 'confirm' && S.view === 'pro') confirmAll();
    else if (a === 'file' && S.view === 'pro') file();
    else if (a === 'due') { S.due = true; log('시연', '날짜 이동: 납부 기한일 도래'); }
    else if (a === 'retry' && S.view === 'biz') { S.lowBalance = false; S.payStatus = ''; log('사업자 나비', '잔액 부족 해소 후 재시도 승인'); }
    tryAutoPay(); render();
  }
  function onChange(e) {
    var t = e.target;
    if (t.matches && t.matches('[data-consent]')) {
      if (S.view !== 'biz') return;
      S.consent = t.checked; S.consentLimit = S.consent ? Math.max(currentTax().vatPayable, 0) : 0;
      log('사업자 나비', S.consent ? '자동납부 동의(한도 ' + won(S.consentLimit) + ', 기한일 1회)' : '자동납부 동의 철회');
    } else if (t.matches && t.matches('[data-audit]')) { S.gate.audit = t.value === 'yes' ? 'yes' : 'no'; recomputeGate(); }
    else if (t.matches && t.matches('[data-reg]')) { if (S.view !== 'pro' || S.filed) return; S.reg = t.checked; log('세무사·회계사', t.checked ? '세무대리업무 등록 확인(시연 가정)' : '세무대리업무 등록 확인 해제'); }
    else if (t.matches && t.matches('[data-low]')) { S.lowBalance = t.checked; }
    else if (t.matches && t.matches('[data-acct]')) { if (S.view === 'pro') changeAccount(t.getAttribute('data-acct'), t.value); }
    else if (t.matches && t.matches('[data-rate]')) { var v = Number(t.value); S.rate = isFinite(v) ? Math.max(0, Math.min(40, v)) : DEFAULT_RATE; }
    else return;
    tryAutoPay(); render();
  }
  function onInput(e) {
    var t = e.target;
    if (t.matches && t.matches('[data-code]')) { S.gate[t.getAttribute('data-code') === 'biz' ? 'bizCode' : 'proCode'] = t.value.replace(/[^0-9]/g, ''); }
  }

  var CSS = '#bizLinkDemo .bld-step{border:1px solid var(--border,#e2e8f0);border-radius:10px;padding:16px 18px;margin:14px 0;background:#fff}' +
    '#bizLinkDemo .bld-h{display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:15px;margin-bottom:6px}' +
    '#bizLinkDemo .bld-p{font-size:14px;color:#334155;margin:6px 0 10px}' +
    '#bizLinkDemo .bld-note{font-size:13px;color:#475569;margin:8px 0}' +
    '#bizLinkDemo .bld-warn{font-size:13.5px;color:#9a3412;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:8px 12px;margin:8px 0}' +
    '#bizLinkDemo .bld-sub{font-size:13px;color:#64748b}#bizLinkDemo .bld-sub2{font-size:14px;font-weight:600;margin:10px 0 4px}' +
    '#bizLinkDemo .bld-key{font-size:13px;color:#64748b;font-family:ui-monospace,Menlo,monospace}' +
    '#bizLinkDemo .bld-chip{display:inline-block;font-size:13px;padding:1px 9px;border-radius:999px;background:#f1f5f9;color:#475569}' +
    '#bizLinkDemo .bld-chip.ok{background:#dcfce7;color:#166534}#bizLinkDemo .bld-chip.no{background:#fee2e2;color:#991b1b}#bizLinkDemo .bld-chip.wait{background:#fef9c3;color:#854d0e}' +
    '#bizLinkDemo .bld-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}' +
    '#bizLinkDemo .bld-lab{min-width:130px;font-size:14px;font-weight:600}' +
    '#bizLinkDemo .bld-in{font:inherit;font-size:14px;padding:5px 9px;border:1px solid #cbd5e1;border-radius:6px;background:#fff}#bizLinkDemo .bld-rate{width:64px}' +
    '#bizLinkDemo .bld-bar,#bizLinkDemo .bld-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0}' +
    '#bizLinkDemo .bld-t td.r{text-align:right;white-space:nowrap}' +
    '#bizLinkDemo .bld-cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:760px){#bizLinkDemo .bld-cols{grid-template-columns:1fr}}' +
    '#bizLinkDemo .bld-flag{font-size:13px;color:#9a3412;margin-top:3px}#bizLinkDemo .bld-ask{font-size:13.5px;margin-top:6px}' +
    '#bizLinkDemo .bld-ol{list-style:none;padding:0;margin:8px 0}#bizLinkDemo .bld-li{font-size:14px;padding:4px 0}' +
    '#bizLinkDemo .bld-n{display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:50%;background:#e2e8f0;font-size:13px;margin-right:8px}' +
    '#bizLinkDemo .bld-li.done .bld-n{background:#16a34a;color:#fff}#bizLinkDemo .bld-li.fail .bld-n{background:#dc2626;color:#fff}' +
    '#bizLinkDemo .bld-chk{font-size:14px;display:inline-flex;gap:6px;align-items:center}' +
    '#bizLinkDemo .bld-log{list-style:none;padding:0;margin:6px 0;font-size:13.5px;max-height:260px;overflow:auto}#bizLinkDemo .bld-log li{padding:3px 0;border-bottom:1px solid #f1f5f9}';

  function init() {
    var el = $('bizLinkDemo'); if (!el || el.getAttribute('data-ready')) return;
    el.setAttribute('data-ready', '1');
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    S = fresh();
    el.addEventListener('click', onClick); el.addEventListener('change', onChange); el.addEventListener('input', onInput);
    render();
  }
  root.BizLinkDemo = { core: core, init: init, _state: function () { return S; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(typeof window !== 'undefined' ? window : this);
