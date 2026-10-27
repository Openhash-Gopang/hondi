/* gov-agency-proposal.js — 시·도 관련 기관 페이지(pages/gov-agency.html)의 「사업 제안」 버튼 (2026-10-27 신설)

   헤더 오른쪽(.topnav-right)에 「사업 제안」 버튼을 달고, 누르면 페이지 본문(.ug-doc)을 그 시·도의 나비 숫자 코드 테스트 제안서로 바꿔 보여 준다.
   다시 누르거나 「← 기관 페이지로」를 누르면 원래 본문으로 돌아온다. 주소 끝에 #proposal 을 붙여 바로 열 수도 있다.
   제안서 본문: assets/proposals/<slug>.html (조각 HTML, 이미지는 assets/proposals/img/). 제안서가 있는 시·도의 페이지에만 버튼이 생긴다.
   새 시·도를 추가하려면 PROPOSALS 에 slug 를 적고 assets/proposals/<slug>.html 을 만든다. */
(function () {
  'use strict';
  var PROPOSALS = { jeju: '제주특별자치도', busan: '부산광역시', ulsan: '울산광역시', gyeongnam: '경상남도', jeonnam: '전라남도', jeonbuk: '전북특별자치도', gyeonggi: '경기도', seoul: '서울특별시', chungnam: '충청남도', chungbuk: '충청북도', gangwon: '강원특별자치도', gyeongbuk: '경상북도' };
  var SLUG_ALIAS = { 'jeonnam-gwangju': 'jeonnam', jejusi: 'jeju', seogwipo: 'jeju' };
  var NOTES = { jeju: '제주도 나비 코드 보급 계획 · 초안(2026-10-12), 수치는 모두 가정' };
  var GROUP_SLUG = { '제주': 'jeju', '부산': 'busan', '울산': 'ulsan', '경남': 'gyeongnam', '서울': 'seoul', '경기': 'gyeonggi', '전북': 'jeonbuk', '전남광주': 'jeonnam', '전남': 'jeonnam', '충남': 'chungnam', '충북': 'chungbuk', '강원': 'gangwon', '경북': 'gyeongbuk' };

  var code = (new URLSearchParams(location.search).get('gov_code') || '').trim();
  var rec = (window.GOV_AGENCIES || {})[code] || null;

  function sidoSlug() {
    var parts = code.split(':');
    var second = SLUG_ALIAS[parts[1]] || parts[1];
    if (second && PROPOSALS[second]) return second;
    var first = rec && rec[1] ? String(rec[1]).split(/[\s·]/)[0] : '';
    return GROUP_SLUG[first] || null;
  }
  var slug = sidoSlug();
  if (!slug) return;

  function init() {
    var doc = document.querySelector('.ug-doc');
    var navRight = document.querySelector('.topnav-right');
    if (!doc) return;
    if (!navRight) { setTimeout(init, 60); return; }
    if (document.getElementById('proposalNavBtn')) return;

    var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/assets/proposals/proposal.css'; document.head.appendChild(css);
    var view = document.createElement('div');
    view.id = 'proposalView'; view.hidden = true;
    view.innerHTML = '<div class="pv-bar"><button type="button" class="pv-back">← 기관 페이지로</button><span class="pv-note">' + (NOTES[slug] || (PROPOSALS[slug] + ' 나비 숫자 코드 테스트 제안서 · 초안, 수치는 모두 가정')) + '</span></div><div id="proposalBody">불러오는 중…</div>';
    doc.parentNode.insertBefore(view, doc.nextSibling);

    var btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'proposalNavBtn'; btn.className = 'lr-nav-btn';
    btn.title = PROPOSALS[slug] + ' 사업 제안서를 이 페이지에서 봅니다';
    btn.textContent = '사업 제안';
    navRight.insertBefore(btn, navRight.firstChild);

    var loaded = false, open = false;
    function load() {
      if (loaded) return; loaded = true;
      fetch('/assets/proposals/' + slug + '.html', { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
        .then(function (t) { document.getElementById('proposalBody').innerHTML = t; })
        .catch(function () { loaded = false; document.getElementById('proposalBody').textContent = '제안서를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주십시오.'; });
    }
    function show(on) {
      open = on; view.hidden = !on; doc.style.display = on ? 'none' : '';
      btn.textContent = on ? '기관 페이지' : '사업 제안';
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (on) { load(); window.scrollTo(0, 0); }
      try { history.replaceState(null, '', location.pathname + location.search + (on ? '#proposal' : '')); } catch (e) {}
    }
    btn.addEventListener('click', function () { show(!open); });
    view.querySelector('.pv-back').addEventListener('click', function () { show(false); });
    if (location.hash === '#proposal') show(true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 0); }); else setTimeout(init, 0);
})();
