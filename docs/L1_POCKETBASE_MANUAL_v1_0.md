# L1 PocketBase 완전 매뉴얼 v1.0

> **작성일**: 2026-07-19 · **대체 대상**: `docs/gopang_db_manual_v2.md`/`.html`(Supabase 시절, `docs/archive/`로 이동 예정)
> **메타 매뉴얼**: [`docs/MANUAL_INDEX.md`](./MANUAL_INDEX.md)

이 문서는 Supabase에서 완전히 이관된(2026-07-19 기준) L1 PocketBase 인프라의 구조·배포·운영을 다룹니다. 이전 `gopang_db_manual_v2`가 다뤘던 "테이블 43개·Views·Functions" 관점의 상세함을 계승하되, **실제로 존재가 확인된 것만** 기록합니다 — Supabase 매뉴얼처럼 스키마 전체를 추정으로 채우지 않았습니다(추정으로 채웠다가 실제 배포 전 재확인이 필요했던 전례가 `docs/supabase_to_l1_migration_plan.md`에 있습니다 — 이번엔 실측 우선).

---

## 1. 전체 아키텍처

### 1.1 계층 구조 (L1 → L5)

```
L1 (읍면동, 43개 노드)  →  L2 (시/군, 2개: 제주시/서귀포시)
  →  L3 (도, 1개: 제주도)  →  L4 (국가, 1개: KR)  →  L5 (글로벌, 1개)
```

- **L1**: 실제 원장(blocks, profiles 등)을 갖는 유일한 계층. 제주시 26개 + 서귀포시 17개 = 43개
- **L2/L3/L4/L5**: 자체 원장 없음. 하위 노드의 머클루트를 재귀 집계(`/api/supply/verify`가 대표 예시)만 함

### 1.2 물리 배포 — ⚠️ 메모리 문서와 실측이 다름
기존에 "제주시/서귀포시 두 대의 Oracle Cloud 서버로 나뉜다"고 기록돼 있었으나, **2026-07-19 실측 결과 48개(43 L1 + 2 L2 + 1 L3 + 1 L4 + 1 L5) 전부가 `l1-hanlim` 서버 한 대에 함께 떠 있는 것으로 확인됐습니다.** `pb_hooks/main.pb.js`의 `NODE_CONFIG` 상수(전체 48개 노드가 전부 `parentUrl: "http://127.0.0.1:80XX"`로 로컬 포트를 가리킴)가 근거입니다. 다른 물리 서버가 실제로 있는지는 이번 조사 범위 밖입니다 — 확인 필요.

### 1.3 systemd 서비스 구조
```
gopang-pb-{node}.service
  ExecStart=/opt/gopang/pocketbase serve --http=127.0.0.1:{port} \
            --dir=/opt/gopang/pb/{node} --hooksDir=/opt/gopang/pb_hooks
```
- **바이너리 1개, `pb_hooks` 디렉터리 1개를 48개 서비스가 전부 공유**합니다. `pb_hooks/main.pb.js`를 고치면 이론상 48개 전체에 영향을 주지만, 각 프로세스는 **재시작해야만** 새 훅을 메모리에 로드합니다(§5.3 참고 — 자동감지 안 됨, 2026-07-19 실측).
- 데이터 디렉터리(`--dir`)는 노드별로 분리(`/opt/gopang/pb/hanlim`, `/opt/gopang/pb/l1-aewol`, …) — 즉 원장 데이터는 노드마다 독립, 훅 로직만 공유.
- 2026-07-19 기준 **48개 중 7개만 실제 가동 중**(`gopang-pb-hanlim`, `l1-aewol`, `l2-jeju`, `l2-seogwipo`, `l3-jejudo`, `l4-kr`, `l5-global`) — 나머지 41개(주로 나머지 L1 노드)는 **서버 메모리 한계로 의도적으로 stop 상태**입니다(956MB 메모리에 48개 PocketBase 인스턴스는 부담 — 도입 초기 스펙, 출시 시 업그레이드 예정이라는 코드 주석 있음).

### 1.4 NODE_CONFIG 전체 노드 목록(포트·계층)
`pb_hooks/main.pb.js`에 하드코딩된 48개 노드 설정 전체(라우트마다 반복 정의돼 있음 — Goja 콜백 바깥 전역 선언을 실행 시점에 못 찾는 제약 때문). 폴더명(`$app.dataDir()` 마지막 세그먼트) 기준으로 자기 자신을 인식합니다.

| 폴더명 | L1 노드 ID | 포트 | 상위(parentUrl) |
|---|---|---|---|
| `hanlim` | `KR-JEJU-JEJU-HANLIM` | 8091 | :8092(l2-jeju) |
| `l1-aewol` ~ `l1-dodu` (제주시 25개) | `KR-JEJU-JEJU-*` | 8101~8125 | :8092 |
| `l1-daejeong` ~ `l1-yerae` (서귀포시 17개) | `KR-JEJU-SGP-*` | 8126~8142 | :8093 |
| `l2-jeju` | `KR-JEJU-JEJU-SI` | 8092 | :8094(l3) |
| `l2-seogwipo` | `KR-JEJU-SGP-SI` | 8093 | :8094 |
| `l3-jejudo` | `KR-JEJU` | 8094 | :8095(l4) |
| `l4-kr` | `KR` | 8095 | :8096(l5) |
| `l5-global` | `GLOBAL` | 8096 | 없음(최상위) |

전체 43개 L1 노드의 개별 이름·포트는 `pb_hooks/main.pb.js`를 직접 열어 `NODE_CONFIG` 상수를 확인하세요(이 표에선 지면상 제주시/서귀포시 그룹으로 축약).

---

## 2. 인증

- **관리자(superuser) 토큰**: `POST /api/admins/auth-with-password` (`{ identity, password }`) — `worker.js`는 `env.L1_ADMIN_EMAIL`/`env.L1_ADMIN_PASSWORD`(Cloudflare Worker 시크릿)로 자동 발급(`_l1AdminToken()`). 사람이 직접 디버깅할 땐 서버에서 `pocketbase admin create <email> <password> --dir=<노드경로>`로 임시 계정을 발급해 같은 API로 토큰을 획득하는 방식을 권장합니다(운영 계정 자격증명을 별도로 옮겨 적을 필요가 없어 더 안전).
- **일반 사용자**: Ed25519 서명(`worker.js` §1.2 참고) — L1 자체엔 사용자 세션 개념이 없고, `worker.js`가 서명을 검증한 뒤 admin 토큰으로 대신 써주는 구조가 기본. 단, `profiles` 컬렉션만은 `pb_hooks`의 `onRecordBeforeUpdateRequest` 훅이 **admin 토큰이 아닌 요청**에 한해 자체적으로 서명을 재검증합니다(§4.3).

---

## 3. 컬렉션 전체 목록 (44개 확인됨)

`worker.js`(`api/collections/...` 경로 직접 호출)와 `pb_hooks/main.pb.js`(`findCollectionByNameOrId`/`findRecordsByFilter`) 양쪽을 grep해 확인된 실제 존재 컬렉션입니다. **Admin UI로 직접 스키마(필드 타입·Rule)를 뜬 것은 아니라서, 필드명은 코드에서 실제로 `.set()`/`.get()`하는 것 기준으로 역추적한 값입니다** — 필드 목록이 100% 완전하다는 보장은 없습니다.

### 3.1 신원·인증
| 컬렉션 | 용도 | 핵심 필드(코드 기준) |
|---|---|---|
| `profiles` | 사용자/기관/사물 프로필 원장 — 이 플랫폼의 핵심 테이블 | `guid, handle, nickname, entity_type, native_lang, is_public, pubkey_ed25519, x25519_pubkey, name, address, lat, lng, phone, e164, country_code, region, extra(json), claim_status, claim_source, digit_code_id, push_subscription, push_sound, temp_score, temp_rating_count, search_text, fpHex` |
| `gdc_keys` | GDC 거래 서명용 공개키 등록 | `public_key` (buyer_public_key와 대조용) |
| `admin_guids` | 관리자 권한 있는 guid 목록 | — |
| `prompt_admins` | Prompt Editor(GitHub PR 연동) 전용 관리자 계정 — PocketBase 내장 인증 사용 | `email/username, password`(내장) |
| `_superusers` | PocketBase 내장 최상위 관리자 | (PocketBase 표준) |

### 3.2 PDV(Private Data Vault)
| 컬렉션 | 용도 |
|---|---|
| `pdv_records` | PDV 6하원칙 기록 원장 — `/pdv/report`가 씀. **Supabase `pdv_log`의 후신**(2026-07-14 이관) |
| `pdv_consent_requests` | PDV 조회 동의 요청 — `/pdv/query`가 동의 필요 시 생성, `consent.html`이 응답 |
| `pdv_merkle_anchors` | PDV 머클 앵커링(OpenHash 무결성 증빙) |
| `pdv_query_audit_log` | PDV 조회 감사 로그(공무원 대리조회 포함) |

### 3.3 GDC 재무·거래 원장 (⚠️ pb_hooks가 직접 다루는 핵심 영역)
| 컬렉션 | 용도 |
|---|---|
| `blocks` | **거래 원장의 핵심** — `block_type`(`tx_2party`/`deposit`/`ai_usage_charge`/`bridge_in`/`bridge_refund`)별로 outputs(JSON) 배열을 담음. 잔액은 이 테이블 전체를 재생(replay)해서 계산(`computeBalance()`) — 별도 잔액 컬럼이 없는 UTXO 유사 모델 |
| `ledger_entries` | 복식부기 재무제표 보조장부(차변/대변, `fs_account`: `bs-cash`/`pl-purchase`/`pl-revenue`) — 2026-07-18 신설, `blocks`의 회계적 해석을 영구 기록 |
| `tx_hash_chain` | (2026-07-14 Supabase `l1_ledger`→이관) 선형 해시체인 — `updateNodeHashChain`이 씀. `l1_ledger`(아래)와 이름이 비슷하지만 **완전히 별개 컬렉션**이니 혼동 주의 |
| `l1_ledger` | `/api/tx`의 Merkle 앵커링용(`tx_id, leaf_hash, l1_node, parent_root`) — 위 `tx_hash_chain`과 다름 |
| `node_ledger` | L2 이상 계층의 `/push_root` — 하위 노드의 머클루트 집계 |
| `bridge_in` / `bridge_out` | 크로스-L1 거래(판매자가 다른 L1 소속일 때) — outbox 패턴, `status`: `pending`/`applied`/`completed`/`refunded` |
| `gdc_deposits` | 사업자 GDC 예치금 |
| `gdc_dao_proposals` / `gdc_dao_votes` | GDC 거버넌스 제안/투표 |
| `charge_requests` | 청구 요청(충전 등) |

### 3.4 K-Market / 거래
| 컬렉션 | 용도 |
|---|---|
| `order_queue` | 주문 대기열 |
| `seller_products` | 판매자 상품 목록 |
| `seller_verifications` | 판매자 인증 심사 |
| `trade_ratings` | 거래 평점(온도) |
| `transaction_disputes` | 거래 이의제기 |
| `category_medians` | 카테고리별 중간값(가격 참고 등으로 추정 — 코드 재확인 필요) |
| `delivery_requests` | 배송 요청 |
| `reservations` | 예약 |
| `ins_claims` | 보험금 청구 |

### 3.5 오케스트레이션 / SP(System Prompt) 저작
| 컬렉션 | 용도 |
|---|---|
| `atom_rows` | 원자 단위 실행 행 |
| `procedure_maps` | 절차 지도(행정 프로세스 매핑으로 추정) |
| `project_states` | 프로젝트/작업 상태 저장(사람 확인 대기 등 일시정지 상태 포함) |
| `sp_draft_requests` | SP 초안 요청 |
| `sp_refresh_schedule` | SP 갱신 스케줄 |
| `sp_update_proposals` | SP 자기 갱신 제안 |
| `gov_task_schema_drafts` | 공공 업무 스키마 초안 |
| `escalations` | 에스컬레이션(상위 처리 필요 건) |

### 3.6 정부 연동
| 컬렉션 | 용도 |
|---|---|
| `dept_tasks` | 부서 업무 태스크 |
| `gov_data_resolve_log` | 공공데이터 조회 로그 |
| `guid_home_l1` | guid별 소속 L1 매핑(§3.3 브릿지에서 판매자 소속 L1 조회 시 사용 — L3 레지스트리 역할) |
| `org_profiles` | 기관 프로필 |
| `pending_claims` | 청구권(claim, 72시간 만료) 대기열 — GDC 거래 후 매수/매도 양쪽에 발급되는 임시 청구권 |
| `meta_table_records` | 메타 테이블(범용 스키마 확장용으로 추정) |

### 3.7 기타
| 컬렉션 | 용도 |
|---|---|
| `gwp_registry` | GWP(Navi Wallet Protocol) 레지스트리 |
| `svc_registry` | 하위 서비스 등록(레벨·PDV 권한 등, `_getSvcRegistration`이 조회) |
| `feedback` / `user_feedback` | 피드백(2종 — 용도 차이 재확인 필요) |
| `webrtc_signals` | WebRTC 시그널링(SDP/ICE) — 메시지 자체는 저장 안 함, 신호만 임시 저장 |
| `user_llm_keys` | 사용자 LLM API 키(민감정보 — Supabase user_llm_keys에서 이관) |
| `web_search_usage` / `ai_usage_log` / `public_data_usage` | 사용량 로그 3종 |

**미검증 안내**: 위 44개는 코드에서 참조가 발견된 것만이며, 실제 L1 Admin UI에서 컬렉션 스키마(필드 타입·Rule·인덱스)를 확인한 것은 아닙니다. 정확한 Rule(예: `createRule`/`updateRule`)은 `docs/POCKETBASE-STRUCTURE-GUIDE_v1_1_addendum_2026-07-19.md`에 일부 정리돼 있으니 함께 참고하세요.

---

## 4. `pb_hooks/main.pb.js` 상세

이 파일은 hanlim 노드의 `/opt/gopang/pb_hooks/main.pb.js`이자 git `gopang` 저장소의 `pb_hooks/main.pb.js`(2026-07-19부로 정식 git 추적 시작)입니다. TweetNaCl Ed25519 포트 하나(`_sigVerify`, 파일 최상단 IIFE)를 공유 유틸로 두고, 그 아래 `routerAdd()`로 커스텀 REST 라우트를, 그리고 `onRecordBeforeCreateRequest`/`onRecordBeforeUpdateRequest`로 `profiles` 컬렉션 요청을 가로채는 훅 2개를 등록합니다.

### 4.1 `POST /api/tx` — P2P/거래 정산의 핵심
- **요청**: `{ tx: {input, outputs}, tx_hash, buyer_sig, buyer_public_key, purpose?, seller_home_node? }`
- **검증 파이프라인**(순서대로 실패 시 즉시 거부):
  1. 공개키가 `gdc_keys`에 등록돼 있는지
  2. `sha256hex(sortedStringify(tx))`가 클라이언트가 보낸 `tx_hash`와 일치하는지(정렬된 JSON 직렬화 — 필드 순서 무관하게 동일 해시 보장)
  3. Ed25519 서명이 `tx_hash`에 대해 유효한지
  4. `blocks`에서 이 guid의 직전 `tx_2party` 블록을 찾아 `prev_settle_hash` 일치 확인(불일치 시 `409 STALE_STATE`) + 이중지불 검사
  5. `computeBalance()`로 **원장을 처음부터 재생**해 실제 잔액 계산, `outputs` 합계와 대조(클라이언트가 주장하는 `balance_claimed`는 참고용일 뿐 신뢰하지 않음)
- **크로스-L1 브릿지**: `seller_home_node`가 자기 노드와 다르면, 판매자 몫 output의 `recipient_guid`를 `bridge-out:{target}` sentinel로 바꿔치기 — 로컬 총량 보존식은 그대로 유지하면서 실제 정산은 `bridge_out` outbox로 위임(worker.js가 폴링해 대상 L1의 `/api/bridge-in` 호출)
- 성공 시 `blocks`(정산 블록) + `ledger_entries`(복식부기) + `l1_ledger`(머클 앵커) 3곳에 기록, 상위 L2로 머클루트 전파(`/push_root`)
- **청구권(claim) 발급**: `buyerClaim`(`fs_account: 'pl-purchase'`)과 `sellerClaim`(`fs_account: 'pl-revenue'`) — 72시간 만료, `gopang-wallet.js`의 `redeemClaim()`이 이 값을 신뢰해서 로컬 잔액을 갱신

### 4.2 `/api/mint`, `/api/ai-charge`, `/api/balance`, `/api/supply*`
| 엔드포인트 | 용도 | 인증 |
|---|---|---|
| `POST /api/mint` | GDC 발행(개발 전용). `krw_amount`(정본) 또는 `amount`(하위호환, GDC 직접지정) | `MINT_SECRET`(env, 2026-07-19 이관) |
| `POST /api/ai-charge` | AI 사용량 초과분 GDC 차감. `tx_hash`로 멱등성 보장(중복 차감 방지) | `AI_CHARGE_SECRET`(env) |
| `GET /api/balance` | guid의 실제 잔액 + 다음 거래용 `prev_settle_hash` 재조회(클라이언트 로컬 상태 어긋남 복구용) | 없음(공개 조회) |
| `GET /api/supply/verify` | 발행 총량==잔액 합 불변식 검증. L1은 로컬만, L2 이상은 하위 노드 재귀 집계 | 없음 |
| `GET /api/supply` | 발행 총량만 간단 조회(검증 없이) | 없음 |

**환율**: KRW 1,000원 = GDC 1T(고정), `EXCHANGE_RATE_KRW_PER_GDC` 상수로 각 라우트 콜백 안에 반복 선언(Goja 콜백 바깥 전역 함수/상수를 실행 시점에 못 찾는 제약 때문).

### 4.3 `/api/bridge-in`, `/api/bridge-out/pending`, `/api/bridge-out/complete`, `/api/bridge-out/refund`
크로스-L1 정산 프로토콜(P1 원칙: L1은 다른 L1을 직접 호출하지 않음 — 항상 worker.js가 중개):
- `bridge-in`: 다른 L1에서 이 L1 판매자에게 들어오는 크레딧 반영. `tx_hash` 멱등 + `BRIDGE_SECRET`(env) 인증 필수
- `bridge-out/pending`: worker.js가 폴링해 재시도 대상 조회
- `bridge-out/complete`: 대상 L1의 bridge-in 성공 확인 후 상태 갱신
- `bridge-out/refund`: 유예시간(예: 1시간) 초과 시 sentinel에서 원 구매자에게 되돌리는 보상 트랜잭션

### 4.4 `profiles` 컬렉션 훅 2종

#### `onRecordBeforeCreateRequest` — 전화번호 소유 검증(2026-07-15 신설)
`e164`가 있는 생성 요청은 `phone_verify_token`(worker.js `POST /biz/phone-otp-verify`가 발급, `{e164}:{만료ms}.{HMAC-SHA256 hex}` 형식) 검증 필수. `PHONE_VERIFY_SECRET`(env) 필요 — 없으면 생성 자체 거부.

#### `onRecordBeforeUpdateRequest` — 프로필 수정 서명 검증(2026-07-19 신설, 같은 날 회귀버그 발생·수정)
- **요구 필드**: `guid, pubkey, signature`(+ `ts`, 검증 대상 문자열 `${guid}:${pubkey}:${ts}`에 포함)
- **admin 인증 요청은 우회**(`if (info.admin) return;`) — **2026-07-19 긴급 수정**. 최초 배포 버전엔 이 예외가 없어서 `_l1UpsertProfile`(worker.js, admin 토큰으로 PATCH하는 정식 경로) 자체가 전부 막혔던 회귀버그가 있었음
- TOFU: 기존 `pubkey_ed25519`와 다른 키로는 수정 불가

---

## 5. 배포 절차

### 5.1 `pb_hooks/main.pb.js` — GitHub Actions 자동배포
`.github/workflows/deploy-pb-hooks.yml` — `pb_hooks/**` push 시 자동 실행. SSH로 hanlim 서버에 접속해 강제 커맨드(`/opt/gopang/ops/apply-pb-hooks.sh`)를 실행합니다.

**필요 시크릿**(저장소 Settings > Secrets):
- `L1_HOOKS_SSH_PRIVATE_KEY` — pb_hooks 배포 전용 키(2026-07-19 최초 발급·등록 — 그 전까지 4번의 배포 시도가 전부 이 시크릿 부재로 실패했었음)
- `L1_SSH_HOST`, `L1_SSH_USER` — 기존 pb_migrations용과 공유

**서버 측 준비**(hanlim):
```bash
# authorized_keys에 강제 커맨드로 등록(SSH 키 쌍은 별도 발급 — pb_migrations 키와 절대 겹치지 않게)
command="/opt/gopang/ops/apply-pb-hooks.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA... gopang-pb-hooks-deploy
```
`ubuntu` 계정이 `sudo -n systemctl restart gopang-pb-hanlim`을 암호 없이 실행 가능해야 함(sudoers, 2026-07-19 확인 완료).

**`ops/apply-pb-hooks.sh`가 하는 일**(2026-07-19 v3):
1. 현재 파일을 `pb_hooks_backups/`(감시 밖 — hooksWatch가 있다면 불필요한 재시작 트리거 방지 목적으로 설계됐던 흔적)에 백업
2. GitHub main의 최신 파일을 `/tmp`(감시 밖)로 다운로드
3. 최소 검증(`/api/tx` 라우트 존재 확인)
4. 교체(cp) + **명시적 `systemctl restart`**(v3 — `hooksWatch` 자동재시작 가정이 실측 결과 틀린 것으로 확인돼 추가됨)
5. 최대 120초 헬스체크 대기(`hooksPool` 콜드스타트로 70~80초까지 정상)
6. 실패 시 백업으로 롤백 + 재시작

### 5.2 `worker.js` — GitHub Actions 자동배포
`.github/workflows/deploy-worker.yml` — `worker.js`/`wrangler.toml` push 시 Cloudflare Workers에 자동 배포(`wrangler-action`). `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` 시크릿 필요(2026-07-12부터 등록 완료 — 이쪽은 pb_hooks와 달리 처음부터 정상 작동해왔음, 2026-07-19 기준 100/100 성공).

### 5.3 `pb_migrations` — 별도 워크플로우
`.github/workflows/deploy-pb-migrations.yml` + `ops/deploy-pb-migrations.sh` — 이 매뉴얼 작성 시점에 상세 조사는 안 함(다음 라운드 과제).

