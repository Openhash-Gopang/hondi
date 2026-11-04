/**
 * embed-delegate.js — hondi.net 페이지가 나비웹(mail.hondi.net · naviweb.kr) 화면 안에 iframe 으로 떠 있을 때, AI 입력을 그 화면의 기본 SP 로 넘기는 규약(2026-11-01).
 *
 * 원칙: 데스크탑 입력 필드와 이 페이지가 한 화면에 함께 있으면, 이 페이지의 SP 는 데스크탑 입력 필드의 SP(AC-PRO-CORE)다.
 *  호스트 → 페이지  { type:'hondi-embed-host', v:1, ai:'delegate' }                 위임 시작(호스트가 iframe 을 띄운 뒤 보낸다)
 *  페이지 → 호스트  { type:'hondi-embed-ai', id, text }                              사용자가 이 페이지의 AI 입력창에 쓴 말
 *   (files 가 있으면 { files:[{name,mime,isImage,text,dataUrl}] } 이 함께 간다 — 서류 SP 가 읽을 자료)
 *  호스트 → 페이지  { type:'hondi-embed-ai-reply', id, text }                        호스트가 처리한 결과 요약(말풍선에 표시)
 *  호스트 → 페이지  { type:'hondi-embed-ai-note', text }                             뒤늦게 끝난 일(서류 수정 결과 등)
 * 호스트가 위임을 알리지 않으면(일반 접속·폰) 아무것도 바뀌지 않는다. 메시지는 부모 창에서 온 것이고 출처가 허용 목록에 있을 때만 받는다.
 *
 * 서류 작성 도우미 인계(2026-11-04): 서류 화면이 떠 있어 대화창 SP 가 '서류 작성 도우미'(inline:doc:…)일 때, 그 SP 가 답변 끝에 내는 태그를 호스트로 올린다.
 *  [AGENT_TASK: slot=<첨부서류 항목>; goal=<도우미가 할 일 한 문장>]   → 페이지 → 호스트  { type:'hondi-embed-agent-task', slot, goal }
 *  [DOC_HANDBACK: reason=cancel|complete]                              → 페이지 → 호스트  { type:'hondi-embed-doc-handback', reason }
 * 태그는 화면에 보이지 않게 지운다. 호스트가 실제로 실행할지(확장 연결·저장 여부)는 호스트가 정한다 — 이 파일은 읽어서 올리기만 한다.
 */
(function (root) {
  'use strict';
  var HOSTS = ['https://mail.hondi.net', 'https://naviweb.kr', 'https://www.naviweb.kr'];
  var TEXT_MAX = 2000, REPLY_MAX = 2000, WAIT_MS = 90000, FILES_MAX = 4, TEXT_FILE_MAX = 20000, DATA_MAX = 8 * 1024 * 1024;

  function isHost(ev, parentWin) {
    return !!ev && !!ev.data && typeof ev.data === 'object' && ev.source === parentWin && HOSTS.indexOf(ev.origin) >= 0;
  }
  /** 대화창에 첨부한 파일을 호스트로 넘길 형태로 줄인다 — 최대 FILES_MAX 개, 본문 텍스트(≤TEXT_FILE_MAX)와 사진·PDF 원본(dataUrl ≤DATA_MAX). */
  function packFiles(files) {
    var out = [], a = Array.isArray(files) ? files : [];
    for (var i = 0; i < a.length && out.length < FILES_MAX; i++) {
      var f = a[i]; if (!f || !f.name) continue;
      var mime = String(f.mimeType || f.type || ''), du = typeof f.dataUrl === 'string' && f.dataUrl.indexOf('data:') === 0 && f.dataUrl.length <= DATA_MAX ? f.dataUrl : '';
      var tx = typeof f.extractedText === 'string' ? f.extractedText.slice(0, TEXT_FILE_MAX) : '';
      if (!du && !tx) continue;
      out.push({ name: String(f.name).slice(0, 120), mime: mime.slice(0, 80), isImage: !!f.isImage, text: tx, dataUrl: (f.isImage || /pdf/i.test(mime)) ? du : '' });
    }
    return out;
  }
  function create(opts) {
    var parentWin = opts.parent, post = opts.post, origin = '', pending = {}, noteFn = null, seq = 0;
    function onMessage(ev) {
      if (!isHost(ev, parentWin)) return false;
      var d = ev.data;
      if (d.type === 'hondi-embed-host') { origin = d.ai === 'delegate' ? ev.origin : ''; return true; }
      if (d.type === 'hondi-embed-ai-reply') {
        var p = pending[String(d.id || '')]; if (!p) return true;
        delete pending[d.id]; clearTimeout(p.t); p.resolve(String(d.text == null ? '' : d.text).slice(0, REPLY_MAX)); return true;
      }
      if (d.type === 'hondi-embed-ai-note') { if (noteFn) noteFn(String(d.text == null ? '' : d.text).slice(0, REPLY_MAX)); return true; }
      return false;
    }
    /** 위임 중이면 호스트로 보내고 결과 문장을 돌려준다(시간 초과면 null). 위임 중이 아니면 undefined — 호출자가 기존 처리를 한다. */
    function send(text, files) {
      if (!origin) return undefined;
      var t = String(text == null ? '' : text).slice(0, TEXT_MAX);
      var fl = packFiles(files);
      if (!t.trim() && !fl.length) return undefined;
      var id = 'e' + (++seq) + '-' + Date.now().toString(36);
      return new Promise(function (resolve) {
        pending[id] = { resolve: resolve, t: setTimeout(function () { delete pending[id]; resolve(null); }, opts.waitMs || WAIT_MS) };
        try { post({ type: 'hondi-embed-ai', id: id, text: t, files: fl.length ? fl : undefined }, origin); } catch (e) { clearTimeout(pending[id].t); delete pending[id]; resolve(null); }
      });
    }
    return { onMessage: onMessage, send: send, active: function () { return !!origin; }, onNote: function (fn) { noteFn = fn; } };
  }
  /**
   * 순수 함수 — 서류 SP 의 답변에서 [AGENT_TASK: …]·[DOC_HANDBACK: …] 를 뽑고 지운 본문을 돌려준다.
   * tasks: 한 답변에 최대 2건, slot ≤ 80자 · goal ≤ 300자, 제어문자 제거. 형식이 틀린 태그는 버리되 화면에서는 지운다.
   * handback: 'cancel' | 'complete' | null (여러 번 나오면 마지막 것).
   */
  var TASK_MAX = 2, SLOT_MAX = 80, GOAL_MAX = 300;
  function oneLine(s, n) { return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n); }
  function parseDocTags(text) {
    var tasks = [], handback = null;
    var clean = String(text == null ? '' : text)
      .replace(/\[AGENT_TASK:\s*([^\]]*)\]/g, function (m, body) {
        var mm = /slot\s*=\s*([^;]*?)\s*;\s*goal\s*=\s*([\s\S]+)$/.exec(body);
        if (!mm) return '';
        var slot = oneLine(mm[1], SLOT_MAX), goal = oneLine(mm[2], GOAL_MAX);
        if (slot && goal && tasks.length < TASK_MAX) tasks.push({ slot: slot, goal: goal });
        return '';
      })
      .replace(/\[DOC_HANDBACK:\s*([^\]]*)\]/g, function (m, body) {
        var mm = /reason\s*=\s*(cancel|complete)\b/i.exec(body);
        if (mm) handback = mm[1].toLowerCase();
        return '';
      });
    return { tasks: tasks, handback: handback, clean: clean.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() };
  }

  var API = { HOSTS: HOSTS, isHost: isHost, create: create, packFiles: packFiles, parseDocTags: parseDocTags };
  root.EmbedDelegate = API;
})(typeof window !== 'undefined' ? window : globalThis);
