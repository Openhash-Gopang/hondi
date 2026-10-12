/**
 * pdv-consent.js
 * ---------------------------------------------------------------------------
 * PDV 동의 SDK 공통 모듈 (레이어 A)
 *
 * 기존 pdv-history-client.js(13개 서비스 연동 완료)를 확장하는 신규 모듈.
 * 기존 파일을 직접 수정하지 않고, requestPDVConsent()를 이 파일에서 export하여
 * pdv-history-client.js가 내부적으로 import해 쓰도록 설계했다.
 * (기존 클라이언트 코드를 보지 못한 상태에서 작성했으므로, 실제 통합 시
 *  pdv-history-client.js 쪽에서 이 모듈을 import하는 한 줄만 추가하면 된다.)
 *
 * 참조: 나비-공무원직무보조-시스템갱신계획_v1.0_2026-07-14.md §5 레이어 A
 * ---------------------------------------------------------------------------
 */

/**
 * 확정된 PDV scope enum (20종)
 * §3 매핑표(58건)에서 실제로 등장한 scope만 반영했다.
 * 신규 scope 추가 시 이 목록과 GOV24_API_MAP(레이어 B)을 함께 갱신할 것.
 */
const PDV_SCOPES = Object.freeze({
  RESIDENT_REGISTRATION: 'resident-registration',   // 전입신고, 세대주변경, 초등입학통지 (1,8,98)
  FAMILY_RELATION: 'family-relation',                // 가족관계, 양육수당, 다자녀 (2,16,19)
  EMPLOYMENT_INSURANCE: 'employment-insurance',      // 재직증명, 실업급여 (3,17)
  HEALTH_INSURANCE: 'health-insurance',              // 건강보험 자격득실 (4)
  CRIMINAL_RECORD_CONSENT: 'criminal-record-consent',// 범죄경력 조회 동의, 택시면허 (5,53)
  TAX_COMPLETION: 'tax-completion',                  // 국세완납증명 (6)
  LOCAL_TAX_COMPLETION: 'local-tax-completion',      // 지방세완납증명, 새올 연동상태 확인 필요 (7)
  REAL_ESTATE_REGISTRY: 'real-estate-registry',      // 부동산 등기사항 (9)
  MILITARY_SERVICE: 'military-service',              // 병역사항, 예비군통지 (10,99)
  FINANCIAL_STATEMENT: 'financial-statement',        // 재무제표(기초수급,건보료,장학금,전세대출,여행업자본금) (11,12,13,15,52)
  IDENTITY: 'identity',                              // 본인인증(장애인등록,사업자등록,주민증재발급,여권재발급) (18,49,93,100)
  LEASE_CONTRACT: 'lease-contract',                  // 임대차계약(주거급여) (20)
  BUSINESS_REGISTRY: 'business-registry',            // 사업자등록(음식점신고,폐업,겸직점검,개인정보처리방침) (46,50,55,87)
  DOCUMENT_COMPLETENESS: 'document-completeness',    // 서류완비확인(건축허가,옥외광고물) (47,54)
  VEHICLE_REGISTRY: 'vehicle-registry',              // 차량등록(이전등록,정기검사) (48,95)
  TRAFFIC_VIOLATION: 'traffic-violation',            // 주정차위반 이의신청 (51)
  E_SIGNATURE: 'e-signature',                        // 전자서명(인감대체,혼인신고) (94,97)
  PENSION_HISTORY: 'pension-history',                // 국민연금 이력(예상수령액) (96)
  EMERGENCY_CONTACT: 'emergency-contact',            // 비상연락처(교통사고시 가족연락) (80)
  HEALTH_CONDITION_OPTIN: 'health-condition-optin',  // 건강상태 옵트인(백신안내,미세먼지알림) (78,83)
  DISASTER_SUPPORT_OPTIN: 'disaster-support-optin',  // 재난지원 옵트인(대피,안전확인) (76,77,81,82,84) - Phase 3 선행과제
});

/**
 * 목적 태그 enum — 92번(조회 로그 감사)의 원천 데이터가 되는 목적구속 태그.
 * 새 업무 유형 추가 시 반드시 이 목록에 목적을 등록해야 조회가 허용된다.
 */
const PURPOSE_TAGS = Object.freeze({
  CIVIL_SERVICE_ISSUANCE: 'civil-service-issuance',       // 순수 증명서 발급성 (트랙 A, J 대부분)
  ELIGIBILITY_REVIEW: 'eligibility-review',                // 자격 심사 (트랙 B, E 일부)
  PERMIT_REVIEW: 'permit-review',                          // 인허가 심사 (트랙 E)
  SAFETY_NOTIFICATION: 'safety-notification',              // 개인별 안전 알림 (트랙 H 해결됨 항목)
  INTERNAL_AUDIT_CROSS_CHECK: 'internal-audit-cross-check',// 겸직점검 등 감사성 대조 (87)
});

/**
 * @typedef {Object} PDVConsentToken
 * @property {string} token_id
 * @property {string} citizen_id
 * @property {string} scope          - PDV_SCOPES 중 하나
 * @property {string} purpose        - PURPOSE_TAGS 중 하나
 * @property {string} requested_by   - 담당공무원 GPKI 직무 인증 ID
 * @property {string} requested_at   - ISO8601
 * @property {string} expires_at     - ISO8601 (기본 요청 처리 시점 + 1시간, 업무별 조정 가능)
 * @property {boolean} approved
 */

/**
 * 담당공무원의 PDV 조회 요청을 시민에게 동의 요청으로 전달하고,
 * 승인 시 스코프 토큰을 발급한다.
 *
 * 반드시 "이 담당공무원이 이 시각에 이 목적으로 요청했다"는 사실이
 * 트리거로 남아야 한다는 원칙(GWP_REGISTRY 기관용 AC 설계 원칙 ②)을
 * 그대로 따른다 — AC가 스스로 판단해 조회하는 경로는 없다.
 *
 * @param {string} citizenId
 * @param {string} scope        - PDV_SCOPES 값 중 하나. 목록 밖 값은 즉시 reject.
 * @param {string} purpose      - PURPOSE_TAGS 값 중 하나.
 * @param {Object} requester
 * @param {string} requester.officialId   - GPKI 직무 인증 ID
 * @param {string} requester.deptSpId     - 요청 주체 SP ID (예: SP-EMD-HALLIM)
 * @returns {Promise<PDVConsentToken>}
 */
async function requestPDVConsent(citizenId, scope, purpose, requester) {
  if (!Object.values(PDV_SCOPES).includes(scope)) {
    throw new Error(`INVALID_SCOPE: '${scope}' is not a registered PDV scope`);
  }
  if (!Object.values(PURPOSE_TAGS).includes(purpose)) {
    throw new Error(`INVALID_PURPOSE: '${purpose}' is not a registered purpose tag`);
  }
  if (!requester || !requester.officialId || !requester.deptSpId) {
    throw new Error('MISSING_REQUESTER: officialId and deptSpId are required (no AC self-triggered queries allowed)');
  }

  const requestRecord = {
    citizen_id: citizenId,
    scope,
    purpose,
    requested_by: requester.officialId,
    requested_from_sp: requester.deptSpId,
    requested_at: new Date().toISOString(),
  };

  // 92번(조회 로그 감사)의 원천 이벤트 — 승인/거절 결과와 무관하게 요청 자체를 먼저 기록한다.
  await writeAuditLog({ event: 'PDV_CONSENT_REQUESTED', ...requestRecord });

  // 실제 시민 동의 UX(푸시 알림 → 승인/거절)는 기존 GWP postMessage 인프라를 통해 처리.
  // 이 함수는 그 결과를 받아 토큰을 발급하는 지점까지만 담당한다.
  const approved = await dispatchConsentRequestToCitizen(requestRecord);

  const token = {
    token_id: generateTokenId(),
    citizen_id: citizenId,
    scope,
    purpose,
    requested_by: requester.officialId,
    requested_at: requestRecord.requested_at,
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 기본 1시간
    approved,
  };

  await writeAuditLog({
    event: approved ? 'PDV_CONSENT_APPROVED' : 'PDV_CONSENT_DENIED',
    token_id: token.token_id,
    ...requestRecord,
  });

  return token;
}

/**
 * 실제 시민 동의 알림 전송 — GWP postMessage 인프라 연동 지점 (구현 필요).
 * 지금은 인터페이스만 정의한다.
 * @param {Object} requestRecord
 * @returns {Promise<boolean>}
 */
async function dispatchConsentRequestToCitizen(requestRecord) {
  throw new Error('NOT_IMPLEMENTED: GWP postMessage 동의 알림 연동 필요 — Phase 1에서 구현');
}

/**
 * 92번 감사 로그 기록 지점 — audit-log-schema.js의 writeAuditLog와 동일 인터페이스.
 * @param {Object} entry
 */
async function writeAuditLog(entry) {
  throw new Error('NOT_IMPLEMENTED: 온나라시스템 감사 로그 연동 필요 — audit-log-schema.js 참조, Phase 4에서 구현');
}

function generateTokenId() {
  return `pdvc_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

module.exports = {
  PDV_SCOPES,
  PURPOSE_TAGS,
  requestPDVConsent,
};
