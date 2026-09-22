# 혼디(Hondi)/Gopang 전체 시스템 기능별 테스트 마스터플랜 v1.0

**작성** Team Jupiter | 2026-07-17
**목적** 혼디 생태계(gopang 메인 허브 + K서비스 18개 저장소 + jeju 저장소)의 기능 하나하나를
빠짐없이 나열하고, 각 기능마다 테스트 목적·절차·기대결과·우선순위·환경(정적/유닛/통합/라이브)·
기존 커버리지 여부를 명시한다. "무엇을 검증했다"가 아니라 "무엇을 검증해야 하는가"의 전체
지도를 그리는 문서다.

---

# 0. 이 문서의 위치 — 기존 계획서와의 관계

혼디에는 이미 두 계열의 테스트 자산이 존재한다. 이 문서는 그것들을 대체하지 않고,
**빠진 부분을 채우고 전체를 하나의 지도로 통합**한다.

1. **`docs/gopang_implementation_plan_v3.1.md`(완성본)** — Phase 1~8로 구성된 최초 구현
   계획서. Phase 1(코어)~Phase 8(통합)까지 다루며, `src/tests/{core,pdv,openhash,
   ai-secretary,domains,network}/`의 phase1~10 테스트가 여기 대응한다. 이 문서가
   작성된 시점(추정 초기)엔 K서비스가 klaw·khealth 2개뿐이었고, GWP_REGISTRY·
   전문가 페르소나 시스템·profile2.0·숫자코드·jeju 연동·qna/users 저장소는 아직 없었다.
2. **`src/tests/integration/phase11~24`** — v3.1 완성 이후 기능이 늘어날 때마다 그때그때
   추가된 통합 테스트. 체계적 계획 없이 "그 주에 고친 것"을 검증하는 방식이라, 번호가
   이가 빠진 듯 하고(phase21 없음) 커버리지에 사각지대가 있다.
3. **`src/tests/profile2.0/m01~m13`** — 별도 계열. 회원가입·결제·프로필·AI비서·리뷰·
   위치·히트맵·커뮤니티·원장·감사·검색·보안까지 신원 생명주기를 다루는데, v3.1이나
   phase11~24 어느 쪽 목록에도 언급되지 않는 독립 트랙이다.

이 세 트랙 다 훌륭하지만 서로를 참조하지 않아, "혼디 전체에서 무엇이 검증되어 있고
무엇이 비어 있는가"를 한눈에 보여주는 문서가 없었다. 아래 PART A~I가 그 역할을 한다.
각 항목에 **[기존]**(이미 테스트 존재, 파일명 명시) 또는 **[신규]**(테스트가 없어 이번에
새로 설계) 태그를 붙인다.

---

# 1. 테스트 대상 시스템 지도 (전체 인벤토리)

## 1.1 저장소 목록 (19개, Openhash-Gopang 조직)

| 저장소 | 역할 | 규모(파일 수) | GWP_REGISTRY id |
|---|---|---|---|
| gopang | 메인 허브 — 코어·인증·PDV·Openhash·AI비서·라우터·매니페스트·프로필2.0 | 2,251 | (허브 자체) |
| klaw | K-Law 법률 AI | 17(+gopang 내 klaw/ 사본) | klaw |
| 911 | K-Emergency 긴급 구조 | 8 | kemergency |
| police | K-Police 치안 | 23 | kpolice |
| security | K-Security 보안(방금 PDV 클라이언트 신규 배치) | 14 | ksecurity |
| health | K-Health 보건의료 | 11 | khealth |
| school | K-Edu 교육 | 25 | kedu |
| gdc | K-GDC(방금 PDV 클라이언트 신규 배치) | 44 | kgdc |
| stock | K-Finance 금융/증권 | 17 | kfinance |
| insurance | K-Insurance 보험 | 31 | kinsurance |
| market | K-Commerce/K-Market 상거래(3개 registry entry 공유: kcommerce/kcommerce_seller/kbusiness) | 27 | kcommerce 등 |
| tax | K-Tax 세무 | 14 | ktax |
| traffic | K-Transport 교통 | 18 | ktransport |
| logistics | K-Logistics 물류 | 17 | klogistics |
| jeju | 제주도청 AI(자체 SP 트리, 매니페스트 비의존) | 8 | jeju |
| public | K-Gov 정부24 연계 | 10 | kgov |
| democracy | K-Democracy 국민청원/여론 | 15 | kdemocracy |
| qna | Gopang QnA(2026-07-17 신규 등록, 테스트 0건) | 51 | kqna |
| users | Gopang Users 엔티티 검색(2026-07-17 신규 등록, 테스트 0건) | 16 | kusers |
| gopang-test | 빈 저장소(LICENSE만) | 1 | — (검증 대상 제외) |

gopang 내부 서브서비스(별도 저장소 아님): `services/fiil-kcleaner`(K-Clean, id: fiil-kcleaner),
`kbank`/`ktelecom`/`kestate`(type:'switch' — 같은 스레드 SP 교체 방식, 별도 저장소 불필요),
`profile-assistant`(가입 튜토리얼), `tool-calculator`/`tool-web-search`(function-calling 도구),
`ksearch`(검색).

## 1.2 gopang 내부 계층 구조

```
gopang/
├── auth/            인증(SSO, QR로그인, silent-sign/auth/pref)
├── src/gopang/
│   ├── ai/          AI 파이프라인(call-ai, expert-registry/session, hondi-code, manifest-loader, vision, weather)
│   ├── core/         가입·인증 코어(auth.js), state.js
│   ├── gwp/          GWP(GovWebPostMessage) 인프라
│   ├── p2p/          P2P 채팅(WebRTC)
│   ├── pdv/          PDV(개인데이터금고) — keyManager 등
│   ├── profile2.0/    프로필 2.0 (M01~M13 모듈 대응 실 구현체)
│   ├── services/      서비스 연동 헬퍼
│   └── ui/            UI 컴포넌트
├── src/openhash/      분산원장 — bivm/hashChain/ilmv/importanceVerifier/lpbft/plsm/transactionPipeline
├── src/worker/        Cloudflare Worker 핸들러(ai-chat-handler, order-queue-handler, delivery-handler 등)
├── src/tests/         39개 테스트 파일(phase 체계 + profile2.0 m01~13)
├── pb_hooks/, pb_migrations/   PocketBase 훅·스키마 마이그레이션
├── prompts/           243개 SP(System Prompt) 파일 + sp-catalog.json 매니페스트
├── gwp-registry.js    GWP_REGISTRY(28 서비스 라우팅 테이블)
├── worker.js          메인 Cloudflare Worker(7,900줄+)
├── tools/             build_manifest.py, check_stale_refs.py, extract_gwp_registry.mjs 등
└── docs/              설계 문서 다수(계획서, 프로토콜, HANDOFF 등)
```

## 1.3 기능 대분류 (11개 PART)

| PART | 영역 | 비고 |
|---|---|---|
| A | 코어 인프라(플랫폼 코어·PDV 기반·Openhash·PDV+Openhash 통합) | Phase 1~2C 대응 |
| B | AI/오케스트레이션(AI비서·GWP라우터·전문가 페르소나·매니페스트) | Phase 3, 11, 22, 23 + 신규 |
| C | 신원/가입/프로필 생명주기(M01~M13) | profile2.0 계열 |
| D | 혼디 시각 코드(숫자코드 활성, 색상코드 폐기) | 이번 세션 12/13 검증 완료분 확장 |
| E | K서비스 개별 기능(18개) | 표준 5체크 + 도메인별 심화 |
| F | 네트워크/푸시/보안/GDC/프라이버시 | Phase 5, 9, 10 |
| G | 정부 연계 특수 기능(공유타겟·서류인계·복지자격·SP저자동화·웹서치) | Phase 17~20, 22, 24 |
| H | 부트스트랩/Shell UI | Phase 7 |
| I | 횡단 관심사(SSOT 드리프트·참조무결성·보안회귀·환경매트릭스) | 신규 — 이번 세션에서 필요성 확인 |

---

# 2. 테스트 분류체계 및 우선순위 기준

## 2.1 환경 구분

| 구분 | 정의 | 이 환경에서 가능? |
|---|---|---|
| **정적(Static)** | 코드/문서 정합성, 참조 무결성, 스키마 대조 | 가능 |
| **유닛(Unit)** | DOM/네트워크 의존 없는 순수 함수를 Node로 직접 실행 | 가능 |
| **격리통합(Isolated Integration)** | `vm` 모듈 등으로 window/fetch/storage를 스텁 처리해 브라우저 전역 스크립트를 실행 | 가능(이번 세션 pdv-history-client.js에 적용) |
| **워커통합(Worker Integration)** | `worker.js`를 그대로 import해서 `handleXxx` 함수를 호출(실제 PocketBase/외부 API는 호출별로 mock) | 대부분 가능(기존 phase11~24가 이 방식) |
| **라이브 E2E(Live)** | 실제 배포된 Oracle Cloud VM·Cloudflare Worker·PocketBase·Supabase·브라우저 세션 | **이 샌드박스에서 불가 — 사용자 환경에서 수동 실행 필요** |

## 2.2 우선순위

- **P0** — 가입·인증·PDV·Openhash·라우팅 등 실패 시 시스템 전체가 멎는 항목
- **P1** — 개별 K서비스 기능, 실패해도 해당 서비스만 영향
- **P2** — 성능·부가기능·UI 디테일

## 2.3 커버리지 태그

- **[기존]** — 이미 테스트 파일 존재. 파일명과 최근 실행 여부 명시
- **[신규]** — 테스트가 없어 이 문서에서 처음 설계
- **[불가]** — 라이브 인프라 필요, 이 샌드박스에서는 설계만 하고 실행은 사용자 환경 몫

---

# PART A — 코어 인프라

## A-1. 플랫폼 코어 [기존: `src/tests/core/phase1_core.test.js`, C-01~C-08]

| ID | 대상 | 목적 | 우선순위 | 커버리지 |
|---|---|---|---|---|
| A1-1 | `src/gopang/core/state.js` | 전역 상태(PROXY 등)가 여러 모듈에서 동일 인스턴스로 공유되는지 | P0 | ✅ **확인 완료** — 저장소 전체에 `state.js` 사본이 단 하나뿐이고(`src/gopang/core/state.js`), 24개 import 지점 전부 상대경로로 그 파일 하나에 귀결됨. ESM의 `export let` 라이브 바인딩 특성상 동일 모듈을 가리키는 이상 별도 런타임 테스트 없이도 공유가 보장됨(중복 파일이 없다는 것 자체가 검증 포인트) |
| A1-2 | 플랫폼 초기화 순서 | app.js 부트스트랩 시 core→pdv→openhash 순서 준수 | P1 | 별도 확인 안 함 — Phase 7(부트스트랩) 재실행 시 함께 확인 예정, R2 범위 밖으로 이월 |
| A1-3 | 의존성 방향 규칙 | `docs/gopang_implementation_plan_v3.1.md` §1의 "의존성 방향 규칙" 위반 여부(예: core가 K서비스를 import하는 역방향 의존) | P1 | ✅ **종결(2026-07-18, 사용자 확인) — 실질적 위험 없음, 조치 불필요.** 심층 조사 결과: (1) 이 규칙의 출처(`docs/architecture.md`, "gopang_v2 아키텍처 문서", 2026-05-22)가 PART H에서 이미 폐기 확인된 `src/app.js`/`shell-ui.js`와 **같은 문서** — 규칙 자체의 현재 유효성이 의심스러움. (2) `core/auth.js`가 import하는 4개 파일(`ui/bubble.js`/`services/push.js`/`ai/hondi-code.js`/`ai/hondi-digit-code.js`) 전부 **자기 자신은 아무것도 import하지 않는 leaf 모듈** — 순환 참조 위험 없음(실측 확인). (3) `core/auth.js`는 `gopang-app.js`(브라우저)에서만 쓰이고 `worker.js`/서비스워커/PWA 등 DOM 없는 컨텍스트에서는 전혀 안 쓰임(전체 저장소 grep으로 확인) — 이 규칙이 막으려던 "DOM 코드가 DOM 없는 곳에서 로드돼 깨지는" 실제 사고 시나리오 자체가 성립하지 않음. (4) `hondi-code.js`/`hondi-digit-code.js`는 AI/LLM과 무관한 순수 인코더 함수가 `ai/` 폴더에 잘못 배치된 것뿐(이름표 문제, 저위험 파일 이동으로 고칠 수 있으나 사용자가 보류 결정). `ui/bubble.js`(지문/얼굴/보안키 MFA 피드백)만 실질적 계층 위반이지만 기능상 문제 없음 — 이미 낡은 것으로 확인된 문서의 규칙 하나 때문에 보안 민감 인증 흐름을 건드릴 이유 없다는 판단으로 **리팩토링하지 않고 그대로 종결** |

## A-2. PDV 기반 레이어 [기존: `src/tests/pdv/phase2a_pdv.test.js`, P-01~P-08]

| ID | 대상 | 목적 | 우선순위 | 커버리지 |
|---|---|---|---|---|
| A2-1 | `src/pdv/keyManager.js`의 `sha256`/`generateKeyPair`/`signMessage` | 암호 primitive 정확성(Web Crypto API 기반) | P0 | ✅ 재실행 완료(2026-07-17) — 9/9 통과, 회귀 없음 |
| A2-2 | `pdv-history-client.js` 태그 파싱·동의흐름 | ④ 항목, 이번 세션 완료 | P0 | [기존, 신규 테스트 추가] `pdv-history-client.test.mjs` 14/14 통과 (2026-07-17) |
| A2-3 | PDV 4대 유형(문서 §PDV-4대유형) vs `_parseTagParams`가 실제 인식하는 scope 종류 | 설계-구현 갭 확인 | P1 → 하향(§우측 참조) | ✅ **분석 완료 — "갭"이 아니라 애초에 서로 다른 두 축의 분류 체계였음이 확인됨.** `PDV-4대유형-해법_2026-07-14.md`의 "4대 유형"(①다수인 대상 집계 ②강제조사/수사 ③기관 내부 행정 ④정책용 익명통계)은 정부기관이 PDV를 소비하는 **쿼리 패턴(용도)** 분류다. 반면 `_parseTagParams`/`scope`(worker.js에 51개 이상 실존)는 **어느 서비스/기관 소관인지**(khealth/kpolice/ktax/jeju_xxx 등)를 나타내는 완전히 다른 축 — 코드 어디에도 요청이 4대 유형 중 무엇인지 구분하는 필드가 없다. 4대 유형 분류는 지금 설계 문서로만 존재. 실제 쿼리 파라미터로 넣을지는 별도 설계 판단 필요(P1 유지, 다만 "버그"는 아님) |
| A2-4 | `phase16_pdv_extract.test.mjs` | PDV 추출 로직("과거 상호작용 요약 → 고정 필드") | P0 | ✅ 재실행 완료(2026-07-17) — 12/12 통과, 회귀 없음 |

## A-3. OpenHash 레이어 [기존: `src/tests/openhash/phase2b_openhash.test.js`, O-01~O-14]

| ID | 대상 | 목적 | 우선순위 | 커버리지 |
|---|---|---|---|---|
| A3-1 | `plsm.js` selectLayer/simulateDistribution | 5계층 분포 χ² 검정 | P0 | **[기존, 완료]** 2026-07-17 실행, 통과 |
| A3-2 | `hashChain.js` anchor/verifyChainIntegrity | 체인 연결·무결성 | P0 | **[기존, 완료]** 2026-07-17 버그 수정 후 통과(원인: 테스트 코드 계약 위반) |
| A3-3 | `bivm.js` Σδ≠0 탐지, BMI 위변조 탐지 | 이중불변량검증(BIVM) | P0 | **[기존, 완료]** |
| A3-4 | `lpbft.js` 비상합의/복귀 | 계층별 비상 컨센서스 | P0 | **[기존, 완료]** |
| A3-5 | `importanceVerifier.js` 점수식 | 논문 §4.1 공식 수치 정합성 | P1 | **[기존, 완료]** |
| A3-6 | `transactionPipeline.js` Stage1~5 | 파이프라인 정상/차단 경로 | P0 | **[기존, 완료]** |
| A3-7 | `phase_anchor_integration.test.js`(A-01~A-12) | 앵커링 통합 시나리오 v2.0 — phase2b와 별개 파일 | P0 | [기존] **이번 세션 미실행** — phase2b만 돌리고 이 파일은 놓침 |
| A3-8 | IndexedDB 영속성(`_idbOpen` 등) | 브라우저 환경에서만 실제 저장 확인 가능 | P1 | [불가] — Node vm으로 IndexedDB mock 구현 후 재시도 가능성 있음(신규 검토) |

## A-4. PDV+OpenHash 통합 [기존: `src/tests/pdv/phase2c_evidence.test.js`, E-01~E-06]

| ID | 대상 | 목적 | 우선순위 | 커버리지 |
|---|---|---|---|---|
| A4-1 | 증거 패키지 생성(PDV 조회 결과 + Openhash 앵커 결합) | 두 레이어가 실제로 맞물리는지 | P0 | ✅ **완료 — 실제 프로덕션 버그 발견·수정.** 최초 실행 시 7개 중 4개 실패, 원인 조사 결과 테스트가 아니라 `src/pdv/evidencePackage.js`(법원 제출용 증거 패키지 생성 모듈) 자체가 `hashChain.js`의 옛 `anchor()` API(content, sig, msgId)를 그대로 호출하고 있어 신 API(contentHash, signatures[], msgId)와 어긋나 매번 예외로 실패했음(스토킹/가정폭력 등 실사용 시나리오에서 증거 패키지 생성이 항상 죽는 상태였음). 프로덕션 코드 수정 + `generateEvidencePackage()`를 실제로 끝까지 호출하는 신규 종단 테스트(`phase2c_evidence_e2e.test.mjs`, vault.js를 mock.module로 대체) 추가. 결과: `phase2c_evidence.test.js` 7/7, `phase2c_evidence_e2e.test.mjs` 2/2 |

---

# PART B — AI/오케스트레이션 계층

## B-1. AI 비서 파이프라인 [기존: `src/tests/ai-secretary/phase3_ai_secretary.test.js`, A-01~A-11]

| ID | 대상 | 목적 | 우선순위 | 커버리지 |
|---|---|---|---|---|
| B1-1 | `call-ai.js`(3,905줄) 전체 | AI 호출 파이프라인 — 이번 세션에서 파일 크기만 확인, 내용 미검증 | P0 | ✅ **phase3_ai_secretary.test.js 재실행 — 실제 프로덕션 버그 발견·수정.** 최초 13개 중 3개 실패(A-11~A-13), 원인은 `src/ai-secretary/phase6.js`가 `evidencePackage.js`와 동일한 `anchor()` API 드리프트(구 API로 호출)를 갖고 있어 AI 비서의 모든 Phase 6(대화 기록+OpenHash 앵커링)가 항상 예외로 실패하던 것 — 수정 후 13/13 통과 |
| B1-2 | `phase13_ai_chat_handler.test.mjs` | "짜장면 주문 사고실험" — `src/worker/ai-chat-handler.js` | P0 | ✅ **실행 결과 9/31 실패 → 전면 원인 규명·수정, 31/31 통과.** 2026-07-15 `ai-chat-handler.js`가 세션/LLM키 조회를 Supabase(sbFetch)→L1 PocketBase(`_l1AdminToken`+원문 fetch)로 이관했는데 테스트 목이 갱신 안 됨(`_l1AdminToken is not a function`) + AES 테스트 키가 hex 아니어서 유효하지 않은 키 길이 + 번역 테스트 env에 DEEPSEEK_API_KEY 누락, 3가지 복합 원인 |
| B1-3 | `phase14_order_queue_handler.test.mjs` | 주문 큐 처리 | P1 | ✅ 재실행 완료(2026-07-17) — 11/11 통과, 회귀 없음 |
| B1-4 | `phase15_delivery_handler.test.mjs` | 배송 처리 | P1 | ✅ 재실행 완료(2026-07-17) — 12/12 통과, 회귀 없음 |

## B-2. GWP 라우터 & 오케스트레이션

| ID | 대상 | 목적 | 우선순위 | 커버리지 |
|---|---|---|---|---|
| B2-1 | `router-category.test.mjs` | SP-00-ROUTER 실제 코드 라우팅 검증(재구현 아닌 실행 기반) | P0 | [기존] **이번 세션 미실행** |
| B2-2 | `sp-intercall.test.mjs` | `worker.js`의 `handleGovRelay` 실제 경로 | P0 | [기존] **이번 세션 미실행** |
| B2-3 | `phase11_orchestration_registry_and_ksearch.test.mjs` | 오케스트레이션 레지스트리 + K-Search | P0 | ✅ 재실행 완료(2026-07-17) — 23/23 통과, 회귀 없음 |
| B2-4 | `phase22_sp_author_automation.test.mjs` | SP-Author 자동화(신호 큐잉, ESCALATE) | P1 | ✅ 재실행 완료(2026-07-17) — 14/14 통과, 회귀 없음 |
| B2-5 | `phase23_gwp_registry_scaling.test.mjs` | **이번 세션에 gwp-registry.js를 직접 수정(qna/users 추가)했는데 이 스케일링 테스트를 안 돌림** | P0 | [기존] **회귀 확인 시급** — 다음 세션 최우선 |
| B2-6 | SP-00-ROUTER 매니페스트 동기화 | `check_stale_refs.py`가 "manifest에 SP-00-ROUTER 키 없음"으로 매번 이 검사를 건너뛰고 있음 — 근본 원인 파악 필요 | P0 | ✅ **근본 원인 확인 후 검사 제거로 해결.** SP-00-ROUTER는 2026-07-05(같은 날 나중 커밋 6766c60)에 죽은 코드로 완전 삭제됐고, 라우팅은 이제 AGENT-COMMON이 GWP_REGISTRY를 직접 참조해 판단하는 방식이라 "라우터 서비스 표"라는 두 번째 진실 공급원 자체가 더 이상 존재하지 않음 — 검사 대상이 원천적으로 사라진 것. `check_router_registry_sync()` 함수와 호출부를 제거(되살릴 게 아니라 없애는 게 맞음). 제거 후 64/64 참조 정상 확인 |
| B2-7 | GWP_REGISTRY 신규 2건(kqna/kusers) 트리거 정확도 | threshold 0.65, trigger 문구가 실제 발화에서 오탐/누락 없이 매칭되는지 | P0 | ✅ **재현 시도 — matchService() 자체가 존재하지 않음을 확인(2026-07-05 완전 삭제, 함수 자체가 없음).** 트리거 배열 직접 점검만 가능: kqna(질문있어/문의/궁금해/뭐예요/어떻게 해요/절차가/신청 방법/자격 요건/필요한 서류), kusers(이 사람 찾아줘/프로필 찾아줘/연락처 찾아줘/누구세요/가입자 조회/엔티티 검색) — 문구 자체는 합리적이나 실사용 오탐/누락 여부는 실제 LLM 판단 품질 문제라 이 샌드박스에서 검증 불가(라이브 환경 필요, R3로 이월) |

## B-3. 전문가 AI 페르소나 호출 시스템

| ID | 대상 | 목적 | 우선순위 | 커버리지 |
|---|---|---|---|---|
| B3-1 | `expert-registry.js` 27개 페르소나 개별 | 각 페르소나의 `key`가 실제 `sp-catalog.json`에 존재하는지 | P0 | [기존] check_stale_refs.py가 부분 커버(38→0건 확인) |
| B3-2 | `expert-session.js` 세션 교체(same-thread SP switch) | 실제로 시스템 프롬프트가 교체되는지, 이전 페르소나 잔존 여부 | P0 | ✅ **신규 테스트 작성·통과(6/6, `expert-session-switch.test.mjs`)** — CFG.system 교체·history[0] 동기화·history 유지(맥락 보존)·종료 발화 감지·system_base 복원·이전 페르소나 잔존 없음·PDV 기록까지 실행 검증 |
| B3-3 | 위기개입 상속(`needsMedicalSafety`) | 임상심리사·정신건강전문요원·전문상담교사 3개만 true인지 | P0 | [기존, 완료] 2026-07-17 grep 확인 |
| B3-4 | `UNIVERSAL-INTEGRITY` 자동 상속 | manifest-loader.js 주석에 "K-Intent/K-Compose 등 전부에 적용 안 되고 있었다"는 2026-07-12 발견 기록 — 그 이후 실제로 고쳐졌는지 재확인 | P0 | ✅ **회귀 없음, 실행 검증 완료.** `_loadSpByKey()`가 UNIVERSAL-INTEGRITY(+2026-07-17 TASK-DELEGATION-GUIDE)를 모든 SP 로드에 무조건 결합(자기 자신 로드 시만 예외). call-ai.js의 12개 로더 전부가 이 함수 하나만 거치는 단일 관문 구조라 개별 로더가 우회할 수 없음(구조 자체가 회귀를 막음). 실행 테스트로 확인 |
| B3-5 | `TASK-DELEGATION-GUIDE` 자동 상속(2026-07-17 신설, 주피터님 지시) | 방금 추가된 기능이라 테스트 자체가 없음 | P1 | [신규] |

## B-4. 매니페스트/SP 카탈로그 시스템

| ID | 대상 | 목적 | 우선순위 | 커버리지 |
|---|---|---|---|---|
| B4-1 | `tools/build_manifest.py` | prompts/ 스캔 → sp-catalog.json 재생성이 커밋된 버전과 일치하는지(수동 편집 흔적 검출) | P0 | ✅ **실행 완료 — 재생성 결과와 커밋된 파일이 완전히 동일(diff 0줄, 163항목).** 수동 편집 흔적 없음 |
| B4-2 | `tools/check_stale_refs.py` 자체의 정확성 | 스크립트가 놓치는 참조 패턴은 없는지(예: 동적으로 조합되는 파일명) | P1 | ✅ **실제 사각지대 발견·수정.** `src/gopang/ai/hondi-faq-router.js`의 `HONDI_FAQ_REGISTRY`(19개 파일 참조)가 `file: 'xxx.txt'` 형식(접두사 없는 파일명, 런타임에 별도 상수와 결합)이라 기존 4개 정규식 어디에도 안 걸렸고 스캔 대상 목록에도 없었음 — 지금 당장 깨진 참조는 없었지만(19개 전부 실존 확인) 향후 오타/삭제를 못 잡는 상태였음. 신규 검사 함수 추가 후 83건 검사로 확대, 의도적으로 파일명을 깨뜨려 실제로 MISSING을 잡아내는지(exit 1) 재검증 완료 |
| B4-3 | `tools/extract_gwp_registry.mjs` | vm 기반 추출이 실제 브라우저 실행 결과와 100% 동일한지(fetch 스텁이 실제 동작과 다를 가능성) | P1 | ✅ **교차검증 완료(브라우저는 아니지만 독립된 두 번째 실행 경로와 비교).** vm 샌드박스 추출 결과와 ESM import+전역 스텁 방식(이 세션에서 계속 써온 방법)의 결과가 바이트 단위로 완전히 동일함을 diff로 확인. 100% 브라우저 재현은 이 샌드박스에서 불가하나, 서로 다른 두 실행 메커니즘이 일치한다는 것으로 신뢰도 보강 |

---

# PART C — 신원/가입/프로필 생명주기 (Profile 2.0, M01~M13)

**전체가 [기존] 테스트 파일은 있으나, 이번 세션에서 단 하나도 실행하지 않았다.** 아래는
각 모듈이 다루는 범위 추정(파일명 기반)과, ①(가입) 검증에서 이번 세션이 다루지 못한
부분을 표시한다.

| ID | 모듈 | 실측 결과(2026-07-17) | 우선순위 |
|---|---|---|---|
| C-01 | `m01_auth.test.mjs` | ✅ 9/9 통과. **단, 실제 `src/profile2.0/*.js`를 import하지 않고 "테스트 대상 함수 인라인" 방식(주석에 명시)** — node:crypto만 외부 의존, 나머지 로직은 테스트 파일 안에 재구현됨. 내적 정합성은 검증되지만 실제 프로덕션 코드와의 드리프트는 이 테스트로 보장 안 됨 | P0 |
| C-02 | `m02_register.test.mjs` | ✅ 11/11 통과(C-01과 동일한 인라인 재구현 방식) | P0 |
| C-03 | `m03_payment.test.mjs` | ✅ 13/13 통과(동일 방식) | P0 |
| C-04 | `m04_profile.test.mjs` | ✅ 11/11 통과(동일 방식) | P0 |
| C-05 | `m05_ai_assistant.test.mjs` | ✅ 12/12 통과(동일 방식) | P1 |
| C-06 | `m06_review.test.mjs` | ✅ 12/12 통과(동일 방식) | P1 |
| C-07 | `m07_location.test.mjs` | ✅ 12/12 통과(동일 방식) | P1 |
| C-08 | `m08_heatmap.test.mjs` | ✅ **버그 수정 후 19/19 통과** — `/home/claude/heatmap.js`(이전 세션의 하드코딩된 샌드박스 절대경로)를 `../../profile2.0/heatmap.js`로 수정, 실제 `src/profile2.0/heatmap.js`(getColor/handleHeatmap) 대상으로 실행 확인 | P2 |
| C-09 | `m09_community.test.mjs` | ✅ **버그 수정 후 12/12 통과** — 동일한 절대경로 버그, `community.js` 실제 모듈 대상 확인 | P1 |
| C-10 | `m10_ledger.test.mjs` | ✅ **완료 — `src/profile2.0/ledger.js` 신규 구현 후 19/19 통과.** 테스트 사양(7개 함수)대로 K-Market 구매 1건을 구매자 차변/판매자 대변(97%)/플랫폼 대변(3%) 3행 복식부기로 분해, Σ차변=Σ대변 불변식(verifyBIVM) 검증, 원장→사용자 잔액 역산(reconstructBalances/computeSettledFs), 프로필 캐시(extra.fs) 대조(detectBalanceAnomalies), Supabase RPC 기록(marketPurchaseRPC, SQLSTATE 23514→CHECK_VIOLATION 변환)까지 구현. `verifyBIVM`은 A-3(OpenHash BIVM)과 개념만 공유하고 구현은 완전히 별개(파일도 다름) | 완료 |
| C-11 | `m11_audit.test.mjs` | ✅ **버그 수정 후 22/22 통과** — 동일한 절대경로 버그, `audit.js`(sha256hex/computeMerkleRoot/buildPdvLogInsert/anchorL1MerkleRoot/handleMerkleVerify) 실제 모듈 대상 확인. A-3(OpenHash phase_anchor_integration)와는 별개 계층(이쪽은 PDV 로그 Merkle 감사, A-3은 가입/대화/거래 3단 앵커링)으로 겹치지 않음 확인 | P0 |
| C-12 | `m12_m13.test.mjs` | ✅ **버그 수정 후 19/19 통과** — 동일한 절대경로 버그, `search.js`(handleSearch)+`security.js`(localAnomalyScore/classifySeverity/scoreContent) 실제 모듈 대상 확인. ksearch(GWP_REGISTRY id)와는 별개(이쪽은 profile2.0 내부 프로필 검색) | P0 |
| (보너스) | `test_m14_bulk_register.py` | ✅ **버그 수정 후 10/10 통과** — `sys.path.insert(0, '/home/claude')` 하드코딩을 저장소 상대경로로 수정, `tools/bulk_register.py` 실제 모듈 대상 확인 | — |

**PART C 종합 소견(갱신)**: M08/M09/M11/M12/M14 5개 파일이 전부 동일한 패턴의 버그(이전 세션이 남긴
샌드박스 전용 절대경로 `/home/claude/*`)로 실행 자체가 불가능했다 — 경로만 고치면 실제 프로덕션
모듈을 정확히 검증하는 잘 작성된 테스트였음(19/19, 12/12, 22/22, 19/19, 10/10 전부 통과). M10은
프로덕션 모듈(`ledger.js`) 자체가 없어서 테스트 사양대로 신규 구현 후 19/19 통과 확인. 반면 M01~M07은
실행은 늘 가능했지만 애초에 프로덕션 코드를 import하지 않는 방식이라 "통과"의 의미가 다르다 —
프로덕션 모듈과의 드리프트 여부는 별도 확인이 필요하다. **PART C(M01~M14) 전 항목 완료.**

---

# PART D — 혼디 시각 코드 시스템

## D-1. 숫자 코드(활성) [기존+신규, 이번 세션 상당 부분 완료]

| ID | 대상 | 목적 | 우선순위 | 커버리지 |
|---|---|---|---|---|
| D1-1 | `idToDigits`/`digitsToId` 왕복 | 1000건 랜덤 + 경계값 | P0 | **[신규, 완료]** `hondi-digit-code.roundtrip.test.mjs` 13/13 |
| D1-2 | `phoneToDigits`/`digitsToPhone` 왕복 | 휴대폰+전 지역번호(17개) | P0 | **[신규, 완료]** |
| D1-3 | `digitsToPhone` 입력 엄격성 | 배열/문자열 비대칭 해소 확인(2026-07-17 수정) | P0 | **[신규, 완료]** |
| D1-4 | `generateDigitCodeCanvas`/`generateDigitCodeDataURL` | 실제 이미지 렌더링(Canvas API 의존) | P1 | [불가] — Node에 canvas 네이티브 빌드 필요, 이번 세션 시도 안 함. jsdom+node-canvas 조합으로 재시도 검토 |
| D1-5 | `hondi-digit-scanner.js` — `digit_code_id`로 profiles 조회 | 스캐너가 실제로 올바른 프로필을 찾는지(라이브 PocketBase 필요) | P0 | [불가] — 로직 자체(쿼리 문자열 조합)는 정적 확인 가능, 실제 조회 결과는 라이브 필요 |
| D1-6 | 등록 파이프라인 연동(`_completeRegistration` → `digit_code_id` 저장 → 스캐너 조회) | **엔드투엔드 경로 전체**가 실제로 이어지는지 | P0 | [신규] — 이번 세션은 코드 존재만 확인, 실행 연결은 미검증 |
| D1-7 | `test-hondi-digit-code.html` | 저장소에 이미 있는 수동 테스트 페이지 — 이번 세션에서 존재만 확인하고 열어보지 않음 | P1 | [기존, 미실행] |
| D1-8 | 7세그먼트 패턴 정확성(`SEGMENT_PATTERNS`) | 육안 확인 — 이번 세션 소스 대조로 0~9 전부 표준 세그먼트와 일치 확인함(코드 리뷰 수준) | P2 | [신규, 완료 — 코드리뷰만] |
| D1-9 | `digit_code_id` 유니크 제약(`1784100001_updated_profiles_digit_code_unique.js`) | 동일 코드 중복 가입 시 실제로 거부되는지 | P0 | [불가] — 라이브 DB 필요 |

## D-2. 색상 코드(폐기 예정) — 회귀 방지 관점만

| ID | 대상 | 목적 | 우선순위 | 커버리지 |
|---|---|---|---|---|
| D2-1 | `hondi-code.js` 참조 제거 확인 | 폐기 결정 후에도 `_completeRegistration`이 여전히 `guidToShortId`/`generateHondiCodeDataURL`을 호출 중(이번 세션에서 확인) — 제거 작업 자체는 아직 안 함 | P1 | [신규] — 제거 여부는 사용자 결정 대기 |
| D2-2 | "9색/9진법(주석) vs 6색/6진법(실구현)" 불일치 | 폐기와 함께 자연 소멸 예정이나, 제거 전까지는 여전히 살아있는 버그 | P2 | [기존 발견, 미조치] |

---

*(다음 섹션에서 계속: PART E — K서비스 개별 기능 테스트 18개)*

# PART E — K서비스 개별 기능 테스트 (18개)

## 표준 템플릿 (모든 서비스 공통 적용)

각 서비스마다 아래 5개 표준 체크(이번 세션 ③에서 이미 실행한 매트릭스)를 **최신 상태로
재확인**하고, 서비스 고유 도메인 로직에 대한 심화 테스트를 추가한다.

- **S1** 엔트리포인트 존재(`index.html`/`webapp.html`/`desktop.html`)
- **S2** PDV 클라이언트 존재 + SSOT(`gopang/pdv-history-client.js`) 대비 `diff` 일치
- **S3** GWP_REGISTRY 등록 여부 + `type`(tab/inline/switch) 적절성
- **S4** 트리거(triggers) 배열의 오탐/누락 — 실제 발화 샘플로 재현
- **S5** `gopang-wallet.js` 사본이 있다면(대부분의 서비스가 지참) SSOT 대비 드리프트 확인 — **이번 세션에서 한 번도 확인 안 한 새 축**

## E-1. K-Emergency (911) — id: kemergency

| 체크 | 상태(2026-07-17 기준) | 심화 테스트 필요 항목 | 우선순위 |
|---|---|---|---|
| S1~S3 | 정상(등록·PDV·엔트리 전부 확인됨) | — | — |
| S4 | 미실시 | "살려줘", "심정지" 등 긴급 트리거가 threshold 0.6(전체 중 가장 낮음=가장 민감)로 오탐(단순 감탄사에도 반응) 없는지 | **P0** — 긴급 오탐은 사용자 신뢰에 치명적 |
| S5 | 미실시 | `dashboard.html` 관제 화면이 실제 911 출동 연계 API와 어떻게 통신하는지 문서 대조 | P0 |
| 도메인 | 미실시 | 119/112 연계가 실제 라이브 엔드포인트인지, 목업인지 확인 — 라이브 테스트 항목 | [불가] |

## E-2. K-Law (klaw) — id: klaw [기존: `src/tests/domains/phase4_klaw.test.js`, K-01~K-10]

| 체크 | 상태 | 심화 테스트 | 우선순위 |
|---|---|---|---|
| S2 | **2026-07-17 PDV 클라이언트 신규 배치 완료** | 배치 직후이므로 실제 태그 처리 재확인 필요 | P0 |
| S4 | 미실시 | "판결", "소송" 등 법률 트리거와 K-Police의 "고소"류 트리거가 겹치는지(priority klaw=1, kpolice=1 — 동순위 충돌 가능) | **P0 — 우선순위 동률 충돌 케이스, R3로 이월** |
| 도메인 | ✅ **재실행 완료(11/11 통과)** — K-10이 core 파일의 JSDoc 예시 주석("예: 'k-law'")까지 실제 코드 결합으로 오탐하던 걸 수정 | AI 가상 판결문 로직(K-Law v20.0) 정확성 — classifier.js 자체(K-01~09)는 정상 | 완료 |
| gopang 내 사본 | 미실시 | `gopang/klaw/` 서브디렉토리와 독립 klaw 저장소 간 `diff -rq` | P0, R3로 이월 |
| **🔴 아키텍처 갭(2026-07-17 발견 → 해결)** | `src/tests/domains/phase6_khealth.test.js`의 H-08에서 실제 파이프라인 실행 중 발견 | ✅ **(A)(B) 모두 완료.** (A) 근본 원인은 두 겹이었음: ① `phase2.js`의 p1Score<0.3 게이트가 Phase 2(도메인 분류기 호출) 자체를 생략 — 이 경로가 순수 정규식이라 비용이 사실상 0인데도 협박·사기 어휘 없는 순수 민사분쟁을 걸러내고 있었음(게이트 제거). ② 제거 후에도 `phase4.js`의 WS 공식(P1×0.50+P2×0.35+P3×0.15)이 P2 단독 고신뢰도 감지(CV-2 severity 0.72)를 P1=0일 때 0.252로 희석 — 여전히 S0. Fast-Path가 이미 쓰는 "고신뢰도 단일신호는 안 희석" 원칙을 P2에 최소 적용(severity≥0.5면 최소 S1 문턱 보장, S2/S3는 여전히 P1 뒷받침 필요 — 패턴 매칭 하나로 차단 안 함). (B) "개별 위법 탐지"(1단계, 규칙기반, 비용 0)와 "전반적 위법 가능성 판단"(2단계) 경쟁이 아니라 이어지는 구조로 설계·구현 — 신규 `phase7.js`(LLM 기반, S0면 호출 자체 안 함 → 잡담엔 토큰 0, llmCaller 주입식이라 운영 미설정 시 안전하게 skip, riskResult.level을 직접 안 바꿈). **알려진 v1 범위 제한**: Phase 7은 현재 단일 메시지 단위로 호출됨(멀티턴 대화 전체를 종합하려면 `runPipeline`에 history 스레딩이 추가로 필요 — R3 이후 과제로 남김) | ✅ 완료 — phase7 9/9, phase6_khealth 10/10, phase4_klaw 11/11, phase3_ai_secretary 13/13 |

## E-3. K-Police (police) — id: kpolice

| 체크 | 상태 | 심화 | 우선순위 |
|---|---|---|---|
| S1~S3 | 정상 | — | — |
| S4 | 미실시 | "112 신고" 발화 시 kemergency(119/112 통합)와 kpolice 중 어디로 갈지 — 두 서비스 모두 112 관련 트리거 보유, priority kemergency=0 > kpolice=1이라 emergency 우선일 것으로 추정되나 미검증 | **P0 — 라우팅 충돌** |
| 도메인 | 미실시 | `ops.html`(경찰 운영 화면) 접근 권한 체계 | P1 |

## E-4. K-Security (security) — id: ksecurity

| 체크 | 상태 | 심화 | 우선순위 |
|---|---|---|---|
| S2 | **2026-07-17 PDV 클라이언트 신규 배치 완료** | 배치 직후 재확인 필요 | P0 |
| 도메인 | 미실시 | `security-agent.js` — 해킹/피싱 대응 로직, `security_whitepaper.html` 내용과 실제 코드 기능 일치 여부 | P1 |

## E-5. K-Health (health) — id: khealth [기존: `phase6_khealth.test.js`, H-01~H-10]

| 체크 | 상태 | 심화 | 우선순위 |
|---|---|---|---|
| S1~S3 | 정상 | — | — |
| 도메인 | ✅ **재실행 완료 — 9/10 통과.** H-08(K-Law+K-Health 동시 활성화) 1건 실패 — K-Health 자체 결함 아님, K-Law 쪽 파이프라인 연결 갭이 원인(§E-2 K-Law 아키텍처 갭 참조). K-Health 고유 로직(H-01~07, H-09~10, MED-01~05 분류)은 전부 정상 | 의료 정보 민감도 — needsMedicalSafety 상속 체계(B-3)와의 연동 여부는 별도 확인(B-3에서 이미 임상심리사 등 3개 상속 확인됨) — **완료** |
| 별도 파일 | 미실시 | `health`에만 `pdv.js`가 별도로 있음(다른 서비스는 `pdv-history-client.js`만) — 이 파일의 역할과 중복/충돌 여부 확인 필요 | P1, R3로 이월 |

## E-6. K-Edu (school) — id: kedu

| 체크 | 상태 | 심화 | 우선순위 |
|---|---|---|---|
| S2 | 이전 세션에 "누락"으로 오탐했다가 `js/pdv-history-client.js` 경로에서 재확인(SSOT 일치) | 재확인 완료, 갱신 시 경로 유지 확인 필요 | P1 |
| 도메인 | 미실시 | 전문상담교사 페르소나(B-3)와 K-Edu 서비스 자체의 역할 분담(개인 상담 vs 학교행정) 경계 테스트 | P1 |

## E-7. K-GDC (gdc) — id: kgdc

| 체크 | 상태 | 심화 | 우선순위 |
|---|---|---|---|
| S2 | **2026-07-17 PDV 클라이언트 신규 배치 완료** | 재확인 필요 | P0 |
| 도메인 | 미실시 | `charge-admin.html`, `nation-dashboard.html` — "결제/송금/환전" 트리거(threshold 0.75, 전체 중 가장 높은 축에 속함=가장 신중) 실제 오탐률 | **P0 — 금융 관련, 신중해야 함** |

## E-8. K-Finance/Stock (stock) — id: kfinance

| 체크 | 상태 | 심화 | 우선순위 |
|---|---|---|---|
| S1~S3 | 정상 | — | — |
| 도메인 | 미실시 | "주식/ETF/포트폴리오" — 실시간 시세 연동이 라이브인지 확인 | [불가 부분 포함] |

## E-9. K-Insurance (insurance) — id: kinsurance

| 체크 | 상태 | 심화 | 우선순위 |
|---|---|---|---|
| S1~S3 | 정상 | — | — |
| 도메인 | 미실시 | `my_insurance.html` — 개인 보험 정보 조회 시 PDV scope 권한 체계와 실제 연동 | P0 |

## E-10. K-Commerce/K-Market (market) — id: kcommerce / kcommerce_seller / kbusiness (1저장소 3등록)

| 체크 | 상태 | 심화 | 우선순위 |
|---|---|---|---|
| S3 | 3개 GWP 엔트리가 같은 저장소를 가리킴 — 서로 다른 threshold/trigger로 하나의 코드베이스 내 다른 진입점을 라우팅하는 구조 | 3개 엔트리 각각이 실제로 `gopang-order-flow.html`/`kmarket_admin_dashboard.html`/`gopang-seller-catalog.js` 중 올바른 대상으로 연결되는지 | **P0 — 다중 등록 자체가 오배선 위험** |
| 도메인 | 미실시 | `gopang-wallet.js`(지갑) — STEP27_test_checklist.md의 실제 QA 시나리오(짜장면 주문)와 연동 재현 | P0 |
| SSOT | 미실시 | market의 `gopang-wallet.js`가 다른 12개 서비스의 사본과 버전 일치하는지(`diff` 미실시 — 이번 세션은 pdv-history-client.js만 SSOT 비교했고 gopang-wallet.js는 비교 안 함) | **P0 — 신규 발견 과제** |

## E-11. K-Tax (tax) — id: ktax

| 체크 | 상태 | 심화 | 우선순위 |
|---|---|---|---|
| S1~S3 | 정상(이번 세션 T-01 태그 파싱 테스트의 실제 시나리오 대상이 tax였음) | ④ PDV 태그 테스트가 tax.hondi.net 시나리오로 이미 검증됨 | 완료 |
| 도메인 | 미실시 | 세무사(expert-registry.js) 페르소나와 K-Tax 서비스의 역할 경계(개인 상담 vs 서비스 처리) | P1 |

## E-12. K-Transport/Traffic (traffic) — id: ktransport

| 체크 | 상태 | 심화 | 우선순위 |
|---|---|---|---|
| S1~S3 | 정상 | — | — |
| 도메인 | 미실시 | `national-dashboard.html` — 과태료/단속 정보의 실시간성 | [불가 부분 포함] |

## E-13. K-Logistics (logistics) — id: klogistics

| 체크 | 상태 | 심화 | 우선순위 |
|---|---|---|---|
| S1~S3 | 정상 | — | — |
| 도메인 | 미실시 | market의 배송 요청(`gopang-order-flow.html`)과의 실제 연동(주문→배송 핸드오프) — phase15_delivery_handler.test.mjs와 겹칠 가능성 | P0 |

## E-14. 제주도청 AI (jeju) — id: jeju

| 체크 | 상태 | 심화 | 우선순위 |
|---|---|---|---|
| S2, 참조무결성 | **2026-07-17 stale ref 2건 수정 완료(로컬), push 후 원격 재확인 필요** | push 여부 확인 안 됨(사용자 실행 로그에 push 성공 여부 미명시) | **P0 — 재확인 필요** |
| 도메인 | 미실시 | 자체 SP 트리(`Jejudo/01-do`~`09-national`) — 매니페스트 비의존 구조라 다른 서비스와 다른 별도 무결성 검사 필요 | P1 |
| 문서 | 존재 확인만 | `docs/business-plan/JEJU-FIELD-TEST-MASTER-PLAN_v1.0.md`, `jeju-l1-l3-field-test-plan-2026-07-07.md` — **이미 있는 현장 테스트 계획서, 이 문서와 통합 검토 필요** | P1 |

## E-15. K-Gov (public) — id: kgov

| 체크 | 상태 | 심화 | 우선순위 |
|---|---|---|---|
| S1~S3 | 정상 | — | — |
| 도메인 | 미실시 | `phase17_share_target.test.mjs`(정부24 앱 연동), `phase18_procedure_docs.test.mjs`(공유문서→서류 연결), `phase19_welfare_eligibility.test.mjs`(복지 자격) — **전부 이 서비스와 직결되는 기존 테스트인데 이번 세션 미실행** | **P0 — E-15가 사실상 PART G와 동일 대상** |

## E-16. K-Democracy (democracy) — id: kdemocracy

| 체크 | 상태 | 심화 | 우선순위 |
|---|---|---|---|
| S1~S3 | 정상 | — | — |
| 도메인 | 미실시 | `ai_democracy_sp.html`, `gopang_laws.html` — 청원/여론 집계 로직 | P1 |

## E-17. Gopang QnA (qna) — id: kqna **(2026-07-17 신규 등록, 테스트 이력 0건)**

| 체크 | 상태 | 심화 | 우선순위 |
|---|---|---|---|
| S1 | **완료(2026-07-17)** — index/webapp/desktop.html 전부 HTTP 200 확인 | — | — |
| S2 | **완료 — 실패(P0 발견)** — `pdv-history-client.js`가 저장소 어디에도 없음(루트·js/ 둘 다 404, 클론 후 루트 목록에서도 부재 확인). qna는 51개 파일 규모 신규 저장소인데 PDV 기록 자체가 안 됨 | 신규 저장소 배치 시 SSOT 체크리스트에 PDV 클라이언트가 빠졌을 가능성 — I1-1의 "12개 일치+3개 신규 배치"에 qna/users는 포함 안 됐던 것으로 보임 | **P0 — PDV 기록 불가 상태** |
| S3 | **완료** — gwp-registry.js에 등록됨(id: kqna, type: tab, status: active, priority 9, threshold 0.65) — sp-tag-dispatch.test.mjs SD-14/15로 구조 검증 통과 | — | — |
| S4 | 미실시(정적 검사로는 한계) | trigger("찾아줘" 계열은 없지만 "질문있어/문의/궁금해"가 다른 서비스의 일반 질문과 경계가 모호함 — 예: "보험 궁금해"가 kqna로 갈지 kinsurance로 갈지)는 라이브 LLM 판단 품질 문제라 이 샌드박스에서 재현 불가 | **P0** |
| 도메인 | 미실시 | `SP-CORE.txt` + 9개 도메인별 SP(BIZ/ECONOMY/EDU/GOV/INFRA/IP/LEGAL/LOGISTICS/SAFETY) 자체 라우팅 로직 — gwp-registry.js와는 별개로 qna 자체 내부에 2차 라우터가 있음, 이 내부 라우터 테스트 전무 | **P0 — 완전 미검증 영역** |

## E-18. Gopang Users (users) — id: kusers **(2026-07-17 신규 등록, 테스트 이력 0건)**

| 체크 | 상태 | 심화 | 우선순위 |
|---|---|---|---|
| S1 | **완료(2026-07-17)** — index/webapp/desktop.html 전부 HTTP 200 확인 | — | — |
| S2 | **완료 — 실패(P0 발견, qna와 동일 패턴)** — `pdv-history-client.js` 없음(루트·js/ 둘 다 404, 클론 확인) | E-17과 동일 원인으로 추정 | **P0 — PDV 기록 불가 상태** |
| S3 | **완료** — gwp-registry.js에 등록됨(id: kusers, type: tab, status: active, priority 9, threshold 0.65) — sp-tag-dispatch.test.mjs SD-14/15로 구조 검증 통과 | — | — |
| S4 | **재확인 완료 — 이전 판단(3중 충돌) 정정 필요.** 실제 kusers의 trigger는 "찾아줘" 단독이 아니라 "이 사람 찾아줘"/"프로필 찾아줘"/"연락처 찾아줘" 등 구체적 구문이다(gwp-registry.js 508행대 실측 확인) — `ksearch`/`tool-web-search`의 "찾아줘"는 kusers 문구의 부분 문자열이라 완전 동일 충돌은 아님. 다만 matchService()가 dead code라 실사용 라우팅에는 어차피 영향 없음(sp-tag-dispatch.test.mjs SD-16에 정보성으로 기록됨) | 이전 세션(E-18 최초 작성 시점)의 "3중 충돌" 판단 자체가 부정확했음 — 이번 세션에서 실측으로 정정 | P1(실사용 영향 없음으로 하향) |
| 도메인 | 미실시 | GAS(Gopang Address System) v1.6 기반 엔티티 검색 — `register-profile.html`/`profile.html`과의 데이터 연동(동일 저장소 내 register 관련 파일들) | P0 |


---

# PART F — 네트워크/푸시/보안/GDC/프라이버시 계층

[기존: `src/tests/network/phase5_network_gdc_privacy.test.js`(N-01~05, G-01~08, P-01~06),
`phase9_push_broadcast.test.js`(PB-01~04), `phase10_push_l1_priority.test.js`]

| ID | 대상 | 목적 | 우선순위 | 커버리지 |
|---|---|---|---|---|
| F-1 | Network 계층(N-01~05) | `src/network/` 통신 규약 | P0 | ✅ **완료 — 실제 프로덕션 버그 발견·수정.** 원래 파일(`phase5_network_gdc_privacy.test.js`)이 GDC import 6곳(§F-2 참조)이 깨져 파일 전체가 단 하나도 실행 못 하는 상태였음 — `phase5_network_privacy.test.js`로 분리해 N-01~05 살림. 분리 중 `src/network/layerClient.js` 자체가 "config import 제거"라는 자기 주석대로 실제 import는 지웠는데 `config.LAYER_ENDPOINTS`/`config.ENV` 참조는 안 지워서 이 파일을 import하는 순간 항상 크래시하던 것도 발견·수정(로컬 dev 스텁 추가). 5/5 통과 |
| F-2 | GDC 계층(G-01~08) | `src/gdc/` — E-7(K-GDC 서비스)과는 별개로 코어에도 GDC 모듈이 존재, 역할 분담 확인 필요 | P0 | ✅ **"역할 중복"이 아니라 gopang에 GDC 코드 자체가 더 이상 없음을 확인.** `git log`로 실측: 2026-07-15 커밋(e0e71d0)에서 `src/gdc/*.js` 6개(tokenomics/smartVault/currencyPool/escrow/dao/offlineQueue)가 통째로 gdc 저장소로 이동했음(고의적 마이그레이션, 버그 아님). gopang 쪽에서는 G-01~08을 더 이상 검증할 수 없음 — 원본 테스트 스펙을 `docs/phase5_gdc_original_spec_REFERENCE.js`로 보존하고, 실제 검증은 `HONDI_DOMAIN_DEEP_TEST_DIRECTIVE_v1_0.md` §4.5(gdc 저장소)로 이관 완료 |
| F-3 | Privacy 계층(P-01~06) | `src/privacy/` | P0 | ✅ **완료 — 6/6(P-06은 offlineQueue.js 부재로 skip, 별도 실패 아님).** F-1과 같은 분리 작업으로 함께 살림. `getMixnode()` 누락 import 버그도 함께 발견·수정(GDC import 에러에 가려 안 보이고 있었음) |
| F-4 | Push 브로드캐스트(PB-01~04) | `worker.js`의 `POST /push/broadcast`, `sw.js` push 분기 | P1 | ✅ **완료 — 실제 프로덕션 버그 발견·수정, 8/8 통과.** PB-04: 구독 픽스처가 placeholder 키(`p256dh:'x'`)라 실제 payload 암호화를 못 통과해 발송이 항상 조용히 실패(sent:0)하던 것 발견 — 진짜 ECDH 키로 교체. 같은 테스트의 Authorization 헤더 정규식이 프로덕션이 실제로 만드는 형식(콤마 뒤 공백)과 안 맞아 검증 자체가 안 되던 것도 수정. SW-01~03은 `sw.js`에 나중에 추가된 상시 PLAY_SOUND 브로드캐스트를 반영 안 한 낡은 기대값이었음 — 갱신 |
| F-5 | Push L1 우선순위 | `node:test` 프레임워크 사용(다른 파일들과 다른 스타일 — Node 내장 test runner) | P1 | ✅ **완료 — 전면 재작성, 5/5 통과.** 이 파일 전체가 "L1 우선, Supabase 폴백" 아키텍처를 검증하고 있었는데 2026-07-14에 Supabase가 완전히 폐기됨(handlePushSend/handlePushSubscribe 어디에도 Supabase 코드 없음, 실사 확인) — "L1 only, 실패 시 즉시 502" 현재 설계에 맞춰 재작성 |

---

# PART G — 정부 연계 특수 기능

이 PART는 사실상 E-15(K-Gov)의 심화 항목과 동일 대상을 다루므로, 실행 시 E-15와
묶어서 진행 권장.

| ID | 대상 | 목적 | 우선순위 | 커버리지 |
|---|---|---|---|---|
| G-1 | `phase17_share_target.test.mjs` | 정부24 앱 ↔ 혼디 앱 대 앱 연동, Web Share Target API | P0 | ✅ **완료(2026-07-18) — 20/20 통과, 회귀 없음.** 전부 in-memory mock(Cache Storage), 실제 네트워크 호출 없음 |
| G-2 | `phase18_procedure_docs.test.mjs` | "정부24 공유문서 → 개인파산 court-filing 서류 연결" | P0 | ✅ **완료(2026-07-18) — 41/41 통과, 회귀 없음** |
| G-3 | `phase19_welfare_eligibility.test.mjs` | "기초수급자격 확인+신청" 사고실험 | P0 | ✅ **완료(2026-07-18) — 20/20 통과, 회귀 없음** |
| G-4 | `phase20_document_handoff.test.mjs` | "이력서+등본 두 통을 기업에 전송" 사고실험 | P1 | ✅ **완료(2026-07-18) — 20/20 통과, 회귀 없음** |
| G-5 | `phase22_sp_author_automation.test.mjs` | B-4와 중복 리스트 — SP 저작 자동화 | P1 | ✅ **완료(2026-07-18) — 14/14 통과, 회귀 없음.** L1 PocketBase in-memory mock만 사용 |
| G-6 | `phase24_web_search.test.mjs` | `POST /web-search`(Serper.dev 프록시) | P1 | ✅ **완료(2026-07-18) — 5/5 통과, 회귀 없음.** 테스트 자체 주석에 "Serper.dev 호출은 이 샌드박스에서 불가하므로 mock"이라 명시돼 있음 |

**PART G 결론**: 6개 전부 완전 mock 기반(라이브 정부24/Serper.dev 호출 없음)임을 실행 전 확인 후 전량 실행. 120/120 통과, 신규 버그 없음.

---

# PART H — 부트스트랩 / Shell UI [기존: `phase7_bootstrap.test.js`, B-01~B-09]

| ID | 대상 | 목적 | 우선순위 | 커버리지 |
|---|---|---|---|---|
| H-1 | `src/app.js` 부트스트랩 순서 | v3.1 문서 §7 명시 순서(core→pdv→openhash→...) 준수 | P0 | ✅ **실행 완료(2026-07-18) — 8/9 통과, 1건 실패(B-03).** 순서 자체(`registry.init`→`registry.register`→`ShellUI.render`)는 정상 구현·정상 실행됨. **추가 실측**: `src/app.js`의 `bootstrap()`은 죽은 코드가 아니라 `gopang-app.js`의 `_boot()`(webapp.html이 로드)가 `await import('./src/app.js')`로 동적 호출 — A1-2가 이월만 하고 확인 못 한 부분이 해소됨. 다만 6단계 `ShellUI.render()`가 찾는 DOM 루트 `#gopang-shell`이 webapp.html/desktop.html 어디에도 없어 `_renderDOM()`의 `if (!root) return` 가드에 걸려 **매번 조용히 no-op**됨 — webapp.html은 `#message-list`/`#status-dot`/`#tab-bar`를 손으로 직접 구현해 놓았고 `registry`/`ShellUI`와 전혀 안 이어져 있음. `bootstrap()`은 "성공" 로그를 남기고 KLaw/KHealth 플러그인을 `registry`에 등록까지 하지만 그 결과를 실제로 소비하는 코드가 없음. 버그라기보단 아키텍처 미스매치 — 2026-05-30(fbeadad) "device-routing index, PC desktop.html, mobile webapp.html restored" 커밋에서 셸 구조가 통째로 교체되며 shell-ui.js의 DOM 생성 경로가 고아가 된 것으로 보임 |
| H-2 | `index.html` Shell UI | 최초 로딩 화면 구성요소 | P1 | ✅ **실행 완료(2026-07-18, B-03) — 실패.** index.html에 `#gopang-shell`/`#boot-splash`/`src/app.js` 참조가 전혀 없음. 버그가 아니라 H-1과 동일한 아키텍처 변경 — index.html은 더 이상 Shell UI 마운트 지점이 아니라 기기 판별 후 webapp.html(모바일/SSO)·desktop.html(PC 정적 랜딩)로 즉시 리다이렉트만 하는 라우터 페이지로 재작성됨(fe99325 "index.html 스플래시 제거"). 테스트가 낡은 기대치를 검사하고 있음 |

**PART H 결론**: 코드 결함은 없음(부트스트랩 순서 자체는 정상 동작). **2026-07-18 주피터님 결정: (1) 테스트를 실제 구조에 맞게 재작성 — 완료. (2) `gopang-app.js`/`src/app.js`/`shell-ui.js` 정리(레거시 v2 플러그인 체계 제거)는 의도적으로 보류, 코드에 경위 주석만 남김.** `phase7_bootstrap.test.js`의 B-03을 index.html의 실제 역할(기기 판별 후 webapp.html/desktop.html 리다이렉트)에 맞게 재작성해 9/9 전체 통과로 갱신했다. `gopang-app.js`의 `bootstrap()` 호출부와 `phase7_bootstrap.test.js` 상단에 향후 제거 작업 시 필요한 정보(무엇이 죽은 코드가 아니고 무엇이 no-op인지, 함께 지울 파일 목록)를 주석으로 남겨뒀다.

---

# PART I — 횡단 관심사 (Cross-cutting)

이번 세션에서 실제로 필요성이 드러난, 기존 Phase 체계 어디에도 속하지 않는 신규 영역이다.

## I-1. SSOT 드리프트 방지

| ID | 대상 | 목적 | 우선순위 | 커버리지 |
|---|---|---|---|---|
| I1-1 | `pdv-history-client.js` 전 저장소 `diff` | 이번 세션 완료(12개 일치 확인, 3개 신규 배치) | P0 | **[완료]** |
| I1-2 | `gopang-wallet.js` 전 저장소 `diff` | **완료(2026-07-17, 이 세션) — 3세대 드리프트 확인.** ① gopang(허브): v2.0.0/IDB_VER=3, anchor_chain(OpenHash 통합)+WebAuthn PRF+X25519 암호화 키페어까지 포함(1,510줄, 최신). ② `users`: v2.0.0/IDB_VER=2, `hash_chain` 스토어(OpenHash 통합 이전 세대, anchor_chain 개명·WebAuthn·X25519 전부 없음, 1,062줄) — 허브와 users 사이 중간 세대가 그대로 배포돼 있음. ③ klaw/911/police/health/school/stock/insurance/market/tax/traffic/logistics/jeju/public/democracy/qna(15개): v1.0.0, IDB 스토어 자체가 keys 하나뿐(hash_chain조차 없음, 567줄) — OpenHash 앵커링 기능이 이 15개 저장소의 지갑에는 전혀 없는 상태. ④ security/gdc: `gopang-wallet.js` 파일 자체가 없음(같은 두 저장소에 `pdv-history-client.js`는 최근 배치돼 있음 — I1-1이 말한 "3개 신규 배치"가 아마 이 두 곳 포함일 가능성, 근데 지갑 파일은 그때 안 딸려간 것으로 보임). **재배포는 각 저장소에 대한 push 권한이 필요해 이 세션 범위 밖 — 주피터님 확인 후 우선순위(허브 v2.0.0을 18개 전체에 동기화할지, 아니면 위성 저장소는 지갑 기능 자체가 불필요한지) 판단 필요.** | **P0 — 조사 완료, 배포는 사용자 조치 필요** |
| I1-3 | `desktop.html`/`webapp.html` 공통 셸 템플릿 | 서비스마다 다른 트리, 어디까지 공유되어야 하는지 기준 문서 부재 | P2 |

## I-2. 참조 무결성 확장

| ID | 대상 | 목적 | 우선순위 | 커버리지 |
|---|---|---|---| ---|
| I2-1 | `check_stale_refs.py`의 SP-00-ROUTER 검사 스킵 근본 원인 | B2-6과 동일 항목, 여기서도 재강조 | **P0** | ✅ **재확인 완료(2026-07-18) — 이미 해소돼 있었음.** 103~109행 주석에 "2026-07-05 신설 당시엔 유의미했으나, 같은 날 나중에(6766c60) SP-00-ROUTER 자체가 삭제됨"이라 명시, 실제로 그 검사는 "manifest에 SP-00-ROUTER 키 없음 — 검사 건너뜀" 경고만 찍고 항상 통과하도록 이미 처리됨(6aad178). 추가 조치 불필요 |
| I2-2 | GWP_REGISTRY 트리거 충돌 전수 조사 | E-18에서 발견한 "찾아줘" 3중 충돌처럼, 28개 서비스 전체 trigger 배열을 교차 비교해 숨은 충돌 찾기 | **P0 — 이번 계획서 작성 중 실제로 1건 발견됨, 전수조사 시 더 있을 가능성 높음** | ✅ 이전 세션(R1)에서 완료 — 동일 trigger 문자열 공유 7쌍 확인(matchService dead code라 실사용 무관) |
| I2-3 | `services/fiil-kcleaner`, `kbank`/`ktelecom`/`kestate`(switch형) — 별도 저장소 없는 서비스들의 코드 실체 확인 | 이번 세션에서 fiil-kcleaner는 gopang/services 하위에 있음만 확인, kbank 등 3개는 존재 자체를 확인 안 함(type:switch라 SP만 있고 코드가 없을 가능성) | P1 | ✅ **완료(2026-07-18).** kbank/ktelecom/kestate: 예상대로 `SP-22~24_*.txt` SP 파일만 존재, 별도 코드 없음(설계대로). fiil-kcleaner: `services/fiil-kcleaner/manifest.json` 하나뿐 — `url: "https://fiil.kr/webapp.html"`로 이 저장소 밖 외부 배포 사이트를 가리킴, gopang 쪽엔 SP 경로만 있고 실 서비스 코드는 fiil.kr 별도 배포. 둘 다 설계대로, 버그 아님 |

## I-3. 보안 회귀

| ID | 대상 | 목적 | 우선순위 | 커버리지 |
|---|---|---|---|---|
| I3-1 | `handleProfilePost` 서명 검증 우회 시나리오 | 서명 없이/위조 서명으로 프로필 갱신 시도 시 실제 거부되는지 | P0 | ✅ **완료(2026-07-18) — 신규 테스트 `src/tests/integration/phase25_security_regression.test.mjs` 5/5 통과.** 워커통합 방식(라이브 인프라 불필요, worker.js 직접 import + L1 mock)으로 검증 가능함을 확인 — "[불가]로 재분류될 가능성" 우려가 해소됨. 검증한 우회 시도: (a) signature 누락 → 400, (b) 랜덤 위조 서명 → 401, (c) 공격자가 자기 키로 서명 후 pubkey만 피해자 것으로 바꿔치기 → 401(서명·공개키 불일치로 차단), (d) 다른 guid로 서명해놓고 요청 본문 guid만 바꿔치기(메시지 변조) → 401. 정상 서명은 통과(오탐 없음). **결론: 우회 경로 발견 안 됨** |
| I3-2 | `phone_verify_token` 재사용 공격 | 한 번 쓴 토큰 재사용 시 거부되는지 | P0 | ✅ **완료(2026-07-18) — 수정 완료, 신규 테스트 13/13 통과.** 주피터님 확인 결과 PC 로그인과는 무관(그건 별도 QR SSO 경로)한 순수 사업자 claim 시나리오였고, "토큰을 guid에 묶어라"는 지시로 수정 진행. **수정 내용**: (1) `handlePhoneOtpVerify`가 이제 `guid`를 선택 인자로 받아 서명 대상에 포함(`e164:guid:exp`) — claim 흐름은 이제 특정 guid 전용 토큰만 통과, 다른 guid로 재사용 시 403 `TOKEN_GUID_MISMATCH`. (2) **수정 과정에서 별개의 실제 프로덕션 버그 발견·수정**: `handleProfileClaim`이 `atob(payloadB64)`로 payload를 디코딩하고 있었는데, 발급부(`handlePhoneOtpVerify`)는 2026-07-15(caf72c1)에 `btoa()`를 이미 제거해서 payload가 원문 그대로 서명되고 있었다(같은 날 `pb_hooks/main.pb.js`의 등록용 검증 훅은 맞춰 고쳐졌으나 claim용인 이 함수만 누락). payload에 base64 알파벳에 없는 `:` 문자가 있어 `atob()`가 매번 예외를 던져 **2026-07-15 이후 전화인증 claim 시도가 전부 TOKEN_MALFORMED로 실패하고 있었던 것으로 보임** — atob() 제거로 함께 수정. (3) 테스트를 손으로 만든 토큰 대신 실제 `/biz/phone-otp-verify` 엔드포인트를 호출해 발급받도록 재작성(이번에 놓쳤던 발급부-검증부 불일치를 다음엔 테스트가 직접 잡을 수 있도록) |
| I3-3 | PDV `request_id` 위조(T-05에서 이미 로직 확인, 라이브 재현 필요) | 크로스 사이트 재사용 방어 | P0 | [기존 로직 확인, 라이브 미확인 — 이번 세션에서도 미착수] |

## I-4. 환경 매트릭스 (실행 가능성 요약)

| 계층 | 정적 | 유닛 | 격리통합 | 워커통합 | 라이브 필수 |
|---|---|---|---|---|---|
| PART A(코어) | ✓ | ✓(A-3 완료) | — | — | A3-8 IDB만 |
| PART B(AI/오케스트레이션) | ✓ | 부분 | — | ✓(router-category, sp-intercall) | — |
| PART C(프로필2.0) | — | 추정 다수 | — | 추정 다수 | M03 결제는 라이브 필수 가능성 |
| PART D(시각코드) | ✓ | ✓(D-1 대부분 완료) | — | — | D1-5, D1-9 |
| PART E(K서비스) | ✓ | — | — | — | 대부분의 "도메인" 항목 |
| PART F~H | 부분 | ✓ | — | 부분 | — |
| PART I | ✓ | ✓ | — | — | I3 일부 |

---

# 3. 실행 로드맵 및 우선순위

## Phase R1 — 즉시(다음 세션 최우선, 전부 이 샌드박스에서 실행 가능)

1. **B2-5** `phase23_gwp_registry_scaling.test.mjs` — ✅ 완료(11/11 통과, 회귀 없음) + DB 드리프트 마이그레이션(`1786500002_...`) 추가
2. **PART C 전체(M01~M13)** — ✅ 완료(+보너스 M14). M08/M09/M11/M12/M14 절대경로 버그 수정 후 전부 통과(19/19, 12/12, 22/22, 19/19, 10/10). **M10(ledger.js) 프로덕션 모듈 자체가 없음 확인 — 사용자 결정 필요**
3. **A3-7** `phase_anchor_integration.test.js` — ✅ 완료(12/12 통과) + hashChain.js 배치 타이머 unref() 누락 버그 수정(프로세스 행 현상 재현·해결)
4. **B2-1, B2-2** `router-category.test.mjs`, `sp-intercall.test.mjs` — ✅ 완료. B2-1은 죽은 `router.js` 참조로 실행 자체 불가 확인 후 `sp-tag-dispatch.test.mjs`(16/16)로 교체. B2-2는 최초 실행 시 26개 중 8개 실패 → JEJU-DO-SP 목 파일명 드리프트(v1.0→v1.5)가 원인으로 확인, 수정 후 26/26 통과
5. **I1-2** `gopang-wallet.js` 전 저장소 diff — ✅ 조사 완료(3세대 드리프트 + security/gdc 파일 누락 발견, §I-1 참조) — **재배포는 push 권한 필요해 사용자 판단/조치 대기**
6. **I2-2** 트리거 충돌 전수조사(kusers/ksearch/tool-web-search 3중 충돌 재현 포함) — ✅ 완료. 정확히 동일한 trigger 문자열 공유 7쌍 확인(정보성, matchService dead code라 실사용 무관) + kusers 3중 충돌 판단 자체가 부정확했음을 재확인·정정(§E-18 S4)
7. **E-17, E-18** qna/users 방금 등록한 신규 서비스 최초 검증 — ✅ S1~S3 완료. **P0 발견: 두 저장소 모두 `pdv-history-client.js`가 없어 PDV 기록이 아예 안 되는 상태**(§E-17/E-18 S2 참조, 사용자 조치 필요)

## Phase R2 — 단기(1주 내)

- ✅ PART A 나머지(A1-1/A1-2/A1-3, A2-1/A2-3/A2-4, A4-1) 완료 — A4-1에서 evidencePackage.js 프로덕션 버그 발견·수정
- ✅ PART B 나머지(B1 전체, B2-3/B2-4/B2-6/B2-7, B3-2/B3-4, B4-1~B4-3) 완료 — B1-1에서 ai-secretary/phase6.js 프로덕션 버그 발견·수정, B1-2에서 phase13_ai_chat_handler.test.mjs L1 이관 드리프트 전면 수정
- ✅ PART E — gopang 세션에서 가능한 만큼(구조적 SSOT 확인) 완료. E-2(K-Law)에서 **중대 아키텍처 갭 발견·수정**(classifier.js가 실사용 파이프라인에 연결 안 돼 있던 문제, phase2.js/phase4.js 수정 + phase7.js 신설로 "개별 위법 탐지 vs 전반적 위법 가능성 판단" 2단계 구조 구현). 나머지 16개 서비스 저장소의 도메인 고유 로직 심화 테스트는 `docs/HONDI_DOMAIN_DEEP_TEST_DIRECTIVE_v1_0.md`로 별도 작업자에게 이관
- ✅ PART F 전체(F-1~F-5) 완료 — F-1/F-3에서 `layerClient.js` 로드 크래시, F-4에서 push 발송 조용한 실패 2건 발견·수정, F-2는 GDC 코드가 gdc 저장소로 완전 이동했음을 확인(원본 스펙 보존·이관), F-5는 Supabase 폐기 이후 아키텍처로 전면 재작성

**미해결 — 사용자 결정 대기 중인 항목**:
- PART C M10(ledger.js) — ✅ 사용자 지시로 신규 구현 완료(2026-07-17)
- I1-2 wallet 3세대 드리프트 — ✅ 18개 저장소 동기화 완료(2026-07-17)
- E-17/E-18 PDV 클라이언트 누락 — ✅ qna/users 배치 완료(2026-07-17)
- A1-3 의존성 방향 규칙 위반(`core/auth.js`가 ui/services/ai를 import) — **미해결, 리팩토링 범위가 크고 위험해 임의로 안 건드림**

## Phase R2 다음 — ✅ 완료(2026-07-18)

- ✅ **PART G** 정부 연계 특수 기능 6개 전부 실행 — 사전에 전부 mock 기반(라이브 의존 없음) 확인 후 실행, 120/120 통과, 신규 버그 없음
- ✅ **PART H** 부트스트랩/Shell UI — 실행은 8/9(B-03 실패)이나, 실패 원인을 아키텍처 변경(2026-05-30 index.html→webapp.html/desktop.html 분리)으로 규명. 추가로 `ShellUI.render()`가 프로덕션에서 `#gopang-shell` 부재로 매번 no-op된다는 부작용 신규 발견 — **사용자 판단 대기**
- ✅ **PART I** — I-1(이미 완료), I-2(전부 확인 완료, 추가 조치 불필요), I-3(신규 테스트 작성 — I3-1 우회 경로 없음 확인, I3-2에서 **phone_verify_token의 다중 프로필 재사용 가능성 신규 발견 — 사용자 판단 대기**), I-3-3만 라이브 필요라 미착수, I-4는 아래 갱신판 참고

**미해결 — 사용자 결정 대기 중인 신규 항목(2026-07-18)**: 전부 해소됨.
- PART H — ✅ 사용자 지시로 처리 완료(2026-07-18): 테스트 재작성 완료, 코드 정리는 주석만 남기고 보류
- I3-2 — ✅ 사용자 확인·지시로 처리 완료(2026-07-18): 토큰을 guid에 바인딩(guid 없는 토큰으로 claim 시 400 TOKEN_NOT_BOUND, 다른 guid용 토큰 재사용 시 403 TOKEN_GUID_MISMATCH). 수정 과정에서 별개의 실제 프로덕션 버그(발급부-검증부 base64 인코딩 불일치로 전화인증 claim이 2026-07-15 이후 전부 실패하던 것)도 함께 발견·수정 — 상세는 위 I3-2 항목 참고

## Phase R3 — ✅ 실질적으로 완료(2026-07-18)

R3의 결정 대기 항목(PART H, I3-2, A1-3) 전부 사용자 확인·지시로 처리 완료. 남은 항목은
전부 이 샌드박스의 근본적 한계(라이브 인프라 필요) 때문에 보류 중이거나, 사용자가 필요할
때 요청하면 되는 선택적 작업뿐 — R3 로드맵상 더 이상 미해결 결정 대기 항목 없음.

- A1-3 의존성 방향 규칙 위반 — ✅ 종결(2026-07-18): 조사 결과 실질적 위험 없음(순환참조 없음,
  DOM-less 컨텍스트 미사용 확인), 규칙 출처 자체가 PART H와 같은 폐기 문서. 리팩토링 안 함
- phase7.js LLM 배선 — ✅ **완료(2026-07-18, 아래 전용 섹션 참고)**
- I3-3(PDV request_id 위조 라이브 재현) — **라이브 환경 필요, 이 샌드박스에서 불가**
- PART G 라이브 정부24/Serper.dev 실물 연동 확인 — **라이브 환경 필요, 이 샌드박스에서 불가**

## Phase 7 실전 배선 — ✅ 완료(2026-07-18, 사용자 설계 확정 후 구현)

기존 §3(A) 항목의 "**알려진 v1 범위 제한**"과 이어지는 후속 작업. 단순 배선이 아니라
설계·비용·법적 책임 문제가 얽혀 있어 사용자와 여러 차례 논의 후 아래로 확정:

- **비용 정책**: 수익자 부담 원칙 — Phase 7은 opt-in(기본 꺼짐), 켜면 사용자 본인의
  무료 한도/GDC 잔액에서 차감(`/deepseek` 프록시를 본인 guid로 호출). 플랫폼 공용
  예산(K-Law `/klaw/relay` 같은)은 쓰지 않음 — 사용자가 요청·소비도 안 하는 백그라운드
  검사를 플랫폼이나 사용자 모르게 과금하지 않기 위함
- **신고 메커니즘**: **완전 자동 신고 없음.** S3(정규식 즉시감지)든 Phase 7의
  `recommend_review`든, 위법 가능성이 감지되면 신고 초안만 만들어 채팅창에 "🚨
  K-Police에 신고" 버튼으로 보여줄 뿐, 실제 전송은 사용자가 직접 버튼을 눌러야만
  이뤄진다("1초를 다투는 긴급 상황" 논의 결과 — 법적 책임 소재가 불분명해 사용자가
  직접 신고하는 쪽으로 최종 확정). 버튼을 누르면 K-Police 웹앱(`kpolice`, GWP_REGISTRY
  등록됨, `url: https://police.hondi.net/webapp.html`)을 `_gwpLaunch()`로 새 탭에
  열면서 신고 초안을 컨텍스트로 넘긴다 — 실제 제출은 그 탭에서 사용자가 직접 진행.
  **police.hondi.net이 이 컨텍스트를 받아 실제로 뭘 하는지는 이 저장소 밖(외부 배포)이라
  확인 불가** — 핸드오프까지가 이번 작업 범위
- **구현 파일**: `src/gopang/core/config.js`(`CFG.phase7` 설정 + 저장/로드),
  `webapp.html`(AI 설정 패널에 토글 UI 추가, 확인 버튼이 `saveSettings()`를 안 부르고
  있던 기존 버그도 같이 수정), `src/gopang/ui/settings.js`(`openAISettings()`가 저장된
  Phase7 상태를 반영하도록), `src/gopang/ui/send-message.js`(`llmCaller` 배선 + 신고
  초안 UI)

**부수 발견 — 이번 배선 과정에서 드러난 실제 프로덕션 버그 2건 (전부 수정 완료)**:
1. `_runPipelineBackground()`의 동적 import 경로가 `'./src/ai-secretary/pipeline.js'`
   였는데, 이 파일(`src/gopang/ui/send-message.js`) 기준 상대경로는
   `src/gopang/ui/src/ai-secretary/pipeline.js`로 잘못 해석됨(존재하지 않는 경로) —
   매번 404로 실패하고 catch가 콘솔 경고만 남기고 조용히 삼켰다. `../../ai-secretary/pipeline.js`로 수정
2. **더 근본적으로, `_runPipelineBackground()` 자체가 `sendMessage()`를 포함해
   어디서도 호출되지 않고 있었다**(export도 안 됨) — 즉 위 1번을 고치기 전부터
   **Phase 0~6 전체(위험 탐지·PDV 기록·OpenHash 앵커링)가 실제로는 한 번도 실행되지
   못했던 것으로 보인다.** `sendMessage()`의 `if (text) {...}` 분기 진입 시
   fire-and-forget으로 호출하도록 연결
3. (미수정, 후속 과제로 기록만) `showRiskAnalysis()`도 같은 이유로 고아 상태 —
   "분석 결과 보여줘" 같은 사용자 명령에 연결하는 라우팅이 어디에도 없음. Phase 7
   경고 자체는 `_injectReportSuggestion()`으로 직접 띄우게 만들어서 이번 작업 범위엔
   영향 없었지만, 상세 분석 결과를 나중에 다시 보고 싶을 때 쓸 명령어 라우팅은 없는 상태

**검증 범위의 한계**: 이 변경은 브라우저 DOM(`document.getElementById` 등)에 깊게
의존하는 UI 코드라, 이 저장소의 기존 테스트 스위트(Node 단독 실행)로는 자동
검증이 안 된다 — `node --check` 문법 검사, 전체 import 체인 파일 존재 확인, 코드
리뷰로 검증했다. 실제 브라우저 동작 확인(설정 토글 저장/로드, 신고 버튼 클릭 시
새 탭 오픈 등)은 배포 후 수동 확인이 필요하다.

## 위임된 16개 K서비스 심화 테스트 — ✅ 검토 완료(2026-07-18)

`docs/HONDI_DOMAIN_DEEP_TEST_DIRECTIVE_v1_0.md`로 위임했던 16개 K서비스 저장소
(https://github.com/Openhash-Gopang/{911,police,security,school,gdc,stock,insurance,
market,tax,traffic,logistics,jeju,public,democracy,qna,users})를 각각 clone해서
최근 커밋 이력을 검토했다. 결론: **작업자가 실제로 심화 테스트를 수행했고, 오늘
(2026-07-18) 세션 하나에서 이 문서 전체를 통틀어 손꼽힐 만큼 심각한 취약점 2건을
발견·수정 완료했다.**

### 🔴 최우선 — school 저장소: 학생 프로필 IDOR (아동 개인정보 직결)

`dashboard.html`의 `window._onGopangAuth`가 guid를 "URL 쿼리 파라미터 우선, 없으면
인증된 `user.ipv6`" 순서로 결정하면서, **로그인한 사용자 본인의 guid와 URL이 지정한
guid가 같은지 비교하는 코드가 파일 전체에 단 한 줄도 없었다.** 결과: 아무 계정으로나
로그인한 뒤 URL을 `?guid=<다른-학생-guid>`로 바꾸면 그 학생의 이름·나이·학제
단계·진로 희망·AI 대체가능성 점수·최근 성적표 3건이 그대로 조회됨 — **조건부·잠재적
위험이 아니라 발견 시점에 이미 완전히 작동하는 데이터 유출 경로**였다. 대상이
미성년자 학생이라는 점에서 작업자 스스로 "이번 세션 전체를 통틀어 가장 심각한
발견"으로 기록. jsdom으로 실제 재현 후(테스트 커밋으로 문서화) 즉시 수정 —
`window._onGopangAuth`가 이제 URL의 `?guid=`를 완전히 무시하고 오직
로그인한 본인의 `user.ipv6`만 쓴다. 수정 확인 테스트 2/2 통과. (학부모/교사가 자녀·
학생 데이터를 봐야 하는 정당한 시나리오는 서버가 "요청자-학생 관계"를 실제로
검증하는 별도 기능으로 새로 설계해야 한다고 작업자가 명시 — 법적 검토 포함, 범위 밖으로 분류)

### 🔴 최우선 — security 저장소: K-Security 에이전트 무인증 원격 킬스위치

`security-agent.js`는 school/traffic/stock 등 **여러 하위 서비스의 `</body>` 직전에
삽입되어 광범위하게 배포**되는 스크립트다. 서버발 지시 채널(`COMMAND_URL`) 자체는
아직 비활성(null)이지만, **`window.KSecAgent.executeCommand`가 서명·출처 검증
없이 전역에 그대로 노출**돼 있었다 — 같은 페이지의 다른 스크립트(광고, 위젯, 또는
XSS로 주입된 코드)가 `window.KSecAgent.executeCommand({type:'SUSPEND'})`를 직접
호출하면 해당 서비스의 모든 입력·버튼이 즉시 비활성화됨(서비스거부/DoS 킬스위치).
jsdom으로 실증(테스트 커밋)한 뒤 (1) `executeCommand`를 전역 노출에서 제거(report/
diagnose만 읽기 전용이라 계속 노출), (2) `COMMAND_URL` 활성화 시를 대비해 Ed25519
서명 검증 체계를 미리 설계·구현 — 서명·`svc_id`(교차 서비스 재생 방지)·`ts`(5분 이내
신선도)·화이트리스트 타입 4중 검증을 전부 통과해야 실행. 서명 검증 테스트 8개 +
취약점 수정 확인 1개, 총 9/9 통과. **⚠️ 후속 조치 필요: 코드의
`K_SECURITY_PUBLIC_KEY_B64U`가 아직 테스트용 플레이스홀더 키다 — 실제 K-Security
서버의 개인키와 짝이 맞는 진짜 키로 교체해야 이 검증이 실전에서 의미가 있다**(작업자
본인이 코드 주석에도 명시).

### 나머지 14개 저장소

최근 커밋을 검토한 결과 위 두 건과 같은 수준의 신규 취약점은 없음 — 정상적인 유지보수
범위(UNIVERSAL-INTEGRITY `service_id` 주입 일관성 정리, `gopang-proxy`→`hondi-proxy`
도메인 이관, `GWP_DONE` 보고 배선, PDV/지갑 클라이언트 SSOT 동기화 등)로 판단.
`gdc` 저장소는 F-2에서 이미 확인한 것처럼 법적 검토를 거쳐 DAO·tokenomics 활성화,
escrow는 계속 legal-hold 상태.

**남은 일**: (1) security의 진짜 공개키 교체 — 사용자(또는 K-Security 서버 관리자)만
할 수 있는 일이라 여기서 처리 불가. (2) school/security 두 저장소는 이 gopang
저장소 밖이라 patch 방식으로 전달 못 함 — 이미 각 저장소에 직접 커밋·푸시된 상태로
확인됨(추가 조치 불필요, 확인만 하면 됨).



## 세션 중 신규 기능 4종 테스트 커버리지 점검 — ✅ 완료(2026-07-18)

이번 세션 진행 중 주피터님이 별도로 push한 신규 기능(GDC P2P 이체, GDC 예치금 인출,
GDC DAO 거버넌스, 플랫폼 수수료율 API) 4건을 전부 점검했다.

| 기능 | 커밋 | 테스트 상태 |
|---|---|---|
| GDC 예치금 인출(`/biz/gdc-deposit-close`) | 120ae1d | ✅ 커밋 시점에 이미 테스트 작성됨(`test/gdc_deposit_close.test.mjs` 3개 + `test/gdc_deposit_close_full.test.mjs` 5개, 실제 Ed25519 서명 사용) — 재실행 8/8 통과 |
| GDC DAO 거버넌스(제안/투표/조회 3종) | cc8aff2 | ✅ 커밋 시점에 이미 테스트 작성됨(`test/gdc_dao.test.mjs` 7개, stake_gdc 클라이언트 자기신고 방지 검증 포함) — 재실행 7/7 통과 |
| 플랫폼 수수료율(`GET /biz/fee-rate`) | 47799d7 | ✅ 커밋 시점에 이미 테스트 작성됨(`test/fee_rate.test.mjs` 1개) — 재실행 1/1 통과 |
| GDC P2P 이체(`/wallet/gdc-transfer`) + `/api/tx` 서명 암호학적 검증 신설 | a775958 | ⚠️ **테스트 없었음 — 점검 중 심각한 버그 발견, 수정 + 신규 테스트 작성 완료(아래)** |

### 🔴 발견 — pb_hooks/main.pb.js의 `sha256hex()` UTF-8 미지원 (한글 상품명 있는 모든 구매가 깨질 뻔함)

`/api/tx` 핸들러에 이번에 처음 추가된 서명 검증은 `expectedTxHash =
sha256hex(sortedStringify(tx))`로 서버가 tx_hash를 직접 재계산해 클라이언트
주장값과 비교한다. 그런데 이 손이식 SHA-256(`pb_hooks/main.pb.js`에 **5곳
복붙**돼 있음)이 `charCodeAt()`이 256 이상(한글 등 비ASCII)이면 **조용히 빈
문자열을 반환**하고 있었다 — UTF-8 멀티바이트 인코딩 없이 코드포인트를 그대로
1바이트로 취급한 게 원인. 실측 재현(Node `crypto.createHash`와 대조): ASCII
입력은 정상이지만 `'GDC 이체'`(GDC P2P 이체의 `item_name` 기본값 그 자체) 하나만
넣어도 결과가 `''`가 됨을 확인. `tx.items`에 실제 상품명이 들어가는 필드(`item.
name`, `src/gopang/gwp/sign.js`에서 서명 확인 UI에 렌더링하는 그 필드)를 감안하면,
**한글 상품명이 있는 모든 K-Market 구매가 이 서명 검증 도입과 함께
TX_HASH_MISMATCH로 거부될 뻔했다** — 한국어 상거래 플랫폼에서 사실상 전체 구매
플로우에 영향을 줄 수 있는 심각도.

**수정**: UTF-8 인코딩 단계(코드포인트 → UTF-8 바이트열, 서로게이트쌍 포함)를
기존 SHA-256 블록 처리 알고리즘 앞에 추가 — 5곳 전부 동일하게 적용. Node
`TextEncoder`와 결과 동일함을 ASCII/한글/이모지 서로게이트쌍/한중일 혼합 문자로
실측 검증.

**함께 검증**: 이 커밋에서 처음 이식된 TweetNaCl Ed25519(`_sigVerify.
ed25519Verify`)도 Node 네이티브 Ed25519(`crypto.generateKeyPairSync`/`crypto.
sign`)로 만든 실제 서명과 상호운용 검증 — 정상 서명 통과, 변조된 메시지 거부,
다른 공개키 거부, `sortedStringify` 키 순서 무관 정규화 전부 확인. **이 부분은
버그 없음.**

**신규 테스트**: `test/pb_hooks_sha256_utf8.test.mjs`(31개 — 5개 복사본 ×
6가지 케이스 + 복사본 개수 자체 검증), `test/pb_hooks_tx_signature.test.mjs`(5개).
두 파일 다 `pb_hooks/main.pb.js`에서 해당 함수를 **그 자리에서 직접 추출해서
실행**하는 방식이라(별도 유지·관리 사본이 아님) 원본이 바뀌면 테스트가 자동으로
최신 코드를 검증한다. 전체 재실행 52/52 통과(신규 기능 4종 테스트 전부 포함).



## 다음 세션 시작점 (R4 후보)

마스터플랜상 R1~R3 전 범위, 위임된 16개 K서비스 심화 테스트, 세션 중 신규 기능 4종
커버리지 점검까지 전부 소진됐다. 다음으로 고려할 만한 것:
1. security 저장소의 `K_SECURITY_PUBLIC_KEY_B64U` 플레이스홀더를 실제 키로 교체
   (사용자/K-Security 서버 관리자 영역)
2. `showRiskAnalysis()` 명령 라우팅 신설 여부(위 Phase 7 섹션 참고) — 원하면 진행
3. 라이브 환경 접근이 가능한 세션에서 I3-3, PART G 라이브 연동, PART I I-3(보안 회귀 나머지),
   Phase 7 실배포 후 수동 QA 착수

## Phase R3 — 중기(라이브 환경 접근 확보 후)

- PART G 전체(정부24 연계 — 외부 API 의존)
- D1-4, D1-5, D1-9(숫자코드 실물 렌더링·스캔·DB 유니크 제약)
- PART I-3 보안 회귀(라이브 공격 시나리오)
- jeju 현장 테스트 계획서(E-14)와의 통합

## Phase R4 — 지속(CI화)

- B4-1(build_manifest.py 자동 재생성-대조), I2-1(SP-00-ROUTER 매니페스트 키 근본 수정)을
  GitHub Actions에 편입해 매 push마다 자동 실행

---

# 4. 부록 — 전체 테스트 파일 인벤토리 (39개, gopang 기준)

| 파일 | Phase/모듈 | 이번 세션 실행 여부 |
|---|---|---|
| core/phase1_core.test.js | Phase 1(C-01~08) | 미실행 |
| pdv/phase2a_pdv.test.js | Phase 2A(P-01~08) | 미실행 |
| openhash/phase2b_openhash.test.js | Phase 2B(O-01~14) | **실행, 2건 수정 후 14/14** |
| pdv/phase2c_evidence.test.js | Phase 2C(E-01~06) | 미실행 |
| ai-secretary/phase3_ai_secretary.test.js | Phase 3(A-01~11) | 미실행 |
| domains/phase4_klaw.test.js | Phase 4(K-01~10) | 미실행 |
| network/phase5_network_gdc_privacy.test.js | Phase 5(N/G/P) | 미실행 |
| domains/phase6_khealth.test.js | Phase 6(H-01~10) | 미실행 |
| phase7_bootstrap.test.js | Phase 7(B-01~09) | 미실행 |
| network/phase9_push_broadcast.test.js | Phase 9(PB-01~04) | 미실행 |
| network/phase10_push_l1_priority.test.js | Phase 10 | 미실행 |
| integration/phase11_orchestration_registry_and_ksearch.test.mjs | Phase 11 | 미실행 |
| integration/phase12_gov_importance_scoring.test.mjs | Phase 12 | 미실행 |
| integration/phase13_ai_chat_handler.test.mjs | Phase 13 | 미실행 |
| integration/phase14_order_queue_handler.test.mjs | Phase 14 | 미실행 |
| integration/phase15_delivery_handler.test.mjs | Phase 15 | 미실행 |
| integration/phase16_pdv_extract.test.mjs | Phase 16 | 미실행 |
| integration/phase17_share_target.test.mjs | Phase 17 | 미실행 |
| integration/phase18_procedure_docs.test.mjs | Phase 18 | 미실행 |
| integration/phase19_welfare_eligibility.test.mjs | Phase 19 | 미실행 |
| integration/phase20_document_handoff.test.mjs | Phase 20 | 미실행 |
| integration/phase22_sp_author_automation.test.mjs | Phase 22 | 미실행 |
| integration/phase23_gwp_registry_scaling.test.mjs | Phase 23 | **미실행 — 직접 수정한 파일 관련, R1 최우선** |
| integration/phase24_web_search.test.mjs | Phase 24 | 미실행 |
| phase_anchor_integration.test.js | 별도(A-01~12) | 미실행 |
| router-category.test.mjs | 라우터 하네스 | 미실행 |
| sp-intercall.test.mjs | 오케스트레이션 하네스 | 미실행 |
| profile2.0/m01_auth.test.mjs | M01 | 미실행 |
| profile2.0/m02_register.test.mjs | M02(①과 직결) | 미실행 |
| profile2.0/m03_payment.test.mjs | M03 | 미실행 |
| profile2.0/m04_profile.test.mjs | M04 | 미실행 |
| profile2.0/m05_ai_assistant.test.mjs | M05 | 미실행 |
| profile2.0/m06_review.test.mjs | M06 | 미실행 |
| profile2.0/m07_location.test.mjs | M07 | 미실행 |
| profile2.0/m08_heatmap.test.mjs | M08 | 미실행 |
| profile2.0/m09_community.test.mjs | M09 | 미실행 |
| profile2.0/m10_ledger.test.mjs | M10 | 미실행 |
| profile2.0/m11_audit.test.mjs | M11 | 미실행 |
| profile2.0/m12_m13.test.mjs | M12+M13 | 미실행 |
| hondi-digit-code.roundtrip.test.mjs | ⑥(신규, 2026-07-17) | **실행, 13/13** |
| pdv-history-client.test.mjs | ④(신규, 2026-07-17) | **실행, 14/14** |

**39개 중 실행 완료 3개(8%), 미실행 36개(92%)** — 이것이 "간단히 끝났나"라는 질문에 대한
정량적 답이다. 이번 세션은 이 39개 중 극히 일부와, 그 바깥에 있던 정적 검증 도구
2개(`check_stale_refs.py`, `extract_gwp_registry.mjs`)를 돌렸을 뿐이다.

---

*(문서 끝 — 다음 세션은 위 "Phase R1" 7개 항목부터 순서대로 진행 권장)*
