/**
 * ui/register-flow.js — 아이디 등록 플로우 UI
 * - _showRegisterFlow()      : AI버튼/설정 경유 등록
 * - _showRegisterFlowThenPeer(): 검색 → 채팅 시도 시 등록 후 자동 연결
 */
import { _registerToL1, _isRegistered } from '../core/auth.js';
import { _USER, PROXY } from '../core/state.js';
import { appendBubble } from './bubble.js';
import { _updateHandleChip } from './settings.js';

// ── 기본 등록 플로우 (대화 상대 없음) ────────────────────
export function _showRegisterFlow() {
  _buildRegisterModal({
    pendingPeer: null,
    subtitle: '아이디를 등록하면 다른 사용자와 대화하고 AI 비서를 사용할 수 있습니다.',
    btnLabel: '아이디 등록',
    onSuccess: () => {
      appendBubble('ai',
        `✅ <b>${_USER.handle}</b> 으로 등록됐습니다!<br><br>` +
        `이제 🔍 검색으로 다른 사용자를 찾거나 <b>AI</b> 버튼으로 AI를 활성화하세요.`,
        true
      );
    },
  });
}

// ── 검색 → 채팅 경유 등록 (pendingPeer 자동 연결) ────────
export function _showRegisterFlowThenPeer(pendingPeer) {
  const peerName = pendingPeer.name || pendingPeer.handle || '상대방';
  _buildRegisterModal({
    pendingPeer,
    subtitle: `<b>${peerName}</b>님과 대화하려면 아이디가 필요합니다.<br>아이디는 OpenHash L1에 P2P 방식으로 기록됩니다.`,
    peerCard: pendingPeer,
    btnLabel: `등록 후 ${peerName}에게 연결`,
    onSuccess: async () => {
      appendBubble('ai',
        `✅ <b>${_USER.handle}</b> 으로 등록됐습니다!<br>` +
        `<b>${peerName}</b>님과 연결합니다…`,
        true
      );
      const { setPeer } = await import('../p2p/webrtc.js');
      await setPeer(pendingPeer);
    },
  });
}

// ── 공통 모달 빌더 ───────────────────────────────────────
function _buildRegisterModal({ pendingPeer, subtitle, peerCard, btnLabel, onSuccess }) {
  // 중복 방지
  document.getElementById('_register-flow-overlay')?.remove();

  const ov = document.createElement('div');
  ov.id = '_register-flow-overlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:flex-end;justify-content:center';

  const peerCardHTML = peerCard ? `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;
                background:#EEF4FF;border-radius:12px;padding:12px 14px">
      <span style="font-size:22px">${peerCard.avatar_emoji || ''}</span>
      <div>
        <div style="font-size:14px;font-weight:700;color:#111">${peerCard.name || peerCard.handle}</div>
        <div style="font-size:11px;color:#6b7280">${peerCard.handle || ''}</div>
      </div>
      <div style="margin-left:auto;font-size:11px;color:#1A73E8;font-weight:600">← 대화 상대</div>
    </div>` : '';

  ov.innerHTML = `
    <div style="background:#fff;border-radius:20px 20px 0 0;padding:24px;
                width:100%;max-width:480px;padding-bottom:calc(24px + env(safe-area-inset-bottom,0px))">
      <div style="width:36px;height:4px;background:#e5e7eb;border-radius:2px;margin:0 auto 20px"></div>
      ${peerCardHTML}
      <p style="font-weight:700;font-size:18px;margin:0 0 6px;color:#111;display:flex;align-items:center;gap:8px"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1A73E8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> 나비 아이디 등록</p>
      <p style="font-size:13px;color:#6b7280;margin:0 0 18px;line-height:1.6">${subtitle}</p>
      <div style="background:#f9fafb;border-radius:10px;padding:12px 14px;margin-bottom:18px;font-size:12px;color:#374151;line-height:1.7">
        <b style="color:#1A73E8">등록 사용자 혜택</b><br>
        ✅ P2P 채팅 · AI 비서 사용<br>
        ✅ GDC 결제 수단 · 재무제표 자동 생성<br>
        ✅ 프로필 페이지 (사업체 → 쇼핑몰 활용)
      </div>
      <label style="font-size:12px;font-weight:700;color:#9ca3af;display:block;margin-bottom:6px;
                    text-transform:uppercase;letter-spacing:.5px">내 표시 이름</label>
      <input id="_reg_name" type="text" maxlength="20" placeholder="예: 주피터, 한림상회"
        style="width:100%;box-sizing:border-box;padding:12px 14px;border:1.5px solid #e5e7eb;
               border-radius:10px;font-size:15px;outline:none;font-family:inherit;
               transition:border-color .15s;margin-bottom:18px">
      <label style="font-size:12px;font-weight:700;color:#9ca3af;display:block;margin-bottom:6px;
                    text-transform:uppercase;letter-spacing:.5px">지역 <span style="font-weight:400;color:#d1d5db">(선택)</span></label>
      <div style="display:flex;gap:8px;margin-bottom:18px">
        <input id="_reg_region" type="text" placeholder="내 위치 버튼으로 자동 입력"
          style="flex:1;box-sizing:border-box;padding:12px 14px;border:1.5px solid #e5e7eb;
                 border-radius:10px;font-size:14px;outline:none;font-family:inherit;
                 background:#f9fafb;transition:border-color .15s">
        <button id="_reg_loc_btn"
          style="padding:0 14px;border:1.5px solid #e5e7eb;border-radius:10px;
                 background:#fff;cursor:pointer;font-size:12px;font-family:inherit;
                 white-space:nowrap;color:#374151">내 위치</button>
      </div>
      <input type="hidden" id="_reg_lat">
      <input type="hidden" id="_reg_lng">

      <div style="display:flex;gap:8px">
        <button id="_reg_cancel"
          style="flex:1;padding:13px;border:1px solid #e5e7eb;border-radius:10px;
                 background:none;cursor:pointer;font-size:14px;font-family:inherit">취소</button>
        <button id="_reg_ok"
          style="flex:2;padding:13px;border:none;border-radius:10px;
                 background:#1A73E8;color:#fff;cursor:pointer;
                 font-size:14px;font-weight:700;font-family:inherit">${btnLabel}</button>
      </div>
    </div>`;
  document.body.appendChild(ov);

  const inp   = ov.querySelector('#_reg_name');
  const okBtn = ov.querySelector('#_reg_ok');
  inp.focus();

  // 지역 자동 설정 (Kakao 역지오코딩, register-profile.html 동일 방식)
  const locBtn    = ov.querySelector('#_reg_loc_btn');
  const regionInp = ov.querySelector('#_reg_region');
  const latInp    = ov.querySelector('#_reg_lat');
  const lngInp    = ov.querySelector('#_reg_lng');

  const _autoRegion = () => {
    if (!navigator.geolocation) return;
    locBtn.textContent = '확인 중…'; locBtn.disabled = true;
    navigator.geolocation.getCurrentPosition(async pos => {
      const { latitude: lat, longitude: lng } = pos.coords;
      latInp.value = lat; lngInp.value = lng;
      try {
        const res  = await fetch(`${PROXY}/geocode?lat=${lat}&lng=${lng}`);
        const data = await res.json();
        const doc  = data?.documents?.[0];
        const addr = doc?.road_address?.address_name
                  || doc?.address?.address_name
                  || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        regionInp.value = addr;
      } catch {
        regionInp.value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      }
      locBtn.textContent = '재검색'; locBtn.disabled = false;
    }, () => { locBtn.textContent = '내 위치'; locBtn.disabled = false; });
  };

  locBtn.onclick = _autoRegion;
  // 모달 열리자마자 자동 시도
  _autoRegion();

  inp.addEventListener('focus', () => inp.style.borderColor = '#1A73E8');
  inp.addEventListener('blur',  () => inp.style.borderColor = '#e5e7eb');
  ov.querySelector('#_reg_cancel').onclick = () => ov.remove();

  const doRegister = async () => {
    const name = inp.value.trim();
    if (!name) { inp.focus(); inp.style.borderColor = '#ef4444'; return; }

    okBtn.disabled = true;
    okBtn.textContent = '등록 중…';

    const region = regionInp?.value?.trim() || '';
    await _registerToL1(name, region);

    if (!_USER?.handle) {
      okBtn.disabled = false;
      okBtn.textContent = btnLabel;
      inp.style.borderColor = '#ef4444';
      let errEl = ov.querySelector('#_reg_err');
      if (!errEl) {
        errEl = document.createElement('p');
        errEl.id = '_reg_err';
        errEl.style.cssText = 'font-size:12px;color:#ef4444;margin:8px 0 0;text-align:center';
        okBtn.parentNode.appendChild(errEl);
      }
      errEl.textContent = '⚠️ 등록에 실패했습니다. 네트워크를 확인하고 다시 시도해 주세요.';
      return;
    }

    ov.remove();
    _updateHandleChip(_USER.handle);
    await onSuccess();
  };

  okBtn.onclick = doRegister;
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') doRegister(); });
}
