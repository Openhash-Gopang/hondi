import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// 2026-10-03 — GDC 필드테스터 이체·예치 한도(handleBizOrder 앞단) 회귀 테스트.
// 1) _gdcCheckTransferLimits 가 gdc 저장소의 한도 명세·기준 구현과 같은 결과를 내는지 시나리오로 대조
// 2) handleBizOrder 흐름에서 한도 위반 시 L1 /api/tx 가 호출되지 않는지, 비대상(일반 회원·카탈로그 구매)은 영향받지 않는지 확인

describe('_gdcCheckTransferLimits — gdc 저장소 시나리오와 일치', () => {
  let check, scenarios;
  before(async () => {
    global.fetch = async () => { throw new Error('이 테스트는 네트워크를 쓰지 않는다'); };
    ({ _gdcCheckTransferLimits: check } = await import('../worker.js?xl=' + Date.now()));
    const fx = JSON.parse(await readFile(new URL('./fixtures/gdc_transfer_limit_scenarios.json', import.meta.url), 'utf8'));
    scenarios = fx.scenarios;
  });
  test('시나리오가 충분히 들어 있다', () => assert.ok(scenarios.length >= 11, String(scenarios.length)));
  test('모든 transfer 시나리오의 결과 코드가 expected와 같다', () => {
    for (const s of scenarios) {
      const r = check(s.inputs);
      assert.equal(r.ok, s.expected.ok, s.id);
      assert.equal(r.code, s.expected.code, s.id);
    }
  });
});

describe('_gdcKstDayStartMs', () => {
  let f;
  before(async () => { ({ _gdcKstDayStartMs: f } = await import('../worker.js?kst=' + Date.now())); });
  test('KST 자정(= 전날 15:00 UTC)을 돌려준다', () => {
    assert.equal(new Date(f(Date.parse('2026-10-03T01:00:00Z'))).toISOString(), '2026-10-02T15:00:00.000Z');
    assert.equal(new Date(f(Date.parse('2026-10-03T14:59:59Z'))).toISOString(), '2026-10-02T15:00:00.000Z');
    assert.equal(new Date(f(Date.parse('2026-10-03T15:00:00Z'))).toISOString(), '2026-10-03T15:00:00.000Z');
  });
});

describe('handleBizOrder — 테스터 이체·예치 한도', () => {
  let handleBizOrder;
  let testers, blocks, failTesterLookup, failBlocks, blocksTotal, txCalls, blockUrls, products;
  const env = { L1_ADMIN_EMAIL: 'a', L1_ADMIN_PASSWORD: 'b' };
  const cors = {};
  const iso = (ms) => new Date(ms).toISOString().replace('T', ' ');

  before(async () => {
    global.fetch = async (url, opts) => {
      const u = decodeURIComponent(String(url));
      const method = opts?.method || 'GET';
      if (u.endsWith('/api/admins/auth-with-password')) return { ok: true, json: async () => ({ token: 't' }) };
      if (u.includes('/gdc_test_financial_statements/records')) {
        if (failTesterLookup) return { ok: false, status: 500, json: async () => ({}) };
        const g = u.match(/user_guid='([^']+)'/)?.[1];
        return { ok: true, json: async () => ({ items: testers.has(g) ? [{ user_guid: g }] : [] }) };
      }
      if (u.includes('/api/collections/blocks/records')) {
        blockUrls.push(u);
        if (failBlocks) return { ok: false, status: 500, json: async () => ({}) };
        return { ok: true, json: async () => ({ items: blocks, totalItems: blocksTotal ?? blocks.length }) };
      }
      if (u.includes('/seller_products/records')) return { ok: true, json: async () => ({ items: products }) };
      if (u.endsWith('/api/tx') && method === 'POST') {
        txCalls.push(JSON.parse(opts.body));
        return { ok: true, json: async () => ({ ok: false, error: 'INSUFFICIENT_BALANCE' }) }; // 한도 통과 후 여기까지 왔다는 신호
      }
      throw new Error('예상치 못한 fetch: ' + method + ' ' + u); // L3 홈노드 조회 등은 호출부가 catch 후 null 처리
    };
    ({ handleBizOrder } = await import('../worker.js?biz=' + Date.now()));
  });

  beforeEach(() => {
    testers = new Set(['tester1']); blocks = []; failTesterLookup = false; failBlocks = false;
    blocksTotal = undefined; txCalls = []; blockUrls = []; products = [];
  });

  async function order({ owner = 'tester1', from = owner, outputs, items = [], seller = outputs?.[0]?.recipient_guid || 'bob', net, fee = 0 }) {
    const body = {
      tx: { version: 1, input: { owner_guid: owner, prev_settle_hash: null, balance_claimed: 99999 }, outputs, items },
      tx_hash: 'h', buyer_sig: 's', buyer_public_key: 'k', from_guid: from, seller_guid: seller,
      seller_net: net ?? outputs.reduce((s, o) => s + o.amount, 0), fee,
    };
    const res = await handleBizOrder(new Request('https://x/biz/order', { method: 'POST', body: JSON.stringify(body) }), env, cors, {});
    return { status: res.status, data: await res.json() };
  }
  const priorTo = (guid, amount, ms = Date.now()) => ({ created: iso(ms), buyer_guid: 'tester1', outputs: JSON.stringify([{ recipient_guid: guid, amount }]) });

  test('테스터의 1회 상한(₮1,000) 초과 이체는 409 PER_TX_LIMIT — L1 호출 없음', async () => {
    blocks = [priorTo('bob', 10)];
    const { status, data } = await order({ outputs: [{ recipient_guid: 'bob', amount: 1001 }] });
    assert.equal(status, 409); assert.equal(data.error, 'PER_TX_LIMIT'); assert.equal(txCalls.length, 0);
  });

  test('상한과 같은 금액은 통과한다(L1까지 도달)', async () => {
    blocks = [priorTo('bob', 10)];
    const { status, data } = await order({ outputs: [{ recipient_guid: 'bob', amount: 1000 }] });
    assert.equal(status, 402); assert.equal(data.error, 'INSUFFICIENT_BALANCE'); assert.equal(txCalls.length, 1);
  });

  test('예금금고 예치도 같은 한도를 받는다 — 1,500은 거절, 1,000은 통과(금고는 신규 수취인 아님)', async () => {
    let r = await order({ outputs: [{ recipient_guid: 'gdc-deposit-vault', amount: 1500 }] });
    assert.equal(r.status, 409); assert.equal(r.data.error, 'PER_TX_LIMIT');
    r = await order({ outputs: [{ recipient_guid: 'gdc-deposit-vault', amount: 1000 }] });
    assert.equal(r.status, 402);
  });

  test('처음 보내는 수취인에게 ₮101은 409 NEW_RECIPIENT_LIMIT, ₮100은 통과', async () => {
    let r = await order({ outputs: [{ recipient_guid: 'newbie', amount: 101 }] });
    assert.equal(r.status, 409); assert.equal(r.data.error, 'NEW_RECIPIENT_LIMIT'); assert.equal(txCalls.length, 0);
    r = await order({ outputs: [{ recipient_guid: 'newbie', amount: 100 }] });
    assert.equal(r.status, 402);
  });

  test('이전에 보낸 적 있는 수취인에게는 신규 수취인 상한이 없다', async () => {
    blocks = [priorTo('bob', 5, Date.now() - 3 * 86400000)];
    const r = await order({ outputs: [{ recipient_guid: 'bob', amount: 900 }] });
    assert.equal(r.status, 402);
  });

  test('오늘 누적 1,500 + 600 = 2,100은 409 DAILY_LIMIT, 500(=2,000)은 통과', async () => {
    blocks = [priorTo('bob', 1500)];
    let r = await order({ outputs: [{ recipient_guid: 'bob', amount: 600 }] });
    assert.equal(r.status, 409); assert.equal(r.data.error, 'DAILY_LIMIT'); assert.equal(txCalls.length, 0);
    r = await order({ outputs: [{ recipient_guid: 'bob', amount: 500 }] });
    assert.equal(r.status, 402);
  });

  test('KST 어제 이전의 거래는 오늘 누적에 포함되지 않는다', async () => {
    blocks = [priorTo('bob', 1900, Date.now() - 36 * 3600 * 1000)];
    const r = await order({ outputs: [{ recipient_guid: 'bob', amount: 1000 }] });
    assert.equal(r.status, 402);
  });

  test('이력 조회는 ai_usage_charge 블록을 제외하는 필터를 쓴다', async () => {
    await order({ outputs: [{ recipient_guid: 'bob', amount: 10 }] });
    assert.ok(blockUrls.some(u => u.includes("block_type!='ai_usage_charge'") && u.includes("buyer_guid='tester1'")), blockUrls.join('\n'));
  });

  test('테스터가 아닌 일반 회원은 한도 없이 L1까지 도달한다', async () => {
    const r = await order({ owner: 'regular', outputs: [{ recipient_guid: 'bob', amount: 50000 }] });
    assert.equal(r.status, 402); assert.equal(txCalls.length, 1); assert.equal(blockUrls.length, 0);
  });

  test('from_guid를 일반 회원으로 속여도 서명 대상인 tx.input.owner_guid(테스터)로 판단한다', async () => {
    const r = await order({ owner: 'tester1', from: 'regular', outputs: [{ recipient_guid: 'bob', amount: 2000 }] });
    assert.equal(r.status, 409); assert.equal(r.data.error, 'PER_TX_LIMIT'); assert.equal(txCalls.length, 0);
  });

  test('카탈로그 구매(items 있음)는 테스터라도 이 한도를 받지 않는다', async () => {
    products = [{ id: 'p1', price: 5000, is_public: true, name: 'x', stock_qty: null }];
    const r = await order({
      items: [{ id: 'p1', quantity: 1 }],
      outputs: [{ recipient_guid: 'shop', amount: 4850 }, { recipient_guid: 'gopang-platform', amount: 150 }], seller: 'shop', net: 4850, fee: 150,
    });
    assert.notEqual(r.data.error, 'PER_TX_LIMIT');
    assert.equal(txCalls.length, 1);
  });

  test('테스터 여부 조회 실패 시 이체를 거절한다(fail-closed)', async () => {
    failTesterLookup = true;
    const r = await order({ outputs: [{ recipient_guid: 'bob', amount: 10 }] });
    assert.equal(r.status, 502); assert.equal(r.data.error, 'L1_UNREACHABLE'); assert.equal(txCalls.length, 0);
  });

  test('거래 이력 조회 실패 시 이체를 거절한다(fail-closed)', async () => {
    failBlocks = true;
    const r = await order({ outputs: [{ recipient_guid: 'bob', amount: 10 }] });
    assert.equal(r.status, 502); assert.equal(txCalls.length, 0);
  });

  test('이력이 200건을 넘고 조회분 전체가 오늘이면 거절한다(오늘 누적을 알 수 없음)', async () => {
    blocks = [priorTo('bob', 1)]; blocksTotal = 500;
    const r = await order({ outputs: [{ recipient_guid: 'bob', amount: 10 }] });
    assert.equal(r.status, 502); assert.equal(r.data.error, 'LIMIT_HISTORY_INCOMPLETE'); assert.equal(txCalls.length, 0);
  });

  test('출력 금액이 음수이거나 합계가 0이면 400 AMOUNT_INVALID', async () => {
    let r = await order({ outputs: [{ recipient_guid: 'bob', amount: 1500 }, { recipient_guid: 'eve', amount: -1000 }] });
    assert.equal(r.status, 400); assert.equal(r.data.error, 'AMOUNT_INVALID');
    r = await order({ outputs: [{ recipient_guid: 'bob', amount: 0 }] });
    assert.equal(r.status, 409); assert.equal(r.data.error, 'AMOUNT_INVALID');
    assert.equal(txCalls.length, 0);
  });
});
