// 정부 AI 답변마다 붙는 "문제 신고" — 사용자의 제안·버그 신고·개선 요청을 SP별로 확실히 수집하는 결정적 경로.
// (모델이 [USER_FEEDBACK] 태그를 내지 못해도 수집된다.) 서버: POST /user-feedback/sp-report
// 집계·갱신 결정: tools/sp_update_log.py, 절차: docs/GOV-SP-UPDATE-SHARING_v1_0.md

export const REPORT_KINDS = [
  ['wrong_info', '틀린 정보'], ['outdated', '오래된 정보'], ['missing', '빠진 안내'],
  ['wrong_agency', '소관(기관) 안내 오류'], ['suggestion', '개선 제안'], ['other', '기타'],
];

// trace(라우팅 경로) → 이 답변을 처리한 가장 구체적인 SP ID. 개발자용 코드이며 사용자에게 보이지 않는다.
export function deriveSpIdFromTrace(trace) {
  if (!Array.isArray(trace)) return null;
  for (let i = trace.length - 1; i >= 0; i--) {
    const t = String(trace[i] || '').trim();
    if (!t || t.startsWith('(') || t.startsWith('PERMIT-') || t === 'JEJU-GOV-COMMON') continue;
    const lazy = /^(SP-[A-Z]+-LAZY)\(([^/,)]+)/.exec(t);
    if (lazy) return `${lazy[1]}(${lazy[2]})`;
    const base = /^[^(]+/.exec(t)[0].trim();
    if (base) return base;
  }
  return null;
}

// bubble 아래에 작은 "문제 신고" 링크를 붙인다. opts: { trace, proxy, getToken, getGuid }
export function attachAnswerReport(bubble, opts) {
  if (!bubble || typeof document === 'undefined') return;
  const spId = deriveSpIdFromTrace(opts.trace);
  const bar = document.createElement('div');
  bar.style.cssText = 'margin-top:6px;font-size:12px;opacity:.7';
  const link = document.createElement('a');
  link.href = '#'; link.textContent = '이 답변에 문제가 있나요? 신고·제안';
  link.style.cssText = 'color:inherit;text-decoration:underline;cursor:pointer';
  bar.appendChild(link); bubble.appendChild(bar);
  link.addEventListener('click', (ev) => {
    ev.preventDefault();
    const form = document.createElement('div');
    form.style.cssText = 'margin-top:6px;display:flex;flex-direction:column;gap:6px;font-size:13px';
    const sel = document.createElement('select');
    sel.innerHTML = REPORT_KINDS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    const txt = document.createElement('textarea');
    txt.rows = 2; txt.maxLength = 300; txt.placeholder = '무엇이 잘못됐거나 어떻게 바뀌면 좋을지 적어 주세요(선택, 개인정보는 적지 마세요)';
    const btn = document.createElement('button');
    btn.type = 'button'; btn.textContent = '보내기';
    const msg = document.createElement('div');
    form.append(sel, txt, btn, msg); bar.replaceChildren(form);
    btn.addEventListener('click', async () => {
      btn.disabled = true; msg.textContent = '보내는 중…';
      try {
        const tok = opts.getToken ? opts.getToken() : null;
        const r = await fetch(`${opts.proxy}/user-feedback/sp-report`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sp_id: spId, kind: sel.value, comment: txt.value.trim(), trace: (opts.trace || []).slice(-6),
            guid: opts.getGuid ? opts.getGuid() : null, phone_verify_token: tok || undefined }),
        });
        if (r.status === 401 || r.status === 403) { msg.textContent = '로그인한 뒤에 신고할 수 있습니다.'; btn.disabled = false; return; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        bar.textContent = '신고해 주셔서 감사합니다. 접수되었습니다.';
      } catch (e) { msg.textContent = '전송하지 못했습니다. 잠시 뒤 다시 시도해 주세요.'; btn.disabled = false; }
    });
  });
}
