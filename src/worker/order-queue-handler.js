// ═══════════════════════════════════════════════════════════
// src/worker/order-queue-handler.js — 주문 큐/주방 용량 판단
// ═══════════════════════════════════════════════════════════
// 2026-07-09 신설 — 짜장면 주문 사고실험 5·6번("지금 조리 가능한지·
// 주문을 받을 여력이 있는지", "조리시간 파악")을 메운다. ai-chat-
// handler.js의 buildSystemPrompt가 이미 명시적으로 "이 SP는 그걸
// 판단하지 않는다"고 선언해뒀던 바로 그 몫이다.
//
// ★ 의도적으로 LLM을 안 쓴다 — 용량 판단은 순수 산술(현재 큐 깊이 vs
// 설정된 최대 동시처리량)이라 굳이 LLM 호출 비용을 들일 이유가 없다.
// handleAiChat이 만든 priceOrderItems 결과(order)를 그대로 입력으로
// 받는다.
//
// 용량 설정은 profile.extra.max_concurrent_orders에 둔다(새 프로필
// 스키마 마이그레이션 없이 기존 extra JSON 필드 재사용 — ai-chat-
// handler.js가 extra.menu 대신 이제 extra.business_hours만 쓰듯,
// 같은 필드를 계속 확장해서 쓰는 게 이 저장소의 확립된 패턴이다).
// 값이 없으면 DEFAULT_CAPACITY로 폴백한다.
//
// 조리시간 추정은 base + 대기중_주문수 * per_order 라는 단순 선형
// 모델이다 — 실제 조리시간 예측은 훨씬 정교할 수 있지만(메뉴별 조리
// 난이도, 동시조리 가능 여부 등), 이번 범위에서는 "완전히 안 하는 것"
// 보다 "단순하지만 있는 것"이 낫다고 판단했다. extra.base_prep_minutes/
// extra.per_order_extra_minutes로 업체가 재정의할 수 있다.

const DEFAULT_CAPACITY = 5;
const DEFAULT_BASE_PREP_MINUTES = 15;
const DEFAULT_PER_ORDER_EXTRA_MINUTES = 5;

function estimatePrepMinutes(activeCount, profile) {
  const base = Number(profile?.extra?.base_prep_minutes) || DEFAULT_BASE_PREP_MINUTES;
  const perOrder = Number(profile?.extra?.per_order_extra_minutes) || DEFAULT_PER_ORDER_EXTRA_MINUTES;
  return base + activeCount * perOrder;
}

/**
 * POST /biz/order-queue — 이미 가격이 매겨진 주문(handleAiChat의 order
 * 필드)을 큐에 넣을지 판단한다. Ed25519+TOFU는 handleAiChat/handleEscalate
 * 와 동일 패턴을 그대로 쓴다.
 */
async function handleOrderQueue(request, env, corsHeaders, deps) {
  const { _err, _verifyEd25519, _l1FindProfileByGuid, _l1CountActiveOrders, _l1CreateOrderQueueEntry } = deps;

  let body;
  try { body = await request.json(); } catch {
    return _err(400, 'INVALID_JSON', '요청 본문이 올바르지 않습니다.', corsHeaders);
  }

  const { guid, pubkey, signature, target_guid, session_id = null, order } = body;
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  if (!pubkey) return _err(400, 'MISSING_FIELD', 'pubkey 필수', corsHeaders);
  if (!signature) return _err(400, 'MISSING_FIELD', 'signature 필수', corsHeaders);
  if (!target_guid) return _err(400, 'MISSING_FIELD', 'target_guid 필수', corsHeaders);
  if (!order || !Array.isArray(order.items) || !order.items.length) {
    return _err(400, 'MISSING_FIELD', 'order.items 필수(handleAiChat의 order 필드를 그대로 넘기세요)', corsHeaders);
  }
  if (order.unresolved && order.unresolved.length) {
    return _err(400, 'UNRESOLVED_ITEMS', `가격을 매길 수 없는 항목이 있습니다: ${order.unresolved.join(', ')}`, corsHeaders);
  }

  const sigOk = await _verifyEd25519(pubkey, signature, body);
  if (!sigOk) return _err(401, 'INVALID_SIGNATURE', '서명 검증 실패', corsHeaders);

  let callerRecord;
  try {
    callerRecord = await _l1FindProfileByGuid(env, guid);
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
  }
  if (!callerRecord) return _err(404, 'PROFILE_NOT_FOUND', '가입(L1 등록)이 먼저 완료되어야 합니다', corsHeaders);
  if (callerRecord.pubkey_ed25519 && callerRecord.pubkey_ed25519 !== pubkey) {
    return _err(401, 'PUBKEY_MISMATCH', '등록된 공개키와 일치하지 않습니다', corsHeaders);
  }

  let sellerProfile, activeCount;
  try {
    [sellerProfile, activeCount] = await Promise.all([
      _l1FindProfileByGuid(env, target_guid),
      _l1CountActiveOrders(env, target_guid),
    ]);
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패(대상): ' + e.message, corsHeaders);
  }
  if (!sellerProfile) return _err(404, 'TARGET_NOT_FOUND', '대상 프로필이 L1에 없습니다', corsHeaders);

  // ── 2026-07-12 신설 — SP-18 STEP3(미청구 프로필) 도입에 따른 필수 가드.
  // unclaimed 프로필은 실제 업체 관계자가 아직 아무도 서명하지 않은
  // "AI가 웹검색으로 확인만 한 잠정 정보"다. 검색 결과에 노출되는 것과
  // 거기에 돈을 보내도 되는 것은 완전히 다른 문제인데, 지금까지 이 둘을
  // 구분하는 코드가 여기 없었다 — 그대로 두면 "AI가 만든 가짜 업체
  // 프로필에 선입금 유도"라는 사기 벡터가 열린다(2026-07-12 100건
  // 사고실험 #95~96에서 지적). claimed 전환 전까지는 주문 자체를
  // 원천 차단한다 — 부분 허용(예: 소액만 허용)은 하지 않는다, 소유자가
  // 실존하는지 자체가 미확인 상태이기 때문.
  const sellerClaimStatus = sellerProfile.claim_status ?? sellerProfile.extra?.claim_status;
  if (sellerClaimStatus === 'unclaimed') {
    return new Response(JSON.stringify({
      ok: true, accepted: false, reason: 'SELLER_UNCLAIMED',
      message: '이 업체는 아직 나비 정식 가입자가 아니에요(AI가 검색으로 확인만 한 정보예요). ' +
        '주문·결제는 지원되지 않으니, 안내된 연락처로 직접 문의해 보시겠어요?',
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const capacity = Number(sellerProfile?.extra?.max_concurrent_orders) || DEFAULT_CAPACITY;

  if (activeCount >= capacity) {
    return new Response(JSON.stringify({
      ok: true, accepted: false, reason: 'CAPACITY_FULL',
      message: '죄송합니다, 지금 주문이 많아 접수가 어렵습니다. 잠시 후 다시 시도해 주세요.',
      active_count: activeCount, capacity,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const estimated_prep_minutes = estimatePrepMinutes(activeCount, sellerProfile);

  let record;
  try {
    record = await _l1CreateOrderQueueEntry(env, {
      seller_guid: target_guid,
      buyer_guid: guid,
      session_id,
      items: order.items,
      total: order.total,
      currency: order.currency || 'GDC',
      status: 'accepted',
      estimated_prep_minutes,
      queued_at: new Date().toISOString(),
    });
  } catch (e) {
    return _err(502, 'QUEUE_CREATE_FAILED', e.message, corsHeaders);
  }

  return new Response(JSON.stringify({
    ok: true, accepted: true, queue_id: record.id,
    position_in_queue: activeCount + 1, estimated_prep_minutes,
  }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

export { handleOrderQueue, estimatePrepMinutes, DEFAULT_CAPACITY, DEFAULT_BASE_PREP_MINUTES, DEFAULT_PER_ORDER_EXTRA_MINUTES };
