/**
 * ui/progress.js — 진행 상황 시트 (K-Clean 등)
 */
// ══════════════════════════════════════════════════════════
// 진행 상황 관리 시스템
// ══════════════════════════════════════════════════════════

// 단계 정의 (신고자 기준 — 내부 분석 단계 미표시)
const PROGRESS_STEPS_CLN = [
  { id: 'accept',   icon: '📥', label: '신고 접수' },
  { id: 'analyze',  icon: '🔍', label: '현장 분석 중' },
  { id: 'transfer', icon: '🏛️', label: '관할 기관 전달' },
  { id: 'done',     icon: '✅', label: '처리 완료' },
];

// 현재 진행 중인 작업 상태
let _progressJob = null;
// {
//   id: string,            // 신고 ID
//   steps: [...],          // 단계 배열
//   currentStep: number,   // 현재 단계 인덱스
//   intent: string,        // 이해한 지시 내용
//   location: string,      // 위치
//   done: boolean,
// }

// 진행 상황 시작
export function _progressStart(intent, location, reportId) {
  _progressJob = {
    id:          reportId || ('RPT-' + Date.now()),
    steps:       PROGRESS_STEPS_CLN,
    currentStep: 0,
    intent,
    location,
    done:        false,
  };
  _progressSetStep(0);
  _topLogoSetProgress(true);
}

// 특정 단계로 진행
export function _progressSetStep(idx) {
  if (!_progressJob) return;
  _progressJob.currentStep = idx;
  _progressJob.done = (idx >= _progressJob.steps.length - 1);
  _renderProgressSteps();
  if (_progressJob.done) {
    setTimeout(() => _topLogoSetProgress(false), 3000);
  }
}

// 다음 단계로 전진
export function _progressNext() {
  if (!_progressJob || _progressJob.done) return;
  _progressSetStep(_progressJob.currentStep + 1);
}

// 상단 로고 상태 전환
export function _topLogoSetProgress(active) {
  const textEl = document.getElementById('top-logo-text');
  const dotEl  = document.getElementById('top-progress-dot');
  if (!textEl) return;
  if (active) {
    textEl.textContent = '⏳ 진행 상황';
    textEl.style.color = 'rgba(255,255,255,0.95)';
    if (dotEl) dotEl.style.display = 'inline-block';
  } else {
    textEl.textContent = '고팡';
    textEl.style.color = 'rgba(255,255,255,0.90)';
    if (dotEl) dotEl.style.display = 'none';
    _progressJob = null;
  }
}

// 로고 탭 핸들러
export function _onLogoTap() {
  if (!_progressJob) return;   // 진행 중 없으면 무반응
  _renderProgressSteps();
  document.getElementById('progress-overlay').classList.add('open');
}

// 시트 닫기 (배경 탭)
export function _closeProgressSheet(e) {
  if (e.target.id === 'progress-overlay')
    document.getElementById('progress-overlay').classList.remove('open');
}

// 진행 단계 렌더링
export function _renderProgressSteps() {
  if (!_progressJob) return;
  const el = document.getElementById('progress-steps');
  const titleEl = document.getElementById('progress-sheet-title');
  if (!el) return;

  if (titleEl) {
    titleEl.textContent = _progressJob.intent || '진행 상황';
  }

  let html = '';

  // 위치 표시
  if (_progressJob.location) {
    html += `<div style="font-size:12px;color:var(--label-3);
                          margin-bottom:16px;padding:8px 12px;
                          background:var(--bg-subtle);border-radius:10px;">
               📍 ${_progressJob.location}
             </div>`;
  }

  // 단계 목록
  _progressJob.steps.forEach((step, i) => {
    const current = i === _progressJob.currentStep;
    const done    = i < _progressJob.currentStep;
    const pending = i > _progressJob.currentStep;

    const dotColor = done    ? 'var(--green)'
                   : current ? 'var(--yellow)'
                   :            'var(--sep-strong)';
    const labelColor = pending ? 'var(--label-3)' : 'var(--label)';
    const fontWeight = current ? '600' : '400';

    html += `
      <div style="display:flex;align-items:center;gap:14px;
                  padding:12px 4px;position:relative;">
        <!-- 연결선 (마지막 제외) -->
        ${i < _progressJob.steps.length - 1 ? `
          <div style="position:absolute;left:17px;top:36px;
                      width:2px;height:calc(100% - 12px);
                      background:${done ? 'var(--green)' : 'var(--sep-strong)'};
                      border-radius:1px;"></div>` : ''}
        <!-- 상태 원 -->
        <div style="width:34px;height:34px;border-radius:50%;
                    background:${dotColor};flex-shrink:0;
                    display:flex;align-items:center;justify-content:center;
                    font-size:16px;z-index:1;
                    ${current ? 'box-shadow:0 0 0 4px rgba(255,214,10,0.2);' : ''}">
          ${done ? '✓' : step.icon}
        </div>
        <!-- 텍스트 -->
        <div>
          <div style="font-size:15px;font-weight:${fontWeight};
                      color:${labelColor};">${step.label}</div>
          ${current ? `<div style="font-size:12px;color:var(--yellow);
                                    margin-top:2px;">진행 중…</div>` : ''}
          ${done    ? `<div style="font-size:12px;color:var(--green);
                                    margin-top:2px;">완료</div>` : ''}
        </div>
      </div>`;
  });

  // 신고 ID
  html += `<div style="font-size:11px;color:var(--label-3);
                        margin-top:16px;text-align:right;">
             ${_progressJob.id}
           </div>`;

  el.innerHTML = html;
}

// ※ SP-00-ROUTER 프리로드 블록은 2026-07-05 제거됨 — _loadRouterPrompt가
// import 없이 호출되고 있어 매 페이지 로드마다 ReferenceError가
// try/catch로 조용히 삼켜지고 있었다(router.js 자체가 죽은 코드였음).
// 자세한 경위는 prompts/archive/SP-00-ROUTER-DEPRECATED.md 참조.

// ── 초기 AI 비서 환영 메시지 ────────────────────────────
