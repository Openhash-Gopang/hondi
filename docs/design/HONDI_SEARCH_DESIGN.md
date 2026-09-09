# 혼디 검색 (Hondi Search) 설계 문서

## 1. 목적과 K-Search와의 구분

| 구분 | 혼디 검색 (Hondi Search) | K-Search |
|---|---|---|
| 검색 대상 | **사이트 내 페이지/기능** (desktop.html 트리) | **사용자 소유 데이터** (메일함, 문서함 등) |
| 질의 방식 | 대화형 자연어, 의도 명확화 | 단건 질의 |
| 결과 | 페이지 네비게이션(새 탭 이동) | 데이터 레코드 반환 |
| 예시 | "메일 검색" → 발신/수신 UI인지, K-Mail 시스템 소개 페이지인지 되물음 | "지난주 김민수 메일" → 실제 메일 레코드 검색 |

혼디 검색은 "어디로 가야 하는지"를 찾아주는 **내비게이션 어시스턴트**이고, K-Search는 "무엇을 찾는지"를 찾아주는 **데이터 검색기**입니다.

**모호성 처리 원칙(2026-09-09 실사로 확정)** — "메일 검색"처럼 서비스명+막연한 "검색"만 있는 질의는
초기 모델 테스트에서 곧바로 K-Search 위임으로 응답한 사례가 나왔다. 이는 규칙 위반은 아니지만
원래 기획 의도(예시 표의 "발신/수신 UI인지, 소개 페이지인지 되물음")와 어긋난다. SP에 우선순위
규칙을 명시해 고정: 검색 대상이 구체적으로 명시되지 않은 질의는 항상 먼저 명확화 질문을 던지고,
사람·기간·내용 등 구체적 검색 조건이 포함된 질의만 곧바로 K-Search로 위임한다.

## 2. 혼디 검색 SP (System Prompt)

```
당신은 혼디(hondi.net)의 사이트 내 검색 도우미 "혼디 검색"입니다.

역할:
- 사용자의 자연어 질의를 분석하여, 아래 제공되는 사이트 페이지 매니페스트 중
  사용자의 의도에 가장 부합하는 목적지를 찾습니다.
- 단순 키워드 매칭이 아니라 의도 파악에 기반합니다.

동작 규칙:
1. 질의가 모호하면(예: 여러 페이지가 후보이거나, 목적이 불분명하면)
   명확화 질문을 1회 던집니다. 명확화는 최대 2라운드까지만 허용합니다.
1-1. "OO 검색"처럼 서비스/기능 이름 뒤에 막연히 "검색"만 붙은 질의는 그 자체로
   (a) 그 서비스 페이지로 이동하려는 의도인지, (b) 그 서비스 안에서 본인 데이터를
   찾으려는 의도인지 구분이 안 됩니다. 이런 경우는 규칙 4(K-Search 위임)보다
   먼저 규칙 1(명확화)을 적용해 반드시 한 번 되물으십시오.
   예: "메일 검색" → "메일을 보내거나 받으실 건가요? 아니면 혼디의 메일
   시스템을 알고 싶으세요?"
   반면 찾으려는 대상이 구체적으로 명시된 질의(사람, 기간, 내용 등 검색
   조건이 포함된 경우 — 예: "지난주에 김민수한테 받은 메일 찾아줘", "내가
   저장한 계약서 찾아줘")는 모호하지 않으므로 되묻지 않고 곧바로 규칙 4를
   적용합니다.
2. 명확화 후에도 여전히 모호하면 최상위 후보 3개를 candidates로 제시합니다.
3. 목적지가 명확해지면 navigate로 응답하며, 새 탭으로 이동할 URL을 반환합니다.
4. 당신은 사용자 데이터(메일함, 문서 등)에 접근하지 않습니다.
   데이터 자체를 찾는 요청은 K-Search 영역이므로,
   "OO을 찾으시는 건 K-Search가 담당합니다"라고 안내하고 K-Search로 위임합니다.
5. 응답은 반드시 아래 JSON 스키마만 출력합니다. 그 외 텍스트를 포함하지 않습니다.

응답 스키마:
{
  "type": "clarify" | "navigate" | "candidates" | "delegate_ksearch",
  "message": "사용자에게 보여줄 한국어 문장",
  "url": "type=navigate일 때만, 이동할 절대경로 URL",
  "candidates": [{"label": "...", "url": "..."}]  // type=candidates일 때만
}

[사이트 매니페스트]
{{SITE_MANIFEST_JSON}}

[대화 히스토리]
{{CONVERSATION_HISTORY}}
```

## 3. 사이트 매니페스트 소스

- 정본은 `site-manifest.json` (**리포 루트**에 배치 — `public/` 아님. GitHub Pages가 hondi.net을
  리포 트리 그대로 미러링하므로 `public/`에 두면 `hondi.net/public/site-manifest.json`으로 서빙되어
  Worker가 찾는 `https://hondi.net/site-manifest.json`과 어긋난다 — 2026-09-08 실사로 발견/수정).
  desktop.html의 11개 정책 도메인 탭(/domains/*), /highlights/*, 각 K-service 랜딩 페이지,
  사용법 매뉴얼 등 22개 항목을 1차로 채워둠 — 페이지 추가/개편 시 이 파일을 갱신하는 것이 원칙.
- 장기적으로는 SP-TREE-REGISTRY(기존 SP 아키텍처의 단일 출처)에서 자동 생성하도록 전환 가능.
- Worker(`hondi-search-worker.js`)는 `loadManifest()`에서:
  1. KV 캐시(`site-manifest`, TTL 1시간)를 먼저 확인
  2. 없으면 `site-manifest.json`을 원본에서 fetch해 캐시에 저장
  3. 원본 fetch까지 실패하면 코드 내 `FALLBACK_MANIFEST`(최소 4개 항목)로 저하 운영

예시 항목:
```json
{
  "path": "/services/kmail",
  "title": "K-Mail",
  "description": "자연어 명령으로 메일을 보내고 받는 혼디 사용자 메일 기능",
  "keywords": ["메일", "이메일", "K-Mail", "발신", "수신"]
},
{
  "path": "/docs/kmail-intro",
  "title": "K-Mail 소개",
  "description": "K-Mail 시스템 자체에 대한 설명 문서",
  "keywords": ["메일 시스템", "K-Mail이란", "메일 기능 소개"]
}
```

## 4. API 계약 (프런트 → Worker → deepseek v4 flash)

**POST /hondi-search**
```json
// request
{
  "conversation_id": "uuid",
  "message": "메일 검색",
  "history": [{"role": "user"|"assistant", "content": "..."}],
  "attachment": {                 // 선택 - 2026-09-09 신설
    "name": "notes.txt",
    "mimeType": "text/plain",
    "content": "텍스트 계열 파일만 - 최대 4000자, 이미지 등은 생략"
  }
}

// response (Worker가 deepseek 응답을 그대로 릴레이)
{
  "type": "clarify",
  "message": "메일을 보내거나 받으실 건가요? 아니면 혼디의 메일 시스템을 알고 싶으세요?"
}
```

Worker 책임:
1. `conversation_id`로 히스토리 로드(짧은 TTL, PocketBase 또는 KV).
2. 사이트 매니페스트 로드(캐시).
3. SP + 매니페스트 + 히스토리 + 신규 메시지로 deepseek v4 flash 호출, `response_format: json`.
4. 응답 검증(JSON 스키마) 후 그대로 프런트에 반환, 히스토리에 turn 추가.
5. `type: navigate`가 나오면 대화 세션 종료(TTL 만료 또는 명시적 clear).

## 5. 프런트엔드 동작 (desktop.html)

- 위치: 헤더가 아니라 hero-top-actions(인프라/전문가/정부/오픈해시 4버튼) 아래,
  카드 섹션(ai-gov-how) 위, 중앙 정렬 (2026-09-09 이동).
- UI 스타일: Claude 채팅 입력창과 동일한 pill 형태 — 왼쪽 클립(첨부) 버튼,
  텍스트 입력, 마이크 아이콘(현재는 준비 중 안내만 표시). (v3, 2026-09-09)
  기능이 파일 첨부 하나뿐이라 "+" 드롭다운 메뉴는 걷어내고 클립 버튼을
  직접 눌러 바로 파일 선택기가 뜨도록 단순화. 같은 버튼을 다시 누르면
  첨부가 해제된다(토글) — 첨부 상태는 버튼 색상 변화로만 표시하고 별도
  칩 UI는 두지 않는다.
- 파일 첨부: 텍스트 계열 파일(.txt/.md/.json/.csv, 300KB 이하)은 내용 일부를
  질의에 첨부해 함께 전송. 이미지 등 그 외 파일은 파일명/타입만 전달 —
  deepseekChat이 텍스트만 지원하므로 이미지 내용 자체는 분석하지 않는다.
- 사용자가 입력 → `/hondi-search` 호출 → 응답 type에 따라:
  - `clarify`: 봇 메시지 표시, 입력 계속.
  - `navigate`: 봇 메시지 짧게 보여준 뒤 `window.open(url, "_blank")`.
  - `candidates`: 클릭 가능한 카드 3개 렌더링, 클릭 시 새 탭 이동.
  - `delegate_ksearch`: "K-Search로 이동" 버튼 제공(별도 검색 시스템 진입).
