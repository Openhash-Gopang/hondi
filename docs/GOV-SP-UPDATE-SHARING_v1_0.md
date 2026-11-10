# 정부 AI SP 갱신 기록·공유 메커니즘 v1.0 (2026-11-11)

## 규칙

모든 정부 AI SP는 다음 중 **하나라도** 해당하면 갱신해야 한다.

1. 해당 SP에 대한 **미반영 사용자 피드백 10건 이상**
2. **마지막 갱신 후 90일 경과**

갱신할 때는 ① 웹 검색 등으로 **최신 정보**를 확인하고 ② **다른 SP의 갱신 기록을 참고**하며 ③ **언제·어떻게·왜** 갱신했는지 원장에 기록한다. 기록은 **모든 정부 AI와 공유**된다.
(런타임의 30일 확인 의무 — K-Public_common P13 — 는 그대로다. 그것은 응답 시점의 확인이고, 이 문서의 갱신은 SP 파일의 영속 갱신이다.)

## 각 SP의 준수 방식

- **모든 정부 SP 파일(최신 버전)은 본문에 `## §UPDATE-RULE.` 블록을 갖는다** — 갱신 의무(10건/90일), 갱신 방법, 호출 시 행동이 SP 자신에게 적혀 있어 어느 SP를 로드해도 규칙이 따라온다. 정본 블록은 `tools/sp_update_log.py`의 `RULE_BLOCK`이며, 개정하면 `python3 tools/sp_update_log.py rule-apply`로 전 SP에 일괄 반영한다(멱등).
- 규칙의 정본 문장은 K-Public_common **P15**와 SP-10 **§UPDATE-SHARING**이다(두 파일은 블록을 따로 두지 않는다).
- **강제**: CI(`check-pr`)가 모든 정부 SP의 블록 보유·현행 일치를 검사한다 — 새 SP를 추가하면서 블록을 빼먹으면 PR이 막힌다. 정부 SP를 고치는 PR은 갱신 기록도 함께 추가해야 한다.
- 이번 변경은 **규칙 도입**이며 SP 내용을 최신화한 것이 아니다. 실제 최신화는 갱신 의무 SP(90일 경과)를 대상으로 하는 별도 갱신 작업이 규칙에 따라 수행하고 기록한다.

## 구성

| 요소 | 위치 | 역할 |
|---|---|---|
| **원장** | `data/sp-update-log/log.jsonl` | append-only. 한 줄 = 한 번의 갱신(여러 SP를 묶을 수 있음). 고치지 않고 정정 기록을 추가한다 |
| **도구** | `tools/sp_update_log.py` | `add`(기록 추가·검증·참고 후보 계산) · `digest`(공유 다이제스트 생성) · `due`(갱신 의무 SP 목록) · `check-pr`(CI) |
| **공유 다이제스트** | `prompts/gov-tree/00-common/GOV-UPDATE-DIGEST.md` | 최근 90일 전체 갱신 요약(9KB 상한). 매니페스트 키 `GOV-UPDATE-DIGEST` |
| **런타임 공유** | `gov-router.js` `_loadGovCommon`, `worker.js` K-Public 로더 | 도청·시청·읍면동 등 지방정부 체인과 국가기관 체인 **모두** 호출 시 다이제스트를 상위 지침 뒤에 붙인다(1시간 캐시, 실패해도 응답은 진행) |
| **SP 규칙** | K-Public_common **P15**, SP-10 **§UPDATE-SHARING** | 다이제스트를 읽고 따를 것, 검증수준 지킬 것, `[SP_UPDATE_SIGNAL]` 발행 |
| **월간 강제** | `docs/GOV-SP-MONTHLY-REVIEW_v1_0.md` + 장부 | 갱신 의무 SP를 월간 장부가 센다(`remaining_stale`, 후퇴 금지) |
| **CI 게이트** | `gov-sp-monthly-review.yml` | 정부 SP를 바꾸는 PR은 갱신 기록을 함께 추가해야 하고 다이제스트가 원장과 맞아야 통과 |

## 갱신 기록 한 건의 형식

```json
{"id":"U-YYYYMMDD-NNN", "ts":"2026-11-11",
 "sp_ids":["prompts/gov-tree/09-national/agencies/templates/SP-NAT-TAX-*"],   // 경로·글로브(여러 SP 일괄 가능)
 "trigger":"days90 | feedback10 | monthly | manual | initial",
 "why":"무엇 때문에 — 예: 종합소득세 신고 기한 안내 갱신",
 "how":{"method":["web_search","peer_digest","feedback","official_notice","general_knowledge","user_instruction"],
        "sources":["공식 URL (게시일)"], "peer_refs":["참고한 다른 갱신 id"], "feedback_ids":["반영한 피드백 id"]},
 "changes":[{"kind":"소관|법령|창구|명칭|연락처|절차|기한|양식|규칙|정체성|기타","summary":"바뀐 것"}],
 "verified":"web | peer | feedback | partial | unverified",
 "tags":["법령:근로기준법","기관:고용노동부","분야:노동"],   // 공유·참고 후보 계산에 쓰인다
 "author":"작성자(사람/에이전트)"}
```

검증 규칙: `web_search`를 썼으면 `sources` 필수, `peer_digest`를 참고했으면 `peer_refs` 필수, 피드백을 반영했으면 `feedback_ids` 필수, `verified=web`이면 웹/공식 근거 필수. **`unverified` 기록은 90일 시계를 되돌리지 않는다**(바뀐 것을 기록하되, 최신성 확인으로 쳐주지 않는다).

## 공유가 일어나는 세 경로

1. **런타임**: 모든 정부 AI가 호출될 때 최근 90일 전체 갱신을 함께 읽는다(P15-1). 한 기관이 법령 개정을 반영하면 같은 법령을 다루는 다른 기관 AI가 다음 호출부터 그 사실을 본다 — SP 파일이 갱신되기 전이라도.
2. **갱신 작업 시**: `add` 가 태그(법령·기관)를 본문에 언급하는 **다른 SP를 "참고 점검 후보"로 원장에 기록**한다. 다음 갱신 때 그 SP들을 우선 확인한다(권고, 강제 아님).
3. **응답 중 발견**: SP가 웹 검색으로 본문과 다른 최신 정보를 발견하면 `[SP_UPDATE_SIGNAL]`을 낸다 — 갱신 작업이 수집해 원장에 반영한다.

## 갱신 작업 절차(사람 또는 사람이 승인한 에이전트)

1. `python3 tools/sp_update_log.py due` — 갱신 의무 SP(90일·피드백 10건) 확인
2. **다이제스트와 원장에서 같은 태그의 다른 갱신을 먼저 확인**(참고)
3. 공식 출처(.go.kr·법제처·소관 기관)로 확인 → SP 수정 → 마지막 확인일(`legal_basis_last_verified`) 갱신
4. `python3 tools/sp_update_log.py add --file entry.json` → `python3 tools/sp_update_log.py digest`
5. PR 제출 — CI가 갱신 기록·다이제스트 동기를 검사한다

## 한계(정직하게)

- SP는 스스로 파일을 고치지 못한다. "스스로 갱신"은 위 갱신 작업이 대신 수행하며, 런타임에서는 다이제스트 참조와 신호 발행까지가 SP의 몫이다.
- `[USER_FEEDBACK]`·`[SP_UPDATE_SIGNAL]` 태그를 수집하는 서버 쪽 처리는 이 변경 범위 밖이다(기존 user_feedback·sp_update_proposals 경로와 사람의 취합을 병행). 태그 수집이 연결되기 전까지는 피드백 10건 판정이 PocketBase `user_feedback`의 `status=new` + `context_sp` 기준이다.
- 다이제스트는 길이 상한(9KB)이 있어 오래된/많은 기록은 원장 참조로 줄어든다. 기록이 많은 일괄 갱신은 묶음(`sp_ids` 글로브)으로 한 줄에 기록한다.
- 최초 기록 4건은 모두 `unverified`다(사용자 지시에 따른 구조 변경이며 법령·번호는 담당자 검증 필요).
