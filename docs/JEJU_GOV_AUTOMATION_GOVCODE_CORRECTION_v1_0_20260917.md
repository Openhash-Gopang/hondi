# 정정 — 실행 링크는 제안이 아니라 이미 구현되어 있었습니다

**이전 설계서(`jeju_gov_automation_design_spec.md`)의 핵심 내용을 뒤집는 정정 문서입니다.**
이전 문서는 "regional-gov.html에 sp/return 파라미터로 직접 여는 기능을 새로 구현해야 한다"고 제안했으나, 이는 틀렸습니다. `gov-router.js`(6,784줄)를 전량 받아 직접 확인한 결과, **`?gov_code=` 파라미터가 이미 2026-08-03부터 구현되어 있었고, K-정부 카탈로그가 실제로 쓰고 있는 기존 기능**이었습니다.

---

## 1. 실제 메커니즘 — `pages/regional-gov.html?gov_code={tier}:{code}`

`regional-gov.html`이 `_qs.get('gov_code')`로 읽어 `assembleGovSystemPrompt(..., directCode)`에 넘기면, `gov-router.js`의 `_assembleGovSystemPromptRaw()` §-0.9 분기가 이를 해석해 **AC의 자연어 키워드 매칭 단계를 완전히 건너뛰고** 해당 SP를 바로 조립합니다. 첫 턴에만 적용되고(`_govDirectCodeUsed` 플래그), 이후 대화는 자유롭게 이어집니다.

### tier별 code 형식 (원본 코드에서 그대로 확인)

| tier | code 형식 | 예시 | 용도 |
|---|---|---|---|
| `do-dept` | `{도코드}:{SP-DO-* 또는 SP-DIV-*}` | `do-dept:jeju:SP-DO-ECON` (국)<br>`do-dept:jeju:SP-DIV-ECON-JOBECONOMY` (과) | 도청 국·과 — 같은 tier가 국 코드로 못 찾으면 자동으로 `DO_DEPT_DIVISION_TABLE`에서 과 코드로 재시도 |
| `city-dept` | `{시코드}-{국코드}` | `city-dept:jejusi-jachi` | 시청 국(局) 단위 — 시코드·국코드 둘 다 하이픈 없음을 전제로 첫 `-`만 분리 |
| `city` | `{SP-CITY-* 또는 SP-CITYDIV-*}` | `city:SP-CITYDIV-JEJUSI-JACHI-GENERAL` | 시청 자체 또는 시청 과(課) 단위 |
| `emd` | `{읍면동명}` | `emd:애월읍` | 읍면동 행정복지센터 자체 |
| `team` | `{읍면동명}-{팀이름}` | `team:애월읍-총무팀` | 읍면동 산하 팀 |
| `do-agency`/`org` | (본 페이지 범위 밖) | — | 직속기관(농업기술원 등)/출자출연기관 — k-government 카탈로그의 다른 섹션이 이미 사용 중 |

`do-dept`의 도 코드는 선택 사항이지만, 여러 도가 같은 도메인 코드(`SP-DO-PLAN` 등)를 공유할 수 있어 명시하는 쪽이 안전합니다 — 이 페이지는 제주 전용이므로 항상 `jeju`로 고정했습니다.

## 2. 이 페이지에 반영한 것

`jeju-gov-automation-v5.html`의 실행 링크를 전부 실제 형식으로 교체했습니다.

- 도청 국 카드 → `doDeptUrl(spId)` → `do-dept:jeju:{spId}`
- 도청 과 카드 → `doDeptUrl(spId)` (같은 tier, 과 코드는 division 테이블 폴백으로 자동 해석됨)
- 시청 국 카드 → `cityDeptUrl(bureau.id)` — bureau id를 생성할 때부터 `{시코드}-{국코드}` 형식(`jejusi-jachi` 등)으로 만들어 뒀으므로 그대로 재사용
- 시청 과 카드 → `cityDivUrl(spId)` → `city:{spId}`
- 읍면동 카드 → `emdUrl(읍면동명)` → `emd:{읍면동명}`
- 팀 카드 → `teamUrl(읍면동명, 팀이름)` → `team:{읍면동명}-{팀이름}`

"제안·미구현" 배지는 전부 제거했습니다 — 더 이상 제안이 아니라 이미 동작하는 링크입니다.

## 3. 검증

jsdom으로 실제 DOM에서 각 tier의 링크를 클릭 시뮬레이션해 생성된 URL을 확인했습니다.

```
do-dept:jeju:SP-DIV-ECON-JOBECONOMY   (도청 경제정책과)
city-dept:jejusi-jachi                (제주시청 자치행정국)
city:SP-CITYDIV-JEJUSI-JACHI-BASICGOVPREP  (제주시청 자치행정국 기초자치단체 설치준비지원단)
team:구좌읍-총무팀                     (구좌읍 총무팀, 한글 URL 인코딩 정상)
```

전부 `_assembleGovSystemPromptRaw()`가 파싱하는 형식과 정확히 일치합니다. 다만 이 확인은 **URL 생성까지**이며, `regional-gov.html`을 실제로 열어 해당 SP가 맞게 로드되는지(런타임 최종 확인)는 브라우저 환경에서 사람이 한 번 더 검증하는 것을 권장합니다.

## 4. 남은 스코프 밖 항목

- `do-agency`(직속기관 10곳)·`org`(출자출연기관 26곳) tier는 이 페이지(국·과·팀 드릴다운)의 범위 밖이라 반영하지 않았습니다. k-government 카탈로그의 "제주 직속기관"/"제주 출자출연기관" 섹션이 이미 이 tier를 쓰고 있을 가능성이 높습니다.
- `province` tier(`province:jeju`, 도청 자체 진입)도 이 페이지에서는 쓰지 않았습니다 — 현재 도청 탭 진입 시 바로 국 목록을 보여주고, "도청 자체 SP"를 여는 상위 개념 카드는 없기 때문입니다. 필요하면 상단 기관 탭 자체에 실행 버튼을 추가로 붙일 수 있습니다.
