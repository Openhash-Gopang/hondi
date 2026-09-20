# prompts/ 최상위 페르소나 구버전 archive 정리 — 2026-09-20

## 방법
1. `prompts/sp-catalog.json` 매니페스트가 가리키는 파일(651개)을 "라이브"로 확정.
2. 같은 base-name(버전 접미사 제외)으로 2개 이상 버전이 공존하는 78개 그룹(390개 파일) 중, 매니페스트 미참조 파일을 구버전 후보로 추림.
3. 매니페스트에 아예 안 걸린 7개 그룹은 코드(`grep -rn`)로 실제 fetch되는 버전을 직접 확인:
   - `AC-EVOLUTION` → v1_1 라이브(worker.js에서 확인, 최신 버전 v1_5가 아님에 주의)
   - `SP-AUTHOR` → v1_15 라이브
   - `AGENCY-AC-COMMON` → v1.5 라이브(gov-router.js 하드코딩 fetch)
   - `ROUTING-BRANCH-REFERENCE`·`SP-AUTHOR-EXPERT`·`AC-AUTHOR-ORG`·`AGENCY-COMMON-TEMPLATE` → 코드에서 실제 fetch하는 곳을 못 찾음(주석·다른 카탈로그 파일에서만 언급) → **이 4개 그룹은 전부 손대지 않고 그대로 둠**, 다음 세션에서 재조사 필요.
4. 위 기준으로 확정된 **307개**를 `prompts/archive/`로 이동. 그중 109개는 이미 archive에 동일 내용 사본이 있어(과거 어느 세션이 부분적으로 정리해둔 흔적) 최상위 것만 제거, 1개(`SP_sanitarian_v1_2.md`)는 최상위 쪽이 더 최신 내용이라 그 버전으로 archive 사본을 덮어씀.

## 검증
- 매니페스트가 참조하는 651개 파일 전수 존재 확인(0건 누락).
- 라이브 하드코딩 fetch 대상(`AGENCY-AC-COMMON_v1.5.md` 등) 개별 재확인.
- **작업 중 실수 한 번 발생**: 로컬 작업 트리가 이전 단계 상태와 꼬여 `AGENCY-AC-COMMON_v1.5.md`를 포함해 라이브 버전까지 archive로 옮길 뻔했다 — 커밋 전 `git status`/`git show HEAD:...` 대조로 발견해 전부 되돌리고 처음부터 다시 했다. 이 경험 때문에 최종 실행 전 "라이브 파일이 archive 후보에 안 걸려 있는지" 자동 sanity check를 추가했다.

## 결과
`prompts/` 최상위 파일 수: 972 → 665.

## 다음 세션 후보
- ROUTING-BRANCH-REFERENCE(3버전)·SP-AUTHOR-EXPERT(2버전)·AC-AUTHOR-ORG(2버전)·AGENCY-COMMON-TEMPLATE(2버전), 총 9개 파일이 미해결로 남음 — 실제로 어디서도 fetch 안 되는 완전 죽은 문서인지, 아니면 제가 못 찾은 경로로 여전히 쓰이는지 확인 필요.
