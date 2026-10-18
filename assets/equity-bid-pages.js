/* ═════════════════════════════════════════════════════════════════════
   equity-bid-pages.js — 지분 입찰 테스트 하위 4개 페이지 렌더러 (2026-10-18)
     data-page="subscribers" 잠재 가입자 | "pricing" 요금·매출 | "scenarios" 점유율 시나리오 | "competition" 경쟁력 분석

   ※ 시스템 테스트 전용 · 모든 숫자는 가정이며 확정값·예측·이익 약속이 아닙니다.
   ※ 계산은 assets/equity-bid-model.js, 탭은 assets/equity-bid-tabs.js 에 있다.
   ═════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var M = window.EquityBidModel;
  var root = document.getElementById('ebp');
  if (!M || !root) return;
  var PAGE = root.getAttribute('data-page');
  var FX = 1400; // 원/달러 — 범용 AI 구독 가격의 원화 환산용 "가정"이다(실제 환율·결제 경로에 따라 다름).

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var I = M.fmtInt, W = M.fmtWon, P = M.fmtPct;

  /* ── 가정(프리셋) 상태: 탭을 옮겨도 유지되도록 sessionStorage에 둔다(막히면 메모리만) ── */
  var STORE = 'ebp-assumptions-v2';
  var EDIT = ['meterMultiple', 'royaltyRate', 'rdRate', 'supportRate', 'mktRate', 'adminRate'];   // 화면에서 고칠 수 있는 값
  function presetParams(p) { return M.merge(M.DEFAULTS, p.params); }
  var state = { preset: 'floor', params: presetParams(M.PRESETS[0]) };
  try { var raw = sessionStorage.getItem(STORE); if (raw) { var o = JSON.parse(raw); if (o && o.params && typeof o.params.royaltyRate === 'number') state = o; } } catch (e) {}
  function saveState() { try { sessionStorage.setItem(STORE, JSON.stringify(state)); } catch (e) {} }
  function A() { return M.merge(M.DEFAULTS, state.params); }
  function presetLabel() { for (var i = 0; i < M.PRESETS.length; i++) if (M.PRESETS[i].id === state.preset) return M.PRESETS[i]; return null; }
  function varRate(a) { return a.royaltyRate + a.rdRate + a.supportRate + a.mktRate + a.adminRate; }

  var BANNER = '<div class="ebp-testbar" role="note">시스템 테스트 — 실제 입찰이 아닙니다. 이 화면의 모든 숫자는 가정에 따른 계산이며 확정값이 아니고, 수익을 예측하거나 약속하지 않습니다.</div>';

  /* ── 쉽게 이해하기: 초보 독자용 안내 부품 ── */
  var ROAD = [
    ['입찰 테스트', '지분을 어떻게 사는지 연습해 봅니다'],
    ['잠재 가입자', '손님이 될 수 있는 사람이 몇 명인가요?'],
    ['요금·매출', '손님 한 명에게 얼마를 받고, 얼마가 드나요?'],
    ['점유율 시나리오', '손님을 얼마나 모으면 내 지분은 얼마를 받나요?'],
    ['경쟁력 분석', '비슷한 서비스보다 값이 합리적인가요?']
  ];
  function roadmap(cur) {
    return '<p style="margin:12px 0 4px"><b>이 5개 탭은 한 가지 질문에 차례로 답합니다.</b> “나비웹이 직업별 회사를 만들어 지분 5%를 전문가에게 판다면, 그 지분은 살 만한가?”</p><ol class="ebp-road">' +
      ROAD.map(function (r, n) { return '<li' + (n === cur ? ' class="cur"' : '') + '><b>' + (n + 1) + '. ' + esc(r[0]) + (n === cur ? ' (지금 보는 탭)' : '') + '</b><br>' + esc(r[1]) + '</li>'; }).join('') + '</ol>';
  }
  function gloss(items) { return '<dl class="ebp-gloss">' + items.map(function (it) { return '<dt>' + esc(it[0]) + '</dt><dd>' + it[1] + '</dd>'; }).join('') + '</dl>'; }
  function glossBox(title, items) { return '<details class="ebp-det" open><summary><span>' + esc(title) + '</span></summary><div class="body">' + gloss(items) + '</div></details>'; }
  function readme(html) { return '<p class="ebp-readme"><b>이 표 읽는 법</b> — ' + html + '</p>'; }
  function story(html) { return '<div class="ebp-story">' + html + '</div>'; }
  function won0(n) { return W(Math.abs(n)); }
  // 시장 규모 · 점유율을 "10명 중 N명"으로 풀어 쓴다
  function tenOf(share) { return '10명 중 ' + (share * 10) + '명'; }

  /* ── 공용: 가정 패널(프리셋 + 종량제 배수 + 비용 비율) ── */
  function assumptionPanel() {
    var a = A();
    var chips = M.PRESETS.map(function (p) {
      return '<button type="button" class="ebp-chip" data-preset="' + p.id + '" aria-pressed="' + (state.preset === p.id) + '">' + esc(p.label) + '</button>';
    }).join('');
    var pr = presetLabel();
    function inp(id, label, val, max, step) { return '<div class="ebp-field"><label for="' + id + '">' + label + '</label><input id="' + id + '" type="number" min="0" max="' + max + '" step="' + step + '" value="' + val + '"></div>'; }
    return '<section class="ebp-card"><h2>계산 가정</h2>' +
      '<p class="ebp-hint">처음 화면은 <b>하한</b>입니다. 관리자 문서 4.3이 "낙관적인 값이 아니라 가정이 틀렸을 때를 기준으로 판단한다"고 정했기 때문입니다. <b>문서 원안</b>은 비용을 거의 넣지 않은 이전 계산이며 비교용입니다.</p>' +
      '<div class="ebp-chips" role="group" aria-label="가정 프리셋">' + chips + '</div>' +
      '<p class="ebp-preset-desc">' + (pr ? esc(pr.desc) : '직접 입력한 값입니다.') + '</p>' +
      (pr && pr.unrealistic ? '<p class="ebp-preset-desc" style="color:#8a1f14;font-weight:700">이 가정은 연구개발·인건비·마케팅·관리비와 로열티가 빠져 있어 실제 수익을 과대하게 보여 줍니다.</p>' : '') +
      '<div class="ebp-row">' +
        inp('ebpMeter', '종량제 수입 배수(서버 원가 대비)', a.meterMultiple, 30, 0.5) +
        inp('ebpRoy', '나비웹 로열티(매출 대비 %)', Math.round(a.royaltyRate * 100), 90, 1) +
        inp('ebpRd', '연구개발비(매출 대비 %)', Math.round(a.rdRate * 100), 90, 1) +
        inp('ebpSup', '지원·운영 인건비(매출 대비 %)', Math.round(a.supportRate * 100), 90, 1) +
        inp('ebpMkt', '마케팅·영업비(매출 대비 %)', Math.round(a.mktRate * 100), 90, 1) +
        inp('ebpAdm', '일반관리비(매출 대비 %)', Math.round(a.adminRate * 100), 90, 1) +
      '</div>' +
      '<p class="ebp-hint" style="margin-top:8px">비용 합계는 매출의 <b>' + P(varRate(a), 0) + '</b>입니다. 규모가 작아도 드는 <b>연 최소 비용</b>(연구개발 ' + W(a.rdMin) + ', 지원·운영 ' + W(a.supportMin) + ', 마케팅 ' + W(a.mktMin) + ')과 유지비 ' + W(a.fixedMaint) + '(점유율 10% 이상이면 임원 보수 ' + W(a.execPay) + ' 추가)는 비율과 별도로 적용됩니다.</p>' +
      '<details class="ebp-det"><summary><span>비용 가정의 근거와 한계</span></summary><div class="body">' +
        '<ul class="ebp-list">' +
          '<li><b>나비웹 로열티 30%</b> — 이전 문서가 가정한 "매출의 30%"입니다. 문서에는 나비웹 지분이 51% 이상인 동안 로열티가 없다고 되어 있지만, <b>LLM 서버 운영 실비를 누가 부담할지는 미확정</b>이어서 보수적으로 법인이 낸다고 보았습니다. 서버 원가(회원당 ' + I(a.serverCostPerMember) + '원) 아래로는 내려가지 않게 했습니다.</li>' +
          '<li><b>연구개발·마케팅·관리·지원</b> — 민간 B2B SaaS의 중앙값은 영업·마케팅이 매출의 33~47%, R&amp;D가 23~34%, 일반관리가 12~19%입니다(Benchmarkit 2025, 2차 인용). 나비웹 법인은 모델 개발을 나비웹이 로열티로 맡고, 소개의 대가가 금지되어 광고·영업이 제한된다고 보아 R&amp;D·마케팅은 그 절반 수준으로 낮췄습니다. 지원 인건비 10%는 SaaS 고객 지원 비율(약 11%)을 따랐습니다.</li>' +
          '<li>비용 항목의 금액·비율은 모두 <b>검토용 추가 가정</b>이며 관리자 문서에 없습니다. 실제 운영 계획이 나오면 교체해야 합니다.</li>' +
          '<li>세금은 법인세만 반영했고 결손은 다음 해로 넘기지 않습니다. 부가세·결제 수수료·지방소득세는 넣지 않았습니다.</li>' +
        '</ul></div></details>' +
      '</section>';
  }
  function bindAssumptionPanel(rerender) {
    Array.prototype.forEach.call(root.querySelectorAll('[data-preset]'), function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-preset'), p = M.PRESETS.filter(function (x) { return x.id === id; })[0];
        if (!p) return; state = { preset: id, params: presetParams(p) }; saveState(); rerender();
      });
    });
    var map = { ebpMeter: ['meterMultiple', 1, 30], ebpRoy: ['royaltyRate', 0.01, 0.9], ebpRd: ['rdRate', 0.01, 0.9], ebpSup: ['supportRate', 0.01, 0.9], ebpMkt: ['mktRate', 0.01, 0.9], ebpAdm: ['adminRate', 0.01, 0.9] };
    function manual() {
      var params = M.merge(state.params, {});
      Object.keys(map).forEach(function (id) {
        var d = map[id], v = parseFloat(document.getElementById(id).value);
        if (!isFinite(v) || v < 0) v = 0; v = v * d[1]; if (v > d[2]) v = d[2]; params[d[0]] = v;
      });
      var matched = M.PRESETS.filter(function (p) { var q = presetParams(p); return EDIT.every(function (k) { return Math.abs(q[k] - params[k]) < 1e-9; }) && q.rdMin === params.rdMin; })[0];
      state = { preset: matched ? matched.id : 'custom', params: params }; saveState(); rerender();
    }
    Object.keys(map).forEach(function (id) { document.getElementById(id).addEventListener('change', manual); });
  }

  /* ════════ 1) 잠재 가입자 ════════ */
  function pageSubscribers() {
    var total = M.PROFESSIONS.reduce(function (s, p) { return s + p.market; }, 0), maxM = Math.max.apply(null, M.PROFESSIONS.map(function (p) { return p.market; }));
    var rows = M.PROFESSIONS.map(function (p) {
      var w = Math.max(2, Math.round(p.market / maxM * 120));
      return '<tr><td><b>' + esc(p.name) + '</b>' + (p.shrinking ? ' <span class="ebp-badge un">축소 중</span>' : '') + '</td>' +
        '<td class="num">' + I(p.market) + '명</td>' +
        '<td><span class="ebp-bar" style="width:' + w + 'px"></span>' + P(p.market / total, 1) + '</td>' +
        '<td class="num">' + I(p.market * M.BASE_SHARE) + '명</td><td class="num">' + I(p.market * M.TARGET_SHARE) + '명</td>' +
        '<td class="num">' + I(p.target5pctMan) + '만 원</td></tr>';
    }).join('');
    var details = M.PROFESSIONS.map(function (p) {
      return '<details class="ebp-det"><summary><span>' + esc(p.name) + ' · 약 ' + I(p.market) + '명</span></summary><div class="body">' +
        '<p><b>시장 규모의 근거와 한계</b> — ' + esc(p.basis) + '</p>' +
        (p.trend ? '<p><b>추세</b> — ' + esc(p.trend) + '</p>' : '') +
        '<p><b>가입자의 범위</b> — ' + (p.staffIncluded ? '사무원을 포함한 값입니다(법무사 약 7,878명 + 사무원 약 7,878명).' : '자격자 본인만 센 값입니다. 제안서의 요금은 사무소 직원에게도 각각 연 99,000원이 붙지만 직원 수는 추정하지 못해 넣지 않았습니다(그만큼 보수적).') + '</p>' +
        '<p><b>기준 가입자·목표 회원</b> — 시장의 10%인 ' + I(p.market * M.BASE_SHARE) + '명(개시 판단 기준), 30%인 ' + I(p.market * M.TARGET_SHARE) + '명(관리자 문서 2.6의 목표 회원).</p>' +
        '</div></details>';
    }).join('');
    var LW = M.findProfession('lawyer'), PT = M.findProfession('patent-attorney');
    var sorted = M.PROFESSIONS.slice().sort(function (x, y) { return y.market - x.market; }), big = sorted[0], small = sorted[sorted.length - 1];
    var guideSub = '<section class="ebp-card ebp-guide"><h2>먼저 쉽게 이해하기</h2>' +
      '<p class="lead">이 페이지는 <b>“이 회사의 손님이 될 수 있는 사람이 모두 몇 명인가?”</b>를 알려 드립니다.</p>' +
      '<p>동네에 가게를 열 때 “이 동네에 사는 사람이 몇 명이지?”부터 따져 보지요? 그것과 같은 질문입니다. 나비웹은 직업(직역)마다 회사를 하나씩 만들어, 그 직업을 가진 분들에게 AI 도구를 구독으로 제공하려고 합니다. 그래서 <b>그 직업을 가진 사람의 수가 곧 손님이 될 수 있는 최대 인원</b>입니다.</p>' +
      story('<b>예를 들어 볼까요?</b> 변호사는 약 <b>' + I(LW.market) + '명</b>입니다. 이 중 <b>' + tenOf(0.1) + '(10%)</b>이 가입하면 ' + I(LW.market * 0.1) + '명, <b>' + tenOf(0.3) + '(30%)</b>이 가입하면 ' + I(LW.market * 0.3) + '명이 됩니다. 변리사는 시장이 ' + I(PT.market) + '명뿐이라 같은 30%여도 ' + I(PT.market * 0.3) + '명에 그칩니다.') +
      '<p>10개 직역 중 가장 큰 시장은 <b>' + esc(big.name) + '(약 ' + I(big.market) + '명)</b>이고 가장 작은 시장은 <b>' + esc(small.name) + '(약 ' + I(small.market) + '명)</b>으로, 약 <b>' + Math.round(big.market / small.market) + '배</b> 차이가 납니다.</p>' +
      glossBox('이 페이지에 나오는 말', [
        ['시장 규모(잠재 가입자)', '그 직업을 가진 사람의 수입니다. “가입할 수 있는 사람”이지 “가입할 사람”이 아닙니다.'],
        ['기준 가입자(10%)', '시장 규모의 10%입니다. 제안서는 <b>최소한 이만큼 모여야 서비스를 계속할지 판단</b>하고, 그전에는 서버 구입 같은 큰돈을 쓰지 않겠다고 했습니다.'],
        ['목표 회원(30%)', '관리자 문서가 매출을 계산할 때 쓴 목표입니다. 시장의 30%가 가입한다고 가정한 값입니다.'],
        ['5% 매각 목표', '법인 지분 5%를 팔아 모으려는 돈입니다. 시장이 큰 직역일수록 목표 금액도 큽니다.'],
        ['근사치', '정확한 통계가 아니라 “대략 이 정도”라는 값입니다. 아래 직역별 설명에서 근거와 한계를 확인하실 수 있습니다.']
      ]) +
      '<p><b>이 페이지에서 꼭 기억하실 세 가지</b></p><ul class="ebp-list">' +
        '<li>숫자는 모두 <b>대략적인 추정</b>입니다.</li>' +
        '<li>시장이 클수록 같은 점유율에서 회원이 많아집니다. 하지만 큰 시장에는 큰 경쟁자와 까다로운 규제가 있을 수 있습니다.</li>' +
        '<li>시장이 작은 직역은 회사를 운영하는 최소 비용을 감당하기 어려울 수 있습니다(요금·매출 탭에서 확인).</li></ul>' +
      roadmap(1) + '</section>';
    root.innerHTML = BANNER + guideSub +
      '<section class="ebp-card"><h2>잠재 가입자 수</h2>' +
      '<p class="ebp-hint">10개 직역 법인이 각각 상대하는 시장입니다. 관리자 「자회사 10개 설립과 이사진 구성」 2.1의 시장 규모를 그대로 썼으며, 모두 <b>근사치이고 참여 규모를 약속하는 값이 아닙니다</b>.</p>' +
      '<div class="ebp-kpis">' +
        '<div class="ebp-kpi"><div class="k">10개 직역 시장 합계</div><div class="v">' + I(total) + '명</div><div class="s">의사·공인중개사가 약 58%</div></div>' +
        '<div class="ebp-kpi"><div class="k">기준 가입자(시장의 10%)</div><div class="v">' + I(total * M.BASE_SHARE) + '명</div><div class="s">개시 여부를 가르는 기준</div></div>' +
        '<div class="ebp-kpi"><div class="k">목표 회원(시장의 30%)</div><div class="v">' + I(total * M.TARGET_SHARE) + '명</div><div class="s">문서 2.6의 연 환산 기준</div></div>' +
      '</div>' +
      readme('가로로 한 줄이 한 직역입니다. <b>시장 규모</b>는 그 직업의 전체 인원, <b>비중</b>은 10개 직역 전체에서 차지하는 몫(노란 막대가 길수록 큼), <b>기준 가입자</b>와 <b>목표 회원</b>은 시장의 10%와 30%, <b>5% 매각 목표</b>는 법인 지분 5%로 모으려는 돈입니다.') +
      '<div class="ebp-tw"><table class="ebp-table"><thead><tr><th>직역</th><th class="num">시장 규모</th><th>비중</th><th class="num">기준 가입자(10%)</th><th class="num">목표 회원(30%)</th><th class="num">5% 매각 목표</th></tr></thead><tbody>' + rows +
      '<tr class="total"><td>합계</td><td class="num">' + I(total) + '명</td><td></td><td class="num">' + I(total * M.BASE_SHARE) + '명</td><td class="num">' + I(total * M.TARGET_SHARE) + '명</td><td class="num">5억 원</td></tr></tbody></table></div>' +
      '<p class="ebp-hint" style="margin-top:10px">직역별 목표 회원은 문서 2.6에서 반올림한 값(예: 변호사 9,600명)을 쓰므로 여기의 30% 계산과 소수 자리에서 조금 다를 수 있습니다.</p></section>' +
      '<section class="ebp-card"><h2>직역별 설명</h2><p class="ebp-hint">직역을 눌러 시장 규모의 근거와 한계를 확인하십시오.</p>' + details + '</section>' +
      '<div class="ebp-caution" role="note"><b>읽을 때 유의할 점</b><ul>' +
        '<li>"잠재 가입자"는 <b>가입할 수 있는 사람의 수</b>이지 가입할 사람의 수가 아닙니다. 가입률(점유율)은 다음 탭 「점유율 시나리오」에서 10~90%로 가정해 봅니다.</li>' +
        '<li>시장 규모에는 공식 통계가 아닌 추정(블로그 추정 포함)이 섞여 있습니다. 개업·비개업 구분이 안 된 직역도 있습니다.</li>' +
        '<li>공인중개사 시장은 폐업이 개업을 웃돌아 줄고 있으므로, 시장 규모가 시간이 갈수록 작아질 수 있습니다.</li></ul></div>';
  }

  /* ════════ 2) 요금·매출 ════════ */
  function pagePricing() {
    root.innerHTML = BANNER + '<div id="ebpGuide"></div><div id="ebpAssump"></div><div id="ebpBody"></div>';
    function draw() {
      document.getElementById('ebpAssump').innerHTML = assumptionPanel();
      bindAssumptionPanel(function () { draw(); });
      var a = A(), meter = M.meterPerMember(a), rev = M.revenuePerMember(a), srv = a.serverCostPerMember;
      var roy = Math.max(rev * a.royaltyRate, srv), rd = rev * a.rdRate, sup = rev * a.supportRate, mkt = rev * a.mktRate, adm = rev * a.adminRate;
      var contrib = rev - roy - rd - sup - mkt - adm;
      var gross = M.payPerMemberGross(a);
      var bep1 = M.breakEvenMembers(state.params, false), bep2 = M.breakEvenMembers(state.params, true);
      var LW = M.findProfession('lawyer'), AD = M.findProfession('administrative-scrivener'), pr0 = presetLabel();
      var keep = rev > 0 ? contrib / rev : 0;
      var storyPay = '<b>지금 고른 가정(' + esc(pr0 ? pr0.label : '직접 입력') + ')으로 풀어 보면</b> — 회원 한 분이 1년에 내는 돈(부가세 포함)은 약 <b>' + I(gross) + '원</b>, 한 달로 나누면 약 <b>' + I(gross / 12) + '원</b>입니다. 회사 매출은 부가세를 뺀 <b>' + I(rev) + '원</b>입니다. ' +
        '이 중 ' + I(roy) + '원은 나비웹에 내는 로열티(LLM 서버 사용료), ' + I(rd) + '원은 연구개발, ' + I(sup) + '원은 지원·운영 인건비, ' + I(mkt) + '원은 마케팅, ' + I(adm) + '원은 관리비로 나갑니다. ' +
        (contrib > 0 ? '모두 쓰고 나면 <b>' + I(contrib) + '원</b>이 남습니다. <b>100원을 받으면 약 ' + Math.round(keep * 100) + '원이 남는 셈</b>입니다.' : '모두 쓰고 나면 <b>남는 돈이 없습니다.</b> 이 가정에서는 손님이 늘어도 이익이 나지 않습니다.');
      var storyBep = bep2 == null ? '이 가정에서는 손님이 아무리 많아도 흑자가 나지 않습니다.' :
        '<b>가게에 비유하면</b>, 손익분기는 월세와 직원 월급을 겨우 낼 수 있는 손님 수입니다. 이 가정에서 변호사 법인은 약 <b>' + I(Math.ceil(bep2)) + '명</b>(변호사 전체의 ' + P(bep2 / LW.market, 0) + ')이 가입해야 적자를 면합니다. ' +
        (bep2 > AD.market ? '행정사 법인은 필요한 인원(' + I(Math.ceil(bep2)) + '명)이 행정사 시장 전체(' + I(AD.market) + '명)보다 많아서, <b>모든 행정사가 가입해도 적자</b>입니다.' : '행정사 법인은 시장의 ' + P(bep2 / AD.market, 0) + '가 가입해야 합니다.');
      document.getElementById('ebpGuide').innerHTML = '<section class="ebp-card ebp-guide"><h2>먼저 쉽게 이해하기</h2>' +
        '<p class="lead">이 페이지는 <b>“손님 한 명에게 얼마를 받고, 그중 얼마가 회사에 남는가?”</b>를 알려 드립니다.</p>' +
        '<p>휴대폰 요금제와 비슷합니다. 매달 내는 <b>기본요금</b>(기본료 연 99,000원)이 있고, 쓴 만큼 더 내는 요금(<b>종량제</b>, 전기·수도요금처럼)이 붙습니다. 종량제 금액은 아직 정해지지 않았고, 관리자 문서가 “서버 원가의 몇 배”로 가정한 값입니다. 아래 <b>계산 가정</b>의 버튼으로 바꿔 가며 결과가 어떻게 달라지는지 보세요.</p>' +
        story(storyPay) + story(storyBep) +
        glossBox('이 페이지에 나오는 말', [
          ['기본료', '누구나 내는 정액 요금입니다. 연 99,000원(부가세 포함)이며 월로 나누면 8,250원입니다.'],
          ['종량제', '쓴 만큼 더 내는 요금입니다. <b>얼마를 받을지는 미확정</b>이고 근거가 가장 약한 가정이라, 하한은 0으로 두었습니다.'],
          ['부가세', '요금에 붙는 10% 세금입니다. 회사는 이를 나라에 내므로 매출에서는 뺍니다(99,000원 → 90,000원).'],
          ['나비웹 로열티', '법인이 나비웹의 AI와 서버를 쓰는 대가입니다. 여기서는 LLM 서버 비용으로 보고 매출의 30%를 가정했습니다.'],
          ['연구개발비', '직업별 기능을 만들고 정확한지 확인하는 비용입니다.'],
          ['지원·운영 인건비', '손님의 문의에 답하고 서비스를 돌보는 직원들의 월급입니다.'],
          ['마케팅·영업비', '서비스를 알리고 가입자를 모으는 비용입니다.'],
          ['일반관리비', '사무실, 회계, 보험처럼 회사를 꾸려 가는 데 드는 비용입니다.'],
          ['기여이익', '손님 한 명에게서 받은 돈에서 위 비용을 뺀, <b>그 손님 덕분에 남는 돈</b>입니다. 이 값이 클수록 손님이 늘수록 유리합니다.'],
          ['손익분기', '들어오는 돈과 나가는 돈이 같아지는 지점입니다. 이 손님 수에 못 미치면 적자입니다.'],
          ['연 최소 비용', '손님이 적어도 회사에는 최소한의 팀과 비용이 듭니다. 그래서 비율과 별개로 일정 금액이 깔립니다.']
        ]) + roadmap(2) + '</section>';
      var line = function (label, v, note, cls) { return '<tr class="' + (cls || '') + '"><td>' + label + '</td><td class="num">' + (v < 0 ? '-' : '') + I(Math.abs(v)) + '</td><td class="num">' + P(Math.abs(v) / rev, 1) + '</td><td class="wrap">' + note + '</td></tr>'; };
      var rowsBep = M.PROFESSIONS.map(function (p) {
        var pct = bep2 == null ? null : bep2 / p.market, risky = pct == null || pct > M.BASE_SHARE;
        return '<tr class="' + (risky ? 'warn' : '') + '"><td><b>' + esc(p.name) + '</b></td><td class="num">' + I(p.market) + '명</td><td class="num">' + (bep2 == null ? '흑자 없음' : I(Math.ceil(bep2)) + '명') + '</td><td class="num">' + (pct == null ? '-' : (pct > 1 ? '시장 전체보다 많음' : P(pct, 1))) + '</td><td class="wrap">' + (pct == null ? '이 가정에서는 규모를 키워도 흑자가 나지 않음' : (pct > 1 ? '시장 전체가 가입해도 손익분기에 못 미침' : (pct > M.BASE_SHARE ? '기준 가입자(10%)보다 많은 가입이 있어야 손익분기' : '기준 가입자(10%) 이내에서 손익분기'))) + '</td></tr>';
      }).join('');
      var rowsRev = M.PROFESSIONS.map(function (p) {
        var r1 = M.compute(p, 0.10, a), r3 = M.compute(p, 0.30, a);
        return '<tr><td><b>' + esc(p.name) + '</b></td><td class="num">' + W(r1.revenue) + '</td><td class="num">' + W(r1.operatingProfit) + '</td><td class="num">' + W(r3.revenue) + '</td><td class="num">' + W(r3.operatingProfit) + '</td></tr>';
      }).join('');
      document.getElementById('ebpBody').innerHTML =
        '<section class="ebp-card"><h2>요금 구조</h2><p class="ebp-hint">제안서의 틀입니다. 요금을 받는 주체·정산 방식·종량 단가는 <b>미확정</b>이며, 아래 종량제는 관리자 문서의 가정입니다.</p>' +
        '<div class="ebp-kpis">' +
          '<div class="ebp-kpi"><div class="k">기본료(연)</div><div class="v">99,000원</div><div class="s">부가세 포함 · 공급가 ' + I(M.feeSupply(a)) + '원 · 월 환산 ' + I(99000 / 12) + '원</div></div>' +
          '<div class="ebp-kpi"><div class="k">종량제(연, 공급가)</div><div class="v">' + I(meter) + '원</div><div class="s">서버 원가 ' + I(srv) + '원 × ' + a.meterMultiple + '배</div></div>' +
          '<div class="ebp-kpi"><div class="k">회원 1인 연 부담(부가세 포함)</div><div class="v">' + I(gross) + '원</div><div class="s">월 환산 약 ' + I(gross / 12) + '원</div></div>' +
        '</div>' +
        '<p class="ebp-hint" style="margin-top:10px">사무소 직원도 각각 연 99,000원 + 종량제입니다. 종량제는 쓴 만큼 늘어나므로 <b>회원이 내는 금액이 사용량에 따라 달라져 예측하기 어렵다</b>는 점이 경쟁력 분석 탭에서 다시 다뤄집니다.</p></section>' +
        '<section class="ebp-card"><h2>회원 1인 단위 경제(연, 규모가 충분히 커진 뒤)</h2><p class="ebp-hint">연 최소 비용을 덮을 만큼 커진 뒤의 회원 1인 기준입니다. 규모가 작을 때의 최소 비용은 아래 손익분기에서 반영됩니다.</p>' +
        readme('위에서 아래로 <b>손님 한 명</b>의 1년을 따라갑니다. 먼저 받는 돈(매출)이 나오고, 그다음 줄들은 <b>나가는 돈</b>(앞에 - 표시)입니다. 맨 아래 <b>기여이익</b>이 손님 한 명에게서 남는 돈입니다. 오른쪽 “매출 대비”는 받은 돈 100원 중 몇 원인지입니다.') +
        '<div class="ebp-tw"><table class="ebp-table"><thead><tr><th>항목</th><th class="num">금액(원/년)</th><th class="num">매출 대비</th><th class="wrap">가정</th></tr></thead><tbody>' +
          line('연회비 공급가', M.feeSupply(a), '99,000원 ÷ 1.1') +
          line('종량제 수입', meter, '서버 원가 × ' + a.meterMultiple + '배(가정)') +
          '<tr class="total"><td>매출 합계</td><td class="num">' + I(rev) + '</td><td class="num">100%</td><td class="wrap"></td></tr>' +
          line('나비웹 로열티(LLM 서버 비용)', -roy, '매출 × ' + P(a.royaltyRate, 0) + ', 서버 원가 ' + I(srv) + '원 이상') +
          line('연구개발비', -rd, '매출 × ' + P(a.rdRate, 0)) +
          line('지원·운영 인건비', -sup, '매출 × ' + P(a.supportRate, 0)) +
          line('마케팅·영업비', -mkt, '매출 × ' + P(a.mktRate, 0)) +
          line('일반관리비', -adm, '매출 × ' + P(a.adminRate, 0)) +
          '<tr class="total"><td>회원 1인당 기여이익</td><td class="num">' + (contrib < 0 ? '-' : '') + I(Math.abs(contrib)) + '</td><td class="num">' + P(contrib / rev, 1) + '</td><td class="wrap">유지비·임원 보수·법인세 차감 전' + (contrib <= 0 ? ' — <b>회원이 늘어도 이익이 나지 않는 구조</b>' : '') + '</td></tr>' +
        '</tbody></table></div></section>' +
        '<section class="ebp-card"><h2>손익분기와 직역별 연 매출</h2>' +
          '<p class="ebp-hint">비용(연 최소 비용 포함)과 유지비를 덮어 영업이익이 0이 되는 회원 수입니다. 유지비만 반영하면 <b>' + (bep1 == null ? '흑자 없음' : '약 ' + I(Math.ceil(bep1)) + '명') + '</b>, 임원 보수까지 반영하면 <b>' + (bep2 == null ? '흑자 없음' : '약 ' + I(Math.ceil(bep2)) + '명') + '</b>입니다.</p>' +
          readme('직역마다 <b>적자를 면하려면 몇 명이 가입해야 하는지</b>와, 그 인원이 그 직업 전체의 몇 %인지를 보여 줍니다. 붉은 글씨 줄은 시장의 10%(기준 가입자)보다 많이 모아야 한다는 뜻이고, “시장 전체보다 많음”은 그 직업 사람이 모두 가입해도 적자라는 뜻입니다.') +
          '<div class="ebp-tw"><table class="ebp-table"><thead><tr><th>직역</th><th class="num">시장 규모</th><th class="num">손익분기 회원(임원 보수 포함)</th><th class="num">시장 대비</th><th class="wrap">판단</th></tr></thead><tbody>' + rowsBep + '</tbody></table></div>' +
          '<h3>점유율 10%·30%일 때 직역별 연 매출과 영업이익</h3>' +
          readme('<b>점유율 10%</b>는 그 직업 10명 중 1명이, <b>30%</b>는 10명 중 3명이 가입했을 때입니다. <b>영업이익</b>은 매출에서 모든 비용을 뺀 값으로, <b>마이너스(-)면 적자</b>입니다.') +
          '<div class="ebp-tw"><table class="ebp-table"><thead><tr><th>직역</th><th class="num">매출(10%)</th><th class="num">영업이익(10%)</th><th class="num">매출(30%)</th><th class="num">영업이익(30%)</th></tr></thead><tbody>' + rowsRev + '</tbody></table></div>' +
          '<p class="ebp-hint" style="margin-top:10px">영업이익은 법인세 차감 전이고 위 비용을 모두 뺀 값입니다. 5개 점유율 전체와 지분 배당은 「점유율 시나리오」 탭에 있습니다.</p></section>';
    }
    draw();
  }

  // 선택한 직역(또는 합계)의 한 점유율을 "한 걸음씩" 풀어 쓴 문장
  function scenarioStory(selProf, sh, a) {
    var all = selProf === '__all', prof = all ? null : M.findProfession(selProf);
    var r = all ? M.computeAll(sh, a) : M.compute(prof, sh, a);
    var who = all ? '10개 직역 전체를 합쳐' : esc(prof.name) + ' 법인';
    var share5 = all ? '10개 법인 지분 5%를 모두 샀다면' : '이 법인의 지분 5%를 샀다면';
    var t = '<b>' + who + ', 점유율 ' + Math.round(sh * 100) + '%(' + tenOf(sh) + ' 가입)</b>일 때를 한 걸음씩 따라가 보겠습니다. 회원은 <b>' + I(r.members) + '명</b>이고 1년 매출은 <b>' + W(r.revenue) + '</b>입니다. 비용으로 <b>' + W(r.costTotal) + '</b>이 나가서 ';
    if (r.operatingProfit > 0) {
      t += '회사에 남는 돈(영업이익)은 <b>' + W(r.operatingProfit) + '</b>입니다. 법인세 ' + W(r.tax) + '을 빼면 주주 몫으로 <b>' + W(r.netIncome) + '</b>이 남습니다. ' + share5 + ', 그 5%인 <b>' + W(r.stakeDividend) + '</b>이 해마다 배당으로 들어옵니다. 지분을 산 값 ' + W(r.stakeCost) + '에 견주면 <b>연 ' + P(r.yieldPct, 0) + '</b>이고, 1,000만 원을 넣었다면 해마다 약 ' + W(r.yieldPct * 10000000) + '을 받는 셈입니다.';
    } else {
      t += '<b>모자라는 돈(적자)이 ' + W(Math.abs(r.operatingProfit)) + '</b>입니다. 이익이 없으니 ' + share5 + ' <b>받을 배당이 없습니다.</b>';
    }
    return t;
  }

  /* ════════ 3) 점유율 시나리오 ════════ */
  var selProf = 'lawyer';
  function pageScenarios() {
    root.innerHTML = BANNER + '<div id="ebpGuide"></div>' +
      '<div class="ebp-caution" role="note"><b>이 표를 읽기 전에</b><ul>' +
        '<li>"수익률"은 <b>5% 지분을 낙찰가(관리자 문서 2.4의 참고 가격)에 샀을 때, 법인 세후 이익 전액을 배당한다고 가정한 연 배당수익률</b>입니다. 배당 정책은 정해지지 않았고, 나비웹이 90% 이상을 보유해 소수 주주의 배당 권한은 약합니다.</li>' +
        '<li>연구개발비·지원 인건비·마케팅비·관리비와 <b>LLM 서버 비용(나비웹 로열티)</b>을 반영했습니다. 반영하지 않은 이전 계산은 가정 프리셋 <b>문서 원안</b>에서 비교할 수 있습니다.</li>' +
        '<li>점유율 도달은 보장되지 않습니다. 70%·90%는 이론상 상한을 보는 칸이며 현실적으로 도달하기 어렵습니다(경쟁력 탭 참고). 이익이 나지 않는 칸은 배당이 0입니다.</li>' +
        '<li>높은 수익률이 나오는 칸은 <b>사업이 좋아서가 아니라 입찰 가격이 낮기 때문</b>일 수 있습니다(5% 지분의 취득가가 법인 이익에 비해 작음). 이 가격 차이는 증여세·배임 쟁점과 이어지므로 세무 검토가 필요합니다. 투자한 돈을 잃을 수 있습니다.</li></ul></div>' +
      '<div id="ebpAssump"></div><div id="ebpBody"></div>';
    function draw() {
      document.getElementById('ebpAssump').innerHTML = assumptionPanel();
      bindAssumptionPanel(function () { draw(); });
      var a = A();
      var opts = M.PROFESSIONS.map(function (p) { return '<option value="' + p.id + '"' + (p.id === selProf ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') +
        '<option value="__all"' + (selProf === '__all' ? ' selected' : '') + '>10개 직역 합계</option>';
      var prof = M.findProfession(selProf);
      var rows = M.SHARES.map(function (s) {
        var r = selProf === '__all' ? M.computeAll(s, a) : M.compute(prof, s, a);
        if (r.paybackYears === undefined) r.paybackYears = r.stakeDividend > 0 ? r.stakeCost / r.stakeDividend : null;   // 합계 행은 모델이 주지 않으므로 여기서 계산
        var warn = s >= 0.7 ? ' warn' : '';
        return '<tr class="' + warn.trim() + '"><td><b>' + Math.round(s * 100) + '%</b>' + (s >= 0.7 ? ' <span class="ebp-badge un">참고용 상한</span>' : '') + '</td>' +
          '<td class="num">' + I(r.members) + '명</td><td class="num">' + W(r.revenue) + '</td><td class="num">' + W(r.operatingProfit) + '</td>' +
          '<td class="num">' + P(r.margin, 1) + '</td><td class="num">' + (r.netIncome != null ? W(r.netIncome) : '-') + '</td>' +
          '<td class="num">' + W(r.stakeDividend) + '</td><td class="num"><b>' + P(r.yieldPct, 0) + '</b></td>' +
          '<td class="num">' + (r.paybackYears == null ? '회수 불가' : r.paybackYears.toFixed(1) + '년') + '</td></tr>';
      }).join('');
      var rs = M.SHARES.map(function (s) { return selProf === '__all' ? M.computeAll(s, a) : M.compute(prof, s, a); });
      var costLine = function (label, key, bold) {
        return '<tr class="' + (bold ? 'total' : '') + '"><td>' + label + '</td>' + rs.map(function (r) { var v = r[key]; return '<td class="num">' + W(v) + ' <span class="ebp-src">(' + P(r.revenue > 0 ? v / r.revenue : 0, 0) + ')</span></td>'; }).join('') + '</tr>';
      };
      var rawP = M.PRESETS.filter(function (x) { return x.id === 'docraw'; })[0].params;
      var cmpRows = M.SHARES.map(function (sh, i) {
        var o = selProf === '__all' ? M.computeAll(sh, rawP) : M.compute(prof, sh, rawP), c = rs[i];
        return '<tr><td><b>' + Math.round(sh * 100) + '%</b></td><td class="num">' + P(o.margin, 1) + '</td><td class="num"><b>' + P(c.margin, 1) + '</b></td><td class="num">' + P(o.yieldPct, 0) + '</td><td class="num"><b>' + P(c.yieldPct, 0) + '</b></td></tr>';
      }).join('');
      var costRows = costLine('매출', 'revenue', true) + costLine('나비웹 로열티(LLM 서버)', 'royalty') + costLine('연구개발비', 'rd') + costLine('지원·운영 인건비', 'support') + costLine('마케팅·영업비', 'mkt') + costLine('일반관리비', 'admin') + costLine('유지비·임원 보수', 'fixed') + costLine('비용 합계', 'costTotal', true) + costLine('영업이익', 'operatingProfit', true);
      var cost = selProf === '__all' ? M.PROFESSIONS.reduce(function (s, p) { return s + p.target5pctMan * 10000; }, 0) : prof.target5pctMan * 10000;
      var head = selProf === '__all' ? '10개 직역 합계' : prof.name;
      var matrix = M.PROFESSIONS.map(function (p) {
        return '<tr' + (p.id === selProf ? ' class="sel"' : '') + '><td><b>' + esc(p.name) + '</b></td><td class="num">' + W(p.target5pctMan * 10000) + '</td>' +
          M.SHARES.map(function (s) { var r = M.compute(p, s, a); return '<td class="num">' + P(r.yieldPct, 0) + '</td>'; }).join('') + '</tr>';
      }).join('');
      document.getElementById('ebpBody').innerHTML =
        '<section class="ebp-card"><h2>점유율별 시나리오</h2>' +
        '<div class="ebp-row"><div class="ebp-field"><label for="ebpProf">직역</label><select id="ebpProf">' + opts + '</select></div></div>' +
        '<p class="ebp-hint">' + esc(head) + ' · 5% 지분 취득가 <b>' + W(cost) + '</b>(5,000주 × 참고 주당 가격, 실제 낙찰가는 입찰로 정해집니다) · 현재 가정 <b>' + esc(presetLabel() ? presetLabel().label : '직접 입력') + '</b></p>' +
        readme('한 줄이 하나의 점유율입니다. 왼쪽에서 오른쪽으로 <b>회원 수 → 매출 → 영업이익 → 세후 이익 → 내 지분 배당 → 연 수익률</b> 순으로 이어집니다. <b>마이너스(-)는 적자</b>이고, 적자인 줄은 수익률이 0%입니다.') +
        '<div class="ebp-tw"><table class="ebp-table"><thead><tr><th>시장 점유율</th><th class="num">회원 수</th><th class="num">연 매출</th><th class="num">영업이익</th><th class="num">영업이익률</th><th class="num">세후 이익</th><th class="num">5% 지분 배당(연)</th><th class="num">연 배당수익률</th><th class="num">원금 회수 기간</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<p class="ebp-hint" style="margin-top:10px">점유율 10% 이상에서는 임원 보수(연 3,600만 원)가 붙는다고 가정했습니다. 법인세는 2억 원 이하 9%, 200억 원 이하 19%(지방소득세 제외)를 적용했고 적자는 다음 해로 넘기지 않습니다.</p></section>' +
        '<section class="ebp-card"><h2>비용 반영 전후 비교(' + esc(head) + ')</h2><p class="ebp-hint">이전 계산(문서 원안: 서버 원가와 고정비만 반영)과 지금 가정(비용 전부 반영)을 같은 점유율에서 비교합니다.</p>' +
        readme('같은 점유율에서 <b>이전 계산(원안)</b>과 <b>지금 가정</b>을 나란히 놓았습니다. 비용을 빼놓았던 원안은 영업이익률이 90% 안팎으로 나왔지만, 비용을 모두 반영한 지금은 훨씬 낮아집니다. 비용을 넣으면 숫자가 얼마나 달라지는지 보시는 표입니다.') +
        '<div class="ebp-tw"><table class="ebp-table"><thead><tr><th>시장 점유율</th><th class="num">영업이익률(원안)</th><th class="num">영업이익률(지금)</th><th class="num">연 배당수익률(원안)</th><th class="num">연 배당수익률(지금)</th></tr></thead><tbody>' + cmpRows + '</tbody></table></div></section>' +
        '<section class="ebp-card"><h2>비용 구조(' + esc(head) + ')</h2><p class="ebp-hint">점유율별로 매출이 어디에 쓰이는지 보여 줍니다. 괄호는 매출 대비 비율입니다. 규모가 작을 때는 연 최소 비용 때문에 비율이 크게 올라갑니다.</p>' +
        readme('위에서 아래로 <b>매출이 어디에 쓰이는지</b> 보여 줍니다. 괄호 안은 매출 100원 중 몇 원인지입니다. 점유율이 낮을 때 지원·운영 인건비 비율이 크게 높은 것은, 손님이 적어도 직원 몇 명의 월급은 나가기 때문입니다.') +
        '<div class="ebp-tw"><table class="ebp-table"><thead><tr><th>항목</th>' + M.SHARES.map(function (s) { return '<th class="num">' + Math.round(s * 100) + '%</th>'; }).join('') + '</tr></thead><tbody>' + costRows + '</tbody></table></div></section>' +
        '<section class="ebp-card"><h2>직역별 연 배당수익률 한눈에 보기</h2><p class="ebp-hint">같은 가정에서 직역·점유율별 연 배당수익률(5% 지분, 세후 이익 전액 배당 가정)입니다. 시장이 작은 직역은 고정비 비중이 커서 낮은 점유율에서 수익률이 낮거나 배당이 없을 수 있습니다.</p>' +
        readme('가로로 한 줄이 한 직역이고, 오른쪽 칸들은 점유율별 <b>연 배당수익률</b>입니다. 0%는 적자라서 배당이 없다는 뜻입니다. 시장이 작은 직역은 낮은 점유율에서 0%가 많습니다.') +
        '<div class="ebp-tw"><table class="ebp-table"><thead><tr><th>직역</th><th class="num">5% 취득가</th>' + M.SHARES.map(function (s) { return '<th class="num">' + Math.round(s * 100) + '%</th>'; }).join('') + '</tr></thead><tbody>' + matrix + '</tbody></table></div></section>';
      var stories = story(scenarioStory(selProf, 0.3, a)) + story(scenarioStory(selProf, 0.5, a));
      document.getElementById('ebpGuide').innerHTML = '<section class="ebp-card ebp-guide"><h2>먼저 쉽게 이해하기</h2>' +
        '<p class="lead">이 페이지는 <b>“손님을 얼마나 모으느냐에 따라 회사가 얼마를 벌고, 내가 산 5% 지분은 해마다 얼마를 돌려주는가?”</b>를 보여 드립니다.</p>' +
        '<p>아래 표는 <b>점유율</b>(그 직업 10명 중 몇 명이 쓰는지)을 10%부터 90%까지 바꿔 가며 계산한 것입니다. 숫자는 이런 순서로 이어집니다.</p>' +
        '<ol class="ebp-steps">' +
          '<li><b>회원 수</b> — 시장 규모 × 점유율</li>' +
          '<li><b>매출</b> — 회원 수 × 한 사람이 내는 돈</li>' +
          '<li><b>영업이익</b> — 매출에서 로열티·연구개발·인건비·마케팅·관리비를 뺀, 회사에 남는 돈(마이너스면 적자)</li>' +
          '<li><b>세후 이익</b> — 영업이익에서 법인세를 뺀 돈</li>' +
          '<li><b>5% 지분 배당</b> — 세후 이익의 5%. 회사가 이익을 주주에게 나눠 주는 돈입니다</li>' +
          '<li><b>연 배당수익률</b> — 내 배당 ÷ 지분을 산 값. “1,000만 원을 넣으면 해마다 얼마를 받는가”입니다</li>' +
          '<li><b>원금 회수 기간</b> — 산 값을 배당으로 다 돌려받는 데 걸리는 햇수</li></ol>' +
        '<p><b>지금 선택한 직역과 가정으로 예를 들면</b></p>' + stories +
        glossBox('가정 버튼은 이런 뜻입니다', [
          ['하한', '가장 나쁜 쪽에 가깝습니다. <b>종량제 수입이 하나도 없고 기본료만</b> 받으며, 비용은 모두 냅니다. 처음 화면입니다.'],
          ['보수', '종량제 수입이 조금(서버 원가의 1배) 있다고 보는 조심스러운 가정입니다.'],
          ['문서 매출', '관리자 문서가 기대한 만큼 종량제 수입이 생긴다고 보되, 비용은 모두 냅니다. 종량제는 근거가 약해서 <b>낙관적인 쪽</b>입니다.'],
          ['문서 원안', '비용을 거의 빼놓고 계산한 <b>이전 계산</b>입니다. 이익이 부풀려져 비현실적이므로 비교용으로만 보세요.']
        ]) +
        glossBox('이 페이지에 나오는 말', [
          ['시장 점유율', '그 직업을 가진 사람 중 서비스를 쓰는 사람의 비율입니다. 10%면 10명 중 1명입니다.'],
          ['영업이익률', '매출 100원 중 회사에 남는 돈입니다. 높을수록 장사가 잘되는 것입니다.'],
          ['배당', '회사가 번 돈을 주주들에게 나눠 주는 것입니다. <b>회사가 배당하기로 해야 받을 수 있고</b>, 이 화면은 이익 전부를 배당한다고 가정했습니다.'],
          ['참고용 상한', '점유율 70%·90%는 현실적으로 도달하기 어려운 칸입니다. “이론상 최대”를 보는 용도입니다.'],
          ['원금 회수 기간', '“회수 불가”는 이 가정에서는 배당이 없어서 산 값을 돌려받지 못한다는 뜻입니다.']
        ]) + roadmap(3) + '</section>';
      document.getElementById('ebpProf').addEventListener('change', function (e) { selProf = e.target.value; draw(); });
    }
    draw();
  }

  /* ════════ 4) 경쟁력 분석 ════════ */
  // s: 'ok' = 이번 조사에서 출처로 확인 / 'un' = 확인하지 못함(추정·미조사). 분석 의견은 나비웹의 판단이 아니라 이 보고서 작성 시점의 추정입니다.
  var SRC = {
    1: { t: '이투데이(2026-03-30) — 엘박스 MS 스타트업 커넥션 발표', u: 'https://www.etoday.co.kr/news/view/2570701' },
    2: { t: '대학저널(2026-04-30) — 엘박스 신규 변호사 무료 프로모션(스탠다드 플랜 월 69,900원 상당)', u: 'https://www.dhnews.co.kr/news/view/1065590581495696' },
    3: { t: '데일리팜(2023-03-23) — 약국 청구 SW 점유율', u: 'https://m.dailypharm.com/user/news/30020' },
    4: { t: '데일리팜(2021-04-29) — 약사회 배포 무료 청구 프로그램', u: 'https://dailypharm.com/user/news/52001' },
    5: { t: 'Lindy(2026-08-26) — ChatGPT 요금제 비교(Plus·Claude Pro·Google AI Pro 월 약 $20)', u: 'https://wf.lindy.ai/blog/chatgpt-pricing' },
    6: { t: '엘박스 관계자 링크드인 게시글 — 행정사회 협력 언급(게시 날짜 미확인)', u: 'https://kr.linkedin.com/in/gene-lee2019' }
  };
  var GENAI = { t: '범용 생성형 AI 구독(월 약 $20)', s: 'ok', src: 5 };
  var COMP = {
    'judicial-scrivener': { intensity: '중간(추정)', price: '가격에 민감할 가능성이 높음(추정)',
      land: [GENAI, { t: '법무사 전용 업무·등기 프로그램과 법원 전자 신청 시스템을 이미 쓰고 있을 가능성(명칭·가격 조사하지 못함)', s: 'un' }, { t: '변호사용 법률 AI 업체가 법무사까지 넓힐지(확인하지 못함)', s: 'un' }],
      pro: ['사무원까지 같은 계정 구조로 묶는 시장(약 15,756명) — 직원이 많은 사무소일수록 단가 대비 효과가 큼(추정)', '등기·서류 작성처럼 반복되는 업무가 많아 자동화 여지가 큼(추정)'],
      con: ['양쪽 위임 금지·소송 관여 금지 같은 업무 경계 때문에 AI가 할 수 있는 범위가 좁음', '이미 쓰는 업무 프로그램과 연동되지 않으면 이중 입력이 생김'],
      verdict: '기존 업무 프로그램을 대체하기보다 서류 초안·점검을 맡는 보완재로 자리 잡을 때 가격이 합리적입니다. 연동 범위가 도입 여부를 가릅니다.',
      todo: ['쓰고 있는 업무 프로그램의 명칭·월 이용료 조사', '대법원 전자 신청 연동 가능 범위 확인'] },
    'administrative-scrivener': { intensity: '중간(추정)', price: '가격에 민감할 가능성이 높음(추정)',
      land: [GENAI, { t: '엘박스가 행정사회와 협력(회원 대상 스탠다드 플랜 할인, 신규 개업자 무료 이용 검토)하는 움직임이 게시글에 나옴. 날짜·성사 여부는 확인하지 못함', s: 'ok', src: 6 }],
      pro: ['업무 종류가 다양하고 서류 중심이라 반복 업무 자동화 효과를 기대할 수 있음(추정)'],
      con: ['법률 AI 대형 업체가 같은 직역에 이미 접근 중이어서 선점 효과가 작음', '개업 인원이 공식 통계가 아니라 시장 규모 오차가 큼'],
      verdict: '엘박스의 할인 협약이 성사되면 연 99,000원 기본료의 가격 우위가 줄어듭니다. 행정사 업무에 특화된 기능이 가격보다 중요한 승부처입니다.',
      todo: ['엘박스–행정사회 협력의 실제 조건(할인율·기간) 확인', '행정사 업무별 자동화 가능 범위 조사'] },
    'lawyer': { intensity: '높음', price: '비교 기준이 명확함(엘박스)',
      land: [{ t: '엘박스가 국내 변호사의 약 70%가 이용한다고 밝힘. 고객사 1,600여 곳, 대법원·대검찰청에도 공급(회사 발표 기준)', s: 'ok', src: 1 },
             { t: '엘박스 스탠다드 플랜이 월 69,900원 상당(연 환산 838,800원, 할인·약정 미반영)', s: 'ok', src: 2 }, GENAI],
      pro: ['기본료만 보면 엘박스 월 요금의 1/8 수준(하한 가정)으로 진입 부담이 작음', '법률 외 서류·세무·행정을 한 계정에서 쓰는 통합 구조를 내세울 수 있음(나비웹의 주장이며 검증 전)'],
      con: ['판결문 데이터·사용자 기반에서 선두 업체와 격차가 큼. 나비웹의 판결문 데이터 규모는 이 조사에서 확인하지 못함', '30%를 넘는 점유율은 엘박스 이용자 상당수가 중복 가입하거나 옮겨 온다는 전제가 필요함', '변호사법 제34조와 변호사 아닌 자가 지배하는 법인의 주식 취득·배당 쟁점이 먼저 정리돼야 함'],
      verdict: '가격만으로 이길 수 있는 시장이 아닙니다. 판례 검색이 아닌 사건 수임·서류 작성·사무 자동화 같은 보완 기능으로 엘박스와 같이 쓰는 도구가 되는 것이 합리적인 목표입니다.',
      todo: ['엘박스 연 약정·단체 할인 조건 확인', '나비웹 법률 데이터 규모와 정확도 검증', '대한변호사협회 입장 확인'] },
    'tax-accounting': { intensity: '높음(추정)', price: '기존 업무 시스템 비용에 얹히는 구조(추정)',
      land: [GENAI, { t: '더존비즈온·한국세무사회 세무사랑 같은 기존 업무 시스템이 자리 잡고 있을 가능성(AI 기능과 가격은 조사하지 못함)', s: 'un' }],
      pro: ['시장이 약 35,000명으로 커서 같은 점유율이면 변호사보다 회원이 많음', '신고 자료 정리·검토처럼 반복 업무가 많음(추정)'],
      con: ['기존 시스템에 이미 묶여 있어 갈아타는 비용이 큼(추정)', '세무 신고 자동 제출은 의도적으로 제외돼 있어 자동화의 핵심 구간이 빠짐', '세무대리 오인 광고 금지·명의대여 금지·외부감사 독립성 쟁점이 있음'],
      verdict: '기존 시스템과 연동되지 않으면 추가 비용으로만 느껴질 수 있습니다. 연동 또는 기존 시스템과 병행하는 보조 도구라는 위치가 가격을 정당화합니다.',
      todo: ['기존 세무·회계 프로그램의 AI 기능과 요금 조사', '회계사·세무사 시장 규모 재확인(블로그 추정)'] },
    'patent-attorney': { intensity: '중간(추정)', price: '시장이 작아 단가 의존도가 큼',
      land: [GENAI, { t: '특허청 KIPRIS 같은 공공 무료 검색과 유료 특허 DB·AI 서비스가 있을 가능성(이번 조사에서 확인하지 못함)', s: 'un' }],
      pro: ['명세서·청구항 작성은 문서 품질이 곧 성과라 AI 보조의 가치를 인정받기 쉬움(추정)'],
      con: ['시장이 약 4,800명으로 작아 고정비를 덮는 데 시장의 큰 비중이 필요함(요금·매출 탭의 손익분기 참고)', '제출·수수료 납부의 자동 실행, 비변리사와의 제휴 금지 쟁점이 있음'],
      verdict: '회원이 적어 종량제 비중이 높아야 성립하는 구조입니다. 종량제 근거가 약한 현재는 소형 직역일수록 불확실성이 큽니다.',
      todo: ['유료 특허 DB·AI 서비스 가격 조사', '변리사법 제7조의2·제7조의3 내용 확인'] },
    'appraiser': { intensity: '낮음~중간(추정)', price: '시장이 작아 단가 의존도가 큼',
      land: [GENAI, { t: '감정평가 업무용 소프트웨어·데이터 서비스(이번 조사에서 확인하지 못함)', s: 'un' }],
      pro: ['평가서 작성·사례 검색 같은 반복 업무에 쓸 수 있음(추정)', '연 신규 최소 약 180명으로 새 이용자가 꾸준히 유입됨'],
      con: ['시장이 약 5,000명으로 작음', '"감정평가" 명칭 사용 제한, 명의 대여 금지, 소속 제한 쟁점'],
      verdict: '소형 직역이라 점유율이 낮을 때는 손익분기도 어렵습니다. 법인 단독 운영보다 다른 직역과 비용을 나누는 구조가 필요할 수 있습니다.',
      todo: ['평가서 작성 소프트웨어와 데이터 서비스 가격 조사', '개업·법인 소속 구분이 포함된 시장 규모 확인'] },
    'physician': { intensity: '중간(추정)', price: '의료기록 프로그램(EMR) 비용과 비교될 가능성(추정)',
      land: [GENAI, { t: 'EMR 업체가 AI 진료기록 자동화 기능을 내놓는 흐름(헤드라인 수준으로만 확인, 상세·가격은 조사하지 못함)', s: 'un' }],
      pro: ['시장이 약 118,000명으로 가장 커서 점유율 1%p의 규모가 큼', '진료 외 행정·서류 업무에서 효과를 기대할 수 있음(추정)'],
      con: ['환자 정보 처리와 소프트웨어 의료기기 해당 여부가 풀리지 않으면 핵심 기능이 제한됨', '환자 유인·알선 금지와 의료광고 규제', '기존 EMR과 연동하지 않으면 도입이 어려움(추정)'],
      verdict: '시장이 큰 만큼 규제 판단이 곧 사업 가능 여부입니다. 진료 판단이 아닌 사무·서류 보조로 범위를 좁힐 때 가격이 합리적입니다.',
      todo: ['소프트웨어 의료기기 해당 여부 검토', 'EMR 업체의 AI 기능·요금 조사'] },
    'real-estate-agent': { intensity: '중간(추정)', price: '가격에 가장 민감한 직역 중 하나(추정)',
      land: [GENAI, { t: '협회·포털이 제공하는 매물·중개 업무 프로그램(이번 조사에서 확인하지 못함)', s: 'un' }],
      pro: ['시장이 약 109,616명으로 크고 서류·계약서 작성 수요가 있음(추정)'],
      con: ['폐업이 개업을 웃돌아 시장이 줄고 있어 잠재 가입자가 계속 감소할 수 있음', '중개보수 한도가 있어 비용 부담에 민감함(추정)', '중개보수 한도와 금지 행위 쟁점'],
      verdict: '시장이 줄어드는 직역이라 점유율을 올려도 절대 회원 수가 줄 수 있습니다. 기본료 중심의 낮은 가격이 아니면 도입이 어렵습니다.',
      todo: ['중개 업무 프로그램의 요금 조사', '최근 개업·폐업 추이 반영'] },
    'pharmacist': { intensity: '높음(무료 기본 SW)', price: '무료 청구 프로그램이 기준선',
      land: [{ t: '대한약사회가 배포하는 청구 프로그램(팜IT3000 등)은 무료이고, 2023-03 보도 기준 점유율 약 45%, 유팜 약 35%, 이팜 약 9%', s: 'ok', src: 3 },
             { t: '약사회 배포 청구 프로그램이 약국 약 1만 곳에서 무료로 쓰인다는 2021년 보도', s: 'ok', src: 4 }, GENAI],
      pro: ['약국마다 쓰는 기본 SW가 이미 있어 AI는 상담·복약 지도·재고 같은 부가 기능으로 구분하기 쉬움(추정)'],
      con: ['기본 SW가 무료인 관행 때문에 유료 구독에 대한 저항이 클 가능성이 큼(추정)', '환자 정보 처리, 소프트웨어 의료기기 해당 여부, 약국 개설·의약품 광고 쟁점', '시장 규모(약 41,000명)는 약국 수와 달리 근무 약사 수 기준임'],
      verdict: '무료 SW가 기준선이므로 기본료 연 99,000원 자체가 부담이 될 수 있습니다. 청구와 겹치지 않는 부가 기능으로 한정하고 종량제를 최소화해야 합리적입니다.',
      todo: ['약사용 AI 서비스 요금 조사', '약국 수·근무 약사 수 기준 정리'] },
    'traditional-medicine-doctor': { intensity: '낮음~중간(추정)', price: '의료기록 프로그램 비용과 비교될 가능성(추정)',
      land: [GENAI, { t: '한의원 EMR·청구 프로그램(이번 조사에서 확인하지 못함)', s: 'un' }],
      pro: ['시장이 약 22,000명으로 중간 규모이고 AI 서비스 경쟁이 상대적으로 적을 것으로 추정'],
      con: ['환자 정보 처리, 소프트웨어 의료기기 해당 여부, 환자 유인·알선 금지, 의료광고 쟁점', '직역 특화 데이터(한방 진료·청구)를 갖추었는지 검증되지 않음'],
      verdict: '경쟁은 약할 수 있지만 직역 특화 기능이 검증되지 않으면 범용 AI 구독과 구분하기 어렵습니다.',
      todo: ['한의원 프로그램과 AI 기능 요금 조사', '한방 진료·청구 특화 데이터 검증'] }
  };
  var selComp = 'lawyer';
  function badge(s) { return s === 'ok' ? '<span class="ebp-badge ok">출처 확인</span>' : '<span class="ebp-badge un">미확인·추정</span>'; }

  function pageCompetition() {
    var BM_LBOX = 69900 * 12, BM_AI = 20 * 12 * FX;
    var rows = M.PRESETS.filter(function (p) { return p.id !== 'docraw'; }).map(function (p) {
      var a = M.merge(M.DEFAULTS, p.params), g = M.payPerMemberGross(a);
      return { label: '나비웹 · ' + p.label + (p.id === 'floor' ? '(기본료만)' : (p.id === 'docrev' ? '(종량제 10배)' : '')), v: g, own: true, sub: '연 ' + I(g) + '원 · 월 약 ' + I(g / 12) + '원' };
    }).concat([
      { label: '범용 생성형 AI 구독(월 약 $20)', v: BM_AI, own: false, sub: '연 $240 ≈ ' + I(BM_AI) + '원(환율 ' + I(FX) + '원/$ 가정) · 월 약 ' + I(BM_AI / 12) + '원' },
      { label: '엘박스 AI 스탠다드(변호사용)', v: BM_LBOX, own: false, sub: '월 69,900원 상당 × 12 = ' + I(BM_LBOX) + '원(할인·약정 미반영)' }
    ]);
    var maxV = Math.max.apply(null, rows.map(function (r) { return r.v; }));
    var bars = rows.map(function (r) {
      return '<tr><td class="wrap"><b>' + esc(r.label) + '</b></td><td style="min-width:260px"><span class="ebp-bar" style="width:' + Math.max(3, Math.round(r.v / maxV * 220)) + 'px;background:' + (r.own ? '#f0b429' : '#94a3b8') + '"></span></td><td class="wrap">' + esc(r.sub) + '</td></tr>';
    }).join('');
    var docV = M.payPerMemberGross(M.merge(M.DEFAULTS, { meterMultiple: 10 }));
    var opts = M.PROFESSIONS.map(function (p) { return '<option value="' + p.id + '"' + (p.id === selComp ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('');
    var sum = M.PROFESSIONS.map(function (p) {
      var c = COMP[p.id];
      return '<tr><td><b>' + esc(p.name) + '</b></td><td class="num">' + I(p.market) + '명</td><td>' + esc(c.intensity) + '</td><td class="wrap">' + esc(c.price) + '</td></tr>';
    }).join('');
    var srcList = Object.keys(SRC).map(function (k) { return '<li>[' + k + '] ' + esc(SRC[k].t) + ' — <a href="' + esc(SRC[k].u) + '" target="_blank" rel="noopener noreferrer">' + esc(SRC[k].u) + '</a></li>'; }).join('');

    var guideComp = '<section class="ebp-card ebp-guide"><h2>먼저 쉽게 이해하기</h2>' +
      '<p class="lead">이 페이지는 <b>“비슷한 일을 해 주는 다른 서비스가 이미 있는데, 나비웹은 값과 서비스로 경쟁할 만한가?”</b>를 살펴봅니다.</p>' +
      '<p>새 식당을 열기 전에 근처 식당들의 메뉴와 가격부터 보는 것과 같습니다. 손님 입장에서는 “이미 쓰는 서비스보다 싸거나 더 편해야” 옮길 이유가 생깁니다.</p>' +
      story('<b>가격을 한마디로 줄이면</b> — 기본료만 받는다면 연 99,000원(월 약 ' + I(99000 / 12) + '원)으로, 범용 AI 구독(월 약 ' + I(BM_AI / 12) + '원)의 약 <b>' + P(99000 / BM_AI, 0) + '</b>이고 변호사용 법률 AI(월 69,900원 상당)의 약 <b>' + P(99000 / BM_LBOX, 0) + '</b>입니다. 하지만 종량제까지 문서 기준으로 더하면 연 약 ' + I(docV) + '원(월 약 ' + I(docV / 12) + '원)이 되어 <b>범용 AI 구독과 비슷한 값</b>이 됩니다. 값이 싼지는 종량제를 얼마로 정하느냐에 달려 있습니다.') +
      '<p><b>그래프 읽는 법</b> — 노란 막대는 나비웹, 회색 막대는 다른 서비스입니다. <b>막대가 짧을수록 1년에 내는 돈이 적습니다.</b></p>' +
      glossBox('이 페이지에 나오는 말', [
        ['대체재', '같은 일을 대신해 주는 서비스입니다. 예를 들어 범용 AI 구독은 거의 모든 직업의 대체재가 됩니다.'],
        ['보완재', '기존 서비스와 <b>함께 쓰면 더 좋아지는</b> 서비스입니다. 경쟁하기보다 같이 쓰이는 길을 찾는 것이 합리적일 때가 많습니다.'],
        ['갈아타기 비용', '이미 익숙한 프로그램에서 새 프로그램으로 옮길 때 드는 수고와 위험입니다. 클수록 새 서비스가 파고들기 어렵습니다.'],
        ['경쟁 강도', '비슷한 서비스가 얼마나 많고 강한지입니다. 이 페이지의 등급은 조사자의 <b>추정</b>이며 확정이 아닙니다.'],
        ['종량제의 불확실성', '쓴 만큼 내는 요금은 <b>한 해에 얼마가 나올지 미리 알기 어렵습니다.</b> 전문직 이용자는 예측 가능한 정액 요금을 선호하는 경우가 많습니다.'],
        ['출처 확인 / 미확인·추정', '<span class="ebp-badge ok">출처 확인</span>은 기사 등 출처로 확인한 사실, <span class="ebp-badge un">미확인·추정</span>은 확인하지 못했거나 추정한 내용입니다. 후자는 가격이나 기능을 단정하지 않았습니다.']
      ]) + roadmap(4) + '</section>';
    root.innerHTML = BANNER + guideComp +
      '<section class="ebp-card"><h2>가격 경쟁력 총평</h2>' +
      '<p class="ebp-hint">회원 1인이 1년에 내는 금액(부가세 포함)을 비교합니다. 비교 대상은 이번에 출처를 확인한 것만 넣었습니다.</p>' +
      readme('한 줄이 하나의 서비스입니다. 가운데 막대의 길이가 <b>회원 한 명이 1년에 내는 돈(부가세 포함)</b>이고, 오른쪽에 연 금액과 월 환산 금액을 적었습니다. 나비웹 줄은 가정(하한·보수·문서 매출)에 따라 세 가지로 나눠 보여 줍니다.') +
      '<div class="ebp-tw"><table class="ebp-table"><thead><tr><th>서비스</th><th>연 부담액</th><th>설명</th></tr></thead><tbody>' + bars + '</tbody></table></div>' +
      '<div class="ebp-two">' +
        '<div class="ebp-box"><h4>읽는 법</h4><ul>' +
          '<li><b>기본료만(하한)</b>이면 연 99,000원으로 범용 AI 구독의 약 ' + P(99000 / BM_AI, 0) + ', 엘박스 연 환산의 약 ' + P(99000 / BM_LBOX, 0) + '입니다. 가격 우위가 뚜렷합니다.</li>' +
          '<li><b>종량제 10배(문서 기준)</b>까지 더하면 연 약 ' + I(docV) + '원으로 범용 AI 구독과 비슷해지고(' + P(docV / BM_AI, 0) + '), 가격 우위가 사라집니다.</li>' +
        '</ul></div>' +
        '<div class="ebp-box"><h4>분석 의견(추정)</h4><ul>' +
          '<li>관리자 문서의 매출은 종량제가 약 72%라서 <b>회원이 실제로 내는 금액이 사용량에 따라 크게 달라집니다.</b> 예측하기 어려운 요금은 전문직이 가입을 망설이는 이유가 됩니다.</li>' +
          '<li>종량제에 월 상한을 두거나 사용량 구간별 정액제로 바꾸면 예측이 쉬워지지만, 문서 기준 매출 가정은 줄어듭니다.</li>' +
        '</ul></div>' +
      '</div></section>' +
      '<section class="ebp-card"><h2>직역별 서비스·가격 경쟁력 보고서</h2>' +
      '<p class="ebp-hint">직역을 고르면 그 직업의 <b>경쟁 서비스, 가격 비교, 강점과 약점, 먼저 확인할 법적 쟁점, 종합 의견</b>이 차례로 나옵니다. “다음에 확인할 것”은 아직 조사가 필요한 숙제입니다.</p>' +
      '<div class="ebp-row"><div class="ebp-field"><label for="ebpComp">직역</label><select id="ebpComp">' + opts + '</select></div></div>' +
      '<div id="ebpCompBody"></div></section>' +
      '<section class="ebp-card"><h2>직역별 한눈에 보기</h2><p class="ebp-hint">경쟁 강도와 가격 민감도는 이 보고서 작성 시점의 <b>분석 의견(추정)</b>입니다.</p>' +
      readme('직역마다 <b>시장 규모</b>, 비슷한 서비스가 얼마나 강한지(<b>경쟁 강도</b>), 가격을 비교할 때 무엇을 기준으로 삼아야 하는지(<b>가격 기준선</b>)를 한 줄로 요약했습니다.') +
      '<div class="ebp-tw"><table class="ebp-table"><thead><tr><th>직역</th><th class="num">시장 규모</th><th>경쟁 강도</th><th class="wrap">가격 기준선</th></tr></thead><tbody>' + sum + '</tbody></table></div></section>' +
      '<div class="ebp-caution" role="note"><b>이 보고서의 한계</b><ul>' +
        '<li><span class="ebp-badge ok">출처 확인</span>은 아래 출처에서 확인한 사실이고, <span class="ebp-badge un">미확인·추정</span>은 이번에 확인하지 못했거나 추정한 내용입니다. 후자는 가격·기능을 단정하지 않았습니다.</li>' +
        '<li>엘박스의 이용률(약 70%)은 회사 발표를 옮긴 보도이며 독립적으로 검증되지 않았습니다. 이용자가 여러 서비스를 함께 쓰는 중복 이용도 있을 수 있습니다.</li>' +
        '<li>법적 쟁점은 제안서의 "직능별로 가장 먼저 확인할 쟁점"을 옮긴 것이며 법적 판단이 아닙니다.</li></ul></div>' +
      '<section class="ebp-card"><h2>출처</h2><ul class="ebp-src">' + srcList + '</ul></section>';

    function drawComp() {
      var p = M.findProfession(selComp), c = COMP[selComp];
      var aDoc = M.merge(M.DEFAULTS, { meterMultiple: 10 });
      var land = c.land.map(function (l) { return '<li>' + badge(l.s) + esc(l.t) + (l.src ? ' <span class="ebp-src">[' + l.src + ']</span>' : '') + '</li>'; }).join('');
      var li = function (arr) { return arr.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join(''); };
      var cmp = '';
      if (selComp === 'lawyer') {
        cmp = '<p><b>가격 비교</b> — 엘박스 연 환산 ' + I(BM_LBOX) + '원 대비 나비웹은 기본료만이면 ' + P(99000 / BM_LBOX, 0) + ', 종량제 문서 기준이면 ' + P(M.payPerMemberGross(aDoc) / BM_LBOX, 0) + '입니다.</p>';
      } else {
        cmp = '<p><b>가격 비교</b> — 이 직역의 직접 경쟁 서비스 요금은 확인하지 못했습니다. 비교 가능한 기준은 범용 AI 구독(연 약 ' + I(BM_AI) + '원)이며, 나비웹은 기본료만이면 ' + P(99000 / BM_AI, 0) + ', 종량제 문서 기준이면 ' + P(M.payPerMemberGross(aDoc) / BM_AI, 0) + '입니다.</p>';
      }
      var r10 = M.compute(p, 0.10, { meterMultiple: 0 });
      document.getElementById('ebpCompBody').innerHTML =
        '<div class="ebp-kpis">' +
          '<div class="ebp-kpi"><div class="k">시장 규모</div><div class="v">' + I(p.market) + '명</div><div class="s">' + (p.trend ? esc(p.trend) : '추세 자료 없음') + '</div></div>' +
          '<div class="ebp-kpi"><div class="k">경쟁 강도(추정)</div><div class="v" style="font-size:18px">' + esc(c.intensity) + '</div></div>' +
          '<div class="ebp-kpi"><div class="k">점유율 10%·하한 가정 영업이익</div><div class="v" style="font-size:18px">' + W(r10.operatingProfit) + '</div><div class="s">회원 ' + I(r10.members) + '명 · 시나리오 탭에서 변경</div></div>' +
        '</div>' +
        '<h3>대체재와 경쟁 서비스</h3><ul class="ebp-list" style="list-style:none;margin-left:0">' + land + '</ul>' + cmp +
        '<div class="ebp-two"><div class="ebp-box"><h4>강점</h4><ul>' + li(c.pro) + '</ul></div><div class="ebp-box"><h4>약점·위험</h4><ul>' + li(c.con) + '</ul></div></div>' +
        '<h3>가장 먼저 확인할 쟁점</h3><p>' + esc(p.firstIssue) + '</p>' +
        '<h3>종합 의견(추정)</h3><p>' + esc(c.verdict) + '</p>' +
        '<h3>다음에 확인할 것</h3><ul class="ebp-list">' + li(c.todo) + '</ul>';
    }
    drawComp();
    document.getElementById('ebpComp').addEventListener('change', function (e) { selComp = e.target.value; drawComp(); });
  }

  var PAGES = { subscribers: pageSubscribers, pricing: pagePricing, scenarios: pageScenarios, competition: pageCompetition };
  if (PAGES[PAGE]) PAGES[PAGE]();
})();
