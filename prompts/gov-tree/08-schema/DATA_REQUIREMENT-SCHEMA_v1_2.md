```
# DATA_REQUIREMENT-SCHEMA
# ═══════════════════════════════════════════════════
# 문서명    : 업무영역 전문 SP(SP-EXP-*)의 데이터 요구사항 선언 스키마
# 문서 코드  : DATA_REQUIREMENT-SCHEMA
# 버전      : v1.2
# 근거      : JEJU-GOV-COMMON v1.2 §10(정직성 원칙) + §11(능동적 역량·불가 사유 이원화 원칙)
# 작성일     : 2026-07-03
# 작성자     : AI City Inc. · 주피터
# 적용 대상  : SP-EXP-*(업무영역 전문 SP) 및 모든 기관 SP(SP-DO-*, SP-NAT-* 등)
#             신설 시 각 SP 문서 안에 이 스키마를 따르는 DATA_REQUIREMENT
#             목록 + CAPABILITIES 목록을 포함해야 한다.
# 다음 버전  : v1.3 — 실제 백엔드(PocketBase/Supabase) 스키마와 1:1 매핑
# ═══════════════════════════════════════════════════
#
# 버전 변경 이력
# ─────────────────────────────────────────────────
# v1.2 (2026-07-08): 주피터님 지시(사고실험 9 — 승인된 SP가 법령 개정
#                    등으로 사후에 틀려질 수 있음) 반영. last_verified·
#                    revalidation_interval_days 필드 신설.
#                    connected:true가 "영구히 맞다"를 뜻하지 않는다는
#                    걸 명문화.
# v1.1 (2026-07-03): unavailable_reason 필드 추가(no_internal_data |
#                    no_interagency_access). CAPABILITIES 선언 스펙 추가
#                    (JEJU-GOV-COMMON §11).
# v1.0 (2026-07-03): 최초 작성.
# ─────────────────────────────────────────────────
```

## 목적

업무영역 전문 SP가 "이상적으로는 이런 데이터가 있으면 더 정확히 답할 수 있다"고
선언하는 목록이다. 이 선언 자체가 두 가지 역할을 한다:

1. **LLM에게**: 연동 안 된 필드는 지어내지 말고 §10-4 템플릿으로 공백을
   고지하라는 명시적 지침이 된다.
2. **개발/운영자에게**: 어느 기관·부서의 어떤 데이터를 다음에 연동해야
   전체 응답 품질이 올라가는지 보여주는 로드맵이 된다.

## 필드 스펙

각 DATA_REQUIREMENT 항목은 다음 키를 가진다.

| 키 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `field` | string | ✅ | 데이터 필드명 (한글, 사람이 읽는 이름). 예: "급수관_개보수이력" |
| `description` | string | ✅ | 이 필드가 응답에 어떻게 쓰이는지 1문장 설명 |
| `owner_agency` | string | ✅ | 데이터를 보유한 기관명. 예: "제주도 상하수도본부" |
| `owner_dept` | string | ❌ | 부서명(알 수 있는 경우). 예: "시설관리과" |
| `owner_role` | string | ❌ | 담당 직책(알 수 있는 경우, 대부분 null) |
| `connected` | boolean | ✅ | 현재 나비에 실제 데이터 연동이 되어 있는지 |
| `unavailable_reason` | enum(`no_internal_data`\|`no_interagency_access`) | connected=false일 때 필수 | Type A(이 기관 자체에 원래 없는 정보) 또는 Type B(존재하지만 나비와 연동이 안 됨). JEJU-GOV-COMMON §11-2 참고 |
| `source_type` | enum | connected=true일 때 필수 | `api` \| `db_query` \| `static_file` \| `manual_entry` |
| `source_ref` | string | connected=true일 때 필수 | 실제 조회 방법(API 엔드포인트, DB 테이블명 등) |
| `fallback_contact` | string | connected=false일 때 필수 | 사용자에게 안내할 직접 문의처(전화번호 등) |
| `min_level` | enum(L0\|L1\|L2\|L3) | ❌ | 이 필드 조회에 필요한 최소 인증 레벨(개인정보 성격일 경우) |
| `last_verified` | ISO8601 date | connected=true일 때 필수 | 이 필드 값이 마지막으로 실제 확인된 날짜(SP-DO-TOURISM v1.2가 "실제 배포 전 재검증 필요" TODO로만 남겼던 것을 필수 필드로 승격) |
| `revalidation_interval_days` | integer | connected=true일 때 필수 | 며칠마다 재검증해야 하는지. 법령·조례 기반 수치(세율·수수료 등)는 90일 이하 권장, 정적 사실(관할 구역명 등)은 365일까지 허용 |

`last_verified + revalidation_interval_days`가 지난 필드는 `connected:true`
상태를 유지하되, 응답 시 "{last_verified} 기준 확인된 정보"라는 시점
라벨을 반드시 붙인다 — 자동으로 `connected:false`로 강등하지는 않는다
(강등하면 §GAP_LOG가 불필요하게 폭증하고, 실제로는 안 바뀌었을 가능성이
높은 정적 사실까지 매번 재조사 대상이 되어 PHASE B-0/C의 효율을
떨어뜨린다). 대신 이 기한 초과 필드 목록은 SP-AUTHOR §PROACTIVE-SWEEP의
우선순위 ①(실사용 갭)과 동급으로 재검증 대상에 자동 포함된다.

## 예시 — SP-EXP-WATER의 DATA_REQUIREMENT 선언

```json
[
  {
    "field": "급수관_개보수이력",
    "description": "누수·악취 원인 추정 시 참고할 관로 개보수 시기·자재",
    "owner_agency": "제주도 상하수도본부",
    "owner_dept": "시설관리과",
    "owner_role": null,
    "connected": false,
    "unavailable_reason": "no_interagency_access",
    "fallback_contact": "1588-5825 (상하수도본부 24시간 콜센터)"
  },
  {
    "field": "수질_검사결과",
    "description": "최근 해당 관할구역 수질 검사 수치(탁도·잔류염소 등)",
    "owner_agency": "보건환경연구원",
    "owner_dept": null,
    "owner_role": null,
    "connected": false,
    "unavailable_reason": "no_interagency_access",
    "fallback_contact": "제주콜센터 064-120"
  },
  {
    "field": "동일지역_최근민원이력",
    "description": "같은 관할구역 내 최근 유사 민원 발생 여부 — 광역 누수 등 패턴 파악용",
    "owner_agency": "제주도 상하수도본부",
    "owner_dept": "민원접수팀",
    "owner_role": null,
    "connected": false,
    "unavailable_reason": "no_interagency_access",
    "fallback_contact": "1588-5825"
  },
  {
    "field": "나비_민원접수_기록",
    "description": "이 사용자가 나비를 통해 접수한 민원 자체 — 이건 나비 내부 데이터라 연동 완료",
    "owner_agency": "Hondi (Gopang L1 PocketBase)",
    "owner_dept": null,
    "owner_role": null,
    "connected": true,
    "source_type": "db_query",
    "source_ref": "L1 PocketBase collection: gov_tickets"
  }
]
```

## GAP_LOG 태그 출력 규칙

`connected: false`인 필드를 실제로 언급해야 하는 상황이 발생하면(사용자 질의가
그 필드를 필요로 할 때만 — 관련 없는 필드까지 전부 나열하지 않는다), 응답
말미에 다음 형식으로 기록한다. 이 태그는 사용자에게 노출되는 텍스트가 아니라
PDV_STORE와 같은 방식으로 세션 종료 시 별도 로그로 저장된다.

```
[GAP_LOG: field={field}, owner_agency={owner_agency}, owner_dept={owner_dept|null},
 owner_role={owner_role|null}, requested_by={이 SP의 코드}, connected=false,
 reason={unavailable_reason}, ts={ISO시각}]
```

여러 필드가 동시에 걸리면 GAP_LOG를 필드 수만큼 반복 출력한다.

## CAPABILITIES 선언 스펙 (JEJU-GOV-COMMON §11-4)

DATA_REQUIREMENT와 짝을 이루는 또 하나의 필수 선언이다. "이 SP가 데이터 연동 여부와 무관하게 실제로 할 수 있는 일" 목록으로, §11-1 원칙에 따라 데이터 공백이 이 목록을 축소하는 핑계가 되지 않도록 명시적으로 고정해둔다.

| 키 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `action` | string | ✅ | 할 수 있는 일 (사람이 읽는 이름). 예: "민원 접수" |
| `mode` | enum(`direct`\|`intake_only`\|`referral_only`) | ✅ | `direct`=이 SP가 직접 완결 처리, `intake_only`=접수만 하고 처리는 타 기관, `referral_only`=안내만(직접 처리 권한 없음) |
| `implementation` | string | ❌ | 실제 구현 방식(예: "GOV_TICKET 태그 발급 → gov_tickets 컬렉션 INSERT") |

### 예시 — SP-EXP-WATER의 CAPABILITIES

```json
[
  { "action": "증상 접수(누수·악취·단수·탁도)", "mode": "direct", "implementation": "GOV_TICKET 발급" },
  { "action": "관할 확인", "mode": "direct" },
  { "action": "긴급 상황 시 콜센터 즉시 연결 안내", "mode": "referral_only" },
  { "action": "개별 배관 개보수 이력 확인", "mode": "referral_only" }
]
```

## unavailable_reason 판정 기준

DATA_REQUIREMENT 필드에 `connected: false`를 선언할 때, 다음 질문으로 Type을 정한다:

- **"이 정보가 존재한다면, 원래 어느 기관이 갖고 있어야 하는가?"** → 그 기관이 **지금 이 SP를 발행한 기관과 동일**하면 `no_internal_data`(예: 세무서 SP인데 세무서 자체가 특정 통계를 안 만든 경우). **다른 기관**(owner_agency가 이 SP의 소속 기관과 다름)이면 `no_interagency_access`.
- 이 판정은 owner_agency 필드와 이 SP 자신의 소속 기관을 비교하면 기계적으로도 유도 가능하다 — 향후 자동 검증 고도화 시 활용.



`owner_agency`가 실제로 데이터를 연동하면: `connected: true`로 바꾸고
`source_type`/`source_ref`를 채운다. 그 순간부터 이 SP는 해당 필드를 §10-4의
"좋은 예"처럼 실제 값으로 답할 수 있게 되고, GAP_LOG도 더 이상 그 필드에
대해서는 발생하지 않는다 — 즉 GAP_LOG 발생 빈도의 감소 자체가 연동 진행률의
지표가 된다.
