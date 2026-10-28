// 2026-10-28 — K-Mail 의 주소록 현황 파악(요약 태그·프롬프트 주입·조회 범위 설명).
export const CONTACTS_NOTE_TAG = `[주소록 도구 안내 — 서버가 매 턴 붙이는 사실]
- 주소록 전체 현황(총 건수, 대학·소속별 건수, 카테고리별 건수)이 궁금하면 답변 끝에 KMAIL_CONTACTS_SUMMARY 를 단독으로 내세요(JSON 없이 그 한 줄). 서버가 정확히 집계해 돌려줍니다.
- KMAIL_LOOKUP_CONTACTS 결과의 "정확한 총 건수"는 그때 건 조건(이름·소속·태그 등)에 맞는 건수일 뿐 주소록 전체 건수가 아닙니다. 조건 없이 조회한 경우에도 승인된 연락처만 셉니다(승인 대기 제외).
- 조회 목록은 소속·이름 순 앞쪽 최대 200건 샘플이며 최신순이 아닙니다.
- 아래 "[주소록 현황]"의 숫자만 전체 건수로 말하세요. 대화 앞부분이 생략됐다는 안내가 있으면 기억으로 합산하지 말고 요약 태그로 확인하세요.`;

export function buildContactsNote({ total, confirmed, pending, omittedCount = 0, omittedRegistered = 0 } = {}) {
  const known = [total, confirmed, pending].every(n => Number.isFinite(n));
  let s = known ? `[주소록 현황] 전체 ${total}건 (승인됨 ${confirmed}건, 승인 대기 ${pending}건). 소속·카테고리별 건수는 KMAIL_CONTACTS_SUMMARY 로 확인.\n` : '[주소록 현황] 건수 조회에 실패했습니다 — 건수를 말하지 말고 KMAIL_CONTACTS_SUMMARY 로 확인하세요.\n';
  if (omittedCount > 0) s += `[대화 이력 안내] 대화가 길어 앞부분 ${omittedCount}개 메시지는 모델에 전달되지 않았습니다${omittedRegistered ? ` (생략된 부분의 등록 완료 보고 합계 ${omittedRegistered}건)` : ''}. 이번 세션 등록 건수를 기억으로 말하지 마세요.\n`;
  return s + CONTACTS_NOTE_TAG;
}

// 생략된 메시지 속 "✅ N건 …등록" 보고의 합계
export function sumRegisteredInMessages(msgs) {
  let sum = 0;
  for (const m of msgs || []) {
    if (!m || m.role !== 'assistant' || typeof m.content !== 'string') continue;
    for (const mm of m.content.matchAll(/✅\s*(\d+)\s*건[^\n]*등록/g)) sum += parseInt(mm[1], 10) || 0;
  }
  return sum;
}

// rows: [{ org, category, status, created }] → 소속별·카테고리별 집계
export function summarizeContacts(rows, nowMs = Date.now()) {
  const orgs = new Map(), cats = new Map();
  let added24h = 0;
  for (const r of rows || []) {
    if (r.status === 'rejected') continue;
    const o = String(r.org || '').trim() || '(소속 없음)';
    orgs.set(o, (orgs.get(o) || 0) + 1);
    const c = String(r.category || '').trim() || '(미분류)';
    cats.set(c, (cats.get(c) || 0) + 1);
    const t = Date.parse(String(r.created || '').replace(' ', 'T'));
    if (Number.isFinite(t) && nowMs - t < 864e5) added24h++;
  }
  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([name, count]) => ({ name, count }));
  return { orgs: top(orgs, 25), orgCount: orgs.size, categories: top(cats, 12), added24h };
}

export function buildSummaryContext(s) {
  return `[주소록 요약 결과 — 서버 집계, 정확함]\n전체 ${s.total}건 (승인됨 ${s.confirmed}건, 승인 대기 ${s.pending}건, 거부 ${s.rejected}건).\n`
    + `최근 24시간 등록 ${s.added24h}건. 소속 ${s.orgCount}곳${s.truncated ? ' (※ 레코드가 많아 앞쪽 ' + s.scanned + '건만 집계한 소속·카테고리 수치는 하한)' : ''}.\n`
    + `소속별 상위: ${JSON.stringify(s.orgs)}\n카테고리별: ${JSON.stringify(s.categories)}\n\n`
    + '위 숫자만 근거로 사용자에게 간결하게 정리해 답하세요(표 가능). 숫자를 바꾸거나 지어내지 마세요.';
}

// 조회 조건 설명 — 조회 결과가 "전체 건수"로 오해되지 않게 한다.
export function describeLookupScope(opts) {
  const parts = [];
  for (const [k, label] of [['q', '검색어'], ['org', '소속'], ['occupation', '직업'], ['relationship', '관계'], ['tag', '태그']]) {
    if (opts && opts[k]) parts.push(`${label} '${opts[k]}'`);
  }
  return `승인된 연락처 중 ${parts.length ? '조건: ' + parts.join(', ') : '조건 없음'} — 이 건수는 이 조건의 건수이며 주소록 전체 건수가 아님`;
}
