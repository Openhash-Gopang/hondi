// 면허 인증 프런트 연결 패치 (2026-10-21, 계획 W1-6): chat-widget.js(pro_session 첨부·차단 안내), admin.html(승인 화면), worker.js(관리자 Bearer 인증).
// 앵커 기준 제자리 삽입 — 파일을 통째로 바꾸지 않으므로 다른 세션의 변경과 충돌하지 않는다. 파일별로 한 번만 적용된다.
// 전제: #724(apply-pro-verify-worker-patch) 적용됨. 사용: node scripts/apply-pro-verify-frontend-patch.mjs   (저장소 루트에서)
import fs from 'node:fs';

function patch(file, marker, steps) {
  let s = fs.readFileSync(file, 'utf8');
  if (s.includes(marker)) { console.log(`${file}: 이미 적용됨`); return; }
  for (const [kind, anchor, text] of steps) {
    const n = s.split(anchor).length - 1;
    if (n !== 1) { console.error(`${file}: 앵커가 ${n}번 나타남(1번이어야 함): ${anchor.slice(0, 80)}`); process.exit(1); }
    s = kind === 'before' ? s.replace(anchor, () => text + anchor) : kind === 'after' ? s.replace(anchor, () => anchor + text) : s.replace(anchor, () => text);
  }
  fs.writeFileSync(file, s);
  console.log(`${file}: 적용 완료`);
}

// ── worker.js: 관리자 페이지 Bearer 토큰으로도 /pro-verify 운영 호출 허용 ──
patch('worker.js', 'bearerAdmin:', [
  ['after', "    store: makePocketBaseProVerifyStore({ base: L1_DEFAULT, getToken: () => _l1AdminToken(env) }),\n",
   "    bearerAdmin: async (req, e) => (await _requireAdmin(req, e))?.admin || null,   // 관리자 페이지(admin.html)의 Bearer 로그인으로 승인·열람\n"],
]);

// ── assets/chat-widget.js ──
patch('assets/chat-widget.js', '_isProSp', [
  ['before', "  // ── SP 로딩 (desktop.html _loadVisitorSP과 동일 패턴",
`  // ── 전문가용 SP 면허 인증 (2026-10-21) — 전문가용(-assistant) SP 를 쓰는 페이지는 인증 세션(pro_session)을 함께 보낸다. 서버: pro-gate.js
  function _isProSp(t) {
    t = String(t || '');
    if (/^# SP-[A-Z]+-[0-9A-Za-z-]+ · [^\\n]*보조 AI/m.test(t.slice(0, 600))) return true;
    return t.indexOf('scope_note: "{경계 영역일 때 범위 확인 사유}"') >= 0 && t.indexOf('law_checked: {조회한 법령·서식·기준과 조회일') >= 0;
  }
  var _proClientP = null;
  function _loadProClient() {
    if (window.HondiPro) return Promise.resolve();
    if (!_proClientP) _proClientP = new Promise(function (resolve) { var s = document.createElement('script'); s.src = '/assets/pro-verify.js'; s.onload = resolve; s.onerror = resolve; document.head.appendChild(s); });
    return _proClientP;
  }

`],
  ['before', "      var body = JSON.stringify({\n",
`      var _proSession = null;
      if (_isProSp(composedSP)) {
        try { await _loadProClient(); if (window.HondiPro) _proSession = await window.HondiPro.getSession(); } catch (eP) { console.warn('[chat-widget] 전문가 세션', eP); }
      }

`],
  ['after', "        system: composedSP,\n", "        pro_session: _proSession || undefined,\n"],
  ['replace', "      if (!res.ok) throw new Error('Worker ' + res.status);",
`      if (!res.ok) {
        if (window.HondiPro && await window.HondiPro.isBlocked(res)) throw new Error('PRO_BLOCKED');
        throw new Error('Worker ' + res.status);
      }`],
  ['replace', "      appendMsg('ai', '네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');",
`      if (err && err.message === 'PRO_BLOCKED') {
        appendMsg('ai', '전문가용 AI는 면허 인증이 승인된 전문가만 쓸 수 있습니다. 열린 창에서 인증을 신청해 주세요.');
        try { window.HondiPro.openPanel(); } catch (eO) {}
      } else appendMsg('ai', '네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');`],
]);

// ── admin.html: 전문가 면허 인증 승인 패널 ──
patch('admin.html', '_loadProVerifyList', [
  ['before', "      <!-- ①-d GDC 잔액 조정",
`      <!-- ①-e 전문가 면허 인증 승인 (2026-10-21 신설 — /pro-verify/pending·file·decide 연동)
           면허증 사본은 승인·반려 즉시 서버에서 삭제된다. 열람은 기록된다. -->
      <div style="border:1px solid var(--ad-line,#3c3f46);border-radius:0;padding:16px 18px;margin-bottom:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
          <div style="font-size:12px;color:var(--ad-faint,#6e737a);letter-spacing:.3px">전문가 면허 인증 — 승인 대기</div>
          <button onclick="_loadProVerifyList()" style="padding:5px 12px;background:var(--ad-panel2,#33363c);color:var(--ad-text,#d7d9dd);border:1px solid var(--ad-line-strong,#4a4e56);border-radius:0;font-size:11.5px;font-weight:500;cursor:pointer;font-family:inherit">새로고침</button>
        </div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:11.5px;min-width:640px">
            <thead><tr style="text-align:left;color:var(--ad-faint,#6e737a)">
              <th style="padding:0 8px 8px 0;font-weight:400">직역</th>
              <th style="padding:0 8px 8px 0;font-weight:400;width:70px">구분</th>
              <th style="padding:0 8px 8px 0;font-weight:400;width:110px">면허번호</th>
              <th style="padding:0 8px 8px 0;font-weight:400;width:120px">신청자</th>
              <th style="padding:0 8px 8px 0;font-weight:400;width:110px">신청 시각</th>
              <th style="padding:0 0 8px;width:200px"></th>
            </tr></thead>
            <tbody id="pv-body"></tbody>
          </table>
        </div>
        <div id="pv-empty" style="font-size:12.5px;color:var(--ad-faint,#6e737a);text-align:center;padding:18px">불러오는 중…</div>
      </div>

`],
  ['before', "async function _loadChargeList() {",
`// ── 전문가 면허 인증 승인 (2026-10-21) ──
async function _pvCall(path, body) {
  return fetch(\`\${WORKER_URL}\${path}\`, { method: 'POST', signal: AbortSignal.timeout(20000),
    headers: Object.assign({ 'Content-Type': 'application/json' }, _adminAuthHeaders()), body: JSON.stringify(body || {}) });
}
async function _loadProVerifyList() {
  const tbody = document.getElementById('pv-body'), empty = document.getElementById('pv-empty');
  if (!tbody || !empty) return;
  empty.style.display = 'block'; empty.textContent = '불러오는 중…'; tbody.innerHTML = '';
  try {
    const res = await _pvCall('/pro-verify/pending');
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || 'API_ERROR');
    if (!data.items.length) { empty.textContent = '승인 대기 중인 신청이 없습니다.'; return; }
    empty.style.display = 'none';
    tbody.innerHTML = data.items.map(r => {
      const when = r.ts ? new Date(r.ts).toLocaleString('ko-KR', {timeZone:'Asia/Seoul', month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'}) : '—';
      const id = _esc(String(r.id));
      return \`<tr style="border-top:1px solid var(--ad-line,#3c3f46)">
        <td style="padding:7px 8px 7px 0">\${_esc(String(r.persona))}</td>
        <td style="padding:7px 8px 7px 0">\${r.role === 'staff' ? '직원' : '전문가'}</td>
        <td style="padding:7px 8px 7px 0;font-family:var(--ad-mono)">\${_esc(String(r.license_no_masked))}</td>
        <td style="padding:7px 8px 7px 0;font-family:var(--ad-mono)">\${_esc(String(r.applicant))}…</td>
        <td style="padding:7px 8px 7px 0;color:var(--ad-faint,#6e737a);font-family:var(--ad-mono)">\${when}</td>
        <td style="padding:7px 0;white-space:nowrap">
          <button onclick="_pvView('\${id}')" \${r.has_file ? '' : 'disabled'} style="padding:3px 8px;font-size:11px;cursor:pointer">사본 보기</button>
          <button onclick="_pvDecide('\${id}','approve')" style="padding:3px 8px;font-size:11px;cursor:pointer">승인</button>
          <button onclick="_pvDecide('\${id}','reject')" style="padding:3px 8px;font-size:11px;cursor:pointer">반려</button>
        </td></tr>\`;
    }).join('');
  } catch (e) { empty.textContent = '불러오지 못했습니다: ' + e.message; }
}
async function _pvView(id) {
  try {
    const res = await _pvCall('/pro-verify/file', { id });
    if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.message || ('사본을 열 수 없습니다 (' + res.status + ')')); return; }
    const blob = await res.blob(), url = URL.createObjectURL(blob);
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px';
    ov.innerHTML = blob.type === 'application/pdf' ? \`<iframe src="\${url}" style="width:min(900px,95vw);height:92vh;background:#fff;border:0"></iframe>\` : \`<img src="\${url}" style="max-width:95vw;max-height:92vh;background:#fff">\`;
    ov.onclick = () => { URL.revokeObjectURL(url); ov.remove(); };
    document.body.appendChild(ov);
  } catch (e) { alert('사본을 열 수 없습니다: ' + e.message); }
}
async function _pvDecide(id, decision) {
  let note = '';
  if (decision === 'reject') { note = prompt('반려 사유를 입력하세요 (신청자에게 보입니다)'); if (!note) return; }
  else if (!confirm('면허증 사본을 확인했고 승인합니다. 승인하면 사본이 즉시 삭제됩니다.')) return;
  try {
    const res = await _pvCall('/pro-verify/decide', { id, decision, note });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) { alert(j.message || ('처리하지 못했습니다 (' + res.status + ')')); return; }
    _loadProVerifyList();
  } catch (e) { alert('처리하지 못했습니다: ' + e.message); }
}

`],
  ['after', "  _loadChargeList();\n", "  _loadProVerifyList();\n"],
]);
