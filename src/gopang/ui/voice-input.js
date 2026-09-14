/**
 * ui/voice-input.js — 혼디 음성 입력(VAD 기반 자동 전송) v1.0
 *
 * 요구사항(원문):
 *   가입 후 앱을 열면 기본적으로 마이크 활성화.
 *   입력 필드 또는 화면의 다른 곳을 터치하면 마이크 비활성.
 *   활성 마이크는 1초 이상 침묵하면 인식된 텍스트를 입력창에 채우고
 *   "입력 완료"(=기존 전송 경로 그대로 트리거)한 뒤, 다시 ON으로 복귀.
 *   → 사용자는 음성, 비서는 문자로 대화.
 *
 * 통합 지점: call-ai.js를 직접 호출하지 않고, #msg-input에 값을 넣은 뒤
 * 기존 send-btn 클릭을 그대로 트리거합니다. 이렇게 해야 일반 타이핑 전송과
 * 100% 동일한 경로(버블 추가·history push·callAI 호출)를 타며, 이 모듈이
 * call-ai.js 내부 로직을 알 필요가 없습니다.
 *
 * ⚠️ 브라우저 지원 한계 (중요):
 *   Web Speech API(SpeechRecognition)는 Chrome(Android/Desktop)·Edge에서만
 *   동작합니다. iOS Safari는 이 API를 지원하지 않습니다(iOS WebView 포함).
 *   모바일 사용자 중 iOS 비중이 있다면, 이 모듈은 그 사용자에게는 조용히
 *   비활성화됩니다(아래 _supportsSTT 가드) — 화면이 깨지진 않지만 음성
 *   입력 자체는 동작하지 않습니다. iOS까지 지원해야 한다면 MediaRecorder로
 *   오디오를 녹음해 서버(예: 이미 있는 멀티 프로바이더 체인을 통한 Whisper
 *   API 등)로 보내는 방식으로 별도 구현이 필요합니다 — 원하시면 이어서
 *   작업하겠습니다.
 */

const SILENCE_MS        = 1000;          // 요구사항: 1초 이상 침묵 → 자동 전송
const INPUT_SELECTOR    = '#msg-input';
const SEND_BTN_SELECTOR = '#send-btn';
const MIC_BTN_SELECTOR  = '#mic-btn';    // 실제 마이크 버튼 id가 다르면 이 한 줄만 교체

// ── 의문문 자동 "?" 삽입 (2026-09-14 신설, 주피터 지시) ──────────────
// ⚠️ 중요한 한계: Web Speech API는 인식된 텍스트와 신뢰도만 돌려줄 뿐,
// 억양(pitch contour) 같은 음성 자체의 운율 정보는 애초에 노출하지
// 않는다 — 그래서 "끝이 올라가는 억양"을 직접 감지하는 건 이 API로는
// 불가능하다(음성 원본에 접근하려면 MediaRecorder + 별도 피치 분석
// 파이프라인이 필요 — voice-input.js 상단 iOS 한계 주석과 같은 종류의
// 더 큰 작업).
//
// 대신 한국어 의문문의 상당수는 억양과 무관하게 문법적으로(종결
// 어미로) 이미 의문문임이 표시된다는 점을 이용한다 — 예: "~까요",
// "~습니까", "~나요"는 억양이 어떻든 항상 의문문이다. 반대로 "~요"·
// "~에요"·"~죠" 같은 어미는 억양에 따라 평서문도 의문문도 될 수 있어
// (예: "밥 먹었어요"는 억양만으로 진술과 질문이 갈림) 텍스트만으로는
// 판단할 근거가 없으므로 일부러 제외한다 — 잘못 물음표를 붙이는 오탐이
// 아무것도 안 붙이는 것보다 사용자 경험상 더 거슬리기 때문에, 확신이
// 낮은 어미는 건드리지 않는 쪽을 택했다.
const QUESTION_ENDING_PATTERNS = [
  '까요', '나요', '인가요', '던가요', '습니까', '읍니까', '을까요', 'ㄹ까요',
  '까', '냐',
];
// "~니"로 끝나는 의문문(예: "밥 먹었니")은 흔하지만, 호칭·감탄사 등
// 의문문이 아닌 단어도 "니"로 끝나는 경우가 있어(예: "어머니", "할머니")
// 이 어미만 별도로 예외 목록을 두고 처리한다.
const NI_ENDING_EXCLUDE = ['어머니', '할머니', '아니', '아니요', '아니오', '어머님', '아버니'];

function _looksLikeKoreanQuestion(text) {
  const t = text.trim();
  if (!t || /[.!?？！。]$/.test(t)) return false; // 이미 문장부호가 있으면 건드리지 않음
  if (QUESTION_ENDING_PATTERNS.some(p => t.endsWith(p))) return true;
  if (t.endsWith('니') && !NI_ENDING_EXCLUDE.some(w => t.endsWith(w))) return true;
  return false;
}

// finalizedTranscript를 입력창에 채우기 직전에 호출 — 의문형 어미로
// 끝나면 물음표를 붙이고, 아니면 원문 그대로 돌려준다.
function _appendQuestionMarkIfNeeded(text) {
  return _looksLikeKoreanQuestion(text) ? text + '?' : text;
}

let recognizer = null;
let micState   = 'OFF';   // 'ON' | 'OFF'
let silenceTimer = null;
let finalizedTranscript = '';   // 이번 발화 동안 누적된 확정(final) 인식 텍스트

function _getInput()   { return document.querySelector(INPUT_SELECTOR); }
function _getSendBtn() { return document.querySelector(SEND_BTN_SELECTOR); }
function _getMicBtn()  { return document.querySelector(MIC_BTN_SELECTOR); }

function _supportsSTT() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// 실제 HTML에 마이크 버튼이 없으면 최소한의 토글 버튼을 직접 만들어 둔다.
// (이미 #mic-btn이 있으면 그대로 그 버튼을 사용 — 새로 만들지 않음)
function _ensureMicButton() {
  let btn = _getMicBtn();
  if (btn) return btn;
  btn = document.createElement('button');
  btn.id = 'mic-btn';
  btn.type = 'button';
  btn.setAttribute('aria-label', '음성 입력 켜기/끄기');
  btn.textContent = '🎙️';
  btn.style.cssText = [
    'position:fixed', 'right:16px', 'bottom:90px', 'z-index:150',
    'width:48px', 'height:48px', 'border-radius:50%', 'border:none',
    'background:#1A73E8', 'color:#fff', 'font-size:20px', 'cursor:pointer',
    'box-shadow:0 4px 12px rgba(0,0,0,.25)', 'transition:opacity .15s, background .15s'
  ].join(';');
  document.body.appendChild(btn);
  return btn;
}

function _setMicUI(state) {
  const btn = _ensureMicButton();
  btn.classList.toggle('mic-active', state === 'ON');
  btn.style.opacity    = state === 'ON' ? '1' : '.45';
  btn.style.background = state === 'ON' ? '#1A73E8' : '#9e9e9e';
}

function _resetSilenceTimer() {
  if (silenceTimer) clearTimeout(silenceTimer);
  silenceTimer = setTimeout(_commitUtterance, SILENCE_MS);
}

// 직전 callAI 응답이 아직 스트리밍 중이면 잠깐 대기 후 재시도.
// (call-ai.js의 _currentAbort는 새 호출 시 이전 컨트롤러를 그냥 덮어쓸 뿐
//  이전 요청을 취소하지 않으므로, 응답 도중 또 전송하면 두 응답이 동시에
//  흐르며 버블이 섞일 수 있다 — 음성 모드는 연속 발화가 흔해 이 경합이
//  실제로 발생하기 쉬워 여기서 방어한다.)
function _commitUtterance(retry = 0) {
  const text = finalizedTranscript.trim();
  const sendBtn = _getSendBtn();

  if (sendBtn && sendBtn.classList.contains('generating')) {
    if (retry < 30) { // 최대 약 6초 대기
      silenceTimer = setTimeout(() => _commitUtterance(retry + 1), 200);
      return;
    }
  }

  finalizedTranscript = '';
  if (!text) return; // 1초간 정말 아무 말도 안 했으면 전송하지 않음

  const input = _getInput();
  if (!input) return;

  input.value = _appendQuestionMarkIfNeeded(text);
  input.dispatchEvent(new Event('input', { bubbles: true })); // send-btn 활성화 리스너 등 트리거

  requestAnimationFrame(() => {
    const btn = _getSendBtn();
    if (btn && !btn.disabled) {
      btn.click(); // 기존 전송 경로 그대로 사용 — 타이핑 전송과 동일하게 처리됨
    } else {
      // 폴백: Enter 전송 방식을 쓰는 UI인 경우
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
  });
  // recognizer는 continuous라 계속 청취 중 — micState는 그대로 'ON' 유지
}

function _startRecognizer() {
  if (!_supportsSTT()) {
    console.warn('[Voice] 이 브라우저는 음성 인식을 지원하지 않습니다 (예: iOS Safari).');
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognizer = new SR();
  recognizer.lang = 'ko-KR';
  recognizer.continuous = true;
  recognizer.interimResults = true;

  recognizer.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalizedTranscript += r[0].transcript;
    }
    // 중간 결과든 확정 결과든, 인식 이벤트가 들어오는 동안은 "말하는 중"이므로
    // 매번 침묵 타이머를 리셋한다. 더 이상 이벤트가 없으면 SILENCE_MS 후 커밋.
    _resetSilenceTimer();
  };

  recognizer.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return; // 정상 재시작 케이스
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      console.warn('[Voice] 마이크 권한이 차단되었습니다.');
      micState = 'OFF';
      _setMicUI('OFF');
      return;
    }
    console.warn('[Voice] 인식 오류:', e.error);
    if (micState === 'ON') _restartRecognizer();
  };

  recognizer.onend = () => {
    // 브라우저가 일정 시간 후 자동으로 recognition을 끊는 경우가 있어
    // 사용자가 여전히 ON 상태로 두었다면 즉시 재시작한다.
    if (micState === 'ON') _restartRecognizer();
  };

  try { recognizer.start(); } catch (e) { console.warn('[Voice] start 실패:', e.message); }
}

function _restartRecognizer() {
  try { recognizer && recognizer.stop(); } catch {}
  setTimeout(() => { if (micState === 'ON') _startRecognizer(); }, 200);
}

function _stopRecognizer() {
  if (silenceTimer) clearTimeout(silenceTimer);
  silenceTimer = null;
  finalizedTranscript = '';
  if (recognizer) {
    try { recognizer.onend = null; recognizer.stop(); } catch {}
    recognizer = null;
  }
}

export function micOn() {
  if (micState === 'ON') return;
  micState = 'ON';
  _setMicUI('ON');
  _startRecognizer();
}

export function micOff() {
  if (micState === 'OFF') return;
  micState = 'OFF';
  _setMicUI('OFF');
  _stopRecognizer();
}

/**
 * initVoiceInput — 앱(채팅 화면) 진입 시 1회 호출.
 * call-ai.js를 import하는 메인 진입 파일에서 함께 import만 해주면 됩니다:
 *   import { initVoiceInput } from './ui/voice-input.js';
 *   initVoiceInput();
 */
export function initVoiceInput() {
  if (!_supportsSTT()) {
    console.info('[Voice] STT 미지원 브라우저 — 음성 입력 비활성 (텍스트 입력은 정상 동작)');
    return;
  }

  _ensureMicButton();
  micOn(); // 요구사항: 앱 진입 시 기본 활성화

  // 입력 필드 또는 화면의 다른 곳을 터치 → 마이크 비활성.
  // 마이크 버튼 자체를 누른 경우만 예외(재활성 토글용).
  const offIfOutsideMic = (e) => {
    if (e.target.closest(MIC_BTN_SELECTOR)) return;
    micOff();
  };
  document.addEventListener('touchstart', offIfOutsideMic, { passive: true });
  document.addEventListener('mousedown', offIfOutsideMic);

  // 마이크 버튼 — 누르면 토글(꺼져 있으면 다시 켬)
  const micBtn = _getMicBtn();
  micBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (micState === 'ON') micOff(); else micOn();
  });
}
