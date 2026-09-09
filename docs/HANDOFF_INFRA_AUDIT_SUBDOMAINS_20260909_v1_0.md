# 인수인계서 — K-서비스 서브도메인 인프라 전수 점검 (2026-09-09)

**작성 목적**: 2026-09-09 세션에서 hondi.net 루트 도메인의 라우팅 문제를 고치던 중, 다른 K-서비스 서브도메인들도 같은 계열의 문제를 겪고 있을 가능성이 발견됐다. 이 문서는 다음 세션이 그 전수 점검을 처음부터 다시 조사하지 않고 바로 시작할 수 있도록, 지금까지 확인된 사실과 다음 단계를 정리한다.

**먼저 읽을 것**: `docs/SESSION_LESSONS_HONDI_SEARCH_ROUTING_DNS_20260909_v1_0.html` — 이번 세션에서 겪은 진단법·git 사고 패턴·인프라 함정을 전부 정리해뒀다. 특히 "③ 코드/인프라 문제 3초 진단법"과 "② Route가 있어도 DNS가 안 뚫려있으면 소용없다"는 이 작업 내내 계속 쓰게 된다.

---

## 1. 배경 — hondi.net에서 무슨 일이 있었나 (요약)

`hondi.net`(루트 도메인)에 새 API 경로(`/hondi-search`)를 추가했는데 계속 404/405만 났다. 원인을 역순으로 나열하면:

1. `wrangler.toml`에 Workers Route 설정이 아예 없었다 → 코드로 추가·배포
2. `hondi.net`(apex) DNS 레코드가 **"DNS only"**(회색 구름)였다 → Proxied(주황)로 전환
3. 그제서야 `Server: cloudflare`, `CF-RAY` 헤더가 찍히기 시작 — 라우팅 완전 해결

이 과정에서 다른 서브도메인들의 DNS 상태를 확인하다가, `hondi.net` 외의 **거의 모든 서브도메인이 DNS only 상태**라는 게 눈에 띄었다 (Cloudflare DNS Records 화면에 51개 레코드 중 `hondi.net` 본인 하나만 Proxied, 나머지는 전부 회색 + 경고 삼각형 아이콘).

## 2. 지금까지 확인된 것 — 9개 K-서비스 서브도메인 1차 스크리닝

`curl`/`Invoke-WebRequest`로 헤더만 빠르게 확인한 결과다 (본문 내용이나 실제 기능은 아직 안 봤다):

| 그룹 | 서브도메인 | 증상 | 원인 추정 | 확신도 |
|---|---|---|---|---|
| A | `klaw`, `mail`, `plan`, `telecom`, `city` | `Server: GitHub.com`, `CF-RAY` 없음 | hondi.net과 동일 — Route 미등록 또는 DNS only | 높음 (hondi.net과 재현 패턴 동일) |
| B | `search`, `biz`, `watch`, `job` | PowerShell에서 `curl.exe -v` 시 `SEC_E_WRONG_PRINCIPAL`(SNI/인증서 이름 불일치) | GitHub Pages Custom Domain 자체가 미등록/미검증 — 그룹 A보다 근본적 | 중간 (SSL 계층 에러라는 것만 확인, 정확한 원인은 GitHub 저장소 Pages 설정을 봐야 확정) |

**아직 확인 안 한 것**: DNS Records 화면에 있던 나머지 약 40개 서브도메인(`911`, `bank`, `biz`, `democracy`, `estate`, `gdc`, `health`, `insurance`, `jeju`, `jit`, `logistics`, `openhash`, `police`, `public`, `qna`, `school`, `security`, `social`, `stock`, `tax`, `traffic`, `users`, `verify`, `www` 등). 이 중 상당수는 순수 정적 안내 페이지일 가능성이 높아 손댈 필요가 없을 수도 있다 — **모든 서브도메인이 문제인 것도, 모든 서브도메인을 고쳐야 하는 것도 아니다.** 실제로 동적 기능(로그인·API·과금)이 있는지부터 구분하는 게 이 작업의 핵심이다.

## 3. 작업 순서 제안

### 3-1. 범위 확정 — 어떤 서브도메인에 실제 동적 기능이 있는가

무작정 51개를 다 점검하지 말고, 먼저 어떤 서브도메인이 "정적 안내 페이지"이고 어떤 게 "로그인·API·과금이 실제로 필요한 서비스"인지부터 나눈다.

- `desktop.html`의 MEGA_MENU_SECTIONS(서비스 섹션)에 있는 K-서비스 목록이 출발점이다: K-Law, K-Plan, K-Mail, K-Telecom, K-Search, K-Biz, K-Watch, K-Job, K-City, K-Democracy 등.
- 각 서비스의 실제 백엔드가 이 저장소(`Openhash-Gopang/hondi`)의 `hondi-proxy` Worker인지, 아니면 별도 저장소(`Openhash-Gopang/mail`처럼)의 별도 Worker인지부터 확인한다 — 저장소가 다르면 wrangler.toml도 다르고 점검 대상도 다르다.
- `docs/` 폴더의 관련 SESSION_SUMMARY/HANDOFF 문서(K-Mail, K-Plan, K-Law 관련해서 여러 개 있음)를 먼저 훑으면 각 서비스가 실제로 어떤 동적 기능을 갖고 있는지 빠르게 파악된다.

### 3-2. 그룹 A(klaw/mail/plan/telecom/city) — Route/DNS 점검

hondi.net에서 썼던 것과 완전히 같은 절차:

1. 해당 서브도메인이 어느 Cloudflare Worker에 연결되어야 하는지 확인 (자체 저장소의 wrangler.toml, 또는 대시보드에서 직접 확인)
2. DNS Records에서 그 서브도메인 레코드의 Proxy 상태 확인 → DNS only면 Proxied로 전환
3. 그 Worker의 Workers Routes에 해당 서브도메인/경로가 등록돼 있는지 확인 → 없으면 추가 (와일드카드 `*.hondi.net/*`은 쓰지 말 것 — hondi.net 때와 같은 이유로, 다른 정적 콘텐츠까지 가로챌 위험)
4. `curl -i https://서브도메인.hondi.net/실제경로`로 `Server: cloudflare` 확인

**주의**: 서브도메인 하나마다 이 절차를 반복하기 전에, 정말 그 서브도메인에 Worker가 필요한지부터 확인할 것 — 어떤 서비스는 순수 SPA 프런트엔드만 GitHub Pages에 있고, API 호출은 다른 도메인(예: `hondi-proxy.tensor-city.workers.dev` 직접 호출, 또는 hondi.net 경유)으로 나가는 구조일 수도 있다. 그런 경우라면 그 서브도메인 자체는 Proxied로 안 바꿔도 무방하다.

### 3-3. 그룹 B(search/biz/watch/job) — GitHub Pages Custom Domain 점검

이건 Route/DNS 문제가 아니라 한 단계 더 근본적인 문제로 보인다. `SEC_E_WRONG_PRINCIPAL`은 보통:

- 그 도메인용 인증서가 origin(GitHub Pages)에서 발급되지 않았거나
- GitHub Pages 저장소의 Settings → Pages → Custom domain에 그 서브도메인이 등록/검증되지 않았을 때

발생한다. 확인 순서:

1. 각 서브도메인이 어느 GitHub 저장소의 Pages로 서빙되어야 하는지 확인 (DNS 레코드의 CNAME 대상은 전부 `openhash-gopang.github.io`로 찍혀 있었다 — 즉 조직 페이지 하나로 몰려있는 구조일 가능성. 저장소별로 나뉜 것인지 재확인 필요)
2. 해당 저장소 GitHub Settings → Pages에서 Custom domain 필드에 그 서브도메인이 실제로 등록·"DNS check successful" 상태인지 확인
3. 미등록이면 등록 후 재확인. 등록해도 안 되면 CNAME 파일(저장소 루트의 `CNAME`)이 올바른 값을 갖고 있는지도 확인

### 3-4. 나머지 ~40개 서브도메인 — 저위험 우선순위

정적 안내 페이지로 보이는 것들은 급하지 않다. 시간이 있을 때 `curl -sI`로 일괄 스크리닝해서(이번 세션에서 쓴 PowerShell foreach 패턴 재사용 가능) `Server: GitHub.com`이 아닌 이상한 응답이 나오는 것만 골라내는 정도로 충분할 수 있다.

## 4. 참고 — 이번 세션에서 쓴 진단 명령어 모음

```powershell
# 여러 서브도메인 일괄 헤더 확인
foreach ($sub in @("klaw","mail","plan")) {
  Write-Host "=== $sub.hondi.net ===" -ForegroundColor Cyan
  try {
    $r = Invoke-WebRequest -Uri "https://$sub.hondi.net" -Method Head -UseBasicParsing -ErrorAction Stop
    $r.Headers["Server"]; $r.Headers["CF-RAY"]
  } catch { $_.Exception.Response.Headers["Server"] }
}

# SSL 레벨 에러까지 보고 싶을 때
curl.exe -v "https://서브도메인.hondi.net" 2>&1 | Select-String "SSL|certificate|Connected|HTTP/"
```

## 5. 이 작업의 범위가 아닌 것

- 혼디 검색(Hondi Search) 기능 자체 — 완료됨, `docs/design/HONDI_SEARCH_DESIGN.md` 참고
- 각 K-서비스의 실제 비즈니스 로직 버그 — 이건 라우팅이 뚫린 *다음*에 각 서비스 담당 세션에서 볼 문제
