/**
 * equity_bid_core.test.js — 5% 지분 입찰 시스템 "테스트판"의 계산·검증 로직(assets/equity-bid-core.js).
 * 시스템 테스트 전용이며 실제 입찰 절차가 아니다. 설계 문서의 계산 예시(낙찰가 3,500원)를 그대로 검증한다.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const ctx = {}; ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(readFileSync(join(ROOT, 'assets/equity-bid-core.js'), 'utf8'), ctx);
const C = ctx.EquityBidCore;

const bizNo = (b9) => { const w = [1, 3, 7, 1, 3, 7, 1, 3, 5]; let s = 0; for (let i = 0; i < 9; i++) s += Number(b9[i]) * w[i]; s += Math.floor(Number(b9[8]) * 5 / 10); return b9 + ((10 - (s % 10)) % 10); };

describe('equity-bid-core', () => {
  it('균일가: 설계 문서 예시는 낙찰가 3,500원, D는 경계에서 500주', () => {
    const r = C.clearAuction([
      { id: 'A', qty: 1500, price: 5000 }, { id: 'B', qty: 1000, price: 4500 }, { id: 'C', qty: 2000, price: 4000 },
      { id: 'D', qty: 1500, price: 3500 }, { id: 'E', qty: 1000, price: 3000 }]);
    assert.equal(r.cleared, true); assert.equal(r.price, 3500); assert.equal(r.soldShares, 5000);
    assert.deepEqual(r.allocations.map((a) => a.awarded), [1500, 1000, 2000, 500, 0]);
    assert.equal(r.totalPrice, 17500000); assert.equal(r.totalDeposit, 1750000);
  });
  it('경계 가격 동점: 수량에 비례해 나누고 합계는 정확히 5,000주', () => {
    const r = C.clearAuction([{ id: 'A', qty: 3000, price: 4000 }, { id: 'B', qty: 2000, price: 4000 }, { id: 'C', qty: 1001, price: 4000 }]);
    assert.equal(r.allocations.reduce((s, a) => s + a.awarded, 0), 5000);
    r.allocations.forEach((a) => assert.ok(a.awarded <= a.qty));
  });
  it('약정액은 거래 가격의 10%, 잔금은 나머지', () => {
    const r = C.clearAuction([{ id: 'A', qty: 5000, price: 1234 }]);
    assert.equal(r.allocations[0].pay, 6170000); assert.equal(r.allocations[0].deposit, 617000); assert.equal(r.allocations[0].balance, 5553000);
  });
  it('수량 미달·입찰 없음은 낙찰을 확정하지 않는다', () => {
    assert.equal(C.clearAuction([{ id: 'A', qty: 2000, price: 4000 }]).reason, 'undersubscribed');
    assert.equal(C.clearAuction([]).reason, 'no-bids');
  });
  it('사업자등록번호: 검증 숫자가 맞아야 통과', () => {
    const ok = bizNo('123456789');
    assert.equal(C.validateBizNo(ok).ok, true);
    assert.equal(C.validateBizNo(ok.slice(0, 9) + ((Number(ok[9]) + 1) % 10)).ok, false);
    assert.equal(C.validateBizNo('12-34').ok, false);
  });
  it('자격 번호: 4~20자, 허용 문자만', () => {
    assert.equal(C.validateLicense('법무사 제123호').ok, true);
    assert.equal(C.validateLicense('ab').ok, false);
    assert.equal(C.validateLicense('12345<script>').ok, false);
  });
  it('입찰 값 검증: 수량·단가·날짜', () => {
    assert.equal(C.validateBid({ qty: 10, price: 100, date: '2026-10-18' }).ok, true);
    assert.equal(C.validateBid({ qty: 0, price: 50, date: '2026-13-40' }).errors.length, 3);
    assert.equal(C.validateBid({ qty: 5001, price: 100, date: '2026-10-18' }).ok, false);
    assert.equal(C.validateBid({ qty: 1.5, price: 100, date: '2026-10-18' }).ok, false);
  });
});
