# Gopang v3.4 릴리스 노트

**릴리스일:** 2026-05-23  
**작성:** AI City Inc. · 도영민  
**적용 파일:** `index.html`, `sw.js`, `gopang/prompts/SP-00_v7.0.txt ~ v9.0.txt`

---

## 주요 변경사항 요약

| # | 분류 | 내용 |
|---|------|------|
| 1 | 🐛 Fix | GPS 위치 인식 불안정 (watchPosition 전환, maximumAge:0) |
| 2 | 🐛 Fix | IP 폴백 위치 AI 미전달 버그 (source=IP 분기 누락) |
| 3 | 🐛 Fix | SW 자동 갱신 미작동 (SKIP_WAITING message 핸들러 추가) |
| 4 | 🐛 Fix | System prompt 미전달 버그 (history push 순서 오류) |
| 5 | ✨ Feat | DeepSeek Prefix Caching — system 1회 전송, 91% 토큰 절감 |
| 6 | ✨ Feat | SP-00 v9.0 — 4단계 폭포수 의사결정 구조 명시 |
| 7 | ✨ Feat | 동적 전문가 변신 — K-Law GitHub fetch 실제 작동 |
| 8 | ✨ Feat | 모델 교체: deepseek-v4-flash → deepseek-v4-pro |
| 9 | ✨ Feat | 1단계 자체해결 시 영역 태그 출력 제거 |
| 10 | ✨ Feat | PDV 대화 저장: 세션 종료 시 단 1회 (pagehide/visibilitychange) |
| 11 | ✨ Feat | 스마트폰 음성 인식 분기 (Android: Web Speech, iOS: MediaRecorder+STT) |

---

## 상세 변경 내역

### 🐛 1. GPS 위치 인식 불안정

**증상:** 데스크탑은 위치 파악, 스마트폰(Chrome/PWA)은 간헐적 실패.

**원인:**
- `getCurrentPosition()` 1회 시도 — 실패 시 재시도 없음
- `maximumAge: 60000` — 1분 캐시로 stale 위치 반환
- `timeout: 8000` — 모바일에서 PWA 배너와 충돌

**수정:**
```javascript
// Before
getCurrentPosition(ok, err, { timeout: 8000, maximumAge: 60000 })

// After
watchPosition(ok, err, { timeout: 5000, maximumAge: 0 })
```

**재발 방지 지침:**
> 1. `getCurrentPosition` 대신 `watchPosition` 사용 (재시도 자동)
> 2. `maximumAge` 는 항상 `0` — 캐시로 인한 stale 위치 방지
> 3. `timeout` 은 5000ms 이하 — 모바일 PWA 배너 충돌 방지
> 4. GPS 실패 시: IP 폴백 → PDV 주소 순서로 처리
> 5. `_locationReady = true` 는 체인 완료 후에만 설정

---

### 🐛 2. IP 폴백 위치 AI 미전달

**증상:** GPS 실패 후 IP로 "Jeju City" 획득했으나 AI가 "위치 정보 없음" 응답.

**원인:** `locNote` 조립 시 `source === 'IP'` 분기 누락.

**수정:** `_buildLocNote()` 독립 함수로 분리, 4가지 source 모두 처리.
```
GPS → 좌표+정확도
PDV → 등록 주소
IP  → 시/도 수준 (정확도 낮음 명시)   ← 추가
UNKNOWN → 위치정보 없음
```

**재발 방지 지침:**
> `_userLocation.source` 값은 반드시 4가지 분기 처리:
> `'GPS'` | `'PDV'` | `'IP'` | `'UNKNOWN'`
> `locNote`, `_updateLocationInPrompt`, `_buildLocNote` 모두 동일하게 유지.

---

### 🐛 3. SW 자동 갱신 미작동

**증상:** "업데이트 완료" 버튼 클릭해도 페이지 새로고침 안 됨.

**원인:** `sw.js`에 `message` 이벤트 핸들러 없음 → `SKIP_WAITING` 수신 불가.

**수정 (`sw.js` v1.0 → v1.1):**
```javascript
// 추가
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// 제거: install 자동 skipWaiting (사용자 동의 없이 강제 교체 방지)
```

**정상 흐름:**
```
새 sw.js 배포 → updatefound → 배너 표시
→ "지금 업데이트" 클릭 → SKIP_WAITING 전송
→ sw.js message 수신 → self.skipWaiting()
→ controllerchange → window.location.reload()
```

**재발 방지 지침:**
> 1. `sw.js` 에 `message` 핸들러 항상 유지
> 2. `install` 시 자동 `self.skipWaiting()` 호출 금지
> 3. CACHE_NAME 버전 변경 시 `activate` 에서 구버전 캐시 삭제 확인

---

### 🐛 4. System prompt 미전달

**증상:** `[Cache] prompt=11` — system 11토큰만 전달. AI가 위치/맥락 전혀 모름.

**원인:** `sendMessage()`에서 `history.push(user)` 후 `callAI()` 호출.
`callAI()` 진입 시 `history=[{role:'user'}]` → `history.length===0` 조건 false
→ system 삽입 안 됨 → `messages=[user]` 만 전송.

**수정:** `sendMessage()`에서 `history.push(user)` 제거.
`callAI()` 내부에서 순서 보장:
```
1. history.length === 0 → system 삽입 (최초 1회)
2. history.push(user)
3. messages = [...history.slice(0,-1), userContent]
4. 응답 완료 → history.push(assistant)
```

**재발 방지 지침:**
> 1. `callAI()` 호출 전 `history.push()` 절대 금지
> 2. history 조작은 `callAI()` 내부에서만
> 3. 수정 후 반드시 로컬 검증:
> ```javascript
> node -e "
> const h=[];
> // system 삽입 → user push → messages 구성
> // 검증: messages[0].role==='system', system 중복 없음
> "
> ```

---

### ✨ 5. DeepSeek Prefix Caching

**구조:**
```
history[0] = { role:'system', content: SP-00 v9.0 + GPS위치 }  ← 세션 최초 1회 고정
history[1..] = [user, assistant, user, assistant, ...]
messages = [...history, currentUser]
```

**효과:** 2번째 메시지부터 system prompt 캐시 히트.
콘솔 확인: `[Cache] prompt=1265 cached=1152 completion=1064 (절감율 91%)`

---

### ✨ 6. SP-00 v9.0 — 4단계 폭포수

```
1단계 자체해결  → 일반 질문·계산·위치 확인 → 태그 없이 즉시 답변
2단계 전문가변신 → K-Law·K-Medical 등     → 🔄[JUS] K-Law 모드 전환
3단계 외부AI호출 → 고팡 레지스트리 탐색   → 🔍[MKT] 탐색 중...
4단계 웹 검색   → 최후 수단              → 🌐[코드] 검색
```

**핵심:** 1단계로 해결 가능하면 영역 태그 없이 바로 답변.

---

### ✨ 10. PDV 대화 저장 — 세션 종료 시 단 1회

```javascript
// 트리거: 탭 닫기 / 앱 나가기 / 백그라운드 전환
window.addEventListener('pagehide', _saveOnce);
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') _saveOnce();
});

// 중복 방지
let _sessionSaved = false;
function _saveOnce() {
  if (_sessionSaved) return;
  _sessionSaved = true;
  _saveSessionOnce();
}
```

**저장 내용 (localStorage):**
```
키: gopang_history_{GUID}_{날짜}
값: [{ ts, domain, turns, summary(마지막 4턴) }]
```

---

## 버그 재발 방지 종합 체크리스트

### 위치 인식 수정 시
- [ ] `watchPosition` 사용 (getCurrentPosition 금지)
- [ ] `maximumAge: 0` 유지
- [ ] `timeout: 5000` 이하
- [ ] source 4가지 분기 확인 (GPS/PDV/IP/UNKNOWN)
- [ ] `_buildLocNote()` / `_updateLocationInPrompt()` 동시 수정

### History/Messages 수정 시
- [ ] `callAI()` 호출 전 `history.push()` 없음 확인
- [ ] 로컬 시뮬레이션으로 `messages roles` 검증
- [ ] `prompt 토큰 수` 정상 범위 확인 (1000+ 토큰)
- [ ] Prefix Cache 절감율 콘솔 확인

### Service Worker 수정 시
- [ ] `message` 핸들러 존재 확인
- [ ] `install` 자동 `skipWaiting` 없음 확인
- [ ] CACHE_NAME 버전 변경 확인

### System Prompt 수정 시
- [ ] 영역 태그: 1단계 출력 금지, 2단계 이상만 허용
- [ ] "매 응답 말미 필수 출력" 형태 지시 금지
- [ ] 예시 포함 (LLM이 규칙을 예시로 이해)
- [ ] `node` 스크립트로 핵심 규칙 검증
