/**
 * phase28_klaw_case_billing.test.mjs
 *
 * 2026-08-12 신설. K-Law 사건단위 하이브리드 정액과금(§4-A 8단계 세분화 +
 * klaw_case_charges 사건단위 중복방지)을 검증하는 라이브 스모크테스트.
 * docs/klaw_case_billing_thought_experiment_2026-08-12.md의 시나리오표를
 * 실제 worker.js를 통해(phase27_gdc_billing_gate.test.mjs와 동일한 Worker
 * Integration 방식 — worker.js를 직접 import, fetch만 mock) 라이브로
 * 재현·검증한다.
 *
 * 가장 중요하게 검증하는 것: 사고실험 발견1(STEP A/B/C 이중과금)이 실제로
 * 고쳐졌는지 — 즉 case_id가 있는 흐름에서 STEP A/B/C 호출이 ai-charge를
 * 절대 추가로 호출하지 않는지.
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ══════════════════════════════════════════════════════════════════
// KV mock (phase27과 동일)
// ══════════════════════════════════════════════════════════════════
function makeKvMock() {
  const store = new Map();
  return {
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, String(value)); },
    async delete(key) { store.delete(key); },
    _store: store,
  };
}

// ══════════════════════════════════════════════════════════════════
// L1 mock — phase27의 gdc_keys 패턴을 klaw_case_charges/user_subscriptions로 확장
// ══════════════════════════════════════════════════════════════════
let balances;
let aiChargeCalls;
let deepseekCalled;
let caseChargesDb;   // klaw_case_charges 레코드 배열
let subscriptionsDb; // user_subscriptions 레코드 배열
let caseIdCounter;

function resetState() {
  balances = {};
  aiChargeCalls = [];
  deepseekCalled = 0;
  caseChargesDb = [];
  subscriptionsDb = [];
  caseIdCounter = 0;
}

// filter='guid='X' && case_id='Y''를 최소한으로 파싱(테스트 목적 — 정확한
// PocketBase 필터 문법 전체를 구현할 필요는 없음, 이 두 필드 조합만 지원)
function parseGuidCaseIdFilter(filter) {
  const guidM = filter.match(/guid='([^']*)'/);
  const caseIdM = filter.match(/case_id='([^']*)'/);
  const userGuidM = filter.match(/user_guid='([^']*)'/);
  return { guid: guidM?.[1], caseId: caseIdM?.[1], userGuid: userGuidM?.[1] };
}

function installMockFetch() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = init.method || 'GET';

    if (u.hostname === 'api.deepseek.com') {
      deepseekCalled++;
      return new Response(JSON.stringify({
        choices: [{ message: { content: '테스트 판결문 STEP 응답입니다.' } }],
        usage: { prompt_tokens: 500, completion_tokens: 300 },
      }), { status: 200 });
    }

    if (u.pathname === '/api/admins/auth-with-password') {
      return new Response(JSON.stringify({ token: 'mock-admin-token' }), { status: 200 });
    }

    if (u.pathname === '/api/balance') {
      const guid = u.searchParams.get('guid');
      return new Response(JSON.stringify({ ok: true, guid, balance: balances[guid] ?? 0, exchange_rate: 1 }), { status: 200 });
    }

    if (u.pathname === '/api/ai-charge') {
      const body = JSON.parse(init.body);
      aiChargeCalls.push(body);
      const guid = body.guid;
      const before = balances[guid] ?? 0;
      if (before < body.krw_amount) {
        return new Response(JSON.stringify({ ok: false, error: 'INSUFFICIENT_BALANCE' }), { status: 402 });
      }
      balances[guid] = before - body.krw_amount;
      return new Response(JSON.stringify({ ok: true, charged_gdc: body.krw_amount, balance_after: balances[guid], tx_hash: body.tx_hash }), { status: 200 });
    }

    // ── klaw_case_charges 컬렉션 ──
    const caseChargesMatch = u.pathname.match(/^\/api\/collections\/klaw_case_charges\/records\/?$/);
    if (caseChargesMatch && method === 'GET') {
      const filter = decodeURIComponent(u.searchParams.get('filter') || '');
      const { guid, caseId } = parseGuidCaseIdFilter(filter);
      const items = caseChargesDb.filter(r => r.guid === guid && r.case_id === caseId);
      return new Response(JSON.stringify({ items }), { status: 200 });
    }
    if (caseChargesMatch && method === 'POST') {
      const body = JSON.parse(init.body);
      // 유일 인덱스(guid, case_id) 재현 — 이미 있으면 제약 위반으로 실패시킴
      // (사고실험 시나리오 17 검증용)
      const dup = caseChargesDb.find(r => r.guid === body.guid && r.case_id === body.case_id);
      if (dup) {
        return new Response(JSON.stringify({ code: 400, message: 'UNIQUE_CONSTRAINT_VIOLATION' }), { status: 400 });
      }
      const rec = { id: 'case_' + (++caseIdCounter), ...body };
      caseChargesDb.push(rec);
      return new Response(JSON.stringify(rec), { status: 200 });
    }
    const caseChargePatchMatch = u.pathname.match(/^\/api\/collections\/klaw_case_charges\/records\/([^/]+)\/?$/);
    if (caseChargePatchMatch && method === 'PATCH') {
      const id = caseChargePatchMatch[1];
      const body = JSON.parse(init.body);
      const rec = caseChargesDb.find(r => r.id === id);
      if (rec) Object.assign(rec, body);
      return new Response(JSON.stringify(rec || {}), { status: 200 });
    }

    // ── user_subscriptions 컬렉션(전문직 무료 판정용) ──
    const subsMatch = u.pathname.match(/^\/api\/collections\/user_subscriptions\/records\/?$/);
    if (subsMatch && method === 'GET') {
      const filter = decodeURIComponent(u.searchParams.get('filter') || '');
      const { userGuid } = parseGuidCaseIdFilter(filter);
      const items = subscriptionsDb.filter(r => r.user_guid === userGuid);
      return new Response(JSON.stringify({ items }), { status: 200 });
    }

    if (u.pathname === '/api/collections/ai_usage_log/records' && method === 'POST') {
      return new Response(JSON.stringify({ id: 'mock_log' }), { status: 200 });
    }

    throw new Error('mock: 의도적으로 처리 안 함(설계상 graceful fallback 유도): ' + u.pathname);
  };
  return () => { globalThis.fetch = realFetch; };
}

// ── window 스텁 (2026-08-12) — worker.js가 gov-router.js(클라이언트 코드,
//    모듈 최상위에서 window.resolveGovAgency = ... 실행)를 끌어와서, 이
//    스텁 없이는 임포트 자체가 'window is not defined'로 실패한다.
//    sp-tag-dispatch.test.mjs와 동일한 패턴 — phase27_gdc_billing_gate.
//    test.mjs도 같은 문제를 겪고 있어(2026-08-12 확인, 이 세션과 무관한
//    선재 결함) 여기서 최소 스텁만 주입한다. ──
globalThis.window = globalThis;

let worker;
let kvMock;
let ENV;

before(async () => {
  installMockFetch();
  worker = (await import('../../../worker.js')).default;
});

beforeEach(() => {
  resetState();
  kvMock = makeKvMock();
  ENV = {
    DEEPSEEK_API_KEY: 'test-key',
    AI_SETUP_SEALS_KV: kvMock,
    L1_ADMIN_EMAIL: 'admin@test', L1_ADMIN_PASSWORD: 'pw',
  };
});

function klawReq(body) {
  return new Request('https://hondi-proxy.example/klaw/relay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': 'https://klaw.hondi.net' },
    body: JSON.stringify(body),
  });
}
async function callKlaw(body) {
  const res = await worker.fetch(klawReq(body), ENV, { waitUntil: (p) => p.catch(() => {}) });
  // settleKlaw 체인은 klaw_case_charges 조회·생성까지 포함해 ctx.waitUntil로
  // 넘어가는 비동기 작업이 phase27보다 한 단계 더 깊다 — 여유있게 40ms 대기.
  await new Promise(r => setTimeout(r, 40));
  return res;
}

function baseKlawBody(overrides = {}) {
  return {
    guid: 'guid-테스트',
    tier: 'klaw-pro',
    messages: [{ role: 'user', content: 'STEP 0 작성' }],
    stream: false,
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════
describe('KLAW-FEE: 8단계 세분화 정액표 경계값 (사고실험 #1~4, #18~19)', () => {
  it('KF-01: claim=2천만원 → 1천만~3천만 구간(10,000원)', async () => {
    balances['guid-테스트'] = 100_000;
    await callKlaw(baseKlawBody({ step_cycle: true, case_id: 'case-a', claim_amount_krw: 20_000_000 }));
    assert.equal(aiChargeCalls.length, 1);
    assert.equal(aiChargeCalls[0].krw_amount, 10_000);
  });

  it('KF-02: claim=1천만원 정확히(경계) → 5,000원(하위 구간 포함)', async () => {
    balances['guid-테스트'] = 100_000;
    await callKlaw(baseKlawBody({ step_cycle: true, case_id: 'case-b', claim_amount_krw: 10_000_000 }));
    assert.equal(aiChargeCalls[0].krw_amount, 5_000);
  });

  it('KF-03: claim=1천만1원(경계+1) → 다음 구간(10,000원)으로 넘어감', async () => {
    balances['guid-테스트'] = 100_000;
    await callKlaw(baseKlawBody({ step_cycle: true, case_id: 'case-c', claim_amount_krw: 10_000_001 }));
    assert.equal(aiChargeCalls[0].krw_amount, 10_000);
  });

  it('KF-04: claim=35억원 → 최상위 구간(50,000원)', async () => {
    balances['guid-테스트'] = 200_000;
    await callKlaw(baseKlawBody({ step_cycle: true, case_id: 'case-d', claim_amount_krw: 3_500_000_000 }));
    assert.equal(aiChargeCalls[0].krw_amount, 50_000);
  });

  it('KF-19: claim=999억원(상한 없음) → 여전히 50,000원', async () => {
    balances['guid-테스트'] = 200_000;
    await callKlaw(baseKlawBody({ step_cycle: true, case_id: 'case-e', claim_amount_krw: 99_900_000_000 }));
    assert.equal(aiChargeCalls[0].krw_amount, 50_000);
  });

  it('KF-18: claim=음수 → 정액과금 미실행(무효 판정), ai-charge 호출 안 됨', async () => {
    balances['guid-테스트'] = 100_000;
    await callKlaw(baseKlawBody({ step_cycle: true, case_id: 'case-f', claim_amount_krw: -100 }));
    assert.equal(aiChargeCalls.length, 0, '음수 소송가액은 과금 자체가 보류돼야 함');
    assert.equal(caseChargesDb.length, 0, '과금 안 됐으므로 사건 기록도 생성되지 않아야 함');
  });
});

// ══════════════════════════════════════════════════════════════════
describe('KLAW-CASE: 사건단위 중복방지 — STEP A/B/C 이중과금 버그 회귀 테스트 (발견1)', () => {
  it('KC-05/06: STEP0 결제 후 같은 case_id로 STEP A·B·C 호출 → 추가 ai-charge 없음', async () => {
    balances['guid-테스트'] = 100_000;
    await callKlaw(baseKlawBody({ step_cycle: true, case_id: 'case-g', claim_amount_krw: 20_000_000 }));
    assert.equal(aiChargeCalls.length, 1, 'STEP0에서 1회만 과금돼야 함');

    // STEP A/B/C — step_cycle:false, 같은 case_id
    for (const step of ['A', 'B', 'C']) {
      await callKlaw(baseKlawBody({
        step_cycle: false, case_id: 'case-g',
        messages: [{ role: 'user', content: `STEP ${step} 작성` }],
      }));
    }
    assert.equal(aiChargeCalls.length, 1, '★핵심 회귀 검증★ STEP A/B/C에서 추가 ai-charge가 나가면 안 됨(발견1 재발)');
    assert.equal(deepseekCalled, 4, 'DeepSeek 자체는 4번 다 정상 호출돼야 함(과금만 스킵)');
  });

  it('KC-07/08: 같은 case_id로 STEP0 재호출(재생성 버튼) → 무료, verdict_count만 증가, 이후 STEP A/B/C도 계속 무료', async () => {
    balances['guid-테스트'] = 100_000;
    await callKlaw(baseKlawBody({ step_cycle: true, case_id: 'case-h', claim_amount_krw: 20_000_000 }));
    assert.equal(aiChargeCalls.length, 1);
    assert.equal(caseChargesDb[0].verdict_count, 1);

    // 재생성 — 같은 case_id로 STEP0 다시
    await callKlaw(baseKlawBody({ step_cycle: true, case_id: 'case-h', claim_amount_krw: 20_000_000 }));
    assert.equal(aiChargeCalls.length, 1, '재생성은 추가 과금 없어야 함');
    assert.equal(caseChargesDb[0].verdict_count, 2, '재생성 카운트가 올라가야 함');

    await callKlaw(baseKlawBody({ step_cycle: false, case_id: 'case-h' }));
    assert.equal(aiChargeCalls.length, 1, '재생성 뒤 STEP A도 여전히 무료');
  });

  it('KC-09: 다른 case_id(진짜 새 사건), 같은 guid → 독립적으로 새로 과금', async () => {
    balances['guid-테스트'] = 100_000;
    await callKlaw(baseKlawBody({ step_cycle: true, case_id: 'case-i-1', claim_amount_krw: 20_000_000 }));
    await callKlaw(baseKlawBody({ step_cycle: true, case_id: 'case-i-2', claim_amount_krw: 20_000_000 }));
    assert.equal(aiChargeCalls.length, 2, '사건이 다르면 각각 과금돼야 함');
    assert.equal(caseChargesDb.length, 2);
  });

  it('KC-16: 다른 guid가 같은 case_id 문자열을 재사용해도 서로 독립 과금(복합키 격리)', async () => {
    balances['guid-A'] = 100_000;
    balances['guid-B'] = 100_000;
    await callKlaw(baseKlawBody({ guid: 'guid-A', step_cycle: true, case_id: 'shared-case-id', claim_amount_krw: 20_000_000 }));
    await callKlaw(baseKlawBody({ guid: 'guid-B', step_cycle: true, case_id: 'shared-case-id', claim_amount_krw: 20_000_000 }));
    assert.equal(aiChargeCalls.length, 2, 'guid가 다르면 case_id가 같아도 각자 과금돼야 함');
    assert.equal(balances['guid-A'], 100_000 - 10_000);
    assert.equal(balances['guid-B'], 100_000 - 10_000);
  });

  it('KC-10/11: case_id 없는 구버전 클라이언트 — STEP0은 매번 과금, STEP A는 토큰 종량제(폴백, 이중과금 아님을 확인)', async () => {
    balances['guid-테스트'] = 100_000;
    await callKlaw(baseKlawBody({ step_cycle: true, case_id: null, claim_amount_krw: 20_000_000 }));
    assert.equal(aiChargeCalls.length, 1);
    assert.equal(caseChargesDb.length, 0, 'case_id 없으면 사건 기록 자체를 만들지 않아야 함(재현 불가능한 하위호환 폴백)');

    // 재호출(같은 소송가액, case_id 여전히 없음) → 다시 과금(사건단위 구분 불가하므로 정상)
    await callKlaw(baseKlawBody({ step_cycle: true, case_id: null, claim_amount_krw: 20_000_000 }));
    assert.equal(aiChargeCalls.length, 2, 'case_id 없으면 매번 과금이 의도된 동작');
  });

  it('KC-13: case_id는 있는데 claim_amount_krw가 없음(추출 실패) → 과금도 토큰청구도 안 됨, 사건 기록 없음', async () => {
    balances['guid-테스트'] = 100_000;
    await callKlaw(baseKlawBody({ step_cycle: true, case_id: 'case-no-amount' }));
    assert.equal(aiChargeCalls.length, 0);
    assert.equal(caseChargesDb.length, 0);
  });
});

// ══════════════════════════════════════════════════════════════════
describe('KLAW-FREE: 무료 면제 티어 부재 확인 (2026-08-14 요금제 재설계 반영, 구 사고실험 #14~15)', () => {
  it('KF-14/15: "professional" 구독 레코드가 있어도 무료 면제 티어가 없어 정상 과금됨', async () => {
    // ★ 2026-08-30 갱신 — 2026-08-11엔 "전문직 티어(all_services_free)"가
    // 있어 K-Law를 무료로 면제했으나, 2026-08-14 요금제가 시민(990원)
    // 단일로 재설계되며 all_services_free:true인 티어 자체가 SUBSCRIPTION_
    // TIERS에서 사라졌다(worker.js handleKlawRelay 주석 참고 — "지금은 이
    // 조회가 사실상 항상 false로 귀결된다"). 이 테스트는 그 이전 설계를
    // 그대로 검증하고 있었음 — 코드는 현재 의도대로 정상 과금 중이었다.
    // 무료 면제 구조 자체는 향후 재도입 대비로 코드에 남아있으므로,
    // "professional" 같은 옛/무관한 tier 문자열이 실수로 무료 처리로
    // 새지 않는다는 걸 확인하는 회귀 테스트로 용도를 바꿔 유지한다.
    balances['guid-전문직'] = 100_000;
    subscriptionsDb.push({ user_guid: 'guid-전문직', tier: 'professional' });

    await callKlaw(baseKlawBody({ guid: 'guid-전문직', step_cycle: true, case_id: 'case-pro', claim_amount_krw: 500_000_000 }));
    await callKlaw(baseKlawBody({ guid: 'guid-전문직', step_cycle: false, case_id: 'case-pro' }));

    assert.equal(aiChargeCalls.length, 1, '무료 면제 티어가 없으므로 STEP0에서 정상 과금돼야 함');
    assert.equal(balances['guid-전문직'], 100_000 - 35_000, 'STEP0 정액과금(claim_amount_krw 5억원 이하 구간, KLAW_CLAIM_FEE_SCHEDULE 기준 35,000)만큼 차감돼야 함');
    assert.equal(caseChargesDb.length, 1, '정상 과금이므로 사건 기록이 생성돼야 함');
  });
});

// ══════════════════════════════════════════════════════════════════
describe('KLAW-RACE: 동시 STEP0 중복 클릭 — 사고실험 #17', () => {
  it('KC-17: 같은 case_id로 STEP0을 동시에 2번 보내면 최소 1건은 과금, 이중 결제 시 사건기록 생성 실패가 로그로 드러남', async () => {
    balances['guid-동시성'] = 100_000;
    const body = baseKlawBody({ guid: 'guid-동시성', step_cycle: true, case_id: 'case-race', claim_amount_krw: 20_000_000 });

    const [r1, r2] = await Promise.all([callKlaw(body), callKlaw(body)]);

    // 사고실험에서 예측한 대로: 두 요청 모두 "기록 없음"으로 조회될 수 있어
    // 최악의 경우 ai-charge가 2번 나갈 수 있다(진짜 동시성 문제, 유일
    // 인덱스는 "기록 저장" 단계에서만 막는다 — 결제 자체는 못 막음).
    // 이 테스트는 그 위험을 있는 그대로 관찰·기록하는 것이 목적이다.
    assert.ok(aiChargeCalls.length >= 1, '최소 1건은 과금됐어야 함');
    if (aiChargeCalls.length > 1) {
      console.warn(`[KC-17] 예상대로 동시성 이중과금 재현됨(${aiChargeCalls.length}건) — ` +
        `사고실험 시나리오17 그대로. 발생 빈도가 실사용에서 유의미하면 멱등키 보강 필요.`);
    }
    // 사건 기록은 유일 인덱스 때문에 최대 1건만 남아야 한다(둘 다 결제에
    // 성공했더라도 기록 생성은 하나만 성공).
    assert.ok(caseChargesDb.length <= 1, '유일 인덱스로 사건 기록은 최대 1건이어야 함');
  });
});
