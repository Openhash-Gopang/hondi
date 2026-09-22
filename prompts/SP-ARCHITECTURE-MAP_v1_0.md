# SP-ARCHITECTURE-MAP · 전체 SP 위계 구조 지도 v1.1

> **문서 성격**: `SP_hierarchy_inheritance_v1_0.md`(SP-COMMON-05, 상속의
> 일반 원칙 H1~H8)는 그대로 유효하다. 이 문서는 그 원칙이 **실제로 어느
> 코드에서, 어떤 상태로 적용돼 있는지**를 검증된 사실 기준으로 기록한
> 지도다 — "설계상 이래야 한다"가 아니라 "2026-07-04 기준 실제로 이렇다".
> 상태 표시: ✅ 코드로 확인됨 / ⚠️ 부분 적용·조건부 / ❌ 미적용(알려진
> 공백) / ❓ 미확인.

---

## 0. 전체 트리

```
UNIVERSAL-INTEGRITY_v1_0.md  (U0~U7 — 안내로 끝내지 않기, 확신도 이원화, 불확실 식별자 차단, 인허가 모호성 처리, 안전판정 민감도 유지, 완료 연출 금지)
│  ROUTER-PRIORITY_v1_0.md가 "어디로 보낼지"를 결정, 이 문서는
│  "보내진 곳에서 어떻게 판단할지"를 결정 — 트랙 무관 최상위
│
├─ [정부 트랙] JEJU-GOV-COMMON_v1_5.md  (§1~§14: 정체성·PDV·적극적보조)
│   ├─ JEJU-DO-SP (도청) → SP-DO-* (13개 부서)
│   ├─ JEJU-NATIONAL-SP → SP-NAT-* (20개 국가기관 제주 지역 대변)
│   ├─ SP-CITY-JEJU / SP-CITY-SEOGWIPO (행정시)
│   ├─ SP-EMD-* (읍면동, 43개 데이터 + TEMPLATE)
│   └─ SP-EXP-EMERGENCY / SP-EXP-WATER (응급·상수도, GOV-COMMON 직속)
│
├─ [K-서비스 트랙 — 국가사무] K-Public_common_v1_3.md  (P1~P10: 정체성·업무수행/권한행사 분리)
│   └─ GOV_AGENCIES 9개 (worker.js /gov/relay 배포 완료, ✅):
│      public · tax · health · police · 911 · democracy · insurance ·
│      traffic · logistics
│
├─ [K-서비스 트랙 — 독자 노선] SP-01_klaw_v15.1.txt
│   └─ /klaw/relay 전용, K-Public_common **미상속**(❌, 별도 관리 결정
│      상태) — 단, 자체 확신도 이원화 메커니즘이 UNIVERSAL-INTEGRITY
│      원안이 될 만큼 정교해 실질적 공백은 아님. UNIVERSAL-INTEGRITY만
│      서버측 강제 주입(✅, handleKlawRelay)
│
├─ [K-서비스 트랙 — 미편입 5개] ⚠️ K-Public_common 상속 안 함(정체성
│   불일치 — 국가기관이 아니라서 의도적으로 배제), UNIVERSAL-INTEGRITY만
│   클라이언트 코드에서 직접 fetch:
│   ├─ K-School (school 저장소) ✅ 배선 완료(2026-07-04)
│   ├─ K-Market/K-Commerce (market 저장소) ✅
│   ├─ K-Stock (stock 저장소) ✅
│   ├─ GDC (gdc 저장소, desktop.html만 — webapp.html은 AI채팅 없음) ✅
│   └─ K-Clean (fiil.kr) ❓ 저장소 위치 미발견, 미배선
│
├─ [전문직 페르소나 트랙] SP_common_guardrails.md(매니페스트 경유 최신본)  (C1~C42: 적극적보조 판단/실행 분리)
│   ├─ (의료 계열) SP_common_medical_safety.md(매니페스트 경유 최신본) + SP_red_flag_registry_v1_0.md 추가 상속
│   └─ 27개 페르소나 (SP_lawyer, SP_nurse, ... SP_tax-accountant 등)
│      expert-session.js가 UNIVERSAL-INTEGRITY → 공통가드레일 → (의료시
│      안전모듈) → 페르소나 순으로 매 세션 fetch+prepend ✅ 코드 확인됨
│
└─ [개인/사업자 트랙] AGENT-COMMON_v3_44.txt  (그림자 AI 기본값, R4 폴백)
    └─ AGENT-SUPPLIER-{KSIC}  (R3 — 라우팅 대상 아닌 직교 배경레이어,
       사용자 프로필의 업종코드로 결정, worker.js _compileAgentSP)
       UNIVERSAL-INTEGRITY가 이 합성의 최선두 ✅
```

## 1. 라우팅은 별도 문서 — ROUTER-PRIORITY_v1_0.md

위 트리 중 "이번 발화가 어디로 가는가"는 이 문서가 아니라
`ROUTER-PRIORITY_v1_0.md`(R0 응급 게이트 → R1 공익대변/사익대리 → R2
국가사무/자치사무 → R3 사업자 직교레이어 → R4 개인 폴백)가 결정한다.
이 문서는 "도착한 뒤 어떤 공통 규칙을 상속하는가"만 다룬다.

## 2. 트랙별 검증 상태 요약표

| 트랙 | 최상위 상속 원본 | 실제 코드 경로 | 상태 |
|---|---|---|---|
| 정부(Jejudo, 50개 SP) | JEJU-GOV-COMMON_v1_5 | `jeju-router.js`(jeju 저장소, GitHub raw 실시간 fetch) | ✅ (2026-07-04 SP-EXP-EMERGENCY 404 버그 수정 포함) |
| K-Public 9개 | K-Public_common_v1_3 | `worker.js` `handleGovRelay` + `GOV_AGENCIES` | ✅ (wrangler deploy 시점부터 적용) |
| K-Law | 자체(K-Public_common 미상속) | `worker.js` `handleKlawRelay` | ⚠️ 의도적 예외, UNIVERSAL-INTEGRITY만 주입 |
| 미편입 K-서비스 4개 | (없음, UNIVERSAL-INTEGRITY만) | 각 저장소 클라이언트 JS | ✅ (2026-07-04 신규 배선) |
| K-Clean | ❓ | ❓ | ❓ 저장소 미발견 |
| 전문직 27개 | SP_common_guardrails(매니페스트 경유 최신본) | `expert-session.js` `_composeExpertPrompt` | ✅ 코드 확인 |
| 개인/사업자 | AGENT-COMMON_v3_44 | `worker.js` `_compileAgentSP` | ✅ 코드 확인 |

## 3. 알려진 공백 (다음 작업 후보)

1. K-Clean 저장소 위치 확인 및 UNIVERSAL-INTEGRITY 배선
2. K-Law를 K-Public_common 생태계로 완전 편입할지, 계속 독자 노선으로
   둘지 — `SP_hierarchy_inheritance_v1_0.md`에 "다음 개정 때 편입 예정"
   이라고 오래전부터 적혀있었으나 실행되지 않은 상태
3. 정부 트랙 48개 leaf SP의 도메인별 §14 실행 예시 보강(반복 권고)
4. `SP_hierarchy_inheritance_v1_0.md`의 조직도 섹션 자체를 이 문서로
   대체하거나, 이 문서를 참조하도록 링크 추가(중복 방지)
5. **(2026-07-18 발견)** 이 문서의 버전 표기가 실제 sp-catalog.json
   대비 크게 뒤처져 있었다(K-Public_common v1_1→실제 v1_3,
   SP_common_guardrails v3_2→실제 v3_10, AGENT-COMMON v3_9→실제
   v3_44) — 이번에 그 세 값만 수정했다. 단, "GOV_AGENCIES 9개" 목록
   자체(§0, §2 표)와 "미편입 5개" 목록, K-Public 상속 여부 같은
   **구조적 사실**은 이번에 재검증하지 않았다 — 위 세 파일의 버전
   문자열만 확인하고 고쳤을 뿐, worker.js의 UNIVERSAL_FORCED_K_SERVICES
   (14개 서비스: kemergency·kpolice·ksecurity·khealth·kedu·kgdc·
   kfinance·kinsurance·ktax·kcommerce·ktransport·klogistics·
   kdemocracy·fiil-kcleaner)와 이 문서의 "GOV_AGENCIES 9개"가 같은
   집합인지, 아니면 서로 다른 목적(UNIVERSAL-INTEGRITY 강제주입 대상
   vs K-Public_common 상속 대상)의 별개 목록인지는 확인하지 못했다.
   다음 세션에서 worker.js를 처음부터 다시 훑어 이 문서 전체를
   재검증할 것을 권한다 — 지금 상태로는 "✅ 코드 확인됨" 표시 중
   일부가 실제로는 2026-07-04 시점 기준이라는 걸 감안해서 읽어야 한다.

## 4. UNIVERSAL-INTEGRITY 부록(2026-07-18 신설) 참고
UNIVERSAL-INTEGRITY_v1_0.md에 "부록. 혼디 플랫폼 자체의 유지보수 세션
참고사항"이 추가되어, `docs/HONDI_GAP_REMEDIATION_DIRECTIVE_v1_0.md`
(16개 저장소 점검 세션의 미비점 보완 지시서)를 조건부로 참조한다 —
TASK-DELEGATION-GUIDE와 달리 manifest-loader.js가 강제 주입하지는
않는다(이용자 응대와 무관한 내용이라 매 대화에 섞이면 안 되므로).
이 지도(SP-ARCHITECTURE-MAP)가 다루는 "코드가 강제로 상속시키는 문서"
목록에는 포함되지 않는다 — 성격이 다른 참조라는 점에 유의.

## 4. 다국가 확장 설계 (개념 단계, 2026-07-04 추가)

`GLOBAL-LOCAL-COMPLIANCE_v1_0.md` — K-서비스를 "보편원칙 계층(혼디 자체
규약, 국가 무관, 자동 적용)"과 "국가모듈 계층(실정법 반영 + 실제 관할
인간 승인)"으로 나누는 설계. 지금 `K-Public_common_v1_3.md`은 이 구조의
"한국모듈" 인스턴스로 재해석되며, 실제 코드 상 두 층위 분리는 아직 안
됐다(문서는 개념 정의 단계, 구현은 향후 다국가 확장 시점 과제).

---

## 변경 이력
- v1.1 (2026-07-18): UNIVERSAL-INTEGRITY U0~U7 반영(이전 세션 v1.7까지
  기준으로 U1~U5라 적혀있던 stale 표기 수정). K-Public_common(v1_1→
  v1_3)·SP_common_guardrails(v3_2→v3_10, C1~C42로 확인)·AGENT-COMMON
  (v3_9→v3_44) 버전 표기를 sp-catalog.json 기준으로 갱신. §3에 이번에
  검증하지 못한 부분(GOV_AGENCIES 9개 목록과 UNIVERSAL_FORCED_K_SERVICES
  14개 목록의 관계 등) 명시. §4에 UNIVERSAL-INTEGRITY 신규 부록
  (HONDI_GAP_REMEDIATION_DIRECTIVE 참조) 안내 추가.
- v1.0 (2026-07-04): 최초 작성. UNIVERSAL-INTEGRITY/ROUTER-PRIORITY 신설,
  K-Public_common v1.1, AGENT-COMMON v3.9, tax-accountant 신설, 5개
  미편입 서비스 배선, kinsurance 중복 정리, jeju-router.js 버그 수정까지
  모두 반영한 최초의 "검증된 실제 상태" 지도.
