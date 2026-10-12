/**
 * src/gopang/ui/chat-input.js — 공용 채팅 입력창 모듈 (v1.0, 2026-07-23 신설)
 *
 * ★ 배경 — 옵션 B 결정(주피터 지시, 2026-07-23):
 *   기존 src/gopang/ui/chat-shell.js(2026-07-22)는 pages/regional-gov.html·
 *   expert-chat.html·profile-assistant.html 3곳의 "가벼운 버전"이었고, 그
 *   가벼운 마이크 구현(continuous:true + e.resultIndex 신뢰)에 실사용자가
 *   실제로 겪은 버그(동일 구간 반복 캡처 → 문장이 눈덩이처럼 불어남)가
 *   있었다. 반대로 webapp.html의 #ai-panel-input-row는 가장 트래픽이 많은
 *   화면이라 이미 실전에서 걸러진 예외처리(무음 자동전송, 분당 자동전송
 *   상한, continuous:false 기반 안전한 마이크, 하울링/오인식 방지 등)가
 *   녹아있다. 그래서 이번엔 반대 방향으로 뒤집는다 — **webapp.html의
 *   구현을 기준(baseline)으로 삼아 공용 모듈로 뽑고, 4개 대화창
 *   (webapp.html의 AI 패널 포함) 전부가 이 모듈을 불러 쓰며, 각자
 *   config로 필요한 부분만 커스터마이즈한다.**
 *
 * 1단계 범위(이번 커밋): 이 모듈만 새로 만든다. webapp.html·
 * pages/regional-gov.html 등 기존 페이지는 전혀 수정하지 않는다(아직
 * 아무도 이 모듈을 import하지 않음) — 다음 단계에서 페이지별로 하나씩
 * 전환하며 각 단계마다 회귀 확인 후 진행한다.
 *
 * 설계 원칙(chat-shell.js의 경계를 그대로 계승):
 *   이 모듈은 "화면을 어떻게 그리고 입력을 어떻게 받을지"와 "안전한
 *   음성인식/첨부파일 처리"까지만 책임진다. AI를 실제로 어떻게 부르는지
 *   (스트리밍, 태그 파싱, GWP_DONE 보고 등)는 절대 이 모듈이 알지 못한다
 *   — 페이지가 onSend 콜백 안에서 전부 직접 처리한다.
 *
 * ── 마크업/DOM 접근 방식 ──
 * chat-shell.js와 달리 이 모듈은 필요한 마크업을 직접 생성해 container에
 * 주입한다(4개 페이지에 동일 HTML을 복사해두던 문제를 근본적으로 없앰).
 * 내부 요소는 전부 container.querySelector('.ci-…')로 찾는다(getElementById
 * 미사용) — 페이지에 여러 인스턴스를 마운트해도 충돌하지 않는다.
 *
 * ── 마이크 상태를 외부에 알리는 방법 ──
 * 기존 webapp.html의 "나비야" 상시대기 wake-word 스크립트는
 * document.getElementById('ai-panel-mic-btn')/('btn-mic')로 특정 페이지의
 * 특정 id를 직접 참조해 마이크 충돌을 피했다. 이 모듈은 그 대신
 * container에서 버블링되는 CustomEvent를 쏜다:
 *   'chatinput:micstart' / 'chatinput:micend'
 * 어떤 페이지의 어떤 인스턴스든 이 이벤트를 구독하면 되므로, 특정 id에
 * 결합되지 않는다. (webapp.html을 이 모듈로 전환하는 단계에서 wake-word
 * 스크립트도 이 이벤트 구독 방식으로 같이 정리할 예정 — 그 전까지
 * webapp.html의 기존 id 기반 코드는 무영향.)
 *
 * ── 색 테마 ──
 * 사용자 지시(2026-07-23): webapp.html(AI 비서)은 기존 파랑 유지, 그 외
 * 모든 대화창(정부기관/전문가 페르소나/프로필 작성 등)은 라인(LINE) 앱
 * 스타일의 녹색(#06C755, 2020년 이후 공식 브랜드 그린)으로 통일 —
 * 사용자가 "지금 누구와 대화 중인지" 색만으로 즉시 구분하게 하기 위함.
 * 사용자 말풍선도 --brand-primary를 그대로 쓰므로 자동으로 같은 색이 된다.
 *
 * ★ 이름 관련 결정(2026-07-23): webapp.html 안의 기존 `--green` 변수(실제
 * 값은 파랑 #1A73E8 — 이름과 값이 어긋나는 레거시)는 그대로 둔다(21곳
 * 참조 중이라 이름 변경만으로 별도 리스크를 이번 작업에 얹지 않기 위함).
 * 이 새 모듈은 처음부터 색-중립적인 이름(--brand-primary 등)만 쓴다.
 * webapp.html이 이 모듈을 쓰게 될 때(다음 단계)는 모듈에 실제 파랑 값을
 * 넘기기만 하면 되고, `--green`이라는 이름 자체는 webapp.html 안에 남아도
 * 무방하다(모듈은 넘겨받은 값만 볼 뿐 이름을 모른다).
 *
 * 사용법:
 *   import { mountChatInput, THEME_LINE_GREEN, THEME_HONDI_BLUE }
 *     from '/src/gopang/ui/chat-input.js';
 *   const ci = mountChatInput(document.getElementById('chat-input-slot'), {
 *     theme: THEME_LINE_GREEN,          // 또는 colors: {...}로 직접 지정
 *     placeholder: '메시지를 입력하세요…',
 *     fileAccept: 'image/*,.pdf,.txt,.docx',
 *     multiple: true,
 *     allowStop: true,
 *     onSend: async (text, files) => { ... },   // 필수
 *     onStop: () => { ... },                     // allowStop:true일 때만 의미있음
 *   });
 *   ci.setGenerating(true);  // 응답 스트리밍 시작 시 페이지가 직접 호출
 *   ci.setGenerating(false); // 완료/에러 시
 */

// ── 색 테마 프리셋 / 발화 누적·자동전송상한 순수 로직 ──────────────
// node에서 독립적으로 테스트되는 chat-input-core.js(src/tests/ui/
// chat-input-core.test.mjs, 21/21 통과)를 그대로 재사용한다 — 이 파일
// 안에서 같은 로직을 다시 구현하지 않는다(중복 시 한쪽만 고치고 잊어버릴
// 위험을 없애기 위함).
import { appendUtterance, AutoSendLimiter, THEME_HONDI_BLUE, THEME_LINE_GREEN }
  from './chat-input-core.js';
export { THEME_HONDI_BLUE, THEME_LINE_GREEN };

const DEFAULT_FILE_ACCEPT = 'image/*,.pdf,.txt,.docx';
const SILENCE_MS = 1000;          // 무음 → 자동 전송까지 대기시간
const RESTART_DELAY_MS = 150;     // 인식 세션 재시작 전 지연(오디오 핸들 해제 대기)
const AUTO_SEND_MAX_PER_MINUTE = 6; // 오인식/하울링으로 인한 자동전송 폭주 방지
const AUTO_SEND_WINDOW_MS = 60_000;
const MAX_EXTRACT_CHARS = 20000;

function _svgAttachIcon() {
  return `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
}
function _svgCameraIcon() {
  return `<svg width="16.87" height="16.87" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;
}
function _svgMicIcon() {
  return `<svg width="15.88" height="15.88" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/>
    <line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>`;
}
function _svgSendButton() {
  return `
    <svg class="icon-send" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
    <svg class="icon-stop" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
    <svg class="icon-waveform" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <line x1="2"  y1="8.5" x2="2"  y2="15.5"/><line x1="6"  y1="6.5" x2="6"  y2="17.5"/>
      <line x1="10" y1="3"   x2="10" y2="21"/><line x1="14" y1="3"   x2="14" y2="21"/>
      <line x1="18" y1="6.5" x2="18" y2="17.5"/><line x1="22" y1="8.5" x2="22" y2="15.5"/>
    </svg>`;
}

function _buildMarkup(cfg) {
  return `
<div class="ci-attach-preview" hidden>
  <span class="ci-attach-name"></span>
  <button type="button" class="ci-attach-idv-save" title="이 서류를 IDV에 저장(다음에 자동 재사용)">IDV 저장</button>
  <button type="button" class="ci-attach-remove" aria-label="첨부 취소">✕</button>
</div>
<div class="ci-idv-save-form" hidden>
  <select class="ci-idv-type">
    <option value="">서류 종류 선택…</option>
    <option value="idv.cert.business_registration">사업자등록증</option>
    <option value="idv.cert.resident_registration_transcript">주민등록초본</option>
    <option value="idv.cert.family_relation">가족관계증명서</option>
    <option value="idv.cert.local_tax_payment">지방세 세목별 과세증명서</option>
  </select>
  <input type="date" class="ci-idv-issuance-date" title="발급일(서류에 적힌 날짜)">
  <button type="button" class="ci-idv-save-confirm">저장</button>
  <button type="button" class="ci-idv-save-cancel">취소</button>
  <span class="ci-idv-save-status"></span>
</div>
<div class="ci-card">
  <textarea class="ci-input" rows="1" placeholder="${cfg.placeholder}"></textarea>
  <div class="ci-toolbar">
    <div class="ci-aux-left">
      <button type="button" class="ci-btn ci-attach-btn" title="파일 첨부">${_svgAttachIcon()}</button>
      <button type="button" class="ci-btn ci-camera-btn" title="${cfg.cameraTitle}">${_svgCameraIcon()}</button>
    </div>
    <div class="ci-aux-right">
      <button type="button" class="ci-btn ci-mic-btn" title="음성으로 대화">${_svgMicIcon()}</button>
      <button type="button" class="ci-send-btn" disabled title="전송 / 중단">${_svgSendButton()}</button>
    </div>
  </div>
</div>
<input type="file" class="ci-file-input" hidden accept="${cfg.fileAccept}" ${cfg.multiple ? 'multiple' : ''}>
<input type="file" class="ci-camera-input" hidden accept="image/*" capture="environment">
`.trim();
}

// ── 파일 첨부 — pdf.js/mammoth 지연 로드 (webapp.html ai-panel 구현 그대로) ──
let _pdfjsLoaded = null;
function _ensurePdfJs() {
  if (_pdfjsLoaded) return _pdfjsLoaded;
  _pdfjsLoaded = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.js';
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js';
      resolve();
    };
    s.onerror = () => reject(new Error('pdf.js 로드 실패'));
    document.head.appendChild(s);
  });
  return _pdfjsLoaded;
}
let _mammothLoaded = null;
function _ensureMammoth() {
  if (_mammothLoaded) return _mammothLoaded;
  _mammothLoaded = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.7.0/mammoth.browser.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('mammoth.js 로드 실패'));
    document.head.appendChild(s);
  });
  return _mammothLoaded;
}
async function _extractFileText(file) {
  try {
    if (file.type === 'text/plain') return (await file.text()).slice(0, MAX_EXTRACT_CHARS);
    if (file.type === 'application/pdf') {
      await _ensurePdfJs();
      const buf = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
      let text = '';
      for (let i = 1; i <= pdf.numPages && text.length < MAX_EXTRACT_CHARS; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(it => it.str).join(' ') + '\n';
      }
      return text.slice(0, MAX_EXTRACT_CHARS);
    }
    if (file.name.toLowerCase().endsWith('.docx')) {
      await _ensureMammoth();
      const buf = await file.arrayBuffer();
      const result = await window.mammoth.extractRawText({ arrayBuffer: buf });
      return (result.value || '').slice(0, MAX_EXTRACT_CHARS);
    }
  } catch (e) {
    console.warn('[ChatInput] 첨부파일 본문 추출 실패:', file.name, e.message);
    return null;
  }
  return null;
}

/**
 * mountChatInput(container, config) → controller
 *
 * config:
 *   theme          {primary, primaryDark, primaryBg} — 기본 THEME_LINE_GREEN
 *   colors         theme과 동일한 형태, theme보다 우선 적용(둘 다 주면 colors가 이김)
 *   placeholder    입력창 placeholder (기본 '메시지를 입력하세요…')
 *   cameraTitle    카메라 버튼 title/aria (페이지마다 의미가 다름 — 예: 나비 코드 스캔 vs 사진 촬영)
 *   fileAccept     첨부 input의 accept (기본 'image/*,.pdf,.txt,.docx')
 *   multiple       다중 파일 선택 허용 (기본 true)
 *   allowStop      생성 중 전송버튼을 "중단" 버튼으로 전환할지 (기본 true)
 *   micEnabled     음성 입력 사용 여부 (기본 true — 브라우저 미지원 시 자동 비활성)
 *   autoSendOnSilence  마이크로 말하고 1초 무음 시 자동 전송할지 (기본 true)
 *   onSend(text, files)  필수. files는 [{name, dataUrl, isImage, mimeType, sha256, extractedText}]
 *   onStop()       allowStop:true일 때, 생성 중 전송버튼 클릭 시 호출
 */
export function mountChatInput(container, config = {}) {
  if (!container) throw new Error('[ChatInput] mountChatInput: container가 필요합니다.');

  const colors = config.colors || config.theme || THEME_LINE_GREEN;
  const cfg = {
    placeholder: config.placeholder || '메시지를 입력하세요…',
    cameraTitle: config.cameraTitle || '사진 촬영',
    fileAccept: config.fileAccept || DEFAULT_FILE_ACCEPT,
    multiple: config.multiple !== false,
    allowStop: config.allowStop !== false,
    micEnabled: config.micEnabled !== false,
    autoSendOnSilence: config.autoSendOnSilence !== false,
    readonlyUntilFocus: !!config.readonlyUntilFocus,
    onSend: config.onSend || (() => console.warn('[ChatInput] onSend 콜백이 설정되지 않았습니다.')),
    onStop: config.onStop || (() => {}),
  };

  container.classList.add('chat-input-root');
  container.style.setProperty('--brand-primary', colors.primary);
  container.style.setProperty('--brand-primary-dark', colors.primaryDark);
  container.style.setProperty('--brand-primary-bg', colors.primaryBg);
  container.innerHTML = _buildMarkup(cfg);

  const $ = (sel) => container.querySelector(sel);
  const input           = $('.ci-input');
  const sendBtn          = $('.ci-send-btn');
  const attachBtn        = $('.ci-attach-btn');
  const cameraBtn        = $('.ci-camera-btn');
  const micBtn           = $('.ci-mic-btn');
  const fileInput        = $('.ci-file-input');
  const cameraInput      = $('.ci-camera-input');
  const attachPreview    = $('.ci-attach-preview');
  const attachNameEl     = $('.ci-attach-name');
  const attachRemoveBtn  = $('.ci-attach-remove');
  const idvSaveBtn       = $('.ci-attach-idv-save');
  const idvSaveForm      = $('.ci-idv-save-form');
  const idvTypeSel       = $('.ci-idv-type');
  const idvDateInput     = $('.ci-idv-issuance-date');
  const idvSaveConfirm   = $('.ci-idv-save-confirm');
  const idvSaveCancel    = $('.ci-idv-save-cancel');
  const idvSaveStatus    = $('.ci-idv-save-status');

  let _generating = false;
  let _attachedFiles = [];

  // ── 슬라이드업 패널 등에서 자동 키보드 표시를 막는 readonly 트릭 ──
  // (webapp.html #ai-panel-input의 원본 동작: 포커스 전엔 readonly라 탭
  // 전엔 모바일 키보드가 뜨지 않고, 포커스를 얻는 순간 해제된다.)
  if (cfg.readonlyUntilFocus) {
    input.setAttribute('readonly', '');
    input.addEventListener('focus', () => input.removeAttribute('readonly'));
    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (document.activeElement !== input) input.setAttribute('readonly', '');
      }, 200);
    });
  }

  // ── 입력창 자동 높이 + 전송 버튼 상태 ─────────────────────
  function _syncState() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
    if (cfg.allowStop && _generating) { sendBtn.disabled = false; return; }
    sendBtn.disabled = !(input.value.trim() || _attachedFiles.length);
  }
  input.addEventListener('input', _syncState);
  sendBtn.disabled = true;

  // ── 첨부파일 ───────────────────────────────────────────
  function _renderAttachPreview() {
    if (!_attachedFiles.length) { attachPreview.hidden = true; return; }
    const names = _attachedFiles.map(f => (f.isImage ? '📷 ' : '📎 ') + f.name).join(', ');
    attachNameEl.textContent = _attachedFiles.length > 1
      ? `${_attachedFiles.length}개 파일: ${names}` : names;
    attachPreview.hidden = false;
    // IDV 저장은 "이 파일 하나가 어떤 서류인지" 사용자가 직접 골라야
    // 하는 UI라 다중 첨부 시 어느 파일에 대응시킬지 모호해진다 —
    // 1개 첨부일 때만 노출한다. 폼이 이미 열려 있었는데 파일이 추가돼
    // 1개가 아니게 된 경우도 함께 닫는다(2026-08-13 수정 — 버튼은
    // 숨겨졌는데 이미 열려있던 폼은 그대로 남아 "어떤 파일이 저장될지"
    // 헷갈리는 문제가 있었음).
    idvSaveBtn.hidden = _attachedFiles.length !== 1;
    if (idvSaveBtn.hidden) { idvSaveForm.hidden = true; idvSaveStatus.textContent = ''; }
  }
  function _clearAttachPreview() {
    _attachedFiles = [];
    attachPreview.hidden = true;
    fileInput.value = '';
    cameraInput.value = '';
    idvSaveForm.hidden = true;
    idvTypeSel.value = '';
    idvDateInput.value = '';
    idvSaveStatus.textContent = '';
    _syncState();
  }
  async function _addAttachedFile(file) {
    if (!file) return;
    const entry = {
      name: file.name, dataUrl: null, isImage: file.type.startsWith('image/'),
      mimeType: file.type, sha256: null, extractedText: null,
      // 첨부 직후 곧바로 전송(sha256/본문추출이 아직 안 끝난 경합 케이스)을
      // 대비해, 호출부(onSend)가 필요하면 명시적으로 기다릴 수 있도록 각
      // 비동기 작업의 Promise 자체도 노출한다(webapp.html _callPanelAI의
      // 기존 계약 — f._hashPromise/f._extractPromise를 Promise.all로 기다린
      // 뒤 사용 — 그대로 유지).
      _hashPromise: null, _extractPromise: null,
    };
    const reader = new FileReader();
    const dataUrlPromise = new Promise((resolve) => {
      reader.onload = () => { entry.dataUrl = reader.result; resolve(); };
    });
    reader.readAsDataURL(file);
    await dataUrlPromise;
    entry._hashPromise = file.arrayBuffer()
      .then(buf => crypto.subtle.digest('SHA-256', buf))
      .then(hashBuf => Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join(''))
      .then(hex => { entry.sha256 = hex; return hex; })
      .catch(e => { console.warn('[ChatInput] SHA-256 계산 실패:', e.message); return null; });
    entry._extractPromise = entry.isImage ? Promise.resolve(null)
      : _extractFileText(file).then(text => { entry.extractedText = text; return text; });
    _attachedFiles.push(entry);
    _renderAttachPreview();
    _syncState();
  }
  attachBtn.addEventListener('click', () => fileInput.click());
  cameraBtn.addEventListener('click', () => cameraInput.click());
  fileInput.addEventListener('change', (e) => Array.from(e.target.files || []).forEach(_addAttachedFile));
  cameraInput.addEventListener('change', (e) => Array.from(e.target.files || []).forEach(_addAttachedFile));
  attachRemoveBtn.addEventListener('click', _clearAttachPreview);

  // ── IDV 저장 (2026-08-13 신설) — 정부24 등에서 이미 발급받아 첨부한
  // 서류를 로컬 IDV(gopang_idv_vault)에 저장해 다음에 kgov가 자동
  // 재사용하도록(GOV_TASK_SCHEMA_LOOKUP → findFreshCredential) 만든다.
  // storeCredential()(발급기관 서명 검증)이 아니라 storeRawDocument()
  // (사용자 업로드, 미검증 등급)를 쓴다 — 이유는 idv-store.js 주석 참고.
  idvSaveBtn.addEventListener('click', () => {
    idvSaveForm.hidden = !idvSaveForm.hidden;
    idvSaveStatus.textContent = '';
  });
  idvSaveCancel.addEventListener('click', () => {
    idvSaveForm.hidden = true;
    idvSaveStatus.textContent = '';
  });
  idvSaveConfirm.addEventListener('click', async () => {
    const idvType = idvTypeSel.value;
    const dateVal = idvDateInput.value; // 'YYYY-MM-DD' (input type=date)
    if (!idvType || !dateVal) {
      idvSaveStatus.textContent = '서류 종류와 발급일을 모두 선택하세요.';
      return;
    }
    const f = _attachedFiles[0];
    if (!f) { idvSaveStatus.textContent = '첨부된 파일이 없습니다.'; return; }

    idvSaveConfirm.disabled = true;
    idvSaveStatus.textContent = '저장 중…';
    try {
      // sha256 계산이 아직 안 끝났을 수 있어(첨부 직후 바로 클릭한 경우) 기다린다.
      if (f._hashPromise) await f._hashPromise.catch(() => null);
      if (!f.sha256) {
        idvSaveStatus.textContent = '파일 해시 계산 실패 — 저장할 수 없습니다.';
        return;
      }
      const { storeRawDocument } = await import('../idv/idv-store.js');
      const result = await storeRawDocument({
        idvType,
        issuanceDate: new Date(dateVal + 'T00:00:00').toISOString(),
        name: f.name,
        sha256: f.sha256,
        extractedText: f.extractedText || null,
      });
      idvSaveStatus.textContent = result.ok ? '저장됨 ✓' : `실패: ${result.reason || '알 수 없는 오류'}`;
      if (result.ok) {
        setTimeout(() => { idvSaveForm.hidden = true; idvSaveStatus.textContent = ''; }, 1500);
      }
    } catch (e) {
      console.warn('[ChatInput] IDV 저장 실패:', e.message);
      idvSaveStatus.textContent = `실패: ${e.message}`;
    } finally {
      idvSaveConfirm.disabled = false;
    }
  });


  // ── 전송 ───────────────────────────────────────────────
  async function _submit() {
    const text = input.value.trim();
    const files = _attachedFiles.slice();
    if (!text && !files.length) return;
    input.value = '';
    _clearAttachPreview();
    _syncState();
    await cfg.onSend(text, files);
  }
  sendBtn.addEventListener('click', () => {
    if (cfg.allowStop && _generating) cfg.onStop();
    else _submit();
  });
  input.addEventListener('keydown', (e) => {
    // 한글 IME 조합 확정 Enter와 실제 전송 Enter 이중 전송 방지
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      if (!(cfg.allowStop && _generating)) _submit();
    }
  });

  // ── 마이크 — continuous:false 안전 패턴(webapp.html 검증 구현 그대로) ──
  // continuous:true + e.resultIndex 신뢰 방식(구 chat-shell.js)은 Chrome에서
  // 이미 확정(final)된 구간이 재평가되어 문장이 중복 누적되는 버그가 있었다.
  // 이 구현은 "한 발화 = 정확히 하나의 확정 결과"만 받고, 인식 세션이
  // 끝나면(onend) 새 세션으로 재시작해 그 버그를 구조적으로 피한다.
  let _micSupported = false;
  let recognition = null;
  let micActive = false;
  let baseText = '';
  let errorStreak = 0;
  let silenceTimer = null;
  const _autoSendLimiter = new AutoSendLimiter(AUTO_SEND_MAX_PER_MINUTE, AUTO_SEND_WINDOW_MS);

  function _setMicVisual(on) {
    micBtn.classList.toggle('mic-active', on);
    sendBtn.classList.toggle('mic-active', on);
  }
  function _clearSilenceTimer() { if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; } }
  function _scheduleAutoSend() {
    if (!cfg.autoSendOnSilence) return;
    _clearSilenceTimer();
    silenceTimer = setTimeout(() => {
      silenceTimer = null;
      if (!micActive) return;
      if (input.value.trim() || _attachedFiles.length) {
        if (!_autoSendLimiter.allowed()) {
          console.warn(`[ChatInput] 1분 내 자동전송 한도(${AUTO_SEND_MAX_PER_MINUTE}회) 초과 — 오작동 의심으로 마이크를 멈춥니다.`);
          _stopMic();
          return;
        }
        _autoSendLimiter.record();
        baseText = '';
        _submit();
        _stopMic(); // 1회성 — 계속 듣고 있는 것처럼 보이는 상시 알림 문제 방지(webapp.html과 동일 정책)
      }
    }, SILENCE_MS);
  }
  function _createRecognition(SR) {
    const r = new SR();
    r.lang = document.documentElement.lang === 'ko' ? 'ko-KR' : (navigator.language || 'ko-KR');
    r.continuous = false;
    r.interimResults = false;
    r.onresult = (event) => {
      const text = event.results?.[0]?.[0]?.transcript || '';
      if (text) {
        baseText = appendUtterance(baseText, text);
        input.value = baseText;
        _syncState();
      }
      errorStreak = 0;
      _scheduleAutoSend();
    };
    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      errorStreak++;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || errorStreak >= 3) {
        micActive = false;
        _clearSilenceTimer();
      }
    };
    r.onend = () => {
      if (micActive) setTimeout(() => { if (micActive) _startListening(); }, RESTART_DELAY_MS);
      else _setMicVisual(false);
    };
    return r;
  }
  function _startListening() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = _createRecognition(SR);
    try { recognition.start(); return true; } catch (e) { return false; }
  }
  function _startMic() {
    baseText = input.value;
    errorStreak = 0;
    micActive = true;
    if (!_startListening()) { micActive = false; return; }
    _setMicVisual(true);
    container.dispatchEvent(new CustomEvent('chatinput:micstart', { bubbles: true }));
  }
  function _stopMic() {
    micActive = false;
    _setMicVisual(false);
    _clearSilenceTimer();
    try { recognition?.stop(); } catch (e) { /* 무시 */ }
    container.dispatchEvent(new CustomEvent('chatinput:micend', { bubbles: true }));
  }
  if (cfg.micEnabled) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      _micSupported = true;
      micBtn.addEventListener('click', () => { micActive ? _stopMic() : _startMic(); });
      input.addEventListener('input', () => {
        if (!micActive) return;
        baseText = input.value;
        _clearSilenceTimer();
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && micActive) _stopMic();
      });
      window.addEventListener('pagehide', () => { if (micActive) _stopMic(); });
    } else {
      micBtn.style.display = 'none';
    }
  } else {
    micBtn.style.display = 'none';
  }

  // ── 컨트롤러 ───────────────────────────────────────────
  return {
    getText: () => input.value,
    setText: (text) => { input.value = text || ''; _syncState(); },
    clear: () => { input.value = ''; _clearAttachPreview(); _syncState(); },
    focusInput: () => input.focus(),
    isMicActive: () => micActive,
    isMicSupported: () => _micSupported,
    setGenerating: (on) => { _generating = !!on; sendBtn.classList.toggle('generating', _generating); _syncState(); },
    destroy: () => {
      if (micActive) _stopMic();
      _clearSilenceTimer();
      container.innerHTML = '';
    },
    el: { root: container, input, sendBtn, micBtn, attachBtn, cameraBtn },
  };
}
