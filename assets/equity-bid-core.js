/* ══════════════════════════════════════════════════════════════════
   equity-bid-core.js — 직역별 자회사 5% 지분 입찰 시스템 "테스트" 핵심 로직 (2026-10-18)

   ※ 시스템 테스트 전용입니다. 개시일 미정, 실제 입찰 절차가 아닙니다.
   ※ 서버·결제·실제 자격 조회와 연결되어 있지 않습니다. 형식 검증과 계산만 합니다.

   규칙(설계 문서 「5% 지분 입찰 참가 시스템 설계」 기준, 모두 초안):
     - 자회사마다 5,000주(0.5만 주), 액면 100원
     - 구글 방식(균일가): 높은 가격부터 수량을 채워 5,000주가 소진되는 마지막 가격이 낙찰가,
       낙찰자는 모두 같은 낙찰가를 낸다. 경계 가격의 남은 수량은 수량에 비례해 나눈다(접수 순 방식은 미정).
     - 약정액 = 거래 가격(낙찰가 × 배정 수량)의 10%, 잔금 90%
     - 하한가·1인 한도·수량 미달 시 처리는 미확정 → 이 테스트는 하한가=액면가(100원), 한도=5,000주로 둔다.

   브라우저(window.EquityBidCore)와 Node(module.exports) 양쪽에서 쓴다.
   ══════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var TOTAL_SHARES = 5000;      // 자회사마다 판매 수량(0.5만 주)
  var PAR_VALUE = 100;          // 액면가(원)
  var DEPOSIT_RATE = 0.10;      // 약정액 비율(거래 가격의 10%)

  var PROFESSIONS = [
    { id: 'judicial-scrivener', label: '법무사' },
    { id: 'administrative-scrivener', label: '행정사' },
    { id: 'lawyer', label: '변호사' },
    { id: 'tax-accounting', label: '세무·회계' },
    { id: 'patent-attorney', label: '변리사' },
    { id: 'appraiser', label: '감정평가사' },
    { id: 'doctor', label: '의사' },
    { id: 'realtor', label: '공인중개사' },
    { id: 'pharmacist', label: '약사' },
    { id: 'kmd', label: '한의사' }
  ];

  function digitsOnly(s) { return String(s == null ? '' : s).replace(/[^0-9]/g, ''); }

  // 사업자등록번호: 10자리 + 검증번호(국세청 알고리즘). 형식 검증일 뿐 실제 등록 여부는 확인하지 않는다.
  function validateBizNo(input) {
    var d = digitsOnly(input);
    if (d.length !== 10) return { ok: false, reason: '사업자등록번호는 숫자 10자리입니다.' };
    var w = [1, 3, 7, 1, 3, 7, 1, 3, 5], sum = 0, i;
    for (i = 0; i < 9; i++) sum += Number(d.charAt(i)) * w[i];
    sum += Math.floor((Number(d.charAt(8)) * 5) / 10);
    var check = (10 - (sum % 10)) % 10;
    if (check !== Number(d.charAt(9))) return { ok: false, reason: '사업자등록번호의 검증 숫자가 맞지 않습니다.' };
    return { ok: true, normalized: d.slice(0, 3) + '-' + d.slice(3, 5) + '-' + d.slice(5) };
  }

  // 자격 번호: 직역마다 번호 체계가 달라 이 테스트는 길이와 문자만 본다(4~20자, 한글·영문·숫자·하이픈).
  function validateLicense(input) {
    var s = String(input == null ? '' : input).trim();
    if (s.length < 4 || s.length > 20) return { ok: false, reason: '자격 번호는 4~20자로 입력하십시오.' };
    if (!/^[0-9A-Za-z가-힣\-\s]+$/.test(s)) return { ok: false, reason: '자격 번호에는 한글, 영문, 숫자, 하이픈만 쓸 수 있습니다.' };
    return { ok: true, normalized: s.replace(/\s+/g, '') };
  }

  function validateIdentity(kind, input) {
    if (kind === 'org') return validateBizNo(input);
    if (kind === 'expert') return validateLicense(input);
    return { ok: false, reason: '구분(전문가 또는 기관)을 선택하십시오.' };
  }

  function isInt(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }

  // 입찰 값 검증: 수량 1~5,000주 정수, 단가 액면가(100원) 이상 정수, 입찰 날짜 YYYY-MM-DD.
  function validateBid(b) {
    var errs = [];
    var qty = Number(b && b.qty), price = Number(b && b.price);
    if (!isInt(qty) || qty < 1) errs.push('구매 희망 수량은 1주 이상의 정수입니다.');
    else if (qty > TOTAL_SHARES) errs.push('구매 희망 수량은 ' + TOTAL_SHARES.toLocaleString('ko-KR') + '주(판매 수량) 이하입니다.');
    if (!isInt(price) || price < PAR_VALUE) errs.push('단가는 액면가(' + PAR_VALUE + '원) 이상의 정수입니다.');
    var date = String(b && b.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date + 'T00:00:00Z'))) errs.push('입찰 날짜를 YYYY-MM-DD 형식으로 입력하십시오.');
    return { ok: errs.length === 0, errors: errs };
  }

  // 균일가 낙찰 계산. bids = [{id, qty, price, ...}]
  // 반환: { cleared, price, soldShares, shortfall, allocations:[{id, qty, price, awarded, pay, deposit, balance}], totalPrice, totalDeposit }
  function clearAuction(bids, total) {
    total = total || TOTAL_SHARES;
    var list = (bids || []).map(function (b, idx) {
      return { id: b.id, qty: Number(b.qty), price: Number(b.price), _idx: idx, _src: b };
    }).filter(function (b) { return isInt(b.qty) && b.qty > 0 && isInt(b.price) && b.price > 0; });

    var demand = list.reduce(function (s, b) { return s + b.qty; }, 0);
    if (!list.length) {
      return { cleared: false, reason: 'no-bids', price: null, soldShares: 0, shortfall: total, demand: 0, allocations: [], totalPrice: 0, totalDeposit: 0 };
    }
    if (demand < total) {
      // 수량 미달: 처리 방식(하한가로 낙찰 / 재입찰)은 미확정이므로 낙찰을 확정하지 않는다.
      return { cleared: false, reason: 'undersubscribed', price: null, soldShares: 0, shortfall: total - demand, demand: demand, allocations: [], totalPrice: 0, totalDeposit: 0 };
    }

    list.sort(function (a, b) { return b.price - a.price || a._idx - b._idx; });
    var cum = 0, i, clearing = null;
    for (i = 0; i < list.length; i++) {
      cum += list[i].qty;
      if (cum >= total) { clearing = list[i].price; break; }
    }

    var awarded = {};            // idx → 배정 수량
    var above = list.filter(function (b) { return b.price > clearing; });
    var atPrice = list.filter(function (b) { return b.price === clearing; });
    var used = 0;
    above.forEach(function (b) { awarded[b._idx] = b.qty; used += b.qty; });
    var remain = total - used;
    var atDemand = atPrice.reduce(function (s, b) { return s + b.qty; }, 0);

    if (atDemand <= remain) {
      atPrice.forEach(function (b) { awarded[b._idx] = b.qty; });
    } else {
      // 경계 가격: 수량에 비례해 나눈다(내림 후 남는 주식은 소수점 큰 순서, 같으면 접수 순).
      var parts = atPrice.map(function (b) {
        var exact = remain * b.qty / atDemand;
        return { b: b, base: Math.floor(exact), frac: exact - Math.floor(exact) };
      });
      var given = parts.reduce(function (s, p) { return s + p.base; }, 0);
      var left = remain - given;
      parts.slice().sort(function (a, b) { return (b.frac - a.frac) || (a.b._idx - b.b._idx); })
        .forEach(function (p) { if (left > 0) { p.base += 1; left -= 1; } });
      parts.forEach(function (p) { awarded[p.b._idx] = Math.min(p.base, p.b.qty); });
    }

    var allocations = list.slice().sort(function (a, b) { return a._idx - b._idx; }).map(function (b) {
      var got = awarded[b._idx] || 0;
      var pay = got * clearing;
      var deposit = Math.round(pay * DEPOSIT_RATE);
      return { id: b.id, qty: b.qty, bidPrice: b.price, awarded: got, pay: pay, deposit: deposit, balance: pay - deposit };
    });
    var sold = allocations.reduce(function (s, a) { return s + a.awarded; }, 0);
    return {
      cleared: true, price: clearing, soldShares: sold, shortfall: total - sold, demand: demand,
      allocations: allocations,
      totalPrice: sold * clearing,
      totalDeposit: allocations.reduce(function (s, a) { return s + a.deposit; }, 0)
    };
  }

  var api = {
    TOTAL_SHARES: TOTAL_SHARES, PAR_VALUE: PAR_VALUE, DEPOSIT_RATE: DEPOSIT_RATE, PROFESSIONS: PROFESSIONS,
    validateBizNo: validateBizNo, validateLicense: validateLicense, validateIdentity: validateIdentity,
    validateBid: validateBid, clearAuction: clearAuction
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.EquityBidCore = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {}));
