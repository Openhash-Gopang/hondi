# hondi-proxy Worker(`worker.js`) API 레퍼런스 v1.0

> **작성일**: 2026-07-19 · **2026-07-27 갱신**(§3.3 `/profile/*`·`/sp-updates/*`
> 부분만 — 그날 세션이 실제로 만진 곳) · **대상 파일**: `worker.js`(gopang
> 저장소, **18,449줄**, 2026-07-27 실측 — 작성 당시 "14,300줄+"에서 29%
> 증가) · **엔드포인트 수**: 원 작성 시점 145개, 2026-07-27 `pathname ===`/
> `pathname.startsWith(` 매칭 기준 재실측 시 약 190개(느슨한 카운트 —
> 정확한 재집계는 원 작성 방법론 그대로 다음 라운드에서)
> **메타 매뉴얼**: 이 문서가 다루는 범위와 다른 매뉴얼과의 관계는 [`docs/MANUAL_INDEX.md`](./MANUAL_INDEX.md) 참고
> **⚠ 2026-07-29 정정**: 본문(특히 `/orchestration/procedure-map` 행)이
> 참조하는 `AGENT-COMMON`은 이후 완전히 폐기되고 `AC-SHADOW-CORE`/
> `AC-PRO-CORE`/`AC-FLASH-EXECUTOR`로 교체됐습니다(`sp-catalog.json`에
> `AGENT-COMMON` 키 없음). 각 엔드포인트가 실제로 어느 파일에서 호출되는지는
> 재검증되지 않았습니다 — [`docs/SP_TREE_GOVERNANCE_MANUAL_v1_0.md`](./SP_TREE_GOVERNANCE_MANUAL_v1_0.md) §7 참조.

이 문서는 `worker.js`에 등록된 라우트 145개 전체의 인벤토리(§2)와, 그중 보안·재무·최근 변경 등으로 중요도가 높은 약 30개 엔드포인트의 상세 스펙(§3)으로 구성됩니다. **145개 전부를 필드 단위까지 문서화하지는 않았습니다** — 이 정도 규모의 API를 한 번에 전수 조사하면 오히려 검증 부실로 이어질 위험이 커서, 상세 문서화는 "자주 바뀌는 곳·보안 민감한 곳·오늘 세션에서 실제로 만졌던 곳"부터 시작했습니다. §2 요약표만 있는 나머지 엔드포인트는 핸들러 함수명과 줄번호가 있으니 코드에서 직접 확인하시고, 필요하면 이 문서에 이어서 채워주세요.

---

## 1. 공통 규약

### 1.1 요청/응답 공통 패턴
- 거의 모든 POST 엔드포인트는 `await request.json()`으로 body를 파싱하고, 파싱 실패 시 `400 INVALID_JSON`을 반환합니다.
- 성공 응답은 대체로 `{ ok: true, ... }`, 실패는 `{ ok: false, error: CODE, detail: '...' }` 형태(`_err()` 헬퍼 사용)입니다. 다만 일부 구형 엔드포인트(`handleVerify` 등)는 `{ valid: true/false }`처럼 다른 관례를 씁니다 — 통일돼 있지 않으니 클라이언트 작성 시 매번 실제 응답을 확인하세요.
- CORS: `ALLOWED_ORIGINS`(worker.js 29줄) 화이트리스트 기반, OPTIONS는 경로 무관 전역 처리(4203줄).

### 1.2 서명 인증 (Ed25519) — 여러 변형이 공존합니다
이 코드베이스엔 "서명으로 본인확인" 패턴이 최소 4가지 변형으로 존재합니다. **엔드포인트마다 서명 대상 메시지 포맷이 다르니 절대 섞어 쓰면 안 됩니다.**

| 사용처 | 서명 대상 메시지 | 비고 |
|---|---|---|
| `/auth/issue` | `auth-issue:${guid}:${pubkey}:${svc}:${ts}` | 재전송 방지 창: **120초** |
| `handleProfilePost`(`/profile` POST), `/profile/visibility` | `${guid}:${pubkey}:${ts}` | 재전송 방지 창: **300초**(`_isFreshTs` 기본값) — `/profile` POST 자체는 `_isFreshTs`를 안 씀(무제한) |
| `/account/full-reset` | `full-reset:${guid}:${ts}` | L1에 등록된 키가 없으면(가입 직후) 서명 생략 허용 |
| `pb_hooks/main.pb.js` profiles PATCH 훅 | `${guid}:${pubkey}:${ts}` | worker.js와 별개 레이어(PocketBase 훅) — admin 토큰 요청은 우회(2026-07-19 수정) |

공통 검증 함수는 `_verifyEd25519Simple(pubkeyB64u, signatureB64u, message)`(6996줄) — base64url 인코딩, Ed25519, TweetNaCl 포트 기반.

### 1.3 TOFU(Trust On First Use) pubkey 핀
`profiles.pubkey_ed25519`가 한 번 등록되면 그 이후로는 같은 키로만 수정 가능합니다. **단, `pubkey_ed25519`가 비어있으면(미청구 프로필) 이 체크가 스킵됩니다** — `/profile/visibility`는 2026-07-19에 이 구멍을 막았지만(`PROFILE_NOT_CLAIMED` 신설), 다른 엔드포인트(`handleProfilePost` 등)는 아직 동일한 보강이 안 돼 있을 수 있습니다 — 각 엔드포인트 절에서 개별 확인 필요.

### 1.4 L1 PocketBase 연동
`L1_DEFAULT`는 hanlim 노드를 가리킵니다. 서버측(admin 토큰) 쓰기는 `_l1AdminToken(env)`, 조회는 `_l1FindProfileByGuid(env, guid)` 등 헬퍼 재사용이 관례입니다. 상세는 [`docs/L1_POCKETBASE_MANUAL_v1_0.md`](./L1_POCKETBASE_MANUAL_v1_0.md) 참고.

---

## 2. 전체 라우트 인벤토리 (145개, 카테고리별)


### 인증 (`/auth/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| (코드확인필요) | `/auth/issue` | `handleIssue` | ── SSO 인증 ────────────────────────────────────────── |
| (코드확인필요) | `/auth/verify` | `handleVerify` | — |
| (코드확인필요) | `/auth/refresh` | `handleRefresh` | — |
| (코드확인필요) | `/auth/webauthn/challenge` | `handleWAChallenge` | ── WebAuthn ───────────────────────────────────────── |

### 계정 (`/account/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| POST | `/account/delete-profile` | `handleAccountDeleteProfile` | — |
| POST | `/account/full-reset` | `handleAccountFullReset` | 계정 완전 삭제 시 Supabase user_profiles row도 함께 정리 (L1과 별도 저장소이므로 누락되면 pubkey_ed25519/ |

### 프로필 (`/profile/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| GET | `/profile/verify-owner` | `handleProfileVerifyOwner` | 서명 체계 — 전체 시스템이 서명 체계를 하나만 공유한다는 원칙. 2026-07-01: SP를 돌려주던 /profile/my-sp를 대체 — 이 |
| POST | `/profile/claim` | `handleProfileClaim` | 2026-07-12 — SP-18_ksearch STEP3 선행조건 (c): claim(정식 전환) 절차. profile POST보다 먼저 체크 |
| POST | `/profile/photo-upload` | `handleProfilePhotoUpload` | 2026-07-27 신설 — §IMAGE-SCAN으로 첨부된 사진(간판·메뉴판·사업자등록증 등)을 Cloudflare R2(`env.PROFILE_MEDIA`)에 저장. Ed25519 서명 인증, 5MB/jpeg·png·webp 제한 |
| GET | `/media/profile-photo/*` | `handleMediaGet` | 2026-07-27 신설 — 위에서 저장한 사진의 퍼블릭 서빙(인증 불필요). `/profile/*`는 아니지만 위 엔드포인트와 짝이라 여기 함께 기재 |
| ~~POST~~ | ~~`/profile/visibility`~~ | ~~`handleProfileVisibility`~~ | **엔드포인트 자체는 없음**(2026-07-20 커밋 6728a592가 무관한 목적으로 실수로 삭제 — git 히스토리로 확인). `is_public` 변경은 이제 일반 `/profile` POST로 처리되며, 그 안에 있던 `PROFILE_NOT_CLAIMED` 보호는 2026-07-27 `handleProfilePost`에 복원함. 상세는 §3.3 참고. |

### P2P 디렉토리(GDUDA) (`/p2p/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| POST | `/p2p/register` | `handleP2PRegister` | ── 사용자 P2P 등록/검색 (GDUDA Phase 1) ─────────────────── |
| GET | `/p2p/search` | `handleP2PSearch` | — |

### PDV (`/pdv/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| (코드확인필요) | `/pdv/query` | `handlePdvQuery` | ── PDV ────────────────────────────────────────────── |
| (코드확인필요) | `/pdv/report` | `handlePdvReport` | — |
| POST | `/pdv/consent-receipt` | `handleConsentReceipt` | §5 수신확인 3단계(sw.js push/notificationclick 훅이 호출) |

### PDV 동의 (`/consent/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| (코드확인필요) | `/consent/info` | `handleConsentInfo` | ── PDV 조회 동의 승인 페이지 (consent.html 전용, 2026-07-02 신설) ── |
| (코드확인필요) | `/consent/respond` | `handleConsentRespond` | — |

### 개인 AC (`/personal-ac/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| POST | `/personal-ac/call` | `handlePersonalAcCall` | ── 개인 AC 호출 프로토콜 (PERSONAL-AC-CALL-PROTOCOL_v1_0, 2026-07-15) ── 공무원 AC가 특정 시민의  |

### WebRTC 시그널링 (`/signal/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| (코드확인필요) | `/signal/send` | `handleSignalSend` | ── WebRTC 시그널링 (P2P 채팅 — OpenHash 철학) ────────── 메시지는 서버에 저장하지 않음 — 시그널(SDP/ICE) |
| (코드확인필요) | `/signal/poll` | `handleSignalPoll` | — |
| (코드확인필요) | `/signal/delete` | `handleSignalDelete` | — |

### 지갑 (`/wallet/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| POST | `/wallet/gdc-transfer` | `handleGdcTransfer` | 수수료 검증을 건너뛰므로 재사용에 적합하다(설계문서 docs/gdc_transfer_design_v0_1.md §2 참고). 크로스-L1 브릿지 |
| (코드확인필요) | `/wallet/x25519` | `handleWalletX25519Get` | v5.1: 토큰 기반 폐기 — Ed25519 서명(/biz/product와 동일 패턴)으로 전환 GET  : ?guid=... 만으로 조회 (저 |

### 재무원장 (`/ledger/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| GET | `/ledger/reconcile` | `handleLedgerReconcile` | 2026-07-18 신설 — 재무제표 대사. 설계문서 Phase 4. |
| GET | `/ledger/issuance-summary` | `handleLedgerIssuanceSummary` | 2026-07-18 신설 — 발행잔액 집계. 설계문서 Phase 5. |
| POST | `/ledger/dispute` | `handleTradeDisputeSubmit` | 2026-07-18 신설 — 거래 이의제기(사후 신고). 설계문서 Phase 3. |
| GET | `/ledger/dispute-queue` | `handleTradeDisputeQueue` | — |
| POST | `/ledger/dispute-resolve` | `handleTradeDisputeResolve` | — |

### 비즈니스(K-Market/GDC/보험 등) (`/biz/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| POST | `/biz/order` | `handleBizOrder` | — |
| POST | `/biz/gdc-deposit` | `handleGdcDepositCreate` | — |
| GET | `/biz/gdc-deposits` | `handleGdcDepositList` | — |
| GET | `/biz/fee-rate` | `handleFeeRate` | — |
| POST | `/biz/gdc-deposit-close` | `handleGdcDepositClose` | — |
| POST | `/biz/gdc-dao/proposal` | `handleGdcDaoProposalCreate` | — |
| POST | `/biz/gdc-dao/vote` | `handleGdcDaoVote` | — |
| GET | `/biz/gdc-dao/proposals` | `handleGdcDaoProposalsList` | — |
| POST | `/biz/ins-claim` | `handleInsClaimCreate` | (2026-07-18 신설 — K-Insurance 청구 접수. HONDI_GAP_REMEDIATION_DIRECTIVE v1.0 §2.1 참고 |
| GET | `/biz/ins-claims` | `handleInsClaimsList` | — |
| GET | `/biz/verify-admin` | `handleVerifyAdmin` | (2026-07-18 신설 — 플랫폼 공통 관리자 인증. HONDI_GAP_REMEDIATION_DIRECTIVE v1.0 §2.3 참고. ta |
| GET | `/biz/balance` | `handleBizBalance` | — |
| GET | `/biz/supply` | `handleBizSupply` | — |
| POST | `/biz/charge-request` | `handleChargeRequest` | (2026-07-14 신설: GDC 충전 파이프라인 — "고정계좌 + 입금자명 매칭") |
| GET | `/biz/charge-status` | `handleChargeStatus` | — |
| GET | `/biz/charge-list` | `handleChargeList` | — |
| POST | `/biz/charge-confirm` | `handleChargeConfirm` | — |
| POST | `/biz/phone-otp-request` | `handlePhoneOtpRequest` | (2026-07-15 신설: 전화번호 OTP — 가입 시 번호 소유 증명, 솔라피 연동) |
| POST | `/biz/phone-otp-verify` | `handlePhoneOtpVerify` | — |
| POST | `/biz/trade-rating` | `handleTradeRatingSubmit` | 2026-07-07: /biz/review(Supabase biz_reviews, 5점 척도) → 완전 대체. 실거래(tx_hash) 기반 tr |
| GET | `/biz/temperature` | `handleTemperatureQuery` | — |
| POST | `/biz/reservation` | `handleReservationCreate` | — |
| PATCH | `/biz/reservation/status` | `handleReservationStatus` | — |
| GET | `/biz/claims` | `handleClaimsList` | — |
| POST | `/biz/claims/ack` | `handleClaimsAck` | — |
| POST | `/biz/settle-ledger` | `handleSettleLedger` | — |
| GET | `/biz/financials` | `handleFinancialsGet` | — |
| GET | `/biz/tx-history` | `handleTxHistory` | — |
| POST | `/biz/ai-chat` | `handleAiChat` | ★ 2026-07-09 신설 — 짜장면 주문 사고실험 1단계: 프로필-to-프로필 AI 메시징(예: 손님의 AI가 식당의 AI에게 주문을 전달) |
| POST | `/biz/escalate` | `handleEscalate` | — |
| POST | `/biz/order-queue` | `handleOrderQueue` | ★ 2026-07-09 신설 — 짜장면 주문 사고실험 5·6단계: 주문 큐/주방 용량 판단 + 조리시간 추정. buildSystemPrompt가 |
| POST | `/biz/delivery-request` | `handleDeliveryRequest` | ★ 2026-07-09 신설 — 짜장면 주문 사고실험 7·8단계: 배송업체 검색+ 요청. LLM 없이 search_entities RPC + 순 |
| POST | `/biz/catalog/sync` | `handleCatalogSync` | ── K-Market 판매자 카탈로그(로컬 IndexedDB 원본 + L1 백업/공개미러) ── |
| POST | `/biz/catalog/hydrate` | `handleCatalogHydrate` | — |
| GET | `/biz/catalog` | `handleCatalogGet` | — |

### 비즈니스 (`/business/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| (코드확인필요) | `/business/relay` | `handleBusinessRelay` | — |

### 판매자 인증 (`/seller/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| POST | `/seller/verify-submit` | `handleSellerVerifySubmit` | 2026-07-18 신설 — 판매자 자격 확인(사업자등록증 첨부, 정부24 발급). 설계문서: docs/gdc_commerce_completio |
| GET | `/seller/verify-status` | `handleSellerVerifyStatus` | — |
| GET | `/seller/verify-queue` | `handleSellerVerifyQueue` | 2026-07-18 신설 — 판매자 인증 승인 절차(admin_guids 재사용). |
| POST | `/seller/verify-review` | `handleSellerVerifyReview` | — |

### 공공기관 연동 (`/gov/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| POST | `/gov/dept-task` | `handleDeptTaskCreate` | ── 부서/기관/사업자 간 업무지시 큐 (2026-07-12 신설, B그룹 대응) ── |
| (코드확인필요) | `/gov/relay` | `handleGovRelay` | — |
| (코드확인필요) | `/gov/task/submit` | `handleGovTaskSubmit` | — |
| (코드확인필요) | `/gov/task/batch-status` | `handleGovTaskBatchStatus` | — |
| (코드확인필요) | `/gov/dept-task/my-assignments` | `handleMyAssignments` | — |
| (코드확인필요) | `/gov/task/schema/draft` | `handleGovTaskSchemaDraft` | — |

### 관리자 (`/admin/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| POST | `/admin/login` | `handleAdminLogin` | ── Prompt Editor (관리자 — L1 prompt_admins 인증 + GitHub PR) ── |
| GET | `/admin/stats` | `handleAdminStats` | GET /admin/stats — 대시보드 통계 (HMAC 인증, L1 PocketBase 프록시) |
| GET | `/admin/tx-recent` | `handleAdminTxRecent` | (2026-07-15 신설) GET /admin/tx-recent — gdc.hondi.net 관리자 대시보드용 전체 최근 거래(admin/st |
| GET | `/admin/gov-task-drafts` | `handleGovTaskDraftList` | GET /admin/gov-task-drafts — 대기중 GOV_TASK draft 목록 (2026-07-12 위치 정정 — 기존엔 POST  |
| POST | `/admin/cf-dns` | `handleAdminCfDns` | POST /admin/cf-dns — Cloudflare DNS CNAME 추가 (CORS 우회 프록시) |
| POST | `/admin/users/bulk-delete` | `handleAdminBulkDelete` | POST /admin/users/bulk-delete — 관리자 일괄 삭제 (L1 + Supabase 9개 테이블 + KV) |
| POST | `/admin/default-key` | `handleAdminDefaultKeySet` | ── 디폴트 LLM 키 관리 ────────────────────────────────────── POST /admin/default-key   |
| POST | `/admin/prompt` | `handleAdminPromptSave` | — |
| (코드확인필요) | `/admin/gov-task-drafts/review` | `handleGovTaskDraftReview` | — |

### 오케스트레이션(SP 실행 엔진) (`/orchestration/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| (코드확인필요) | `/orchestration/project-state/save` | `handleProjectStateSave` | ── 오케스트레이션 project_state (2026-07-17 신설 — mode=project human_action 일시정지/재개, SP- |
| (코드확인필요) | `/orchestration/project-state/query` | `handleProjectStateQuery` | — |
| GET | `/orchestration/procedure-map` | `handleProcedureMapLookup` | AGENT-COMMON §0-H v3.40 / K-Compose SP-20이 참조. PROCEDURE_MAP· ORG_PROFILE·ATOM_R |
| GET | `/orchestration/benefit-candidates` | `handleBenefitCandidateSearch` | — |
| GET | `/orchestration/benefit-semantic-search` | `handleBenefitSemanticSearch` | 2026-07-16 신설 — 임베딩 기반 의미검색(bge-m3+Vectorize). 위 orchestration/benefit-candidate |
| POST | `/orchestration/benefit-embed-index` | `handleBenefitEmbedIndex` | — |
| POST | `/orchestration/procedure-map/draft` | `handleProcedureMapDraft` | — |
| POST | `/orchestration/procedure-map/update` | `handleProcedureMapUpdate` | — |
| GET | `/orchestration/org-profile` | `handleOrgProfileLookup` | — |
| POST | `/orchestration/org-profile/draft` | `handleOrgProfileDraft` | — |
| POST | `/orchestration/org-profile/update` | `handleOrgProfileUpdate` | — |
| POST | `/orchestration/atom-row/draft` | `handleAtomRowDraft` | — |
| POST | `/orchestration/atom-row/update` | `handleAtomRowUpdate` | — |
| POST | `/orchestration/execute-atom` | `handleExecuteAtom` | — |

### SP 저작 (`/sp-author/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| POST | `/sp-author/queue` | `handleSPAuthorQueue` | ── SP-Author 자동화 (2026-07-11 신설) ───────────────────────── |
| GET | `/sp-author/queue` | `handleSPAuthorQueueList` | — |
| POST | `/sp-author/escalate` | `handleSPAuthorEscalate` | — |
| GET | `/sp-author/escalations` | `handleSPAuthorEscalationList` | — |
| GET | `/sp-author/refresh-due` | `handleSPAuthorRefreshDue` | — |
| POST | `/sp-author/refresh-schedule` | `handleSPAuthorRefreshScheduleUpsert` | — |

### SP 자기갱신 (`/sp-updates/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| POST | `/sp-updates/propose` | `handleSpUpdatePropose` | ── SP 자기 갱신 제안 (2026-07-17 신설 — K-Intent v1.3/K-Compose v1.7/K-Deliver v1.3/K-Report v1.1). `sp_update_proposals`에 `status=pending_review`로만 저장, 절대 자동 승인 없음. `source=user_feedback`(사용자 피드백 기반)일 때 `proposed_patch`가 플레이스홀더가 아니면 `_l1CreateEscalation`로 `@owner` 알림도 신설(2026-07-27) |
| POST | `/sp-updates/draft-patch` | `handleSpUpdatesDraftPatch` | 2026-07-27 신설 — `tools/triage_feedback.py` 전용. 사용자 피드백 클러스터(quotes)+대상 SP 원문을 DeepSeek V4 Flash에 넘겨 실제 패치 초안을 생성(저장은 안 함, 순수 생성만 — 저장은 위 `/sp-updates/propose`가 담당) |

### GWP 프로토콜 (`/gwp/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| POST | `/gwp/register-key` | `handleRegisterKey` | — |

### GWP 레지스트리 (`/gwp-registry/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| GET | `/gwp-registry/lookup` | `handleGwpRegistryLookup` | ── gwp_registry (2026-07-11 신설) ────────────────────────────── |
| GET | `/gwp-registry/search` | `handleGwpRegistrySearch` | — |
| POST | `/gwp-registry/register` | `handleGwpRegistryRegister` | — |

### 서비스 등록 (`/svc/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| (코드확인필요) | `/svc/register` | `handleSvcRegister` | ── 서비스 등록 ─────────────────────────────────────── |
| (코드확인필요) | `/svc/verify` | `handleSvcVerify` | — |

### 푸시 알림 (`/push/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| POST | `/push/subscribe` | `handlePushSubscribe` | ── Push 알림 ─────────────────────────────────────────── |
| POST | `/push/send` | `handlePushSend` | — |
| GET | `/push/vapid-public-key` | `handlePushVapidKey` | — |
| POST | `/push/broadcast` | `handlePushBroadcast` | — |

### 피드백 (`/feedback/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| POST | `/feedback` | `handleFeedbackPost` | ── Feedback ───────────────────────────────────────────── |
| GET | `/feedback` | `handleFeedbackGet` | — |

### 통계 (`/stats/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| GET | `/stats/org` | `handleStatsOrgCompare` | GET /stats/org, /stats/agency-report — 준공개 통계 엔드포인트 (2026-07-14 신설, 회귀로 삭제됐다가 복구 |
| GET | `/stats/agency-report` | `handleStatsAgencyReport` | — |
| (코드확인필요) | `/stats/dept` | `handleStatsDeptCompare` | — |
| (코드확인필요) | `/stats/self` | `handleStatsSelf` | — |

### OpenHash 앵커링 (`/openhash/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| POST | `/openhash/anchor` | `handleOpenhashAnchor` | ── OpenHash 앵커링 프록시 ──────────────────────────────── buildout_plan_v2 Phase 1: 클 |
| GET | `/openhash/status` | `handleOpenhashStatus` | ── OpenHash ILMV 상태 조회 (Phase 5) ─────────────────────────────── |

### 머클 검증 (`/merkle/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| (코드확인필요) | `/merkle/verify` | `handleMerkleVerify` | ── merkle (T10) ───────────────────────────────────────── |

### 검색 (`/search/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| POST | `/search` | `handleSearch` | ── search (v4.7) ──────────────────────────────────── |
| (코드확인필요) | `/search/users` | `handleSearchUsers` | ── 사용자 검색 (GDUDA Phase 1) ────────────────────────── |

### 공공데이터 (`/public-data/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| GET | `/public-data/bdong-code` | `handleBdongCode` | ── 공공데이터포털: 법정동코드 (2026-07-16 신설) ──────────────── PUBLIC-DATA-PORTAL-INTEGRATIO |
| GET | `/public-data/law-search` | `handleLawSearch` | ── 공공데이터포털: 법령정보 목록 조회 (2026-07-16 신설) ────────── PUBLIC-DATA-PORTAL-INTEGRATION |
| GET | `/public-data/law-precedent` | `handleLawPrecedent` | ── open.law.go.kr: 판례 목록/본문 조회 (2026-07-16 신설) ──────── PUBLIC-DATA-PORTAL-INTEG |

### Kakao 연동 (`/kakao/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| (코드확인필요) | `/kakao/appkey` | `handleKakaoAppKey` | — |

### 템플릿 (`/template-lookup/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| POST | `/template-lookup` | `handleTemplateLookup` | profile-assistant SP의 [INDUSTRY_TEMPLATE_LOOKUP]/[PERSON_TEMPLATE_LOOKUP] 태그가 v2 |

### 임베딩 (`/embed-text/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| (코드확인필요) | `/embed-text` | `handleEmbedText` | — |

### 웹검색 (`/web-search/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| POST | `/web-search` | `handleWebSearch` | ── 웹검색(Serper.dev) (2026-07-11 신설) ──────────────────────── |

### TURN 서버 (`/turn/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| GET | `/turn/credential` | `handleTurnCredential` | ── TURN credential (coturn, RFC 8489) — _TURN_COTURN_PATCH_APPLIED_ ────── GET / |

### AI 설정 (`/ai-setup/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| (코드확인필요) | `/ai-setup/seal` | `handleAiSetupSealGet` | — |
| (코드확인필요) | `/ai-setup` | `?` | — |

### AI (`/ai/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| (코드확인필요) | `/ai/chat` | `handleAIChat` | — |

### LLM (`/llm/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| (코드확인필요) | `/llm/relay` | `handleLLMRelay` | — |

### 채팅 (`/chat/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| (코드확인필요) | `/chat/completions` | `callDeepSeek` | — |

### K-Law (`/klaw/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| (코드확인필요) | `/klaw/relay` | `handleKlawRelay` | — |

### 프롬프트 (`/prompt/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| GET | `/prompt` | `handlePromptGet` | — |

### 디버그 (`/debug/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| GET | `/debug/importance` | `?` | ── debug (진단용, 인증 불필요) ────────────────────────── |

### 기본 키 (`/default-key/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| GET | `/default-key` | `handleDefaultKeyGet` | — |

### 무료 한도 (`/free-quota-status/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| GET | `/free-quota-status` | `handleFreeQuotaStatus` | (2026-07-14: /free-quota-status 재도입 — "가입자당 100원 무료 한도" 정책으로 복귀. 한도값은 FREE_QUOTA |

### 사용량 로그 (`/usage-log/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| GET | `/usage-log` | `handleUsageLog` | (2026-07-14 신설) usage.html의 모델별·기간별 상세 내역용. |

### 사용자 피드백 (`/user-feedback/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| (코드확인필요) | `/user-feedback/submit` | `handleUserFeedbackSubmit` | — |

### 기타 API (`/api/*`)

| Method | Path | Handler | 설명(코드 주석 기반) |
|---|---|---|---|
| (코드확인필요) | `/api/stats/resolve` | `handleGovDataResolve` | ── 국가데이터처(KOSIS) 통계 리졸버 (2026-07-16 배선) ── |
---

## 3. 상세 스펙 — 우선순위 엔드포인트

### 3.1 인증

#### `POST /auth/issue` (7909줄, `handleIssue`)
로그인/토큰 발급의 핵심 진입점.
- **요청**: `{ guid, pubkey, signature, ts, level?='L0', svc?='*' }`
- **서명**: `auth-issue:${guid}:${pubkey}:${svc}:${ts}` — **재전송 방지 창 120초**(다른 대부분의 서명 엔드포인트가 300초인 것과 다름, 주의)
- **TOFU**: `_l1FindProfileByGuid`로 기존 pubkey와 대조. 핀이 없으면(최초 로그인) 통과시키고, 곧이어 호출되는 `/profile` POST가 핀을 기록(책임 분리)
- **응답**: `{ ok:true, guid, level, token }` + `Set-Cookie`(HttpOnly, `.hondi.net`) — 쿠키가 안 먹는 크로스도메인 상황 대비, 같은 토큰을 body에도 실어줌(`Authorization: Bearer` 용)

#### `GET /auth/verify` (7957줄, `handleVerify`)
쿠키(`gopang_token`) 검증. 응답 형식이 다른 엔드포인트와 다름: `{ valid:true, ipv6, level, svc, exp }` (⚠️ `ok` 필드 없음 — `data.ok`로 판단하는 클라이언트 코드는 여기서 오작동할 수 있음)

#### `GET /auth/refresh` (7958줄, `handleRefresh`)
만료 30분 이내(`remaining<=1800`)일 때만 갱신. 그 외엔 `{ ok:false, reason:'not_yet', remaining }`.

#### `GET /auth/webauthn/challenge` (7962줄, `handleWAChallenge`)
WebAuthn용 챌린지 발급. `GOPANG_MASTER_KEY`로 HMAC-SHA256 서명, 5분 유효.

---

### 3.2 계정

#### `POST /account/delete-profile` (10372줄, `handleAccountDeleteProfile`)
"경량 삭제" — **L1 profiles 레코드 하나만** 삭제. PDV·지갑 등 로컬 데이터는 그대로 남음(재가입 시 자연 연결).
- **요청**: `{ guid, phone?, ed25519_pubkey?, signature?, ts? }`
- **서명**: `delete-profile:${guid}:${ts}` — 등록된 키가 없으면 생략 허용
- **2차 확인**: `phone`이 저장값과 다르면 `PHONE_MISMATCH`로 거부(오조작 방지용 보조 장치)
- ⚠️ **발견된 이슈**: L1 DELETE 요청에 `Authorization: 'Admin ' + token`을 씁니다 — 이 파일의 다른 모든 admin 토큰 사용처(`_l1UpsertProfile` 등)는 `'Bearer ' + token`을 씁니다(참고: 예전엔 `handleProfileVisibility`도 이 예시 중 하나였으나, 2026-07-20 커밋 6728a592가 실수로 삭제 — §3.3 참고). 왜 여기만 다른지 확인이 안 됐습니다 — PocketBase가 실제로 `Admin` 스킴도 받아주는지, 아니면 이 두 엔드포인트가 지금 조용히 실패(404 아닌 401 등)하고 있는지는 **실제 삭제 테스트로 검증 필요**(계정 삭제라 함부로 테스트 못 해서 이번 조사에선 확인 못 함).

#### `POST /account/full-reset` (10425줄, `handleAccountFullReset`)
"완전 초기화" — L1 + KV(봉투)의 해당 guid 관련 데이터 전부 삭제 + 클라이언트도 로컬 데이터(PDV·지갑) 초기화 유도.
- **요청**: `{ guid, ed25519_pubkey?, signature?, ts? }`, 서명 대상 `full-reset:${guid}:${ts}`
- 내부적으로 `_deleteAllUserData(env, guid, l1Record)`(10462줄) 호출 — 여러 L1 컬렉션을 순회하며 개별 삭제(PocketBase는 Supabase의 IN 조건 배치 삭제가 없어 개별 처리)
- ⚠️ 같은 `'Admin '` 헤더 이슈(위 참고)
- ⚠️ **주석 낡음**: 함수 상단 주석이 "Supabase 9개 테이블도 삭제"라고 돼 있으나, 실제 코드엔 Supabase 호출이 전혀 없습니다(2026-07-19 grep으로 확인 — worker.js 전체에 살아있는 Supabase 참조 0건). 주석만 갱신 필요.

---

### 3.3 프로필

#### `GET /profile` · `POST /profile` (15046/15720줄, `handleProfileGet`/`handleProfilePost`) — **2026-07-27 줄번호·필드 갱신**
프로필 조회/생성·수정의 정식 경로. **`POST`는 `entity_type`/`name`/`pubkey`/`signature` 필수의 전체 upsert**입니다 — 다만 2026-07-27부터 `is_public`과 `finance`(`gdc_accepted`/`currencies`/`price_range`/`payout_account`)는 body에 해당 키가 없으면 기존 저장값을 그대로 보존하는 안전망이 생겼습니다(`job_ksco`/`affiliation`/`work_domain`/`industry_fields`/`products_structured`/`data_sources`/`avatar_url`/`photo_urls`는 이미 이전부터 같은 방식으로 보호되고 있었음) — 그 외 필드(`name`/`address`/`phone`/`website`/`description`/`tags`/`hours`/`holidays`/`entity_subtype`/`field_visibility` 등)는 여전히 body에 없으면 기본값으로 덮어써지므로 부분 수정 시 주의가 필요합니다. 자세한 배경은 [`PROFILE_ASSISTANT_MANUAL_v1_0.md` §6](./PROFILE_ASSISTANT_MANUAL_v1_0.md#6-profile-update-mode--완성된-프로필의-지속-갱신) 참고.
- 서명: `${guid}:${pubkey}:${ts}` (단, `_isFreshTs` 재전송-방지 체크는 **안 함** — 다른 서명 엔드포인트와 다른 점)
- `GET` 응답 필드: `guid, current_ipv6, handle, entity_type, native_lang, is_public, pubkey_ed25519, name, address, lat, lng, phone, website, casts_for, extra, updated_at, created_at` — `extra.public`엔 2026-07-27 신설 필드(`avatar_url`, `photo_urls`, `data_sources`)도 추가됨. `description`/`tags`/`hours` 등 다수 필드가 중첩된(flatten 안 된) 구조라, `POST` 바디를 만들 때 이 GET 응답을 그대로 재사용할 수 없습니다 — 클라이언트에선 `profile.html`의 `_buildProfilePostBodyFromCurrent()`가 이 변환을 담당합니다(부분 수정 시 표준 패턴 — 아래 참고).

#### `POST /profile/claim` (15518줄, `handleProfileClaim`)
관리자가 사전 등록한 "미청구(unclaimed)" 사업자 리스팅의 정식 소유권 확정. 서명 방식이 다름: `claim:${guid}:${pubkey}:${ts}` (앞에 `claim:` 접두어 — 다른 서명 엔드포인트와 혼동 주의). 전화인증 경로(`phone_verify_token`)도 대안으로 지원.

#### `POST /profile/photo-upload` (15644줄, `handleProfilePhotoUpload`) — **2026-07-27 신설**
§IMAGE-SCAN으로 첨부된 사진(간판·메뉴판·사업자등록증·이용약관 등)을 실제로 저장. 판독(텍스트 추출)과 완전히 독립적 — 하나가 실패해도 다른 하나엔 영향 없음.
- **요청**: `{ guid, pubkey, signature, ts, image_base64, mime_type }`
- **서명**: `${guid}:${pubkey}:${ts}` (다른 `/profile` 서명과 동일 체계 재사용)
- **제약**: jpeg/png/webp만, 디코딩된 원본 기준 5MB 상한
- **저장소**: Cloudflare R2(`env.PROFILE_MEDIA` 바인딩) — 배포 전 `wrangler r2 bucket create hondi-profile-media` 1회 필요. 바인딩이 없으면 `503 PHOTO_STORAGE_UNAVAILABLE`(프로필 작성 자체는 계속 진행 가능하도록 설계)
- 응답: `{ ok: true, url, key }` — `url`은 아래 `/media/profile-photo/*`로 서빙됨

#### `GET /media/profile-photo/{guid}/{filename}` (15698줄, `handleMediaGet`) — **2026-07-27 신설**
위에서 저장한 사진의 퍼블릭 서빙. **인증 불필요**(공개 프로필의 사진이라 누구나 볼 수 있어야 함). R2를 별도 커스텀 도메인으로 공개하지 않고 이 워커 자신이 유일한 진입점.

---

### 3.3-부록 — 부분 수정(patch) 표준 패턴: `/profile/visibility`는 더 이상 없습니다

**2026-07-27 확인·복원** — `handleProfileVisibility`라는 이름의 전용
엔드포인트는 더 이상 없습니다. `git log -S`로 추적한 결과, 2026-07-20
커밋 `6728a592`("Jejudo→gov-tree 경로 리네이밍")가 무관한 목적의
커밋임에도 이 함수 80줄과 라우트 등록을 실수로 함께 삭제한 것으로
확인됐습니다(해당 커밋의 worker.js diff가 6줄 추가/85줄 삭제인데, 6줄만
경로 리네이밍과 관련 있고 나머지 삭제분은 전혀 무관한 위치였음). 그
안에 있던 `PROFILE_NOT_CLAIMED`(관리자가 사전등록한 미청구 사업자
리스팅의 `is_public`을 아무나 바꿀 수 없게 막는 보호)도 같이 사라졌던
것을 이번 문서 갱신 작업 중 발견해 **`handleProfilePost`에 복원**했습니다
(별도 엔드포인트로 되살리지 않고, `is_public` 변경이 이제 일반 `/profile`
POST를 거치는 현재 구조에 맞춰 그 안에 재구현). "진짜 신규가입"(기존
레코드 자체가 없음)과 "관리자 사전등록 미청구 리스팅"(레코드는 있지만
`pubkey_ed25519`가 비어있음)을 구분해, 후자에서 `is_public`을 건드리려는
시도만 `403 PROFILE_NOT_CLAIMED`로 막습니다 — 신규가입 TOFU 흐름은
영향받지 않습니다(5가지 케이스 직접 시뮬레이션으로 검증 완료).

대신 부분 수정은 클라이언트 쪽 패턴으로 처리됩니다:

```js
// profile.html
function _buildProfilePostBodyFromCurrent(overrides = {}) {
  // 현재 로드된 _profile(GET /profile 응답)을 POST 바디 형태로 복원한 뒤
  // overrides로 필요한 부분만 덮어써서 전체를 다시 POST /profile로 제출
}
```

`is_public` 토글·계좌 정보 등록·예약 설정 변경 모두 이 헬퍼로 "현재
전체 상태 복원 → 원하는 필드만 override → 전체 재제출"합니다. 위
`handleProfilePost`의 2026-07-27 보존 안전망(§3.3 서두 참고)과 합쳐지면,
클라이언트가 실수로 일부 필드를 빠뜨려도(이 헬퍼를 안 거치고 직접
POST하는 경우 등) `is_public`/`finance`만큼은 서버에서도 보호됩니다.

---

### 3.4 PDV

#### `POST /pdv/query` (7355줄, `handlePdvQuery`)
동의 기반 PDV 조회 — 이 코드베이스에서 가장 정교한 접근제어 로직 중 하나.
- **요청**: `{ query: { svc, ipv6, scope: string[], period: {start, end}, purpose?, consent_token?, request_id?, official_access_cert? } }`
- **검증 순서**: ① `svc`가 `_getSvcRegistration`에 등록+PDV권한 있는지 ② `scope` 각각이 `VALID_PDV_SCOPES` 또는 `work_pdv:` 접두 패턴인지 ③ `period`가 12개월 이내인지 ④ 인증 레벨(L0~L3)이 scope별 최소요구레벨(`SCOPE_MIN_LEVEL`) 이상인지 ⑤ `consent_token`이 없으면 `202 CONSENT_REQUIRED` + 동의 URL 발급(사용자가 먼저 승인해야 함) ⑥ 있으면 `_verifyConsentToken`으로 검증 ⑦ Rate limit
- **공무원 조회 특례**: `query.official_access_cert`가 있으면(공무원이 시민을 대신 조회) `_verifyAccessCert`로 서명·만료·TOFU 검증 후 감사 로그에 `official_guid`/`org_id` 기록
- `work_pdv:{orgId}` scope는 일반 PDV와 다른 저장소(L1 `pdv_records`, 조직별 업무 PDV)를 조회

#### `POST /pdv/report` (7027줄, `handlePdvReport`)
PDV 기록 저장 — 6하원칙(who/what/why/how/where + svc/type) 구조의 report를 받아 L1 `pdv_records`에 기록. `record.js`의 `recordPDV()`/`_recordPDV()`(users·gopang 클라이언트 양쪽)가 이 엔드포인트를 호출(2026-07-19 `_recordPDV`도 이 경로로 통일됨 — 이전엔 Supabase 직접 INSERT였음).

#### `POST /pdv/consent-receipt` (핸들러: `handleConsentReceipt`)
동의 수신확인 3단계(`sw.js`의 push/notificationclick 훅 전용).

---

### 3.5 P2P 디렉토리 (GDUDA)

#### `GET /p2p/search` (10962줄, `handleP2PSearch`)
- **쿼리 파라미터**: `q`(닉네임/핸들 부분일치) 또는 `handle`(정확일치), `country`, `region`, `limit`(최대 50)
- L1 `profiles` 컬렉션 필터 쿼리로 직접 검색(PocketBase filter 문법) — Supabase `global_profiles` 시절의 완전 대체

#### `POST /p2p/register` (11019줄, `handleP2PRegister`)
GDUDA Phase 1 — HLR(Home Location Register) 역할의 사용자 등록.

---

### 3.6 관리자

#### `POST /admin/login` (14001줄, `handleAdminLogin`)
- **요청**: `{ email, password }` — L1 `prompt_admins` 컬렉션에 `auth-with-password`로 직접 인증(PocketBase 내장 인증 그대로 사용)
- 성공 시 `buildAdminToken`으로 별도 관리자 토큰 발급(30분), Prompt Editor(GitHub PR 연동) 전용

#### `POST /admin/users/bulk-delete` (4633줄 부근)
주석에 "L1 + Supabase 9개 테이블 + KV" 언급 — §3.2와 동일하게 **주석이 낡았을 가능성** 높음(실제 코드 재확인 필요, 이번 조사에서 본문까지는 안 읽음).

---

### 3.7 GDC/재무 관련 — `worker.js` vs `pb_hooks/main.pb.js` 역할 분담 주의

**중요**: GDC 발행(mint)·거래(tx)·잔액조회(balance)의 핵심 로직은 `worker.js`가 아니라 **`pb_hooks/main.pb.js`**(`/api/mint`, `/api/tx`, `/api/balance`, `/api/ai-charge`)에 있습니다. `worker.js`의 `/wallet/gdc-transfer`, `/biz/balance`, `/biz/order` 등은 이 pb_hooks 엔드포인트를 감싸거나 관련 처리를 하는 앞단입니다 — 실제 잔액 계산·이중지불 방지·해시체인 로직을 찾으신다면 `pb_hooks/main.pb.js`를 먼저 보세요(상세는 [`L1_POCKETBASE_MANUAL_v1_0.md` §4](./L1_POCKETBASE_MANUAL_v1_0.md)).

`/biz/*` 아래 35개 엔드포인트(K-Market 주문, GDC 입출금, 보험金 청구, 판매자 인증, DAO 투표 등)는 이번 조사에서 요약표(§2) 수준까지만 다뤘습니다 — 분량이 커서 다음 라운드에서 이어가는 걸 권장합니다.

---

### 3.8 서식 평가·보상 — `/doc-form/rate` · `/doc-form/stats` · `/doc-form/mine` · `/doc-form/reward-admin` (2026-10-17 신설)

구현: `src/worker/doc-form-reward.js`(핸들러), `src/worker/doc-form-reward-store.js`(PocketBase 어댑터). `worker.js`의 `handleDocFormRoutes`가 이 핸들러를 먼저 호출하고, 다루지 않는 경로는 기존 서식 DB 핸들러(`/doc-form/save`·`find`·`list`·`review` 등)로 넘긴다. 규칙·운영 절차는 [`DOC_FORM_REWARD_정책_20261017.md`](./DOC_FORM_REWARD_정책_20261017.md), 세션 배경은 [`SESSION_SUMMARY_DOCFORM_REWARD_MARINE_PILOT_20261017_v1_0.md`](./SESSION_SUMMARY_DOCFORM_REWARD_MARINE_PILOT_20261017_v1_0.md).

**서명 메시지는 엔드포인트마다 다르다**(§1.2와 같은 주의). 줄바꿈은 `\n`, `ts`는 밀리초이며 서버 시각과 `maxSkewMs` 이내여야 한다.

| 엔드포인트 | 서명 대상 메시지 |
|---|---|
| `/doc-form/rate` | `hondi-doc-form-rate\n${key_hash}\n${version}\n${rating}\n${ts}` |
| `/doc-form/mine` | `hondi-doc-form-mine\n${guid}\n${ts}` |
| `/doc-form/reward-admin` | `hondi-doc-form-reward-admin\n${action}\n${key_hash}\n${version}\n${kind}\n${ts}` |

서명은 L1에 핀된 공개키(`getPinnedPubKey`)로 검증한다. 오류 응답은 `{ ok:false, code, message }`.

#### `POST /doc-form/rate`
- **요청**: `{ key_hash(64자 hex), version(정수≥1), rating(1~5 정수), used:true, guid, ts, sig }` — `used`가 `true`가 아니면 `400 NOT_USED`(써 보지 않은 서식은 평가 불가).
- **응답**: `{ ok:true, counted, stats:{count, avg} }`. `counted:false`는 가입 7일 미만 계정이라 **저장은 됐지만 집계에서 제외**됐다는 뜻. 지급 여부·기여자·다른 평가자 정보는 돌려주지 않는다.
- **오류**: `400 MISSING|NOT_USED|STALE_TS`, `401 BAD_SIG`, `403 SELF_RATING`(본인 서식), `404 NO_ACCOUNT|NO_FORM`, `429 RATE`(하루 30건; 이미 평가한 서식의 수정은 제외), `500 INTERNAL`.
- 같은 평가자가 같은 (key_hash, version)을 다시 보내면 덮어쓴다(유일 인덱스: key_hash+version+rater).
- 평가를 저장한 뒤 `settle()`로 지급 조건을 점검한다. 점검이 실패해도 평가 응답은 성공으로 돌려준다(오류는 로그만).

#### `GET /doc-form/stats?keys=<key_hash>:<version>,…`
- 공개. 한 번에 최대 20개. 형식이 틀렸거나 없는 서식은 건너뛴다. `Cache-Control: public, max-age=60`.
- **응답**: `{ ok:true, stats:{ "<key_hash>:<version>": {count, avg} } }`(`avg`는 소수 첫째 자리). 집계에는 인정 평가만 들어간다.

#### `POST /doc-form/mine`
- **요청**: `{ guid, ts, sig }`. 본인 서명으로만 열린다.
- 본인이 올린 서식(최대 50건)에 대해 version 1이면 `settle()`을 한 번 돌린 뒤 돌려준다.
- **응답**: `{ ok:true, rewardsEnabled, items:[{ keyHash, version, agency, name, savedTs, rewardEligible, stats:{count,avg}, rewards:[{kind, status, amountKrw, paidTs}] }] }`. `rewardsEnabled`는 `DOC_FORM_REWARD_KRW > 0` 여부.

#### `POST /doc-form/reward-admin`
- **요청**: `{ action:'void'|'retry', key_hash, version, kind:'qualified'|'excellent', guid, ts, sig }`. 서명자는 운영자(`DOC_FORM_ADMINS`)여야 한다(`403 NOT_ADMIN`).
- `void`: 보상 기록을 무효로 바꿔 이후 지급하지 않는다. `retry`: 운영자가 L1 원장에서 **실제로 지급되지 않았음을 확인한** `failed`/`unknown` 건의 재시도 횟수를 비우고 다시 점검한다.
- 상태가 `paid`·`minting`이면 `409 ALREADY` — 바꿀 수 없다.

#### 지급 (`_mintFormReward`)
- L1 `${L1_DEFAULT}/api/mint`에 `{guid, krw_amount, secret, memo}`를 보낸다(`memo`: `form_reward:<kind>:<key_hash 앞 12자>:v<version>`). 수취인 guid는 `_l1FindProfileByPubkey`로 기여자 공개키에서 찾는다.
- L1이 **명시적으로 거절**하면 `{ok:false}` → 보상 `failed`(5분 간격 최대 3회 재시도). 응답을 읽지 못하거나 네트워크 오류면 예외 → 보상 `unknown`(자동 재시도 안 함 — 이중 지급 방지).
- 환경변수: `DOC_FORM_REWARD_KRW`(양수일 때만 지급), `DOC_FORM_ADMINS`(운영자 목록, 기존 서식 검토에서 쓰는 것과 같다).
- 로그: 지급 성공 시 `{"tag":"DOC_FORM_REWARD_PAID",…}` 한 줄, 응답 불명 시 `[DocFormReward] mint 응답 불명 …`.
