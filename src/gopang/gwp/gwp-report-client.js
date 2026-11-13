/**
 * src/gopang/gwp/gwp-report-client.js — GWP 세션 종료 보고 공통 모듈
 *
 * 배경(2026-07-09): K-서비스 15개 중 9개(market/police/public/health/tax/
 * traffic/logistics/democracy/insurance/911)가 완전히 동일한 41줄짜리
 * _reportSessionEnd() 함수를 각자 저장소에 복사해서 갖고 있었다(md5 대조로
 * 100% 일치 확인). klaw/school/stock/gdc/security 5곳과 jeju는 아예 없어서
 * 보고 없이 탭이 닫히면 AI 비서가 결과를 전혀 모르는 상태였다.
 *
 * "각자 복사" 구조에서는 로직을 한 곳만 고치면 나머지는 안 고쳐지는 사고가
 * 반복된다(SP_lawyer 버전 고정, call-ai.js manifest 로더 중복과 동일 패턴).
 * 이 파일은 그 복사본들을 단일 소스로 통합한다 — auth/subsystem-auth.js가
 * 이미 쓰고 있는 크로스오리진 <script type="module" src="https://app.naviweb.kr/..."> 관행을
 * 그대로 따른다.
 *
 * 사용법 (각 K-서비스 webapp.html):
 *   <script type="module">
 *     import { reportGwpSessionEnd } from 'https://app.naviweb.kr/src/gopang/gwp/gwp-report-client.js';
 *     window._reportSessionEnd = (resultText, summaryLine) => reportGwpSessionEnd({
 *       agencyId: AGENCY_ID, guid: _govGuid(), messages: conversationState.messages,
 *       resultText, summaryLine, gwpMode: GWP_MODE, gwpOrigin: GWP_ORIGIN,
 *       sessionId: _sessionId, sessionStartedAt: _sessionStartedAt,
 *     });
 *   </script>
 * 기존 로컬 _reportSessionEnd() 정의는 삭제하고 호출부(대화 종료 지점)는
 * 그대로 둔다 — 함수 시그니처(resultText, summaryLine)를 그대로 유지했다.
 *
 * 사용법 (전문가 페르소나 세션, expert-session.js — 2026-07-20 신설):
 *   import { recordOwnerPDV } from 'https://app.naviweb.kr/src/gopang/gwp/gwp-report-client.js';
 *   await recordOwnerPDV({
 *     ownerAgency: EXPERT_REGISTRY[personaKey].ownerAgency,
 *     recordType: 'consultation', guid: userGuid,
 *     personaKey, personaVersion, what: summaryLine, how: outcomeType,
 *   });
 * 자세한 스키마·가드레일은 prompts/SP_PDV_v1_2.md §7 참조.
 */

const DEFAULT_PROXY = 'https://hondi-proxy.tensor-city.workers.dev';

// ── SHA-256 해시 유틸 (2026-08-20 신설) ─────────────────────────────────
// "서버는 사용자 데이터를 저장하면 안 됨, 오직 해시만"(주피터 지시).
// 이 파일의 세 기록 함수(reportGwpSessionEnd/recordOwnerPDV/
// recordUserPdvForExpert) 모두, 네트워크로 나가기 직전 콘텐츠를 이
// 함수로 해시화한다 — pdv/record.js에도 동일한 헬퍼가 있으나 이 파일은
// 독립 모듈(별도 오리진에서 <script type="module" src="https://app.naviweb.kr/...">
// 로 로드됨)이라 import로 공유하지 않고 각자 유지한다(기존 관례).
async function _sha256Hex(str) {
  const buf = new TextEncoder().encode(str ?? '');
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── keepalive-safe fetch (2026-07-26 신설) ──────────────────────────────
// 배경: reportGwpSessionEnd()/recordOwnerPDV()는 beforeunload/pagehide/
// visibilitychange 등 "탭이 곧 사라지는" 시점에 호출되는 경우가 실사용에서
// 드물지 않다(예: market/webapp.html의 비구매 상담 세션 종료 보고 —
// 2026-07-26). keepalive 없는 일반 fetch는 문서가 파괴되는 순간 브라우저가
// 요청을 중단시킬 수 있어, 이 시점의 보고가 조용히 유실될 위험이 있다.
// fetch의 keepalive 옵션은 sendBeacon과 동일하게 페이지 소멸 이후에도
// 요청 전송을 보장하지만, 대신 body 크기를 64KiB로 제한한다(스펙 규정) —
// 그 한도를 넘기면 브라우저가 요청 자체를 거부(reject)한다. 대화가 긴
// 세션의 transcript는 이 한도를 쉽게 넘을 수 있으므로, 안전 마진을 둔
// 크기 이하일 때만 keepalive를 켠다. 한도를 넘으면 기존과 동일하게
// keepalive 없이 보낸다 — 즉 이 변경은 순수 추가(additive)이며, 큰
// payload에 대해서는 지금까지의 동작을 그대로 유지해 기존 대비 나빠지는
// 경우가 없다.
const KEEPALIVE_BODY_LIMIT = 60000; // bytes — 64KiB 스펙 한도에 여유를 둠
function _fetchKeepaliveSafe(url, opts) {
  const bodyStr = typeof opts?.body === 'string' ? opts.body : '';
  let size = 0;
  try {
    size = new Blob([bodyStr]).size;
  } catch (e) {
    size = bodyStr.length; // Blob 불가 환경 폴백(대략치) — 과소평가 가능성 있어도 안전 쪽으로 keepalive 생략됨
  }
  const canKeepalive = size > 0 && size <= KEEPALIVE_BODY_LIMIT;
  return fetch(url, canKeepalive ? { ...opts, keepalive: true } : opts);
}

/**
 * @param {Object} opts
 * @param {string} opts.agencyId       - 서비스 식별자 (예: 'klaw', 'kschool')
 * @param {string} opts.guid           - 사용자 GUID (없으면 'anonymous')
 * @param {Array<{role:string, content:string}>} opts.messages - 대화 로그
 * @param {string} opts.resultText     - 마지막 AI 응답(요약에 포함됨)
 * @param {string} [opts.summaryLine]  - 6하원칙 what 필드로 쓸 한 줄 요약
 * @param {boolean} opts.gwpMode       - GWP 경유 여부(?gwp=1). false면 즉시 반환
 * @param {string} [opts.gwpOrigin]    - postMessage 대상 origin(없으면 '*')
 * @param {string} [opts.sessionId]    - 없으면 자동 생성
 * @param {string} [opts.sessionStartedAt] - 없으면 now
 * @param {string} [opts.proxyBase]    - PDV 리포트 프록시 base URL
 * @param {Array<{docType:string, fileName:string, mime:string, size:number,
 *   acquiredAt:string}>} [opts.attachedDocs] - HUMAN-AUTHORITY-GATE-SCHEMA
 *   G19(보조 경로, GWP_DOC_REQUEST)로 확보한 서류의 메타데이터만(원본
 *   base64는 포함하지 않음 — 이미 요청 탭 자신의 대화에 실려 kgov
 *   GOV_TASK_SUBMIT_REQUEST로 처리됐으므로 여기서는 G18(STAFF_REVIEW_GATE)
 *   산출물 번들에 "무엇을 확보했는지"만 남긴다). 같은 탭 첨부(§기본
 *   경로)로 확보한 서류는 이미 GOV_TASK_SUBMIT_REQUEST 쪽에 기록되므로
 *   여기 다시 넣지 않는다 — 중복 기록 방지.
 * @returns {Promise<{reported: boolean, sessionId: string}>}
 */
export async function reportGwpSessionEnd({
  agencyId,
  guid,
  messages = [],
  resultText = '',
  summaryLine = '',
  gwpMode,
  gwpOrigin = '',
  sessionId,
  sessionStartedAt,
  proxyBase = DEFAULT_PROXY,
  attachedDocs = [],
  how = 'completed', // 2026-07-20 신설 — §7 owner_pdv 기록용. 대부분 K-서비스는
                      // escalation 개념이 없으므로 기본값 'completed'. 필요한
                      // 서비스만 명시적으로 전달(값 종류는 §7.4 참조).
} = {}) {
  if (!gwpMode) return { reported: false, sessionId: null };
  if (!agencyId) throw new Error('[gwp-report-client] agencyId 필수');

  const now = new Date().toISOString();
  const sid = sessionId || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));
  const startedAt = sessionStartedAt || now;
  const resolvedGuid = guid || 'anonymous';

  const transcript = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => `[${m.role === 'user' ? '사용자' : 'AI'}] ${m.content}`)
    .concat(resultText ? [`[AI] ${resultText}`] : [])
    .join('\n\n');

  const whenObj = { period_start: startedAt, period_end: now };
  const whatText = summaryLine || `${agencyId} 상담 완료`;

  // (a) 서브시스템 자기 PDV — 대화 원문 "시간순 저장"이었으나, 2026-08-20
  // 설계 변경으로 서버는 콘텐츠를 저장하지 않는다. transcript는 더 이상
  // 서버로 전송되지 않고, SHA-256 해시만 전송한다 — K-서비스가 자기
  // 운영 목적으로 원문을 남기고 싶다면 자체 DB(각 서비스 report.js가
  // 이미 하고 있는 패턴, gopang_pdv_rules.md §1 참조)에 별도로 저장해야
  // 한다. pdv_records는 더 이상 그 역할을 하지 않는다.
  try {
    const transcriptHash = await _sha256Hex(JSON.stringify({ transcript, why: whatText }));
    await _fetchKeepaliveSafe(proxyBase + '/pdv/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        report: {
          svc: agencyId, type: 'conversation_transcript', session_id: sid,
          who: { ipv6: resolvedGuid, role: 'user' },
          when: whenObj,
          where: { svc_url: location.href },
          content_hash: transcriptHash,
        },
      }),
    });
  } catch (e) {
    console.warn('[PDV] 자기 기록 실패(무시):', e.message);
  }

  // (b) 나만의 AI 비서에게 6하원칙 보고 — engine.js가 사용자 PDV에 기록
  if (window.opener) {
    try {
      window.opener.postMessage(
        {
          type: 'GWP_DONE',
          summary: whatText,
          session_id: sid,
          reporter_svc: agencyId,
          pdvData: { who: resolvedGuid, when: whenObj, where: location.href, what: whatText, how: 'gwp', why: whatText },
          attachedDocs: Array.isArray(attachedDocs) && attachedDocs.length ? attachedDocs : undefined,
        },
        gwpOrigin || '*'
      );
    } catch (e) {
      console.warn('[GWP_DONE] 보고 실패(무시):', e.message);
    }
  }

  // (c) §7 기관측 PDV — 2026-07-20 신설. 여기 한 곳에서만 호출하면, 이미
  // reportGwpSessionEnd()를 쓰고 있는 K-서비스 15개+ 전원이 개별 수정 없이
  // 자동으로 owner_pdv에 consultation 레코드를 남긴다("모든 K-서비스가
  // 자신의 PDV에 기록하는 메커니즘"을 한 곳으로 일반화 — 각 서비스 webapp.html을
  // 일일이 고치는 대신 이미 다들 호출하는 공용 함수 안에 심는다).
  // persona_key는 항상 null — 이건 "K-서비스 자신"과의 직접 상담이고, 전문가
  // 페르소나 경유(expert-chat.html)는 recordOwnerPDV()를 별도로 직접 호출한다
  // (그쪽은 ownerAgency가 agencyId 자기 자신이 아니라 소유 K-서비스이므로 구분 필요).
  // guid가 없는 완전 익명 세션(resolvedGuid==='anonymous')은 §7.2 해싱 대상이
  // 아니므로 기록을 생략한다 — 억지로 "anonymous" 문자열을 해싱하면 그
  // K-서비스의 모든 익명 세션이 같은 who_hash로 뭉쳐 의미 없는 데이터가 된다.
  if (guid) {
    try {
      await recordOwnerPDV({
        ownerAgency: agencyId,
        recordType: 'consultation',
        guid,
        personaKey: null,
        personaVersion: null,
        what: whatText,
        how,
        when: startedAt,
        where: location.href,
        proxyBase,
      });
    } catch (e) {
      console.warn('[owner-pdv] 자동 기록 실패(무시):', e.message);
    }
  }

  return { reported: true, sessionId: sid };
}

/**
 * recordOwnerPDV — §7(기관측 PDV, SP_PDV v1.2) 기록 함수 (2026-07-20 신설)
 *
 * reportGwpSessionEnd()의 (a) "서브시스템 자기 PDV"와 목적이 다르다: 그쪽은
 * K-서비스가 실명 GUID + 원문 전체를 자기 운영용으로 남기는 기존 메커니즘이고,
 * 이 함수는 소유 K-서비스(ownerAgency)가 만족도/성과 분석·SP 개정 근거로 쓰는
 * 가명화·요약 전용 거버넌스 레코드를 남긴다. 둘은 별개이며 서로 대체하지 않는다.
 *
 * 호출 주체는 두 종류다:
 *   - 전문가 페르소나 세션 (expert-session.js): recordType='consultation',
 *     personaKey/personaVersion 필수, guid 필수(해싱 대상).
 *   - K-서비스 자신의 고유 산출물 (예: K-Law 가상 판결문): recordType='own_output',
 *     personaKey/personaVersion 없음, guid는 특정 상대가 없으면 생략 가능.
 *
 * 중요 — guid는 여기서 평문 그대로 프록시로 전송된다. §7.2의 who_hash =
 * SHA256(userGuid + ownerAgency_salt) 계산은 반드시 프록시(Worker, salt는
 * 서버 비밀)에서 수행해야 한다. 클라이언트에서 해시하면 salt가 번들에
 * 노출되어 GUID(uuidv5(phone_number), 결정론적)를 전화번호 전수조사로
 * 역산할 수 있게 되므로 "역추적 불가" 원칙이 무력화된다 — 프록시 구현은
 * 이 저장소 범위 밖(별도 인프라 레포)이며, 반드시 해시 후에만
 * `<ownerAgency>_pdv`에 저장해야 한다(원문 guid를 그대로 영속화 금지).
 *
 * @param {Object} opts
 * @param {string} opts.ownerAgency        - 소유 K-서비스 id (예: 'klaw'). expert-registry.js의 ownerAgency와 동일
 * @param {'consultation'|'own_output'} [opts.recordType='consultation']
 * @param {string} [opts.guid]             - 사용자 GUID (consultation이면 필수, 프록시에서 해싱됨)
 * @param {string} [opts.personaKey]       - consultation일 때만 (예: 'lawyer')
 * @param {string} [opts.personaVersion]   - 세션 시점 SP 버전 (예: 'v4.1')
 * @param {string} opts.what               - 무엇을 처리했는지 1문장 요약
 * @param {'completed'|'escalated_success'|'escalated_ai_limit'|'early_exit'} opts.how
 * @param {string} [opts.why]              - 목적 태그
 * @param {string} [opts.when]             - 없으면 now
 * @param {string} [opts.where]            - 없으면 location.href
 * @param {string} [opts.proxyBase]
 * @returns {Promise<{recorded: boolean, recordId: string}>}
 */
export async function recordOwnerPDV({
  ownerAgency,
  recordType = 'consultation',
  guid,
  personaKey = null,
  personaVersion = null,
  what,
  how,
  why = null,
  when,
  where,
  detail = null, // 2026-07-20 신설 — own_output 전용 구조화 데이터(K-서비스마다
                  // 스키마가 다름). 예: K-Law 판결문 { case_no, klaw_version,
                  // score_total, grade }. consultation이면 항상 무시(null)된다.
  outcomeSignals = null, // 2026-07-20 신설(#4) — 문장/단어 판독이 아닌 구조화된
                  // 행동 신호. 예: { explicit_rating: 'up'|'down' }. consultation/
                  // own_output 공통으로 쓸 수 있다.
  proxyBase = DEFAULT_PROXY,
} = {}) {
  if (!ownerAgency) throw new Error('[gwp-report-client] recordOwnerPDV: ownerAgency 필수');
  if (recordType === 'consultation' && !guid) {
    throw new Error('[gwp-report-client] recordOwnerPDV: consultation 레코드는 guid 필수(해싱은 프록시가 수행)');
  }
  if (!what || !how) {
    throw new Error('[gwp-report-client] recordOwnerPDV: what/how 필수');
  }

  const now = new Date().toISOString();
  // 2026-08-20 — what/why/detail은 콘텐츠(사용자 데이터)이므로 해시로만
  // 전송한다. how는 고정된 카테고리 값(§7.4의 4개 enum 중 하나)이라
  // 예외 — 상태 코드지 사용자 콘텐츠가 아니다.
  const detailObj = recordType === 'own_output' ? (detail || null) : null;
  const [whatHash, whyHash, detailHash] = await Promise.all([
    _sha256Hex(what),
    why ? _sha256Hex(why) : Promise.resolve(null),
    detailObj ? _sha256Hex(JSON.stringify(detailObj)) : Promise.resolve(null),
  ]);
  const record = {
    record_id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2),
    record_type: recordType,
    owner_agency: ownerAgency,
    persona_key: recordType === 'consultation' ? personaKey : null,
    persona_version: recordType === 'consultation' ? personaVersion : null,
    guid_for_hashing: guid || null, // 프록시가 해싱 후 폐기 — owner_pdv에는 who_hash만 저장
    when: when || now,
    where: where || (typeof location !== 'undefined' ? location.href : null),
    what_hash: whatHash,
    how,
    why_hash: whyHash,
    detail_hash: detailHash,
    outcome_signals: outcomeSignals || null,
    source_ref: null, // 원문 미저장 원칙(SP_PDV §1/§7.3)
    confidence: 1,
  };

  try {
    const res = await _fetchKeepaliveSafe(proxyBase + '/owner-pdv/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ record }),
    });
    return { recorded: res.ok, recordId: record.record_id };
  } catch (e) {
    console.warn('[owner-pdv] 기록 실패(무시):', e.message);
    return { recorded: false, recordId: record.record_id };
  }
}

/**
 * recordUserPdvForExpert — 갭① 보완 (2026-08-20 신설)
 *
 * 배경: expert-chat.html(_recordExpertOwnerPDV)은 지금까지 recordOwnerPDV()
 * (§7 기관측 PDV, 가명화 요약)만 호출했다 — reportGwpSessionEnd()의 (a)
 * "서브시스템 자기 PDV"·(b) "사용자 PDV" 두 경로가 EXPERT 페르소나 경로에는
 * 아예 없었다(실사로 확인). 그 결과 전문가 페르소나와의 상담은 사용자
 * 본인의 "나의 기록 금고"(pdv_records)에 단 한 건도 남지 않고 있었다 —
 * 기관측 가명화 로그(owner_pdv)에만 존재해 본인도 조회할 수 없는 상태였다.
 *
 * reportGwpSessionEnd()의 (a) 경로와 동일하게 /pdv/report를 직접 호출한다.
 * 다만 대화 원문 전체(transcript)는 보내지 않는다 — EXPERT 상담은 K-서비스
 * 자체 상담보다 민감한 내용(의료·법률 등)이 섞일 가능성이 높고, 원문은
 * 이미 owner_pdv 쪽 가명화 원칙(§7.3 원문 미저장)과 결이 다르게 사용자측에
 * 평문으로 쌓이는 셈이라 요약 한 줄(what)만 남긴다 — GWP 경로보다 보수적.
 *
 * @param {Object} opts
 * @param {string} opts.ownerAgency - 소유 K-서비스 id (svc 필드로 저장됨)
 * @param {string} opts.personaKey  - 상담한 전문가 페르소나 (예: 'lawyer-tax')
 * @param {string} opts.guid        - 사용자 GUID
 * @param {string} opts.what        - 1문장 요약
 * @param {string} [opts.why]
 * @param {string} [opts.when]      - 세션 시작 시각(없으면 now)
 * @param {string} [opts.where]
 * @param {string} [opts.proxyBase]
 * @returns {Promise<{recorded: boolean}>}
 */
export async function recordUserPdvForExpert({
  ownerAgency,
  personaKey,
  guid,
  what,
  why = null,
  when,
  where,
  proxyBase = DEFAULT_PROXY,
} = {}) {
  if (!ownerAgency || !personaKey || !guid || !what) {
    console.warn('[PDV] recordUserPdvForExpert: ownerAgency/personaKey/guid/what 필수 — 호출 무시');
    return { recorded: false };
  }
  const now = new Date().toISOString();
  try {
    // 2026-08-20 — what/why(상담 요약 한 줄)는 콘텐츠라 해시로만 전송한다.
    const contentHash = await _sha256Hex(JSON.stringify({ what, why: why || what }));
    const res = await _fetchKeepaliveSafe(proxyBase + '/pdv/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        report: {
          svc: ownerAgency, type: 'expert_consultation', persona_key: personaKey,
          who: { ipv6: guid, role: 'user' },
          when: { period_start: when || now, period_end: now },
          where: { svc_url: where || (typeof location !== 'undefined' ? location.href : null) },
          content_hash: contentHash,
        },
      }),
    });
    return { recorded: res.ok };
  } catch (e) {
    console.warn('[PDV] recordUserPdvForExpert 실패(무시):', e.message);
    return { recorded: false };
  }
}

/**
 * queryOwnerPdvSelfHistory — §U0-1(UNIVERSAL-common 제1원칙) "즉시조회
 * 가능성" 구현 (2026-08-10 신설)
 *
 * recordOwnerPDV()가 쌓아온 자기 기관(ownerAgency)의 과거 상담 기록
 * 중, 지금 이 사용자(guid)와 나눈 것만 요약해서 돌려받는다. U8의
 * /pdv/query(타 기관 데이터에 대한 동의 기반 접근)와는 다르다 — 이건
 * "같은 기관이 자기 자신의 과거 기록을 보는" 것이라 기관 간 교차가
 * 전혀 없고, 그래서 동의 절차도 없다.
 *
 * 호출 시점 권장: 세션 시작 시(첫 인사말을 만들기 전) 1회 — U0-2/U8-2가
 * "인사말은 이 조회 결과가 나온 뒤에 구성한다"고 요구하는 바로 그
 * 지점이다.
 *
 * @param {Object} opts
 * @param {string} opts.ownerAgency        - 소유 K-서비스 id (예: 'kedu')
 * @param {string} opts.guid               - 사용자 GUID (해싱은 프록시가 수행)
 * @param {string} [opts.personaKeyPrefix] - 특정 페르소나 계열로 좁히고 싶을 때(예: 'professor'). 생략하면 이 ownerAgency의 모든 persona_key를 다 본다
 * @param {number} [opts.limit=5]          - 최근 몇 건까지 받을지(최대 20)
 * @param {string} [opts.proxyBase]
 * @returns {Promise<{ok: boolean, found: boolean, totalVisits?: number, recent?: Array}>}
 *   실패 시에도 throw하지 않고 {ok:false}를 돌려준다 — 호출부가 U2
 *   정신대로 "조회 실패, 새로 시작"을 정직하게 처리하도록.
 */
export async function queryOwnerPdvSelfHistory({
  ownerAgency,
  guid,
  personaKeyPrefix = null,
  limit = 5,
  proxyBase = DEFAULT_PROXY,
} = {}) {
  if (!ownerAgency || !guid) {
    console.warn('[owner-pdv] queryOwnerPdvSelfHistory: ownerAgency/guid 필수 — 조회 생략');
    return { ok: false, found: false };
  }
  try {
    const res = await fetch(proxyBase + '/owner-pdv/self-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        owner_agency: ownerAgency,
        guid_for_hashing: guid,
        persona_key_prefix: personaKeyPrefix,
        limit,
      }),
    });
    if (!res.ok) {
      // 2026-08-20 — 해시 전용 재설계로 이 엔드포인트는 서버에서 410을
      // 반환하도록 의도적으로 바뀌었다(U0-2 서버측 제거, 기기 로컬
      // 재구현 전까지). 기존의 "실패 시 새 세션으로 진행" 폴백이 그대로
      // 이 상황도 우아하게 처리한다 — 별도 분기 불필요.
      console.warn('[owner-pdv] 자기이력 조회 실패(무시 — 새 세션으로 진행):', res.status);
      return { ok: false, found: false };
    }
    return await res.json();
  } catch (e) {
    console.warn('[owner-pdv] 자기이력 조회 예외(무시 — 새 세션으로 진행):', e.message);
    return { ok: false, found: false };
  }
}

