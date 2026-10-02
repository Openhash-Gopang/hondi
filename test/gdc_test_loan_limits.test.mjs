import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, sign } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';

// 2026-10-03 — GDC 필드테스트 대출 한도(handleGdcTestLoanApply) 회귀 테스트.
// 1) 서버 구현(_gdcCheckLoanLimits)이 gdc 저장소의 한도 명세·기준 구현과 같은 결과를 내는지 시나리오로 대조
// 2) 실제 Ed25519 서명을 쓴 핸들러 흐름에서 한도 위반 시 지급 블록이 만들어지지 않는지 확인

const genKeyPair = promisify(generateKeyPair);
const toB64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('_gdcCheckLoanLimits — gdc 저장소 시나리오와 일치', () => {
  let check, scenarios;
  before(async () => {
    global.fetch = async () => { throw new Error('이 테스트는 네트워크를 쓰지 않는다'); };
    ({ _gdcCheckLoanLimits: check } = await import('../worker.js?limits=' + Date.now()));
    const fx = JSON.parse(await readFile(new URL('./fixtures/gdc_loan_limit_scenarios.json', import.meta.url), 'utf8'));
    scenarios = fx.scenarios;
  });

  test('시나리오가 충분히 들어 있다', () => {
    assert.ok(scenarios.length >= 11, '시나리오 수: ' + scenarios.length);
  });

  test('모든 loan_limit 시나리오의 결과 코드가 expected와 같다', () => {
    for (const s of scenarios) {
      const r = check(s.inputs);
      assert.equal(r.ok, s.expected.ok, s.id);
      assert.equal(r.code, s.expected.code, s.id);
      if (typeof s.expected.dsr === 'number') {
        assert.ok(Math.abs(r.dsr - s.expected.dsr) <= 0.0005, `${s.id}: DSR ${r.dsr} vs ${s.expected.dsr}`);
      }
    }
  });
});

describe('handleGdcTestLoanApply — 한도 검사와 지급 차단 (실제 서명)', () => {
  let handleGdcTestLoanApply, pubB64u, privateKey;
  let profiles, tfs, loans, blockWrites, loanWrites, failLoanList, fetchCount;
  const env = { L1_ADMIN_EMAIL: 'a', L1_ADMIN_PASSWORD: 'b' };

  before(async () => {
    const { publicKey, privateKey: priv } = await genKeyPair('ed25519');
    privateKey = priv;
    const raw = publicKey.export({ type: 'spki', format: 'der' });
    pubB64u = toB64u(raw.subarray(raw.length - 32));

    global.fetch = async (url, opts) => {
      fetchCount++;
      const u = decodeURIComponent(String(url));
      const method = opts?.method || 'GET';
      const body = opts?.body ? JSON.parse(opts.body) : null;
      const guidIn = u.match(/user_guid='([^']+)'/)?.[1] || u.match(/\bguid='([^']+)'/)?.[1] || '';

      if (u.endsWith('/api/admins/auth-with-password')) return { ok: true, json: async () => ({ token: 'fake-admin-token' }) };
      if (u.includes('/api/collections/profiles/records')) {
        const rec = profiles[guidIn];
        return { ok: true, json: async () => ({ items: rec ? [rec] : [] }) };
      }
      if (u.includes('/api/collections/gdc_test_financial_statements/records')) {
        const rec = tfs[guidIn];
        return { ok: true, json: async () => ({ items: rec ? [rec] : [] }) };
      }
      if (u.includes('/api/balance')) return { ok: true, json: async () => ({ ok: true, balance: 1000 }) };
      if (u.includes('/api/collections/gdc_test_loans/records') && method === 'GET') {
        if (failLoanList) return { ok: false, status: 500, json: async () => ({}), text: async () => 'boom' };
        const items = loans.filter(l => l.user_guid === guidIn && l.status === 'active');
        return { ok: true, json: async () => ({ items, totalItems: items.length }) };
      }
      if (u.includes('/api/collections/blocks/records') && method === 'POST') {
        blockWrites.push(body);
        return { ok: true, json: async () => ({ id: 'block-' + blockWrites.length }) };
      }
      if (u.includes('/api/collections/gdc_test_loans/records') && method === 'POST') {
        loanWrites.push(body);
        return { ok: true, json: async () => ({ id: 'loan-' + loanWrites.length }) };
      }
      throw new Error('예상치 못한 fetch: ' + method + ' ' + u);
    };
    ({ handleGdcTestLoanApply } = await import('../worker.js?apply=' + Date.now()));
  });

  beforeEach(() => {
    fetchCount = 0; failLoanList = false; blockWrites = []; loanWrites = []; loans = [];
    profiles = {
      u1: { guid: 'u1', pubkey_ed25519: pubB64u },
      u2: { guid: 'u2', pubkey_ed25519: pubB64u },
      u3: { guid: 'u3', pubkey_ed25519: pubB64u },
    };
    tfs = {
      // 우량 테스터: 영업이익 4000, 순자산 10000, 등급 AAA(연 0.5%)
      u1: { user_guid: 'u1', bs_ar: 500, bs_ap: 600, bs_debt: 200, bs_equity: 10000, pl_revenue: 10000, pl_cogs: 4000, pl_opex: 2000, cf_op: 1000 },
      // 소득 0 테스터
      u2: { user_guid: 'u2', bs_ar: 500, bs_ap: 600, bs_debt: 200, bs_equity: 10000, pl_revenue: 1000, pl_cogs: 1000, pl_opex: 0, cf_op: 1000 },
      // u3: 테스터 레코드 없음
    };
  });

  function signedRequest(guid, principal) {
    const ts = String(Date.now());
    const sigMsg = `gdc-test-loan-apply:${guid}:${principal}:${pubB64u}:${ts}`;
    const sig = toB64u(sign(null, Buffer.from(sigMsg), privateKey));
    return new Request('https://x/biz/gdc-test-loan-apply', {
      method: 'POST',
      body: JSON.stringify({ user_guid: guid, principal, pubkey: pubB64u, signature: sig, ts }),
    });
  }
  async function call(guid, principal) {
    const res = await handleGdcTestLoanApply(signedRequest(guid, principal), env, {});
    return { status: res.status, data: await res.json() };
  }

  test('한도 안의 대출은 지급 블록과 대출 레코드가 만들어지고 DSR이 응답에 포함된다', async () => {
    const { status, data } = await call('u1', 1000);
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.grade, 'AAA');
    assert.ok(data.dsr > 0 && data.dsr < 0.4, 'dsr=' + data.dsr);
    assert.equal(blockWrites.length, 1);
    assert.equal(blockWrites[0].buyer_guid, 'gdc-loan-vault');
    assert.equal(blockWrites[0].seller_guid, 'u1');
    assert.equal(loanWrites.length, 1);
    assert.equal(loanWrites[0].principal, 1000);
  });

  test('1건 상한(₮3,000) 초과는 409 LOAN_PER_LIMIT — 지급 블록 없음', async () => {
    const { status, data } = await call('u1', 3001);
    assert.equal(status, 409);
    assert.equal(data.error, 'LOAN_PER_LIMIT');
    assert.equal(blockWrites.length, 0);
    assert.equal(loanWrites.length, 0);
  });

  test('기존 활성 대출과 합쳐 ₮5,000 초과는 409 LOAN_TOTAL_LIMIT — 지급 블록 없음', async () => {
    loans = [{ user_guid: 'u1', status: 'active', outstanding_principal: 3001, annual_rate: 0.005 }];
    const { status, data } = await call('u1', 2000);
    assert.equal(status, 409);
    assert.equal(data.error, 'LOAN_TOTAL_LIMIT');
    assert.equal(blockWrites.length, 0);
  });

  test('상환 완료(repaid) 대출은 잔액 합계에 포함되지 않는다', async () => {
    loans = [{ user_guid: 'u1', status: 'repaid', outstanding_principal: 0, annual_rate: 0.005 }];
    const { status } = await call('u1', 1000);
    assert.equal(status, 200);
  });

  test('DSR 40% 초과는 409 DSR_EXCEEDED — 지급 블록 없음', async () => {
    const { status, data } = await call('u1', 3000); // 연 상환액 약 3,030 / 소득 4,000
    assert.equal(status, 409);
    assert.equal(data.error, 'DSR_EXCEEDED');
    assert.equal(blockWrites.length, 0);
  });

  test('기존 대출의 상환액이 DSR에 합산된다', async () => {
    loans = [{ user_guid: 'u1', status: 'active', outstanding_principal: 3000, annual_rate: 0.005 }];
    const { status, data } = await call('u1', 100);
    assert.equal(status, 409);
    assert.equal(data.error, 'DSR_EXCEEDED');
    assert.equal(blockWrites.length, 0);
  });

  test('소득(영업이익)이 0이면 409 NO_INCOME', async () => {
    const { status, data } = await call('u2', 500);
    assert.equal(status, 409);
    assert.equal(data.error, 'NO_INCOME');
    assert.equal(blockWrites.length, 0);
  });

  test('기존 대출 조회 실패 시 대출을 거절한다(fail-closed) — 지급 블록 없음', async () => {
    failLoanList = true;
    const { status, data } = await call('u1', 1000);
    assert.equal(status, 502);
    assert.equal(data.error, 'L1_UNREACHABLE');
    assert.equal(blockWrites.length, 0);
  });

  test('필드테스터가 아니면 기존대로 403 NOT_A_TESTER', async () => {
    const { status, data } = await call('u3', 100);
    assert.equal(status, 403);
    assert.equal(data.error, 'NOT_A_TESTER');
    assert.equal(blockWrites.length, 0);
  });

  test('문자열 숫자·Infinity 원금은 서명 검증 전에 400 INVALID_AMOUNT', async () => {
    for (const principal of ['100', null]) {
      const req = new Request('https://x/biz/gdc-test-loan-apply', {
        method: 'POST', body: JSON.stringify({ user_guid: 'u1', principal, pubkey: pubB64u, signature: 'x', ts: '1' }),
      });
      const res = await handleGdcTestLoanApply(req, env, {});
      const data = await res.json();
      assert.ok(res.status === 400, String(principal) + ' -> ' + res.status);
      assert.ok(data.error === 'INVALID_AMOUNT' || data.error === 'MISSING_FIELD', data.error);
    }
    assert.equal(blockWrites.length, 0);
  });
});
