// ═════════════════════════════════════════════════
// 대화 상대 찾기 — 카카오톡 방식(2026-11-15, 주피터 지시)
//   · 아이디: 가입 때 본인이 고른 이메일 ID(예: ceo → ceo@naviweb.kr). 정확히 같을 때만 찾는다(부분일치·둘러보기 없음).
//   · 이름: 상대가 "이름으로 찾기"를 허용한 경우에만, 이름이 정확히 같을 때만 찾는다(같은 이름이 여럿이면 목록).
//   · 전화번호: 상대가 "번호로 찾기 허용"을 켠 경우에만, 번호가 정확히 같을 때만 찾는다.
//   · 결과에는 연결에 필요한 최소 정보(guid·아이디·이름·아이콘)만 담는다. 전화번호·백업 이메일은 절대 돌려주지 않는다.
//   · AI(LLM)를 쓰지 않는다 — 입력 해석은 이 모듈, 조회는 worker.js 가 한다.
// 이 모듈은 입력 해석과 검증만 한다(네트워크 없음).
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
 *  { kind: 'phone', e164 }  전화번호
 *  { kind: 'id', id }       이메일 ID(영문 소문자·숫자·-·_ 3~30자). "@naviweb.kr" 까지 붙여 써도 된다
 *  { kind: 'empty' }
 *  { kind: 'name', name }   이름(닉네임) — 상대가 "이름으로 찾기"를 허용한 경우에만, 정확히 같을 때만
 *  { kind: 'invalid' }      번호·아이디·이름 어느 것도 아님(숫자만, 너무 긴 글 등) — 조회하지 않는다
 */
export function classifyQuery(q) {
  const s = String(q == null ? '' : q).trim();
  if (!s) return { kind: 'empty' };
  const e164 = normalizePhone(s);
  if (e164) return { kind: 'phone', e164 };
  const id = s.replace(/^@/, '').replace(/@(naviweb\.kr|hondi\.kr)$/i, '').trim().toLowerCase();
  if (!id) return { kind: 'empty' };
  if (/^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/.test(id) && /[a-z]/.test(id)) return { kind: 'id', id };   // 숫자만인 아이디는 없다
  const name = s.replace(/^@/, '').replace(/\s+/g, ' ').trim();
  if (name.length >= 2 && name.length <= 20 && /^[A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ0-9 ._-]+$/.test(name) && /[A-Za-z가-힣]/.test(name)) return { kind: 'name', name };
  return { kind: 'invalid' };
}

/** 검색 결과로 돌려줄 공개 카드 — 이 필드 밖의 정보는 절대 포함하지 않는다. */
export function publicCard(p) {
  if (!p) return null;
  return {
    guid: p.guid, handle: p.handle || '', mail_id: p.mail_id || '', nickname: p.nickname || '',
    avatar_emoji: p.avatar_emoji || '', region: p.region || '', country_code: p.country_code || '',
  };
}

/** 시간당 조회 한도 판정. count 는 이번 시각 구간에서 이미 쓴 횟수. */
export function rateLimitOk(count, limit = RATE_LIMIT_PER_HOUR) { return Number(count || 0) < limit; }
