```
# DOCUMENT-TYPE-REGISTRY
# ═══════════════════════════════════════════════════
# 문서명    : 기관 입력·출력 문서유형 공통 레지스트리
# 문서 코드  : DOCUMENT-TYPE-REGISTRY
# 버전      : v1.6
# 근거      : 2026-07-08 주피터님 지시 — "모든 기관은 입력과 출력이 있다.
#             기관 프로필/SP 작성의 첫 단추는 입력·출력 파악"이라는 원칙을
#             기계적으로 매칭 가능한 형태로 구현. 이게 없으면 "기관A의
#             출력이 기관B의 입력과 같은 문서인지"를 시스템이 판단할 방법이
#             없어, 위치기반서비스 사례의 반복입력(10여 회) 같은 문제가
#             구조적으로 반복된다.
#             v1.1(2026-07-08): 사고실험 6·8 결과 반영 — 외국인 신원문서,
#             대리신청 위임문서 대분류 신설(HUMAN-AUTHORITY-GATE-SCHEMA
#             G8과 짝).
#             v1.2(2026-07-08): B-1 검증(GAP-LIST-50) 결과 반영. (1)
#             `HEALTH`·`EVIDENCE` 대분류 신설(#22·#42로 확인). (2) 당초
#             가설이던 `FINANCE` 대분류는 기각 — #30 재검토 결과 계좌정보
#             등은 "문서"가 아니라 원자값(atomic field)이라, 새 대분류가
#             아니라 `doc_type`/`pdv_field` 이원 표기 신설로 해결.
#             v1.3(2026-07-08): B-2 검증 결과 반영 — `typical_inputs_
#             required_to_obtain`이 참고용 메타데이터로만 존재하고 실제
#             경로 해석 동작이 없던 것을 §경로 해석으로 신설, 필드명도
#             `issuing_gov_task`로 명확화.
#             v1.4(2026-07-08): B-3 검증 결과 반영 — GOV_TASK_CHAIN_PLAN을
#             순수 선형(order)에서 DAG(depends_on)로 확장(#26·#33 병렬
#             AND-join). GOV_TASK_BROADCAST 신설(#37 팬아웃 통지 — 체인과
#             무관한 별도 메커니즘임을 확인).
#             v1.5(2026-07-08): B-5 검증 결과 반영(GAP-LIST-50에서 가장
#             중요하다고 표시했던 항목) — `task_type` 필드 신설
#             ("application"/"appeal"), GOV_TASK_APPEAL 신설. 지금까지
#             모든 설계가 정방향 신청만 상정했던 것을 확인.
#             v1.6(2026-07-08): B-6·B-7 검증 결과 반영(잔여 B급 일괄
#             처리) — task_type "participation"/"notification" 추가,
#             GOV_TASK_NOTIFY 신설. `DOC-PROXY-PROFESSIONAL`(전문직
#             위임) 신설.
# 적용 대상  : SP-AUTHOR PHASE B-0(신설)이 작성하는 모든 기관 SP의
#             INPUT_SCHEMA/OUTPUT_SCHEMA. `DATA_REQUIREMENT-SCHEMA`·
#             `PDV-TRANSFER-PROTOCOL`의 REQUIRED_USER_FIELDS/
#             ISSUED_DOCUMENTS는 이 레지스트리의 `doc_type` 식별자를
#             그대로 참조한다(자유서술 금지).
# 작성일     : 2026-07-08
# 작성자     : AI City Inc. · 주피터
# ═══════════════════════════════════════════════════
#
# 버전 변경 이력
# ─────────────────────────────────────────────────
# v1.6 (2026-07-08): task_type "participation"/"notification" 신설,
#                GOV_TASK_NOTIFY 신설, DOC-PROXY-PROFESSIONAL 신설.
# v1.5 (2026-07-08): 역방향 절차(불복·이의제기) 신설 — task_type 필드,
#                GOV_TASK_APPEAL, sustained/dismissed 종결상태.
# v1.4 (2026-07-08): GOV_TASK_CHAIN_PLAN을 DAG(depends_on)로 확장.
#                GOV_TASK_BROADCAST(팬아웃 통지) 신설.
# v1.3 (2026-07-08): §경로 해석 신설. `issuing_gov_task` 필드로
#                선행조건 자동 연쇄 계획 수립 근거 마련.
# v1.2 (2026-07-08): `HEALTH`·`EVIDENCE` 대분류 신설. `doc_type`/
#                `pdv_field` 이원 표기 신설(원자값은 새 대분류가 아니라
#                이 구분으로 처리).
# v1.1 (2026-07-08): `IDENT-FOREIGN`·`PROXY` 대분류 신설.
# v1.0 (2026-07-08): 최초 제정.
# ─────────────────────────────────────────────────
```

## 목적 — "출력=입력"을 기계가 판단할 수 있게

기관 SP가 각자 "사업자등록증이 필요합니다"라고 자유서술하면, 사람은 알아도
시스템은 기관A가 발급한 문서와 기관B가 요구하는 문서가 같은 것인지 문자열
비교로는 판단할 수 없다(오타·이명·띄어쓰기 차이만으로도 매칭 실패).
`doc_type`이라는 공통 식별자 하나로 발급 측·요구 측이 항상 같은 값을 쓰게
강제하면, 이 매칭이 기계적으로 성립한다 — SP-AUTHOR가 새 기관 SP를 찍어낼
때마다 자동으로 "이미 갖고 있을 가능성이 있는 문서"를 표시할 수 있게 되는
근거가 이것이다.

## doc_type 명명 규칙

```
DOC-{대분류}-{세부코드}
```

| 대분류 | 의미 | 예시 |
|---|---|---|
| `IDENT` | 신원 증명 | `DOC-IDENT-RESIDENCE`(주민등록등본), `DOC-IDENT-SEALCERT`(인감증명서) |
| `BIZ` | 사업자 관련 | `DOC-BIZ-REG`(사업자등록증), `DOC-BIZ-CORPNO`(법인등록번호증명) |
| `TAX` | 세무 관련 | `DOC-TAX-RECEIPT`(납세증명서), `DOC-TAX-LICENSEFEE-RECEIPT`(등록면허세 영수증) |
| `LICENSE` | 인허가·등록 산출물(절차 고유) | `DOC-LICENSE-{절차슬러그}`, 예: `DOC-LICENSE-LBS-REG`(위치기반서비스 등록증) |
| `FACILITY` | 설비·시설 관련 진술서 | `DOC-FACILITY-SPEC`(주요설비 명세서) |
| `IDENT-FOREIGN` | 외국인 신원 증명(내국인 `IDENT`와 별도 체계) | `DOC-IDENT-FOREIGN-REG`(외국인등록증), `DOC-IDENT-FOREIGN-ARC`(등록번호증명) |
| `PROXY` | 대리신청 자격 증빙(HUMAN-AUTHORITY-GATE-SCHEMA G8 전제조건) | `DOC-PROXY-AUTH`(위임장), `DOC-PROXY-FAMILY`(가족관계증명서, 법정대리인 확인용), `DOC-PROXY-PROFESSIONAL`(전문직 위임 — 변호사·법무사·세무사 등 자격증번호 결합) |
| `HEALTH` | 의료·건강 관련 입력문서(기본 `min_level: L3`) | `DOC-HEALTH-DIAGNOSIS`(진단서·소견서), `DOC-HEALTH-EXAM`(검사결과서) |
| `EVIDENCE` | 신고·민원의 증빙자료(신고인이 제출하는 자유형식 증거) | `DOC-EVIDENCE-CAPTURE`(스크린샷·통신기록 캡처), `DOC-EVIDENCE-PHOTO`(현장사진), `DOC-EVIDENCE-RECEIPT`(피해 영수증) |

절차 고유 산출물(`LICENSE`류)은 기관마다 새로 발급하는 게 원칙이라 재사용
대상이 아니다 — 매칭의 실익은 대부분 `IDENT`·`BIZ`·`TAX`류처럼 **여러
절차에서 반복 요구되는 입력**에서 나온다(위치기반서비스 사례의 사업자
등록증·법인등록번호가 정확히 이 유형). `IDENT-FOREIGN`·`PROXY`·`HEALTH`는
기본 `min_level: L3`로 등재한다 — 타인 신원·대리자격·건강정보와 직결되는
문서라 매 건 동의 대상에서 예외를 두지 않는다. `EVIDENCE`는 등재 시
건별로 `min_level`을 판단한다 — 단순 현장사진(L1)과 피해 통신기록(L2~L3)
은 민감도가 다르므로 대분류 하나로 일괄 지정하지 않는다.

## doc_type vs pdv_field — "문서"와 "원자값"은 다른 것이다

B-1 검증(#30 부가세 환급 계좌정보) 결과 확인된 것: 모든 입력이 "문서"는
아니다. 계좌번호·생년월일처럼 **발급받은 증서가 아니라 그 자체로 값인
것**은 `doc_type`으로 등재하지 않는다 — Navi가 이미 갖고 있는 PDV 필드
어휘(`docs/PROFILE_REGISTER_HANDOVER_v2.md`의 `biz_reg_no`·`ksic_code`류)
를 그대로 재사용한다. `INPUT_SCHEMA`는 이제 두 종류의 항목을 명시적으로
구분해 표기한다:

```json
"INPUT_SCHEMA": [
  { "type": "doc_type", "value": "DOC-HEALTH-DIAGNOSIS", "required": true },
  { "type": "pdv_field", "value": "bank_account_no", "min_level": "L2", "required": true }
]
```

`doc_type` 항목만 §승계 후보 판정(발급 이력 재사용)의 대상이다 —
`pdv_field`는 PDV_STORE에서 직접 조회하는 것이지 "발급받아 재사용"하는
성격이 아니므로 별도 취급한다. 새 `doc_type`을 등재하기 전에는 먼저
"이게 발급되는 증서인가, 그냥 값인가"부터 판별한다 — 애매하면 pdv_field
쪽을 기본값으로 한다(불필요한 doc_type 증식 방지).

## 등재 절차

새 `doc_type`이 필요하면 SP-AUTHOR가 임의로 만들지 않고, 기존 레지스트리를
먼저 전수 검색해 동의어가 이미 있는지 확인한다(§등재 예시의 `aliases` 필드
활용). 없을 때만 신규 등재하며, 등재 시 다음을 필수로 채운다:

```json
{
  "doc_type": "DOC-BIZ-REG",
  "label": "사업자등록증",
  "aliases": ["사업자 등록증", "사업자등록증명원"],
  "issuing_agency_pattern": "국세청(세무서)",
  "typical_inputs_required_to_obtain": ["DOC-IDENT-RESIDENCE"],
  "issuing_gov_task": "SP-NAT-TAX:사업자등록",
  "min_level": "L2",
  "registered_by_sp_draft": "{이 doc_type을 처음 등재한 GOV_SP_DRAFT_REQUEST id}"
}
```

`issuing_gov_task`는 이 `doc_type`이 Navi 생태계 안에서 실제로 발급
가능한 GOV_TASK가 있으면 `{tier}-{institution}:{task명}` 형식으로
채운다(§경로 해석의 근거). 아직 그 기관 SP가 없으면 `null`로 두고,
SP-AUTHOR가 나중에 해당 SP를 찍어낼 때 이 필드를 채운다 — 등재 시점에
반드시 알아야 하는 필드는 아니다.

`min_level`은 `DATA_REQUIREMENT-SCHEMA`/`PDV-TRANSFER-PROTOCOL`의 L0~L3
어휘를 그대로 재사용한다 — 이 문서가 별도 민감도 체계를 만들지 않는다.

## 경로 해석 — 선행조건을 사용자에게 떠넘기지 않는다

B-2 검증(#25 폐기물 처리업 등록 — 배출시설 설치허가 선행 필요)에서 확인된
문제: `typical_inputs_required_to_obtain`이 참고용 메타데이터로만 있었지,
실제로 사용자 AI 비서가 "이 문서가 없으면 어디서 받아야 하는지"까지
자동으로 계획을 세우는 동작이 정의된 적이 없었다. 이제 GOV_TASK를 시작하기
전, INPUT_SCHEMA의 각 `doc_type` 항목에 대해 §승계 후보 판정(이미 갖고
있는지 확인) 다음 단계로 아래를 수행한다:

```
1. 승계 후보가 없다면, 그 doc_type의 `issuing_gov_task`를 조회한다.
2. `issuing_gov_task`가 있으면, 그 GOV_TASK의 INPUT_SCHEMA도 같은 방식
   으로 재귀 확인한다(순환 참조 방지를 위해 깊이 제한을 둔다 — 기본 3단계).
3. 전체 선행조건 사슬이 확정되면, 사용자에게 실행 순서 전체를 한 번에
   보여주고 승인을 받는다:
```

```
[GOV_TASK_CHAIN_PLAN: steps=[
  {id:"fire", task:"소방동의", agency:"소방서", depends_on:[]},
  {id:"urban", task:"도시계획심의", agency:"도시계획과", depends_on:[]},
  {id:"final", task:"건축허가", agency:"건축과", depends_on:["fire","urban"]}
], blocking=true]
```

B-3 검증(#26 건축허가, #33 공연장 등록)에서 확인된 것: 선행조건이 **하나가
아니라 서로 독립적인 여러 개**인 경우(소방·도시계획처럼 서로 순서가
없는 병렬 승인)가 실제로 더 흔하다. `order`(순번) 하나로는 이걸 표현할
수 없어 `depends_on`(선행 step id 배열) 기반 DAG로 바꿨다 — `depends_on`이
빈 항목들은 동시에 병렬 실행되고, `final`처럼 다른 step에 의존하는 항목만
그 선행 항목들이 전부 완료된 뒤 시작한다. 선형 사슬(B-2 사례)은 이
DAG의 특수한 경우(각 step이 바로 앞 step 하나에만 의존)로 그대로 표현된다
— 별도 문법이 필요하지 않다.

전체 계획은 한 번만 승인받지만(사용자가 매 단계마다 "이거 왜 필요하냐"고
재확인당하지 않도록), **각 단계 내부의 G1~G10 게이트(사실확인·결제승인
등)는 단계마다 그대로 적용**된다 — 전체계획 승인이 개별 단계의 승인을
대체하지 않는다. `issuing_gov_task`가 없는(=아직 Navi에 그 기관 SP가
없는) doc_type을 만나면 그 지점에서 사슬 해석을 멈추고, 기존대로 "이
서류는 직접 준비해주세요" 안내로 폴백한다 — 억지로 SP-AUTHOR를 그 자리에서
호출하지 않는다(§PROACTIVE-SWEEP의 계획된 우선순위를 무시하고 즉흥적으로
새 SP를 만들면 클러스터링(PHASE(-1))의 효율 이점이 없어지기 때문).

## 팬아웃 통지 — 체인과는 다른 문제

B-3 검증(#37 폐업신고 — 세무서·국민연금공단·건강보험공단 동시 통지)에서
확인된 것: 이건 위 체인/DAG로 표현할 수 없다 — 세 기관은 서로를
기다리지 않고, 하나의 최종 산출물로 수렴하지도 않는다. 같은 사건을 각자
독립적으로 처리할 뿐이다. 별도 태그를 신설한다:

```
[GOV_TASK_BROADCAST: trigger_event="폐업", targets=[
  {agency:"세무서", task:"폐업신고"},
  {agency:"국민연금공단", task:"자격상실신고"},
  {agency:"건강보험공단", task:"자격상실신고"}
], independent=true]
```

`independent=true`가 이 태그의 핵심이다 — 각 target은 완전히 독립된
GOV_TASK로 동시 발송되고, 각자 자신의 G1~G10 게이트를 각자 통과하며,
한 곳이 지연되거나 거부돼도 다른 곳에 영향을 주지 않는다. 사용자에게는
하나의 통합 진행 현황("3곳 중 2곳 완료")으로 보여주되, 내부적으로는
`gov_tickets`에 완전히 별도 레코드로 남는다. 부수 효과: 같은 트리거를
동시에 여러 기관에 보내는 구조라서, `gov_latency_stats`(PDV-TRANSFER-
PROTOCOL §5)에 **완벽한 대조군 데이터**가 자동으로 쌓인다 — 같은 시각에
같은 사건으로 시작된 처리가 기관마다 얼마나 다르게 걸리는지, 다른 변수
없이 순수하게 비교할 수 있다.

## 기관 SP의 INPUT_SCHEMA / OUTPUT_SCHEMA 표기

```json
"INPUT_SCHEMA": [
  { "doc_type": "DOC-BIZ-REG", "required": true },
  { "doc_type": "DOC-IDENT-RESIDENCE", "required": false, "condition": "법인이 아닌 개인사업자인 경우" }
],
"OUTPUT_SCHEMA": [
  { "doc_type": "DOC-LICENSE-LBS-REG", "format": "PDF 등록증" }
]
```

## 승계 후보 판정 — "가능성 계산"이지 "자동전송"이 아니다

사용자 AI 비서는 새 GOV_TASK를 시작하기 전, 대상 기관 SP의 `INPUT_SCHEMA`
각 `doc_type`에 대해 다음 순서로 이미 보유한 것이 있는지 조회한다:

```
1. PDV_STORE{type:"transfer"} 이력에 같은 doc_type을 이미 다른 기관에
   제출한 기록이 있는가? (재사용 가능한 사본이 있을 수 있음)
2. 다른 기관의 OUTPUT_SCHEMA 중 같은 doc_type을 이미 발급받은 이력이
   `gov_tickets`에 있는가?
```

둘 중 하나라도 있으면 "승계 후보"로 표시하고 사용자에게 확인만 받는다
(재입력·재발급 요청 대신 "지난번 받으신 {doc_type} 그대로 쓸까요?"로
1턴 단축). **이 조회와 확인은 어디까지나 사용자 AI 비서가 수행**하며,
`PDV-TRANSFER-PROTOCOL` §3-A(기관 간 직접 전달 예외 없이 금지)를 우회하지
않는다 — 승계 후보 판정이 "무엇을 갖고 있는지 아는 것"이라면, 실제 전송은
여전히 §1~§3의 화이트리스트·동의 절차를 그대로 거친다.

## 역방향 절차 — 불복·이의제기

B-5 검증(#49 세액 부과 이의신청, 원처분기관≠심사기관)에서 확인된 것:
지금까지 모든 GOV_TASK는 암묵적으로 `task_type="application"`(정방향
신청) 하나만 상정했다. `gov_tickets`에 `task_type` 필드를 신설하고,
`"appeal"`(불복·이의제기)을 두 번째 값으로 추가한다:

```
[GOV_TASK_APPEAL: disputed_decision={원처분 gov_tickets 레코드 ID,
    doc_type=DOC-TAX-ASSESSMENT-NOTICE}, original_agency="세무서",
  review_agency="조세심판원", grounds=..., filing_deadline={원처분
    발급일+법정기간}]
```

**재사용되는 부분**: 다투는 대상인 원처분 문서(`disputed_decision`)는
새로 제출받을 필요가 없다 — 이미 `gov_tickets`에 있는 기존 발급 이력이므로
§승계 후보 판정이 그대로 적용된다. 결과 통지(인용 시 원처분기관에 정정
반영)는 새 메커니즘이 필요 없다 — `GOV_TASK_BROADCAST`(원처분기관 1곳
대상, 정정 통지)를 그대로 쓴다.

**새로 필요한 부분**: `filing_deadline`(불복기한)은 정방향 절차에 없던
개념이다 — 기관이 처리하는 데 걸리는 시간(G11)이 아니라, **사용자가
행동하지 않으면 권리가 소멸하는** 시한이다. 이건 HUMAN-AUTHORITY-GATE-
SCHEMA G14(불복기한 게이트)로 별도 신설한다.

`gov_tickets`의 종결 상태에 `sustained`(인용)·`dismissed`(기각)를
추가한다 — `denied`(정방향 절차에서 기관이 최초 거부)와는 다른 상태다.

## 참여형·알림형 절차 — 신청도 불복도 아닌 나머지

B-6 검증(#38 조례 의견수렴, #28 운전면허 갱신 선제 알림) 결과 신설.
`task_type`을 두 값 더 확장한다:

- **`"participation"`**(참여형) — 발급물이 없는 절차. 산출물을 기다리는
  게 아니라 의견 제출 자체가 종결이다. 종결 상태는 `issued`가 아니라
  `submitted_for_record`(기록으로 접수됨, 승인/거부 판단 대상이 아님).
- **`"notification"`**(알림형) — 기관이 사용자에게 먼저 말을 거는
  절차. G14(불복기한 게이트, HUMAN-AUTHORITY-GATE-SCHEMA)가 "사용자
  요청 없이 먼저 발화하는 유일한 게이트"였는데, 이제 그 원리를
  기한 임박 알림 일반으로 확장한다:

```
[GOV_TASK_NOTIFY: agency=..., subject=..., reason=...,
  action_needed=true|false]
```

`action_needed=false`면 단순 정보 제공(참고만)이고, `true`면 사용자
행동이 필요한 알림(면허 갱신 임박 등)이라 G14와 동일하게 취급한다 —
방치하면 권리·자격이 소멸할 수 있는 사안은 §PROACTIVE-SWEEP이 우선순위
①에 준하는 감시 대상으로 등록한다.

## SP-AUTHOR와의 관계

`SP-AUTHOR_v1_0.md`의 PHASE C(역할·절차 조사)는 이 문서 제정 이후
PHASE B-0으로 앞당겨지고 범위가 좁혀진다 — "이 기관이 하는 일 전반"을
막연히 조사하는 게 아니라 **INPUT_SCHEMA/OUTPUT_SCHEMA부터 확정**하는
것이 첫 조사 목표가 된다(SP-AUTHOR v1.1 패치로 반영).
