# 인수인계서 — 혼디 검색(Hondi Search)이 전용 Worker/저장소로 이관됨 (2026-09-09)

**작성 목적**: `docs/HANDOFF_SITEWIDE_1042_RESOLVED_HONDI_SEARCH_PENDING_20260909_v1_0.md`에서
대기 중이던 "A안(zone 경유로 전환)"을 대신해, 이 세션에서 더 근본적인
D안(전용 Worker 분리)을 실증 검증하고 실제로 적용까지 완료했다. 이 문서는
그 결과와, **이 저장소(`Openhash-Gopang/hondi`)의 `wrangler.toml`을 다시
건드릴 때 반드시 지켜야 할 것**을 정리한다.

**먼저 읽을 것**:
- `docs/HANDOFF_SITEWIDE_1042_CORS_BLOCK_20260909_v1_0.md` — 1042 문제 원인
- `docs/HANDOFF_SITEWIDE_1042_RESOLVED_HONDI_SEARCH_PENDING_20260909_v1_0.md` — B안(Route 제거)으로 임시 정상화한 직전 상태

---

## 1. 결론 요약

- **혼디 검색(`/hondi-search`) 백엔드는 더 이상 이 저장소(`hondi-proxy`
  Worker, `worker.js`)에서 서빙되지 않는다.**
- 완전히 별도인 전용 Worker **`hondi-search-relay`**로 이관했고, 그 코드는
  새 저장소 **`Openhash-Gopang/hondi-search-relay`**에 있다.
- 이 저장소의 `src/routes/hondi-search-worker.js`는 **참고용으로만
  남겨뒀다** — 실제로 트래픽을 처리하지 않는다. 수정해도 라이브 동작에
  영향이 없다(반대로, 진짜 수정이 필요하면 `hondi-search-relay` 저장소
  쪽 사본을 고쳐야 한다 — 두 사본이 갈라지지 않도록 주의).
- 이 저장소 `wrangler.toml`의 `hondi.net/hondi-search` Route는 **계속
  주석 처리된 상태로 둘 것.** 이 Route를 다시 켜면 §2의 사고가 그대로
  재발한다.

## 2. 왜 이렇게 됐는가 (배경)

`hondi.net` zone에 `hondi-proxy` Worker로 가는 Route(`hondi.net/hondi-search`)가
존재하는 것 자체가, `Origin: https://hondi.net` 헤더가 붙은 모든 요청을
`hondi-proxy.tensor-city.workers.dev`(workers.dev 직접 주소)에서
Cloudflare Error 1042로 차단시키는 원인이었다(상세: 위 두 HANDOFF 문서).
`hondi-proxy.tensor-city.workers.dev`를 직접 참조하는 파일이 이 저장소에
최소 50개 있어서(`desktop.html`, `webapp.html`, `auth/*`,
`pages/expert-chat.html` 등), 혼디 검색 하나 살리자고 그 50개 전부를
고칠 수는 없었다.

## 3. 실증 검증 — D안(전용 Worker 분리)

**가설**: Cloudflare Error 1042는 "그 zone에 Route를 가진 바로 그
Worker"의 workers.dev 직접 호출만 막고, 같은 zone의 **다른** Worker에는
영향을 주지 않는다. 이게 맞다면, `hondi-search`를 `hondi-proxy`와 별개의
Worker로 분리하고 그 별개 Worker에만 Route를 주면, `hondi-proxy`(및 그걸
참조하는 50개 파일)는 전혀 영향받지 않는다.

**검증 방법**: `hondi-proxy`와 완전히 무관한 1회성 테스트 Worker
(`test-route-probe`, 순수 "hello world" 핸들러)를 만들어 `hondi.net/probe-test`
Route를 부여한 뒤, 그 상태에서 `hondi-proxy.tensor-city.workers.dev`를
`Origin: https://hondi.net` 헤더로 호출:

```powershell
curl.exe -i "https://hondi-proxy.tensor-city.workers.dev/deepseek" -H "Origin: https://hondi.net"
# → HTTP/1.1 405 Method Not Allowed (1042 아님, 정상 JSON 응답)
```

**1042가 재발하지 않음을 확인** — 가설 확정. 이후 실제
`hondi-search-relay` Worker를 배포하고 같은 검증을 반복해 재확인했다
(§4).

## 4. 실제 이관 — `hondi-search-relay`

새 저장소/Worker 구성:

```
Openhash-Gopang/hondi-search-relay/
  wrangler.toml          — name: hondi-search-relay, route: hondi.net/hondi-search,
                            KV: HONDI_SEARCH_HISTORY(이 저장소와 동일 네임스페이스 재사용)
  src/index.js            — CORS/라우팅 래퍼(이 저장소 worker.js의
                            getCorsOrigin/buildCorsHeaders/_err와 동일 계약)
  src/hondi-search-worker.js — 이 저장소의 원본을 그대로 복사(로직 무수정)
  src/deepseek-client.js  — 이 저장소의 원본을 그대로 복사(유일한 외부
                            의존성, api.deepseek.com 직접 호출 — hondi-proxy를
                            전혀 경유하지 않으므로 분리가 가능했다)
```

시크릿(`DEEPSEEK_API_KEY`)은 Worker 간에 공유되지 않으므로, `hondi-proxy`와
동일한 값을 `hondi-search-relay`에도 별도로 `wrangler secret put`했다.

**라이브 검증 완료**(2026-09-09):
```powershell
curl.exe -i "https://hondi.net/hondi-search" -X POST -H "Content-Type: application/json" --data-binary "@test-body.json"
# → HTTP/1.1 200, {"type":"navigate","url":"/pages/sp-editor.html?...SP_physician-internal-medicine...", ...}

curl.exe -i "https://hondi-proxy.tensor-city.workers.dev/deepseek" -H "Origin: https://hondi.net"
# → HTTP/1.1 405 (1042 없음 — 사이트 전역 정상)
```

혼디 검색 기능도 정상 동작하고, 나머지 50개 파일의 라우팅도 전혀
영향받지 않음을 둘 다 실제 배포 상태에서 확인했다.

## 5. 앞으로 지킬 것

- **이 저장소 `wrangler.toml`의 `hondi.net/hondi-search` Route를 다시
  켜지 말 것.** 필요가 생기면(예: 성능, 통합 등의 이유) 반드시 이 문서와
  §3의 실증 결과를 먼저 재검토하고, 별도 세션으로 신중하게 진행한다.
- 혼디 검색 로직을 고쳐야 하면 `Openhash-Gopang/hondi-search-relay`
  저장소를 고친다. 이 저장소의 `src/routes/hondi-search-worker.js`는
  실제 서빙과 무관한 참고용 사본이므로, 여기만 고치고 배포를 잊으면
  "고쳤는데 반영이 안 된다"는 혼선이 생긴다.
- `wrangler deploy`를 Windows에서 실행할 때는 `C:\Users\<사용자>\...`
  프로필 트리 바깥(예: `C:\temp\...`)에서 실행할 것 — 프로필 안에서
  실행하면 `Application Data` junction 권한 문제로 매번 실패한다(이 PC
  에서 실증 확인됨, 근본 원인 미상 — Windows 기본 보안 설정이지 이
  저장소나 계정 설정 문제가 아니다).

## 6. 관련 문서

- `docs/HANDOFF_SITEWIDE_1042_CORS_BLOCK_20260909_v1_0.md`
- `docs/HANDOFF_SITEWIDE_1042_RESOLVED_HONDI_SEARCH_PENDING_20260909_v1_0.md`
- `docs/HANDOFF_EXPERT_CHAT_FAILED_TO_FETCH_20260909_v1_0.md` — 별개 미해결 이슈(관련 없음)
- `docs/HANDOFF_INFRA_AUDIT_SUBDOMAINS_20260909_v1_0.md` — 별개 미해결 이슈(관련 없음)
- `Openhash-Gopang/hondi-search-relay` 저장소 — 실제 혼디 검색 백엔드
