/**
 * ui/search.js — 사용자 검색 UI (GDUDA Phase 1)
 * - 전화번호·아이디 정확 일치 검색 → 연결 요청 (카카오톡 방식: 닉네임·부분 일치 둘러보기 없음)
 * - Worker /friends/find 경유 (friend-find-client.js)
 */
import { PROXY, _USER } from '../core/state.js';
import { currentGuid } from '../p2p/signal-auth.js';
import { rememberUser } from './frequent-users.js';
import { classifyQuery, normalizePhone } from '../../worker/friend-find.js';
import { findFriend, matchContacts, getInviteCode } from './friend-find-client.js';

let _searchOverlay = null;
let _searchTimer   = null;

// ── 검색 패널 열기 ────────────────────────────────────────
// @param {string} [prefillQuery] — 그림자 AI [SEARCH: query=...] 태그에서 전달.
//   지정 시 입력란에 자동 채우고 즉시 검색을 실행한다(사용자 타이핑 불필요).
export function openSearch(prefillQuery) {
  if (_searchOverlay) { _searchOverlay.remove(); _searchOverlay = null; }
  // BUG-FIX(2026-07-01): 검색창을 "여는" 순간 바로 튜토리얼 완료 신호를
  // 보내던 것을 제거 — 실제 사용자 행동(검색해보고 닫음)이 끝난 시점인
  // _closeSearch()로 옮겼다. 사용자가 검색 버튼만 눌러도 즉시 "참 잘했어요"
  // 응답이 나오던 원인이었다.

  const overlay = document.createElement('div');
  overlay.id = '_search-overlay';
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:9998',
    'background:rgba(0,0,0,0.4)',
    'display:flex;align-items:flex-start;justify-content:center',
    'padding:60px 16px 16px;box-sizing:border-box',
  ].join(';');

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:20px;width:100%;max-width:400px;
                box-sizing:border-box;overflow:hidden;
                box-shadow:0 8px 32px rgba(0,0,0,0.18)">

      <!-- 헤더 -->
      <div style="display:flex;align-items:center;padding:16px 20px;
                  border-bottom:1px solid #f0f0f0">
        <span style="font-size:calc(0.9375rem*var(--hondi-fs,1));font-weight:600;color:#111827;flex:1">사용자 검색</span>
        <button id="_search-close"
          style="border:none;background:none;font-size:calc(1.25rem*var(--hondi-fs,1));cursor:pointer;
                 color:#9ca3af;padding:0 4px">✕</button>
      </div>

      <!-- 검색 입력 -->
      <div style="padding:16px 20px 8px">
        <div style="display:flex;align-items:center;
                    border:1px solid #e5e7eb;border-radius:12px;
                    background:#f9fafb;overflow:hidden" id="_sq-field">
          <input id="_sq-input" type="text" placeholder="이름, 이메일 ID 또는 전화번호를 정확히 입력"
            style="flex:1;padding:0 14px;height:48px;border:none;background:transparent;
                   font-size:calc(0.9375rem*var(--hondi-fs,1));font-family:inherit;outline:none;color:#111827;min-width:0"
            autocomplete="off"/>
          <button id="_sq-btn"
            style="padding:0 16px;height:48px;border:none;background:transparent;
                   cursor:pointer;color:#1A73E8;font-size:calc(0.875rem*var(--hondi-fs,1));font-weight:600">
            검색
          </button>
        </div>
      </div>

      <div style="padding:0 20px 8px">
        <button id="_sq-contacts" type="button"
          style="width:100%;height:40px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;
                 color:#1A73E8;font-size:calc(0.8125rem*var(--hondi-fs,1));font-weight:600;cursor:pointer">
          📇 연락처에서 찾기·초대하기
        </button>
      </div>

      <!-- 결과 -->
      <div id="_sq-results"
        style="max-height:360px;overflow-y:auto;padding:0 0 8px">
      </div>
    </div>`;

  document.body.appendChild(overlay);
  _searchOverlay = overlay;

  const input       = document.getElementById('_sq-input');
  const field       = document.getElementById('_sq-field');
  const resultsEl   = document.getElementById('_sq-results');

  // 닫기
  document.getElementById('_search-close').onclick = _closeSearch;
  overlay.addEventListener('click', e => { if (e.target === overlay) _closeSearch(); });

  // 포커스
  input.addEventListener('focus', () => field.style.borderColor = '#1A73E8');
  input.addEventListener('blur',  () => field.style.borderColor = '#e5e7eb');

  // 입력 중 자동 검색은 하지 않는다 — 정확 일치 조회는 시간당 한도가 있어, 검색 버튼·Enter 때만 조회한다.
  input.addEventListener('input', () => {
    if (!input.value.trim()) resultsEl.innerHTML = '';
  });

  document.getElementById('_sq-contacts').onclick = () => _searchContacts(resultsEl);
  document.getElementById('_sq-btn').onclick = () => {
    const q = input.value.trim();
    if (q) _doSearch(q, '', '', resultsEl);
  };

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const q = input.value.trim();
      if (q) _doSearch(q, '', '', resultsEl);
    }
    if (e.key === 'Escape') _closeSearch();
  });

  // ── 그림자 AI가 query를 미리 전달한 경우: 자동 입력 + 즉시 검색 ──
  if (prefillQuery && prefillQuery.trim()) {
    input.value = prefillQuery.trim();
    _doSearch(prefillQuery.trim(), '', '', resultsEl);
  } else {
    input.focus();
  }
}

// ── 검색 실행 ─────────────────────────────────────────────
async function _doSearch(q, country, region, resultsEl) {
  resultsEl.innerHTML = `
    <div style="text-align:center;padding:24px;color:#9ca3af;font-size:calc(0.8125rem*var(--hondi-fs,1))">
      검색 중...
    </div>`;

  // 카카오톡 방식: 전화번호(상대가 허용한 경우만)·아이디 정확 일치로만 찾는다. 닉네임·부분 일치 둘러보기는 없다.
  const cq = classifyQuery(q);
  const msg = (t) => `<div style="text-align:center;padding:24px 16px;color:#9ca3af;font-size:calc(0.8125rem*var(--hondi-fs,1));line-height:1.6">${t}</div>`;
  try {
    const fr = await findFriend(q);
    if (fr.ok && fr.found && fr.user) {
      try { rememberUser(localStorage, _USER?.guid || _USER?.ipv6, fr.user); } catch {}   // 찾은 사용자는 자주 찾는 사용자로 저장
      if (cq.kind === 'phone' && cq.e164) _rememberKnownPhone(fr.user, cq.e164);   // 번호로 찾았으면, 응답이 없을 때 문자로 알릴 수 있게 번호를 이 기기에 잠시 둔다
      const many = Array.isArray(fr.users) && fr.users.length > 1;      // 같은 이름이 여럿이면 목록에서 고른다
      resultsEl.innerHTML = many ? fr.users.map(_renderUserCard).join('') : _renderUserCard(fr.user);
      resultsEl.querySelectorAll('[data-connect]').forEach(btn => { btn.onclick = () => _sendConnectRequest(JSON.parse(btn.dataset.connect)); });
      // 2026-11-16(주피터 지시): 찾은 뒤 곧바로 연결하지 않고, 한 명으로 분명해도 확인 팝업을 먼저 보여 준다. 카드의 '대화' 버튼도 같은 확인을 거친다.
      if (!many) _sendConnectRequest(fr.user);
      return;
    }
    if (fr.ok && fr.self) {
      resultsEl.innerHTML = msg('검색하신 상대는 본인 계정입니다.<br>같은 계정을 다른 기기에서 쓰려면 <b>기기 연결</b>을 이용해 주세요.');
    } else if (!fr.ok && fr.error === 'LOGIN_REQUIRED') {
      resultsEl.innerHTML = msg('상대를 찾으려면 먼저 로그인해 주세요.' + (fr.message && /\(/.test(fr.message) ? '<br><span style="font-size:11px">' + String(fr.message).replace(/[<>&]/g, '') + '</span>' : ''));
    } else if (!fr.ok) {
      resultsEl.innerHTML = msg(fr.message || '검색에 실패했습니다.');
    } else if (cq.kind === 'phone') {
      resultsEl.innerHTML = msg('이 전화번호로 찾을 수 있는 사용자가 없습니다.<br>아직 가입하지 않았거나 전화번호 찾기를 허용하지 않았을 수 있어요.') + '<div id="_sq-invite-one" style="text-align:center;padding:0 16px 12px"></div>';
      _fillInviteButton(resultsEl.querySelector('#_sq-invite-one'), cq.e164, '');
    } else {
      resultsEl.innerHTML = msg('일치하는 사용자가 없습니다.<br>상대의 이름·이메일 ID·전화번호 중 하나를 정확히 입력해 주세요. 상대가 찾기를 허용한 항목으로만 찾을 수 있습니다.');
    }
  } catch (e) {
    resultsEl.innerHTML = `<div style="text-align:center;padding:24px;color:#dc2626;font-size:calc(0.8125rem*var(--hondi-fs,1))">네트워크 오류: ${e.message}</div>`;
  }
}

// ── 연락처에서 찾기·초대 ───────────────────────────────────
// 안드로이드 크롬의 Contact Picker 로 사용자가 직접 고른 연락처만 읽는다(앱이 연락처 전체를 가져가지 않는다).
// 가입자(상대가 전화번호 찾기를 허용한 경우)는 바로 대화, 그 밖에는 문자 앱으로 초대 문구를 보낸다 — 문자는 사용자 본인 번호로 나간다.
let _inviteCache = null;
async function _loadInvite() {
  if (_inviteCache) return _inviteCache;
  const r = await getInviteCode();
  if (r && r.ok) _inviteCache = r;
  return _inviteCache;
}
function _smsHref(tel, text) {
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  return `sms:${tel}${ios ? '&' : '?'}body=${encodeURIComponent(text)}`;
}
function _rememberKnownPhone(user, e164) {
  try { if (user && user.guid && e164) localStorage.setItem('navi_known_phone_' + user.guid, JSON.stringify({ e164, ts: Date.now() })); } catch {}
}
const _esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const _INVITE_BTN_STYLE = 'display:inline-block;padding:6px 14px;background:#fff;color:#1A73E8;border:1px solid #1A73E8;border-radius:8px;font-size:calc(0.8125rem*var(--hondi-fs,1));font-weight:600;text-decoration:none;flex-shrink:0';
async function _fillInviteButton(el, e164) {
  if (!el) return;
  const inv = await _loadInvite();
  if (!inv) { el.textContent = ''; return; }
  const a = document.createElement('a');
  a.textContent = '초대 문자 보내기';
  a.style.cssText = _INVITE_BTN_STYLE;
  a.href = _smsHref(e164, inv.text);
  el.innerHTML = ''; el.appendChild(a);
}

async function _searchContacts(resultsEl) {
  const msg = (t) => `<div style="text-align:center;padding:24px 16px;color:#9ca3af;font-size:calc(0.8125rem*var(--hondi-fs,1));line-height:1.6">${t}</div>`;
  if (!('contacts' in navigator) || !navigator.contacts?.select) {
    resultsEl.innerHTML = msg('이 기기·브라우저에서는 연락처를 불러올 수 없습니다.<br>(안드로이드 크롬에서 지원됩니다) 전화번호나 아이디를 직접 입력해 주세요.');
    return;
  }
  _loadInvite();                                   // 초대 문구를 미리 받아 둔다(버튼을 누르면 바로 문자 앱이 열리도록)
  let picked;
  try { picked = await navigator.contacts.select(['name', 'tel'], { multiple: true }); }
  catch (e) { resultsEl.innerHTML = msg('연락처를 불러오지 못했습니다: ' + _esc(e.message || e)); return; }
  if (!picked || !picked.length) return;
  const rows = [];                                  // { name, e164 }
  const seen = new Set();
  for (const c of picked) {
    const nm = (c.name && c.name[0]) || '';
    for (const t of (c.tel || [])) {
      const e = normalizePhone(t);
      if (e && !seen.has(e)) { seen.add(e); rows.push({ name: nm, e164: e }); }
    }
  }
  if (!rows.length) { resultsEl.innerHTML = msg('고른 연락처에 전화번호가 없습니다.'); return; }
  const list = rows.slice(0, 50);
  resultsEl.innerHTML = msg('연락처 확인 중...');
  const r = await matchContacts(list.map(x => x.e164));
  if (!r.ok) { resultsEl.innerHTML = msg(_esc(r.message || '연락처 확인에 실패했습니다.')); return; }
  const member = new Map((r.matches || []).map(m => [m.e164, m.user]));
  const mine = list.filter(x => member.has(x.e164)), others = list.filter(x => !member.has(x.e164));
  const sub = 'font-size:calc(0.75rem*var(--hondi-fs,1));color:#6b7280';
  const rowHtml = (left, btn) => `<div style="display:flex;align-items:center;gap:12px;padding:10px 20px;border-bottom:1px solid #f9f9f9"><div style="flex:1;min-width:0;font-size:calc(0.875rem*var(--hondi-fs,1));color:#111827">${left}</div>${btn}</div>`;
  let html = '';
  if (mine.length) html += `<div style="padding:8px 20px;${sub}">나비웹 사용자</div>`;
  mine.forEach((x, i) => {
    const u = member.get(x.e164);
    html += rowHtml(`<b>${_esc(x.name || u.nickname)}</b>${u.nickname && u.nickname !== x.name ? ` <span style="${sub}">${_esc(u.nickname)}</span>` : ''}`,
      `<button data-m="${i}" style="padding:6px 14px;background:#1A73E8;color:#fff;border:none;border-radius:8px;font-size:calc(0.8125rem*var(--hondi-fs,1));font-weight:600;cursor:pointer;flex-shrink:0">대화</button>`);
  });
  if (others.length) html += `<div style="padding:8px 20px;${sub}">초대하기 · 가입하면 초대한 분께 1,000 GDC</div>`;
  others.forEach((x, i) => { html += rowHtml(_esc(x.name || x.e164), `<span data-i="${i}"></span>`); });
  resultsEl.innerHTML = html;
  resultsEl.querySelectorAll('[data-m]').forEach(b => { b.onclick = () => { const _e = mine[Number(b.dataset.m)].e164; _rememberKnownPhone(member.get(_e), _e); _sendConnectRequest(member.get(_e), { skipConfirm: true }); } });
  resultsEl.querySelectorAll('span[data-i]').forEach(sp => { _fillInviteButton(sp, others[Number(sp.dataset.i)].e164); });
}

// ── 사용자 카드 렌더 ──────────────────────────────────────
function _renderUserCard(u) {
  const esc     = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const idText  = u.mail_id || '';
  const name    = u.nickname || idText;
  const region  = u.region ? esc(u.region) : '';
  const data    = JSON.stringify(u).replace(/"/g, '&quot;');

  return `
    <div style="display:flex;align-items:center;gap:12px;
                padding:12px 20px;border-bottom:1px solid #f9f9f9">
      <div style="font-size:calc(1.75rem*var(--hondi-fs,1));flex-shrink:0">${esc(u.avatar_emoji || '🙂')}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:calc(0.875rem*var(--hondi-fs,1));font-weight:600;color:#111827">
          ${esc(name)}
        </div>
        <div style="font-size:calc(0.75rem*var(--hondi-fs,1));color:#6b7280;margin-top:2px">
          ${idText ? esc(idText) : ''}
          ${region ? `<span style="margin-left:6px">${region}</span>` : ''}
        </div>
      </div>
      <button data-connect="${data}"
        style="padding:6px 14px;background:#1A73E8;color:#fff;
               border:none;border-radius:8px;font-size:calc(0.8125rem*var(--hondi-fs,1));
               font-weight:600;cursor:pointer;flex-shrink:0">
        대화
      </button>
    </div>`;
}

// ── 연결 요청 전송 ────────────────────────────────────────
async function _sendConnectRequest(targetUser, opts = {}) {
  if (!currentGuid(_USER)) {
    alert('로그인이 필요합니다.');
    return;
  }

  if (!opts.skipConfirm) {
    const confirmed = await (window.mpConfirm||confirm)(
      `${targetUser.nickname || targetUser.mail_id || targetUser.handle}님에게 연결 요청을 보내시겠습니까?`
    );
    if (!confirmed) return;
  }

  // 2026-07-07: 검색을 새 탭(pages/search-tab.html)에서 여는 경우, P2P
  // 채팅은 아직 메인 창(webapp.html)의 DOM(#peer-bar·#msg-input 등)에
  // 결합돼 있어 이 탭 자체에서는 startP2PCall()을 바로 쓸 수 없다(P2P
  // 자체를 새 탭에서 여는 기능은 별도 엔지니어링 작업으로 진행 중).
  // 그래서 이 탭이 메인 창의 팝업(window.opener)으로 열린 경우엔 실제
  // 연결 수행을 메인 창에 위임하고, 그 결과가 준비되면 메인 창이 스스로
  // 대화를 이어간다 — 이 탭에서 조용히 실패하는 대신 정직하게 위임한다.
  if (!document.getElementById('peer-bar') && window.opener && !window.opener.closed) {
    try {
      window.opener.postMessage(
        { type: 'HONDI_P2P_CONNECT_REQUEST', targetUser },
        window.opener.location.origin
      );
      window.opener.focus();
      try { rememberUser(localStorage, _USER?.guid || _USER?.ipv6, targetUser, Date.now(), true); } catch {}
      _closeSearch();
    } catch (e) {
      alert('메인 창 연결 요청 실패: ' + e.message);
    }
    return;
  }

  try {
    // WebRTC offer 생성
    const { startP2PCall } = await import('./p2p-chat.js');
    await startP2PCall(targetUser);
    try { rememberUser(localStorage, _USER?.guid || _USER?.ipv6, targetUser, Date.now(), true); } catch {}
    _closeSearch();
  } catch(e) {
    alert('연결 요청 실패: ' + e.message);
  }
}

// ── 검색 패널 닫기 ────────────────────────────────────────
function _closeSearch() {
  _searchOverlay?.remove();
  _searchOverlay = null;
  clearTimeout(_searchTimer);
  // BUG-FIX(2026-07-01): 튜토리얼 STEP 4 완료 신호 — "검색창을 열기만
  // 해도" 완료 처리하던 것을 "검색해보고 닫음"으로 정정. 검색 결과가
  // 있었는지와 무관하게(예: '경찰청'은 실제로는 우측 메뉴 GWP 기관
  // 서비스이지 이 사용자검색 대상이 아니라 결과가 없을 수 있음) 검색창을
  // 닫는 행위 자체를 완료 조건으로 삼아, 모든 사용자가 이 단계를 실제로
  // 완료할 수 있게 한다. p2p-chat.js의 _closeP2P()에도 동일 신호가 있어,
  // 실제로 대화 상대를 찾아 연결했다가 나간 경우도 동일하게 인정된다.
  if (typeof window._tutorialSignal === 'function') window._tutorialSignal('search_flow_done');
}

// ── 전역 노출 ─────────────────────────────────────────────
window._openSearch = openSearch;
