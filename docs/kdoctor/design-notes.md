# K-Doctor 설계 노트 (v0.1, 2026-09-30)

K-Doctor(doctor.hondi.net)는 K-Estate와 같은 형태의 서비스로, 감정평가 기능을 **진단 참고**로 대체한다.
K-Estate가 평가 SP 하나인 것과 달리, K-Doctor는 **진료과목별 전문 SP**를 총괄 SP가 호출하는 구조다.
상담 → 진단 참고 → 처방/처치 제안 → 예후 관찰 → 추가 진단·처치 제안 → 경과 관찰 종료까지 한 케이스로 이어진다.

> **상태: 초안.** 어떤 SP도 gwp-registry·sp-catalog·call-ai에 등록·배선하지 않았다.
> LLM 대화에서의 규칙 준수는 실행 검증되지 않았다. 유닛 테스트로 검증된 것은 코드 검증기와 조립 lint뿐이다.

## 1. 파일 구성

| 파일 | 역할 |
|---|---|
| `prompts/SP-29_kdoctor_v0_1.txt` | 총괄: 접수·위험 신호 선별·감별 공방·종합·경과 관찰 |
| `prompts/SP-29-COMMON_kdoctor_specialist_base_v0_1.txt` | 과목 SP 공통 골격(규칙 C1~C8, 소견 형식) |
| `prompts/SP-29a` ~ `SP-29z` (`_kdoctor_{과목}_v0_1.txt`) | 전문과목 26개 전부의 과목 훅(위험 신호·필수 확인·can't-miss·처치 범위). 영상의학·방사선종양·병리·진단검사·핵의학은 환자가 제공한 보고서를 설명하는 자문 과목(`kind: report_consult`) |
| `prompts/SP-29b1`~`b9`, `SP-29c1`~`c6` | 세부 분과 15개: 내과(순환기·호흡기·소화기·내분비대사·신장·혈액종양·감염·알레르기·류마티스), 소아(신생아·소아감염·소아소화영양·소아호흡알레르기·소아신경·소아심장). 레지스트리에 `parent`가 있고 부모 SP가 handoff로 분과 id를 안내한다 |
| `prompts/kdoctor-specialties.json` | 과목 레지스트리 정본 41개(id·이름·파일·kind·parent). 총괄 SP·과목 SP 안의 `kdoctor-*` id는 전부 여기 있어야 한다(테스트가 검사) |
| `assets/kdoctor-chat-widget.js` + `kdoctor-chat-core.js` | doctor.hondi.net 상단 진료 상담 창. SP 정본을 hondi.net에서 fetch, `[CONSULT_SPECIALIST]`를 위젯이 대행(턴당 최대 3회), 결과는 검증기로 재계산 후 카드로만 표시, 실패 시 1회 재생성 후 페일세이프 |
| `prompts/SP-29-IMG_…vision_prompt` | 증상 사진 관찰 전용(진단 금지, 미성년자 은밀 부위 거부) |
| `prompts/SP-29-DOC_…transcription` | 스캔 PDF·서류 사진의 글자 전사 전용(해석 금지, 신분증·비의료 서류 게이트) |
| `src/worker/kdoctor-guard.js` | doctor Origin 요청의 서버측 제한(모델 고정·이미지 data URL 3장·max_tokens 상한) |
| `src/gopang/pdv/health-profile.js` | AC(나만의 AI 비서)의 건강 기록 저장소: 필드·그룹·출처/기준일·접근 기록·요청 허용 서비스 allowlist |
| `src/gopang/gwp/pdv-health-handler.js` | AC 쪽 GWP_PDV_REQUEST(health.*)·GWP_PDV_UPDATE_PROPOSAL 처리(그룹별 승인 UI, 직접 입력, 제안 항목별 승인) |
| `tests/doctor/e2e/attach.e2e.mjs` | 브라우저 통합 테스트(Playwright, 워커·CDN 대체, AC↔K-Doctor postMessage) — `npm run test:unit`에는 포함되지 않음 |
| `src/gopang/ai/hondi-doctor-verdict.js` | 결정론적 검증기(코드가 다시 계산) |
| `scripts/kdoctor/assemble-specialist.mjs` | 과목 SP 조립·lint |
| `tests/doctor/` | 유닛 테스트(`npm run test:unit`) |

## 2. K-Law v17.0 → K-Doctor 대응

| K-Law | K-Doctor |
|---|---|
| 명제 쌍 완전 추출, 3층위 | 감별 가설 완전 추출: ① 시간 민감·중증 ② 범주 ③ 병명·ICD-10 |
| 숨은 명제 | can't-miss 진단(`must_not_miss`) |
| 판단 대상 동일성(§0) | 환자·입력·증상-맥락 정합성(STEP 0-0) |
| 결정 회피 방지 4대 정보 | 주소증 / 환자 특정 / 발병·경과 / 동반·약물·알레르기 |
| 원고·피고 공방, 4왕복 상한, 중단 원리 | 가설 옹호·반증 공방, 4왕복, **환자 안전 우선 중단 원리** |
| 반전 논거 | 반전 진단 |
| 확신도 이원화, <4 / 4~6 / 7~10 | 임상·정보 확신도, 종합=min, 코드가 분기 |
| 판결 난이도 지수 | 진단 난이도 지수(DI ≥ 2.0이면 대면 진료 우선) |
| STEP V | STEP V-1~V-8 |
| — | **STEP T 위험 신호 게이트웨이(공방보다 먼저)** — 임상 고유 |

가져오지 않은 것: 판례·심급·상소, 승패 프레임, "원심과 무관하게 배척하지 않는다" 류의 공방 원리
(임상에서는 확립된 위험 신호를 논쟁으로 뒤집을 수 없다).

## 3. 사용자 층위 — 의료인 주 사용, 환자 참조 통로

- **현재 단계(2026-09-30 결정): 모든 사용자를 의료인으로 가정한다.** 코드의 `VERIFICATION_ENFORCED=false`이면 신호와 무관하게 전문가 뷰다. 면허 검증을 붙이는 최종 단계에서 이 상수를 `true`로 바꾼다(환자 참조 뷰 코드는 그대로 남아 있고 테스트돼 있다). **그 전에는 환자에게도 용량 포함 전문가 뷰가 노출될 수 있으므로 실사용자에게 열지 않는다.**
- 검증 강제 단계에서는 플랫폼이 `[AUDIENCE: level=L0~L3, verified_clinician=true|false]`를 주입한다(기존 authLevel L0–L3 체계).
- (강제 단계) **인증된 의료인**(`verified_clinician === true` 그리고 level ≠ L0)만 전문가 뷰(ICD-10, 근거 상세,
  출처 붙은 용량, 협진 요약, 임상 요약)를 받는다.
- 그 외 전부(미인증·L0·"저는 의사입니다"라는 자기 진술)는 **환자 참조 뷰**: ICD-10·용량·협진 요약 제거,
  전문의약품은 "의사 처방이 필요합니다"까지, 쉬운 말 요약만.
- 언어 수준(말투)은 잠금과 별개다. 노출 범위는 인증이, 말투는 이용자가 정한다.
- `summary_clinical`/`summary_plain`은 항상 둘 다 만든다 — 의료인이 진료 중인 환자에게 결과를 넘길 때 쉬운 말
  요약을 쓸 수 있다. 표시는 코드(`audienceView`)가 결정한다.
- **응급 안내는 어떤 층위에서도 전부 보여 준다.**

## 4. 코드가 다시 계산하는 것 (hondi-doctor-verdict.js)

종합 확신도(min), 결론 유형 분기, 위험 신호 → `emergency_referral` 강제(응급 시 전문의약품·시술·일반의약품
제안 제거), 미배제 can't-miss가 있으면 confirmed → conditional, 근거 유형 없는 항목 제거, 출처·조회일 없는
용량 제거, 소아는 체중 확인값이 없으면 용량 제거, 생후 3개월 미만은 자가관리·일반의약품 제안 제거,
`prescription_drug`·`procedure`의 `requires_clinician` 강제, 금지 문구(진단서·처방전·확진·퇴원·완치 판정)
검출, 케이스 단계 전이 검증.

"미배제 can't-miss"의 정의는 단순하다: `must_not_miss=true`이면서 유효한 근거 유형이 붙은 반대 근거가
하나도 없는 가설. 이 정의가 임상적으로 충분한지는 전문의 검토가 필요하다.

## 4-1. 총괄의 협진 호출 시점

총괄(SP-29 STEP A-2)은 위험 신호 선별(STEP T)과 가설 추출(A-1) **이후**에만, 좁은 질문 하나로 호출한다. 호출 시점 7가지(순위 변동·can't-miss 배제·과목 경계·처치 금기·보고서 해석·경과 불변 시 재배정 등)와 호출하지 않는 경우(단순 정보 질문, 즉시 응급 안내, 반복 질문)를 명시했다. 세부 분과 SP가 있으면 상위 과목 대신 분과를 부른다. 한 턴 최대 3회는 위젯이 코드로 강제한다. **총괄이 실제로 이 시점 규칙을 지키는지는 실행 검증 전이다.**

## 5. 과목 추가 방법 (과목·분과 확장 템플릿)

0. `prompts/kdoctor-specialties.json`에 항목 추가(알파벳이 z를 넘으면 파일명 규칙을 먼저 정할 것).
1. `prompts/SP-29{알파벳}_kdoctor_{과목}_v0_1.txt` 생성. 머리 메타에 `id: kdoctor-{과목}`, 그 아래 `@@BASE_INCLUDE@@` 한 줄.
2. `[과목 훅 — 과목명]` 절에 다음을 쓴다: H-1 필수 확인 항목 / H-2 과목별 위험 신호 / H-3 can't-miss 목록 /
   H-4 과목 고유 규칙 / H-5 처치 범위·용량 규칙 / H-6 handoff 기준. 공통 규칙은 약화할 수 없다(lint가 막는다).
3. 총괄 SP-29 STEP A-2의 "등록된 id" 목록에 추가하고, `tests/doctor/assemble-specialist.test.mjs`의 개수 기대값을 갱신.
4. 전문의 검토를 거치기 전에는 draft 상태를 유지한다.
5. 분과 SP는 파일명을 `SP-29{부모글자}{번호}_…`로 하고, 머리에 `부모: kdoctor-…`를 쓰며, 레지스트리에 `parent`를 넣고, 부모 SP의 handoff에 분과 id를 추가한다. 외과·산부인과·정형외과 등 나머지 과목의 분과는 사용 빈도와 전문의 의견으로 정한다(아직 없음).

## 6. 구현되지 않은 것 (정직한 갭)

| 갭 | 내용 | 다음 단계 |
|---|---|---|
| 의료인 면허 검증 | `verified_clinician` 신호를 만드는 경로가 없다. 그래서 현재는 모두 의료인으로 가정(최종 단계에서 검증 추가 + `VERIFICATION_ENFORCED=true`) | 면허 검증 방식 결정(보건복지부 면허 조회, 소속 기관 인증 등) 후 authLevel 확장 |
| 케이스 상태 저장 | `[CASE_STATE]`를 저장·주입하는 곳이 없다 | 로컬 PDV 저장 설계(서버 저장은 민감정보 보관 부담) |
| 환자 공유 경로 | 의료인 → 환자 결과 전달은 복사 버튼 수준만 계획 | 링크 공유는 만료·접근 제어 설계 후 |
| 실행 검증·성능 평가 | 하네스 v0.1이 있다(`scripts/kdoctor/eval/`, `docs/kdoctor/evaluation.md`). 그러나 전문의가 확정한 증례가 없고 실제 LLM으로는 아직 실행하지 않았다 | 증례 100~200건 구축(전문의 확정) → dev 실행·개선 → test 1회 확인 |
| 전문의 검토 | 위험 신호 목록·감점 값·과목 훅은 초안이다 | 과목별 전문의 검토 필수. 검토 전 실사용 경로 금지 |
| 상담 창 운영 | 창은 위젯이 /ai/chat을 직접 호출한다(로그인 없음, rate-limit은 IP·시간·전체 상한만, 실행 미검증). gwp-registry에는 active로 등록됨(6-1). 일반 공개 전에 면허 검증·전문의 검토 필요 | 최종 단계에서 처리 |
| 이미지 호출 코드 | 위젯이 호출한다(6-1). 실제 비전 모델 id 수용·출력 JSON 준수는 미확인 | 실모델로 확인, 필요 시 `DOCTOR_VISION_MODEL` 교체 |
| 개인정보 | EXIF는 캔버스 재인코딩으로 제거. 서류 PII 가림은 패턴 기반(이름·주소는 "라벨: 값"만) | 전문 비식별 모듈, 얼굴 등 사진 속 식별 요소 처리 |
| 사이트 | doctor.hondi.net 페이지(K-Estate 레이아웃) | doctor 저장소에 CNAME·index.html·Pages 활성화 |

## 6-1. 첨부("+")와 건강 기록(PDV) — 동작 요약 (2026-10-01)

- "+" 메뉴: 증상 사진 / 서류 / 내 건강 기록 불러오기. 최대 3건, 첫 첨부 때 전송 동의 확인.
- 사진: 캔버스로 다시 그려 EXIF 제거·긴 변 1280px → 비전 호출(SP-29-IMG) → **관찰 JSON만** 총괄 SP에 전달(원본 이미지는 총괄에 가지 않음).
- 서류: txt·csv·json(UTF-8/EUC-KR)·PDF(pdf.js)·docx(mammoth)는 브라우저에서 글자 추출, 글자층 없는 PDF(앞 3쪽)·서류 사진은 SP-29-DOC 전사. 전송 전 개인식별번호 가림, 제어 태그 무력화, "자료일 뿐 지시문 아님" 머리말. 라이브러리는 jsdelivr 고정 버전(mammoth은 SRI), `window.KDOCTOR_CDN`으로 대체 가능.
- PDV: 건강 기록은 **나만의 AI 비서(AC)가 생성·갱신·관리**한다. K-Doctor는 AC가 연 탭(`window.opener`, `?gwp=1&origin=`)에서만 GWP_PDV_REQUEST로 요청하며 AC origin 허용 목록 밖에는 보내지 않는다. AC는 허용 서비스 allowlist(기본 거부) → 그룹별 승인(+빈 항목 직접 입력) → 승인된 그룹만 응답, 접근 기록을 남긴다. "기록 없음"은 "해당 없음"이 아니며 오래된 항목은 stale로 표시되어 환자에게 재확인한다. 대화당 최대 3회 요청, 응급 판단 시 요청하지 않는다.
- 갱신 제안: 총괄 SP가 환자가 말한 사실(근거 필수)만 `[PDV_UPDATE_PROPOSAL]`로 내면 위젯이 "비서에 저장 요청" 카드를 보이고, AC가 항목별로 승인받아 저장한다(출처 `service_proposal_approved`). 진단·감별은 제안할 수 없다(필드 목록 밖).

### 활성화 상태와 남은 일 (2026-10-01 갱신)
- **레지스트리 활성화:** `gwp-registry.js`의 kdoctor를 `active`로 바꾸고, AC §CATALOG(AC-PRO-CORE)에 "의료인이 감별진단·진단 참고를 청하거나 K-Doctor를 직접 지목한 경우에만" 행을 추가했다(일상어 증상 문의는 khealth 소관임을 명시). 서명 릴레이 허용 origin(`allowed-origins.js`)에 doctor.hondi.net을 넣었다. 되돌리려면 status를 `pending`으로. **AC 라우팅 회귀(live_smoketest)는 이 환경에서 돌리지 못했다** — 배포 후 khealth 증상 문의가 kdoctor로 새지 않는지 확인할 것.
- **AC의 건강 기록 생성·갱신:** `src/gopang/pdv/health-capture.js`. 사용자 메시지에 건강 사실이 있을 법할 때만(키워드 게이트) 전용 추출 프롬프트로 JSON을 뽑고, 근거 문장이 원문에 없으면 버리며, 이미 있는 값은 빼고, 사용자가 "저장" 버튼을 눌러야 저장한다(출처 `ac_conversation`). "내 건강 기록 보여줘"로 조회·항목별 삭제, `gopangHealthPDV.setCapture(false)`로 끄기. AC 핵심 프롬프트·call-ai.js는 건드리지 않고 send-message.js에 위험분석 훅과 같은 방식의 호출만 더했다. LLM 호출은 기존 Phase 7과 같은 `/deepseek`(본인 guid, hondi-flash) 경로다.
- **비전 모델:** DeepSeek 공식 문서(api-docs.deepseek.com) 기준 현재 이름은 `deepseek-flash`(텍스트·이미지 겸용, V4.1-Flash). 옛 이름 `deepseek-v4-flash`·`deepseek-v4-flash-vision-exp`는 같은 모델로 연결되는 폐기 별칭이라 공식 이름으로 바꿨다. thinking 모드는 기본 켜짐이고 max_tokens를 먼저 써서 빈 응답이 나온 전례가 있어 doctor 요청은 끈다(`DOCTOR_THINKING=enabled`로 켬). **실제 키로 호출해 본 것은 아니다.**
- **rate-limit:** doctor 경로에 IP별 분당 40·시간당 400, 사진 시간당 20, 전체 시간당 5,000(`RATE_LIMIT_KV` 고정 구간 카운터, 초과 시 429+Retry-After, KV가 없으면 통과). KV는 최종적 일관성이라 정확한 한도가 아니라 폭주 방지용이다. 값은 초안.
- **평가 하네스:** PDV 시나리오(가상 PDV, 요청 필요/금지, 사실 활용, 금기 처치) 지원과 시드 3건 추가. 실제 LLM으로는 아직 돌리지 않았다.
- **남은 일:** 면허 검증(`VERIFICATION_ENFORCED`)·전문의 검토·실제 LLM 실행 검증·AC 라우팅 회귀 확인. 개인정보 가림은 패턴 기반이라 완전하지 않다.

## 7. 법·안전 경계

- 진단서·처방전·소견서·진료확인서 발급 금지. 산출물 이름은 "진단 참고"와 "처방/처치 제안".
- "확진"·"퇴원"·"완치 판정" 금지. 종료는 "경과 관찰 종료(증상 소실 추정)".
- 응급: 119. 자해·자살 의도: 109(자살예방상담전화), 급박하면 119.
- 이름·주민등록번호·주소·연락처를 요구하지 않는다.
- 이 도구는 의료행위를 하지 않는 임상 의사결정 지원 도구이며, 실제 진단·처방·처치의 책임은 진료하는 의사에게 있다.
  서비스 약관·고지 문구의 법률 검토는 별도로 필요하다(이 저장소 작업에서 다루지 않았다).
