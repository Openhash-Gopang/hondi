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
   worker.js ALLOWED_ORIGINS에 https://doctor.hondi.net 등록 필요). rate-limit은 워커(doctor 경로, IP·시간·전체)에서 건다.

   첨부("+", 2026-10-01): 증상 사진 → SP-29-IMG 비전 관찰 JSON, 서류 → 브라우저 글자 추출(txt·PDF·docx) 또는 SP-29-DOC 전사(스캔·사진)
     → 개인식별번호 가림·제어 태그 무력화 후 [ATTACHED_*] 블록으로 총괄 SP에 전달. 사진 원본은 총괄 SP에 보내지 않는다.
   건강 기록(PDV): "나만의 AI 비서"(hondi.net)가 연 탭(window.opener, ?gwp=1)에서만 GWP_PDV_REQUEST로 병력·가족력·생활습관을 요청한다.
     사용자가 비서 쪽에서 그룹별로 승인한 값만 돌아온다. 그 밖의 경로로 열면 환자에게 직접 묻는다.

   현재 단계(2026-09-30 결정): 모든 사용자를 의료인으로 가정한다(VERIFICATION_ENFORCED=false).
   면허 검증 전에는 환자에게도 전문가 뷰(용량 포함)가 보일 수 있으므로 일반 공개 전에 검증을 붙일 것.
   ══════════════════════════════════════════════════════════════════ */
import {
  runTurn, assembleSpecialist, renderMarkdown, escapeHtml, FAILSAFE_TEXT,
  ATTACH_LIMITS, classifyFile, decodeTextBytes, prepareDocumentText, parseVisionJson, describeObservation, composeUserText, buildPdvBlock,
} from './kdoctor-chat-core.js';
import { HEALTH_FIELD_IDS } from '../src/gopang/pdv/health-profile.js';
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
    '.kd-report ul{margin:2px 0 4px 16px;padding:0;}' +
    '.kd-inputrow{position:relative;align-items:flex-end;}' +
    '.kd-plus{border:1px solid var(--border,#e5e7eb);background:transparent;color:var(--text2,#334155);font-size:20px;line-height:1;width:38px;height:38px;border-radius:10px;cursor:pointer;flex-shrink:0;}' +
    '.kd-plus:disabled{opacity:.5;cursor:not-allowed;}' +
    '.kd-menu{position:absolute;left:14px;bottom:56px;background:var(--surface,#fff);border:1px solid var(--border,#e5e7eb);border-radius:10px;box-shadow:0 4px 14px rgba(0,0,0,.12);padding:4px;display:flex;flex-direction:column;min-width:210px;z-index:5;}' +
    '.kd-menu[hidden]{display:none;}' +
    '.kd-menu button{border:none;background:transparent;text-align:left;padding:8px 10px;border-radius:8px;font-family:Pretendard,sans-serif;font-size:12.5px;color:var(--text,#0f172a);cursor:pointer;}' +
    '.kd-menu button:hover{background:var(--bg-subtle,#f1f3f5);}' +
    '.kd-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px;}.kd-chips:empty{display:none;}' +
    '.kd-chip{display:inline-flex;align-items:center;gap:6px;max-width:100%;border:1px solid var(--border,#e5e7eb);background:var(--bg-subtle,#f1f3f5);border-radius:99px;padding:3px 6px 3px 10px;font-family:Pretendard,sans-serif;font-size:11.5px;color:var(--text,#0f172a);}' +
    '.kd-chip .kd-cn{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px;}.kd-chip .kd-cs{color:var(--text3,#64748b);}' +
    '.kd-chip.err{border-color:#fecaca;background:#fef2f2;color:#991b1b;}.kd-chip.err .kd-cs{color:#991b1b;}' +
    '.kd-chip button{border:none;background:transparent;cursor:pointer;font-size:14px;line-height:1;color:inherit;padding:0 4px;}' +
    '.kd-attach-list{margin-top:6px;font-size:11.5px;opacity:.9;}' +
    '.kd-prop{font-size:12.5px;}.kd-prop ul{margin:4px 0 6px 16px;padding:0;}.kd-prop button{margin-top:4px;padding:4px 10px;border-radius:8px;border:1px solid var(--border,#e5e7eb);background:var(--surface,#fff);cursor:pointer;font-size:12px;}';
  document.head.appendChild(style);

  container.innerHTML =
    '<div class="kd-head"><span class="kd-dot"></span>K-Doctor 진료 상담 — 증상을 알려주세요<button class="kd-new" id="kd-new" type="button">새 상담</button></div>' +
    '<div class="kd-emerg">응급이면 지금 119 · 자살예방상담전화 109(24시간). 이 창은 진단서·처방전을 발급하지 않는 임상 의사결정 지원 도구입니다.</div>' +
    '<div class="kd-messages" id="kd-messages"></div>' +
    '<div class="kd-status" id="kd-status"></div>' +
    '<div class="kd-chips" id="kd-chips"></div>' +
    '<div class="kd-inputrow"><button class="kd-plus" id="kd-plus" type="button" aria-label="파일 추가" aria-haspopup="true" aria-expanded="false" title="사진·서류·건강 기록 추가">+</button>' +
    '<div class="kd-menu" id="kd-menu" role="menu" hidden>' +
    '<button type="button" role="menuitem" data-act="photo">📷 증상 사진 (JPEG·PNG·WebP)</button>' +
    '<button type="button" role="menuitem" data-act="doc">📄 서류 (PDF·docx·텍스트·서류 사진)</button>' +
    '<button type="button" role="menuitem" data-act="pdv">🔒 내 건강 기록 불러오기 (비서 PDV)</button></div>' +
    '<input type="file" id="kd-file-photo" accept="image/jpeg,image/png,image/webp" multiple hidden>' +
    '<input type="file" id="kd-file-doc" accept=".pdf,.docx,.txt,.md,.csv,.tsv,.json,.log,image/jpeg,image/png,image/webp" multiple hidden>' +
    '<textarea class="kd-input" id="kd-input" rows="1" placeholder="예) 55세 남성, 30분 전부터 가슴이 조이고 식은땀이 납니다"></textarea><button class="kd-send" id="kd-send" type="button">전송</button></div>' +
    '<div class="kd-note">개인정보(이름·주민등록번호·주소·연락처)는 입력하지 마세요. 첨부한 서류의 주민번호·전화·이메일·카드번호 등은 전송 전에 가리지만 완전하지 않습니다. 증상 사진은 이 브라우저에서 줄여 AI 판독에만 쓰이며 저장되지 않고, 총괄 AI에는 판독 결과만 전달됩니다. 대화는 이 화면 메모리에만 있고 저장되지 않습니다. 현재는 모든 사용자를 의료인으로 가정한 초안 단계이며 실사용자 대상이 아닙니다.</div>';

  var msgsEl = document.getElementById('kd-messages');
  var input = document.getElementById('kd-input');
  var sendBtn = document.getElementById('kd-send');
  var statusEl = document.getElementById('kd-status');
  var newBtn = document.getElementById('kd-new');
  var plusBtn = document.getElementById('kd-plus');
  var menuEl = document.getElementById('kd-menu');
  var chipsEl = document.getElementById('kd-chips');
  var photoInput = document.getElementById('kd-file-photo');
  var docInput = document.getElementById('kd-file-doc');

  var history = [];
  var busy = false;
  var atts = [];            // 첨부: {id,name,icon,status:'processing'|'ready'|'error',label,att?}
  var attSeq = 0;
  var consented = false;    // 첨부 전송 동의(대화당 1회)
  var pdvState = { count: 0 };
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
      fetchText(BASE + '/prompts/SP-29K_kdoctor_check_v0_1.txt').catch(function () { return ''; }),
    ]);
    resources = { registry: JSON.parse(results[0]), orchestratorSP: results[1], baseText: results[2], checkSP: results[3] };
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
  async function callLLM(system, messages, maxTokens, isCheck) {
    var ctl = new AbortController();
    var t = setTimeout(function () { ctl.abort(); }, 90000);
    try {
      var res = await fetch(WORKER_URL + '/ai/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl.signal,
        body: JSON.stringify({ provider: 'deepseek', model: 'deepseek-v4-flash', system: system, messages: messages, max_tokens: maxTokens, check: isCheck ? true : undefined }),
      });
      if (res.status === 429) { var rl = new Error('Worker 429'); rl.rateLimited = true; throw rl; }
      if (!res.ok) throw new Error('Worker ' + res.status);
      var data = await res.json();
      if (!data.content) throw new Error('empty');
      return data.content;
    } finally { clearTimeout(t); }
  }


  // ─────────────── 첨부 처리 ───────────────
  var L = ATTACH_LIMITS;
  var CDN = (typeof window.KDOCTOR_CDN === 'string' && window.KDOCTOR_CDN) || 'https://cdn.jsdelivr.net/npm';
  var DEFAULT_CDN = CDN === 'https://cdn.jsdelivr.net/npm';
  var PDFJS_VER = '4.4.168', MAMMOTH_VER = '1.8.0';
  var MAMMOTH_SRI = 'sha384-/cXAMbzovUIKbBERjPmR3SnPTh8siWr5lsvFYj1Uq4XP0yaJUZJmsh0YXyGv5P0y';
  var libs = {};
  var visionSP = {};

  function loadPdfjs() {
    if (!libs.pdf) libs.pdf = (async function () {
      var mod = await import(/* @vite-ignore */ CDN + '/pdfjs-dist@' + PDFJS_VER + '/build/pdf.min.mjs');
      // 교차 출처 워커는 직접 만들 수 없으므로 소스를 받아 blob 워커로 돌린다
      var w = await fetch(CDN + '/pdfjs-dist@' + PDFJS_VER + '/build/pdf.worker.min.mjs');
      if (!w.ok) throw new Error('pdf worker ' + w.status);
      mod.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([await w.text()], { type: 'text/javascript' }));
      return mod;
    })();
    libs.pdf.catch(function () { libs.pdf = null; });
    return libs.pdf;
  }
  function loadMammoth() {
    if (window.mammoth) return Promise.resolve(window.mammoth);
    if (!libs.mammoth) libs.mammoth = new Promise(function (resolve, reject) {
      var sc = document.createElement('script');
      sc.src = CDN + '/mammoth@' + MAMMOTH_VER + '/mammoth.browser.min.js';
      if (DEFAULT_CDN) { sc.integrity = MAMMOTH_SRI; sc.crossOrigin = 'anonymous'; }
      sc.onload = function () { window.mammoth ? resolve(window.mammoth) : reject(new Error('mammoth missing')); };
      sc.onerror = function () { reject(new Error('mammoth load')); };
      document.head.appendChild(sc);
    });
    libs.mammoth.catch(function () { libs.mammoth = null; });
    return libs.mammoth;
  }
  async function loadVisionSP(name) {
    if (!visionSP[name]) visionSP[name] = fetchText(BASE + '/prompts/' + name);
    try { return await visionSP[name]; } catch (e) { delete visionSP[name]; throw e; }
  }
  function readFile(file) {
    return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; r.readAsArrayBuffer(file); });
  }
  // 사진을 캔버스로 다시 그려 EXIF(위치·기기 정보)를 버리고 긴 변을 줄인다 → JPEG data URL
  async function imageToDataUrl(blob) {
    var bmp = null, w, h, src;
    try { bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' }); w = bmp.width; h = bmp.height; src = bmp; }
    catch (e) {
      var url = URL.createObjectURL(blob);
      try {
        var img = await new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = function () { rej(new Error('image decode')); }; i.src = url; });
        w = img.naturalWidth; h = img.naturalHeight; src = img;
      } finally { URL.revokeObjectURL(url); }
    }
    var k = Math.min(1, L.imageMaxEdge / Math.max(w, h));
    var cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
    var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(src, 0, 0, cv.width, cv.height);
    if (bmp && bmp.close) bmp.close();
    return cv.toDataURL('image/jpeg', L.jpegQuality);
  }
  async function callVision(spName, dataUrl, instruction) {
    var sp = await loadVisionSP(spName);
    var content = await callLLM(sp, [{ role: 'user', content: [{ type: 'text', text: instruction }, { type: 'image_url', image_url: { url: dataUrl } }] }], 3000);
    var obj = parseVisionJson(content);
    if (!obj) throw new Error('vision parse');
    return obj;
  }
  function docFromTranscripts(objs) {
    var parts = [], kinds = {}, refusal = null;
    objs.forEach(function (o) {
      if (o.gate) { refusal = refusal || o.gate; return; }
      if (o.doc_kind) kinds[o.doc_kind] = 1;
      var t = String(o.transcript || '').trim();
      if (t) parts.push(t + (o.notes ? '\n(메모: ' + String(o.notes).slice(0, 200) + ')' : ''));
    });
    return { text: parts.join('\n\n--- 다음 쪽 ---\n\n'), refusal: parts.length ? null : refusal };
  }
  var DOC_GATE_LABEL = { NOT_MEDICAL_DOCUMENT: '의료 서류가 아닌 것으로 보여 제외', IDENTITY_DOCUMENT: '신분증·증명서로 보여 제외', UNREADABLE: '글자를 읽을 수 없어 제외' };

  async function extractPdf(file, setLabel) {
    var pdfjs = await loadPdfjs();
    var doc = await pdfjs.getDocument({ data: new Uint8Array(await readFile(file)) }).promise;
    var n = Math.min(doc.numPages, L.maxPdfPages), text = '';
    for (var i = 1; i <= n; i++) {
      var pg = await doc.getPage(i), tc = await pg.getTextContent();
      text += tc.items.map(function (it) { return it.str + (it.hasEOL ? '\n' : ' '); }).join('') + '\n';
    }
    var truncatedPages = doc.numPages > n;
    if (text.replace(/\s/g, '').length >= 40 * Math.min(n, 3)) return { text: text, via: 'pdf_text', truncated: truncatedPages };
    // 글자층이 없는 스캔 PDF → 앞쪽 몇 쪽을 그림으로 그려 전사
    var scanN = Math.min(doc.numPages, L.maxScanPages), objs = [];
    for (var j = 1; j <= scanN; j++) {
      setLabel('스캔 전사 중 ' + j + '/' + scanN);
      var page = await doc.getPage(j), vp0 = page.getViewport({ scale: 1 });
      var vp = page.getViewport({ scale: Math.min(2, L.imageMaxEdge / Math.max(vp0.width, vp0.height)) });
      var cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: cx, viewport: vp }).promise;
      objs.push(await callVision('SP-29-DOC_kdoctor_document_transcription_v0_1.txt', cv.toDataURL('image/jpeg', L.jpegQuality), '이 서류 ' + j + '쪽의 글자를 전사하세요.'));
    }
    var d = docFromTranscripts(objs);
    return { text: d.text, via: 'vision_transcription', truncated: doc.numPages > scanN, refusal: d.refusal };
  }

  function chipRender() {
    chipsEl.innerHTML = '';
    atts.forEach(function (a) {
      var c = document.createElement('span'); c.className = 'kd-chip' + (a.status === 'error' ? ' err' : '');
      c.innerHTML = '<span>' + a.icon + '</span><span class="kd-cn">' + escapeHtml(a.name) + '</span><span class="kd-cs">' + escapeHtml(a.status === 'processing' ? (a.label || '처리 중…') : (a.label || '')) + '</span>';
      var x = document.createElement('button'); x.type = 'button'; x.setAttribute('aria-label', a.name + ' 제거'); x.textContent = '×';
      x.addEventListener('click', function () { atts = atts.filter(function (z) { return z.id !== a.id; }); chipRender(); });
      c.appendChild(x); chipsEl.appendChild(c);
    });
    updateSendState();
  }
  function updateSendState() {
    var proc = atts.some(function (a) { return a.status === 'processing'; });
    sendBtn.disabled = busy || proc;
    plusBtn.disabled = busy;
  }
  function attCount() { return atts.filter(function (a) { return a.status !== 'error'; }).length; }

  async function processFile(file, mode, entry) {
    var cls = classifyFile(file, L);
    if (cls.kind === 'unsupported') { entry.status = 'error'; entry.label = cls.reason; return; }
    var setLabel = function (t) { entry.label = t; chipRender(); };
    try {
      if (mode === 'photo') {
        if (cls.kind !== 'image') { entry.status = 'error'; entry.label = '증상 사진은 JPEG·PNG·WebP만 올릴 수 있습니다'; return; }
        setLabel('판독 중…');
        var obs = await callVision('SP-29-IMG_kdoctor_symptom_image_vision_prompt_v0_1.txt', await imageToDataUrl(file), '이 증상 사진을 관찰 규칙에 따라 JSON으로만 기술하세요.');
        var d = describeObservation(obs);
        if (obs.gate === 'NOT_MEDICAL') { entry.status = 'error'; entry.label = d.label; return; }
        entry.status = 'ready'; entry.label = d.label; entry.att = { kind: 'image_observation', name: file.name, observation: obs };
        return;
      }
      var text, via, truncated = false;
      if (cls.kind === 'image') {
        setLabel('전사 중…');
        var o = await callVision('SP-29-DOC_kdoctor_document_transcription_v0_1.txt', await imageToDataUrl(file), '이 서류의 글자를 전사하세요.');
        var dd = docFromTranscripts([o]);
        if (dd.refusal) { entry.status = 'error'; entry.label = DOC_GATE_LABEL[dd.refusal] || '제외'; return; }
        text = dd.text; via = 'vision_transcription';
      } else if (cls.kind === 'pdf') {
        setLabel('글자 추출 중…');
        var r = await extractPdf(file, setLabel);
        if (r.refusal) { entry.status = 'error'; entry.label = DOC_GATE_LABEL[r.refusal] || '제외'; return; }
        text = r.text; via = r.via; truncated = !!r.truncated;
      } else if (cls.kind === 'docx') {
        setLabel('글자 추출 중…');
        var m = await loadMammoth();
        text = (await m.extractRawText({ arrayBuffer: await readFile(file) })).value; via = 'docx_text';
      } else {
        text = decodeTextBytes(new Uint8Array(await readFile(file))); via = 'text';
      }
      var prep = prepareDocumentText(text, L);
      if (!prep.text.trim()) { entry.status = 'error'; entry.label = '읽을 수 있는 글자가 없습니다'; return; }
      entry.status = 'ready';
      entry.label = (via === 'vision_transcription' ? '전사 완료' : '글자 추출 완료') + (prep.masked ? ' · 개인정보 ' + prep.masked + '건 가림' : '') + (prep.truncated || truncated ? ' · 일부만 사용' : '');
      entry.att = { kind: 'document', name: file.name, via: via, text: prep.text, truncated: prep.truncated || truncated };
    } catch (err) {
      console.error('[kdoctor-chat-widget] attach', err);
      entry.status = 'error';
      entry.label = err && err.rateLimited ? '요청이 많아 처리하지 못했습니다. 잠시 후 다시 시도해 주세요'
        : cls.kind === 'pdf' || cls.kind === 'docx' ? '읽지 못했습니다(문서 해석 모듈을 불러오지 못했거나 파일이 손상됨)' : '처리하지 못했습니다. 다시 시도해 주세요';
    }
  }

  async function addFiles(fileList, mode) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length || busy) return;
    if (!consented) {
      var ok = window.confirm('첨부한 사진·서류는 AI가 읽기 위해 서버로 전송됩니다(저장하지 않음).\n이름·주민등록번호 등 개인식별정보는 가능한 한 가리고 올려 주세요.\n계속할까요?');
      if (!ok) return;
      consented = true;
    }
    var entries = [];
    files.forEach(function (f) {
      var e = { id: ++attSeq, name: f.name || 'file', icon: mode === 'photo' ? '📷' : '📄', status: 'processing', label: '대기 중…' };
      if (attCount() + entries.filter(function (x) { return x.status !== 'error'; }).length >= L.maxFiles) { e.status = 'error'; e.label = '한 번에 ' + L.maxFiles + '개까지만 첨부할 수 있습니다'; }
      entries.push({ e: e, f: f });
    });
    entries.forEach(function (x) { atts.push(x.e); });
    chipRender();
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].e.status === 'error') continue;
      await processFile(entries[i].f, mode, entries[i].e);
      chipRender();
    }
  }

  // ─────────────── PDV(건강 기록) — "나만의 AI 비서"가 연 탭에서만 ───────────────
  var AC_ORIGINS = (Array.isArray(window.KDOCTOR_AC_ORIGINS) && window.KDOCTOR_AC_ORIGINS.length) ? window.KDOCTOR_AC_ORIGINS : ['https://hondi.net', 'https://www.hondi.net'];
  var qs = new URLSearchParams(location.search);
  var acOrigin = null;
  if (qs.get('gwp') === '1' && window.opener && !window.opener.closed) {
    var asked = qs.get('origin');
    acOrigin = AC_ORIGINS.indexOf(asked) >= 0 ? asked : null; // 허용 목록에 없는 출처에는 보내지 않는다
  }
  var pending = {}; // request_id → {resolve, timer, type}
  function newRid() { return 'kd-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
  window.addEventListener('message', function (e) {
    if (!acOrigin || e.origin !== acOrigin || e.source !== window.opener) return;
    var d = e.data;
    if (!d || typeof d !== 'object' || !pending[d.request_id]) return;
    var p = pending[d.request_id];
    if ((d.type === 'GWP_PDV_RESPONSE' && p.type === 'req') || (d.type === 'GWP_PDV_UPDATE_RESULT' && p.type === 'upd')) {
      clearTimeout(p.timer); delete pending[d.request_id]; p.resolve(d);
    }
  });
  function pdvPost(type, body, kind, timeoutMs) {
    return new Promise(function (resolve) {
      var rid = newRid();
      var timer = setTimeout(function () { delete pending[rid]; resolve(null); }, timeoutMs);
      pending[rid] = { resolve: resolve, timer: timer, type: kind };
      try { window.opener.postMessage(Object.assign({ type: type, request_id: rid }, body), acOrigin); }
      catch (err) { clearTimeout(timer); delete pending[rid]; resolve(undefined); }
    });
  }
  async function requestPdv(fields, reason) {
    if (!acOrigin) return { status: 'unavailable' };
    statusEl.textContent = '내 건강 기록 제공 승인을 기다리는 중… (나만의 AI 비서 창에서 승인해 주세요)';
    var d = await pdvPost('GWP_PDV_REQUEST', { fields: fields, reason: String(reason || '진단 참고').slice(0, 200), purpose: 'diagnosis_support' }, 'req', 180000);
    if (d === null) return { status: 'timeout' };
    if (d === undefined) return { status: 'error' };
    if (d.approved && d.values) return { status: 'ok', values: d.values };
    return { status: d.reason === 'ui_unavailable' ? 'error' : 'denied' };
  }
  async function addPdvAttachment() {
    if (busy) return;
    if (!acOrigin) { statusEl.textContent = '이 창은 나만의 AI 비서에서 연 창이 아니라 건강 기록을 불러올 수 없습니다. 비서에서 K-Doctor를 열어 주세요.'; return; }
    if (pdvState.count >= 3) { statusEl.textContent = '이 대화의 건강 기록 요청 한도에 도달했습니다.'; return; }
    if (atts.some(function (a) { return a.kind === 'pdv' && a.status !== 'error'; })) { statusEl.textContent = '건강 기록은 이미 첨부되어 있습니다.'; return; }
    var e = { id: ++attSeq, kind: 'pdv', name: '내 건강 기록', icon: '🔒', status: 'processing', label: '비서에 요청 중…' };
    if (attCount() >= L.maxFiles) { statusEl.textContent = '한 번에 ' + L.maxFiles + '개까지만 첨부할 수 있습니다.'; return; }
    atts.push(e); chipRender();
    pdvState.count++;
    var fields = HEALTH_FIELD_IDS.slice();
    var res = await requestPdv(fields, '진단 참고를 위한 병력·가족력·생활습관 확인');
    if (res.status === 'ok') {
      var got = fields.filter(function (f) { var v = res.values[f]; return v && v.value !== undefined; }).length;
      e.status = 'ready'; e.label = got + '개 항목 받음'; e.att = { kind: 'pdv_data', name: 'pdv', text: buildPdvBlock(res, fields) };
    } else {
      e.status = 'error'; e.label = { denied: '제공하지 않음', timeout: '응답 시간 초과', unavailable: '연결 안 됨' }[res.status] || '불러오지 못함';
    }
    statusEl.textContent = '';
    chipRender();
  }

  function renderProposals(props, holder) {
    if (!acOrigin || !props || !props.length) return;
    var w = document.createElement('div'); w.className = 'kd-prop';
    w.innerHTML = '📝 이번 상담에서 말씀하신 내용을 내 건강 기록에 남길 수 있습니다.<ul>' + props.map(function (p) {
      return '<li><b>' + escapeHtml(p.label) + '</b>: ' + escapeHtml(Array.isArray(p.value) ? p.value.join(', ') : String(p.value)) + '</li>';
    }).join('') + '</ul>';
    var b = document.createElement('button'); b.type = 'button'; b.textContent = '비서에 저장 요청';
    b.addEventListener('click', async function () {
      b.disabled = true; b.textContent = '비서에서 확인 중…';
      var d = await pdvPost('GWP_PDV_UPDATE_PROPOSAL', { proposals: props.map(function (p) { return { field: p.field, value: p.value, evidence: p.evidence }; }), reason: 'K-Doctor 상담 중 말씀하신 내용' }, 'upd', 180000);
      var n = d && Array.isArray(d.applied) ? d.applied.length : 0;
      b.remove();
      var r = document.createElement('div'); r.textContent = d === null ? '응답이 없어 저장하지 않았습니다.' : n ? n + '개 항목을 내 건강 기록에 저장했습니다.' : '저장하지 않았습니다.';
      w.appendChild(r);
    });
    w.appendChild(b); holder.querySelector('.kd-bubble').appendChild(w);
  }

  // + 메뉴
  function setMenu(open) { menuEl.hidden = !open; plusBtn.setAttribute('aria-expanded', open ? 'true' : 'false'); }
  plusBtn.addEventListener('click', function (e) { e.stopPropagation(); if (!busy) setMenu(menuEl.hidden); });
  document.addEventListener('click', function (e) { if (!menuEl.contains(e.target) && e.target !== plusBtn) setMenu(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });
  menuEl.addEventListener('click', function (e) {
    var act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
    if (!act) return;
    setMenu(false);
    if (act === 'photo') photoInput.click(); else if (act === 'doc') docInput.click(); else if (act === 'pdv') addPdvAttachment();
  });
  photoInput.addEventListener('change', function () { var f = photoInput.files; addFiles(f, 'photo').then(function () { photoInput.value = ''; }); });
  docInput.addEventListener('change', function () { var f = docInput.files; addFiles(f, 'doc').then(function () { docInput.value = ''; }); });

  function autoResize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; }
  input.addEventListener('input', autoResize);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  newBtn.addEventListener('click', function () {
    if (busy) return;
    history = []; atts = []; pdvState = { count: 0 }; msgsEl.innerHTML = ''; statusEl.textContent = ''; chipRender(); greet();
  });

  async function send() {
    var text = input.value.trim();
    var ready = atts.filter(function (a) { return a.status === 'ready' && a.att; });
    if ((!text && !ready.length) || busy || atts.some(function (a) { return a.status === 'processing'; })) return;
    var composed = composeUserText(text, ready.map(function (a) { return a.att; }), L);
    busy = true; input.value = ''; input.style.height = 'auto';
    var shown = escapeHtml(text || '(첨부 자료)');
    if (ready.length) shown += '<div class="kd-attach-list">' + ready.map(function (a) { return a.icon + ' ' + escapeHtml(a.name); }).join('<br>') + '</div>';
    atts = []; chipRender();
    append('user', shown);
    if (composed.dropped.length) statusEl.textContent = '분량 제한으로 제외한 첨부: ' + composed.dropped.join(', ');
    var typing = append('ai', '<div class="kd-typing"><span></span><span></span><span></span></div>');
    statusEl.textContent = '진료과목별 소견을 모으는 중… (최대 1~2분)';
    try {
      var res = await loadResources();
      var out = await runTurn(history, composed.text, {
        callLLM: callLLM, callCheck: function (sp, msgs, max) { return callLLM(sp, msgs, max, true); }, checkSP: res.checkSP, orchestratorSP: res.orchestratorSP, registry: res.registry, loadSpecialist: loadSpecialist,
        validate: validateDiagnosis, audienceView: audienceView, audience: undefined,
        pdvState: pdvState, requestPdv: acOrigin ? requestPdv : undefined,
      });
      history = out.history.slice(-24);
      typing.remove();
      var v = out.view, holder;
      if (v.type === 'report') { holder = append('ai', v.html); renderProposals(v.pdvProposals, holder); }
      else append('ai', renderMarkdown(v.text));
      var used = (v.consults || []).filter(function (c) { return c.ok; }).map(function (c) { return c.id.replace('kdoctor-', ''); });
      var rv = v.review;
      var rvTxt = rv && rv.verdict ? ' · 검수: ' + rv.verdict + (rv.reconciled ? '(재조정 반영)' : '') : (rv && rv.status === 'error' ? ' · 검수 실패(원 결과 표시)' : '');
      statusEl.textContent = (used.length ? '협진: ' + used.join(', ') : '') + rvTxt;
    } catch (err) {
      typing.remove();
      append('ai', renderMarkdown((err && err.rateLimited ? '요청이 많아 잠시 쉬어 갑니다. 1분쯤 뒤에 다시 보내 주세요.' : '상담 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.') + '\n\n' + FAILSAFE_TEXT));
      statusEl.textContent = '';
      console.error('[kdoctor-chat-widget]', err);
    }
    busy = false; updateSendState(); input.focus();
  }
  sendBtn.addEventListener('click', send);
})();
