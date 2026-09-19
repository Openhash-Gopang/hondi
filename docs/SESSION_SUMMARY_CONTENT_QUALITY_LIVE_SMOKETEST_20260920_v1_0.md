# 세션 요약 — 520개 제주 지역 SP 내용 품질 평가, 1단계 LLM 비평가 스크리닝 (2026-09-20)

**전제**: `docs/HANDOFF_2026-09-19_jeju-sp-quality-evaluation.md`의 후속 작업. 그
인수인계서는 §4에서 "1단계 LLM 비평가 스크리닝 → 2단계 사람 표본 검토"라는
2단계 방법론을 제안했다. 이 세션은 1단계를 실제로 구현·실행했다.

## 1. 만든 것

- `tests/live_smoketest/content_quality_live_smoketest.py` — 시나리오당
  (a) 실제 서비스 응답 생성 1회 + (b) 그 응답을 시스템 프롬프트 대비 채점하는
  비평가 호출 1회. 채점 축은 인수인계서 §2의 4가지(사무분장 정합성·최신성/
  수치·정직한 불확실성 고지 vs 환각·관할 지역 오안내). 비평가 자체도 환각
  가능하다는 한계 때문에 `CONTENT-PASS`/`CONTENT-NEEDS-REVIEW` 2상태만 쓴다
  (확정 FAIL 없음 — NEEDS-REVIEW는 2단계 사람 검토 후보라는 뜻일 뿐).
- `tests/live_smoketest/select_content_quality_sample.py` — 1단계
  NEEDS-REVIEW 전수 + 카테고리별 무작위 N건을 합쳐 사람이 바로 훑어볼 마크다운
  체크리스트를 만든다.
- `.github/workflows/live-smoketest-content-quality-govtree.yml` — 기존
  govtree 워크플로 골격 재사용, 결과 브랜치는
  `results/live-smoketest-content-quality-govtree`로 분리.

## 2. 실행 중 발견·수정한 결함 (전부 이 세션에서 발견)

1. **`CRITIC_MAX_TOKENS=2000`이 너무 낮았다** — DeepSeek deepseek-v4-flash가
   추론형 모델이라 reasoning 토큰도 예산에 포함되는데, 생성 호출
   (`GEN_MAX_TOKENS=12000`)엔 이미 반영된 교훈을 비평가 호출에 빼먹었다.
   part1of5 첫 실행에서 9/104건이 이 때문에 CONTENT-ERROR. → 12000으로 상향,
   재발 시 바로 진단 가능하도록 `reasoning_content_len` 디버그 필드 추가.
2. **★가장 중요한 발견 — 테스트 하네스가 UNIVERSAL-INTEGRITY(U2) 없이
   생성 호출을 하고 있었다.** `render_govtree_prompts.mjs`가 만든
   agencyPrompt만 시스템 프롬프트로 썼는데, 실제 프로덕션(`worker.js`
   `handleGovRelay`)은 `systemParts = [universalIntegrity, universalCommon,
   controlTowerPrinciple, identityDoc, ownSpAndGates, agencyPrompt, ...]`
   순으로 조립한다 — U2("불확실 식별자 생성 차단")가 agencyPrompt 앞에 항상
   붙는다. 이 갭 때문에 part1of5 첫 실행에서 "환각 의심" 5건이 나왔는데, U2를
   반영해 재실행하니 **3건이 사라졌다**(하네스 결함이었지 실제 결함이
   아니었음). → `resolve_system_prompt`가 이제 UNIVERSAL-INTEGRITY·
   UNIVERSAL-common을 agencyPrompt 앞에 동일한 순서·구분자로 붙인다.
3. **부수 발견(기록만, 아직 안 고침)**: `prompts/sp-catalog.json`에
   `CONTROL-TOWER-PRINCIPLE` 키 자체가 없다 — 프로덕션에서도 그 문서 전문은
   항상 로드 실패 후 빈 문자열로 대체된다(형식 준수는 `gov-router.js`가 별도로
   붙이는 짧은 "최종 확인" 리마인더 덕에 그럭저럭 지켜짐). **별도 버그로
   후속 세션에서 다룰 것** — 매니페스트에 올바른 파일명을 등록하면 된다.
4. **운영 결함**: 82건 중 1건(CT-0317)이 CONTENT-ERROR면 스크립트가
   `sys.exit(1)`하고, 워크플로의 표본추출 스텝이 `if: always()`가 아니어서
   나머지 81건 멀쩡한데도 사람 검토용 표본 자체를 못 만들고 건너뛰었다. →
   표본추출 스텝을 `if: always()`로 변경.

## 3. 알려진 잔여 갭 (정직하게 기록)

- `identityDoc`(K-Public_common/PROFESSIONAL-common)·`ownSpAndGates`(기관
  정본 SP+게이트 스키마)는 agency별 동적 조립이라 Python 하네스에서 아직
  재현 못 했다. "환각 의심" 축 재현에는 U2만으로 충분했지만, "사무분장
  정합성" 축은 여전히 완전한 프로덕션 재현이 아닐 수 있다 — 다음 세션에서
  `worker.js`의 `_fetchOwnSpAndGates(agency)` 로직을 참고해 이식할지 검토할 것.
- 비평가(LLM critic) 판정 자체도 환각 가능 — 아래 결과는 전부 "2단계 사람
  검토 후보 스크리닝"이지 확정 결론이 아니다.

## 4. 실행 결과

| 배치 | 시나리오 파일 | 건수 | PASS | NEEDS-REVIEW | ERROR |
|---|---|---|---|---|---|
| part1of5 전수 (U2 포함 재실행) | `scenarios_..._full520_20260919_part1of5.json` | 104 | 102 | 2 | 0 |
| part2~5of5 표본(카테고리당 무작위 10건, seed=20260920) | `scenarios_content_quality_sample_part2to5_20260920.json` | 82 | 80 | 2 | 0(CT-0317 단독 재실행 후 PASS) |
| **합계** | | **186** | **182** | **4** | **0** |

part1of5는 do-dept·do-agency 대부분을 전수 커버했고, 나머지 4개 파트
(org·jejusi·seogwipo·emd/team·do-agency 잔여, 총 416건)는 프롬프트가 U2+
UNIVERSAL-common 결합으로 커진 상태라 비용·시간 절감을 위해 표본으로
전환했다(카테고리당 10건, 모집단 10건 미만인 do-agency 잔여 카테고리는 전수).

## 5. 2단계 사람 검토로 넘길 최종 4건

전부 "사무분장 정합성" 또는 "환각 의심" — SYSTEM_PROMPT에 없는 세부 예시를
확정처럼 덧붙인 패턴. 관할지역 오안내·최신성 이슈는 0건.

| ID | 카테고리 | 기관 | 요약 |
|---|---|---|---|
| CT-0054 | do-dept/division | 관광교류국 관광정책과 | "관광사업 등록·허가"는 시청 관광진흥과 소관인데 자기 소관처럼 나열 |
| CT-0064 | do-dept/division | 해양수산국 수산정책과 | SYSTEM_PROMPT에 없는 "어촌·어항 정책"을 자기 소관 예시로 제시 |
| CT-0172 | org/bureau | 제주문화예술재단 | 근거에 없는 "재단 시설·공연장 이용"을 민원 유형으로 제시 |
| CT-0293 | seogwipo/division | 자치행정국 세무과 | SP가 "추정·재검증 필요"로 표시한 재산세·자동차세 담당을 확정 사실처럼 서술 |

전체 결과(186건)와 표본 체크리스트는 결과 브랜치
(`results/live-smoketest-content-quality-govtree`)의 각 배치 폴더 —
`content_quality_results.jsonl` + `human_review_sample.md` — 에 있다.

## 6. 다음 세션 시작점

이번 세션과 별개로 논의된 우선순위(주피터님 제시, Phase 2 리포트 §6 기준)와
연결하면:

1. 패치 #0006(§2 템플릿 근본수정) 병합 — 이 세션과 무관, 대기 중이던 작업.
2. SP_advisor·SP_nurse에 C39-2 추가.
3. **112개 기존 SP §2 재작성 + §3(안내/연계) 누락 109건 정비(합쳐서 배치)**
   — 이번 세션에서 찾은 CT-0054·CT-0064(인접 부서 소관 경계 혼동)가 바로 이
   작업이 다뤄야 할 실제 사례다. 재작성 후에는 이 세션이 만든
   `content_quality_live_smoketest.py`로 before/after 재검증할 것(이미
   프로덕션과 동일한 U2 가드레일 포함 상태로 고쳐뒀으니 바로 쓰면 된다).
4. `prompts/` 최상위 페르소나 구버전 ~300개 archive 정리(기계적).
5. **(이번 세션에서 새로 발견, 후속 필요)** `sp-catalog.json`에
   `CONTROL-TOWER-PRINCIPLE` 키 등록 — 별도 소규모 버그 수정.
6. **(이번 세션에서 새로 발견, 후속 필요)** `content_quality_live_smoketest.py`에
   `identityDoc`·`ownSpAndGates` 레이어 반영 — §3의 "잔여 갭" 참고.

## 7. 함정 메모 (이번 세션에서 겪은 것, HANDOFF §6에 추가)

- U2+UNIVERSAL-common을 붙이면서 프롬프트가 요청당 ~10만자(13만 토큰대)로
  커졌다 — DeepSeek 프롬프트 캐싱 덕에 비용·속도 영향은 생각보다 작았지만
  (`prompt_cache_hit_tokens`가 대부분), 워크플로 소요시간 변동폭이 커졌다.
  전수 대신 표본 실행을 기본으로 고려할 것.
- `sys.exit(1)`은 CONTENT-ERROR 1건만 있어도 발생 — CI가 "실패"로 표시돼도
  대부분의 결과는 정상 커밋돼 있을 수 있다. 결과 브랜치를 먼저 확인할 것,
  워크플로 상태만 보고 "전체 실패"로 단정하지 말 것.
