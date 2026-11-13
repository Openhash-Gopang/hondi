/**
 * ui/welcome.js — PROFILE_SUBMIT 처리 + PDV 초기화 + 본인 검증 헬퍼
 *
 * v1.6 — "가입 직후 PA가 자동으로 끼어든다"는 기존 설계를 폐기했다.
 * 이제 첫 대화의 이름짓기·프로필 작성 안내는 AGENT-COMMON이
 * call-ai.js의 _buildFirstContactContext()를 통해 직접 처리하고,
 * "프로필 작성"은 설정 화면에서 사용자가 자유 텍스트를 입력해 직접
 * 시작하는 별도 흐름이다(settings.js의 openProfileComposer() 참조).
 * 이 파일은 더 이상 온보딩을 트리거하지 않는다 — PROFILE_SUBMIT 처리와
 * PDV 초기화, 핸드셰이크 본인 검증 헬퍼만 남는다.
 */
import { appendBubble } from './bubble.js';
import { _USER } from '../core/state.js';
import { loadPersonalAssistantSP, resetSPLoader } from '../core/config.js';
import { _recordPDV } from '../pdv/record.js';
import { validateJobKsco } from '../profile2.0/ksco-lookup.js';

// ── 초기 환영 메시지 — 더 이상 아무 일도 하지 않음 (v1.6) ──────────
// gopang-app.js가 부팅 시 호출하는 기존 진입점과의 호환을 위해 함수
// 자체는 남겨둔다. PA 자동 트리거(window._aiPanelOnboardingMsg 설정,
// openAIPanel() 강제 호출)는 전부 삭제했다 — 이제 "나만의 AI 비서"는
// 항상 AGENT-COMMON으로 시작하고, 프로필 작성은 설정에서 사용자가
// 명시적으로 시작한다.
let _welcomeShown = false;
export async function _showWelcomeMessage() {
  if (_welcomeShown) return;   // 중복 호출 방지
  _welcomeShown = true;
}

// ── PROFILE_SUBMIT 파서 ───────────────────────────────────
// call-ai.js의 응답에서 PROFILE_SUBMIT {...} 블록을 감지하여
// Worker에 POST하고 IndexedDB PDV를 초기화
export async function handleProfileSubmit(aiResponseText, extraFields = {}) {
  // 2026-0X-XX 수정 — 원래 단일 정규식(첫 매치, non-greedy)이었는데,
  // PROFILE_SUBMIT 재시도 안전장치의 [INTERNAL: ... PROFILE_SUBMIT { ... }
  // 태그가 빠져서...] 지시문 자체를 모델이 그대로 에코(반복 출력)하는
  // 경우가 실측 확인됐다(하네스 #92 재현) — 그 안내문 안의 예시
  // "PROFILE_SUBMIT { ... }"가 먼저 걸려 진짜 JSON(그 뒤에 옴)까지 통째로
  // 삼켜버리고 파싱에 실패했다. "PROFILE_SUBMIT" 뒤 '{' 시작 위치를 전부
  // 찾아 마지막 것부터 역순으로 중괄호 균형 매칭 + JSON.parse를 시도,
  // 처음으로 성공하는 결과를 채택한다(진짜 최종 응답이 항상 안내문보다
  // 뒤에 오므로).
  const _starts = [];
  const _re = /PROFILE_SUBMIT\s*(?=\{)/g;
  let _m;
  while ((_m = _re.exec(aiResponseText)) !== null) {
    _starts.push(_m.index + _m[0].length);
  }
  let profile = null;
  for (let si = _starts.length - 1; si >= 0; si--) {
    const raw = aiResponseText.slice(_starts[si]);
    let depth = 0, end = null;
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === '{') depth++;
      else if (raw[i] === '}') {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    if (end === null) continue;
    try {
      profile = JSON.parse(raw.slice(0, end));
      break;
    } catch (e) {
      continue; // 이 후보는 실패 — 더 앞쪽(더 이른) 후보로 계속 시도
    }
  }
  if (!profile) {
    console.warn('[Profile] PROFILE_SUBMIT JSON 파싱 실패: 유효한 JSON 후보를 찾지 못함');
    return false;
  }

  // 2026-0X-XX 신설 — 호출부(profile-assistant.html의 §ESCALATE-TO-PRO
  // (c)패턴)가 "이 프로필은 반드시 이 entity_type이어야 한다"고 이미
  // 확신하는 경우, LLM이 뭐라고 냈든 코드가 사후에 강제한다. 프롬프트
  // 지시문 주입까지 해도 모델이 여전히 틀릴 위험을 배제할 수 없어서
  // (사물이 실제로 상거래를 다루면 모델이 "이건 사업체다"로 되돌아가려는
  // 경향이 강함 — 라이브 스모크테스트 실측), 최종 저장 직전 이 지점에서
  // 한 번 더 못박는다. job_ksco 검증(아래)보다 먼저 실행해야 entity_type
  // 변경이 job_ksco 제거 판단에도 정확히 반영된다.
  if (extraFields.forceEntityType && profile.entity_type !== extraFields.forceEntityType) {
    console.warn('[Profile] entity_type 강제 오버라이드:', profile.entity_type, '->', extraFields.forceEntityType);
    profile.entity_type = extraFields.forceEntityType;
    if (extraFields.forceEntityType === 'thing' || extraFields.forceEntityType === 'concept') {
      // thing/concept은 결제를 직접 받는 주체가 아니다(worker.js
      // handleProfilePost의 동일 원칙 서버 강제와 이중 안전망 — patch M).
      profile.gdc_accepted = false;
      delete profile.payout_account;
    }
  }

  // 2026-07-13 신설(AC-AUTHOR_v1_0.md §3-1) — job_ksco는 entity_type이
  // person일 때만 의미가 있고, LLM이 제안한 code/label을 실제 KSCO
  // 데이터(data/ksco_2024_v8.json)로 한 번 더 대조한다 — U2(불확실
  // 식별자 지어내지 않기)를 프롬프트 지침에만 맡기지 않고 코드로 강제.
  if (profile.entity_type === 'person' && profile.job_ksco) {
    try { profile.job_ksco = await validateJobKsco(profile.job_ksco); }
    catch (e) { console.warn('[Profile] job_ksco 검증 실패, 원본 유지:', e.message); }
  } else if (profile.entity_type !== 'person' && profile.job_ksco) {
    // §3-2: 사업자/기관에는 job_ksco 개념이 없다 — 잘못 채워졌으면 제거.
    delete profile.job_ksco;
  }

  // 사용자 GUID 주입
  const user = _USER || JSON.parse(localStorage.getItem('gopang_user_v4') || '{}');
  if (user?.ipv6) profile.guid = user.ipv6;
  if (user?.handle) profile.handle = profile.handle || user.handle;

  // 판매자 AI 비서 endpoint 설정 (사업자일 때)
  if (profile.entity_type === 'business' && profile.handle) {
    const ep = `https://market.naviweb.kr/webapp.html?seller=${profile.handle}`;
    const aiCfg = profile.extra?.public?.ai_assistant;
    if (aiCfg) {
      aiCfg.seller_ai_endpoint = ep;
      aiCfg.seller_guid = profile.guid || '';
    }
  }

  // industry_fields.schema_id 정규화 (2026-07-27 버그 수정) — profile-assistant SP는
  // PROFILE_SUBMIT 최상위에 schema_id(KSIC)를 실어 보내는데, worker.js
  // handleProfilePost()는 industry_fields.schema_id만 검증·저장한다(최상위
  // schema_id는 구조분해 목록에도 없어 조용히 버려짐). 게다가 STEP3B(예약
  // 수락 여부)가 person을 제외한 모든 entity_type에 무조건 실행되며
  // industry_fields.reservation_config를 항상 채우므로, industry_fields가
  // non-null인데 그 안에 schema_id가 없어 서버가 400 INVALID_SCHEMA_ID로
  // 저장 자체를 거부하는 상태였다(entity_type≠person 전수 재현 — 100건
  // 사고실험 결과 §0 참조). _forwardProductsToMarket()의 /biz/catalog/sync
  // 요청에는 이미 있던 것과 동일한 정규화를 여기 /profile 요청에도 추가한다.
  if (profile.entity_type !== 'person' && profile.schema_id != null) {
    const sid = String(profile.schema_id);
    if (/^\d{2}$/.test(sid)) {
      profile.industry_fields = { ...(profile.industry_fields || {}), schema_id: sid };
    } else {
      console.warn('[Profile] schema_id 형식 불일치, industry_fields 병합 생략:', sid);
    }
  }

  const PROXY = 'https://hondi-proxy.tensor-city.workers.dev';

  // 프로필 사진(avatar_url/photo_urls) 병합 (2026-07-27 신설) — PA는
  // PROFILE_SUBMIT 스키마에 이 필드를 애초에 정의하지 않는다(사진 URL은
  // /profile/photo-upload 응답값이라 LLM이 알 수 없는 값 — schema_id
  // 정규화와 동일한 이유로 클라이언트가 대신 채워 넣는다). 호출자가 값을
  // 안 넘겼으면(extraFields 미사용 호출부) 이 블록은 아무 영향 없음 —
  // profile에 이미 없는 필드를 새로 추가하지 않는다.
  if (extraFields.avatar_url) profile.avatar_url = extraFields.avatar_url;
  if (Array.isArray(extraFields.photo_urls) && extraFields.photo_urls.length) {
    profile.photo_urls = extraFields.photo_urls;
  }

  try {
    // ── Ed25519 서명 (2026-07-07 버그 수정) ──
    // worker.js의 handleProfilePost()는 v6.0(TOFU 복원)부터 pubkey·signature를
    // 필수로 요구하는데(서명 대상: `${guid}:${pubkey}:${ts}`,
    // _verifyEd25519Simple로 검증), 이 함수는 그 뒤로 한 번도 갱신되지 않아
    // 서명 없이 profile만 그대로 보내고 있었다 — 즉 지금까지 모든
    // PROFILE_SUBMIT이 서버에서 400 MISSING_FIELD(pubkey 필수)로 거부되고
    // 있었을 가능성이 높다(실사용 로그로 최종 확인 필요). gopangWallet이
    // 이미 이 오리진(hondi.net)에 떠 있으므로 auth.js의 verifyOwnerHandshake와
    // 동일한 패턴(signPayload)으로 서명해 함께 보낸다.
    const wallet = window.gopangWallet;
    if (!wallet?.signPayload || !wallet.publicKeyB64u) {
      throw new Error('지갑이 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.');
    }
    const ts = String(Math.floor(Date.now() / 1000));
    const pubkey = wallet.publicKeyB64u;
    const sigMsg = `${profile.guid}:${pubkey}:${ts}`;
    const signature = await wallet.signPayload(sigMsg);

    const res = await fetch(`${PROXY}/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...profile, pubkey, signature, ts }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.detail || data.error || 'Profile 등록 실패');

    // ── 완성 플래그 설정 ──
    localStorage.setItem('hondi_profile_done', '1');
    localStorage.removeItem('hondi_profile_step');
    console.info('[Profile] 등록 완료:', profile.handle);

    // ── SP 로더 리셋 — 다음 loadPersonalAssistantSP() 호출 시 SP fresh fetch ──
    // _paSPLoaded=true가 유지되면 온보딩 SP가 세션 내내 고정되는 버그 방지
    resetSPLoader();

    // 2026-07-01: 위임 인증서 서명 단계 제거. 별도 그림자 정체성(별도
    // guid·키쌍)을 더 이상 만들지 않으므로(worker.js _mergeAgentSP 참조),
    // "위임"이라는 개념 자체가 무의미해졌다 — 단일 정체성이고, 운영자
    // 본인인지는 핸드셰이크(GET /profile/verify-owner)로 실시간 확인한다.

    // ── PDV IndexedDB 사전 초기화 제거 (2026-07-07) ──
    // 예전엔 여기서 _initPDV()가 'hondi-pdv'라는 별도 IndexedDB를 열어
    // pdv_init 레코드 하나만 남겼다. 이 DB는 실제로는 profile.html의
    // _writeSellerPDV()([SELLER_PDV:] 태그 수신 시 판매자 매출 기록)가
    // 쓰는 저장소인데, 그쪽은 필요할 때 자체적으로 open()해서 스키마를
    // 만든다(IndexedDB onupgradeneeded는 스토어가 없으면 알아서 생성) —
    // 즉 여기서 미리 만들어 둘 필요가 없었다. 게다가 "이제 모든 대화와
    // 거래가 안전하게 기록됩니다"라는 안내 문구는 실제로는 대화 기록
    // (gopang_pdv_log/gopang_pdv_store)과 무관한 DB를 열어놓고 하는
    // 말이라 부정확했다. _writeSellerPDV()로 기록된 매출 데이터를 다시
    // 읽어서 보여주는 화면이 현재 어디에도 없다는 별도 문제가 있으니
    // (판매 내역 대시보드 부재), 그 기능이 실제로 필요할 때 profile.html
    // 쪽에서 다루기로 하고 이 사전 초기화 호출은 제거한다.

    // ── PA(personal-assistant)가 수집한 데이터를 PDV에 기록 (2026-07-07) ──
    // 이전에는 프로필이 /profile에만 등록되고 _recordPDV()를 한 번도
    // 거치지 않아 PDV 파이프라인(gopang_pdv_log → _buildPDVNote()가 매 턴
    // 컨텍스트에 넣는 최근 기록)에 전혀 반영되지 않았다. GWP/EXPERT/P2P가
    // 쓰는 것과 동일한 _recordPDV()를 그대로 재사용해, PA가 얻은 정보도
    // 같은 단일 경로로 기록되도록 한다.
    await _recordProfileToPDV(profile).catch(e =>
      console.warn('[Profile] PDV 기록 실패 (무시):', e.message)
    );

    // ── CA → Market 상품·서비스 전달 (2026-07-07 신설) ──
    // PA가 프로필 대화 중 파악한 상품(products_structured)이 있으면, 판매자가
    // market.hondi.net에서 SP-KMARKET과 처음부터 다시 대화하지 않아도 검색에
    // 뜨도록 이 자리에서(CA와 같은 오리진 = hondi.net) 곧바로 Market의
    // seller_products에 반영한다. mode='merge'로 보내 — CA는 이 판매자의
    // "전체" 카탈로그를 알지 못하므로(market 쪽에서 직접 등록한 상품이
    // 따로 있을 수 있음), 여기 없는 기존 상품을 실수로 지우지 않는다.
    await _forwardProductsToMarket(profile, wallet, pubkey).catch(e =>
      console.warn('[Profile] Market 상품 전달 실패 (무시):', e.message)
    );

    // ── 그림자 SP 즉시 로드 (플래그 리셋 직후) ──
    await loadPersonalAssistantSP();

    // 2026-07-13 변경 — boolean 대신 저장된 profile 객체를 반환한다.
    // 기존 호출부(call-ai.js, pages/profile-assistant.html) 둘 다 반환값을
    // 쓰지 않고 있어(grep으로 확인) 안전한 변경 — 호출자가 GWP_DONE
    // 요약을 만들 때 이 값을 그대로 재사용할 수 있게 하기 위함.
    return profile;
  } catch (e) {
    console.error('[Profile] 등록 오류:', e.message);
    appendBubble('ai', `⚠️ 프로필 등록 중 오류가 발생했습니다: ${e.message}\n잠시 후 다시 시도해 주세요.`);
    return false;
  }
}

// ── CA → Market 상품·서비스 전달 (2026-07-07 신설) ────────────────────
// PA가 [products_structured]로 파악한 개별 상품을 Market의 seller_products
// 스키마(name/desc/price/unit/category/stock/image_url/is_public)에 맞춰
// 그대로 /biz/catalog/sync에 넘긴다. 서명은 gopang-seller-catalog.js의
// _runSync()와 동일한 방식 — payload를 JSON.stringify한 바이트를 그대로
// 서명한다(worker.js의 _verifyEd25519가 시그니처만 떼고 나머지를 다시
// JSON.stringify해 대조하므로, 클라이언트가 보낼 객체와 서명 대상 객체의
// 키 순서가 반드시 같아야 한다 — 아래에서 한 객체(payload)를 만들고
// 그대로 서명 → {...payload, signature}로 전송하는 순서를 지킨다).
//
// entity_type이 'person'이면 상품이 있을 수 없으므로 호출하지 않는다.
// products_structured가 없으면(자유 텍스트만 있는 구버전 PA 응답 등)
// 아무 것도 보내지 않는다 — 잘못 파싱해서 억지로 구조화하지 않는다.
async function _forwardProductsToMarket(profile, wallet, pubkey) {
  if (profile.entity_type === 'person') return;
  const items = Array.isArray(profile.products_structured) ? profile.products_structured : [];
  if (!items.length) {
    console.info('[Catalog] products_structured 없음 — Market 전달 생략');
    return;
  }

  // 2026-07-07 수정(사고실험 #2): name이 없는 항목이 하나라도 섞이면 서버가
  // 배치 전체를 400으로 거부한다(handleCatalogSync의 for-loop 검증). 상품
  // 여러 개 중 하나가 LLM 환각 등으로 이름을 못 냈다고 나머지 정상 상품까지
  // 전부 버려지는 건 손해가 크므로, 클라이언트에서 미리 걸러 유효한 것만
  // 보낸다 — 서버는 여전히 최종 방어선(같은 검증)으로 남겨둔다.
  const validItems = items.filter(p => p && String(p.name || '').trim());
  const skipped = items.length - validItems.length;
  if (skipped > 0) {
    console.warn('[Catalog] name 누락 상품', skipped, '개 제외하고 전달');
  }
  if (!validItems.length) {
    console.info('[Catalog] 유효한 상품 없음 — Market 전달 생략');
    return;
  }

  const products = validItems.map(p => {
    const category = p.category || profile.entity_subtype || profile.schema_id || '';
    return {
      id: p.id || _slugifyProductName(p.name, category),
      name: p.name,
      desc: p.desc || '',
      price: typeof p.price === 'number' ? p.price : null,
      unit: p.unit || '',
      category,
      stock: p.stock || 'in',
      // 2026-07-13 신설 — GDC-재무제표-재고 연동 1단계. profile-assistant가
      // 사용자가 자발적으로 언급한 수량만 채워 보낸다(강제 질문 아님) —
      // worker.js handleCatalogSync가 이 값으로 legacy stock(위 필드)도
      // 자동 파생하므로 여기선 원본 그대로만 전달한다.
      stock_qty: typeof p.stock_qty === 'number' ? p.stock_qty : null,
      // 2026-07-13 신설 — GDC-재무제표-재고 연동 4단계(매출원가). 절대
      // 공개 카탈로그에 노출되지 않는다(worker.js handleCatalogGet에서
      // 명시 제외) — 원가는 사업자 본인만 봐야 하는 정보.
      cost_price: typeof p.cost_price === 'number' ? p.cost_price : null,
      image_url: p.image_url || '',
      is_public: p.is_public !== false,
      updated_at: new Date().toISOString(),
    };
  });

  // 2026-07-13 신설 — 상품 삭제 경로. mode는 여전히 'merge'로 고정
  // (이 세션이 판매자의 "전체" 카탈로그를 모르므로 'replace'는 여전히
  // 위험 — 다른 경로로 등록된 상품까지 지울 수 있음). 대신 사용자가
  // 명시적으로 "이제 안 팔아요"라고 말한 상품만 이름으로 정확히
  // 지정해 표적 삭제한다(handleCatalogSync가 deleted_names로 처리).
  const payload = {
    guid: profile.guid, pubkey, products, mode: 'merge',
    deleted_names: Array.isArray(profile.deleted_product_names) ? profile.deleted_product_names : [],
  };
  // industry_fields: PA가 KSIC 코드(schema_id)를 이미 판단해 뒀으면 실어
  // 보낸다. 2026-07-07 수정(사고실험 #3): 이전엔 "형식이 안 맞아도 서버가
  // 그 필드만 무시하고 동기화는 계속된다"고 설명했는데 이건 착각이었다 —
  // 실제로는 handleCatalogSync가 형식이 안 맞으면 요청 전체를 400으로
  // 거부한다. PA SP 어디에도 "정확히 숫자 2자리 문자열"이라는 형식이
  // 명시된 적이 없어 언제든 어긋날 수 있으므로, 여기서 미리 형식
  // (숫자 2자리)을 검증하고 안 맞으면 아예 생략한다 — 서버의
  // keyword_fallback(카테고리 키워드 매칭)에 업종 판단을 맡긴다.
  const sid = profile.schema_id != null ? String(profile.schema_id) : '';
  if (/^\d{2}$/.test(sid)) {
    payload.industry_fields = { schema_id: sid };
  } else if (sid) {
    console.warn('[Catalog] schema_id 형식 불일치, 생략(keyword_fallback에 위임):', sid);
  }

  const signature = await wallet.signPayload(JSON.stringify(payload));

  const res = await fetch('https://hondi-proxy.tensor-city.workers.dev/biz/catalog/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, signature }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    console.warn('[Catalog] Market 전달 실패:', data.detail || data.error || res.status);
    return;
  }
  console.info('[Catalog] Market 전달 완료 |', products.length, '개 상품 | mode: merge' +
    (data.occupation_updated ? ` | 업종 자동판단: ${data.occupation}` : ''));

  // ⚠️ 알려진 한계(2026-07-07): market.hondi.net은 별도 오리진이라 이 호출이
  // 그쪽의 로컬 IndexedDB(gopang_seller_catalog_v1)까지 갱신하지는 못한다.
  // 판매자가 나중에 market.hondi.net에서 자기 카탈로그를 직접 열어 로컬
  // 스냅샷을 다시 sync하면(그쪽은 mode 기본값 'replace'), 로컬에 없는
  // 이 상품들이 삭제될 수 있다 — 양쪽을 진짜 일관되게 유지하려면
  // gopang-seller-catalog.js의 hydrateFromServerIfEmpty()가 "로컬이
  // 비었을 때만"이 아니라 서버 쪽 최신 항목도 주기적으로 끌어오도록
  // 확장하는 별도 작업이 필요하다 — 이번 패치 범위 밖으로 남겨둔다.
}

// 2026-07-07 수정: id를 name(+category)만으로 결정적(deterministic)으로 생성한다.
// 이전엔 Date.now()를 섞어 매 제출마다 새 id가 나왔고, mode='merge'는 삭제를
// 하지 않으므로 판매자가 프로필을 재제출할 때마다(예: 가격 수정) Market에
// 같은 상품이 계속 쌓였다(중복 버그, 2026-07-07 사고실험 #1). name(+category)이
// 같으면 항상 같은 id를 만들어 upsert가 "같은 상품 갱신"으로 수렴하도록 한다.
// i(배열 인덱스)는 제외 — 인덱스는 재제출 시 순서가 바뀔 수 있어 오히려
// 결정성을 해친다. 같은 이름의 상품이 여러 개면(category까지 같음) 그건
// 실제로 하나로 합쳐지는 게 맞다고 보고 의도된 동작으로 남긴다.
function _slugifyProductName(name, category) {
  const norm = s => String(s || '').trim().toLowerCase()
    .replace(/\s+/g, '-').replace(/[^a-z0-9가-힣-]/g, '');
  const base = norm(name) || 'item';
  const cat  = norm(category);
  return cat ? `${base}--${cat}` : base;
}

// ── PA(personal-assistant) 수집 데이터 → PDV 기록 (2026-07-07 신설) ──────
// PA는 PDV를 직접 쓰지 않는다 — 수집한 데이터를 여기서 _recordPDV()로
// 넘기는 것이 유일한 경로다(AGENT-COMMON_v3_26.txt §2-2 원칙과 동일한
// 정신을 실제 코드에서는 "같은 탭이므로 함수 호출로 직접 넘긴다"는
// 형태로 구현한다 — 별도 탭이 아니므로 postMessage/큐가 필요 없다).
// 필드 하나하나를 6하원칙 관점(누가/언제/어디서/무엇을/어떻게/왜)으로
// 구조화해 개별 기록한다 — "프로필을 등록했다"는 사실 하나로 뭉치지 않는다.
async function _recordProfileToPDV(profile) {
  const now      = new Date().toISOString();
  const who      = profile.guid || profile.handle || null;
  const isBiz    = profile.entity_type && profile.entity_type !== 'person';
  const label    = profile.name || profile.nickname || '(이름 미상)';

  // ① 요약 레코드 — GWP_DONE/폴백 보고와 동일한 톤의 최상위 이벤트
  await _recordPDV({
    type:    'profile_registered',
    guid:    who,
    who,
    when:    now,
    where:   isBiz ? (profile.address || '미상') : '설정 → 프로필 작성',
    what:    isBiz
      ? `${label} 프로필 등록(${profile.entity_subtype || profile.schema_id || '업종 미상'})`
      : `개인 프로필 등록 — ${label}`,
    how:     'profile_assistant',
    why:     isBiz ? 'K-Market 등에서 검색·연결되기 위함' : '개인화된 응대를 위함',
    summary: isBiz
      ? `${label} 프로필 등록 완료`
      : `${label}님 개인 프로필 등록 완료`,
  });

  // ② 개별 필드 — 존재하는 것만, 6하원칙 taxonomy에 맞춰 분류
  const fieldRecords = [];
  if (profile.address) {
    fieldRecords.push({
      type: 'location', key: '주소', value: profile.address,
      summary: `${label}의 주소: ${profile.address}`.slice(0, 60),
    });
  }
  if (profile.phone) {
    fieldRecords.push({
      type: 'relation', key: '연락처', value: profile.phone,
      summary: `${label}의 연락처 등록`.slice(0, 60),
    });
  }
  if (profile.products) {
    fieldRecords.push({
      type: 'preference', key: '취급 상품·서비스', value: profile.products,
      summary: `${label} 취급 품목: ${profile.products}`.slice(0, 60),
    });
  }
  if (profile.entity_subtype || profile.schema_id) {
    fieldRecords.push({
      type: 'preference', key: '업종', value: profile.entity_subtype || profile.schema_id,
      summary: `${label} 업종: ${profile.entity_subtype || profile.schema_id}`.slice(0, 60),
    });
  }

  for (const f of fieldRecords) {
    await _recordPDV({
      type:    f.type,
      guid:    who,
      who,
      when:    now,
      where:   profile.address || '설정 → 프로필 작성',
      what:    `${f.key}: ${f.value}`,
      how:     'profile_assistant',
      why:     '프로필 작성 중 PA에게 직접 제공',
      summary: f.summary,
      data:    { field: f.key, value: f.value, data_source: profile.data_sources?.[f.key] || 'pa_dialogue' },
    });
  }

  console.info('[Profile] PDV 기록 완료 | 필드 수:', fieldRecords.length + 1);
}

// ── 본인 검증 헬퍼 (핸드셰이크 실시간 판단용) ────────────────────────
// 2026-07-01: 옛 _triggerDelegationSignature(위임 인증서 서명, 1회성)를
// 대체. 별도 그림자 정체성이 없어졌으므로 "위임"은 더 이상 의미가 없고,
// 대신 대화 시작 시(AGENT-COMMON §4 핸드셰이크) "지금 상대가 본인인지"를
// 그때그때 묻는다. gopang-wallet.js의 sign()/verify()와 동일한 서명
// 체계 — 전체 시스템이 서명 체계를 하나만 공유한다는 원칙을 그대로 따름.
// 호출부(call-ai.js 등)에서 AI가 [VERIFY_OWNER] 태그를 출력하면 이 함수를
// 불러 결과를 다시 AI에게 시스템 메시지로 전달하는 식으로 와이어링한다.
export async function verifyOwnerHandshake(principalGuid) {
  const PROXY = 'https://hondi-proxy.tensor-city.workers.dev';
  const wallet = window.gopangWallet;
  if (!wallet?.signPayload || typeof wallet.signPayload !== 'function') {
    console.warn('[Handshake] gopangWallet 미준비 — 본인 검증 불가, false 처리');
    return { verified: false, reason: 'WALLET_NOT_READY' };
  }

  const ts = String(Math.floor(Date.now() / 1000));
  const sigMsg    = `VERIFY-OWNER:${principalGuid}:${ts}`;
  const signature = await wallet.signPayload(sigMsg);
  const pubkey    = wallet.publicKeyB64u || wallet.publicKeyB64 || '';

  const qs = new URLSearchParams({ guid: principalGuid, pubkey, signature, ts });
  try {
    const res = await fetch(`${PROXY}/profile/verify-owner?${qs.toString()}`, { cache: 'no-cache' });
    const result = await res.json().catch(() => ({}));
    if (result.ok) {
      console.info('[Handshake] 본인 검증 결과:', result.verified);
      return { verified: !!result.verified, reason: result.reason || null };
    }
    console.warn('[Handshake] 서버 거부:', result.error, result.detail);
    return { verified: false, reason: result.error || 'SERVER_ERROR' };
  } catch (e) {
    console.warn('[Handshake] 본인 검증 요청 실패:', e.message);
    return { verified: false, reason: 'NETWORK_ERROR' };
  }
}
