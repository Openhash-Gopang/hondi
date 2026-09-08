# 혼디 검색 (Hondi Search) 설계 문서

## 1. 목적과 K-Search와의 구분

| 구분 | 혼디 검색 (Hondi Search) | K-Search |
|---|---|---|
| 검색 대상 | **사이트 내 페이지/기능** (desktop.html 트리) | **사용자 소유 데이터** (메일함, 문서함 등) |
| 질의 방식 | 대화형 자연어, 의도 명확화 | 단건 질의 |
| 결과 | 페이지 네비게이션(새 탭 이동) | 데이터 레코드 반환 |
| 예시 | "메일 검색" → 발신/수신 UI인지, K-Mail 시스템 소개 페이지인지 되물음 | "지난주 김민수 메일" → 실제 메일 레코드 검색 |

혼디 검색은 "어디로 가야 하는지"를 찾아주는 **내비게이션 어시스턴트**이고, K-Search는 "무엇을 찾는지"를 찾아주는 **데이터 검색기**입니다.

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

- SP-TREE-REGISTRY(기존 SP 아키텍처의 단일 출처)를 재사용하거나,
  desktop.html의 11개 정책 도메인 탭 + /domains/ + /highlights/ + 각 K-service 랜딩 페이지를
  별도 `site-manifest.json`으로 관리 (경로, 설명, 키워드 배열).
- 매니페스트는 빌드 타임에 생성하거나, Worker에서 KV/PocketBase 캐시로 관리 후
  요청마다 SP에 주입.

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

**POST /api/hondi-search**
```json
// request
{
  "conversation_id": "uuid",
  "message": "메일 검색",
  "history": [{"role": "user"|"assistant", "content": "..."}]
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

- 상단 검색 필드 클릭 시 대화형 팝오버 오픈.
- 사용자가 입력 → `/api/hondi-search` 호출 → 응답 type에 따라:
  - `clarify`: 봇 메시지 표시, 입력 계속.
  - `navigate`: 봇 메시지 짧게 보여준 뒤 `window.open(url, "_blank")`.
  - `candidates`: 클릭 가능한 카드 3개 렌더링, 클릭 시 새 탭 이동.
  - `delegate_ksearch`: "K-Search로 이동" 버튼 제공(별도 검색 시스템 진입).
