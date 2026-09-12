/**
 * ui/settings.js — 설정 패널
 */
import { CFG, loadSettings, PROVIDER_INFO } from '../core/config.js';
import { _isRegistered, _isGDCUser, ensureX25519Synced } from '../core/auth.js';
import { _USER } from '../core/state.js';
import { appendBubble } from './bubble.js';
import { SKIN_COLOR_KEY, watchHondiSkin, setHondiSkin } from '../../../assets/hondi-skin.js';
import { phoneToDigits, digitsToId, generateDigitCodeDataURL, VALID_AREA_CODES }
  from '../ai/hondi-digit-code.js';

// ── 스킨 색상 (webapp.html 본문 + 좌/우 슬라이드 메뉴 공통) ─────
// 팔레트 정의는 /assets/hondi-skin.js 한 곳에만 있다(과거에는 이
// 값이 이 파일과 left-menu.html/right-menu.html에 각각 복사돼
// 있었음). 여기서는 저장 + "지금 열려 있는 webapp.html 본문"의
// --green 계열 및 --accent-teal 계열 변수 갱신만 담당한다.
// 좌/우 메뉴 iframe은 각자 storage 이벤트로 동일한 값을 받아 적용한다.
const WEBAPP_SKIN_VARMAP = {
  '--green': 'accent', '--green-lt': 'lt', '--green-dk': 'dk', '--green-bd': 'bd',
  '--tint': 'accent',
  '--accent-teal': 'accent', '--accent-teal-lt': 'lt',
};

// 앱 시작 시 이전에 저장된 스킨이 있으면 본문에도 바로 적용
watchHondiSkin(WEBAPP_SKIN_VARMAP);

export function applySkinColor(key) {
  setHondiSkin(key);              // localStorage 저장 + 스와치 선택 표시 (공유 모듈)
  watchHondiSkin(WEBAPP_SKIN_VARMAP); // 본문 즉시 반영 (메뉴는 storage 이벤트로 자동 반영)
}

// 설정 패널을 열 때 현재 저장된 스킨에 맞춰 스와치 선택 표시를 동기화
function _syncSkinSwatchSelection() {
  const current = localStorage.getItem(SKIN_COLOR_KEY);
  document.querySelectorAll('.skin-swatch').forEach(el => {
    el.classList.toggle('is-selected', el.dataset.skin === current);
  });
}

// ── 핸들 칩 업데이트 ────────────────────────────────────
export function _updateHandleChip(h) {
  const c = document.getElementById('my-handle-chip');
  if (c) c.textContent = h || 'Guest';

  const s = document.getElementById('gopang-id-status');
  const b = document.getElementById('gopang-id-register-box');
  if (h) {
    const nickname = _USER?.nickname || _USER?.name || '';
    const nickPrefix = nickname ? `${nickname} ` : '';
    if (s) s.innerHTML = `${nickPrefix}<b style="color:#007b8b">${h}</b>`;
    if (b) b.style.display = 'none';
  } else {
    if (s) s.textContent = '등록되지 않았습니다.';
    if (b) b.style.display = 'block';
  }
}

// ── 설정 패널 열기 ───────────────────────────────────────
export function openSettings() {
  const registered = _isRegistered();
  const isGDC      = _isGDCUser();

  if (typeof _updateLogoutBtn === 'function') _updateLogoutBtn();

  // 1. 아이디 등록 박스: Guest만 표시
  const registerBox = document.getElementById('gopang-id-register-box');
  if (registerBox) registerBox.style.display = registered ? 'none' : 'block';

  // 2. 아이디 상태 표시
  const idStatus = document.getElementById('gopang-id-status');
  if (idStatus) {
    if (registered) {
      const s = JSON.parse(localStorage.getItem('gopang_user_v4') || sessionStorage.getItem('gopang_user_v4') || '{}');
      const nickPrefix = s.nickname ? `${s.nickname} ` : '';
      idStatus.innerHTML = `${nickPrefix}<b style="color:#007b8b">${s.handle}</b>`;
    } else {
      idStatus.textContent = '등록되지 않았습니다.';
    }
  }

  // 2-1. 혼디 코드 썸네일
  if (registered) _renderHondiCodeThumb();
  else { const t = document.getElementById('hondi-code-thumb'); if (t) t.style.display = 'none'; }

  // 3. Guest 등록 유도 안내
  const idSec = document.getElementById('gopang-id-section');
  if (idSec) {
    if (!registered) {
      if (!document.getElementById('_id-section-guide')) {
        const g = document.createElement('p');
        g.id = '_id-section-guide';
        g.style.cssText = 'font-size:12px;color:#007b8b;font-weight:600;margin-bottom:8px;' +
                          'background:#d3f7ff;border-radius:8px;padding:8px 10px;line-height:1.5';
        g.innerHTML = '아이디를 등록하면 AI 비서와 P2P 채팅을 사용할 수 있습니다.';
        idSec.insertBefore(g, idSec.firstChild);
      }
    } else {
      document.getElementById('_id-section-guide')?.remove();
    }
  }

  // 4. GDC Wallet 섹션: GDC 사용자만 표시
  const gdcSec = document.getElementById('gdc-wallet-section');
  if (gdcSec) gdcSec.style.display = isGDC ? 'block' : 'none';
  // 2026-08-28 신설 — 설정 패널을 열 때마다 서버 실잔액으로 재대사
  // (hydrateFromServer가 로그인 시점에만 불려 이후 차감/충전이 화면에
  // 전혀 반영되지 않던 문제의 부분 수정 — 자세한 배경은
  // gopang-wallet.js의 refreshBalanceUI() 주석 참조). fire-and-forget:
  // 패널이 이미 열린 뒤 값이 늦게 갱신돼도 무방하다.
  if (isGDC && window.gopangWallet?.refreshBalanceUI) {
    window.gopangWallet.refreshBalanceUI().catch(() => {});
  }

  // 5. AI 설정 카드: 등록 사용자만 표시
  const aiCard      = document.getElementById('_ai-card');
  const aiLabel     = document.getElementById('_ai-label');
  const profileCard = document.getElementById('_profile-card');
  if (profileCard) profileCard.style.display = registered ? 'block' : 'none';
  if (aiCard)  aiCard.style.display  = registered ? 'block' : 'none';
  if (aiLabel) aiLabel.style.display = registered ? 'block' : 'none';

  // 6. 계정 삭제 카드(위험 구역): 등록 사용자만 표시
  // 입력값 초기화는 openAccountDelete()가 슬라이드아웃을 열 때마다 직접
  // 처리하므로, 여기서는 카드 자체의 노출 여부만 관리한다.
  const deleteCard = document.getElementById('card-account-delete');
  if (deleteCard) deleteCard.style.display = registered ? 'block' : 'none';

  _updateSecuritySection();
  _syncSkinSwatchSelection();
  document.getElementById('settings-overlay')?.classList.add('open');
}

// ── 설정 패널 닫기 ───────────────────────────────────────
export function closeSettings() {
  document.getElementById('settings-overlay')?.classList.remove('open');
}

export function handleOverlayClick(e) {
  if (e.target.id === 'settings-overlay') closeSettings();
}

// ── AI 설정 슬라이드 패널 ────────────────────────────────
// v2(2026-07-01): Flash/Pro 수동 선택 UI 제거. 이제 사용자는 모델을
// 고를 필요가 없다 — call-ai.js의 _resolveHondiTier()가 매 턴 질문의
// 복잡도를 스스로 판단해 hondi-flash/hondi-pro를 자동으로 고른다.
export function openAISettings() {
  const sysEl = document.getElementById('setting-system');
  if (sysEl) sysEl.value = CFG.system;
  document.getElementById('ai-settings-overlay')?.classList.add('open');

  // Phase 7(AI 종합 위법 가능성 판단) 저장된 상태 반영
  const p7Toggle  = document.getElementById('setting-phase7-enabled');
  const p7Tier    = document.getElementById('setting-phase7-tier');
  const p7TierRow = document.getElementById('setting-phase7-tier-row');
  if (p7Toggle) {
    p7Toggle.checked = !!CFG.phase7?.enabled;
    if (p7Tier)    p7Tier.value = CFG.phase7?.tier === 'pro' ? 'pro' : 'flash';
    if (p7TierRow) p7TierRow.style.display = p7Toggle.checked ? 'flex' : 'none';
  }

  // ── X25519 자동 부트스트랩 (공장초기화 후 첫 진입 시 자동 개시) ──
  // PC(ai-setup.html)가 이 공개키로 API 설정을 암호화해 보낼 수 있도록
  // 설정 창을 열 때마다 보장 — 이미 있으면 아무 일도 하지 않음
  _ensurePcSyncReady();

  // ── 무료 한도 사용 현황 (2026-07-01 신설) ──
  // 본인 키를 등록하지 않은 사용자에게만 의미가 있으므로, 등록자는 숨긴다.
  _loadFreeQuotaStatus();
}

// 무료 한도(deepseek-default) 사용 현황 조회 — worker.js GET /free-quota-status
async function _loadFreeQuotaStatus() {
  const box = document.getElementById('free-quota-status-box');
  if (!box) return;
  const hasOwnKey = Array.isArray(CFG.providers) && CFG.providers.length > 0;
  if (hasOwnKey) { box.style.display = 'none'; return; }

  const guid = _USER?.ipv6 ||
    JSON.parse(localStorage.getItem('gopang_user_v4') || sessionStorage.getItem('gopang_user_v4') || '{}')?.ipv6;
  if (!guid) { box.style.display = 'none'; return; }

  try {
    const res = await fetch(`${CFG.endpoint.replace(/\/+$/, '')}/free-quota-status?guid=${encodeURIComponent(guid)}`);
    const d = await res.json();
    if (!d.ok) { box.style.display = 'none'; return; }

    box.style.display = 'block';
    const pct = Math.min(Math.round((d.spent_krw / d.limit_krw) * 100), 100);
    box.innerHTML = `
      <div style="font-size:12.5px;color:#374151;margin-bottom:6px">
        혼디 무료 제공분 <b>${d.spent_krw.toLocaleString()}원</b> / ${d.limit_krw.toLocaleString()}원 사용
      </div>
      <div style="height:6px;border-radius:3px;background:#eee;overflow:hidden;margin-bottom:8px">
        <div style="height:100%;width:${pct}%;background:${pct >= 90 ? '#dc2626' : '#1A73E8'}"></div>
      </div>
      ${d.estimated_monthly_krw > 0
        ? `<div style="font-size:12px;color:#6b7280">지금 쓰시는 속도라면 한 달에 대략 <b>${d.estimated_monthly_krw.toLocaleString()}원</b> 정도예요.
           본인 키를 등록하시면 이 한도 없이 계속 쓰실 수 있어요.</div>`
        : `<div style="font-size:12px;color:#6b7280">아직 대화를 시작하기 전이에요.</div>`}
    `;
  } catch (e) {
    box.style.display = 'none';
    console.warn('[FreeQuota] 조회 실패:', e.message);
  }
}

// ── "사용량 보기" 메뉴 (2026-07-14 신설) ──────────────────
// 설정 창 > GDC Wallet 섹션의 "사용량 보기" 행에서 호출된다.
// GDC 잔액 + 무료 한도 사용 현황을 DeepSeek 플랫폼 Usage 페이지와
// 유사한 형식의 대시보드로, 별도 탭(usage.html)에서 보여준다.
// 새 탭으로 여는 이유: 설정 시트(바텀시트)는 화면이 좁아 표·그래프
// 형태의 사용량 내역을 담기 부적합하고, 사용자가 이 페이지만 즐겨찾기
// 하거나 나중에 다시 열어보기도 편해진다.
window._openUsagePage = function () {
  const guid = _USER?.ipv6 ||
    JSON.parse(localStorage.getItem('gopang_user_v4') || sessionStorage.getItem('gopang_user_v4') || '{}')?.ipv6;
  if (!guid) {
    alert('사용량을 보려면 먼저 가입/로그인이 필요합니다.');
    return;
  }
  const url = `/usage.html?guid=${encodeURIComponent(guid)}`;
  // 2026-08-28 신설(주피터 지시: "웹앱 기준으로 설명하라") — iOS에서
  // 홈 화면에 설치된 standalone 앱 안에서 window.open()으로 새 탭을
  // 열면 Safari로 튕겨져 나가면서 standalone 컨텍스트 자체가 깨진다
  // (iOS PWA의 알려진 제약 — 여러 창/탭을 지원하지 않음). 이러면
  // usage.html이 "이미 설치된 앱인데도 설치 안내"를 잘못 띄우게 된다
  // (display-mode: standalone이 false로 보임). standalone으로 이미
  // 실행 중이면 같은 창 안에서 이동해 그 컨텍스트를 유지하고, 일반
  // 브라우저 탭에서 열린 경우(기존 동작)만 새 탭으로 연다.
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                        window.navigator.standalone === true;
  if (isStandalone) {
    window.location.href = url;
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

// ── PC→휴대폰 동기화 준비: X25519 키 보장 + 등록 + 대기 중인 PC 설정 확인 ──
async function _ensurePcSyncReady() {
  const guid = _USER?.ipv6 || JSON.parse(localStorage.getItem('gopang_user_v4') || sessionStorage.getItem('gopang_user_v4') || '{}')?.ipv6;
  if (!guid) {
    console.warn('[AI설정] guid를 찾을 수 없어 PC 동기화 안내를 건너뜁니다.');
    return;
  }

  try {
    const result = await ensureX25519Synced(guid);
    if (!result.ok) {
      console.warn('[AI설정] X25519 동기화 미완료:', result.reason || '(원인 미상)');
      const REASON_MSG = {
        guid_missing:              '사용자 식별 정보를 찾을 수 없습니다. 다시 로그인해 주세요.',
        wallet_module_not_loaded:  '지갑 모듈을 불러오지 못했습니다. 앱을 다시 열어 주세요.',
        wallet_not_found:          '지갑이 아직 생성되지 않았습니다. 잠시 후 다시 열어 주세요.',
        wallet_locked:             '이 기기의 지갑을 열 수 없습니다. 화면 하단의 복구 안내를 확인해 주세요.',
        PUBKEY_MISMATCH:           '이 기기는 이 계정에 등록된 기기가 아닙니다. 화면 하단의 복구 안내를 확인해 주세요.',
        network:                   '네트워크 오류로 암호화 키를 등록하지 못했습니다. 잠시 후 다시 열어 주세요.',
      };
      _renderPcSyncBanner({
        _error: true,
        message: REASON_MSG[result.reason] || (result.reason || '암호화 키를 아직 준비하지 못했습니다. 설정 창을 한 번 더 열어 주세요.'),
      });
      return;
    }

    console.info('[AI설정] X25519 동기화 완료, PC 설정 확인 중...');
    _pollPcSealedSetting(guid, result.wallet);
  } catch(e) {
    console.warn('[AI설정] X25519 부트스트랩 실패:', e.message);
    _renderPcSyncBanner({ _error: true, message: '암호화 키 준비 중 오류가 발생했습니다: ' + e.message });
  }
}

// ── PC가 보낸 암호화 봉투가 있는지 확인하고, 있으면 복호화하여 안내 ──
async function _pollPcSealedSetting(guid, wallet) {
  try {
    const res  = await fetch(`${CFG.endpoint}/ai-setup/seal?guid=${encodeURIComponent(guid)}`);
    const data = await res.json();
    if (!data.ok || !data.sealed) {
      _renderPcSyncBanner({ _idle: true }, guid);
      return;
    }

    // 서버는 DB 컬럼명(snake_case)을 그대로 반환하지만, wallet.openSealed는
    // ephemeralPubKey(camelCase)를 기대한다 — 여기서 맞춰준다.
    const sealedCamel = {
      ephemeralPubKey: data.sealed.ephemeral_pubkey,
      iv:              data.sealed.iv,
      ciphertext:      data.sealed.ciphertext,
    };

    const plaintext = await wallet.openSealed(sealedCamel);
    const parsed = JSON.parse(plaintext);  // { provider, model, apiKey, systemPrompt? }
    _renderPcSyncBanner(parsed, guid);
  } catch(e) {
    console.warn('[AI설정] PC 봉투 확인 실패:', e.message);
    _renderPcSyncBanner({ _idle: true }, guid);
  }
}

// ── "PC에서 입력하세요" 안내 / "PC에서 보낸 설정이 있습니다" 배너 렌더링 ──
function _renderPcSyncBanner(parsed, guid) {
  const host = document.getElementById('ai-settings-body') || document.body;
  let banner = document.getElementById('_pc-sync-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = '_pc-sync-banner';
    banner.style.cssText = 'margin:0 16px 12px;padding:14px 16px;border-radius:12px;font-size:13px;line-height:1.6';
    host.insertBefore(banner, host.firstChild);
  }

  if (!parsed) { banner.style.display = 'none'; return; }

  if (parsed._error) {
    banner.style.display = 'block';
    banner.style.background = '#fef2f2';
    banner.style.color = '#991b1b';
    banner.innerHTML = `⚠️ ${parsed.message}`;
    return;
  }

  // PC가 아직 아무것도 보내지 않은 기본 상태. v3.3(2026-07-01)부터는
  // DeepSeek V4 Flash가 가입 즉시 무료 한도 내에서 자동 제공되므로,
  // "PC에서 키를 등록하라"는 안내 자체가 불필요하다 — 조용히 숨긴다.
  if (parsed._idle) {
    banner.style.display = 'none';
    return;
  }

  const _displayLabel = Array.isArray(parsed.freeModelPool) && parsed.freeModelPool.length
    ? 'OpenRouter (무료 모델 ' + parsed.freeModelPool.length + '개 자동 순환)'
    : (PROVIDER_INFO[parsed.provider]?.label || parsed.provider);

  banner.style.display = 'block';
  banner.style.background = '#d3f7ff';
  banner.style.color = '#166534';
  banner.innerHTML = `
    🔒 PC에서 <b>${_displayLabel}</b> 설정이 암호화되어 도착했습니다.${parsed.systemPrompt ? '<br>시스템 프롬프트도 함께 도착했습니다.' : ''}<br>
    <button id="_pc-sync-accept" style="margin-top:8px;padding:8px 14px;border:none;border-radius:8px;background:#007b8b;color:#fff;font-size:12.5px;font-weight:600;cursor:pointer">이 설정으로 등록하기</button>
    <button id="_pc-sync-dismiss" style="margin-top:8px;margin-left:6px;padding:8px 14px;border:none;border-radius:8px;background:transparent;color:#166534;font-size:12.5px;cursor:pointer">무시</button>
  `;

  document.getElementById('_pc-sync-accept').onclick = async () => {
    await _acceptPcSyncedSetting(parsed, guid);
  };
  document.getElementById('_pc-sync-dismiss').onclick = async () => {
    await fetch(`${CFG.endpoint}/ai-setup/seal?guid=${encodeURIComponent(guid)}&consume=1`).catch(()=>{});
    banner.style.display = 'none';
  };
}

// ── 앱 부트스트랩 시점 자동 동기화 — AI 설정 화면을 열지 않아도 PC가 보낸
// LLM Key 설정을 확인 즉시 적용한다. 사용자 확인 버튼 없이 자동 적용.
// ── 백그라운드 수신 시 bubble 큐 — 포그라운드 복귀 시 flush ──
const _pendingBubbles = [];
let _pendingFlushRegistered = false;

function _enqueueBubble(role, text) {
  const list = document.getElementById('message-list');
  if (list) {
    // 채팅창이 이미 열려있으면 즉시 출력
    appendBubble(role, text);
    return;
  }
  // 백그라운드 상태 — 큐에 적재
  _pendingBubbles.push({ role, text });
  if (!_pendingFlushRegistered) {
    _pendingFlushRegistered = true;
    document.addEventListener('visibilitychange', function _flush() {
      if (document.visibilityState !== 'visible') return;
      const list = document.getElementById('message-list');
      if (!list) return;
      let item;
      while ((item = _pendingBubbles.shift())) {
        appendBubble(item.role, item.text);
      }
      document.removeEventListener('visibilitychange', _flush);
      _pendingFlushRegistered = false;
    });
  }
}

export async function _autoApplyPcSyncedSetting() {
  const guid = _USER?.ipv6 ||
    JSON.parse(localStorage.getItem('gopang_user_v4') || sessionStorage.getItem('gopang_user_v4') || '{}')?.ipv6;
  if (!guid) {
    console.info('[AI설정][자동] guid 없음 — 미등록 사용자, 건너뜀');
    return true; // 재시도할 대상 자체가 없음 — 실패로 취급하지 않음 (백오프 누적 방지)
  }

  console.info('[AI설정][자동] 시작 — guid:', guid.slice(0, 12) + '...');

  let result = await ensureX25519Synced(guid);
  if (!result.ok) {
    console.warn('[AI설정][자동] X25519 1차 시도 실패:', result.reason, '— 1.5초 후 재시도');
    await new Promise(r => setTimeout(r, 1500));
    result = await ensureX25519Synced(guid);
    if (!result.ok) {
      console.error('[AI설정][자동] X25519 재시도도 실패:', result.reason, '— 자동 적용 중단');
      return false; // 호출부가 이 신호로 다음 재시도 간격을 늘림(백오프)
    }
  }
  console.info('[AI설정][자동] X25519 준비 완료');

  try {
    const res  = await fetch(`${CFG.endpoint}/ai-setup/seal?guid=${encodeURIComponent(guid)}`);
    const data = await res.json();
    if (!data.ok || !data.sealed) {
      console.info('[AI설정][자동] 대기 중인 PC 설정 없음 — 정상 종료');
      return true;
    }

    console.info('[AI설정][자동] PC 설정 발견 — 복호화 시도');
    const sealedCamel = {
      ephemeralPubKey: data.sealed.ephemeral_pubkey,
      iv:              data.sealed.iv,
      ciphertext:      data.sealed.ciphertext,
    };
    const plaintext = await result.wallet.openSealed(sealedCamel);
    const parsed = JSON.parse(plaintext);

    console.info('[AI설정][자동] 복호화 성공 — provider:', parsed.provider, 'model:', parsed.model);
    await _acceptPcSyncedSetting(parsed, guid, { silent: true });

    _enqueueBubble('ai', 'PC로부터 AI 키 도착 및 설정 완료. 상단 AI 버튼을 클릭하여, 자신 만의 AI 비서로 훈련하십시오.');
    console.info('[AI설정][자동] 적용 완료');
    return true;
  } catch(e) {
    console.error('[AI설정][자동] 처리 중 오류:', e.message, e.stack);
    return false; // 복호화·등록 단계 오류도 백오프 대상으로 취급
  }
}

// ── PC가 보낸 설정을 휴대폰의 진짜 지갑으로 서명하여 최종 등록 ──
async function _acceptPcSyncedSetting(parsed, guid, opts = {}) {
  try {
    const wallet = await window.GopangWallet.load();
    if (!wallet) throw new Error('지갑을 찾을 수 없습니다.');

    const body = {
      guid,
      pubkey: wallet.publicKeyB64u,
      provider: parsed.provider,
      model: parsed.model,
      api_key: parsed.apiKey,
      ai_active: true,
      ...(parsed.systemPrompt && { custom_prompt: parsed.systemPrompt }),
    };
    const signature = await wallet.signPayload(JSON.stringify({ ...body, signature: undefined }));
    body.signature = signature;

    const res  = await fetch(`${CFG.endpoint}/ai-setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.detail || data.error || '등록 실패');

    // 사용 완료된 봉투는 폐기
    await fetch(`${CFG.endpoint}/ai-setup/seal?guid=${encodeURIComponent(guid)}&consume=1`).catch(()=>{});

    // 화면 갱신
    CFG.model = parsed.model;
    if (Array.isArray(parsed.freeModelPool) && parsed.freeModelPool.length) {
      // OpenRouter 등 무료 모델 풀 — CFG.providers 배열에 순서대로 등록
      // call-ai.js의 _buildCallCandidates()가 이 배열을 순차 페일오버 후보로 사용
      if (!Array.isArray(CFG.providers)) CFG.providers = [];
      CFG.providers = CFG.providers.filter(p => p.provider !== parsed.provider);
      for (const m of parsed.freeModelPool) {
        CFG.providers.push({ provider: parsed.provider, model: m, apiKey: parsed.apiKey });
      }
      console.info(`[AI설정] ${parsed.provider} 무료 모델 풀 ${parsed.freeModelPool.length}개 등록 (페일오버 순서 유지)`);
    } else if (parsed.provider === 'gemini') {
      CFG.geminiKey = parsed.apiKey;
    } else {
      CFG.apiKey = parsed.apiKey;
    }
    if (parsed.systemPrompt) CFG.system = parsed.systemPrompt;

    try {
      localStorage.setItem('gopang_cfg', JSON.stringify({
        model: CFG.model, endpoint: CFG.endpoint,
        apiKey: CFG.apiKey, geminiKey: CFG.geminiKey,
        system: CFG.system, providers: CFG.providers,
      }));
    } catch {}

    // (등록된 LLM 모델 섹션을 삭제했으므로 이 시점의 화면 갱신은 불필요)
    const sysEl = document.getElementById('setting-system');
    if (sysEl && parsed.systemPrompt) sysEl.value = parsed.systemPrompt;
    document.getElementById('_pc-sync-banner')?.style && (document.getElementById('_pc-sync-banner').style.display = 'none');
    if (!opts.silent) {
      const _doneLabel = Array.isArray(parsed.freeModelPool) && parsed.freeModelPool.length
        ? 'OpenRouter (무료 모델 ' + parsed.freeModelPool.length + '개 자동 순환)'
        : (PROVIDER_INFO[parsed.provider]?.label || parsed.provider);
      if (typeof appendBubble === 'function') appendBubble('ai', `⚙️ PC에서 보낸 ${_doneLabel} 설정이 등록되었습니다.`);
    }
  } catch(e) {
    alert('등록 중 오류가 발생했습니다: ' + e.message);
  }
}

export function closeAISettings() {
  document.getElementById('ai-settings-overlay')?.classList.remove('open');
}

export function handleAISettingsOverlayClick(e) {
  const sheet = document.querySelector('#ai-settings-overlay .settings-sheet');
  if (sheet && !sheet.contains(e.target)) closeAISettings();
}

// ── 보안 섹션 업데이트 ───────────────────────────────────
export function _updateSecuritySection() {
  const stored  = JSON.parse(localStorage.getItem('gopang_user_v4') || sessionStorage.getItem('gopang_user_v4') || 'null');
  const levelEl = document.getElementById('auth-level-display');
  const idEl    = document.getElementById('gopang-id-display');
  const fpBtn   = document.getElementById('btn-register-fp');

  if (fpBtn) fpBtn.style.display = 'none';

  if (!stored?.ipv6) {
    if (levelEl) levelEl.textContent = '미등록 사용자';
    return;
  }

  if (levelEl) levelEl.innerHTML =
    `<span style="font-size:13px;color:#007b8b">${stored.handle || stored.ipv6}</span>`;
  if (idEl) idEl.textContent = '';
}

// ── 설정에서 아이디 등록 버튼 ────────────────────────────
export async function _settingsRegisterHandle() {
  const inp  = document.getElementById('gopang-id-input');
  const name = inp?.value?.trim().replace(/\D/g,'').slice(0,8) || '';
  if (!name || !/^\d{8}$/.test(name)) { inp?.focus(); return; }

  const btn = document.getElementById('gopang-id-register-btn') ||
              document.querySelector('#gopang-id-register-box button');
  if (btn) { btn.disabled = true; btn.textContent = '등록 중…'; }

  const { _registerToL1 } = await import('../core/auth.js');
  await _registerToL1(name);
  _updateHandleChip(_USER?.nickname || _USER?.handle || null);
  if (typeof _updateLogoutBtn === 'function') _updateLogoutBtn();

  if (btn) { btn.disabled = false; btn.textContent = '아이디 등록'; }

  // [16] 등록 완료 후 설정 창 재호출 (상태 갱신)
  openSettings();
}

// ── SW 캐시 초기화 ───────────────────────────────────────
export async function clearSWCache() {
  if (!navigator.serviceWorker) { alert('Service Worker 없음'); return; }
  const keys = await caches.keys();
  await Promise.all(keys.map(k => caches.delete(k)));
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map(r => r.unregister()));
  alert('캐시 초기화 완료. 페이지를 새로고침합니다.');
  location.reload();
}

// ── 푸시 알림 재구독 (2026-07-22 신설) ──────────────────────
// device-link(기기 간 지갑 이전) 웹푸시가 안 오는 문제를 사용자가
// javascript: 북마클릿이나 URL 파라미터(?resetpush=1) 없이도 설정
// 화면에서 바로 재시도할 수 있게 한다. 자주 쓰는 기능이 아니라
// "앱 관리" 섹션 맨 아래에 배치(webapp.html 참조). 실제 재구독 로직은
// services/push.js의 requestPushSubscription() 그대로 재사용 —
// in-flight 락이 있어 gopang-app.js의 24시간 자동 재시도와 겹쳐도
// 안전하다.
export async function _resubscribePush() {
  const guid = _USER?.ipv6 || JSON.parse(localStorage.getItem('gopang_user_v4') || 'null')?.ipv6;
  if (!guid) { alert('로그인 상태가 아닙니다.'); return; }

  const label = document.getElementById('label-resubscribe-push');
  if (label) label.textContent = '재구독 중…';

  try {
    const { requestPushSubscription } = await import('../services/push.js');
    const result = await requestPushSubscription(guid);
    if (result.ok) {
      alert('✅ 푸시 재구독 완료');
    } else if (result.reason === 'permission_denied') {
      alert('🔔 알림 권한이 꺼져 있습니다. 브라우저 설정 → 알림에서 허용해 주세요.');
    } else {
      alert('⚠️ 재구독 실패: ' + (result.reason || '알 수 없는 오류'));
    }
  } finally {
    if (label) label.textContent = '푸시 알림 재구독';
  }
}

// ══════════════════════════════════════════════════════════════
// ① 이전 대화 기록
// ══════════════════════════════════════════════════════════════
export function openChatHistory() {
  const user = JSON.parse(localStorage.getItem('gopang_user_v4') || '{}');
  const guid = user.ipv6 || '';

  // 모든 날짜의 기록 수집
  const allSessions = [];
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(`gopang_history_${guid}`)) continue;
    const entries = JSON.parse(localStorage.getItem(key) || '[]');
    allSessions.push(...entries.filter(e => e.domain === 'P2P' || e.peerHandle));
  }
  allSessions.sort((a, b) => new Date(b.ts) - new Date(a.ts));

  _openSheet('이전 대화 기록', _renderHistoryList(allSessions));
}

function _renderHistoryList(sessions) {
  if (!sessions.length) {
    return '<div style="padding:40px 16px;text-align:center;color:#9ca3af;font-size:14px">대화 기록이 없습니다.</div>';
  }
  return sessions.map((s, i) => `
    <div onclick="_openChatDetail(${i})" data-idx="${i}"
         style="padding:14px 16px;border-bottom:1px solid #f2f2f7;cursor:pointer;display:flex;align-items:center;gap:12px">
      <div style="width:40px;height:40px;border-radius:50%;background:#eafcff;
                  display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">💬</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:15px;font-weight:500;color:#111827">${s.peerHandle || '알 수 없음'}</div>
        <div style="font-size:12px;color:#9ca3af;margin-top:2px">
          ${new Date(s.ts).toLocaleString('ko-KR')} · ${s.turns}턴
        </div>
      </div>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#c7c7cc" stroke-width="2.5"
           stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </div>
  `).join('');
}

window._openChatDetail = async function(idx) {
  const user = JSON.parse(localStorage.getItem('gopang_user_v4') || '{}');
  const guid = user.ipv6 || '';

  // IndexedDB에서 원본 찾기
  const allSessions = [];
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(`gopang_history_${guid}`)) continue;
    const entries = JSON.parse(localStorage.getItem(key) || '[]');
    allSessions.push(...entries.filter(e => e.domain === 'P2P' || e.peerHandle));
  }
  allSessions.sort((a, b) => new Date(b.ts) - new Date(a.ts));
  const session = allSessions[idx];
  if (!session) return;

  // IndexedDB에서 원문 조회
  let messages = session.summary || [];
  try {
    const db = await new Promise(r => { const req = indexedDB.open('gopang_pdv_dev'); req.onsuccess = e => r(e.target.result); });
    const tx = db.transaction('messages', 'readonly');
    const rec = await new Promise(r => { const req = tx.objectStore('messages').get(session.sessionId); req.onsuccess = e => r(e.target.result); });
    if (rec?.content) {
      const data = JSON.parse(rec.content);
      messages = data.messages || messages;
    }
  } catch(e) {}

  const html = `
    <div style="padding:0">
      <div style="padding:12px 16px;border-bottom:1px solid #f2f2f7;display:flex;align-items:center;gap:10px">
        <button onclick="openChatHistory()" style="border:none;background:none;color:#007b8b;font-size:15px;cursor:pointer;padding:0">← 목록</button>
        <span style="font-size:15px;font-weight:600">${session.peerHandle || '대화'}</span>
      </div>
      <div style="padding:16px;display:flex;flex-direction:column;gap:8px">
        ${messages.map(m => m.role === 'me' || m.role === 'user'
          ? `<div style="display:flex;justify-content:flex-end">
               <div style="background:#007b8b;color:#fff;padding:8px 12px;border-radius:16px 16px 4px 16px;max-width:70%;font-size:14px">${m.content}</div>
             </div>`
          : `<div style="display:flex;justify-content:flex-start">
               <div style="background:#f3f4f6;color:#111827;padding:8px 12px;border-radius:16px 16px 16px 4px;max-width:70%;font-size:14px">${m.content}</div>
             </div>`
        ).join('')}
      </div>
    </div>`;

  document.getElementById('_gopang-sheet-body').innerHTML = html;
};

// ══════════════════════════════════════════════════════════════
// ② Hash Chain 보기
// ══════════════════════════════════════════════════════════════
export function openHashChain() {
  // BUG-FIX(2026-07-02): webapp.html에서 window.openHashChain을 나중에
  // wrapping해서 튜토리얼 신호(_tutorialSignal('pdv_open'))를 붙이려던
  // 방식은 구조적으로 항상 실패했다 — webapp.html의 classic 스크립트가
  // gopang-app.js(type=module, 게다가 top-level await로 initAuth()까지
  // 기다림)보다 먼저 실행되어 wrapping 시점엔 window.openHashChain이
  // 아직 없고, 이후 gopang-app.js의 exposeGlobals()가 원본 함수로 그냥
  // 덮어써버려 wrapping이 무효화됐다. wrapping 대신 여기서 직접 신호를
  // 보낸다 — 순서 문제 자체가 발생할 수 없다.
  if (typeof window._tutorialSignal === 'function') window._tutorialSignal('pdv_open');
  if (typeof window._resetTutorialWatchdog === 'function') window._resetTutorialWatchdog();

  const user = JSON.parse(localStorage.getItem('gopang_user_v4') || '{}');
  const guid = user.ipv6 || '';

  // localStorage의 history에서 entryHash 수집
  const chains = [];
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(`gopang_history_${guid}`)) continue;
    const entries = JSON.parse(localStorage.getItem(key) || '[]');
    for (const e of entries) {
      if (e.entryHash) chains.push(e);
    }
  }
  chains.sort((a, b) => new Date(b.ts) - new Date(a.ts));

  const html = chains.length === 0
    ? '<div style="padding:40px 16px;text-align:center;color:#9ca3af;font-size:14px">Hash Chain 기록이 없습니다.</div>'
    : chains.map((c, i) => `
      <div style="padding:12px 16px;border-bottom:1px solid #f2f2f7">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span style="font-size:11px;background:#eafcff;color:#007b8b;padding:2px 6px;border-radius:4px;font-weight:600">
            ${i === chains.length - 1 ? 'Genesis' : 'L' + (i + 1)}
          </span>
          <span style="font-size:11px;color:#9ca3af">${new Date(c.ts).toLocaleString('ko-KR')}</span>
        </div>
        <div style="font-family:monospace;font-size:11px;color:#374151;word-break:break-all;background:#f9fafb;padding:6px 8px;border-radius:6px">
          ${c.entryHash}
        </div>
        <div style="font-size:11px;color:#9ca3af;margin-top:4px">
          ${c.peerHandle ? `P2P: ${c.peerHandle}` : c.domain || ''} · ${c.turns || 0}턴
        </div>
      </div>`).join('');

  _openSheet('Hash Chain', html);
}

// ══════════════════════════════════════════════════════════════
// ③ Gopang Wallet
// ══════════════════════════════════════════════════════════════
export async function openGopangWallet() {
  const user = JSON.parse(localStorage.getItem('gopang_user_v4') || '{}');
  const guid = user.ipv6 || '';

  _openSheet('Gopang Wallet', '<div style="padding:40px 16px;text-align:center;color:#9ca3af;font-size:14px">로딩 중...</div>');

  try {
    const { PROXY } = await import('../core/state.js');

    // 2026-07-13 신설 — 재무제표(fs)는 서버 프로필 레코드에 저장된 적이
    // 없다(사고실험으로 발견 — extra.public.finance.fs 경로가 애초에
    // 아무도 값을 쓴 적 없는 빈 자리라 이 화면이 항상 ₮0만 보여주고
    // 있었다). fs는 로컬 지갑(IndexedDB)이 유일한 원본이므로 거기서
    // 직접 읽는다.
    const wallet = window.gopangWallet;
    // 2026-08-28 신설 — 지갑 시트는 "지금 잔액이 얼마인지" 확인하려고
    // 여는 화면이라, 로컬 캐시를 보여주기 전에 서버로 재대사한다(실패
    // 해도 무시하고 로컬 값으로 폴백 — 아래 getFinancialState()가
    // 어차피 그 결과를 담은 IndexedDB를 다시 읽는다). AI 채팅 차감이나
    // 계좌입금 충전 직후 이 시트를 열어도 항상 정확한 값을 보장한다.
    if (wallet?.refreshBalanceUI) await wallet.refreshBalanceUI().catch(() => {});
    const fs = wallet?.getFinancialState ? await wallet.getFinancialState() : {};
    const balance = fs['bs-cash'] ?? 0;

    // pdv_log에서 거래 기록 조회
    const pdvRes = await fetch(`${PROXY}/pdv/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: {
          svc: 'gopang', ipv6: guid,
          scope: ['kmarket'],
          period: { start: '2026-01-01', end: new Date().toISOString().slice(0,10) },
          auth_token: { level: 'L0', exp: Math.floor(Date.now()/1000) + 3600 },
        }
      })
    }).catch(() => null);

    // 2026-08-28 신설(주피터 지시: "거래 내역이 표시되지 않습니다 —
    // 누가 언제 얼마를 입금했는지 기록") — 아래 last_tx_id 기반 섹션은
    // 전체 저장소를 뒤져도 실제로 값을 쓰는 코드가 단 한 군데도 없는
    // 죽은 필드였다(gopang-app.js 등 어디서도 setFinancialState로
    // last_tx_id를 채운 적이 없음, auth.js 가입 시 null 초기화만 있고
    // 그 후 갱신 없음) — 그래서 실제로 얼마를 충전했든 이 섹션은 항상
    // "거래 내역이 없습니다"만 보여줄 수밖에 없었다.
    //
    // 2026-08-28 추가 확장(주피터 지시: "GDC는 충전 용도만이 아니라
    // 사용자 간 결제 수단으로도 이용됩니다 — 상품 구매 등") — 처음엔
    // charge_requests(입금/충전 신청)만 가져왔는데, 이건 "충전"
    // 이벤트만 담고 있어 마켓 구매·P2P 이체·AI 사용료 차감은 전혀
    // 안 보였다. 실제 회계 원장인 ledger_entries가 이 4종
    // (mint=충전·market=구매·gdc_transfer=이체·ai_usage=AI사용료)을
    // 전부 기록하고 있으므로(pb_hooks/main.pb.js 확인) 새 엔드포인트
    // (/wallet/ledger-history — 이번에 신설, /biz/charge-status와
    // 동일하게 secret 불필요·guid 본인 것만 조회)로 가져와 합친다.
    // charge_requests는 "입금 대기" 상태(아직 ledger_entries에 안 올라간
    // pending 신청)를 보여주는 용도로만 남기고, 확정된 모든 거래는
    // ledger_entries 쪽을 신뢰 가능한 단일 소스로 삼는다 — 매칭된
    // 충전 건이 양쪽에 중복으로 안 뜨도록, charge_requests에서는
    // status==='pending'인 것만 걸러 쓴다.
    const [chargeHistory, ledgerHistory] = await Promise.all([
      fetch(`${PROXY}/biz/charge-status?guid=${encodeURIComponent(guid)}`).then(r => r.json()).catch(() => null),
      fetch(`${PROXY}/wallet/ledger-history?guid=${encodeURIComponent(guid)}`).then(r => r.json()).catch(() => null),
    ]);
    const pendingCharges = ((chargeHistory?.ok && chargeHistory.requests) ? chargeHistory.requests : [])
      .filter(r => r.status === 'pending');
    const ledgerEntries = (ledgerHistory?.ok && ledgerHistory.entries) ? ledgerHistory.entries : [];

    const _SOURCE_LABEL  = { mint: 'GDC 충전', market: '상품 구매', gdc_transfer: 'GDC 이체', ai_usage: 'AI 사용료' };
    const _SOURCE_ICON   = { mint: '💰', market: '🛍️', gdc_transfer: '↔️', ai_usage: '🤖' };

    // 두 소스를 하나의 타임라인으로 정규화(공통 필드: kind/label/icon/
    // amount/direction/timestamp/raw) — 상세 패널(_openTxDetail)이
    // kind로 원본 레코드 종류를 구분해 알맞은 6하원칙 문구를 만든다.
    const timeline = [
      ...pendingCharges.map(r => ({
        kind: 'charge_pending', raw: r,
        label: `${(r.requested_krw || 0).toLocaleString()}원 입금 신청`,
        icon: '💰', direction: 'pending', amount: r.requested_krw || 0,
        timestamp: r.created,
      })),
      ...ledgerEntries.map(r => ({
        kind: 'ledger', raw: r,
        label: _SOURCE_LABEL[r.source] || r.source || '거래',
        icon: _SOURCE_ICON[r.source] || '📄',
        direction: r.direction === 'credit' ? 'income' : 'expense',
        amount: r.amount || 0,
        timestamp: r.created,
      })),
    ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // 2026-08-28 신설(주피터 지시) — 상세 슬라이드아웃 패널(_openTxDetail)이
    // 인덱스만으로 원본 레코드 전체를 다시 조회 없이 바로 꺼내 쓸 수
    // 있도록 window에 보관해둔다. 시트를 새로 열 때마다 최신 배열로
    // 덮어쓰므로 오래된 참조가 남을 걱정은 없다.
    window._gopangWalletTimeline = timeline;

    // 2026-08-28 신설(주피터 지시: "지출/수입 상단 박스 용도가 애매하다 —
    // 모든 항목을 지출/수입으로 분류해 보여주는 게 낫겠다") — 기존
    // fs['pl-purchase']/fs['pl-revenue']는 last_tx_id와 마찬가지로 실제
    // 값을 쓰는 코드가 없는 죽은 필드였다(항상 0만 표시). 이제
    // ledger_entries의 실제 direction(credit=수입/debit=지출)으로
    // 정직하게 집계한다 — 충전은 수입, 마켓 구매·AI 사용료는 지출,
    // P2P 이체는 방향에 따라 자연스럽게 어느 한쪽으로 갈린다(내가 보낸
    // 이체는 debit, 받은 이체는 credit으로 ledger_entries에 각자
    // 기록되므로 별도 분기 불필요).
    const incomeTotal = ledgerEntries.filter(r => r.direction === 'credit').reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const expenseTotal = ledgerEntries.filter(r => r.direction === 'debit').reduce((s, r) => s + (Number(r.amount) || 0), 0);

    const html = `
      <div style="padding:20px 16px;border-bottom:1px solid #f2f2f7;text-align:center">
        <div style="font-size:32px;font-weight:700;color:#111827">₮${Math.trunc(balance).toLocaleString()}</div>
        <div style="font-size:13px;color:#9ca3af;margin-top:4px">GDC 잔액</div>
        <div style="display:flex;gap:16px;margin-top:12px;justify-content:center">
          <div style="text-align:center">
            <div style="font-size:16px;font-weight:600;color:#dc2626">-₮${Math.trunc(expenseTotal).toLocaleString()}</div>
            <div style="font-size:11px;color:#9ca3af">지출</div>
          </div>
          <div style="width:1px;background:#f2f2f7"></div>
          <div style="text-align:center">
            <div style="font-size:16px;font-weight:600;color:#007b8b">+₮${Math.trunc(incomeTotal).toLocaleString()}</div>
            <div style="font-size:11px;color:#9ca3af">수입</div>
          </div>
        </div>
      </div>
      ${timeline.length > 0 ? `
      <div style="padding:0">
        <div style="padding:10px 16px;font-size:12px;color:#9ca3af;font-weight:600">거래 내역</div>
        ${timeline.map((t, idx) => {
          const amountColor = t.direction === 'income' ? '#0F9D58' : (t.direction === 'expense' ? '#dc2626' : '#B45309');
          const amountPrefix = t.direction === 'income' ? '+' : (t.direction === 'expense' ? '-' : '');
          const statusText = t.direction === 'pending' ? '입금 대기' : '';
          return `
        <div onclick="_openTxDetail(${idx})" style="padding:14px 16px;border-bottom:1px solid #f2f2f7;display:flex;align-items:center;gap:12px;cursor:pointer">
          <div style="width:40px;height:40px;border-radius:50%;background:#f2f2f7;display:flex;align-items:center;justify-content:center;font-size:18px">${t.icon}</div>
          <div style="flex:1">
            <div style="font-size:14px;color:#111827">${t.label}</div>
            <div style="font-size:12px;color:#9ca3af">${t.timestamp ? new Date(t.timestamp).toLocaleString('ko-KR') : ''}</div>
          </div>
          <span style="font-size:13px;font-weight:600;color:${amountColor}">${statusText || `${amountPrefix}₮${Math.trunc(t.amount).toLocaleString()}`}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#c7c7cc" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>`;
        }).join('')}
      </div>` : '<div style="padding:40px 16px;text-align:center;color:#9ca3af;font-size:13px">거래 내역이 없습니다.</div>'}`;

    document.getElementById('_gopang-sheet-body').innerHTML = html;
  } catch(e) {
    document.getElementById('_gopang-sheet-body').innerHTML =
      '<div style="padding:40px 16px;text-align:center;color:#ef4444;font-size:13px">데이터 로드 실패</div>';
  }
}

// 2026-08-28 신설(주피터 지시) — 거래 내역 항목을 탭하면 열리는 6하원칙
// 상세 슬라이드아웃 패널. webapp.html의 #charge-detail-overlay(계정삭제와
// 동일한 backdrop+drawer 슬라이드아웃 패턴)를 채운다. 서버 재조회 없이
// openGopangWallet()이 이미 window._gopangWalletTimeline에 저장해둔
// 정규화된 항목(charge_pending 또는 ledger 두 종류)을 그대로 쓴다.
const _CHARGE_CHANNEL_LABEL = {
  manual_admin: '관리자가 은행 명세서를 직접 확인',
  auto_openbanking: '오픈뱅킹 자동 조회',
  auto_pg_webhook: 'PG 가상계좌 웹훅 자동 확정',
  auto_notification_capture: '관리자 폰의 입금 알림을 자동 캡처',
};
const _LEDGER_SOURCE_WHAT = {
  mint: 'GDC 충전(원화 입금 → GDC 발행)',
  market: '마켓에서 상품 구매',
  gdc_transfer: 'GDC 개인 간 이체',
  ai_usage: 'AI 비서 사용료 차감',
};
const _LEDGER_SOURCE_WHY = {
  mint: 'GDC 잔액 충전을 위한 본인 입금',
  market: '마켓 상품 결제',
  gdc_transfer: '개인 간 GDC 송금',
  ai_usage: '무료 한도 초과분 AI 사용료 정산',
};

window._openTxDetail = function(idx) {
  const t = (window._gopangWalletTimeline || [])[idx];
  const overlay = document.getElementById('charge-detail-overlay');
  const body = document.getElementById('charge-detail-drawer-body');
  if (!t || !overlay || !body) return;

  const r = t.raw;
  let rows, hashLine = '';

  if (t.kind === 'charge_pending') {
    const isPhoneKey = /^\d{8}$/.test(r.match_code || '');
    rows = [
      ['누가', isPhoneKey ? `본인 계정 (전화번호 뒷 8자리 ${r.match_code}로 확인)` : '본인 계정'],
      ['언제', `신청 ${r.created ? new Date(r.created).toLocaleString('ko-KR') : '-'} (아직 미확정)`],
      ['어디서', '은행 계좌 입금 대기 중'],
      ['무엇을', `${(r.requested_krw || 0).toLocaleString()}원 입금 신청`],
      ['어떻게', '관리자 확인 대기 중'],
      ['왜', 'GDC 잔액 충전을 위한 본인 입금'],
    ];
  } else {
    // ledger_entries 레코드 — counterpart(상대방 guid)가 있으면 그걸
    // "누가"에 반영한다(P2P 이체·마켓 구매는 상대가 있는 거래이므로).
    const whoLine = r.counterpart
      ? `본인 ↔ ${r.counterpart}`
      : '본인 계정';
    rows = [
      ['누가', whoLine],
      ['언제', r.created ? new Date(r.created).toLocaleString('ko-KR') : '-'],
      ['어디서', r.l1_node ? `${r.l1_node} 원장에 기록` : '-'],
      ['무엇을', _LEDGER_SOURCE_WHAT[r.source] || r.source || '-'],
      ['어떻게', `${r.direction === 'credit' ? '입금(credit)' : '출금(debit)'} · ${Math.trunc(r.amount || 0).toLocaleString()}원 · 계정과목: ${r.fs_account || '-'}`],
      ['왜', _LEDGER_SOURCE_WHY[r.source] || '-'],
    ];
    if (r.tx_id) hashLine = r.tx_id;
  }

  body.innerHTML = `
    <div style="padding:0 16px 12px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #f2f2f7;padding-bottom:14px">
      <button onclick="closeChargeDetail()" style="border:none;background:none;color:#007b8b;font-size:15px;cursor:pointer;padding:0">← 뒤로</button>
      <span style="font-size:15px;font-weight:600">거래 상세</span>
    </div>
    <div style="padding:16px;display:flex;flex-direction:column;gap:14px">
      ${rows.map(([label, value]) => `
        <div>
          <div style="font-size:11px;color:#9ca3af;font-weight:600;margin-bottom:3px">${label}</div>
          <div style="font-size:14px;color:#111827;line-height:1.5">${value}</div>
        </div>
      `).join('')}
      ${hashLine ? `
        <div>
          <div style="font-size:11px;color:#9ca3af;font-weight:600;margin-bottom:3px">거래 ID</div>
          <div style="font-size:12px;color:#9ca3af;word-break:break-all;font-family:monospace">${hashLine}</div>
        </div>` : ''}
    </div>`;
  overlay.classList.add('open');
};

window.closeChargeDetail = function() {
  document.getElementById('charge-detail-overlay')?.classList.remove('open');
};

window._openWalletTxDetail = async function() {
  // 2026-07-13 신설 — 위 openGopangWallet과 동일한 이유로 로컬 지갑에서
  // 직접 읽는다(서버 profile 레코드엔 fs가 저장된 적이 없었음).
  const wallet = window.gopangWallet;
  const fs = wallet?.getFinancialState ? await wallet.getFinancialState() : {};

  let txRecord = {};
  try { txRecord = JSON.parse(fs['last_tx_record'] || '{}'); } catch {}

  const html = `
    <div style="padding:0">
      <div style="padding:12px 16px;border-bottom:1px solid #f2f2f7;display:flex;align-items:center;gap:10px">
        <button onclick="openGopangWallet()" style="border:none;background:none;color:#007b8b;font-size:15px;cursor:pointer;padding:0">← 뒤로</button>
        <span style="font-size:15px;font-weight:600">거래 상세</span>
      </div>
      <div style="padding:16px;display:flex;flex-direction:column;gap:10px">
        ${Object.entries({
          '거래 ID':    fs['last_tx_id'] || '-',
          '거래 시각':  fs['last_updated_at'] ? new Date(fs['last_updated_at']).toLocaleString('ko-KR') : '-',
          '상품명':     txRecord.item_name || '-',
          '금액':       txRecord.total ? `₮${Number(txRecord.total).toLocaleString()}` : '-',
          '수수료':     txRecord.fee   ? `₮${Number(txRecord.fee).toLocaleString()}` : '-',
          '거래 상대':  txRecord.seller_guid ? txRecord.seller_guid.slice(0,20) + '...' : '-',
          'Block Hash': fs['last_block_hash'] ? fs['last_block_hash'].slice(0,24) + '...' : '-',
        }).map(([k, v]) => `
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f9fafb">
            <span style="font-size:13px;color:#6b7280">${k}</span>
            <span style="font-size:13px;color:#111827;font-family:${k.includes('Hash') || k.includes('ID') ? 'monospace' : 'inherit'};word-break:break-all;text-align:right;max-width:60%">${v}</span>
          </div>`).join('')}
      </div>
    </div>`;

  document.getElementById('_gopang-sheet-body').innerHTML = html;
};

// ══════════════════════════════════════════════════════════════
// ④ 재무제표 (4탭: 대차대조표 / 손익계산서 / 현금흐름표 / 재무분석)
// ══════════════════════════════════════════════════════════════
export async function openFinancialStatement() {
  _openSheet('재무제표', '<div style="padding:40px 16px;text-align:center;color:#9ca3af;font-size:14px">로딩 중...</div>');

  try {
    // 2026-07-13 신설 — 위 두 함수와 동일한 이유로 로컬 지갑에서 직접
    // 읽는다(서버 profile 레코드엔 fs가 저장된 적이 없어 이 화면 전체가
    // 지금까지 항상 ₮0만 보여주고 있었을 가능성이 높음 — 사고실험으로
    // 발견).
    const wallet = window.gopangWallet;
    const fs = wallet?.getFinancialState ? await wallet.getFinancialState() : {};

    const bsCash     = fs['bs-cash']     || 0;
    const plPurchase = fs['pl-purchase'] || 0;
    const plRevenue  = fs['pl-revenue']  || 0;
    // 2026-07-13 신설 — GDC-재무제표-재고 연동 4단계(매출원가). 원가를
    // 알려준 상품에 한해서만 계산되므로(모든 판매를 다 커버하지 않음)
    // 전체 지출 기준 순이익(netIncome)과 별개로 표시한다.
    const plCogs      = fs['pl-cogs'] || 0;
    const grossProfit = plRevenue - plCogs;
    const netIncome   = plRevenue - plPurchase;
    const lastUpdated = fs['last_updated_at']
      ? new Date(fs['last_updated_at']).toLocaleString('ko-KR')
      : '거래 없음';

    const _row = (label, val, cls='', bold=false) => `
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:0.5px solid #f2f2f7">
        <span style="font-size:13px;color:${bold?'#111827':'#6b7280'};font-weight:${bold?'600':'400'}">${label}</span>
        <span style="font-size:13px;font-weight:${bold?'700':'500'};color:${cls==='green'?'#007b8b':cls==='red'?'#dc2626':'#111827'}">${val}</span>
      </div>`;

    const _card = (rows) =>
      `<div style="background:#f9fafb;border-radius:10px;padding:4px 12px;margin-bottom:14px">${rows}</div>`;

    const _title = (text, color='#007b8b') =>
      `<div style="font-size:12px;font-weight:600;color:#374151;margin:12px 0 6px;
                   padding-bottom:4px;border-bottom:2px solid ${color}">${text}</div>`;

    const _notice = `<div style="text-align:center;font-size:11px;color:#9ca3af;padding:8px 0">마지막 갱신: ${lastUpdated}</div>`;

    // ── 탭별 콘텐츠 ──────────────────────────────────────────
    const tabs = {
      bs: `
        ${_title('대차대조표 (Balance Sheet)', '#007b8b')}
        ${_card(
          _row('자산 · 현금 (bs-cash)', '₮' + bsCash.toLocaleString()) +
          _row('자산 합계', '₮' + bsCash.toLocaleString(), 'green', true)
        )}
        ${_title('부채 및 자본', '#3b82f6')}
        ${_card(
          _row('부채 합계', '₮0') +
          _row('자본 (순자산)', '₮' + bsCash.toLocaleString()) +
          _row('부채 + 자본 합계', '₮' + bsCash.toLocaleString(), 'green', true)
        )}
        ${_notice}`,

      pl: `
        ${_title('손익계산서 (P&L)', '#3b82f6')}
        ${_card(
          _row('수입 (pl-revenue)', '+₮' + plRevenue.toLocaleString(), 'green') +
          (plCogs > 0 ? _row('매출원가 (pl-cogs)', '-₮' + plCogs.toLocaleString(), 'red') : '') +
          (plCogs > 0 ? _row('매출총이익 (Gross Profit)', (grossProfit >= 0 ? '+' : '') + '₮' + grossProfit.toLocaleString(),
               grossProfit >= 0 ? 'green' : 'red') : '') +
          _row('지출 전체 (pl-purchase)', '-₮' + plPurchase.toLocaleString(), 'red') +
          _row('순이익', (netIncome >= 0 ? '+' : '') + '₮' + netIncome.toLocaleString(),
               netIncome >= 0 ? 'green' : 'red', true)
        )}
        ${plCogs > 0 ? '<div style="text-align:center;font-size:11px;color:#9ca3af;padding:0 0 8px">매출원가는 원가를 알려주신 상품에 한해서만 계산됩니다</div>' : ''}
        ${_notice}`,

      cf: `
        ${_title('현금흐름표 (Cash Flow)', '#8b5cf6')}
        ${_card(
          _row('영업 활동 현금흐름', '₮' + netIncome.toLocaleString(), netIncome >= 0 ? 'green' : 'red') +
          _row('투자 활동 현금흐름', '₮0') +
          _row('재무 활동 현금흐름', '₮0') +
          _row('순 현금 증감', (netIncome >= 0 ? '+' : '') + '₮' + netIncome.toLocaleString(),
               netIncome >= 0 ? 'green' : 'red', true)
        )}
        ${_title('현금 잔액', '#8b5cf6')}
        ${_card(
          _row('기초 현금', '₮0') +
          _row('기말 현금', '₮' + bsCash.toLocaleString(), 'green', true)
        )}
        ${_notice}`,

      fa: `
        ${_title('재무분석 (Financial Analysis)', '#f59e0b')}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
          ${[
            ['수익률', plRevenue > 0 ? ((netIncome/plRevenue)*100).toFixed(1)+'%' : '0%', netIncome >= 0 ? '#007b8b' : '#dc2626'],
            ['유동비율', '100%', '#007b8b'],
            ['부채비율', '0%', '#111827'],
            ['총거래 횟수', (fs['last_tx_id'] ? '1건+' : '0건'), '#111827'],
          ].map(([label, val, color]) => `
            <div style="background:#f9fafb;border-radius:10px;padding:12px">
              <div style="font-size:11px;color:#9ca3af;margin-bottom:4px">${label}</div>
              <div style="font-size:18px;font-weight:500;color:${color}">${val}</div>
            </div>`).join('')}
        </div>
        ${_card(
          _row('총 수입', '+₮' + plRevenue.toLocaleString(), 'green') +
          _row('총 지출', '-₮' + plPurchase.toLocaleString(), 'red') +
          _row('평균 거래금액', fs['last_tx_id'] ? '₮' + plRevenue.toLocaleString() : '₮0') +
          _row('순자산', '₮' + bsCash.toLocaleString(), bsCash >= 0 ? 'green' : 'red', true)
        )}
        ${_notice}`,
    };

    // ── 탭 UI ────────────────────────────────────────────────
    const html = `
      <div>
        <div id="_fs-tabs" style="display:flex;border-bottom:0.5px solid #f2f2f7;background:#f9fafb">
          ${[['bs','대차대조표'],['pl','손익계산서'],['cf','현금흐름표'],['fa','재무분석']].map(([id,label],i) => `
            <button onclick="_fsSwitchTab('${id}')" id="_fs-tab-${id}"
              style="flex:1;padding:10px 2px;font-size:11px;font-weight:${i===0?'600':'400'};
                     color:${i===0?'#007b8b':'#9ca3af'};background:${i===0?'#fff':'transparent'};
                     border:none;border-bottom:${i===0?'2px solid #007b8b':'2px solid transparent'};
                     cursor:pointer;font-family:inherit;transition:all .15s">
              ${label}
            </button>`).join('')}
        </div>
        <div id="_fs-body" style="padding:12px 16px">
          ${tabs['bs']}
        </div>
      </div>`;

    document.getElementById('_gopang-sheet-body').innerHTML = html;

    // 탭 전환 함수 전역 등록
    window._fsSwitchTab = function(id) {
      const tabData = { bs: tabs.bs, pl: tabs.pl, cf: tabs.cf, fa: tabs.fa };
      ['bs','pl','cf','fa'].forEach(t => {
        const el = document.getElementById('_fs-tab-' + t);
        if (!el) return;
        const active = t === id;
        el.style.color      = active ? '#007b8b' : '#9ca3af';
        el.style.fontWeight = active ? '600' : '400';
        el.style.background = active ? '#fff' : 'transparent';
        el.style.borderBottom = active ? '2px solid #007b8b' : '2px solid transparent';
      });
      const body = document.getElementById('_fs-body');
      if (body) body.innerHTML = tabData[id];
    };

  } catch(e) {
    document.getElementById('_gopang-sheet-body').innerHTML =
      '<div style="padding:40px 16px;text-align:center;color:#ef4444;font-size:13px">데이터 로드 실패</div>';
  }
}

// ══════════════════════════════════════════════════════════════
// 공통 시트 패널
// ══════════════════════════════════════════════════════════════
function _openSheet(title, html) {
  let sheet = document.getElementById('_gopang-bottom-sheet');
  if (!sheet) {
    sheet = document.createElement('div');
    sheet.id = '_gopang-bottom-sheet';
    sheet.style.cssText = [
      'position:fixed;inset:0;z-index:10000',
      'background:#fff',
      'display:flex;flex-direction:column',
      'transform:translateY(100%)',
      'transition:transform 0.3s ease',
    ].join(';');
    sheet.innerHTML = `
      <div style="display:flex;align-items:center;padding:14px 16px;border-bottom:1px solid #f2f2f7;flex-shrink:0">
        <button id="_gopang-sheet-close"
          style="border:none;background:none;font-size:15px;color:#007b8b;cursor:pointer;padding:0;font-family:inherit">
          닫기
        </button>
        <div id="_gopang-sheet-title" style="flex:1;text-align:center;font-size:16px;font-weight:600"></div>
        <div style="width:36px"></div>
      </div>
      <div id="_gopang-sheet-body" style="flex:1;overflow-y:auto"></div>`;
    document.body.appendChild(sheet);
    document.getElementById('_gopang-sheet-close').onclick = () => {
      sheet.style.transform = 'translateY(100%)';
    };
  }

  document.getElementById('_gopang-sheet-title').textContent = title;
  document.getElementById('_gopang-sheet-body').innerHTML = html;
  requestAnimationFrame(() => { sheet.style.transform = 'translateY(0)'; });
}

export function openMyProfile() {
  const stored = JSON.parse(localStorage.getItem('gopang_user_v4') || sessionStorage.getItem('gopang_user_v4') || 'null');
  const handle = stored?.handle;
  if (!handle) { alert('프로필을 먼저 등록해주세요.'); return; }
  // 같은 탭 내 인라인 패널로 표시 (새 탭 열지 않음)
  _openProfilePanel(handle);
}

// ══════════════════════════════════════════════════════════════
// 프로필 작성 — v1.6: 설정 화면에서 사용자가 직접 시작하는 전용 패널
// ══════════════════════════════════════════════════════════════
// "AI와 대화로 프로필 작성" 메뉴에서 자유 텍스트를 입력하면 PA SP가 그
// 내용을 보고 정체성(개인/사업자/협회/공공기관)·업종을 스스로 판단하고,
// 부족한 정보만 자연스럽게 하나씩 채워나간다(personal-assistant-v1.6).
//
// 메인 채팅/AI 패널(call-ai.js의 callAI, webapp.html의 _callPanelAI)과
// 완전히 분리된 독립 history(_composerHistory)를 쓴다 — PA SP는 이제
// 가입 직후에도, 메인 채팅에서도 절대 자동으로 끼어들지 않고 오직 이
// 패널 안에서만 호출된다(call-ai.js _callAIInner 참조).
let _composerHistory = [];

export function openProfileComposer() {
  document.getElementById('_profile-composer-overlay')?.remove();

  const done = localStorage.getItem('hondi_profile_done') === '1';
  let resumeNote = '';
  try {
    const step = localStorage.getItem('hondi_profile_step');
    if (!done && step) resumeNote = `이전에 ${step}단계까지 작성하던 내용이 있어요 — 이어서 진행할게요.`;
  } catch {}

  // v1.6 — PROFILE_SKIP 시 hondi_profile_skipped='1'이 남아있으면
  // call-ai.js의 PA SP 로더가 막혀 있을 일은 이제 없지만(메인 채팅과 무관한
  // 독립 패널이므로), 이 패널 자체의 [CONTEXT]에는 여전히 정확한 skipped/
  // done 상태가 들어가야 하므로 따로 건드리지 않는다 — _buildProfileContext()
  // 가 그대로 읽는다.
  _composerHistory = [];

  const ov = document.createElement('div');
  ov.id = '_profile-composer-overlay';
  ov.style.cssText = [
    'position:fixed;inset:0;z-index:1200',
    'background:#fff',
    'display:flex;flex-direction:column',
    'transform:translateX(100%)',
    'transition:transform .3s cubic-bezier(.32,1,.4,1)',
    'will-change:transform',
  ].join(';');

  ov.innerHTML = `
    <div style="background:#4B7BE5;padding:calc(env(safe-area-inset-top,0px)+12px) 16px 0;
      display:flex;align-items:center;gap:10px;flex-shrink:0">
      <button id="_pc-back" style="width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.15);
          border:none;cursor:pointer;color:#fff;font-size:20px;display:flex;
          align-items:center;justify-content:center;flex-shrink:0">&#8592;</button>
      <span style="font-size:17px;font-weight:600;color:#fff;flex:1">프로필 작성</span>
    </div>
    <div id="_pc-msglist" style="flex:1;overflow-y:auto;padding:16px;display:flex;
         flex-direction:column;gap:10px;background:#f9fafb"></div>
    <div style="display:flex;gap:8px;padding:10px 12px calc(env(safe-area-inset-bottom,0px)+10px);
         border-top:1px solid #eee;background:#fff;flex-shrink:0">
      <textarea id="_pc-input" rows="1"
        placeholder="${done ? '수정하고 싶은 내용을 말씀해 주세요' : '예: 한림읍에서 중국집 해요, 상호명은 금능반점이에요'}"
        style="flex:1;resize:none;border:1px solid #e5e7eb;border-radius:18px;padding:10px 14px;
               font-size:14px;font-family:inherit;outline:none;max-height:100px;box-sizing:border-box"></textarea>
      <button id="_pc-send" style="width:40px;height:40px;border-radius:50%;border:none;
               background:#1A73E8;color:#fff;font-size:16px;cursor:pointer;flex-shrink:0">&#8593;</button>
    </div>`;

  document.body.appendChild(ov);
  requestAnimationFrame(() => requestAnimationFrame(() => { ov.style.transform = 'translateX(0)'; }));

  const close = () => {
    ov.style.transform = 'translateX(100%)';
    setTimeout(() => ov.remove(), 300);
  };
  ov.querySelector('#_pc-back').onclick = close;

  const list  = ov.querySelector('#_pc-msglist');
  const input = ov.querySelector('#_pc-input');
  const sendBtn = ov.querySelector('#_pc-send');

  function appendMsg(role, text) {
    const row = document.createElement('div');
    row.style.cssText = `align-self:${role === 'user' ? 'flex-end' : 'flex-start'};max-width:80%`;
    const bubble = document.createElement('div');
    bubble.style.cssText = role === 'user'
      ? 'background:#1A73E8;color:#fff;padding:10px 14px;border-radius:16px 16px 4px 16px;font-size:14px;line-height:1.5;white-space:pre-wrap'
      : 'background:#fff;border:1px solid #eee;color:#111;padding:10px 14px;border-radius:16px 16px 16px 4px;font-size:14px;line-height:1.5;white-space:pre-wrap';
    bubble.textContent = text;
    row.appendChild(bubble);
    list.appendChild(row);
    list.scrollTop = list.scrollHeight;
    return bubble;
  }

  function appendSystemNote(text) {
    const note = document.createElement('div');
    note.style.cssText = 'align-self:center;font-size:11px;color:#9ca3af;padding:4px 10px;text-align:center';
    note.textContent = text;
    list.appendChild(note);
    list.scrollTop = list.scrollHeight;
  }

  if (resumeNote) appendSystemNote(resumeNote);

  async function send() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';
    sendBtn.disabled = true;
    appendMsg('user', text);
    const bubble = appendMsg('ai', '…');
    try {
      const finished = await _callComposerAI(text, bubble);
      if (finished) appendSystemNote('✅ 프로필이 정리됐어요 — 여기서 닫으셔도 됩니다');
    } catch (e) {
      bubble.textContent = 'AI 오류: ' + e.message;
    }
    sendBtn.disabled = false;
    input.focus();
  }

  sendBtn.onclick = send;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
  });

  // 설정 시트가 열려 있었다면 닫는다
  document.getElementById('_gopang-sheet-overlay')?.classList?.remove('open');

  setTimeout(() => input.focus(), 350);
}

/**
 * _callComposerAI — 프로필 작성 패널 전용 LLM 호출.
 *
 * 메인 채팅(call-ai.js의 callAI)과 완전히 분리된 _composerHistory를 쓰고,
 * system은 항상 profile-assistant SP다(2026-07-08: personal-assistant에서
 * 개명·분리 — 프로필 작성만 다루는 SP). _callLLM(범용 페일오버+스트리밍
 * 헬퍼)을 재사용해 fetch/후보선정 로직을 중복 구현하지 않는다.
 *
 * @returns {Promise<boolean>} true면 PROFILE_SUBMIT/SKIP으로 이 세션이 끝남
 */
async function _callComposerAI(userText, bubble) {
  const {
    _loadProfileAssistantSP, _buildProfileContext,
    _handleProfileTags, _stripInternalTags, _callLLM,
  } = await import('../ai/call-ai.js');

  if (_composerHistory.length === 0) {
    const sys = await _loadProfileAssistantSP();
    _composerHistory.push({ role: 'system', content: sys || '' });
  }

  let enhanced = userText;
  try { enhanced = `${_buildProfileContext()}\n\n${userText}`; } catch {}
  _composerHistory.push({ role: 'user', content: enhanced });

  const fullReply = await _callLLM(_composerHistory, { bubble });
  _composerHistory.push({ role: 'assistant', content: fullReply });
  bubble.textContent = _stripInternalTags(fullReply);

  let handled = false;
  try {
    // PROFILE_SUBMIT/SKIP 시 _handleProfileTags가 _switchToAssistantSP()로
    // 메인 채팅(AGENT-COMMON)의 system_base를 갱신해 둔다. sendFn은 메인
    // 채팅으로 "인계 안착 인사"를 보내는 용도인데, 이 패널은 메인 채팅이
    // 아니므로 아무 일도 하지 않는 콜백을 넘긴다(불필요한 추가 호출 방지).
    handled = await _handleProfileTags(fullReply, null, async () => {});
  } catch (e) {
    console.warn('[ProfileComposer] _handleProfileTags 처리 실패(무시):', e.message);
  }

  if (handled) _composerHistory.length = 0;
  return handled;
}

export function _openProfilePanel(handle) {
  // 기존 패널이 있으면 제거
  document.getElementById('_profile-panel-overlay')?.remove();

  const ov = document.createElement('div');
  ov.id = '_profile-panel-overlay';
  ov.style.cssText = [
    'position:fixed;inset:0;z-index:1200',
    'background:#fff',
    'display:flex;flex-direction:column',
    'transform:translateX(100%)',
    'transition:transform .3s cubic-bezier(.32,1,.4,1)',
    'will-change:transform',
  ].join(';');

  // 상단 바
  ov.innerHTML = `
    <div style="background:#4B7BE5;padding:calc(env(safe-area-inset-top,0px)+12px) 16px 0;
      display:flex;align-items:center;gap:10px;flex-shrink:0">
      <button onclick="document.getElementById('_profile-panel-overlay').style.transform='translateX(100%)';
        setTimeout(()=>document.getElementById('_profile-panel-overlay')?.remove(),300)"
        style="width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.15);
          border:none;cursor:pointer;color:#fff;font-size:20px;display:flex;
          align-items:center;justify-content:center;flex-shrink:0">&#8592;</button>
      <span style="font-size:17px;font-weight:600;color:#fff;flex:1">내 프로필</span>
      <a href="/register-profile.html?edit=1"
        style="font-size:13px;color:rgba(255,255,255,.85);text-decoration:none;
          padding:6px 12px;border-radius:8px;background:rgba(255,255,255,.15)">수정</a>
    </div>
    <iframe id="_profile-panel-iframe"
      src="/profile.html?handle=${encodeURIComponent(handle)}&inline=1"
      style="flex:1;border:none;width:100%;background:#fff"
      allow="geolocation"></iframe>`;

  document.body.appendChild(ov);

  // 슬라이드 인
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      ov.style.transform = 'translateX(0)';
    });
  });
}

// ══════════════════════════════════════════════════════════════
// ⑤ 백업 키 — v6.0
// 이 기기를 잃어버리거나 바꿀 때, 같은 계정으로 다시 들어오기 위한 유일한
// 방법이다(전화번호/닉네임만으로는 더 이상 로그인되지 않음 — 의도된 동작).
// ══════════════════════════════════════════════════════════════
export async function openBackupKey() {
  _openSheet('백업 키', '<div style="padding:40px 16px;text-align:center;color:#9ca3af;font-size:14px">로딩 중...</div>');

  const html = `
    <div style="padding:20px 16px">
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;
                  padding:12px 14px;font-size:12px;color:#92400e;line-height:1.6;margin-bottom:20px">
        이 키를 아는 사람은 누구나 이 계정이 될 수 있습니다.<br>
        캡처/공유하지 말고, 본인만 아는 안전한 곳(예: 비밀번호 관리자)에<br>보관하세요. 고팡은 이 키를 서버에 저장하지 않습니다.
      </div>

      <p style="font-size:13px;font-weight:600;color:#111827;margin-bottom:8px">내 백업 키 내보내기</p>
      <div id="_bk-display" style="display:none;background:#f9fafb;border:1px solid #e5e7eb;
           border-radius:8px;padding:12px;font-family:monospace;font-size:12px;
           word-break:break-all;color:#111827;margin-bottom:8px"></div>
      <button id="_bk-show-btn" style="width:100%;padding:13px;border:1px solid #e5e7eb;border-radius:10px;
              background:none;color:#007b8b;font-weight:600;cursor:pointer;font-size:14px;margin-bottom:8px">
        키 표시
      </button>
      <button id="_bk-copy-btn" style="display:none;width:100%;padding:13px;border:none;border-radius:10px;
              background:#007b8b;color:#fff;font-weight:600;cursor:pointer;font-size:14px;margin-bottom:28px">
        복사
      </button>

      <div style="height:1px;background:#f2f2f7;margin-bottom:20px"></div>

      <p style="font-size:13px;font-weight:600;color:#111827;margin-bottom:4px">다른 기기의 백업 키로 복구</p>
      <p style="font-size:12px;color:#9ca3af;line-height:1.5;margin-bottom:10px">
        이 기기를 그 백업 키의 계정으로 등록합니다. 이 기기에 이미 있던<br>로컬 키는 교체됩니다.
      </p>
      <textarea id="_bk-restore-input" rows="3" placeholder="백업 키 붙여넣기"
        style="width:100%;border:1px solid #e5e7eb;border-radius:10px;padding:12px;
               font-size:13px;font-family:monospace;resize:none;box-sizing:border-box;
               margin-bottom:8px" autocomplete="off" autocorrect="off" spellcheck="false"></textarea>
      <div id="_bk-restore-err" style="display:none;font-size:12px;color:#dc2626;margin-bottom:8px"></div>
      <div id="_bk-restore-ok" style="display:none;font-size:12px;color:#007b8b;margin-bottom:8px"></div>
      <button id="_bk-restore-btn" style="width:100%;padding:13px;border:none;border-radius:10px;
              background:#111827;color:#fff;font-weight:600;cursor:pointer;font-size:14px">
        이 기기에 적용
      </button>
    </div>`;

  document.getElementById('_gopang-sheet-body').innerHTML = html;

  document.getElementById('_bk-show-btn').onclick = async () => {
    const { _exportBackupKey } = await import('../core/auth.js');
    const key = await _exportBackupKey();
    const disp = document.getElementById('_bk-display');
    if (!key) { alert('지갑을 아직 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'); return; }
    disp.textContent = key;
    disp.style.display = 'block';
    document.getElementById('_bk-show-btn').style.display = 'none';
    document.getElementById('_bk-copy-btn').style.display = 'block';
  };

  document.getElementById('_bk-copy-btn').onclick = async () => {
    const text = document.getElementById('_bk-display').textContent;
    try {
      await navigator.clipboard.writeText(text);
      const btn = document.getElementById('_bk-copy-btn');
      btn.textContent = '복사됨';
      setTimeout(() => { btn.textContent = '복사'; }, 1500);
      // 2026-08-31 신설 — 백업 키를 실제로 내보낸(표시+복사) 시점을
      // "확인 완료"로 기록한다. 지금까지 이 버튼은 로컬 플래그조차 안
      // 세팅했다(라이브 UI의 유일한 정상 확인 경로인데도) — 그래서
      // "지금 저장" 배너를 눌러 키를 복사해도 배너의 원인이 되는 상태가
      // 전혀 안 바뀌었다. 로컬 플래그 + 계정 단위 서버 기록(다른 기기에도
      // 반영되도록) 둘 다 여기서 남긴다.
      const { USER_GUID } = await import('../core/state.js');
      const { _confirmBackupOnServer } = await import('../core/auth.js');
      try { localStorage.setItem('gopang_backup_confirmed_v1', '1'); } catch {}
      document.getElementById('backup-warn-banner')?.classList.remove('show');
      _confirmBackupOnServer(USER_GUID).catch(() => {});
    } catch { alert('복사에 실패했습니다. 직접 길게 눌러 선택해 주세요.'); }
  };

  document.getElementById('_bk-restore-btn').onclick = async () => {
    const input  = document.getElementById('_bk-restore-input');
    const errEl  = document.getElementById('_bk-restore-err');
    const okEl   = document.getElementById('_bk-restore-ok');
    const btn    = document.getElementById('_bk-restore-btn');
    const val    = input.value.trim();
    errEl.style.display = 'none'; okEl.style.display = 'none';
    if (!val) { errEl.textContent = '백업 키를 입력해 주세요.'; errEl.style.display = 'block'; return; }

    btn.disabled = true; btn.textContent = '확인 중…';
    const stored = JSON.parse(localStorage.getItem('gopang_user_v4') || 'null');
    const { _restoreFromBackupKey } = await import('../core/auth.js');
    const result = await _restoreFromBackupKey(val, stored?.ipv6 || null, 'gopang');
    btn.disabled = false; btn.textContent = '이 기기에 적용';

    if (!result.ok) {
      const msg = result.reason === 'PUBKEY_MISMATCH'
        ? '이 백업 키는 현재 로그인된 계정의 키가 아닙니다.'
        : result.reason === 'invalid_key'
          ? '키 형식이 올바르지 않습니다.'
          : '적용에 실패했습니다' + (result.detail ? ` (${result.detail}).` : ` (${result.reason}).`);
      errEl.textContent = msg;
      errEl.style.display = 'block';
      return;
    }
    okEl.textContent = '✅ 이 기기가 백업 키로 등록되었습니다.';
    okEl.style.display = 'block';
    input.value = '';
  };
}

// ── 혼디 코드 썸네일 렌더링 ──────────────────────────────────
export function _renderHondiCodeThumb() {
  const thumb = document.getElementById('hondi-code-thumb');
  if (!thumb) return;
  const img = localStorage.getItem('hondi_code_image_v1');
  if (img) {
    thumb.src = img;
    thumb.style.display = 'block';
    return;
  }
  // 캐시 없으면 guid로 즉시 재생성
  try {
    const s = JSON.parse(
      localStorage.getItem('gopang_user_v4') ||
      sessionStorage.getItem('gopang_user_v4') || '{}'
    );
    if (!s.guid) return;
    import('../ai/hondi-code.js')
      .then(({ guidToShortId, generateHondiCodeDataURL }) =>
        generateHondiCodeDataURL(guidToShortId(s.guid), 1)
      )
      .then(dataURL => {
        try { localStorage.setItem('hondi_code_image_v1', dataURL); } catch {}
        if (thumb) { thumb.src = dataURL; thumb.style.display = 'block'; }
      })
      .catch(() => {});
  } catch {}
}

// ── 혼디 코드 모달 열기/닫기 ────────────────────────────────
export function openHondiCodeModal() {
  const modal    = document.getElementById('hondi-code-modal');
  const modalImg = document.getElementById('hondi-code-modal-img');
  const thumb    = document.getElementById('hondi-code-thumb');
  if (!modal) return;
  if (modalImg && thumb?.src) modalImg.src = thumb.src;
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

export function closeHondiCodeModal() {
  const modal = document.getElementById('hondi-code-modal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
}

export function _downloadHondiCode() {
  const img = localStorage.getItem('hondi_code_image_v1');
  if (!img) return;
  const a = document.createElement('a');
  a.href = img;
  a.download = 'hondi-code.png';
  a.click();
}

// ── e164 → {type, areaCode, subscriberNumber} 파싱 ────────────
// auth/device-link.html의 _parseE164Kr()와 동일한 규칙(로컬 클로저라
// 재사용 불가 — 여기서 동일 로직을 유지). 세 갈래(휴대폰/서울 유선/그 외
// 유선)를 VALID_AREA_CODES 기준으로 구분한다.
function _parseE164Kr(e164) {
  if (!e164) return null;
  const digits = e164.replace(/^\+82/, '');
  if (digits.length === 11 && digits.startsWith('010')) {
    return { type: 'mobile', areaCode: null, subscriberNumber: digits.slice(3) };
  }
  for (const code of VALID_AREA_CODES) {
    const prefix = '0' + code;
    if (digits.startsWith(prefix)) {
      return { type: 'landline', areaCode: code, subscriberNumber: digits.slice(prefix.length) };
    }
  }
  return null;
}

// ── 다른 기기 연결 모달 (2026-07-31 신설, 같은 날 QR→혼디 숫자 코드로 교체) ──
// "폰이나 PC에서 자신의 계정을 간단히 호출할 방안"(주피터 요청) — 이미
// 로그인돼 있는 기기(예: PC)에서 코드를 띄우면, 새 기기(예: 폰)가 혼디
// 앱 자체의 카메라 스캐너(auth/link-scan.html)로 그 코드를 찍는 것만으로
// auth/device-link.html이 전화번호 입력 없이 곧바로 승인 요청을 전송한다.
// auth/device-link.html은 ?phone= 쿼리가 있으면(PREFILLED_PHONE) 전화번호
// 입력 화면을 건너뛰고 즉시 요청을 보내도록 이미 구현돼 있다(2026-07-28
// 변경분 참고) — 여기서는 그 전화번호를 혼디 숫자 코드로 인코딩해
// 보여주기만 하면 된다.
//
// ★ 2026-07-31 교체 — 원래는 외부 api.qrserver.com으로 일반 QR을
// 생성했으나, 저장소 안에 이미 "혼디 숫자 코드"(hondi-digit-code.js)라는
// 자체 시각코드 체계가 있고, 그 인코더가 phoneToDigits()라는 전화번호
// 전용 인코딩까지 이미 갖추고 있었다(docs/pages/scenarios.html의 "QR
// Code vs. 혼디 코드" 비교표에도 "전화번호를 직접 인코딩 — 등록된
// 전화번호와 정확히 일치해야 하며, 위조 방지는 L1 서버의 실시간 대조로
// 이뤄짐"이라고 이미 설계돼 있던 용도). 외부 서비스 호출 없이(전화번호
// 유래 코드를 제3자 QR API로 보내지 않아도 되고) 100% 클라이언트에서
// 캔버스로 그려지며, 브랜드 자산(로고)도 재사용된다.
// ★ 2026-07-19 QR "로그인"(auth/qr-scan.html) 자체는 주피터 지시로
// 폐기됐다(SMS 인증만이 유일한 본인 확인 경로) — 이건 다른 것이다. 이
// 코드는 인증을 대신하지 않는다. 여전히 실제 승인은 이미 로그인된
// 기기에서 생체인증으로 이뤄지고, 이 코드는 전화번호를 직접 타이핑하지
// 않고 그 승인 요청 화면을 열어주는 바로가기일 뿐이다.
function _currentUserForCode() {
  if (_USER?.e164) return _USER;
  try {
    const s = JSON.parse(
      localStorage.getItem('gopang_user_v4') ||
      sessionStorage.getItem('gopang_user_v4') || 'null'
    );
    return s;
  } catch { return null; }
}

export async function openDeviceLinkQR() {
  const modal   = document.getElementById('device-link-qr-modal');
  const imgEl   = document.getElementById('device-link-qr-img');
  const errEl   = document.getElementById('device-link-qr-error');
  const linkBox = document.getElementById('device-link-qr-linkbox');
  if (!modal) return;

  const user = _currentUserForCode();
  const parsed = _parseE164Kr(user?.e164);
  if (!parsed) {
    // 전화번호 인증 전(게스트 등)이거나 파싱 불가한 형식 — 연결할 계정 자체가 없다.
    if (imgEl)   imgEl.style.display = 'none';
    if (linkBox) linkBox.style.display = 'none';
    if (errEl)   errEl.style.display = 'block';
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    return;
  }

  const targetUrl = 'https://hondi.net/auth/device-link.html'
    + '?phone=' + encodeURIComponent(user.e164)
    + '&return=' + encodeURIComponent('/webapp.html');

  if (linkBox) {
    linkBox.style.display = 'flex';
    linkBox.dataset.link = targetUrl;
  }
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  try {
    const digits  = phoneToDigits(parsed);
    const shortId = digitsToId(digits);
    const dataUrl = await generateDigitCodeDataURL(shortId);
    if (imgEl) { imgEl.src = dataUrl; imgEl.style.display = 'block'; }
    if (errEl) errEl.style.display = 'none';
  } catch (e) {
    console.error('[DeviceLinkCode] 생성 실패:', e);
    if (imgEl) imgEl.style.display = 'none';
    if (errEl) { errEl.textContent = '코드 생성 중 오류가 발생했습니다: ' + e.message; errEl.style.display = 'block'; }
  }
}


export function closeDeviceLinkQR() {
  const modal = document.getElementById('device-link-qr-modal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
}

export async function _copyDeviceLinkQRUrl() {
  const linkBox = document.getElementById('device-link-qr-linkbox');
  const url = linkBox?.dataset?.link;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    const btn = document.getElementById('device-link-qr-copy-btn');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '복사됨';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    }
  } catch {
    prompt('아래 링크를 복사하세요:', url);
  }
}
