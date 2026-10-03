import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// 2026-10-03 — 대출 상환(수취인이 대출금고)은 테스터 이체 한도에서 제외한다(3단계). 상환이 아닌 거래의 한도는 그대로여야 한다.

describe('handleBizOrder — 대출 상환의 한도 제외', () => {
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

  const LOAN = 'gdc-loan-vault';

  test('대출금고로의 첫 상환은 신규 수취인 한도(₮100)·1회 한도(₮1,000)를 받지 않는다 — 이력 조회도 하지 않는다', async () => {
    const r = await order({ outputs: [{ recipient_guid: LOAN, amount: 2500 }] });
    assert.equal(r.status, 402); assert.equal(r.data.error, 'INSUFFICIENT_BALANCE'); // L1까지 도달
    assert.equal(txCalls.length, 1); assert.equal(blockUrls.length, 0);
  });

  test('예치금고로 같은 금액을 보내면 여전히 1회 한도를 받는다(대조)', async () => {
    const r = await order({ outputs: [{ recipient_guid: 'gdc-deposit-vault', amount: 2500 }] });
    assert.equal(r.status, 409); assert.equal(r.data.error, 'PER_TX_LIMIT');
  });

  test('다른 수취인이 섞인 출력은 면제하지 않는다', async () => {
    const r = await order({ outputs: [{ recipient_guid: LOAN, amount: 500 }, { recipient_guid: 'bob', amount: 2000 }] });
    assert.equal(r.status, 409); assert.equal(r.data.error, 'PER_TX_LIMIT'); assert.equal(txCalls.length, 0);
  });

  test('상환 금액은 1일 유출 누적에 들어가지 않는다 — 오늘 상환 1,900 뒤에 이체 1,000은 통과', async () => {
    blocks = [priorTo(LOAN, 1900), priorTo('bob', 5)];
    const r = await order({ outputs: [{ recipient_guid: 'bob', amount: 1000 }] });
    assert.equal(r.status, 402);
  });

  test('대조: 일반 이체 1,900 뒤에 이체 1,000은 1일 한도 초과', async () => {
    blocks = [priorTo('bob', 1900)];
    const r = await order({ outputs: [{ recipient_guid: 'bob', amount: 1000 }] });
    assert.equal(r.status, 409); assert.equal(r.data.error, 'DAILY_LIMIT');
  });

  test('음수 출력이 섞인 상환은 여전히 400 AMOUNT_INVALID', async () => {
    const r = await order({ outputs: [{ recipient_guid: LOAN, amount: 1500 }, { recipient_guid: 'eve', amount: -1000 }] });
    assert.equal(r.status, 400); assert.equal(r.data.error, 'AMOUNT_INVALID'); assert.equal(txCalls.length, 0);
  });

  test('일반 회원의 상환은 원래도 한도가 없다', async () => {
    const r = await order({ owner: 'regular', outputs: [{ recipient_guid: LOAN, amount: 2500 }] });
    assert.equal(r.status, 402); assert.equal(txCalls.length, 1);
  });
});
