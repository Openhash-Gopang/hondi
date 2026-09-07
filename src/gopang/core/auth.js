/**
 * core/auth.js — 사용자 인증·등록 v3.4
 * - 내부: E.164 풀번호 기반 GUID/nickname_hash
 * - UI:   한국 기본(뒷 8자리), 비KR은 국가prefix handle (@US-XXXXXXXX)
 *         UN 가입국 194개 + 실시간 검색
 * - 익명 모드 없음
 */
import { setUser, _USER, USER_GUID, L1_URL, L1_PDV_URL, L1_ANCHOR_URL, PROXY } from './state.js';
const PROXY_URL = PROXY;
import { appendBubble } from '../ui/bubble.js';
import { requestPushSubscription } from '../services/push.js';
import { guidToShortId } from '../ai/hondi-code.js';
import { phoneToDigits, generateDigitCodeDataURL } from '../ai/hondi-digit-code.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⚠️  DEV MODE — 정식 운영 전환: false로 복원 (2026-06-27)
//     - 가입자마다 _e164ToIPv6()로 고유 GUID 생성 (handle만으로 dev 합류 안 됨)
//     - _issueSession() Ed25519 서명 검증 정상 작동
//     - 기기 불일치 시 강제 통과 대신 백업 키 복구 폼(_showDeviceMismatchNotice) 노출
//     다시 개발 모드가 필요하면 이 값만 true로 되돌리면 된다.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const DEV_MODE = false;

// DEV_MODE: _issueSession 서명 검증 우회 → 항상 ok
// DEV_MODE: initAuth / initAuthWithPhone → handle만 있으면 즉시 로그인
//
// (2026-07-14 제거됨 — 예전에는 여기서 DEV_MODE 시 localStorage.gopang_cfg에
//  실제 DeepSeek API 키를 하드코딩해 자동 주입했었다. 이게 소스에 실키가
//  그대로 노출되는 사고로 이어졌는데, 확인해보니 애초에 불필요한 코드였다 —
//  call-ai.js의 _buildCallCandidates()가 "혼디 제공 DeepSeek 기본 키" 후보
//  (provider: 'deepseek-default', apiKey: null)를 사용자 키 등록 여부와
//  무관하게 항상 마지막 폴백으로 추가하므로, DEV 환경에서도 키 없이 이미
//  정상 동작한다. 즉 이 블록은 기능적 이득 없이 위험만 추가하고 있었다.
//  개발자가 실제 자기 키로 테스트하고 싶으면 앱 UI의 LLM 키 설정 화면에서
//  직접 등록하면 된다 — 소스에 다시 하드코딩하지 말 것.)

const STORE_KEY = 'gopang_user_v4';
const DEFAULT_COUNTRY = 'KR';

// ── Base64URL 헬퍼 (2026-09-07 신설) ────────────────────────────────
// gopang-wallet.js의 동명 내부 함수와 동일한 인코딩 — 이 파일에서도
// 재클레임 흐름의 WebAuthn 챌린지/assertion을 다뤄야 해서 여기 별도로
// 둔다(gopang-wallet.js는 IIFE 내부 비공개 함수라 import 불가).
function _b64uToBuf(b64u) {
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
function _bufToB64u(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── 모바일 기기 판별 (보수적: 확실한 모바일 키워드가 없으면 PC로 간주) ──
// 목적: 암호키(GDC Wallet) 생성은 휴대폰에서만 — PC가 먼저 키를 만들어
//       가입 시점의 진짜 키와 어긋나는 사고(부록 A-1)를 원천 차단.
// 애매한 UA(태블릿, 알 수 없는 기기 등)는 안전한 쪽으로 "PC"로 판정한다.
function _isMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
}

// ── PC로 판별된 기기에서 신규가입 시도 시 확인 다이얼로그 ──────
// "예"를 누르면 그 자리에서 가입 진행, "아니요"/닫기는 가입 자체를 막는다.
function _confirmMobileRegistration() {
  return new Promise((resolve) => {
    document.getElementById('_mobile-confirm-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = '_mobile-confirm-overlay';
    overlay.style.cssText = [
      'position:fixed;inset:0;z-index:10002',
      'background:rgba(0,0,0,0.5)',
      'display:flex;align-items:center;justify-content:center',
      'padding:24px;box-sizing:border-box',
    ].join(';');

    overlay.innerHTML = `
      <div style="background:#fff;border-radius:20px;padding:28px 22px;
                  width:100%;max-width:360px;box-sizing:border-box;">
        <p style="font-weight:700;font-size:16px;margin:0 0 10px;color:#111827">
          첫 방문이시군요
        </p>
        <p style="font-size:13px;color:#374151;line-height:1.6;margin:0 0 20px">
          고팡의 암호키(GDC Wallet)는 보안을 위해 <b>오직 스마트폰에서만</b> 생성할 수 있습니다.<br><br>
          지금 접속하신 기기가 <b>스마트폰</b>인가요?
        </p>
        <div style="display:flex;gap:8px">
          <button id="_mc_no"
            style="flex:1;padding:13px;border:1px solid #e5e7eb;border-radius:10px;
                   background:none;cursor:pointer;font-size:14px;font-family:inherit">
            아니요, PC입니다
          </button>
          <button id="_mc_yes"
            style="flex:1;padding:13px;border:none;border-radius:10px;
                   background:#16a34a;color:#fff;cursor:pointer;
                   font-size:14px;font-weight:700;font-family:inherit">
            예, 스마트폰입니다
          </button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#_mc_yes').onclick = () => { overlay.remove(); resolve(true); };
    overlay.querySelector('#_mc_no').onclick  = () => { overlay.remove(); resolve(false); };
  });
}

// ── PC 확인 후 "아니요"를 선택했을 때 보여줄 안내 ───────────
function _showPcRegisterBlockedNotice() {
  document.getElementById('_mobile-confirm-overlay')?.remove();
  document.getElementById('_pc-blocked-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = '_pc-blocked-overlay';
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:10002',
    'background:rgba(0,0,0,0.5)',
    'display:flex;align-items:center;justify-content:center',
    'padding:24px;box-sizing:border-box',
  ].join(';');

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:20px;padding:28px 22px;
                width:100%;max-width:360px;box-sizing:border-box;text-align:center">
      <p style="font-weight:700;font-size:16px;margin:0 0 10px;color:#111827">
        스마트폰으로 등록해 주세요
      </p>
      <p style="font-size:13px;color:#374151;line-height:1.6;margin:0 0 20px">
        사용자 등록(암호키 생성)은 스마트폰에서만 가능합니다.<br>
        스마트폰으로 <b>hondi.net</b>에 접속해 등록해 주세요.<br><br>
        등록을 마친 후에는 PC에서도 로그인할 수 있습니다.
      </p>
      <button id="_pc_blocked_close"
        style="width:100%;padding:13px;border:none;border-radius:10px;
               background:#16a34a;color:#fff;cursor:pointer;
               font-size:14px;font-weight:700;font-family:inherit">
        확인
      </button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#_pc_blocked_close').onclick = () => overlay.remove();
}

// ── 2026-07-23 신설: PC에서 서명이 실제로 필요해진 순간에만 뜨는
//    "계정 연결" 흐름 (전용/공용 PC 선택) ─────────────────────
//
// 0단계(gopang-wallet.js)가 PC에서는 지갑을 조용히 자동생성하지 않도록
// 바꿔서, window.gopangWallet이 null이고 gopangWalletNeedsSetup=true인
// 상태가 정상적으로 존재하게 됐다. 이 함수는 "실제로 서명이 필요해진
// 순간"(현재는 sendMessage() 진입부, 다른 서명 필요 지점에도 필요하면
// 같은 함수를 재사용) 호출되어, 사용자에게 계정 연결 방법을 묻는다.
//
// 세션당 한 번만 묻는다(sessionStorage 플래그) — 매 메시지마다 반복해서
// 물어보면 방해가 된다. "아니요, 처음이에요"를 고르면 이 사람은 신규
// 방문자라는 뜻이므로, 이후 정상적인 회원가입 흐름(_showRegisterFlow
// 등)에 맡기고 이 함수는 관여하지 않는다.
const _WALLET_SETUP_ASKED_KEY = 'gopang_wallet_setup_asked_v1';

function _showAccountExistsCheck() {
  return new Promise((resolve) => {
    document.getElementById('_account-exists-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = '_account-exists-overlay';
    overlay.style.cssText = [
      'position:fixed;inset:0;z-index:10002',
      'background:rgba(0,0,0,0.5)',
      'display:flex;align-items:center;justify-content:center',
      'padding:24px;box-sizing:border-box',
    ].join(';');

    overlay.innerHTML = `
      <div style="background:#fff;border-radius:20px;padding:28px 22px;
                  width:100%;max-width:360px;box-sizing:border-box;">
        <p style="font-weight:700;font-size:16px;margin:0 0 10px;color:#111827">
          이미 혼디 계정이 있으신가요?
        </p>
        <p style="font-size:13px;color:#374151;line-height:1.6;margin:0 0 20px">
          스마트폰에서 이미 가입하셨다면, 그 계정을 이 PC에서도 이용할 수 있습니다.
        </p>
        <div style="display:flex;gap:8px">
          <button id="_ae_no"
            style="flex:1;padding:13px;border:1px solid #e5e7eb;border-radius:10px;
                   background:none;cursor:pointer;font-size:14px;font-family:inherit">
            아니요, 처음이에요
          </button>
          <button id="_ae_yes"
            style="flex:1;padding:13px;border:none;border-radius:10px;
                   background:#16a34a;color:#fff;cursor:pointer;
                   font-size:14px;font-weight:700;font-family:inherit">
            네, 있어요
          </button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#_ae_yes').onclick = () => { overlay.remove(); resolve(true); };
    overlay.querySelector('#_ae_no').onclick  = () => { overlay.remove(); resolve(false); };
  });
}

function _showDedicatedOrSharedChoice() {
  return new Promise((resolve) => {
    document.getElementById('_pc-mode-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = '_pc-mode-overlay';
    overlay.style.cssText = [
      'position:fixed;inset:0;z-index:10002',
      'background:rgba(0,0,0,0.5)',
      'display:flex;align-items:center;justify-content:center',
      'padding:24px;box-sizing:border-box',
    ].join(';');

    overlay.innerHTML = `
      <div style="background:#fff;border-radius:20px;padding:28px 22px;
                  width:100%;max-width:360px;box-sizing:border-box">
        <p style="font-weight:700;font-size:16px;margin:0 0 10px;color:#111827">
          이 PC는 어떤 PC인가요?
        </p>
        <p style="font-size:13px;color:#374151;line-height:1.6;margin:0 0 20px">
          전용 PC를 선택하면 다음부터 폰 없이 바로 로그인됩니다.<br>
          공용 PC를 선택하면 이 PC엔 아무 정보도 남지 않습니다.
        </p>
        <button id="_pm_dedicated"
          style="width:100%;padding:13px;border:none;border-radius:10px;
                 background:#16a34a;color:#fff;cursor:pointer;
                 font-size:14px;font-weight:700;font-family:inherit;margin-bottom:8px">
          저만 쓰는 전용 PC예요
        </button>
        <button id="_pm_shared"
          style="width:100%;padding:13px;border:1px solid #e5e7eb;border-radius:10px;
                 background:none;cursor:pointer;font-size:14px;font-family:inherit">
          여러 사람이 쓰는 공용 PC예요
        </button>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#_pm_dedicated').onclick = () => { overlay.remove(); resolve('dedicated'); };
    overlay.querySelector('#_pm_shared').onclick    = () => { overlay.remove(); resolve('shared'); };
  });
}

/**
 * ensureWalletSetup()
 * 서명이 실제로 필요해진 지점(현재: sendMessage())에서 호출.
 * - 이미 지갑이 있거나(window.gopangWallet), 애초에 이 PC가 대상이
 *   아니면(gopangWalletNeedsSetup 미설정) 즉시 반환 — UI 없음.
 * - 이번 세션에 이미 한 번 물어봤으면 다시 안 물어봄.
 * - "처음이에요" → 관여 안 함(기존 회원가입 흐름에 맡김).
 * - "전용 PC" → device-link.html로 이동(이 페이지로 돌아오는 return
 *   파라미터 포함) — 진짜 개인키를 X25519 봉투로 전달받음.
 * - "공용 PC" → sessionStorage에 표시만 하고 종료(3~5단계에서 이 표시를
 *   보고 매 서명을 폰에 그때그때 위임하도록 이어붙일 예정 — 아직 미구현).
 */
export async function ensureWalletSetup() {
  if (window.gopangWallet) return;               // 이미 있음
  if (!window.gopangWalletNeedsSetup) return;     // 이 PC 대상 아님(모바일/잠김 등)
  if (sessionStorage.getItem(_WALLET_SETUP_ASKED_KEY)) return; // 이번 세션에 이미 물어봄

  sessionStorage.setItem(_WALLET_SETUP_ASKED_KEY, '1');

  const hasAccount = await _showAccountExistsCheck();
  if (!hasAccount) return; // 진짜 신규 방문자 — 기존 회원가입 흐름에 맡김

  const mode = await _showDedicatedOrSharedChoice();
  if (mode === 'dedicated') {
    location.href = '/auth/device-link.html?return=' + encodeURIComponent(location.href);
    return; // 페이지 이동 — 이후 코드 실행 안 됨
  }
  // mode === 'shared'
  sessionStorage.setItem('gopang_pc_session_mode', 'shared');
  // 2026-07-23 — 4단계: 실제 서명 프록시를 window.gopangWallet 자리에
  // 꽂는다. 기존 호출부들(call-ai.js, p2p-chat.js, gwp/sign.js 등)은
  // 전부 window.gopangWallet?.sign(...) 형태로 이미 짜여 있어서, 이
  // 시점 이후로는 어떤 호출부도 수정할 필요 없이 자동으로 폰 승인
  // 경유 서명을 쓰게 된다 — 개인키는 이 PC에 여전히 없다.
  if (typeof window.GopangWallet?.createSessionSignProxy === 'function') {
    window.gopangWallet = window.GopangWallet.createSessionSignProxy();
    const stored = (() => {
      try { return JSON.parse(localStorage.getItem(STORE_KEY) || sessionStorage.getItem(STORE_KEY) || 'null'); }
      catch { return null; }
    })();
    if (stored?.ipv6) window.gopangWallet.setIdentity({ guid: stored.ipv6, handle: stored.handle || null });
  }
  console.info('[Auth] 공용 PC 모드로 설정 — 이 세션엔 개인키를 저장하지 않습니다. 서명이 필요할 때마다 폰 승인을 거칩니다.');
}

// ── 한국 유선 지역번호 목록 (서울만 1자리, 나머지 전부 2자리) ──────
// hondi-digit-code.js의 VALID_AREA_CODES와 반드시 동일한 코드 값을
// 유지해야 한다(숫자 코드 인코딩/디코딩과 짝이 맞아야 하므로).
// 2026-07-27 — export 추가: auth/device-link.html이 자체적으로 전화번호
// 정규화를 다시 구현하다가(normalizePhoneToE164) 휴대폰 앞자리 "010"
// 누락을 검증 없이 그냥 이어붙이는 버그를 냈다(사고실험에서 발견 —
// 존재하는 계정인데 "번호로 등록된 계정 없음" 오류가 남). 근본 원인은
// 이 목록과 아래 _buildKrE164/krNeededDigitsFor 같은 검증된 로직이
// 이 파일에만 있고 재사용이 안 됐던 것 — 이제 export해서 그쪽에서
// 그대로 가져다 쓴다.
export const KR_AREA_CODES = [
  { code: '2',  name: '서울' },
  { code: '31', name: '경기' },
  { code: '32', name: '인천' },
  { code: '33', name: '강원' },
  { code: '41', name: '충남' },
  { code: '42', name: '대전' },
  { code: '43', name: '충북' },
  { code: '44', name: '세종' },
  { code: '51', name: '부산' },
  { code: '52', name: '울산' },
  { code: '53', name: '대구' },
  { code: '54', name: '경북' },
  { code: '55', name: '경남' },
  { code: '61', name: '전남' },
  { code: '62', name: '광주' },
  { code: '63', name: '전북' },
  { code: '64', name: '제주' },
];

const COUNTRIES = {
  AF: { flag: "🇦🇫", name: "Afghanistan", code: "+93", prefix: "", digits: 9 },
  AL: { flag: "🇦🇱", name: "Albania", code: "+355", prefix: "0", digits: 9 },
  DZ: { flag: "🇩🇿", name: "Algeria", code: "+213", prefix: "0", digits: 9 },
  AD: { flag: "🇦🇩", name: "Andorra", code: "+376", prefix: "", digits: 6 },
  AO: { flag: "🇦🇴", name: "Angola", code: "+244", prefix: "", digits: 9 },
  AG: { flag: "🇦🇬", name: "Antigua & Barbuda", code: "+1268", prefix: "", digits: 7 },
  AR: { flag: "🇦🇷", name: "Argentina", code: "+54", prefix: "0", digits: 10 },
  AM: { flag: "🇦🇲", name: "Armenia", code: "+374", prefix: "0", digits: 8 },
  AU: { flag: "🇦🇺", name: "Australia", code: "+61", prefix: "0", digits: 9 },
  AT: { flag: "🇦🇹", name: "Austria", code: "+43", prefix: "0", digits: 10 },
  AZ: { flag: "🇦🇿", name: "Azerbaijan", code: "+994", prefix: "0", digits: 9 },
  BS: { flag: "🇧🇸", name: "Bahamas", code: "+1242", prefix: "", digits: 7 },
  BH: { flag: "🇧🇭", name: "Bahrain", code: "+973", prefix: "", digits: 8 },
  BD: { flag: "🇧🇩", name: "Bangladesh", code: "+880", prefix: "0", digits: 10 },
  BB: { flag: "🇧🇧", name: "Barbados", code: "+1246", prefix: "", digits: 7 },
  BY: { flag: "🇧🇾", name: "Belarus", code: "+375", prefix: "0", digits: 9 },
  BE: { flag: "🇧🇪", name: "Belgium", code: "+32", prefix: "0", digits: 9 },
  BZ: { flag: "🇧🇿", name: "Belize", code: "+501", prefix: "", digits: 7 },
  BJ: { flag: "🇧🇯", name: "Benin", code: "+229", prefix: "", digits: 8 },
  BT: { flag: "🇧🇹", name: "Bhutan", code: "+975", prefix: "", digits: 8 },
  BO: { flag: "🇧🇴", name: "Bolivia", code: "+591", prefix: "0", digits: 8 },
  BA: { flag: "🇧🇦", name: "Bosnia & Herzegovina", code: "+387", prefix: "0", digits: 8 },
  BW: { flag: "🇧🇼", name: "Botswana", code: "+267", prefix: "", digits: 8 },
  BR: { flag: "🇧🇷", name: "Brazil", code: "+55", prefix: "0", digits: 11 },
  BN: { flag: "🇧🇳", name: "Brunei", code: "+673", prefix: "", digits: 7 },
  BG: { flag: "🇧🇬", name: "Bulgaria", code: "+359", prefix: "0", digits: 9 },
  BF: { flag: "🇧🇫", name: "Burkina Faso", code: "+226", prefix: "", digits: 8 },
  BI: { flag: "🇧🇮", name: "Burundi", code: "+257", prefix: "", digits: 8 },
  CV: { flag: "🇨🇻", name: "Cabo Verde", code: "+238", prefix: "", digits: 7 },
  KH: { flag: "🇰🇭", name: "Cambodia", code: "+855", prefix: "0", digits: 9 },
  CM: { flag: "🇨🇲", name: "Cameroon", code: "+237", prefix: "", digits: 9 },
  CA: { flag: "🇨🇦", name: "Canada", code: "+1", prefix: "", digits: 10 },
  CF: { flag: "🇨🇫", name: "Central African Rep.", code: "+236", prefix: "", digits: 8 },
  TD: { flag: "🇹🇩", name: "Chad", code: "+235", prefix: "", digits: 8 },
  CL: { flag: "🇨🇱", name: "Chile", code: "+56", prefix: "0", digits: 9 },
  CN: { flag: "🇨🇳", name: "China", code: "+86", prefix: "", digits: 11 },
  CO: { flag: "🇨🇴", name: "Colombia", code: "+57", prefix: "0", digits: 10 },
  KM: { flag: "🇰🇲", name: "Comoros", code: "+269", prefix: "", digits: 7 },
  CG: { flag: "🇨🇬", name: "Congo", code: "+242", prefix: "", digits: 9 },
  CD: { flag: "🇨🇩", name: "Congo (DR)", code: "+243", prefix: "0", digits: 9 },
  CR: { flag: "🇨🇷", name: "Costa Rica", code: "+506", prefix: "", digits: 8 },
  CI: { flag: "🇨🇮", name: "Côte d'Ivoire", code: "+225", prefix: "", digits: 10 },
  HR: { flag: "🇭🇷", name: "Croatia", code: "+385", prefix: "0", digits: 9 },
  CU: { flag: "🇨🇺", name: "Cuba", code: "+53", prefix: "0", digits: 8 },
  CY: { flag: "🇨🇾", name: "Cyprus", code: "+357", prefix: "", digits: 8 },
  CZ: { flag: "🇨🇿", name: "Czech Republic", code: "+420", prefix: "", digits: 9 },
  DK: { flag: "🇩🇰", name: "Denmark", code: "+45", prefix: "", digits: 8 },
  DJ: { flag: "🇩🇯", name: "Djibouti", code: "+253", prefix: "", digits: 8 },
  DM: { flag: "🇩🇲", name: "Dominica", code: "+1767", prefix: "", digits: 7 },
  DO: { flag: "🇩🇴", name: "Dominican Republic", code: "+1809", prefix: "", digits: 7 },
  EC: { flag: "🇪🇨", name: "Ecuador", code: "+593", prefix: "0", digits: 9 },
  EG: { flag: "🇪🇬", name: "Egypt", code: "+20", prefix: "0", digits: 10 },
  SV: { flag: "🇸🇻", name: "El Salvador", code: "+503", prefix: "", digits: 8 },
  GQ: { flag: "🇬🇶", name: "Equatorial Guinea", code: "+240", prefix: "", digits: 9 },
  ER: { flag: "🇪🇷", name: "Eritrea", code: "+291", prefix: "0", digits: 7 },
  EE: { flag: "🇪🇪", name: "Estonia", code: "+372", prefix: "", digits: 8 },
  SZ: { flag: "🇸🇿", name: "Eswatini", code: "+268", prefix: "", digits: 8 },
  ET: { flag: "🇪🇹", name: "Ethiopia", code: "+251", prefix: "0", digits: 9 },
  FJ: { flag: "🇫🇯", name: "Fiji", code: "+679", prefix: "", digits: 7 },
  FI: { flag: "🇫🇮", name: "Finland", code: "+358", prefix: "0", digits: 9 },
  FR: { flag: "🇫🇷", name: "France", code: "+33", prefix: "0", digits: 9 },
  GA: { flag: "🇬🇦", name: "Gabon", code: "+241", prefix: "0", digits: 8 },
  GM: { flag: "🇬🇲", name: "Gambia", code: "+220", prefix: "", digits: 7 },
  GE: { flag: "🇬🇪", name: "Georgia", code: "+995", prefix: "0", digits: 9 },
  DE: { flag: "🇩🇪", name: "Germany", code: "+49", prefix: "0", digits: 11 },
  GH: { flag: "🇬🇭", name: "Ghana", code: "+233", prefix: "0", digits: 9 },
  GR: { flag: "🇬🇷", name: "Greece", code: "+30", prefix: "", digits: 10 },
  GD: { flag: "🇬🇩", name: "Grenada", code: "+1473", prefix: "", digits: 7 },
  GT: { flag: "🇬🇹", name: "Guatemala", code: "+502", prefix: "", digits: 8 },
  GN: { flag: "🇬🇳", name: "Guinea", code: "+224", prefix: "", digits: 9 },
  GW: { flag: "🇬🇼", name: "Guinea-Bissau", code: "+245", prefix: "", digits: 9 },
  GY: { flag: "🇬🇾", name: "Guyana", code: "+592", prefix: "", digits: 7 },
  HT: { flag: "🇭🇹", name: "Haiti", code: "+509", prefix: "", digits: 8 },
  HN: { flag: "🇭🇳", name: "Honduras", code: "+504", prefix: "", digits: 8 },
  HU: { flag: "🇭🇺", name: "Hungary", code: "+36", prefix: "06", digits: 8 },
  IS: { flag: "🇮🇸", name: "Iceland", code: "+354", prefix: "", digits: 7 },
  IN: { flag: "🇮🇳", name: "India", code: "+91", prefix: "0", digits: 10 },
  ID: { flag: "🇮🇩", name: "Indonesia", code: "+62", prefix: "0", digits: 11 },
  IR: { flag: "🇮🇷", name: "Iran", code: "+98", prefix: "0", digits: 10 },
  IQ: { flag: "🇮🇶", name: "Iraq", code: "+964", prefix: "0", digits: 10 },
  IE: { flag: "🇮🇪", name: "Ireland", code: "+353", prefix: "0", digits: 9 },
  IL: { flag: "🇮🇱", name: "Israel", code: "+972", prefix: "0", digits: 9 },
  IT: { flag: "🇮🇹", name: "Italy", code: "+39", prefix: "0", digits: 10 },
  JM: { flag: "🇯🇲", name: "Jamaica", code: "+1876", prefix: "", digits: 7 },
  JP: { flag: "🇯🇵", name: "Japan", code: "+81", prefix: "0", digits: 10 },
  JO: { flag: "🇯🇴", name: "Jordan", code: "+962", prefix: "0", digits: 9 },
  KZ: { flag: "🇰🇿", name: "Kazakhstan", code: "+7", prefix: "8", digits: 10 },
  KE: { flag: "🇰🇪", name: "Kenya", code: "+254", prefix: "0", digits: 9 },
  KI: { flag: "🇰🇮", name: "Kiribati", code: "+686", prefix: "", digits: 5 },
  KP: { flag: "🇰🇵", name: "Korea (North)", code: "+850", prefix: "0", digits: 10 },
  KR: { flag: "🇰🇷", name: "Korea (South)", code: "+82", prefix: "010", digits: 8 },
  KW: { flag: "🇰🇼", name: "Kuwait", code: "+965", prefix: "", digits: 8 },
  KG: { flag: "🇰🇬", name: "Kyrgyzstan", code: "+996", prefix: "0", digits: 9 },
  LA: { flag: "🇱🇦", name: "Laos", code: "+856", prefix: "0", digits: 9 },
  LV: { flag: "🇱🇻", name: "Latvia", code: "+371", prefix: "", digits: 8 },
  LB: { flag: "🇱🇧", name: "Lebanon", code: "+961", prefix: "0", digits: 8 },
  LS: { flag: "🇱🇸", name: "Lesotho", code: "+266", prefix: "", digits: 8 },
  LR: { flag: "🇱🇷", name: "Liberia", code: "+231", prefix: "0", digits: 8 },
  LY: { flag: "🇱🇾", name: "Libya", code: "+218", prefix: "0", digits: 9 },
  LI: { flag: "🇱🇮", name: "Liechtenstein", code: "+423", prefix: "", digits: 7 },
  LT: { flag: "🇱🇹", name: "Lithuania", code: "+370", prefix: "8", digits: 8 },
  LU: { flag: "🇱🇺", name: "Luxembourg", code: "+352", prefix: "", digits: 9 },
  MG: { flag: "🇲🇬", name: "Madagascar", code: "+261", prefix: "0", digits: 9 },
  MW: { flag: "🇲🇼", name: "Malawi", code: "+265", prefix: "0", digits: 9 },
  MY: { flag: "🇲🇾", name: "Malaysia", code: "+60", prefix: "0", digits: 9 },
  MV: { flag: "🇲🇻", name: "Maldives", code: "+960", prefix: "", digits: 7 },
  ML: { flag: "🇲🇱", name: "Mali", code: "+223", prefix: "", digits: 8 },
  MT: { flag: "🇲🇹", name: "Malta", code: "+356", prefix: "", digits: 8 },
  MH: { flag: "🇲🇭", name: "Marshall Islands", code: "+692", prefix: "", digits: 7 },
  MR: { flag: "🇲🇷", name: "Mauritania", code: "+222", prefix: "", digits: 8 },
  MU: { flag: "🇲🇺", name: "Mauritius", code: "+230", prefix: "", digits: 8 },
  MX: { flag: "🇲🇽", name: "Mexico", code: "+52", prefix: "01", digits: 10 },
  FM: { flag: "🇫🇲", name: "Micronesia", code: "+691", prefix: "", digits: 7 },
  MD: { flag: "🇲🇩", name: "Moldova", code: "+373", prefix: "0", digits: 8 },
  MC: { flag: "🇲🇨", name: "Monaco", code: "+377", prefix: "", digits: 8 },
  MN: { flag: "🇲🇳", name: "Mongolia", code: "+976", prefix: "0", digits: 8 },
  ME: { flag: "🇲🇪", name: "Montenegro", code: "+382", prefix: "0", digits: 8 },
  MA: { flag: "🇲🇦", name: "Morocco", code: "+212", prefix: "0", digits: 9 },
  MZ: { flag: "🇲🇿", name: "Mozambique", code: "+258", prefix: "0", digits: 9 },
  MM: { flag: "🇲🇲", name: "Myanmar", code: "+95", prefix: "0", digits: 9 },
  NA: { flag: "🇳🇦", name: "Namibia", code: "+264", prefix: "0", digits: 9 },
  NR: { flag: "🇳🇷", name: "Nauru", code: "+674", prefix: "", digits: 7 },
  NP: { flag: "🇳🇵", name: "Nepal", code: "+977", prefix: "0", digits: 10 },
  NL: { flag: "🇳🇱", name: "Netherlands", code: "+31", prefix: "0", digits: 9 },
  NZ: { flag: "🇳🇿", name: "New Zealand", code: "+64", prefix: "0", digits: 9 },
  NI: { flag: "🇳🇮", name: "Nicaragua", code: "+505", prefix: "", digits: 8 },
  NE: { flag: "🇳🇪", name: "Niger", code: "+227", prefix: "", digits: 8 },
  NG: { flag: "🇳🇬", name: "Nigeria", code: "+234", prefix: "0", digits: 10 },
  MK: { flag: "🇲🇰", name: "North Macedonia", code: "+389", prefix: "0", digits: 8 },
  NO: { flag: "🇳🇴", name: "Norway", code: "+47", prefix: "", digits: 8 },
  OM: { flag: "🇴🇲", name: "Oman", code: "+968", prefix: "", digits: 8 },
  PK: { flag: "🇵🇰", name: "Pakistan", code: "+92", prefix: "0", digits: 10 },
  PW: { flag: "🇵🇼", name: "Palau", code: "+680", prefix: "", digits: 7 },
  PA: { flag: "🇵🇦", name: "Panama", code: "+507", prefix: "", digits: 8 },
  PG: { flag: "🇵🇬", name: "Papua New Guinea", code: "+675", prefix: "", digits: 8 },
  PY: { flag: "🇵🇾", name: "Paraguay", code: "+595", prefix: "0", digits: 9 },
  PE: { flag: "🇵🇪", name: "Peru", code: "+51", prefix: "0", digits: 9 },
  PH: { flag: "🇵🇭", name: "Philippines", code: "+63", prefix: "0", digits: 10 },
  PL: { flag: "🇵🇱", name: "Poland", code: "+48", prefix: "0", digits: 9 },
  PT: { flag: "🇵🇹", name: "Portugal", code: "+351", prefix: "", digits: 9 },
  QA: { flag: "🇶🇦", name: "Qatar", code: "+974", prefix: "", digits: 8 },
  RO: { flag: "🇷🇴", name: "Romania", code: "+40", prefix: "0", digits: 9 },
  RU: { flag: "🇷🇺", name: "Russia", code: "+7", prefix: "8", digits: 10 },
  RW: { flag: "🇷🇼", name: "Rwanda", code: "+250", prefix: "0", digits: 9 },
  KN: { flag: "🇰🇳", name: "Saint Kitts & Nevis", code: "+1869", prefix: "", digits: 7 },
  LC: { flag: "🇱🇨", name: "Saint Lucia", code: "+1758", prefix: "", digits: 7 },
  VC: { flag: "🇻🇨", name: "Saint Vincent", code: "+1784", prefix: "", digits: 7 },
  WS: { flag: "🇼🇸", name: "Samoa", code: "+685", prefix: "", digits: 7 },
  SM: { flag: "🇸🇲", name: "San Marino", code: "+378", prefix: "", digits: 10 },
  ST: { flag: "🇸🇹", name: "São Tomé & Príncipe", code: "+239", prefix: "", digits: 7 },
  SA: { flag: "🇸🇦", name: "Saudi Arabia", code: "+966", prefix: "0", digits: 9 },
  SN: { flag: "🇸🇳", name: "Senegal", code: "+221", prefix: "", digits: 9 },
  RS: { flag: "🇷🇸", name: "Serbia", code: "+381", prefix: "0", digits: 9 },
  SC: { flag: "🇸🇨", name: "Seychelles", code: "+248", prefix: "", digits: 7 },
  SL: { flag: "🇸🇱", name: "Sierra Leone", code: "+232", prefix: "0", digits: 8 },
  SG: { flag: "🇸🇬", name: "Singapore", code: "+65", prefix: "", digits: 8 },
  SK: { flag: "🇸🇰", name: "Slovakia", code: "+421", prefix: "0", digits: 9 },
  SI: { flag: "🇸🇮", name: "Slovenia", code: "+386", prefix: "0", digits: 8 },
  SB: { flag: "🇸🇧", name: "Solomon Islands", code: "+677", prefix: "", digits: 7 },
  SO: { flag: "🇸🇴", name: "Somalia", code: "+252", prefix: "0", digits: 9 },
  ZA: { flag: "🇿🇦", name: "South Africa", code: "+27", prefix: "0", digits: 9 },
  SS: { flag: "🇸🇸", name: "South Sudan", code: "+211", prefix: "0", digits: 9 },
  ES: { flag: "🇪🇸", name: "Spain", code: "+34", prefix: "", digits: 9 },
  LK: { flag: "🇱🇰", name: "Sri Lanka", code: "+94", prefix: "0", digits: 9 },
  SD: { flag: "🇸🇩", name: "Sudan", code: "+249", prefix: "0", digits: 9 },
  SR: { flag: "🇸🇷", name: "Suriname", code: "+597", prefix: "", digits: 7 },
  SE: { flag: "🇸🇪", name: "Sweden", code: "+46", prefix: "0", digits: 9 },
  CH: { flag: "🇨🇭", name: "Switzerland", code: "+41", prefix: "0", digits: 9 },
  SY: { flag: "🇸🇾", name: "Syria", code: "+963", prefix: "0", digits: 9 },
  TW: { flag: "🇹🇼", name: "Taiwan", code: "+886", prefix: "0", digits: 9 },
  TJ: { flag: "🇹🇯", name: "Tajikistan", code: "+992", prefix: "0", digits: 9 },
  TZ: { flag: "🇹🇿", name: "Tanzania", code: "+255", prefix: "0", digits: 9 },
  TH: { flag: "🇹🇭", name: "Thailand", code: "+66", prefix: "0", digits: 9 },
  TL: { flag: "🇹🇱", name: "Timor-Leste", code: "+670", prefix: "", digits: 8 },
  TG: { flag: "🇹🇬", name: "Togo", code: "+228", prefix: "", digits: 8 },
  TO: { flag: "🇹🇴", name: "Tonga", code: "+676", prefix: "", digits: 7 },
  TT: { flag: "🇹🇹", name: "Trinidad & Tobago", code: "+1868", prefix: "", digits: 7 },
  TN: { flag: "🇹🇳", name: "Tunisia", code: "+216", prefix: "", digits: 8 },
  TR: { flag: "🇹🇷", name: "Turkey", code: "+90", prefix: "0", digits: 10 },
  TM: { flag: "🇹🇲", name: "Turkmenistan", code: "+993", prefix: "8", digits: 8 },
  TV: { flag: "🇹🇻", name: "Tuvalu", code: "+688", prefix: "", digits: 5 },
  UG: { flag: "🇺🇬", name: "Uganda", code: "+256", prefix: "0", digits: 9 },
  UA: { flag: "🇺🇦", name: "Ukraine", code: "+380", prefix: "0", digits: 9 },
  AE: { flag: "🇦🇪", name: "UAE", code: "+971", prefix: "0", digits: 9 },
  GB: { flag: "🇬🇧", name: "United Kingdom", code: "+44", prefix: "0", digits: 10 },
  US: { flag: "🇺🇸", name: "United States", code: "+1", prefix: "", digits: 10 },
  UY: { flag: "🇺🇾", name: "Uruguay", code: "+598", prefix: "0", digits: 9 },
  UZ: { flag: "🇺🇿", name: "Uzbekistan", code: "+998", prefix: "8", digits: 9 },
  VU: { flag: "🇻🇺", name: "Vanuatu", code: "+678", prefix: "", digits: 7 },
  VE: { flag: "🇻🇪", name: "Venezuela", code: "+58", prefix: "0", digits: 10 },
  VN: { flag: "🇻🇳", name: "Vietnam", code: "+84", prefix: "0", digits: 9 },
  YE: { flag: "🇾🇪", name: "Yemen", code: "+967", prefix: "0", digits: 9 },
  ZM: { flag: "🇿🇲", name: "Zambia", code: "+260", prefix: "0", digits: 9 },
  ZW: { flag: "🇿🇼", name: "Zimbabwe", code: "+263", prefix: "0", digits: 9 },
};

// ── E.164 / Handle / GUID 빌더 ────────────────────────────
export function buildE164(phoneDigits, countryKey = DEFAULT_COUNTRY) {
  const c = COUNTRIES[countryKey] || COUNTRIES[DEFAULT_COUNTRY];
  return c.code + c.prefix + phoneDigits;
}

export function buildHandle(phoneDigits, countryKey = DEFAULT_COUNTRY) {
  return countryKey === DEFAULT_COUNTRY
    ? `@${phoneDigits}`
    : `@${countryKey}-${phoneDigits}`;
}

// ── 한국 휴대폰/지역번호 전용 e164·handle 빌더 ────────────────
// 휴대폰인 경우 기존 buildE164/buildHandle과 완전히 동일한 결과를
// 내야 한다(기존 가입자와의 호환성) — 그래서 그대로 위임한다.
// 지역번호(유선)인 경우는 새 포맷이며, handle에 "-"를 포함시켜
// 순수 숫자로만 이뤄진 휴대폰 handle과 절대 겹치지 않게 한다.
export function _buildKrE164(phoneType, areaCode, digits) {
  if (phoneType === 'mobile') return buildE164(digits, 'KR');
  return `+82` + `0${areaCode}` + digits;
}

export function _buildKrHandle(phoneType, areaCode, digits) {
  if (phoneType === 'mobile') return buildHandle(digits, 'KR');
  return `@0${areaCode}-${digits}`;
}

// 휴대폰/지역번호 선택 시 필요한 가입자번호 자릿수(서울만 8자리, 그 외
// 지역은 7자리, 휴대폰은 8자리) — 순수 함수로 분리해 외부(예:
// auth/device-link.html)에서도 재사용할 수 있게 했다(2026-07-27,
// _buildKrE164와 짝을 이루는 export — 위 changelog 참고).
export function krNeededDigitsFor(phoneType, areaCode) {
  if (phoneType === 'mobile') return 8;
  return areaCode === '2' ? 8 : 7;
}

// ── SHA-256 헬퍼 ─────────────────────────────────────────
export async function _sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ── 신규/재가입 시 GUID 생성 — 2026-09-06 변경: 전화번호 결정론적 해시 폐기 ──
// 기존 _e164ToIPv6(e164)는 SHA-256('gopang-phone:'+e164)로 guid를 만들어서,
// "같은 전화번호로 가입하면 항상 같은 guid"가 나왔다. 문제: 한국 통신사는
// 해지된 번호를 통상 3~6개월 뒤 다른 사람에게 재배정한다 — 그 경우 새
// 소유자가 이전 소유자와 완전히 동일한 guid를 계산해내서, ledger/blocks에
// 남아있던 이전 소유자의 GDC 잔액·거래이력·K-Law 상담기록을 그대로
// 물려받는 계정 탈취급 결함이 있었다(2026-09-06 실사로 발견·수정).
//
// 수정: guid를 전화번호와 무관한 CSPRNG(암호학적으로 안전한 난수)로 생성한다.
// IPv6 8그룹 형식은 하위 시스템(GDUDA 라우팅 등)과의 호환을 위해 유지하되,
// 앞 2그룹(2601:db80:)은 여전히 "고팡 발급 주소"임을 나타내는 고정 프리픽스로
// 남겨두고, 나머지 6그룹(96비트)을 crypto.getRandomValues()로 채운다.
// 96비트 난수 공간이면 생일역설을 감안해도 실질적으로 충돌 가능성이 없다.
async function _generateRandomGuid() {
  const randBytes = crypto.getRandomValues(new Uint8Array(12)); // 96비트
  const hex = Array.from(randBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  const groups = ['2601', 'db80'];
  for (let i = 0; i < 6; i++) groups.push(hex.slice(i * 4, i * 4 + 4));
  return groups.join(':');
}

// 하위 호환용 별칭 — 기존 호출부(_e164ToIPv6(e164))를 전부 바꾸는 대신,
// 같은 이름으로 시그니처만 유지하고 내부적으로 무작위 생성을 쓴다.
// e164 인자는 더 이상 guid 계산에 쓰이지 않는다(의도적으로 무시함 — 실수로
// 다시 해시에 섞어 넣지 않도록 아래에서 인자명을 _unusedE164로 명시).
async function _e164ToIPv6(_unusedE164) {
  return _generateRandomGuid();
}

// ── window.gopangWallet 준비 대기 ────────────────────────
// gopang-wallet.js의 싱글턴 초기화는 비동기(IIFE)라서, 이 모듈이 먼저 실행되면
// window.gopangWallet이 아직 null/undefined일 수 있다. 최대 5초 폴링.
function _waitForWallet(timeoutMs = 15000) {
  return new Promise((resolve) => {
    if (window.gopangWallet) { resolve(window.gopangWallet); return; }
    // 2026-07-28 수정 — PC/미확인 기기(gopangWalletNeedsSetup)나 지갑
    // 복호화 영구 실패(gopangWalletLocked) 상태는 gopang-wallet.js의
    // 부트 IIFE가 이미 "window.gopangWallet은 영구히 null"이라고 확정한
    // 것인데, 이 폴링 루프는 그 사실을 몰라 15초 타임아웃을 매번 꽉
    // 채우고서야 포기했다 — "시작하기" 클릭 후 대기 화면이 뜨기까지
    // 10~13초씩 걸리던 지연의 정체(사용자 지시로 실사·발견). 두 플래그
    // 중 하나라도 이미 서 있으면 그 자리에서 즉시 포기한다.
    if (window.gopangWalletNeedsSetup || window.gopangWalletLocked) { resolve(null); return; }
    const start = Date.now();
    const t = setInterval(() => {
      if (window.gopangWallet) {
        clearInterval(t);
        resolve(window.gopangWallet);
      } else if (window.gopangWalletNeedsSetup || window.gopangWalletLocked) {
        clearInterval(t);
        resolve(null);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(t);
        resolve(null);
      }
    }, 100);
  });
}

// ── _issueSession — Ed25519 챌린지 서명 → Worker /auth/issue 검증 ───────
// v6.0: 로그인(또는 가입 직후 세션 수립)은 "전화번호/닉네임을 안다"가 아니라
// "그 guid에 핀(pin)된 Ed25519 개인키를 갖고 있다"로만 증명되어야 한다.
// 서버가 TOFU 핀과 다른 공개키를 보면 PUBKEY_MISMATCH를 반환 — 이 기기가
// 그 계정의 정당한 기기가 아니라는 뜻이므로, 호출부는 절대 로그인으로
// 폴백하지 말고 reason을 그대로 사용자에게 보여줘야 한다.
export async function _issueSession(guid, svc = 'gopang', level = 'L0') {
  // DEV_MODE: 서명 검증 우회
  if (typeof DEV_MODE !== 'undefined' && DEV_MODE) {
    console.info('[DEV] _issueSession 우회 — guid:', guid);
    return { ok: true };
  }
  const wallet = await _waitForWallet();
  if (!wallet?.publicKeyB64u || typeof wallet.signPayload !== 'function') {
    return { ok: false, reason: 'wallet_not_ready' };
  }
  const ts = Date.now();
  const sigMsg = `auth-issue:${guid}:${wallet.publicKeyB64u}:${svc}:${ts}`;
  let signature;
  try {
    signature = await wallet.signPayload(sigMsg);
  } catch (e) {
    return { ok: false, reason: 'sign_failed' };
  }
  try {
    const res = await fetch(`${PROXY_URL}/auth/issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guid, pubkey: wallet.publicKeyB64u, signature, ts, level, svc }),
    });
    const data = await res.json().catch(() => ({}));
    // ★ 2026-07-23 수정 — worker.js의 _err()는 {ok:false, error: code, detail}
    // 형태로 응답한다(code라는 필드는 애초에 없음). 여기서 data?.code를
    // 먼저 보던 기존 코드는 항상 undefined만 얻어 data?.detail(사람이 읽는
    // 한글 메시지)로 폴백했다 — PUBKEY_MISMATCH 같은 기계 판별용 코드가
    // 필요한 호출부(_restoreFromBackupKey 경유, 설정화면 백업 키 복구 폼)가
    // 실제로는 한 번도 정확히 그 값과 일치할 수 없었던 원인.
    if (!res.ok) return { ok: false, reason: data?.error || data?.detail || `http_${res.status}`, detail: data?.detail };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'network' };
  }
}

// ── 백업 키 확인 여부(이 기기) ────────────────────────────
const BACKUP_CONFIRMED_KEY = 'gopang_backup_confirmed_v1';
export function _hasConfirmedBackup() {
  try { return localStorage.getItem(BACKUP_CONFIRMED_KEY) === '1'; }
  catch { return false; }
}

// ── 백업 확인 상태를 서버(계정 단위)에도 기록 (2026-08-31 신설) ──
// 배경: 지금까지 위 로컬 플래그만 있어서, 폰에서 이미 백업을 저장한
// 사용자가 PC에서 device-link로 같은 계정을 열어도 PC는 "확인한 적
// 없음"으로 판단해 배너가 다시 떴다(라이브 검증에서 재현). 이 계정
// (guid)의 profiles.backup_confirmed_at을 채워두면, 어느 기기로
// 로그인하든 그 값을 읽어 로컬 플래그를 채울 수 있다(initAuthWithPhone·
// _finishImport의 backup_confirmed_at 하이드레이션 참고).
// 실패해도(오프라인 등) 로컬 확인 자체는 이미 끝난 상태라 조용히
// 무시한다 — 사용자 흐름을 막지 않는다.
export async function _confirmBackupOnServer(guid) {
  if (!guid) return;
  try {
    const wallet = await _waitForWallet(5000);
    if (!wallet?.publicKeyB64u || typeof wallet.signPayload !== 'function') return;
    const ts = Date.now();
    const sigMsg = `${guid}:${wallet.publicKeyB64u}:${ts}`;
    const signature = await wallet.signPayload(sigMsg);
    await fetch(`${PROXY_URL}/auth/confirm-backup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guid, pubkey: wallet.publicKeyB64u, signature, ts }),
    });
  } catch (e) {
    console.warn('[Auth] 백업 확인 서버 기록 실패(무시 — 로컬 확인은 이미 완료):', e.message);
  }
}

// ── 백업 키를 본인 이메일로 — mailto (서버를 거치지 않음) ──
// 서버가 개인키를 보거나 보관하지 않도록, 발송은 전적으로 사용자 기기의
// 메일 앱이 처리한다(mailto:). 키는 기기 → 사용자 본인 메일함으로만 이동한다.
function _mailtoBackupKey(key, handle) {
  const subject = encodeURIComponent('[혼디] 내 백업 키 — 안전하게 보관하세요');
  const body = encodeURIComponent(
    `혼디(Hondi) 계정 백업 키입니다.\n` +
    (handle ? `계정: ${handle}\n` : '') +
    `\n${key}\n\n` +
    `이 키를 아는 사람은 누구나 이 계정이 될 수 있습니다.\n` +
    `이 메일을 다른 사람에게 전달하거나 공개된 곳에 저장하지 마세요.\n` +
    `기기를 분실했을 때, 새 기기의 설정 → 백업 키 화면에서 이 키를 입력하면 계정을 복구할 수 있습니다.`
  );
  window.location.href = `mailto:?subject=${subject}&body=${body}`;
}

// ── 가입 직후 필수 백업 확인 단계 ─────────────────────────
// v6.0: 이 단계를 건너뛸 방법이 없다(닫기/배경클릭 없음, _showPhonePopup과 동일
// 패턴) — resolve()가 호출돼야만 _register()가 끝나고 가입이 "완료"된다.
// 개인키는 서버 어디에도 사본이 없으므로, 사용자가 직접 백업해두지 않으면
// 기기 분실 시 영구히 그 계정을 잃는다 — 이 위험을 가입 완료 조건으로 만든다.
function _showMandatoryBackupStep(key, handle) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = '_backup-mandatory-overlay';
    overlay.style.cssText = [
      'position:fixed;inset:0;z-index:10004',
      'background:rgba(0,0,0,0.6)',
      'display:flex;align-items:center;justify-content:center',
      'padding:24px;box-sizing:border-box',
    ].join(';');

    overlay.innerHTML = `
      <div style="background:#fff;border-radius:20px;padding:28px 22px;
                  width:100%;max-width:380px;box-sizing:border-box">
        <p style="font-weight:700;font-size:17px;margin:0 0 8px;color:#111827;text-align:center">
          백업 키를 저장하세요
        </p>
        <p style="font-size:13px;color:#374151;line-height:1.6;margin:0 0 16px;text-align:center">
          이 키는 이 기기에만 있고, 혼디 서버에는 사본이 없습니다.<br>
          <b>지금 저장하지 않으면, 이 기기를 잃었을 때 계정을 되찾을 방법이 없습니다.</b>
        </p>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;
             padding:12px;font-family:monospace;font-size:12px;word-break:break-all;
             color:#111827;margin-bottom:12px">${key}</div>
        <div style="display:flex;gap:8px;margin-bottom:16px">
          <button id="_bm_copy" style="flex:1;padding:11px;border:1px solid #e5e7eb;border-radius:8px;
                  background:none;color:#16a34a;font-weight:600;cursor:pointer;font-size:13px">
            복사
          </button>
          <button id="_bm_mail" style="flex:1;padding:11px;border:1px solid #e5e7eb;border-radius:8px;
                  background:none;color:#16a34a;font-weight:600;cursor:pointer;font-size:13px">
            이메일로 보내기
          </button>
        </div>
        <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;margin-bottom:16px">
          <input type="checkbox" id="_bm_chk" style="width:16px;height:16px;margin-top:1px;accent-color:#16a34a;flex-shrink:0">
          <span style="font-size:13px;color:#374151;line-height:1.5">이 키를 안전한 곳에 저장했습니다. 분실 시 계정을 복구할 수 없다는 점을 이해했습니다.</span>
        </label>
        <button id="_bm_continue" disabled
          style="width:100%;padding:13px;border:none;border-radius:10px;
                 background:#d1d5db;color:#fff;cursor:not-allowed;
                 font-size:14px;font-weight:700;font-family:inherit;transition:background .15s">
          계속하기
        </button>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#_bm_copy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(key);
        const btn = overlay.querySelector('#_bm_copy');
        btn.textContent = '복사됨';
        setTimeout(() => { btn.textContent = '복사'; }, 1500);
      } catch { alert('복사에 실패했습니다. 직접 길게 눌러 선택해 주세요.'); }
    };
    overlay.querySelector('#_bm_mail').onclick = () => _mailtoBackupKey(key, handle);

    const chk = overlay.querySelector('#_bm_chk');
    const continueBtn = overlay.querySelector('#_bm_continue');
    chk.addEventListener('change', () => {
      continueBtn.disabled = !chk.checked;
      continueBtn.style.background = chk.checked ? '#16a34a' : '#d1d5db';
      continueBtn.style.cursor = chk.checked ? 'pointer' : 'not-allowed';
    });
    continueBtn.onclick = () => {
      if (!chk.checked) return;
      try { localStorage.setItem(BACKUP_CONFIRMED_KEY, '1'); } catch {}
      overlay.remove();
      resolve();
    };
    // 의도적으로 닫기/배경클릭 핸들러를 두지 않음 — 확인 없이는 빠져나갈 수 없다.
  });
}

// ── 백업 키 내보내기 (설정 화면에서 사용) ────────────────
export async function _exportBackupKey() {
  const wallet = await _waitForWallet();
  if (!wallet || typeof wallet.exportPrivateKey !== 'function') return null;
  return wallet.exportPrivateKey();
}

// ── 백업 키로 이 기기의 지갑을 교체 + 서버 검증 ──────────
// 성공하면 window.gopangWallet이 복원된 키로 교체되어, 이후 모든 서명이
// 그 키로 이뤄진다. guid가 주어지면 그 guid에 대해 즉시 /auth/issue로
// 검증까지 시도한다(로그인 복구 흐름용). guid 없이 호출(설정 화면에서의
// 단순 키 교체)도 가능하다.
export async function _restoreFromBackupKey(privKeyB64u, guid = null, svc = 'gopang') {
  if (typeof window.GopangWallet === 'undefined') return { ok: false, reason: 'wallet_module_not_loaded' };
  let wallet;
  try {
    wallet = await window.GopangWallet.restoreFromPrivateKey(privKeyB64u);
  } catch (e) {
    return { ok: false, reason: e.message || 'invalid_key' };
  }
  if (guid) wallet.setIdentity({ guid, handle: null });
  window.gopangWallet = wallet; // 싱글턴 교체 — 이후 서명은 전부 복원된 키로

  // 2026-07-07 신설: 백업 키로 지갑을 복원한다는 건 곧 이 기기의 로컬
  // IndexedDB(financial_state)가 비어있거나 낡았다는 뜻이다(새 기기,
  // 재설치 등) — 재대사가 필요한 바로 그 시나리오다. 서버(L1)의 실제
  // 잔액/prev_settle_hash로 로컬을 교정한다. 실패해도 복구 흐름 자체를
  // 막지는 않는다(다음 거래 시도에서 어차피 STALE_STATE 등으로 다시
  // 드러날 수 있으니 여기서 굳이 전체를 실패시키지 않는다).
  if (guid && typeof wallet.hydrateFromServer === 'function') {
    wallet.hydrateFromServer().catch(e =>
      console.warn('[Wallet] hydrateFromServer 실패(무시하고 복구 계속):', e.message)
    );
  }

  // 백업 키를 직접 입력했다는 것 자체가 "이미 어딘가에 저장해 뒀다"는 증거다 —
  // 이 기기에서 다시 백업 안내로 귀찮게 하지 않는다.
  try { localStorage.setItem(BACKUP_CONFIRMED_KEY, '1'); } catch {}

  if (!guid) return { ok: true };

  const session = await _issueSession(guid, svc);
  if (!session.ok) return { ok: false, reason: session.reason, detail: session.detail };
  return { ok: true };
}

// ── 기기 불일치 안내 → 인라인(오버레이) 기기 승인 ────────────────
// found: L1에서 찾은 기존 계정 레코드, resolve: initAuth류의 원래 resolve 콜백
//
// 2026-07-28 개편(사용자 지시, 재개편) — 예전엔 여기서 device-link.html로
// 페이지 전체를 이동(location.href)했다. 이동 자체가 HTML/CSS/JS를
// 처음부터 다시 받아 파싱·실행하는 비용이라, "시작하기"부터 대기 화면이
// 뜨기까지 지연의 상당 부분이 여기 있었다(백엔드 쪽 왕복 최적화만으로는
// 안 줄어드는 부분). 이제 페이지를 아예 떠나지 않고, 이 오버레이 안에서
// 요청 전송→폴링→복호화→로그인 완료까지 전부 처리한다.
// device-link.html과 동일한 서버 엔드포인트(init/poll)를 그대로 쓰되,
// 클라이언트 로직만 이쪽으로 옮겨왔다 — 폰이 하는 일(승인·서명·전달)은
// 전혀 안 바뀐다. sign_request(공용 PC 서명 요청)는 여전히 별도
// 팝업(device-link.html)을 쓴다 — 그건 원래도 페이지 이동 문제가 없고
// (전용 팝업), opener에 postMessage로 결과를 돌려주는 구조가 그대로
// 적합하다.
function _showDeviceMismatchNotice(found, resolve) {
  document.getElementById('_dl-inline-overlay')?.remove();
  if (!document.getElementById('_dl-inline-style')) {
    const style = document.createElement('style');
    style.id = '_dl-inline-style';
    style.textContent = '@keyframes _dlSpin{to{transform:rotate(360deg)}}';
    document.head.appendChild(style);
  }

  const overlay = document.createElement('div');
  overlay.id = '_dl-inline-overlay';
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:10003',
    'background:rgba(0,0,0,0.5)',
    'display:flex;align-items:center;justify-content:center',
    'padding:24px;box-sizing:border-box',
  ].join(';');
  document.body.appendChild(overlay);

  let sessionId = null;
  let pcKeyPair = null;
  let pollTimer = null;
  let countdownTimer = null;
  let smsFallbackTimer = null;

  const $$ = (id) => overlay.querySelector(id);
  const render = (html) => {
    overlay.innerHTML = `<div style="background:#fff;border-radius:20px;padding:28px 22px;width:100%;max-width:360px;box-sizing:border-box;text-align:center">${html}</div>`;
  };
  const setStatus = (msg, isError) => {
    const el = $$('#_dl-status');
    if (!el) return;
    el.textContent = msg || '';
    el.style.color = isError ? '#dc2626' : '#6b7280';
  };

  function _onVisibilityChange() {
    if (!document.hidden && pollTimer) _pollOnce();
  }
  function stopAll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = null;
    if (smsFallbackTimer) clearTimeout(smsFallbackTimer);
    smsFallbackTimer = null;
    document.removeEventListener('visibilitychange', _onVisibilityChange);
  }
  function closeOverlay(result) {
    stopAll();
    pcKeyPair = null;
    overlay.remove();
    resolve?.(result ?? null);
  }

  function renderWaiting() {
    render(`
      <div style="width:24px;height:24px;border:2.5px solid #e5e7eb;border-top-color:#0057A8;border-radius:50%;animation:_dlSpin 0.8s linear infinite;margin:20px auto"></div>
      <p style="font-size:14px;color:#374151;margin-bottom:6px">스마트폰 알림을 열어 <strong>"본인이 맞습니다"</strong>를 눌러주세요</p>
      <p style="font-size:12px;color:#9ca3af;margin-bottom:10px">알림이 도착하기까지 보통 몇 초에서 20초 정도 걸릴 수 있어요. 잠시만 기다려 주세요.</p>
      <div id="_dl-timer" style="font-size:12px;color:#9ca3af;margin-bottom:14px"></div>
      <button id="_dl-sms" style="width:100%;padding:11px;border:none;border-radius:10px;background:#f3f4f6;color:#374151;cursor:pointer;font-size:12.5px;opacity:0.5;margin-bottom:8px;font-family:inherit">알림이 안 왔나요? 문자로 받기</button>
      <button id="_dl-backup" style="width:100%;padding:11px;border:1px solid #e5e7eb;border-radius:10px;background:none;color:#374151;cursor:pointer;font-size:12.5px;margin-bottom:8px;font-family:inherit">백업 키를 직접 갖고 있어요(수동 입력)</button>
      <button id="_dl-close" style="width:100%;padding:11px;border:none;background:none;color:#9ca3af;cursor:pointer;font-size:12.5px;font-family:inherit">나중에</button>
      <div id="_dl-status" style="font-size:12px;margin-top:10px;min-height:16px"></div>
    `);
    $$('#_dl-sms').onclick = _resendSms;
    $$('#_dl-backup').onclick = _showBackupForm;
    $$('#_dl-close').onclick = () => closeOverlay(null);
  }

  function _startCountdown(seconds) {
    // 문자 재전송·백업 폼에서 뒤로가기 등으로 재호출될 수 있다. 여기서
    // 먼저 정리하지 않으면, 이전 tick()이 나중에 실행되면서 그 사이
    // 재할당된 countdownTimer(=새 인터벌)를 실수로 clearInterval해
    // 버리는 클로저 공유 변수 버그가 생긴다(실사로 발견 — 매 호출부마다
    // 개별적으로 정리하지 않아도 되도록 여기 한 곳에서만 방어한다).
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    let remain = seconds;
    const el = () => $$('#_dl-timer');
    const tick = () => {
      const timerEl = el();
      if (!timerEl) { clearInterval(countdownTimer); return; }
      if (remain <= 0) {
        clearInterval(countdownTimer); countdownTimer = null;
        stopAll();
        _showExpiredGuidance();
        return;
      }
      timerEl.textContent = `${remain}초 후 만료`;
      remain -= 1;
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  function _setupSmsFallback(pushSentToMobile, hasMobileDevice) {
    const btn = $$('#_dl-sms');
    if (!btn) return;
    btn.style.opacity = '0.5';
    btn.disabled = false;
    if (pushSentToMobile === false || hasMobileDevice === false) {
      btn.style.opacity = '1';
    } else {
      // 대기 화면에 "보통 20초 정도 걸릴 수 있다"고 안내했으니(2026-07-28
      // 신설), 그보다 먼저 버튼이 밝아지면 안내와 앞뒤가 안 맞는다 —
      // 같은 기준(20초)으로 맞춘다.
      smsFallbackTimer = setTimeout(() => { if (btn) btn.style.opacity = '1'; }, 20000);
    }
  }

  async function _resendSms() {
    const btn = $$('#_dl-sms');
    if (!sessionId || !btn || btn.disabled) return;
    btn.disabled = true;
    setStatus('문자를 보내는 중...');
    try {
      const res = await fetch(`${PROXY_URL}/auth/device-link/resend-sms`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.detail || data.error || '문자 발송에 실패했습니다.');
      setStatus('문자를 보냈습니다. 잠시만 기다려 주세요.');
      _startCountdown(data.expires_in || 90);
    } catch (e) {
      setStatus(e.message || '문자 발송에 실패했습니다.', true);
      if (btn) btn.disabled = false;
    }
  }

  function _showBackupForm() {
    render(`
      <p style="font-weight:700;font-size:16px;margin:0 0 10px;color:#111827">백업 키 입력</p>
      <p style="font-size:13px;color:#374151;line-height:1.6;margin:0 0 16px">가입 시 또는 설정 → 백업 키에서 내보낸<br>키 문자열을 붙여넣어 주세요.</p>
      <textarea id="_dl-key-input" rows="3" placeholder="백업 키 붙여넣기"
        style="width:100%;border:1px solid #e5e7eb;border-radius:10px;padding:12px;font-size:13px;font-family:monospace;resize:none;box-sizing:border-box;margin-bottom:8px" autocomplete="off" autocorrect="off" spellcheck="false"></textarea>
      <div id="_dl-key-err" style="display:none;font-size:12px;color:#dc2626;margin-bottom:8px"></div>
      <button id="_dl-key-submit" style="width:100%;padding:13px;border:none;border-radius:10px;background:#16a34a;color:#fff;cursor:pointer;margin-bottom:8px;font-size:14px;font-weight:700;font-family:inherit">복구</button>
      <button id="_dl-key-back" style="width:100%;padding:13px;border:1px solid #e5e7eb;border-radius:10px;background:none;color:#6b7280;cursor:pointer;font-size:14px;font-family:inherit">뒤로</button>
    `);
    const input = $$('#_dl-key-input');
    const errEl = $$('#_dl-key-err');
    const subBtn = $$('#_dl-key-submit');
    input.focus();
    $$('#_dl-key-back').onclick = () => { renderWaiting(); if (sessionId) _startCountdown(90); };
    subBtn.onclick = async () => {
      const val = input.value.trim();
      if (!val) { errEl.textContent = '백업 키를 입력해 주세요.'; errEl.style.display = 'block'; return; }
      subBtn.disabled = true; subBtn.textContent = '확인 중…'; errEl.style.display = 'none';
      const result = await _restoreFromBackupKey(val, found.guid, 'gopang');
      if (!result.ok) {
        const msg = result.reason === 'PUBKEY_MISMATCH'
          ? '이 백업 키는 이 계정의 키가 아닙니다.'
          : result.reason === 'invalid_key'
            ? '키 형식이 올바르지 않습니다.'
            : '복구에 실패했습니다' + (result.detail ? ` (${result.detail}).` : ` (${result.reason}).`);
        errEl.textContent = msg;
        errEl.style.display = 'block';
        subBtn.disabled = false; subBtn.textContent = '복구';
        return;
      }
      const user = {
        ipv6: found.guid, handle: found.handle,
        e164: found.e164 || '',
        country_code: found.country_code || DEFAULT_COUNTRY,
        nickname: found.nickname || '',
        region: found.region || '',
        name: found.handle, isGuest: false, isTemp: false,
        registeredAt: found.created,
      };
      localStorage.setItem(STORE_KEY, JSON.stringify(user));
      setUser(user);
      console.info('[Auth] 백업 키 복구 완료:', found.handle);
      closeOverlay(user);
    };
  }

  function _showExpiredGuidance() {
    render(`
      <p style="font-size:13px;color:#dc2626;line-height:1.6;margin-bottom:16px;text-align:left">
        응답이 없어 만료됐습니다. 이 방식은 개인키를 가진 다른 기기가
        실제로 존재해야만 작동합니다 — 그 기기가 확실히 있다면 다시
        시도해 주세요. 만약 이 계정을 쓰던 기기가 이것뿐이었고 데이터를
        지운 적이 있다면, 가입 시 저장해둔 백업 키(4단어 시드)가 있으면
        복구하고, 없다면 이 계정은 되살릴 수 없으니 새로 가입해 주세요.
      </p>
      <button id="_dl-retry" style="width:100%;padding:13px;border:none;border-radius:10px;background:#0057A8;color:#fff;cursor:pointer;margin-bottom:8px;font-size:14px;font-weight:700;font-family:inherit">다시 시도</button>
      <button id="_dl-backup2" style="width:100%;padding:13px;border:1px solid #e5e7eb;border-radius:10px;background:none;color:#374151;cursor:pointer;margin-bottom:8px;font-size:13px;font-family:inherit">백업 키를 직접 갖고 있어요</button>
      <button id="_dl-close2" style="width:100%;padding:13px;border:none;background:none;color:#9ca3af;cursor:pointer;font-size:13px;font-family:inherit">닫기</button>
    `);
    $$('#_dl-retry').onclick = () => _startRequest();
    $$('#_dl-backup2').onclick = _showBackupForm;
    $$('#_dl-close2').onclick = () => closeOverlay(null);
  }

  async function _pollOnce() {
    try {
      const res = await fetch(`${PROXY_URL}/auth/device-link/poll?sessionId=${encodeURIComponent(sessionId)}`);
      const data = await res.json();
      if (!data.ok) return;
      if (data.state === 'expired') {
        stopAll();
        _showExpiredGuidance();
        return;
      }
      if (data.state === 'delivered' && data.sealed) {
        stopAll();
        await _finishImport(data.sealed);
      }
    } catch { /* 일시적 네트워크 오류는 무시하고 다음 polling에서 재시도 */ }
  }

  async function _finishImport(sealed) {
    render(`<p style="font-size:14px;color:#374151">가져오는 중...</p>`);
    try {
      const plaintext = await GopangWallet.openSealedWithKey(pcKeyPair.privateKey, sealed);
      const { privKeyB64u, userRecord, onboardingFlags } = JSON.parse(plaintext);
      if (!privKeyB64u) throw new Error('전달받은 데이터 형식이 올바르지 않습니다.');

      await GopangWallet.restoreFromPrivateKey(privKeyB64u);

      let user;
      if (userRecord && userRecord.ipv6) {
        localStorage.setItem(STORE_KEY, JSON.stringify(userRecord));
        user = userRecord;
      } else {
        console.warn('[DeviceLink] 폰의 gopang_user_v4가 비어있어 계정 식별 정보를 옮기지 못했습니다.');
        user = {
          ipv6: found.guid, handle: found.handle, e164: found.e164 || '',
          country_code: found.country_code || DEFAULT_COUNTRY, nickname: found.nickname || '',
          region: found.region || '', name: found.handle, isGuest: false, isTemp: false,
          registeredAt: found.created,
        };
        localStorage.setItem(STORE_KEY, JSON.stringify(user));
      }

      if (onboardingFlags) {
        if (onboardingFlags.firstGreeted) localStorage.setItem('hondi_first_greeted', '1');
        if (onboardingFlags.tutorialDone) localStorage.setItem('hondi_tutorial_done', '1');
        if (onboardingFlags.tutorialStep) localStorage.setItem('hondi_tutorial_step', onboardingFlags.tutorialStep);
      }

      setUser(user);
      console.info('[DeviceLink] 인라인 가져오기 완료:', user.handle);

      // 2026-08-31 신설 — 계정(guid) 단위 백업 확인 상태를 이 새 기기에도
      // 반영한다. 폰에서 이미 백업 키를 저장했다면 found.backup_confirmed_at에
      // 그 시각이 있을 것이고, 그러면 이 PC에서 다시 배너를 안 띄운다.
      if (found?.backup_confirmed_at) {
        try { localStorage.setItem(BACKUP_CONFIRMED_KEY, '1'); } catch {}
      }

      closeOverlay(user);
    } catch (e) {
      render(`<p style="font-size:13px;color:#dc2626;margin-bottom:16px">지갑 가져오기에 실패했습니다: ${e.message}</p>`);
      setTimeout(() => _showExpiredGuidance(), 1200);
    }
  }

  async function _startRequest() {
    renderWaiting();
    setStatus('스마트폰에 요청을 보내는 중...');
    try {
      pcKeyPair = await GopangWallet.generateX25519KeyPair();
      const pcLabel = (() => {
        const ua = navigator.userAgent;
        const browser = /Chrome/.test(ua) ? 'Chrome' : /Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : '브라우저';
        const os = /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
        return `${browser} · ${os}`.trim();
      })();

      const res = await fetch(`${PROXY_URL}/auth/device-link/init`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          e164: found.e164, pcLabel, purpose: 'key_transfer',
          pcPubKeyB64u: pcKeyPair.publicKeyB64u,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.detail || data.error || '요청 실패');

      sessionId = data.sessionId;
      if (data.hasMobileDevice === false) {
        setStatus('이 계정에 등록된 스마트폰이 없습니다. 아래 "문자로 받기"를 이용해 주세요.', true);
      } else {
        setStatus('');
      }
      _startCountdown(data.expires_in || 90);
      pollTimer = setInterval(_pollOnce, 2000);
      document.addEventListener('visibilitychange', _onVisibilityChange);
      _setupSmsFallback(data.pushSentToMobile, data.hasMobileDevice);
    } catch (e) {
      setStatus(e.message || '요청에 실패했습니다.', true);
    }
  }

  _startRequest();
}


// ── 저장소 읽기 ──────────────────────────────────────────
function _loadStored() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || 'null') ||
           JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null');
  } catch { return null; }
}

// ── 사용자 초기화 (앱 시작 시 1회) ──────────────────────
export async function initAuth() {
  const stored = _loadStored();
  if (stored?.ipv6) {
    console.info('[Auth] 자동 로그인 ✅', stored.ipv6);
    setUser(stored);
    // ★ 2026-07-21 신설 — 실사로 발견한 버그: 여태 이 지점에서 localStorage만
    // 보고 곧바로 로그인 처리했다. 관리자가 PocketBase에서 계정을 직접
    // 삭제해도(테스트 계정 정리 등) 클라이언트는 그 사실을 전혀 모른 채
    // "정상 작동"하는 것처럼 계속 동작했다 — 실제 API 호출들이 이후
    // 산발적으로 실패하기 시작할 뿐, 어디서도 "계정이 없어졌다"고 명확히
    // 알려주지 않았다. 화면 반응 속도를 늦추지 않기 위해 여기서는 낙관적
    // 으로 먼저 로그인 처리하고, 백그라운드에서 서버에 실제 존재 여부를
    // 확인해 없으면 그 자리에서 정리하고 새로 시작하게 한다.
    _verifyStoredAccountStillExists(stored);
    return stored;
  }
  // DEV_MODE: 저장된 세션 없어도 팝업 없이 개발용 계정으로 통과
  if (typeof DEV_MODE !== 'undefined' && DEV_MODE) {
    const devUser = {
      ipv6: '::1', handle: 'dev', nickname: 'dev',
      e164: '', country_code: 'KR',
      name: 'dev', isGuest: false, isTemp: false,
      registeredAt: new Date().toISOString(),
    };
    try { localStorage.setItem('gopang_user_v4', JSON.stringify(devUser)); } catch {}
    setUser(devUser);
    console.info('[DEV] initAuth 우회 — 개발용 계정으로 자동 로그인');
    return devUser;
  }
  return new Promise((resolve) => { _showPhonePopup(resolve); });
}

// ── 저장된 계정의 서버 존재 여부 백그라운드 확인 (2026-07-21 신설) ──
// 네트워크 오류 등으로 조회 자체가 실패하면(오프라인 등) 아무 조치도
// 하지 않는다 — "확인 못 함"과 "확실히 없음"을 구분해, 일시적 네트워크
// 문제로 정상 계정을 로그아웃시키는 사고를 만들지 않는다. 진짜로 서버가
// "레코드 없음"이라고 명확히 응답했을 때만 로그아웃 처리한다.
export async function _verifyStoredAccountStillExists(stored) {
  const _checkOnce = async () => {
    const filter = encodeURIComponent(`guid='${stored.ipv6}'`);
    const res  = await fetch(`${L1_URL}?filter=${filter}&perPage=1`);
    if (!res.ok) return 'unknown'; // 서버 오류 — 판단 보류
    const data = await res.json().catch(() => null);
    if (!data) return 'unknown';
    return (data.items?.length || 0) > 0 ? 'exists' : 'missing';
  };
  try {
    let result = await _checkOnce();
    // 첫 조회에서 "없음"이 나와도 곧바로 로그아웃시키지 않는다 — 복제
    // 지연 등 일시적 사유일 수 있으므로 1.5초 뒤 한 번 더 확인해 두 번
    // 연속으로 "없음"이 나올 때만 확정한다.
    if (result === 'missing') {
      await new Promise(r => setTimeout(r, 1500));
      result = await _checkOnce();
    }
    if (result !== 'missing') return; // 존재 확인됨 또는 판단 보류 — 아무것도 안 함

    console.warn('[Auth] 저장된 계정이 서버에서 사라짐(관리자 삭제 등) — 로컬 세션 정리:', stored.ipv6);
    try { localStorage.removeItem(STORE_KEY); } catch {}
    try { await window.GopangWallet?.destroy?.(); } catch {}
    setUser(null);
    // 조용히 새로고침해 initAuth()가 처음부터 다시 시작하게 한다 — 어중간한
    // 화면 상태(존재하지 않는 계정으로 로그인된 것처럼 보이는 UI)로 남겨두지
    // 않는다.
    alert('이 기기에 저장된 계정이 서버에서 삭제되어 로그아웃됩니다. 다시 가입해 주세요.');
    location.reload();
  } catch (e) {
    // 네트워크 오류 등 — 판단 보류, 조용히 무시
  }
}

// ── 번호를 직접 받아 처리 (통합 팝업용) ─────────────────
// BUG-FIX: 기존 신규가입 분기가 어디에도 정의되지 않은 _showNicknameStep을
// 호출하고 있어(리팩터링 중 삭제된 것으로 보임) 신규 사용자가 이 경로로
// 들어오면 ReferenceError로 조용히 실패했다. 신규가입 완료 로직을 별도로
// 다시 만드는 대신, 이미 검증된 _showPhonePopup(닉네임·약관·색상코드·
// 숫자코드 생성까지 전부 포함)에 그대로 위임한다 — 전화번호를 다시 입력해야
// 하는 약간의 불편은 있지만, 그 전에는 신규가입 자체가 100% 실패했다.
export async function initAuthWithPhone(digits, countryKey = 'KR', phoneType = 'mobile', areaCode = null) {
  const stored = _loadStored();
  if (stored?.ipv6) {
    setUser(stored);
    return stored;
  }
  return new Promise(async (resolve) => {
    const e164   = countryKey === 'KR' ? _buildKrE164(phoneType, areaCode, digits)   : buildE164(digits, countryKey);
    const handle = countryKey === 'KR' ? _buildKrHandle(phoneType, areaCode, digits) : buildHandle(digits, countryKey);
    try {
      const filter = encodeURIComponent(`handle='${handle}'`);
      const res    = await fetch(`${L1_URL}?filter=${filter}&perPage=1`);
      const data   = await res.json();
      const found  = data.items?.[0];

      if (found) {
        // v6.0: handle 일치만으로 더 이상 즉시 로그인하지 않는다 — 이 기기가
        // 그 guid에 핀(pin)된 Ed25519 키를 실제로 갖고 있다는 서명 증거가 있어야
        // 한다. 다른 사람의 번호/닉네임을 알았다고 해서 그 계정이 되어선 안 된다.
        const session = await _issueSession(found.guid, 'gopang');
        if (!session.ok) {
          console.warn('[Auth] 세션 검증 실패(통합팝업):', session.reason);
          if (session.reason === 'wallet_not_ready') {
            // 2026-07-28 수정 — 아래 _loginExisting의 동일 수정과 같은 이유:
            // gopangWalletLocked 또는 gopangWalletNeedsSetup(둘 다 영구
            // 상태)이면 재시도 안내로 멈추지 않고 기기 불일치 처리로
            // 흘려보낸다.
            if (!window.gopangWalletLocked && !window.gopangWalletNeedsSetup) {
              // BUG FIX: 이 함수(initAuthWithPhone) 스코프에는 errEl/btn DOM 요소가
              // 존재하지 않는다(호출부가 자체 UI를 그리는 별도 팝업이라 여기선 참조할
              // 방법이 없음) — 참조 시 ReferenceError로 즉시 죽어 재시도 안내조차
              // 못 보여주고 조용히 멈추는 문제가 있었다. resolve(null)로 호출부에
              // 알려 호출부가 자체적으로 재시도/안내를 하도록 한다.
              console.warn('[Auth] 보안 키 준비 중 — 잠시 후 다시 시도 필요');
              resolve(null);
              return;
            }
          }
          // DEV_MODE: DeviceMismatch 무시하고 강제 로그인
          if (typeof DEV_MODE !== 'undefined' && DEV_MODE) {
            console.info('[DEV] DeviceMismatch 우회 — 강제 로그인:', found.handle);
          } else {
            _showDeviceMismatchNotice(found, resolve);
            return;
          }
        }
        const user = {
          ipv6: found.guid, handle: found.handle,
          e164: found.e164 || '',
          country_code: found.country_code || countryKey,
          nickname: found.nickname || '',
          region: found.region || '',
          name: digits, isGuest: false, isTemp: false,
          registeredAt: found.created,
        };
        console.info('[Auth] 로그인 (통합팝업):', found.handle);
        localStorage.setItem(STORE_KEY, JSON.stringify(user));
        setUser(user);
        // 2026-08-31 신설 — 계정 단위 백업 확인 상태를 이 기기에도 반영
        if (found.backup_confirmed_at) {
          try { localStorage.setItem(BACKUP_CONFIRMED_KEY, '1'); } catch {}
        }
        resolve(user);
      } else {
        // 신규 사용자 → 검증된 전체 가입 플로우(_showPhonePopup)로 위임
        console.info('[Auth] 신규 번호 — 통합 가입 팝업으로 전환');
        _showPhonePopup(resolve);
      }
    } catch(e) {
      console.warn('[Auth] initAuthWithPhone 실패:', e.message);
      resolve(null);
    }
  });
}

// ── 전화번호 입력 팝업 ───────────────────────────────────
// ── 전화번호+닉네임 통합 팝업 (v2.1) ─────────────────────────
// 기존: 전화번호 팝업 → (신규자만) 별도 화면으로 전환되는 닉네임 팝업, 2단계.
// 변경: 최초 접속 시 전화번호·닉네임을 한 카드에서 함께 받고 한 번에 제출한다.
//   - 전화번호만 있고 닉네임이 비어있는 값이 "닉네임"란에 들어오면 기존 사용자의
//     닉네임 로그인 단축 경로도 그대로 유지(전화번호 없이 닉네임만으로 로그인).
//   - 전화번호가 이미 가입된 번호면 닉네임 입력값은 무시하고 로그인으로 처리.
//   - 전화번호가 새 번호면 닉네임(+약관 동의)을 반드시 채운 뒤 그 자리에서 가입 완료.
//   디자인은 기존 "닉네임 설정" 카드 스타일(둥근 카드·타이틀+부제·파란 버튼)을 그대로 사용.
function _showPhonePopup(resolve) {
  let selectedCountry = DEFAULT_COUNTRY;

  const overlay = document.createElement('div');
  overlay.id = '_phone-overlay';
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:9999',
    'background:rgba(0,0,0,0.4)',
    'display:flex;align-items:center;justify-content:center',
    'padding:24px;box-sizing:border-box',
  ].join(';');

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:20px;padding:28px 20px;
                width:100%;max-width:340px;box-sizing:border-box;">

      <div style="margin-bottom:20px">
        <div style="font-size:16px;font-weight:600;color:#111827;margin-bottom:4px">혼디 시작하기</div>
        <div style="font-size:13px;color:#6b7280">전화번호와 닉네임만 있으면 바로 시작할 수 있어요</div>
      </div>

      <!-- 2026-07-21 신설 — 아래 전체를 컨테이너로 감싸, 인증번호 단계로
           전환할 때 이 블록은 숨기고 _otp-step을 보여주는 방식으로 바꾼다
           (기존엔 네이티브 prompt()를 썼는데, 모바일에서 사용자가 문자
           앱으로 전환하는 순간 브라우저가 백그라운드 탭의 prompt()를
           강제로 닫아버려 코드를 영영 입력할 수 없게 되는 사고가 실사로
           확인됐다 — prompt는 화면에 "계속 남아있지" 않는다). -->
      <div id="_main-step">

      <!-- 국가 드롭다운 패널 -->
      <div id="_country-panel" style="display:none;margin-bottom:10px;
           border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;
           background:#fff;box-shadow:0 4px 16px rgba(0,0,0,0.12)">
        <div style="padding:10px 12px;border-bottom:1px solid #f0f0f0">
          <input id="_country-search" type="text" placeholder="국가 검색..."
            style="width:100%;border:1px solid #e5e7eb;border-radius:8px;
                   padding:8px 12px;font-size:14px;outline:none;
                   box-sizing:border-box;font-family:inherit"
            autocomplete="off"/>
        </div>
        <div id="_country-list"
          style="max-height:220px;overflow-y:auto;overscroll-behavior:contain">
        </div>
      </div>

      <!-- 한국 전용: 휴대폰/지역번호 선택 (검색 가능 드롭다운) -->
      <div id="_kr-areatype-panel" style="display:none;margin-bottom:10px;
           border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;
           background:#fff;box-shadow:0 4px 16px rgba(0,0,0,0.12)">
        <div style="padding:10px 12px;border-bottom:1px solid #f0f0f0">
          <input id="_kr-areatype-search" type="text" placeholder="예: 06 (지역번호 검색)..."
            style="width:100%;border:1px solid #e5e7eb;border-radius:8px;
                   padding:8px 12px;font-size:14px;outline:none;
                   box-sizing:border-box;font-family:inherit"
            autocomplete="off"/>
        </div>
        <div id="_kr-areatype-list"
          style="max-height:220px;overflow-y:auto;overscroll-behavior:contain">
        </div>
      </div>
      <div id="_kr-areatype-row" style="display:none;margin-bottom:10px">
        <button id="_kr-areatype-btn" type="button"
          style="width:100%;text-align:left;padding:12px 14px;border:1.5px solid #e5e7eb;
                 border-radius:10px;background:#f9fafb;cursor:pointer;font-family:inherit;
                 font-size:14px;color:#111827;display:flex;align-items:center;gap:8px">
          <span id="_kr-areatype-label">📱 휴대폰 (010)</span>
          <span style="margin-left:auto;font-size:9px;color:#9ca3af">▼</span>
        </button>
      </div>

      <!-- 전화번호 입력 행 -->
      <div style="display:flex;align-items:center;
                  border:1px solid #e5e7eb;border-radius:12px;
                  background:#f9fafb;overflow:hidden;margin-bottom:6px"
           id="_phone-field">
        <button id="_country-btn"
          style="padding:0 10px;height:52px;border:none;background:transparent;
                 cursor:pointer;border-right:1px solid #e5e7eb;
                 flex-shrink:0;display:flex;align-items:center;gap:3px">
          <span id="_flag-icon" style="font-size:20px">🇰🇷</span>
          <span id="_dial-code" style="font-size:11px;color:#6b7280">+82</span>
          <span style="font-size:9px;color:#9ca3af">▼</span>
        </button>
        <input id="_phone-input" type="tel" maxlength="8"
          placeholder="전화번호 뒷 8자리"
          style="flex:1;padding:0 12px;height:52px;border:none;background:transparent;
                 font-size:16px;font-family:inherit;outline:none;color:#111827;
                 min-width:0;letter-spacing:2px"
          autocomplete="off" inputmode="numeric"/>
      </div>
      <div id="_phone-error" style="display:none;font-size:12px;color:#dc2626;
           padding:0 4px;margin-bottom:4px"></div>
      <div id="_phone-hint" style="font-size:12px;color:#9ca3af;padding:0 4px;margin-bottom:14px">
        기존 회원이면 닉네임만 입력해도 로그인돼요. 처음이면 둘 다 입력해 주세요.
      </div>

      <!-- 닉네임 입력 -->
      <div style="display:flex;align-items:center;
                  border:1px solid #e5e7eb;border-radius:12px;
                  background:#f9fafb;overflow:hidden;margin-bottom:10px"
           id="_nick-field">
        <input id="_nick-input" type="text" maxlength="20"
          placeholder="닉네임 (예: 홍길동, James)"
          style="flex:1;padding:0 14px;height:52px;border:none;background:transparent;
                 font-size:15px;font-family:inherit;outline:none;color:#111827;min-width:0"
          autocomplete="off"/>
      </div>
      <div id="_nick-error" style="display:none;font-size:12px;color:#dc2626;padding:0 4px;margin-bottom:8px"></div>

      <!-- 이용 약정서 동의 -->
      <label style="display:flex;align-items:flex-start;gap:8px;padding:10px 4px;margin-bottom:6px;cursor:pointer">
        <input type="checkbox" id="_terms-agree-chk" style="margin-top:2px;width:16px;height:16px;flex-shrink:0;accent-color:#1A73E8">
        <span style="font-size:12.5px;color:#374151;line-height:1.6">
          <span onclick="event.preventDefault();window.openTermsOfUse&&window.openTermsOfUse()" style="color:#1A73E8;font-weight:600;text-decoration:underline">이용 약정서</span>(베타 서비스 면책조항 포함)를 읽었으며 동의합니다. <span style="color:#9ca3af">(처음 가입할 때만 필요해요)</span>
        </span>
      </label>
      <div id="_terms-error" style="display:none;font-size:12px;color:#dc2626;padding:0 4px;margin-bottom:8px">이용 약정서에 동의해야 가입을 완료할 수 있습니다.</div>

      <button id="_auth-btn"
        style="width:100%;height:52px;background:#1A73E8;color:#fff;
               border:none;border-radius:12px;font-size:16px;font-weight:600;
               cursor:pointer;font-family:inherit">
        시작하기
      </button>
      <div style="font-size:12px;color:#9ca3af;text-align:center;margin-top:10px">
        handle: <span id="_handle-preview" style="color:#1A73E8">@ · · · · · · · ·</span>
      </div>

      </div>

      <!-- 인증번호 입력 단계 (2026-07-21 신설, prompt() 대체) — 화면에
           계속 남아있어서 문자 앱을 확인하고 돌아와도 사라지지 않는다. -->
      <div id="_otp-step" style="display:none">
        <div style="font-size:15px;font-weight:600;color:#111827;margin-bottom:4px">인증번호 입력</div>
        <div id="_otp-desc" style="font-size:13px;color:#6b7280;margin-bottom:16px"></div>
        <input id="_otp-input" type="text" maxlength="6" placeholder="6자리 숫자"
          style="width:100%;height:52px;border:1px solid #e5e7eb;border-radius:12px;
                 background:#f9fafb;padding:0 14px;font-size:20px;letter-spacing:6px;
                 text-align:center;font-family:inherit;outline:none;color:#111827;
                 box-sizing:border-box;margin-bottom:8px"
          autocomplete="one-time-code" inputmode="numeric"/>
        <div id="_otp-error" style="display:none;font-size:12px;color:#dc2626;padding:0 4px;margin-bottom:8px"></div>
        <button id="_otp-verify-btn"
          style="width:100%;height:52px;background:#1A73E8;color:#fff;
                 border:none;border-radius:12px;font-size:16px;font-weight:600;
                 cursor:pointer;font-family:inherit;margin-bottom:8px">
          확인
        </button>
        <div style="display:flex;gap:8px">
          <button id="_otp-resend-btn" type="button"
            style="flex:1;height:44px;background:#f3f4f6;color:#374151;border:none;
                   border-radius:10px;font-size:13px;cursor:pointer;font-family:inherit">
            재전송
          </button>
          <button id="_otp-back-btn" type="button"
            style="flex:1;height:44px;background:none;color:#9ca3af;border:1px solid #e5e7eb;
                   border-radius:10px;font-size:13px;cursor:pointer;font-family:inherit">
            전화번호 다시 입력
          </button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const phoneInput = document.getElementById('_phone-input');
  const phoneField = document.getElementById('_phone-field');
  const phoneErr   = document.getElementById('_phone-error');
  const panel      = document.getElementById('_country-panel');
  const listEl     = document.getElementById('_country-list');
  const searchEl   = document.getElementById('_country-search');
  const flagIcon   = document.getElementById('_flag-icon');
  const dialCode   = document.getElementById('_dial-code');
  const hintEl     = document.getElementById('_phone-hint');
  const nickInput  = document.getElementById('_nick-input');
  const nickField  = document.getElementById('_nick-field');
  const nickErr    = document.getElementById('_nick-error');
  const handlePrev = document.getElementById('_handle-preview');

  // ── 한국 전용: 휴대폰/지역번호 선택 상태 ──────────────────
  // phoneType: 'mobile' | 'landline'. landline일 때만 areaCode 사용.
  let phoneType = 'mobile';
  let areaCode  = null;
  const krRow        = document.getElementById('_kr-areatype-row');
  const krBtn         = document.getElementById('_kr-areatype-btn');
  const krLabel       = document.getElementById('_kr-areatype-label');
  const krPanel       = document.getElementById('_kr-areatype-panel');
  const krListEl      = document.getElementById('_kr-areatype-list');
  const krSearchEl    = document.getElementById('_kr-areatype-search');

  // 휴대폰 또는 지역번호 선택 시 필요한 가입자번호 자릿수 — 실제 계산은
  // 모듈 최상위 krNeededDigitsFor(순수 함수, 위 export 참고)에 위임한다.
  function _krNeededDigits() {
    return krNeededDigitsFor(phoneType, areaCode);
  }

  function _renderKrAreaList(query = '') {
    const q = query.trim().replace(/\D/g, '');
    const items = [{ code: null, name: '휴대폰', label: '📱 휴대폰 (010)' },
      ...KR_AREA_CODES.map(a => ({ code: a.code, name: a.name, label: `☎️ ${a.name} (0${a.code})` }))];
    const filtered = !q ? items : items.filter(it => it.code && ('0' + it.code).startsWith(q));
    krListEl.innerHTML = (q && filtered.length === 0 ? items : filtered).map(it => `
      <div data-code="${it.code ?? ''}"
           style="padding:10px 14px;cursor:pointer;display:flex;align-items:center;gap:10px;
                  border-bottom:1px solid #f9f9f9;
                  ${(it.code === areaCode && phoneType==='landline') || (it.code===null && phoneType==='mobile') ? 'background:#f0fdf4;' : ''}">
        <span style="flex:1;color:#111827;font-size:14px">${it.label}</span>
      </div>`).join('');

    krListEl.querySelectorAll('[data-code]').forEach(el => {
      el.onmouseenter = () => el.style.background = '#f0fdf4';
      el.onmouseleave = () => el.style.background = '';
      el.onclick = () => _selectKrAreaType(el.dataset.code || null);
    });
  }

  function _selectKrAreaType(code) {
    if (code === null || code === '') {
      phoneType = 'mobile'; areaCode = null;
      krLabel.textContent = '📱 휴대폰 (010)';
    } else {
      phoneType = 'landline'; areaCode = code;
      const found = KR_AREA_CODES.find(a => a.code === code);
      krLabel.textContent = `☎️ ${found ? found.name : ''} (0${code})`;
    }
    krPanel.style.display = 'none';
    krSearchEl.value = '';
    const need = _krNeededDigits();
    phoneInput.maxLength = need;
    phoneInput.value = '';
    phoneInput.placeholder = phoneType === 'mobile' ? '전화번호 뒷 8자리' : `가입자번호 ${need}자리`;
    _updateHandlePreview();
    phoneInput.focus();
  }

  krBtn.onclick = (e) => {
    e.stopPropagation();
    const isOpen = krPanel.style.display !== 'none';
    krPanel.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) {
      _renderKrAreaList();
      setTimeout(() => krSearchEl.focus(), 50);
    }
  };
  krSearchEl.addEventListener('input', () => _renderKrAreaList(krSearchEl.value));
  krSearchEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') krPanel.style.display = 'none';
    if (e.key === 'Enter') {
      const first = krListEl.querySelector('[data-code]');
      if (first) _selectKrAreaType(first.dataset.code || null);
    }
  });


  // ── 국가 목록 렌더 ──────────────────────────────────────
  function _renderList(query = '') {
    const q = query.toLowerCase();
    const allEntries = Object.entries(COUNTRIES);
    const entries = !q ? allEntries : [
      ...allEntries.filter(([key]) => key.toLowerCase() === q),
      ...allEntries.filter(([key]) => key.toLowerCase() !== q && key.toLowerCase().startsWith(q)),
      ...allEntries.filter(([key, c]) =>
        !key.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q)
      ),
      ...allEntries.filter(([key, c]) =>
        !key.toLowerCase().startsWith(q) && !c.name.toLowerCase().includes(q) && c.code.includes(q)
      ),
    ];
    listEl.innerHTML = entries.map(([key, c]) => `
      <div data-country="${key}"
           style="padding:10px 14px;cursor:pointer;
                  display:flex;align-items:center;gap:10px;
                  border-bottom:1px solid #f9f9f9;
                  ${key === selectedCountry ? 'background:#f0fdf4;' : ''}">
        <span style="font-size:20px;flex-shrink:0;width:28px;text-align:center">${c.flag}</span>
        <span style="flex:1;color:#111827;font-size:14px">${c.name}</span>
        <span style="color:#6b7280;font-size:12px;margin-right:4px">${key}</span>
        <span style="color:#9ca3af;font-size:14px">${c.code}</span>
      </div>`).join('');

    listEl.querySelectorAll('[data-country]').forEach(el => {
      el.onmouseenter = () => el.style.background = '#f0fdf4';
      el.onmouseleave = () => el.style.background = el.dataset.country === selectedCountry ? '#f0fdf4' : '';
      el.onclick = () => _selectCountry(el.dataset.country);
    });
  }

  function _updateHandlePreview() {
    const digits = phoneInput.value.trim();
    const need = selectedCountry === 'KR' ? _krNeededDigits() : COUNTRIES[selectedCountry].digits;
    if (digits.length === need) {
      if (selectedCountry === 'KR') {
        handlePrev.textContent = _buildKrHandle(phoneType, areaCode, digits);
      } else {
        handlePrev.textContent = buildHandle(digits, selectedCountry);
      }
    } else {
      handlePrev.textContent = '@' + '·'.repeat(Math.min(need, 8));
    }
  }

  function _selectCountry(key) {
    selectedCountry = key;
    const c = COUNTRIES[key];
    flagIcon.textContent = c.flag;
    dialCode.textContent = c.code;
    panel.style.display = 'none';
    searchEl.value = '';

    // 국가를 바꾸면 한국 전용 휴대폰/지역번호 선택 상태를 초기화한다.
    phoneType = 'mobile'; areaCode = null;
    krLabel.textContent = '📱 휴대폰 (010)';
    krRow.style.display = key === 'KR' ? 'block' : 'none';

    const need = key === 'KR' ? _krNeededDigits() : c.digits;
    phoneInput.maxLength = need;
    phoneInput.value = '';
    phoneInput.placeholder = key === DEFAULT_COUNTRY ? '전화번호 뒷 8자리' : `전화번호 (${c.digits}자리)`;
    _updateHandlePreview();
    phoneInput.focus();
  }

  krRow.style.display = selectedCountry === 'KR' ? 'block' : 'none';

  _renderList();

  document.getElementById('_country-btn').onclick = (e) => {
    e.stopPropagation();
    const isOpen = panel.style.display !== 'none';
    panel.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) {
      _renderList();
      setTimeout(() => searchEl.focus(), 50);
    }
  };

  searchEl.addEventListener('input', () => _renderList(searchEl.value));
  searchEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') panel.style.display = 'none';
    if (e.key === 'Enter') {
      const first = listEl.querySelector('[data-country]');
      if (first) _selectCountry(first.dataset.country);
    }
  });

  overlay.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && e.target.id !== '_country-btn') {
      panel.style.display = 'none';
    }
    if (!krPanel.contains(e.target) && e.target.id !== '_kr-areatype-btn' && !krBtn.contains(e.target)) {
      krPanel.style.display = 'none';
    }
  });

  phoneInput.focus();
  phoneInput.addEventListener('focus', () => phoneField.style.borderColor = '#16a34a');
  phoneInput.addEventListener('blur',  () => phoneField.style.borderColor = '#e5e7eb');
  phoneInput.addEventListener('input', () => {
    const need = selectedCountry === 'KR' ? _krNeededDigits() : COUNTRIES[selectedCountry].digits;
    // 2026-07-28 수정 — "010"/지역번호를 포함해서 입력(또는 자동완성)해도
    // 항상 뒤에서부터 필요한 자릿수를 취한다. 기존 slice(0, need)는 앞
    // 8자리를 잘라 "01096627170" → "01096627"처럼 엉뚱한 번호가 됐다.
    // device-link.html의 buildE164FromInput()이 2026-07-27에 이미 이
    // 방식(뒤에서부터 slice)으로 고쳐졌으나 이 파일(회원가입 본화면)에는
    // 반영되지 않고 남아 있었다.
    let rawDigits = phoneInput.value.replace(/\D/g, '');
    if (rawDigits.length > need) rawDigits = rawDigits.slice(-need);
    phoneInput.value = rawDigits;
    phoneErr.style.display = 'none';
    _updateHandlePreview();
  });

  nickInput.focus === undefined; // no-op (스타일 정리용)
  nickInput.addEventListener('focus', () => nickField.style.borderColor = '#16a34a');
  nickInput.addEventListener('blur',  () => nickField.style.borderColor = '#e5e7eb');

  // ── 닉네임 실시간 동명이인 안내 (신규 가입 예정자에게만 의미 있음) ──
  let _nickTimer = null;
  nickInput.addEventListener('input', () => {
    nickErr.style.display = 'none';
    const nick = nickInput.value.trim();
    clearTimeout(_nickTimer);

    let nickHintEl = document.getElementById('_nick-hint');
    if (!nickHintEl) {
      nickHintEl = document.createElement('div');
      nickHintEl.id = '_nick-hint';
      nickHintEl.style.cssText = 'font-size:12px;color:#9ca3af;padding:0 4px;margin-bottom:6px;line-height:1.6;min-height:18px';
      nickErr.insertAdjacentElement('afterend', nickHintEl);
    }
    if (nick.length < 2) { nickHintEl.innerHTML = ''; return; }
    nickHintEl.innerHTML = '<span style="color:#9ca3af">확인 중…</span>';
    _nickTimer = setTimeout(async () => {
      try {
        const nickFilter = encodeURIComponent(`nickname='${nick}'`);
        const r = await fetch(`${L1_URL}?filter=${nickFilter}&perPage=1`);
        const d = await r.json();
        const total = d.totalItems ?? d.items?.length ?? 0;
        if (total === 0) {
          nickHintEl.innerHTML = `<span style="color:#16a34a">✓ 처음 사용하는 닉네임입니다.</span>`;
        } else {
          nickHintEl.innerHTML =
            `<span style="color:#f59e0b">⚠ 이미 ${total}명이 사용 중입니다.</span> ` +
            `<span style="color:#9ca3af">전화번호로 구분되니 그대로 진행하셔도 돼요.</span>`;
        }
      } catch { nickHintEl.innerHTML = ''; }
    }, 400);
  });

  const btn = document.getElementById('_auth-btn');

  // ── 전화번호 OTP 발송/확인 (2026-07-15 신설, 2026-07-21 UI 전면 교체) ──
  // 성공 시 L1 훅이 검증할 phone_verify_token을 반환. 사용자가 뒤로가기를
  // 누르거나 5회 다 틀리면 null을 반환(가입 중단, 앞 화면으로).
  //
  // ★ 2026-07-21 재작성 — 원래 여기서 매 시도마다 네이티브 prompt()를
  // 띄워 6자리를 입력받았는데, 실사에서 확인된 치명적 결함이 있었다:
  // 사용자가 문자를 확인하러 메시지 앱으로 전환하면(=이 탭이 백그라운드로
  // 밀리면) 안드로이드 Chrome이 그 순간 열려 있던 prompt()를 강제로
  // 닫아버린다. 그러면 code===null(취소)로 처리돼 그대로 가입이 중단되고,
  // 다시 시도할 방법(재입력 창)이 아예 없었다 — "인증 창이 한번 나타났다
  // 사라진 뒤 다시 안 뜬다"는 증상 그대로. 지금은 카드 안에 계속 남아있는
  // 입력창(#_otp-step)으로 바꿔서, 앱을 오가도 이 화면 상태가 유지된다.
  function _requestAndVerifyPhoneOtp(e164) {
    return new Promise((resolve) => {
      (async () => {
        // 2026-09-07 신설(사용자 지시) — 이 번호가 이미 지문(WebAuthn)을
        // 쓰는 계정에 클레임돼 있으면, handlePhoneOtpRequest가 그 계정
        // guid 앞으로 생체 인증 챌린지를 함께 내려준다. SMS 코드가
        // 맞더라도 이 챌린지를 이 기기로 통과 못 하면(=이 기기가 그
        // 계정을 등록한 물리적 기기가 아니면) 재가입을 진행시키지 않는다.
        let existingAccountChallenge = null;

        try {
          const reqRes = await fetch(`${PROXY}/biz/phone-otp-request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ e164 }),
          });
          const reqData = await reqRes.json().catch(() => ({}));
          if (!reqRes.ok || !reqData.ok) {
            alert('인증번호 발송에 실패했습니다: ' + (reqData.detail || reqData.error || '알 수 없는 오류'));
            resolve(null);
            return;
          }
          existingAccountChallenge = reqData.existingAccountBiometricChallenge || null;
        } catch (e) {
          alert('인증번호 발송 중 네트워크 오류가 발생했습니다: ' + e.message);
          resolve(null);
          return;
        }

        const mainStep  = document.getElementById('_main-step');
        const otpStep   = document.getElementById('_otp-step');
        const otpDesc   = document.getElementById('_otp-desc');
        const otpInput  = document.getElementById('_otp-input');
        const otpErr    = document.getElementById('_otp-error');
        const verifyBtn = document.getElementById('_otp-verify-btn');
        const resendBtn = document.getElementById('_otp-resend-btn');
        const backBtn   = document.getElementById('_otp-back-btn');

        mainStep.style.display = 'none';
        otpStep.style.display = '';
        otpDesc.textContent = `${e164}로 전송된 인증번호 6자리를 입력해 주세요. 다른 앱에서 문자를 확인하고 돌아오셔도 이 화면은 그대로 남아있어요.`;
        otpErr.style.display = 'none';
        otpInput.value = '';
        otpInput.focus();

        let attempts = 0;
        let settled  = false;

        // ── WebOTP API (2026-07-21 신설) ──────────────────────────
        // 지원 브라우저(안드로이드 Chrome)에서는 문자를 아예 확인하러
        // 나갈 필요 없이, 브라우저가 SMS 도착을 감지해 입력창에 자동으로
        // 채워준다 — worker.js가 문자 맨 끝에 "@hondi.net #코드" 태그를
        // 붙여 보내야 이 기능이 동작한다(같은 커밋에서 함께 수정).
        // 이 단계(otp-step)를 벗어나면(수동 확인·재전송·뒤로가기 등)
        // abort()로 반드시 정리한다 — 안 그러면 다음 단계에서도 계속
        // SMS를 엿듣는 상태로 남는다.
        const otpAbort = ('OTPCredential' in window && navigator.credentials?.get)
          ? new AbortController() : null;
        if (otpAbort) {
          navigator.credentials.get({
            otp: { transport: ['sms'] },
            signal: otpAbort.signal,
          }).then((otpCred) => {
            if (settled || !otpCred?.code) return;
            otpInput.value = otpCred.code;
            doVerify(); // 자동 채움 후 바로 제출 — 사용자가 확인 버튼을 누를 필요조차 없음
          }).catch(() => {
            // 미지원·권한 거부·타임아웃 등 — 수동 입력 경로는 그대로 살아있으므로 조용히 무시
          });
        }

        const finish = (result) => {
          if (settled) return;
          settled = true;
          otpAbort?.abort();
          verifyBtn.onclick = null;
          resendBtn.onclick = null;
          backBtn.onclick   = null;
          mainStep.style.display = '';
          otpStep.style.display = 'none';
          resolve(result);
        };

        const doVerify = async () => {
          const code = otpInput.value.trim();
          if (!/^\d{6}$/.test(code)) {
            otpErr.textContent = '6자리 숫자를 입력해 주세요.';
            otpErr.style.display = 'block';
            return;
          }
          verifyBtn.disabled = true;
          verifyBtn.textContent = '확인 중...';
          otpErr.style.display = 'none';
          try {
            const verRes  = await fetch(`${PROXY}/biz/phone-otp-verify`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ e164, code }),
            });
            const verData = await verRes.json().catch(() => ({}));
            if (verRes.ok && verData.ok) {
              if (!existingAccountChallenge) {
                finish({ phoneVerifyToken: verData.phone_verify_token, stepUpToken: null });
                return;
              }
              // ── 생체 인증 필수 구간 (2026-09-07 신설) ────────────────
              // SMS 코드는 맞았지만, 이 번호로 이미 등록된 계정이 지문을
              // 쓴다. 이 기기가 그 계정을 등록한 물리적 기기가 아니면
              // navigator.credentials.get()이 자연스럽게 실패한다(해당
              // credential이 이 기기에 없으므로) — 이게 방어의 핵심이다.
              verifyBtn.textContent = '지문/Face ID 확인 중...';
              try {
                const assertion = await navigator.credentials.get({
                  publicKey: {
                    challenge: _b64uToBuf(existingAccountChallenge.challengeB64u),
                    rpId: existingAccountChallenge.rpId || 'hondi.net',
                    allowCredentials: (existingAccountChallenge.credentialIds || []).map(id => ({
                      id: _b64uToBuf(id), type: 'public-key',
                    })),
                    userVerification: 'required',
                  },
                });
                const stepUpRes = await fetch(`${PROXY}/account/step-up-verify`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    guid: existingAccountChallenge.guid,
                    sessionId: existingAccountChallenge.sessionId,
                    credentialId: _bufToB64u(assertion.rawId),
                    authenticatorDataB64u: _bufToB64u(assertion.response.authenticatorData),
                    clientDataJSONB64u: _bufToB64u(assertion.response.clientDataJSON),
                    signatureB64u: _bufToB64u(assertion.response.signature),
                  }),
                });
                const stepUpData = await stepUpRes.json().catch(() => ({}));
                if (!stepUpRes.ok || !stepUpData.ok) {
                  throw new Error(stepUpData.detail || '생체 인증 확인에 실패했습니다.');
                }
                finish({ phoneVerifyToken: verData.phone_verify_token, stepUpToken: stepUpData.step_up_token });
                return;
              } catch (bioErr) {
                otpErr.textContent = '이 번호로 등록된 계정은 지문 인증이 필요합니다 — 이 기기는 그 계정을 등록한 기기가 아닌 것 같습니다(' +
                  (bioErr.message || bioErr) + '). 본인 계정이 맞다면 그 계정을 등록했던 기기에서 다시 시도해 주세요.';
                otpErr.style.display = 'block';
                verifyBtn.disabled = false;
                verifyBtn.textContent = '확인';
                return;
              }
            }
            attempts += 1;
            if (attempts >= 5) {
              alert('인증 시도 횟수를 초과했습니다. 처음부터 다시 시도해 주세요.');
              finish(null);
              return;
            }
            otpErr.textContent = verData.detail || '인증번호가 일치하지 않습니다. 다시 시도해 주세요.';
            otpErr.style.display = 'block';
            otpInput.value = '';
            otpInput.focus();
          } catch (e) {
            otpErr.textContent = '인증 확인 중 네트워크 오류가 발생했습니다: ' + e.message;
            otpErr.style.display = 'block';
          } finally {
            verifyBtn.disabled = false;
            verifyBtn.textContent = '확인';
          }
        };

        verifyBtn.onclick = doVerify;
        otpInput.onkeydown = (ev) => { if (ev.key === 'Enter') doVerify(); };

        resendBtn.onclick = async () => {
          resendBtn.disabled = true;
          resendBtn.textContent = '재전송 중...';
          try {
            const r = await fetch(`${PROXY}/biz/phone-otp-request`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ e164 }),
            });
            const d = await r.json().catch(() => ({}));
            if (r.ok && d.ok) {
              otpErr.style.display = 'none';
              otpInput.value = '';
              otpInput.focus();
            } else {
              otpErr.textContent = d.detail || d.error || '재전송에 실패했습니다.';
              otpErr.style.display = 'block';
            }
          } catch (e) {
            otpErr.textContent = '재전송 중 네트워크 오류: ' + e.message;
            otpErr.style.display = 'block';
          } finally {
            resendBtn.disabled = false;
            resendBtn.textContent = '재전송';
          }
        };

        backBtn.onclick = () => finish(null);
      })();
    });
  }

  // ── 실제 신규 가입 처리 (기존 _register 로직 그대로, 지역 필드는 제거) ──
  async function _completeRegistration({ ipv6, handle, e164, nickname, digits, phoneVerifyToken, stepUpToken }) {
    const nickname_hash = await _sha256('phone:' + e164);
    const region = '';

    // (구) 혼디 색상 코드 — 2026-07-27 잠정 중단, 숫자 코드로 전환.
    // hondi_code_id(GUID 기반 short_id)는 하위 호환을 위해 계속 계산·
    // 저장하지만, 색상 이미지는 더 이상 생성하지 않는다.
    const hondiCodeVersion = 'v1';
    let hondiShortId = null;
    try {
      hondiShortId = guidToShortId(ipv6, hondiCodeVersion);
    } catch (e) {
      console.warn('[가입][GUID short_id] 생성 실패 (가입은 계속 진행):', e.message);
    }

    // ── 숫자 코드(digit_code_id) 생성 — 한국(휴대폰/지역번호)만 해당 ──
    // phoneToDigits()가 휴대폰/지역번호를 10자리로 인코딩한다(이전 대화에서
    // 정한 규칙: 휴대폰="00"+8자리, 서울="0"+"2"+8자리, 그 외 지역=
    // "0"+지역번호(2자리)+7자리). 실패해도 가입 자체는 계속 진행한다.
    // 2026-07-27부터 이 값이 혼디 코드 시각 렌더링(hondi-digit-code.js)의
    // 유일한 입력이 된다 — 색상 코드(GUID 기반)는 잠정 중단.
    let digitCodeId = null, hondiDigitCodeImage = null;
    if (selectedCountry === 'KR' && digits) {
      try {
        const digitsArr = phoneType === 'mobile'
          ? phoneToDigits({ type: 'mobile', subscriberNumber: digits })
          : phoneToDigits({ type: 'landline', areaCode, subscriberNumber: digits });
        digitCodeId = digitsArr.join('');
        console.info('[가입][숫자코드] 생성 완료:', digitCodeId);
        hondiDigitCodeImage = await generateDigitCodeDataURL(digitCodeId);
      } catch (e) {
        console.warn('[가입][숫자코드] 생성 실패 (가입은 계속 진행):', e.message);
      }
    }

    const user = {
      ipv6, handle, e164, country_code: selectedCountry,
      nickname, region,
      name: nickname, isGuest: false, isTemp: false,
      registeredAt: new Date().toISOString(),
      hondi_code_version: hondiCodeVersion,
      hondi_code_id: hondiShortId ? hondiShortId.toString() : null,
      digit_code_id: digitCodeId,
    };

    // ★ 2026-07-11 수정: 기존엔 이 POST의 응답을 전혀 확인하지 않고 바로
    // 아래에서 localStorage.setItem()·setUser()로 "가입 완료" 상태를
    // 무조건 만들었다 — L1 서버가 콜드스타트·일시적 오류 등으로 이 요청을
    // 실제로 처리 못 해도 클라이언트는 그걸 모른 채 정상 가입 화면을 그대로
    // 보여줬다. 그 결과 서버엔 프로필이 없는데 클라이언트는 "가입됨"으로
    // 믿는 상태가 되어, 이후 X25519 지갑 키 등록을 포함한 모든 프로필
    // 의존 호출이 PROFILE_NOT_FOUND(404)로 영구히 실패했다(실사로 확인).
    // 1회 짧게 재시도하고, 그래도 실패하면 예외를 던져 호출부(위쪽
    // _submit 핸들러)의 기존 catch 블록이 "네트워크 오류. 다시 시도해
    // 주세요"를 정직하게 보여주도록 한다 — 가입을 "일단 완료"로 밀어붙이지
    // 않는다.
    const _postL1Profile = () => fetch(L1_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guid: ipv6, nickname_hash, handle, nickname, region,
        e164, country_code: selectedCountry,
        native_lang: navigator.language?.slice(0,2) || 'ko',
        is_public: true,
        hondi_code_version: hondiCodeVersion,
        hondi_code_id: hondiShortId ? hondiShortId.toString() : null,
        digit_code_id: digitCodeId,
        // 2026-07-15 신설 — L1 pb_hooks의 전화번호 소유 검증 훅이 이 값을
        // 요구한다(없으면 프로필 생성 자체가 거부됨). 아래 케이스 C에서
        // _requestAndVerifyPhoneOtp()로 발급받은 값을 그대로 전달.
        phone_verify_token: phoneVerifyToken,
        // 2026-09-07 신설 — 이 번호로 등록된 기존 계정이 지문(WebAuthn)을
        // 쓰는 경우에만 의미가 있다(_requestAndVerifyPhoneOtp가 그 경우에만
        // 채워서 돌려줌). pb_hooks가 그 계정 guid 앞으로 독립 검증한다.
        step_up_token: stepUpToken || null,
      })
    });
    let _l1Res = await _postL1Profile().catch(e => { console.warn('[가입][L1] 1차 요청 실패(네트워크):', e.message); return null; });
    if (!_l1Res || !_l1Res.ok) {
      console.warn('[가입][L1] 1차 등록 실패(status:', _l1Res?.status, ') — 1.5초 후 재시도');
      await new Promise(r => setTimeout(r, 1500));
      _l1Res = await _postL1Profile().catch(e => { console.warn('[가입][L1] 재시도 요청 실패(네트워크):', e.message); return null; });
    }
    if (!_l1Res || !_l1Res.ok) {
      throw new Error(`L1 프로필 등록 실패(status: ${_l1Res?.status ?? '네트워크 오류'}) — 서버에 프로필이 생성되지 않았습니다`);
    }
    console.info('[Auth] 신규 등록:', handle, nickname);

    if (hondiDigitCodeImage) {
      try { localStorage.setItem('hondi_digit_code_image_v1', hondiDigitCodeImage); } catch {}
    }

    // BUG-FIX: 여기 있던 2차 POST(_L1_PROFILES_P2P)는 "global_profiles"라는
    // 별도 컬렉션을 겨냥한 것으로 보였으나, URL 조합 결과가 우연히 바로 위
    // 본POST와 완전히 같은 엔드포인트(profiles 컬렉션)를 가리키고 있었다.
    // profiles 컬렉션에는 unique 제약이 없어서, 매 가입마다 e164·hondi_code_id·
    // digit_code_id 등이 빠진 불완전한 중복 레코드가 하나 더 생기고 있었다
    // (숫자/색상 코드 조회 시 어느 레코드가 먼저 잡히느냐에 따라 코드가 비어
    //보일 위험이 있었음). 실제로 존재하지 않는 컬렉션을 겨냥한 죽은 코드였으므로
    // 제거했다 — 본 POST(위)로 이미 완전한 레코드가 등록된다.

    localStorage.setItem(STORE_KEY, JSON.stringify(user));
    setUser(user);
    overlay.remove();

    _recordRegisterPdv({ ipv6, handle, nickname, e164, selectedCountry }).catch(
      e => console.warn('[PDV] 가입 초기 레코드 실패 (무시):', e.message)
    );

    let syncResult = await ensureX25519Synced(ipv6).catch(e => {
      console.error('[가입][X25519] 예외:', e.message); return { ok: false };
    });
    if (!syncResult?.ok) {
      console.warn('[가입][X25519] 1차 실패:', syncResult?.reason, '— 3초 후 재시도');
      await new Promise(r => setTimeout(r, 3000));
      syncResult = await ensureX25519Synced(ipv6).catch(e => {
        console.error('[가입][X25519] 재시도 예외:', e.message); return { ok: false };
      });
      if (syncResult?.ok) {
        console.info('[가입][X25519] 재시도 성공');
      } else {
        console.error('[가입][X25519] 재시도도 실패:', syncResult?.reason, '— 가입은 계속 진행');
      }
    } else {
      console.info('[가입][X25519] 키 등록 완료:', syncResult.publicKeyB64u?.slice(0, 16) + '...');
    }

    console.info('[가입] 백업 단계 스킵(v2.0 간소화)');
    localStorage.setItem('hondi_new_registration', '1');

    resolve(user);

    // 2026-07-23 신설 — 실사 중 확인된 혼란: 이 지갑은 지금 가입을 마친
    // "이 브라우저"에만 생성된다. 같은 폰이라도 나중에 다른 브라우저(예:
    // Chrome으로 가입했는데 Safari로 열어봄)에서는 별도 기기로 인식돼
    // 다시 승인이 필요하다는 걸 미리 알려준다 — 그때 가서 "왜 또
    // 로그인하라고 하지?"로 헤매지 않도록.
    if (document.getElementById('message-list')) {
      appendBubble('ai', 'ℹ️ 이 계정은 지금 쓰고 계신 이 브라우저에 연결됐어요. 같은 폰이라도 다른 브라우저(Chrome↔Safari 등)에서 열면 별도 기기로 인식되니, 그럴 땐 이 브라우저에서 승인 한 번만 더 해주시면 됩니다.');
    }

    requestPushSubscription(ipv6).then(pushResult => {
      if (!document.getElementById('message-list')) return;
      if (pushResult.reason === 'permission_denied') {
        appendBubble('ai', '🔔 알림 권한이 꺼져 있어요. PC에서 보낸 메시지를 실시간으로 받으려면 브라우저 설정 → 알림에서 고팡을 허용해 주세요.');
      }
    }).catch(() => {});

    // 2026-07-20 신설(사용자 지시 — 생체인증 디폴트 활성화): 가입 버튼을
    // 누른 직후라 사용자 제스처 맥락이 아직 살아있을 가능성이 높은
    // 시점이다 — 여기서 바로 시도한다. WebAuthn 등록(navigator.credentials
    // .create())은 완전히 조용한 백그라운드 트리거가 불가능(브라우저가
    // 사용자 제스처를 요구)하므로, 웹푸시처럼 "권한이 이미 default"인
    // 상태를 그냥 밀어붙이는 것과는 다르다 — 이 시점에 시도해서 성공하면
    // 그걸로 "디폴트 활성화"가 완성되고, 브라우저가 제스처 부족으로
    // 거부하면 조용히 실패하고 넘어간다(설정 화면의 수동 등록 버튼이
    // 폴백으로 남아있음 — 무한정 재시도하며 성가시게 하지 않는다).
    if (typeof window.GopangWallet !== 'undefined') {
      window.GopangWallet.enrollStepUpBiometric(ipv6).then(bioResult => {
        if (bioResult.ok) {
          console.info('[가입][생체인증] 고액 거래 재인증 기본 등록 완료');
        } else {
          console.info('[가입][생체인증] 기본 등록 시도 실패(설정에서 수동 등록 가능):', bioResult.reason);
        }
      }).catch(() => {});
    }
  }

  const _submit = async () => {
    const digits   = phoneInput.value.trim();
    const nickname = nickInput.value.trim();
    const needDigits = selectedCountry === 'KR' ? _krNeededDigits() : COUNTRIES[selectedCountry].digits;
    const digitsFilled = digits.length > 0;
    const digitsValid  = new RegExp(`^\\d{${needDigits}}$`).test(digits);

    phoneErr.style.display = 'none';
    nickErr.style.display  = 'none';

    if (!digitsFilled && !nickname) {
      phoneErr.textContent = '전화번호 또는 닉네임을 입력해 주세요.';
      phoneErr.style.display = 'block';
      phoneInput.focus();
      return;
    }

    if (digitsFilled && !digitsValid) {
      phoneErr.textContent = `전화번호 뒷자리는 숫자 ${needDigits}자리로 입력해 주세요.`;
      phoneErr.style.display = 'block';
      phoneInput.focus();
      return;
    }

    btn.style.opacity = '0.4';
    btn.style.pointerEvents = 'none';

    try {
      // ── 케이스 A: 전화번호 없이 닉네임만 — 기존 회원 닉네임 로그인 단축 경로 ──
      if (!digitsFilled && nickname) {
        const nickLower = nickname.toLowerCase();
        const nickTitle = nickname.charAt(0).toUpperCase() + nickname.slice(1).toLowerCase();
        let found = null;
        for (const nick of [nickname, nickLower, nickTitle]) {
          const f = encodeURIComponent(`nickname='${nick}'`);
          const r = await fetch(`${L1_URL}?filter=${f}&perPage=1`);
          const d = await r.json();
          if (d.items?.[0]) { found = d.items[0]; break; }
        }
        if (!found) {
          nickErr.textContent = `닉네임 '${nickname}'을(를) 찾을 수 없습니다. 전화번호로 시작해 주세요.`;
          nickErr.style.display = 'block';
          btn.style.opacity = '1'; btn.style.pointerEvents = '';
          return;
        }
        await _loginExisting(found, nickname);
        return;
      }

      // ── 전화번호 기준 조회 ──────────────────────────────
      const e164   = selectedCountry === 'KR' ? _buildKrE164(phoneType, areaCode, digits)   : buildE164(digits, selectedCountry);
      const handle = selectedCountry === 'KR' ? _buildKrHandle(phoneType, areaCode, digits) : buildHandle(digits, selectedCountry);
      const filter = encodeURIComponent(`handle='${handle}'`);
      const res    = await fetch(`${L1_URL}?filter=${filter}&perPage=1`);
      const data   = await res.json();
      const found  = data.items?.[0];

      if (found) {
        // ── 케이스 B: 이미 가입된 번호 — 닉네임 입력값은 무시하고 로그인 ──
        await _loginExisting(found, digits);
        return;
      }

      // ── 케이스 C: 신규 번호 — 닉네임·약관 필요 ──────────────
      if (!nickname) {
        nickErr.textContent = '처음 오셨네요! 닉네임도 함께 입력해 주세요.';
        nickErr.style.display = 'block';
        nickInput.focus();
        btn.style.opacity = '1'; btn.style.pointerEvents = '';
        return;
      }
      const termsChk = document.getElementById('_terms-agree-chk');
      const termsErr = document.getElementById('_terms-error');
      if (!termsChk?.checked) {
        termsErr.style.display = 'block';
        termsChk?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        btn.style.opacity = '1'; btn.style.pointerEvents = '';
        return;
      }
      termsErr.style.display = 'none';

      if (!_isMobileDevice()) {
        btn.style.opacity = '1'; btn.style.pointerEvents = '';
        const ok = await _confirmMobileRegistration();
        if (!ok) {
          _showPcRegisterBlockedNotice();
          overlay.remove();
          resolve(null);
          return;
        }
        btn.style.opacity = '0.4'; btn.style.pointerEvents = 'none';
      }

      btn.textContent = '인증번호 확인 중...';
      const otpResult = await _requestAndVerifyPhoneOtp(e164);
      if (!otpResult?.phoneVerifyToken) {
        phoneErr.textContent = '전화번호 인증이 완료되지 않아 가입을 진행할 수 없습니다.';
        phoneErr.style.display = 'block';
        btn.style.opacity = '1'; btn.style.pointerEvents = '';
        btn.textContent = '시작하기';
        return;
      }

      btn.textContent = '등록 중...';
      const ipv6 = await _e164ToIPv6(e164);
      await _completeRegistration({
        ipv6, handle, e164, nickname, digits,
        phoneVerifyToken: otpResult.phoneVerifyToken, stepUpToken: otpResult.stepUpToken,
      });

    } catch(e) {
      phoneErr.textContent = '네트워크 오류. 다시 시도해 주세요.';
      phoneErr.style.display = 'block';
      btn.style.opacity = '1';
      btn.style.pointerEvents = '';
      btn.textContent = '시작하기';
    }
  };

  // ── 기존 회원 로그인 공통 처리 (전화번호 경로·닉네임 경로 공용) ──
  async function _loginExisting(found, valForDisplay) {
    const session = await _issueSession(found.guid, 'gopang');
    if (!session.ok) {
      console.warn('[Auth] 세션 검증 실패:', session.reason);
      btn.style.opacity = '1';
      btn.style.pointerEvents = '';
      if (session.reason === 'wallet_not_ready') {
        // 2026-07-28 수정 — wallet_not_ready를 항상 "잠시 후 재시도"로
        // 안내하면 안 된다. 이게 영구 상태인 경우가 두 가지 있다:
        //   ① gopangWalletLocked — 기존 지갑 복호화 영구 실패
        //   ② gopangWalletNeedsSetup — PC/미확인 기기라 애초에 지갑을
        //      자동 생성 안 한 상태(오늘 Brave 재현 케이스 — ①만 걸러서
        //      이 경우가 빠졌던 게 재발 원인)
        // 둘 다 재시도해도 절대 안 풀리므로, 기기 불일치와 동일하게
        // 아래로 흘려보낸다.
        if (!window.gopangWalletLocked && !window.gopangWalletNeedsSetup) {
          phoneErr.textContent = '보안 키 준비 중입니다. 잠시 후 다시 시도해 주세요.';
          phoneErr.style.display = 'block';
          return;
        }
      }
      if (typeof DEV_MODE !== 'undefined' && DEV_MODE) {
        console.info('[DEV] _showPhonePopup DeviceMismatch 우회:', found.handle);
      } else {
        overlay.remove();
        _showDeviceMismatchNotice(found, resolve);
        return;
      }
    }

    const user = {
      ipv6: found.guid, handle: found.handle,
      e164: found.e164 || '',
      country_code: found.country_code || selectedCountry,
      nickname: found.nickname || '',
      region: found.region || '',
      name: valForDisplay, isGuest: false, isTemp: false,
      registeredAt: found.created,
    };
    console.info('[Auth] 로그인:', found.handle);
    localStorage.setItem(STORE_KEY, JSON.stringify(user));
    setUser(user);
    overlay.remove();
    resolve(user);
  }

  btn.onclick = _submit;
  phoneInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') nickInput.focus(); });
  nickInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') _submit(); });
}

// ── 등록 여부 판별 ────────────────────────────────────────
export function _isRegistered() {
  try { return !!(_loadStored()?.handle); } catch { return false; }
}

export function _isTypeBorC() {
  try {
    const s = _loadStored();
    if (!s) return false;
    return !!(s.seedHex || s.faceVec || s.webauthn?.credentialId || s.handle);
  } catch { return false; }
}

export function _isGDCUser() {
  try {
    const s = _loadStored();
    return !!(s?.gdcEnabled && s?.walletPubKey);
  } catch { return false; }
}

// ── L1 PocketBase 등록 ────────────────────────────────────
export async function _registerToL1(name) {
  const user = _USER;
  if (!user) return null;
  const countryKey    = user.country_code || DEFAULT_COUNTRY;
  const e164          = user.e164 || buildE164(name, countryKey);
  const guid          = user.ipv6 || USER_GUID;
  const nickname_hash = await _sha256('phone:' + e164);
  const handle        = buildHandle(name, countryKey);

  try {
    const postRes = await fetch(L1_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guid, nickname_hash, handle,
        e164, country_code: countryKey,
        native_lang: navigator.language?.slice(0,2) || 'ko',
        is_public: true
      }),
    });

    if (!postRes.ok) {
      const filter     = encodeURIComponent(`guid='${guid.replace(/'/g, "\\'")}'`);
      const getRes     = await fetch(`${L1_URL}?filter=${filter}&perPage=1`);
      const getData    = await getRes.json();
      const existingId = getData.items?.[0]?.id;
      if (existingId) {
        await fetch(`${L1_URL}/${existingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guid, nickname_hash, handle, e164, country_code: countryKey, is_public: true }),
        });
      }
    }

    user.handle = handle; user.name = name;
    user.e164 = e164; user.country_code = countryKey;
    user.isGuest = false; user.isTemp = false;
    localStorage.setItem(STORE_KEY, JSON.stringify(user));
    console.info('[L1] 등록 완료:', handle, e164);

    // ── 2026-07-07 신설: GDC 지갑·재무제표 가입 시점 초기화 ─────────
    // 이전엔 지갑(키페어)만 로컬에서 자동 생성되고, ①L1의 gdc_keys에
    // 공개키를 등록하는 절차가 아예 없어 첫 실거래가 무조건
    // UNREGISTERED_KEY로 막혔고, ②재무제표는 "생성 이벤트" 없이
    // 그냥 비어있다가 첫 거래 때 암묵적으로 0 취급되는 식이었다.
    // 실패해도(오프라인 등) 가입 자체는 막지 않는다 — 다음 접속 시
    // wallet-init IIFE의 hydrateFromServer()가 재시도 격으로 동작한다.
    _initGdcWalletAndFs(guid).catch(e =>
      console.warn('[L1] GDC 지갑/재무제표 초기화 실패(가입은 유지):', e.message)
    );

    return handle;
  } catch(e) {
    console.warn('[L1] 등록 실패:', e.message);
    return null;
  }
}

// ── GDC 지갑·재무제표 가입 시점 초기화 (2026-07-07 신설) ──────────────
// ① L1 gdc_keys에 이 계정 지갑의 공개키를 등록(TOFU — 개인키로 서명해
//    소유권 증명) — 없으면 첫 실거래가 UNREGISTERED_KEY로 막힌다.
// ② 로컬 재무제표를 명시적으로 0으로 초기화 — IASB 5대 요소 기준
//    (자산/부채/자본/수익/비용) 매핑: bs-cash=자산(현금성자산),
//    pl-purchase=비용(누적 매입), pl-revenue=수익(누적 매출).
//    부채는 이 개인 지갑 모델에 없고, 자본=자산-부채=bs-cash로 항상
//    일치(부채가 없으므로) — 그래서 별도 필드로 자본을 저장하지 않고
//    bs-cash를 그대로 자본으로도 해석한다(회계등식 자산=부채+자본,
//    부채=0이므로 자산=자본).
// ③ "재무제표 생성" 이벤트를 PDV에 남겨 감사 추적을 남긴다.
async function _initGdcWalletAndFs(guid) {
  const wallet = await _waitForWallet();
  if (!wallet || typeof wallet.signPayload !== 'function') {
    throw new Error('wallet_not_ready');
  }

  // ① 공개키 등록 (TOFU)
  const ts  = Date.now();
  const sigMsg = `register-key:${guid}:${ts}`;
  const signature = await wallet.signPayload(sigMsg);
  const regRes = await fetch(`${PROXY_URL}/gwp/register-key`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guid, public_key: wallet.publicKeyB64u, signature, ts }),
  });
  const regData = await regRes.json().catch(() => ({}));
  if (!regRes.ok || !regData.ok) {
    throw new Error('register-key 실패: ' + (regData.error || regRes.status));
  }
  console.info('[GDC] 지갑 공개키 등록 완료:', guid.slice(0, 20));

  // ② 재무제표 명시적 0 초기화 — 이미 거래 이력이 있는 재가입 등은
  // 덮어쓰지 않는다(로컬에 이미 뭔가 있으면 건드리지 않음).
  const existingFs = await wallet.getFinancialState();
  if (!existingFs || Object.keys(existingFs).length === 0) {
    await wallet.setFinancialState({ 'bs-cash': 0, 'pl-purchase': 0, 'pl-revenue': 0, 'pl-cogs': 0 });
    console.info('[GDC] 재무제표 초기화 완료(IASB: 자산/비용/수익 각 0)');

    // ③ 감사 추적 — 재무제표 생성 사실을 PDV에 남긴다
    try {
      const { recordPDV } = await import('../pdv/record.js');
      await recordPDV({
        report: {
          svc: 'gdc', reporter_svc: 'gopang',
          type: 'fs_genesis',
          who:  { ipv6: guid, role: 'user', level: 'L0', recipients: ['gopang-pdv'] },
          when: { period_start: new Date().toISOString(), period_end: new Date().toISOString() },
          where:{ svc_url: 'https://hondi.net' },
          what: { summary: 'GDC 지갑·재무제표 초기화(자산 0 / 비용 0 / 수익 0)' },
          how:  { method: 'signup_auto_init' },
          why:  { goal: 'IASB 기준 재무제표 최초 생성' },
        },
      });
    } catch (e) {
      console.warn('[GDC] 재무제표 생성 PDV 기록 실패(무시):', e.message);
    }
  }
}

// ── 계정 삭제(경량) — 서버 프로필(전화번호·guid)만 삭제, 로컬 PDV·지갑은 보존 ──
// 2026-07-02 신설: 설정 화면 "계정 삭제" 슬라이드아웃 전용. _deviceFullReset()과
// 달리 로컬 데이터를 지우지 않는다 — 혼디는 서버에 원본 데이터를 두지
// 않으므로, 나중에 같은 번호로 다시 가입하면 로컬에 남아있던 PDV 기록·지갑과
// 함께 자연스럽게 이전 상태로 돌아갈 수 있다 — 서버가 곧 원본인 기존 SNS와
// 근본적으로 다른 지점이다.
export async function _deleteMyProfile(phoneE164) {
  const stored = _loadStored();
  const guid = stored?.ipv6;
  if (!guid) { alert('로그인 정보가 없습니다.'); return false; }

  let body = { guid, phone: phoneE164 || stored.e164 || '' };
  try {
    if (typeof window.GopangWallet !== 'undefined') {
      const wallet = await window.GopangWallet.load().catch(() => null);
      if (wallet?.publicKeyB64u && typeof wallet.signPayload === 'function') {
        const ts  = Date.now();
        const sig = await wallet.signPayload(`delete-profile:${guid}:${ts}`);
        body = { ...body, ed25519_pubkey: wallet.publicKeyB64u, signature: sig, ts };
      }
    }
  } catch (e) {
    console.warn('[DeleteProfile] 서명 생성 실패(서명 없이 진행):', e.message);
  }

  try {
    const res  = await fetch(`${PROXY_URL}/account/delete-profile`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      alert('계정 삭제에 실패했습니다: ' + (data?.message || `HTTP ${res.status}`));
      return false;
    }
  } catch (e) {
    alert('계정 삭제 요청 실패: ' + e.message);
    return false;
  }

  // 서버 연결 정보(가입 상태)만 지운다 — PDV(gopang_pdv_log 등)와 지갑
  // (GopangWallet IndexedDB)은 의도적으로 건드리지 않는다.
  try {
    localStorage.removeItem(STORE_KEY);
    sessionStorage.removeItem(STORE_KEY);
  } catch {}

  return true;
}

// ── 기기 완전 초기화 ─────────────────────────────────────
// ── 로컬 데이터만 초기화 (L1 레코드 유지 → 재접속 시 복원 가능) ──
export async function _deviceLocalReset() {
  if (!confirm('이 기기의 고팡 데이터를 초기화합니다.\n\n계정 정보는 서버에 유지되므로\n같은 번호로 재접속하면 복원됩니다.')) return;
  await _clearLocalData();
}

// ── 계정 완전 삭제 (L1 레코드 + 로컬 모두 삭제, 판매·양도용) ──
export async function _deviceFullReset() {
  if (!confirm(
    '계정을 완전히 삭제합니다.\n' +
    '\n' +
    '⚠️ L1 서버, Supabase, 이 기기의 모든 기록이 삭제됩니다.\n' +
    '복원이 불가능합니다. 계속하시겠습니까?'
  )) return;

  const stored = _loadStored();
  const guid   = stored?.ipv6;

  let serverDeleteOk = false;
  let serverErrorMsg = '';

  if (guid) {
    // 서버 전체 삭제 — Worker가 L1·Supabase·KV 일괄 처리
    try {
      let resetBody = { guid };
      if (typeof window.GopangWallet !== 'undefined') {
        const wallet = await window.GopangWallet.load().catch(() => null);
        if (wallet?.publicKeyB64u && typeof wallet.signPayload === 'function') {
          const ts  = Date.now();
          const sig = await wallet.signPayload(`full-reset:${guid}:${ts}`);
          resetBody = { guid, ed25519_pubkey: wallet.publicKeyB64u, signature: sig, ts };
        }
      }
      const res  = await fetch(`${PROXY_URL}/account/full-reset`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(resetBody),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data?.ok) {
        // HTTP 200이어도 results 안의 개별 테이블이 'error:...'로 실패했을 수 있음
        const failedTables = Object.entries(data.results || {})
          .filter(([, v]) => typeof v === 'string' && v.startsWith('error:'))
          .map(([k]) => k);
        if (failedTables.length === 0) {
          serverDeleteOk = true;
          console.info('[Reset] 서버 삭제 완료:', data.results);
        } else {
          serverErrorMsg = `일부 항목 삭제 실패: ${failedTables.join(', ')}`;
          console.warn('[Reset] 서버 일부 삭제 실패:', data.results);
        }
      } else {
        serverErrorMsg = data?.message || `HTTP ${res.status}`;
        console.warn('[Reset] 서버 삭제 실패:', res.status, data);
      }
    } catch(e) {
      serverErrorMsg = e.message;
      console.warn('[Reset] 서버 삭제 요청 실패:', e.message);
    }
  } else {
    serverErrorMsg = 'guid 없음 (로컬에 등록 정보가 없음)';
  }

  // "계정 완전 삭제"는 서버(ID+전화번호)와 로컬 데이터 삭제가 반드시
  // 동시에(원자적으로) 이뤄져야 한다 — 둘 중 하나만 지워지면 다음 두 문제가
  // 생긴다: (1) 서버엔 전화번호가 그대로 남아 재가입이 막히거나 다른 사람과
  // 충돌할 수 있고, (2) 사용자는 "완전 삭제했다"고 믿지만 실제로는 서버에
  // 자신의 ID+전화번호가 살아있다. 그래서 서버 삭제가 확인되지 않으면
  // 로컬은 절대 건드리지 않고 여기서 중단한다 — "로컬만이라도 지울까요"
  // 같은 부분 완료 경로를 더 이상 제공하지 않는다. 기기 데이터만 지우고
  // 싶다면(서버 계정은 유지) 별도 기능인 _deviceLocalReset()을 쓰면 된다.
  // (2026-07-02: 다른 개발자의 검토를 반영해 "부분 완료 후 사용자 선택"
  // 방식에서 "원자성 보장, 실패 시 전면 중단" 방식으로 변경)
  if (!serverDeleteOk) {
    alert(
      `⚠️ 서버 삭제가 완료되지 않아 계정 완전 삭제를 중단했습니다 (${serverErrorMsg || '알 수 없는 오류'}).\n\n` +
      '완전 삭제는 서버(전화번호·ID)와 이 기기의 기록이 함께 지워져야만 완료로 인정됩니다.\n' +
      '이 기기의 데이터는 그대로 남아있습니다 — 아무것도 삭제되지 않았습니다.\n\n' +
      '네트워크 상태를 확인한 뒤 다시 시도해 주세요. 계속 실패하면 문의해 주세요.\n' +
      '(참고: 서버 계정은 그대로 두고 이 기기의 기록만 지우고 싶다면, "이 기기 데이터만 초기화" 메뉴를 따로 이용하실 수 있습니다.)'
    );
    return;
  }

  // 스마트폰/PC 로컬 전체 삭제
  // localStorage, sessionStorage, IndexedDB(지갑 포함), SW 캐시, PWA 캐시
  await _clearLocalData();
}

// ── 공통: 로컬 데이터 삭제 + 페이지 리로드 ─────────────────
async function _clearLocalData() {
  localStorage.clear(); sessionStorage.clear();
  const dbs = await indexedDB.databases?.() || [];
  for (const db of dbs) indexedDB.deleteDatabase(db.name);
  const keys = await caches.keys();
  await Promise.all(keys.map(k => caches.delete(k)));
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map(r => r.unregister()));
  location.reload();
}

// ── gopangAuth — 레벨별 인증 요구 ────────────────────────
export const gopangAuth = {
  async require(level = 'L0') {
    const stored = _loadStored();
    if (!stored?.ipv6) return false;
    const levels  = ['L0','L1','L2','L3'];
    const current = levels.indexOf(stored.authLevel || 'L0');
    const needed  = levels.indexOf(level);
    if (current >= needed) return true;

    if (needed >= 1) {
      if (!stored.faceVec) { appendBubble('ai', '⚠️ 얼굴을 먼저 등록해 주세요. (설정 → 보안)', true); return false; }
      appendBubble('ai', '📷 얼굴 인증이 필요합니다.', true);
      const vec = await _captureFaceVector();
      if (!vec) return false;
      const sim = _cosineSim(vec, stored.faceVec);
      if (sim < 0.90) { appendBubble('ai', `❌ 얼굴 인증 실패 (유사도 ${(sim*100).toFixed(1)}%)`, true); return false; }
      if (needed === 1) return true;
    }

    if (needed >= 2) {
      const credId = stored.webauthn?.credentialId;
      if (!credId) { appendBubble('ai', '⚠️ 지문을 먼저 등록해 주세요. (설정 → 보안)', true); return false; }
      try {
        appendBubble('ai', '🔐 지문 인증이 필요합니다.', true);
        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const assertion = await navigator.credentials.get({
          publicKey: {
            challenge, timeout: 30000, userVerification: 'required',
            allowCredentials: [{ id: Uint8Array.from(atob(credId.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0)), type: 'public-key' }],
          },
        });
        if (!assertion) return false;
        if (needed === 2) { appendBubble('ai', '✅ 지문 인증 완료.', true); return true; }
      } catch(e) { appendBubble('ai', '지문 인증이 취소됐습니다.', true); return false; }
    }

    if (needed >= 3) {
      // v6.0: 전화번호 재입력은 증명이 아니다(전화번호는 비밀이 아님 — 아는 사람
      // 누구나 통과할 수 있었다). 대신 이 기기의 Ed25519 키가 실제로 이 계정에
      // 핀(pin)된 키인지 서버가 서명으로 검증한다(_issueSession과 동일 경로,
      // level만 L3).
      appendBubble('ai', '🔑 보안키 인증이 필요합니다.', true);
      const session = await _issueSession(stored.ipv6, 'gopang', 'L3');
      if (!session.ok) {
        appendBubble('ai', `❌ 인증 실패 (${session.reason === 'PUBKEY_MISMATCH' ? '이 기기는 등록된 기기가 아닙니다' : (session.detail || session.reason)}).`, true);
        return false;
      }
      appendBubble('ai', '✅ L3 인증 완료.', true);
      return true;
    }
    return false;
  }
};

// ── 인증 확인 버튼 ───────────────────────────────────────
export function _injectAuthConfirmButton(level) {
  const list = document.getElementById('message-list');
  if (!list) return;
  const labels = { L1:'얼굴 인증', L2:'지문 인증', L3:'번호 인증' };
  const row = document.createElement('div');
  row.className = 'msg-row ai';
  row.id = '_auth-confirm-row';
  row.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;padding:4px 0;">
      <button onclick="window._executeAuthAndProceed('${level}')"
        style="background:var(--tint);color:#fff;border:none;border-radius:8px;
               padding:10px 20px;font-size:14px;font-weight:600;cursor:pointer;">
        🔐 ${labels[level]||'추가 인증'} 후 진행
      </button>
      <button onclick="window._cancelAuthRequest()"
        style="background:var(--bg-subtle);color:var(--label-2);border:1px solid var(--sep);
               border-radius:8px;padding:10px 16px;font-size:13px;cursor:pointer;">취소</button>
    </div>`;
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;
}

window._executeAuthAndProceed = async function(level) {
  document.getElementById('_auth-confirm-row')?.remove();
  const { callAI } = await import('../ai/call-ai.js');
  const ok = await gopangAuth.require(level);
  if (!ok) { appendBubble('ai', '인증이 취소됐습니다.', true); return; }
  appendBubble('user', `[인증완료:${level}] 인증이 완료됐습니다.`, false);
  await callAI(`[AUTH_CONFIRMED:${level}] 사용자가 ${level} 인증을 완료했습니다. 이전 요청을 즉시 실행하세요.`);
};

window._cancelAuthRequest = function() {
  document.getElementById('_auth-confirm-row')?.remove();
  appendBubble('ai', '거래가 취소됐습니다.', true);
};

// ── ensureX25519Synced — X25519 키 보장 + 서버 등록 (가입 완료 / AI 설정 화면 공통) ──
// PC(ai-setup.html)가 이 사용자의 핸들을 검색해 공개키를 얻어 LLM Key를
// 암호화해 보낼 수 있도록, 가입 직후부터 키를 준비해 둔다.
// 반환: { ok, publicKeyB64u } — 실패해도 가입 흐름을 막지 않도록 호출부에서 catch 처리.
export async function ensureX25519Synced(guid) {
  if (!guid) return { ok: false, reason: 'guid_missing' };
  if (typeof window.GopangWallet === 'undefined') return { ok: false, reason: 'wallet_module_not_loaded' };

  let wallet;
  try {
    wallet = await window.GopangWallet.load();
  } catch (e) {
    // load()가 2026-07-21부터 "레코드는 있는데 복호화 실패"를 null 대신
    // 구분된 에러로 던지도록 바뀌었다 — 이 함수는 "실패해도 가입 흐름을
    // 막지 않는다"는 계약이므로, 여기서도 예외를 삼키고 사유만 구분해 반환한다.
    return { ok: false, reason: e?.code === 'WALLET_DECRYPT_FAILED' ? 'wallet_locked' : (e.message || 'wallet_load_failed') };
  }
  if (!wallet) return { ok: false, reason: 'wallet_not_found' };

  const { publicKeyB64u } = await wallet.ensureX25519Key();

  // 로컬에 키가 있다는 사실과 "서버에 등록되어 있다"는 사실은 별개이므로
  // (네트워크 오류, user_profiles 미생성 등으로 서버 등록이 실패할 수 있음),
  // 매번 서버 상태를 직접 조회해 확인한다.
  let serverOk = false;
  try {
    const checkRes = await fetch(`${PROXY_URL}/wallet/x25519?guid=${encodeURIComponent(guid)}`);
    const checkData = await checkRes.json();
    serverOk = !!(checkData.ok && checkData.registered && checkData.x25519_pubkey === publicKeyB64u);
  } catch {}

  if (!serverOk) {
    const ts = Math.floor(Date.now() / 1000);
    const sigMsg = `${guid}:${publicKeyB64u}:${ts}`;
    const signature = await wallet.signPayload(sigMsg);

    const regRes = await fetch(`${PROXY_URL}/wallet/x25519`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guid, x25519_pubkey: publicKeyB64u,
        ed25519_pubkey: wallet.publicKeyB64u,
        signature, ts,
      }),
    }).catch(e => { console.warn('[X25519] 공개키 등록 요청 실패:', e.message); return null; });

    if (!regRes) return { ok: false, reason: 'network' };
    const regData = await regRes.json().catch(() => null);
    if (!regRes.ok || !regData?.ok) {
      // ★ 2026-07-23 수정 — 기존엔 regData?.detail(사람이 읽는 한글 메시지)을
      // reason으로 반환해서, 호출부가 이 값으로 분기하려면 깨지기 쉬운
      // 문자열 비교를 해야 했다(실제로 다른 곳에선 이 값을 그냥 로그에만
      // 찍고 아무도 분기하지 않았다). worker.js의 _err()가 이미 기계
      // 판별용 코드(regData.error, 예: 'PUBKEY_MISMATCH')를 별도로 내려주므로
      // 그걸 reason으로 쓴다. detail은 호출부가 사람에게 보여줄 때 쓰라고
      // 별도 필드로 함께 반환.
      const reason = regData?.error || 'server_error';
      if (reason === 'PUBKEY_MISMATCH') {
        // 6단계 — 이 PC의 로컬 지갑이 이 계정과 안 맞는다는 뜻(잠긴 것과는
        // 다르지만 사용자가 취할 조치는 동일: 백업 키 복구/새로 시작/다른
        // 기기에서 지갑 가져오기) — 이미 만들어둔 지갑 잠금 배너를 그대로
        // 재사용한다(같은 이벤트를 재사용해 별도 배너를 새로 안 만듦).
        window.gopangWalletLocked = true;
        try { window.dispatchEvent?.(new CustomEvent('gopang:wallet-locked')); } catch (e) {}
      }
      return { ok: false, reason, detail: regData?.detail };
    }
  }

  return { ok: true, publicKeyB64u, wallet };
}

// ── _createMinimalProfile — 가입 완료 시 최소 프로필 자동 생성 ───────────────
async function _createMinimalProfile({ ipv6, handle, nickname, e164, isPublic }) {
  try {
    const wallet = window.gopangWallet;
    if (!wallet) throw new Error('gopangWallet 없음');

    // wallet에 guid 반영 (setIdentity가 아직 안 된 경우 대비)
    if (!wallet.guid && wallet.setIdentity) {
      wallet.setIdentity({ guid: ipv6, handle });
    }

    const ts = Date.now().toString();
    const sigMsg = `${ipv6}:${wallet.publicKeyB64u}:${ts}`;
    const signature = await wallet.signPayload(sigMsg);

    const payload = {
      guid:        ipv6,
      pubkey:      wallet.publicKeyB64u,
      signature,
      ts,
      entity_type: 'person',
      name:        nickname,
      handle,
      phone:       e164 || null,
      is_public:   isPublic,
      native_lang: navigator.language?.slice(0, 2) || 'ko',
    };

    const { PROXY } = await import('./state.js');
    const res = await fetch(`${PROXY}/profile`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.info('[Profile] 최소 프로필 생성 완료 | handle:', handle, '| is_public:', isPublic);
  } catch(e) {
    console.warn('[Profile] 최소 프로필 생성 실패:', e.message);
  }
}

// ── _recordRegisterPdv — 가입 완료 시 PDV 초기 레코드 + OpenHash 앵커링 ─────
// 목적:
//   1. 가입 원본 데이터 구성 → SHA-256(원본) = contentHash
//   2. gopangWallet.sign(contentHash) → userSig (Ed25519 서명)
//   3. hashChain.anchor(contentHash, [userSig], sessionId) → entryHash
//      entryHash = SHA-256(prevHash + contentHash + userSig + blockHeight)
//      prevHash: 이전 체인 상태 (위변조 방지 핵심)
//      userSig:  "나는 이 가입 데이터가 정확함을 서명한다"
//   4. pdv_log INSERT (openhash_anchored: true)
//   5. extra.fs 초기화
//      { bs-cash:0, pl-purchase:0, pl-revenue:0,
//        last_tx_id:null, last_block_hash:null }
//      bs-cash = wallet 잔액 (재무제표 현금 계정 = wallet)
//
// 설계:
//   - 원본은 호출자(auth.js)가 보관 — OpenHash에는 contentHash만 기록
//   - fire-and-forget — 실패해도 가입 흐름 차단 안 함
async function _recordRegisterPdv({ ipv6, handle, nickname, e164, selectedCountry }) {
  const now       = new Date().toISOString();
  const sessionId = `REG-${ipv6.replace(/:/g, '').slice(0, 12)}-${Date.now()}`;

  // ① 가입 원본 데이터 구성
  const regPayload = JSON.stringify({
    type: 'user_register', guid: ipv6, handle, nickname, e164,
    country_code: selectedCountry, ts: now,
  });

  // ② contentHash = SHA-256(원본)
  const buf         = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(regPayload));
  const contentHash = Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');

  // ③ Ed25519 서명 — "나는 이 가입 데이터가 정확함을 서명한다"
  //    _recordRegisterPdv 호출 시점에 gopangWallet은 아직 guid 미반영
  //    (wallet은 모듈 로드 시 1회만 localStorage를 읽음)
  //    → setIdentity()로 직접 guid를 주입한 후 서명
  let userSig = ipv6;  // fallback
  try {
    if (window.gopangWallet) {
      // guid 직접 주입
      if (typeof window.gopangWallet.setIdentity === 'function') {
        window.gopangWallet.setIdentity({ guid: ipv6, handle: null });
      }
      if (typeof window.gopangWallet.sign === 'function') {
        userSig = await window.gopangWallet.sign(contentHash);
      }
    }
  } catch (e) {
    console.warn('[Auth] Ed25519 서명 실패, guid로 대체:', e.message);
  }

  // ④ OpenHash 앵커링
  //    anchor(contentHash, [userSig], sessionId)
  //    entryHash = SHA-256(prevHash + contentHash + userSig + blockHeight)
  let entryHash = null;
  let layer     = null;
  try {
    const { anchor } = await import('../../openhash/hashChain.js');
    const result  = await anchor(contentHash, [userSig], sessionId);
    entryHash     = result.entryHash;
    layer         = result.layer;
    console.info('[Auth] OpenHash 앵커링 완료',
      '| contentHash:', contentHash.slice(0, 16),
      '| entryHash:', entryHash.slice(0, 16),
      '| layer:', layer);
  } catch (e) {
    console.warn('[Auth] OpenHash 앵커링 실패 (무시):', e.message);
  }

  // ⑤ pdv_log 기록
  const report = {
    svc:          'gopang',
    type:         'user_register',
    reporter_svc: 'gopang-auth',
    session_id:   sessionId,
    block_hash:   entryHash,
    who:  { ipv6, handle },
    when: now,
    where: 'https://hondi.net',
    what: `신규 사용자 가입: ${nickname} (${handle})`,
    how:  '전화번호 입력 → 즉시 등록 (테스트 모드, 상용화 시 SMS 2FA)',
    why:  '고팡 서비스 최초 가입',
  };

  // ⑤ T-C: L1 pdv_records 직접 기록 (Worker pdv 리포트 대체)
  await fetch(L1_PDV_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      guid:         ipv6,
      report_id:    `${sessionId}:gopang-auth`,
      reporter_svc: report.reporter_svc,
      svc:          report.svc,
      type:         report.type,
      summary:      report.what,
      summary_6w:   JSON.stringify(report),
      block_hash:   report.block_hash,
      risk_level:   'low',
      source:       report.svc,
      openhash_anchored: !!report.block_hash,
    }),
  }).catch(e => console.warn('[PDV] L1 pdv_records 전송 실패:', e.message));

  if (entryHash) {
    fetch(L1_ANCHOR_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entry_hash:   entryHash,
        content_hash: contentHash,
        msg_id:       sessionId,
        source:       'pdv_records',
      }),
    }).catch(e => console.warn('[PDV] L1 anchor_records 전송 실패:', e.message));
  }

  // ⑥ extra.fs 초기화
  //    bs-cash          = wallet 잔액 (재무제표 현금 계정)
  //    last_tx_id       = 마지막 거래 식별자 (null: 거래 없음)
  //    last_block_hash  = 마지막 거래 OpenHash 앵커
  //    last_updated_at  = 마지막 갱신 시각
  const fsInit = {
    'bs-cash':          0,
    'pl-purchase':      0,
    'pl-revenue':       0,
    'pl-cogs':          0,
    'last_tx_id':       null,
    'last_block_hash':  null,
    'last_updated_at':  now,
  };

  // PATCH /profile은 worker.js 미지원 — 브라우저가 L1 PocketBase를 직접
  // 찾아서(find) PATCH한다. 옛 Supabase 직접접근 폴백을 없애고, 이 파일
  // 2201-2205행에서 이미 쓰고 있는 것과 정확히 같은 find-then-PATCH
  // 패턴으로 교체했다(profiles 컬렉션은 이미 공개 write 규칙이라 admin
  // 토큰 불필요 — L1_URL을 인증 없이 직접 두드리는 다른 호출부와 동일).
  {
    try {
      const filter = encodeURIComponent(`guid='${ipv6.replace(/'/g, "\\'")}'`);
      const getRes = await fetch(`${L1_URL}?filter=${filter}&perPage=1`);
      const getData = await getRes.json();
      const existingId = getData.items?.[0]?.id;
      if (existingId) {
        await fetch(`${L1_URL}/${existingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ extra: { public: { finance: { fs: fsInit } } } }),
        });
      } else {
        console.warn('[PDV] fs 초기화 실패 — L1에서 guid로 프로필을 못 찾음:', ipv6);
      }
    } catch (e) {
      console.warn('[PDV] fs 초기화 L1 PATCH 실패:', e.message);
    }
  }

  console.info('[Auth] 가입 PDV + OpenHash 앵커링 + fs 초기화 완료',
    '| handle:', handle,
    '| contentHash:', contentHash.slice(0, 16),
    '| entryHash:', entryHash?.slice(0, 16) ?? 'none',
    '| layer:', layer ?? 'none');
}

