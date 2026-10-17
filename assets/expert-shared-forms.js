/* expert-shared-forms.js — 전문가 페이지의 "이용자가 알려 준 서식" 게시 (2026-10-15, 주피터 지시)
   직역 페이지(/pages/<직역id>.html)에 붙여 쓴다. 이용자가 전문가 채팅에서 첨부·대화로 알려 주고 저장에 동의한 빈 서식이
   서식 DB(/doc-form/list?persona=<직역id>)에 쌓이면 이 목록에 나타나고, 다른 이용자가 그 서식으로 작성을 시작할 수 있다.
   직역 id 는 페이지 파일 이름(예: /pages/dentist.html → dentist)이다. 상위 직역(lawyer)은 하위(lawyer-*) 서식을 함께 보여 준다.
   서식 본문은 내려받지 않는다(목록만) — 작성은 전문가 채팅이 서식 DB에서 직접 조회한다. */
(function () {
  var WORKER = 'https://hondi-proxy.tensor-city.workers.dev';
  var m = location.pathname.match(/\/pages\/([a-z0-9-]+)\.html$/i);
  if (!m) return;
  var persona = m[1];
  var STATUS = { user_provided: '이용자 제공 · 공식 확인 전', reviewed: '운영자 검토', official_verified: '공식 확인' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var NEW_MS = 7 * 24 * 60 * 60 * 1000;
  function statsText(s) { return s && s.count ? '★' + s.avg + ' · ' + s.count + '명 평가' : '평가 모으는 중'; }

  function render(forms, stats) {
    stats = stats || {};
    var host = document.getElementById('sharedForms');
    if (!host) {
      host = document.createElement('div'); host.id = 'sharedForms';
      var footer = document.querySelector('.ug-footer');
      (footer && footer.parentNode ? footer.parentNode : document.body).insertBefore(host, footer || null);
    }
    var chat = '/pages/expert-chat.html?persona=' + encodeURIComponent(persona);
    var rows = forms.map(function (f) {
      var isNew = f.ts && (Date.now() - f.ts) < NEW_MS;
      return '<tr><td class="doc-title">' + esc(f.name) +
        (isNew ? ' <span style="font-size:11px;font-weight:600;color:#fff;background:#2563eb;border-radius:6px;padding:1px 6px;margin-left:4px">새 서식</span>' : '') +
        '<br><span style="font-size:12px;font-weight:400;color:#6b7280">' + esc(statsText(stats[f.keyHash + ':' + f.version])) + '</span>' +
        '</td><td class="doc-detail">' + esc(f.agency) +
        (f.formNo ? ' · ' + esc(f.formNo) : '') + '</td><td class="doc-detail">' + esc(STATUS[f.status] || f.status) +
        '</td><td class="doc-detail">' + esc(f.versionDate || '') + '</td></tr>';
    }).join('');
    host.innerHTML = '<div class="svc-content" style="margin-top:24px"><div class="svc-detail"><h2>이용자가 알려 준 서식</h2>' +
      '<p class="svc-lead">이 직역의 서류 양식은 이용자가 전문가 채팅에서 첨부하거나 말로 알려 주신 것이 쌓여 만들어집니다. ' +
      '개인정보를 뺀 빈 서식만 게시되며, 공식 확인 전 서식은 제출 전에 해당 기관 양식과 대조하십시오.</p>' +
      (forms.length
        ? '<div class="svc-table-wrap"><table class="svc-table"><thead><tr><th>서식</th><th>기관·번호</th><th>상태</th><th>기준일</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
          '<p class="svc-lead" style="margin-top:12px">원하는 서식 이름을 <a href="' + chat + '">전문가 채팅</a>에서 말씀하시면 이 서식으로 작성을 시작합니다. 써 본 뒤에는 채팅에서 점수를 남겨 주세요 — 다음 이용자가 서식을 고르는 데 쓰입니다.</p>' +
          '<p class="svc-lead" style="margin-top:4px">서식을 처음 올린 이용자가 다른 이용자 5명 이상에게 높은 평가를 받으면 GDC 보상이 지급될 수 있습니다(운영 정책에 따라 지급 여부·금액이 정해지며, 이미 있던 서식과 AI가 구성한 서식은 대상이 아닙니다).</p>'
        : '<p class="svc-lead">아직 알려 주신 서식이 없습니다. <a href="' + chat + '">전문가 채팅</a>에서 서식 파일을 첨부하거나 사진을 찍어 알려 주시면, 동의하신 경우 빈 서식이 이곳에 게시되어 다른 이용자도 쓸 수 있습니다.</p>') +
      '</div></div>';
  }

  fetch(WORKER + '/doc-form/list?persona=' + encodeURIComponent(persona))
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (!(j && j.ok && Array.isArray(j.forms))) return;
      render(j.forms);                                   // 목록을 먼저 보여 주고, 평가 집계는 도착하면 다시 그린다(실패해도 목록은 그대로)
      var keys = j.forms.slice(0, 20).map(function (f) { return f.keyHash + ':' + f.version; }).join(',');
      if (!keys) return;
      fetch(WORKER + '/doc-form/stats?keys=' + encodeURIComponent(keys))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (s) { if (s && s.ok) render(j.forms, s.stats); })
        .catch(function () {});
    })
    .catch(function () { /* 게시 목록은 부가 기능 — 실패해도 페이지는 그대로 */ });
})();
