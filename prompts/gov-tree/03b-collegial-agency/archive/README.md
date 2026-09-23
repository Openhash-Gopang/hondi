# 2026-09-24 — 합의제행정기관 새 K-FOI tier(collegial) 신설(작업 #16)

## 왜 새 tier인가

`prompts/gov-tree/kfoi-digest/org-baseline-agency.json`(작업 #12~#14, 2026-09-22~23)는
「제주특별자치도 행정기구 설치 및 정원 조례 시행규칙」(제938호, 2026.8.25. 시행) 제5장(합의제행정기관,
제60조~제63조의3)에 감사위원회·지방노동위원회·자치경찰위원회 3개 기관이 실려 있는데도 K-FOI 다이제스트의
어떤 유형(do/jeju-si/seogwipo/agency/org/emd)에도 담기지 못한다는 것을 확인하고, 이를
`missing_in_inventory`가 아니라 `open_questions`에 "합의제행정기관 3개를 K-FOI의 어느 유형에 넣을지 —
기존 6개 유형에 없는 새 범주다"로 정직하게 남겨뒀다.

프로젝트 총괄(피터/주피터)의 명시적 지시는 이 열린 질문을 기존 유형에 억지로 끼워맞추지 말고 **완전히
새 digest tier를 만드는 방향**으로 풀라는 것이었다. 조직법적으로도 그럴 근거가 있다 — 03-do-agency
(직속기관·사업소)는 지방자치법 제125조 근거로 **도지사 소속·지휘를 받는 집행조직**인 반면, 합의제행정기관은
지방자치법 제130조 근거로 **독립적 의사결정 합의체**다(예: 감사위원회는 감사의 독립성을 위해, 자치경찰
위원회는 경찰사무 심의·의결의 독립성을 위해 설치된다). 이 차이는 이름만 다른 게 아니라 §LEGAL-BASIS에서
설명해야 하는 실질적 조직법 성격 차이라, 기존 institution kind에 욱여넣기보다 새 kind(`committee`)·새 tier
(`collegial`)로 분리하는 편이 정직하다고 판단했다.

## 왜 이 디렉토리 이름·명명 규칙인가

`ls prompts/gov-tree/`로 확인한 기존 디렉토리 명명 규칙은 계층 순서를 숫자 접두어로 표현한다
(00-common, 01-do, 02-do-dept, 03-do-agency, 04-city, 05-emd, 06-expert, 07-org, 08-schema,
09-national). 합의제행정기관은 도지사 직속기관·사업소(03-do-agency)와 위상은 비슷하지만(둘 다 도 산하
개별 기관 단위, 도청 실·국보다 한 단계 아래) 조직법적 성격이 다르므로, 전혀 무관한 새 번호(예: 10-)를
붙이기보다 **03 바로 옆(03b-collegial-agency)**에 두어 "03-do-agency와 같은 계층 위상이지만 다른 갈래"
라는 관계를 디렉토리 이름 자체로 드러내기로 했다. 내부 구조(institution 파일은 최상위, division 파일은
`divisions/`, 배치 기록은 `archive/README.md`)도 03-do-agency와 동일한 관례를 그대로 따랐다.

SP 코드 접두어는 기존 `SP-AGY-*`(institution)·`SP-AGYDIV-*`(division)와 명확히 구분되도록 새로 정의했다 —
`SP-COMM-*`(institution, "위원회committee"에서)·`SP-COMMDIV-*`(division). 사용자 지시의 예시
(SP-COMM-AUDIT·SP-COMM-LABOR·SP-COMM-POLICE)를 그대로 채택했다.

## 스키마 변경 — `tools/build_kfoi_digest.mjs`

최소 침습 원칙에 따라 기존 `do-agency` tier의 로직(파일 스캔 `findByPrefix`, org-baseline 대조
`applyOrgBaseline`, 상태 판정 `entryFrom`/`parseSp`)을 전부 그대로 재사용했다 — 새 코드를 추가한 곳은
다음 세 지점뿐이다.

1. `ORG_BASELINE_FILES`에 `collegial: org-baseline-collegial.json` 한 줄 추가(기존 tier마다 파일 하나씩
   갖는 패턴 그대로).
2. `TIER_LABELS`에 `collegial: '합의제행정기관'` 한 줄 추가.
3. `staticTiers` 배열에 `['collegial', data.DO_COLLEGIAL, '03b-collegial-agency', 'committee']` 한 줄
   추가 — `kind`를 기존 institution이 아니라 새 값 `'committee'`로 줘서 digest 항목에서 도지사 직속
   집행조직과 명확히 구분되게 했다.
4. `applyOrgBaseline`의 조건문(`e.kind === 'bureau' || e.kind === 'institution'`)에 `'committee'`를
   추가해야 했다 — 안 하면 org-baseline 대조(org_counts 등)가 조용히 비어버리는 결함이 있었다(테스트로
   발견, 즉시 수정).

이 4곳 외에는 `buildDigest`·`applyOrgBaseline`·`serialize`·`toMarkdownChunks` 등 어떤 함수도 tier별로
분기하지 않는다 — 애초에 데이터 배열(`data.DO_COLLEGIAL`)과 org-baseline 파일 하나만 있으면 새 tier가
기존 파이프라인을 그대로 통과하도록 설계돼 있었기 때문이다.

`src/worker/kfoi-digest.js`의 `TIER_KEYS_HINT`(오류 메시지에 쓰는 tier 목록)와 `how_to_read`의 kind 설명
(`bureau·division·institution·emd` → `...·committee·emd`)도 함께 갱신했다 — 안 하면 K-FOI 청구
비서에게 잘못된 tier 목록을 안내하게 된다.

## 새 org-baseline 파일 — `org-baseline-collegial.json`

`org-baseline-agency.json`과 동일한 필드 구조(`tier`/`as_of`/`basis`/`confidence_note`/
`official_units`/`expected_counts`/`missing_in_inventory`/`corrections`/`open_questions`/`sources`/
`mapping`)로 새로 만들었다. `missing_in_inventory`에 있던 3건(감사위원회·지방노동위원회·자치경찰위원회)을
전부 `mapping`으로 옮기고(이번에 SP를 만들었으므로 missing이 아니라 match), `org-baseline-agency.json`
쪽에서는 그 3건을 완전히 지우고 `corrections`에 "새 tier로 이동했다"는 기록만 남겼다(expected_counts의
"합의제행정기관: 3" 행도 함께 뺐다).

## 사무 원문(별표) 확보 여부 — 기관마다 다르다

작업 전 `duties-raw-2024-01-22.json`(별표7~11 전체)을 감사위원회·지방노동위원회·자치경찰위원회와 7개
division 이름 전부로 검색했다. 결과가 갈렸다.

- **지방노동위원회 사무국**·**자치경찰위원회 자치경찰총괄과**: 별표10_합의제행정기관에 실제 사무 원문이
  있었다(각각 17건·16건) — 그대로 옮겨 confidence: high.
- **자치경찰위원회 자치경찰협력과**: 별표10에 "협력과"라는 이름은 없고 "자치경찰정책과"(15건)만 있다 —
  2026.8.25. 시행 조례에서 개명됐을 가능성이 높지만 사무 범위가 그대로 이어졌는지 확정하지 못해, 옛 이름
  원문을 잠정 사용하고 confidence: medium으로 표기했다(작업 #14의 "이름은 확인, 사무는 추정" 패턴과 유사).
- **감사위원회 4개 division**(감사과·조사과·심의과·부패방지지원센터): 별표10 어디에도 감사위원회 자체가
  없다 — 별표10에는 지방노동위원회·자치경찰위원회 항목만 있다. 작업 #14의 정직한 최소-공시 방식을 그대로
  따라, 각 division §2를 명칭에서 합리적으로 추정한 3~4개 항목만 담고 confidence: low로 표기했다.

## 명칭 충돌 발견

1. **지방노동위원회 vs SP-NAT-LABORREL(매우 중요)** — `gov-router.js`의 `JEJU_NATIONAL_TABLE`에 이미
   `SP-NAT-LABORREL`("제주지방노동위원회(고용노동부)")가 키워드 `['노동위원회', '부당해고']`로 등록돼
   있다. 그런데 이번에 확인한 시행규칙 원문은 지방노동위원회를 **도 소속** 합의제행정기관(제62~63조)으로
   분류한다. 노동위원회법상 지방노동위원회는 통상 고용노동부 소속 특별행정기관이지만, 제주특별자치도는
   특별법에 따라 예외적으로 도 소속으로 운영하는 것으로 보인다 — 즉 **두 SP가 같은 실체를 서로 다른
   소속으로 가리키고 있을 가능성이 매우 높다.** 이번 배치에서는 해결하지 않고 SP-COMM-LABOR §6·
   org-baseline-collegial.json의 open_questions에 정직하게 기록만 남겼다. 새 division-tables.js 항목의
   kw에는 bare "노동위원회"·"부당해고"를 넣지 않고 "지방노동위원회 사무국"·"조정사건"·"중재사건" 등
   복합어·사무명 위주로 구성했다.
2. **자치경찰위원회(위원회) vs 자치경찰단(SP-AGY-POLICE, 집행조직)** — 둘은 법적으로 별개 기관이다
   (전자는 자치경찰사무 정책심의·의결기구, 후자는 실제 집행조직). "자치경찰"이라는 낱말을 공유한다고
   해서 같은 기관으로 취급하면 안 된다 — 새 kw에는 bare "자치경찰"을 넣지 않고 "자치경찰위원회" 전체
   명칭·위원회 고유 사무명(위원구성협의체 등) 위주로 구성해 SP-AGY-POLICE의 기존 키워드(관광경찰·
   생활안전·자치경찰단·지역 특성 치안)와 겹치지 않게 했다.
3. **감사위원회 vs bare "감사" 키워드** — `division-tables.js`(SP-ORGDIV-JTO-AUDIT의 "감사"·"감사팀")·
   `gov-router.js`(SP-DO-COMM 청렴감찰관의 "감사")에 이미 bare "감사" 키워드가 등록돼 있어, 새 항목의
   kw에는 bare "감사"를 넣지 않고 "감사위원회" 전체 명칭 위주로 구성했다(SP-AGY-VETERANS의 "보훈청"→
   "제주특별자치도 보훈청" 복합어 원칙과 동일).

세 충돌 모두 **실제 라우팅 우선순위·중복 해소는 재검증하지 않았다** — VETERANS/EMPLOYMENT/CENTRALCOOP
명칭 중복(작업 #12~#13)과 동일 클래스의 미해결 문제로 다음 배치 과제로 남긴다.

## gov-router.js 배선

`agency`/`org` tier와 동일한 패턴으로 `collegial`/`collegialDivision`을 `PROVINCE_TABLES.jeju`에
추가하고, accessor(`_collegialTable`/`_collegialDivisionTable`), fetch 함수(`_fetchCollegialText`),
division 판정 함수(`_resolveCollegialDivision`)를 각각 `_agencyTable` 계열과 나란히 추가했다. 메인
매칭 흐름(0.6단계)에는 agency→org 매칭이 실패한 뒤 마지막으로 collegial 매칭을 시도하도록 붙였고,
directCode(K-Search) 경로에도 `tier === 'collegial-agency'` 분기를 `do-agency`/`org`와 동일한 구조로
추가했다(기관 단위 코드 → division 단위 코드 폴백 순서 동일).

## 배선 안전성

새 기관 3개·division 7개 어디에도 실제 서비스에 연결된 task_key(GOV_TASK 접수 파이프라인)가 없다
(2026-09-24 확인) — 완전히 새로운 tier·디렉토리이므로 신설 시 안전하게 만들 수 있었다.

## 검증

`node tools/build_kfoi_digest.mjs --check`·`python3 tools/check_stale_refs.py`·
`node src/tests/kfoi-digest.test.mjs`(32/32)·`node src/tests/kfoi-duties-raw.test.mjs`(51/51) 전부
통과했다. 전체 테스트 스윕에서 `git stash`로 변경 전후를 대조한 결과, 이번 배치와 무관하게 원래부터
실패하던 5개 테스트 파일(c50-next-step-marker·conversational-style-guard·kplan-kwatch-kjob-dispatch·
sp-intercall·sp-tag-dispatch, 환경설정 의존으로 추정)을 제외하고 회귀가 없음을 확인했다.
`node --input-type=module`로 `division-tables.js`·`build_kfoi_digest.mjs`를 직접 로드해 문법 오류가
없음도 확인했다.

**이번 배치 이후에도 confidence: low(감사위원회 4개 division)·medium(자치경찰협력과)로 남는 항목이
있다** — 실제 서비스 라우팅(task_key)을 연결하기 전에는 반드시 최신 별표나 실제 조직 자료로 §2를
재검증해야 한다. SP-NAT-LABORREL과의 소관 중복도 다음 배치에서 해결해야 할 과제로 남는다.

# 2026-09-24 — 자치경찰위원회 ↔ 자치경찰단 상하관계 문서화(작업 #17)

위 배치에서 "명칭이 비슷해 라우팅 키워드 충돌 위험이 있다"고 open_questions에 남겨뒀던 것을
프로젝트 총괄에게 직접 확인 + 웹 조사로 해소했다. 자치경찰위원회(`SP-COMM-POLICE`)가 자치경찰단
(`SP-AGY-POLICE`, 03-do-agency)에 대해 실질적인 지휘·감독 권한을 행사하는 상급 컨트롤타워라는
사실을 jeju.go.kr 공식 설명·삼다일보 보도로 확인했다(웹 조사로 확인, 2026-09-24). 두 기관은 여전히
서로 다른 별개의 법인격이며(삭제·통합 없음), 이번에는 그 관계의 방향만 양쪽 SP에 명시했다 —
상세 내용은 `prompts/gov-tree/03-do-agency/archive/README.md`의 "2026-09-24 — 명칭 충돌 3건 정리"
항목 참고. 같은 배치에서 고용센터·중앙협력본부의 명칭 중복도 옛 SP(SP-DIV-ECON-EMPLOYCENTER·
SP-DO-LIAISON) archive로 정리했고, 지방노동위원회(`SP-COMM-LABOR` vs `SP-NAT-LABORREL`)는 프로젝트
총괄이 "확실하지 않음, 다음 배치에서 더 조사"라고 답해 이번에도 손대지 않고 open_questions에
그대로 남겨뒀다.
