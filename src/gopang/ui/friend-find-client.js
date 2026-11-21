/**
 * ui/friend-find-client.js — 카카오톡 방식 대화 상대 찾기(2026-10-28)의 클라이언트 쪽 공용 부분.
 *  - findFriend(q): 번호·검색용 아이디 정확일치 조회(/friends/find). 로그인 토큰은 공유 쿠키 hondi_pvt.
 *  - mountFriendFindCard(): 설정 화면에 "이름·이메일 ID·전화번호별 찾기 허용" 카드를 붙인다.
 */
import { _USER } from '../core/state.js';
import { signalPost, currentGuid } from '../p2p/signal-auth.js';

// 로그인 증명: 문자 인증 쿠키(hondi_pvt)가 있으면 그것을, 없으면(기기 키로만 로그인한 기기) 지갑 서명으로 발급한 토큰을 쓴다.
// signalPost 가 둘 중 가능한 쪽을 붙이고, 쿠키 계정이 다르거나 만료면 지갑 증명으로 한 번 더 시도한다.
async function post(path, body) {
  const guid = currentGuid(_USER);
  try {
    const r = await signalPost(path, guid, body || {});
    if (r.ok) return r.data;
    const d = r.data || {};
    const noAuth = r.status === 401 || r.status === 403 || d.error === 'AUTH_REQUIRED';
    return { ok: false, error: noAuth ? 'LOGIN_REQUIRED' : (d.error || 'HTTP_' + r.status), message: noAuth ? ('인증에 실패했습니다. 잠시 후 다시 시도해 주세요.' + (d.error || d.code ? ' (' + (d.error || d.code) + ')' : '') + (r.authKind ? ' [' + r.authKind + ']' : '')) : (d.message || d.detail || '요청에 실패했습니다.') };
  } catch (e) { return { ok: false, error: 'NETWORK', message: '네트워크 오류: ' + e.message }; }
}

/** @returns {Promise<{ok:boolean, found?:boolean, self?:boolean, user?:object, message?:string}>} */
export function findFriend(q) { return post('/friends/find', { q }); }
/** 무응답 초대를 남긴 뒤 상대에게 푸시 알림을 보낸다(실패해도 무시). */
export function notifyInvite(toGuid) { return post('/friends/invite-notify', { to_guid: toGuid }); }
/** 연락처에서 고른 번호(E.164) 중 번호 찾기를 허용한 가입자 → { ok, matches: [{ e164, user }] } */
export function matchContacts(numbers) { return post('/friends/match', { numbers }); }
/** 내 추천 코드와 초대 문자 본문 → { ok, code, link, text, reward_gdc } */
export function getInviteCode() { return post('/friends/invite-code', {}); }
/** 초대받아 가입한 사람이 추천 코드를 청구 → { ok, status: granted|already|self|expired|capped|invalid } */
export function claimReferral(code) { return post('/friends/ref-claim', { code }); }
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
    const row = (id, label, hint) =>
      '<label style="display:flex;align-items:flex-start;gap:8px;margin-top:10px;font-size:calc(0.8125rem*var(--hondi-fs,1));color:#111827">' +
      '<input id="' + id + '" type="checkbox" style="margin-top:3px">' +
      '<span><span style="font-weight:600">' + label + '</span> <span id="' + id + '-v" style="color:#1A73E8;font-weight:600"></span> 검색 허용' +
      '<span style="display:block;font-size:calc(0.6875rem*var(--hondi-fs,1));color:#8e8e93;margin-top:1px">' + hint + '</span></span></label>';
    card.innerHTML =
      '<div style="font-size:calc(0.875rem*var(--hondi-fs,1));font-weight:600;color:#000;margin-bottom:6px">대화 상대 찾기</div>' +
      '<div style="font-size:calc(0.75rem*var(--hondi-fs,1));color:#8e8e93;line-height:1.5">다른 나비웹 사용자가 아래 항목을 정확히 입력하면 나를 찾을 수 있습니다. 항목별로 허용 여부를 정하세요.</div>' +
      '<div id="ff-real-box" style="display:none;margin-top:10px;font-size:calc(0.75rem*var(--hondi-fs,1));color:#6b7280">본명(기관·부서·사업자는 그 명칭)을 아직 입력하지 않으셨습니다.' +
      '<div style="display:flex;gap:6px;margin-top:4px"><input id="ff-real-in" type="text" maxlength="60" placeholder="본명 또는 기관명" style="flex:1;min-width:0;padding:6px 8px;border:1px solid #d1d5db;border-radius:8px;font-size:inherit;font-family:inherit">' +
      '<button id="ff-real-save" type="button" style="padding:6px 12px;border:0;border-radius:8px;background:#1A73E8;color:#fff;font-weight:600;font-size:inherit;font-family:inherit">저장</button></div></div>' +
      row('ff-real', '본명', '본명(기관은 기관명)으로 찾을 수 있습니다. 본인 인증 전에는 입력한 값입니다') +
      row('ff-name', '이름', '같은 이름이 여럿이면 목록에서 고르게 됩니다') +
      row('ff-mail', '이메일 ID', '가입할 때 정한 이메일 ID로 찾을 수 있습니다') +
      row('ff-phone', '전화번호', '번호는 상대에게 보이지 않습니다') +
      '<div id="ff-msg" style="font-size:calc(0.75rem*var(--hondi-fs,1));margin-top:8px;min-height:16px;color:#6b7280"></div>';
    host.appendChild(card);
  }
  const msg = (t, bad) => { const m = card.querySelector('#ff-msg'); m.textContent = t || ''; m.style.color = bad ? '#dc2626' : '#0f7b4f'; };
  const s = await getFriendSettings();
  if (!s.ok) { if (s.error !== 'LOGIN_REQUIRED') msg(s.message, true); return; }   // 로그인 증명을 못 붙인 드문 경우엔 문구 없이 둔다
  const h = String(s.handle || '').replace(/^@/, '');     // 한국 번호는 가입 때 뒤 8자리가 아이디가 되므로 010-XXXX-XXXX 로 보여 준다
  const phoneShown = /^\d{8}$/.test(h) ? '010-' + h.slice(0, 4) + '-' + h.slice(4) : '';
  card.querySelector('#ff-name-v').textContent = s.nickname || '';
  card.querySelector('#ff-mail-v').textContent = s.mail_id || '';
  card.querySelector('#ff-phone-v').textContent = phoneShown;
  card.querySelector('#ff-real-v').textContent = s.real_name || '';
  if (!s.real_name) {                                       // 본명 칸이 없던 때 가입한 분: 여기서 채운다
    const box = card.querySelector('#ff-real-box'); box.style.display = '';
    card.querySelector('#ff-real-save').onclick = async () => {
      const v = card.querySelector('#ff-real-in').value.trim();
      if (v.length < 2) { msg('본명을 2자 이상 입력해 주세요.', true); return; }
      const r = await saveFriendSettings({ real_name: v });
      if (!r.ok) { msg(r.message, true); return; }
      box.style.display = 'none'; card.querySelector('#ff-real-v').textContent = v; msg('본명을 저장했습니다.');
    };
  }
  const bind = (id, key, onTxt, offTxt) => {
    const el = card.querySelector('#' + id);
    el.checked = !!s[key];
    el.onchange = async () => {
      const want = el.checked, r = await saveFriendSettings({ [key]: want });
      if (!r.ok) { el.checked = !want; msg(r.message, true); } else msg(want ? onTxt : offTxt);
    };
  };
  bind('ff-real', 'real_name_findable', '이제 본명으로 나를 찾을 수 있습니다.', '본명으로는 더 이상 찾히지 않습니다.');
  bind('ff-name', 'name_findable', '이제 이름으로 나를 찾을 수 있습니다.', '이름으로는 더 이상 찾히지 않습니다.');
  bind('ff-mail', 'mail_findable', '이제 이메일 ID로 나를 찾을 수 있습니다.', '이메일 ID로는 더 이상 찾히지 않습니다.');
  bind('ff-phone', 'phone_findable', '이제 전화번호로 나를 찾을 수 있습니다.', '전화번호로는 더 이상 찾히지 않습니다.');
}

/**
 * 실명 입력 의무화(2026-11-21): 로그인한 가입자의 본명이 비어 있으면 입력할 때까지 닫을 수 없는 창을 띄운다.
 * 본명이 없으면 입금자를 확인할 수 없어 플랜 입금·GDC 충전이 자동 처리되지 않는다. 저장되면 창이 닫힌다.
 * 조회에 실패하면(네트워크·로그인 문제) 창을 띄우지 않는다 — 실명이 있는 가입자를 막지 않기 위해서다.
 */
export async function requireRealName() {
  if (document.getElementById('realname-gate')) return;
  const s = await getFriendSettings();
  if (!s || !s.ok || String(s.real_name || '').trim().length >= 2) return;
  const ov = document.createElement('div');
  ov.id = 'realname-gate';
  ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px';
  ov.innerHTML =
    '<div style="background:#fff;border-radius:14px;max-width:380px;width:100%;padding:20px;font-family:inherit;color:#111827">' +
    '<div style="font-size:16px;font-weight:700;margin-bottom:8px">실명을 입력해 주세요</div>' +
    '<div style="font-size:13px;line-height:1.6;color:#374151">나비웹 이용을 위해 실명(신분증의 이름, 기관·사업자는 그 명칭) 입력이 필요합니다.</div>' +
    '<div style="font-size:12.5px;line-height:1.6;color:#b45309;background:#fffbeb;border-radius:8px;padding:8px 10px;margin-top:10px">실명을 입력하지 않으면 입금자를 확인할 수 없어, 입금해도 플랜 적용과 GDC 충전이 자동으로 처리되지 않습니다.</div>' +
    '<input id="rg-in" type="text" maxlength="60" placeholder="실명 또는 기관명" style="width:100%;box-sizing:border-box;margin-top:12px;padding:9px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px">' +
    '<div id="rg-msg" style="min-height:16px;font-size:12px;color:#dc2626;margin-top:6px"></div>' +
    '<button id="rg-save" type="button" style="width:100%;margin-top:6px;padding:10px;border:0;border-radius:8px;background:#1A73E8;color:#fff;font-weight:600;font-size:14px;font-family:inherit">저장</button></div>';
  document.body.appendChild(ov);
  const msg = (t) => { ov.querySelector('#rg-msg').textContent = t || ''; };
  const save = async () => {
    const v = ov.querySelector('#rg-in').value.trim().replace(/\s+/g, ' ');
    if (v.length < 2) { msg('실명을 2자 이상 입력해 주세요.'); return; }
    const b = ov.querySelector('#rg-save'); b.disabled = true;
    const r = await saveFriendSettings({ real_name: v });
    b.disabled = false;
    if (!r || !r.ok) { msg((r && r.message) || '저장하지 못했습니다. 다시 시도해 주세요.'); return; }
    ov.remove();
  };
  ov.querySelector('#rg-save').onclick = save;
  ov.querySelector('#rg-in').addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
}
