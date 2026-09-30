/* ══════════════════════════════════════════════════════════════════
   kdoctor-chat-widget.js — doctor.hondi.net 상단 진료 상담 창 (v0.1, 2026-09-30)

   ES 모듈로 로드한다:
     <div id="kdoctor-chat"></div>
     <script type="module" src="https://hondi.net/assets/kdoctor-chat-widget.js"></script>

   구조(estate 위젯과 다른 점):
     - SP 본문을 이 파일에 복사해 두지 않고 hondi.net의 정본을 실행 시점에 fetch한다
       (prompts/SP-29_kdoctor_v0_1.txt, prompts/kdoctor-specialties.json, 과목 SP, 공통 골격).
       정본이 곧 실행본이므로 사본 동기화 문제가 없다. 대신 hondi.net에 배포된 뒤에야 동작한다.
     - 총괄 SP가 낸 [CONSULT_SPECIALIST: …]를 이 위젯이 대신 실행한다(서버에 그 프로토콜 처리 코드가 없음).
       협진은 한 턴에 최대 3회, 등록되지 않은 과목 id는 호출하지 않는다.
     - [DIAGNOSIS_REPORT]는 src/gopang/ai/hondi-doctor-verdict.js로 재계산·제한한 뒤 카드로만 보여 준다.
       검증 실패는 1회 재생성 후 페일세이프(대면 진료 + 119·109 안내).
   호출 경로: POST https://hondi-proxy.tensor-city.workers.dev/ai/chat (Origin 화이트리스트만, 로그인 없음 —
   worker.js ALLOWED_ORIGINS에 https://doctor.hondi.net 등록 필요). 별도 rate-limit은 없다.

   현재 단계(2026-09-30 결정): 모든 사용자를 의료인으로 가정한다(VERIFICATION_ENFORCED=false).
   면허 검증 전에는 환자에게도 전문가 뷰(용량 포함)가 보일 수 있으므로 일반 공개 전에 검증을 붙일 것.
   ══════════════════════════════════════════════════════════════════ */
import { runTurn, assembleSpecialist, renderMarkdown, escapeHtml, FAILSAFE_TEXT } from './kdoctor-chat-core.js';
import { validateDiagnosis, audienceView } from '../src/gopang/ai/hondi-doctor-verdict.js';

(function () {
  var container = document.getElementById('kdoctor-chat');
  if (!container || container.dataset.kdInit) return;
  container.dataset.kdInit = '1';

  var BASE = new URL('..', import.meta.url).href.replace(/\/$/, ''); // https://hondi.net
  var WORKER_URL = 'https://hondi-proxy.tensor-city.workers.dev';

  var style = document.createElement('style');
  style.textContent =
    '#kdoctor-chat{border:1px solid var(--border,#e5e7eb);border-radius:var(--radius-lg,10px);background:var(--surface,#fff);overflow:hidden;box-shadow:var(--shadow,0 1px 3px rgba(0,0,0,.08));max-width:860px;margin:0 auto;}' +
    '.kd-head{display:flex;align-items:center;gap:8px;padding:14px 18px;border-bottom:1px solid var(--border,#e5e7eb);font-family:Pretendard,sans-serif;font-size:13.5px;font-weight:600;color:var(--text,#0f172a);}' +
    '.kd-head .kd-dot{width:7px;height:7px;border-radius:50%;background:var(--brand,#3ecf8e);flex-shrink:0;}' +
    '.kd-head .kd-new{margin-left:auto;border:1px solid var(--border,#e5e7eb);background:transparent;border-radius:8px;padding:3px 10px;font-size:12px;cursor:pointer;color:var(--text2,#334155);}' +
    '.kd-emerg{padding:9px 18px;background:#fef2f2;color:#991b1b;font-family:Pretendard,sans-serif;font-size:12.5px;border-bottom:1px solid #fecaca;}' +
    '.kd-messages{max-height:520px;min-height:140px;overflow-y:auto;padding:14px 18px;display:flex;flex-direction:column;gap:10px;}' +
    '.kd-msg{display:flex;max-width:92%;}.kd-msg.user{align-self:flex-end;}.kd-msg.ai{align-self:flex-start;}' +
    '.kd-bubble{padding:9px 13px;border-radius:14px;font-family:Pretendard,sans-serif;font-size:13px;line-height:1.65;word-break:break-word;}' +
    '.kd-msg.user .kd-bubble{background:var(--brand,#3ecf8e);color:#fff;border-bottom-right-radius:4px;}' +
    '.kd-msg.ai .kd-bubble{background:var(--bg-subtle,#f1f3f5);color:var(--text,#0f172a);border-bottom-left-radius:4px;}' +
    '.kd-msg.ai .kd-bubble p{margin:0 0 8px;}.kd-msg.ai .kd-bubble p:last-child{margin-bottom:0;}' +
    '.kd-msg.ai .kd-bubble ul{margin:6px 0 8px 16px;padding:0;display:flex;flex-direction:column;gap:4px;}' +
    '.kd-typing{display:flex;gap:4px;align-items:center;padding:9px 13px;}.kd-typing span{width:5px;height:5px;border-radius:50%;background:var(--text4,#6b7280);animation:kd-dot 1.2s ease-in-out infinite;}' +
    '.kd-typing span:nth-child(2){animation-delay:.2s}.kd-typing span:nth-child(3){animation-delay:.4s}' +
    '@keyframes kd-dot{0%,80%,100%{opacity:.3;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}' +
    '.kd-status{font-family:Pretendard,sans-serif;font-size:11.5px;color:var(--text4,#6b7280);padding:0 18px 6px;min-height:18px;}' +
    '.kd-inputrow{display:flex;gap:8px;padding:12px 14px;border-top:1px solid var(--border,#e5e7eb);}' +
    '.kd-input{flex:1;resize:none;border:1px solid var(--border,#e5e7eb);outline:none;background:var(--bg-subtle,#f1f3f5);border-radius:10px;padding:9px 12px;font-family:Pretendard,sans-serif;font-size:13px;color:var(--text,#0f172a);line-height:1.5;max-height:120px;min-height:38px;}' +
    '.kd-send{border:none;background:var(--text,#0f172a);color:#fff;font-family:Pretendard,sans-serif;font-size:13px;font-weight:600;padding:0 16px;border-radius:10px;cursor:pointer;flex-shrink:0;}' +
    '.kd-send:disabled{background:var(--border2,#d1d5db);cursor:not-allowed;}' +
    '.kd-note{padding:8px 18px 12px;font-size:11px;color:var(--text4,#6b7280);border-top:1px solid var(--border,#e5e7eb);font-family:Pretendard,sans-serif;}' +
    '.kd-report{display:flex;flex-direction:column;gap:6px;font-size:12.5px;}' +
    '.kd-alert{background:#fef2f2;color:#991b1b;border:1px solid #fecaca;border-radius:8px;padding:8px 10px;font-weight:600;}' +
    '.kd-kind{font-weight:700;font-size:13px;}.kd-kind-emergency_referral{color:#b91c1c;}.kd-kind-deferred{color:#92400e;}.kd-kind-conditional{color:#b45309;}.kd-kind-confirmed{color:var(--brand-dk,#1a9e6a);}' +
    '.kd-row{display:flex;gap:10px;}.kd-k{color:var(--text3,#64748b);min-width:64px;flex-shrink:0;}.kd-v{color:var(--text,#0f172a);}' +
    '.kd-flag{color:#991b1b;font-size:12px;}.kd-sec{font-weight:700;margin-top:6px;}' +
    '.kd-tag{display:inline-block;font-size:10.5px;padding:1px 6px;border-radius:99px;background:#e0e7ff;color:#3730a3;}' +
    '.kd-det summary{cursor:pointer;color:var(--text2,#334155);}.kd-conf{font-size:11.5px;color:var(--text3,#64748b);}' +
    '.kd-warn{font-size:11.5px;color:#92400e;}.kd-foot{font-size:11px;color:var(--text4,#6b7280);border-top:1px solid var(--border,#e5e7eb);padding-top:6px;margin-top:4px;}' +
    '.kd-report ul{margin:2px 0 4px 16px;padding:0;}';
  document.head.appendChild(style);

  container.innerHTML =
    '<div class="kd-head"><span class="kd-dot"></span>K-Doctor 진료 상담 — 증상을 알려주세요<button class="kd-new" id="kd-new" type="button">새 상담</button></div>' +
    '<div class="kd-emerg">응급이면 지금 119 · 자살예방상담전화 109(24시간). 이 창은 진단서·처방전을 발급하지 않는 임상 의사결정 지원 도구입니다.</div>' +
    '<div class="kd-messages" id="kd-messages"></div>' +
    '<div class="kd-status" id="kd-status"></div>' +
    '<div class="kd-inputrow"><textarea class="kd-input" id="kd-input" rows="1" placeholder="예) 55세 남성, 30분 전부터 가슴이 조이고 식은땀이 납니다"></textarea><button class="kd-send" id="kd-send" type="button">전송</button></div>' +
    '<div class="kd-note">개인정보(이름·주민등록번호·주소·연락처)는 입력하지 마세요. 대화는 이 화면 메모리에만 있고 저장되지 않습니다. 사진 분석은 아직 연결되지 않았습니다. 현재는 모든 사용자를 의료인으로 가정한 초안 단계이며 실사용자 대상이 아닙니다.</div>';

  var msgsEl = document.getElementById('kd-messages');
  var input = document.getElementById('kd-input');
  var sendBtn = document.getElementById('kd-send');
  var statusEl = document.getElementById('kd-status');
  var newBtn = document.getElementById('kd-new');

  var history = [];
  var busy = false;
  var resources = null;
  var specCache = {};

  function append(role, html) {
    var w = document.createElement('div'); w.className = 'kd-msg ' + role;
    var b = document.createElement('div'); b.className = 'kd-bubble'; b.innerHTML = html;
    w.appendChild(b); msgsEl.appendChild(w); msgsEl.scrollTop = msgsEl.scrollHeight; return w;
  }
  function greet() {
    append('ai', renderMarkdown('안녕하세요. 증상을 자유롭게 말씀해 주세요. 위험 신호부터 확인하고, 필요하면 진료과목별 전문 AI의 소견을 모아 진단 참고를 드립니다.\n\n먼저 **가장 힘든 증상 한 가지**가 무엇인가요?'));
  }
  greet();

  function fetchText(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(url + ' ' + r.status); return r.text(); });
  }
  async function loadResources() {
    if (resources) return resources;
    var results = await Promise.all([
      fetchText(BASE + '/prompts/kdoctor-specialties.json'),
      fetchText(BASE + '/prompts/SP-29_kdoctor_v0_1.txt'),
      fetchText(BASE + '/prompts/SP-29-COMMON_kdoctor_specialist_base_v0_1.txt'),
    ]);
    resources = { registry: JSON.parse(results[0]), orchestratorSP: results[1], baseText: results[2] };
    return resources;
  }
  async function loadSpecialist(id) {
    if (specCache[id]) return specCache[id];
    var res = await loadResources();
    var spec = res.registry.specialties.filter(function (s) { return s.id === id; })[0];
    if (!spec) throw new Error('unknown specialty ' + id);
    var text = await fetchText(BASE + '/prompts/' + spec.file);
    specCache[id] = assembleSpecialist(text, res.baseText);
    return specCache[id];
  }
  async function callLLM(system, messages, maxTokens) {
    var ctl = new AbortController();
    var t = setTimeout(function () { ctl.abort(); }, 90000);
    try {
      var res = await fetch(WORKER_URL + '/ai/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl.signal,
        body: JSON.stringify({ provider: 'deepseek', model: 'deepseek-v4-flash', system: system, messages: messages, max_tokens: maxTokens }),
      });
      if (!res.ok) throw new Error('Worker ' + res.status);
      var data = await res.json();
      if (!data.content) throw new Error('empty');
      return data.content;
    } finally { clearTimeout(t); }
  }

  function autoResize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; }
  input.addEventListener('input', autoResize);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  newBtn.addEventListener('click', function () { if (busy) return; history = []; msgsEl.innerHTML = ''; statusEl.textContent = ''; greet(); });

  async function send() {
    var text = input.value.trim();
    if (!text || busy) return;
    busy = true; sendBtn.disabled = true; input.value = ''; input.style.height = 'auto';
    append('user', escapeHtml(text));
    var typing = append('ai', '<div class="kd-typing"><span></span><span></span><span></span></div>');
    statusEl.textContent = '진료과목별 소견을 모으는 중… (최대 1~2분)';
    try {
      var res = await loadResources();
      var out = await runTurn(history, text, {
        callLLM: callLLM, orchestratorSP: res.orchestratorSP, registry: res.registry, loadSpecialist: loadSpecialist,
        validate: validateDiagnosis, audienceView: audienceView, audience: undefined,
      });
      history = out.history.slice(-24);
      typing.remove();
      var v = out.view;
      if (v.type === 'report') append('ai', v.html);
      else append('ai', renderMarkdown(v.text));
      var used = (v.consults || []).filter(function (c) { return c.ok; }).map(function (c) { return c.id.replace('kdoctor-', ''); });
      statusEl.textContent = used.length ? '협진: ' + used.join(', ') : '';
    } catch (err) {
      typing.remove();
      append('ai', renderMarkdown('상담 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.\n\n' + FAILSAFE_TEXT));
      statusEl.textContent = '';
      console.error('[kdoctor-chat-widget]', err);
    }
    busy = false; sendBtn.disabled = false; input.focus();
  }
  sendBtn.addEventListener('click', send);
})();
