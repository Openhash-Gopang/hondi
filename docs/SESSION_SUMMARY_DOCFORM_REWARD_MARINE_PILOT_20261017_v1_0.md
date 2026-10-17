# 세션 기록 — 도선사 서류 조사 반영(SP_marine-pilot v3.5) · 서식 공유·평가·GDC 보상 알고리즘(SP_DOC_FORM v1.3) (2026-10-17)

> 관련 문서: [`WORKLOG_INDEX.md`](./WORKLOG_INDEX.md)(전체 작업 기록 지도) ·
> 정책·규칙 정본 [`DOC_FORM_REWARD_정책_20261017.md`](./DOC_FORM_REWARD_정책_20261017.md) ·
> 조사 원자료 [`research/도선사_서류_조사_20261017.md`](./research/도선사_서류_조사_20261017.md) ·
> 엔드포인트 명세 [`API_REFERENCE_worker_v1_0.md`](./API_REFERENCE_worker_v1_0.md) §3.8
>
> 반영: PR #647 (main 병합). 이 문서는 그 변경이 **무엇이고, 왜 그렇게 했고, 무엇을 아직 모르는지**를 적은 것이다.
> 규칙 수치의 정본은 코드(`REWARD_RULES`)이며 이 문서는 사본이다.

## 0. 범위

이 세션은 세 덩어리다.

1. **도선사 서류 조사 → SP 반영** — 도선법·시행규칙이 요구하는 서류를 조사해 `docs/research/`에 남기고, `SP_marine-pilot`을 v3.4 → v3.5로 올렸다.
2. **서식 공유·평가·보상 알고리즘(전 직역 공통)** — 이용자가 올린 서식을 다른 이용자가 활용하고 평가할 수 있게 하고, **처음 올린 사람**이 **다른 이용자들의 높은 평가**를 받으면 GDC를 지급한다. `SP_DOC_FORM` v1.2 → v1.3.
3. **전달 경로 문제 해결** — 이 환경은 GitHub push가 403이라 zip + PowerShell로 전달했고, 그 과정에서 생긴 문제와 수정(§7).

앞선 세션(같은 날 이전)의 전문가 페이지 정비(PR #637·#638)와 K-Law v15.1 이식(PR #642, 10개 직역)은 여기서 다시 다루지 않는다.

## 1. 도선사 서류 조사와 SP_marine-pilot v3.5

- 출처는 도선법·시행규칙 정리본(nepla.ai). **법제처 원문과는 아직 대조하지 않았다** — 조문·별지 번호는 정리본 기준이다.
- 법정 서식 6종(별지 번호·첨부·기한 포함)과 도선법상 의무 표를 `docs/research/도선사_서류_조사_20261017.md`에 정리했다.
- **확인하지 못한 것**(조사 문서 "미확인" 절): 도선기록부·도선수첩·사고 보고서 서식, 별지 서식의 칸 구성, 도선료 신고 주체, 별지 제10호 번호가 신청서와 면제증에 중복 표기된 점.
- `prompts/SP_marine-pilot_v3_5.md`: 순수 추가만(v3.4 대비 삭제 0줄, 1행 버전 표기 제외). STEP C "서류 초안 요청 처리", "부록 A — 도선 서류 카탈로그"(A-1 법정 서식, A-2 관행 서류, A-3 면허 관리 일정표, A-4 부록에 없는 서류는 SP_DOC_FORM §8로)를 넣었다. §LEGAL-LIMIT·C5·C33-2 등 상위 규칙은 완화하지 않는다.
- 카탈로그(`sp-catalog.json`, `sp-catalog-categories.json`)·`pages/expert-personas.html`·`pages/professional-ai.html`·`data/expert-persona-index.json`·`src/tests/sp_klaw_v151_hooks.test.js`의 참조를 새 파일명으로 옮겼다.

## 2. 서식 공유·평가·보상 — 설계

기존 서식 DB(`doc_forms`, `[FORM_LOOKUP:]`/`[FORM_SAVE_PROPOSAL:]` 태그)를 그대로 쓰고, 그 위에 평가와 보상을 얹었다.

| 단계 | 동작 |
|---|---|
| 게시 고지 | 저장 동의 카드에 "이 직역 전문가 페이지에 게시되어 다른 이용자가 활용한다", "처음 올린 서식은 조건 충족 시 GDC 보상 가능(보장 아님)"을 표시 |
| 활용 | 전문가 페이지 「이용자가 알려 준 서식」 목록에 게시(7일간 "새 서식" 표시, 평가 요약), 채팅에서 서식 이름을 말하면 서식 DB 조회 |
| 평가 | 서식으로 서류를 만든 뒤 평가 카드(1~5점) → 지갑 서명으로 `POST /doc-form/rate` |
| 점검(settle) | 평가가 들어올 때, 그리고 기여자가 「내 서식 현황」을 열 때 서버가 지급 조건 점검 |
| 지급 | 조건 충족 + `env.DOC_FORM_REWARD_KRW > 0` → L1 `/api/mint`로 기여자에게 지급(`memo: form_reward:…`) |

### 2.1 규칙(요약 — 정본은 `REWARD_RULES`와 정책 문서)

- 보상은 **version 1 기여자**만, 출처가 `user_attached`인 서식만. AI가 구성한 서식(`ai_composed`)과 운영자(`DOC_FORM_ADMINS`)가 올린 서식은 제외. 같은 본문이 다른 키로 먼저 저장돼 있으면 제외.
- 기본 보상: 인정 평가자 ≥5명, 보정 평균 ≥4.0, 4~5점 비율 ≥70%. 우수 보상(같은 액수 1회 추가): ≥20명, ≥4.5, ≥85%.
- 보정 평균 = (점수 합 + 3×2) ÷ (평가 수 + 2).
- 인정 평가: 가입 7일 이상, 본인 서식 아님, 상호 평가 아님(기여자가 그 평가자의 서식을 평가한 적 없음), 평가자당 서식 1표(다시 누르면 덮어씀). 가입 7일 미만 평가는 **저장은 하되 집계에서 제외**(`eligible` 플래그, 평가 시점에 계산).
- 저장 후 72시간 대기. 평가자 하루 30건, 기여자 30일 10건.
- **금액은 `env.DOC_FORM_REWARD_KRW`**(1:1 시험 환율). 0이거나 없으면 평가·집계만 하고 지급하지 않는다. 켜는 순간 이미 조건을 넘긴 서식에도 소급 지급된다.

### 2.2 이중 지급 방지

- 보상 원장 `doc_form_rewards`는 (key_hash, version, kind) 유일 인덱스. 동시에 두 점검이 돌아도 보상 기록은 하나(`CONFLICT`를 흡수).
- 상태: `minting` → `paid` / `failed` / `unknown` / `void`.
  - `failed`: L1이 **명시적으로 거절**. 5분 간격 최대 3회 자동 재시도.
  - `unknown`: mint 응답을 받지 못함(네트워크 끊김·시간 초과). **자동 재시도 안 함** — 실제로는 지급됐을 수 있어서다. 운영자가 L1 원장을 확인한 뒤 `reward-admin`의 `retry` 또는 `void`.
  - `paid`·`minting`은 운영자도 바꿀 수 없다.
- 월 한도(`countSince`)는 `void`·`failed` 건을 세지 않는다.

### 2.3 설계 선택과 이유

- **서명 인증**: 기존 서식 저장과 같은 Ed25519 지갑 서명. 서명 메시지 세 종류는 서로 다르며 섞어 쓰면 안 된다(API 레퍼런스 §3.8).
- **평가자에게 지급 여부를 알리지 않는다** — 평가가 보상 흥정이 되지 않도록.
- **공개 응답에는 기여자·평가자 식별자가 없다** — 평가 수와 평균만.
- **AI 지침(SP_DOC_FORM §8-5·8-6)**: AI는 평가를 유도하거나 특정 점수로 몰지 않고, 보상을 단정하는 표현(“보상받으실 수 있습니다” 등)을 쓰지 않는다. 고지는 화면 카드가 담당한다.

## 3. 변경된 파일

| 구분 | 파일 |
|---|---|
| 서버 | `src/worker/doc-form-reward.js`(규칙·순수 계산·핸들러), `src/worker/doc-form-reward-store.js`(PocketBase 어댑터), `src/worker/doc-form-store.js`(`earlierSameBody`·`listByContributor` 추가), `worker.js`(핸들러 연결 + `_mintFormReward`) |
| DB | `pb_migrations/1794900001_created_doc_form_ratings.js`, `1794900002_created_doc_form_rewards.js` — **병합 시 `deploy-pb-migrations`가 L1에 자동 적용** |
| 클라이언트 | `src/gopang/ai/doc-form-client.js`(`rateForm`·`fetchStats`·`fetchMine`·고지문), `pages/expert-chat.html`(평가 카드·내 서식 현황·저장 카드 고지), `assets/expert-shared-forms.js`(전문가 페이지 평가 열 대신 이름 칸 안에 표시 — 모바일에서 4열 유지) |
| SP | `prompts/SP_DOC_FORM_v1_3.md`, `prompts/SP_marine-pilot_v3_5.md` + 카탈로그·인덱스 참조 갱신 |
| 테스트 | `src/tests/doc-form-reward.test.mjs`(33건), `doc-form-reward-store.test.mjs`(17건, 배선·문서 수치 일치 정적 검사 포함) |
| 문서 | `docs/DOC_FORM_REWARD_정책_20261017.md`, `docs/research/도선사_서류_조사_20261017.md`, 이 문서 |

`worker.js`는 `handleDocFormRoutes`를 비동기로 바꿔 평가·보상 핸들러가 먼저 경로를 가져가게 하고, 나머지는 기존 서식 DB 핸들러로 넘긴다. 지급은 `${L1_DEFAULT}/api/mint`에 `{guid, krw_amount, secret, memo}`를 보내며, 수취인 guid는 `_l1FindProfileByPubkey`로 찾는다(가입 보너스 `_grantSignupBonus`와 같은 경로).

## 4. 데이터 모델

- `doc_form_ratings`: key_hash, version, rater(공개키), rating(1~5), eligible, form_contributor, ts, sig. 유일 (key_hash, version, rater).
- `doc_form_rewards`: key_hash, version, kind(`qualified`/`excellent`), contributor, amount_krw, status, attempts, attempt_ts, gdc, mint_hash, paid_ts, error, stats, ts. 유일 (key_hash, version, kind).
- 두 컬렉션 모두 접근 규칙이 null(관리자 토큰으로만 접근) — 기존 `doc_forms`와 같은 방식.

## 5. 운영 절차

1. **병합 직후**: GitHub Actions `deploy-pb-migrations`가 성공했는지 확인. 실패하면 `/doc-form/rate`가 오류를 낸다.
2. **지급 켜기**: Cloudflare Worker 환경변수 `DOC_FORM_REWARD_KRW`를 0보다 큰 정수로 설정. 설정 전에 아래 §6의 미결정 사항을 먼저 정할 것.
3. **`unknown` 처리**: 운영자가 L1 원장에서 해당 `memo form_reward:…` 거래가 있는지 확인 → 없으면 `retry`, 있으면 `void`가 아니라 원장과 맞춰 기록을 정리(현재 `paid`로 바꾸는 경로는 없음 — 필요하면 추가 개발).
4. **부정 의심**: `reward-admin`의 `void`로 지급 전 보상을 무효화. 지급 완료(`paid`)분은 되돌리는 경로가 없다.

## 6. 미결정 사항 (소유자 판단 필요)

- `DOC_FORM_REWARD_KRW` 금액과 시행 시점(켜면 소급).
- **GDC 신규 발행**이 `GDC_POLICY`의 발행 한도·인플레이션 방침과 맞는지.
- **여러 계정·품앗이 평가 방어**: 현재는 가입 7일·상호 평가 제외·72시간 대기가 전부다. 지급액이 커지면 평가자 전화 인증 등을 추가해야 한다.
- 개정본(v2+) 기여자와 `ai_composed` 서식에 보상할지.
- 지급 전 운영자 `reviewed` 상태를 요구할지.
- 기준선부터 실패 중인 CI `check_no_hardcoded_sp_refs`(SP-24* 파일)는 이번 변경과 무관하며 그대로다.

## 7. 검증 상태와 전달 중 겪은 문제

### 7.1 검증한 것
- 단위·정적 테스트 50건 추가, 관련 449건 통과(1건 건너뜀: 이 환경에 `python3` 없음). 전체 실행에서 실패 43건은 기준선과 동일.
- Playwright로 평가 카드, 저장 카드 고지, 「내 서식 현황」, 전문가 페이지 목록 표시를 화면에서 확인.
- 전달 zip이 깨끗한 체크아웃에 적용되어 검증한 트리와 같은 결과(LF·CRLF 양쪽의 `worker.js` 포함)가 나오는 것을 확인.

### 7.2 검증하지 못한 것
- 실제 PocketBase·L1 `/api/mint` 연동, 실제 지갑 서명 창, 실제 AI가 SP_DOC_FORM §8-5·8-6을 따르는지, 운영 배포 후 동작.
- 도선법 조문·별지 번호의 정확성(법제처 원문 대조 전).

### 7.3 전달 중 겪은 문제 (재발 방지용)
- **`git apply`가 사용자 PC의 `worker.js`에 적용되지 않음**(`patch failed: worker.js:22`). 원인은 확정하지 못했다. → `worker.js`는 통째로 보내지 않고, 앵커 두 곳(import 줄, 옛 `handleDocFormRoutes`)을 찾아 바꾸는 Node 스크립트(`apply-worker-edit.mjs`, 줄바꿈 보존·멱등·`--check` 지원)로 연결했다. 앵커가 없으면 아무것도 쓰지 않고 멈춘다.
- **PowerShell 콘솔에 붙여 넣는 블록**은 줄이 하나씩 실행된다. `return`으로는 멈출 수 없고, 괄호 안에 `;`로 두 문장을 넣으면 구문 오류가 나며 그 뒤 줄이 각각 실행된다. 이번에 이 오류로 커밋이 `main`에 먼저 만들어졌고(푸시 전이라 피해 없음), 기존 브랜치를 `--ff-only`로 맞춰 올려 해결했다. 앞으로 붙여 넣는 블록은 **`if … else`로 감싼 단일 구문**으로 쓰고, 조건식 안에는 단일 명령만 둔다.
- **사용자 PC에서만 실패한 테스트**: `sp_klaw_v151_hooks.test.js`의 행정사 항목("직전 버전과 비교해 삭제된 줄")이 643줄 전부 다르다고 나왔다. 이번 변경에 들어 있지 않은 파일이고 이 환경에서는 통과하므로 로컬 줄바꿈(CRLF) 문제로 추정하지만 **확인하지 못했다.** CI는 LF 환경이라 영향이 없을 것으로 본다. 재발하면 `prompts/SP_administrative-scrivener_v1_1.md`·`v1_2.md`의 CR 개수를 먼저 확인할 것.
- 테스트 디렉터리 지정(`node --test src/tests/`)은 이 Node 버전에서 동작하지 않아 파일을 명시했다.
- 테스트 중 발견·수정한 결함: (a) 테스트용 메모리 보상 저장소의 동시 점검 경합(운영에서는 PocketBase 유일 인덱스가 막음), (b) PocketBase 어댑터가 400을 전부 `CONFLICT`로 취급해 **검증 실패로 보상이 영영 지급되지 않을 수 있던 문제** → 400 이후 행이 실제로 있는지 재확인하고, 없으면 오류로 올린다.

## 8. 다음에 이어서 할 일

1. 병합 후 `deploy-pb-migrations` 결과 확인, 실환경에서 평가 → 집계 → (지급 켠 뒤) mint 한 건 시험.
2. §6 미결정 사항 결정 후 `DOC_FORM_REWARD_KRW` 설정.
3. 도선법 조문·별지 번호를 법제처 원문과 대조하고, 조사 문서의 "미확인" 항목(도선기록부 등)을 채울 것.
4. `unknown` 건을 `paid`로 정리하는 운영 경로가 필요한지 검토.
