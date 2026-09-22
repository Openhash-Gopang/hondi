# 세션 기록 — clean.hondi.net(구 fiil.kr) 실사 소스 이식 · Supabase 완전 제거 · Cloudflare 토큰 인증오류 근본원인 규명 · K-Cleaner→K-Clean 명칭 정정 (2026-09-22)

> 관련 문서: `WORKLOG_INDEX.md`에서 전체 문서 지도 확인 (desktop.html 좌측
> 사이드바 "🛠 개발자 문서" 섹션에서 링크됨)

## 0. 이 문서가 다루는 범위

hondi.net에서 K-Cleaner(환경 신고 SP-14) 위젯을 열었더니 로그인한 실사용자
("도영민")가 아니라 더미 텍스트("김제주")가 표시되고, GPS도 자동 전달되지
않고 "시간 초과"만 뜨는 문제 제보에서 시작해, 저장소 자체를 이관하고
백엔드를 교체하고 배포 파이프라인 장애까지 해결한 하루짜리 세션 전체
기록이다. 특정 버그 하나가 아니라 **저장소 이관 → 실사 코드 이식 → 백엔드
전환 → 인프라 장애 대응 → 명칭 정정**까지 이어진 작업 흐름과, 그 과정에서
반복하지 않아야 할 실수들을 정리한다.

## 1. 배경 — 왜 저장소를 옮겼나

- 문제의 위젯은 `fiil.kr`(외부 조직 `nounweb/fiil` 저장소)이 서빙하던
  화면이었다. hondi의 GWP(고팡 위젯 프로토콜)가 `token`(GUID)·`ctx`·
  `facts`를 넘겨주고 있었는데도 fiil.kr 쪽 SDK가 이를 제대로 소비하지
  못해 더미 데이터를 표시하고 있었다.
- 사용자 지시에 따라 **fiil.kr을 그대로 `Openhash-Gopang/clean` 저장소로
  이식**하고, `clean.hondi.net`(GitHub Pages + CNAME)으로 서빙하도록
  전환했다. 처음에는 화면을 재구성하는 방식으로 접근했으나, 사용자가
  "실사 소스를 그대로 복제하라"고 정정하여 `nounweb/fiil`의 실제
  `webapp.html`을 그대로 가져와 결함만 패치하는 방향으로 다시 작업했다.

## 2. 발견·수정한 버그 (nounweb/fiil 실사 소스 기준)

| # | 증상 | 원인 | 수정 |
|---|------|------|------|
| 1 | 로그인 사용자 대신 더미 텍스트("김제주") 표시 | fiil.kr SDK가 GWP `ctx` 파라미터를 구버전 방식(순수 `decodeURIComponent`)으로만 읽음 — hondi가 `ctx_enc=b64`로 보내는 신버전 인코딩을 처리 못함 | `gwp-sdk.js`에 `_decodeCtx()` 신설, `ctx_enc` 유무로 base64/legacy 자동 분기 |
| 2 | GPS "시간 초과" | GWP가 넘겨주는 `facts.currentLocation`을 안 읽고 자체 `navigator.geolocation`만 새로 호출 | `engine.js`(hondi 쪽)에 `gps_addr` 평문 파라미터 추가 이식(구버전 SDK 호환), `webapp.html`이 GWP `facts`를 우선 사용하도록 수정 |
| 3 | 없는 LLM 설정 배너 표시 | 코드에 죽어있던 조건부 배너 로직 | 제거 |
| 4 | GUID/전화번호 필드 혼용 | 서버 스키마와 클라이언트 필드명 불일치 | 필드 매핑 정정 |

## 3. Supabase 제거 → hondi-proxy(L1 PocketBase) 전환

- `webapp.html`에 하드코딩돼 있던 Supabase anon key(`ebbecjfrwaswbdybbgiu`)는
  **2026-08-12 45개 저장소 시크릿 스캔에서 이미 노출 확인된 바로 그 키**였다.
  hondi 저장소 쪽은 이미 3/4 소비 파일이 정리돼 있었고, 이번 세션에서
  `kcleaner.js`(hondi, 죽은 코드였던 `_updateFiilReport`)와 `clean`
  저장소의 `webapp.html`(실제 살아있는 코드) 두 곳을 마저 정리했다.
- **중대 정정**: 처음에는 "PocketBase 관리자 콘솔에서 컬렉션을 수동
  생성하라"고 안내했는데, 사용자가 "Supabase는 전부 L1 PocketBase로
  이전 완료됐고, 이 조직은 `pb_migrations/` + CI(`deploy-pb-migrations.yml`)
  자동 배포 파이프라인을 이미 쓰고 있다"고 정정했다. → 컬렉션 생성을
  `pb_migrations/1794200001_created_kcleaner_reports.js`로 다시 작성해
  기존 컨벤션(`1794100001_created_foi_campaigns.js` 등)을 그대로 따름.
- 신설 백엔드: `worker.js`에 `/kcleaner/report`(POST 저장)·
  `/kcleaner/reports`(GET 목록)·`/kcleaner/report/:id`(PATCH/GET)·
  `/kcleaner/photo-upload`(POST, R2)·`/media/kcleaner-photo/*`(GET, R2)
  6개 라우트 신설. R2 버킷 `hondi-kcleaner-photos`(바인딩명
  `KCLEANER_PHOTOS`) 신규 추가.
- 실제 요청으로 검증 완료: 신고 저장(`POST /kcleaner/report`) →
  L1 PocketBase `kcleaner_reports` 컬렉션에 저장 확인, 사진 업로드
  (`POST /kcleaner/photo-upload`) → R2 저장 후 원본과 바이트 단위로
  동일하게 다운로드되는 것까지 확인.

## 4. Cloudflare 배포 파이프라인 장애 — 근본원인과 함정

`wrangler.toml`에 새 R2 바인딩(`KCLEANER_PHOTOS`)을 추가한 뒤 첫 배포가
`Authentication error [code: 10000]`로 실패했다.

- **처음 의심(틀림)**: GitHub Secret `CLOUDFLARE_API_TOKEN`에 R2 권한
  자체가 없다고 판단 → 토큰 상세 화면을 다시 보니 이미 권한이 있었음
  (권한 부족이 원인이 아니었음이 드러남).
- **최종 원인**: 권한이 아니라 **토큰 값 자체의 문제**였을 가능성이
  높음(만료·IP 필터·시크릿 값 불일치 등 — 권한 조회만으로는 code 10000을
  설명할 수 없음). → **토큰을 Roll(재발급)** 하고 `gh secret set`으로
  갱신하는 쪽으로 해결.
- **재발급 전 반드시 확인할 것**: 이 시크릿이 저장소 단독인지, 조직
  공유인지. `gh secret list --repo <owner>/<repo>`로 저장소 시크릿
  목록에 해당 이름이 실제로 뜨는지 먼저 확인한다 — 뜬다면 **저장소
  시크릿이 조직 시크릿보다 항상 우선 적용**되므로, 다른 저장소를
  전혀 건드리지 않고 안전하게 Roll+갱신할 수 있다. (조직 admin 권한이
  없어서 조직 시크릿 존재 여부를 직접 조회하지 못하는 경우에도, 이
  우선순위 규칙 덕분에 저장소 시크릿만 확인하면 충분하다.)
- **삽질**: `git am`에 넘길 패치 파일 경로를 플레이스홀더 문자열
  그대로 넣어 실패 → 그 상태에서 `push`가 실행돼 **빈 브랜치**가
  원격에 먼저 올라간 사고, 로컬 브랜치 전환(`checkout -b`) 실패를
  못 보고 `git am`이 `main`에 그대로 커밋된 사고가 두 번 있었다.
  둘 다 `git log --oneline`으로 커밋이 예상한 브랜치에 있는지, `git
  branch -f`로 커밋을 올바른 브랜치로 옮기는 방식으로 복구했다.
  **교훈**: `checkout -b`나 `git am` 뒤에는 반드시 `git log --oneline
  -3`이나 현재 브랜치명을 확인하고 다음 명령으로 넘어갈 것.

## 5. 서비스 명칭 K-Cleaner → K-Clean 전면 정정

사용자 지시로 사용자 노출 표시명(name)만 전부 "K-Clean"으로 바꿨다 —
`gwp_id`/`id`/`sp_key`/`service_id` 같은 내부 식별자(`fiil-kcleaner`,
`SP-14_kcleaner`, `kcleaner_reports` 컬렉션명 등)는 그대로 유지했다.

- **hondi**: `gwp-registry.js`·`services/fiil-kcleaner/manifest.json`
  표시명, K-services/agents/overview 등 안내 페이지, SP-14 AI 프롬프트
  (AI가 스스로를 "K-Clean"으로 지칭하도록), 테스트 픽스처의
  `expected_name`까지 144개 파일·268곳.
- **주의할 함정**: `gwp_registry` PocketBase 테이블은
  `1783500009_seeded_gwp_registry_core.js`로 **이미 프로덕션에 적용된**
  시딩 마이그레이션이 채워둔 것이라, 그 파일 자체의 텍스트를 고쳐도
  서버 데이터는 안 바뀐다(마이그레이션은 1회만 실행됨). 기존 레코드의
  `name` 필드를 실제로 갱신하려면 `dao.findFirstRecordByFilter()` +
  `dao.saveRecord()`로 **UPDATE 전용 새 마이그레이션**
  (`1794300001_renamed_kcleaner_to_kclean.js`)을 추가해야 한다.
- **clean**: `webapp.html`의 GWP 탭 타이틀(`gwp.ready({title:'K-Clean'})`)
  포함 6개 파일·26곳.

## 6. 최종 검증

```
gh run list --repo Openhash-Gopang/hondi --workflow=deploy-worker.yml --limit 3
# ✓ chore: 서비스 명칭 K-Clean... 성공

curl.exe "https://hondi-proxy.tensor-city.workers.dev/kcleaner/reports?limit=1"
# {"ok":true,"reports":[...]}

curl.exe -s https://clean.hondi.net/webapp.html | Select-String "title:\s*'K-Clean'"
# title:       'K-Clean',
```

## 7. 다음에 이 작업을 반복할 때 체크리스트

1. 외부 저장소(fiil.kr 등)의 화면을 hondi로 이관할 때는 **재구성이
   아니라 실사 소스를 그대로 가져와 결함만 패치**하는 쪽이 실사용자
   행동을 가장 정확히 재현한다.
2. Supabase처럼 "이미 전체 폐지됐다"고 알려진 레거시가 코드베이스
   한구석에 하드코딩돼 남아있을 수 있다 — grep으로 프로젝트 전체를
   훑고, PocketBase 컬렉션은 반드시 `pb_migrations/` 컨벤션을 따를 것
   (관리자 콘솔 수동 생성 금지).
3. `wrangler.toml`에 새 리소스 바인딩(R2·KV·D1 등)을 추가하는 첫
   배포는 그 리소스에 대한 **별도 API 토큰 권한**을 새로 요구할 수
   있다 — 배포 실패 로그의 `Authentication error`를 권한 부족으로
   단정하기 전에 토큰 상세 화면을 먼저 확인한다.
4. GitHub Secret을 Roll/갱신하기 전에는 `gh secret list --repo <repo>`로
   저장소 단독 시크릿인지부터 확인 — 저장소 시크릿이 있으면 조직
   시크릿 여부와 무관하게 그 저장소만 영향받는다.
5. 이미 프로덕션에 적용된 시딩 마이그레이션의 데이터를 고칠 때는
   그 파일을 수정하지 말고 **새 UPDATE 마이그레이션**을 추가한다.
6. `git am` 경로 지정 시 플레이스홀더를 실제 경로로 바꾸지 않으면
   조용히 실패하고 이후 명령이 엉뚱한 브랜치에 적용될 수 있다 — 매
   명령 뒤 `git log --oneline -3`으로 확인하는 습관을 들인다.

## 관련 문서

- `pb_migrations/1794200001_created_kcleaner_reports.js`,
  `pb_migrations/1794300001_renamed_kcleaner_to_kclean.js`
- `gwp-registry.js` (`fiil-kcleaner` 항목)
- Openhash-Gopang/clean 저장소 전체
