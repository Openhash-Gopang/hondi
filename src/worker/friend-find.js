// ═════════════════════════════════════════════════
// 대화 상대 찾기 — 카카오톡 방식(2026-10-28, 주피터 지시)
//   · 전화번호: 상대가 "번호로 찾기 허용"을 켠 경우에만, 번호가 정확히 같을 때만 찾는다(부분일치·둘러보기 없음).
//   · 혼디 아이디(handle): 가입 때 전화번호에서 서버가 정해 준 값이라 본인이 고를 수 없다. 정확히 같을 때만 찾는다.
//   · 결과에는 연결에 필요한 최소 정보(guid·handle·닉네임·아이콘)만 담는다. 전화번호·이메일은 절대 돌려주지 않는다.
// 이 모듈은 입력 해석과 검증만 한다(네트워크 없음). L1 조회는 worker.js 가 한다.
// ═════════════════════════════════════════════════

export const RATE_LIMIT_PER_HOUR = 40;

/** 입력이 전화번호처럼 보이면 E.164 로, 아니면 null. 한국 번호(010…)는 +82 로 바꾼다. */
export function normalizePhone(input) {
  const raw = String(input == null ? '' : input).trim();
  if (!raw) return null;
  if (/[^\d\s()+\-.]/.test(raw)) return null;            // 글자가 섞이면 번호가 아니다
  const plus = raw.startsWith('+');
  let d = raw.replace(/\D/g, '');
  if (!d) return null;
  if (plus) { /* +82… 그대로 */ }
  else if (d.startsWith('00')) d = d.slice(2);             // 00 82 … 국제전화 접두
  else if (d.startsWith('0')) d = '82' + d.slice(1);        // 010… → 82 10…
  else if (d.startsWith('82')) { /* 이미 국가번호 */ }
  else return null;                                        // 0·+·82 로 시작하지 않으면 번호로 보지 않는다(아이디일 수 있음)
  if (d.startsWith('820')) d = '82' + d.slice(3);          // +82 010… 처럼 0 을 남긴 경우
  if (d.length < 9 || d.length > 15) return null;
  return '+' + d;
}

/**
 * 검색창 입력 해석:
 *  { kind: 'phone', e164 }   전화번호
 *  { kind: 'handle', handle } 혼디 아이디(handle) — 전화번호로 가입할 때 서버가 정해 주는 값(@+번호 뒤 8자리, 해외는 @국가-번호). 본인이 고르는 값이 아니다
 *  { kind: 'id', id }        그 밖의 글(닉네임·테스트 아이디 등) — 정확일치 조회 대상이 아니다
 *  { kind: 'empty' }
 */
export function classifyQuery(q) {
  const s = String(q == null ? '' : q).trim();
  if (!s) return { kind: 'empty' };
  const e164 = normalizePhone(s);
  if (e164) return { kind: 'phone', e164 };
  const bare = s.replace(/^@/, '').trim();
  if (!bare) return { kind: 'empty' };
  if (/^\d{8}$/.test(bare)) return { kind: 'handle', handle: '@' + bare };
  const m = bare.match(/^([A-Za-z]{2})-(\d{4,12})$/);
  if (m) return { kind: 'handle', handle: '@' + m[1].toUpperCase() + '-' + m[2] };
  return { kind: 'id', id: bare.toLowerCase() };
}

/** 검색 결과로 돌려줄 공개 카드 — 이 필드 밖의 정보는 절대 포함하지 않는다. */
export function publicCard(p) {
  if (!p) return null;
  return {
    guid: p.guid, handle: p.handle || '', nickname: p.nickname || '',
    avatar_emoji: p.avatar_emoji || '', region: p.region || '', country_code: p.country_code || '',
  };
}

/** 시간당 조회 한도 판정. count 는 이번 시각 구간에서 이미 쓴 횟수. */
export function rateLimitOk(count, limit = RATE_LIMIT_PER_HOUR) { return Number(count || 0) < limit; }
