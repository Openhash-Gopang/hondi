// 메인 채팅(AI 비서)에서 이용자가 방금 첨부한 사진을 잠시 기억해 두는 곳 (2026-10-14 신설).
// 메인 채팅은 대화 기록(history)에 사진 대신 "[첨부: 이미지]"라는 글자만 남긴다. 그래서 AI 비서가 전문가 페르소나를
// 부를 때 사진이 새 탭으로 넘어갈 방법이 없었다. 여기에 최근 사진을 메모리(탭이 열려 있는 동안만)에 두고,
// 전문가 호출 때 꺼내 같은 기기의 IndexedDB로 넘긴다(form-shots-handoff.js). 서버로는 보내지 않는다.
export const MAX_KEPT = 5;
export const KEEP_MS = 30 * 60 * 1000;
let kept = [];   // { url, ts }

export function rememberImages(urls, now = Date.now) {
  const t = now();
  for (const u of urls || []) if (typeof u === 'string' && u.startsWith('data:image/')) kept.push({ url: u, ts: t });
  kept = kept.slice(-MAX_KEPT);
}
export function recallImages(now = Date.now) {
  const t = now();
  kept = kept.filter(k => t - k.ts <= KEEP_MS);
  return kept.map(k => k.url);
}
export function forgetImages() { kept = []; }
