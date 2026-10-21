// 전문가용 AI 구독(W5) 연결 패치 (2026-10-21): worker.js(구독 API·세션에 구독 반영), admin.html(구독 부여·환불·만료 임박 패널),
// chat-widget.js·expert-chat.html(차단 사유별 안내 문구). 앵커 기준 제자리 삽입 — 다른 세션의 변경과 충돌하지 않는다. 파일별로 한 번만 적용된다.
// 전제: 면허 인증(#724)·게이트·프런트(#728) 적용됨. 사용: node scripts/apply-pro-sub-patch.mjs   (저장소 루트에서)
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

// ── worker.js ──
patch('worker.js', 'handleProSubRoutes', [
  ['after', "import { makePocketBaseProVerifyStore } from './src/worker/pro-verify-store.js';\n",
   "import { makeProSubHandler } from './src/worker/pro-sub-handler.js';\nimport { makePocketBaseProSubStore } from './src/worker/pro-sub-store.js';\n"],
  // 세션 발급 시 구독·체험 만료 시각을 토큰에 싣는다
  ['after', "    store: makePocketBaseProVerifyStore({ base: L1_DEFAULT, getToken: () => _l1AdminToken(env) }),\n",
   "    subStore: makePocketBaseProSubStore({ base: L1_DEFAULT, getToken: () => _l1AdminToken(env) }),\n"],
  ['before', "// ── 나비 서식 DB(2026-10-14 신설)",
`// ── 전문가용 AI 구독(2026-10-21 신설, W5) — 수동 입금 확인 후 관리자 부여·환불. 접근권만 다루고 사용량은 GDC 종량 과금이 따로 한다.
// 접근 통제는 env.PRO_SUB_MODE(off 기본 | log | enforce)와 PRO_GATE_MODE=enforce 가 함께일 때만 차단한다. 체험 일수는 env.PRO_TRIAL_DAYS(기본 7).
function handleProSubRoutes(request, url, env, corsHeaders) {
  const cfg = { base: L1_DEFAULT, getToken: () => _l1AdminToken(env) };
  const handler = makeProSubHandler({
    store: makePocketBaseProSubStore(cfg),
    verStore: makePocketBaseProVerifyStore(cfg),
    bearerAdmin: async (req, e) => (await _requireAdmin(req, e))?.admin || null,
    getPinnedPubKey: async (e, guid) => (await _l1FindProfileByGuid(e, guid))?.pubkey_ed25519 || null,
  });
  return handler.handle(request, url, env, corsHeaders);
}

`],
  ['after', "    if (pathname.startsWith('/pro-verify/')) return handleProVerifyRoutes(request, url, env, corsHeaders);\n",
   "    if (pathname.startsWith('/pro-sub/')) return handleProSubRoutes(request, url, env, corsHeaders);\n"],
]);

// ── assets/chat-widget.js: 차단 사유별 안내 ──
patch('assets/chat-widget.js', 'HondiPro.blockMessage', [
  ['replace', "        appendMsg('ai', '전문가용 AI는 면허 인증이 승인된 전문가만 쓸 수 있습니다. 열린 창에서 인증을 신청해 주세요.');",
   "        appendMsg('ai', (window.HondiPro && window.HondiPro.blockMessage) ? window.HondiPro.blockMessage() : '전문가용 AI는 면허 인증이 승인된 전문가만 쓸 수 있습니다. 열린 창에서 인증을 신청해 주세요.');"],
]);

// ── pages/expert-chat.html ──
patch('pages/expert-chat.html', 'HondiPro.blockMessage', [
  ['replace', "        throw new Error('전문가용 AI는 면허 인증이 승인된 전문가만 쓸 수 있습니다. 열린 창에서 인증을 신청해 주세요.');",
   "        throw new Error(window.HondiPro.blockMessage ? window.HondiPro.blockMessage() : '전문가용 AI는 면허 인증이 승인된 전문가만 쓸 수 있습니다. 열린 창에서 인증을 신청해 주세요.');"],
]);

// ── admin.html: 구독 패널 ──
patch('admin.html', '_loadProSubList', [
  ['before', "      <!-- ①-d GDC 잔액 조정",
`      <!-- ①-f 전문가용 AI 구독 (2026-10-21 신설, W5 — /pro-sub/grant·list·quote·refund 연동)
           수동 입금 확인 후 부여한다. 입금 참조(pay_ref)는 중복 부여 방지용 필수 값이다. 카드·계좌번호는 입력하지 않는다. -->
      <div style="border:1px solid var(--ad-line,#3c3f46);border-radius:0;padding:16px 18px;margin-bottom:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
          <div style="font-size:12px;color:var(--ad-faint,#6e737a);letter-spacing:.3px">전문가용 AI 구독 — 입금 확인 후 부여 · 만료 임박 · 환불 <span id="ps-active" style="margin-left:8px"></span></div>
          <button onclick="_loadProSubList()" style="padding:5px 12px;background:var(--ad-panel2,#33363c);color:var(--ad-text,#d7d9dd);border:1px solid var(--ad-line-strong,#4a4e56);border-radius:0;font-size:11.5px;cursor:pointer">새로고침</button>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:12px;font-size:12px">
          <input id="ps-guid" placeholder="대상 계정 ID(guid)" style="padding:5px 8px;min-width:200px">
          <select id="ps-kind" style="padding:5px 8px"><option value="professional">전문가</option><option value="staff">직원</option></select>
          <input id="ps-ref" placeholder="입금 참조(입금자명 등)" maxlength="60" style="padding:5px 8px;min-width:170px">
          <input id="ps-amount" type="number" min="0" value="99000" style="padding:5px 8px;width:100px" title="금액(원)">
          <input id="ps-months" type="number" min="1" max="24" value="12" style="padding:5px 8px;width:60px" title="개월">
          <button onclick="_psGrant()" style="padding:5px 12px;cursor:pointer">구독 부여</button>
        </div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:11.5px;min-width:640px">
            <thead><tr style="text-align:left;color:var(--ad-faint,#6e737a)">
              <th style="padding:0 8px 8px 0;font-weight:400;width:80px">구분</th>
              <th style="padding:0 8px 8px 0;font-weight:400;width:120px">가입자</th>
              <th style="padding:0 8px 8px 0;font-weight:400">입금 참조</th>
              <th style="padding:0 8px 8px 0;font-weight:400;width:80px">금액</th>
              <th style="padding:0 8px 8px 0;font-weight:400;width:130px">만료</th>
              <th style="padding:0 0 8px;width:90px"></th>
            </tr></thead>
            <tbody id="ps-body"></tbody>
          </table>
        </div>
        <div id="ps-empty" style="font-size:12.5px;color:var(--ad-faint,#6e737a);text-align:center;padding:18px">불러오는 중…</div>
      </div>

`],
  ['before', "async function _loadChargeList() {",
`// ── 전문가용 AI 구독 (2026-10-21) ──
async function _psCall(path, body) {
  return fetch(\`\${WORKER_URL}\${path}\`, { method: 'POST', signal: AbortSignal.timeout(20000),
    headers: Object.assign({ 'Content-Type': 'application/json' }, _adminAuthHeaders()), body: JSON.stringify(body || {}) });
}
async function _loadProSubList() {
  const tbody = document.getElementById('ps-body'), empty = document.getElementById('ps-empty'), act = document.getElementById('ps-active');
  if (!tbody || !empty) return;
  empty.style.display = 'block'; empty.textContent = '불러오는 중…'; tbody.innerHTML = '';
  try {
    const res = await _psCall('/pro-sub/list', { within_days: 30 });
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || 'API_ERROR');
    if (act) act.textContent = '유효 구독 ' + data.active_count + '건';
    const fmt = ts => ts ? new Date(ts).toLocaleDateString('ko-KR', {timeZone:'Asia/Seoul'}) : '—';
    const mark = new Set(data.expiring.map(r => r.id));
    const rows = [...data.expiring, ...data.recent.filter(r => !mark.has(r.id))];
    if (!rows.length) { empty.textContent = '부여된 구독이 없습니다.'; return; }
    empty.style.display = 'none';
    tbody.innerHTML = rows.map(r => {
      const soon = mark.has(r.id) && r.status === 'active';
      return \`<tr style="border-top:1px solid var(--ad-line,#3c3f46)">
        <td style="padding:7px 8px 7px 0">\${r.kind === 'staff' ? '직원' : '전문가'}\${r.status === 'refunded' ? ' (환불)' : ''}</td>
        <td style="padding:7px 8px 7px 0;font-family:var(--ad-mono)">\${_esc(String(r.subscriber))}…</td>
        <td style="padding:7px 8px 7px 0">\${_esc(String(r.pay_ref))}</td>
        <td style="padding:7px 8px 7px 0;font-family:var(--ad-mono)">\${Number(r.amount).toLocaleString('ko-KR')}</td>
        <td style="padding:7px 8px 7px 0;font-family:var(--ad-mono)">\${fmt(r.expires_ts)}\${soon ? ' · ' + r.days_left + '일 남음' : ''}</td>
        <td style="padding:7px 0">\${r.status === 'active' ? \`<button onclick="_psRefund('\${_esc(String(r.id))}')" style="padding:3px 8px;font-size:11px;cursor:pointer">환불</button>\` : ''}</td></tr>\`;
    }).join('');
  } catch (e) { empty.textContent = '불러오지 못했습니다: ' + e.message; }
}
async function _psGrant() {
  const g = id => document.getElementById(id).value.trim();
  const body = { target_guid: g('ps-guid'), kind: g('ps-kind'), pay_ref: g('ps-ref'), amount: Number(g('ps-amount')), months: Number(g('ps-months')) };
  if (!body.target_guid || body.pay_ref.length < 2) { alert('대상 계정 ID와 입금 참조(2자 이상)를 입력하세요.'); return; }
  if (!confirm('입금을 확인했습니다. ' + body.kind + ' 구독 ' + body.months + '개월(' + body.amount.toLocaleString('ko-KR') + '원)을 부여합니다.')) return;
  try {
    const res = await _psCall('/pro-sub/grant', body);
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) { alert(j.message || ('부여하지 못했습니다 (' + res.status + ')')); return; }
    document.getElementById('ps-ref').value = ''; document.getElementById('ps-guid').value = '';
    _loadProSubList();
  } catch (e) { alert('부여하지 못했습니다: ' + e.message); }
}
async function _psRefund(id) {
  try {
    const q = await (await _psCall('/pro-sub/quote', { id })).json();
    if (!q.ok) { alert(q.message || '제안액을 가져오지 못했습니다.'); return; }
    const k = q.quote;
    const amt = prompt('환불액(원). 제안: ' + k.suggested_amount.toLocaleString('ko-KR') + '원 (결제 ' + k.paid.toLocaleString('ko-KR') + '원, 잔여 ' + k.days_left + '일' + (k.within_7d ? ', 결제 7일 이내' : '') + ') — 초안 정책이며 최종 금액은 운영자가 정합니다.', String(k.suggested_amount));
    if (amt === null) return;
    const note = prompt('환불 사유 (필수)'); if (!note) return;
    if (!confirm('환불 처리하면 해당 구독이 즉시 종료됩니다. 실제 송금은 따로 하셔야 합니다.')) return;
    const res = await _psCall('/pro-sub/refund', { id, amount: Number(amt), note });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) { alert(j.message || ('처리하지 못했습니다 (' + res.status + ')')); return; }
    _loadProSubList();
  } catch (e) { alert('처리하지 못했습니다: ' + e.message); }
}

`],
  ['after', "  _loadProVerifyList();\n  _loadCFCredentials();\n", "  _loadProSubList();\n"],
]);
