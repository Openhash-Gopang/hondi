/**
 * ui/friend-find-client.js — 카카오톡 방식 대화 상대 찾기(2026-10-28)의 클라이언트 쪽 공용 부분.
 *  - findFriend(q): 번호·검색용 아이디 정확일치 조회(/friends/find). 로그인 토큰은 공유 쿠키 hondi_pvt.
 *  - mountFriendFindCard(): 설정 화면에 "내 혼디 아이디 / 번호로 찾기 허용" 카드를 붙인다.
 */
import { PROXY } from '../core/state.js';

function readCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}
function token() {
  const t = readCookie('hondi_pvt'), e = Number(readCookie('hondi_pvt_exp') || 0);
  return t && (!e || Date.now() < e) ? t : '';
}
async function post(path, body) {
  const t = token();
  if (!t) return { ok: false, error: 'LOGIN_REQUIRED', message: '로그인이 필요합니다.' };
  try {
    const r = await fetch(PROXY + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone_verify_token: t, ...body }) });
    const d = await r.json().catch(() => ({}));
    return r.ok ? d : { ok: false, error: d.error || 'HTTP_' + r.status, message: d.message || d.detail || '요청에 실패했습니다.' };
  } catch (e) { return { ok: false, error: 'NETWORK', message: '네트워크 오류: ' + e.message }; }
}

/** @returns {Promise<{ok:boolean, found?:boolean, self?:boolean, user?:object, message?:string}>} */
export function findFriend(q) { return post('/friends/find', { q }); }
export function getFriendSettings() { return post('/friends/settings', { action: 'get' }); }
export function saveFriendSettings(patch) { return post('/friends/settings', { action: 'set', ...patch }); }

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

export async function mountFriendFindCard() {
  const host = document.getElementById('gopang-id-section');
  if (!host) return;
  let card = document.getElementById('friend-find-card');
  if (!card) {
    card = document.createElement('div');
    card.id = 'friend-find-card'; card.className = 'settings-card'; card.style.cssText = 'margin-top:10px;padding:12px 14px';
    card.innerHTML =
      '<div style="font-size:14px;font-weight:600;color:#000;margin-bottom:6px">대화 상대 찾기</div>' +
      '<div style="font-size:12px;color:#8e8e93;line-height:1.5">상대가 내 <b>혼디 아이디</b>를 입력하면 나를 찾을 수 있습니다. 혼디 아이디는 가입할 때 전화번호로 정해지며 바꿀 수 없습니다.</div>' +
      '<div id="ff-handle" style="font-size:15px;font-weight:600;margin:8px 0;color:#1A73E8"></div>' +
      '<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#111827"><input id="ff-phone" type="checkbox"> 내 전화번호로 나를 찾을 수 있게 허용</label>' +
      '<div id="ff-msg" style="font-size:12px;margin-top:6px;min-height:16px;color:#6b7280"></div>';
    host.appendChild(card);
  }
  const msg = (t, bad) => { const m = card.querySelector('#ff-msg'); m.textContent = t || ''; m.style.color = bad ? '#dc2626' : '#0f7b4f'; };
  const phEl = card.querySelector('#ff-phone');
  const s = await getFriendSettings();
  if (!s.ok) { msg(s.message, true); return; }
  card.querySelector('#ff-handle').textContent = s.test_account ? String(s.handle).replace(/^tid-/, '') : s.handle;
  phEl.checked = !!s.phone_findable;
  phEl.onchange = async () => {
    const want = phEl.checked, r = await saveFriendSettings({ phone_findable: want });
    if (!r.ok) { phEl.checked = !want; msg(r.message, true); } else msg(want ? '이제 내 전화번호로 나를 찾을 수 있습니다.' : '전화번호로는 더 이상 찾히지 않습니다.');
  };
}
