# 세션 기록 — 전문가 면허 인증·서버 게이트·구독·법무사/행정사 SP 분리·검수 패키지 (2026-10-21)

> 주관: 주피터(AI City Inc. 수석 설계자) · 작업: Claude 세션 · 반영 PR: #724(면허 인증), 게이트 PR, #728(프런트·관리자 패널), #730(법무사·행정사 SP 분리), #732(약관·처리방침 초안), #734(구독), #736·#737(검수 패키지·수정)
> 이 문서는 개발자용 기록이다. 사업 쪽 정리는 `docs/business-plan/consortium/consortium-business-plan-summary-v6.md`.

## 1. 출발점과 결정

출발점은 나비웹 컨소시엄 사업 계획 요약(v1→v5)과 저장소 재점검(준비 완료/미완료 구분) 결과였다. 점검 결론: 플랫폼 골격·과금·회원 집계는 준비됨, **면허 인증과 서버측 접근 통제, 직역 전문가 검수, 법령 원문 대조는 전 직역 미완료**, 구독은 2026-09-23에 코드가 폐지된 상태.

| # | 결정(주피터) | 내용 |
|---|---|---|
| D1 | 면허 인증 | 면허증 사본 업로드 후 **관리자 수동 승인** |
| D2 | 요금 | **연 99,000원 구독 부활**(전문가·직원 각각) + 종량제. 구독료는 **직역 법인이 징수** |
| D3 | 모집 | 입찰·GPU 확보 전에도 현 기반으로 선모집(직역별 단계 개시) |
| D4 | 검수 | 입찰 예정 전문가 위촉 + 별도 자문 계약 + 직역 단체 협조 **병행** |
| 기타 | 법령 원문 | 변호사법·약사법 원문은 불필요(이용자가 각 직역 전문가). SP의 "확인 필요" 표시는 유지 |
| 기타 | 배포 | 코드 밖 배포 설정은 마지막에 수행. 저장소는 사용자가 직접 push |

## 2. 만든 것

| 구분 | 위치 | 내용 |
|---|---|---|
| 면허 인증 장부 | `pb_migrations/1795000001_created_pro_verifications.js`, `src/worker/pro-verify-handler.js`, `pro-verify-store.js` | `/pro-verify/apply·status·session·pending·file·decide`. 신청은 지갑 서명(파일 SHA-256·면허번호 해시 포함), 사본은 매직 바이트 검사(JPEG/PNG/PDF/WEBP, 5MB 이하), **승인·반려 즉시 사본 삭제**(`clearFile`), 면허번호는 마스킹본+해시만 저장, 같은 면허의 다중 계정 거부, 인증 유효 1년, 하루 5건 신청 한도, 직원은 소속 전문가 승인이 유효한 동안만 유효, 상위 직역이 하위(`parent-*`)를 덮음, 열람 기록 `view_log`(최근 20건) |
| 전문가 세션 | `src/worker/pro-session.js` | HMAC 토큰(`PRO_SESSION_SECRET` 16자 이상), 수명 4시간. 페이로드: `pk, personas, sub, iat, exp` |
| 서버 게이트 | `src/worker/pro-gate.js`, `assistant-sp-codes.js`(생성) | AI 프록시 경로(`isAiProxyPath`)에서 전문가용 SP 식별(제목 코드 또는 생성기 표지 줄 2개) → `body.pro_session` 검증. 모드 `PRO_GATE_MODE` off\|**log(기본)**\|enforce |
| 프런트 | `assets/pro-verify.js`, `assets/chat-widget.js`, `admin.html` | 인증 신청 창(`window.HondiPro`), 전문가용 SP 감지 시 세션 자동 첨부, 차단 안내, 관리자 승인 패널(대기 목록·사본 보기·승인/반려), 관리자 Bearer 로 `/pro-verify` 운영 호출 |
| 구독 | `pb_migrations/1795000002_created_pro_subscriptions.js`, `src/worker/pro-sub-core.js`, `pro-sub-handler.js`, `pro-sub-store.js` | `/pro-sub/status·grant·quote·refund·list`. 수동 입금 확인 후 부여(입금 참조 필수·유니크), 갱신은 만료 직후에 이어 붙임, 환불 제안액(7일 이내 전액/이후 잔여 비례, 초안 정책)과 처리, 무료 체험(처음 승인 시각 + `PRO_TRIAL_DAYS`, 기본 7일), 잔여일·만료 임박 안내, admin.html 구독 패널 |
| 구독 게이트 | `pro-gate.js` | 세션 토큰의 `sub`(구독·체험 접근 가능 시각)만 검사 → 추가 DB 조회 없음. 402 `PRO_SUBSCRIPTION_REQUIRED`. 모드 `PRO_SUB_MODE` **off(기본)**\|log\|enforce, **둘 다 enforce 일 때만 차단** |
| SP 분리 | `scripts/split-scrivener-sp.py`, `prompts/SP_judicial-scrivener_v4_0.md`·`SP_administrative-scrivener_v2_0.md`(일반인용), `…-assistant_v1_0.md`(전문가용, SP-LAW-02A / 08A) | 법무사·행정사의 서류 작성 단계(STEP C·W, 부록 A)를 전문가용으로 이전. 전문가 페이지 `sp:` 키와 서류 작성하기(expert-chat 임베드)를 전문가용으로 연결하고 `pro_session` 첨부. 게이트 대상 SP 136→138개 |
| 약관·처리방침 | `docs/legal/hondi-terms-privacy-draft-20261021.md` | 이용약관 14개 조, 개인정보 처리방침(면허 인증 부분), 화면 고지 문구, 확정 필요 항목, 구현 정합성 점검표. **법률 검토 전 초안** |
| 검수 패키지 | `docs/review/README.md`, `review-log.md`, `docs/review/sheets/*-검수시트.md`(11종), `scripts/gen-review-packages.py` | 세 트랙 절차, 이해관계 공개, 자문 계약 핵심 조항·직역 단체 공문 초안, 화면 표기 규칙. 시트는 SP 에서 자동 생성되고 테스트가 동기화를 검사 |
| 사업 계획 | `docs/business-plan/consortium/consortium-business-plan-summary-v6.md` | 구독 부활, 직역별 단계 개시, 환불·개인정보 리스크 반영(관리자 「사업 계획」에 링크) |

## 3. 동작 요약

1. 전문가가 신청(직역·면허번호·사본·서명) → 관리자 패널에서 사본 열람(기록됨) → 승인/반려 → **사본 즉시 삭제**.
2. 승인된 계정은 `/pro-verify/session` 에 지갑 서명으로 4시간 세션을 받는다. 세션에 구독·체험 접근 가능 시각(`sub`)이 실린다.
3. 클라이언트는 전문가용 SP 를 쓰는 호출에 `pro_session` 을 첨부한다(chat-widget, expert-chat 임베드). 게이트는 SP 식별 → 세션 검증 → 직역 일치 → (구독 모드 시) `sub` 검사. 토큰은 LLM 으로 넘기지 않고 본문에서 제거한다.
4. 철회·만료·구독 부여/환불은 토큰 수명(4시간) 안에 반영된다.
5. 구독은 접근권, 사용량은 GDC 종량 차감으로 따로 과금한다.

## 4. 배포 순서(코드 밖 작업 — 아직 하지 않음)

1. L1 PocketBase 에 마이그레이션 적용: `1795000001`(인증), `1795000002`(구독).
2. Worker 비밀값: `PRO_SESSION_SECRET`(16자 이상, 필수). 선택: `PRO_VERIFY_ADMINS`(guid 또는 공개키, 쉼표 구분 — 관리자 페이지 Bearer 만 쓰면 불필요), `PRO_TRIAL_DAYS`(기본 7).
3. 종단 시험: 가입 → 인증 신청 → 관리자 승인 → 세션 발급 → 구독 부여 → 서류 초안 → 과금.
4. `PRO_GATE_MODE=enforce` 로 전환(기본은 log: 차단 없이 `HONDI_PRO_GATE_WOULD_BLOCK` 로그만). 로그로 오차단 여부 확인 후 전환.
5. `PRO_SUB_MODE=log` 로 구독 차단 대상 확인 → `enforce`.
6. 전환 후 생성기의 한계 문구 "서버가 막는 장치는 아직 없습니다" 수정 → 페이지 재생성(`expert_pages_start_field` 테스트 갱신).

## 5. 점검에서 나온 결함과 조치

1. **게이트 오탐**: 법무사·행정사 일반 SP 가 제목 정규식·골격 문구에 걸림 → 제목 판정은 `ASSISTANT_SP_CODES` 에 있는 코드만, 생성기 표지 줄 2개만 보조 표지로 사용. (이후 법무사·행정사는 실제로 분리)
2. 테스트: 사본 삭제 확인이 항상 false(mem-store 행 변이) → 삭제 전 `hadFile` 캡처. 마스킹 기대값 오류 수정.
3. **SP 분리 후 깨진 테스트 4곳**(STEP W·부록 A 검증, 옛 파일명 참조, B-05 서류 목록 비교, v151 훅 버전 비교)을 새 구조에 맞게 수정하고 분리 검증 테스트 `scrivener-split.test.mjs` 추가.
4. **Windows 인코딩**: `gen-review-packages.py` 가 하위 프로세스 출력(cp949)을 UTF-8 로 해석하다 실패 → 하위 프로세스 UTF-8 고정(#737). 테스트는 `python3` 없으면 `python` 도 탐색.
5. **병합 실패(일시)**: `gh pr merge` 가 "Base branch was modified" 로 실패 → 재시도 루프 3회로 해결. 스크립트는 오류 시 중단하지 않을 수 있으니 여러 줄 붙여넣기 시 `throw` 이후 줄이 이어서 실행되는지 확인.
6. 읽기 전용 스크래치 클론에서 push 불가(403) → 변경은 압축 파일 + PowerShell 로 전달. 공유 대형 파일(`worker.js`, `admin.html`, `chat-widget.js`, `expert-chat.html`)은 **앵커 삽입 스크립트**(`scripts/apply-*-patch.mjs`, 멱등)로만 수정.

## 6. 테스트 상태

- 신규: `pro-verify-handler`, `pro-gate`, `pro-sub`, `scrivener-split`, `review_sheets` 등. 관련 테스트 전부 통과.
- 전체 실행: `node --test src/tests/*.test.js src/tests/*.test.mjs`(디렉터리 지정은 실패). **이전부터 실패하던 10건**은 이 작업과 무관: 강원도 L2 기본 라벨, foodimport(경남·경기) 2건, `gov-router-2026-08-21-session-smoketest`, `kplan-kwatch-kjob-dispatch`, `c50-next-step-marker`, `conversational-style-guard`, `sp-intercall`, `sp-tag-dispatch`, C-04(`patent-attorney-bio-pharma` 세부 분야 SP 불일치).

## 7. 한계와 추후 작업

- **우회 가능성**: 클라이언트가 공개 파일로 SP 를 조립해 보내므로 제목·표지 줄을 지우면 게이트를 피할 수 있다. 근본 해결은 전문가용 SP 를 **서버에서만 조립**하는 것. 현재 게이트는 "키만 바꿔 호출"을 막는 1차 장치이며 이용은 GDC 과금 대상.
- 자동 결제·세금계산서·현금영수증(징수 주체·세무 확정 후), 만료 알림의 **푸시/이메일**(현재는 화면 안내와 관리자 목록만), 환불 송금은 수동.
- 관리자 사본 열람 기록은 최근 20건만 유지 — 처리방침의 열람 기록 보관 기간 확정 시 별도 로그 필요.
- 체험은 "처음 승인 시각 + 일수"로 정의했다(기존 가입 체험과 별개). 기존 체험과 일치시킬지 결정 필요.
- 법령 원문 대조(W3): 의사·한의사·세무·회계·감정평가사는 원문 접근이 가능할 때. 변호사·약사는 사용자 결정으로 SP 의 "확인 필요" 표시를 유지.
- 검수(W4): 검수자 섭외와 시트 회수·반영은 사람이 진행. 트랙 A(입찰 예정자) 의견만으로는 "검수 완료"로 표기하지 않는다.
- 약관·처리방침은 법률 검토 필요(징수 법인명, 환불 기준, 국외 이전, 직역법 쟁점 — 변호사법 제34조 등).
- 일반 SP 의 L2·L3 분기 문구 정리, 입찰 서버(`equity-bid`)는 법률 검토 회신 후.

## 8. 관련 문서

`docs/legal/hondi-terms-privacy-draft-20261021.md`, `docs/review/README.md`, `docs/business-plan/consortium/consortium-business-plan-summary-v6.md`, `docs/SESSION_SUMMARY_EXPERT_ASSISTANT_SP_SPLIT_20261017_v1_0.md`(전문가용 SP 이분화의 배경).
