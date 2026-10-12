/**
 * core/config.js — 앱 설정 (CFG, 모델, 엔드포인트)
 */
import { setAiActive, aiActive, _USER, USER_GUID } from './state.js';

// ── Provider별 정보 (모델 → provider 식별 + baseUrl) ────────
// 모든 provider가 OpenAI 호환 /chat/completions 형식 지원
// (Anthropic은 공식 OpenAI SDK 호환 레이어 제공 — base_url=api.anthropic.com/v1,
//  Authorization: Bearer 사용. 단, prompt caching 등 일부 고급기능은 미지원이므로
//  stream_options도 보수적으로 비활성화.)
export const PROVIDER_INFO = {
  anthropic:  { label: 'Claude',     baseUrl: 'https://api.anthropic.com/v1',                              keyField: 'apiKey',    noStreamOptions: true },
  gemini:     { label: 'Gemini',     baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyField: 'geminiKey', noStreamOptions: true },
  deepseek:   { label: 'DeepSeek',   baseUrl: 'https://api.deepseek.com',                                 keyField: 'apiKey' },
  openai:     { label: 'ChatGPT',    baseUrl: 'https://api.openai.com/v1',                                 keyField: 'apiKey' },
  xai:        { label: 'Grok',       baseUrl: 'https://api.x.ai/v1',                                       keyField: 'apiKey' },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1',                               keyField: 'apiKey', noStreamOptions: true },
};

// ── 호출 우선순위 (2026-06-24 v2 — OpenRouter 무료풀 1순위, 사용자 조정 가능) ──
// DEFAULT_PRIORITY_ORDER는 사용자가 한 번도 순서를 바꾸지 않았을 때의 기본값이다.
// ai-setup-mobile.html에서 드래그로 순서를 바꾸면 그 결과가
// localStorage(gopang_cfg.providerOrder)에 저장되고, getPriorityOrder()가 그 값을
// 최우선으로 읽는다. call-ai.js·webapp.html(_callPanelAI) 모두 이 함수를 통해서만
// 우선순위를 읽어야 사용자 설정이 실제 호출 순서에 반영된다.
export const DEFAULT_PRIORITY_ORDER = ['openrouter', 'anthropic', 'gemini', 'deepseek', 'openai', 'xai'];
// 하위 호환용 별칭 — 기존에 PRIORITY_ORDER를 직접 import하던 코드가 있어도 깨지지 않게 유지
export const PRIORITY_ORDER = DEFAULT_PRIORITY_ORDER;

export function getPriorityOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem('gopang_cfg') || '{}');
    const order = saved?.providerOrder;
    if (Array.isArray(order) && order.length) {
      // 알려진 provider id만 채택 + 빠진 id는 기본 순서대로 뒤에 보충
      // (새 provider가 추가됐는데 사용자의 저장된 순서가 오래된 경우를 대비)
      const known = new Set(DEFAULT_PRIORITY_ORDER);
      const valid = order.filter(id => known.has(id));
      const missing = DEFAULT_PRIORITY_ORDER.filter(id => !valid.includes(id));
      if (valid.length) return [...valid, ...missing];
    }
  } catch {}
  return DEFAULT_PRIORITY_ORDER;
}

export function _providerOf(model) {
  if (!model) return null;
  // OpenRouter 모델 ID는 'vendor/model-name' 형식 (예: deepseek/deepseek-r1:free)
  if (model.includes('/'))         return 'openrouter';
  if (model.startsWith('gemini'))  return 'gemini';
  if (model.startsWith('deepseek'))return 'deepseek';
  if (model.startsWith('claude'))  return 'anthropic';
  if (model.startsWith('grok'))    return 'xai';
  if (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3')) return 'openai';
  return null;
}

export const CFG = {
  apiKey:    '',
  geminiKey: '',
  endpoint:  'https://hondi-proxy.tensor-city.workers.dev',
  model:     'deepseek-v4-flash',
  // ── 다중 LLM 순차 페일오버 ───────────────────────────────
  // 각 항목: { provider, model, apiKey }
  // 등록된 순서대로 호출하며, 한도 초과(429/402) 시 다음 항목으로 자동 전환
  providers: [],
  // personal-assistant-v1.0 — Profile 온보딩 + 일상 비서 + P2P 대리 응대
  // GitHub raw에서 동적 로드 (loadPersonalAssistantSP 참조)
  // 2026-07-05: 로드 실패 시 쓰던 인라인 폴백(라우팅 표에 표시명을 그대로
  // 써서 실제 레지스트리 id와 어긋났고, 안전장치도 전혀 없었음)을 완전히
  // 제거했다. loadPersonalAssistantSP()는 이제 모든 시도가 실패하면 조용히
  // 이 빈 문자열을 반환하는 대신 명시적으로 예외를 던진다.
  system: '',
  system_base: null,
  locationStr: '',
  // ── Phase 7(AI 종합 위법 가능성 판단) — 2026-07-18 신설 ────────
  // opt-in, 기본 꺼짐. 켜면 본인 무료 한도/GDC 잔액에서 비용 차감
  // (수익자 부담). 절대 자동 신고 없음 — send-message.js가 감지 시
  // 신고 초안만 만들어 보여주고, 실제 신고는 사용자가 직접 확인 후 진행.
  phase7: { enabled: false, tier: 'flash' },
};

// ── 모델명 교정 매핑 ──────────────────────────────────────
export const MODEL_MIGRATION = {
  'deepseek-v4':  'deepseek-v4-flash',
  'deepseek-v3':  'deepseek-v4-flash',
  'deepseek-r1':  'deepseek-reasoner',
  // deepseek-chat/reasoner는 2026-07-24 단종 예정 별칭 — 명시적 V4 ID로 선이전
  'deepseek-chat':     'deepseek-v4-flash',
  'deepseek-reasoner': 'deepseek-v4-flash',
};

// ── 설정 저장 ─────────────────────────────────────────────
export function saveSettings() {
  const modelSel = document.getElementById('setting-model');
  const epSel    = document.getElementById('setting-endpoint');
  const apiInput = document.getElementById('setting-apikey');
  const gKeyInput= document.getElementById('setting-gemini-key');
  const sysInput = document.getElementById('setting-system');
  const custUrl  = document.getElementById('custom-endpoint-url');
  const p7Toggle = document.getElementById('setting-phase7-enabled');
  const p7Tier   = document.getElementById('setting-phase7-tier');

  if (modelSel)  CFG.model = modelSel.value;
  if (epSel) {
    CFG.endpoint = epSel.value === 'custom'
      ? (custUrl?.value?.trim() || CFG.endpoint)
      : epSel.value;
  }
  const apiVal = apiInput?.value?.trim();
  if (apiVal && !apiVal.startsWith('•')) CFG.apiKey = apiVal;
  const gVal = gKeyInput?.value?.trim();
  if (gVal && !gVal.startsWith('•'))   CFG.geminiKey = gVal;
  if (sysInput?.value?.trim())         CFG.system    = sysInput.value.trim();
  if (p7Toggle) {
    CFG.phase7 = {
      enabled: !!p7Toggle.checked,
      tier: (p7Tier?.value === 'pro') ? 'pro' : 'flash',
    };
  }

  try {
    localStorage.setItem('gopang_cfg', JSON.stringify({
      model: CFG.model, endpoint: CFG.endpoint,
      apiKey: CFG.apiKey, geminiKey: CFG.geminiKey,
      providers: CFG.providers, phase7: CFG.phase7,
    }));
  } catch {}

  if (typeof window.closeSettings === 'function') window.closeSettings();
  if (typeof window.appendBubble  === 'function') window.appendBubble('ai', `⚙️ 설정 저장: ${CFG.model}`);
}

// ── 설정 불러오기 ─────────────────────────────────────────
export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('gopang_cfg') || '{}');
    if (saved.model)    CFG.model    = MODEL_MIGRATION[saved.model] ?? saved.model;
    if (saved.endpoint) CFG.endpoint = saved.endpoint;
    if (saved.apiKey)   CFG.apiKey   = saved.apiKey;
    if (saved.geminiKey)CFG.geminiKey= saved.geminiKey;
    if (Array.isArray(saved.providers) && saved.providers.length) {
      CFG.providers = saved.providers;
    }
    if (saved.phase7 && typeof saved.phase7 === 'object') {
      CFG.phase7 = {
        enabled: !!saved.phase7.enabled,
        tier: saved.phase7.tier === 'pro' ? 'pro' : 'flash',
      };
    }
    if (saved.apiKey || saved.geminiKey || CFG.providers.length) setAiActive(true);
  } catch {}
}

// ── 디폴트 LLM 키 fetch (체험 기간 사용자 전용) ─────────────
// 사용자가 직접 키를 등록하지 않은 경우에만 호출
// 등록된 키가 있으면 건너뜀 (사용자 키 우선)
//
// 2026-06-27: 공용 디폴트 키 제공을 전면 중단. 토큰 낭비(K-Market·
// K-Insurance가 같은 공유 프록시로 deepseek-v4-pro를 기본/고정 호출)가
// 확인되어, 이제 모든 사용자가 자신이 선택한 API 키를 직접 입력해야
// 한다. 다시 켜려면 이 값만 true로 되돌리면 된다.
const DEFAULT_KEY_PROVISIONING_ENABLED = false;

export async function loadDefaultKeyIfNeeded() {
  if (!DEFAULT_KEY_PROVISIONING_ENABLED) return;  // 2026-06-27 중단

  try {
    // 이미 사용자 키가 있으면 건너뜀
    const cfg = JSON.parse(localStorage.getItem('gopang_cfg') || '{}');
    const hasUserKey = (Array.isArray(cfg.providers) && cfg.providers.length > 0)
                    || cfg.apiKey || cfg.geminiKey;
    if (hasUserKey) return;

    // 가입일 확인
    const user = JSON.parse(
      localStorage.getItem('gopang_user_v4') ||
      sessionStorage.getItem('gopang_user_v4') || '{}'
    );
    const registeredAt = user.registeredAt || user.created;
    if (!registeredAt || !user.guid) return;

    // 이미 만료 확인했고 캐시가 유효하면 재요청 안 함 (1시간 캐시)
    const cache = JSON.parse(localStorage.getItem('hondi_default_key_cache') || 'null');
    if (cache && Date.now() - cache.ts < 3600000) {
      if (cache.ok) _applyDefaultKey(cache);
      return;
    }

    const PROXY = (await import('./state.js')).PROXY;
    const res   = await fetch(
      `${PROXY}/default-key?guid=${encodeURIComponent(user.guid)}&registered_at=${encodeURIComponent(registeredAt)}`,
      { signal: AbortSignal.timeout(5000) }
    );
    const data  = await res.json();

    // 캐시 저장
    localStorage.setItem('hondi_default_key_cache', JSON.stringify({ ...data, ts: Date.now() }));

    if (data.ok && data.key) {
      _applyDefaultKey(data);
    } else if (data.status === 'TRIAL_EXPIRED') {
      // 만료 배너 표시 (웹앱에서 처리)
      window._hondiTrialExpiredMsg = data.message;
      window.dispatchEvent(new CustomEvent('hondi:trial_expired', { detail: data }));
    }
  } catch (e) {
    console.info('[DefaultKey] fetch 실패 (무시):', e.message);
  }
}

function _applyDefaultKey({ provider, model, key }) {
  // CFG.providers에 임시 주입 (localStorage 저장 안 함 — 매 세션 fetch)
  const entry = {
    provider,
    baseUrl:  _providerBaseUrl(provider),
    model:    model || _providerDefaultModel(provider),
    apiKey:   key,
    isProxy:  false,
    priority: 0,
    _isDefault: true,  // 구분 플래그
  };
  // 기존에 _isDefault 항목이 있으면 교체, 없으면 앞에 추가
  const existing = Array.isArray(CFG.providers) ? CFG.providers : [];
  CFG.providers = [entry, ...existing.filter(p => !p._isDefault)];
  setAiActive(true);
  console.info('[DefaultKey] 디폴트 키 적용:', provider, model);
}

function _providerBaseUrl(provider) {
  const map = {
    openrouter: 'https://openrouter.ai/api/v1',
    anthropic:  'https://api.anthropic.com/v1',
    openai:     'https://api.openai.com/v1',
    gemini:     'https://generativelanguage.googleapis.com/v1beta',
    deepseek:   'https://api.deepseek.com',
    grok:       'https://api.x.ai/v1',
  };
  return map[provider] || 'https://openrouter.ai/api/v1';
}

function _providerDefaultModel(provider) {
  const map = {
    openrouter: 'deepseek/deepseek-v4-flash',
    anthropic:  'claude-haiku-4-5-20251001',
    openai:     'gpt-4o-mini',
    gemini:     'gemini-2.5-flash-preview-05-20',
    deepseek:   'deepseek-v4-flash',
    grok:       'grok-3-mini',
  };
  return map[provider] || 'deepseek/deepseek-v4-flash';
}

// ── 모델 비전 지원 여부 ───────────────────────────────────
// 2026-06-24: ai-setup-mobile.html에 추가된 현행 모델 ID들을 반영.
// 레거시 ID(구버전 사용자가 이미 등록해둔 값)도 하위호환으로 그대로 둔다.
// DeepSeek V4(Flash/Pro)는 비전 미지원으로 알려져 있어 포함하지 않음.
export const VISION_MODELS = new Set([
  // Claude
  'claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-7',
  'claude-sonnet-4-20250514', 'claude-opus-4-20250514', // 레거시
  // Gemini (전 모델 멀티모달 기본 지원)
  'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.1-pro',
  'gemini-2.0-flash', 'gemini-1.5-pro', // 레거시(단종)
  // OpenAI
  'gpt-5.4', 'gpt-5.4-nano', 'gpt-5.5',
  'gpt-4o', 'gpt-4o-mini', // 레거시
  // xAI
  'grok-4.1-fast', 'grok-4.3',
  // DeepSeek (V4부터 비전 지원 — 이전엔 deepseek-chat(V3)만 가능했음)
  'deepseek-v4-flash', 'deepseek-v4-pro',
  // 레거시 — 2026-07-24 폐기 예정(deepseek-v4-flash로 자동 변환됨, MODEL_MIGRATION 참고)
  'deepseek-chat',
]);

export function _modelSupportsVision(model) {
  return VISION_MODELS.has(model);
}


// ── Personal Assistant / 그림자 SP 로더 ─────────────────────────────
// 설계 원칙(2026-06-22 합의):
//   1) 그림자(_ai)가 존재하면: Worker에서 그 Profile을 fresh fetch → system_prompt 사용
//      (profile.html이 B의 Profile에서 system_prompt를 가져오는 것과 동일한 메커니즘)
//   2) 그림자 없음(온보딩 미완료): manifest['profile-assistant'] 키로 최신 SP 로드
// 영구 localStorage 캐시 제거 — 매 세션 fresh fetch로 통일(갱신 자동 반영)
// ※ 버전 갱신 시 SP 파일 추가 후 git push — CI가 manifest를 자동 갱신
// SP 파일명은 sp-catalog.json['profile-assistant'] 에서 결정
//   (2026-07-09: prompts/manifest.json → prompts/sp-catalog.json 개명, W-16)
// (2026-07-08: manifest 키를 'personal-assistant'→'profile-assistant'로
//  개명 — 프로필 작성 기능만 다루는 별도 SP로 분리됐다. 함수명
//  loadPersonalAssistantSP는 welcome.js 등 기존 호출부와의 호환을 위해
//  그대로 유지한다 — 내부에서 참조하는 manifest 키만 바뀐다.)
const _SP_BASE_CFG = '/prompts/';
const _PROXY_URL = 'https://hondi-proxy.tensor-city.workers.dev';
let _paSPLoaded = false;

// ※ 2026-07-27 확인 — 이 함수는 앱 부팅 시(gopang-app.js) 호출되지 않는다.
//   메인 채팅/AI 패널의 system은 항상 call-ai.js가 부팅 즉시 AGENT-COMMON을
//   로드해 고정한다(call-ai.js 3444행 부근 "PA 자동 로드 분기 제거" 참조) —
//   함수명만 보면 "온보딩 진입점"처럼 보이지만 실제 호출부는 welcome.js의
//   handleProfileSubmit() 성공 직후 단 한 곳뿐이다. 그 시점엔 profileDone·
//   handle이 이미 참이므로 아래 351행 폴백(manifest['profile-assistant'])은
//   "신규 가입자용 온보딩 SP 로드"가 아니라 "본인 system_prompt fetch 두
//   번(본인/레거시 그림자)이 전부 실패했을 때의 네트워크 안전망"으로만
//   동작한다 — 실제로 도달할 일이 거의 없지만 완전히 죽은 코드는 아니다.
export async function loadPersonalAssistantSP() {
  if (_paSPLoaded) return CFG.system;

  const profileDone = _profileDone();
  const handle = _USER?.handle || null;

  if (profileDone && handle) {
    const cleanHandle = handle.replace(/^@/, '');

    // 2026-07-01: internal/public 두 변형을 가입 시 미리 컴파일해 따로
    // 저장하던 방식을 폐기 — system_prompt는 이제 단 하나뿐이고, 운영자/
    // 고객 공개범위 구분은 대화 시작 시 핸드셰이크(welcome.js의
    // verifyOwnerHandshake → GET /profile/verify-owner)에서 실시간으로
    // 판단한다. 그래서 여기선 그냥 본인 공개 행에서 바로 읽는다.
    try {
      const res = await fetch(`${_PROXY_URL}/profile/@${encodeURIComponent(cleanHandle)}`, { cache: 'no-cache' });
      if (res.ok) {
        const data = await res.json();
        const sp = data?.profile?.extra?.public?.ai_assistant?.system_prompt;
        if (sp && sp.length > 200) {
          CFG.system = sp;
          CFG.system_base = sp;
          _paSPLoaded = true;
          console.info('[SP] 본인 system_prompt 로드 완료:', sp.length, 'chars');
          return CFG.system;
        }
      }
    } catch (e) {
      console.warn('[SP] 본인 공개 SP 로드 실패 — 폴백:', e.message);
    }

    // 레거시 안전망 — 2026-06-30 이전에 생성된 기관용 그림자(@handle_ai)가
    // 아직 남아있는 계정 대비. 새 가입자에게는 해당 없음(더 이상 생성 안 함).
    try {
      const agentHandle = `${cleanHandle}_ai`;
      const res = await fetch(`${_PROXY_URL}/profile/@${encodeURIComponent(agentHandle)}`, { cache: 'no-cache' });
      if (res.ok) {
        const data = await res.json();
        const sp = data?.profile?.extra?.public?.ai_assistant?.system_prompt;
        if (sp && sp.length > 200) {
          CFG.system = sp;
          CFG.system_base = sp;
          _paSPLoaded = true;
          console.info('[SP] 레거시 그림자 system_prompt 로드 완료:', agentHandle, sp.length, 'chars');
          return CFG.system;
        }
      }
    } catch (e) {
      console.warn('[SP] 레거시 그림자 SP 로드 실패 — 폴백:', e.message);
    }
  }

  // 4) 폴백: sp-catalog.json['profile-assistant'] 키로 버전 결정 후 온보딩 SP 로드
  //    (2026-07-09: prompts/manifest.json → prompts/sp-catalog.json 개명, W-16)
  //    (*-LATEST.txt 포인터 방식은 폐기됨 — manifest 단일 체계로 통일)
  //    localStorage 영구 캐시 금지 — 항상 fresh fetch (그림자가 생기면 자동 전환됨)
  try {
    const manifestRes = await fetch(_SP_BASE_CFG + 'sp-catalog.json', { cache: 'no-cache' });
    if (!manifestRes.ok) throw new Error('manifest fetch 실패: ' + manifestRes.status);
    const manifest = await manifestRes.json();
    const fname = manifest['profile-assistant'];
    if (!fname) throw new Error('manifest 에 profile-assistant 키 없음');
    const res = await fetch(_SP_BASE_CFG + fname, { cache: 'no-cache' });
    if (res.ok) {
      let sp = await res.text();
      if (sp && sp.length > 200) {
        // 2026-07-27 신설 — HONDI-CAPABILITIES-COMMON(§DIGITAL-BRIDGE가
        // 참조하는 "나비가 지금 실제로 할 수 있는 것" 단일 소스) 합성.
        // PA SP 안에 이 목록을 프로즈로 직접 박아두면, call-ai.js와
        // profile-assistant.html이 TEMPLATE_LOOKUP 태그를 놓고 따로
        // 갈라졌던 것과 같은 방식으로 이 문서도 SP 사본마다 조용히
        // 낡을 수 있다 — 단일 파일을 매 세션 fresh fetch해 앞에 붙이는
        // 것으로 그 위험을 없앤다(합성 실패해도 PA SP 자체 로드는
        // 막지 않는다 — 이 문서는 보강 정보이지 필수 골격이 아니다).
        try {
          const capFname = manifest['HONDI-CAPABILITIES-COMMON'];
          if (capFname) {
            const capRes = await fetch(_SP_BASE_CFG + capFname, { cache: 'no-cache' });
            if (capRes.ok) {
              const capText = await capRes.text();
              if (capText && capText.length > 100) {
                sp = capText + '\n\n---\n\n' + sp;
                console.info('[SP] HONDI-CAPABILITIES-COMMON 합성 완료:', capFname, capText.length, 'chars');
              }
            } else {
              console.warn('[SP] HONDI-CAPABILITIES-COMMON fetch 실패(무시, PA SP는 정상 로드):', capRes.status);
            }
          }
        } catch (e) {
          console.warn('[SP] HONDI-CAPABILITIES-COMMON 합성 오류(무시, PA SP는 정상 로드):', e.message);
        }
        CFG.system = sp;
        CFG.system_base = sp;
        // ※ 이전엔 여기서 미선언 변수 latestFile을 참조해 ReferenceError가 났음
        //   (catch에 잡혀 "SP 로드 실패"로 오인되는 로그가 남았으나, 위에서
        //   CFG.system은 이미 정상적으로 설정된 뒤였음 — 동작엔 영향 없었지만
        //   디버깅을 방해했음). fname으로 정정.
        console.info('[SP] profile-assistant SP 로드 완료:', fname, sp.length, 'chars');
      }
    }
  } catch (e) {
    console.error('[SP] profile-assistant SP 로드 실패:', e.message);
  }
  _paSPLoaded = true;
  if (!CFG.system) {
    // 2026-07-05: 예전엔 여기서 조용히 빈 문자열(사실상 하드코딩 폴백)을
    // 반환했다. 이제 정본이 없으면 명확히 실패한다 — 유일한 호출부인
    // welcome.js가 이미 try/catch로 감싸고 있어 사용자에게 오류 버블을
    // 보여준다.
    throw new Error('profile-assistant SP를 어디서도 불러오지 못했습니다');
  }
  return CFG.system;
}

function _profileDone() {
  try { return !!localStorage.getItem('hondi_profile_done'); } catch { return false; }
}

/**
 * SP 로더 플래그 리셋 — PROFILE_SUBMIT 완료 직후 호출.
 * 이후 loadPersonalAssistantSP()를 다시 호출하면 그림자 SP를 fresh fetch한다.
 * 이렇게 하지 않으면 세션 내에 _paSPLoaded=true가 유지돼
 * 온보딩 SP가 평생 그대로 남는다.
 */
export function resetSPLoader() {
  _paSPLoaded = false;
}
