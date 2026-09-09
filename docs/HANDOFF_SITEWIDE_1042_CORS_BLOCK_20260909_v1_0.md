# 인수인계서 — 사이트 전역 API 호출이 Cloudflare Error 1042로 차단됨 (2026-09-09)

**심각도: 높음.** 오늘 발견된 것 중 가장 파급 범위가 큰 문제다. 채팅뿐 아니라
지갑·인증·결제·위치 등 사이트 핵심 기능 대부분이 지금 이 문제의 영향권에 있을
가능성이 높다. **혼디 검색(Hondi Search) 기능 범위를 완전히 벗어나며, 별도
세션에서 신중하게(서두르지 말고) 다뤄야 한다.**

**먼저 읽을 것**:
- `docs/SESSION_LESSONS_HONDI_SEARCH_ROUTING_DNS_20260909_v1_0.html` — 오늘 세션
  진단법 전반
- `docs/HANDOFF_EXPERT_CHAT_FAILED_TO_FETCH_20260909_v1_0.md` — 이 문제의 첫
  증상(expert-chat.html)을 다뤘던 이전 인수인계서. **이 문서가 원인을 설명한다** —
  거기서 "원인 미확정"으로 남겨뒀던 것의 답이 여기 있다.

---

## 1. 증상

`hondi.net/desktop.html` 우측 하단 채팅 아이콘(`webapp.html`)을 열고 메시지를
보내면 응답이 전부 "Failed to fetch"로 실패한다. 브라우저 콘솔을 열어보면
채팅뿐 아니라 **거의 모든 API 호출이 동시에 실패**하고 있다:

```
Access to fetch at 'https://hondi-proxy.tensor-city.workers.dev/deepseek'
from origin 'https://hondi.net' has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

같은 패턴으로 실패하는 경로들(콘솔에서 실제로 관측됨):
`/deepseek`, `/auth/issue`, `/wallet/x25519`, `/biz/balance`, `/biz/claims`,
`/pdv/relay/pull`, `/account/step-up-threshold`, `/account/protective-setting`,
`/profile`, `/geocode`, `/openhash/anchor` 등. **거의 전부**다.

## 2. 근본 원인 (실사로 확인 완료)

CORS 에러 메시지만 보면 "Access-Control-Allow-Origin 헤더가 없다"로 보이지만,
실제로는 그보다 한 단계 앞에서 막히고 있었다. 브라우저의 CORS 강제를 우회해서
`curl`로 직접 응답을 받아보면:

```powershell
curl.exe -i -X OPTIONS "https://hondi-proxy.tensor-city.workers.dev/auth/issue" `
  -H "Origin: https://hondi.net" -H "Access-Control-Request-Method: POST"
```

```
HTTP/1.1 404 Not Found
Server: cloudflare
CF-RAY: a3849d42ced584f1-HKG
error code: 1042
```

**`error code: 1042`는 우리 Worker 코드가 반환한 응답이 아니라, Cloudflare
엣지 자체가 요청을 차단했다는 신호다** (`worker.js`의 어떤 핸들러도 저런
plain-text 응답을 만들지 않는다 — 우리 코드는 항상 JSON + corsHeaders를
반환한다). 즉 요청이 Worker 코드에 도달하기도 전에 막혔다.

### 결정적 실험

같은 URL을 **Origin 헤더 없이** 호출하면 정상 응답이 온다:

```powershell
# Origin 헤더 있음 → 1042 차단 (심지어 오늘 만든 /hondi-search 자기 자신도!)
curl.exe -i "https://hondi-proxy.tensor-city.workers.dev/hondi-search" -H "Origin: https://hondi.net"
# → error code: 1042

# Origin 헤더 없음 → 정상 통과
curl.exe -i "https://hondi-proxy.tensor-city.workers.dev/hondi-search"
# → 정상 JSON 응답 (405 Method Not Allowed 등 우리 코드가 만든 응답)
```

**즉 `Origin: https://hondi.net` 헤더가 있느냐 없느냐가 1042 차단의 결정적
변수다.** 브라우저는 same-origin이 아닌 모든 fetch에 Origin 헤더를 자동으로
붙이므로, `webapp.html`(hondi.net에서 로드됨)이 workers.dev를 호출하는 모든
요청이 이 조건에 걸린다.

### 의심되는 메커니즘

Cloudflare Error 1042는 공식적으로 "같은 계정의 Worker가 같은 zone의 다른
Worker(또는 자기 자신)를 호출하는 것을 막는" 보안 정책으로 문서화되어 있다.
정확한 트리거 조건은 이번 조사에서 100% 확정하지 못했지만, 강하게 의심되는
시나리오는 다음과 같다:

> **`hondi.net` zone에 이 Worker(`hondi-proxy`)로 가는 Workers Route가 하나라도
> 존재하면, Cloudflare가 "이 zone은 이 Worker와 연결되어 있다"고 인식하고,
> 그 zone을 Origin으로 주장하며 같은 Worker의 **workers.dev** 주소를 직접
> 두드리는 요청을 차단한다** — zone 레벨 보호(WAF 등)를 workers.dev 백도어로
> 우회하는 걸 막기 위한 설계로 추정.

이게 사실이라면, **오늘 이 세션에서 `hondi.net/hondi-search` Route를 처음
추가한 것(`HANDOFF_INFRA_AUDIT_SUBDOMAINS` 작업)이 이 문제를 유발했을
가능성**이 있다 — 그 전까지 `hondi.net`에는 이 Worker로 가는 Route가 단
하나도 없었다(오늘 아침 실사로 확인: Cloudflare 대시보드 Overview가 "No
Workers connected" 상태였음).

**다만 확정은 아니다** — 이 대화의 아주 처음(오늘 세션 시작 시점)에 이미
`webapp.html`이 "Failed to fetch"로 깨져 있는 스크린샷이 있었다. 그때는 아직
Route를 추가하기 전이었을 수도, 이미 추가한 후였을 수도 있어서(정확한 타임라인
재구성 안 됨) 원래부터 있던 문제인지 오늘 유발한 문제인지 단정할 수 없다.
**다음 세션에서 반드시 이것부터 확정할 것** — 아래 3-1 참고.

## 3. 다음 세션이 할 일

### 3-1. 타임라인/인과관계 확정 (가장 먼저)

- Cloudflare 대시보드에서 `hondi-proxy` Worker의 배포 히스토리와 Route 추가
  시점을 대조해서, 1042 문제가 Route 추가 **전**에도 있었는지 확인
- 안 된다면(로그가 없다면), 테스트용 Worker를 하나 새로 만들어서 "Route
  없음 → workers.dev Origin=hondi.net으로 호출 성공" → "Route 추가 → 같은
  호출이 1042로 실패"가 실제로 재현되는지 직접 실험해서 인과관계를 확정한다.

### 3-2. 영향받는 파일 전수 조사

`hondi-proxy.tensor-city.workers.dev`를 직접 참조하는 파일이 저장소에
**최소 50개** 있다(`grep -rl "hondi-proxy.tensor-city.workers.dev"` 결과):

```
receive-payment.html, profile.html, feedback.html, admin/seller-verify.html,
src/gopang/ai/call-ai.js, src/gopang/ui/welcome.js, src/gopang/services/push.js,
src/gopang/gdc/tax-execution.js, src/gopang/gdc/financial-statements.js,
src/gopang/gwp/gwp-report-client.js, src/gopang/pdv/usage-summary.js,
src/gopang/gov/gov-router.js, src/gopang/core/state.js, src/gopang/core/config.js,
auth/qr-login.html, auth/device-link-approve.html, auth/k-service-auth-client.js,
auth/silent-auth.html, auth/gopang-sso.js, auth/device-link.html,
desktop.html, sw.js, profiles/2537012854.html, assets/chat-widget.js,
pay-code.html, report/gopang-report.js, worker.js,
domains/medical.html, domains/logistics.html, domains/social.html,
webapp.html, personas/law.html, consent.html, usage.html, community.html,
pdv-history-client.js, gopang-wallet.js, register-profile.html,
pages/prompt-editor.html, pages/dashboard.html, pages/expert-chat.html,
pages/profile-assistant.html, pages/regional-gov.html, pages/sp-editor.html,
citizen-report.html, schedule.html
(+ 문서/테스트 파일 일부 — 실제 런타임 영향 없음)
```

**다행히 완전히 흩어져 있지는 않다** — 대부분은 `src/gopang/core/config.js`의
공용 상수(`endpoint`, `_PROXY_URL`)를 참조하는 것으로 보인다(2곳만 개별
`const RELAY_ENDPOINT`를 자체 선언 — `pages/expert-chat.html`,
`pages/profile-assistant.html`). 즉 고칠 때 50개 파일을 다 헤집기보다,
**공용 config 경유 여부부터 먼저 지도를 그리면** 실제 개별 수정이 필요한
지점이 훨씬 줄어들 수 있다.

### 3-3. 고칠 방향 후보 (장단점, 결정은 다음 세션에서)

| 방향 | 내용 | 장점 | 단점 |
|---|---|---|---|
| A. zone 경유로 전환 | 모든 API 경로를 `hondi.net` 상대경로로 바꾸고, 필요한 만큼 Workers Route를 추가 | 근본적 해결, CDN/캐시 등 zone 레벨 이점도 챙김 | 50개 파일 감사 필요, 수십 개 Route 추가 필요, 회귀 위험 큼 |
| B. Route 제거 | 오늘 추가한 `hondi.net/hondi-search` Route를 되돌림 | 즉시 원상복구(추정) | 혼디 검색 기능이 다시 깨짐 — 트레이드오프 |
| C. Cloudflare 설정으로 우회 | `global_fetch_strictly_public` 같은 Cloudflare Workers 런타임 플래그로 이 제약을 완화할 수 있는지 조사 | 코드 안 건드림 | 이번 세션에서 실제로 이 옵션이 우리 상황(zone Origin 매칭)에 적용되는지 확인 못 함 — 조사 필요 |

**권장**: 3-1로 인과관계부터 확정한 뒤, B(Route 제거)로 우선 사이트를
정상화하고, A는 별도의 충분히 큰 세션으로 계획해서 진행. 지금 당장 A를
시도하는 건 위험도 대비 소득이 낮다.

### 3-4. 재현/검증용 명령어

```powershell
# 1042 재현 (Origin 있음 → 차단)
curl.exe -i "https://hondi-proxy.tensor-city.workers.dev/<임의경로>" -H "Origin: https://hondi.net"

# 정상 통과 (Origin 없음)
curl.exe -i "https://hondi-proxy.tensor-city.workers.dev/<임의경로>"
```

## 4. 관련 문서

- `docs/HANDOFF_EXPERT_CHAT_FAILED_TO_FETCH_20260909_v1_0.md` — 이 문제의 첫
  증상. "원인 미확정"이었던 부분이 이 문서로 해소됨.
- `docs/SESSION_LESSONS_HONDI_SEARCH_ROUTING_DNS_20260909_v1_0.html` — 오늘
  세션 전체의 다른 교훈들(git 사고, DNS/Route 구분법 등)
- `docs/HANDOFF_INFRA_AUDIT_SUBDOMAINS_20260909_v1_0.md` — 오늘 hondi.net에
  Route를 처음 추가하게 된 배경 작업
