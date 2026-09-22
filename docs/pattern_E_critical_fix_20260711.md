# 패턴 E 재검증 — ★★★ 치명적 결함 발견 및 수정 (2026-07-11)

## 결론 먼저

Phase 1("K-Search 실제 검색 실행 로직 구현", `혼디_파이프라인_보완계획.md`에 ✅ 완료로
기록됨)이 실제로는 **`call-ai.js` 전체를 브라우저에서 파싱조차 안 되는 상태로 만들어
놓고 있었습니다.** 이건 패턴 E(25%) 하나의 문제가 아니라 **hondi.net 메인 포털의
AI 채팅 전체(패턴 A/D/F/G/I 포함 전부)가 멈춰 있었을 수 있는** 최상위 심각도의
결함입니다. 지금 수정하고 실제 ES 모듈 파서로 재검증까지 마쳤습니다.

## 어떻게 발견했나

패턴 E를 다시 보려고 `_handleKSearchExecutionTag`(Phase 1이 신설했다는 함수)를
찾다가, 함수를 설명하는 문서화 주석(JSDoc)은 있는데 **실제 `function` 선언 줄
자체가 파일에 없다**는 걸 발견했습니다. `grep -n "function _handleKSearchExecutionTag"`
결과 0건. 같은 방식으로 확인하니 `_handleSPAuthorTags`도 마찬가지였습니다.

처음엔 "혹시 화살표 함수 스타일로 어딘가 다르게 선언됐나"부터 의심했지만, 실제
파일을 읽어보니 두 함수의 **본문 코드는 멀쩡히 존재하는데 그 앞의 선언 줄만
빠져 있었습니다** — 마치 `export async function _handleKSearchExecutionTag(...) {`
한 줄이 편집 중에 통째로 유실된 것처럼요. 본문이 끝나는 지점엔 정상적으로
`return true; }`가 있으니, 그 `return`문들이 **함수 밖(모듈 최상위)에 그대로
노출**되는 구조가 됐습니다.

## 왜 이게 "설계 특이점"이 아니라 진짜 결함인지 — 직접 검증

`call-ai.js`는 `import`/`export` 문법을 쓰는 ES 모듈이라, 실제 브라우저는 이걸
반드시 모듈로 파싱합니다. 모듈 최상위에 `return`문이 있으면 `SyntaxError: Illegal
return statement`로 **모듈 전체 로드가 실패**합니다. `.js` 확장자로 `node --check`를
돌리면 Node가 관대하게(CommonJS 스크립트로) 봐줘서 통과하지만, `.mjs`로 강제
확장자를 바꿔 진짜 ES 모듈로 파싱시키면:

```
$ node --check call-ai.mjs
call-ai.mjs:1126
  if (!m) return false;
          ^^^^^^
SyntaxError: Illegal return statement
```

인수인계 문서(§3)가 이미 "call-ai.js는 Node에서 직접 import 불가(브라우저 전용
코드 포함, top-level return 등)"라고 적어뒀던 게, 사실은 "브라우저만의 특성"이
아니라 **진짜 문법 오류를 잘못 진단해서 넘어간 기록**이었던 것으로 보입니다.

## 수정 내용

두 함수의 선언 줄을 실제 호출부(2584·2592행, 4개 인자: `fullReply, bubble, callAI,
userText`)와 문서화 주석의 설명에 맞춰 복구했습니다:

- `export async function _handleKSearchExecutionTag(fullReply, bubble, sendFn = callAI, userText = '') {`
- `export async function _handleSPAuthorTags(fullReply, bubble, sendFn = callAI, userText = '') {`

수정 후 `.mjs` 강제 재검증 → **정상 통과**(`node --check` exit 0).

## 덤으로 발견한 두 번째 버그(같은 파일, 별개 원인) — 함께 수정

`_callGeminiGeneral`·`_geminiResultToText`·`_showGeminiProgress`·
`_hideGeminiProgress`·`_fileToBase64` 5개 함수가 `call-ai.js`에서 **호출은 되는데
import가 안 돼 있었습니다**(이미지 첨부 후 Gemini 분석 경로를 탈 때마다
`ReferenceError`). 전부 `src/gopang/ai/vision.js`에 이미 정상 구현·export
돼 있길래, import 문 하나 추가로 해결했습니다.

## 전체 저장소 구문 재검증(같은 실수가 다른 파일에도 있을까 봐)

`src/gopang/` 아래 모든 `.js`(ai/ui/core/services/gwp/pdv/p2p/profile2.0)와
루트 레벨 스크립트를 전부 `.mjs`로 강제해 재검사했습니다. **1개 더 발견**:

### `src/gopang/services/kcleaner.js` — 별도의 치명적 결함(현재는 고아 파일이라 실피해 없음)

61행 `_callGeminiVision` 함수 안에서 백틱(`` ` ``)으로 시작한 템플릿 리터럴
문자열이 안 닫혀서, 그 뒤 파일 전체(`_parseKCleanerReply`, `_updateFiilReport` 등
K-Clean 사진신고 파싱·저장 로직 전부)가 문자열 안에 파묻혀 `SyntaxError:
Unexpected end of input`로 파일 전체가 깨져 있습니다.

**다행히 지금 당장 실피해는 없습니다** — `grep -rln`으로 확인한 결과 이 파일을
import하는 곳이 저장소 전체에 **단 한 곳도 없습니다**(고아 파일). 다만 이건
"패턴 없음"이 아니라 **D-13(fiil.kr 환경신고 — K-Clean 사진 신고, 조직 전체
커버리지 문서 기준)이 사실상 연결이 끊겨 있다**는 뜻입니다 — `worker.js`의
`UNIVERSAL_FORCED_K_SERVICES`엔 `'fiil-kcleaner'`가 등록돼 있는데(서버는 준비돼
있음) 정작 이걸 부를 프론트엔드 진입점이 없는 상태입니다.

**이 파일은 이번에 고치지 않았습니다** — 백틱 안에 파묻힌 원래 프롬프트 텍스트가
어디까지였고 실제 API 호출 로직이 어떻게 이어졌어야 하는지 추측으로 복원하면
위험합니다(K-Clean의 `_parseKCleanerReply`는 이미 완성도 높은 정규식 파싱
로직이라 대충 재구성하면 데이터 유실 위험). **다음 세션에서 별도로 다루는 걸
권장**하며, `vision.js`에 이미 있는 `_callGeminiVision`/`_showGeminiProgress`와
중복 정의라는 점도 함께 정리가 필요합니다(어느 쪽이 정본인지 결정 필요).

## 패턴 E 최종 상태

`call-ai.js` 로드 실패가 풀렸으니, Phase 1이 원래 의도한 대로 `_handleKSearchExecutionTag`가
정상적으로 `[SEARCH]{...}[/SEARCH]` 태그를 감지 → `worker.js`의 `POST /search`
(`handleSearch`, 확인 완료) 호출 → 결과를 `history`에 재주입 → `sendFn`으로 재귀
호출하는 흐름을 탑니다. 호출부의 게이팅(`CFG.system?.includes('K-Search')`)도
정상 확인했습니다. **패턴 E(전체 시나리오의 ~25%)는 이제 코드상으로는 완전한
경로를 갖췄습니다** — 다만 이건 정적 코드 검증이지 실제 브라우저 E2E 테스트는
아직입니다(다음 단계로 권장).

## 권고 — 재발 방지

이 두 결함(선언 유실, 템플릿 리터럴 미종료) 모두 **"AI가 큰 코드 블록을 삽입할 때
경계선 일부가 유실되는" 같은 계열의 실수**입니다. 인수인계 문서가 이미 "인접한
diff 블록은 병합해서 패치한다"는 원칙을 세워뒀는데, 이번 결함들은 그 원칙이
지켜지지 않았을 때 실제로 무슨 일이 벌어지는지 보여주는 사례입니다. 제안:
앞으로 `call-ai.js`처럼 큰 파일을 편집하는 fix.py/패치를 만들 때는, **적용
시뮬레이션 후 반드시 `cp x.js /tmp/x.mjs && node --check /tmp/x.mjs`로 실제
ES 모듈 구문 검증까지 하고 나서 제출**하는 걸 표준 절차에 추가하는 걸 권합니다
(`.js` 확장자 그대로 `node --check`하면 이번처럼 못 잡습니다).
