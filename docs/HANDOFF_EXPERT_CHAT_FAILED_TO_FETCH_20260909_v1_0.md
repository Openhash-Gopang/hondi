# 인수인계서 — expert-chat.html "Failed to fetch" 버그 (2026-09-09)

**작성 목적**: 혼디 검색(Hondi Search) 세션 도중 우연히 발견한, `expert-chat.html`
자체의 기존 버그. 혼디 검색과는 무관하며 별도 세션에서 이어서 조사한다.

**먼저 읽을 것**: `docs/SESSION_LESSONS_HONDI_SEARCH_ROUTING_DNS_20260909_v1_0.html`
— 오늘 세션에서 겪은 진단법(코드 vs 인프라 구분법, git 사고 패턴 등)이 여기서도
그대로 적용될 가능성이 높다.

---

## 1. 증상

`https://hondi.net/pages/expert-chat.html?persona=physician-internal-medicine`
(다른 페르소나 id도 동일 증상으로 추정, 미확인) 접속 시:

- 페이지 자체는 정상 로드됨 (제목바 "자격직 전문가 페르소나 · 최종 법적/의료적
  행위는 인간 전속" 정상 표시)
- 첫 인사말/응답 생성 시도 시 다음 에러 표시:
  > ⚠ 응답 중 오류가 발생했습니다: Failed to fetch. 잠시 후 다시 시도해 주세요.
- 비로그인 상태에서 재현됨(로그인 상태는 미확인)

**"Failed to fetch"는 일반 HTTP 에러 응답(4xx/5xx)이 아니라, 브라우저가
네트워크 요청 자체를 완료하지 못했을 때(CORS 프리플라이트 실패, 연결 거부,
DNS 실패 등) 뜨는 `fetch()`의 TypeError**라는 점이 중요하다 — 서버가 뭔가
응답은 했지만 내용이 이상한 경우와는 다른 종류의 실패다.

## 2. 재현 경로 (혼디 검색과는 무관 — 우연히 발견됨)

1. `hondi.net/desktop.html`의 혼디 검색(4버튼 아래 검색창)에 "내과 의사" 입력
2. **혼디 검색은 정상 동작** — `expert-chat.html?persona=physician-internal-medicine`로
   정확히 새 탭 이동됨 (이 부분은 오늘 세션에서 만들고 검증 완료된 기능,
   `docs/design/HONDI_SEARCH_DESIGN.md` 참고)
3. 이동된 그 페이지 자체가 응답 생성 단계에서 위 에러로 깨짐

즉 **버그는 3번, expert-chat.html 내부에 있다.** 혼디 검색 없이 이 URL을
직접 열어도 똑같이 재현될 것으로 추정된다(미확인 — 다음 세션에서 먼저 확인할 것).

## 3. 코드 조사 결과 (이번 세션에서 확인 완료)

### 3-1. 호출 체인

`expert-chat.html`의 `callExpertAI()` (pages/expert-chat.html:355 부근)가
페이지 로드 시 자동으로 인사말을 생성하려고 `RELAY_ENDPOINT`
(`https://hondi-proxy.tensor-city.workers.dev`, worker.js와 동일 Worker의
workers.dev 기본 도메인)에 직접 POST 요청을 보낸다. 후보 provider에 따라
`/chat/completions`, `/deepseek`, 또는 `/llm/relay` 중 하나를 호출한다
(`_buildCandidates()` 참고 — 어떤 provider가 선택되는지는 미확인, 다음 단계에서
콘솔 로그로 확인 필요).

### 3-2. 확인해서 배제한 것들

다음은 전부 정상이라 원인이 **아님**을 확인했다:

- **라우트 존재 여부**: `/deepseek`(worker.js:13150), `/llm/relay`(worker.js:13151)
  둘 다 실제로 등록돼 있음.
- **workers.dev는 hondi.net의 Route/DNS 설정과 무관**: `hondi-proxy.tensor-city.workers.dev`는
  Cloudflare Worker의 기본 도메인이라 항상 직접 연결된다 — 오늘 세션 내내 다뤘던
  "hondi.net 도메인에 Route가 없어서 GitHub Pages로 새는" 문제와는 다른 계열이다.
- **CORS 오리진 화이트리스트**: `ALLOWED_ORIGINS`(worker.js:56)에
  `'https://hondi.net'`이 명시적으로 포함되어 있음 — 오리진 차단이 원인이 아니다.
- **전역 OPTIONS 프리플라이트 처리**: worker.js:12308에 존재함.

### 3-3. 아직 확인 못 한 것 — 다음 세션이 여기부터

- **AI 프록시 경로 추가 방어 로직**(worker.js:13140 부근, `isAiProxyPath && !corsOrigin`
  체크)이 이 요청을 막고 있을 가능성. `corsOrigin === ''`(Origin 헤더 자체가
  없는 요청)만 걸러내는 로직이라 브라우저에서 보내는 정상 요청은 안 걸릴
  것으로 보이지만, 실제로 그런지는 브라우저 네트워크 탭에서 직접 확인
  안 했다.
- **실제 네트워크 탭 확인 전무** — 지금까지는 코드만 읽었지, 브라우저
  개발자도구(F12 → Network 탭)로 실패한 요청의 상태 코드/에러 메시지를
  직접 본 적이 없다. **다음 세션 1순위 작업**은 이것이다:
  1. `expert-chat.html?persona=physician-internal-medicine` 접속
  2. F12 → Network 탭 열고 재현
  3. 실패한 요청을 찾아 Status(빨간 글씨로 "(failed)" 등), 실제 호출된
     URL(`/deepseek`인지 `/llm/relay`인지 `/chat/completions`인지),
     Console 탭의 정확한 에러 메시지를 확인
  4. `_buildCandidates()`가 정확히 어떤 provider/baseUrl을 반환하는지
     (하드코딩된 다른 baseUrl을 쓰고 있어서 workers.dev가 아닌 엉뚱한
     곳을 두드리고 있을 가능성도 배제 안 됨 — 코드까지는 확인 안 했다)
  5. `wrangler tail`로 실시간 로그를 보면서 재현 — 요청이 Worker에 아예
     도달하는지(CORS 프리플라이트에서 브라우저가 막았다면 Worker 로그에
     아무것도 안 찍힐 것이다) 확인. 오늘 세션에서 이 방법으로 다른 버그도
     찾았다(`wrangler tail` 사용법은 위 SESSION_LESSONS 문서에 없지만
     이번 대화 내역 참고).

## 4. 작업 시 주의할 것

- 오늘 세션 내내 반복된 사고 패턴(`git checkout -b` 실패 시 조용히 이전
  브랜치에 남는 문제, "머지됨"과 "배포됨"은 다른 사실이라는 것 등)이 여기서도
  똑같이 반복될 수 있다 — SESSION_LESSONS 문서의 체크리스트를 먼저 습관화할 것.
- `expert-chat.html`은 관리자용이 아니라 **실사용자가 실제로 요금(GDC)을
  내고 쓰는 페이지**다(`_ensureExpertPersonaAccess()`, 월 9,900원 구독 로직
  확인됨) — 수정 시 이 과금 로직을 건드리지 않도록 주의.
- 페르소나가 552개이므로, 이 버그가 `physician-internal-medicine` 하나만의
  문제인지 전체 공통 문제인지도 확인 필요 (십중팔구 전체 공통일 것 — 개별
  페르소나 설정이 아니라 `callExpertAI()` 공용 함수의 문제로 보인다).

## 5. 관련 문서

- `docs/design/HONDI_SEARCH_DESIGN.md` — 혼디 검색이 이 페이지로 어떻게
  라우팅하는지(정상 동작 확인됨)
- `docs/SESSION_LESSONS_HONDI_SEARCH_ROUTING_DNS_20260909_v1_0.html` — 오늘
  세션 전체의 진단법/git 사고 교훈
- `docs/HANDOFF_INFRA_AUDIT_SUBDOMAINS_20260909_v1_0.md` — 오늘 같이 발견된
  또 다른 미해결 이슈(서브도메인 DNS/Route 전수 점검) — 이것과는 별개 작업이다
