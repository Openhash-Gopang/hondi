// 사용 분야(2026-11-21) — AI 사용량 로그(ai_usage_log.field)에 남길 "어디에 쓴 요청인지" 이름.
// 1) 요청 본문의 usage_field(클라이언트가 직접 지정: 예 "병원·의원 · 피부과")를 걸러서 쓰고,
// 2) 없으면 요청을 보낸 사이트(Origin)로 짐작한다(전문가 AI 사이트 단위). 모르면 '' — 서비스 구분(service_id)만 남는다.
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>\[\]{}"`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const SITES = [
  [/^doctor\./, '병원·의원 전문가 AI'],
  [/^tax\./, '세무·회계 전문가 AI'],
  [/^(law|navi-?law)\./, '나비로(법률 서류)'],
  [/^clean\./, 'K-Clean(환경)'],
  [/^market\./, 'K-Market'],
  [/^school\./, 'K-School'],
  [/^mail\./, '메일'],
];
export function fieldFromOrigin(origin) {
  let host = '';
  try { host = new URL(String(origin || '')).hostname.toLowerCase(); } catch (e) { return ''; }
  if (!/(^|\.)(hondi\.net|naviweb\.kr|hondi\.kr)$/.test(host)) return '';
  const sub = host.replace(/\.(hondi\.net|naviweb\.kr|hondi\.kr)$/, '');
  for (const [re, label] of SITES) if (re.test(sub + '.')) return label;
  return '';
}
export function usageField(bodyText, origin) {
  let b = null;
  try { b = JSON.parse(bodyText); } catch (e) { /* 본문이 JSON 이 아님 */ }
  const own = clean(b && b.usage_field, 40);
  return own || fieldFromOrigin(origin);
}
