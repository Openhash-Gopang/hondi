# profile-assistant(PA) 완전 매뉴얼 v1.0

> **작성일**: 2026-07-27 · **대체 대상**: `docs/pa_update_roadmap_v1.md`,
> `docs/pa_dialogue_simulation_10cases_v1.md`,
> `docs/pa_identity_template_thought_experiment_v1.md`,
> `docs/user_profile_authoring_guidelines_v1_0.md`(모두 산발적 설계/사고실험
> 메모, `docs/archive/`로 이동 검토 대상), `docs/PROFILE_REGISTER_HANDOVER_v2.md`
> (2026-06-15 — 지금은 없어진 `register-profile.html` 단독 페이지 구조를
> 설명하는 완전히 낡은 문서, 대화형 PA 탭 구조와 무관)
> **메타 매뉴얼**: [`docs/MANUAL_INDEX.md`](./MANUAL_INDEX.md)
> **일회성 작업 기록**: 오늘 하루 전체 작업 경과는
> [`docs/WORKLOG_MANUAL_2026_07_27.md`](./WORKLOG_MANUAL_2026_07_27.md) 참고
> (이 문서는 "지금 어떻게 동작하는가"만 다룹니다 — 시간순 기록이 아닙니다).
> **⚠ 2026-07-29 정정**: 아래 본문의 `AGENT-COMMON`(AC — 메인 비서)은
> 이후 `AC-SHADOW-CORE`/`AC-PRO-CORE`/`AC-FLASH-EXECUTOR`로 교체됐습니다.
> `prompts/AGENT-COMMON_v3_48.txt` 같은 구체적 파일 경로 언급은 더 이상
> 유효하지 않습니다 — 현재 AC-PA 연동이 어느 파일 기준인지는 재검증
> 필요.

이 문서는 profile-assistant(PA — 나비 프로필 작성·갱신 담당 AI)와 AGENT-COMMON
(AC — 메인 비서)의 협업 구조를 2026-07-27 기준으로 다룹니다. `docs/manual/`
6부작이 코드베이스 전반을 다루는 것과 달리, 이 문서는 PA 하나에 집중합니다 —
그만큼 오늘 하루 사이 실질적인 서브시스템으로 커졌기 때문입니다.

---

## 1. 전체 아키텍처

### 1.1 PA는 별도 탭이다 (2026-07-11 리팩터링)

PA는 AC와 **같은 창의 history를 공유하지 않는 별도 브라우저 탭**입니다
(`pages/profile-assistant.html`, `url: '/pages/profile-assistant.html'`,
`gwp-registry.js`의 `id: 'profile-assistant', type: 'tab'` 참조). 예전엔
같은 탭 안 오버레이(system 교체 방식)였으나, 튜토리얼 대본이 실제 사용자
지시를 가로채는 사고 이후 분리됐습니다. **이 사실 하나가 이 문서 나머지
전체의 전제입니다** — PA가 뭘 알고 뭘 모르는지는 전부 "탭 경계를 넘어
명시적으로 전달됐는가"로 결정됩니다.

AC가 PA를 여는 방법은 `[GWP: profile-assistant]` 태그 하나뿐입니다
(`call-ai.js`의 `_parseAgentTags` → `_gwpLaunch()` → `window.open()`).

### 1.2 SP 로드 — 매 세션 fresh fetch

PA의 시스템 프롬프트는 `prompts/sp-catalog.json`의 `"profile-assistant"` 키가
가리키는 파일(현재 `profile-assistant/profile-assistant-v2_20.txt`)을 매
세션 시작 시 그대로 fetch합니다(`config.js`의 `loadPersonalAssistantSP()`).
같은 함수가 `HONDI-CAPABILITIES-COMMON_v1_0.md`(§5 참조)도 함께 fetch해
PA SP 앞에 합성합니다 — PA SP 파일 자체엔 "실재하는 도구" 목록을 프로즈로
박아두지 않습니다(과거 그렇게 했다가 드리프트가 난 전례 때문 — §5 참조).

### 1.3 STEP 흐름 (PHASE 0/1, 총 6단계 + 조건부 STEP3C)

```
PHASE 0 (세션 시작 즉시 분기)
  ├─ done=true  → §PROFILE-UPDATE-MODE(§6 참조)
  ├─ skipped/step>0 → 이어서 진행
  └─ step=0, 신규 → PHASE 1 시작

PHASE 1
  [1/6] STEP1  기본 식별(entity_type 등)
  [2/6] STEP2  핵심 정보(유형별) — §TEMPLATE-REFERENCE로 동종업계 참조
  [3/6] STEP3  GDC 결제 수락 여부
  [4/6] STEP3A 계좌 이체 결제 지원(§4 참조)
  [5/6] STEP3B 예약 수락 여부(confirm_mode 기본값 결정 — §4 참조)
        STEP3C 업무 자동화(조건부, Tier3면 스킵)
  [6/6] STEP4  공개 여부 → STEP-FINAL(PROFILE_SUBMIT)
```

각 STEP은 `[CONTEXT]`에 해당 값이 이미 있으면 건너뜁니다 — 이 스킵 로직
하나가 "이어서 하기"와 "완성된 프로필 갱신"(§6) 양쪽에 재사용됩니다.

---

## 2. 사진 처리 (§IMAGE-SCAN + 실제 저장)

### 2.1 판독 — PA가 사진에서 값을 읽어 필드를 채움

`§IMAGE-SCAN`(profile-assistant SP)은 사진 종류를 스스로 판단해(메뉴판·
사업자등록증·명함·이용약관 등, 되묻지 않음) 값을 즉시 `[PARTIAL_SAVE]`로
저장합니다. 이용약관·안전수칙류 문서는 원문을 베끼지 않고 방문자가 알아야
할 핵심만 2~4문장으로 재구성해 `industry_fields.notice_text`(+ 명확하면
`min_age`)에 담습니다 — 이용자 본인의 서명·개인정보는 추출 대상이
아닙니다.

### 2.2 저장 — 사진 자체를 R2에 업로드

판독과 완전히 독립적으로, 사진이 첨부되는 즉시(`_onPhotoAttached`,
`pages/profile-assistant.html`) `POST /profile/photo-upload`(Ed25519 서명
인증)로 Cloudflare R2(`env.PROFILE_MEDIA` 바인딩)에 올라갑니다. 세션 첫
사진이 아바타 후보, 전체가 갤러리(`photo_urls`)가 됩니다. 하나가 실패해도
다른 하나엔 영향 없습니다(판독 실패해도 저장은 계속, 저장 실패해도 판독은
계속).

퍼블릭 서빙은 `GET /media/profile-photo/{guid}/{filename}`(인증 불필요 —
공개 프로필의 사진이므로) — R2를 별도 커스텀 도메인으로 공개하지 않고
워커 자신이 유일한 진입점입니다.

`profile.html`이 `avatar_url`(원형 아바타)과 `photo_urls`(사진 갤러리
카드)를 렌더링합니다.

**한계**: 상품별 개별 사진 매칭은 없습니다 — 세션 전체 사진을 하나의
갤러리로만 취급합니다(메뉴판 한 장에 여러 상품이 찍혀도 상품마다 사진을
따로 연결하지 않음).

---

## 3. 결제 수단 (GDC + 계좌 이체)

STEP3(GDC)과 STEP3A(계좌 이체)는 **업종과 무관하게 모든 사업자·기관·
단체에 동일하게** 적용되는 원칙입니다(2026-07-27 — "업종별 예외를
나열하지 말고 원칙으로" 지시 반영). 계좌 정보는
`payout_account: {bank_name, account_number, holder_name}`로 저장되고,
`profile.html`이 "📋 계좌번호 복사" 버튼으로 공개 표시합니다.

**confirm_mode 결정 원칙**(STEP3B, v2.15~2.19에 걸쳐 정착):
- GDC 수락 → `confirm_mode: "auto"`(즉시 자동 정산되므로)
- GDC 미수락 + 계좌이체 등록 → `"manual"`
- 둘 다 미수락(현금 결제만) → `"manual"`(v2.19 — 이 케이스가 원래
  누락돼 있었음)

원칙은 하나입니다: **"이 업종이라서"가 아니라 "이번에 선택한 결제수단이
즉시 확인 가능한지"**로 판단합니다.

---

## 4. §DIGITAL-BRIDGE — 아날로그→디지털 전환 제안

사용자가 "종이로/수기로/전화로만" 같은 아날로그 절차를 언급하면, 업종별
대본이 아니라 **원칙**("이 사람이 지금 아날로그로 하는 일 중 나비가 이미
가진 도구로 대체할 수 있는가")으로 판단해 자연스러운 순간에 1회만
제안합니다.

**절대 원칙**: 실재하지 않는 기능을 있다고 말하지 않습니다. 이 판단의
근거가 `HONDI-CAPABILITIES-COMMON_v1_0.md`(§1.2에서 합성됨)입니다 — "실재
하는 도구" 목록과 "아직 없는 것" 목록을 명시적으로 나눠 관리합니다. 이
목록은 **`tools/check_capabilities_registry.py`가 매 배포·매일 CI로 실제
코드와 대조**합니다(`검증-서버:`/`검증-클라이언트:` 줄 → 파일::문자열 대조,
`tools/check_wallet_sync.py`와 동일 철학 — 자기보고 불신, 실측). 목록에
없는 아이디어는 `[USER_FEEDBACK: ..., category=feature_request]`로
기록만 하고(§7 참조) 확정 약속하지 않습니다.

---

## 5. HONDI-CAPABILITIES-COMMON — 단일 소스 원칙

`prompts/HONDI-CAPABILITIES-COMMON_v1_0.md`는 "나비가 지금 실제로 할 수
있는 것"의 유일한 소스입니다. 이 문서가 필요했던 이유: PA SP 안에 이
목록을 프로즈로 직접 박아뒀다면, `call-ai.js`와 `pages/profile-assistant.html`이
`[TEMPLATE_LOOKUP]` 태그를 두고 서로 다른 사본을 갖다가 한쪽만 갱신되며
갈라졌던 것(§8 참조)과 똑같은 드리프트를 반복했을 것입니다.

새 기능을 추가하면 **반드시** 이 문서에 `검증-서버:`/`검증-클라이언트:`
줄을 실제 파일 경로·문자열로 추가하세요 — 그래야 CI가 계속 대조합니다.

---

## 6. §PROFILE-UPDATE-MODE — 완성된 프로필의 지속 갱신

PA는 한 번 완성으로 끝나지 않습니다. AC(§0-1-P[11], `AGENT-COMMON`)가
대화 중 프로필과 어긋나거나 확장하는 정보를 감지하면 자연스럽게 갱신을
제안하고, 승인 시 **새 태그 없이** 기존 `[GWP: profile-assistant]`를
그대로 씁니다 — 승인 직전 AC의 응답 원문이 자동으로 새 탭의 `ctx`
파라미터로 전달되는 기존 배관(`_gwpLaunch`)을 재사용하기 때문입니다.

PA(`pages/profile-assistant.html`)는:
1. `ctx`/`ctx_enc` URL 파라미터를 디코딩해 `[CONTEXT: PROFILE_UPDATE_HINT]`로 반영
2. `done=true`면 `_fetchExistingProfileForUpdate()`로 서버의 실제 현재
   프로필을 인증 조회(뷰어 서명, `profile.html`과 동일 패턴)해
   `_existing_*` 필드로 `[CONTEXT]`에 실음

**유실 방지 원칙**: "언급 안 된 필드는 그대로 유지"가 원칙입니다 —
`_existing_finance`(계좌 포함)·`_existing_industry_fields`(예약·자동화·
notice_text 포함) 등은 이번 대화에서 다시 안 나왔으면 그대로 복사해
재제출합니다. 이건 프롬프트 지시에만 의존하지 않고, **서버(`worker.js`
`handleProfilePost`)에도 안전망이 있습니다** — `is_public`/`finance`
(payout_account 포함)는 요청 body에 해당 키가 없으면 기존 저장값을
그대로 유지합니다(Tier3 강제는 최우선 그대로).

---

## 7. AC↔PA 실시간 채널

PA는 별도 탭이라 EXPERT 페르소나(같은 history 공유)와 달리 "자동으로
기억되는" 게 없습니다 — 명시적으로 상태를 주고받아야 합니다.

**PA → AC (진행 중)**: PA가 STEP을 넘길 때마다 `postMessage({type:
'GWP_PROGRESS', step, total, label})`를 조용히 보냅니다(채팅 버블 없음 —
매 STEP마다 말풍선이 뜨면 애초에 탭을 분리한 이유가 무색해짐).
`engine.js`가 `_gwpLiveProgress`로 들고 있다가, `call-ai.js`가 매 턴
`[ctx]`에 `PA진행:N/6단계(라벨)` 한 줄로 반영합니다 — 사용자가 PA 탭을
열어둔 채 AC와 다른 얘기를 해도 AC가 배경지식으로 알고 있되 먼저 나서서
언급하진 않습니다.

**PA → AC (완료 시)**: `GWP_DONE`의 `pdvData`(who/when/where/what/how/why
— 이미 구조화된 실데이터라 별도 LLM 요약 불필요)가 지금까지 PDV에만
기록되고 AC의 실제 `history`엔 안 남았습니다. `engine.js`가
`_paHandoffPending`(1회성)으로 남기면, `call-ai.js`가 다음 턴 `[ctx]`에
`[PA_HANDOFF_REPORT: ...]`로 실어 소비합니다(firstContact·job_ksco
재확인과 동일한 "1회 소비" 패턴) — "이미 화면에서 봤으니 다시 요약하지
말고, 자연스러운 기회에만 반영하라"고 명시돼 있습니다.

**비정상 종료(GWP_DONE 없이 탭 닫힘)**: PA는 매 STEP마다
`hondi_profile_step`/`hondi_profile_partial`을 localStorage에 즉시
써두므로, `_gwpFallbackReport`가 이걸 읽어 "N/6단계까지 진행, 확보된
필드: ..." 같은 부분 정보라도 AC에 남깁니다.

**AC → PA (호출 시, §6과 짝)**: `_gwpLaunch`의 `context` 인자가 base64로
`ctx` URL 파라미터에 실립니다 — PA가 이걸 읽어 `[CONTEXT:
PROFILE_UPDATE_HINT]`로 반영합니다(§6 참조).

---

## 8. 알려진 결함 이력 (같은 계보 — "탭 분리 때 배선 누락")

이번 세션에서 반복적으로 발견된 패턴: **`call-ai.js`(AC)에 먼저 만들어진
메커니즘이 `pages/profile-assistant.html`(PA)엔 배선되지 않은 채 방치되는
것.** 2026-07-11 탭 분리 이후 최소 4건 확인됨:

| 메커니즘 | 발견 당시 상태 | 수정 |
|---|---|---|
| `[TEMPLATE_LOOKUP]`(2026-07-17 태그 개편) | PA는 구 태그(`INDUSTRY_TEMPLATE_LOOKUP`)+구 엔드포인트(`/search`)만 인식 — §TEMPLATE-REFERENCE 전체가 사실상 미작동 | `/template-lookup` 두 축 조회로 재배선 |
| `[TEMPLATE_CANDIDATE]` | PA에 처리 코드 자체가 없었음 | 로컬 큐잉 추가 |
| `_gwpLaunch`의 `ctx` URL 파라미터 | PA가 전혀 안 읽음(다른 GWP 서비스는 이미 씀) | §6의 갱신모드 힌트 수신에 활용 |
| `[USER_FEEDBACK]` | PA에 제출 코드 없었음(§7의 전신인 `[FEATURE_SUGGESTION]`을 새로 만들었다가, 기존 파이프라인과 중복임을 뒤늦게 발견) | USER_FEEDBACK 제출 배선 추가, FEATURE_SUGGESTION 폐기 |

**교훈**: 새 탭·새 컨텍스트를 만들 때는 "이 메커니즘이 정말 새 탭에도
똑같이 필요한가"를 먼저 물어야 합니다 — 기본값은 "필요하다"입니다.

---

## 9. 관련 코드 위치 요약

| 관심사 | 파일 |
|---|---|
| PA 탭 자체 | `pages/profile-assistant.html` |
| PA↔서버 저장/조회 | `worker.js`의 `handleProfilePost`/`handleProfileGet`/`handleTemplateLookup`/`handleProfilePhotoUpload`/`handleMediaGet` |
| AC 쪽 GWP 엔진 | `src/gopang/gwp/engine.js` |
| AC 쪽 컨텍스트 합성 | `src/gopang/ai/call-ai.js`(`_buildPaHandoffContext` 등) |
| 공유 상태 | `src/gopang/core/state.js`(`_gwpLiveProgress`, `_paHandoffPending`) |
| PA SP 본문 | `prompts/profile-assistant/profile-assistant-v2_20.txt` |
| AC SP 본문 | `prompts/AGENT-COMMON_v3_48.txt`(§0-1-P[11]) |
| 역량 단일 소스 | `prompts/HONDI-CAPABILITIES-COMMON_v1_0.md` + `tools/check_capabilities_registry.py` |
| 사용자 피드백 파이프라인 | `tools/triage_feedback.py` + `.github/workflows/triage-user-feedback.yml` |
