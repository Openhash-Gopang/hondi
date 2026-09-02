# K-Mail↔K-Plan 파이프라인 라이브 테스트 — 사고 5건 기록 (2026-09-02)

K-Plan v1.1(K-Recompose 신설) → K-Mail↔K-Plan 데이터 파이프라인 → 관리자
시딩 기반 라이브 스모크테스트를 실제로 성공시키기까지, 서로 다른 층위의
사고 5건을 순서대로 만났습니다. 하나하나는 사소해 보여도 합쳐서 GitHub
Actions 로그인 실패만 4~5차례 반복시켰습니다 — 그래서 "주의" 항목으로
상시 노출합니다.

---

## 1. PowerShell 파이프의 개행 문제 — 세 번째(이상) 재발

`docs/L1_ADMIN_AUTH_INCIDENT_2026_07_21.md`에 이미 문서화되고 좌측 메뉴에
상시 노출까지 해둔 바로 그 버그가, **이번엔 `wrangler secret put`이 아니라
`gh secret set`에서 똑같이 재현**됐습니다.

```powershell
# 이렇게 하면 값 끝에 개행이 붙습니다(길이가 항상 +1로 나옴)
Get-Content -Raw file.txt | gh secret set SECRET_NAME --repo ...
```

`HONDI_ADMIN_PASSWORD`(원본 9자 `hondi2026`)가 실제로는 10자로 등록돼
로그인이 계속 `INVALID_CREDENTIALS`로 실패했습니다. 로컬 파일 왕복 비교
(`Get-Content -Raw` 결과와 원본 문자열 `-eq` 비교)로는 **이 문제가 안
잡힙니다** — 개행은 파이프로 넘어가는 그 순간에 붙지, 파일 자체에는 없기
때문입니다. 반드시 **전달 대상 프로그램이 실제로 받은 값**을 별도로
검증해야 합니다(§4 참고).

**교훈**: 문서화·메뉴 노출까지 해둔 규칙도 다른 CLI 도구로 옮겨가면
다시 잊혀집니다. `gh secret set`도 이 문서의 "절대 이렇게 하지 말 것"
목록에 추가합니다 — `wrangler secret put`과 완전히 동일한 증상.

## 2. GitHub Actions secrets ≠ Cloudflare Worker secrets

이번 세션에서 가장 시간을 많이 잡아먹은 오해입니다. 두 저장소는
**이름이 같아도 완전히 별개**입니다:

| | 어디서 읽는가 | 예시 |
|---|---|---|
| GitHub Actions secrets | 워크플로우 YAML의 `${{ secrets.X }}` | `DEEPSEEK_API_KEY`(스모크테스트용), `HONDI_ADMIN_*`, `CLOUDFLARE_*` |
| Cloudflare Worker secrets | 배포된 worker.js 코드 안의 `env.X` | `L1_ADMIN_EMAIL`, `L1_ADMIN_PASSWORD`, `DEEPSEEK_API_KEY`(Worker가 K-Plan 호출할 때 쓰는 것) |

`DEEPSEEK_API_KEY`처럼 **이름이 같은 secret이 두 저장소에 각각 따로
존재**할 수 있다는 게 특히 헷갈립니다 — 하나만 등록하고 "됐다"고
착각하기 쉽습니다. `gh secret set`은 GitHub Actions 쪽만 채우고, 배포된
Worker 런타임에는 어떤 영향도 주지 않습니다. Worker 쪽은 반드시
`npx wrangler secret put`으로 별도 등록해야 합니다.

**교훈**: 새 admin 엔드포인트나 Worker 코드가 `env.X`를 참조하면, 그
`X`가 **Worker secret 목록**(`npx wrangler secret list`)에 있는지 먼저
확인할 것 — GitHub 저장소의 `gh secret list`는 전혀 다른 목록입니다.

## 3. `_admins` 비밀번호 재설정이 `L1_ADMIN_PASSWORD` Worker secret을 깨뜨림

Admin UI(대시보드) 로그인이 안 돼서 `./pocketbase admin update
tensor.city@gmail.com "새비밀번호"`로 PocketBase 내장 `_admins` 계정
비밀번호를 재설정했는데, **이 계정이 바로 Worker의 `_l1AdminToken()`이
서비스 인증에 쓰던 그 계정**이었습니다. 대시보드에 들어가려고 바꾼
비밀번호가, Worker↔L1 간 내부 인증도 함께 깨뜨린 것 — Cloudflare가
`Error 1101`(미처리 예외)을 반환하는 것으로 나타났습니다.

**교훈**: `_admins` 컬렉션(PocketBase 내장 관리자)은 대시보드 로그인
**뿐 아니라** 여러 서버 간 서비스 인증에도 재사용될 수 있습니다.
이 계정 비밀번호를 바꿀 땐, 그 계정을 참조하는 Worker secret
(`L1_ADMIN_EMAIL`/`L1_ADMIN_PASSWORD`)도 **같이** 갱신해야 합니다 —
대시보드 접속 하나만 생각하고 바꾸면 안 됩니다.

## 4. Cloudflare Worker의 미처리 예외는 JSON이 아니라 `Error 1101`

새로 만든 admin 엔드포인트(`_l1AdminToken()`을 try/catch 없이 호출)가
예외를 던지자, 클라이언트는 `{"ok":false,...}` 같은 우리 코드의 JSON
에러가 아니라 Cloudflare 플랫폼 자체의 일반 에러 페이지(`Error 1101`,
JSON 아님)를 받았습니다. `jq -r '.ok'`로 파싱하려 하면
"Invalid numeric literal at line 1, column 6" 같은, 원인과 무관해
보이는 에러만 남아 처음엔 헤맸습니다.

**교훈**: 관리자/디버그용 엔드포인트를 새로 만들 때는 내부에서 부르는
모든 함수(`_l1AdminToken()` 포함)를 try/catch로 감싸서, 실패해도 항상
우리가 정의한 JSON 에러 형식으로 응답하게 할 것 — Cloudflare의 원시
에러 페이지가 그대로 노출되면 디버깅이 훨씬 오래 걸립니다.

## 5. 서버 전용 스크립트가 git 밖에 있으면 저장소 통합 때 방치된다

`/opt/gopang/ops/apply-pb-migrations.sh`가 hanlim 서버에만 존재하고
git 이력이 전혀 없었습니다. `gopang`/`gopang_v2` → `hondi` 저장소 통합
때 이 파일은 통합 대상에 아예 없었고, 그 결과 `RAW_BASE`가 계속
아카이브된 `Openhash-Gopang/gopang`을 가리켜 마이그레이션 배포가 매번
404로 실패했습니다.

**교훈**: 저장소 통합·이름 변경 작업 시, "서버에는 있는데 저장소엔
없는 파일"이 있는지 서버를 직접 뒤져서 확인할 것 — `find /opt/gopang
-type f | xargs grep -l "Openhash-Gopang/gopang"` 같은 전수조사가
저렴한 예방책입니다. (이 스크립트는 이제 `ops/apply-pb-migrations.sh`로
저장소에 편입됐지만, 강제 커맨드 SSH 키의 구조적 한계상 **저장소가
바뀌어도 서버엔 자동 반영되지 않습니다** — 다음에 이 파일을 고치면
수동 반영이 여전히 필요합니다.)

---

**요약**: 시크릿을 CLI로 넣을 땐 파이프 대신 파일 리다이렉션(`§1`,
`L1_ADMIN_AUTH_INCIDENT_2026_07_21.md` §4)을 쓰고, GitHub Actions
secret과 Cloudflare Worker secret을 절대 같은 것으로 착각하지 말고,
`_admins` 비밀번호를 바꿀 땐 그 계정을 쓰는 Worker secret도 같이
갱신하고, 새 엔드포인트는 내부 호출을 전부 try/catch로 감싸고, 서버
전용 파일은 주기적으로 저장소 편입 여부를 확인하십시오.
