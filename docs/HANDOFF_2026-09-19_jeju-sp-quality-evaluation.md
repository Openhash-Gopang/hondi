# 인수인계서 — 520개 제주 지역 SP 개별 내용 품질 평가 (2026-09-19)

**전제**: 이 문서는 같은 날 먼저 끝낸 `SESSION_SUMMARY_CONTROL_TOWER_LIVE_SMOKETEST_20260919_v1_0.md`의 후속 작업이다. 그 세션은 520개 SP의 **형식 준수**(관제탑 원칙 — 마크다운 금지·한 번에 한 단계)만 검증했고 60건 표본 전부 통과를 확인했다. 이번 세션은 **내용 품질**(사실관계 정확성·최신성·사무분장 정합성 등)이라는 별개 축을 다룬다 — 형식이 맞아도 내용이 틀리면 소용없다.

## 1. 대상

`pages/jeju-gov-automation.html`에 등록된 520개 SP 전부:

| 카테고리 | 건수 | directCode tier |
|---|---|---|
| 도청 실·국(do-dept) | 79 (25국 + division 54) | `do-dept:jeju:{spId}` |
| 도청 직속기관(do-agency) | 37 | `do-agency:{spId}` |
| 도 출자출연기관(org) | 110 | `org:{spId}` |
| 제주시청(jejusi) | 60 | `city-dept:{id}` / `city:{spId}` |
| 서귀포시청(seogwipo) | 50 | `city-dept:{id}` / `city:{spId}` |
| 읍면동 팀(emd/team) | 184 (43개 읍면동 × 팀) | `team:{읍면동명}-{팀이름}` |

시나리오/directCode 매핑은 이미 만들어져 있다: `tests/live_smoketest/scenarios_control_tower_govtree_jeju_full520_20260919.json` (520건, 스키마 `{id, directCode, renderText, pdvLocationHint, utterance, category, note}`). 5분할 파일(`..._part{1~5}of5.json`, 각 104건)도 있다 — 워크플로 타임아웃(30분) 대응용.

## 2. "내용 품질"이 형식 준수와 다른 이유

형식 준수 테스트(`control_tower_live_smoketest.py`)는 순수 패턴 매칭(`_violatesConversationalStyle`과 동일 철학 — 마크다운 헤더/볼드/목록/길이)만 본다. 답변이 완벽한 형식으로 **틀린 사실**을 말해도 PASS로 집계된다. 이번 세션에서 확인이 필요한 것은 그와 독립적인 축들이다:

1. **사무분장 정합성** — "이 과/팀이 이 민원을 처리한다"는 주장이 실제 제주도/제주시/서귀포시 조직도와 맞는가.
2. **최신성** — 금액·기준·연령·소득기준선 등 구체적 수치가 2026년 기준으로 맞는가. `pages/jeju-gov-automation.html` 헤더 주석 자체가 이미 몇 가지 정합성 이슈를 알고 있다(§3 참조).
3. **정직한 불확실성 고지 vs 환각** — 확인 안 된 내용을 확정처럼 말하는지, 아니면 정직하게 "미확정/재검증 필요"라고 밝히는지. (참고: part1 재검증 중 뽑은 CT-0003 원본 응답이 이 축에서 오히려 모범 사례였다 — "장애인복지과 사무분장 자체가 미확정 잠정 초안", "조직개편 확정 시 재검증 대상"이라고 스스로 밝힘. 이런 정직한 고지는 감점 대상이 아니라 오히려 원하는 동작이라는 점에 유의 — "확정된 사실을 말하지 않았다"와 "거짓을 말했다"를 구분해서 평가할 것.)
4. **관할 지역 오안내** — 예를 들어 서귀포시 SP가 제주시 전용 서비스를 안내하는 등 지역 간 사무 혼동.

## 3. 이미 알려진 정합성 이슈 (페이지 자체 헤더 주석, 2026-09-17 기준)

`pages/jeju-gov-automation.html` 상단 주석에 이미 기록된 것들 — 평가 시 "새 발견"으로 착각하지 말고 알려진 것으로 취급:

- 제주시청 `agri`(농수축산국)·`health`(제주보건소)는 `CITY_DIVISION_TABLE`에는 있어(division 9개, 실제 라우팅 가능) 정상 작동하지만, `city-dept-master-data.json`의 국목록에는 컨테이너 레코드가 없다.
- 읍면동 팀 SP는 과 단위와 달리 팀별 정적 `.md` 파일이 아니라 템플릿(`SP-TEAM-*-TEMPLATE_v2.1.md`) + 데이터 조합으로 런타임 렌더링된다 — "SP 원문" 링크가 개별 파일이 아니라 템플릿 파일을 가리키는 게 정상이다.

이번 세션에서 추가로 발견·수정한 것(참고): 서귀포시 농수축산경제국 template 파일명 오타(PR #376, 이미 수정 완료).

## 4. 제안하는 방법론

520건을 전부 사람이 직접 검토하는 건 비현실적이다. 2단계를 제안한다:

**1단계 — LLM 비평가(critic) 1차 스크리닝**: 형식 검사와 별개로, 각 SP의 렌더된 시스템 프롬프트 + 실제 utterance에 대한 라이브 응답을 별도 LLM 호출로 채점하게 한다. 채점 축은 §2의 4가지. `control_tower_live_smoketest.py`를 참고해 새 스크립트(`content_quality_live_smoketest.py` 등)를 만들되, 채점 기준을 "형식"이 아니라 "다음 중 이 답변이 확정처럼 말한 구체적 사실(기관명·금액·연령·기준일 등)이 있는가 → 그 사실이 실제로 검증 가능한 근거(어느 SP 원본 파일)에서 나왔는가"로 잡을 것. 순수 패턴 매칭으로는 안 되고 LLM 판단이 필요한 영역이다 — 다만 LLM 채점 자체도 환각 가능하므로 신뢰도는 참고용으로만 쓰고, 2단계로 넘어갈 후보를 추리는 용도로 제한할 것.

**2단계 — 사람 표본 검토**: 1단계에서 "의심스러움" 플래그가 붙은 것 + 카테고리별 무작위 표본을 사람(피터)이 직접 열어 실제 조직도·공식 자료와 대조. 이번 세션에서 쓴 것과 같은 방식(무작위 10건씩 카테고리별 표본)을 재사용하면 된다.

## 5. 시작점

- `tests/live_smoketest/scenarios_control_tower_govtree_jeju_full520_20260919.json` — 520건 전체 목록, directCode 이미 검증됨(렌더 실패 0건, PR #376 반영 후).
- `tests/live_smoketest/render_govtree_prompts.mjs` — directCode → 실제 시스템 프롬프트 렌더링(그대로 재사용 가능).
- `tests/live_smoketest/control_tower_live_smoketest.py` — 형식 채점 스크립트, 채점 로직(`_check_*` 계열 함수 위치)을 참고해 내용 채점용으로 복제·개조.
- `.github/workflows/live-smoketest-control-tower-govtree.yml` — 워크플로 골격 재사용 가능(스크립트 이름만 바꾸면 됨). `DEEPSEEK_API_KEY` 시크릿 이미 등록되어 있어 즉시 실행 가능.
- 결과는 `results/live-smoketest-control-tower-govtree` 브랜치에 force-push되므로, 여러 배치를 동시에 못 돌린다(직렬 실행 + 매번 `gh run download`로 로컬 백업 권장 — 이번 세션에서 실제로 이 문제를 겪었다).

## 6. 주의사항 (이번 세션에서 겪은 함정)

- `scenarios_file` 워크플로 입력값은 **파일명만**(예: `scenarios_..._part1of5.json`), 전체 경로(`tests/live_smoketest/...`)를 넣으면 경로가 중복돼 실패한다.
- Windows PowerShell에서 `git am`으로 패치 적용 전에 반드시 해당 브랜치로 `checkout -b` 되어 있는지 확인할 것 — 두 차례 실수로 `main`에 직접 커밋이 올라간 적이 있다(다행히 내용 자체는 문제없었음).
- 결과 브랜치는 매 실행마다 force-push로 덮어써진다 — 여러 배치를 순차 실행할 계획이면 매번 `gh run download <run-id> -n live-smoketest-control-tower-govtree-results -D <배치별폴더>`로 로컬에 받아둘 것.
