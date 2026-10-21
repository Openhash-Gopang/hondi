/* 전문가 면허 인증 클라이언트 (2026-10-21, 계획 W1-6) — window.HondiPro
 *
 *   needsSession(text)   이 SP 본문이 전문가용(-assistant)인가 (서버 게이트 pro-gate.js 와 같은 기준)
 *   getSession()         승인된 전문가의 세션 토큰(문자열) 또는 null. 지갑 서명이 필요하므로 성공한 토큰은 sessionStorage 에 두고,
 *                        실패(미인증 등)는 5분간 다시 묻지 않는다(생체인증 창이 반복해서 뜨지 않게).
 *   openPanel(persona?)  인증 신청·상태 창. 면허증 사본은 승인·반려 즉시 삭제된다는 안내를 함께 보인다.
 *   isBlocked(res)       /ai/chat 등의 응답이 전문가 인증 부족(401/403 PRO_*)이면 true — 호출부가 안내를 띄운다.
 *
 * 서버: worker.js /pro-verify/* (src/worker/pro-verify-handler.js). 서명 메시지는 서버의 *Message 함수와 글자까지 같아야 한다.
 */
(function () {
  'use strict';
  if (window.HondiPro) return;
  var WORKER = 'https://hondi-proxy.tensor-city.workers.dev';
  var SS_KEY = 'hondi_pro_session', FAIL_KEY = 'hondi_pro_session_fail';
  var enc = new TextEncoder();

  function ssGet(k) { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function ssDel(k) { try { sessionStorage.removeItem(k); } catch (e) {} }

  function meGuid() {
    try {
      var u = JSON.parse(localStorage.getItem('gopang_user_v4') || 'null');
      return u && !u.isGuest && !u.isTemp && u.ipv6 ? u.ipv6 : null;
    } catch (e) { return null; }
  }
  async function getWallet(guid) {
    var t0 = Date.now();
    while (window.gopangWallet === undefined && Date.now() - t0 < 2500) await new Promise(function (r) { setTimeout(r, 150); });
    var w = window.gopangWallet || null;
    if (!w && window.GopangWallet) {
      w = await window.GopangWallet.load();
      if (w) { try { w.setIdentity({ guid: guid }); } catch (e) {} window.gopangWallet = w; }
    }
    if (!w || typeof w.signPayload !== 'function') throw new Error('이 기기에서 지갑을 열 수 없습니다. 나비 앱에 로그인한 뒤 다시 시도해 주세요.');
    return w;
  }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  async function sha256Hex(data) { return hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data)); }
  function normLicenseNo(s) { return String(s || '').normalize('NFKC').replace(/[\s\-_.\/]/g, '').toUpperCase(); }

  // 서버 pro-verify-handler.js 와 동일해야 하는 서명 메시지
  function sessionMessage(ts) { return 'hondi-pro-verify\nsession\n' + ts; }
  function applyMessage(persona, role, licenseHash, fileSha, supGuid, ts) {
    return 'hondi-pro-verify\napply\n' + persona + '\n' + role + '\n' + licenseHash + '\n' + fileSha + '\n' + (supGuid || '') + '\n' + ts;
  }

  function licenseHash(persona, no) { return sha256Hex('hondi-license\n' + persona + '\n' + normLicenseNo(no)); }

  var SP_MARKS = ['scope_note: "{경계 영역일 때 범위 확인 사유}"', 'law_checked: {조회한 법령·서식·기준과 조회일'];
  function needsSession(text) {
    var t = String(text || '');
    if (/^# SP-[A-Z]+-[0-9A-Za-z-]+ · [^\n]*보조 AI/m.test(t.slice(0, 600))) return true;
    return SP_MARKS.every(function (m) { return t.indexOf(m) >= 0; });
  }

  async function getSession() {
    var c = ssGet(SS_KEY);
    if (c && c.token && c.exp - 60000 > Date.now()) return c.token;
    var f = ssGet(FAIL_KEY);
    if (f && Date.now() - f.ts < 5 * 60 * 1000) return null;
    var guid = meGuid();
    if (!guid) return null;
    try {
      var w = await getWallet(guid), ts = Date.now();
      var sig = await w.signPayload(sessionMessage(ts));
      var res = await fetch(WORKER + '/pro-verify/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guid: guid, ts: ts, sig: sig }) });
      var j = await res.json().catch(function () { return {}; });
      if (res.ok && j.token) { ssSet(SS_KEY, { token: j.token, exp: j.exp, personas: j.personas }); ssDel(FAIL_KEY); return j.token; }
      ssSet(FAIL_KEY, { ts: Date.now(), code: j.code || res.status });
      return null;
    } catch (e) {
      ssSet(FAIL_KEY, { ts: Date.now(), code: 'ERR' });
      return null;
    }
  }

  var lastBlockCode = null;
  async function isBlocked(res) {
    if (!res || (res.status !== 401 && res.status !== 402 && res.status !== 403)) return false;
    try {
      var j = await res.clone().json();
      var hit = j && (j.code === 'PRO_SESSION_REQUIRED' || j.code === 'PRO_PERSONA_MISMATCH' || j.code === 'PRO_SUBSCRIPTION_REQUIRED');
      if (hit) lastBlockCode = j.code;
      return !!hit;
    } catch (e) { return false; }
  }
  // 차단 사유에 맞는 안내 문구 — 구독 만료(402)와 인증 부족(401/403)을 구분한다.
  function blockMessage() {
    return lastBlockCode === 'PRO_SUBSCRIPTION_REQUIRED'
      ? '전문가용 AI 구독이 필요합니다. 체험 기간이 끝났거나 구독이 만료되었습니다. 열린 창에서 구독 상태를 확인해 주세요.'
      : '전문가용 AI는 면허 인증이 승인된 전문가만 쓸 수 있습니다. 열린 창에서 인증을 신청해 주세요.';
  }

  function pagePersona() {
    if (window.HONDI_PRO_PERSONA) return String(window.HONDI_PRO_PERSONA);
    var m = location.pathname.match(/\/([a-z][a-z0-9-]+)\.html$/);
    return m ? m[1] : '';
  }

  // ── 인증 신청·상태 창 ──
  var STATUS_KO = { pending: '승인 대기', approved: '승인됨', rejected: '반려', revoked: '철회', expired: '만료' };
  function el(tag, attrs, html) { var e = document.createElement(tag); for (var k in (attrs || {})) e.setAttribute(k, attrs[k]); if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var overlay = null;
  function closePanel() { if (overlay) { overlay.remove(); overlay = null; } }

  var SUB_NOTICE = {
    expired: '구독이 없거나 만료되었습니다. 이용하려면 구독이 필요합니다.',
    trial: '무료 체험 중입니다.', trial_ending: '무료 체험이 곧 끝납니다.',
    expiring_30: '구독이 30일 이내에 만료됩니다.', expiring_7: '구독이 7일 이내에 만료됩니다.',
  };
  async function loadSub(box, guid) {
    box.textContent = '';
    try {
      var r = await fetch(WORKER + '/pro-sub/status?guid=' + encodeURIComponent(guid));
      var j = await r.json();
      if (!j.ok) return;
      var line = '<b>이용 기간</b> — ';
      if (j.sub_until) line += '구독 ' + new Date(j.sub_until).toLocaleDateString('ko-KR') + '까지 (' + j.days_left + '일 남음)';
      else if (j.in_trial) line += '무료 체험 ' + new Date(j.trial_until).toLocaleDateString('ko-KR') + '까지 (' + j.days_left + '일 남음)';
      else line += '없음';
      var warn = j.notice && SUB_NOTICE[j.notice] ? '<div style="color:' + (j.notice === 'expired' || j.notice === 'expiring_7' || j.notice === 'trial_ending' ? '#b42318' : '#555') + ';margin-top:2px">' + SUB_NOTICE[j.notice] + '</div>' : '';
      var how = (j.notice === 'expired' || j.notice === 'expiring_7' || j.notice === 'expiring_30' || j.notice === 'trial_ending')
        ? '<div style="color:#555;margin-top:2px">구독료는 연 ' + Number(j.price || 99000).toLocaleString('ko-KR') + '원입니다. 입금 후 운영자가 확인하면 이용 기간이 늘어납니다. 입금 방법은 운영자에게 문의하세요.</div>' : '';
      box.innerHTML = '<div style="background:#f6f7f9;border-radius:6px;padding:8px 10px;margin-bottom:10px;font-size:12.5px">' + line + warn + how + '</div>';
    } catch (e) { /* 구독 정보를 못 불러와도 인증 화면은 동작한다 */ }
  }

  async function loadStatus(box, guid) {
    box.textContent = '인증 상태를 불러오는 중…';
    try {
      var res = await fetch(WORKER + '/pro-verify/status?guid=' + encodeURIComponent(guid));
      var j = await res.json();
      if (!j.ok) { box.textContent = '상태를 불러오지 못했습니다.'; return; }
      if (!j.items.length) { box.textContent = '신청 내역이 없습니다.'; return; }
      box.innerHTML = j.items.map(function (r) {
        var exp = r.expires_ts && r.status === 'approved' ? ' · ' + new Date(r.expires_ts).toLocaleDateString('ko-KR') + '까지' : '';
        var note = r.note ? ' · 사유: ' + esc(r.note) : '';
        return '<div style="padding:6px 0;border-top:1px solid #e3e5e8">' + esc(r.persona) + (r.role === 'staff' ? ' (직원)' : '') + ' — <b>' + (STATUS_KO[r.status] || esc(r.status)) + '</b>' + exp + note + '</div>';
      }).join('');
    } catch (e) { box.textContent = '상태를 불러오지 못했습니다.'; }
  }

  function openPanel(persona) {
    closePanel();
    var guid = meGuid();
    overlay = el('div', { style: 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;font-family:inherit' });
    var box = el('div', { role: 'dialog', 'aria-modal': 'true', style: 'background:#fff;color:#1b1d21;max-width:460px;width:100%;max-height:92vh;overflow:auto;padding:20px 22px;border-radius:10px;font-size:14px;line-height:1.55' });
    overlay.appendChild(box);
    overlay.addEventListener('click', function (ev) { if (ev.target === overlay) closePanel(); });
    if (!guid) {
      box.innerHTML = '<h3 style="margin:0 0 8px;font-size:16px">전문가 인증</h3><p>전문가용 AI는 로그인한 뒤 면허 인증을 거쳐 이용할 수 있습니다. 나비 앱에 로그인한 뒤 다시 열어 주세요.</p>';
      var cb = el('button', { type: 'button', style: 'margin-top:8px;padding:8px 14px' }, '닫기'); cb.onclick = closePanel; box.appendChild(cb);
      document.body.appendChild(overlay); return;
    }
    box.innerHTML =
      '<h3 style="margin:0 0 6px;font-size:16px">전문가 면허 인증</h3>' +
      '<p style="margin:0 0 10px;color:#555;font-size:13px">전문가용 AI는 면허가 확인된 전문가만 쓸 수 있습니다. 운영자가 면허증 사본을 확인해 승인합니다.</p>' +
      '<div style="background:#f3f6fb;border-radius:6px;padding:8px 10px;font-size:12.5px;margin-bottom:12px">면허증 사본은 승인 판단에만 쓰이며 <b>승인 또는 반려 즉시 삭제</b>됩니다. 서버에는 직역·면허번호 끝 4자리·승인일만 남습니다. 주민등록번호 등 불필요한 부분은 가리고 올려 주세요.</div>' +
      '<div id="hpv-sub"></div>' +
      '<div id="hpv-status" style="font-size:13px;margin-bottom:12px"></div>' +
      '<form id="hpv-form" autocomplete="off">' +
      '<label style="display:block;margin-bottom:8px">직역(페이지 기준)<input id="hpv-persona" required pattern="[a-z][a-z0-9\\-]{1,59}" style="display:block;width:100%;padding:7px;box-sizing:border-box"></label>' +
      '<label style="display:block;margin-bottom:8px">구분<select id="hpv-role" style="display:block;width:100%;padding:7px;box-sizing:border-box"><option value="professional">면허 소지 전문가</option><option value="staff">전문가의 직원</option></select></label>' +
      '<label id="hpv-sup-wrap" style="display:none;margin-bottom:8px">소속 전문가의 계정 ID(guid)<input id="hpv-sup" style="display:block;width:100%;padding:7px;box-sizing:border-box"></label>' +
      '<label style="display:block;margin-bottom:8px">면허(자격)번호<input id="hpv-lic" required minlength="3" maxlength="40" style="display:block;width:100%;padding:7px;box-sizing:border-box"></label>' +
      '<label style="display:block;margin-bottom:10px">면허증 사본 (JPG·PNG·WEBP·PDF, 5MB 이하)<input id="hpv-file" type="file" required accept="image/jpeg,image/png,image/webp,application/pdf" style="display:block;width:100%;margin-top:4px"></label>' +
      '<div id="hpv-msg" role="status" style="min-height:20px;font-size:13px;margin-bottom:8px"></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" id="hpv-close" style="padding:8px 14px">닫기</button><button type="submit" id="hpv-submit" style="padding:8px 14px;background:#1b1d21;color:#fff;border:0;border-radius:4px">신청</button></div>' +
      '</form>';
    document.body.appendChild(overlay);
    box.querySelector('#hpv-persona').value = persona || pagePersona();
    box.querySelector('#hpv-close').onclick = closePanel;
    box.querySelector('#hpv-role').onchange = function () { box.querySelector('#hpv-sup-wrap').style.display = this.value === 'staff' ? 'block' : 'none'; };
    loadStatus(box.querySelector('#hpv-status'), guid);
    loadSub(box.querySelector('#hpv-sub'), guid);

    box.querySelector('#hpv-form').onsubmit = async function (ev) {
      ev.preventDefault();
      var msg = box.querySelector('#hpv-msg'), btn = box.querySelector('#hpv-submit');
      var pers = box.querySelector('#hpv-persona').value.trim(), role = box.querySelector('#hpv-role').value;
      var lic = box.querySelector('#hpv-lic').value, sup = box.querySelector('#hpv-sup').value.trim();
      var file = box.querySelector('#hpv-file').files[0];
      if (!file) { msg.textContent = '면허증 사본을 선택해 주세요.'; return; }
      if (file.size > 5 * 1024 * 1024) { msg.textContent = '파일이 5MB를 넘습니다.'; return; }
      if (role === 'staff' && !sup) { msg.textContent = '소속 전문가의 계정 ID를 입력해 주세요.'; return; }
      btn.disabled = true; msg.style.color = '#333'; msg.textContent = '서명 중…';
      try {
        var bytes = new Uint8Array(await file.arrayBuffer());
        var fileSha = await sha256Hex(bytes);
        var licHash = await licenseHash(pers, lic);
        var ts = Date.now();
        var w = await getWallet(guid);
        var sig = await w.signPayload(applyMessage(pers, role, licHash, fileSha, role === 'staff' ? sup : '', ts));
        var fd = new FormData();
        fd.append('persona', pers); fd.append('role', role); fd.append('license_no', lic);
        fd.append('supervisor_guid', role === 'staff' ? sup : ''); fd.append('guid', guid); fd.append('ts', String(ts)); fd.append('sig', sig);
        fd.append('file', new Blob([bytes], { type: file.type }), file.name);
        msg.textContent = '전송 중…';
        var res = await fetch(WORKER + '/pro-verify/apply', { method: 'POST', body: fd });
        var j = await res.json().catch(function () { return {}; });
        if (res.ok && j.ok) {
          msg.style.color = '#0a7a3b'; msg.textContent = '신청했습니다. 운영자가 확인한 뒤 승인되면 전문가용 AI를 쓸 수 있습니다.';
          box.querySelector('#hpv-lic').value = ''; box.querySelector('#hpv-file').value = '';
          ssDel(FAIL_KEY); loadStatus(box.querySelector('#hpv-status'), guid);
        } else { msg.style.color = '#b42318'; msg.textContent = j.message || ('신청하지 못했습니다 (' + res.status + ')'); }
      } catch (e) { msg.style.color = '#b42318'; msg.textContent = e && e.message ? e.message : '신청하지 못했습니다.'; }
      btn.disabled = false;
    };
  }

  window.HondiPro = { needsSession: needsSession, getSession: getSession, openPanel: openPanel, isBlocked: isBlocked, blockMessage: blockMessage, _sessionMessage: sessionMessage, _applyMessage: applyMessage, _licenseHash: licenseHash };
})();
