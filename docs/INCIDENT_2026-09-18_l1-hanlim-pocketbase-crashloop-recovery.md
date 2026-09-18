# INCIDENT_2026-09-18 — l1-hanlim 서버 PocketBase 48개 인스턴스 crash-loop 발견·복구

## 배경

JILES 중복 SP(`SP-ORGDIV-JILES-EDU`/`SP-ORGDIV-JILES-LIFELONG`) 정리 작업의 일환으로,
PocketBase 라이브 레지스트리에서 구 `SP-ORGDIV-JILES-LIFELONG` 레코드(`unclaimed_7ba267d3-49ff-4337-8421-2923c139dadf`)를
삭제하려고 `l1-hanlim-new`(152.67.196.86) 서버에 SSH 접속하는 과정에서, 도 단위(L3) PocketBase 인스턴스가
장기간 crash-loop 상태임을 발견했다. 조사 범위를 넓혀보니 해당 서버의 **거의 모든 PocketBase 인스턴스(48개 중 46개)**가
같은 계열의 문제로 크래시 루프 또는 장기 정체 상태였다.

## 원인 1 — 마이그레이션 파일 잔재 충돌 (약 22개 인스턴스, restart 2,190~16,753회)

- 공유 마이그레이션 디렉터리 `/opt/gopang/pb/pb_migrations/`에 **저장소(git)엔 없는 버려진 초안 파일**
  `1793990003_created_goal_path_traces.js`가 남아 있었다. 이 파일은 최종본
  `1794000001_created_goal_path_traces.js`(2026-09-15 신설, 저장소 정본)와 **똑같은 컬렉션 이름("goal_path_traces")**을
  만들려고 시도한다 — 2026-09-15 리네임/재번호 매기기 당시 서버에서 지워지지 않고 남은 잔재로 추정된다.
- PocketBase는 `migrate up` 실행 시 미적용 마이그레이션 전체를 **하나의 트랜잭션**으로 묶어 적용한다. 이 잔재 파일이
  먼저(타임스탬프가 더 이름) `goal_path_traces` 컬렉션 생성을 시도하고, 뒤이어 정본 `1794000001`이 같은 이름으로
  다시 생성을 시도하면서 같은 트랜잭션 내에서 `UNIQUE constraint failed: _collections.name`으로 충돌 → 전체 배치
  롤백 → 다음 재기동에서도 동일하게 반복.
- 증거: 정지 후 단독 `migrate up` 실행도 동일하게 실패(타이밍 문제 아님), `_collections` 테이블엔 실제로
  `goal_path_traces`가 존재하지 않음(트랜잭션이 매번 롤백됐으므로), 고립된 단일 INSERT 테스트는 충돌 없이 성공(커밋된
  DB 상태엔 진짜 충돌이 없음을 확인) — 배치 트랜잭션 내부 자기충돌 가설과 정확히 부합.
- **조치**: `1793990003_created_goal_path_traces.js`를 `/opt/gopang/pb_migrations_removed_stale/`로 이동(삭제 아님,
  백업 보존). 이후 44개 인스턴스에 대해 각각 서비스 정지 → `pocketbase migrate up --dir=<인스턴스 dir>` →
  서비스 재기동을 순차 실행 — 26개는 이 조치만으로 즉시 정상화.

## 원인 2 — 수동 마이그레이션 시 환경변수 누락 (17개 인스턴스, 서귀포 권역 읍면동)

- 안덕·천지·대천·대정·대륜·동홍·효돈·정방·중앙(서귀포)·중문·남원·표선·서홍·성산·송산·영천·예래 등 17개 노드는
  원인 1 조치 이후에도 실패 — 이들은 **훨씬 이전 마이그레이션** `1793900200_backfill_existing_e164_hash_enc_last8.js`
  에서 걸려 있었다(원인 1과 무관, 이전부터 `inactive` 상태였던 것으로 보임).
  에러: `PHONE_VERIFY_SECRET 미설정 — 백필을 진행할 수 없습니다.`
- `PHONE_VERIFY_SECRET`은 `/opt/gopang/gopang.env`에 실제로 존재하지만, systemd 서비스는 `EnvironmentFile=`로
  자동 로드하는 반면 **수동으로 `pocketbase migrate up`을 실행할 때는 그 환경이 로드되지 않아** 발생한 것으로
  확인됐다.
- **조치**: `systemd-run --uid=ubuntu --gid=ubuntu -p EnvironmentFile=/opt/gopang/gopang.env ... pocketbase migrate up`
  형태로 systemd 자체의 env 파일 파서를 이용해(따옴표·한글 값 등에 안전) 재실행 — 17개 전부 성공.

## 결과

48개 인스턴스(L1 읍면동 43개 + L2 시 2개 + L3 도 1개 + L4 국가 1개 + L5 글로벌 1개) 전부 `active/running`,
`NRestarts=0`으로 안정화 확인(2026-09-18 11:09 UTC 기준).

## 남은 후속 작업

1. **재발 방지**: `deploy-pb-migrations.yml` 배포 워크플로가 리네임/삭제된 마이그레이션 파일을 서버에서 정리하지
   않는 구조인지 확인 필요 — 새 파일만 추가하고 지워진 파일은 그대로 두는 방식이라면, 앞으로도 같은 계열의 사고가
   재발할 수 있다. (원인 1)
2. **영향 범위 파악**: 서귀포 권역 17개 노드가 정확히 언제부터 멈춰 있었는지, 그 기간 동안 실사용자 영향(예약·조회
   실패 등)이 있었는지 추가 조사가 필요할 수 있다. (원인 2)
3. **삭제 훅 버그**: JILES-LIFELONG 레코드 삭제 시 `profiles` 컬렉션의 삭제 전 훅이 `_balanceUtils is not defined`로
   에러를 내며 정상 삭제를 막는 것을 발견했다(`force_delete=true`로 우회해 이번 건은 처리함). 이 훅이 깨져 있으면
   **현재 어떤 profiles 레코드도 정상적인 잔액/이력 확인 없이 강제 삭제로만 지울 수 있는 상태** — `pb_hooks`의
   `_balanceUtils` 정의/임포트 문제를 원인 파악·수정해야 한다. 안전장치가 무력화된 상태이므로 우선순위가 높다.
4. **admin 비밀번호**: JILES 레코드 삭제 작업을 위해 `tensor.city@gmail.com` 계정의 **l3-jejudo 인스턴스 한정**
   비밀번호를 임시값으로 재설정했다(다른 인스턴스는 영향 없음). 편한 시점에 원래 쓰던 비밀번호로 다시 변경 필요.

## JILES-LIFELONG PocketBase 레코드 삭제 (원래 목적)

- 대상: `profiles` 컬렉션, `id=41u96i3suymduy0`, `guid=unclaimed_7ba267d3-49ff-4337-8421-2923c139dadf`,
  `entity_subtype=org:SP-ORGDIV-JILES-LIFELONG`, `claim_status=unclaimed`(삭제 시점까지 미클레임 확인).
- l3-jejudo 인스턴스(포트 8094)에서 API로 조회 후 `force_delete=true`로 삭제, 삭제 후 재조회로 0건 확인 완료.
- 이로써 JILES 중복 데이터 정리(코드/SP 파일 + 라이브 레지스트리)가 전부 마무리됐다.
