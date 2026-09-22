/**
 * ai/mic.js — 마이크 입력 (Web Speech API / MediaRecorder STT)
 */
import { micActive, recognition, setMicActive, setRecognition } from '../core/state.js';
import { CFG } from '../core/config.js';
import { appendBubble } from '../ui/bubble.js';

// ── 마이크 입력 후 1초 무입력 시 자동 전송 ─────────────────
let _micAutoSendTimer = null;

export function _micAutoSend() {
  if (_micAutoSendTimer) clearTimeout(_micAutoSendTimer);
  _micAutoSendTimer = setTimeout(() => {
    _micAutoSendTimer = null;
    const input = document.getElementById('msg-input');
    if (input && input.value.trim()) {
      console.log('[Mic] 1초 무입력 — 자동 전송');
      sendMessage();
    }
  }, 1000);
}

// 사용자가 입력창을 직접 수정하면 자동 전송 타이머 취소
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('msg-input');
  if (input) {
    // 인라인 oninput 대체 — 함수 정의 이후 바인딩
    input.addEventListener('input', (ev) => {
      autoResize(input);
      updateSendBtn();
      // ★ 마이크 dispatchEvent(isTrusted=false)는 타이머 취소 안 함
      if (_micAutoSendTimer && ev.isTrusted) {
        clearTimeout(_micAutoSendTimer);
        _micAutoSendTimer = null;
      }
    });
    // 인라인 onkeydown 대체
    input.addEventListener('keydown', (e) => handleKey(e));
  }

  // 전송 버튼
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn) {
    sendBtn.addEventListener('click', () => sendMessage());
  }

  // 카메라 버튼
  const camBtn = document.getElementById('btn-camera');
  if (camBtn) {
    camBtn.addEventListener('click', () => triggerCamera());
  }

  // 마이크 버튼
  const micBtn = document.getElementById('btn-mic');
  if (micBtn) {
    micBtn.addEventListener('click', () => toggleMic());
  }
});


// Android Chrome: Web Speech API (webkitSpeechRecognition)
// iOS Safari:     MediaRecorder → DeepSeek STT API 폴백

export function toggleMic() {
  if (micActive) {
    _micStop();
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

  if (!isIOS && SpeechRecognition) {
    // ── Android Chrome / 데스크탑: Web Speech API ──────────
    _micStartWebSpeech(SpeechRecognition);
  } else {
    // ── iOS Safari / 미지원 브라우저: MediaRecorder + STT ──
    _micStartMediaRecorder();
  }
}

export function _micStop() {
  recognition?.stop();
  setMicActive(false);
  _micSetUI(false);
  if (window._micMediaRecorder?.state === 'recording') {
    window._micMediaRecorder.stop();
  }
}

function _micSetUI(active) {
  const btn = document.getElementById('btn-mic');
  if (!btn) return;
  btn.classList.toggle('mic-recording', active);
  btn.title = active ? '음성 입력 중 (탭하여 중지)' : '음성 입력';
}

// ── Web Speech API (Android Chrome / 데스크탑) ───────────────
async function _micStartWebSpeech(SpeechRecognition) {
  // ★ getUserMedia() 제거:
  //   SpeechRecognition.start()이 마이크 권한을 자체 처리한다.
  //   getUserMedia()를 먼저 호출하면 안드로이드 크롬에서
  //   스트림 충돌이 발생하여 onresult가 호출되지 않는다.

  setRecognition(new SpeechRecognition());
  recognition.lang            = 'ko-KR';
  recognition.continuous      = false;
  recognition.interimResults  = false;
  recognition.maxAlternatives = 1;

  recognition.onresult = (e) => {
    const t = e.results[0][0].transcript;
    const input = document.getElementById('msg-input');
    if (input && t) {
      input.value = t;
      autoResize(input);
      updateSendBtn();
    }
    setMicActive(false);
    _micSetUI(false);
    _micAutoSend();
  };

  recognition.onerror = (e) => {
    setMicActive(false);
    _micSetUI(false);
    const MSG = {
      'not-allowed':     '마이크 권한이 거부되었습니다. 브라우저 설정에서 허용하세요.',
      'no-speech':       '음성이 감지되지 않았습니다. 다시 시도해 주세요.',
      'network':         '음성 인식 서버에 연결할 수 없습니다. 네트워크를 확인하세요.',
      'audio-capture':   '마이크를 찾을 수 없습니다.',
      'service-not-allowed': '이 브라우저/환경에서는 음성 인식이 지원되지 않습니다.',
    };
    const msg = MSG[e.error] || `음성 인식 오류: ${e.error}`;
    appendBubble('ai', `⚠️ ${msg}`);
    console.warn('[Mic] Web Speech 오류:', e.error);
  };

  recognition.onend = () => {
    setMicActive(false);
    _micSetUI(false);
  };

  recognition.start();
  setMicActive(true);
  _micSetUI(true);
}

// ── MediaRecorder + DeepSeek STT (iOS Safari 폴백) ───────────
async function _micStartMediaRecorder() {
  if (!navigator.mediaDevices?.getUserMedia) {
    appendBubble('ai', '⚠️ 이 브라우저는 마이크를 지원하지 않습니다. iOS 17 이상의 Safari를 사용하세요.');
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    appendBubble('ai', '⚠️ 마이크 권한이 거부되었습니다. 설정 → Safari → 마이크에서 hondi.net을 허용하세요.');
    return;
  }

  const chunks = [];
  // iOS는 audio/mp4, Android/PC는 audio/webm 선호
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : MediaRecorder.isTypeSupported('audio/mp4')
      ? 'audio/mp4'
      : 'audio/ogg';

  const recorder = new MediaRecorder(stream, { mimeType });
  window._micMediaRecorder = recorder;

  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  recorder.onstop = async () => {
    stream.getTracks().forEach(t => t.stop());
    setMicActive(false);
    _micSetUI(false);

    const blob = new Blob(chunks, { type: mimeType });
    appendBubble('ai', '🎙️ 음성 변환 중...');

    try {
      // DeepSeek는 STT 미지원 → OpenAI Whisper API 엔드포인트 사용
      // (DeepSeek API 키를 그대로 사용, 엔드포인트만 변경)
      const formData = new FormData();
      formData.append('file', blob, `voice.${mimeType.split('/')[1].split(';')[0]}`);
      formData.append('model', 'whisper-1');
      formData.append('language', 'ko');

      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${CFG.apiKey}` },
        body: formData,
      });

      if (!res.ok) throw new Error(`STT API ${res.status}`);
      const data = await res.json();
      const text = data.text?.trim();

      // 마지막 AI 버블(변환 중...) 제거 후 입력창에 삽입
      document.querySelector('#chat-messages .bubble-ai:last-child')?.remove();

      if (text) {
        const input = document.getElementById('msg-input');
        if (input) {
          input.value = text;
          autoResize(input);
          updateSendBtn();
        }
        // 1초 후 자동 전송
        _micAutoSend();
      } else {
        appendBubble('ai', '⚠️ 음성을 텍스트로 변환하지 못했습니다. 다시 시도해 주세요.');
      }
    } catch (e) {
      document.querySelector('#chat-messages .bubble-ai:last-child')?.remove();
      appendBubble('ai', `⚠️ 음성 변환 실패: ${e.message}`);
      console.warn('[Mic] STT 오류:', e);
    }
  };

  recorder.start();
  setMicActive(true);
  _micSetUI(true);

  // 최대 30초 자동 종료
  setTimeout(() => {
    if (micActive && recorder.state === 'recording') recorder.stop();
  }, 30000);
}


// ── FIIL.kr 신고 전송 — Supabase 직접 저장 ─────────────────
// localStorage/postMessage 방식 폐기 → Supabase REST API 사용
// 어떤 브라우저에서도 동일한 DB에 저장/조회 가능
// ── K-Clean AI 응답 텍스트 파싱 — 전체 데이터 추출 ────────


