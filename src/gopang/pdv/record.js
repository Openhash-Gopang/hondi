/**
 * pdv/record.js — PDV 기록·체인·Supabase 연동
 */
import { USER_GUID, _USER, _userLocation } from '../core/state.js';
import { CFG } from '../core/config.js';
// ★ 2026-07-30 버그 수정 — 아래 221행 부근에서 _klawReview를 호출하는데
// import가 없어 실행 시 "Uncaught ReferenceError: _klawReview is not
// defined"로 매번 터졌다(실제 wrangler tail·브라우저 콘솔로 확인).
// klaw.js가 이 파일의 _recordPDV를 다시 참조하는 순환 참조이지만,
// 양쪽 다 즉시실행이 아니라 setTimeout/함수 본문 내부의 지연 호출이라
// ESM의 라이브 바인딩 특성상 안전하다.
import { _klawReview } from '../services/klaw.js';
// (2026-07-19: _recordPDV()는 /pdv/report 경유로 이관 완료. 아래
//  _patchL1LedgerUserHash/_patchPdvChainHeight는 대응하는 worker.js
//  엔드포인트가 아직 없어 Supabase 직접 접근이 남아있다 — §미해결 블로커.)

// ── PDV 일상/업무 영역 모드 — AC-EVOLUTION_v1_1.md §PDV-SPLIT ──────────
// 시간대 기반 자동전환은 쓰지 않는다(AC-EVOLUTION-GAPS #13 — 자동전환은
// 근무시간이 불규칙한 대부분의 직종에서 틀리기 쉽고, 조용히 틀리면
// 사고(#12류 정보 혼입)로 이어진다). 오직 명시적 전환만 인정 —
// AGENT-COMMON이 사용자의 "업무 시작"/"퇴근했어요" 류 발화를 감지해
// [PDV_DOMAIN_SET: mode=work|personal] 태그로 알려주면 그때만 바뀐다.
// 세션을 새로 열면 항상 personal로 리셋(다음 세션에 이전 업무모드가
// 새어나가지 않도록 — 과소분류가 과다노출보다 안전하다는 원칙 재적용).
const _PDV_DOMAIN_KEY = 'gopang_pdv_domain_mode'; // sessionStorage — 세션 종료 시 자동 초기화

export function getPdvDomain() {
  try { return sessionStorage.getItem(_PDV_DOMAIN_KEY) === 'work' ? 'work' : 'personal'; }
  catch { return 'personal'; }
}

export function setPdvDomain(mode, affiliationOrgId = null) {
  const m = mode === 'work' ? 'work' : 'personal';
  try {
    sessionStorage.setItem(_PDV_DOMAIN_KEY, m);
    sessionStorage.setItem(_PDV_DOMAIN_KEY + '_org', m === 'work' ? (affiliationOrgId || '') : '');
  } catch (e) { console.warn('[PDV] 도메인 모드 저장 실패:', e.message); }
}

function _currentAffiliationOrgId() {
  try { return sessionStorage.getItem(_PDV_DOMAIN_KEY + '_org') || null; }
  catch { return null; }
}

// ── SHA-256 해시 유틸 (2026-08-20 신설) ─────────────────────────────────
// "서버는 사용자 데이터를 저장하면 안 됨, 오직 해시만"(주피터 지시)에
// 따라, 서버로 나가는 모든 PDV 콘텐츠(what/why/how 프로즈)는 이 함수를
// 거쳐 해시로 치환된 뒤에만 전송한다. 원문 자체는 이 함수를 벗어나지
// 않는다 — 로컬 저장(localStorage/IndexedDB)은 이 변경과 무관하게 계속
// 원문을 보관한다(기기 로컬 보관 자체는 원래 설계 그대로).
async function _sha256Hex(str) {
  const buf = new TextEncoder().encode(str ?? '');
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── recordPDV — 하위 시스템 공통 PDV 표준 함수 (STEP 20) ────────
// 설계 원칙 P2: 모든 하위 시스템 PDV는 Worker /pdv/report 경유 필수
// 하위 시스템(market, gdc 등)이 window.recordPDV()를 호출하면
// Worker가 수신 → Supabase pdv_log INSERT + OpenHash 앵커링 처리
//
// @param {Object} report — 6하 원칙 포함 PDV 리포트 객체
//   필수: report.who.ipv6, report.what, report.why, report.svc
//   선택: report.block_hash (동기 앵커링 시 포함)
//         report.session_id (중복 방지용, STEP 11)
//         report.reporter_svc (보고 주체 서비스 ID)
// @returns {Promise<Response>}
export async function recordPDV({ report }) {
  if (!report) {
    console.warn('[recordPDV] report 객체 누락 — 호출 무시');
    return;
  }
  // AC-EVOLUTION_v1_1.md §PDV-SPLIT — 호출부가 명시하지 않으면 현재
  // 세션 모드를 그대로 태깅한다(하위 시스템이 매번 신경 쓰지 않아도
  // 되도록 기본값을 여기서 채움).
  if (!report.domain) report.domain = getPdvDomain();
  if (report.domain === 'work' && !report.affiliation_org_id) {
    report.affiliation_org_id = _currentAffiliationOrgId();
  }
  // 2026-08-20 신설 — 하위 시스템(market/school/klaw 등)의 report.js가
  // 여전히 what.summary 등에 프로즈를 담아 이 공유 함수를 호출하더라도
  // (각자 report.js가 원본을 자기 DB에 보관하는 건 그대로 정상 — §7.3
  // 원칙과 무관), 네트워크로 나가기 직전 여기 한 곳에서 콘텐츠를 해시로
  // 치환한다. 16개 K-서비스 report.js를 개별 수정할 필요 없이 이 공유
  // 함수만 고치면 전체에 적용된다.
  const narrative = JSON.stringify({
    what: report.what?.summary ?? null,
    why:  report.why?.goal ?? null,
    how:  report.how?.method ?? null,
  });
  const contentHash = await _sha256Hex(narrative);
  const sanitizedReport = { ...report, what: undefined, why: undefined, how: undefined, content_hash: contentHash };
  try {
    const res = await fetch(CFG.endpoint + '/pdv/report', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ report: sanitizedReport }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => res.status);
      console.warn('[recordPDV] Worker 오류:', res.status, err);
    } else {
      console.info('[recordPDV] Worker 전송 완료 | svc:', report.svc,
                   '| reporter_svc:', report.reporter_svc || '-',
                   '| session_id:', report.session_id || '-');
    }
    return res;
  } catch(e) {
    console.warn('[recordPDV] 네트워크 오류 (무시):', e.message);
  }
}
// 전역 노출 — 하위 시스템(market, gdc, kinsurance 등) window.recordPDV()로 접근
window.recordPDV = recordPDV;

// ── PDV 최근 요약 — 동적 ctx 주입용 (call-ai.js _buildLocNote와 동일 위치에 삽입) ──
// 그림자가 "PDV에서 인출"한다고 말해도 실제로 LLM은 IndexedDB/localStorage에
// 접근할 수 없으므로, 매 턴 최근 PDV 항목을 텍스트로 압축해 [ctx]에 동봉한다.
// 정적 system 프롬프트에는 절대 굽지 않는다(PDV는 계속 자라므로 캐시 prefix를
// 깨뜨리고, 오래된 정보가 영구 고정되는 문제가 생긴다 — 동적 주입만 사용).
const _PDV_NOTE_MAX_ITEMS = 8;
const _PDV_NOTE_MAX_CHARS = 500;

export function _buildPDVNote() {
  let log;
  try { log = JSON.parse(localStorage.getItem('gopang_pdv_log') || '[]'); }
  catch { return ''; }
  if (!Array.isArray(log) || !log.length) return '';

  // AC-EVOLUTION-GAPS #12 패치 — 현재 모드와 다른 도메인의 기록은 애초에
  // 이 턴의 컨텍스트에 넣지 않는다. domain 미기재 항목(패치 이전 기록)은
  // 'personal'로 취급 — 과거 데이터가 업무모드에 새어 들어가는 것보다
  // 개인모드에 남는 쪽이 안전하다.
  const mode = getPdvDomain();
  const curOrg = mode === 'work' ? _currentAffiliationOrgId() : null;
  const scoped = log.filter(r => {
    const d = r.domain === 'work' ? 'work' : 'personal';
    if (d !== mode) return false;
    // 업무모드에서도 "지금 이 소속" 기록만 보여준다 — 겸직 시 다른
    // 소속의 업무 기록이 섞여 들어가는 것도 막는다(AC-EVOLUTION §1 겸직 지원).
    if (mode === 'work' && curOrg && r.affiliation_org_id && r.affiliation_org_id !== curOrg) return false;
    return true;
  });

  const recent = scoped.slice(-_PDV_NOTE_MAX_ITEMS).reverse(); // 최신순
  const lines = [];
  let used = 0;
  for (const r of recent) {
    const summary = (r.summary || r.what || r.data?.location || '').toString().slice(0, 60);
    if (!summary) continue;
    const line = `· ${summary}`;
    if (used + line.length > _PDV_NOTE_MAX_CHARS) break;
    lines.push(line);
    used += line.length;
  }
  if (!lines.length) return '';
  const domainLabel = mode === 'work' ? '업무' : '일상';
  return `\n\n[PDV 최근 기록(${domainLabel} 영역) — 참고용, 추측 금지]\n` + lines.join('\n');
}


// 나비 내부 전용. /pdv/report 경유(위 recordPDV()와 동일 경로, 2026-07-19 이관).
// 하위 시스템은 위 recordPDV()를 직접 사용.
export async function _recordPDV(record) {
  try {
    // AC-EVOLUTION_v1_1.md §PDV-SPLIT — 호출부가 명시 안 하면 현재 모드로.
    if (!record.domain) record.domain = getPdvDomain();
    if (record.domain === 'work' && !record.affiliation_org_id) {
      record.affiliation_org_id = _currentAffiliationOrgId();
    }
    // ── 로컬 PDV 캐시 (localStorage) ──────────────────────
    const log = JSON.parse(localStorage.getItem('gopang_pdv_log') || '[]');
    log.push(record);
    if (log.length > 1000) log.splice(0, log.length - 1000);
    localStorage.setItem('gopang_pdv_log', JSON.stringify(log));

    // ── IndexedDB 미러 갱신 트리거 (2026-07-02) ─────────────
    // pdv-store.js가 이 이벤트를 받아 gopang_pdv_store(IndexedDB)에 반영한다.
    // webapp.html에서만 의미 있음(그쪽에만 실제 record 이벤트가 흐름) —
    // pdv-store.js 쪽 리스너는 이미 구현돼 있었고 발행부만 빠져 있었음.
    try {
      window.dispatchEvent(new CustomEvent('gopang:pdv-recorded', { detail: record }));
    } catch (e) {
      console.warn('[PDV] gopang:pdv-recorded 이벤트 발행 실패:', e.message);
    }

    // ── 6하 원칙 필드 구성 ─────────────────────────────────
    // 누가 (Who) — P17: guid 방어코드
    const _effectiveGuid = _USER?.guid || _USER?.ipv6 || null;
    const whoName = _USER?.phone
      ? _USER.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
      : 'GUID:' + (_effectiveGuid?.slice(0, 8) ?? 'unknown');

    // 어디서 (Where) — GPS 우선, 주소 fallback
    const locStr = _userLocation
      ? (_userLocation.address ||
         (_userLocation.lat
           ? `${_userLocation.lat.toFixed(5)},${_userLocation.lng.toFixed(5)}`
           : null))
      : (record.data?.location || null);

    // 어떻게 (How) — 입력 방식 추론
    const howStr = record.how
      || (record.data?.reportId  ? 'image'
        : record.type === 'klaw_monitor' ? 'auto'
        : 'text');

    // 왜 (Why) — 서비스명 또는 직접 기록된 의도
    const whyStr = record.why
      || (record.service ? record.service + ' 서비스 이용'
        : record.type === 'klaw_monitor' ? '법적 리스크 자동 감시'
        : record.type === 'service_task' ? '서비스 작업 완료'
        : '대화');

    // ── L1 PocketBase(pdv_records) 저장 — Worker /pdv/report 경유 ──────
    // (2026-07-19: Supabase pdv_log 직접 INSERT 제거. 바로 위 recordPDV()가
    //  이미 이 경로로 정상 이관돼 있었는데 _recordPDV만 옛 방식으로 남아있던
    //  것을 발견해 통일한다. handlePdvReport(worker.js)가 기대하는 report
    //  스키마에 맞춰 6하원칙 필드를 구성한다.)
    // 2026-08-20 — 서버로 프로즈를 보내지 않는다. what/why/how는 로컬
    // 캐시(위 gopang_pdv_log)에만 남고, 서버로는 SHA-256 해시만 전송된다.
    // record.chain_local_hash는 별개 목적(GDC 체인 해시)이라 콘텐츠
    // 해시와 혼동하지 않도록 필드명을 분리한다(content_hash로 통일).
    const narrative = JSON.stringify({
      what: record.what || record.summary || null,
      why:  whyStr,
      how:  howStr,
    });
    const contentHash = await _sha256Hex(narrative);
    const res = await fetch(CFG.endpoint + '/pdv/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        report: {
          svc:  'gopang',
          type: record.type,
          who:   { role: 'user', ipv6: _effectiveGuid },
          where: { svc_url: locStr || undefined },
          session_id:        record.session_id        ?? null,
          reporter_svc:      null,
          domain:            record.domain             ?? 'personal',
          affiliation_org_id: record.affiliation_org_id ?? null,
          block_hash:        record.block_hash         ?? null,
          content_hash:      contentHash,
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.status);
      console.warn('[PDV] Worker 오류:', res.status, err);
    } else {
      console.info('[PDV] 기록 완료:', record.type,
        '| session_id:', record.session_id?.slice(0, 8) || '-',
        '| chain_height:', record.chain_height ?? '-');
    }
  } catch(e) { console.warn('[PDV] 기록 실패:', e.message); }

  // K-Law 백그라운드 감시 트리거 — 서비스 완료 결과 자동 검토
  if (record.type === 'service_task' && record.serviceId !== 'klaw') {
    setTimeout(() => _klawReview('service', record), 2000);
  }
}

// ── project_state 저장/조회 (2026-07-17 신설 — mode=project human_action
// 일시정지·재개, SP-19 v1.2/SP-20 v1.6/SP-22 v1.1). worker.js
// /orchestration/project-state/* 경유 — L1 PocketBase project_states
// 컬렉션 직접 사용(일반 recordPDV의 pdv_records와는 별도 컬렉션).
export async function _saveProjectState(state) {
  if (!state?.project_id || !state?.goal || !state?.status) {
    console.warn('[ProjectState] 저장 무시 — project_id/goal/status 누락');
    return null;
  }
  try {
    const guid = _USER?.guid || _USER?.ipv6 || null;
    if (!guid) { console.warn('[ProjectState] guid 없음 — 저장 불가'); return null; }
    const res = await fetch(CFG.endpoint + '/orchestration/project-state/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...state, guid }),
    });
    if (!res.ok) {
      console.warn('[ProjectState] 저장 실패:', res.status);
      return null;
    }
    console.info('[ProjectState] 저장 완료:', state.project_id, '| status:', state.status);
    return await res.json();
  } catch (e) {
    console.warn('[ProjectState] 저장 오류(무시):', e.message);
    return null;
  }
}

// AGENT-COMMON §0-H [재개 판별]이 매 턴 시작 시 호출 — 열려있는(멈춰있는)
// 프로젝트가 있는지 확인. 없으면 빈 배열(평소처럼 §ROUTER-CONFIDENCE로).
export async function _loadOpenProjectStates() {
  try {
    const guid = _USER?.guid || _USER?.ipv6 || null;
    if (!guid) return [];
    const res = await fetch(
      CFG.endpoint + '/orchestration/project-state/query'
        + `?guid=${encodeURIComponent(guid)}&status=awaiting_human_action`
    );
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({ items: [] }));
    return data.items || [];
  } catch (e) {
    console.warn('[ProjectState] 조회 오류(무시):', e.message);
    return [];
  }
}

// ── SP 자기 갱신 제안 (2026-07-17 신설 — RULE-03, K-Intent v1.3/
// K-Compose v1.7/K-Deliver v1.3/K-Report v1.1). worker.js
// /sp-updates/propose 경유 — sp_update_proposals 컬렉션에
// status=pending_review로만 저장(자동 승인 없음 — 실제 SP 파일
// 갱신은 사람이 검토 후 수동으로 다음 버전을 만든다).
export async function _proposeSpUpdate(proposal) {
  if (!proposal?.sp_id || !proposal?.issue || !proposal?.proposed_patch) {
    console.warn('[SelfUpdate] 제안 무시 — sp_id/issue/proposed_patch 누락');
    return null;
  }
  try {
    const res = await fetch(CFG.endpoint + '/sp-updates/propose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(proposal),
    });
    if (!res.ok) {
      console.warn('[SelfUpdate] 제안 저장 실패:', res.status);
      return null;
    }
    console.info('[SelfUpdate] 제안 저장 완료:', proposal.sp_id, '| trigger:', proposal.trigger);
    return await res.json();
  } catch (e) {
    console.warn('[SelfUpdate] 제안 저장 오류(무시):', e.message);
    return null;
  }
}

// 2026-07-17 신설 — 사용자 개선 제안 능동 획득(docs/
// user_feedback_mechanism_proposal_v1.md). _proposeSpUpdate와 동일
// 패턴 — 실패해도 원래 하려던 응답 흐름을 막지 않는다(사이드이펙트).
export async function _submitUserFeedback(feedback) {
  if (!feedback?.raw_text) {
    console.warn('[UserFeedback] 제출 무시 — raw_text 누락');
    return null;
  }
  try {
    const res = await fetch(CFG.endpoint + '/user-feedback/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(feedback),
    });
    if (!res.ok) {
      console.warn('[UserFeedback] 제출 저장 실패:', res.status);
      return null;
    }
    console.info('[UserFeedback] 저장 완료 | context_sp:', feedback.context_sp);
    return await res.json();
  } catch (e) {
    console.warn('[UserFeedback] 제출 저장 오류(무시):', e.message);
    return null;
  }
}



/**
 * pdv_records.user_hash를 클라이언트 local_hash로 교정
 * Worker의 단순화 공식과 클라이언트 h_i 공식이 달라 불일치 발생
 * → 클라이언트가 redeemClaim 직후 PATCH로 덮어씀
 * (2026-08-20: Supabase l1_ledger 직접 접근 → Worker PATCH /pdv/ledger-hash로
 *  교체 — 2026-08-12 시크릿 유출로 자격증명이 비워지며 무성 실패하던 갭 보완.
 *  l1_ledger 테이블은 애초에 pdv_records로 통합됐던 대상이라 별도 컬렉션
 *  확정이 필요 없어졌다.)
 */
export async function _patchL1LedgerUserHash(blockHash, localHash) {
  if (!blockHash || !localHash) return;
  try {
    const res = await fetch(CFG.endpoint + '/pdv/ledger-hash', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ block_hash: blockHash, user_hash: localHash }),
    });
    if (res.ok) {
      console.info('[PDV] user_hash 교정 완료 | block_hash:',
        blockHash.slice(0, 8), '| user_hash:', localHash.slice(0, 8));
    } else {
      console.warn('[PDV] user_hash PATCH 실패 | status:', res.status);
    }
  } catch(e) {
    console.warn('[PDV] _patchL1LedgerUserHash 오류:', e.message);
  }
}

/**
 * B-3: market 등 하위 시스템이 이미 INSERT한 pdv_records 레코드에
 *      chain_height / chain_local_hash 소급 기록
 * 타이밍 경쟁 조건 대응: 실패 시 300ms 후 1회 재시도 (설계서 E2 수정)
 * (2026-08-20: Supabase pdv_log 직접 접근 → Worker PATCH /pdv/chain-height로
 *  교체. pdv_log는 이미 pdv_records로 이관 완료된 옛 이름이었다.)
 */
export async function _patchPdvChainHeight(sessionId, chainHeight, chainLocalHash, retry = true) {
  if (!sessionId || chainHeight == null) return;
  try {
    const res = await fetch(CFG.endpoint + '/pdv/chain-height', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        session_id:       sessionId,
        chain_height:     chainHeight,
        chain_local_hash: chainLocalHash,
      }),
    });
    if (res.ok) {
      console.info('[PDV] chain_height 소급 완료 | session_id:',
        sessionId.slice(0, 8), '| height:', chainHeight);
    } else if (retry) {
      console.warn('[PDV] chain_height PATCH 실패 — 300ms 후 재시도 | status:', res.status);
      setTimeout(() =>
        _patchPdvChainHeight(sessionId, chainHeight, chainLocalHash, false),
        300
      );
    } else {
      console.warn('[PDV] chain_height PATCH 최종 실패 | status:', res.status);
    }
  } catch(e) {
    console.warn('[PDV] _patchPdvChainHeight 오류:', e.message);
  }
}

/**
 * B-4: Supabase INSERT 완료 후 IDB hash_chain 레코드의 pdv_anchored를 true로 갱신
 */
export async function _markPdvAnchored(height) {
  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('gopang-wallet');
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
    const tx    = db.transaction('hash_chain', 'readwrite');
    const store = tx.objectStore('hash_chain');
    const rec   = await new Promise((resolve, reject) => {
      const r = store.get(height);
      r.onsuccess = e => resolve(e.target.result);
      r.onerror   = e => reject(e.target.error);
    });
    if (rec) {
      rec.pdv_anchored = true;
      store.put(rec);
      console.info('[PDV] pdv_anchored 갱신 | height:', height);
    }
  } catch(e) {
    console.warn('[PDV] pdv_anchored 갱신 실패:', e.message);
  }
}

