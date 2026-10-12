/**
 * pdv/procedure-docs.js — 절차별 필요서류 정의 및 진행상황 추적
 *
 * 2026-07-09 신설, 같은 날 확장(사용자 지적 반영) — Web Share Target으로
 * 받은 문서를 실제 절차(개인파산 등)의 필요서류와 연결하는 계층.
 *
 * atom_rows의 court-filing 레코드가 정의한 5개 공식 필요서류
 * (파산·면책신청서/진술서/채권자목록/재산목록/수입및지출목록)와, 그
 * 서류들을 실제로 작성할 때 첨부 증빙으로 필요한 3개(은행잔고증명서/
 * 보험가입확인서/국민연금증명원)를 구분해서 관리한다 — 후자는 atom_rows
 * 시딩 데이터에는 없던 항목이라 별도 EVIDENCE 상수로 분리했다(atom_rows
 * 갱신 시 공식 목록에 편입될 수도 있음, 지금은 실무 지식으로만 보충).
 *
 * ★ 서버 쪽 court-filing 레코드가 나중에 바뀌면 이 상수도 같이 갱신해야
 * 한다 — 단일 진실공급원 아님(알려진 한계).
 *
 * ★ 소스별 실사 확인(2026-07-09) —
 *   - 국민연금증명원: 정부24로도 발급 가능(gov.kr 민원안내 확인) + 국민연금
 *     공단 공식 앱 "내 곁에 국민연금"(Android: kr.or.nps.smart)도 가능.
 *   - 은행잔고증명서: 은행마다 앱이 달라 단일 앱을 안내할 수 없음 — 은행
 *     앱 일반 안내로 그친다(정직하게 한계 명시).
 *   - 보험가입확인서: 생명보험협회 "내보험찾아줌"(cont.insure.or.kr,
 *     공식)과 금융감독원 "내보험다보여"가 공식 서비스다. 검색해보니 이름이
 *     비슷한 민간 보험비교/마케팅 앱(내보험조회, 보험다모아 등)이 다수
 *     섞여 있어 — 잘못 안내하면 사용자를 민간 마케팅 앱으로 유도할 위험이
 *     있다고 판단, 앱스토어 링크 대신 공식 협회 웹사이트 URL만 안내한다.
 */

// atom_rows의 court-filing.required_docs와 동일(2026-07-08 시딩 데이터 기준)
export const BANKRUPTCY_REQUIRED_DOCS = [
  '파산·면책신청서',
  '진술서',
  '채권자목록',
  '재산목록',
  '수입및지출목록',
];

// 실무상 필요한 첨부 증빙(atom_rows 공식 목록엔 아직 없음 — 알려진 한계)
export const BANKRUPTCY_EVIDENCE_DOCS = [
  '은행잔고증명서',
  '보험가입확인서',
  '국민연금증명원',
];

// 증빙이 어느 공식 서류를 뒷받침하는지(UI 그룹핑용)
export const EVIDENCE_PARENT = {
  '은행잔고증명서': '재산목록',
  '보험가입확인서': '재산목록',
  '국민연금증명원': '수입및지출목록',
};

export const PROCEDURE_REQUIRED_DOCS = {
  'court-filing': BANKRUPTCY_REQUIRED_DOCS,
  // 기초생활보장 신청 — 사회보장급여 신청서/금융정보 등 제공동의서는
  // 국민기초생활보장법 시행규칙상 표준 서류로 안정적인 사실이라(2026년
  // 수치처럼 매년 바뀌는 값이 아님) 별도 검색 없이도 신뢰할 수 있는
  // 항목만 담았다. 소득·재산신고서는 읍면동 창구에서 상담 후 작성하는
  // 경우가 많아 이 목록에선 제외 — 신청 시점에 결정됨.
  'welfare-application': ['사회보장급여 신청서', '금융정보 등 제공동의서'],
};

export const PROCEDURE_EVIDENCE_DOCS = {
  'court-filing': BANKRUPTCY_EVIDENCE_DOCS,
};

// 문서 출처 정보 — 어느 앱/서비스에서 받아야 하는지, 앱 실행 정보가
// 있으면 그것도 같이 둔다. source가 'bank'/'insurance-assoc'인 항목은
// buildDocumentGuidance가 launchUrl 없이 안내문만 준다(정직하게 앱을
// 특정 못 한다고 밝히는 게 잘못된 링크를 주는 것보다 낫다).
export const DOCUMENT_SOURCES = {
  '가족관계증명서': {
    source: 'gov24',
    guidance: '정부24 앱에서 발급받아 "공유하기"로 보내주세요.',
  },
  '주민등록등본': {
    source: 'gov24',
    guidance: '정부24 앱에서 발급받아 "공유하기"로 보내주세요.',
  },
  '국민연금증명원': {
    source: 'gov24-or-nps',
    guidance: '정부24 앱 또는 국민연금공단 공식 앱 "내 곁에 국민연금"에서 발급받아 공유해주세요.',
  },
  '은행잔고증명서': {
    source: 'bank',
    guidance: '이용하시는 은행 앱에서 잔고증명서를 발급받아 공유해주세요. 은행마다 앱이 달라 특정 앱을 바로 안내해드리기는 어렵습니다 — 어느 은행을 이용하시는지 알려주시면 더 구체적으로 안내해드릴 수 있습니다.',
  },
  '보험가입확인서': {
    source: 'insurance-assoc',
    guidance: '생명보험협회 "내보험찾아줌"(cont.insure.or.kr) 또는 금융감독원 "내보험다보여" 공식 서비스에서 가입내역을 조회·발급받아 공유해주세요. 이름이 비슷한 민간 보험비교 앱들과 혼동하지 않도록 위 공식 서비스만 이용해주세요.',
  },
  '이력서': {
    source: 'user-upload',
    guidance: '이미 작성해두신 이력서 파일이 있으면 공유해주세요. 나비가 대신 작성해드리지는 않습니다 — 경력·학력 등 구조화된 정보가 없어 지어낼 위험이 있기 때문입니다.',
  },
};

// 문서명 → 매칭용 키워드(파일명/제목/공유텍스트에 이 키워드가 있으면
// 그 문서로 추정한다). 어디까지나 "추정"이라 항상 사람 확인을 거친다
// (guessDocumentMatch는 결정을 내리지 않고 후보만 제시).
const _MATCH_KEYWORDS = {
  '파산·면책신청서': ['파산', '면책신청'],
  '진술서': ['진술서'],
  '채권자목록': ['채권자'],
  '재산목록': ['재산목록', '재산 목록'],
  '수입및지출목록': ['수입', '지출', '소득'],
  '가족관계증명서': ['가족관계증명서', '가족관계'],
  '주민등록등본': ['주민등록등본', '등본'],
  '국민연금증명원': ['국민연금', '연금증명', '연금 증명'],
  '은행잔고증명서': ['잔고증명', '잔액증명', '예금잔액'],
  '보험가입확인서': ['보험가입', '보험 가입', '보험증권'],
  '사회보장급여 신청서': ['사회보장급여', '급여신청서'],
  '금융정보 등 제공동의서': ['금융정보', '제공동의서'],
  '이력서': ['이력서', '자기소개서'],
};

/**
 * 공유받은 문서(파일명/제목/텍스트)로 필요서류 후보를 추정한다.
 * 절대 자동 확정하지 않는다 — 항상 사람 확인용 후보 목록만 반환.
 * @param {{filename?: string, title?: string, text?: string}} doc
 * @param {string[]} requiredDocs - 후보를 좁힐 필요서류 목록(공식+증빙 합쳐서 넘겨도 됨)
 * @returns {string[]} 매칭된 필요서류 라벨 목록(매칭 안 되면 빈 배열)
 */
export function guessDocumentMatch(doc, requiredDocs) {
  const haystack = [doc.filename, doc.title, doc.text].filter(Boolean).join(' ');
  if (!haystack) return [];
  const matched = [];
  for (const label of requiredDocs) {
    const keywords = _MATCH_KEYWORDS[label] || [label];
    if (keywords.some(kw => haystack.includes(kw))) matched.push(label);
  }
  return matched;
}

/**
 * 문서 하나를 어디서 받아야 하는지 안내 정보를 만든다. 앱을 특정할 수
 * 없는 항목(은행 등)은 launchUrl 없이 안내문만 준다 — 잘못된 링크를
 * 주느니 정직하게 모른다고 하는 쪽을 택했다.
 */
export function buildDocumentGuidance(docLabel) {
  return DOCUMENT_SOURCES[docLabel] || {
    source: 'unknown',
    guidance: `"${docLabel}"을(를) 어디서 받아야 하는지 아직 정리된 안내가 없습니다 — 직접 확인이 필요합니다.`,
  };
}

const _STORAGE_KEY_PREFIX = 'hondi_procedure_progress_';

function _getStorage(opts) {
  return opts?.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
}

/**
 * 절차의 진행상황(어떤 필요서류가 제공됐는지)을 읽는다. 공식/증빙 구분
 * 없이 같은 저장소에 함께 기록된다(둘 다 "제공됨" 여부만 추적하면 되므로).
 * @returns {{procedureId: string, provided: Record<string,{ts:number, sourceTitle?:string}>}}
 */
export function getProcedureProgress(procedureId, opts = {}) {
  const storage = _getStorage(opts);
  if (!storage) return { procedureId, provided: {} };
  try {
    const raw = storage.getItem(_STORAGE_KEY_PREFIX + procedureId);
    const provided = raw ? JSON.parse(raw) : {};
    return { procedureId, provided };
  } catch {
    return { procedureId, provided: {} };
  }
}

/**
 * 필요서류(공식 또는 증빙) 하나가 제공됐음을 기록한다. 사람이 확인을
 * 마친 뒤에만 호출해야 한다(guessDocumentMatch의 추정만으로 자동 호출 금지).
 */
export function markDocumentProvided(procedureId, docLabel, meta = {}, opts = {}) {
  const storage = _getStorage(opts);
  if (!storage) return false;
  const { provided } = getProcedureProgress(procedureId, opts);
  provided[docLabel] = { ts: Date.now(), ...meta };
  try {
    storage.setItem(_STORAGE_KEY_PREFIX + procedureId, JSON.stringify(provided));
    return true;
  } catch {
    return false;
  }
}

/**
 * 아직 제공 안 된 "공식" 필요서류 목록(atom_rows 기준 5개 중 남은 것).
 */
export function getMissingDocuments(procedureId, opts = {}) {
  const required = PROCEDURE_REQUIRED_DOCS[procedureId] || [];
  const { provided } = getProcedureProgress(procedureId, opts);
  return required.filter(label => !provided[label]);
}

/**
 * 아직 제공 안 된 "증빙" 목록(은행잔고증명서 등 3개 중 남은 것).
 * getMissingDocuments와 분리한 이유 — 공식 목록(atom_rows 근거)과
 * 실무 보충 지식(이번에 추가)의 신뢰 수준이 다르다는 걸 API로도 구분
 * 해두는 게 나중에 atom_rows가 갱신될 때 헷갈리지 않는다.
 */
export function getMissingEvidence(procedureId, opts = {}) {
  const evidence = PROCEDURE_EVIDENCE_DOCS[procedureId] || [];
  const { provided } = getProcedureProgress(procedureId, opts);
  return evidence.filter(label => !provided[label]);
}
