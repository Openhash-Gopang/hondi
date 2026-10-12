# 아카이브 — expert-session.js "같은 스레드" EXPERT 세션 서브시스템

**이관일**: 2026-08-06
**출처**: `src/gopang/ai/expert-session.js`
**이관 사유**: 죽은 코드 확인 후 제거 (죽은 코드부터 정리하라는 지시에 따름)

## 왜 죽은 코드였나

이 서브시스템은 "같은 스레드 안에서 System Prompt만 교체"하는 방식으로 EXPERT
페르소나를 호출하던 옛 설계(PA→AGENT-COMMON 전환과 동일한 패턴)의 잔재다.
2026-07-03부로 EXPERT 페르소나 호출은 GWP 기관 서비스와 동일하게 **새 탭**
(`pages/expert-chat.html`)을 여는 방식(`handleExpertTag()`)으로 전환됐다.

- `isExpertActive()`가 `true`가 되는 유일한 경로는 `startExpertSession()`이었다.
- `startExpertSession()`을 호출하는 곳은 허브(gopang) 저장소 전체에 **0곳**이었다
  (2026-08-06 `grep -rn "startExpertSession("` 재확인 — `expert-session.js` 자기
  자신의 정의부와 주석뿐).
- 따라서 `isExpertActive()`는 항상 `false`를 반환했고, 그 값에 의존하던
  `maybeHandleExpertTurn()` / `applyExpertSystemIfActive()` / `endExpertSession()`도
  전부 최상단 가드(`if (!_expert.active) return`)에서 즉시 반환해 실질적으로
  아무 일도 하지 않았다.
- 2026-08-06 신설된 C50(관제탑 원칙) NEXT_STEP 강제 코드도 처음에는 이 죽은
  게이트(`isExpertActive()`)에 걸려 있어 한 번도 실행되지 못했다 — 이 발견이
  이번 정리의 직접 계기였다. 해당 훅은 `pages/expert-chat.html`
  (`_maybeEnforceNextStep`)로 재배선했다.

`isExpertActive()` 자체는 `webapp.html`과 `src/gopang/ai/call-ai.js`에서
`handleExpertTag()` 호출 앞에 `if (!isExpertActive()) { ... }` 가드로도
쓰이고 있었지만, `isExpertActive()`가 항상 `false`이므로 이 가드는 상시
통과(no-op)였다 — 제거해도 동작 변화 없음. 새 탭 방식에서는 "메인 스레드가
지금 전문가 세션 중인가"라는 개념 자체가 성립하지 않는다(세션은 다른 탭에서
독립적으로 산다).

## 부활이 필요해지면

만약 향후 "같은 스레드 페르소나 전환" 방식으로 되돌아갈 이유가 생기면(예:
새 탭을 열 수 없는 임베디드 환경 지원 등), 아래 원본 코드를 참고할 것 —
단, `_composeExpertPrompt()` 시그니처와 `_promptCache` 캐시 키는 현재
`expert-session.js`의 살아있는 버전을 그대로 재사용해야 한다(2026-07-19
UNIVERSAL-common/PROFESSIONAL-common 조립 순서 수정이 반영돼 있음).

```js
// ── 세션 상태 (단일 사용자 탭 기준 — 전역 1개) ───────────────
let _expert = {
  active:     false,
  personaId:  null,
  def:        null,
  startIdx:   0,       // 세션 시작 시점의 history.length (요약 시 슬라이스 기준)
  timer:      null,    // 무응답 타임아웃 setTimeout 핸들
};

const EXPERT_TIMEOUT_MS = 10 * 60 * 1000; // 10분 무응답 → 자동 종료
const TERMINATION_RE = /끝났|그만|종료|돌아가|그림자\s*AI(로|에게)?\s*(돌아|연결)/;

export function isExpertActive() {
  return _expert.active;
}

export function currentExpertLabel() {
  return _expert.def ? `${_expert.def.icon} ${_expert.def.label}` : null;
}

function _resetTimeoutTimer() {
  if (_expert.timer) clearTimeout(_expert.timer);
  _expert.timer = setTimeout(() => {
    console.info('[Expert] 무응답 타임아웃 — 자동 종료:', _expert.personaId);
    endExpertSession('timeout').catch(e => console.warn('[Expert] 타임아웃 종료 실패:', e.message));
  }, EXPERT_TIMEOUT_MS);
}

function _clearTimeoutTimer() {
  if (_expert.timer) { clearTimeout(_expert.timer); _expert.timer = null; }
}

// ── CFG.system과 history[0]을 함께 갱신 ──────────────────────
function _applySystemEverywhere(text) {
  CFG.system = text;
  if (history.length > 0 && history[0]?.role === 'system') {
    history[0] = { role: 'system', content: text };
  }
}

export async function startExpertSession(personaId, def) {
  if (_expert.active && _expert.personaId === personaId) return; // 이미 같은 페르소나 진행 중

  const prompt = await _composeExpertPrompt(def);
  _applySystemEverywhere(prompt);

  _expert = {
    active: true, personaId, def,
    startIdx: history.length,
    timer: null,
  };
  _resetTimeoutTimer();

  appendBubble('ai',
    `${def.icon} <b>${def.label} AI</b>와 연결되었습니다. 상담이 끝나면 "끝났어"라고 말씀해주세요.`,
    true
  );
  console.info('[Expert] 세션 시작:', personaId);
}

export async function maybeHandleExpertTurn(userText) {
  if (!_expert.active) return false;
  _resetTimeoutTimer();
  if (userText && TERMINATION_RE.test(userText)) {
    await endExpertSession('user_phrase');
    return true;
  }
  return false;
}

export function applyExpertSystemIfActive() {
  if (!_expert.active) return false;
  if (_promptCache.has(_expert.def.key)) {
    _applySystemEverywhere(_promptCache.get(_expert.def.key));
    return true;
  }
  return false;
}

export async function endExpertSession(reason = 'unknown') {
  if (!_expert.active) return;
  _clearTimeoutTimer();

  const def       = _expert.def;
  const personaId = _expert.personaId;
  const turns     = history.slice(_expert.startIdx);

  _expert = { active: false, personaId: null, def: null, startIdx: 0, timer: null };

  const transcript = turns
    .map(t => `[${t.role === 'user' ? '사용자' : def.label}] ${
      typeof t.content === 'string' ? t.content : JSON.stringify(t.content)
    }`)
    .join('\n');

  const report6w = transcript.trim() ? await summarizeTranscript6W(transcript) : null;
  const summaryText = report6w?.what || report6w?.result ||
    (transcript.trim()
      ? `${def.label} AI와의 상담이 종료됨(요약 실패 — 원문 ${turns.length}턴 보존)`
      : `${def.label} AI와의 상담이 대화 없이 종료됨`);

  await _recordPDV({
    type:      'agent_report',
    serviceId: personaId,
    service:   def.label,
    summary:   summaryText,
    who:       report6w?.who   || _USER?.nickname || _USER?.ipv6 || null,
    when:      report6w?.when  || new Date().toISOString(),
    where:     report6w?.where || '나비',
    what:      report6w?.what  || summaryText,
    how:       report6w?.how   || `expert_session_${reason}`,
    why:       report6w?.why   || '',
    ts:        new Date().toISOString(),
  }).catch(e => console.warn('[Expert] PDV 기록 실패:', e.message));

  _applySystemEverywhere(CFG.system_base || CFG.system);

  const reasonLabel = reason === 'timeout' ? '(응답이 없어 자동 종료됨)' : '';
  appendBubble('ai',
    `✅ <b>${def.icon} ${def.label} AI</b> 상담이 끝났습니다${reasonLabel}. 그림자 AI로 돌아왔습니다.<br>` +
    `<span style="font-size:12px;color:var(--label-3)">요약: ${summaryText}</span>`,
    true
  );
  console.info('[Expert] 세션 종료(' + reason + '):', personaId, '| 요약:', summaryText);
}
```

원본은 `_recordPDV`(`../pdv/record.js`), `summarizeTranscript6W`
(`./report-utils.js`), `_USER`(`../core/state.js`) import가 추가로 필요했다
— 살아있는 파일에서는 이 세 import도 함께 제거했다(다른 곳에서 쓰이지 않음).
