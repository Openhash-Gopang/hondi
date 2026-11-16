/**
 * gopang-report.js  v1.0
 * 고팡 하위 서비스 보고서 전송 라이브러리
 *
 * 배포 위치: https://naviweb.kr/report/gopang-report.js
 * 매뉴얼:   docs/gopang-report-manual.md
 *
 * 사용법:
 *   import { sendReportOnce, flushReportQueue }
 *     from 'https://naviweb.kr/report/gopang-report.js';
 *
 *   const ack = await sendReportOnce(report);
 */

const _ENDPOINT  = 'https://hondi-proxy.tensor-city.workers.dev/pdv/report';
const _QUEUE_KEY = 'gopang_report_queue';    // localStorage — 재전송 큐
const _ACK_PFX   = 'gopang_ack_';           // localStorage — ACK 저장 prefix

// ── 오류 코드 정의 ────────────────────────────────────────
const ERR = {
  INVALID_SIGNATURE: { retry: true,  delay: 0   },
  USER_NOT_FOUND:    { retry: false, delay: 0   },
  DUPLICATE_REPORT:  { retry: false, delay: 0   },
  SCHEMA_ERROR:      { retry: false, delay: 0   },
  PDV_LOCKED:        { retry: true,  delay: 60  },
  SERVER_ERROR:      { retry: true,  delay: 5   },
  NETWORK_ERROR:     { retry: true,  delay: 10  },
};

// ── 서비스 ID 자동 감지 ──────────────────────────────────
function _detectSvcId() {
  const host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return 'dev';
  const sub = host.replace(/\.gopang\.net$/, '');
  return sub !== host ? sub : host.split('.')[0] || 'unknown';
}

// ── 보고서 ID 생성 ────────────────────────────────────────
function _buildReportId(svcId) {
  const date = new Date().toISOString().slice(0,10).replace(/-/g,'');
  const uuid  = crypto.randomUUID().slice(0,8);
  return `RPT-${svcId}-${date}-${uuid}`;
}

// ── SHA-256 해시 ─────────────────────────────────────────
async function _sha256(text) {
  const buf = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2,'0')).join('');
}

// ── 세션 토큰 가져오기 ───────────────────────────────────
function _getSession() {
  try {
    const raw = sessionStorage.getItem('gopang_sso_token');
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s?.exp > Date.now()/1000 ? s : null;
  } catch { return null; }
}

// ── ACK 저장/조회 ────────────────────────────────────────
function _saveAck(reportId, ack) {
  localStorage.setItem(
    _ACK_PFX + reportId,
    JSON.stringify({ ...ack, savedAt: Date.now() })
  );
}

function _getAck(reportId) {
  try {
    const raw = localStorage.getItem(_ACK_PFX + reportId);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function _isReported(reportId) {
  return _getAck(reportId)?.ok === true;
}

// ── 재전송 큐 ────────────────────────────────────────────
function _enqueue(report, reportId) {
  try {
    const queue = JSON.parse(localStorage.getItem(_QUEUE_KEY) || '[]');
    // 동일 reportId 중복 방지
    if (queue.some(q => q.reportId === reportId)) return;
    queue.push({ report, reportId, attempts: 0, queuedAt: Date.now() });
    localStorage.setItem(_QUEUE_KEY, JSON.stringify(queue));
  } catch(e) {
    console.warn('[Report] 큐 저장 실패:', e.message);
  }
}

function _dequeue(reportId) {
  try {
    const queue = JSON.parse(localStorage.getItem(_QUEUE_KEY) || '[]');
    const next  = queue.filter(q => q.reportId !== reportId);
    localStorage.setItem(_QUEUE_KEY, JSON.stringify(next));
  } catch {}
}

// ── 핵심 전송 함수 ───────────────────────────────────────
async function _send(report, reportId) {
  const session = _getSession();
  const token   = session
    ? `${session.ipv6}:${session.level}`
    : 'anonymous';

  const res = await fetch(_ENDPOINT, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Gopang-Svc': report.report?.svc || _detectSvcId(),
      'X-Gopang-Ver': '1.0',
      'X-Report-Id':  reportId,
      'Authorization': `Bearer ${token}`,
    },
    credentials: 'include',
    body: JSON.stringify(report),
  });

  const data = await res.json().catch(() => ({
    ok: false, error: 'SERVER_ERROR', detail: `HTTP ${res.status}`
  }));

  return data;
}

// ── 지수 백오프 재전송 ────────────────────────────────────
async function _sendWithRetry(report, reportId, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await _send(report, reportId);

      if (result.ok) return result;

      const errCfg = ERR[result.error] || ERR.SERVER_ERROR;

      // 재전송 불필요 오류
      if (!errCfg.retry) {
        console.warn('[Report] 재전송 불필요:', result.error, result.detail);
        return result;
      }

      // 마지막 시도면 실패 반환
      if (i === maxRetries - 1) return result;

      // 대기 후 재시도 (지수 백오프)
      const delay = (result.retry_after || errCfg.delay || Math.pow(2, i)) * 1000;
      await new Promise(r => setTimeout(r, delay));

    } catch(e) {
      console.warn(`[Report] 전송 오류 (시도 ${i+1}):`, e.message);
      if (i === maxRetries - 1) {
        return { ok: false, error: 'NETWORK_ERROR', detail: e.message };
      }
      await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000));
    }
  }
  return { ok: false, error: 'MAX_RETRY_EXCEEDED' };
}

// ══════════════════════════════════════════════════════════
// 공개 API
// ══════════════════════════════════════════════════════════

/**
 * 보고서 전송 (중복 방지 포함)
 * 이미 ACK가 있는 reportId는 전송 생략
 */
export async function sendReportOnce(report) {
  // report.report.id 없으면 자동 생성
  if (!report?.report) throw new Error('[Report] report.report 필드 필수');

  const svcId    = report.report.svc || _detectSvcId();
  const reportId = report.report.id  || _buildReportId(svcId);
  report.report.id  = reportId;
  report.report.svc = svcId;

  // 이미 전송 완료된 경우
  if (_isReported(reportId)) {
    console.info('[Report] 이미 전송 완료:', reportId);
    return _getAck(reportId);
  }

  // 콘텐츠 해시 추가 (무결성)
  report.report.content_hash = await _sha256(
    JSON.stringify(report.report.what || '')
  );

  const ack = await _sendWithRetry(report, reportId);

  if (ack.ok) {
    _saveAck(reportId, ack);
    _dequeue(reportId);
    console.info('[Report] ✅ PDV 기록 완료:', ack.pdv_entry);
  } else {
    _enqueue(report, reportId);
    console.warn('[Report] ❌ 전송 실패 — 큐 저장:', ack.error);
  }

  return ack;
}

/**
 * 재전송 큐 처리 (앱 시작 시 또는 네트워크 복구 시 호출)
 */
export async function flushReportQueue() {
  const queue = JSON.parse(localStorage.getItem(_QUEUE_KEY) || '[]');
  if (!queue.length) return { flushed: 0, failed: 0 };

  let flushed = 0, failed = 0;
  const remaining = [];

  for (const item of queue) {
    // 최대 3회 시도 초과 시 폐기
    if (item.attempts >= 3) {
      console.error('[Report] 최대 재시도 초과, 폐기:', item.reportId);
      continue;
    }

    // 이미 다른 경로로 전송된 경우
    if (_isReported(item.reportId)) {
      console.info('[Report] 큐 항목 이미 완료:', item.reportId);
      flushed++;
      continue;
    }

    try {
      const ack = await _send(item.report, item.reportId);
      if (ack.ok) {
        _saveAck(item.reportId, ack);
        flushed++;
        console.info('[Report] 큐 재전송 성공:', item.reportId);
      } else {
        item.attempts++;
        remaining.push(item);
        failed++;
      }
    } catch {
      item.attempts++;
      remaining.push(item);
      failed++;
    }

    // 전송 간 간격 (서버 부하 방지)
    await new Promise(r => setTimeout(r, 500));
  }

  localStorage.setItem(_QUEUE_KEY, JSON.stringify(remaining));
  console.info(`[Report] 큐 처리 완료 — 성공: ${flushed}, 실패: ${failed}`);
  return { flushed, failed };
}

/**
 * 보고서 전송 상태 조회
 */
export function getReportStatus(reportId) {
  const ack = _getAck(reportId);
  const queue = JSON.parse(localStorage.getItem(_QUEUE_KEY) || '[]');
  const queued = queue.find(q => q.reportId === reportId);

  if (ack?.ok)   return { status: 'delivered', ack };
  if (queued)    return { status: 'queued', attempts: queued.attempts };
  return         { status: 'unknown' };
}

/**
 * 6하원칙 보고서 빌더 — 간편 생성 헬퍼
 */
export function buildReport({ svc, type, period, ipv6, role = 'user',
  recipients = ['gopang-pdv'],
  what, how, why, analysis = {} }) {
  const now = new Date();
  return {
    report: {
      id:     _buildReportId(svc),
      ver:    '1.0',
      svc,
      type,
      period: period || now.toISOString().slice(0,7),

      who: { ipv6, role, recipients },

      when: {
        generated_at: now.toISOString(),
        period_start: what.period_start || now.toISOString(),
        period_end:   what.period_end   || now.toISOString(),
        next_report:  what.next_report  || null,
      },

      where: {
        svc_url:  `https://${svc}.hondi.net`, // 2026-07-28: gopang.net 브랜드 폐기, hondi.net으로 통일
        svc_id:   svc,
      },

      what: {
        summary: what.summary,
        details: what.details || [],
        metrics: what.metrics || {},
      },

      how: {
        method:       how.method      || '자동 집계',
        tools:        how.tools       || [],
        difficulty:   how.difficulty  || null,
        assist_level: how.assist_level || null,
      },

      why: {
        goal:      why.goal      || '',
        triggered: why.triggered || 'schedule',
        context:   why.context   || '',
      },

      analysis: {
        strengths:       analysis.strengths       || [],
        weaknesses:      analysis.weaknesses       || [],
        recommendations: analysis.recommendations  || [],
        trend:           analysis.trend            || 'stable',
        risk_level:      analysis.risk_level       || 'low',
      },

      sig: {
        svc_token:  _getSession()?.level || 'L0',
        signed_at:  now.toISOString(),
      },
    },
  };
}
