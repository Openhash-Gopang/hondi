import { idToDigits, digitsToId, MAX_DIGIT_ID, DIGIT_COUNT,
         phoneToDigits, digitsToPhone, VALID_AREA_CODES } from '../gopang/ai/hondi-digit-code.js';

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; }
  else { fail++; console.error('❌', label); }
}

// ── D-01: id → digits → id 왕복, 랜덤 1000건 ──────────────────
{
  let allOk = true;
  for (let i = 0; i < 1000; i++) {
    const id = BigInt(Math.floor(Math.random() * Number(MAX_DIGIT_ID)));
    const digits = idToDigits(id);
    const back = digitsToId(digits);
    if (back !== id || digits.length !== DIGIT_COUNT) { allOk = false; }
  }
  ok(allOk, 'D-01: id→digits→id 왕복 1000건');
}

// ── D-02: 경계값 ────────────────────────────────────────────
ok(digitsToId(idToDigits(0n)) === 0n, 'D-02a: id=0 왕복');
ok(digitsToId(idToDigits(MAX_DIGIT_ID - 1n)) === MAX_DIGIT_ID - 1n, 'D-02b: id=MAX-1 왕복');
{
  let threw = false;
  try { idToDigits(MAX_DIGIT_ID); } catch (e) { threw = true; }
  ok(threw, 'D-02c: id=MAX(범위초과) → Error');
}
{
  let threw = false;
  try { idToDigits(-1n); } catch (e) { threw = true; }
  ok(threw, 'D-02d: id=-1(음수) → Error');
}

// ── D-03: 휴대폰 인코딩/디코딩 왕복 ─────────────────────────
{
  const digits = phoneToDigits({ type: 'mobile', subscriberNumber: '12345678' });
  const phone = digitsToPhone(digits);
  ok(phone.type === 'mobile' && phone.subscriberNumber === '12345678' && phone.display === '010-1234-5678',
     'D-03: 휴대폰 왕복 (010-1234-5678)');
}

// ── D-04: 서울 유선(1자리 지역번호) 왕복 ────────────────────
{
  const digits = phoneToDigits({ type: 'landline', areaCode: '2', subscriberNumber: '12345678' });
  const phone = digitsToPhone(digits);
  ok(phone.type === 'landline' && phone.areaCode === '2' && phone.display === '02-1234-5678',
     'D-04: 서울 유선(02) 왕복');
}

// ── D-05: 그 외 지역(2자리 지역번호) 왕복, 전 지역번호 순회 ──
{
  let allOk = true;
  for (const area of VALID_AREA_CODES) {
    if (area === '2') continue; // 서울은 D-04에서 별도 처리
    const digits = phoneToDigits({ type: 'landline', areaCode: area, subscriberNumber: '1234567' });
    const phone = digitsToPhone(digits);
    if (phone.type !== 'landline' || phone.areaCode !== area || phone.subscriberNumber !== '1234567') {
      allOk = false;
      console.error('  →', area, JSON.stringify(phone));
    }
  }
  ok(allOk, `D-05: 2자리 지역번호 전체(${VALID_AREA_CODES.length - 1}개) 왕복`);
}

// ── D-06: 잘못된 입력 거부 ──────────────────────────────────
{
  let threw = false;
  try { phoneToDigits({ type: 'landline', areaCode: '99', subscriberNumber: '1234567' }); }
  catch (e) { threw = true; }
  ok(threw, 'D-06a: 존재하지 않는 지역번호(99) → Error');
}
{
  let threw = false;
  try { phoneToDigits({ type: 'mobile', subscriberNumber: '123' }); } // 8자리 아님
  catch (e) { threw = true; }
  ok(threw, 'D-06b: 휴대폰 자리수 오류 → Error');
}
{
  // 배열 형태로 짧은 길이를 주면 정상적으로 거부된다.
  let threw = false;
  try { digitsToPhone(['1','2','3','4','5']); } // 5개 원소, 10 아님
  catch (e) { threw = true; }
  ok(threw, 'D-06c: digitsToPhone([짧은 배열]) → Error (배열 경로는 정상 거부)');
}
{
  // 2026-07-17 강화: 문자열/숫자 형태도 이제 배열과 동일하게 엄격히
  // 거부한다 — 더 이상 자동으로 0을 채워 통과시키지 않는다(비대칭 해소).
  let threw = false;
  try { digitsToPhone('12345'); } // 5자리, 자동 패딩 없이 즉시 거부되어야 함
  catch (e) { threw = true; }
  ok(threw, 'D-06d: digitsToPhone(\'12345\') → Error (문자열 경로도 배열과 동일하게 엄격 거부, 비대칭 해소 확인)');
}
{
  // 정확히 10자리 문자열은 여전히 정상 동작해야 한다(패딩 로직 제거가
  // 정상 케이스까지 깨뜨리지 않았는지 확인).
  const phone = digitsToPhone('0012345678');
  ok(phone.type === 'mobile' && phone.subscriberNumber === '12345678',
     'D-06e: digitsToPhone(정확히 10자리 문자열)은 여전히 정상 동작');
}

{
  // 2026-11-15: 휴대폰 코드는 010에서 앞의 0만 뺀 "10"+8자리, 유선은 0을 빼고 모자라면 앞을 0으로 채움
  ok(phoneToDigits({ type: 'mobile', subscriberNumber: '98807170' }).join('') === '1098807170', 'D-07a: 010-9880-7170 → 1098807170');
  ok(digitsToPhone('1098807170').display === '010-9880-7170', 'D-07b: 1098807170 → 010-9880-7170');
  ok(digitsToPhone('0012345678').type === 'mobile', 'D-07c: 예전 코드 00+8자리도 읽힌다');
  ok(phoneToDigits({ type: 'landline', areaCode: '2', subscriberNumber: '12345678' }).join('') === '0212345678', 'D-07d: 02-1234-5678 → 0212345678');
  ok(phoneToDigits({ type: 'landline', areaCode: '64', subscriberNumber: '1234567' }).join('') === '0641234567', 'D-07e: 064-123-4567 → 0641234567');
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패 / 총 ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
