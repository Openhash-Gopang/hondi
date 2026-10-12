# SP-TREE-REGISTRY v1.0 · SP 상호 참조 단일 진실 공급원

## 이 문서의 목적

지금까지 각 SP가 다른 SP를 가리킬 때 자기 헤더나 본문에 `이름_v버전`을
직접 적어 넣었다. 그 SP가 개정되면 참조하는 쪽 전부를 손으로 찾아 고쳐야
했고, 실제로 2026-07-29 감사에서 16개 파일·33건이 갱신되지 않은 채
방치되어 있었다(worker.js·gov-router.js가 URL에 문서 버전을 직접 박아
fetch하던 것과 같은 종류의 버그 — 다만 코드가 아니라 prompts/ 문서
자체에 있었다).

이제부터 규칙은 하나다: **다른 SP를 가리킬 때는 이름만 쓰고, 버전은
절대 적지 않는다.** 최신 버전이 몇 번인지 알아야 할 때는
`prompts/sp-catalog.json`(이름→실제 파일명 매핑, 기계가 읽는 SSOT)을
보거나, 사람이 읽을 때는 이 문서에서 "누가 무엇을 상속/참조하는가"라는
구조 정보를 확인한다. 이름과 버전은 서로 다른 문서가 각자 책임진다 —
sp-catalog.json은 "이름 → 최신 파일명", 이 문서는 "이름 → 이름 관계".

`tools/check_no_hardcoded_sp_refs.py`가 이 규칙을 CI에서 기계적으로
강제한다 — 등록된 SP가 다른 SP의 이름+버전을 나란히 적으면 빌드가
실패한다(변경이력 섹션의 과거 기록은 예외).

## 사용법

- **SP를 새로 작성/개정할 때** 다른 SP를 언급해야 하면: `이름(SP-TREE-REGISTRY 참조)`
  형태로 쓴다. 버전 번호나 확장자(.md/.txt)를 붙이지 않는다.
- **실제 최신 파일이 필요한 코드(worker.js 등)**는 이 문서가 아니라
  `prompts/sp-catalog.json`을 통해 가져온다. 이 문서는 사람·LLM이 구조를
  파악하기 위한 것이지, 런타임이 참조하는 경로가 아니다.
- **새 상속/참조 관계가 생기면** 이 문서의 해당 섹션에 한 줄 추가한다.
  CI는 "버전이 박혀 있는가"만 검사하고 "이 문서가 최신인가"는 검사하지
  않으므로, 최신 상태 유지는 여전히 사람의 책임이다.

## A. 공식 상속 패밀리 (tools/check_sp_inheritance.py가 기계적으로 검증)

이 세 패밀리는 이미 별도 CI(check-sp-inheritance.yml)가 상속 선언·필수
섹션·복붙 여부까지 검사하고 있다. 아래는 그 요약이다.

- **AGENT-SUPPLIER-COMMON** ← AGENT-SUPPLIER-01 ~ 99 (KSIC 업종별 페르소나,
  77개 파일 운영 중, informational — 레거시 버전 세대 차이 존재)
- **SP-INDUSTRY-TRANSFORM-COMMON** ← SP-INDUSTRY-TRANSFORM-01 ~ 56
  (strict — 2026-07-23 신규 패밀리, 위반 이력 없음 유지)
  - SP-INDUSTRY-TRANSFORM-COMMON 자신은 TRANSFORM-COMMON 계열 원칙을
    따르며, AGENT-SUPPLIER-COMMON과는 "§0 정체성 차이" 근거로 별도
    계열임을 명시한다(업종 대변 vs 산업전환 상담이라는 목적 차이).
- **SP-10_kpublic(kgov)** ← policy-bodies 70개(`SP-NAT-POLICY-*`,
  `prompts/gov-tree/09-national/policy-bodies/`) — POLICY-BODIES 패밀리로
  2026-08-03 신설 등록(informational — 최초 등록이라 위반 이력 검증 진행
  중). 다른 두 패밀리와 달리 "common" 파일이 자식과 같은 디렉터리에 있지
  않다 — kgov는 policy-bodies 외에도 광역시도청·시군구청 등 훨씬 많은
  기관이 함께 상속하는 전국 공통 원본이기 때문. 상속 선언(헤더의
  "# 상위 상속" 문구)·필수 섹션(§LEGAL-BASIS·§1·§CAPABILITIES·§5) 검증만
  수행하며 복붙 여부도 함께 검사한다.
  - **본청(policy-bodies) vs 지사(agencies/templates) 공존 관계** — 국세청
    (NTS/TAX)·관세청(KCS/CUSTOMS)·경찰청(POLICE)·병무청(MMA)·해양경찰청
    (KCG/COASTGUARD)·조달청(PPS)·검찰청(PROSECUTION) 7개 기관은 두 계층에
    동시에 존재한다 — policy-bodies의 `SP-NAT-POLICY-{CODE}`(전국 단일
    본청 창구)와 `agencies/templates/SP-NAT-{NAME}-TEMPLATE`(도별 지사
    싱글턴 인스턴스)는 부모-자식 관계가 아니라 **둘 다 kgov를 직접
    상속하는 형제 관계**이며, 어느 쪽이 응답할지는 발화 성격으로
    갈린다(정책·제도 문의 → policy-bodies, 접수·처리 등 실행형 민원 →
    지사) — `gov-router.js`의 `-0.8)` 단계 우선순위 가드(정책기관과
    집행기관 사전이 동시 매칭될 때 지사 라우팅이 우선)에 이미 구현돼
    있으나, 이 문서에는 2026-08-03 이전까지 문서화가 빠져 있었다.

## B. K-Public 정부기관 계열 (SP_hierarchy_inheritance 문서의 H1~H8 원칙 적용 대상)

```
K-Public (국가/공공기관 AI 공통 규칙 원본 — 상속의 최상위)
 ├─ 행정부: K-Province · K-City · K-County · K-Tax · K-Health ·
 │          police · 911 · K-Insurance(공적 영역만) ·
 │          policy-bodies 70개(중앙정부 부처·청·위원회 본청, 대통령 직속
 │          기관 포함 — SP-NAT-POLICY-*, POLICY-BODIES 패밀리)
 ├─ 사법부: 대법원 대변 AI(SP-NAT-POLICY-SUPREMECOURT) ·
 │          헌법재판소 대변 AI(SP-NAT-POLICY-CONSTCOURT)
 └─ 입법부: 국회 대변 AI(SP-NAT-POLICY-ASSEMBLY)
            [지방의회 대변 AI는 아직 미작성 — 필요 시 이 자리에 추가]

K-Doctor — 독립. K-Health를 상속하지 않는다(제도 대변과 개인 면허
           전문가 모사는 서로 다른 계열이라는 원칙, SP_hierarchy_inheritance 참조).
```

> **2026-08-03 정정** — 이전 버전은 입법부 항목을 "democracy(국회 +
> 지방의회)"로 표기했으나 이는 부정확했다. `SP-12_kdemocracy`는 국회를
> 대변하는 기관 페르소나가 **아니다** — 나비(Navi) 생태계 자체의
> 내부 거버넌스(DAWN, 직접민주주의 절차) 도구이며, 문서 자신의
> §0-IDENTITY에서 "대한민국 국가기관을 대표하지 않습니다"라고 명시적으로
> 오버라이드하고, 실제 국민동의청원 등 진짜 국가기관 청원은 kgov 소관이라고
> 스스로 밝히고 있다(민원 채널을 혼동하지 않도록 주의). 실제 국회
> 기관 페르소나는 policy-bodies 70개 중 하나인 `SP-NAT-POLICY-ASSEMBLY`이며,
> 사법부 두 기관과 동일하게 kgov를 직접 상속한다 — 위 다이어그램이 이제
> 그 실제 구조를 반영한다. `SP-12_kdemocracy`는 이 트리에 속하지 않는
> 별도 계열이므로 여기서 제외했다.

- **K-Public_common** ← 각 기관 SP(SP-10_kpublic 등)가 상속
- **PROFESSIONAL-common** ← K-Public_common이 상속(직역 전문성 공통 규칙)
- **UNIVERSAL-common** ← PROFESSIONAL-common이 상속(전체 SP 최상위 공통)
  - UNIVERSAL-common은 UNIVERSAL-INTEGRITY와는 별개 문서다(성격이 다름 —
    후자는 무결성/사실성 원칙 전용).
- **HUMAN-AUTHORITY-GATE-SCHEMA** ← SP-10_kpublic, SP-INDUSTRY-TRANSFORM-COMMON
  등 인간 승인 게이트가 필요한 다수 SP가 참조
- **PDV-TRANSFER-PROTOCOL** ← SP-10_kpublic이 개인정보 이전 시 참조
- **GOV-TIER-IO-SCHEMA** ← SP-INDUSTRY-TRANSFORM-COMMON, gov-tree 템플릿군이 참조
  - **DOCUMENT-TYPE-REGISTRY**, **DATA_REQUIREMENT-SCHEMA** ← GOV-TIER-IO-SCHEMA가 참조

## C. gov-tree 계열 (Jeju 중심에서 전국 16개 광역시도로 확장된 라우팅 문서군)

- **gov-tree/00-common/GOV-TREE-PROTOCOL** → kgov(SP-10_kpublic)를 참조
- **gov-tree/00-common/overlays/GOV-COMMON-OVERLAY-TEMPLATE** → kgov(SP-10_kpublic)를 참조
- **gov-tree/01-do/templates/SP-PROVINCE-TEMPLATE** → GOV-TIER-IO-SCHEMA를 참조

> worker.js와 gov-router.js가 이 계열 문서를 각자 다른 코드 경로에서
> fetch한다 — 한쪽만 매니페스트 경유로 고치고 다른 쪽을 놓치는 실수가
> 반복될 위험이 있다(2026-07-29 감사에서 실제로 10곳 중 일부가 그런
> 상태였다). 이 계열을 건드릴 때는 항상 양쪽을 함께 확인한다.

## D. 전문가 페르소나(EXPERT) 안전장치 계열

- **SP_common_guardrails** — 60개 EXPERT 페르소나 전원이 상속하는 안전
  게이트 설계(C30~C34 사용자 등급 분기, 레드플래그 레지스트리 연동).
  본문 안에서 SP_lawyer·SP_physician을 구체 사례로 언급한다(최초 적용
  사례 추적용 — 어느 SP가 먼저 반영됐는지 기록하는 목적이지, 상속
  관계는 아니다).
- **SP_red_flag_registry** ← SP_PDV, SP_dietitian, SP_common_guardrails 등이
  참조(민감정보 감지 시 태깅 정책)
- **SP_PDV** → SP_common_guardrails, SP_red_flag_registry를 참조

## E. 기타 개별 참조

- **business-kr** → k-business를 본문 전체 삽입 방식으로 참조
- **SP_professional-engineer** → SP_nurse, SP_dietitian을 패턴 참고 사례로 언급
- **SP_social-worker** → SP_real-estate-agent를 서술 방식 참고 사례로 언급
- **profile-assistant** → HONDI-CAPABILITIES-COMMON을 참조
- **k-plan** → k-watch·k-job과 동일한 조립 순서(UNIVERSAL-INTEGRITY →
  UNIVERSAL-common → k-plan → plan-kr(국가모듈) → agencyPrompt)로 설계된
  단일 공통 SP. 2026-09-02 gwp-registry.js·call-ai.js(SWITCH_SP_LOADERS)에
  편입 — type:'switch', 태그 `[CALL_KPLAN: query=...]`.
- **k-watch** → k-plan과 동일한 조립 순서로 설계된 단일 공통 SP.
  2026-09-02 gwp-registry.js·call-ai.js(SWITCH_SP_LOADERS)에 편입 —
  type:'switch', 태그 `[CALL_KWATCH: query=...]`.
- **k-job** → k-plan(prompts/k-plan_v1_0.md)·k-watch(prompts/k-watch_v1_0.md)와
  동일한 조립 순서(UNIVERSAL-INTEGRITY → UNIVERSAL-common → k-job →
  job-kr(국가모듈) → agencyPrompt)를 참고 사례로 언급 — 2026-09-02 신설.
  구직자 개인용 단일 공통 모듈이며, K-Biz-COMMON식 KSIC 업종별 세분화는
  이번 범위에 포함하지 않는다(§ Q1에 K-Plan·EXPERT 페르소나와의 정체성
  차이 명시). 2026-09-02 gwp-registry.js·call-ai.js(SWITCH_SP_LOADERS)에
  편입 — type:'switch', 태그 `[CALL_KJOB: query=...]`.

## F. 기계 판독용 엣지 목록 (CI·SP-TREE-GUARDIAN 공통 파싱 대상)

A~E는 사람이 읽는 설명이고, 아래 블록은 `tools/check_no_undeclared_inheritance.py`와
`SP-TREE-GUARDIAN`이 똑같이 파싱하는 단일 데이터다 — **새 상속 관계가 필요하면
반드시 여기에 줄을 추가해야 하고(그래야 CI가 통과한다), 그 외의 방식으로
"관습적으로" 새 부모-자식 관계를 선언할 수 없다.**

형식: `CHILD_PATTERN -> PARENT_NAME` 한 줄에 하나. `CHILD_PATTERN`은 정확한
이름이거나 `*` 글롭(예: `AGENT-SUPPLIER-*`)을 쓸 수 있다. `#`으로 시작하는 줄은
주석. `ALIAS: 짧은이름 = 정식이름` 줄로 코드/문서에서 흔히 쓰는 별칭을 등록한다
(예: `kgov`는 `SP-10_kpublic`을 가리키는 관용 별칭).

```edges
# 별칭
ALIAS: kgov = SP-10_kpublic

# 공식 패밀리 (tools/check_sp_inheritance.py가 이미 상세 검증)
AGENT-SUPPLIER-* -> AGENT-SUPPLIER-COMMON
SP-INDUSTRY-TRANSFORM-* -> SP-INDUSTRY-TRANSFORM-COMMON
SP-NAT-POLICY-* -> kgov

# UNIVERSAL-INTEGRITY 직속 (SP-NN_xxx 전국 서비스 계열, "# 상위 상속" 헤더로 선언)
SP-02_k119 -> UNIVERSAL-INTEGRITY
SP-03_kpolice -> UNIVERSAL-INTEGRITY
SP-04_khealth -> UNIVERSAL-INTEGRITY
SP-06_ktraffic -> UNIVERSAL-INTEGRITY
SP-10_kpublic -> UNIVERSAL-INTEGRITY
SP-12_kdemocracy -> UNIVERSAL-INTEGRITY
SP-13_klogistics -> UNIVERSAL-INTEGRITY
SP-16_kinsurance -> UNIVERSAL-INTEGRITY

# 공통 레이어 체인 (B 섹션 산문 설명과 동일 관계)
PROFESSIONAL-common -> UNIVERSAL-common
K-Public_common -> PROFESSIONAL-common
UNIVERSAL-common -> UNIVERSAL-INTEGRITY
SP-PROVINCE-TEMPLATE -> kgov
SP-INDUSTRY-TRANSFORM-COMMON -> HUMAN-AUTHORITY-GATE-SCHEMA
SP-INDUSTRY-TRANSFORM-COMMON -> GOV-TIER-IO-SCHEMA
SP-10_kpublic -> HUMAN-AUTHORITY-GATE-SCHEMA
SP-10_kpublic -> PDV-TRANSFER-PROTOCOL
GOV-TIER-IO-SCHEMA -> DOCUMENT-TYPE-REGISTRY
GOV-TIER-IO-SCHEMA -> DATA_REQUIREMENT-SCHEMA
```

**적용 범위 — 2026-07-29 기준 알려진 한계**: 이 edges 블록과
`check_no_undeclared_inheritance.py`는 현재 `sp-catalog.json`에 등록된
최상위 SP(위 목록)에 대해서만 **strict**(위반 시 CI 실패)로 동작한다.
`prompts/gov-tree/` 아래 도청·시청·부서·읍면동 SP는 `# 상위 상속` 헤더
선언이 893건 존재하지만 `sp-catalog.json`에 개별 등록되지 않고, 표기
형식도 파일마다 제각각(중간에 폐기 경고·조건부 표시·플레이스홀더가
섞여 있음)이라 지금 상태로 strict 적용하면 오탐이 정상 작업을 막는다
— 그래서 gov-tree는 **informational**(위반을 출력하되 CI는 통과)로
남겨둔다. gov-tree 헤더 형식을 먼저 정규화하는 게 strict 전환의
선행 조건이다(AGENT-SUPPLIER 레거시와 동일한 처리 원칙,
`check_sp_inheritance.py` 참조).

## 변경 이력

- v1.1 (2026-09-02): k-job(구직자 개인용 구직 보조 AI, 단일 공통
  모듈) 신설 등록 — E 섹션에 K-Plan·K-Watch를 조립 순서 참고 사례로
  언급하는 개별 참조로 추가. 아직 sp-catalog.json 최상위 등록만
  됐을 뿐 worker.js relay·UI wiring은 별도 작업.
- v1.0 (2026-07-29, 같은 날 F 섹션 추가): 신설. 2026-07-29 감사에서 발견된 16개 파일·33건의
  하드코딩된 SP 상호 참조를 실제로 수정하면서 드러난 관계를 기반으로
  A~E 섹션을 채웠다. A, B 섹션은 기존 문서(check_sp_inheritance.py
  FAMILIES, SP_hierarchy_inheritance_v1_0.md)의 내용을 그대로 반영했고,
  C~E는 이번 감사에서 실제로 발견된 참조만 기록했다 — 카탈로그에 등록된
  198개 SP 전체의 관계를 빠짐없이 다룬 것은 아니며, 앞으로 새 참조가
  생기면 이 문서에 계속 추가한다.
