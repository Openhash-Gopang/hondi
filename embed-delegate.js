/**
 * embed-delegate.js — hondi.net 페이지가 나비웹(mail.hondi.net · naviweb.kr) 화면 안에 iframe 으로 떠 있을 때, AI 입력을 그 화면의 기본 SP 로 넘기는 규약(2026-11-01).
 *
 * 원칙: 데스크탑 입력 필드와 이 페이지가 한 화면에 함께 있으면, 이 페이지의 SP 는 데스크탑 입력 필드의 SP(AC-PRO-CORE)다.
 *  호스트 → 페이지  { type:'hondi-embed-host', v:1, ai:'delegate' }                 위임 시작(호스트가 iframe 을 띄운 뒤 보낸다)
 *  페이지 → 호스트  { type:'hondi-embed-ai', id, text }                              사용자가 이 페이지의 AI 입력창에 쓴 말
 *  호스트 → 페이지  { type:'hondi-embed-ai-reply', id, text }                        호스트가 처리한 결과 요약(말풍선에 표시)
 *  호스트 → 페이지  { type:'hondi-embed-ai-note', text }                             뒤늦게 끝난 일(서류 수정 결과 등)
 * 호스트가 위임을 알리지 않으면(일반 접속·폰) 아무것도 바뀌지 않는다. 메시지는 부모 창에서 온 것이고 출처가 허용 목록에 있을 때만 받는다.
 */
(function (root) {
  'use strict';
  var HOSTS = ['https://mail.hondi.net', 'https://naviweb.kr', 'https://www.naviweb.kr'];
  var TEXT_MAX = 2000, REPLY_MAX = 2000, WAIT_MS = 90000;

  function isHost(ev, parentWin) {
    return !!ev && !!ev.data && typeof ev.data === 'object' && ev.source === parentWin && HOSTS.indexOf(ev.origin) >= 0;
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
    function send(text) {
      if (!origin) return undefined;
      var t = String(text == null ? '' : text).slice(0, TEXT_MAX); if (!t.trim()) return undefined;
      var id = 'e' + (++seq) + '-' + Date.now().toString(36);
      return new Promise(function (resolve) {
        pending[id] = { resolve: resolve, t: setTimeout(function () { delete pending[id]; resolve(null); }, opts.waitMs || WAIT_MS) };
        try { post({ type: 'hondi-embed-ai', id: id, text: t }, origin); } catch (e) { clearTimeout(pending[id].t); delete pending[id]; resolve(null); }
      });
    }
    return { onMessage: onMessage, send: send, active: function () { return !!origin; }, onNote: function (fn) { noteFn = fn; } };
  }
  var API = { HOSTS: HOSTS, isHost: isHost, create: create };
  root.EmbedDelegate = API;
})(typeof window !== 'undefined' ? window : globalThis);
