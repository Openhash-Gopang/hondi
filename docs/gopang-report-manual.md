# 나비 하위 시스템 보고서 작성 및 전송 매뉴얼

> **이 문서가 다루는 범위**: 하위 시스템이 PDV 6하원칙 보고서를 작성·전송하는 스키마와 API
> **전체 문서 지도**: [MANUAL_INDEX.md](MANUAL_INDEX.md)
**Navi Subsystem Report Manual**
버전 1.0 · 2026년 5월 · AI City Inc.

---

## 목차

1. 개요 및 목적
2. 핵심 원칙
3. 보고서 구조 — 6하원칙 기반
4. 보고서 유형 및 주기
5. 전송 API 규격
6. 수신 확인(ACK) 메커니즘
7. PDV 기록 규칙
8. school.hondi.net 구현 예시
9. 하위 시스템별 필드 정의
10. 오류 처리 및 재전송
11. 보안 및 개인정보
12. 구현 체크리스트

---

## 1. 개요 및 목적

나비의 모든 하위 시스템(K-Law, K-School, K-Market, K-Health 등)은 사용자 활동과 결과를 주기적으로 나비에 보고합니다. 나비는 이를 사용자의 **PDV(Private Data Vault)**에 6하원칙(누가·언제·어디서·무엇을·어떻게·왜)에 따라 기록하고, 해당 사용자의 AI 비서가 종합적 맥락을 갖추도록 합니다.

```
하위 시스템                      나비 (PDV)
K-School ──보고서 전송──▶ hondi.net/api/report ──▶ 사용자 PDV 기록
K-Health                                           ──▶ AI 비서 업데이트
K-Law                                              ──▶ 수신 확인 반환
K-Market ◀──────────────── ACK (기록 완료 통지) ──────────────────
```

---

## 2. 핵심 원칙

```
원칙 1: 사용자 중심
  모든 보고서는 특정 사용자(IPv6)에 귀속됩니다.
  사용자 동의 없이 타 시스템에 전달하지 않습니다.

원칙 2: 6하원칙 완전성
  WHO·WHEN·WHERE·WHAT·HOW·WHY 6개 필드를 모두 포함해야 합니다.
  누락된 필드는 "알 수 없음" 으로 명시합니다.

원칙 3: PDV 불변성
  한 번 기록된 PDV 항목은 수정하지 않습니다.
  정정이 필요하면 별도 정정 보고서를 추가 전송합니다.

원칙 4: 최소 정보 수집
  PDV에 기록하는 내용은 6하원칙 요약에 한정합니다.
  원본 데이터(영상, 문서 등)는 각 하위 시스템이 보관합니다.

원칙 5: 전송 보장
  네트워크 오류 시 최대 3회 재전송합니다.
  재전송 실패 시 큐에 보관, 연결 복구 후 자동 전송합니다.
```

---

## 3. 보고서 구조 — 6하원칙 기반

모든 보고서는 다음 JSON 구조를 따릅니다.

```json
{
  "report": {
    "id":        "RPT-{svc}-{YYYYMMDD}-{uuid4}",
    "ver":       "1.0",
    "svc":       "school",
    "type":      "weekly_progress",
    "period":    "2026-W21",

    "who": {
      "ipv6":       "2601:db80:a3f8:c291:...",
      "role":       "learner",
      "recipients": ["parent", "teacher", "gopang-pdv"]
    },

    "when": {
      "generated_at": "2026-05-30T09:00:00+09:00",
      "period_start": "2026-05-24T00:00:00+09:00",
      "period_end":   "2026-05-30T23:59:59+09:00",
      "next_report":  "2026-06-06T09:00:00+09:00"
    },

    "where": {
      "svc_url":    "https://school.hondi.net",
      "svc_id":     "school",
      "session_ids": ["sess-001", "sess-002"]
    },

    "what": {
      "summary":  "이번 주 수학 2단원 완료, 영어 독해 80% 달성",
      "details":  [
        {
          "subject":    "수학",
          "topic":      "2단원 방정식",
          "status":     "completed",
          "score":      92,
          "time_spent": 180
        },
        {
          "subject":    "영어",
          "topic":      "독해 Unit 5",
          "status":     "in_progress",
          "score":      null,
          "time_spent": 120,
          "progress":   80
        }
      ],
      "metrics": {
        "total_time_min":   300,
        "sessions":         5,
        "avg_score":        92,
        "completion_rate":  75
      }
    },

    "how": {
      "method":     "AI 튜터 대화 + 문제 풀이",
      "tools":      ["ai-tutor", "quiz-engine"],
      "difficulty": "adaptive",
      "assist_level": "medium"
    },

    "why": {
      "goal":       "2026년 1학기 수학·영어 목표 달성",
      "triggered":  "weekly_schedule",
      "context":    "중학교 2학년 2학기 선행 준비"
    },

    "analysis": {
      "strengths":   ["수학 문제 해결 속도 향상", "집중 시간 증가"],
      "weaknesses":  ["영어 어휘 부족"],
      "recommendations": ["영어 단어 암기 10분/일 추가 권장"],
      "trend":       "improving",
      "risk_level":  "low"
    },

    "sig": {
      "svc_token":  "eyJwYXlsb2Fk...",
      "signed_at":  "2026-05-30T09:00:01+09:00"
    }
  }
}
```

---

## 4. 보고서 유형 및 주기

### 4.1 표준 보고서 유형

| type | 설명 | 권장 주기 | 적용 시스템 |
|------|------|-----------|-------------|
| `daily_summary` | 일일 활동 요약 | 매일 자정 | K-Health, K-School |
| `weekly_progress` | 주간 진도·성과 | 매주 월요일 09:00 | K-School, K-Market |
| `monthly_report` | 월간 종합 분석 | 매월 1일 09:00 | 전체 시스템 |
| `event_report` | 즉시 발생 이벤트 | 이벤트 발생 즉시 | K-Law, K-Security |
| `milestone` | 목표 달성·변경 | 달성 시 즉시 | K-School, K-Health |
| `alert` | 위험·이상 감지 | 감지 즉시 | K-Security, K-Health |
| `correction` | 이전 보고서 정정 | 오류 발견 즉시 | 전체 시스템 |

### 4.2 주기 설정

```javascript
// 각 하위 시스템의 보고 스케줄 선언
const REPORT_SCHEDULE = {
  daily_summary:   { cron: '0 0 * * *',   tz: 'Asia/Seoul' },
  weekly_progress: { cron: '0 9 * * 1',   tz: 'Asia/Seoul' },
  monthly_report:  { cron: '0 9 1 * *',   tz: 'Asia/Seoul' },
};
```

---

## 5. 전송 API 규격

### 5.1 엔드포인트

```
POST https://gopang-proxy.tensor-city.workers.dev/pdv/report
Content-Type: application/json
Authorization: Bearer {gwp_token}
```

### 5.2 요청 헤더

```
Content-Type:  application/json
X-Gopang-Svc:  school                    ← 서비스 ID
X-Gopang-Ver:  1.0                       ← API 버전
X-Report-Id:   RPT-school-20260530-xxxx  ← 멱등성 키
Authorization: Bearer {gwp_token}        ← SSO 토큰
```

### 5.3 응답 구조

**성공 (200)**
```json
{
  "ok":         true,
  "report_id":  "RPT-school-20260530-xxxx",
  "pdv_entry":  "PDV-2601db80-20260530-001",
  "recorded_at": "2026-05-30T09:00:05+09:00",
  "recipients_notified": ["parent", "teacher"],
  "message":    "PDV 기록 완료. 수신자 2명에게 알림 전송."
}
```

**실패 (4xx/5xx)**
```json
{
  "ok":     false,
  "error":  "INVALID_SIGNATURE",
  "detail": "gwp_token 만료. 재인증 후 재전송하세요.",
  "retry":  true,
  "retry_after": 60
}
```

### 5.4 전송 구현 (하위 시스템 표준 코드)

```javascript
// gopang-report.js — 모든 하위 시스템 공통 라이브러리
import { gopangAuth } from 'https://hondi.net/auth/gopang-sso.js';

const REPORT_ENDPOINT =
  'https://gopang-proxy.tensor-city.workers.dev/pdv/report';

/**
 * 나비 PDV에 보고서 전송
 * @param {object} report  - 6하원칙 보고서 객체
 * @param {string} ipv6    - 사용자 IPv6
 * @returns {object}       - ACK 응답
 */
export async function sendReport(report, ipv6) {
  // 1. SSO 토큰 획득 (하위 시스템 서비스 계정)
  const auth = gopangAuth.session();
  if (!auth) throw new Error('인증 필요: gopangAuth.require() 먼저 호출');

  // 2. 보고서 ID 생성 (멱등성 보장)
  const reportId = report.report?.id ||
    `RPT-${report.report?.svc}-${_dateStr()}-${crypto.randomUUID().slice(0,8)}`;

  // 3. 전송
  const res = await fetch(REPORT_ENDPOINT, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'X-Gopang-Svc':  report.report?.svc || 'unknown',
      'X-Gopang-Ver':  '1.0',
      'X-Report-Id':   reportId,
      'Authorization': `Bearer ${auth.level}`,
    },
    credentials: 'include',
    body: JSON.stringify(report),
  });

  const data = await res.json();

  // 4. 실패 시 큐에 저장 (재전송용)
  if (!data.ok) {
    await _queueForRetry(report, reportId);
    console.warn('[Report] 전송 실패 — 큐 저장:', data.error);
  } else {
    console.info('[Report] PDV 기록 완료:', data.pdv_entry);
  }

  return data;
}

// ── 재전송 큐 ──────────────────────────────────────────────
const _QUEUE_KEY = 'gopang_report_queue';

async function _queueForRetry(report, reportId) {
  const queue = JSON.parse(localStorage.getItem(_QUEUE_KEY) || '[]');
  queue.push({ report, reportId, attempts: 0, queuedAt: Date.now() });
  localStorage.setItem(_QUEUE_KEY, JSON.stringify(queue));
}

export async function flushReportQueue() {
  const queue = JSON.parse(localStorage.getItem(_QUEUE_KEY) || '[]');
  if (!queue.length) return;

  const remaining = [];
  for (const item of queue) {
    if (item.attempts >= 3) {
      console.error('[Report] 최대 재시도 초과, 폐기:', item.reportId);
      continue;
    }
    try {
      const result = await sendReport(item.report, null);
      if (!result.ok) {
        item.attempts++;
        remaining.push(item);
      }
    } catch {
      item.attempts++;
      remaining.push(item);
    }
  }
  localStorage.setItem(_QUEUE_KEY, JSON.stringify(remaining));
}

function _dateStr() {
  return new Date().toISOString().slice(0,10).replace(/-/g,'');
}
```

---

## 6. 수신 확인(ACK) 메커니즘

### 6.1 ACK 흐름

```
하위 시스템              나비 Worker              PDV
    │                       │                      │
    │── POST /pdv/report ──▶│                      │
    │                       │── PDV 기록 ─────────▶│
    │                       │◀── 기록 완료 ─────────│
    │                       │── 수신자 알림 전송    │
    │◀── 200 OK + ACK ──────│                      │
    │                       │
    │  ACK 내용:
    │  - pdv_entry ID
    │  - recorded_at
    │  - recipients_notified
```

### 6.2 ACK 저장

하위 시스템은 ACK를 로컬에 저장하여 전송 완료를 추적합니다.

```javascript
// ACK 저장 및 조회
function saveAck(reportId, ack) {
  const key = `gopang_ack_${reportId}`;
  localStorage.setItem(key, JSON.stringify({
    ...ack,
    savedAt: Date.now(),
  }));
}

function getAck(reportId) {
  const raw = localStorage.getItem(`gopang_ack_${reportId}`);
  return raw ? JSON.parse(raw) : null;
}

// 전송 완료 여부 확인
function isReported(reportId) {
  const ack = getAck(reportId);
  return ack?.ok === true;
}
```

### 6.3 중복 전송 방지 (멱등성)

```javascript
async function sendReportOnce(report) {
  const reportId = report.report.id;

  // 이미 ACK가 있으면 전송 생략
  if (isReported(reportId)) {
    console.info('[Report] 이미 전송 완료:', reportId);
    return getAck(reportId);
  }

  const ack = await sendReport(report, report.report.who.ipv6);
  if (ack.ok) saveAck(reportId, ack);
  return ack;
}
```

---

## 7. PDV 기록 규칙

### 7.1 PDV 항목 구조

나비가 보고서를 수신하면 다음 형식으로 PDV에 기록합니다.

```json
{
  "pdv_entry": {
    "id":        "PDV-{ipv6-prefix}-{YYYYMMDD}-{seq}",
    "ipv6":      "2601:db80:a3f8:...",
    "source":    "school",
    "type":      "weekly_progress",

    "6w": {
      "who":   "학습자 본인 (2601:db80:...)",
      "when":  "2026년 5월 4주차 (05-24 ~ 05-30)",
      "where": "school.hondi.net",
      "what":  "수학 2단원 완료(점수 92), 영어 독해 80% 진행",
      "how":   "AI 튜터 + 문제 풀이, 총 300분 학습",
      "why":   "1학기 수학·영어 목표 달성 (선행 준비)"
    },

    "summary":   "이번 주 수학 완료, 영어 진행 중. 수행 추세 상승.",
    "tags":      ["학습", "수학", "영어", "주간"],
    "risk":      "low",
    "recorded_at": "2026-05-30T09:00:05+09:00",
    "immutable": true
  }
}
```

### 7.2 6하원칙 작성 가이드라인

| 필드 | 작성 기준 | 예시 |
|------|-----------|------|
| **WHO** | 사용자 역할 + IPv6 약식 | "학습자 (2601:db80:...)" |
| **WHEN** | 기간 또는 시각 (한국어) | "2026년 5월 4주차" |
| **WHERE** | 서비스 이름 + URL | "school.hondi.net" |
| **WHAT** | 핵심 결과 1~3문장 | "수학 완료(92점), 영어 80%" |
| **HOW** | 방법·도구·소요시간 | "AI 튜터, 300분" |
| **WHY** | 목표·동기·맥락 | "1학기 선행 준비" |

### 7.3 요약 자동 생성 (AI 비서용)

```javascript
// 나비 Worker가 보고서를 받으면 AI 요약 생성
function generate6WSummary(report) {
  const r = report.report;
  return {
    who:   `${r.who.role} (${r.who.ipv6.slice(0,20)}...)`,
    when:  formatPeriod(r.when.period_start, r.when.period_end),
    where: r.where.svc_url,
    what:  r.what.summary,
    how:   `${r.how.method}, 총 ${r.what.metrics.total_time_min}분`,
    why:   r.why.goal,
  };
}
```

---

## 8. school.hondi.net 구현 예시

### 8.1 주간 보고서 생성 및 전송

```javascript
// school/js/weekly-report.js
import { sendReportOnce } from 'https://hondi.net/report/gopang-report.js';
import { gopangAuth }     from 'https://hondi.net/auth/gopang-sso.js';

async function generateWeeklyReport(learnerIpv6, weekData) {
  const now      = new Date();
  const periodStart = getWeekStart(now);
  const periodEnd   = getWeekEnd(now);
  const weekStr     = getISOWeek(now);         // "2026-W21"

  const report = {
    report: {
      id:     `RPT-school-${dateStr()}-${shortUUID()}`,
      ver:    '1.0',
      svc:    'school',
      type:   'weekly_progress',
      period: weekStr,

      who: {
        ipv6:       learnerIpv6,
        role:       'learner',
        recipients: ['parent', 'teacher', 'gopang-pdv'],
      },

      when: {
        generated_at: now.toISOString(),
        period_start: periodStart.toISOString(),
        period_end:   periodEnd.toISOString(),
        next_report:  addDays(now, 7).toISOString(),
      },

      where: {
        svc_url:     'https://school.hondi.net',
        svc_id:      'school',
        session_ids: weekData.sessionIds,
      },

      what: {
        summary: buildSummary(weekData),
        details: weekData.subjects.map(s => ({
          subject:    s.name,
          topic:      s.currentTopic,
          status:     s.status,
          score:      s.latestScore,
          time_spent: s.minutesSpent,
          progress:   s.progressPct,
        })),
        metrics: {
          total_time_min:  weekData.totalMinutes,
          sessions:        weekData.sessionCount,
          avg_score:       weekData.avgScore,
          completion_rate: weekData.completionRate,
        },
      },

      how: {
        method:      'AI 튜터 대화 + 문제 풀이',
        tools:       ['ai-tutor', 'quiz-engine', 'video-lecture'],
        difficulty:  'adaptive',
        assist_level: weekData.assistLevel,
      },

      why: {
        goal:      weekData.semesterGoal,
        triggered: 'weekly_schedule',
        context:   weekData.gradeContext,
      },

      analysis: {
        strengths:       weekData.strengths,
        weaknesses:      weekData.weaknesses,
        recommendations: weekData.recommendations,
        trend:           weekData.trend,
        risk_level:      weekData.riskLevel,
      },

      sig: {
        svc_token:  gopangAuth.session()?.level || 'L0',
        signed_at:  now.toISOString(),
      },
    },
  };

  // 전송 (중복 방지)
  const ack = await sendReportOnce(report);
  console.info('[School] 주간 보고서 전송:', ack.ok ? '성공' : '실패');
  return ack;
}

// 매주 월요일 09:00 자동 실행
function scheduleWeeklyReport(learnerIpv6) {
  const checkAndSend = async () => {
    const now = new Date();
    if (now.getDay() === 1 && now.getHours() === 9) {
      const weekData = await collectWeekData(learnerIpv6);
      await generateWeeklyReport(learnerIpv6, weekData);
    }
  };

  // 1시간마다 체크 (서비스 워커 또는 setInterval)
  setInterval(checkAndSend, 3600 * 1000);
}
```

### 8.2 수신자별 알림

```javascript
// 나비가 PDV 기록 후 수신자에게 알림
// 이 로직은 Cloudflare Worker에서 실행됨

async function notifyRecipients(report, pdvEntryId) {
  const recipients = report.report.who.recipients;

  for (const recipient of recipients) {
    switch (recipient) {
      case 'gopang-pdv':
        // PDV 기록 완료 (이미 처리됨)
        break;

      case 'parent':
        await sendPushNotification(report.report.who.ipv6, {
          title:   `📚 ${getWeekLabel()} 학습 보고서`,
          body:    report.report.what.summary,
          url:     `https://school.hondi.net/report/${report.report.id}`,
          channel: 'parent',
        });
        break;

      case 'teacher':
        await sendPushNotification(report.report.who.ipv6, {
          title:   `학생 주간 보고서`,
          body:    `진도율 ${report.report.what.metrics.completion_rate}%`,
          url:     `https://school.hondi.net/teacher/report/${report.report.id}`,
          channel: 'teacher',
        });
        break;
    }
  }
}
```

---

## 9. 하위 시스템별 필드 정의

각 하위 시스템은 `what.details` 배열에 시스템 고유 필드를 추가합니다.

### K-School (학습)
```json
{
  "subject": "수학",
  "topic": "방정식",
  "score": 92,
  "time_spent": 180,
  "progress": 100,
  "mastery_level": "proficient"
}
```

### K-Health (건강)
```json
{
  "metric": "혈압",
  "value": "120/80",
  "unit": "mmHg",
  "normal_range": "90-120/60-80",
  "status": "normal",
  "measured_at": "2026-05-30T08:00:00+09:00"
}
```

### K-Law (법률)
```json
{
  "case_id": "KLAW-2026-0530-001",
  "case_type": "계약 검토",
  "status": "completed",
  "verdict_summary": "계약서 3개 조항 수정 권고",
  "risk_level": "medium",
  "billable_minutes": 5
}
```

### K-Market (거래)
```json
{
  "transaction_id": "TXN-20260530-001",
  "type": "purchase",
  "item": "유기농 쌀 5kg",
  "amount_gdc": 45000,
  "status": "completed",
  "merchant_ipv6": "2601:db80:ff01:..."
}
```

### K-Security (보안)
```json
{
  "event_type": "login_attempt",
  "result": "success",
  "auth_level": "L2",
  "device_fp": "a3f8c2...",
  "risk_score": 0.05
}
```

---

## 10. 오류 처리 및 재전송

### 10.1 오류 코드

| 코드 | 의미 | 재전송 여부 |
|------|------|-------------|
| `INVALID_SIGNATURE` | 서명 검증 실패 | 재인증 후 재전송 |
| `USER_NOT_FOUND` | 사용자 IPv6 미등록 | 재전송 불가 |
| `DUPLICATE_REPORT` | 동일 report_id 이미 존재 | 재전송 불필요 |
| `SCHEMA_ERROR` | 보고서 구조 오류 | 수정 후 재전송 |
| `PDV_LOCKED` | PDV 잠금 상태 | 60초 후 재전송 |
| `SERVER_ERROR` | 서버 오류 | 즉시 재전송 |

### 10.2 재전송 로직

```javascript
async function sendWithRetry(report, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await sendReport(report);
      if (result.ok) return result;

      // 재전송 불필요한 오류
      if (['USER_NOT_FOUND', 'DUPLICATE_REPORT', 'SCHEMA_ERROR']
          .includes(result.error)) {
        console.warn('[Report] 재전송 불필요:', result.error);
        return result;
      }

      // 재시도 대기
      const delay = result.retry_after
        ? result.retry_after * 1000
        : Math.pow(2, i) * 1000;   // 지수 백오프
      await new Promise(r => setTimeout(r, delay));

    } catch(e) {
      if (i === maxRetries - 1) throw e;
      await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000));
    }
  }
}
```

---

## 11. 보안 및 개인정보

### 11.1 전송 보안

```
필수:
  ✅ HTTPS 전용 (TLS 1.3)
  ✅ gwp_token 포함 (SSO 인증)
  ✅ X-Report-Id 멱등성 키
  ✅ 보고서 서명 (svc_token)

금지:
  ❌ 생체정보 (지문·얼굴 이미지) 포함
  ❌ 비밀번호·시드 포함
  ❌ 개인 식별 정보 (이름·전화·주민번호)
     → IPv6만 사용
```

### 11.2 PDV 개인정보 원칙

```
PDV 기록 내용:
  ✅ 6하원칙 요약 (텍스트)
  ✅ 수치 결과 (점수, 시간, 금액)
  ✅ 상태 코드 (completed, failed 등)

PDV 기록 제외:
  ❌ 학습 영상·녹음
  ❌ 의료 영상·검사지 원본
  ❌ 계약서 원문
  → 원본은 각 하위 시스템이 보관
  → PDV는 요약·결과만 기록
```

---

## 12. 구현 체크리스트

하위 시스템 개발 완료 전 다음 항목을 점검합니다.

### 보고서 구조
- [ ] 6하원칙(who/when/where/what/how/why) 모든 필드 포함
- [ ] `report.id` 형식: `RPT-{svc}-{YYYYMMDD}-{uuid}`
- [ ] `report.svc` 가 GWP_REGISTRY에 등록된 ID와 일치
- [ ] `who.ipv6` 가 유효한 나비 IPv6 형식

### 전송
- [ ] `gopang-report.js` 라이브러리 사용
- [ ] `sendReportOnce()` 로 중복 전송 방지
- [ ] 재전송 큐(`gopang_report_queue`) 구현
- [ ] 네트워크 오류 시 지수 백오프 적용

### ACK
- [ ] ACK를 `gopang_ack_{reportId}` 키로 저장
- [ ] ACK 수신 후 UI 상태 갱신
- [ ] 미수신 ACK 24시간 후 알림

### 보안
- [ ] HTTPS 전용
- [ ] 생체정보·개인식별정보 미포함 확인
- [ ] gwp_token 유효성 확인 후 전송
- [ ] PDV에 원본 데이터 미포함 (요약만)

### 스케줄
- [ ] 보고 주기(cron) 설정 완료
- [ ] 시간대 `Asia/Seoul` 명시
- [ ] 첫 전송 후 `next_report` 필드 업데이트

---

## 부록 A — Cloudflare Worker `/pdv/report` 엔드포인트 규격

Worker에 추가할 핸들러:

```javascript
// worker.js에 추가
if (pathname === '/pdv/report') return handlePdvReport(request, env, corsHeaders);

async function handlePdvReport(request, env, corsHeaders) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const report = await request.json().catch(() => null);
  if (!report?.report) {
    return new Response(
      JSON.stringify({ ok: false, error: 'SCHEMA_ERROR' }),
      { status: 400, headers: corsHeaders }
    );
  }

  const r         = report.report;
  const reportId  = r.id;
  const ipv6      = r.who?.ipv6;

  if (!ipv6) {
    return new Response(
      JSON.stringify({ ok: false, error: 'USER_NOT_FOUND' }),
      { status: 404, headers: corsHeaders }
    );
  }

  // 6하원칙 요약 생성
  const summary6w = {
    who:   `${r.who.role} (${ipv6.slice(0,20)}...)`,
    when:  `${r.when.period_start?.slice(0,10)} ~ ${r.when.period_end?.slice(0,10)}`,
    where: r.where.svc_url,
    what:  r.what.summary,
    how:   r.how.method,
    why:   r.why.goal,
  };

  // Supabase PDV 기록
  const pdvId  = `PDV-${ipv6.slice(5,13).replace(/:/g,'')}-${Date.now()}`;
  const pdvRes = await sbFetch(env, '/rest/v1/pdv_log', 'POST', {
    id:          pdvId,
    guid:        ipv6,
    source:      r.svc,
    type:        r.type,
    report_id:   reportId,
    summary_6w:  JSON.stringify(summary6w),
    summary:     r.what.summary,
    tags:        r.why.goal,
    risk_level:  r.analysis?.risk_level || 'low',
    period:      r.period,
    raw_hash:    await _sha256(JSON.stringify(report)),
    created_at:  new Date().toISOString(),
  });

  if (!pdvRes) {
    return new Response(
      JSON.stringify({ ok: false, error: 'PDV_LOCKED' }),
      { status: 503, headers: corsHeaders }
    );
  }

  return new Response(JSON.stringify({
    ok:          true,
    report_id:   reportId,
    pdv_entry:   pdvId,
    recorded_at: new Date().toISOString(),
    recipients_notified: r.who.recipients?.filter(x => x !== 'gopang-pdv') || [],
    message:     'PDV 기록 완료.',
  }), { status: 200, headers: corsHeaders });
}

async function _sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
```

---

## 부록 B — gopang-report.js 배포 위치

```
https://hondi.net/report/gopang-report.js
```

하위 시스템에서 import:

```javascript
import { sendReport, sendReportOnce, flushReportQueue }
  from 'https://hondi.net/report/gopang-report.js';
```

---

*본 매뉴얼은 나비 플랫폼의 기술 발전에 따라 지속적으로 갱신됩니다.*
*© 2026 AI City Inc. All rights reserved.*
