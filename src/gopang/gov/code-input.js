// 사람이 입력한 번호(전화번호 또는 10자리 숫자 코드)를 나비 숫자 코드로 바꾼다 (2026-11-19 신설)
// 휴대폰: 010-1234-5678 → 1012345678 (010에서 앞의 0만 뺀 "10"+8자리, hondi-digit-code.js phoneToDigits와 같은 규칙)
// 유선:   064-000-0001 → 0640000001 (맨 앞 0을 빼고 지역번호+번호, 9자리면 앞에 0을 채운다)
// 이미 10자리 코드이면 그대로 둔다. 바꿀 수 없으면 null.
export function toDigitCode(input) {
  let d = String(input || '').replace(/\D/g, '');
  if (d.startsWith('82') && d.length >= 11 && !d.startsWith('820')) d = '0' + d.slice(2);   // +82 표기
  if (!d) return null;
  if (d.length === 11 && d.startsWith('010')) return '10' + d.slice(3);
  if (d.length === 10 && !d.startsWith('0')) return d;               // 이미 코드(휴대폰 10…, 예외 유선)
  if (d.startsWith('0')) {
    const r = d.slice(1);
    if (r.length === 9) return '0' + r;
    if (r.length === 10) return r;
    return null;
  }
  return null;
}
