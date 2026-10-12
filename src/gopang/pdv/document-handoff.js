/**
 * pdv/document-handoff.js — 준비된 문서를 사용자가 고른 앱으로 전달
 *
 * 2026-07-09 신설 — "내 이력서와 등본 두 통을 모모 기업에 보내줘"
 * 사고실험(원래 "불가능" 판정, 3중 벽 중 마지막 하나)을 다룬다.
 *
 * ★ share-inbox.js(Web Share Target — 다른 앱→나비로 문서 수신)의
 * 정반대 방향이다. Web Share API(navigator.share)로 나비가 준비한
 * 문서를 사용자가 고른 앱(이메일·카카오톡 등)에 넘긴다 — profile.html
 * shareProfile()이 이미 쓰던 것과 같은 API를 파일 첨부까지 확장했다.
 *
 * ★★★ 결정적 한계 — 반드시 읽을 것 ★★★
 * 이 모듈은 "회사에 전송 완료"를 보장하지 않는다. navigator.share()는
 * OS 공유시트를 띄워 사용자가 앱(이메일 등)을 고르고 그 안에서 수신자
 * 주소를 넣고 최종 "보내기"를 직접 눌러야 끝난다 — 나비가 회사
 * 이메일 주소를 알아내거나 대신 발송하지 않는다. 이건 기술적 한계가
 * 아니라 의도된 설계다(§14 적극적 보조 원칙 — AI는 준비까지, 대외
 * 발신처럼 되돌릴 수 없는 최종 행위는 사람이 직접). 개인파산의
 * "본인인증 필수라 법원 제출은 직접"과 같은 원칙이다.
 *
 * 이력서 자체도 PDV에 구조화된 경력 데이터가 없어(§13-4와 동일한
 * 종류의 공백) 이 모듈이 대신 작성해주지 않는다 — 이미 갖고 있는
 * 이력서 파일을 share-inbox.js로 받아서 전달하는 것까지만 한다.
 */

// 이력서는 share-inbox.js의 인박스 메커니즘을 그대로 재사용한다(정부24
// 문서를 받던 것과 같은 파이프라인 — 사용자가 이미 갖고 있는 이력서
// 파일을 "공유하기"로 나비에 보내면 받는다). procedure-docs.js의
// DOCUMENT_SOURCES에 있는 항목이 아니라 여기 별도로 둔 이유 — 이력서는
// 특정 "절차"(court-filing 같은)에 속하지 않고 범용 문서라서.
export const RESUME_MATCH_KEYWORDS = ['이력서', '자기소개서', 'resume', 'CV'];

/**
 * navigator.share가 파일 공유를 실제로 지원하는지 확인한다. 브라우저마다
 * navigator.share는 있어도 파일 첨부는 못 받는 경우가 있어(canShare
 * 결과가 다름) 둘 다 확인해야 한다.
 * @param {File[]} files
 * @param {{nav?: Navigator}} opts - 테스트용 주입 지점(기본값: 전역 navigator)
 */
export function canShareFiles(files, opts = {}) {
  const nav = opts.nav || (typeof navigator !== 'undefined' ? navigator : null);
  if (!nav || typeof nav.share !== 'function') return false;
  if (typeof nav.canShare !== 'function') return false; // canShare 없으면 파일 지원 여부를 확인할 방법이 없어 안전하게 false
  try {
    return nav.canShare({ files });
  } catch {
    return false;
  }
}

/**
 * 준비된 문서(들)를 사용자가 고를 앱으로 넘긴다. 실패/미지원이면
 * 예외를 던지지 않고 { ok:false, reason } 을 반환 — 호출부가 "공유가
 * 안 되면 다운로드로 대신 안내" 같은 폴백을 결정할 수 있게 한다.
 * @param {File[]} files
 * @param {{title?: string, text?: string, nav?: Navigator}} opts
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function shareDocumentsToApp(files, opts = {}) {
  const nav = opts.nav || (typeof navigator !== 'undefined' ? navigator : null);
  if (!files || !files.length) return { ok: false, reason: 'NO_FILES' };
  if (!canShareFiles(files, { nav })) return { ok: false, reason: 'UNSUPPORTED' };

  try {
    await nav.share({ files, title: opts.title || '', text: opts.text || '' });
    return { ok: true };
  } catch (e) {
    // 사용자가 공유시트에서 취소한 경우도 여기로 온다(AbortError) —
    // 에러로 취급하지 않고 조용한 실패로 구분한다.
    if (e && e.name === 'AbortError') return { ok: false, reason: 'CANCELLED' };
    return { ok: false, reason: 'FAILED', message: e?.message };
  }
}

/**
 * share-inbox.js의 getSharedDocument 결과(blob 포함)를 File 객체로
 * 바꾼다 — navigator.share의 files 파라미터는 File[]을 요구하고
 * Blob만으로는 안 된다(파일명이 없으면 첨부 시 이상하게 보임).
 * @param {{blob: Blob, filename: string, mimeType: string}} sharedDoc
 * @returns {File}
 */
export function toShareableFile(sharedDoc) {
  const name = sharedDoc.filename || 'document';
  return new File([sharedDoc.blob], name, { type: sharedDoc.mimeType || 'application/octet-stream' });
}

/**
 * 여러 개의 공유받은 문서(예: 등본 + 이력서)를 한 번에 넘길 File[]로
 * 묶는다. 하나라도 blob이 없는(아직 안 받은) 항목은 조용히 제외한다 —
 * "아직 준비 안 된 문서까지 억지로 보내려 하지 않는다"는 원칙.
 * @param {Array<{blob?: Blob, filename?: string, mimeType?: string}|null>} sharedDocs
 * @returns {File[]}
 */
export function buildShareableBundle(sharedDocs) {
  return (sharedDocs || [])
    .filter(d => d && d.blob)
    .map(toShareableFile);
}
