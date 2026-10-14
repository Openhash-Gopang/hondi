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

  function render(forms) {
    var host = document.getElementById('sharedForms');
    if (!host) {
      host = document.createElement('div'); host.id = 'sharedForms';
      var footer = document.querySelector('.ug-footer');
      (footer && footer.parentNode ? footer.parentNode : document.body).insertBefore(host, footer || null);
    }
    var chat = '/pages/expert-chat.html?persona=' + encodeURIComponent(persona);
    var rows = forms.map(function (f) {
      return '<tr><td class="doc-title">' + esc(f.name) + '</td><td class="doc-detail">' + esc(f.agency) +
        (f.formNo ? ' · ' + esc(f.formNo) : '') + '</td><td class="doc-detail">' + esc(STATUS[f.status] || f.status) +
        '</td><td class="doc-detail">' + esc(f.versionDate || '') + '</td></tr>';
    }).join('');
    host.innerHTML = '<div class="svc-content" style="margin-top:24px"><div class="svc-detail"><h2>이용자가 알려 준 서식</h2>' +
      '<p class="svc-lead">이 직역의 서류 양식은 이용자가 전문가 채팅에서 첨부하거나 말로 알려 주신 것이 쌓여 만들어집니다. ' +
      '개인정보를 뺀 빈 서식만 게시되며, 공식 확인 전 서식은 제출 전에 해당 기관 양식과 대조하십시오.</p>' +
      (forms.length
        ? '<div class="svc-table-wrap"><table class="svc-table"><thead><tr><th>서식</th><th>기관·번호</th><th>상태</th><th>기준일</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
          '<p class="svc-lead" style="margin-top:12px">원하는 서식 이름을 <a href="' + chat + '">전문가 채팅</a>에서 말씀하시면 이 서식으로 작성을 시작합니다.</p>'
        : '<p class="svc-lead">아직 알려 주신 서식이 없습니다. <a href="' + chat + '">전문가 채팅</a>에서 서식 파일을 첨부하거나 사진을 찍어 알려 주시면, 동의하신 경우 빈 서식이 이곳에 게시되어 다른 이용자도 쓸 수 있습니다.</p>') +
      '</div></div>';
  }

  fetch(WORKER + '/doc-form/list?persona=' + encodeURIComponent(persona))
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { if (j && j.ok && Array.isArray(j.forms)) render(j.forms); })
    .catch(function () { /* 게시 목록은 부가 기능 — 실패해도 페이지는 그대로 */ });
})();
