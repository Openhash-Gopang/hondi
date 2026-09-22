# 고팡 설정 창 구현 확정 계획서
> 작성일: 2026-06-14  
> 버전: v1.0 (사고실험 3회 반영)

---

## 1. 상태별 설정 창 확정 구성

### Guest 상태

```
┌─────────────────────────────┐
│ 설정                         │
├─────────────────────────────┤
│ 📱 스마트폰 권한 설정 안내    │  항상 표시
│   ▶ Android (크롬 브라우저)  │
│   ▶ iPhone / iPad (Safari)  │
├─────────────────────────────┤
│ 👤 고팡 아이디               │
│ 등록되지 않았습니다.          │
│ ┌──────────────────────┐    │
│ │ 표시될 이름            │    │  입력창
│ └──────────────────────┘    │
│ [       아이디 등록      ]   │  녹색 버튼
├─────────────────────────────┤
│ [🗑 앱 캐시 초기화         ]  │  항상 표시
└─────────────────────────────┘

숨김: AI 설정 버튼, 로그아웃, GDC Wallet, 기기 초기화
```

---

### 등록 사용자 상태

```
┌─────────────────────────────┐
│ 설정                         │
├─────────────────────────────┤
│ 📱 스마트폰 권한 설정 안내    │  항상 표시
│   ▶ Android                 │
│   ▶ iPhone / iPad           │
├─────────────────────────────┤
│ 👤 고팡 아이디               │
│ @금능#0996 (등록됨)          │  handle 표시
│                              │  아이디 등록 박스 숨김
├─────────────────────────────┤
│ [⚙️ AI 설정              ]   │  녹색 버튼 → 슬라이드 패널
├─────────────────────────────┤
│ [🚪 로그아웃              ]  │  빨간 테두리
│ [⚠️ 기기 완전 초기화      ]  │  회색, 작은 글씨
│ [🗑 앱 캐시 초기화         ] │  항상 표시
└─────────────────────────────┘

숨김: 아이디 등록 박스, GDC Wallet
```

---

### GDC 사용자 상태

```
┌─────────────────────────────┐
│ 설정                         │
├─────────────────────────────┤
│ 📱 스마트폰 권한 설정 안내    │  항상 표시
│   ▶ Android                 │
│   ▶ iPhone / iPad           │
├─────────────────────────────┤
│ 👤 고팡 아이디               │
│ @금능#0996 (등록됨)          │
├─────────────────────────────┤
│ 💰 GDC Wallet               │  GDC 사용자만 표시
│ 잔액: 1,250 GDC             │
│ [Wallet 관리 →           ]  │
├─────────────────────────────┤
│ [⚙️ AI 설정              ]   │  녹색 버튼
├─────────────────────────────┤
│ [🚪 로그아웃              ]  │  빨간 테두리
│ [⚠️ 기기 완전 초기화      ]  │  회색, 작은 글씨
│ [🗑 앱 캐시 초기화         ] │
└─────────────────────────────┘

숨김: 아이디 등록 박스
```

---

### AI 설정 슬라이드 패널 (등록 사용자 + GDC 공통)

```
┌─────────────────────────────┐  ← 설정 창 위에 슬라이드 오버레이
│ ← AI 설정                   │  ← 뒤로가기 버튼
├─────────────────────────────┤
│ LLM 모델                    │
│ [DeepSeek V4 Pro ▼        ] │  id="setting-model" (기존 ID 유지)
├─────────────────────────────┤
│ API 엔드포인트               │
│ [고팡 프록시 (보안 권장) ▼  ] │  id="setting-endpoint"
├─────────────────────────────┤
│ API Key (DeepSeek 직접 시)  │
│ [sk-••••••••••••••••      ] │  id="setting-apikey"
├─────────────────────────────┤
│ Gemini API Key              │
│ [AIza••••••••••••••       ] │  id="setting-gemini-key"
│ K-Clean 이미지 분석용      │
│ [무료 발급 →]               │
├─────────────────────────────┤
│ 시스템 프롬프트               │
│ ┌──────────────────────┐   │  id="setting-system"
│ │                      │   │
│ └──────────────────────┘   │
├─────────────────────────────┤
│ [         저장          ]   │  onclick="saveSettings()"
└─────────────────────────────┘
```

---

## 2. HTML 구조 변경 계획

### 현재 구조 문제점

```html
<!-- 현재: llm-settings-section이 설정 패널 안에 인라인 -->
<div id="settings-overlay">
  <div id="settings-sheet">
    <div id="llm-settings-section">  ← 인라인 LLM 섹션
      ...LLM 입력창들...
    </div>
    <div id="gopang-id-section">...</div>
    <div id="security-section">...</div>
    <button id="btn-logout-or-login">...</button>
    <button onclick="clearSWCache()">...</button>
  </div>
</div>
```

### 수정 후 구조

```html
<!-- 설정 메인 패널 -->
<div id="settings-overlay" onclick="handleOverlayClick(event)">
  <div id="settings-sheet">

    <!-- 항상 표시 -->
    <div class="setting-group" id="device-guide-section">
      📱 스마트폰 권한 설정 안내 ...
    </div>

    <!-- 고팡 아이디 섹션 -->
    <div class="setting-group" id="gopang-id-section">
      <label>👤 고팡 아이디</label>
      <div id="gopang-id-status">...</div>          ← handle 표시
      <div id="gopang-id-register-box">             ← Guest만 표시
        <input id="gopang-id-input">
        <button onclick="_settingsRegisterHandle()">아이디 등록</button>
      </div>
    </div>

    <!-- GDC Wallet 섹션 (GDC 사용자만) -->
    <div class="setting-group" id="gdc-wallet-section" style="display:none">
      <label>💰 GDC Wallet</label>
      <div id="gdc-balance-display">잔액: — GDC</div>
      <button onclick="_openGDCWallet()">Wallet 관리 →</button>
    </div>

    <!-- AI 설정 버튼 (등록 사용자 + GDC) -->
    <button id="btn-ai-settings" onclick="openAISettings()"
      style="display:none; ...green style...">
      ⚙️ AI 설정
    </button>

    <!-- 로그아웃 (등록 사용자 + GDC) -->
    <button id="btn-logout-or-login" onclick="_settingsLogoutOrLogin()"
      style="display:none; ...red border...">
      🚪 로그아웃
    </button>

    <!-- 기기 완전 초기화 (등록 사용자 + GDC) -->
    <button id="btn-device-reset" onclick="_deviceFullReset()"
      style="display:none; ...gray small...">
      ⚠️ 기기 완전 초기화 (판매·양도 전 실행)
    </button>

    <!-- 앱 캐시 초기화 (항상) -->
    <button onclick="clearSWCache()" style="...gray...">
      🗑 앱 캐시 초기화
    </button>

  </div>
</div>

<!-- AI 설정 슬라이드 패널 (별도 오버레이) -->
<div id="ai-settings-overlay" onclick="handleAISettingsOverlayClick(event)">
  <div id="ai-settings-sheet">
    <div class="sheet-title">
      <button onclick="closeAISettings()">←</button>
      <span>AI 설정</span>
    </div>
    <div class="ai-settings-body">
      <!-- 기존 llm-settings-section 내용 이동 -->
      <!-- 입력 ID는 기존과 동일하게 유지 (saveSettings() 재사용) -->
      <div class="setting-group">LLM 모델 / select#setting-model</div>
      <div class="setting-group">API 엔드포인트 / select#setting-endpoint</div>
      <div class="setting-group" id="custom-endpoint-group">커스텀 URL</div>
      <div class="setting-group">API Key / input#setting-apikey</div>
      <div class="setting-group">Gemini API Key / input#setting-gemini-key</div>
      <div class="setting-group">시스템 프롬프트 / textarea#setting-system</div>
      <button onclick="saveSettings()">저장</button>
    </div>
  </div>
</div>
```

---

## 3. openSettings() 수정 계획

**파일:** `src/gopang/ui/settings.js`

```javascript
export function openSettings() {
  const registered = _isRegistered();
  const isGDC      = _isGDCUser();   // 신규

  // 1. 아이디 등록 박스: Guest만 표시
  const registerBox = document.getElementById('gopang-id-register-box');
  if (registerBox) registerBox.style.display = registered ? 'none' : 'block';

  // 2. 아이디 상태 표시
  const idStatus = document.getElementById('gopang-id-status');
  if (idStatus) {
    if (registered) {
      const s = JSON.parse(localStorage.getItem('gopang_user_v3') || '{}');
      idStatus.textContent = `${s.handle} (등록됨)`;
      idStatus.style.color = '#16a34a';
    } else {
      idStatus.textContent = '등록되지 않았습니다.';
      idStatus.style.color = '';
    }
  }

  // 3. GDC Wallet 섹션: GDC 사용자만 표시
  const gdcSec = document.getElementById('gdc-wallet-section');
  if (gdcSec) gdcSec.style.display = isGDC ? 'block' : 'none';

  // 4. AI 설정 버튼: 등록 사용자 + GDC
  const aiBtn = document.getElementById('btn-ai-settings');
  if (aiBtn) aiBtn.style.display = registered ? 'block' : 'none';

  // 5. 로그아웃 버튼: 등록 사용자 + GDC
  _updateLogoutBtn();

  // 6. 기기 초기화 버튼: 등록 사용자 + GDC
  const resetBtn = document.getElementById('btn-device-reset');
  if (resetBtn) resetBtn.style.display = registered ? 'block' : 'none';

  // 7. LLM 섹션: 항상 숨김 (AI 설정 슬라이드로 이동)
  const llmSec = document.getElementById('llm-settings-section');
  if (llmSec) llmSec.style.display = 'none';

  // 8. Guest 등록 유도 안내
  const idSec = document.getElementById('gopang-id-section');
  if (idSec && !registered) {
    if (!document.getElementById('_id-section-guide')) {
      const g = document.createElement('p');
      g.id = '_id-section-guide';
      g.style.cssText = 'font-size:12px;color:#16a34a;font-weight:600;' +
                        'margin-bottom:8px;background:#dcfce7;' +
                        'border-radius:8px;padding:8px 10px;line-height:1.5';
      g.innerHTML = '👤 아이디를 등록하면 AI 비서와 P2P 채팅을 사용할 수 있습니다.';
      idSec.insertBefore(g, idSec.firstChild);
    }
  } else {
    document.getElementById('_id-section-guide')?.remove();
  }

  // 9. 패널 오픈
  _updateSecuritySection();
  document.getElementById('settings-overlay')?.classList.add('open');
}
```

---

## 4. 신규 함수 목록

### settings.js 추가

| 함수 | 역할 |
|------|------|
| `openAISettings()` | AI 설정 슬라이드 패널 열기 + CFG값 입력창 채움 |
| `closeAISettings()` | AI 설정 슬라이드 패널 닫기 |
| `handleAISettingsOverlayClick(e)` | AI 설정 오버레이 클릭 → 닫기 |

### auth.js 추가

| 함수 | 역할 |
|------|------|
| `_isGDCUser()` | GDC 사용자 판별 |
| `_deviceFullReset()` | 기기 완전 초기화 |
| `_patchFpHexToL1(stored, fpHex)` | 기존 사용자 fpHex L1 동기화 |

---

## 5. 수정 파일 + 작업 완전 목록

| 순서 | 파일 | 작업 | 선행 조건 |
|------|------|------|----------|
| 1 | L1 PocketBase | profiles에 fpHex 필드 추가 | 없음 |
| 2 | auth.js | `_registerToL1()` POST body에 fpHex 추가 | 1 |
| 3 | auth.js | `_registerToL1()` fpHex 중복 검증 | 1 |
| 4 | webapp.html | `gopangLogout()` L1 fpHex null 처리 | 1 |
| 5 | auth.js | `initAuth()` 자동 로그인 후 fpHex 동기화 (`_patchFpHexToL1`) | 1 |
| 6 | auth.js | `initAuth()` L1 fpHex 조회 복원 팝업 | 1, 2 |
| 7 | auth.js | `_isGDCUser()` 신규 함수 | 없음 |
| 8 | auth.js | `_deviceFullReset()` 신규 함수 | 없음 |
| 9 | webapp.html | AI 설정 슬라이드 패널 HTML 추가 | 없음 |
| 10 | webapp.html | GDC Wallet 섹션 HTML 추가 | 없음 |
| 11 | webapp.html | AI 설정 버튼, 기기 초기화 버튼 HTML 추가 | 없음 |
| 12 | webapp.html | 기존 llm-settings-section 내용 → AI 설정 패널로 이동 | 9 |
| 13 | settings.js | `openSettings()` 전면 재작성 | 7 |
| 14 | settings.js | `openAISettings()` 신규 함수 | 9 |
| 15 | settings.js | `closeAISettings()` 신규 함수 | 9 |
| 16 | settings.js | `_settingsRegisterHandle()` 완료 후 `openSettings()` 재호출 | 13 |

---

## 6. 완료 체크리스트

### 이미 완료 ✅
- [x] Guest 로그아웃 버튼 숨김
- [x] 미등록 사용자 문구 삭제
- [x] 아이디 등록 완료 후 `_updateLogoutBtn()` 호출
- [x] `initAuth()` guest localStorage 저장
- [x] `_registerToL1()` `_USER` 전체 저장

### 미완료 ⬜ (구현 순서대로)
- [ ] 1. L1 fpHex 필드 추가
- [ ] 2. `_registerToL1()` fpHex POST 포함
- [ ] 3. `_registerToL1()` fpHex 중복 검증
- [ ] 4. `gopangLogout()` L1 fpHex null
- [ ] 5. `_patchFpHexToL1()` + `initAuth()` 동기화
- [ ] 6. `initAuth()` L1 복원 팝업
- [ ] 7. `_isGDCUser()`
- [ ] 8. `_deviceFullReset()`
- [ ] 9~12. webapp.html HTML 구조 변경
- [ ] 13~15. settings.js 전면 재작성
- [ ] 16. `_settingsRegisterHandle()` 완료 후 재호출
