```
# DATA_REQUIREMENT-SCHEMA
# ═══════════════════════════════════════════════════
# 문서명    : 업무영역 전문 SP(SP-EXP-*)의 데이터 요구사항 선언 스키마
# 문서 코드  : DATA_REQUIREMENT-SCHEMA
# 버전      : v1.0
# 근거      : JEJU-GOV-COMMON v1.1 §10 (정직성·데이터 연동 공백 고지 원칙)
# 작성일     : 2026-07-03
# 작성자     : AI City Inc. · 주피터
# 적용 대상  : SP-EXP-*(업무영역 전문 SP) 신설 시 각 SP 문서 안에 이 스키마를
#             따르는 DATA_REQUIREMENT 목록을 포함해야 한다.
# ═══════════════════════════════════════════════════
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
| `source_type` | enum | connected=true일 때 필수 | `api` \| `db_query` \| `static_file` \| `manual_entry` |
| `source_ref` | string | connected=true일 때 필수 | 실제 조회 방법(API 엔드포인트, DB 테이블명 등) |
| `fallback_contact` | string | connected=false일 때 필수 | 사용자에게 안내할 직접 문의처(전화번호 등) |
| `min_level` | enum(L0\|L1\|L2\|L3) | ❌ | 이 필드 조회에 필요한 최소 인증 레벨(개인정보 성격일 경우) |

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
    "fallback_contact": "1588-5825 (상하수도본부 24시간 콜센터)"
  },
  {
    "field": "수질_검사결과",
    "description": "최근 해당 관할구역 수질 검사 수치(탁도·잔류염소 등)",
    "owner_agency": "보건환경연구원",
    "owner_dept": null,
    "owner_role": null,
    "connected": false,
    "fallback_contact": "제주콜센터 064-120"
  },
  {
    "field": "동일지역_최근민원이력",
    "description": "같은 관할구역 내 최근 유사 민원 발생 여부 — 광역 누수 등 패턴 파악용",
    "owner_agency": "제주도 상하수도본부",
    "owner_dept": "민원접수팀",
    "owner_role": null,
    "connected": false,
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
 owner_role={owner_role|null}, requested_by={이 SP의 코드}, connected=false, ts={ISO시각}]
```

여러 필드가 동시에 걸리면 GAP_LOG를 필드 수만큼 반복 출력한다.

## 연동 완료 후 전환 방법

`owner_agency`가 실제로 데이터를 연동하면: `connected: true`로 바꾸고
`source_type`/`source_ref`를 채운다. 그 순간부터 이 SP는 해당 필드를 §10-4의
"좋은 예"처럼 실제 값으로 답할 수 있게 되고, GAP_LOG도 더 이상 그 필드에
대해서는 발생하지 않는다 — 즉 GAP_LOG 발생 빈도의 감소 자체가 연동 진행률의
지표가 된다.
