/**
 * ui/file-attach.js — 파일 첨부·카메라
 */
import { setAttachFile } from '../core/state.js';
import { appendBubble } from './bubble.js';

// ── 파일 첨부 ───────────────────────────────────────────
export function triggerAttach() {
  document.getElementById('file-input').click();
}
export function triggerCamera() {
  document.getElementById('camera-input').click();
}
export function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  setAttachFile(file);

  const nameEl    = document.getElementById('attach-name');
  const previewEl = document.getElementById('attach-preview');

  if (file.type.startsWith('image/')) {
    // 이미지 — 썸네일만 표시 (파일명·경고문 제거)
    const objUrl  = URL.createObjectURL(file);
    const thumbId = 'thumb-' + Date.now();
    nameEl.innerHTML =
      `<img id="${thumbId}" src="${objUrl}"
        style="height:36px;width:36px;object-fit:cover;
               border-radius:8px;vertical-align:middle;display:block;">`;
    requestAnimationFrame(() => {
      const t = document.getElementById(thumbId);
      if (t) t.addEventListener('load', () => URL.revokeObjectURL(objUrl), { once: true });
    });
  } else {
    // 일반 파일 — 아이콘만 표시
    const ext = file.name.split('.').pop().toUpperCase();
    nameEl.innerHTML =
      `<span style="font-size:calc(0.6875rem*var(--hondi-fs,1));font-weight:600;color:var(--label-2);
                    background:var(--bg-subtle);border-radius:6px;
                    padding:3px 7px;">${ext}</span>`;
  }

  previewEl.style.display = 'flex';
  e.target.value = '';
  updateSendBtn();
}

export function removeAttach() {
  setAttachFile(null);
  document.getElementById('attach-preview').style.display = 'none';
  document.getElementById('attach-name').innerHTML = '';
  updateSendBtn();   // ★ 첨부 제거 후 버튼 상태 재계산
}


// ── 마이크 입력 후 1초 무입력 시 자동 전송 ─────────────────
let _micAutoSendTimer = null;

