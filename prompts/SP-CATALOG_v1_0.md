# SP-CATALOG v1.0 — 전체 SP 목록·5단계 우선순위·상속 구조

**작성**: 2026-07-05 | **목적**: AGENT-COMMON(및 향후 이를 대체/보강할
그림자 AI)이 사용자 발화에 대응할 SP를 판단할 때 참조하는 단일 진실
소스. 죽은 코드(구 SP-00-ROUTER)가 하던 "키워드 매칭" 역할을 대신하지
않는다 — 그건 이미 AGENT-COMMON 자신의 의미 이해가 담당한다. 이 문서는
"무엇이 존재하고, 무엇을 먼저 봐야 하고, 어떻게 조립되는지"에 대한
지도(map)다.

## 원칙 — 왜 5단계 순서인가

사용자 발화 하나가 여러 계층에 동시에 걸릴 수 있다(예: "카페 차렸는데
사업자등록 어떻게 하나요"는 정부기관 사무이자 비즈니스 사용자 맥락).
아래 순서는 **우선 확인 순서**이지, 배타적 분류가 아니다 — 상위 계층에서
확신이 서면 그걸 쓰고, 아니면 다음 계층을 본다.

1. **K 시리즈** — 가장 흔한 생활 서비스 요청. 분야가 명확하면(법률·의료·
   세금 등) 여기서 바로 끝난다.
2. **정부 기관과 부서** — K 시리즈의 `kgov`(국가사무, 전국 단일)로도
   부족한, 실제 하위 조직 단위(지자체·읍면동)까지 내려가야 하는 사무.
3. **전문가 AI** — 공익이 아니라 개인 자문(사익)이 목적일 때.
4. **비즈니스 사용자** — 발화 주체가 개인이 아니라 사업체(그림자 AI)일 때.
5. **개인·사물 사용자** — 위 어디에도 안 걸리는 일상 대화, 또는 아직
   구현 안 된 "사물"(IoT/기기) 발화 주체.

---

## ① K 시리즈 (`GWP_REGISTRY`, 17개 기관 서비스 + 유틸 2개)

실체: `gopang-app.js`가 로드하는 `gwp-registry.js`의 `GWP_REGISTRY` 배열.
전부 **평면 구조** — 대부분 SP 파일 1개(`sp_key`)를 그대로 로드하며,
jeju처럼 다단계 하위 조직으로 갈라지지 않는다.

※ 예외: `kcommerce`(K-Market)는 `sp_key`/sp-catalog.json 경로를 타지
않는 유일한 항목이다(2026-07-05 확인). market 레포 자체의
`webapp.html`이 `https://raw.githubusercontent.com/Openhash-Gopang/
market/main/prompts/SP-KMARKET-v2_5.txt`를 직접 fetch하고,
UNIVERSAL-INTEGRITY도 클라이언트에서 별도로 fetch해 앞에 붙인다
(서버 강제 주입은 아니라 아래 표의 ❌ 표기는 유효하지만, 로딩 경로
자체는 이 절의 "대부분 sp_key" 설명의 예외임에 유의). gopang 레포의
`SP-05_kmarket`/`SP-05_kcommerce` manifest 키는 죽은 참조이며
`DEPRECATED_SP-05_kmarket-kcommerce.txt`를 가리킨다.

| id | 이름 | 분야 | UNIVERSAL 서버 강제 주입 |
|---|---|---|---|
| kemergency | K-Emergency | 긴급·재난(R0, 최우선 게이트) | ❌ 미적용 |
| klaw | K-Law | 법률 | ✅ `/klaw/relay` |
| kpolice | K-Police | 경찰 | ❌ 미적용 |
| ksecurity | K-Security | 사이버 보안 | ❌ 미적용 |
| khealth | K-Health | 의료 | ❌ 미적용 |
| kedu | K-School | 교육 | ❌ 미적용 |
| kgdc | GDC | 결제·송금 | ❌ 미적용 |
| kfinance | K-Stock | 투자 | ❌ 미적용 |
| kinsurance | K-Insurance | 보험 | ❌ 미적용 |
| ktax | K-Tax | 세금(국세) | ❌ 미적용 |
| kcommerce | K-Market | 주문·거래(자율 구매대행 에이전트) | ❌ 미적용(클라이언트 자체 fetch) |
| ktransport | K-Traffic | 교통 | ❌ 미적용 |
| klogistics | K-Logistics | 물류 | ❌ 미적용 |
| kgov | K-Public | 민원·행정(국가사무) | ✅ `/gov/relay` |
| kdemocracy | K-Democracy | 투표·거버넌스 | ❌ 미적용 |
| kbusiness | K-Business | 사업체 어드바이저 | ✅ `/business/relay` |
| fiil-kcleaner | K-Clean | 환경 신고 | ❌ 미적용 |

**⚠️ 실사로 확인된 불일치**: `worker.js`에 UNIVERSAL-INTEGRITY/
UNIVERSAL-common을 서버에서 강제 주입하는 전용 relay는 `klaw`,
`gov`(kgov+jeju 공용), `business`(kbusiness+business-kr 공용) 세 곳뿐이다.
나머지 14개는 이 강제 조립 경로가 없다 — 즉 U1~U9 공통 원칙(세션연속성,
PDV 중개 접근 등)이 서버 차원에서 보장되지 않고 클라이언트/SP 자체
서술에 의존한다. 이건 이번 작업 범위 밖의 별도 후속 과제로 남긴다.

**상속선(있는 것만)**: `klaw`/`kgov`/`kbusiness`만 `UNIVERSAL-INTEGRITY →
UNIVERSAL-common → (해당 SP)` 조립이 검증됨.

---

## ② 정부 기관과 부서 (하위 조직까지 내려가는 실제 계층 구조)

K 시리즈의 `kgov`는 "전국 228개 정부기관"이라고 자기소개하지만, 이는
**단일 SP 텍스트의 자기 서술**이지 228개의 개별 SP 레코드가 실재하는
게 아니다(실사 확인 — SP-10_kpublic 1개 파일). 반면 **jeju는 진짜
다단계 상속 트리**를 실제 데이터로 갖고 있다:

```
JEJU-GOV-COMMON (국가 kgov 지식 + 제주 오버레이 + TREE-PROTOCOL)
  └─ SP-DO-000 (제주도청, 항상 포함)
       └─ SP-CITY-JEJU | SP-CITY-SEOGWIPO (행정시, 2개)
            └─ SP-EMD-{읍면동명} (43개 읍면동, 위치 매칭 성공 시에만)
                 └─ SP-EXP-WATER 등 (L4 업무영역 전문 SP, 상하수도 등 키워드 매칭 시)
  └─ NATIONAL_TABLE (28개 — 국가기관, 국세청 등 국가사무 위임 대상)
  └─ L2_TABLE (13개 — 도 산하 부서, 위치 미확정 시 부서명으로 매칭)
```

실제 조립은 `jeju-router.js`의 `assembleJejuSystemPrompt()`가 매 요청마다
실시간으로 문자열을 이어붙인다(캐시되는 건 원료 문서뿐, 완성된 조합
SP는 저장되지 않음 — 이전 대화에서 한림읍 노인복지팀 사례로 상세 확인).

**kgov vs jeju 판단(AGENT-COMMON에 이미 명시됨, ROUTER-PRIORITY R2)**:
전국 단일 기관 소관 → kgov. 제주도·행정시·읍면동이 직접 처리하는
자치사무(지방세·상하수도·읍면동 민원 등) → jeju.

**⚠️ 스코프 갭(실사 확인)**: 이 수준의 하위 조직 트리는 현재 제주뿐이다.
다른 지역 거주자의 지자체 민원(예: 서울 거주자의 수도관 파열 신고)은
대응하는 트리가 없다 — kgov가 국가사무만 다루므로 이 경우 목적지 자체가
없다. 향후 타 지역 추가 시 jeju와 동일한 패턴(공통층→행정시/구→읍면동)을
재사용한다.

**위치 판단 우선순위(AGENT-COMMON 갱신 필요 — §3 참조)**: 발화에 지명이
없을 때, 되묻기 전에 `call-ai.js`가 이미 매 턴 주입하는 `[현재 위치]`
컨텍스트(GPS/PDV, `_buildEnhancedUserContent()`)를 먼저 확인해야 한다.

---

## ③ 전문가 AI (`EXPERT_REGISTRY`, 35개 페르소나 — 2026-07-15 실사 갱신)

실체: `src/gopang/ai/expert-registry.js`. 공익(기관)이 아니라 **사익
자문**이 목적일 때 여기로 온다 — 같은 "의료"라도 병원 행정 처리는
`khealth`(①), 개인 자문은 `EXPERT:nurse` 등(③)으로 갈린다.

```
UNIVERSAL-INTEGRITY
  └─ SP_common_guardrails.md (전체 35개 공통 — sp-catalog.json 최신 버전 기준,
       숫자를 여기 적지 않는 이유가 바로 그것)
       └─ SP_common_medical_safety_v1_3.md (needsMedicalSafety:true 18개 — 의료 14개 +
            상담 계열 4개[임상심리사·전문상담교사·정신건강전문요원·사회복지사],
            위기개입 M5 상속 목적)
            └─ SP_{persona}_v2_x.md (개별 페르소나 SP)
```

법률(2)·재무(2)·의료(14)·교육(1)·상담(4)·문화(2)·공학(5)·해사(4)·부동산(1)
9그룹 35개(실체는 `EXPERT_REGISTRY`의 `category` 6종: LAW/FIN/HEALTH/EDU/ENG/
REAL_ESTATE — 위 9그룹은 이 문서에서 편의상 더 세분한 서술일 뿐, 코드상
카테고리가 9개 있는 건 아님). `[EXPERT: {personaId}]` 태그로 GWP와 동일한
새 탭 방식 호출(2026-07-03 이후 통일).

※ 2026-07-15 정정: 이 절은 원래 "26개"로 작성됐으나 이후 법무사·공인회계사·
부동산(공인중개사) 등이 `expert-registry.js`에 신설되며 실제로는 35개로
늘어난 상태였음에도 이 문서가 갱신되지 않았다(실사로 확인). 앞으로 페르소나
추가 시 이 문서의 개수도 같이 갱신할 것 — `expert-registry.js`가 단일 진실
소스이고 이 문서는 그 요약이므로, 둘이 어긋나면 이 문서가 틀린 것이다.

---

## ④ 비즈니스 사용자 (사업체 그림자 AI)

실체: `k-business_v1_0.md`(글로벌 표준) + `business-kr_v1_0.md`(한국
모듈). `entity_type='business'` 프로필의 그림자 AI가 이 층을 쓴다 —
개인 그림자 AI(⑤)와 완전히 독립된 인스턴스.

```
UNIVERSAL-INTEGRITY → UNIVERSAL-common → k-business → business-kr
```

`/business/relay`(서버 강제 조립)를 통해서만 호출되며, 현재 진입점은
K-Market 관리자 대시보드의 AI 어드바이저 패널 하나뿐이다(`kbusiness`
GWP id로 ①에도 등록돼 있음 — 사업체 소유자가 개인 채팅에서 직접
"재무제표 작성해줘"라고 하면 ①경로로, 대시보드 안에서는 ④경로로 각각
들어갈 수 있어 향후 두 진입점의 SP 버전 동기화 여부를 확인할 필요가 있음).

---

## ⑤ 개인·사물 사용자

**개인(person)** — 실체 확인됨:
```
[가입 직후 1회] personal-assistant SP (프로필 온보딩, 설정 화면에서만 진입)
        ↓ PROFILE_SUBMIT/SKIP
[이후 평생 고정] AGENT-COMMON (그림자 AI 본체 — 나머지 ①~④ 전부를
                 [GWP:]/[EXPERT:] 태그로 스스로 호출하는 주체)
```
AGENT-COMMON 자체는 UNIVERSAL-common을 상속한다는 명시적 조립 선언이
현재 프롬프트 본문에 없다(실사 확인 — grep 0건). AGENT-COMMON이 이미
사실상 최상위이므로 이 자체가 문제는 아니지만, ①~④가 상속하는
U1~U9 원칙을 AGENT-COMMON도 명시적으로 따른다고 문서화하는 게 향후
일관성 점검에 도움이 될 것이다.

**사물(thing/device)** — ⚠️ **미구현, 비전 단계**. 백서(`gopang_whitepaper.md`)엔
"사람·기관·사물은 AI 쌍둥이를 갖는다"(버스의 AI 운전보조 등)는 설계
철학이 있으나, 실제 `entity_type` 필드에는 `person`/`business`/`agent`/
`org` 4종만 존재하고 `device`/`thing` 계열 값은 코드 어디에도 없다(실사
확인). 지금 라우팅 우선순위에 다섯째로 넣긴 하지만, 실제로 사물 발화
주체가 들어올 경로 자체가 아직 없다 — 필요 시 별도 설계 착수 필요.

---

## 변경 이력

- v1.0 (2026-07-05): 신설. 죽은 SP-00-ROUTER를 대체하는 참조 문서로
  작성. 5단계 우선순위·상속 구조 전부 실사(grep/실행) 근거로 검증.
